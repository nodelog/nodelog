var async = require('async');
var Tag = require('./../models/Tag');
var Content = require('./../models/Content');
var constants = require('./../models/constants');
var cmsUtils = require('./cmsUtils');
var kit = require('./adminKit');
var crud = require('./adminCrud');
var io = require('./adminIo');

// ---------- 前台共享接口（保持公开，绝不加鉴权；仅 findAll 已带 status:0 过滤）----------
// 标签页：/tag/:slug （slug 或名称均可）
// 设计原则：直接实时查询 Content，绝不使用 Tag.count 等任何缓存计数；响应头禁止缓存。
exports.findBySlug = function (req, res) {
    var slug = req.params.slug;
    var page = parseInt(req.query.page, 10) || 1;
    var sessionUser = req.session.user;

    function renderTag(tag) {
        // 禁止任何层（浏览器/CDN/代理）缓存该动态页面，保证每次都是实时数据
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        // 直接实时查：公开可见 + （已登录则含自己的草稿/待审），全部基于 Content 真实数据
        Content.getCountByTag(tag.name, sessionUser, function (e1, total) {
            total = total || 0;
            var perPage = constants.PER_PAGE_COUNT || 10;
            var totalPage = total > 0 ? Math.ceil(total / perPage) : 1;
            var p = Math.min(Math.max(page, 1), totalPage);
            if (total <= 0) {
                return res.render('tag', {
                    tag: tag, docs: [], title: '标签：' + tag.name,
                    page: 1, totalPage: 1, total: 0,
                    url: '/tag/' + encodeURIComponent(slug) + '?'
                });
            }
            Content.findByTag(p, tag.name, sessionUser, function (e2, docs) {
                res.render('tag', {
                    tag: tag, docs: docs || [], title: '标签：' + tag.name,
                    page: p, totalPage: totalPage, total: total,
                    url: '/tag/' + encodeURIComponent(slug) + '?'
                });
            });
        });
    }

    Tag.findBySlug(slug, function (err, tag) {
        if (err || !tag) {
            // 回退：按名称查找（兼容未 slugify 的链接）
            Tag.findByName(decodeURIComponent(slug), function (e2, byName) {
                if (e2 || !byName) { res.redirect('/error'); return; }
                renderTag(byName);
            });
            return;
        }
        renderTag(tag);
    });
};
// 标签云（JSON，供前端/首页调用）—— 响应 {docs} 结构不变（I-3/I-5）
exports.list = function (req, res) {
    Tag.findAll(function (err, docs) {
        if (err) return res.json({docs: []});
        res.json({docs: docs});
    });
};

// 一键重算全部标签计数（委托唯一实现 syncTags，覆盖写，幂等安全）。供后台「重新计算标签计数」按钮调用。
exports.reconcile = function (req, res) {
    Tag.reconcileAllCounts(function (err) {
        if (err) return res.json({success: false, msg: err.message});
        res.json({success: true, msg: '标签计数已重新计算'});
    });
};

// ---------- 后台管理（全部 A）----------
var tagDesc = {soft: {status: 0}, search: ['name', 'slug'], dateField: 'createTime',
    sortWhitelist: ['count', 'name', 'createTime'], defaultSortBy: 'count'};

function finish(req, res, meta, body) {
    kit.audit(req, meta, function () { res.json(body); });
}
function tagMeta(action, id, detail, result) {
    return {action: action, target: 'tag', objectId: id ? [String(id)] : [], detail: detail || 'changed:name,slug,status', result: result !== false};
}
function recount(name, note, cb) {
    // 唯一 count 写入者 syncTags 的薄编排入口；失败不阻断主写（§3.7）
    Tag.reconcileForContent([], [name], function (err) {
        if (err) console.warn('[tag] reconcile failed (' + note + '): ' + err.message);
        cb(null);
    });
}
function conflict(err) { return kit.normalizeDaoError(err, 'tag.write', '标签标识已存在'); }

exports.adminList = crud.list({
    Model: Tag, desc: tagDesc, view: 'manager/tag', title: '标签管理',
    currentMenu: 'tag', urlPrefix: '/manager/tag',
    sortWhitelist: tagDesc.sortWhitelist, defaultSortBy: 'count', statusRange: [0, 1]
});
exports.detail = crud.detail({
    Model: Tag, desc: tagDesc, target: 'tag', view: 'manager/detail',
    titleFn: function (d) { return d.name; }, currentMenu: 'tag'
});

