// 后台七类资源共用的编排层（SPEC §4 通用模式 + §3.7 批量语义）。
// 只做「解析 -> 组装 query -> 调 DAO -> 归一化错误 -> 响应 -> 审计」的机械流程；
// 资源差异通过 cfg 描述符/hook 注入。DAO 只执行 controller 组装好的 query。
var kit = require('./adminKit');
var cfgConst = require('./adminConfig');
var cmsUtils = require('./cmsUtils');

// DEF-003 纵深防御（P0 泄敏修复）：所有后台 JSON 响应统一剥离敏感字段黑名单。
// 只作用于 JSON 分支；SSR 分支不动（老 /manager/user 页管理员需查看 email/phone，且是内部页）。
// 用 hasOwnProperty 检测：无敏感字段的资源原样返回 Mongoose doc，序列化结构零变化；
// 命中敏感字段才降级为 POJO 并剔除。当前仅 User schema 含这些字段，
// 且 userAdmin 已用 decorate 白名单重建；此处防止未来资源新增敏感字段或 decorate 遗漏时泄露。
var SENSITIVE_KEYS = ['password', 'passwordHash', 'email', 'phone', 'openUserId', 'token', 'secret'];
function stripOne(doc) {
    if (doc == null) return doc;
    var plain = doc.toObject ? doc.toObject() : doc;
    var hit = SENSITIVE_KEYS.some(function (k) {
        return Object.prototype.hasOwnProperty.call(plain, k);
    });
    if (!hit) return doc; // 无敏感字段：原样返回，Express 序列化结果与修复前逐字节一致
    var out = {};
    Object.keys(plain).forEach(function (k) {
        if (SENSITIVE_KEYS.indexOf(k) === -1) out[k] = plain[k];
    });
    return out;
}
function stripSensitive(docs) {
    return Array.isArray(docs) ? docs.map(stripOne) : stripOne(docs);
}

function sendErr(res, err, action, shape, render) {
    var n = kit.normalizeDaoError(err, action);
    if (render) return res.status(n.status).render('error', {title: '出错了', state: String(n.status)});
    return res.status(n.status).json(kit.failBody(shape, n.msg));
}
function okMsg(res, msg, extra) {
    var body = {success: true, msg: msg || '操作成功'};
    if (extra) Object.assign(body, extra);
    return res.json(body);
}
// 业务拒绝（引用检查等）用 err.userMsg 给出友好文案；其余未知错误才走归一化（含服务端日志）。
function userErrMsg(e, action) {
    if (!e) return '操作失败';
    if (e.userMsg) return e.userMsg;
    return kit.normalizeDaoError(e, action).msg;
}

// 通用 where 构建：软删过滤 + 归属作用域 + 筛选 + 搜索（正则转义）+ 日期区间。
// desc: {soft, owner, search, category, tag, author, role, result, action, actor, target,
//        objectId, dateField, extra(filters, req)}
function buildWhere(desc, filters, req) {
    var w = Object.assign({}, desc.soft || {});
    if (desc.owner) {
        w = kit.scopeTerm(req && req.session && req.session.user, desc.owner, w);
    }
    if (filters.status !== undefined && filters.status !== null) w.status = filters.status;
    if (filters.keyword) {
        var re = new RegExp(cmsUtils.escapeRegExp(filters.keyword), 'i');
        var fields = desc.search || ['name'];
        if (fields.length === 1) {
            var one = {}; one[fields[0]] = re; Object.assign(w, one);
        } else {
            w.$or = fields.map(function (f) { var o = {}; o[f] = re; return o; });
        }
    }
    if (desc.category && filters.categoryId) w.category = filters.categoryId;
    if (desc.tag && filters.tag) {
        w.tags = {"$regex": "^\\s*" + cmsUtils.escapeRegExp(filters.tag) + "\\s*$", "$options": "i"};
    }
    if (desc.author && filters.author) w.author = filters.author;
    if (desc.role && filters.role !== undefined) w.role = filters.role;
    if (desc.result && filters.result !== undefined) w.result = filters.result;
    ['action', 'actor', 'target', 'objectId'].forEach(function (k) {
        if (desc[k] && filters[k]) w[k] = filters[k];
    });
    if (desc.dateField) {
        var range = {};
        var from = filters.dateFrom || filters.from;
        var to = filters.dateTo || filters.to;
        if (from) range.$gte = from;
        if (to) {
            // QA 常用 to=YYYY-MM-DD（当天）：补到 23:59:59.999，避免当天记录被排除（H04/K04）。
            if (req && /^\d{4}-\d{2}-\d{2}$/.test(String(req.query && req.query.to || '').trim())) {
                var d = new Date(to.getTime()); d.setHours(23, 59, 59, 999); range.$lte = d;
            } else range.$lte = to;
        }
        if (Object.keys(range).length) w[desc.dateField] = range;
    }
    if (desc.extra) Object.assign(w, desc.extra(filters, req) || {});
    return w;
}
exports.buildWhere = buildWhere;
// 供 adminIo.js（CSV 导入导出）复用同一套解析/错误归一化，避免第二套口径。
exports._internal = {parseOf: parseOf, sortOf: sortOf, sendErr: sendErr, okMsg: okMsg, userErrMsg: userErrMsg};

