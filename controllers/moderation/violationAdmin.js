// 违规记录后台（SPEC-MODERATION §8.1/§8.2，全部 A）。append-only：只读，无增删改/批量/导入导出。
// 不记正文；ip 即便已截断也不进响应（E16 最小必要）；disposition 轨迹完整返回供四级处置前端读取。
var ViolationLog = require('../../models/ViolationLog');
var kit = require('../adminKit');
var crud = require('../adminCrud');

var SOURCES = ['content', 'comment'];
var FIELDS = ['name', 'content', 'excerpt', 'tags', 'seoTitle', 'seoKeywords', 'seoDescription', 'comment'];
// source/disposition/user/field 不在 parseListQuery 白名单：由 check() 校验并挂 req._filters，extra 只读它。
var desc = {soft: {}, dateField: 'time', search: ['hitWord'],
    sortWhitelist: ['time', 'user', 'source', 'field'], defaultSortBy: 'time',
    extra: function (filters, req) {
        var f = (req && req._filters) || {}, w = {};
        if (f.source) { filters.source = f.source; w.source = f.source; }
        if (f.field) { filters.field = f.field; w.field = f.field; }
        if (f.user) { filters.user = f.user; w.user = f.user; }
        if (f.disp !== null && f.disp !== undefined) {
            filters.disposition = String(f.disp); // 字符串回显，避免 0 被前端 `||''` 吞掉
            w.$expr = {$eq: [{$arrayElemAt: ['$disposition.level', -1]}, f.disp]}; // 最新一条处置级别
        }
        return w;
    }};
// 入口形状守卫（E01：手写 typeof 守卫也是合法校验）+ 非标准筛选白名单化：畸形 query 早拒绝 400。
function check(handler) {
    return function (req, res) {
        var q = req.query || {};
        if (typeof q !== 'object' || Array.isArray(q)) {
            return res.status(400).json({success: false, msg: '参数错误'});
        }
        var source = kit.oneOf(q.source, SOURCES, null);
        var field = kit.oneOf(q.field, FIELDS, null);
        var disp = kit.intInRange(q.disposition, 0, 4, null);
        var usr = kit.isObjectId(q.user) ? String(q.user).trim() : null;
        if ((q.source && source === null) || (q.field && field === null) ||
            (q.user && !usr) ||
            (q.disposition !== undefined && q.disposition !== '' && disp === null)) {
            return res.status(400).json({success: false, msg: '参数错误'});
        }
        req._filters = {source: source, field: field, disp: disp, user: usr};
        return handler(req, res);
    };
}
// 去 ip（截断值也不进列表/详情响应，E16 最小必要）；_id 等由 schema 保证存在。
function stripIp(doc) {
    var o = doc && doc.toObject ? doc.toObject() : Object.assign({}, doc);
    delete o.ip;
    return o;
}
function shapeList(docs, cb) { cb(null, docs.map(stripIp)); }
function shapeOne(doc, cb) { cb(null, stripIp(doc)); }

// 页面 / JSON 列表：SSR 分支散开 keyword/source/disposition/user/field/from/to/sortBy/order 到顶层 locals。
exports.page = check(crud.list({Model: ViolationLog, desc: desc, view: 'manager/violation',
    title: '违规记录', currentMenu: 'violation', urlPrefix: '/manager/violation',
    sortWhitelist: desc.sortWhitelist, defaultSortBy: desc.defaultSortBy, decorate: shapeList}));
exports.list = check(crud.list({Model: ViolationLog, desc: desc,
    sortWhitelist: desc.sortWhitelist, defaultSortBy: desc.defaultSortBy, decorate: shapeList}));
// 单条案底（含 disposition 轨迹）：支持 ?format=json；非法/不存在 id → 302 /error（crud.detail 既有语义）。
exports.detail = crud.detail({Model: ViolationLog, desc: desc, target: 'violation',
    view: 'manager/detail', titleFn: function (d) { return '违规记录 ' + d._id; },
    currentMenu: 'violation', decorate: shapeOne});
