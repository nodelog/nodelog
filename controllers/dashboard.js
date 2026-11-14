// 概览/面板：聚合后台核心计数与模块级明细，渲染管理后台首页看板。
// 原先 /manager 误把「博客配置」表单放在概览页，本控制器将其替换为运营概况看板。
var Content = require('./../models/Content');
var User = require('./../models/User');
var Comment = require('./../models/Comment');
var Category = require('./../models/Category');
var Log = require('./../models/Log');
var Tag = require('./../models/Tag');
var SensitiveWord = require('./../models/SensitiveWord');
var ViolationLog = require('./../models/ViolationLog');

exports.overview = function (req, res) {
    var data = {
        stats: { content: 0, user: 0, comment: 0, category: 0, tag: 0, log: 0, sensitiveWord: 0, violation: 0 },
        recentContent: [],
        pendingViolations: { total: 0, docs: [] },
        pendingContent: 0
    };
    var done = 0, total = 11;
    function tick() {
        if (++done === total) {
            res.render('manager/index', {
                title: (req.session.site && req.session.site.name) || '管理后台',
                currentMenu: 'home',
                stats: data.stats,
                recentContent: data.recentContent,
                pendingViolations: data.pendingViolations,
                pendingContent: data.pendingContent
            });
        }
    }
    // ---- 概览计数（8 项，复用各模型既有计数方法）----
    Content.getCount(null, function (e, c) { if (!e && c) data.stats.content = c; tick(); });
    User.getCount(function (e, c) { if (!e && c) data.stats.user = c; tick(); });
    Comment.getCount(function (e, c) { if (!e && c) data.stats.comment = c; tick(); });
    Category.getCount(function (e, c) { if (!e && c) data.stats.category = c; tick(); });
    Log.getCount(function (e, c) { if (!e && c) data.stats.log = c; tick(); });
    Tag.findAll(function (e, docs) { if (!e && docs) data.stats.tag = docs.length; tick(); });
    if (typeof SensitiveWord.findAllEnabled === 'function') {
        SensitiveWord.findAllEnabled(function (e, docs) { if (!e && docs) data.stats.sensitiveWord = docs.length; tick(); });
    } else { tick(); }
    if (typeof ViolationLog.getCount === 'function') {
        ViolationLog.getCount({}, function (e, c) { if (!e && c) data.stats.violation = c; tick(); });
    } else { tick(); }
    // ---- 模块级明细（3 项）----
    // 最近文章：已发布内容按时间倒序取前 6 篇
    Content.findByPage(1, null, function (e, docs) {
        if (!e && docs) data.recentContent = docs.slice(0, 6);
        tick();
    });
    // 违规待处理：尚未处置（disposition 为空）的违规记录
    if (typeof ViolationLog.findByPage === 'function') {
        ViolationLog.findByPage({disposition: {$size: 0}}, {page: 1, pageSize: 5}, function (e, r) {
            if (!e && r) { data.pendingViolations.total = r.total || 0; data.pendingViolations.docs = (r.docs || []).slice(0, 5); }
            tick();
        });
    } else { tick(); }
    // 待发布内容：草稿 或 私有（status=2）
    if (typeof Content.getPendingCount === 'function') {
        Content.getPendingCount(function (e, c) { if (!e && c != null) data.pendingContent = c; tick(); });
    } else { tick(); }
};