function parseOf(cfgItem, query) {
    return kit.parseListQuery(query, {
        sortWhitelist: cfgItem.sortWhitelist || ['createTime'],
        defaultSortBy: cfgItem.defaultSortBy || 'createTime',
        statusRange: cfgItem.statusRange || [0, 2],
        pageSize: cfgItem.pageSize || cfgConst.PAGE_SIZE
    });
}
function sortOf(parsed) {
    var s = {}; s[parsed.sortBy] = (parsed.order === 'asc' ? 1 : -1); return s;
}

// 列表：cfg = {Model, desc, sortWhitelist, defaultSortBy, statusRange, view, title,
//              currentMenu, urlPrefix}。view 存在则服务端渲染；?format=json 或 view 缺省则 JSON。
exports.list = function (cfgItem) {
    return function (req, res) {
        var parsed = parseOf(cfgItem, req.query);
        if (parsed.error) return res.status(400).json({success: false, msg: parsed.error});
        var where = buildWhere(cfgItem.desc, parsed.filters, req);
        cfgItem.Model.adminList(where, {page: parsed.page, pageSize: parsed.pageSize, sort: sortOf(parsed)},
            function (err, result) {
                if (err) return sendErr(res, err, 'list', 'success', false);
                // 可选批量 decorate（如 comment 补 contentName/userName）：转 POJO + 批量 enrich，避免逐条 N+1。
                // 不配置则走原路，对其它 6 类资源的 list 零影响；与 crud.detail 的 decorate 能力对称（SPEC §4）。
                function respond() {
                    var wantJson = req.query.format === 'json' || !cfgItem.view;
                    if (wantJson) {
                        // DEF-003：JSON 分支统一剥敏（SSR 分支保持原样，老 user 页需 email/phone）。
                        return res.json({success: true, data: stripSensitive(result.docs), page: result.page,
                            totalPage: result.totalPage, total: result.total});
                    }
                    // 筛选值散到顶层 locals（前端用 locals.keyword 等回显，避免 undefined 报错），同时保留 filters 对象。
                    var locals = {
                        docs: result.docs, title: cfgItem.title || '管理', page: result.page,
                        totalPage: result.totalPage, total: result.total,
                        url: (cfgItem.urlPrefix || req.path) + '?',
                        currentMenu: cfgItem.currentMenu || '', filters: parsed.filters
                    };
                    Object.keys(parsed.filters).forEach(function (k) { locals[k] = parsed.filters[k]; });
                    locals.sortBy = parsed.sortBy;
                    locals.order = parsed.order;
                    res.render(cfgItem.view, locals);
                }
                if (!cfgItem.decorate) return respond();
                cfgItem.decorate(result.docs, function (e, enriched) {
                    if (e) return sendErr(res, e, 'list.decorate', 'success', false);
                    result.docs = enriched || result.docs;
                    respond();
                });
            });
    };
};

