/**
 * 告警通知（邮件）—— 风控命中与自动化运维结果的统一出口。
 *
 * 配置约定（与发件账号彻底解耦）：
 *   - 发信通道复用 settings.email 的 SMTP（host/port/secure/user/pass），不新增第二套邮箱配置；
 *   - 收件人【单独配置】：settings.alert.recipients（数组或逗号分隔字符串），
 *     环境变量 ALERT_RECIPIENTS 优先级更高，逗号分隔多个地址；
 *   - 未配置收件人 / alert.enabled === false / ALERT_ENABLED=0 时：只写服务端日志，绝不发信；
 *   - alert.realtime === false / ALERT_REALTIME=0：关闭实时命中告警，只保留运维脚本的汇总邮件。
 *
 * 行为约束：
 *   - 全异步 fire-and-forget，任何失败只 console.error，绝不抛回调用方、绝不阻断发布/处置主链路；
 *   - 相同 key 的事件在 throttleMinutes（默认 30 分钟）内只发一次，防敏感词被反复命中导致邮件轰炸；
 *   - 邮件正文只含字段名、命中词与计数，绝不含文章/评论正文、邮箱、手机号、IP（与 AuditLog 的 K02 同口径）；
 *   - 进程内节流表，重启即清空；多实例部署时各实例独立计数，如需全局去重请接 Redis。
 *
 * 测试：ALERT_TRANSPORT=stub 时把邮件写入 exports._stub 而不调用 SMTP，供离线单测使用。
 */
'use strict';
var settings = require('../settings');

var LEVEL_LABEL = {info: '提示', warn: '预警', critical: '告警'};
var LEVEL_COLOR = {info: '#1d4ed8', warn: '#8a5a0a', critical: '#c32d28'};
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

var throttle = {};   // key -> 上次发送时间戳
var stub = [];       // ALERT_TRANSPORT=stub 时收集邮件（仅测试）

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function parseRecipients(raw) {
    var list = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(',');
    var out = [], seen = {};
    list.forEach(function (v) {
        var addr = String(v == null ? '' : v).trim();
        if (!addr || !EMAIL_RE.test(addr) || seen[addr.toLowerCase()]) return;
        seen[addr.toLowerCase()] = 1;
        out.push(addr);
    });
    return out;
}

// 单一配置解析点：环境变量 > settings.alert > 内置默认。
function resolve() {
    var cfg = settings.alert || {};
    var envRaw = process.env.ALERT_RECIPIENTS;
    var recipients = parseRecipients(
        (envRaw && envRaw.trim()) ? envRaw : cfg.recipients);
    var email = settings.email || {};
    var smtpReady = !!(email.host && email.user && email.pass);
    var enabled = process.env.ALERT_ENABLED !== '0' &&
        cfg.enabled !== false && recipients.length > 0 && smtpReady;
    var realtime = process.env.ALERT_REALTIME !== '0' && cfg.realtime !== false;
    var minutes = parseInt(process.env.ALERT_THROTTLE_MINUTES, 10);
    if (!isFinite(minutes) || minutes < 0) {
        minutes = parseInt(cfg.throttleMinutes, 10);
    }
    if (!isFinite(minutes) || minutes < 0) minutes = 30;
    return {
        enabled: enabled,
        realtime: realtime,
        recipients: recipients,
        throttleMs: minutes * 60000,
        prefix: String(cfg.subjectPrefix || '[NODELOG 风控]'),
        fromName: String(cfg.fromName || 'NODELOG 风控'),
        email: email,
        siteHost: (settings.openPlatform && settings.openPlatform.siteHost) || 'blog.jiangzi.xin'
    };
}

