// Comment 后台审核（SPEC §4.6，全部 A）；从 comment.js 拆出满足单文件 ≤300 行门禁。
// 本文件负责列表/详情/编辑/状态/批量/导入/导出与审计。
var async = require('async');
var Comment = require('./../models/Comment.js');
var User = require('./../models/User.js');
var Content = require('./../models/Content.js');
var kit = require('./adminKit');
var crud = require('./adminCrud');
var io = require('./adminIo');
var guard = require('./moderation/moderationGuard');

var commentDesc = {
    soft: {status: 0}, search: ['comment', 'userName'], dateField: 'createTime',
    sortWhitelist: ['createTime'], defaultSortBy: 'createTime'
};
function meta(action, id, detail, result) {
    return {action: action, target: 'comment', objectId: id ? [String(id)] : [],
        detail: detail || 'changed:comment,status', result: result !== false};
}
function finish(req, res, metaObj, body) {
    kit.audit(req, metaObj, function () { res.json(body); });
}
// 与 comment.js 前台 cleanComment 保持一致：去 HTML 标签与控制字符（防存储型 XSS，C06）。
function cleanComment(s) {
    return String(s == null ? '' : s)
        .replace(/<[^>]*>/g, '')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .trim();
}
function validate(text) {
    if (!text) return '评论内容不能为空';
    if (text.length > 2000) return '评论内容过长，最多 2000 字';
    return null;
}

