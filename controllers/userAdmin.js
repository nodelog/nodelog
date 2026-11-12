// User 后台新增能力（SPEC §4.5）。从 user.js 拆出以满足单文件 ≤300 行门禁，
// 由 user.js 末尾 Object.assign 合并导出，对外仍是 user.xxx，路由与前端无感。
// 硬约束：公开注册硬关、login 仅 nodelog、update 成功 {result} 单键 —— 均在主文件保持不变。
var bcrypt = require('bcryptjs');
var User = require('./../models/User.js');
var constants = require('./../models/constants.js');
var kit = require('./adminKit');
var crud = require('./adminCrud');
var io = require('./adminIo');

// 软删边界：User 软删是 status=2（其余资源为 1）。列表看 0/1，排除 2。
var userDesc = {
    soft: {status: {$lt: constants.USER_DELETE_STATUS}},
    search: ['userName', 'realName'], role: true, dateField: 'createTime',
    sortWhitelist: ['createTime', 'modifyTime', 'userName'], defaultSortBy: 'modifyTime'
};
// 方案D：纯增量后台 JSON 列表端点（GET /manager/user/list），复用本文件 userDesc。
// 不传 view → crud.list 走纯 JSON；desc.soft 原样保留（status<2，软删用户不可见）。
// statusRange [0,1]：2=软删只能走 delete，与 user.status/batch 一致（见下方 status/batch 配置）。
// DEF-003：列表 JSON 绝不能回传 password(bcrypt 哈希)/email/phone/openUserId。
// 复用 crud.list 已有的 decorate 钩子（对整页 docs 生效，JSON 与 SSR 两条响应路径都覆盖），
// 用字段白名单重建 POJO，与 detail 的 sanitize() / J02 导出列口径完全一致。
// 白名单只含后台展示必需字段；decorate 先于 respond 执行，故 stripSensitive 不会再删这些字段。
exports.adminList = crud.list({
    Model: User, desc: userDesc, target: 'user', statusRange: [0, 1],
    sortWhitelist: userDesc.sortWhitelist, defaultSortBy: userDesc.defaultSortBy,
    decorate: function (docs, cb) {
        var out = (docs || []).map(function (d) {
            var p = d && d.toObject ? d.toObject() : Object.assign({}, d || {});
            return {
                _id: p._id, userName: p.userName, realName: p.realName,
                role: p.role, status: p.status, createTime: p.createTime
            };
        });
        cb(null, out);
    }
});
// 方案D-SSR：管理员专用页面级筛选/排序（GET /manager/user/admin）。
// 【关键】与上方 DEF-003 六字段 JSON 白名单【分开定义】的 SSR decorate：管理员内部页要展示
// email/phone/modifyTime，但绝不含 password/passwordHash/openUserId/token/secret。
// 白名单重建 POJO（先 toObject），敏感键不进渲染数据；老模板 manager/user 依赖这些字段。
function userSsrDecorate(docs, cb) {
    cb(null, (docs || []).map(function (d) {
        var p = d && d.toObject ? d.toObject() : Object.assign({}, d || {});
        return {
            _id: p._id, userName: p.userName, realName: p.realName,
            role: p.role, status: p.status, createTime: p.createTime,
            modifyTime: p.modifyTime, email: p.email || '', phone: p.phone || ''
        };
    }));
}
exports.adminPage = crud.list({
    Model: User, desc: userDesc, target: 'user', statusRange: [0, 1],
    sortWhitelist: userDesc.sortWhitelist, defaultSortBy: userDesc.defaultSortBy,
    view: 'manager/user', urlPrefix: '/manager/user/admin',
    title: '用户管理', currentMenu: 'user', decorate: userSsrDecorate
});

function encryption(password) {
    return bcrypt.hashSync(String(password), bcrypt.genSaltSync(10));
}
function meta(action, id, detail, result) {
    return {action: action, target: 'user', objectId: id ? [String(id)] : [],
        detail: detail || 'changed:userName,realName,password,role,status', result: result !== false};
}
function finish(req, res, metaObj, body) {
    kit.audit(req, metaObj, function () { res.json(body); });
}
// 管理端建号/导入共用的字段校验 + 加密落库（不复用公开 addUser，后者硬编码关闭）。
// cb(err, id)；校验类错误带 userMsg，由调用方映射为 {success:false,msg}。
function createUser(input, cb) {
    var userName = kit.str(input.userName, 100, true);
    var realName = kit.str(input.realName, 100, false);
    var password = input.password == null ? '' : String(input.password);
    var role = kit.intInRange(input.role, 0, 1, null);
    var status = kit.intInRange(input.status, 0, 2, null);
    if (!userName) return cb(biz('用户名不能为空'));
    var err = null;
    if (realName === null) err = '姓名不能为空或过长';
    else if (password.length < 8 || password.length > 128) err = '密码长度须为 8-128 位';
    else if (role === null) err = '角色参数错误';
    else if (status === null) err = '状态参数错误';
    if (err) return cb(biz(err));
    User.findByName(userName, function (e, exists) {
        if (e) return cb(e);
        if (exists) return cb(biz('用户名已存在'));
        User.save({
            userName: userName, realName: realName || userName,
            password: encryption(password), role: role, status: status,
            loginType: 'local', createTime: new Date(), modifyTime: new Date()
        }, function (e2, saved) {
            if (e2) return cb(e2);
            cb(null, saved && saved._id ? String(saved._id) : '');
        });
    });
}
function biz(msg) { var e = new Error(msg); e.userMsg = msg; return e; }

