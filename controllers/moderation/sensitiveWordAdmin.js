// 敏感词库后台管理（SPEC-MODERATION §8.1/§8.2，全部 A）。词库任何写成功后调 matcher.invalidate() 热更新。
// 复用 adminCrud/adminIo 的通用编排，只注入资源差异；审计走既有 action，不用 moderation。
var SensitiveWord = require('../../models/SensitiveWord');
var matcher = require('./moderationMatcher');
var cfg = require('../adminConfig');
var kit = require('../adminKit');
var crud = require('../adminCrud');
var io = require('../adminIo');

var CATEGORIES = ['politics', 'porn', 'ad', 'abuse', 'custom'];
var CONFLICT = '该敏感词已存在';
var desc = {soft: {status: 0}, search: ['word'], dateField: 'createTime',
    sortWhitelist: ['createTime', 'modifyTime', 'word'], defaultSortBy: 'createTime', statusRange: [0, 1],
    // category 由 withQuery 白名单化后挂 req._cat（detail 不经 withQuery 时为空，等价无筛选）。
    extra: function (filters, req) {
        var cat = req && req._cat;
        if (cat) { filters.category = cat; return {category: cat}; }
        return {};
    }};
// 写操作 desc 不带 soft：否则 status:0 的 where 会挡住「启用已停用词」。
var writeDesc = Object.assign({}, desc, {soft: {}});

// 入口形状守卫（E01：手写 typeof 守卫也是合法校验）：畸形 query/body 早拒绝，防 kit.* 收到数组/标量。
function withQuery(handler) {
    return function (req, res) {
        var q = req.query || {};
        if (typeof q !== 'object' || Array.isArray(q)) {
            return res.status(400).json({success: false, msg: '参数错误'});
        }
        req._cat = kit.oneOf(q.category, CATEGORIES, null);
        return handler(req, res);
    };
}
function readBody(req, res) {
    var b = req.body || {};
    if (typeof b !== 'object' || b === null || Array.isArray(b)) {
        res.status(400).json({success: false, msg: '参数错误'});
        return null;
    }
    return b;
}

// docs 白名单：只回前端契约字段，不含 wordNormalized/createdBy（防内部 id 泄露）。
function shape(docs, cb) {
    cb(null, docs.map(function (d) {
        var o = d && d.toObject ? d.toObject() : Object.assign({}, d);
        return {_id: o._id, word: o.word, category: o.category, status: o.status, createTime: o.createTime};
    }));
}
// 写操作成功后只失效一次词库缓存（同进程下一次发布即生效）；读操作不包装。
function refresh(handler) {
    return function (req, res) {
        var orig = res.json, fired = false;
        res.json = function (body) {
            if (!fired && body && body.success === true) { fired = true; matcher.invalidate(); }
            return orig.apply(this, arguments);
        };
        return handler(req, res);
    };
}
function parseWord(v) {
    var w = kit.str(v, 64, true);
    if (!w) return null;
    var n = matcher.normalizeForMatch(w);
    // 归一化后超长词会让 matcher 加载词库时抛错 → 全线 fail-open，写入前先挡住。
    return (n && n.length <= cfg.MODERATION_MAX_WORD_CHARS) ? {word: w, norm: n} : null;
}
function meta(action, id, detail, result) {
    return {action: action, target: 'sensitive-word', objectId: id ? [String(id)] : [],
        detail: detail || 'changed:word,category,status', result: result !== false};
}
function finish(req, res, m, body) { kit.audit(req, m, function () { res.json(body); }); }
function failWrite(req, res, m, err) {
    var n = kit.normalizeDaoError(err, 'sensitiveWord', CONFLICT);
    m.result = false;
    kit.audit(req, m, function () { res.status(n.status).json({success: false, msg: n.msg}); });
}

// 页面 / JSON 列表：SSR 分支散开 keyword/status/sortBy/order/category 到顶层 locals，供 pager 回显。
exports.page = withQuery(crud.list({Model: SensitiveWord, desc: desc, view: 'manager/sensitiveWord',
    title: '敏感词管理', currentMenu: 'sensitiveWord', urlPrefix: '/manager/sensitive-word',
    sortWhitelist: desc.sortWhitelist, defaultSortBy: desc.defaultSortBy, statusRange: [0, 1], decorate: shape}));
exports.list = withQuery(crud.list({Model: SensitiveWord, desc: desc,
    sortWhitelist: desc.sortWhitelist, defaultSortBy: desc.defaultSortBy, statusRange: [0, 1], decorate: shape}));

