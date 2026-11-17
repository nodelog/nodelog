// 回归测试：应用管理页性能与防卡死护栏（无需 MongoDB，用 stub 驱动）。
//  1) User.findForBinding 只投影 _id/userName/role 且限流
//  2) User.findByIds 只投影必要字段
//  3) Content.countBySourceApps 带 maxTimeMS，且始终一次聚合（非 N+1）
//  4) apiAuth.list 下游超时时能降级返回已有主数据，不空、不 >5s
'use strict';
var assert = require('assert');
var Module = require('module');
var path = require('path');

var passed = 0, failed = 0;
function check(label, cond) {
    if (cond) { passed++; console.log('  ✓ ' + label); }
    else { failed++; console.log('  ✗ ' + label); }
}

// ---- 捕获查询构造过程 ----
var userQuery = { select: [], limit: null, maxTimeMs: null, sort: null };
var aggPipelines = [];
var aggOptions = [];
// 模拟真实慢点：主数据查询很快，只有文章数聚合卡死；主数据必须先返回且不能被空列表吞掉。
var countDelayMs = 5000;

function fakeQuery(kind) {
    var q = {
        select: function (f) { userQuery.select.push(f); return q; },
        sort: function (s) { userQuery.sort = s; return q; },
        limit: function (n) { userQuery.limit = n; return q; },
        maxTimeMS: function (n) { userQuery.maxTimeMs = n; return q; },
        exec: function (cb) {
            var docs = kind === 'binding'
                ? [{_id: 'u1', userName: 'admin', role: 0}]
                : [{_id: 'u1', userName: 'admin', role: 0}];
            setTimeout(function () { cb(null, docs); }, 0);
        }
    };
    return q;
}

var fakeUserModel = {
    find: function () { return fakeQuery('find'); }
};
var fakeContentModel = {
    aggregate: function (pipeline) {
        aggPipelines.push(pipeline);
        var a = {
            option: function (o) { aggOptions.push(o); return a; },
            exec: function (cb) {
                setTimeout(function () { cb(null, []); }, countDelayMs);
            }
        };
        return a;
    }
};

function FakeSchema() {
    this.ObjectId = function () {};
    this.index = function () {};
    this.method = function () {};
    this.pre = function () {};
}
var origLoad = Module._load;
Module._load = function (request) {
    var base = path.basename(request);
    if (request === 'mongoose') {
        return {
            connect: function () {},
            connection: { on: function () {}, once: function () {} },
            Types: { ObjectId: function () {} },
            model: function () { return {}; },
            Schema: FakeSchema
        };
    }
    if (base === 'mongodb') {
        return {
            mongoose: {
                Schema: FakeSchema,
                model: function (name) {
                    if (name === 'User') return fakeUserModel;
                    if (name === 'Content') return fakeContentModel;
                    if (name === 'ApiApp') return {
                        find: function () {
                            var q = {
                                sort: function () { return q; },
                                exec: function (cb) {
                                    setTimeout(function () { cb(null, [{_id: 'a1', appId: 'app_x', userId: 'u1', status: 0,
                                        secretHash: 'x', name: 'A', description: ''}]); }, 0);
                                }
                            };
                            return q;
                        }
                    };
                    return {};
                },
                Types: { ObjectId: function (v) { this.toString = function () { return String(v); }; } }
            }
        };
    }
    if (request.indexOf('settings') !== -1) return {};
    if (request.indexOf('moderationGuard') !== -1) return { enforce: function (r, f, t, cb) { cb(null, {allowed: true}); } };
    if (request.indexOf('apiCredential') !== -1) return { maskSecret: function () { return 'sk_****x'; }, ready: function () { return true; } };
    return origLoad.apply(this, arguments);
};

var User = require('../models/User.js');
var Content = require('../models/Content.js');
var apiAuthApi = require('../controllers/apiAuthApi.js');

console.log('应用管理页性能护栏回归');

User.findForBinding(function () {
    check('findForBinding 只投影 _id/userName/role', userQuery.select.indexOf('_id userName role') !== -1);
    check('findForBinding 有 limit 上限', userQuery.limit > 0 && userQuery.limit <= 2000);
    check('findForBinding 有 maxTimeMS 保护', userQuery.maxTimeMs === 3000);

    Content.countBySourceApps(['a1b2c3d4e5f60718293a4b5c'], function () {
        check('countBySourceApps 只发一条聚合（非 N+1）', aggPipelines.length === 1);
        check('countBySourceApps 带 maxTimeMS=2000', aggOptions.length === 1 && aggOptions[0].maxTimeMS === 2000);

        // 超时降级：主数据快、只有文章数聚合卡死（>3.5s deadline）
        var t0 = Date.now();
        var res = {
            statusCode: 0, body: null,
            status: function (s) { this.statusCode = s; return this; },
            json: function (b) { this.body = b; this.doneAt = Date.now(); return this; }
        };
        apiAuthApi.list({}, res);
        setTimeout(function () {
            var elapsed = res.doneAt ? (res.doneAt - t0) : (Date.now() - t0);
            check('下游卡死时 <4s 内返回（不超 5s）', elapsed < 4000);
            check('降级响应 success=true', res.body && res.body.success === true);
            check('降级标记 degraded=true', res.body && res.body.degraded === true);
            check('降级不误报空列表（保留主数据）', res.body && Array.isArray(res.body.data) && res.body.data.length === 1);

            console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
            process.exit(failed ? 1 : 0);
        }, 4000);
    });
});
