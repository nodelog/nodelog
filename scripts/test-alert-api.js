#!/usr/bin/env node
/**
 * 邮件告警自检 API 的端到端测试：真起 SMTP 服务 + 真起 HTTP 服务 + 真发一封邮件。
 *
 *   node scripts/test-alert-api.js        （npm run test:alert-api）
 *
 * 为什么需要本地 SMTP 服务：本机没有生产凭据，不能拿真实企业邮箱反复试错。
 * 这里用纯 net 实现一个最小 SMTP 服务器，并【故意复现生产现象】：
 *   - EHLO 广告 "AUTH LOGIN PLAIN"，nodemailer 默认取第一个（LOGIN）；
 *   - 对 AUTH LOGIN 返回 "526 Authentication failure[0]"（与用户线上报错一致）；
 *   - 只有 AUTH PLAIN + 正确凭据才返回 235。
 * 于是自检 API 必须靠 services/alert.js 的自动探测换到 PLAIN，才能把邮件真正发出去。
 * 断言的是 SMTP 服务端【确实收到了邮件】以及 HTTP 返回 sent:true，不是 stub、不是日志。
 *
 * 不连 MongoDB、不新增依赖、不读取任何生产凭据；收件人/发件账号均为测试常量。
 * 生产环境部署后调用同一个 POST /api/alert/probe，会读真实 settings.js 并真实投递。
 */
'use strict';

var net = require('net');
var http = require('http');
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var express = require('express');
var bodyParser = require('body-parser');

var ROOT = path.join(__dirname, '..');
var PROFILE_FILE = path.join(ROOT, '.alert-smtp-profile.json');
var SMTP_USER = 'wyc@jiangzi.xin';
var SMTP_PASS = 'local-test-secret';
var RECIPIENT = '1102377905@qq.com';
var TOKEN = '0123456789abcdef0123456789abcdef';

var received = [];       // SMTP 服务端真正收到的邮件
var authAttempts = [];   // 认证尝试记录（只记机制与用户名，不记密码）

function startSmtp(cb) {
    var server = net.createServer(function (socket) {
        socket.setEncoding('utf8');
        var buf = '';
        var inData = false;
        var authPending = false;
        var lines = [];
        var from = '';
        var rcpt = [];

        function reply(s) { socket.write(s + '\r\n'); }
        function finishPlain(b64) {
            var decoded = '';
            try { decoded = Buffer.from(b64, 'base64').toString('utf8'); } catch (e) { /* 忽略 */ }
            var p = decoded.split('\0');
            var user = p[1] || '';
            var pass = p[2] || '';
            var ok = (user === SMTP_USER && pass === SMTP_PASS);
            authAttempts.push({mech: 'PLAIN', user: user, ok: ok});
            return reply(ok ? '235 2.7.0 Authentication successful'
                : '535 5.7.8 Authentication credentials invalid');
        }
        function handle(line) {
            if (authPending) {
                authPending = false;
                return finishPlain(line.trim());
            }
            if (inData) {
                if (line === '.') {
                    inData = false;
                    received.push({from: from, rcpt: rcpt.slice(), raw: lines.join('\r\n')});
                    lines = [];
                    return reply('250 2.0.0 Ok: queued as TEST' + received.length);
                }
                lines.push(line);
                return;
            }
            var parts = line.split(/\s+/);
            var cmd = (parts[0] || '').toUpperCase();
            if (cmd === 'EHLO' || cmd === 'HELO') {
                // 只广告 LOGIN：nodemailer 默认机制必为 LOGIN 且无其他机制可内部回退，
                // 返回 526 后只能由 services/alert.js 的显式 PLAIN 候选救回来。
                // （若同时广告 PLAIN，nodemailer 会自己 fallback，就测不到自动探测了。）
                return socket.write(
                    '250-localhost\r\n250-AUTH LOGIN\r\n250-SIZE 10485760\r\n250 Ok\r\n');
            }
            if (cmd === 'AUTH') {
                var mech = (parts[1] || '').toUpperCase();
                if (mech === 'LOGIN') {
                    authAttempts.push({mech: 'LOGIN', user: '', ok: false});
                    return reply('526 5.7.0 Authentication failure[0]');
                }
                if (mech === 'PLAIN') {
                    if (parts[2]) return finishPlain(parts[2]);
                    authPending = true;
                    return reply('334 ');
                }
                return reply('504 5.5.4 Unrecognized authentication type');
            }
            if (cmd === 'MAIL') {
                from = (line.match(/FROM:\s*<([^>]*)>/i) || [])[1] || '';
                return reply('250 2.1.0 Ok');
            }
            if (cmd === 'RCPT') {
                var r = (line.match(/TO:\s*<([^>]*)>/i) || [])[1] || '';
                rcpt.push(r);
                return reply('250 2.1.5 Ok');
            }
            if (cmd === 'DATA') {
                inData = true;
                lines = [];
                return reply('354 End data with <CR><LF>.<CR><LF>');
            }
            if (cmd === 'RSET' || cmd === 'NOOP') return reply('250 2.0.0 Ok');
            if (cmd === 'QUIT') {
                reply('221 2.0.0 Bye');
                return socket.end();
            }
            return reply('502 5.5.2 Command not implemented');
        }
        reply('220 localhost ESMTP NODELOG-TEST');
        socket.on('data', function (chunk) {
            buf += chunk;
            var m;
            while ((m = /\r?\n/.exec(buf)) !== null) {
                var line = buf.slice(0, m.index).replace(/\r$/, '');
                buf = buf.slice(m.index + m[0].length);
                handle(line);
            }
        });
        socket.on('error', function () { /* 客户端主动断开，忽略 */ });
    });
    server.listen(0, '127.0.0.1', function () { cb(server.address().port); });
    return server;
}

