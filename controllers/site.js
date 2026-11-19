var async = require("async");//异步回调组件
var utils = require("util");//工具组件
var Site = require('./../models/Site.js');//site DAO接口和Model等
var User = require('./../models/User.js');
var cmsUtils = require('./cmsUtils.js');//自定义util工具
var filter = require('./../routes/filter');//用于更新后失效站点缓存

/**
 * 更新配置
 * @param req
 * @param res
 */
exports.update = function (req, res) {
    var name = (req.body.name || '').trim();
    var copyRight = (req.body.copyRight || '').trim();
    var icp = (req.body.icp || '').trim();
    var version = (req.body.version || '').trim();
    var phone = (req.body.phone || '').trim();
    var address = (req.body.address || '').trim();
    var statistical = req.body.statistical;
    // 分享封面：只接受 http(s) 且无危险字符的 URL，空则用站点默认
    var shareCoverRaw = (req.body.shareCover || '').trim();
    var shareCover = (/^https?:\/\//i.test(shareCoverRaw) && !/['"\\<>\s\u0000-\u001f]/.test(shareCoverRaw)) ? shareCoverRaw : '';

    // 风控告警配置（后台可改）。空值不覆盖 settings.js 的默认——由 services/alert.js 的 pick() 处理。
    var alertCfg = {
        enabled: req.body.alertEnabled !== undefined ? (req.body.alertEnabled === '1' || req.body.alertEnabled === 'true') : undefined,
        recipients: String(req.body.alertRecipients || '').trim(),
        throttleMinutes: (function () { var n = parseInt(req.body.alertThrottle, 10); return isFinite(n) && n >= 0 ? n : undefined; })(),
        realtime: req.body.alertRealtime !== undefined ? (req.body.alertRealtime === '1' || req.body.alertRealtime === 'true') : undefined,
        subjectPrefix: String(req.body.alertPrefix || '').trim().slice(0, 80),
        fromName: String(req.body.alertFromName || '').trim().slice(0, 80)
    };
    var msg = "";
    var success = false;
    var flag = false;//是否已发起回调
    if (name === "") {
        msg = "站点名称不能为空";
    } else if (copyRight === "") {
        msg = "版权不能为空";
    } else if (version === "") {
        msg = "版本号不能为空";
    } else {
        flag = true;
        var obj = {
            name: name,
            copyRight: copyRight,
            icp: icp,
            version: version,
            phone: phone,
            address: address,
            statistical: statistical,
            shareCover: shareCover,
            alert: alertCfg
        };
        Site.update(obj, function (err) {
            if (!err) {
                var session = req.session;
                session.site = obj;
                filter.reloadSiteCache();// 立刻让全局缓存失效，下次请求读取新配置
                success = true;
                msg = "配置更新成功";
            } else {
                console.log(err.message);
                msg = "配置更新失败";
            }
            res.json({'success': success, 'msg': msg});
        });
    }//end else
    if (!flag) {// no callback
        res.json({'success': success, 'msg': msg});
    }
};