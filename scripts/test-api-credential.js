// 离线测试：应用凭证核心 + 鉴权链路。stub mongoose/models，无需本地 mongod。
'use strict';
var Module = require('module');
var path = require('path');
var passed = 0, failed = 0;
function check(label, cond) {
    if (cond) { passed++; console.log('  ✓ ' + label); }
    else { failed++; console.log('  ✗ ' + label); }
}

// ---- stub 层（mongoose + models）----
var FAKE_APP = null, FAKE_USER = null, FAKE_SAVE = null;
var fakeMongoose = {
    connect: function () {},
    connection: {on: function () {}, once: function () {}},
    Types: {ObjectId: function () {}},
    Schema: function (d) { this.obj = d; },
    model: function () { return function () {}; }
};
fakeMongoose.Schema.ObjectId = function () {};

function fakeUserDAO() { return {findById: function (id, cb) { cb(null, FAKE_USER); }}; }
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
    if (request.indexOf('models/ApiApp') !== -1) return fakeApiAppDAO();
    if (request.indexOf('models/User') !== -1) return fakeUserDAO();
    if (request.indexOf('models/Content') !== -1) return fakeContentDAO();
    if (request.indexOf('models/Category') !== -1) return fakeCategoryDAO();
    if (request.indexOf('models/Tag') !== -1) return fakeTagDAO();
    if (base === 'constants') return {CONTENT_ENABLE_STATUS: 0, CONTENT_SELF_STATUS: 2, USER_ENABLE_STATUS: 0};
    if (request.indexOf('moderationGuard') !== -1) {
        return {enforce: function (req, fields, type, cb) { cb(null, {allowed: true}); }};
    }
    if (request.indexOf('mongodb') !== -1 && request.indexOf('models/') !== -1) return fakeMongoose;
    return origLoad.apply(this, arguments);
};

// 提供固定配置，避免依赖 settings.js 真实值
process.env.API_APP_ENCRYPTION_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
process.env.API_APP_TOKEN_SECRET = 'test-token-secret-for-offline-verification-only-2026';

var cred = require('../services/apiCredential');

console.log('=== 1. 凭证核心 ===');
var appId = cred.genAppId();
var secret = cred.genSecret();
check('appId 格式 app_ + 16hex', /^app_[a-f0-9]{16}$/.test(appId));
check('secret 格式 sk_ + 48hex', /^sk_[a-f0-9]{48}$/.test(secret));

var enc = cred.encryptSecret(secret);
check('密文不含明文 secret', enc.indexOf(secret.slice(4, 20)) === -1 && enc.indexOf('sk_') === -1);
var dec = cred.decryptSecret(enc);
check('解密还原明文 secret', dec === secret);
var masked = cred.maskSecret(enc);
check('脱敏只露尾 4 位', /^sk_\*{4}[a-f0-9]{4}$/.test(masked) && masked.indexOf(secret.slice(-4)) !== -1);

var ts = Date.now();
var sig = cred.sign(secret, appId, ts, 'nonce-abc');
check('HMAC 签名正确', /^[a-f0-9]{64}$/.test(sig));
check('safeEqual 同值 true', cred.safeEqual(sig, sig) === true);
check('safeEqual 异值 false', cred.safeEqual(sig, '0'.repeat(64)) === false);
check('safeEqual 长度不等 false', cred.safeEqual(sig, sig.slice(0, 10)) === false);
check('timestampOk 当前时间 true', cred.timestampOk(ts) === true);
check('timestampOk 过期时间 false', cred.timestampOk(ts - 10 * 60 * 1000) === false);

console.log('=== 2. token 签发/校验 ===');
FAKE_APP = {_id: 'a1b2c3d4e5f60718293a4b5c', appId: appId, secretHash: enc, userId: 'u1b2c3d4e5f60718293a4b5c', status: 0};
FAKE_USER = {_id: 'u1b2c3d4e5f60718293a4b5c', userName: 'admin', status: 0};
var issued = cred.issueToken(FAKE_APP, FAKE_USER);
check('签发的 token 三段式', /^[\w-]+\.[\w-]+\.[\w-]+$/.test(issued.token));
check('expiresIn 生效', issued.expiresIn >= 60);
var payload = cred.verifyToken(issued.token);
check('verifyToken 还原 payload', payload && payload.appId === appId && payload.uid === FAKE_USER._id);
check('篡改 token 被拒', cred.verifyToken(issued.token.slice(0, -2) + 'xx') === null);
check('空 token 被拒', cred.verifyToken('') === null);