function httpJson(port, method, url, body, headers, cb) {
    var payload = body ? JSON.stringify(body) : '';
    var h = {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)};
    Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
    var req = http.request({host: '127.0.0.1', port: port, method: method, path: url, headers: h},
        function (res) {
            var data = '';
            res.on('data', function (c) { data += c; });
            res.on('end', function () {
                var parsed = data;
                try { parsed = JSON.parse(data); } catch (e) { /* 保留原始文本 */ }
                cb(res.statusCode, parsed, data);
            });
        });
    req.on('error', function (e) { cb(0, {error: e.message}, ''); });
    if (payload) req.write(payload);
    req.end();
}

var failures = [];
function check(name, fn) {
    try { fn(); console.log('PASS | ' + name); }
    catch (e) { failures.push(name + ' -> ' + (e && e.message ? e.message : e)); console.log('FAIL | ' + name + ' -> ' + (e && e.message ? e.message : e)); }
}
function finish(httpServer, smtpServer) {
    httpServer.close(function () {});
    smtpServer.close(function () {});
    try { fs.unlinkSync(PROFILE_FILE); } catch (e) { /* 清理运行产物 */ }
    console.log('\n结果: ' + (failures.length ? failures.length + ' 项失败' : '全部通过') +
        ' | SMTP 实际收到邮件 ' + received.length + ' 封');
    if (failures.length) {
        failures.forEach(function (f) { console.error('  - ' + f); });
        process.exit(1);
    }
    process.exit(0);
}

