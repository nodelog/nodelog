var async = require("async");
var utils = require("util");
var Comment = require('./../models/Comment.js');
var Content = require('./../models/Content.js');
var User = require('./../models/User.js');
var cmsUtils = require('./cmsUtils.js');
var getCount = function (callback) {
    Comment.getCount(function (err, total) {
        callback(err, total);
    });
};
var getCountByContent = function (content, callback) {
    Comment.getCountByContent(content, function (err, total) {
        callback(err, total);
    });
};

exports.findByPageAndContent = function (req, res) {
    var contentId, total = 0, page = 0, totalPage = 0, docs = null;
    async.auto({
        getContentById: function (callback, results) {
            var id = req.query.cententId;
            Content.findById(id, function (err, obj) {
                cententId = obj._id;
                callback(null);
            });
        },
        totalCount: ["getContentById", function (callback, results) {
            getCountByContent(cententId, function (err, count) {
                total = count;
                callback(null);
            });
        }],
        pageDocs: ["totalCount", function (callback, results) {
            var pageObj = cmsUtils.page(req.query.page,total);
            page = pageObj.page;
            totalPage = pageObj.totalPage;
            if (totalPage > 0) {
                Comment.findByContent(page, cententId, function (err, objects) {
                    docs = objects;
                    callback(null);
                });
            } else {
                callback(null);
            }
        }],
        initUser: ["pageDocs", function (callback, results) {
            if (docs != null) {
                var count = 0;
                async.whilst(//sync floor
                    function () {
                        return count < docs.length
                    },
                    function (callbackThis) {
                        var doc = docs[count];
                        User.findById(doc.commenter, function (err, obj) {
                            if (obj != null) {
                                doc.userName = obj.realName;
                            } else {
                                console.log(doc.name + "'s user not found");
                                doc.userName = "未知";//
                            }
                            doc.createTime = doc.createTime.toLocaleString();
                            console.log(doc.createTime);
                            count++;
                            callbackThis();
                        });
                    },
                    function (err) {
                        callback(err);
                    }
                );
            } else {
                callback(null);
            }
        }]
    }, function (err, results) {
        res.json({docs: docs, page: page, totalPage: totalPage, total: total, result: true});
    });

};


exports.delete = function (req, res) {
    var id = req.body.id;
    Comment.delete(id, function (err) {
        if (!err) {
            res.json({'success': true, 'msg': "删除成功"});
        } else {
            res.json({'success': false, 'msg': "删除失败"});
        }
    });
};

exports.findById = function (req, res) {
    var id = req.query.id;
    var view = req.query.view;
    var doc = null;
    async.auto({
        getComment: function (callback, results) {
            Comment.findById(id, function (err, obj) {
                if (!err) {
                    doc = obj;
                } else {
                    console.log("data err");
                }
                callback(null);
            });
        },
        initUser: ["getComment", function (callback, results) {
            if (doc != null) {
                User.findById(doc.author, function (err, obj) {
                    if (obj != null) {
                        doc.userName = obj.userName;
                    } else {
                        console.log(doc.name + "'s user not found");
                        doc.userName = "未知";//
                    }
                    callback(null);
                });
            } else {
                callback(null);
            }
        }],
        initCategory: ["initUser", function (callback, results) {
            if (doc != null) {
                Category.findById(doc.category, function (err, obj) {
                    if (obj != null) {
                        doc.categoryName = obj.name;
                    } else {
                        console.log(doc.name + "'s user not found");
                        doc.categoryName = "未知";//
                    }
                    callback(null);
                });
            } else {
                callback(null);
            }
        }]
    }, function (err, results) {
        res.render(view, {doc: doc, title: doc != null ? doc.name : "Comment not found"});
    });
};

var findByName = function (name, callback) {
    Comment.findByName(name, function (err, obj) {
        callback(err, obj);
    });
};
//add
exports.add = function (req, res) {
    var id = req.body.id;
    var contentId = req.body.contentId;
    var comment = req.body.comment.trim();
    var msg = "";
    var success = false;
    var falg = false;//callback
    if (comment === "") {
        msg = "评论内容不能为空";
    } else {
        flag = true;
        if (id == null) {//add
            var session = req.session;
            var obj = {
                "comment": comment,
                "commenter": session.user._id,
                "content": contentId
            };
            Comment.save(obj, function (err) {
                if (!err) {
                    success = true;
                    msg = "评论成功";
                } else {
                    console.log(err.message);
                    msg = "评论失败";
                }
                res.json({'success': success, 'msg': msg});
            });
        } else {//update
            var obj = {
                "id": id,
                "comment": comment
            };
            Comment.update(obj, function (err) {
                if (!err) {
                    success = true;
                    msg = "Edit Comment is success";
                    console.log("success");
                } else {
                    console.log(err.message);
                    msg = "Edit Comment is failure";
                }
                res.json({'success': success, 'msg': msg, 'id': obj.id});
            });
        }
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
        msg = "Comment Name is empty";
    } else {
        flag = true;
        findByName(name, function (err, obj) {
            if (obj != null) {
                msg = "Comment Name is exists";
                res.json({'success': success, 'msg': msg});
            } else {
                Comment.update(id, name, function (err) {
                    if (!err) {
                        success = true;
                        msg = "Modify Comment is success";
                    } else {
                        console.log(err.message);
                        msg = "Modify Comment is failure";
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


