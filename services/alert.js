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
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var settings = require('../settings');

var LEVEL_LABEL = {info: '提示', warn: '预警', critical: '告警'};
var LEVEL_COLOR = {info: '#1d4ed8', warn: '#8a5a0a', critical: '#c32d28'};
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

var throttle = {};   // key -> 上次发送时间戳
var stub = [];       // ALERT_TRANSPORT=stub 时收集邮件（仅测试）
var lastError = null; // 最近一次 SMTP 错误，供 probe 输出修复建议

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

// ---------------------------------------------------------------------------
// SMTP 配置解析：允许告警与评论通知使用【不同】发件账号，且支持环境变量一行覆盖。
// 优先级：ALERT_SMTP_* 环境变量 > settings.alert.smtp > settings.email（原有评论通知配置）。
// 自动纠错（只补明显错误，不覆盖明确配置）：
//   - host 为空 / localhost / 示例域 → 按发件账号邮箱域名推断（@qq.com → smtp.qq.com 等）；
//   - secure 未显式配置时按端口推断（465=SSL true，587=STARTTLS false）；
//   - 端口与加密方式冲突时按标准纠正（465→true、587→false）。
// ---------------------------------------------------------------------------
var SMTP_HOST_BY_DOMAIN = {
    'qq.com': 'smtp.qq.com', 'foxmail.com': 'smtp.qq.com',
    '163.com': 'smtp.163.com', '126.com': 'smtp.126.com', 'yeah.net': 'smtp.yeah.net',
    'gmail.com': 'smtp.gmail.com', 'outlook.com': 'smtp.office365.com',
    'hotmail.com': 'smtp.office365.com', 'live.com': 'smtp.office365.com'
};

function inferHost(user) {
    var m = /@([^\s@]+)$/.exec(String(user || '').trim().toLowerCase());
    return m ? (SMTP_HOST_BY_DOMAIN[m[1]] || '') : '';
}

function resolveSmtp() {
    var base = settings.email || {};
    var own = (settings.alert && settings.alert.smtp) || {};
    var env = {
        host: process.env.ALERT_SMTP_HOST, port: process.env.ALERT_SMTP_PORT,
        secure: process.env.ALERT_SMTP_SECURE, user: process.env.ALERT_SMTP_USER,
        pass: process.env.ALERT_SMTP_PASS
    };
    var usedEnv = Object.keys(env).some(function (k) { return env[k] !== undefined && env[k] !== ''; });
    var usedOwn = Object.keys(own).length > 0;
    function pick(key) {
        if (env[key] !== undefined && env[key] !== '') return env[key];
        if (own[key] !== undefined && own[key] !== '') return own[key];
        return base[key];
    }
    var user = String(pick('user') || '').trim();
    var host = String(pick('host') || '').trim();
    var inferred = inferHost(user);
    if ((!host || /^(localhost|127\.0\.0\.1|smtp\.example\.com)$/i.test(host)) && inferred) {
        host = inferred;
    }
    var rawSecure = pick('secure');
    var port = parseInt(pick('port'), 10);
    var secureExplicit = !(rawSecure === undefined || rawSecure === '');
    var secure;
    if (!secureExplicit) {
        secure = (port === 465);
    } else {
        secure = (rawSecure === true || rawSecure === 1 || rawSecure === '1' || rawSecure === 'true');
    }
    if (!isFinite(port) || port < 1) port = secure ? 465 : 587;
    // 仅在未显式声明 secure 时按标准端口纠正，不覆盖运维的明确选择。
    if (!secureExplicit && port === 465) secure = true;   // implicit TLS
    if (!secureExplicit && port === 587) secure = false;  // STARTTLS
    return {
        host: host, port: port, secure: secure, user: user,
        pass: String(pick('pass') == null ? '' : pick('pass')),
        source: usedEnv ? 'ALERT_SMTP_*' : (usedOwn ? 'settings.alert.smtp' : 'settings.email')
    };
}

