/**
 * LINK ONE 开放平台 HTTP 客户端。
 *
 * 上游契约（实读 LINK ONE server 源码 + 线上 curl 实测，勿凭印象改写）：
 *   GET /api/auth/createToken?app_id={AppID}
 *       -> {code:1,show:0,msg:"",data:{token:"<32位16进制md5>",qrcodeUrl:"data:image/png;base64,..."}}
 *       -> {code:0,show:1,msg:"应用不存在或已被禁用",data:[]}
 *   GET /api/auth/status?token={token}
 *       -> {code:1,data:{status:"pending"|"expired"}}
 *       -> {code:1,data:{status:"confirmed",token:"<JWT>",userId,phone,isWhitelist}}
 *   GET /api/wechat/jsConfig?url={encodeURIComponent(当前页URL去#)}
 *       -> {code:1,data:{config:{appId,timestamp,nonceStr,signature,jsApiList,...}}}
 *
 * 实现约束：
 *   - 只用 Node 内置模块（https / http / url / crypto），零新增 npm 依赖。
 *   - 统一 8 秒超时（整体 + socket 空闲双保险）、响应体 <= 1MB。
 *   - 只接受 2xx + 合法 JSON + resp.code === 1，否则抛 Error（带上游 msg）。
 *   - AppSecret 从不进入 URL / 请求头 / 错误信息 / 日志；失败只留一条带关联 ID 的纯文本简报。
 *   - 对外 4 个方法一律返回 Promise。
 */
'use strict';

var https = require('https');
var http = require('http'); // 仅当 apiBase 被覆盖成 http://（内网 / 本地 mock）时选用，同为 Node 内置模块
var URLCtor = require('url').URL;
var crypto = require('crypto');

var TIMEOUT_MS = 8 * 1000;
var MAX_BODY_BYTES = 1024 * 1024; // 上游 qrcodeUrl 是 base64 data URI，必须封顶防内存被打满
var DEFAULT_API_BASE = 'https://ai.jiangzi.xin';

// ---------------------------------------------------------------------------
// 配置：环境变量 > settings.openPlatform > 内置默认
// ---------------------------------------------------------------------------
function normalizePhones(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (s) { return String(s).trim(); }).filter(Boolean);
}

