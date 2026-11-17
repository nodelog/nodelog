// 离线测试 v3：零配置主密钥 + 应用密钥派生 JWT + 统一鉴权 + adminOnly + 来源不可篡改。
// stub mongoose/models，无需本地 mongod。
'use strict';
var Module = require('module');
var path = require('path');
var passed = 0, failed = 0;
function check(label, cond) {
    if (cond) { passed++; console.log('  ✓ ' + label); }
    else { failed++; console.log('  ✗ ' + label); }
}

// ---- stub 层 ----
var FAKE_APP = null, FAKE_USER = null;
var MASTER = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
var fakeMongoose = {
    connect: function () {},
    connection: {on: function () {}, once: function () {}},
    Types: {ObjectId: function (v) { this.v = v; }},
    Schema: function (d) { this.obj = d; },
    model: function () { return function () {}; }
};
fakeMongoose.Schema.ObjectId = function () {};

function fakeSystemConfigDAO() {
    return {getOrCreateMasterKey: function (cb) { cb(null, MASTER); }};
}
function fakeUserDAO() {
    return {findById: function (id, cb) { cb(null, FAKE_USER); }, findByIds: function (ids, cb) { cb(null, FAKE_USER ? [FAKE_USER] : []); }};
}
function fakeApiAppDAO() {
    return {
        findByAppId: function (appId, cb) { cb(null, FAKE_APP && FAKE_APP.appId === appId ? FAKE_APP : null); },
        findById: function (id, cb) { cb(null, FAKE_APP); },
        findByIdAny: function (id, cb) { cb(null, FAKE_APP); },
        touch: function (id, cb) { cb(null); }
    };
}
function fakeContentDAO() { return {}; }
function fakeCategoryDAO() { return {findAll: function (cb) { cb(null, []); }}; }
function fakeTagDAO() { return {reconcileForContent: function (a, b, cb) { cb(null); }}; }

var origLoad = Module._load;
Module._load = function (request) {
    if (request === 'mongoose') return fakeMongoose;
    var base = path.basename(request);
    if (request.indexOf('models/SystemConfig') !== -1) return fakeSystemConfigDAO();
    if (request.indexOf('models/ApiApp') !== -1) return fakeApiAppDAO();
    if (request.indexOf('models/User') !== -1) return fakeUserDAO();
    if (request.indexOf('models/Content') !== -1) return fakeContentDAO();
    if (request.indexOf('models/Category') !== -1) return fakeCategoryDAO();
    if (request.indexOf('models/Tag') !== -1) return fakeTagDAO();
    if (base === 'constants') return {CONTENT_ENABLE_STATUS: 0, CONTENT_SELF_STATUS: 2, USER_ENABLE_STATUS: 0, CONTENT_UNABLE_STATUS: 1};
    if (request.indexOf('moderationGuard') !== -1) return {enforce: function (req, fields, type, cb) { cb(null, {allowed: true}); }};
    return origLoad.apply(this, arguments);
};

var cred = require('../services/apiCredential');

