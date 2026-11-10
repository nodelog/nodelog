/**
 * 开放平台扫码登录 + 微信 JS-SDK 签名：路由处理器与登录态恢复中间件。
 *
 * 保持项目既有风格：CommonJS + var + 回调式 DAO，不引入任何新依赖。
 * 契约要点：
 *   - 只把脱敏后的用户信息回传前端，绝不回传 JWT 原文 / 手机号 / AppSecret / 堆栈。
 *   - JWT 写进 httpOnly cookie（30 天），session.user 与原有本地账号登录完全同构。
 *   - restoreUser 是「尽力而为」的中间件：任何异常都静默放行，绝不阻塞页面渲染。
 */
'use strict';

var crypto = require('crypto');
var bcrypt = require('bcryptjs');
var settings = require('../settings');
var openPlatform = require('../services/openPlatform');
var openJwt = require('../services/openJwt');
var User = require('../models/User.js');

var DEFAULT_API_BASE = 'https://ai.jiangzi.xin';
var TOKEN_RE = /^[a-f0-9]{32}$/;
// qrcodeUrl 会直接进入前端 <img src>：与前端 isSafeSrc 白名单保持一致，
// 只允许 data:image/ 与 https://，拒绝 http:// / javascript: / data:text/html 等。
var SAFE_QR_SRC = /^(?:data:image\/|https:\/\/)/i;
var BAD_QR_CHARS = /[\s"'<>]/;
var JWT_COOKIE = 'nl_open_jwt';
var JWT_COOKIE_MAX_AGE = 30 * 24 * 3600 * 1000; // 30 天，与上游 JWT exp 一致
var RESTORE_GUARD_MS = 3000; // DB 无响应时的兜底放行，避免拖住整站请求

// ---------------------------------------------------------------------------
// 配置：与 services/openPlatform.getConfig() 完全相同的优先级规则
//       （环境变量 > settings.openPlatform > 内置默认）。
// 这里同步读取，便于在 handler 里对「未配置」做短路，不必把整条链路改成 Promise 链。
// ---------------------------------------------------------------------------
function normalizePhones(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (s) { return String(s).trim(); }).filter(Boolean);
}

function readConfig() {
    var base = (settings && settings.openPlatform) || {};
    var adminPhones = process.env.OPEN_ADMIN_PHONES !== undefined
        ? normalizePhones(String(process.env.OPEN_ADMIN_PHONES).split(','))
        : normalizePhones(base.adminPhones);

    return {
        apiBase: process.env.OPEN_API_BASE || base.apiBase || DEFAULT_API_BASE,
        appId: process.env.OPEN_APP_ID || base.appId || '',
        appSecret: process.env.OPEN_APP_SECRET || base.appSecret || '',
        adminPhones: adminPhones,
        shareCover: process.env.OPEN_SHARE_COVER || base.shareCover || ''
    };
}

function notConfigured(res) {
    return res.json({success: false, msg: '未配置开放平台 AppID/AppSecret'});
}

// 上游错误信息归一化：去掉 AppSecret、截断超长内容；绝不拼接完整上游响应或堆栈。
function safeMsg(err, cfg) {
    var msg = (err && err.message) ? String(err.message) : '';
    if (cfg && cfg.appSecret) msg = msg.split(cfg.appSecret).join('[REDACTED]');
    if (!msg) msg = '开放平台服务暂不可用';
    if (msg.length > 200) msg = msg.slice(0, 200);
    return msg;
}

function maskPhone(phone) {
    if (!phone) return '微信用户';
    if (phone.length <= 4) return phone.slice(0, 1) + '****';
    return phone.slice(0, 3) + '****' + phone.slice(-4);
}

// ---------------------------------------------------------------------------
// 1. 二维码
// ---------------------------------------------------------------------------
exports.qrcode = function (req, res) {
    var cfg = readConfig();
    if (!cfg.appId || !cfg.appSecret) return notConfigured(res);

    openPlatform.createToken().then(function (data) {
        var d = data || {};
        // 上游 PHP 用 chunk_split() 生成 base64 data URI，默认每 76 字符插入 \r\n 换行符。
        // 浏览器可容忍，但我们的 BAD_QR_CHARS(\s) 会误判为非法 src → 报「二维码数据无效」。
        // 先做归一化：去掉所有空白（不影响 base64 / URL 语义），再校验。
        var rawUrl = d.qrcodeUrl;
        var qrcodeUrl = (typeof rawUrl === 'string') ? rawUrl.replace(/\s+/g, '') : '';
        // 纵深防御：上游异常/被劫持时不能把非法 src 或不合规 token 交给前端，
        // 否则前端白名单会拒绝渲染、或轮询一直吃 400。文案与 qr-login.js 保持一致。
        if (!TOKEN_RE.test(String(d.token == null ? '' : d.token)) ||
            !qrcodeUrl ||
            !SAFE_QR_SRC.test(qrcodeUrl) || BAD_QR_CHARS.test(qrcodeUrl)) {
            return res.json({success: false, msg: '二维码数据无效，请刷新重试'});
        }
        res.json({
            success: true,
            token: d.token,
            qrcodeUrl: qrcodeUrl,
            expiresIn: 300 // 上游扫码 token 有效期 300 秒，数字秒
        });
    }).catch(function (err) {
        res.json({success: false, msg: safeMsg(err, cfg)});
    });
};