// 详情：非法/不存在 id -> 302 /error（F01 零 500），可选 cfgItem.decorate(doc, cb) 补关联字段。
exports.detail = function (cfgItem) {
    return function (req, res) {
        var chk = kit.requireId(req.query.id != null ? req.query.id : req.body.id);
        if (!chk.ok) return res.redirect('/error');
        var where = buildWhere(cfgItem.desc, {}, req); // 只带软删过滤 + 归属，不按 query 筛选
        cfgItem.Model.adminFindById(chk.id, where, function (err, doc) {
            if (err || !doc) return res.redirect('/error');
            function done(err2, enriched) {
                if (err2 || !enriched) return res.redirect('/error');
                if (req.query.format === 'json') return res.json({success: true, data: stripSensitive(enriched)});
                res.render(cfgItem.view || 'manager/detail', {
                    doc: enriched, title: (cfgItem.titleFn ? cfgItem.titleFn(enriched) : (enriched.name || '详情')),
                    resource: cfgItem.target, currentMenu: cfgItem.currentMenu || ''
                });
            }
            if (cfgItem.decorate) cfgItem.decorate(doc, function (e, d) { done(e, d || doc); });
            else done(null, doc);
        });
    };
};

// 单条状态：intInRange 早拒绝非法值；归属在 where；审计 result:false 也记。
exports.status = function (cfgItem) {
    return function (req, res) {
        var chk = kit.requireId(req.body.id);
        var status = kit.intInRange(req.body.status, cfgItem.statusRange[0], cfgItem.statusRange[1], null);
        if (!chk.ok || status === null) return res.status(400).json(kit.failBody(cfgItem.shape, '参数错误'));
        var where = buildWhere(cfgItem.desc, {}, req);
        var auditMeta = {action: 'status', target: cfgItem.target, objectId: [chk.id], detail: 'changed:status'};
        function after(err, changed, oldDoc) {
            var success = !err && changed > 0;
            auditMeta.result = success;
            function respond() {
                kit.audit(req, auditMeta, function () {
                    if (success) return okMsg(res, cfgItem.statusMsg || '状态更新成功');
                    return res.json(kit.failBody(cfgItem.shape, err ? userErrMsg(err, 'status') : '目标不存在或无权操作'));
                });
            }
            if (cfgItem.afterStatus) cfgItem.afterStatus(chk.id, oldDoc, status, req, respond);
            else respond();
        }
        if (cfgItem.beforeStatus) {
            cfgItem.beforeStatus(chk.id, where, req, function (e, oldDoc) {
                if (e) return after(e, 0, null);
                cfgItem.Model.adminUpdate(chk.id, where, {status: status}, function (err, changed) {
                    after(err, changed, oldDoc);
                });
            });
        } else {
            cfgItem.Model.adminUpdate(chk.id, where, {status: status}, function (err, changed) {
                after(err, changed, null);
            });
        }
    };
};

// 单条删除：可选 beforeDelete（分类引用检查 / 读旧 tags）+ afterDelete（标签重算）。
exports.remove = function (cfgItem) {
    return function (req, res) {
        var chk = kit.requireId(req.body.id);
        if (!chk.ok) return res.status(400).json(kit.failBody(cfgItem.shape, '参数错误'));
        var where = buildWhere(cfgItem.desc, {}, req);
        var auditMeta = {action: 'delete', target: cfgItem.target, objectId: [chk.id], detail: 'changed:status'};
        function proceed(oldDoc) {
            cfgItem.Model.adminSoftDelete(chk.id, where, function (err, changed) {
                var success = !err && changed > 0;
                auditMeta.result = success;
                if (!success) {
                    return kit.audit(req, auditMeta, function () {
                        res.json(kit.failBody(cfgItem.shape, err ? userErrMsg(err, 'delete') : (cfgItem.notFoundMsg || '目标不存在或无权操作')));
                    });
                }
                function respond() {
                    kit.audit(req, auditMeta, function () { okMsg(res, cfgItem.deleteMsg || '删除成功'); });
                }
                if (cfgItem.afterDelete) cfgItem.afterDelete(chk.id, oldDoc, req, function () { respond(); });
                else respond();
            });
        }
        if (cfgItem.beforeDelete) cfgItem.beforeDelete(chk.id, where, req, function (e, oldDoc) {
            if (e) {
                auditMeta.result = false;
                return kit.audit(req, auditMeta, function () {
                    res.json(kit.failBody(cfgItem.shape, userErrMsg(e, 'delete')));
                });
            }
            proceed(oldDoc);
        });
        else proceed(null);
    };
};

