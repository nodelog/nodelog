var async = require("async");
var utils = require("util");
var Log = require('./../models/Log.js');
var cmsUtils = require('./cmsUtils.js');
var getCount = function (callback) {
    Log.getCount(function (err, total) {
        callback(err, total);
    });
};
exports.logCount = function(req, res) {
    getCount(function(err, count) {
        res.json({count:count});
    });
}
exports.findByPage = function (req, res) {
    var total = 0, page = 0, totalPage = 0, docs = {};
    async.auto({
        totalCount: function (callback, results) {
            getCount(function (err, count) {
                total = count;
                callback(null);
            });
        },
        pageDocs: ["totalCount", function (callback, results) {
            var pageObj = cmsUtils.page(req.query.page, total);
            page = pageObj.page;
            totalPage = pageObj.totalPage;
            if (totalPage > 0) {
                Log.findByPage(page, function (err, objects) {
                    docs = objects;
                    callback(null);
                });
            } else {
                callback(null);
            }
        }]
    }, function (err, results) {
        var view = req.query.view;
        var title = "系统公告";
        if (view.indexOf("manager")) {
            title = "公告管理";
        }
        res.render(view, {docs: docs, title: title, page: page, totalPage: totalPage, total: total, url:"/"+view+"?view="+view+"&",currentMenu:"log"});
    });

};


exports.delete = function (req, res) {
    var id = req.body.id;
    Log.delete(id, function (err) {
        if (!err) {
            res.json({'success': true, 'msg': "删除成功"});
        } else {
            res.json({'success': false, 'msg': "删除失败"});
        }
    });
};

exports.findById = function (req, res) {
    var id = req.query.id;
    var doc = {};
    Log.findById(id, function (err, obj) {
        if (!err) {
            doc = obj;
        } else {
            console.log("data err");
        }
        var view = req.query.view;
        res.render(view,{title:doc.name,doc:doc});
    });
};

var findByName = function (name, callback) {
    Log.findByName(name, function (err, obj) {
        callback(err, obj);
    });
};
exports.add = function (req, res) {
    var id = req.body.id;
    var name = req.body.name.trim();
    var oldName = req.body.oldName;
    var content = req.body.content;
    var msg = "";
    var success = false;
    var falg = false;//callback
    if (name === "") {
        msg = "标题不能为空";
    } else if (content === "") {
        msg = "内容不能为空";
    } else {
        flag = true;
        findByName(name, function (err, obj) {
            msg = "已存在该标题的公告";
            if (id == null) {//add
                if (obj !== null) {
                    res.json({'success': success, 'msg': msg});
                } else {
                    var session = req.session;
                    obj = {
                        "name": name,
                        "content": content
                    };
                    Log.save(obj, function (err) {
                        if (!err) {
                            success = true;
                            msg = "发布公告成功";
                        } else {
                            console.log(err.message);
                            msg = "发布公告失败";
                        }
                        res.json({'success': success, 'msg': msg});
                    });
                }
            } else {//update
                if (obj !== null && obj.name != oldName) {
                    res.json({'success': success, 'msg': msg});
                } else {
                    obj = {
                        "_id": id,
                        "name": name,
                        "content": content
                    };
                    Log.update(obj, function (err) {
                        if (!err) {
                            success = true;
                            msg = "编辑公告成功";
                            console.log("success");
                        } else {
                            console.log(err.message);
                            msg = "编辑公告失败";
                        }
                        res.json({'success': success, 'msg': msg, 'id': obj.id});
                    });
                }
            }
        });
    }//end else
    if (!flag) {// no callback
        res.json({'success': success, 'msg': msg});
    }
};
//update
exports.update = function (req, res) {
    var id = req.body.id;
    var name = req.body.name.trim();
    var msg = "";
    var success = false;
    var falg = false;//callback
    if (name == "") {
        msg = "Log Name is empty";
    } else {
        flag = true;
        findByName(name, function (err, obj) {
            if (obj != null) {
                msg = "Log Name is exists";
                res.json({'success': success, 'msg': msg});
            } else {
                Log.update(id, name, function (err) {
                    if (!err) {
                        success = true;
                        msg = "Modify Log is success";
                    } else {
                        console.log(err.message);
                        msg = "Modify Log is failure";
                    }
                    res.json({'success': success, 'msg': msg});
                });
            }
        });
    }//end else
    if (!flag) {// no callback
        res.json({'success': success, 'msg': msg});
    }
};