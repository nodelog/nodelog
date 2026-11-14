/* 回归测试：后台批量改状态 / 批量删除对「已禁用」记录失败。
 *
 * 复现场景（2026-11-15 用户截图）：/manager/content/admin 列表里 8 条记录全是「禁用」，
 * 点「批量改状态→正常」和「批量删除」后，每一行都被标红「操作失败」。
 *
 * 根因：adminCrud 的 status/remove/batch 把【列表可见性过滤 desc.soft】当成【写定位条件】
 * 传给 DAO，再叠加 DAO 用 modifiedCount 判定成功。已禁用记录 status=1 不满足 soft 的
 * {status:{$ne:1}}，且 no-op $set 的 modifiedCount=0，于是逐条返回 changed=0 →
 * 被误判成「目标不存在或无权操作」。
 *
 * 本测试用内存假 DAO 模拟 Mongoose 6 的 Model.update 语义（matchedCount/modifiedCount），
 * 不连数据库、不改数据，可离线重复运行：
 *   node tests/batch-write-scope.test.js
 */
var assert = require('assert');
var path = require('path');

// 审计日志是 DB 写入，测试里替换成空实现（只验证批量编排，不验证审计落库）。
var auditPath = require.resolve('../models/AuditLog');
require.cache[auditPath] = {
    id: auditPath, filename: auditPath, loaded: true, exports: {
        save: function (doc, cb) { cb(null); }
    }
};

var crud = require('../controllers/adminCrud');
// 真实 DAO 的 adminUpdate 回调第二个参数是 toCount(result) 之后的【数字】，不是 UpdateResult 对象。
var adminDao = require('../models/_adminDao');

/* ---------------- 极简 Mongo 查询匹配器（只覆盖本项目 where 用到的操作符） ---------------- */
function matchOne(doc, q) {
    return Object.keys(q || {}).every(function (k) {
        var cond = q[k];
        var val = doc[k];
        if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
            return Object.keys(cond).every(function (op) {
                if (op === '$ne') return val !== cond[op];
                if (op === '$lt') return val < cond[op];
                if (op === '$lte') return val <= cond[op];
                if (op === '$gte') return val >= cond[op];
                return false;
            });
        }
        return String(val) === String(cond);
    });
}

/* 假 DAO：完全复刻 models/_adminDao.js 的查询拼装 + Mongoose 6 UpdateResult 语义 */
function makeModel(docs) {
    var db = {};
    docs.forEach(function (d) { db[String(d._id)] = Object.assign({}, d); });
    function find(id, where) {
        var doc = db[String(id)];
        if (!doc) return null;
        return matchOne(Object.assign({_id: doc._id}, doc), Object.assign({_id: id}, where || {})) ? doc : null;
    }
    function update(id, where, fields, cb) {
        var doc = find(id, where);
        if (!doc) return cb(null, adminDao.toCount({matchedCount: 0, modifiedCount: 0, acknowledged: true}));
        var changed = 0;
        Object.keys(fields || {}).forEach(function (k) {
            if (k === 'modifyTime') return;
            if (String(doc[k]) !== String(fields[k])) { doc[k] = fields[k]; changed++; }
        });
        // MongoDB：命中但值未变 → matchedCount=1 / modifiedCount=0
        var result = {matchedCount: 1, modifiedCount: changed > 0 ? 1 : 0, acknowledged: true};
        cb(null, adminDao.toCount(result));
    }
    return {
        db: db,
        adminFindById: function (id, where, cb) { cb(null, find(id, where)); },
        adminUpdate: update,
        adminSoftDelete: function (id, where, cb) { return update(id, where, {status: 1}, cb); }
    };
}

function fakeReq(body) {
    return {
        method: 'POST', path: '/manager/content/batch', ip: '127.0.0.1',
        headers: {}, connection: {}, query: {}, body: body,
        session: {user: {_id: '000000000000000000000000', role: 0, userName: 'admin'}}
    };
}
function fakeRes(done) {
    return {
        statusCode: 200,
        status: function (n) { this.statusCode = n; return this; },
        json: function (body) { done(this.statusCode, body); },
        redirect: function () { throw new Error('unexpected redirect'); }
    };
}
function runBatch(handler, body) {
    return new Promise(function (resolve) {
        handler(fakeReq(body), fakeRes(function (status, data) { resolve({status: status, data: data}); }));
    });
}

// 与 controllers/contentAdmin.js 的 contentDesc 完全一致
var desc = {soft: {status: {$ne: 1}, draft: {$ne: true}}, owner: 'author'};
function cfgOf(Model) {
    return {
        Model: Model, desc: desc, target: 'content', shape: 'success', statusRange: [0, 2],
        beforeStatus: function (id, where, req, cb) { Model.adminFindById(id, where, cb); },
        afterStatus: function (id, oldDoc, status, req, cb) { cb(null); },
        beforeDelete: function (id, where, req, cb) { Model.adminFindById(id, where, cb); },
        afterDelete: function (id, oldDoc, req, cb) { cb(null); }
    };
}

