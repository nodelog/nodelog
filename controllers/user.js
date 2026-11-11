var bcrypt = require('bcryptjs');
var User = require('./../models/User.js');
var constants = require('./../models/constants.js');
var cmsUtils = require('./cmsUtils.js');
var getCount = function (callback) {
    User.getCount(function (err, total) {
        callback(err, total);
    });
};
exports.findByPage = function (req, res) {
    console.log("用户管理");
    if (req.session.user.role == 0) {
        getCount(function (err, total) {
            var pageObj = cmsUtils.page(req.query.page,total);
            var page = pageObj.page;
            var totalPage = pageObj.totalPage;
            if (!err && totalPage > 0) {
                User.findByPage(page, function (err, docs) {
                    res.render("manager/user", {docs: docs, title: "用户管理", page: page, totalPage: totalPage, url:"/manager/user?",currentMenu:"user"});
                });
            } else {
                console.log("data error");
                res.render("manager/user", {docs: {}, title: "用户管理", page: page, totalPage: totalPage,currentMenu:"user"});
            }
        });
    } else {
        res.render("manager/user", {docs: req.session.user, title: "用户管理",currentMenu:"user"});
    }
}


exports.update = function (req, res) {
    var current = req.session.user;
    if (!current) {
        return res.json({"result": false, "msg": "未登录"});
    }
    var isAdmin = current.role === 0;
    var targetId = req.body.id;
    // 非管理员只能修改自己的资料，禁止越权改他人
    if (!isAdmin && String(targetId) !== String(current._id)) {
        return res.json({"result": false, "msg": "只能修改自己的资料"});
    }
    User.findById(targetId, function (err, obj) {
        if (err || !obj) {
            console.log((err && err.message) || "user is not exists");
            return res.json({"result": false, "msg": "用户不存在"});
        }
        var status = req.body.status;
        var role = req.body.role;
        var userName = req.body.userName;
        var realName = req.body.realName;
        var email = req.body.email;
        var phone = req.body.phone;
        var password = req.body.password;
        // 仅管理员可变更角色 / 状态，杜绝普通用户自我提权为管理员
        if (isAdmin) {
            if (status) {
                if (status != constants.USER_ENABLE_STATUS && status != constants.USER_UNABLE_STATUS) {
                    status = constants.USER_ENABLE_STATUS;// 设置默认为可用。
                }
                obj.status = status;
            }
            if (role !== undefined && role !== null && role !== '') {
                obj.role = role;
            }
        }
        if (cmsUtils.isNotBlank(userName)) {
            obj.userName = userName;
        }
        if (cmsUtils.isNotBlank(realName)) {
            obj.realName = realName;
        }
        if (cmsUtils.isNotBlank(email)) {
            obj.email = email;
        }
        // 手机号：本人可填（用于微信扫码按手机号绑定），管理员可改任意用户。
        // 仅当显式提交非空手机号时才写入，留空不覆盖既有值。
        if (cmsUtils.isNotBlank(phone)) {
            obj.phone = String(phone).trim();
        }
        if (cmsUtils.isNotBlank(password)) {
            obj.password = encryption(password);
        }
        User.update(obj, function (err) {
            if (err) {
                console.log(err.message + "\n update user failure");
                res.json({"result": false});
            } else {
                console.log("update success");
                if (String(obj._id) === String(current._id)) {
                    req.session.user = obj;
                }
                res.json({"result": true});
            }
        });
    });
}
exports.delete = function (req, res) {
    var id = req.body.id;
    User.delete(id, function (err, ok) {
        if (!err && ok) {
            res.json({'success': true, 'msg': "删除成功"});
        } else {
            res.json({'success': false, 'msg': err ? "删除失败" : "用户不存在或已删除"});
        }
    });
}

var findUserByName = function (userName, callback) {
    User.findByName(userName, function (err, obj) {
        callback(err, obj);
    });
};

//register
exports.addUser = function (req, res) {

    //todo 暂停开放注册
    return res.json({'success': false, 'msg': '暂停开放注册'});

    var userName = (req.body.userName || '').trim();
    var password = (req.body.password || '').trim();
    var password2 = (req.body.password2 || '').trim();
    var msg = "";
    var success = false;
    var flag = false;//是否已发起回调
    if (userName == "") {
        msg = "用户名不能为空";
    } else if (password == "") {
        msg = "密码不能为空";
    } else if (password2 == "") {
        msg = "确认密码不能为空";
    } else if (password != password2) {
        msg = "两次密码不一致";
    } else {
        flag = true;
        findUserByName(userName, function (err, obj) {
            if (obj != null) {
                msg = "用户名已经存在";
                res.json({'success': success, 'msg': msg});
            } else {
                password = encryption(password);//加密
                obj = {"userName": userName,"realName": userName, "password": password};
                User.save(obj, function (err) {
                    if (!err) {
                        success = true;
                        msg = "注册成功，请登录";
                    } else {
                        console.log(err.message);
                        msg = "注册失败，请重试";
                    }
                    console.log("result:" + success);
                    res.json({'success': success, 'msg': msg});
                });
            }
        });
    }//end else
    if (!flag) {// no callback
        res.json({'success': success, 'msg': msg});
    }
};

//login
exports.login = function (req, res) {
    var body = req.body || {};
    var userName = body.userName ? String(body.userName).trim() : '';
    var password = body.password ? String(body.password).trim() : '';
    var msg = "";
    var success = false;

    if (userName !== "nodelog") {
        // 注：当前站点对登录做了限制（除 nodelog 外一律拒绝）。若需开放普通账号登录，请移除/调整此判断。
        return res.json({'success': false, 'msg': '暂停开放登录'});
    }

    var flag = false;//是否已发起回调
    if (userName == "") {
        return res.json({'success': false, 'msg': "用户名不能为空"});
    } else if (password == "") {
        return res.json({'success': false, 'msg': "密码不能为空"});
    } else {
        flag = true;
        findUserByName(userName, function (err, obj) {
//            if (obj.status == 1) {
//                obj = null;
//            }
            if (obj != null) {
                if(bcrypt.compareSync(password, obj.password)){
                    success = true;
                    msg = "登录成功";
                    var session = req.session;
                    session.user = obj;
		    console.log("login success----------");
                } else {
                    msg = "密码错误";
		    console.log("login failure----------- ");
                }
            } else {
                msg = "用户不存在";
            }
            res.json({'success': success, 'msg': msg, 'obj': obj});
        });

    }
    if (!flag) {// no callback
        res.json({'success': success, 'msg': msg});
    }
};
exports.logout = function (req, res) {
    req.session.user = null;
    // 同时清掉微信扫码登录写入的 30 天凭证 cookie，
    // 否则本地账号登出后 restoreUser 中间件仍会据该 cookie 把登录态恢复回来。
    // 关键：clearCookie 的选项必须与设置时完全一致（path/httpOnly/sameSite/secure），
    // 否则生产环境（HTTPS + NODE_ENV=production，cookie 为 Secure）浏览器会忽略清除指令，
    // cookie 残留 → 下次请求被 restoreUser 重新登录 → 表现为「退出没用」。
    res.clearCookie('nl_open_jwt', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
    });
    res.json({sucess: true});
};

exports.session = function (req, res) {
    var user = req.session.user;
    res.json({user: user});
}

//加密
function encryption(password){
    var salt = bcrypt.genSaltSync(10);
    password = bcrypt.hashSync(password, salt);//加密
    return password;
}