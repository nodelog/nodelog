/**
 * 离线单测：告警通知 + 服务端自动归类（不连 MongoDB、不真发邮件）。
 * 运行：npm run test:automation
 *
 * ALERT_TRANSPORT=stub 让 services/alert.js 把邮件写进内存数组而非调用 SMTP，
 * 因此本文件可在任何环境重复运行，不会产生外部副作用。
 */
'use strict';
var assert = require('assert');
process.env.ALERT_TRANSPORT = 'stub';
var alert = require('../services/alert');
var ac = require('../services/autoClassify');

var pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); console.log('PASS | ' + name); pass++; }
    catch (e) { console.log('FAIL | ' + name + ' -> ' + (e && e.message ? e.message : e)); fail++; }
}
function reset() { alert.resetThrottle(); alert._stub.length = 0; }

// ---- 告警配置：未配置收件人时绝不发信 ----
delete process.env.ALERT_RECIPIENTS;
delete process.env.ALERT_ENABLED;
reset();
t('未配置收件人 → 告警禁用、零邮件', function () {
    assert.strictEqual(alert.isEnabled(), false);
    var r = null;
    alert.notify({level: 'warn', title: '命中', key: 'k1'}, function (e, x) { r = x; });
    assert.strictEqual(r.sent, false);
    assert.strictEqual(r.reason, 'disabled');
    assert.strictEqual(alert._stub.length, 0);
});

t('收件人解析：过滤非法地址 + 大小写去重', function () {
    var list = alert._parseRecipients('ops@example.com, bad-address, OPS@example.com, dev@example.org');
    assert.deepStrictEqual(list, ['ops@example.com', 'dev@example.org']);
    assert.deepStrictEqual(alert._parseRecipients(['a@example.com', 'a@example.com']), ['a@example.com']);
});

// ---- 实时告警：节流 + 内容转义 ----
process.env.ALERT_RECIPIENTS = 'ops@example.com';
reset();
t('配置收件人后启用，首封实时告警发送', function () {
    assert.strictEqual(alert.isEnabled(), true);
    var r = null;
    alert.notify({
        level: 'warn', title: '敏感词命中，已自动拒发',
        summary: '内容未落库', key: 'hit:comment:<script>alert(1)</script>',
        rows: [{k: '命中词', v: '<b>测试词</b>'}]
    }, function (e, x) { r = x; });
    assert.strictEqual(r.sent, true);
    assert.strictEqual(alert._stub.length, 1);
    assert.ok(/预警/.test(alert._stub[0].subject));
    assert.strictEqual(alert._stub[0].to, 'ops@example.com');
});

t('告警正文做 HTML 转义，不注入脚本', function () {
    var html = alert._stub[0].html;
    assert.ok(html.indexOf('<script>') === -1, '不应出现未转义的 script 标签');
    assert.ok(html.indexOf('&lt;b&gt;测试词&lt;/b&gt;') !== -1);
});

t('同一 key 在节流窗口内只发一封', function () {
    var r = null;
    alert.notify({level: 'warn', title: '敏感词命中', key: 'hit:comment:<script>alert(1)</script>'},
        function (e, x) { r = x; });
    assert.strictEqual(r.reason, 'throttled');
    assert.strictEqual(alert._stub.length, 1);
});

t('不同 key 可正常发送；resetThrottle 后可重发', function () {
    alert.notify({level: 'critical', title: '匹配器不可用', key: 'matcher_unavailable'});
    assert.strictEqual(alert._stub.length, 2);
    alert.resetThrottle();
    alert.notify({level: 'warn', title: '敏感词命中', key: 'hit:comment:<script>alert(1)</script>'});
    assert.strictEqual(alert._stub.length, 3);
});

t('汇总邮件等待发送完成后回调（CLI 退出不丢信）', function () {
    var r = null;
    alert.digest({level: 'warn', title: '自动化运维结果', sections: [
        {title: '存量复扫', rows: [{k: '命中', v: 2}]}
    ]}, function (e, x) { r = x; });
    assert.strictEqual(r.sent, true);
    assert.strictEqual(alert._stub.length, 4);
    assert.ok(/自动化运维结果/.test(alert._stub[3].subject));
});

t('ALERT_ENABLED=0 强制关闭，含汇总邮件', function () {
    process.env.ALERT_ENABLED = '0';
    reset();
    assert.strictEqual(alert.isEnabled(), false);
    var r = null;
    alert.digest({title: 'x'}, function (e, x) { r = x; });
    assert.strictEqual(r.sent, false);
    assert.strictEqual(alert._stub.length, 0);
    delete process.env.ALERT_ENABLED;
});