// 批量（D3）：预检查（上限/合法性/越权）在任何写入前完成；逐条 async.eachSeries 不回滚。
exports.batch = function (cfgItem) {
    return function (req, res) {
        var v = kit.validateBatchIds(req.body.ids);
        if (!v.ok) return res.status(400).json({success: false, msg: v.msg, results: [], failed: v.invalid.length});
        var action = kit.oneOf(req.body.action, ['delete', 'status'], null);
        var status = (action === 'status')
            ? kit.intInRange(req.body.status, cfgItem.statusRange[0], cfgItem.statusRange[1], null) : null;
        if (!action || (action === 'status' && status === null)) {
            return res.status(400).json({success: false, msg: '参数错误', results: [], failed: 0});
        }
        var where = buildWhere(cfgItem.desc, {}, req);
        var results = v.invalid.slice();
        var allowed = v.ids.slice();
        function writeOne(id, cb) {
            var run = function (err, msg) {
                results.push({id: id, ok: !err, msg: err ? userErrMsg(err, 'batch') : (msg || '成功')});
                cb(null); // 一条失败不影响后续
            };
            if (cfgItem.one) return cfgItem.one(id, action, status, where, req, run);
            if (action === 'status') {
                var apply = function (oldDoc) {
                    cfgItem.Model.adminUpdate(id, where, {status: status}, function (err, changed) {
                        if (err || changed === 0) return run(err || new Error('目标不存在或无权操作'));
                        if (cfgItem.afterStatus) return cfgItem.afterStatus(id, oldDoc, status, req, function () { run(null); });
                        run(null);
                    });
                };
                if (cfgItem.beforeStatus) return cfgItem.beforeStatus(id, where, req, function (e, oldDoc) {
                    if (e) return run(e);
                    apply(oldDoc);
                });
                return apply(null);
            }
            var step = function (e, oldDoc) {
                if (e) return run(e);
                cfgItem.Model.adminSoftDelete(id, where, function (err, changed) {
                    if (err || changed === 0) return run(err || new Error('目标不存在或无权操作'));
                    if (cfgItem.afterDelete) return cfgItem.afterDelete(id, oldDoc, req, function () { run(null); });
                    run(null);
                });
            };
            if (cfgItem.beforeDelete) return cfgItem.beforeDelete(id, where, req, step);
            step(null, null);
        }
        function afterPrecheck() {
            var async = require('async');
            async.eachSeries(allowed, writeOne, function () {
                var succeeded = results.filter(function (r) { return r.ok; }).map(function (r) { return r.id; });
                var failed = results.length - succeeded.length;
                kit.audit(req, {
                    action: 'batch', target: cfgItem.target, objectId: succeeded,
                    detail: 'action=' + action + ',failed=' + failed + ',changed:status',
                    result: succeeded.length > 0
                }, function () {
                    res.json({success: true, results: results, failed: failed});
                });
            });
        }
        // 越权预检查（L2）：仅归属型资源 + 非管理员需要；查不到即拒绝，且在任何写入前完成。
        if (cfgItem.desc.owner && !(req.session.user && req.session.user.role === 0)) {
            var async = require('async');
            async.map(allowed, function (id, cb) {
                cfgItem.Model.adminFindById(id, where, function (e, doc) {
                    if (e) return cb(null, {id: id, ok: false, msg: '参数格式错误'});
                    cb(null, doc ? {id: id, ok: true} : {id: id, ok: false, msg: '目标不存在或无权操作'});
                });
            }, function (e, checked) {
                if (e) return sendErr(res, e, 'batch.precheck', 'success', false);
                allowed = checked.filter(function (x) { return x.ok; }).map(function (x) { return x.id; });
                results = results.concat(checked.filter(function (x) { return !x.ok; }));
                afterPrecheck();
            });
        } else afterPrecheck();
    };
};

// CSV 导入导出已拆到 controllers/adminIo.js（单文件 ≤300 行 + 单一职责）；
// 二者共用本文件的 buildWhere / _internal，保证查询与错误口径一致。