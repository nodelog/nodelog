/**
 * 开放接口应用凭证服务（v3 零配置）：
 *   - 主密钥：首次启动随机生成、存 MongoDB system_config，进程内缓存；settings.js 零密钥。
 *   - Secret：AES-256-GCM 加密入库，明文仅创建/重置时返回一次。
 *   - 换 token：HMAC-SHA256 验签证明持有 Secret，Secret 不上网。
 *   - JWT：HS256，签名密钥 = 从该应用 Secret 派生（应用间隔离，吸收 LINKONE 思路）。
 *
 * 零新依赖：仅 Node 内置 crypto。CommonJS + var 风格。
 * 主密钥加载是异步的（查库），故 init() 需在路由挂载前调用一次；之后同步加解密走缓存。
 */
'use strict';
var crypto = require('crypto');
var SystemConfig = require('../models/SystemConfig.js');

var MASTER_KEY_BUFFER = null;    // 进程内缓存的 32 字节主密钥
var INIT_CALLBACKS = [];         // init 并发调用时的等待队列
var INIT_STATE = 0;              // 0 未初始化 / 1 初始化中 / 2 完成

function key32(s) { return crypto.createHash('sha256').update(String(s)).digest(); }

// ---- 初始化：加载（或零配置生成）主密钥 ----
function init(done) {
    done = done || function () {};
    if (INIT_STATE === 2) return done(null);
    INIT_CALLBACKS.push(done);
    if (INIT_STATE === 1) return;
    INIT_STATE = 1;
    // env 可选覆盖（多实例共享），缺省走 SystemConfig 零配置生成
    var envKey = process.env.API_APP_ENCRYPTION_KEY;
    function finish(err, raw) {
        if (err) {
            INIT_STATE = 0;
            var cbs = INIT_CALLBACKS.splice(0);
            cbs.forEach(function (cb) { cb(err); });
            return;
        }
        MASTER_KEY_BUFFER = envKey ? key32(envKey) : key32(raw);
        INIT_STATE = 2;
        var cbs2 = INIT_CALLBACKS.splice(0);
        cbs2.forEach(function (cb) { cb(null); });
    }
    if (envKey) return finish(null, envKey);
    SystemConfig.getOrCreateMasterKey(function (err, raw) {
        if (err) return finish(err);
        if (!raw) return finish(new Error('主密钥生成失败'));
        finish(null, raw);
    });
}
function ready() { return INIT_STATE === 2 && !!MASTER_KEY_BUFFER; }
function requireReady() {
    if (!ready()) throw new Error('凭证服务未初始化：请先调用 apiCredential.init()');
    return MASTER_KEY_BUFFER;
}

// ---- 生成 ----
function genAppId() { return 'app_' + crypto.randomBytes(8).toString('hex'); }
function genSecret() { return 'sk_' + crypto.randomBytes(24).toString('hex'); }

// ---- Secret 加解密（AES-256-GCM，密文 base64: iv|tag|ciphertext）----
function encryptSecret(plain) {
    var key = requireReady();
    var iv = crypto.randomBytes(12);
    var cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    var enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    var tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
}
function decryptSecret(b64) {
    var key = requireReady();
    var buf = Buffer.from(b64, 'base64');
    var iv = buf.slice(0, 12), tag = buf.slice(12, 28), enc = buf.slice(28);
    var decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
function maskSecret(b64) {
    try {
        var plain = decryptSecret(b64);
        return 'sk_****' + plain.slice(-4);
    } catch (e) { return 'sk_****(不可读)'; }
}

// ---- HMAC 签名（换 token）----
function sign(secretPlain, appId, timestamp, nonce) {
    return crypto.createHmac('sha256', String(secretPlain))
        .update(String(appId) + '\n' + String(timestamp) + '\n' + String(nonce))
        .digest('hex');
}
function safeEqual(a, b) {
    a = String(a == null ? '' : a); b = String(b == null ? '' : b);
    if (a.length !== b.length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')); }
    catch (e) { return false; }
}
function timestampOk(ts) {
    var n = Number(ts);
    if (!isFinite(n)) return false;
    return Math.abs(Date.now() - n) <= 5 * 60 * 1000;
}

// ---- JWT（HS256，密钥=应用 Secret 派生，应用间隔离）----
function jwtKeyFor(secretPlain) {
    // 用 Secret 派生签名密钥，A 应用 token 用 B Secret 验不过
    return crypto.createHmac('sha256', String(secretPlain)).update('nodelog-api-jwt-v3').digest();
}
function b64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return Buffer.from(s, 'base64');
}
function issueToken(app, user, secretPlain, ttl) {
    ttl = parseInt(ttl, 10) || 3600;
    if (ttl < 60) ttl = 60;
    if (ttl > 86400) ttl = 86400;
    var now = Math.floor(Date.now() / 1000);
    var header = b64url(JSON.stringify({alg: 'HS256', typ: 'JWT'}));
    var payload = b64url(JSON.stringify({
        appId: app.appId,
        aid: String(app._id),
        uid: String(user && user._id ? user._id : app.userId),
        iat: now,
        exp: now + ttl
    }));
    var signingInput = header + '.' + payload;
    var sig = b64url(crypto.createHmac('sha256', jwtKeyFor(secretPlain)).update(signingInput).digest());
    return {token: signingInput + '.' + sig, expiresIn: ttl};
}
// 从 token 里读出 appId（不验签，仅用于查应用取 Secret）；验签在 verifyTokenWithSecret 完成。
function peekAppId(token) {
    try {
        var parts = String(token || '').split('.');
        if (parts.length !== 3) return null;
        var payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
        return payload && payload.appId ? String(payload.appId) : null;
    } catch (e) { return null; }
}
// 用指定 Secret 验签（验签方需先按 payload.appId 查到应用并解密其 Secret）
function verifyTokenWithSecret(token, secretPlain) {
    try {
        var parts = String(token || '').split('.');
        if (parts.length !== 3) return null;
        var expected = b64url(crypto.createHmac('sha256', jwtKeyFor(secretPlain)).update(parts[0] + '.' + parts[1]).digest());
        if (!safeEqual(expected, parts[2])) return null;
        var payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
        var now = Math.floor(Date.now() / 1000);
        if (!payload.exp || payload.exp <= now) return null;
        if (!payload.appId || !payload.uid) return null;
        return payload;
    } catch (e) { return null; }
}

module.exports = {
    init: init,
    ready: ready,
    genAppId: genAppId,
    genSecret: genSecret,
    encryptSecret: encryptSecret,
    decryptSecret: decryptSecret,
    maskSecret: maskSecret,
    sign: sign,
    safeEqual: safeEqual,
    timestampOk: timestampOk,
    jwtKeyFor: jwtKeyFor,
    issueToken: issueToken,
    peekAppId: peekAppId,
    verifyTokenWithSecret: verifyTokenWithSecret
};
