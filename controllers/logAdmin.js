// Log（公告）后台治理能力（SPEC §4.7）。从 log.js 拆出以满足单文件 ≤300 行门禁。
// 审计统一走 AuditLog（kit.audit），绝不写进 Log.js 公告集合（K01）。
var Log = require('./../models/Log.js');
var kit = require('./adminKit');
var crud = require('./adminCrud');
var io = require('./adminIo');

var logDesc = {
    soft: {status: 0}, search: ['name'], dateField: 'createTime',
    sortWhitelist: ['createTime', 'modifyTime', 'name'], defaultSortBy: 'createTime'
};
// 方案D：纯增量后台 JSON 列表端点（GET /manager/log/list），复用本文件 logDesc。
// 不传 view → crud.list 走纯 JSON；desc.soft 原样保留；statusRange 沿用 log.status/batch 的 [0,1]。
exports.adminList = crud.list({
    Model: Log, desc: logDesc, target: 'log', statusRange: [0, 1],
    sortWhitelist: logDesc.sortWhitelist, defaultSortBy: logDesc.defaultSortBy
});
// 方案D-SSR：管理员专用页面级筛选/排序（GET /manager/log/admin）。
// 新的 crud.list SSR 实例，view 指向升级后的老模板 manager/log；
// 原始 docs 已含 _id/name/createTime/modifyTime/status，无需 decorate。
exports.adminPage = crud.list({
    Model: Log, desc: logDesc, target: 'log', statusRange: [0, 1],
    sortWhitelist: logDesc.sortWhitelist, defaultSortBy: logDesc.defaultSortBy,
    view: 'manager/log', urlPrefix: '/manager/log/admin',
    title: '公告管理', currentMenu: 'log'
});
function finish(req, res, metaObj, body) {
    kit.audit(req, metaObj, function () { res.json(body); });
}
// content 字段是 Object，导出按纯文本处理：去 HTML 标签 + 控制字符（防展示型 XSS，§4.7）。
function plainText(v) {
    return String(v == null ? '' : (typeof v === 'object' && v !== null ? JSON.stringify(v) : v))
        .replace(/<[^>]*>/g, '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

// 可选独立编辑：复用 Log.update({_id,name,content},cb) 的正确签名，不取代 /manager/log/add 带 id 分支。
exports.modify = function (req, res) {
    var chk = kit.requireId(req.body.id);
    var name = kit.str(req.body.name, 200, true);
    var content = (req.body.content || '').trim();
    var metaObj = {action: 'update', target: 'log', objectId: [], detail: 'changed:name,content', result: false};
    function done(body, ok) { metaObj.result = !!ok; finish(req, res, metaObj, body); }
    if (!chk.ok) return res.status(400).json({success: false, msg: '参数错误'});
    metaObj.objectId = [chk.id];
    if (!name) return done({success: false, msg: '标题不能为空'}, false);
    if (!content) return done({success: false, msg: '内容不能为空'}, false);
    Log.update({"_id": chk.id, "name": name, "content": content}, function (err) {
        if (err) {
            var n = kit.normalizeDaoError(err, 'log.modify');
            return done({success: false, msg: n.status === 500 ? '编辑公告失败' : n.msg}, false);
        }
        done({success: true, msg: '编辑公告成功'}, true);
    });
};
exports.status = crud.status({
    Model: Log, desc: logDesc, target: 'log', shape: 'success', statusRange: [0, 1],
    statusMsg: '状态更新成功'
});
exports.batch = crud.batch({
    Model: Log, desc: logDesc, target: 'log', shape: 'success', statusRange: [0, 1]
});
exports['import'] = io.import({
    Model: Log, target: 'log', columns: ['name', 'content', 'status'],
    rowToDoc: function (cells, ctx) {
        var name = kit.csv.sanitize(cells[0]);
        var content = plainText(cells[1]);
        if (!name) throw new Error('标题不能为空');
        if (!content) throw new Error('内容不能为空');
        return {__row: ctx.row, name: name, content: content,
            status: kit.intInRange(cells[2], 0, 1, 0),
            createTime: new Date(), modifyTime: new Date()};
    },
    insertDoc: function (doc, cb) {
        Log.findByName(doc.name, function (err, exists) {
            if (err) return cb(err);
            if (exists) return cb(new Error('已存在该标题的公告'));
            Log.save(doc, function (e, saved) {
                if (e) return cb(e);
                cb(null, saved && saved._id ? String(saved._id) : '');
            });
        });
    }
});
exports['export'] = io.export({
    Model: Log, target: 'log', desc: logDesc,
    columns: ['name', 'content', 'status', 'createTime'],
    docToRow: function (d) {
        return [d.name || '', plainText(d.content), d.status,
            d.createTime ? d.createTime.toISOString() : ''];
    }
});
