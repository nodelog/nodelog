var async = require("async");
var utils = require("util");
var Comment = require('./../models/Comment.js');
var Content = require('./../models/Content.js');
var User = require('./../models/User.js');
var cmsUtils = require('./cmsUtils.js');
var settings = require('./../settings');

var mailer        = require('nodemailer');
var transport = mailer.createTransport({
    host: settings.email.host,
    port: settings.email.port,
    secure: settings.email.secure,
    auth: {
        user: settings.email.user,
        pass: settings.email.pass
    }
});

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
    // 同时兼容前端历史拼写 cententId 与规范 contentId
    var contentId = req.query.contentId || req.query.cententId, total = 0, page = 0, totalPage = 0, docs = null;
    if (!contentId) {
        return res.json({docs: [], page: 1, totalPage: 0, total: 0, result: true});
    }
    async.auto({
        totalCount: function (callback, results) {
            getCountByContent(contentId, function (err, count) {
                total = count;
                callback(null);
            });
        },
        pageDocs: ["totalCount", function (callback, results) {
            var pageObj = cmsUtils.page(req.query.page,total);
            page = pageObj.page;
            totalPage = pageObj.totalPage;
            if (totalPage > 0) {
                Comment.findByContent(page, contentId, function (err, objects) {
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
                                doc.userName = obj.realName || obj.userName;
                            } else {
                                doc.userName = "未知";//
                            }
                            doc.createTime = doc.createTime ? doc.createTime.toLocaleString() : '';
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
    if (!view) {
        view = (req.path.indexOf('/manager') === 0) ? 'manager/commentDetail' : 'commentDetail';
    }
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
// 去除 HTML 标签与控制字符并裁掉两端空白；评论按纯文本处理，避免存储型 XSS
function cleanComment(s) {
    return String(s == null ? '' : s)
        .replace(/<[^>]*>/g, '')            // 去掉 <script>/<img onerror> 等标签
        .replace(/[\u0000-\u001F\u007F]/g, '') // 去掉控制字符
        .trim();
}

exports.add = function (req, res) {
    var id = req.body.id;
    var contentId = req.body.contentId;
    var name = req.body.name;
    var email = req.body.email;
    var comment = cleanComment(req.body.comment);
    var msg = "";
    var success = false;
    var flag = false;//是否已发起回调
    if (comment === "") {
        msg = "评论内容不能为空";
    } else if (comment.length > 2000) {
        msg = "评论内容过长，最多 2000 字";
    } else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg = "邮箱格式不正确";
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
                //发送邮件
                if(email){
                    var detailLink = 'https://blog.jiangzi.xin/content/detail?id='+contentId+'&view=contentDetail';
                    var _html = '<b style="color: #222222;">'+session.user.realName + '</b>:';
                    _html += '评论了您的文章<b style="color: #2a6496;"><a href=\"'+detailLink+'\">《'+name+'》</a></b><br/>';
                    _html += '评论内容：<b style="color: #222222;">'+comment+'</b><br/>';
                    _html += '<b style="color: #2a6496;"><a href=\"'+detailLink+'\">点击查看详情</a></b>';
                    var mailOptions = {
                        from: session.site.name + ' <'+settings.email.user+'>', // 如果不加<xxx@xxx.com> 会报语法错误
                        to: email, // list of receivers
                        subject: session.user.realName + '评论了您的文章《'+name+'》', // Subject line
                        html: _html
                    };
                    transport.sendMail(mailOptions, function(err, info){
                        if(err){
                            console.log(err);
                        }else{
                            console.log('Message sent: ' + info.response);
                        }
                    });
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
    var flag = false;//是否已发起回调
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