function buildConfig() {
    var base = {};
    try {
        // settings.js 被 .gitignore 忽略；缺失时也不能让模块加载失败
        var settings = require('../settings');
        base = (settings && settings.openPlatform) || {};
    } catch (e) {
        base = {};
    }
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

// 契约要求 getConfig() 也返回 Promise；.sync 供 controller 做「未配置」同步短路，规则唯一不漂移。
function getConfig() {
    return Promise.resolve(buildConfig());
}
getConfig.sync = buildConfig;

// ---------------------------------------------------------------------------
// 通用请求
// ---------------------------------------------------------------------------
function scrub(text, secret) {
    var out = String(text == null ? '' : text);
    if (secret) out = out.split(secret).join('[REDACTED]');
    if (out.length > 300) out = out.slice(0, 300);
    return out;
}

function buildUrl(pathname, query, cfg) {
    var base = String(cfg.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
    var qs = Object.keys(query).map(function (k) {
        // 值一律 encodeURIComponent：jsConfig 的 url 内含 ? & = 等字符，不编码会截断上游 query。
        // 上游服务端内部会再做一次 urldecode，解码后即得到前端传入的原始字符串。
        return encodeURIComponent(k) + '=' + encodeURIComponent(String(query[k]));
    }).join('&');
    return new URLCtor(base + pathname + (qs ? '?' + qs : ''));
}

function request(pathname, query, cfg) {
    return new Promise(function (resolve, reject) {
        var reqId = crypto.randomBytes(6).toString('hex');
        var urlObj;
        try {
            urlObj = buildUrl(pathname, query, cfg);
        } catch (e) {
            return reject(new Error('开放平台地址配置无效'));
        }

        var transport = urlObj.protocol === 'http:' ? http : https;
        var settled = false;
        var chunks = [];
        var received = 0;
        var timer = null;
        var req = null;

        function finish(err, data) {
            if (settled) return;
            settled = true;
            if (timer) { clearTimeout(timer); timer = null; }
            if (err) {
                // 结构化简报：只带关联 ID / 路径 / 归一化原因，绝不带 AppSecret、JWT、完整 url
                console.warn('[openPlatform][' + reqId + '] ' + pathname + ' 失败: ' + scrub(err.message, cfg.appSecret));
                return reject(err);
            }
            resolve(data);
        }

        function abort(message) {
            finish(new Error(message));
            if (req) { try { req.destroy(); } catch (e) { /* 已断开 */ } }
        }

        try {
            req = transport.get(urlObj, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'NODELOG-OpenPlatform/1.0'
                }
            }, function (res) {
                var status = res.statusCode || 0;
                if (status < 200 || status >= 300) {
                    res.resume(); // 排空响应体，释放 socket
                    return abort('开放平台返回 HTTP ' + status);
                }
                res.on('data', function (chunk) {
                    if (settled) return; // 超限 / 超时后不再堆积数据
                    received += chunk.length;
                    if (received > MAX_BODY_BYTES) {
                        return abort('开放平台响应体超过 1MB 上限');
                    }
                    chunks.push(chunk);
                });
                res.on('end', function () {
                    if (settled) return;
                    var parsed;
                    try {
                        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    } catch (e) {
                        return finish(new Error('开放平台响应不是合法 JSON'));
                    }
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                        return finish(new Error('开放平台响应格式异常'));
                    }
                    if (parsed.code !== 1) {
                        return finish(new Error(scrub(parsed.msg, cfg.appSecret) || '开放平台返回失败'));
                    }
                    // data 原样返回，由 controller 决定如何包装
                    finish(null, parsed.data);
                });
                res.on('error', function (e) {
                    finish(new Error('开放平台响应读取失败: ' + scrub(e && e.message, cfg.appSecret)));
                });
            });
        } catch (e) {
            return finish(new Error('开放平台请求发起失败: ' + scrub(e && e.message, cfg.appSecret)));
        }

        // 整体 8s 硬超时：覆盖 DNS / 连接 / 首字节 / 慢速响应全过程
        timer = setTimeout(function () { abort('开放平台请求超时(8s)'); }, TIMEOUT_MS);
        // socket 空闲 8s 也直接断开，避免上游持续滴灌拖住请求
        req.setTimeout(TIMEOUT_MS, function () { abort('开放平台请求超时(8s)'); });

        req.on('error', function (e) {
            var msg = (e && e.message) ? e.message : '';
            if (/超时|timeout/i.test(msg)) return finish(new Error('开放平台请求超时(8s)'));
            finish(new Error('开放平台网络错误: ' + scrub(msg, cfg.appSecret)));
        });
    });
}

// ---------------------------------------------------------------------------
// 三个上游接口
// ---------------------------------------------------------------------------
function createToken() {
    var cfg = getConfig.sync();
    if (!cfg.appId || !cfg.appSecret) {
        return Promise.reject(new Error('未配置开放平台 AppID/AppSecret'));
    }
    return request('/api/auth/createToken', {app_id: cfg.appId}, cfg);
}

function getStatus(token) {
    var cfg = getConfig.sync();
    var value = String(token == null ? '' : token);
    if (!/^[a-f0-9]{32}$/.test(value)) {
        return Promise.reject(new Error('扫码 token 格式不正确'));
    }
    return request('/api/auth/status', {token: value}, cfg);
}

function getJsConfig(pageUrl) {
    var cfg = getConfig.sync();
    if (typeof pageUrl !== 'string' || !/^https?:\/\//i.test(pageUrl)) {
        return Promise.reject(new Error('url 必须是 http(s):// 开头的字符串'));
    }
    // 上游服务端会对收到的 url 参数做一次 urldecode。
    // 此处把「已解码的原始 URL 字符串」再 encodeURIComponent 拼进 query（见 buildUrl），
    // 上游解码后拿到的字符串与前端 location.href.split('#')[0] 完全一致。
    // url 内容本身不 trim、不改写、不去参数，原样透传。
    return request('/api/wechat/jsConfig', {url: pageUrl}, cfg);
}

module.exports = {
    getConfig: getConfig,
    createToken: createToken,
    getStatus: getStatus,
    getJsConfig: getJsConfig
};