console.log('=== 3. /api/auth/token 换 token ===');
var apiAuthApi = require('../controllers/apiAuthApi');
function mkRes() { return {code: 0, body: null, status: function (c) { this.code = c; return this; }, json: function (b) { this.body = b; }}; }
function tokenReq(body) { return {body: body, headers: {}}; }
var r1 = mkRes();
apiAuthApi.token(tokenReq({appId: appId, timestamp: Date.now(), nonce: 'n1', signature: cred.sign(dec, appId, Date.now(), 'n1')}), r1);
// 注：timestamp 用两次 Date.now() 可能相差 1ms 导致签名不匹配，下面用固定 ts 重测

var fixedTs = Date.now();
var r2 = mkRes();
apiAuthApi.token(tokenReq({appId: appId, timestamp: fixedTs, nonce: 'n2', signature: cred.sign(dec, appId, fixedTs, 'n2')}), r2);
check('正确签名换 token 成功', r2.code === 0 && r2.body && r2.body.success && !!r2.body.access_token);
check('换 token 响应不含 secret', r2.body && r2.body.secret === undefined && String(r2.body.access_token).indexOf(secret) === -1);
var r3 = mkRes();
apiAuthApi.token(tokenReq({appId: appId, timestamp: fixedTs, nonce: 'n3', signature: 'bad'}), r3);
check('错误签名 401', r3.code === 401);
var r4 = mkRes();
apiAuthApi.token(tokenReq({appId: 'app_unknown', timestamp: fixedTs, nonce: 'n4', signature: sig}), r4);
check('未知 appId 401', r4.code === 401);
var r5 = mkRes();
apiAuthApi.token(tokenReq({appId: appId}), r5);
check('缺参数 400', r5.code === 400);

console.log('=== 4. articleApi.auth 应用凭证鉴权 ===');
var articleApi = require('../controllers/articleApi');
function authReq(token) { return {headers: {authorization: 'Bearer ' + token}, body: {}}; }
function authRun(req, cb) {
    var res = {code: 0, body: null, status: function (c) { this.code = c; return this; }, json: function (b) { this.body = b; }};
    articleApi.auth(req, res, function () { cb(res, null); });
    if (res.code) cb(res, null);
}
authRun(authReq(issued.token), function (res) {
    check('有效 token 鉴权通过（无响应=next）', res.code === 0);
});
authRun(authReq('bad.token.here'), function (res) {
    check('无效 token 401', res.code === 401);
});
authRun(authReq(''), function (res) {
    check('缺 token 401', res.code === 401);
});

console.log('=== 5. 来源不可篡改（静态契约核验）===');
var fs = require('fs');
var contentSrc = fs.readFileSync(require('path').join(__dirname, '..', 'controllers', 'content.js'), 'utf8');
var contentModelSrc = fs.readFileSync(require('path').join(__dirname, '..', 'models', 'Content.js'), 'utf8');
var articleApiSrc = fs.readFileSync(require('path').join(__dirname, '..', 'controllers', 'articleApi.js'), 'utf8');
check('buildFields 所在 controller 不读 source 字段', contentSrc.indexOf('req.body.source') === -1);
var updateBlock = contentModelSrc.slice(contentModelSrc.indexOf('ContentDAO.prototype.update'), contentModelSrc.indexOf('ContentDAO.prototype.update') + 900);
check('Content.update set 白名单不含 source', updateBlock.indexOf('source') === -1);
check('schema source immutable', /source:\s*\{[^}]*immutable:\s*true/.test(contentModelSrc));
check('schema sourceAppId immutable', /sourceAppId:\s*\{[^}]*immutable:\s*true/.test(contentModelSrc));
check('API 发布强制写 source=api', articleApiSrc.indexOf("source: 'api'") !== -1);
check('API 发布写 sourceAppId', articleApiSrc.indexOf('sourceAppId: req.apiApp._id') !== -1);
check('作者强制取 apiAuthor（不信请求体 author）', articleApiSrc.indexOf('f.author = req.apiAuthor._id') !== -1);

console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