// 新增：slug 唯一冲突 -> 409「标签标识已存在」（F02/唯一约束）
exports.add = function (req, res) {
    var name = kit.str(req.body.name, 100, true);
    var slug = kit.str(req.body.slug, 200, false) || Tag.slugify(name || '');
    var status = kit.intInRange(req.body.status, 0, 1, 0);
    var meta = tagMeta('create', null, 'changed:name,slug,status');
    function done(body, ok, id) {
        meta.result = !!ok;
        if (id) meta.objectId = [String(id)];
        finish(req, res, meta, body);
    }
    if (!name || !slug) return done({success: false, msg: '标签名称不能为空'}, false);
    Tag.findByName(name, function (err, exists) {
        if (err) {
            var n = conflict(err);
            return res.status(n.status).json({success: false, msg: n.msg});
        }
        if (exists) return done({success: false, msg: '标签名称已存在'}, false);
        Tag.save({name: name, slug: slug, status: status, count: 0,
            createTime: new Date(), modifyTime: new Date()}, function (e, saved) {
            if (e) {
                var n2 = conflict(e);
                return res.status(n2.status).json({success: false, msg: n2.msg});
            }
            var id = saved && saved._id ? String(saved._id) : '';
            recount(name, 'add', function () {
                done({success: true, msg: '添加标签成功', id: id}, true, id);
            });
        });
    });
};

// 编辑自身判重：findByNameExclude 排除自身 id（F02）
exports.modify = function (req, res) {
    var chk = kit.requireId(req.body.id);
    var name = kit.str(req.body.name, 100, true);
    var slug = kit.str(req.body.slug, 200, false);
    var status = kit.intInRange(req.body.status, 0, 1, null);
    var meta = tagMeta('update', chk.ok ? chk.id : null, 'changed:name,slug,status');
    function done(body, ok) { meta.result = !!ok; finish(req, res, meta, body); }
    if (!chk.ok) return res.status(400).json({success: false, msg: '参数错误'});
    if (!name) return done({success: false, msg: '标签名称不能为空'}, false);
    Tag.adminFindById(chk.id, {status: 0}, function (err, doc) {
        if (err || !doc) return done({success: false, msg: '标签不存在'}, false);
        var newSlug = slug || doc.slug || Tag.slugify(name);
        var newStatus = (status === null) ? doc.status : status;
        Tag.findByNameExclude(name, chk.id, function (e2, dup) {
            if (e2) {
                var n0 = conflict(e2);
                return res.status(n0.status).json({success: false, msg: n0.msg});
            }
            if (dup) return done({success: false, msg: '标签名称已存在'}, false);
            Tag.adminUpdate(chk.id, {status: 0}, {name: name, slug: newSlug, status: newStatus}, function (e3, changed) {
                if (e3) {
                    var n = conflict(e3);
                    return res.status(n.status).json({success: false, msg: n.msg});
                }
                if (!changed) return done({success: false, msg: '标签不存在'}, false);
                // 改名后按同一口径重算（大小写不敏感），不留旧标签脏计数（§3.7）
                Tag.reconcileForContent([doc.name], [name], function (re) {
                    if (re) console.warn('[tag.modify] reconcile failed: ' + re.message);
                    done({success: true, msg: '修改标签成功', id: chk.id}, true);
                });
            });
        });
    });
};

exports.delete = crud.remove({
    Model: Tag, desc: tagDesc, target: 'tag', shape: 'success', deleteMsg: '删除成功',
    notFoundMsg: '标签不存在或无权删除'
    // 注意：标签软删后【不】触发 reconcile —— syncTags 在 total>0 时会自动复活，
    // 这里若重算会立刻把刚禁用的标签恢复（与管理员禁用意图相反）。
});
exports.status = crud.status({Model: Tag, desc: tagDesc, target: 'tag', shape: 'success', statusRange: [0, 1], statusMsg: '状态更新成功'});
exports.batch = crud.batch({Model: Tag, desc: tagDesc, target: 'tag', shape: 'success', statusRange: [0, 1]});

exports['import'] = io.import({
    Model: Tag, target: 'tag', columns: ['name', 'slug', 'count', 'status'],
    rowToDoc: function (cells, ctx) {
        var name = kit.csv.sanitize(cells[0]);
        if (!name) throw new Error('标签名称不能为空');
        return {
            __row: ctx.row, name: name,
            slug: kit.csv.sanitize(cells[1]) || Tag.slugify(name),
            status: kit.intInRange(cells[3], 0, 1, 0),
            count: 0, // 不信任导入的 count，导入后由 syncTags 重算覆盖（§4.3）
            createTime: new Date(), modifyTime: new Date()
        };
    },
    insertDoc: function (doc, cb) {
        Tag.findByName(doc.name, function (err, exists) {
            if (err) return cb(conflict(err));
            if (exists) return cb(new Error('标签名称已存在'));
            Tag.save(doc, function (e, saved) {
                if (e) return cb(conflict(e));
                recount(doc.name, 'import', function () {
                    cb(null, saved && saved._id ? String(saved._id) : '');
                });
            });
        });
    }
});
exports['export'] = io.export({
    Model: Tag, target: 'tag', desc: tagDesc,
    columns: ['name', 'slug', 'count'],
    docToRow: function (d) { return [d.name, d.slug || '', d.count || 0]; }
});
