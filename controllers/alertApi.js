/**
 * 邮件告警自检 API（Token 鉴权，与开放文章发布 API 同源）。
 *
 *   GET  /api/alert/status   查看脱敏配置 + 已探测到的可用 SMTP 参数组合
 *   POST /api/alert/probe    自动探测可用传输参数，并【真实发送一封】测试邮件
 *
 * 设计约束：
 *   - 密码只由服务端从 settings.js / ALERT_SMTP_* 读取，接口永远不接收、不回显密码；
 *   - 所有响应先过 sanitize()：删掉敏感键 + 把可能出现在 SMTP 报错里的明文密码打码；
 *   - 收件人只允许多配的 settings.alert.recipients；未配收件人时发给发件账号自己，
 *     因此接口不会被当成任意地址的中继，也不要求为了自检去改配置；
 *   - 鉴权与 articleApi 同源同口径（settings.articleApi.tokens / ARTICLE_API_TOKENS +
 *     timingSafeEqual 常量时间比较），但【故意不 require articleApi】：那条依赖链会连带
 *     models/mongodb.js 连接数据库，而邮件自检必须能在 DB 不可用时独立工作。
 *     无 session / cookie，故 csrfGuard 对带 token 的 /api/alert 放行；
 *   - probe 会真发邮件，路由层单独限流（5 次/分钟）。
 *
 * 背景：企业邮的 "526 Authentication failure" 常常不是账号密码填错，而是 AUTH 机制、
 * TLS、密码串不可见字符等【传输参数】不匹配。services/alert.js 会自动枚举候选并把
 * 成功组合持久化，本接口负责把这条链路显式跑到 sent:true。
 *
 * 保持项目风格：CommonJS + var + 回调，不引入任何新依赖。
 */
'use strict';

var crypto = require('crypto');
var settings = require('../settings');
var alert = require('../services/alert');

var SECRET_KEY = /^(pass|password|secret|token|authorization|auth|cookie|appSecret|privateKey)$/i;

// 与 articleApi.loadApiConfig / resolveToken 完全同源，但不触碰模型层（零 DB 依赖）。
function loadTokens() {
    var cfg = (settings && settings.articleApi) || {};
    var entries = [];
    if (Array.isArray(cfg.tokens)) {
        cfg.tokens.forEach(function (t) {
            if (t && typeof t.token === 'string' && t.token) entries.push(t.token);
        });
    }
    (process.env.ARTICLE_API_TOKENS || '').split(',').forEach(function (s) {
        s = s.trim();
        if (s) entries.push(s);
    });
    return entries;
}

function resolveToken(req) {
    var header = req.headers['authorization'] || req.headers['x-api-token'] || '';
    var provided = (typeof header === 'string' && header.indexOf('Bearer ') === 0)
        ? header.slice('Bearer '.length).trim() : String(header).trim();
    if (!provided) return false;
    var tokens = loadTokens();
    for (var i = 0; i < tokens.length; i++) {
        var cand = String(tokens[i]);
        if (cand.length !== provided.length) continue;
        if (crypto.timingSafeEqual(Buffer.from(cand, 'utf8'), Buffer.from(provided, 'utf8'))) return true;
    }
    return false;
}

// 兜底打码：某些 SMTP 会在错误文本里回显认证串，绝不让它出现在响应里。
function redact(s) {
    var out = String(s == null ? '' : s);
    try {
        var smtp = alert._resolveSmtp();
        var candidates = [smtp.pass, process.env.ALERT_SMTP_PASS];
        // AUTH PLAIN 会把 \0user\0pass 编码进同一行，精确打码该串（不误伤其它 base64）
        if (smtp.user && smtp.pass) {
            candidates.push(Buffer.from('\0' + smtp.user + '\0' + smtp.pass).toString('base64'));
        }
        candidates.forEach(function (p) {
            if (p && String(p).length > 2) out = out.split(String(p)).join('[REDACTED]');
        });
    } catch (e) { /* 配置读取异常时不做替换，键过滤仍然生效 */ }
    // 通用形态：Authorization: Basic xxxx / AUTH PLAIN <base64(\0user\0pass)> 认证串
    return out
        .replace(/(Basic\s+)[A-Za-z0-9+/=]{8,}/gi, '$1[REDACTED]')
        .replace(/(AUTH\s+PLAIN\s+)[A-Za-z0-9+/=]{8,}/gi, '$1[REDACTED]');
}

function sanitize(value) {
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === 'object') {
        var out = {};
        Object.keys(value).forEach(function (k) {
            if (SECRET_KEY.test(k)) return;
            out[k] = sanitize(value[k]);
        });
        return out;
    }
    if (typeof value === 'string') return redact(value);
    return value;
}

// ---------------------------------------------------------------------------
// 鉴权：无状态 API Token（Authorization: Bearer <token> / X-API-Token）
// ---------------------------------------------------------------------------
exports.auth = function (req, res, next) {
    if (!loadTokens().length) {
        return res.status(503).json({
            success: false,
            msg: '告警自检接口未启用：请配置 ARTICLE_API_TOKENS 或 settings.articleApi.tokens'
        });
    }
    if (!resolveToken(req)) {
        return res.status(401).json({success: false, msg: 'API Token 无效或缺失'});
    }
    next();
};

// ---------------------------------------------------------------------------
// GET /api/alert/status：脱敏配置 + 当前生效的传输参数组合
// ---------------------------------------------------------------------------
exports.status = function (req, res) {
    var last = alert.lastError();
    res.json(sanitize({
        success: true,
        config: alert.describe(),
        profile: alert.getProfile(),
        lastError: last ? String(last.message || last) : null,
        hint: 'POST /api/alert/probe 可自动探测可用 SMTP 参数并真实发送一封测试邮件'
    }));
};

// ---------------------------------------------------------------------------
// POST /api/alert/probe：真实发一封测试邮件，直到 sent:true 才返回 200。
// 可选 body: { to: "someone@example.com" }（必须在已配置收件人白名单内）
// ---------------------------------------------------------------------------
exports.probe = function (req, res) {
    var started = Date.now();
    var to = req.body && req.body.to;
    var view = alert.describe();
    alert.sendTest({to: to}, function (err, r) {
        if (err) {
            return res.status(502).json(sanitize({
                success: false, sent: false, reason: 'transport-error',
                error: String(err.message || err), elapsedMs: Date.now() - started
            }));
        }
        var body = {
            success: !!r.sent,
            sent: !!r.sent,
            reason: r.reason,
            to: to || (r.allowed ? '' : (view.recipients[0] || view.smtp.user)),
            messageId: r.messageId || null,
            accepted: r.accepted || null,
            profile: r.profile || null,
            tried: r.tried || [],
            advice: r.advice || null,
            smtp: view.smtp,
            recipients: view.recipients,
            elapsedMs: Date.now() - started
        };
        if (r.allowed) body.allowed = r.allowed;
        body.credentials = view.credentialShape;
        function respond() {
            res.status(body.sent ? 200 : 502).json(sanitize(body));
        }
        // 认证类全失败时补一次「错误密码」对照，让结论有可验证依据而不是猜测。
        if (!body.sent && r && (r.reason === 'auth-failed' || r.reason === 'no-working-profile')) {
            try {
                return alert.authControl(function (ctl) {
                    body.control = ctl || null;
                    respond();
                });
            } catch (e) {
                body.control = {error: String(e.message || e).slice(0, 120)};
            }
        }
        body.control = null;
        respond();
    });
};

exports._sanitize = sanitize;
