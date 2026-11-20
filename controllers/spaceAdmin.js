// 后台知识库管理：列表 / 新增 / 编辑 / 软删。全部 A（管理员）。
// 复用 Space DAO 与 kit 工具，不做第二套校验口径。
var Space = require('./../models/Space.js');
var kit = require('./adminKit');
var constants = require('./../models/constants.js');

function audit(req, action, id, name, result) {
    kit.audit(req, {
        action: action, target: 'space', objectId: id ? [String(id)] : [],
        detail: 'name=' + name, result: result
    }, function () {});
}

function normalizeSlug(raw, name) {
    var s = Space.slugify(String(raw || '').trim() || name);
    return s.slice(0, 60);
}

// GET /manager/wiki —— 统一工作台（独立全宽页；tabs：知识库 / 文档编辑 / 导入）
exports.workspace = function (req, res) {
    var Content = require('./../models/Content.js');
    Space.findVisible(req.session.user, function (err, spaces) {
        if (err) console.error('[spaceAdmin.workspace] ' + err.message);
        var list = err ? [] : (spaces || []);
        if (!list.length) {
            return res.render('manager/wikiWorkspace', {
                title: '知识库工作台', currentMenu: 'wikiSpace',
                spaces: [], pagesBySpace: {}, initialSpace: null
            });
        }
        // 一次查出所有库的页面（含正文），按 spaceId 分组注入，前端切换零往返。
        // 必须走 DAO 方法：Content 是 DAO 实例，没有 Model.find，直接调会抛 TypeError → 进程崩溃 → 502。
        var ids = list.map(function (s) { return s._id; });
        Content.findPagesBySpaces(ids, function (e2, pages) {
            if (e2) console.error('[spaceAdmin.workspace pages] ' + e2.message);
            var grouped = {};
            (pages || []).forEach(function (p) {
                var k = String(p.spaceId);
                (grouped[k] = grouped[k] || []).push(p);
            });
            res.render('manager/wikiWorkspace', {
                title: '知识库工作台', currentMenu: 'wikiSpace',
                spaces: list, pagesBySpace: grouped,
                initialSpace: String(list[0]._id)
            });
        });
    });
};

// GET /manager/wiki/space —— 管理页（保留兼容，重定向到统一工作台）
exports.page = function (req, res) { res.redirect('/manager/wiki'); };

// POST /manager/wiki/space/add
exports.add = function (req, res) {
    var name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({success: false, msg: '名称不能为空'});
    var slug = normalizeSlug(req.body.slug, name);
    if (!slug) return res.status(400).json({success: false, msg: 'slug 不合法'});
    var visibility = req.body.visibility === constants.SPACE_VISIBILITY_PRIVATE
        ? constants.SPACE_VISIBILITY_PRIVATE : constants.SPACE_VISIBILITY_PUBLIC;
    Space.findByName(name, function (e1, byName) {
        if (e1) { var n1 = kit.normalizeDaoError(e1, 'space.add'); return res.status(n1.status).json({success: false, msg: n1.msg}); }
        if (byName) return res.status(409).json({success: false, msg: '知识库名称已存在'});
        Space.findBySlug(slug, function (e2, bySlug) {
            if (e2) { var n2 = kit.normalizeDaoError(e2, 'space.add'); return res.status(n2.status).json({success: false, msg: n2.msg}); }
            if (bySlug) return res.status(409).json({success: false, msg: 'slug 已存在'});
            Space.save({
                name: name, slug: slug, description: String(req.body.description || '').trim(),
                visibility: visibility, owner: req.session.user._id,
                cover: String(req.body.cover || '').trim(),
                order: parseInt(req.body.order, 10) || 0
            }, function (err, saved) {
                if (err || !saved) {
                    var ne = kit.normalizeDaoError(err, 'space.add');
                    audit(req, 'space-add', null, name, false);
                    return res.status(ne.status).json({success: false, msg: ne.msg});
                }
                audit(req, 'space-add', saved._id, name, true);
                return res.status(201).json({success: true, msg: '创建成功', id: saved._id, slug: saved.slug});
            });
        });
    });
};

