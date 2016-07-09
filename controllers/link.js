var async = require("async");//异步回调组件
var utils = require("util");//工具组件
var Link = require('./../models/Link.js');//link DAO接口和Model等
var User = require('./../models/User.js');
var cmsUtils = require('./cmsUtils.js');//自定义util工具

/**
 * 更新
 * @param req
 * @param res
 */
exports.update = function (req, res) {
    var id = req.body.id;
    var name = req.body.name.trim();
    var name = req.body.name.trim();
    var url = req.body.url.trim();
    var blank = req.body.blank.trim();
    var msg = "";
    var success = false;
    var falg = false;//callback
    if (name === "") {
        msg = "名称不能为空";
    } else if (url === "") {
        msg = "链接地址不能为空";
    } else {
        flag = true;
        var obj = {
            id: id,
            name: name,
            url: url,
            blank: blank
        };
        Link.update(obj, function (err) {
            if (!err) {
                success = true;
                msg = "更新成功";
            } else {
                console.log(err.message);
                msg = "更新失败";
            }
            res.json({'success': success, 'msg': msg});
        });
    }//end else
    if (!flag) {// no callback
        res.json({'success': success, 'msg': msg});
    }
};
exports.save = function (req, res) {
    var name = req.body.name.trim();
    var url = req.body.url.trim();
    var blank = req.body.blank.trim();
    var msg = "";
    var success = false;
    var falg = false;//callback
    if (name === "") {
        msg = "名称不能为空";
    } else if (url === "") {
        msg = "链接地址不能为空";
    } else {
        flag = true;
        var obj = {
            name: name,
            url: url,
            blank: blank
        };
        Link.save(obj, function (err) {
            if (!err) {
                success = true;
                msg = "保存成功";
            } else {
                console.log(err.message);
                msg = "保存失败";
            }
            res.json({'success': success, 'msg': msg});
        });
    }//end else
    if (!flag) {// no callback
        res.json({'success': success, 'msg': msg});
    }
};

exports.delete = function (req, res) {
    var id = req.body.id;
    Link.delete(id, function (err) {
        if (!err) {
            res.json({'success': true, 'msg': "删除成功"});
        } else {
            res.json({'success': false, 'msg': "删除失败"});
        }
    });
};