// 新增：word 归一化存 wordNormalized；partial unique 冲突 11000 → 409。
exports.add = function (req, res) {
    var body = readBody(req, res);
    if (!body) return;
    var pw = parseWord(body.word);
    var category = kit.oneOf(body.category, CATEGORIES, 'custom');
    var status = kit.intInRange(body.status, 0, 1, 0);
    var m = meta('create', null, 'changed:word,category,status');
    function done(body, ok, id) { m.result = !!ok; if (id) m.objectId = [String(id)]; finish(req, res, m, body); }
    if (!pw) return done({success: false, msg: '敏感词不能为空'}, false);
    SensitiveWord.save({word: pw.word, wordNormalized: pw.norm, category: category, status: status,
        createdBy: (req.session.user && req.session.user._id) || null,
        createTime: new Date(), modifyTime: new Date()}, function (err, saved) {
        if (err) return failWrite(req, res, m, err);
        var id = saved && saved._id ? String(saved._id) : '';
        matcher.invalidate();
        done({success: true, msg: '添加成功', id: id}, true, id);
    });
};

// 编辑：重算 wordNormalized；status 可选（不传保留原值）；partial unique 冲突 → 409。
exports.modify = function (req, res) {
    var body = readBody(req, res);
    if (!body) return;
    var chk = kit.requireId(body.id);
    var pw = parseWord(body.word);
    var category = kit.oneOf(body.category, CATEGORIES, 'custom');
    var status = kit.intInRange(body.status, 0, 1, null);
    var m = meta('update', chk.ok ? chk.id : null, 'changed:word,category,status');
    function done(body, ok) { m.result = !!ok; finish(req, res, m, body); }
    if (!chk.ok) return res.status(400).json({success: false, msg: '参数错误'});
    if (!pw) return done({success: false, msg: '敏感词不能为空'}, false);
    var fields = {word: pw.word, wordNormalized: pw.norm, category: category};
    if (status !== null) fields.status = status;
    SensitiveWord.adminUpdate(chk.id, {}, fields, function (err) {
        if (err) return failWrite(req, res, m, err);
        matcher.invalidate();
        done({success: true, msg: '修改成功', id: chk.id}, true);
    });
};

// 软删 / 启停 / 批量：写后失效缓存（delete/status 用 crud hook，batch 用 refresh 包装）。
exports.delete = crud.remove({Model: SensitiveWord, desc: writeDesc, target: 'sensitive-word', shape: 'success',
    deleteMsg: '删除成功', notFoundMsg: '敏感词不存在',
    afterDelete: function (id, oldDoc, req, cb) { matcher.invalidate(); cb(); }});
// 状态文案沿用 crud 默认（adminCrud.js:184）；启停后热更新词库缓存。
exports.status = crud.status({Model: SensitiveWord, desc: writeDesc, target: 'sensitive-word', shape: 'success',
    statusRange: [0, 1], afterStatus: function (id, oldDoc, status, req, cb) { matcher.invalidate(); cb(); }});
exports.batch = refresh(crud.batch({Model: SensitiveWord, desc: writeDesc, target: 'sensitive-word',
    shape: 'success', statusRange: [0, 1]}));

// CSV 导入：表头 word,category,status；rowToDoc 内算 wordNormalized；写后一次性失效缓存。
exports['import'] = refresh(io.import({
    Model: SensitiveWord, target: 'sensitive-word', columns: ['word', 'category', 'status'],
    rowToDoc: function (cells, ctx) {
        var pw = parseWord(kit.csv.sanitize(cells[0]));
        if (!pw) throw new Error('敏感词不能为空或归一化后超长');
        return {__row: ctx.row, word: pw.word, wordNormalized: pw.norm,
            category: kit.oneOf(kit.csv.sanitize(cells[1]), CATEGORIES, 'custom'),
            status: kit.intInRange(cells[2], 0, 1, 0), createTime: new Date(), modifyTime: new Date()};
    },
    insertDoc: function (doc, cb) {
        SensitiveWord.save(doc, function (err, saved) {
            if (err) return cb(err); // 归一化后重名（11000）→ userErrMsg 映射，部分成功
            cb(null, saved && saved._id ? String(saved._id) : '');
        });
    }
}));
// CSV 导出：不含 createdBy/wordNormalized（防内部 id 泄露）。
exports['export'] = io.export({Model: SensitiveWord, target: 'sensitive-word', desc: desc,
    columns: ['word', 'category', 'status'],
    docToRow: function (d) { return [d.word || '', d.category || '', d.status]; }});