// ---- 服务端自动归类 / 打标签（与前端同口径）----
var cats = [
    {_id: 'ui', name: 'UI'},
    {_id: 'ops', name: '运维', keywords: ''},
    {_id: 'ai', name: 'AI', keywords: '机器学习,深度学习,gpt'},
    {_id: 'life', name: '生活'}
];
t('matchCategory：服务器文章不误选 UI', function () {
    var r = ac.matchCategory(cats, '服务器 .git 涨到 5GB：一次从诊断到重构的完整复盘', '');
    assert.ok(r && r.name === '运维');
});
t('matchCategory：显式 keywords 覆盖内置别名', function () {
    var r = ac.matchCategory(cats, '写摘要', '用 gpt 生成了一段文字');
    assert.ok(r && r.name === 'AI');
});
t('matchCategory：无关内容返回 null；空分类返回 null', function () {
    assert.strictEqual(ac.matchCategory(cats, '今天做了顿饭', '番茄炒蛋'), null);
    assert.strictEqual(ac.matchCategory([], 'React 前端', ''), null);
});
t('extractTags：停用词过滤 + 数量上限', function () {
    var tags = ac.extractTags('使用 Redis 做缓存',
        'redis 是高性能的 key-value 数据库，我们用 redis 缓存热点数据，提升性能', 'markdown', 5);
    assert.ok(tags.length > 0 && tags.length <= 5);
    assert.ok(tags.indexOf('redis') !== -1);
    assert.ok(tags.indexOf('的') === -1);
});
t('extractTags：html 正文先去标签再提取', function () {
    var tags = ac.extractTags('', '<p>这是一段 <b>html</b> 正文，包含 script 与样式</p>', 'html', 5);
    tags.forEach(function (x) { assert.ok(!/[<>]/.test(x)); });
});

// ---- SMTP 覆盖、自动纠错与错误诊断 ----
t('ALERT_SMTP_* 覆盖生效，describe 不泄露密码', function () {
    process.env.ALERT_SMTP_HOST = 'smtp.qq.com';
    process.env.ALERT_SMTP_PORT = '465';
    process.env.ALERT_SMTP_SECURE = '1';
    process.env.ALERT_SMTP_USER = '1102377905@qq.com';
    process.env.ALERT_SMTP_PASS = 'secret-auth-code';
    var d = alert.describe();
    assert.strictEqual(d.smtp.host, 'smtp.qq.com');
    assert.strictEqual(d.smtp.port, 465);
    assert.strictEqual(d.smtp.secure, true);
    assert.strictEqual(d.smtp.user, '1102377905@qq.com');
    assert.strictEqual(d.smtp.passSet, true);
    assert.strictEqual(d.smtp.source, 'ALERT_SMTP_*');
    assert.ok(JSON.stringify(d).indexOf('secret-auth-code') === -1, 'describe 不得含密码');
});

t('587 + secure=0 视为 STARTTLS；localhost 主机按发件邮箱域名推断', function () {
    process.env.ALERT_SMTP_PORT = '587';
    process.env.ALERT_SMTP_SECURE = '0';
    var s = alert._resolveSmtp();
    assert.strictEqual(s.port, 587);
    assert.strictEqual(s.secure, false);
    process.env.ALERT_SMTP_HOST = 'localhost';
    assert.strictEqual(alert._resolveSmtp().host, 'smtp.qq.com');
});

t('526 认证失败 → 按发件服务商给指引（阿里云企业邮箱 / QQ 分流）', function () {
    var err = new Error('Invalid login: 526 Authentication failure[0]');
    var ali = alert.explainSmtpError(err, {
        host: 'smtp.qiye.aliyun.com', port: 465, secure: true, user: 'you@your-domain.com'
    });
    assert.strictEqual(ali.kind, 'auth');
    assert.ok(/阿里云企业邮箱/.test(ali.title));
    assert.ok(ali.steps.join(' ').indexOf('客户端授权密码') !== -1);
    assert.ok(ali.steps.join(' ').indexOf('QQ') === -1, '不得误判成 QQ 授权码');
    var qq = alert.explainSmtpError(err, {
        host: 'smtp.qq.com', port: 465, secure: true, user: 'me@qq.com'
    });
    assert.ok(/QQ/.test(qq.title));
    assert.ok(qq.steps.join(' ').indexOf('授权码') !== -1);
});

