// 操作日志（仅管理员只读；无单条删改接口 —— K03）。
// JSON: GET /manager/audit?action=&actor=&target=&result=&objectId=&from=&to=&page= → {success,data,page,totalPage,total}
// 页面: GET /manager/audit/page → 渲染 views/manager/audit.ejs（前端实现）
var AuditLog = require('./../models/AuditLog');
var kit = require('./adminKit');
var cfg = require('./adminConfig');

var AUDIT_SORT = ['time', 'action', 'target', 'actorName'];

function endOfDayIfDateOnly(raw, value) {
    // QA 用 from=<今天>/to=<今天> 这类日期串过滤：to 必须含全天，否则当天记录被排除（H04/K04）。
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(String(raw).trim())) {
        var d = new Date(value.getTime());
        d.setHours(23, 59, 59, 999);
        return d;
    }
    return value;
}

function buildQuery(parsed, query) {
    var f = parsed.filters;
    var where = {};
    if (f.action) where.action = f.action;
    if (f.actor) where.actor = f.actor;
    if (f.target) where.target = f.target;
    if (f.result !== undefined) where.result = f.result;
    if (f.objectId) where.objectId = f.objectId;
    if (f.from || f.to) {
        where.time = {};
        if (f.from) where.time.$gte = f.from;
        if (f.to) where.time.$lte = endOfDayIfDateOnly(query.to, f.to);
    }
    return where;
}

function fetch(req, res, render) {
    var parsed = kit.parseListQuery(req.query, {
        sortWhitelist: AUDIT_SORT,
        defaultSortBy: 'time',
        pageSize: cfg.PAGE_SIZE
    });
    if (parsed.error) {
        if (render) return res.status(400).render('error', {title: '参数错误', state: '400'});
        return res.status(400).json({success: false, msg: parsed.error});
    }
    var sort = {};
    sort[parsed.sortBy] = (parsed.order === 'asc' ? 1 : -1);
    var where = buildQuery(parsed, req.query);
    AuditLog.findByPage(where, {page: parsed.page, pageSize: parsed.pageSize, sort: sort}, function (err, result) {
        if (err) {
            var n = kit.normalizeDaoError(err, 'audit.list');
            if (render) return res.status(n.status).render('error', {title: '出错了', state: String(n.status)});
            return res.status(n.status).json({success: false, msg: n.msg});
        }
        if (render) {
            var locals = {
                docs: result.docs, title: '操作日志', page: result.page,
                totalPage: result.totalPage, total: result.total,
                url: '/manager/audit/page?', currentMenu: 'audit',
                filters: parsed.filters
            };
            // 散开筛选值到顶层（前端 locals.action / locals.from 等回显）；日期 from/to 用原始 query 字符串回填输入框。
            Object.keys(parsed.filters).forEach(function (k) { locals[k] = parsed.filters[k]; });
            ['from', 'to', 'action', 'actor', 'target', 'result'].forEach(function (k) {
                if (req.query[k] !== undefined) locals[k] = req.query[k];
            });
            locals.sortBy = parsed.sortBy;
            locals.order = parsed.order;
            return res.render('manager/audit', locals);
        }
        res.json({
            success: true, data: result.docs, page: result.page,
            totalPage: result.totalPage, total: result.total
        });
    });
}

// GET /manager/audit —— JSON（A，仅管理员；路由挂 filter.authorizeAdmin）
exports.list = function (req, res) { fetch(req, res, false); };

// GET /manager/audit/page —— 渲染页面（A）
exports.auditPage = function (req, res) { fetch(req, res, true); };

exports.AUDIT_SORT = AUDIT_SORT;