// 按【发件主机 / 发件账号】识别服务商。
// 关键：收件人（settings.alert.recipients）与发件账号（smtp.user）是两套独立配置，
// 绝不能从收件人域名推断发件服务商——收件人是 @qq.com，发件完全可能是阿里云企业邮箱。
function providerAdvice(smtp) {
    var host = String((smtp && smtp.host) || '').toLowerCase();
    var user = String((smtp && smtp.user) || '').toLowerCase();
    var domain = (/@([^\s@]+)$/.exec(user) || [])[1] || '';
    var common = [
        '认证 user 必须是完整邮箱地址，且 From 与认证账号一致（当前发件账号：' + (user || '未配置') + '）',
        '不改 settings.js 可临时覆盖：ALERT_SMTP_HOST / ALERT_SMTP_PORT / ALERT_SMTP_SECURE / ALERT_SMTP_USER / ALERT_SMTP_PASS',
        '当前发件主机：' + (host || '未配置') + (smtp && smtp.port ? ':' + smtp.port : '') +
            '；465=SSL(secure=true)，587=STARTTLS(secure=false)'
    ];
    var name, specific;
    if (/qiye\.aliyun|aliyun|mxhichina/.test(host)) {
        name = '阿里云企业邮箱';
        specific = [
            '若管理后台开启了「客户端授权密码 / 安全密码」，SMTP 的 pass 必须填该专用密码，而不是邮箱登录密码；在管理后台 → 安全设置 / 账号管理里查看或重新生成',
            '确认管理后台已为该账号开启 POP3/SMTP/IMAP 服务，账号未停用、未限制「第三方客户端登录」',
            '确认账号没有被安全策略拦截（异地登录、IP 白名单、二次验证），必要时在邮箱侧重置专用密码',
            '阿里云 ECS 出站 25 端口通常被封，请固定使用 465（SSL）或 587（STARTTLS）'
        ];
    } else if (/qq\.com|foxmail/.test(host) || domain === 'qq.com' || domain === 'foxmail.com') {
        name = 'QQ / Foxmail 邮箱';
        specific = ['必须使用「授权码」而非登录密码：邮箱网页版 → 设置 → 账号/POP3-SMTP → 开启服务 → 生成 16 位授权码'];
    } else if (/163\.com|126\.com|yeah\.net/.test(host) || /^(163|126)\.com$/.test(domain)) {
        name = '网易邮箱';
        specific = ['必须使用「客户端授权密码」而非登录密码，且已开启 SMTP/POP3 服务'];
    } else if (/gmail/.test(host) || domain === 'gmail.com') {
        name = 'Gmail';
        specific = ['需使用「应用专用密码」，且 Google 账号已开启两步验证'];
    } else if (/office365|outlook|hotmail/.test(host)) {
        name = 'Microsoft 365 / Outlook';
        specific = ['需使用「应用密码」，且租户已为该邮箱开启 SMTP AUTH'];
    } else {
        name = '企业 / 自建邮箱（未识别服务商）';
        specific = [
            '向邮箱服务商确认是否需要「客户端专用密码 / 授权码」，以及是否已开启 SMTP 服务',
            '确认账号未被限制第三方客户端登录（多数企业邮默认只允许网页版）'
        ];
    }
    return {name: name, steps: specific.concat(common)};
}

// SMTP 错误 → 可直接照做的中文修复建议（按发件服务商给，不再只丢一句 "526 Authentication failure"）。
function explainSmtpError(err, smtp) {
    var msg = String(err && (err.message || err) || '');
    var code = String(err && (err.code || err.responseCode) || '');
    var cur = smtp || resolveSmtp();
    if (/526|535|Authentication failure|Invalid login|BadCredentials|Username and Password not accepted|登录失败|认证失败/i.test(msg)) {
        var p = providerAdvice(cur);
        return {
            kind: 'auth',
            title: 'SMTP 认证失败（' + p.name + '）：账号或密码不被接受',
            steps: p.steps
        };
    }
    if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ESOCKET|timeout/i.test(msg + ' ' + code)) {
        return {
            kind: 'network',
            title: 'SMTP 服务器连不上',
            steps: [
                '检查 host/port 是否正确（当前：' + (cur.host || '未配置') + ':' + cur.port + '）',
                '云服务器常封禁出站 25 端口，改用 465（SSL）或 587（STARTTLS）；检查安全组与防火墙出站规则',
                '可用 node scripts/moderation-automation.js smtp-try 自动试常见端口组合'
            ]
        };
    }
    if (/certificate|SSL|TLS|wrong version|EPROTO/i.test(msg)) {
        return {
            kind: 'tls',
            title: 'TLS/SSL 握手失败，通常是端口与 secure 不匹配',
            steps: [
                '465 配 secure=true（implicit TLS），587 配 secure=false（STARTTLS）；当前 ' +
                    (cur.host || '未配置') + ':' + cur.port + ' secure=' + cur.secure,
                '脚本仅在未显式声明 secure 时按端口纠正；若仍失败可显式设 ALERT_SMTP_SECURE=0 或 1',
                '可用 node scripts/moderation-automation.js smtp-try 自动试常见端口组合'
            ]
        };
    }
    if (/550|553|554|sender|from|Mail from/i.test(msg + ' ' + code)) {
        return {
            kind: 'sender',
            title: '发件人地址被拒绝',
            steps: [
                'From 必须与认证账号一致（默认取 ALERT_SMTP_USER / settings.email.user）',
                '确认该邮箱已开启 SMTP 服务，且未在邮箱侧关闭「第三方客户端发信」'
            ]
        };
    }
    return {kind: 'other', title: 'SMTP 发送失败', steps: ['原始错误：' + msg.slice(0, 300)]};
}

