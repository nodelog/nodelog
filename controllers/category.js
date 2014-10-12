var Category = require('./../models/Category.js');
var cmsUtils = require('./cmsUtils.js');
var Content = require('./../models/Content.js');
var getCount = function (callback) {
    Category.getCount(function (err, total) {
        callback(err, total);
    });
};
exports.findByPage = function (req, res) {
    getCount(function (err, total) {
        var pageObj = cmsUtils.page(req.query.page,total);
        var page = pageObj.page;
        var totalPage = pageObj.totalPage;
        if (!err && totalPage > 0) {
            Category.findByPage(page, function (err, docs) {
                res.render("manager/category", {docs: docs, title: "分类管理", page: page, totalPage: totalPage, url:"/manager/category?"});
            });
        } else {
            console.log("data error");
            res.render("manager/category", {docs: {}, title: "分类管理", page: page, totalPage: totalPage});
        }
    });
}


exports.delete = function (req, res) {
    var id = req.body.id;
    Content.getCountByCategoryOnly(id,function(err,count){
    var result,msg;
        if(count <= 0) {
            Category.delete(id, function (err) {
                if (!err) {
                    result = true;
                    msg = "删除成功";
                } else {
                    result = false;
                    msg = "删除失败";
                }
                res.json({'success': result, 'msg': msg});
            });
        }else{
            result = false;
            msg = "此类别被使用，无法删除";
            res.json({'success': result, 'msg': msg});
        }

    });

}
exports.findAll = function (req, res) {
    Category.findAll(function (err, docs) {
        if (!err) {
            res.json({docs: docs});
        } else {
            console.log(err.message+"\n category load failure");
            res.json({docs:{}});
        }
//        var type = req.query.type;
//        if (type === "json") {
//            res.json({docs: docs});
//        } else {
//            if (!err) {
//                var view = req.query.view;
//                res.render(view, {docs: docs, title: view});
//            } else {
//                res.redirect("/index");
//            }
//        }
    });
}

var findByName = function (name, callback) {
    Category.findByName(name, function (err, obj) {
        callback(err, obj);
    });
};
//add
exports.add = function (req, res) {
    var name = req.body.name.trim();
    var msg = "";
    var success = false;
    var falg = false;//callback
    if (name == "") {
        msg = "分类名称不能为空";
    } else {
        flag = true;
        findByName(name, function (err, obj) {
            if (obj != null) {
                msg = "分类已经存在";
                res.json({'success': success, 'msg': msg});
            } else {
                obj = {"name": name, "createTime": new Date(), "modifyTime": new Date()};
                Category.save(obj, function (err) {
                    if (!err) {
                        success = true;
                        msg = "添加分类成功";
                    } else {
                        console.log(err.message);
                        msg = "添加分类失败";
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
//update
exports.update = function (req, res) {
    var id = req.body.id;
    var name = req.body.name.trim();
    var msg = "";
    var success = false;
    var falg = false;//callback
    if (name == "") {
        msg = "分类名称不能为空";
    } else {
        flag = true;
        findByName(name, function (err, obj) {
            if (obj != null && obj.name != name) {
                msg = "分类名称已经存在";
                res.json({'success': success, 'msg': msg});
            } else {
                Category.update(id, name, function (err) {
                    if (!err) {
                        success = true;
                        msg = "修改分类成功";
                    } else {
                        console.log(err.message);
                        msg = "修改分类失败";
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