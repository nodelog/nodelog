var Category = require('./../models/Category.js');
var cmsUtils = require('./cmsUtils.js');
var Content = require('./../models/Content.js');
var kit = require('./adminKit');
var crud = require('./adminCrud');
var io = require('./adminIo');

var categoryDesc = {soft: {status: 0}, search: ['name', 'slug'], dateField: 'createTime',
    sortWhitelist: ['order', 'name', 'createTime'], defaultSortBy: 'order', defaultOrder: 'asc'};
// 方案D：纯增量后台 JSON 列表端点（GET /manager/category/list），复用本文件 categoryDesc。
// 不传 view → crud.list 走纯 JSON；desc.soft 原样保留；statusRange 沿用 category.status/batch 的 [0,1]。
exports.adminList = crud.list({
    Model: Category, desc: categoryDesc, target: 'category', statusRange: [0, 1],
    sortWhitelist: categoryDesc.sortWhitelist, defaultSortBy: categoryDesc.defaultSortBy
});
// 方案D-SSR：管理员专用页面级筛选/排序（GET /manager/category/admin）。
// 新的 crud.list SSR 实例，view 指向升级后的老模板 manager/category；
// 原始 docs 已含 _id/name/createTime/modifyTime/status，无需 decorate。
exports.adminPage = crud.list({
    Model: Category, desc: categoryDesc, target: 'category', statusRange: [0, 1],
    sortWhitelist: categoryDesc.sortWhitelist, defaultSortBy: categoryDesc.defaultSortBy,
    view: 'manager/category', urlPrefix: '/manager/category/admin',
    title: '分类管理', currentMenu: 'category'
});

function finish(req, res, meta, body) {
    kit.audit(req, meta, function () { res.json(body); });
}
function categoryMeta(action, id, detail, result) {
    return {action: action, target: 'category', objectId: id ? [String(id)] : [], detail: detail || 'changed:name,slug,order,status', result: result !== false};
}
function businessError(msg) { var e = new Error(msg); e.userMsg = msg; return e; }

// 文章引用 + 子分类双重检查后软删。单条删除与批量删除【共用】此函数（G02/G03：批量不得绕过引用检查）。
function deleteOneCategory(id, cb) {
    Content.getCountByCategoryOnly(id, function (err, count) {
        if (err) return cb(businessError('删除失败'));
        if (count > 0) return cb(businessError('此类别被使用，无法删除'));
        Category.delete(id, function (err2) {
            if (!err2) return cb(null, '删除成功');
            if (err2.message === 'HAS_CHILD') return cb(businessError('该分类下还有子分类，无法删除'));
            cb(businessError('删除失败'));
        });
    });
}
exports.deleteOneCategory = deleteOneCategory; // 供回归/测试直接引用

var getCount = function (callback) {
    Category.getCount(function (err, total) { callback(err, total); });
};
exports.findByPage = function (req, res) {
    getCount(function (err, total) {
        var pageObj = cmsUtils.page(req.query.page, total);
        var page = pageObj.page;
        var totalPage = pageObj.totalPage;
        var currentMenu = "category";
        if (!err && totalPage > 0) {
            Category.findByPage(page, function (err, docs) {
                res.render("manager/category", {docs: docs, title: "分类管理", page: page, totalPage: totalPage, url: "/manager/category?", currentMenu: currentMenu});
            });
        } else {
            console.log("data error");
            res.render("manager/category", {docs: {}, title: "分类管理", page: page, totalPage: totalPage, currentMenu: currentMenu});
        }
    });
};
// 公开 /category/all：{docs} 结构不变，绝不加鉴权
exports.findAll = function (req, res) {
    Category.findAll(function (err, docs) {
        if (!err) res.json({docs: docs});
        else { console.log(err.message + "\n category load failure"); res.json({docs: {}}); }
    });
};

exports.delete = function (req, res) {
    var chk = kit.requireId(req.body.id);
    if (!chk.ok) return res.status(400).json({success: false, msg: '参数错误'});
    deleteOneCategory(chk.id, function (err, msg) {
        var ok = !err;
        finish(req, res, categoryMeta('delete', chk.id, 'changed:status', ok),
            {success: ok, msg: ok ? msg : (err.userMsg || '删除失败')});
    });
};

