var User = require('./../models/User');
var Site = require('./../models/Site');

// 站点配置的应用级缓存：避免每个新会话都读一次 MongoDB，多个用户共享同一份配置。
var siteCache = { value: null, expires: 0 };
var SITE_TTL = 5 * 60 * 1000; // 5 分钟

// 供 site.update 在保存成功后立刻失效缓存
exports.reloadSiteCache = function () {
    siteCache.value = null;
    siteCache.expires = 0;
};

// 未登录 / 无权限时如何回应：浏览器页面跳转，API/JSON 请求返回 401（不再 302 到首页导致前端拿不到错误）
function deny(req, res) {
    if (req.method === 'GET') {
        var fallback = (req.originalUrl && req.originalUrl.indexOf('/manager') === 0) ? '/manager' : '/';
        return res.redirect(fallback);
    }
    return res.status(401).json({ success: false, msg: '未登录或无权限' });
}

//验证用户登录
exports.authorize = function (req, res, next) {
    if (!req.session.user) {
        return deny(req, res);
    }
    next();
};
//验证是否是管理员
exports.authorizeAdmin = function (req, res, next) {
    if (!req.session.user) {
        return deny(req, res);
    }
    if (req.session.user.role !== 0) {
        return deny(req, res);
    }
    next();
};

//初始化网站配置信息（带应用级缓存）
exports.initSite = function (req, res, next) {
    var now = Date.now();
    function apply(siteObj) {
        req.session.site = siteObj;
        next();
    }
    if (siteCache.value && siteCache.expires > now) {
        return apply(siteCache.value);
    }
    Site.findOne(function (err, obj) {
        if (err) {
            console.error('[initSite] 读取站点配置失败：', err.message);
            return next(); // 不阻塞请求，使用默认值继续
        }
        if (obj == null) { //不存在创建新的
            obj = {
                name: "NODELOG",
                copyRight: "王亚超",
                icp: "闽ICP备15004025号",
                version: "1.0",
                phone: "13030840306",
                address: "福建厦门"
            };
            Site.save(obj, function (err) {
                if (err) {
                    console.error('[initSite] 创建站点配置失败：', err.message);
                } else {
                    console.log("添加site完成");
                    siteCache.value = obj;
                    siteCache.expires = Date.now() + SITE_TTL;
                }
                apply(obj);
            });
        } else { //把网站配置加入 session
            siteCache.value = obj;
            siteCache.expires = Date.now() + SITE_TTL;
            apply(obj);
        }
    });
};

// CSRF 同源校验：仅拦截「跨站」的状态变更请求（POST/PUT/DELETE/PATCH）。
// 兼容反向代理（nginx/宝塔）：上游 req.headers.host 常为内网地址（如 127.0.0.1:3000），
// 而浏览器 AJAX 会自动携带 Origin/Referer（公网域名）。若直接用 host 比对，会把所有同源 POST 误判为非法（403），
// 导致登录/评论/发文/后台全部失效。因此「自身域名」取 [配置白名单 settings.siteHost, X-Forwarded-Host, Host] 的并集，任一匹配即放行。
function loadSiteHost() {
    try {
        return require('./../settings').siteHost || process.env.SITE_HOST;
    } catch (e) {
        return process.env.SITE_HOST;
    }
}
function selfHostCandidates(req) {
    var list = [];
    var cfg = loadSiteHost();
    if (cfg) {
        String(cfg).split(',').forEach(function (h) {
            h = (h || '').trim();
            if (h) list.push(h);
        });
    }
    // 兜底默认域名（已知公网域名），确保未配置 settings.siteHost 时同源 AJAX 也能放行
    ['blog.jiangzi.xin', 'www.blog.jiangzi.xin', 'nodelog.cn', 'www.nodelog.cn'].forEach(function (h) {
        if (list.indexOf(h) === -1) list.push(h);
    });
    if (req.headers['x-forwarded-host']) list.push(req.headers['x-forwarded-host']);
    if (req.headers.host) list.push(req.headers.host);
    return list;
}
exports.csrfGuard = function (req, res, next) {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].indexOf(req.method) === -1) {
        return next();
    }
    // 开放文章/公告发布 API 使用无状态 Token 鉴权（Authorization / X-API-Token），
    // 不依赖 cookie/session，不存在 CSRF 风险。带 token 的这些路径直接放行，
    // 鉴权与限流由 articleApi.auth / announcementApi.auth 负责；其余接口仍受同源校验保护。
    var p = req.path || '';
    var isOpenApi = p.indexOf('/api/articles') === 0 || p.indexOf('/api/categories') === 0
        || p.indexOf('/api/announcements') === 0;
    if (isOpenApi && (req.headers['authorization'] || req.headers['x-api-token'])) {
        return next();
    }
    var origin = req.headers.origin;
    var referer = req.headers.referer;
    if (!origin && !referer) {
        return next();
    }
    var hosts = selfHostCandidates(req);
    function sameOrigin(u) {
        try {
            return hosts.indexOf(new URL(u).host) !== -1;
        } catch (e) {
            return false;
        }
    }
    if (origin && !sameOrigin(origin)) {
        return res.status(403).json({ success: false, msg: '非法请求来源' });
    }
    if (referer && !sameOrigin(referer)) {
        return res.status(403).json({ success: false, msg: '非法请求来源' });
    }
    next();
};
