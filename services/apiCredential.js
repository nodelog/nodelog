/**
 * 开放接口应用凭证服务：密钥生成 / AES 加密存储 / HMAC 验签 / HS256 token 签发校验。
 *
 * 安全铁律：
 *   - AppSecret 明文只存在于「后台创建/重置时的一次性响应」与调用方手里；
 *     服务端入库前即 AES-256-GCM 加密，库里只有密文，日志/响应绝不出现明文。
 *   - 换 token 用 HMAC-SHA256 签名证明持有 secret，secret 本身不上网。
 *   - 业务 token 是 HS256 JWT，含 appId/uid/exp，短时效，验签后仍需查库确认应用与用户仍启用。
 *
 * 零新依赖：仅用 Node 内置 crypto。CommonJS + var 风格。
 */
'use strict';
var crypto = require('crypto');
var settings = require('../settings');

function hex(bytes) { return Buffer.from(bytes).toString('hex'); }

// ---- 配置读取（env 优先）----
function loadConf() {
    var cfg = (settings && settings.apiAuth) || {};
    var encKey = process.env.API_APP_ENCRYPTION_KEY || cfg.encryptionKey || '';
    var tokenSecret = process.env.API_APP_TOKEN_SECRET || cfg.tokenSecret || '';
    var ttl = parseInt(process.env.API_APP_TOKEN_TTL || cfg.tokenTtl, 10) || 3600;
    if (ttl < 60) ttl = 60;
    if (ttl > 86400) ttl = 86400;
    return {encKey: encKey, tokenSecret: tokenSecret, ttl: ttl};
}

// 把任意字符串密钥归一到 32 字节（sha256），避免长度不合规导致 AES 抛错。
function key32(s) { return crypto.createHash('sha256').update(String(s)).digest(); }

// ---- 生成 ----
function genAppId() { return 'app_' + crypto.randomBytes(8).toString('hex'); }   // app_ + 16 hex
function genSecret() { return 'sk_' + crypto.randomBytes(24).toString('hex'); }   // sk_ + 48 hex

// ---- Secret 加密存储（AES-256-GCM）----
// 密文格式：base64(iv[12] | tag[16] | ciphertext)
function encryptSecret(plain, encKeyRaw) {
    var rawKey = encKeyRaw || loadConf().encKey;
    if (!rawKey) throw new Error('未配置 apiAuth.encryptionKey / API_APP_ENCRYPTION_KEY');
    var key = key32(rawKey);
    var iv = crypto.randomBytes(12);
    var cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    var enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    var tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
}
function decryptSecret(b64, encKeyRaw) {
    var rawKey = encKeyRaw || loadConf().encKey;
    if (!rawKey) throw new Error('未配置 apiAuth.encryptionKey / API_APP_ENCRYPTION_KEY');
    var buf = Buffer.from(b64, 'base64');
    var iv = buf.slice(0, 12), tag = buf.slice(12, 28), enc = buf.slice(28);
    var decipher = crypto.createDecipheriv('aes-256-gcm', key32(rawKey), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
function maskSecret(b64) {
    try {
        var plain = decryptSecret(b64);
        var tail = plain.slice(-4);
        return 'sk_****' + tail;
    } catch (e) { return 'sk_****(无法解密)'; }
}

// ---- HMAC 签名（换 token）----
function sign(secretPlain, appId, timestamp, nonce) {
    return crypto.createHmac('sha256', String(secretPlain))
        .update(String(appId) + '\n' + String(timestamp) + '\n' + String(nonce))
        .digest('hex');
}
// 常量时间比较，长度不等先短路（避免 RangeError）
function safeEqual(a, b) {
    a = String(a == null ? '' : a); b = String(b == null ? '' : b);
    if (a.length !== b.length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')); }
    catch (e) { return false; }
}
// 校验时间戳漂移（毫秒，±5 分钟）
function timestampOk(ts) {
    var n = Number(ts);
    if (!isFinite(n)) return false;
    return Math.abs(Date.now() - n) <= 5 * 60 * 1000;
}

// ---- HS256 JWT（业务 token）----
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function b64urlDecode(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return Buffer.from(s, 'base64');
}
function secretForJwt() {
    var raw = process.env.API_APP_TOKEN_SECRET || (settings && settings.apiAuth && settings.apiAuth.tokenSecret) || '';
    if (!raw) throw new Error('未配置 apiAuth.tokenSecret / API_APP_TOKEN_SECRET');
    return key32(raw);
}
function issueToken(app, user) {
    var conf = loadConf();
    var now = Math.floor(Date.now() / 1000);
    var header = b64url(JSON.stringify({alg: 'HS256', typ: 'JWT'}));
    var payload = b64url(JSON.stringify({
        appId: app.appId,
        aid: String(app._id),
        uid: String(user && user._id ? user._id : app.userId),
        iat: now,
        exp: now + conf.ttl
    }));
    var signingInput = header + '.' + payload;
    var sig = b64url(crypto.createHmac('sha256', secretForJwt()).update(signingInput).digest());
    return {token: signingInput + '.' + sig, expiresIn: conf.ttl};
}
function verifyToken(token) {
    try {
        var parts = String(token || '').split('.');
        if (parts.length !== 3) return null;
        var expected = b64url(crypto.createHmac('sha256', secretForJwt()).update(parts[0] + '.' + parts[1]).digest());
        if (!safeEqual(expected, parts[2])) return null;                 // 签名不符
        var payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
        var now = Math.floor(Date.now() / 1000);
        if (!payload.exp || payload.exp <= now) return null;             // 过期
        if (!payload.appId || !payload.uid) return null;
        return payload;
    } catch (e) { return null; }
}

module.exports = {
    loadConf: loadConf,
    genAppId: genAppId,
    genSecret: genSecret,
    encryptSecret: encryptSecret,
    decryptSecret: decryptSecret,
    maskSecret: maskSecret,
    sign: sign,
    safeEqual: safeEqual,
    timestampOk: timestampOk,
    issueToken: issueToken,
    verifyToken: verifyToken
};