var findByName = function (name, callback) {
    Category.findByName(name, function (err, obj) { callback(err, obj); });
};
//add —— 保留 {success,msg}
exports.add = function (req, res) {
    var name = (req.body.name || '').trim();
    var slug = (req.body.slug || '').trim();
    var parent = (req.body.parent && req.body.parent !== '0' && req.body.parent !== '') ? req.body.parent : null;
    var description = (req.body.description || '').trim();
    var cover = req.body.cover || '';
    var order = kit.intInRange(req.body.order, -1000000, 1000000, 0); // C08 越界归一化
    var meta = categoryMeta('create', null, 'changed:name,slug,parent,order,status');
    function done(body, ok, id) {
        meta.result = !!ok;
        if (id) meta.objectId = [String(id)];
        finish(req, res, meta, body);
    }
    if (!name) return done({success: false, msg: '分类名称不能为空'}, false);
    if (parent && !kit.isObjectId(parent)) return done({success: false, msg: '父分类参数错误'}, false);
    findByName(name, function (err, obj) {
        if (err) return done({success: false, msg: '添加分类失败'}, false);
        if (obj != null) return done({success: false, msg: '分类已经存在'}, false);
        Category.save({name: name, slug: slug, parent: parent, description: description,
            cover: cover, order: order, status: 0, createTime: new Date(), modifyTime: new Date()},
            function (e, saved) {
                if (e) {
                    var n = kit.normalizeDaoError(e, 'category.add');
                    return done({success: false, msg: n.status === 500 ? '添加分类失败' : n.msg}, false);
                }
                done({success: true, msg: '添加分类成功'}, true, saved && saved._id);
            });
    });
};
//update —— F02：编辑自身判重（排除自身 id），不再把自己判为「分类名称已经存在」
exports.update = function (req, res) {
    var chk = kit.requireId(req.body.id);
    var name = (req.body.name || '').trim();
    var slug = (req.body.slug || '').trim();
    var parent = (req.body.parent && req.body.parent !== '0' && req.body.parent !== '') ? req.body.parent : null;
    var description = (req.body.description || '').trim();
    var cover = req.body.cover || '';
    var order = kit.intInRange(req.body.order, -1000000, 1000000, 0);
    var meta = categoryMeta('update', chk.ok ? chk.id : null, 'changed:name,slug,parent,order');
    function done(body, ok) { meta.result = !!ok; finish(req, res, meta, body); }
    if (!chk.ok) return res.status(400).json({success: false, msg: '参数错误'});
    if (!name) return done({success: false, msg: '分类名称不能为空'}, false);
    if (parent && !kit.isObjectId(parent)) return done({success: false, msg: '父分类参数错误'}, false);
    // 关键改动：findByName -> findByNameExclude(name, id, cb)
    Category.findByNameExclude(name, chk.id, function (err, obj) {
        if (err) return done({success: false, msg: '修改分类失败'}, false);
        if (obj != null) return done({success: false, msg: '分类名称已经存在'}, false);
        Category.update(chk.id, {name: name, slug: slug, parent: parent,
            description: description, cover: cover, order: order}, function (e) {
            if (e) {
                var n = kit.normalizeDaoError(e, 'category.update');
                return done({success: false, msg: n.status === 500 ? '修改分类失败' : n.msg}, false);
            }
            done({success: true, msg: '修改分类成功'}, true);
        });
    });
};

// ---------------- 新增后台能力（A）----------------
exports.detail = crud.detail({
    Model: Category, desc: categoryDesc, target: 'category', view: 'manager/detail',
    titleFn: function (d) { return d.name; }, currentMenu: 'category'
});
exports.status = crud.status({
    Model: Category, desc: categoryDesc, target: 'category', shape: 'success', statusRange: [0, 1], statusMsg: '状态更新成功'
});
// 批量：整批一条 batch 审计由 crud.batch 负责；逐条复用 deleteOneCategory（引用检查不绕过）。
exports.batch = crud.batch({
    Model: Category, desc: categoryDesc, target: 'category', shape: 'success', statusRange: [0, 1],
    one: function (id, action, status, where, req, cb) {
        if (action === 'delete') return deleteOneCategory(id, function (e, msg) { cb(e, msg); });
        Category.adminUpdate(id, where, {status: status}, function (err, changed) {
            cb(err || (changed === 0 ? businessError('目标不存在') : null), '状态更新成功');
        });
    }
});
exports['import'] = io.import({
    Model: Category, target: 'category',
    columns: ['name', 'slug', 'parent', 'description', 'cover', 'order', 'status'],
    rowToDoc: function (cells, ctx) {
        var name = kit.csv.sanitize(cells[0]);
        if (!name) throw new Error('分类名称不能为空');
        var parent = kit.csv.sanitize(cells[2]);
        if (parent && !kit.isObjectId(parent)) throw new Error('父分类 id 非法');
        return {
            __row: ctx.row, name: name, slug: kit.csv.sanitize(cells[1]),
            parent: parent || null, description: kit.csv.sanitize(cells[3]),
            cover: kit.csv.sanitize(cells[4]),
            order: kit.intInRange(cells[5], -1000000, 1000000, 0),
            status: kit.intInRange(cells[6], 0, 1, 0),
            createTime: new Date(), modifyTime: new Date()
        };
    },
    insertDoc: function (doc, cb) {
        Category.findByName(doc.name, function (err, exists) {
            if (err) return cb(err);
            if (exists) return cb(new Error('分类已经存在'));
            Category.save(doc, function (e, saved) {
                if (e) return cb(e);
                cb(null, saved && saved._id ? String(saved._id) : '');
            });
        });
    }
});
exports['export'] = io.export({
    Model: Category, target: 'category', desc: categoryDesc,
    columns: ['name', 'slug', 'parent', 'description', 'cover', 'order', 'status'],
    docToRow: function (d) {
        return [d.name, d.slug || '', d.parent ? String(d.parent) : '', d.description || '',
            d.cover || '', d.order || 0, d.status];
    }
});
