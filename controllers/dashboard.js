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
var Link = require('./../models/Link');

// 生成最近 days 天的 UTC 日期轴（YYYY-MM-DD），与聚合的 $dateToString 对齐
function buildDayAxis(days) {
    var axis = [];
    var now = new Date();
    var end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    for (var i = days - 1; i >= 0; i--) {
        axis.push(new Date(end - i * 86400000).toISOString().slice(0, 10));
    }
    return axis;
}
// 把聚合结果 {_id:日期, count} 对齐到日期轴，缺失日补 0
function fillSeries(axis, rows) {
    var map = {};
    (rows || []).forEach(function (r) { if (r && r._id) map[r._id] = r.count || 0; });
    return axis.map(function (d) { return map[d] || 0; });
}

exports.overview = function (req, res) {
    var range = parseInt(req.query.range, 10);
    if ([7, 30, 90].indexOf(range) === -1) range = 30; // 仅允许 7/30/90，否则默认 30

    var data = {
        stats: { content: 0, user: 0, comment: 0, category: 0, tag: 0, log: 0, sensitiveWord: 0, violation: 0 },
        recentContent: [],
        pendingViolations: { total: 0, docs: [] },
        pendingContent: 0,
        recentComments: [],
        recentLogs: [],
        recentLinks: [],
        disabledLog: 0,
        disabledLink: 0,
        trend: { axis: [], content: [], comment: [], user: [], range: range }
    };
    var done = 0, total = 17;
    function tick() {
        if (++done === total) {
            res.render('manager/index', {
                title: (req.session.site && req.session.site.name) || '管理后台',
                currentMenu: 'home',
                stats: data.stats,
                recentContent: data.recentContent,
                pendingViolations: data.pendingViolations,
                pendingContent: data.pendingContent,
                recentComments: data.recentComments,
                recentLogs: data.recentLogs,
                recentLinks: data.recentLinks,
                disabledLog: data.disabledLog,
                disabledLink: data.disabledLink,
                trend: data.trend
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
    // ---- 模块级明细 ----
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
    // 最近评论：已发布评论按时间倒序取前 6 条
    Comment.findByPage(1, function (e, docs) {
        if (!e && docs) data.recentComments = docs.slice(0, 6);
        tick();
    });
    // 最近公告：已发布公告按修改时间倒序取前 5 条
    Log.findByPage(1, function (e, docs) {
        if (!e && docs) data.recentLogs = docs.slice(0, 5);
        tick();
    });
    // 最近友链：已启用友链按时间倒序取前 5 条
    Link.findByPage(1, function (e, docs) {
        if (!e && docs) data.recentLinks = docs.slice(0, 5);
        tick();
    });
    // 公告/友链待复核：已下架（status=1）数量
    if (typeof Log.getCountDisabled === 'function') {
        Log.getCountDisabled(function (e, c) { if (!e && c != null) data.disabledLog = c; tick(); });
    } else { tick(); }
    if (typeof Link.getCountDisabled === 'function') {
        Link.getCountDisabled(function (e, c) { if (!e && c != null) data.disabledLink = c; tick(); });
    } else { tick(); }
    // 运营趋势：按时间范围聚合 文章/评论/用户 每日新增，对齐到日期轴
    (function buildTrend() {
        var c = 0;
        function t() {
            if (++c === 3) {
                var axis = buildDayAxis(range);
                data.trend.axis = axis;
                data.trend.content = fillSeries(axis, data._tc);
                data.trend.comment = fillSeries(axis, data._tm);
                data.trend.user = fillSeries(axis, data._tu);
                tick();
            }
        }
        Content.getTrend(range, function (e, rows) { data._tc = rows; t(); });
        Comment.getTrend(range, function (e, rows) { data._tm = rows; t(); });
        User.getTrend(range, function (e, rows) { data._tu = rows; t(); });
    })();
};
