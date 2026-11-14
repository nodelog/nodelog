// 回归测试：验证 articleApi.publish 接受文档约定的 title 字段（契约修复）。
// 本地无 mongod，故把 mongoose 与 models 全部 stub 掉，直接驱动 publish 完整链路，
// 断言「只传 title → 不再 400 标题不能为空 → 201」。
'use strict';
var Module = require('module');
var path = require('path');

var passed = 0, failed = 0;
function check(label, cond) {
    if (cond) { passed++; console.log('  ✓ ' + label); }
    else { failed++; console.log('  ✗ ' + label); }
}

// ---- stub 层 ----
var fakeMongoose = {
    connect: function () {},
    connection: { on: function () {}, once: function () {} },
    Types: { ObjectId: function () {} }
};
var LAST_SAVE = null;
function makeStub() {
    return {
        findByName: function (a, b) {
            var cb = (typeof a === 'function') ? a : b;
            cb(null, null);
        },
        findAll: function (cb) { cb(null, [{ _id: 'c1', name: '技术', keywords: '' }]); },
        findById: function (id, cb) { cb(null, null); },
        save: function (obj, cb) {
            obj._id = 'a1b2c3d4e5f60718293a4b5c';
            obj.slug = obj.slug || 'slug';
            obj.createTime = Date.now();
            LAST_SAVE = obj;
            cb(null, obj);
        },
        reconcileForContent: function (a, b, cb) { cb(null); }
    };
}
var origLoad = Module._load;
Module._load = function (request) {
    if (request === 'mongoose') return fakeMongoose;
    var base = path.basename(request);
    if (request.indexOf('models/') !== -1) {
        if (base === 'Content.js' || base === 'Category.js' || base === 'User.js' || base === 'Tag.js') return makeStub();
        if (base === 'constants') return { CONTENT_ENABLE_STATUS: 0, CONTENT_SELF_STATUS: 2, USER_ENABLE_STATUS: 0 };
    }
    if (request.indexOf('moderationGuard') !== -1) {
        return { enforce: function (req, fields, type, cb) { cb(null, { allowed: true }); } };
    }
    return origLoad.apply(this, arguments);
};

var articleApi = require('../controllers/articleApi');

function runPublish(body, done) {
    LAST_SAVE = null;
    var req = {
        body: body,
        headers: {},
        apiAuthor: { _id: 'author12345678901234567890' }
    };
    var res = {
        statusCode: 0, body: null,
        status: function (s) { this.statusCode = s; return this; },
        json: function (b) { this.body = b; }
    };
    articleApi.publish(req, res);
    done(res);
}

console.log('契约回归：publish 接受 title 别名');
runPublish({ title: '测试标题', content: '正文', category: '技术', tags: ['a'] }, function (res) {
    check('只传 title → 201（不再 400 标题不能为空）', res.statusCode === 201);
    check('落库对象 name 取到了 title 值', LAST_SAVE && LAST_SAVE.name === '测试标题');
    check('响应含 id', res.body && /^[a-f\d]{24}$/.test(res.body.id));

    runPublish({ name: '老字段名', content: '正文', category: '技术', tags: ['a'] }, function (res2) {
        check('已传 name → 仍 201（向后兼容同步脚本）', res2.statusCode === 201);
        check('落库 name 取 name 值', LAST_SAVE && LAST_SAVE.name === '老字段名');

        runPublish({ content: '无标题正文', category: '技术', tags: ['a'] }, function (res3) {
            check('title 与 name 都缺 → 400 标题不能为空', res3.statusCode === 400 && /标题不能为空/.test(res3.body.msg));

            console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
            process.exit(failed ? 1 : 0);
        });
    });
});
