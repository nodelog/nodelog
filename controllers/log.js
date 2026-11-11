var async = require("async");
var utils = require("util");
var Log = require('./../models/Log.js');
var cmsUtils = require('./cmsUtils.js');
var kit = require('./adminKit');
var getCount = function (callback) {
    Log.getCount(function (err, total) {
        callback(err, total);
    });
};
exports.logCount = function(req, res) {
    getCount(function(err, count) {
        res.json({count:count});
    });
}
exports.findByPage = function (req, res) {
    var total = 0, page = 0, totalPage = 0, docs = {};
    async.auto({
        totalCount: function (callback, results) {
            getCount(function (err, count) {
                total = count;
                callback(null);
            });
        },
        pageDocs: ["totalCount", function (callback, results) {
            var pageObj = cmsUtils.page(req.query.page, total);
            page = pageObj.page;
            totalPage = pageObj.totalPage;
            if (totalPage > 0) {
                Log.findByPage(page, function (err, objects) {
                    docs = objects;
                    callback(null);
                });
            } else {
                callback(null);
            }
        }]
    }, function (err, results) {
        var view = req.query.view;
        if (!view) {
            view = (req.path.indexOf('/manager') === 0) ? 'manager/log' : 'log';
        }
        var title = "系统公告";
        if (view.indexOf("manager") >= 0) {
            title = "公告管理";
        }
        res.render(view, {docs: docs, title: title, page: page, totalPage: totalPage, total: total, url:"/"+view+"?view="+view+"&",currentMenu:"log"});
    });

};


// 审计统一写 AuditLog，不写进 Log.js 公告集合（K01）。
function logFinish(req, res, metaObj, body) {
    kit.audit(req, metaObj, function () { res.json(body); });
}
exports.delete = function (req, res) {
    var chk = kit.requireId(req.body.id);
    if (!chk.ok) return res.status(400).json({'success': false, 'msg': '参数错误'});
    Log.delete(chk.id, function (err) {
        var ok = !err;
        logFinish(req, res, {action: 'delete', target: 'log', objectId: [chk.id],
            detail: 'changed:status', result: ok},
            {'success': ok, 'msg': ok ? "删除成功" : "删除失败"});
    });
};

exports.findById = function (req, res) {
    var id = req.query.id;
    var doc = {};
    Log.findById(id, function (err, obj) {
        if (!err) {
            doc = obj;
        } else {
            console.log("data err");
        }
        var view = req.query.view;
        if (!view) {
            view = (req.path.indexOf('/manager') === 0) ? 'manager/logDetail' : 'logDetail';
        }
        res.render(view,{title: doc && doc.name ? doc.name : '公告不存在', doc:doc});
    });
};

var findByName = function (name, callback) {
    Log.findByName(name, function (err, obj) {
        callback(err, obj);
    });
};
// 兼容不可移除：/manager/log/add 带 id 即编辑（common.js:376 + addLog.ejs 在用）。
// 响应键集合严格不变：新增/冲突失败 {success,msg}；新增成功 {success,msg}；编辑成功 {success,msg,id}。
exports.add = function (req, res) {
    var id = req.body.id;
    var name = (req.body.name || '').trim();
    var oldName = req.body.oldName;
    var content = (req.body.content || '').trim();
    var editing = id != null;
    var action = editing ? 'update' : 'create';
    var metaObj = {action: action, target: 'log', objectId: [], detail: 'changed:name,content', result: false};
    function done(body, ok, oid) {
        metaObj.result = !!ok;
        if (oid) metaObj.objectId = [String(oid)];
        logFinish(req, res, metaObj, body);
    }
    function conflict() { return {success: false, msg: "已存在该标题的公告"}; }
    if (name === "") return done({success: false, msg: "标题不能为空"}, false);
    if (content === "") return done({success: false, msg: "内容不能为空"}, false);
    findByName(name, function (err, obj) {
        if (err) return done({success: false, msg: editing ? "编辑公告失败" : "发布公告失败"}, false);
        if (id == null) {//add
            if (obj !== null) return done(conflict(), false);
            Log.save({"name": name, "content": content}, function (err2, saved) {
                var ok = !err2;
                if (!ok) console.log(err2.message);
                done({success: ok, msg: ok ? "发布公告成功" : "发布公告失败"}, ok, saved && saved._id);
            });
        } else {//update 兼容分支：校验 id，沿用 oldName 判重逻辑
            var chk = kit.requireId(id);
            if (!chk.ok) return res.status(400).json({success: false, msg: '参数错误'});
            if (obj !== null && String(obj._id) !== chk.id && obj.name != oldName) {
                return done(conflict(), false, chk.id);
            }
            var u = {"_id": chk.id, "name": name, "content": content};
            Log.update(u, function (err2) {
                var ok = !err2;
                if (!ok) console.log(err2.message); else console.log("success");
                // 兼容红线：原响应字面量带 id:u.id，但 u 只有 _id → id 恒 undefined，JSON 序列化后 id 键被省略，
                // 实际顶层键为 {success,msg}。此处保留 u.id（undefined）以维持键集合零破坏，不擅自补有值 id。
                done({success: ok, msg: ok ? "编辑公告成功" : "编辑公告失败", id: u.id}, ok, chk.id);
            });
        }
    });
};
// 后台新增能力（modify/status/batch/import/export）合并导出；死代码 exports.update（签名不符、不可达）已删除。
Object.assign(exports, require('./logAdmin'));