// POST /manager/wiki/space/update
exports.update = function (req, res) {
    var chk = kit.requireId(req.body.id);
    if (!chk.ok) return res.status(400).json({success: false, msg: '参数错误'});
    var name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({success: false, msg: '名称不能为空'});
    Space.findById(chk.id, function (err, space) {
        if (err || !space) return res.status(404).json({success: false, msg: '知识库不存在'});
        var slug = normalizeSlug(req.body.slug, name);
        Space.findBySlugExclude(slug, chk.id, function (e2, dup) {
            if (e2) { var n2 = kit.normalizeDaoError(e2, 'space.update'); return res.status(n2.status).json({success: false, msg: n2.msg}); }
            if (dup) return res.status(409).json({success: false, msg: 'slug 已存在'});
            var visibility = req.body.visibility === constants.SPACE_VISIBILITY_PRIVATE
                ? constants.SPACE_VISIBILITY_PRIVATE : constants.SPACE_VISIBILITY_PUBLIC;
            Space.update(chk.id, {
                name: name, slug: slug, description: String(req.body.description || '').trim(),
                visibility: visibility, order: parseInt(req.body.order, 10) || 0
            }, function (e3) {
                if (e3) { var n3 = kit.normalizeDaoError(e3, 'space.update'); return res.status(n3.status).json({success: false, msg: n3.msg}); }
                audit(req, 'space-update', chk.id, name, true);
                return res.json({success: true, msg: '保存成功', slug: slug});
            });
        });
    });
};

// POST /manager/wiki/doc/save —— 新建或更新 Wiki 页面（id 存在则更新）
exports.saveDoc = function (req, res) {
    var Content = require('./../models/Content.js');
    var content = require('./content.js');
    var id = String(req.body.id || '').trim();
    if (id === 'null' || id === 'undefined') id = '';
    var spaceId = String(req.body.spaceId || '').trim();
    if (!kit.isObjectId(spaceId)) return res.status(400).json({success: false, msg: '知识库参数错误'});
    var name = String(req.body.name || '').trim();
    var body = String(req.body.content || '').trim();
    if (!name) return res.status(400).json({success: false, msg: '标题不能为空'});
    if (!body) return res.status(400).json({success: false, msg: '正文不能为空'});

    // 复用 buildFields 归一化（docType 固定 wiki、格式 markdown、slug 由标题生成）
    var f = content.buildFields({body: {
        name: name, content: body, contentType: 'markdown', docType: 'wiki',
        spaceId: spaceId, parent: req.body.parent || '',
        tags: req.body.tags || '', slug: String(req.body.slug || '').trim()
    }});
    // 语义链接需要 slug；缺省由标题派生（与 Space.slugify 同源口径）
    if (!f.slug) f.slug = Space.slugify(name).slice(0, 80);
    f.author = req.session.user._id;

    function done(err, docId) {
        if (err) { var ne = kit.normalizeDaoError(err, 'wiki.saveDoc'); return res.status(ne.status).json({success: false, msg: ne.msg}); }
        audit(req, id ? 'wiki-doc-update' : 'wiki-doc-create', docId, name, true);
        return res.json({success: true, msg: id ? '保存成功' : '创建成功', id: docId, slug: f.slug || ''});
    }
    if (id) {
        if (!kit.isObjectId(id)) return res.status(400).json({success: false, msg: '文档 id 错误'});
        f.id = id;
        Content.update(f, req.session.user, function (e) { done(e, id); });
    } else {
        Content.save(f, function (e, saved) { done(e, saved && String(saved._id)); });
    }
};

// POST /manager/wiki/doc/delete —— 软删 Wiki 页面
exports.deleteDoc = function (req, res) {
    var Content = require('./../models/Content.js');
    var chk = kit.requireId(req.body.id);
    if (!chk.ok) return res.status(400).json({success: false, msg: '参数错误'});
    Content.delete(chk.id, req.session.user, function (err) {
        if (err) { var ne = kit.normalizeDaoError(err, 'wiki.deleteDoc'); return res.status(ne.status).json({success: false, msg: ne.msg}); }
        audit(req, 'wiki-doc-delete', chk.id, '', true);
        return res.json({success: true, msg: '删除成功'});
    });
};

// POST /manager/wiki/space/delete —— 软删（有页面时拒绝，防孤儿）
exports.delete = function (req, res) {
    var chk = kit.requireId(req.body.id);
    if (!chk.ok) return res.status(400).json({success: false, msg: '参数错误'});
    var Content = require('./../models/Content.js');
    Content.countBySpace(chk.id, function (e, n) {
        if (e) { var ne = kit.normalizeDaoError(e, 'space.delete'); return res.status(ne.status).json({success: false, msg: ne.msg}); }
        if (n > 0) return res.status(409).json({success: false, msg: '该知识库下还有 ' + n + ' 篇页面，请先移走或删除'});
        Space.delete(chk.id, function (err) {
            if (err) { var n2 = kit.normalizeDaoError(err, 'space.delete'); return res.status(n2.status).json({success: false, msg: n2.msg}); }
            audit(req, 'space-delete', chk.id, '', true);
            return res.json({success: true, msg: '删除成功'});
        });
    });
};
