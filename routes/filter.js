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
// 同源请求（浏览器自动带 Origin/Referer 且 host 一致）或缺少来源头的请求（同源表单/服务端调用）一律放行，无需前端改造。
exports.csrfGuard = function (req, res, next) {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].indexOf(req.method) === -1) {
        return next();
    }
    var host = req.headers.host;
    var origin = req.headers.origin;
    var referer = req.headers.referer;
    if (!origin && !referer) {
        return next();
    }
    function sameOrigin(u) {
        try {
            return new URL(u).host === host;
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
