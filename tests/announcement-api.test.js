/**
 * 公告发布 API 的逻辑回归（用内存 mock 替掉 Log DAO，无需 MongoDB）。
 * 运行：node tests/announcement-api.test.js
 * 重点验证：commitHash 幂等、Token 鉴权、HTML 转义、非法入参拒绝。
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
process.env.ANNOUNCEMENT_API_TOKENS = TOKEN;
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

t('未设环境变量时，复用 settings.js 的 articleApi.tokens 通过鉴权', function () {
    var settings = null;
    try { settings = require('../settings'); } catch (e) { settings = null; }
    var list = settings && settings.articleApi && settings.articleApi.tokens;
    if (!list || !list.length) {
        console.log('    (本机无 settings.js articleApi 配置，跳过该环境相关断言)');
        return;
    }
    delete process.env.ANNOUNCEMENT_API_TOKENS;   // 强制走 settings.js 回退
    var res = fakeRes();
    var next = false;
    api.auth({ headers: { authorization: 'Bearer ' + list[0].token } }, res, function () { next = true; });
    assert.strictEqual(next, true, 'settings.js 的 articleApi token 应被公告接口接受');
});

console.log('\n全部通过：' + passed + ' 项');
process.exit(0);