t('收件人是 qq.com 不影响发件服务商判断', function () {
    process.env.ALERT_RECIPIENTS = 'someone@qq.com';
    var smtp = alert._resolveSmtp();
    smtp.host = 'smtp.qiye.aliyun.com';
    var ex = alert.explainSmtpError(new Error('526 Authentication failure'), smtp);
    assert.ok(/阿里云企业邮箱/.test(ex.title));
    assert.strictEqual(alert.providerAdvice(smtp).name, '阿里云企业邮箱');
    assert.strictEqual(typeof alert.describe().smtp.provider, 'string');
    delete process.env.ALERT_RECIPIENTS;
});

t('连接超时 / TLS 握手失败各自给出对应指引', function () {
    assert.strictEqual(alert.explainSmtpError(new Error('connect ETIMEDOUT')).kind, 'network');
    assert.strictEqual(alert.explainSmtpError(new Error('wrong version number SSL')).kind, 'tls');
});

['ALERT_SMTP_HOST', 'ALERT_SMTP_PORT', 'ALERT_SMTP_SECURE',
 'ALERT_SMTP_USER', 'ALERT_SMTP_PASS'].forEach(function (k) { delete process.env[k]; });

// ---- SMTP 自适应探测 + 自检 API 脱敏（离线，不连库、不真发信）----
var alertApi = require('../controllers/alertApi');
t('候选参数组合覆盖 PLAIN/LOGIN 与密码清洗，且不含任何凭据明文', function () {
    process.env.ALERT_SMTP_HOST = 'smtp.qiye.aliyun.com';
    process.env.ALERT_SMTP_PORT = '465';
    process.env.ALERT_SMTP_SECURE = '1';
    process.env.ALERT_SMTP_USER = 'wyc@jiangzi.xin';
    process.env.ALERT_SMTP_PASS = 'probe-secret-xyz';
    var list = alert._buildProfiles(alert._resolveSmtp());
    assert.ok(list.length >= 10, '候选数量应足够覆盖常见差异');
    assert.ok(list.some(function (p) { return p.authMethod === 'PLAIN'; }));
    assert.ok(list.some(function (p) { return p.authMethod === 'LOGIN'; }));
    assert.ok(list.some(function (p) { return p.passForm === 'clean'; }));
    var txt = JSON.stringify(list);
    assert.ok(txt.indexOf('probe-secret-xyz') === -1, '候选不得携带密码');
    assert.ok(txt.indexOf('wyc@jiangzi.xin') === -1, '候选不得携带账号');
});

t('自检 API 响应脱敏：删敏感键 + 把错误里的明文密码打码', function () {
    var body = alertApi._sanitize({
        pass: 'probe-secret-xyz', token: 'abc',
        smtp: {user: 'wyc@jiangzi.xin', passSet: true},
        tried: [{authMethod: 'PLAIN', error: 'Invalid login: 526 probe-secret-xyz'}]
    });
    assert.strictEqual(body.pass, undefined);
    assert.strictEqual(body.token, undefined);
    assert.strictEqual(body.smtp.user, 'wyc@jiangzi.xin', '账号本身可保留');
    assert.ok(JSON.stringify(body).indexOf('probe-secret-xyz') === -1, '不得泄露密码');
    assert.ok(/REDACTED/.test(body.tried[0].error));
});

t('stub 通道下 sendTest 走完整自检链路并返回 sent:true', function () {
    alert.resetThrottle();
    alert._stub.length = 0;
    var r = null;
    alert.sendTest({}, function (e, x) { r = x; });
    assert.ok(r, '应有回调结果');
    assert.strictEqual(r.sent, true);
    assert.strictEqual(alert._stub.length, 1);
    assert.ok(/自检/.test(alert._stub[0].subject));
});

t('收件人白名单：任意地址不能借自检接口中继', function () {
    var r = null;
    alert.sendTest({to: 'attacker@evil.example.com'}, function (e, x) { r = x; });
    assert.strictEqual(r.sent, false);
    assert.strictEqual(r.reason, 'recipient-not-allowed');
    assert.strictEqual(alert._stub.length, 1, '不应产生额外邮件');
});

alert.resetProfile();
['ALERT_SMTP_HOST', 'ALERT_SMTP_PORT', 'ALERT_SMTP_SECURE',
 'ALERT_SMTP_USER', 'ALERT_SMTP_PASS'].forEach(function (k) { delete process.env[k]; });

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
