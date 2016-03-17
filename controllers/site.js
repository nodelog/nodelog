var async = require("async");//异步回调组件
var utils = require("util");//工具组件
var Site = require('./../models/Site.js');//site DAO接口和Model等
var User = require('./../models/User.js');
var cmsUtils = require('./cmsUtils.js');//自定义util工具
var sessionUser;//

/**
 *
 * @param req
 * @param res
 */
exports.update = function (req, res) {
    var id = req.body.id;
    var name = req.body.name.trim();
    var copyRight = req.body.copyRight.trim();
    var icp = req.body.icp.trim();
    var version = req.body.version.trim();
    var phone = req.body.phone.trim();
    var address = req.body.address.trim();
    var msg = "";
    var success = false;
    var falg = false;//callback
    if (name === "") {
        msg = "站点名称不能为空";
    } else if (copyRight === "") {
        msg = "版权不能为空";
    } else if (version === "") {
        msg = "版本号不能为空";
    } else {
        flag = true;
        var obj = {
            id: id,
            name: name,
            copyRight: copyRight,
            icp: icp,
            version: version,
            phone: phone,
            address: address
        };
        Site.update(obj, function (err) {
            if (!err) {
                success = true;
                msg = "Modify  is success";
            } else {
                console.log(err.message);
                msg = "Modify  is failure";
            }
            res.json({'success': success, 'msg': msg});
        });
    }//end else
    if (!flag) {// no callback
        res.json({'success': success, 'msg': msg});
    }
};