// POST /manager/user/add —— 管理员唯一建号入口（A）
exports.adminAdd = function (req, res) {
    var m = meta('create', null);
    function done(body, ok, id) {
        m.result = !!ok;
        if (id) m.objectId = [String(id)];
        finish(req, res, m, body);
    }
    createUser({
        userName: req.body.userName, realName: req.body.realName,
        password: req.body.password, role: req.body.role, status: req.body.status
    }, function (err, id) {
        if (err) return done({success: false, msg: err.userMsg || '新增用户失败'}, false);
        done({success: true, msg: '新增用户成功', id: id}, true, id);
    });
};

// 详情脱敏：JSON/页面都不得出现 password / phone / email 原值（J02/K02）。
function sanitize(doc) {
    var d = doc && doc.toObject ? doc.toObject() : Object.assign({}, doc || {});
    delete d.password;
    delete d.phone;
    delete d.email;
    delete d.openUserId;
    return d;
}
exports.detail = crud.detail({
    Model: User, desc: userDesc, target: 'user', view: 'manager/detail',
    titleFn: function (d) { return d.realName || d.userName; }, currentMenu: 'user',
    decorate: function (doc, cb) { cb(null, sanitize(doc)); }
});
exports.status = crud.status({
    Model: User, desc: userDesc, target: 'user', shape: 'success', statusRange: [0, 1],
    statusMsg: '状态更新成功'
});
// 批量：status 只认 0/1（2 只能走 delete 软删）；逐条 update 带归属无关，但批量入口是 A。
exports.batch = crud.batch({
    Model: User, desc: userDesc, target: 'user', shape: 'success', statusRange: [0, 1],
    one: function (id, action, status, where, req, cb) {
        if (action === 'status') {
            User.adminUpdate(id, where, {status: status}, function (err, changed) {
                cb(err || (changed === 0 ? biz('目标不存在') : null), '状态更新成功');
            });
        } else {
            // 删除统一走软删 status=2，绝不在此写 status=1（那是"禁用"不是"删除"）。
            User.adminSoftDelete(id, where, function (err, changed) {
                cb(err || (changed === 0 ? biz('目标不存在') : null), '删除成功');
            });
        }
    }
});

// CSV 导入：userName,realName,password,role,status —— 逐行复用 createUser 校验并 bcrypt 加密。
// 全量校验阶段 rowToDoc 只做字段合法性（含密码长度），不加密、不查重（查重/唯一在写入阶段按单条拒绝）。
exports['import'] = io.import({
    Model: User, target: 'user',
    columns: ['userName', 'realName', 'password', 'role', 'status'],
    rowToDoc: function (cells, ctx) {
        var userName = kit.csv.sanitize(cells[0]);
        var realName = kit.csv.sanitize(cells[1]);
        var password = String(cells[2] == null ? '' : cells[2]).trim();
        var role = kit.intInRange(cells[3], 0, 1, null);
        var status = kit.intInRange(cells[4], 0, 2, null);
        if (!userName || !realName) throw new Error('用户名/姓名不能为空');
        if (password.length < 8 || password.length > 128) throw new Error('密码长度须为 8-128 位');
        if (role === null || status === null) throw new Error('角色或状态参数错误');
        return {__row: ctx.row, userName: userName, realName: realName,
            password: password, role: role, status: status};
    },
    insertDoc: function (doc, cb) { createUser(doc, cb); }
});

// CSV 导出：白名单脱敏，绝不含 password/phone/email；no-store + BOM 由 io.export 统一设置。
exports['export'] = io.export({
    Model: User, target: 'user', desc: userDesc,
    columns: ['userName', 'realName', 'role', 'status', 'createTime'],
    docToRow: function (d) {
        return [d.userName, d.realName || '', d.role, d.status,
            d.createTime ? d.createTime.toISOString() : ''];
    }
});