// ---------------------------------------------------------------------------
// 2. 轮询扫码状态 + 落本地用户 + 写登录态
// ---------------------------------------------------------------------------
exports.status = function (req, res) {
    var cfg = readConfig();
    var token = req.query && req.query.token;
    // 输入校验前置：非法 token 不触发任何配置/网络/DB 操作，直接 400
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
        return res.status(400).json({success: false, msg: '参数错误'});
    }
    if (!cfg.appId || !cfg.appSecret) return notConfigured(res);

    openPlatform.getStatus(token).then(function (data) {
        var d = data || {};
        var state = d.status;
        if (state === 'pending' || state === 'expired') {
            return res.json({success: true, status: state});
        }
        if (state !== 'confirmed') {
            return res.json({success: false, msg: '登录状态异常'});
        }

        var payload = openJwt.verify(d.token, cfg.appSecret);
        if (!payload || payload.userId === undefined || payload.userId === null) {
            return res.json({success: false, msg: '登录凭证校验失败'});
        }
        finishLogin(req, res, cfg, payload, d.token);
    }).catch(function (err) {
        res.json({success: false, msg: safeMsg(err, cfg)});
    });
};

function finishLogin(req, res, cfg, payload, jwt) {
    var openUserId = String(payload.userId);
    var phone = payload.phone ? String(payload.phone) : '';

    // 统一的落库后处理：写 session / cookie / 精简响应，任何异常都不外泄
    function onUser(err, doc) {
        try {
            if (err || !doc) {
                return res.json({success: false, msg: '登录失败，请重试'});
            }
            // 与 controllers/user.js 的本地登录一致：直接放完整的 mongoose 文档，
            // 保证 _id / userName / realName / role / status / email / createTime 等字段全部可用。
            req.session.user = doc;
            res.cookie(JWT_COOKIE, jwt, {
                httpOnly: true,
                maxAge: JWT_COOKIE_MAX_AGE,
                sameSite: 'lax',
                secure: process.env.NODE_ENV === 'production',
                path: '/'
            });
            // 不回传 JWT 原文、手机号、password 或任何堆栈
            return res.json({
                success: true,
                status: 'confirmed',
                user: {
                    _id: doc._id,
                    userName: doc.userName,
                    realName: doc.realName,
                    role: doc.role
                }
            });
        } catch (e) {
            return res.json({success: false, msg: '登录失败，请重试'});
        }
    }

    try {
        User.findByOpenUserId(openUserId, function (err, existing) {
            if (err) return onUser(err, null);
            // 已存在：不覆盖 role（管理员任命只能由后台显式修改），也不强制改手机号
            if (existing) return onUser(null, existing);

            var isAdmin = cfg.adminPhones.indexOf(phone) !== -1;
            var obj = {
                userName: 'wx_' + openUserId,
                realName: maskPhone(phone),
                // Schema 的 password 是 required；开放平台用户没有本地密码，写一次性随机 bcrypt 哈希
                password: bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10),
                role: isAdmin ? 0 : 1,
                status: 0,
                phone: phone,
                loginType: 'wechat',
                openUserId: openUserId
            };
            try {
                User.createOpenUser(obj, onUser);
            } catch (e) {
                onUser(e, null);
            }
        });
    } catch (e) {
        onUser(e, null);
    }
}

// ---------------------------------------------------------------------------
// 3. 微信 JS-SDK 签名（前端 wechat-share.js 读 resp.data.config）
// ---------------------------------------------------------------------------
exports.jsConfig = function (req, res) {
    var pageUrl = req.query && req.query.url;
    if (typeof pageUrl !== 'string' || !/^https?:\/\//i.test(pageUrl)) {
        return res.status(400).json({code: 0, msg: '参数错误'});
    }

    openPlatform.getJsConfig(pageUrl).then(function (upstreamData) {
        // 上游 data 原样透传（形如 {config:{...}}），仅补一层统一外层
        res.json({code: 1, data: upstreamData});
    }).catch(function () {
        // 上游故障细节不外泄，统一 502
        res.status(502).json({code: 0, msg: '签名服务不可用'});
    });
};

// ---------------------------------------------------------------------------
// 4. 登出
// ---------------------------------------------------------------------------
exports.logout = function (req, res) {
    req.session.user = null;
    res.clearCookie(JWT_COOKIE, {path: '/'});
    res.json({success: true});
};

// ---------------------------------------------------------------------------
// 5. 登录态恢复中间件（挂在 session 之后、业务路由之前）
//    session 过期但 30 天 JWT cookie 仍在时，静默把用户放回 session。
// ---------------------------------------------------------------------------
exports.restoreUser = function (req, res, next) {
    var done = false;
    var guard = null;

    function pass() {
        if (done) return;
        done = true;
        if (guard) { clearTimeout(guard); guard = null; }
        next();
    }

    try {
        if (req.session && req.session.user) return pass();

        var cfg = readConfig();
        if (!cfg.appSecret) return pass();
        var jwt = req.cookies && req.cookies[JWT_COOKIE];
        if (!jwt) return pass();

        var payload = openJwt.verify(jwt, cfg.appSecret);
        if (!payload || payload.userId === undefined || payload.userId === null) return pass();

        // DB 无响应时兜底放行：宁可本次按未登录渲染，也不拖住整站请求
        guard = setTimeout(pass, RESTORE_GUARD_MS);
        if (guard.unref) guard.unref();

        User.findByOpenUserId(String(payload.userId), function (err, doc) {
            if (done) return; // 兜底定时器已放行，响应可能已发出，不再回写 session
            try {
                // DAO 查询已带 status < 2，这里再判一次，防止后续改动放宽条件
                if (!err && doc && doc.status < 2 && req.session) {
                    req.session.user = doc;
                }
            } catch (e) { /* 静默：恢复失败不影响请求 */ }
            pass();
        });
    } catch (e) {
        // 配置 / 验签 / DAO 同步抛错一律静默放行，绝不抛给 Express
        pass();
    }
};
