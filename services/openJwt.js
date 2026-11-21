/**
 * 开放平台 JWT 本地验签（HS256），不依赖 jsonwebtoken 等任何第三方包。
 *
 * 上游签发规则（实读 LINK ONE server）：
 *   header  = {"alg":"HS256","typ":"JWT"}
 *   payload = {userId, phone, isWhitelist, iat, exp}，exp = iat + 2592000（30 天）
 *   signature = base64url(HMAC-SHA256(base64url(header) + "." + base64url(payload), AppSecret))
 *   base64url 去掉 '=' 填充，+ -> -，/ -> _
 *
 * 只做本地验签，不发起任何网络请求。AppSecret 只在本模块内参与 HMAC，绝不外泄。
 */
'use strict';

var crypto = require('crypto');

var DEFAULT_TTL = 2592000; // 30 天，与上游一致

function b64urlEncode(input) {
    return Buffer.from(input).toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function b64urlDecode(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    var pad = s.length % 4;
    if (pad) s += new Array(5 - pad).join('=');
    return Buffer.from(s, 'base64').toString('utf8');
}

function encodePart(obj) {
    return b64urlEncode(Buffer.from(JSON.stringify(obj), 'utf8'));
}

/**
 * 签发一个 HS256 JWT（仅供自检 / 测试使用，线上验签走 verify）。
 * ttl 为秒；若 payload 自带 exp / iat 则以自带值为准，便于构造过期 token 做测试。
 */
function sign(payload, secret, ttl) {
    if (!payload || typeof payload !== 'object') throw new Error('payload 必须是对象');
    if (typeof secret !== 'string' || !secret) throw new Error('secret 不能为空');

    var body = {};
    Object.keys(payload).forEach(function (k) { body[k] = payload[k]; });

    var now = Math.floor(Date.now() / 1000);
    var iat = (typeof body.iat === 'number') ? body.iat : now;
    var exp = (typeof body.exp === 'number')
        ? body.exp
        : iat + (typeof ttl === 'number' ? ttl : DEFAULT_TTL);
    body.iat = iat;
    body.exp = exp;

    var signingInput = encodePart({alg: 'HS256', typ: 'JWT'}) + '.' + encodePart(body);
    var signature = b64urlEncode(
        crypto.createHmac('sha256', secret).update(signingInput, 'utf8').digest()
    );
    return signingInput + '.' + signature;
}

/**
 * 校验并返回 payload；任何异常（格式 / alg / 签名 / 过期）一律返回 null，绝不抛错。
 */
function verify(token, secret) {
    try {
        if (typeof token !== 'string' || typeof secret !== 'string' || !secret) return null;

        var parts = token.split('.');
        if (parts.length !== 3) return null;

        var header = JSON.parse(b64urlDecode(parts[0]));
        var payload = JSON.parse(b64urlDecode(parts[1]));
        if (!header || typeof header !== 'object') return null;
        // 明确拒绝 alg=none / RS256 等混淆算法，只用 HS256
        if (header.alg !== 'HS256') return null;
        if (header.typ && header.typ !== 'JWT') return null;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

        var expected = b64urlEncode(
            crypto.createHmac('sha256', secret).update(parts[0] + '.' + parts[1], 'utf8').digest()
        );
        var actualBuf = Buffer.from(parts[2], 'utf8');
        var expectedBuf = Buffer.from(expected, 'utf8');
        // timingSafeEqual 要求等长；长度不是秘密，可提前短路，避免它抛 RangeError
        if (actualBuf.length !== expectedBuf.length) return null;
        if (!crypto.timingSafeEqual(actualBuf, expectedBuf)) return null;

        var now = Math.floor(Date.now() / 1000);
        // exp 单位是秒，必须存在且为有限数值
        if (typeof payload.exp !== 'number' || !isFinite(payload.exp)) return null;
        if (now >= payload.exp) return null;
        // 允许 60s 时钟偏移，拒绝明显来自未来的 iat
        if (typeof payload.iat === 'number' && payload.iat > now + 60) return null;

        return payload;
    } catch (e) {
        return null;
    }
}

module.exports = {
    verify: verify,
    sign: sign
};
