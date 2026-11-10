var User = require('./../models/User');
var Site = require('./../models/Site');
//验证用户登录
exports.authorize = function (req, res, next) {
    if (!req.session.user) {
        res.redirect('/');
    } else {
        next();
    }
};
//验证是否是管理员
exports.authorizeAdmin = function (req, res, next) {
    if (!req.session.user) {
        res.redirect('/');
    } else if (req.session.user.role != 0) {
	    res.redirect('/manager');
    } else {
        next();
    }
};
//初始化网站配置信息
exports.initSite = function (req, res, next) {
    if(!req.session.site){//session不存在
        Site.findOne(function (err, obj) { //查询site
            if (err) {
                console.error('[initSite] 读取站点配置失败：', err.message);
                return next(); // 不阻塞请求，使用默认值继续
            }
            if (obj == null) {//不存在创建新的
                obj = {
                    name: "NODELOG",
                    copyRight: "王亚超",
                    icp: "闽ICP备15004025号",
                    version: "1.0",
                    phone: "13030840306",
                    address: "福建厦门"
                };
                Site.save(obj,function (err) {
                    if (err) {
                        console.error('[initSite] 创建站点配置失败：', err.message);
                    } else {
                        console.log("添加site完成");
                    }
                    next();
                });
            } else { //把网站配置加入session
                var session = req.session;
                session.site = obj;
                next();
            }
        });
    } else {
        next();
    }
};
//获取日期（统一使用 cmsUtils 提供的 Date.prototype.format，避免重复实现）
exports.log = function(req, res){
    console.log("==============================================================");
	console.log("current request time:\t"+new Date().format("yyyy-MM-dd hh:mm:ss"));
    // var _ip = req.headers['x-forwarded-for'] ||
    //     req.connection.remoteAddress ||
    //     req.socket.remoteAddress ||
    //     req.connection.socket.remoteAddress;
    var _ip = req.query._ip;
    console.log("request ip address:");
    console.log(_ip);
    console.log("==============================================================");
	res.json({});

};

 
    