// ---------------------------------------------------------------------------
// 环境变量必须在 require(settings) 之前设置：settings.js 在加载时固化 recipients。
// ---------------------------------------------------------------------------
var smtpServer = startSmtp(function (smtpPort) {
    process.env.ALERT_SMTP_HOST = '127.0.0.1';
    process.env.ALERT_SMTP_PORT = String(smtpPort);
    process.env.ALERT_SMTP_SECURE = '0';
    process.env.ALERT_SMTP_USER = SMTP_USER;
    process.env.ALERT_SMTP_PASS = SMTP_PASS;
    process.env.ALERT_RECIPIENTS = RECIPIENT;
    process.env.ARTICLE_API_TOKENS = TOKEN;
    delete process.env.ALERT_TRANSPORT;
    delete process.env.ALERT_ENABLED;
    delete process.env.ALERT_REALTIME;

    var alert = require('../services/alert');
    var csrfGuard = require('../routes/filter').csrfGuard;
    var alertApi = require('../controllers/alertApi');
    alert.resetProfile();     // 每次都从「未探测」状态开始，确保真的走自愈链路

    var app = express();
    app.use(bodyParser.json());
    app.use(csrfGuard);       // 真实守卫：验证 /api/alert 已进 CSRF 白名单
    app.get('/api/alert/status', alertApi.auth, alertApi.status);
    app.post('/api/alert/probe', alertApi.auth, alertApi.probe);
    var httpServer = app.listen(0, '127.0.0.1', function () {
        var port = httpServer.address().port;
        var auth = {'Authorization': 'Bearer ' + TOKEN};
        var evilOrigin = {'Origin': 'https://evil.example.com',
            'Authorization': 'Bearer ' + TOKEN};

        httpJson(port, 'GET', '/api/alert/status', null, auth, function (code, body, raw) {
            check('status 返回 200 且配置脱敏（不含密码/令牌）', function () {
                assert.strictEqual(code, 200);
                assert.strictEqual(body.config.smtp.user, SMTP_USER);
                assert.strictEqual(body.config.smtp.host, '127.0.0.1');
                assert.strictEqual(body.config.profile, null, '初始应无已保存组合');
                assert.ok(raw.indexOf(SMTP_PASS) === -1, '响应不得包含密码');
                assert.ok(raw.indexOf(TOKEN) === -1, '响应不得包含 API Token');
            });

            httpJson(port, 'POST', '/api/alert/probe', {to: RECIPIENT}, {}, function (c2, b2) {
                check('无 Token 的 probe 被 401 拒绝', function () {
                    assert.strictEqual(c2, 401);
                    assert.strictEqual(b2.success, false);
                });

                httpJson(port, 'POST', '/api/alert/probe', {to: RECIPIENT}, evilOrigin, function (c3, b3) {
                    check('带 Token + 跨站 Origin：CSRF 白名单放行（不是 403）', function () {
                        assert.notStrictEqual(c3, 403, '/api/alert 未加入 csrfGuard 白名单');
                    });
                    check('首次 probe 复现 526 后自动换认证机制，真实发信成功', function () {
                        assert.strictEqual(c3, 200, 'HTTP 应为 200；实际: ' + c3 + ' ' + JSON.stringify(b3));
                        assert.strictEqual(b3.success, true);
                        assert.strictEqual(b3.sent, true);
                        assert.strictEqual(b3.reason, 'sent');
                        assert.ok(b3.messageId, '应有 SMTP messageId');
                        assert.strictEqual(b3.profile.authMethod, 'PLAIN', '应自动切到 PLAIN');
                        assert.ok(b3.tried.length >= 2, '应至少尝试 2 个参数组合');
                        assert.ok(/526/.test(b3.tried[0].error), '首个组合应复现 526 认证失败');
                        assert.strictEqual(b3.tried[0].ok, false);
                    });
                    check('认证轨迹：默认 LOGIN 被 526 拒绝，探测后 PLAIN 认证成功', function () {
                        assert.ok(authAttempts.some(function (a) {
                            return a.mech === 'LOGIN' && a.ok === false;
                        }), '应复现 LOGIN 认证失败');
                        assert.ok(authAttempts.some(function (a) {
                            return a.mech === 'PLAIN' && a.ok === true;
                        }), '应自动切到 PLAIN 并认证成功');
                    });
                    check('SMTP 服务端确实收到 1 封邮件，发件/收件账号正确', function () {
                        assert.strictEqual(received.length, 1);
                        assert.strictEqual(received[0].from, SMTP_USER);
                        assert.ok(received[0].rcpt.indexOf(RECIPIENT) !== -1);
                        assert.ok(received[0].raw.indexOf('Subject:') !== -1, '邮件应有主题头');
                    });
                    check('响应全程脱敏：不出现密码、Token', function () {
                        var s = JSON.stringify(b3);
                        assert.ok(s.indexOf(SMTP_PASS) === -1, '响应泄露了密码');
                        assert.ok(s.indexOf(TOKEN) === -1, '响应泄露了 Token');
                    });
                    check('持久化的 profile 文件只含参数名，不含任何凭据', function () {
                        var txt = fs.readFileSync(PROFILE_FILE, 'utf8');
                        assert.ok(txt.indexOf(SMTP_PASS) === -1);
                        assert.ok(txt.indexOf(SMTP_USER) === -1);
                        var p = JSON.parse(txt);
                        assert.strictEqual(p.profile.authMethod, 'PLAIN');
                    });

                    httpJson(port, 'POST', '/api/alert/probe', {to: RECIPIENT}, evilOrigin, function (c4, b4) {
                        check('第二次 probe 复用已探测组合，再次真实发信成功', function () {
                            assert.strictEqual(c4, 200, 'HTTP: ' + c4 + ' ' + JSON.stringify(b4));
                            assert.strictEqual(b4.sent, true);
                            assert.strictEqual(received.length, 2, 'SMTP 应累计收到 2 封');
                        });

                        httpJson(port, 'POST', '/api/alert/probe',
                            {to: 'attacker@evil.example.com'}, evilOrigin, function (c5, b5) {
                                check('收件人白名单：任意地址被拒绝（防邮件中继）', function () {
                                    assert.strictEqual(c5, 502);
                                    assert.strictEqual(b5.reason, 'recipient-not-allowed');
                                    assert.strictEqual(received.length, 2, '不应产生第三封邮件');
                                });
                                finish(httpServer, smtpServer);
                            });
                    });
                });
            });
        });
    });
});