var IDS = ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccc'];
function seed(status) {
    return IDS.map(function (id) {
        return {_id: id, name: '文章', author: '000000000000000000000000', status: status, draft: false};
    });
}
function resultsOf(r) { return (r.data && r.data.results) || []; }
function okCount(r) { return resultsOf(r).filter(function (x) { return x.ok; }).length; }

var failures = [];
function check(name, cond, detail) {
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
    if (!cond) failures.push(name);
}

(async function () {
    // 场景 1：列表里全是「禁用」(status=1)，批量改为「正常」(status=0)
    var m1 = makeModel(seed(1));
    var r1 = await runBatch(crud.batch(cfgOf(m1)), {ids: IDS, action: 'status', status: '0'});
    check('批量改状态：3 条已禁用 → 全部成功', r1.status === 200 && okCount(r1) === 3,
        'status=' + r1.status + ' ok=' + okCount(r1) + ' msg=' + JSON.stringify(resultsOf(r1).map(function (x) { return x.msg; })));

    // 场景 2：同一批已禁用记录，批量删除（幂等：软删目标值本来就是 1）
    var m2 = makeModel(seed(1));
    var r2 = await runBatch(crud.batch(cfgOf(m2)), {ids: IDS, action: 'delete'});
    check('批量删除：3 条已禁用 → 全部成功（幂等）', r2.status === 200 && okCount(r2) === 3,
        'status=' + r2.status + ' ok=' + okCount(r2) + ' msg=' + JSON.stringify(resultsOf(r2).map(function (x) { return x.msg; })));

    // 场景 3：正常记录改为「正常」（no-op $set，modifiedCount=0 但 matchedCount=1）
    var m3 = makeModel(seed(0));
    var r3 = await runBatch(crud.batch(cfgOf(m3)), {ids: IDS, action: 'status', status: '0'});
    check('批量改状态：目标值等于当前值 → 幂等成功', r3.status === 200 && okCount(r3) === 3,
        'status=' + r3.status + ' ok=' + okCount(r3));

    // 场景 4：单条状态接口，禁用 → 正常（同一 where 缺陷也影响单条）
    var m4 = makeModel(seed(1));
    var r4 = await runBatch(crud.status(cfgOf(m4)), {id: IDS[0], status: '0'});
    check('单条改状态：已禁用 → 正常 成功', r4.status === 200 && r4.data && r4.data.success !== false,
        'status=' + r4.status + ' body=' + JSON.stringify(r4.data));

    // 场景 5：归属约束不能被削弱——非管理员只能改自己的（保护性回归）
    var m5 = makeModel(seed(1));
    m5.db[IDS[0]].author = 'ffffffffffffffffffffffff';
    var req5 = fakeReq({ids: IDS, action: 'status', status: '0'});
    req5.session.user.role = 1;
    var r5 = await new Promise(function (resolve) {
        crud.batch(cfgOf(m5))(req5, fakeRes(function (s, d) { resolve({status: s, data: d}); }));
    });
    var mine = resultsOf(r5).filter(function (x) { return x.ok; }).map(function (x) { return String(x.id); });
    check('归属隔离：非管理员不能改他人记录', r5.status === 200 && mine.length === 2 && mine.indexOf(IDS[0]) === -1,
        'ok=' + JSON.stringify(mine));

    // 场景 6：文档确实不存在 → 仍必须判失败（不能因为改用 matchedCount 就一律算成功）
    var m6 = makeModel(seed(1));
    var r6 = await runBatch(crud.batch(cfgOf(m6)), {
        ids: [IDS[0], 'dddddddddddddddddddddddd'], action: 'delete'
    });
    var oks6 = resultsOf(r6).filter(function (x) { return x.ok; }).map(function (x) { return String(x.id); });
    check('不存在的 id 仍被判失败', r6.status === 200 && oks6.length === 1 && oks6[0] === IDS[0],
        'ok=' + JSON.stringify(oks6));

    // 场景 7：上限校验零执行（101 条 → 4xx），安全边界未被改动
    var many = [];
    for (var i = 0; i < 101; i++) many.push(IDS[0]);
    var r7 = await runBatch(crud.batch(cfgOf(makeModel(seed(1)))), {ids: many, action: 'delete'});
    check('批量 101 条 → 4xx 且零执行', r7.status >= 400 && r7.status < 500 && okCount(r7) === 0,
        'status=' + r7.status);

    console.log('\n' + (failures.length ? 'FAILED: ' + failures.length + ' 项' : 'ALL PASS'));
    process.exit(failures.length ? 1 : 0);
})().catch(function (e) { console.error(e.stack || e); process.exit(2); });
