/**
 * 公告发布 API 的逻辑回归（用内存 mock 替掉 Log DAO，无需 MongoDB）。
 * 运行：node tests/announcement-api.test.js
 *
 * v3 说明：
 *   - 鉴权已统一为应用凭证（adminOnly），由 controllers/announcementApi.js 在模块加载时
 *     绑定 articleApi.authenticate({adminOnly:true})；真实鉴权（AppID+签名换 token、
 *     adminOnly 校验等）由 scripts/test-api-credential.js 完整覆盖，此处 stub 掉以便专注逻辑。
 *   - 静态 token 已彻底废弃，不再有 ANNOUNCEMENT_API_TOKENS / settings.js token 回退。
 *   - 重点验证发布逻辑：commitHash 幂等、HTML 转义、非法入参拒绝、优化类提交、已下架不重发。
 */
'use strict';

var assert = require('assert');

var logPath = require.resolve('../models/Log.js');
var store = [];
require.cache[logPath] = {
    id: logPath, filename: logPath, loaded: true,
    exports: {
        findAnyByCommitHash: function (hash, cb) {
            cb(null, store.filter(function (d) { return d.commitHash === hash; })[0] || null);
        },
        findAnyByName: function (name, cb) {
            cb(null, store.filter(function (d) { return d.name === name; })[0] || null);
        },
        save: function (obj, cb) {
            var doc = Object.assign({ _id: 'mock' + (store.length + 1) }, obj);
            store.push(doc);
            cb(null, doc);
        }
    }
};

var TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

// v3：announcementApi.js 在模块加载时即执行 articleApi.authenticate({adminOnly:true})。
// 这里在 require 之前替换被缓存 articleApi 模块的 authenticate，注入轻量 stub，
// 让本测试只关注发布逻辑，不依赖 cred.init()/MongoDB。真实鉴权见 scripts/test-api-credential.js。
var articleApi = require('../controllers/articleApi');
articleApi.authenticate = function () {
    return function (req, res, next) {
        var h = req.headers['authorization'] || req.headers['x-api-token'] || '';
        if (!h) return res.status(401).json({ success: false });
        next();
    };
};
var api = require('../controllers/announcementApi');

function fakeRes() {
    return {
        code: 200, body: null,
        status: function (c) { this.code = c; return this; },
        json: function (b) { this.body = b; return this; }
    };
}
function payload(subject) {
    return {
        commit: 'c0ffee1234567890abcdef1234567890abcdef12',
        subject: subject || 'feat(announcement): 自动发布新功能公告',
        body: '说明第一行\n<script>alert(1)</script>',
        author: 'jiang',
        date: '2026-11-15T02:30:00+08:00',
        repoUrl: 'https://github.com/nodelog/nodelog.git'
    };
}

var passed = 0;
function t(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

console.log('announcementApi 单元测试（mock DAO）');

t('Token 缺失 → 401', function () {
    var res = fakeRes();
    var next = false;
    api.auth({ headers: {} }, res, function () { next = true; });
    assert.strictEqual(res.code, 401);
    assert.strictEqual(next, false);
});

t('Token 正确 → 放行', function () {
    var res = fakeRes();
    var next = false;
    api.auth({ headers: { authorization: 'Bearer ' + TOKEN } }, res, function () { next = true; });
    assert.strictEqual(next, true);
});

t('发布合法 feat 提交 → 201 且正文已转义', function () {
    var res = fakeRes();
    api.publish({ body: payload() }, res);
    assert.strictEqual(res.code, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(store.length, 1);
    assert.ok(store[0].content.indexOf('<script>') === -1, '不得写入可执行脚本');
    assert.ok(store[0].content.indexOf('&lt;script&gt;') !== -1);
    assert.ok(store[0].name.indexOf('c0ffee1') !== -1);
});

t('同一 commit 二次发布 → duplicate，不产生第二条公告', function () {
    var res = fakeRes();
    api.publish({ body: payload() }, res);
    assert.strictEqual(res.code, 200);
    assert.strictEqual(res.body.duplicate, true);
    assert.strictEqual(store.length, 1);
});

t('非 feat 提交 / 非法 hash → 400 且不落库', function () {
    var r1 = fakeRes(), r2 = fakeRes();
    var bad = payload('feat: x');
    bad.commit = 'oops';
    api.publish({ body: payload('fix(editor): 修个 bug') }, r1);
    api.publish({ body: bad }, r2);
    assert.strictEqual(r1.code, 400);
    assert.strictEqual(r2.code, 400);
    assert.strictEqual(store.length, 1);
});

t('后台 CSV 已导入同名公告（无 commitHash）→ 仍判定重复，不产生第二条', function () {
    store.length = 0;
    var built = require('../services/releaseNote').buildAnnouncement(payload());
    store.push({ _id: 'manual1', name: built.name, content: '纯文本导入的公告' });
    var res = fakeRes();
    api.publish({ body: payload() }, res);
    assert.strictEqual(res.code, 200);
    assert.strictEqual(res.body.duplicate, true);
    assert.strictEqual(store.length, 1);
});

t('优化类提交可发布，标题为【优化升级】且正文标明类型', function () {
    store.length = 0;
    var res = fakeRes();
    api.publish({ body: payload('refactor(ui): 统一设计系统并精简前后台视图') }, res);
    assert.strictEqual(res.code, 201);
    assert.ok(store[0].name.indexOf('【优化升级·ui】') === 0);
    assert.ok(store[0].content.indexOf('站点完成以下优化升级') !== -1);
});

t('已下架(status=1)的公告不会被 hook/CI 自动重发', function () {
    store.length = 0;
    var built = require('../services/releaseNote').buildAnnouncement(payload());
    store.push({ _id: 'off1', name: built.name, commitHash: built.commitHash, status: 1 });
    var res = fakeRes();
    api.publish({ body: payload() }, res);
    assert.strictEqual(res.code, 200);
    assert.strictEqual(res.body.duplicate, true);
    assert.strictEqual(store.length, 1, '不得再插入一条同名公告');
});

t('v3 鉴权：真实 adminOnly 应用凭证鉴权由脚本覆盖，此处仅验证 stub 备用请求头', function () {
    // v3：静态 token 已彻底废弃；真实的应用凭证鉴权（AppID+签名换 token、adminOnly 校验）
    // 由 scripts/test-api-credential.js 完整覆盖，不再断言任何静态 token 可通过鉴权。
    // 此处只验证注入的鉴权中间件对 X-API-Token 备用请求头的放行行为。
    var res = fakeRes();
    var next = false;
    api.auth({ headers: { 'x-api-token': 'any-access-token' } }, res, function () { next = true; });
    assert.strictEqual(next, true, 'stub 鉴权应接受 X-API-Token 备用请求头');
    console.log('    (真实 adminOnly 应用凭证鉴权见 scripts/test-api-credential.js，静态 token 已废弃)');
});

console.log('\n全部通过：' + passed + ' 项');
process.exit(0);
