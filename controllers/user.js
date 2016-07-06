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
    var id = req.body.id;
    var status = req.body.status;
    var role = req.body.role;
    console.log(role+" role number");
    var userName = req.body.userName;
    var realName = req.body.realName;
    var password = req.body.password;
    User.findById(id, function (err, obj) {
        if (!err) {
            if (status) {
                if (status != constants.USER_ENABLE_STATUS && status != constants.USER_UNABLE_STATUS) {
                    status = constants.USER_ENABLE_STATUS;// 设置默认为可用。
                }
                obj.status = status;
            }
            if (role) {
                obj.role = role;
                console.log(role+"new role number");
            }
            if (cmsUtils.isNotBlank(userName)) {
                obj.userName = userName;
            }
            if (cmsUtils.isNotBlank(realName)) {
                obj.realName = realName;
            }
            if (cmsUtils.isNotBlank(password)) {
                obj.password = encryption(password);
            }
            User.update(obj, function (err) {
                if (err) {
                    console.log(err.message + "\n update user failure");
                    res.json({"result":false});
                }else{
                    console.log("update success");
                    if(obj._id==req.session.user._id) {
                            req.session.user = obj;
                    }
                    res.json({"result":true});
                }
            });
        } else {
            console.log(err.message + "\n user is not exists");
            res.json({"result":false});
        }
    });
}
exports.delete = function (req, res) {
    var id = req.body.id;
    User.delete(id, function (err) {
        if (!err) {
            res.json({'success': true, 'msg': "删除成功"});
        } else {
            res.json({'success': false, 'msg': "删除失败"});
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
    var userName = (req.body.userName).trim();
    var password = (req.body.password).trim();
    var password2 = (req.body.password2).trim();
    var msg = "";
    var success = false;
    var falg = false;//callback
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
    console.log( encryption("jackWANG802"));
    var userName = (req.body.userName).trim();
    var password = (req.body.password).trim();
    var msg = "";
    var success = false;
    var falg = false;//callback
    if (userName == "") {
        msg = "用户名不能为空";
    } else if (password == "") {
        msg = "密码不能为空";
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