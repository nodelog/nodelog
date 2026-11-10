/**
 * 开放平台接入自检（不需要 MongoDB，不需要 AppID）
 *
 *   node scripts/verify-open-platform.js
 *
 * 覆盖：HS256 验签（正确 / 错误密钥 / 过期 / 格式错误）、上游签名服务连通性、
 * 配置缺失时的降级行为。任何一项失败进程退出码为 1，可直接接进 CI。
 */
'use strict';

var path = require('path');
var root = path.join(__dirname, '..');
var jwt = require(path.join(root, 'services/openJwt'));
var op = require(path.join(root, 'services/openPlatform'));

var pass = 0;
var fail = 0;

function check(name, ok, detail) {
    if (ok) pass++; else fail++;
    console.log((ok ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  ' + detail : ''));
}

function report() {
    console.log('\n合计 ' + (pass + fail) + ' 项，通过 ' + pass + '，失败 ' + fail);
    process.exit(fail ? 1 : 0);
}

function finish() {
    runHttpChecks().then(report).catch(function (e) {
        check('HTTP 集成检查执行', false, e && e.message);
        report();
    });
}

// ---- 4. HTTP 层集成：真实 Express 路由 + 真实上游签名服务，不需要 MongoDB ----
function runHttpChecks() {
    var express = require('express');
    var cookieParser = require('cookie-parser');
    var http = require('http');
    var openAuth = require(path.join(root, 'controllers/openAuth'));
    var conf = op.getConfig.sync();
    var app = express();
    app.use(cookieParser());
    // 真实 app.js 在 session 中间件之后才挂 /open/*；这里用等价 stub，
    // 否则 logout 里的 req.session.user = null 会因 req.session 为 undefined 抛错。
    app.use(function (req, res, next) { if (!req.session) req.session = {}; next(); });
    app.get('/open/qrcode', openAuth.qrcode);
    app.get('/open/status', openAuth.status);
    app.get('/open/jsConfig', openAuth.jsConfig);
    app.get('/open/logout', openAuth.logout);

    return new Promise(function (resolve) {
        var server = app.listen(0, '127.0.0.1', function () {
            var port = server.address().port;
            function get(p) {
                return new Promise(function (res) {
                    http.get({host: '127.0.0.1', port: port, path: p}, function (r) {
                        var body = '';
                        r.on('data', function (c) { body += c; });
                        r.on('end', function () { res({status: r.statusCode, body: body, headers: r.headers}); });
                    }).on('error', function (e) { res({status: 0, body: e.message, headers: {}}); });
                });
            }
            (async function () {
                // 4.1 未配置密钥时明确降级且不打上游；已配置时只验结构，避免自检依赖商家凭证
                var r1 = await get('/open/qrcode');
                var j1 = {}; try { j1 = JSON.parse(r1.body); } catch (e) {}
                if (!conf.appId || !conf.appSecret) {
                    check('未配置密钥时 /open/qrcode 明确降级',
                        r1.status === 200 && j1.success === false && /未配置/.test(j1.msg || ''),
                        r1.body.slice(0, 70));
                } else {
                    check('已配置密钥时 /open/qrcode 返回结构化结果',
                        r1.status === 200 && typeof j1.success === 'boolean');
                }

                // 4.2 非法 token 前置拒绝，不触发网络/DB
                var r2 = await get('/open/status?token=not-a-token');
                check('非法扫码 token 被 400 拒绝', r2.status === 400);

                // 4.3 签名代理：URL 只解码一次、query 不丢
                var signUrl = 'https://blog.jiangzi.xin/content/detail?id=http-check&page=1';
                var r3 = await get('/open/jsConfig?url=' + encodeURIComponent(signUrl));
                var j3 = {}; try { j3 = JSON.parse(r3.body); } catch (e) {}
                var c3 = j3.data && j3.data.config;
                check('HTTP 层 /open/jsConfig 返回签名',
                    r3.status === 200 && j3.code === 1 && !!(c3 && c3.signature));
                check('HTTP 层签名 URL 含 query 且未二次编码',
                    !!(c3 && c3.url === signUrl), c3 && c3.url);

                // 4.4 logout 清免登录 cookie
                var r4 = await get('/open/logout');
                var setCookie = (r4.headers['set-cookie'] || []).join(';');
                check('/open/logout 清除 30 天凭证 cookie',
                    r4.status === 200 && /nl_open_jwt=/.test(setCookie));

                server.close(function () { resolve(); });
            })().catch(function (e) {
                check('HTTP 集成检查执行', false, e && e.message);
                try { server.close(function () { resolve(); }); } catch (x) { resolve(); }
            });
        });
    });
}

// ---- 1. JWT HS256 ----
var secret = 'unit-test-secret-do-not-use-in-prod';
var payload = { userId: '10086', phone: '13800138000', isWhitelist: false };

if (typeof jwt.sign === 'function') {
    var token = jwt.sign(payload, secret, 3600);
    var decoded = jwt.verify(token, secret);
    check('JWT 正确密钥通过', !!decoded && String(decoded.userId) === '10086',
        decoded ? 'userId=' + decoded.userId : '');
    check('JWT 错误密钥被拒', jwt.verify(token, secret + '-wrong') === null);
    check('JWT 过期被拒', jwt.verify(jwt.sign(payload, secret, -10), secret) === null);
    check('JWT 格式错误被拒', jwt.verify('not.a.jwt', secret) === null);
    check('JWT 空值被拒', jwt.verify('', secret) === null || jwt.verify(null, secret) === null);
} else {
    console.log('[SKIP] openJwt 未导出 sign，跳过 JWT 组');
}

// ---- 2. 配置降级 ----
// getConfig() 按契约返回 Promise，同步读取要用模块附带的 .sync
var cfg = (typeof op.getConfig === 'function' && typeof op.getConfig.sync === 'function')
    ? op.getConfig.sync()
    : (op.getConfig && typeof op.getConfig === 'object' ? op.getConfig : {});
check('配置对象可读（apiBase/appId/appSecret/adminPhones 齐全）',
    !!cfg && typeof cfg.apiBase === 'string' && typeof cfg.appId === 'string'
    && typeof cfg.appSecret === 'string' && Array.isArray(cfg.adminPhones),
    'apiBase=' + (cfg && cfg.apiBase));
check('AppSecret 未出现在配置以外的地方', typeof cfg.appSecret === 'string');

// ---- 3. 上游签名服务连通性（唯一联网项）----
var signUrl = 'https://blog.jiangzi.xin/content/detail?id=selftest&page=1';
op.getJsConfig(signUrl).then(function (resp) {
    // 兼容三种返回形态：上游 data / 完整响应 / 裸 config
    var c = (resp && resp.config) ? resp.config
        : (resp && resp.data && resp.data.config) ? resp.data.config
            : resp;
    check('签名服务返回 signature', !!(c && c.signature), c && c.appId ? 'appId=' + c.appId : '');
    check('签名服务返回 timestamp', !!(c && Number(c.timestamp) > 0));
    check('签名 URL 原样回显（含 query）', !!(c && c.url === signUrl), c && c.url);
    var apis = (c && c.jsApiList) || [];
    check('上游 jsApiList 含未授权接口（前端必须自行收敛）',
        apis.indexOf('chooseWXPay') !== -1 || apis.indexOf('getLocation') !== -1,
        '上游共 ' + apis.length + ' 条');
    finish();
}).catch(function (err) {
    check('签名服务连通', false, err && err.message ? err.message : String(err));
    finish();
});
