var async = require("async");
var utils = require("util");
var Comment = require('./../models/Comment.js');
var Content = require('./../models/Content.js');
var User = require('./../models/User.js');
var cmsUtils = require('./cmsUtils.js');
var kit = require('./adminKit'); // 后台 delete/audit 统一工具（DEF-001：原缺失导致 /manager/comment/delete 500）
var guard = require('./moderation/moderationGuard');
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
    var chk = kit.requireId(req.body.id);
    if (!chk.ok) return res.status(400).json({'success': false, 'msg': '参数错误'});
    Comment.delete(chk.id, function (err) {
        var ok = !err;
        kit.audit(req, {action: 'delete', target: 'comment', objectId: [chk.id],
            detail: 'changed:status', result: ok}, function () {
            if (ok) res.json({'success': true, 'msg': "删除成功"});
            else res.json({'success': false, 'msg': "删除失败"});
        });
    });
};

// 字段错位修复（B13/F01）：schema 是 comment/commenter/content，不是 name/author/category；
// 原代码还 require 了一个不存在的 Category → 详情必 500。改为转 POJO 后查评论人与所属文章标题。
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
                if (!err && obj) doc = (obj.toObject ? obj.toObject() : obj);
                callback(null);
            });
        },
        initUser: ["getComment", function (callback, results) {
            if (doc != null && doc.commenter) {
                User.findById(doc.commenter, function (err, obj) {
                    doc.userName = obj ? (obj.realName || obj.userName) : "未知";
                    callback(null);
                });
            } else { if (doc) doc.userName = doc.userName || "未知"; callback(null); }
        }],
        initContent: ["initUser", function (callback, results) {
            if (doc != null && doc.content) {
                Content.findById(doc.content, function (err, obj) {
                    doc.contentName = (obj && obj.name) || "未知";
                    callback(null);
                });
            } else { if (doc) doc.contentName = "未知"; callback(null); }
        }]
    }, function (err, results) {
        if (doc == null) { res.redirect('/error'); return; }
        res.render(view, {doc: doc, title: doc.comment ? String(doc.comment).slice(0, 40) : "评论详情"});
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
        // W3+W4（§5.3）：cleanComment + 长度/邮箱校验之后、写分支之前【一处】前置守卫，
        // 同时覆盖新增/带 id 编辑两分支。命中即早返回：Comment.save/update 与邮件（sendMail）全不可达。
        guard.enforce(req, {comment: comment}, 'comment', function (gErr, verdict) {
            function reject(m) {
                // §5.6：新增分支失败键 {success,msg}；带 id 编辑分支失败键 {success,msg,id}（带原 id）。
                return (id == null) ? res.json({'success': false, 'msg': m})
                                    : res.json({'success': false, 'msg': m, 'id': id});
            }
            if (gErr) {
                var n = kit.normalizeDaoError(gErr, 'comment.guard');
                return res.status(n.status).json(id == null ? {'success': false, 'msg': n.msg}
                                                          : {'success': false, 'msg': n.msg, 'id': id});
            }
            if (!verdict.allowed) return reject(verdict.msg);

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
                    //发送邮件（守卫命中时本回调整体不可达 → 零邮件）
                    if(email){
                        var detailLink = 'https://blog.jiangzi.xin/content/detail?id='+contentId+'&view=contentDetail';
                        var _html = '<b style="color: #222222;">'+session.user.realName + '</b>:';
                        _html += '评论了您的文章<b style="color: #2a6496;"><a href=\"'+detailLink+'\">《'+name+'》</a></b><br/>';
                        _html += '评论内容：<b style="color: #222222;">'+comment+'</b><br/>';
                        _html += '<b style="color: #2a6496;"><a href=\"'+detailLink+'\">点击查看详情</a></b>';
                        var mailOptions = {
                            from: session.site.name + ' <'+settings.email.user+'>',
                            to: email,
                            subject: session.user.realName + '评论了您的文章《'+name+'》',
                            html: _html
                        };
                        transport.sendMail(mailOptions, function(err, info){
                            if(err){ console.log(err); } else { console.log('Message sent: ' + info.response); }
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
        });
    }//end else
    if (!flag) {// no callback
        res.json({'success': success, 'msg': msg});
    }
};
// 后台新增能力（adminList/detail/modify/status/batch/import/export）合并导出。
// 死代码 exports.update 与 findByName（ Comment.update(id,name,cb) 签名不符、findByName 查不存在的 name 字段）已删除，
// 后台编辑统一走 commentAdmin.modify → Comment.update({id,comment},cb)。
Object.assign(exports, require('./commentAdmin'));