console.log('=== 0. 零配置初始化 ===');
check('init 前 ready=false', cred.ready() === false);
cred.init(function (err) {
    check('init 后 ready=true（主密钥来自 SystemConfig）', !err && cred.ready() === true);

    console.log('=== 1. 凭证核心 ===');
    var appId = cred.genAppId();
    var secret = cred.genSecret();
    check('appId 格式 app_ + 16hex', /^app_[a-f0-9]{16}$/.test(appId));
    check('secret 格式 sk_ + 48hex', /^sk_[a-f0-9]{48}$/.test(secret));
    var enc = cred.encryptSecret(secret);
    check('密文不含明文 secret', enc.indexOf('sk_') === -1);
    check('解密还原明文', cred.decryptSecret(enc) === secret);
    check('脱敏只露尾4位', /^sk_\*{4}[a-f0-9]{4}$/.test(cred.maskSecret(enc)));
    var ts = Date.now();
    var sig = cred.sign(secret, appId, ts, 'nonce-abc');
    check('HMAC 签名 hex', /^[a-f0-9]{64}$/.test(sig));
    check('safeEqual 同值 true', cred.safeEqual(sig, sig) === true);
    check('safeEqual 异值 false', cred.safeEqual(sig, '0'.repeat(64)) === false);
    check('timestampOk 当前 true', cred.timestampOk(ts) === true);
    check('timestampOk 过期 false', cred.timestampOk(ts - 6 * 60 * 1000) === false);

    console.log('=== 2. JWT 用应用密钥派生（应用间隔离）===');
    var secretA = cred.genSecret(), secretB = cred.genSecret();
    var appA = {_id: 'a1b2c3d4e5f60718293a4b5c', appId: cred.genAppId()};
    var appB = {_id: 'b1b2c3d4e5f60718293a4b5c', appId: cred.genAppId()};
    var user = {_id: 'u1b2c3d4e5f60718293a4b5c'};
    var tA = cred.issueToken(appA, user, secretA, 3600).token;
    check('token 三段式', /^[\w-]+\.[\w-]+\.[\w-]+$/.test(tA));
    check('peekAppId 正确', cred.peekAppId(tA) === appA.appId);
    check('A 密钥验 A token 通过', !!cred.verifyTokenWithSecret(tA, secretA));
    check('B 密钥验 A token 失败（应用隔离）', cred.verifyTokenWithSecret(tA, secretB) === null);
    check('篡改 token 被拒', cred.verifyTokenWithSecret(tA.slice(0, -2) + 'xx', secretA) === null);

    console.log('=== 3. /api/auth/token 换 token ===');
    var apiAuthApi = require('../controllers/apiAuthApi');
    function mkRes() { return {code: 0, body: null, status: function (c) { this.code = c; return this; }, json: function (b) { this.body = b; }}; }
    FAKE_APP = {_id: appA._id, appId: appA.appId, secretHash: cred.encryptSecret(secretA), userId: user._id, status: 0};
    FAKE_USER = {_id: user._id, userName: 'admin', status: 0, role: 0};
    var fixedTs = Date.now();
    var r2 = mkRes();
    apiAuthApi.token({body: {appId: appA.appId, timestamp: fixedTs, nonce: 'n2', signature: cred.sign(secretA, appA.appId, fixedTs, 'n2')}}, r2);
    check('正确签名换 token 成功', r2.code === 0 && r2.body.success && !!r2.body.access_token);
    check('响应不含 secret', r2.body.secret === undefined && r2.body.access_token.indexOf(secretA) === -1);
    var r3 = mkRes();
    apiAuthApi.token({body: {appId: appA.appId, timestamp: fixedTs, nonce: 'n3', signature: 'bad'}}, r3);
    check('错误签名 401', r3.code === 401);
    var r4 = mkRes();
    apiAuthApi.token({body: {appId: 'app_unknown', timestamp: fixedTs, nonce: 'n4', signature: sig}}, r4);
    check('未知 appId 401', r4.code === 401);

    console.log('=== 4. 统一鉴权 authenticate（含 adminOnly）===');
    var articleApi = require('../controllers/articleApi');
    function authRun(mw, token, cb) {
        var res = {code: 0, body: null, status: function (c) { this.code = c; return this; }, json: function (b) { this.body = b; }};
        mw({headers: {authorization: 'Bearer ' + token}, body: {}}, res, function () { cb(res, true); });
        if (res.code) cb(res, false);
    }
    var goodToken = r2.body.access_token;
    authRun(articleApi.authenticate({adminOnly: false}), goodToken, function (res, passedMw) {
        check('普通接口：管理员应用 token 通过', passedMw === true);
    });
    authRun(articleApi.authenticate({adminOnly: true}), goodToken, function (res, passedMw) {
        check('adminOnly：管理员应用 token 通过', passedMw === true);
    });
    // 切到普通用户
    FAKE_USER = {_id: user._id, userName: 'guest', status: 0, role: 1};
    authRun(articleApi.authenticate({adminOnly: true}), goodToken, function (res, passedMw) {
        check('adminOnly：普通用户应用被拒 403', res.code === 403 && !passedMw);
    });
    authRun(articleApi.authenticate({adminOnly: false}), goodToken, function (res, passedMw) {
        check('普通接口：普通用户应用可通过', passedMw === true);
    });
    authRun(articleApi.authenticate({adminOnly: false}), 'bad.token.here', function (res, passedMw) {
        check('无效 token 401', res.code === 401 && !passedMw);
    });

    console.log('=== 5. 来源不可篡改（静态契约核验）===');
    var fs = require('fs');
    var contentSrc = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'content.js'), 'utf8');
    var modelSrc = fs.readFileSync(path.join(__dirname, '..', 'models', 'Content.js'), 'utf8');
    var apiSrc = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'articleApi.js'), 'utf8');
    var updateBlock = modelSrc.slice(modelSrc.indexOf('ContentDAO.prototype.update'), modelSrc.indexOf('ContentDAO.prototype.update') + 900);
    check('编辑入口不读 source', contentSrc.indexOf('req.body.source') === -1);
    check('DAO update 白名单不含 source', updateBlock.indexOf('source') === -1);
    check('schema source immutable', /source:\s*\{[^}]*immutable:\s*true/.test(modelSrc));
    check('schema sourceAppId immutable', /sourceAppId:\s*\{[^}]*immutable:\s*true/.test(modelSrc));
    check('API 发布写 source=api', apiSrc.indexOf("source: 'api'") !== -1);
    check('作者强制 apiAuthor', apiSrc.indexOf('f.author = req.apiAuthor._id') !== -1);

    console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
    process.exit(failed ? 1 : 0);
});