// 单一配置解析点：环境变量 > settings.alert > 内置默认。
function resolve() {
    var cfg = settings.alert || {};
    var envRaw = process.env.ALERT_RECIPIENTS;
    var recipients = parseRecipients(
        (envRaw && envRaw.trim()) ? envRaw : cfg.recipients);
    var email = resolveSmtp();
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

// ---------------------------------------------------------------------------
// SMTP 自适应探测：账号配置一字不改，由代码找到能认证成功的【传输参数】组合。
//
// 企业邮（阿里云企业邮箱 smtp.qiye.aliyun.com 等）在 AUTH 阶段对以下参数极敏感，
// 任何一项不匹配都统一回 "526 Authentication failure" / 535，并不告诉你是哪一项：
//   ① 认证机制 LOGIN vs PLAIN（最常见，nodemailer 默认 LOGIN）
//   ② 密码串里混入 BOM / 首尾空白 / 零宽字符（配置里填的确实是正确密码）
//   ③ AUTH 用户名要完整邮箱还是 @ 前的 local-part
//   ④ 465 implicit TLS 与 587 STARTTLS、证书校验严格度
//
// 因此：枚举候选 → 逐个 transport.verify()（只认证、不发信）→ 第一个成功的组合
// 持久化到 .alert-smtp-profile.json（【只存参数名，绝不存密码】）→ 之后所有告警邮件
// 直接复用，实现「一次自检、长期自愈」。profile 与凭据摘要绑定，改配置会自动重新探测。
// ---------------------------------------------------------------------------
var PROFILE_FILE = path.join(__dirname, '..', '.alert-smtp-profile.json');
var activeProfile = null;
var healing = false;

function fingerprint(smtp) {
    // 单向摘要只用于判断「凭据是否变化」，不含任何可还原的原文。
    return crypto.createHash('sha256')
        .update([smtp.host, smtp.port, smtp.user, smtp.pass, smtp.secure].join('\u0001'))
        .digest('hex').slice(0, 16);
}

function readProfile(smtp) {
    if (activeProfile && activeProfile.fp === fingerprint(smtp)) return activeProfile;
    try {
        var raw = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
        if (raw && raw.fp === fingerprint(smtp) && raw.profile) {
            activeProfile = raw;
            return raw;
        }
    } catch (e) { /* 首次运行或文件损坏：直接走探测 */ }
    return null;
}

function saveProfile(smtp, profile) {
    activeProfile = {
        fp: fingerprint(smtp), profile: profile, at: new Date().toISOString(),
        provider: providerAdvice(smtp).name
    };
    try {
        fs.writeFileSync(PROFILE_FILE, JSON.stringify(activeProfile, null, 2));
    } catch (e) {
        console.error('[alert] 保存 SMTP 探测结果失败（不影响本次发信）: ' + e.message);
    }
    return activeProfile;
}

function baseProfile(smtp) {
    return {
        port: smtp.port, secure: smtp.secure, authMethod: null,
        userForm: 'full', passForm: 'raw', tlsLoose: false
    };
}

function variant(smtp, over) {
    var p = baseProfile(smtp);
    Object.keys(over).forEach(function (k) { p[k] = over[k]; });
    return p;
}

// 候选按「最可能成功」排序；每个元素只描述怎么用凭据，不携带任何凭据值。
function buildProfiles(smtp) {
    var list = [], seen = {};
    function add(p) {
        var key = [p.port, p.secure, p.authMethod, p.userForm, p.passForm, p.tlsLoose].join('|');
        if (seen[key]) return;
        seen[key] = 1;
        p.id = 'P' + (list.length + 1);
        list.push(p);
    }
    add(baseProfile(smtp));                                   // 原始参数
    add(variant(smtp, {authMethod: 'PLAIN'}));                // 526 头号根因
    add(variant(smtp, {authMethod: 'LOGIN'}));
    ['trim', 'clean'].forEach(function (pf) {                // 密码里的不可见字符
        add(variant(smtp, {passForm: pf, authMethod: 'PLAIN'}));
        add(variant(smtp, {passForm: pf, authMethod: 'LOGIN'}));
    });
    // 源码字面量与运行时值不同 → 说明 JS 字符串转义 / 环境变量注入改动了密码，
    // 用文件里写的原始字面序列再试一次（不需要用户重新提供密码）。
    var srcPass = readSourcePass();
    if (srcPass !== null && srcPass !== String(smtp.pass == null ? '' : smtp.pass)) {
        ['PLAIN', 'LOGIN'].forEach(function (am) {
            add(variant(smtp, {passForm: 'source', authMethod: am}));
        });
    }
    ['PLAIN', 'LOGIN'].forEach(function (am) {
        add(variant(smtp, {userForm: 'local', authMethod: am}));
    });
    add(variant(smtp, {tlsLoose: true}));                     // 自签证书 / 老 TLS
    add(variant(smtp, {tlsLoose: true, authMethod: 'PLAIN'}));
    [{port: 465, secure: true}, {port: 587, secure: false}].forEach(function (pt) {
        ['PLAIN', 'LOGIN'].forEach(function (am) {
            add(variant(smtp, {port: pt.port, secure: pt.secure, authMethod: am}));
        });
    });
    return list;
}

function cleanText(s) {
    return String(s == null ? '' : s)
        .replace(/[\uFEFF\u200B-\u200D\u2060]/g, '')
        .replace(/[\r\n\t]/g, '')
        .trim();
}

// 读取 settings.js 里 email.pass 的【源码字面量】，不做 JS 字符串解析。
// 用途：配置里写的是正确密码，但 JS 字符串转义（\n / \t / \xNN / \123 等）或
// 环境变量注入的换行会让运行时值悄悄变样，SMTP 只会统一回 526。
// 该文件本身就在服务端、且只用于生成候选凭据，绝不对外输出其内容。
function readSourcePass() {
    try {
        var src = fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8');
        var start = src.indexOf('email:');
        if (start === -1) return null;
        var chunk = src.slice(start, start + 800);
        var m = /pass\s*:\s*(['"])((?:\\.|[^\\\r\n])*?)\1/.exec(chunk);
        return m ? m[2] : null;
    } catch (e) { return null; }
}

// 完全脱敏的凭据「形状」：长度、字符类别、单向摘要。不含任何可还原内容。
function passFingerprint(s) {
    var v = String(s == null ? '' : s);
    return {
        length: v.length,
        hasEdgeWhitespace: /^\s|\s$/.test(v),
        hasControlChars: /[\x00-\x1f\x7f]/.test(v),
        hasBackslash: v.indexOf('\\') !== -1,
        hasNonAscii: /[^\x20-\x7e]/.test(v),
        sha256Prefix: crypto.createHash('sha256').update(v).digest('hex').slice(0, 12)
    };
}

function authFor(smtp, p) {
    var user = String(smtp.user || '');
    if (p.userForm === 'local') user = user.split('@')[0];
    var pass = String(smtp.pass == null ? '' : smtp.pass);
    if (p.passForm === 'trim') pass = pass.replace(/^[\s\uFEFF]+|[\s\uFEFF]+$/g, '');
    if (p.passForm === 'clean') pass = cleanText(pass);
    if (p.passForm === 'source') pass = readSourcePass() || pass;
    return {user: user, pass: pass};
}

function transportOptions(smtp, p) {
    var o = {
        host: smtp.host, port: p.port, secure: p.secure, auth: authFor(smtp, p),
        // CLI 场景必须快速失败：SMTP 不可达时不要挂住整个自动化轮次。
        connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000
    };
    if (p.authMethod && p.authMethod !== 'auto') o.authMethod = p.authMethod;
    if (p.tlsLoose) o.tls = {rejectUnauthorized: false};
    return o;
}

// 对外 / 日志用的脱敏视图：只有参数名，没有账号密码值。
function describeProfile(p) {
    return {
        id: p.id || '', port: p.port, secure: p.secure,
        authMethod: p.authMethod || 'auto', userForm: p.userForm || 'full',
        passForm: p.passForm || 'raw', tlsLoose: !!p.tlsLoose
    };
}

function merge(a, b) {
    var out = {};
    Object.keys(a || {}).forEach(function (k) { out[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) { out[k] = b[k]; });
    return out;
}

/**
 * 逐个候选做 SMTP 连接 + 认证校验，找到第一个可用组合；只认证，不发信。
 * cb(null, {ok, profile, tried, fromCache, advice?})
 */
function findProfile(smtp, cb) {
    if (!smtp.host || !smtp.user || !smtp.pass) {
        return cb(null, {ok: false, reason: 'smtp-not-configured', tried: [], profile: null});
    }
    var mailer;
    try { mailer = require('nodemailer'); }
    catch (e) { return cb(e); }

    var cached = readProfile(smtp);
    var list = cached ? [cached.profile] : [];
    buildProfiles(smtp).forEach(function (p) { list.push(p); });
    var tried = [], i = 0, finished = false;
    function done(r) { if (!finished) { finished = true; cb(null, r); } }
    function next() {
        if (finished) return;
        if (i >= list.length) {
            var ex = explainSmtpError(lastError || new Error('all SMTP profiles failed'), smtp);
            var reason = ex.kind === 'auth' ? 'auth-failed'
                : (ex.kind === 'network' ? 'network-unreachable'
                    : (ex.kind === 'tls' ? 'tls-failed' : 'no-working-profile'));
            return done({ok: false, reason: reason, profile: null, tried: tried, advice: ex});
        }
        var p = list[i++];
        var transport;
        try { transport = mailer.createTransport(transportOptions(smtp, p)); }
        catch (e) {
            tried.push(merge(describeProfile(p), {ok: false,
                error: String(e.message || e).slice(0, 120)}));
            return next();
        }
        transport.verify(function (err) {
            if (transport.close) transport.close();
            tried.push(merge(describeProfile(p), {
                ok: !err,
                error: err ? String(err.message || err).slice(0, 120) : '',
                code: err && err.responseCode ? err.responseCode : null,
                response: err && err.response ? String(err.response).slice(0, 200) : ''
            }));
            if (err) { lastError = err; return next(); }
            saveProfile(smtp, describeProfile(p));
            done({ok: true, profile: describeProfile(p), tried: tried,
                fromCache: !!cached && i === 1});
        });
    }
    next();
}

/**
 * 真实发送一封测试邮件：自动探测可用 SMTP 参数组合，成功后只投递一封。
 * cb(null, {sent, reason, messageId?, accepted?, profile, tried, advice?})
 */
function probeAndSend(mail, cb) {
    if (!cb) cb = function () {};
    if (process.env.ALERT_TRANSPORT === 'stub') {
        stub.push(mail);
        return cb(null, {sent: true, reason: 'sent', messageId: 'stub',
            profile: null, tried: []});
    }
    var smtp = resolve().email;
    findProfile(smtp, function (err, found) {
        if (err) return cb(err);
        if (!found.ok) {
            return cb(null, {sent: false, reason: found.reason, profile: null,
                tried: found.tried, advice: found.advice});
        }
        var transport;
        try { transport = require('nodemailer').createTransport(transportOptions(smtp, found.profile)); }
        catch (e) { return cb(e); }
        transport.sendMail(mail, function (sErr, info) {
            if (transport.close) transport.close();
            if (sErr) {
                lastError = sErr;
                return cb(null, {sent: false, reason: 'send-failed', profile: found.profile,
                    tried: found.tried, advice: explainSmtpError(sErr, smtp)});
            }
            cb(null, {sent: true, reason: 'sent', messageId: info && info.messageId,
                accepted: info && info.accepted, profile: found.profile, tried: found.tried});
        });
    });
}

// 发送失败后的后台自愈：只探测参数、不发信，下一封告警即启用成功组合。
function heal(smtp) {
    if (healing || process.env.ALERT_TRANSPORT === 'stub') return;
    healing = true;
    findProfile(smtp, function (err, found) {
        healing = false;
        if (!err && found && found.ok) {
            console.error('[alert] 已自动找到可用 SMTP 参数组合: ' + JSON.stringify(found.profile));
        }
    });
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
        var cached = readProfile(c.email);
        var transport = mailer.createTransport(
            transportOptions(c.email, cached ? cached.profile : baseProfile(c.email)));
        transport.sendMail(mail, function (err) {
            if (err) {
                lastError = err;
                console.error('[alert] 邮件发送失败（不阻断主流程）: ' + err.message);
                console.error('[alert] 当前 SMTP（脱敏）: ' + JSON.stringify(describe().smtp));
                // 不改配置：后台自动探测可用传输参数，下一封邮件即生效。
                heal(c.email);
            }
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

// 脱敏配置视图：绝不包含密码，供 probe / 日志排障。
function describe() {
    var c = resolve();
    var prof = readProfile(c.email);
    return {
        enabled: c.enabled,
        realtime: c.realtime,
        recipients: c.recipients,
        throttleMinutes: Math.round(c.throttleMs / 60000),
        smtp: {
            host: c.email.host, port: c.email.port, secure: c.email.secure,
            user: c.email.user, passSet: !!c.email.pass, source: c.email.source,
            provider: providerAdvice(c.email).name
        },
        // 已探测到的可用传输参数组合（脱敏），null 表示尚未自检成功。
        profile: prof ? prof.profile : null,
        // 凭据形状诊断：只含长度 / 字符类别 / 单向摘要，绝不含可还原内容。
        // runtime 与 source 长度或摘要不一致 → JS 字符串转义或环境变量注入改动了密码。
        credentialShape: (function () {
            var runtime = String(c.email.pass == null ? '' : c.email.pass);
            var src = readSourcePass();
            return {
                runtime: passFingerprint(runtime),
                source: src === null ? null : passFingerprint(src),
                sourceDiffers: src !== null && src !== runtime,
                passFromEnv: !!process.env.ALERT_SMTP_PASS,
                sourceNote: src === null
                    ? 'settings.js 的 email.pass 非字符串字面量（可能由环境变量注入）' : ''
            };
        })()
    };
}

/**
 * 邮件通道自检：真实投递一封测试邮件。
 * 收件人只允许已配置的 recipients；未配置收件人时默认发给发件账号自己，
 * 因此「接收人需要另外配置」不影响自检，也不会把接口变成任意地址的中继。
 */
exports.sendTest = function (options, cb) {
    if (!cb) cb = function () {};
    var c = resolve();
    var allowed = c.recipients.length ? c.recipients : [c.email.user];
    var to = String((options && options.to) || allowed[0] || '').trim();
    if (!to || allowed.indexOf(to) === -1) {
        return cb(null, {sent: false, reason: 'recipient-not-allowed',
            allowed: allowed, tried: [], profile: null});
    }
    var now = new Date().toISOString();
    var mail = {
        from: c.fromName + ' <' + c.email.user + '>',
        to: to,
        subject: c.prefix + ' [自检] 邮件通道测试 ' + now.slice(0, 19).replace('T', ' '),
        text: 'NODELOG 风控告警邮件通道自检\n时间: ' + now + '\n发件账号: ' + c.email.user +
            '\n收件人: ' + to + '\n收到本邮件即表示 SMTP 认证与投递链路已打通。',
        html: '<div style="font:14px/1.7 -apple-system,Segoe UI,Microsoft YaHei,sans-serif;' +
            'color:#171b21;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e0e3e6;' +
            'border-radius:12px;"><h2 style="font-size:18px;margin:0 0 12px;">邮件通道自检通过</h2>' +
            '<p style="color:#606a76;margin:6px 0;">时间：' + esc(now) + '</p>' +
            '<p style="color:#606a76;margin:6px 0;">发件账号：' + esc(c.email.user) + '</p>' +
            '<p style="color:#606a76;margin:6px 0;">收件人：' + esc(to) + '</p>' +
            '<p style="margin:16px 0 0;">收到本邮件即表示 SMTP 认证与投递链路已打通，' +
            '后续风控预警 / 告警将走同一条通道。</p></div>'
    };
    probeAndSend(mail, function (err, r) {
        if (err) {
            return cb(null, {sent: false, reason: 'transport-error',
                error: String(err.message || err).slice(0, 200), tried: [], profile: null});
        }
        cb(null, r);
    });
};

// 候选组合：当前配置 + 推断出的服务商主机 × (465/SSL, 587/STARTTLS)。
function candidates(smtp) {
    var list = [{host: smtp.host, port: smtp.port, secure: smtp.secure}];
    var hosts = [smtp.host, inferHost(smtp.user)].filter(function (h, i, a) {
        return h && a.indexOf(h) === i;
    });
    [465, 587].forEach(function (port) {
        hosts.forEach(function (host) {
            var cand = {host: host, port: port, secure: port === 465};
            var dup = list.some(function (x) {
                return x.host === cand.host && x.port === cand.port && x.secure === cand.secure;
            });
            if (!dup) list.push(cand);
        });
    });
    return list.slice(0, 5);
}

/**
 * 只做 SMTP 连接 + 认证校验（transport.verify），不发任何邮件。
 * cb(null, {ok, recommended, tried, reason?})；认证类错误立即停止，不浪费时间试端口。
 */
exports.verify = function (cb) {
    var smtp = resolve().email;
    if (!smtp.host || !smtp.user || !smtp.pass) {
        return cb(null, {ok: false, reason: 'smtp-not-configured', tried: [], recommended: null});
    }
    var list = candidates(smtp), tried = [], recommended = null, i = 0;
    function next() {
        if (recommended || i >= list.length) {
            return cb(null, {ok: !!recommended, recommended: recommended, tried: tried});
        }
        var cand = list[i++];
        var transport;
        try {
            transport = require('nodemailer').createTransport({
                host: cand.host, port: cand.port, secure: cand.secure,
                auth: {user: smtp.user, pass: smtp.pass},
                connectionTimeout: 6000, greetingTimeout: 6000, socketTimeout: 8000
            });
        } catch (e) {
            tried.push({host: cand.host, port: cand.port, secure: cand.secure,
                ok: false, error: String(e.message || e).slice(0, 120)});
            return next();
        }
        transport.verify(function (err) {
            tried.push({host: cand.host, port: cand.port, secure: cand.secure, ok: !err,
                error: err ? String(err.message || err).slice(0, 120) : ''});
            if (transport.close) transport.close();
            if (!err) { recommended = cand; return next(); }
            // 认证失败换端口/主机无意义，直接收尾并交给 explainSmtpError 给授权码指引。
            if (explainSmtpError(err, smtp).kind === 'auth') {
                return cb(null, {ok: false, reason: 'auth', recommended: null, tried: tried});
            }
            next();
        });
    }
    next();
};

exports.getConfig = function () {
    var c = resolve();
    return {enabled: c.enabled, realtime: c.realtime, recipients: c.recipients,
        throttleMs: c.throttleMs, prefix: c.prefix};
};
exports.describe = describe;
exports.explainSmtpError = explainSmtpError;
exports.providerAdvice = providerAdvice;
exports.lastError = function () { return lastError; };
exports._resolveSmtp = resolveSmtp;
exports.isEnabled = function () { return resolve().enabled; };
exports.resetThrottle = function () { throttle = {}; };
exports.getProfile = function () {
    var p = readProfile(resolve().email);
    return p ? p.profile : null;
};
exports.probeAndSend = probeAndSend;
// 给 CLI 的 smtp-try 用：只探测可用参数组合，不发信。
exports.probeAuth = function (cb) { findProfile(resolve().email, cb); };
exports._buildProfiles = buildProfiles;
exports._describeProfile = describeProfile;
exports.resetProfile = function () {
    activeProfile = null;
    try { fs.unlinkSync(PROFILE_FILE); } catch (e) { /* 文件不存在 */ }
};
exports._stub = stub;
exports._parseRecipients = parseRecipients;
exports._render = render;
