var async = require("async");
var utils = require("util");
var Link = require('./../models/Link.js');
var User = require('./../models/User.js');
var cmsUtils = require('./cmsUtils.js');
var kit = require('./adminKit');
var crud = require('./adminCrud');
var io = require('./adminIo');

// URL 协议白名单（C07）：只许 http/https 绝对地址与站内绝对路径；拒 //evil、javascript:、data:、vbscript:
function safeUrl(u) {
    u = String(u == null ? '' : u).trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (/^\/(?!\/)/.test(u)) return u;
    return null;
}

var linkDesc = {soft: {status: 0}, search: ['name', 'url'], dateField: 'createTime',
    sortWhitelist: ['createTime', 'name'], defaultSortBy: 'createTime'};

function finish(req, res, meta, body) {
    kit.audit(req, meta, function () { res.json(body); });
}
function linkMeta(action, id, detail, result) {
    return {action: action, target: 'link', objectId: id ? [String(id)] : [], detail: detail || 'changed:name,url,blank', result: result !== false};
}

// 写接口仍为 /manager/link/save（带 id 即编辑），{success,msg} 键集合不变（§5.3 差异 1）
exports.save = function (req, res) {
    var id = req.body.id;
    var name = kit.csv.sanitize(req.body.name); // 去 HTML 标签，防存储型 XSS（C06）
    var url = safeUrl(req.body.url);
    var blank = kit.intInRange(req.body.blank, 0, 1, 1); // 现状默认 1（link.js:12-14）
    var editing = cmsUtils.isNotBlank(id);
    var meta = linkMeta(editing ? 'update' : 'create', editing && kit.isObjectId(id) ? id : null,
        'changed:name,url,blank');
    function done(body, ok, oid) {
        meta.result = !!ok;
        if (oid) meta.objectId = [String(oid)];
        finish(req, res, meta, body);
    }
    if (!name) return done({success: false, msg: '名称不能为空'}, false);
    if (!url) return done({success: false, msg: '链接地址协议不被允许'}, false);
    if (editing) {
        var chk = kit.requireId(id);
        if (!chk.ok) return res.status(400).json({success: false, msg: '参数错误'});
        Link.update({id: chk.id, name: name, url: url, blank: blank}, function (err) {
            if (err) {
                var n = kit.normalizeDaoError(err, 'link.update');
                return done({success: false, msg: n.status === 500 ? '更新失败' : n.msg}, false, chk.id);
            }
            done({success: true, msg: '更新成功'}, true, chk.id);
        });
    } else {
        Link.save({name: name, url: url, blank: blank, status: 0,
            createTime: new Date(), modifyTime: new Date()}, function (err, saved) {
            if (err) {
                var n2 = kit.normalizeDaoError(err, 'link.save');
                return done({success: false, msg: n2.status === 500 ? '保存失败' : n2.msg}, false);
            }
            done({success: true, msg: '保存成功'}, true, saved && saved._id);
        });
    }
};

// 软删（D8）：响应 {success,msg} 不变；Link.delete DAO 已从 remove 改 update(status=1)
exports.delete = function (req, res) {
    var chk = kit.requireId(req.body.id);
    if (!chk.ok) return res.status(400).json({success: false, msg: '参数错误'});
    Link.delete(chk.id, function (err) {
        var ok = !err;
        var meta = linkMeta('delete', chk.id, 'changed:status', ok);
        finish(req, res, meta, {success: ok, msg: ok ? '删除成功' : '删除失败'});
    });
};

// 公开 /link/list：保持 {success,data}，绝不加鉴权；可选 page 走后台分页 DAO
exports.findAll = function (req, res) {
    var q = req.query || {};
    var page = parseInt(q.page != null ? q.page : (req.body && req.body.page), 10);
    if (!isNaN(page) && page > 0) {
        return Link.findByPage(page, function (err, docs) {
            if (err) return res.json({success: false, data: []});
            res.json({success: true, data: docs});
        });
    }
    Link.findAll(function (err, docs) {
        if (!err) res.json({success: true, data: docs});
        else res.json({success: false, data: []});
    });
};

// ---------- 新增后台能力（A）----------
// 后台分页列表：POST /manager/link/list，与公开 /link/list 并存不混，响应带 page/totalPage/total。
exports.adminList = function (req, res) {
    var q = Object.assign({}, req.query || {}, req.body || {});
    var parsed = kit.parseListQuery(q, {
        sortWhitelist: linkDesc.sortWhitelist, defaultSortBy: 'createTime', statusRange: [0, 1]
    });
    if (parsed.error) return res.status(400).json({success: false, msg: parsed.error});
    var where = crud.buildWhere(linkDesc, parsed.filters, req);
    var sort = {}; sort[parsed.sortBy] = (parsed.order === 'asc' ? 1 : -1);
    Link.adminList(where, {page: parsed.page, pageSize: parsed.pageSize, sort: sort}, function (err, result) {
        if (err) {
            var n = kit.normalizeDaoError(err, 'link.list');
            return res.status(n.status).json({success: false, msg: n.msg});
        }
        res.json({success: true, data: result.docs, page: result.page,
            totalPage: result.totalPage, total: result.total});
    });
};
exports.detail = crud.detail({
    Model: Link, desc: linkDesc, target: 'link', view: 'manager/detail',
    titleFn: function (d) { return d.name; }, currentMenu: 'link'
});
exports.status = crud.status({Model: Link, desc: linkDesc, target: 'link', shape: 'success', statusRange: [0, 1], statusMsg: '状态更新成功'});
exports.batch = crud.batch({Model: Link, desc: linkDesc, target: 'link', shape: 'success', statusRange: [0, 1]});

exports['import'] = io.import({
    Model: Link, target: 'link', columns: ['name', 'url', 'blank', 'status'],
    rowToDoc: function (cells, ctx) {
        var name = kit.csv.sanitize(cells[0]);
        var url = safeUrl(cells[1]);
        if (!name) throw new Error('名称不能为空');
        if (!url) throw new Error('链接地址协议不被允许');
        return {
            __row: ctx.row, name: name, url: url,
            blank: kit.intInRange(cells[2], 0, 1, 1),
            status: kit.intInRange(cells[3], 0, 1, 0),
            createTime: new Date(), modifyTime: new Date()
        };
    },
    insertDoc: function (doc, cb) {
        Link.save(doc, function (err, saved) {
            if (err) return cb(err);
            cb(null, saved && saved._id ? String(saved._id) : '');
        });
    }
});
exports['export'] = io.export({
    Model: Link, target: 'link', desc: linkDesc,
    columns: ['name', 'url', 'blank', 'status', 'createTime'],
    docToRow: function (d) {
        return [d.name, d.url, d.blank, d.status, d.createTime ? d.createTime.toISOString() : ''];
    }
});