// 事件体：{level,title,summary,rows:[{k,v}],key}；汇总体可含 sections:[{title,rows}]。
function render(event) {
    var c = resolve();
    var level = LEVEL_LABEL[event.level] ? event.level : 'warn';
    var color = LEVEL_COLOR[level];
    var rows = [];
    (event.rows || []).forEach(function (r) {
        rows.push('<tr><td style="padding:6px 12px;color:#606a76;">' + esc(r.k) +
            '</td><td style="padding:6px 12px;color:#171b21;">' + esc(r.v) + '</td></tr>');
    });
    (event.sections || []).forEach(function (s) {
        rows.push('<tr><td colspan="2" style="padding:12px 12px 4px;font-weight:600;color:#171b21;">' +
            esc(s.title) + '</td></tr>');
        (s.rows || []).forEach(function (r) {
            rows.push('<tr><td style="padding:6px 12px;color:#606a76;">' + esc(r.k) +
                '</td><td style="padding:6px 12px;color:#171b21;">' + esc(r.v) + '</td></tr>');
        });
    });
    var body =
        '<div style="font:14px/1.7 -apple-system,Segoe UI,Microsoft YaHei,sans-serif;color:#171b21;' +
        'max-width:680px;margin:0 auto;padding:24px;border:1px solid #e0e3e6;border-radius:12px;">' +
        '<div style="font-size:13px;color:#606a76;">' + esc(c.siteHost) + ' · 风控通知</div>' +
        '<h2 style="margin:8px 0 4px;font-size:20px;font-weight:600;">' +
        '<span style="color:' + color + ';">[' + LEVEL_LABEL[level] + ']</span> ' + esc(event.title || '') + '</h2>' +
        (event.summary ? '<p style="margin:8px 0 16px;color:#606a76;">' + esc(event.summary) + '</p>' : '') +
        '<table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;">' +
        rows.join('') + '</table>' +
        '<p style="margin:16px 0 0;font-size:12px;color:#8b939e;">本邮件仅含字段名与计数，不含正文及个人信息。' +
        '处理入口：管理后台 → 违规记录 / 敏感词管理。</p></div>';
    return {
        subject: c.prefix + ' [' + LEVEL_LABEL[level] + '] ' + String(event.title || '通知'),
        html: body,
        text: '[' + LEVEL_LABEL[level] + '] ' + String(event.title || '') + '\n' +
            (event.summary || '') + '\n' +
            (event.rows || []).map(function (r) { return r.k + ': ' + r.v; }).join('\n'),
        from: c.fromName + ' <' + c.email.user + '>',
        to: c.recipients.join(',')
    };
}

// 惰性清理过期节流项，不新增常驻定时器。
function shouldThrottle(key, minMs) {
    if (!key || minMs <= 0) return false;
    var now = Date.now();
    Object.keys(throttle).forEach(function (k) {
        if (now - throttle[k] > minMs) delete throttle[k];
    });
    if (throttle[key] && now - throttle[key] <= minMs) return true;
    throttle[key] = now;
    return false;
}

function deliver(mail, cb) {
    if (process.env.ALERT_TRANSPORT === 'stub') {
        stub.push(mail);
        if (cb) cb(null);
        return;
    }
    try {
        var mailer = require('nodemailer');
        var c = resolve();
        var transport = mailer.createTransport({
            host: c.email.host,
            port: c.email.port,
            secure: c.email.secure,
            auth: {user: c.email.user, pass: c.email.pass},
            // CLI 场景必须快速失败：SMTP 不可达时不要挂住整个自动化轮次。
            connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000
        });
        transport.sendMail(mail, function (err) {
            if (err) console.error('[alert] 邮件发送失败（不阻断主流程）: ' + err.message);
            if (cb) cb(err || null);
        });
    } catch (e) {
        console.error('[alert] 邮件通道异常（不阻断主流程）: ' + (e && e.message ? e.message : e));
        if (cb) cb(e);
    }
}

/**
 * 实时告警。event.key 为节流键（如 hit:comment:某词）；realtime 关闭时直接跳过。
 * cb(err|null, {sent:boolean, reason:string}) 可选，回调不等 SMTP 完成（fire-and-forget）。
 */
exports.notify = function (event, cb) {
    var c = resolve();
    function done(sent, reason) {
        if (cb) cb(null, {sent: sent, reason: reason});
    }
    if (!c.enabled || !c.realtime) return done(false, c.enabled ? 'realtime-off' : 'disabled');
    if (shouldThrottle(event && event.key, c.throttleMs)) return done(false, 'throttled');
    try {
        deliver(render(event || {}), function () {});
    } catch (e) {
        console.error('[alert] 构造告警失败（不阻断主流程）: ' + (e && e.message ? e.message : e));
        return done(false, 'render-error');
    }
    return done(true, 'sent');
};

/**
 * 汇总告警（自动化脚本每轮结束时调用）。不做节流，由调用方保证「仅在有事件时发一封」。
 */
exports.digest = function (report, cb) {
    var c = resolve();
    function done(sent, reason) {
        if (cb) cb(null, {sent: sent, reason: reason});
    }
    if (!c.enabled) return done(false, 'disabled');
    try {
        // 与 notify 不同：汇总邮件要等 SMTP 真正返回再回调，否则 CLI 进程退出会丢信。
        deliver(render(report || {}), function (err) {
            done(!err, err ? 'send-failed' : 'sent');
        });
    } catch (e) {
        console.error('[alert] 构造汇总失败（不阻断主流程）: ' + (e && e.message ? e.message : e));
        return done(false, 'render-error');
    }
};

exports.getConfig = function () {
    var c = resolve();
    return {enabled: c.enabled, realtime: c.realtime, recipients: c.recipients,
        throttleMs: c.throttleMs, prefix: c.prefix};
};
exports.isEnabled = function () { return resolve().enabled; };
exports.resetThrottle = function () { throttle = {}; };
exports._stub = stub;
exports._parseRecipients = parseRecipients;
exports._render = render;