// B13/F01：评论列表/详情补 userName（评论人）与 contentName（所属文章标题）。
// Comment schema 无 contentName，故转 POJO 后再补字段（否则 toJSON 会丢掉 schema 外字段）。
// 批量聚合消 N+1：一页 id 收集后各查一次 User.findByIds / Content 批量，结果回填。
function enrich(docs, cb) {
    if (!docs || !docs.length) return cb(null, []);
    var plain = docs.map(function (d) { return d && d.toObject ? d.toObject() : Object.assign({}, d); });
    var userIds = [], contentIds = [];
    plain.forEach(function (d) {
        if (d.commenter) userIds.push(String(d.commenter));
        if (d.content) contentIds.push(String(d.content));
    });
    async.parallel({
        users: function (done) {
            if (!userIds.length) return done(null, []);
            // 单个批量查询失败降级为空映射（字段显示「未知」），不让评论列表/详情因补展示字段而 500。
            User.findByIds(userIds, function (e, us) { done(null, us || []); });
        },
        contents: function (done) {
            if (!contentIds.length) return done(null, []);
            // 用通用 adminList 批量取标题；带上所有状态（软删文章也显示标题），只 select name。
            Content.adminList({_id: {$in: contentIds}}, {page: 1, pageSize: contentIds.length, sort: {}},
                function (e, r) { done(null, (r && r.docs) || []); });
        }
    }, function (err, r) {
        if (err) return cb(null, plain); // 兜底：极端情况下返回未补齐的原始文档，不阻断列表
        var um = {}, cm = {};
        (r.users || []).forEach(function (u) { um[String(u._id)] = u; });
        (r.contents || []).forEach(function (c) { cm[String(c._id)] = c; });
        plain.forEach(function (d) {
            var u = d.commenter ? um[String(d.commenter)] : null;
            var c = d.content ? cm[String(d.content)] : null;
            d.userName = u ? (u.realName || u.userName) : (d.userName || '未知');
            d.contentName = c && c.name ? c.name : '未知';
        });
        cb(null, plain);
    });
}
// list 收数组、detail 收单条，统一走 enrich。
exports.adminList = crud.list({
    Model: Comment, desc: commentDesc, target: 'comment', view: 'manager/comment',
    title: '评论管理', currentMenu: 'comment', urlPrefix: '/manager/comment',
    sortWhitelist: commentDesc.sortWhitelist, defaultSortBy: 'createTime', statusRange: [0, 1],
    decorate: enrich
});
exports.detail = crud.detail({
    Model: Comment, desc: commentDesc, target: 'comment', view: 'manager/detail',
    titleFn: function (d) { return d.comment ? String(d.comment).slice(0, 40) : '评论详情'; },
    currentMenu: 'comment',
    decorate: function (doc, cb) { enrich([doc], function (e, arr) { cb(e, arr && arr[0]); }); }
});
// 后台编辑：复用 Comment.update({id,comment},cb) 的正确签名（非死代码 exports.update 的 (id,name,cb)）。
exports.modify = function (req, res) {
    var chk = kit.requireId(req.body.id);
    var text = cleanComment(req.body.comment);
    var m = meta('update', chk.ok ? chk.id : null, 'changed:comment');
    function done(body, ok) { m.result = !!ok; finish(req, res, m, body); }
    if (!chk.ok) return res.status(400).json({success: false, msg: '参数错误'});
    var bad = validate(text);
    if (bad) return done({success: false, msg: bad}, false);
    // W5c（§5.4）：后台评论编辑直连 Comment.update，validate 之后挂守卫。命中零副作用、零成功审计。
    guard.enforce(req, {comment: text}, 'comment', function (gErr, verdict) {
        if (gErr) {
            var n = kit.normalizeDaoError(gErr, 'comment.modify.guard');
            return done({success: false, msg: n.status === 500 ? '修改失败' : n.msg}, false);
        }
        if (!verdict.allowed) return done({success: false, msg: verdict.msg}, false);
        Comment.update({id: chk.id, comment: text}, function (err) {
            if (err) {
                var n2 = kit.normalizeDaoError(err, 'comment.modify');
                return done({success: false, msg: n2.status === 500 ? '修改失败' : n2.msg}, false);
            }
            done({success: true, msg: '修改成功', id: chk.id}, true);
        });
    });
};
exports.status = crud.status({
    Model: Comment, desc: commentDesc, target: 'comment', shape: 'success', statusRange: [0, 1],
    statusMsg: '状态更新成功'
});
exports.batch = crud.batch({
    Model: Comment, desc: commentDesc, target: 'comment', shape: 'success', statusRange: [0, 1]
});
exports['import'] = io.import({
    Model: Comment, target: 'comment', columns: ['comment', 'userName', 'content', 'status'],
    rowToDoc: function (cells, ctx) {
        var text = cleanComment(cells[0]);
        if (!text) throw new Error('评论内容不能为空');
        if (text.length > 2000) throw new Error('评论内容过长');
        var content = kit.csv.sanitize(cells[2]);
        if (content && !kit.isObjectId(content)) throw new Error('文章 id 非法');
        return {__row: ctx.row, __req: ctx.req, comment: text, userName: kit.csv.sanitize(cells[1]),
            content: content || null, status: kit.intInRange(cells[3], 0, 1, 0),
            createTime: new Date(), modifyTime: new Date()};
    },
    insertDoc: function (doc, cb) {
        // W5b（§5.4）：直连 Comment.save 绕过 add，单独挂守卫。命中行进 results（ok:false），不落库。
        var req = doc.__req; delete doc.__req; req._moderationRow = doc.__row; // CSV 命中审计 detail 带 row=N（§5.4）
        guard.enforce(req, {comment: doc.comment}, 'comment', function (gErr, verdict) {
            if (gErr) return cb(gErr);
            if (!verdict.allowed) {
                var e = new Error('第 ' + doc.__row + ' 行包含违规信息');
                e.userMsg = e.message;
                return cb(e);
            }
            Comment.save(doc, function (err, saved) {
                if (err) return cb(err);
                cb(null, saved && saved._id ? String(saved._id) : '');
            });
        });
    }
});
exports['export'] = io.export({
    Model: Comment, target: 'comment', desc: commentDesc,
    columns: ['comment', 'userName', 'content', 'createTime', 'status'],
    docToRow: function (d) {
        return [d.comment || '', d.userName || '', d.content ? String(d.content) : '',
            d.createTime ? d.createTime.toISOString() : '', d.status];
    }
});
