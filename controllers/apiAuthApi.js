/**
 * 开放接口应用凭证控制器：
 *   1) POST /api/auth/token —— 用 AppID + HMAC 签名换取短期 access_token（无需登录）
 *   2) 后台应用管理 CRUD —— 仅管理员，供 views/manager/apiApp.ejs 消费
 *
 * 安全：secret 明文只在 add/reset 响应出现一次；库里只有 AES 密文；验签常量时间比较。
 * 沿用项目 CommonJS + var + 回调风格，零新依赖。
 */
'use strict';
var crypto = require('crypto');
var ApiApp = require('./../models/ApiApp.js');
var User = require('./../models/User.js');
var Content = require('./../models/Content.js');
var cred = require('./../services/apiCredential');
var constants = require('./../models/constants');

var OID_RE = /^[a-f\d]{24}$/i;

// ---------------------------------------------------------------------------
// POST /api/auth/token —— HMAC 签名换取 access_token
// ---------------------------------------------------------------------------
exports.token = function (req, res) {
    var b = req.body || {};
    var appId = String(b.appId || '').trim();
    var timestamp = b.timestamp;
    var nonce = String(b.nonce || '');
    var signature = String(b.signature || '').trim();

    if (!appId || timestamp == null || !nonce || !signature) {
        return res.status(400).json({success: false, msg: '缺少 appId / timestamp / nonce / signature'});
    }
    if (!cred.timestampOk(timestamp)) {
        return res.status(401).json({success: false, msg: 'timestamp 超出允许的时间窗口'});
    }
    if (nonce.length > 128) {
        return res.status(400).json({success: false, msg: 'nonce 过长'});
    }

    ApiApp.findByAppId(appId, function (err, app) {
        if (err) {
            console.error('[apiAuth.token] 查应用失败：' + err.message);
            return res.status(500).json({success: false, msg: '服务端错误'});
        }
        if (!app) return res.status(401).json({success: false, msg: 'AppID 无效'});
        if (app.status !== 0) return res.status(403).json({success: false, msg: '应用已停用'});

        var secretPlain;
        try { secretPlain = cred.decryptSecret(app.secretHash); }
        catch (e) {
            console.error('[apiAuth.token] 密钥解密失败：' + e.message);
            return res.status(500).json({success: false, msg: '服务端错误'});
        }
        var expected = cred.sign(secretPlain, app.appId, timestamp, nonce);
        if (!cred.safeEqual(expected, signature)) {
            return res.status(401).json({success: false, msg: '签名校验失败'});
        }

        // 校验绑定用户仍存在且启用
        User.findById(app.userId, function (uErr, user) {
            if (uErr) {
                console.error('[apiAuth.token] 查绑定用户失败：' + uErr.message);
                return res.status(500).json({success: false, msg: '服务端错误'});
            }
            if (!user) return res.status(403).json({success: false, msg: '应用绑定的用户不存在'});
            if (user.status !== constants.USER_ENABLE_STATUS) {
                return res.status(403).json({success: false, msg: '应用绑定的用户已停用'});
            }
            var issued;
            try { issued = cred.issueToken(app, user); }
            catch (e) {
                console.error('[apiAuth.token] 签发 token 失败：' + e.message);
                return res.status(500).json({success: false, msg: '服务端错误：未配置 token 签名密钥'});
            }
            ApiApp.touch(app._id, function () { /* 最近使用时间，失败不影响主流程 */ });
            // 响应绝不携带 secret 明文或密文
            return res.json({
                success: true,
                access_token: issued.token,
                token_type: 'Bearer',
                expires_in: issued.expiresIn
            });
        });
    });
};

// ---------------------------------------------------------------------------
// 后台：应用列表
// ---------------------------------------------------------------------------
exports.list = function (req, res) {
    ApiApp.findAll(function (err, apps) {
        if (err) {
            console.error('[apiAuth.list] 失败：' + err.message);
            return res.status(500).json({success: false, msg: '服务端错误'});
        }
        apps = apps || [];
        var userIds = apps.map(function (a) { return String(a.userId); });
        User.findByIds(userIds, function (uErr, users) {
            var userMap = {};
            (users || []).forEach(function (u) { userMap[String(u._id)] = u.userName; });
            var data = apps.map(function (a) {
                return {
                    id: String(a._id),
                    appId: a.appId,
                    name: a.name,
                    userId: String(a.userId),
                    userName: userMap[String(a.userId)] || '(用户已删除)',
                    status: a.status,
                    description: a.description || '',
                    secret: cred.maskSecret(a.secretHash),       // 脱敏，绝不返回明文
                    lastUsedAt: a.lastUsedAt || null,
                    createTime: a.createTime
                };
            });
            // 每个应用的文章数（用于列表 postCount）
            var pending = data.length;
            if (!pending) return res.json({success: true, data: data});
            data.forEach(function (row) {
                Content.countBySourceApp(row.id, function (cErr, n) {
                    row.postCount = cErr ? 0 : n;
                    if (--pending === 0) res.json({success: true, data: data});
                });
            });
        });
    });
};

// ---------------------------------------------------------------------------
// 后台：新增应用（secret 明文仅此一次返回）
// ---------------------------------------------------------------------------
exports.add = function (req, res) {
    var b = req.body || {};
    var name = String(b.name || '').trim();
    var userId = String(b.userId || '').trim();
    var description = String(b.description || '').trim();
    if (!name) return res.json({success: false, msg: '应用名称不能为空'});
    if (!OID_RE.test(userId)) return res.json({success: false, msg: '绑定用户无效'});

    User.findById(userId, function (uErr, user) {
        if (uErr) {
            console.error('[apiAuth.add] 查用户失败：' + uErr.message);
            return res.json({success: false, msg: '服务端错误'});
        }
        if (!user) return res.json({success: false, msg: '绑定用户不存在'});
        if (user.status !== constants.USER_ENABLE_STATUS) {
            return res.json({success: false, msg: '绑定用户已停用'});
        }
        var appId = cred.genAppId();
        var secret = cred.genSecret();
        var enc;
        try { enc = cred.encryptSecret(secret); }
        catch (e) {
            console.error('[apiAuth.add] 加密密钥失败：' + e.message);
            return res.json({success: false, msg: '服务端错误：未配置加密密钥'});
        }
        ApiApp.save({
            appId: appId, secretHash: enc, name: name,
            userId: user._id, status: 0, description: description
        }, function (err, saved) {
            if (err || !saved) {
                console.error('[apiAuth.add] 保存失败：' + (err && err.message));
                return res.json({success: false, msg: '创建应用失败'});
            }
            // secret 明文仅此一次返回
            return res.json({success: true, msg: '应用已创建', id: String(saved._id), appId: appId, secret: secret});
        });
    });
};

// ---------------------------------------------------------------------------
// 后台：编辑应用
// ---------------------------------------------------------------------------
exports.modify = function (req, res) {
    var b = req.body || {};
    var id = String(b.id || '').trim();
    if (!OID_RE.test(id)) return res.json({success: false, msg: '应用 id 无效'});
    var name = String(b.name || '').trim();
    var userId = String(b.userId || '').trim();
    if (!name) return res.json({success: false, msg: '应用名称不能为空'});
    if (!OID_RE.test(userId)) return res.json({success: false, msg: '绑定用户无效'});

    User.findById(userId, function (uErr, user) {
        if (uErr || !user || user.status !== constants.USER_ENABLE_STATUS) {
            return res.json({success: false, msg: '绑定用户不存在或已停用'});
        }
        ApiApp.findByIdAny(id, function (err, app) {
            if (err || !app) return res.json({success: false, msg: '应用不存在'});
            var status = (b.status === 0 || b.status === '0' || b.status === 1 || b.status === '1')
                ? Number(b.status) : app.status;
            ApiApp.update({
                id: id, name: name, userId: user._id,
                description: String(b.description || '').trim(), status: status
            }, function (uErr2) {
                if (uErr2) {
                    console.error('[apiAuth.modify] 更新失败：' + uErr2.message);
                    return res.json({success: false, msg: '更新应用失败'});
                }
                return res.json({success: true, msg: '应用已更新'});
            });
        });
    });
};

// ---------------------------------------------------------------------------
// 后台：删除（软删）
// ---------------------------------------------------------------------------
exports.delete = function (req, res) {
    var id = String((req.body || {}).id || '').trim();
    if (!OID_RE.test(id)) return res.json({success: false, msg: '应用 id 无效'});
    ApiApp.delete(id, function (err, n) {
        if (err) {
            console.error('[apiAuth.delete] 失败：' + err.message);
            return res.json({success: false, msg: '删除失败'});
        }
        return res.json({success: true, msg: '应用已删除'});
    });
};

// ---------------------------------------------------------------------------
// 后台：重置密钥（secret 明文仅此一次返回）
// ---------------------------------------------------------------------------
exports.resetSecret = function (req, res) {
    var id = String((req.body || {}).id || '').trim();
    if (!OID_RE.test(id)) return res.json({success: false, msg: '应用 id 无效'});
    ApiApp.findByIdAny(id, function (err, app) {
        if (err || !app) return res.json({success: false, msg: '应用不存在'});
        var secret = cred.genSecret();
        var enc;
        try { enc = cred.encryptSecret(secret); }
        catch (e) {
            return res.json({success: false, msg: '服务端错误：未配置加密密钥'});
        }
        ApiApp.update({id: id, secretHash: enc, name: app.name, userId: app.userId,
            description: app.description, status: app.status}, function (uErr) {
            if (uErr) {
                console.error('[apiAuth.resetSecret] 失败：' + uErr.message);
                return res.json({success: false, msg: '重置失败'});
            }
            return res.json({success: true, msg: '密钥已重置', secret: secret});
        });
    });
};

// ---------------------------------------------------------------------------
// 后台：某应用发布的文章（溯源）
// ---------------------------------------------------------------------------
exports.posts = function (req, res) {
    var id = String((req.query || {}).id || '').trim();
    if (!OID_RE.test(id)) return res.json({success: false, msg: '应用 id 无效'});
    Content.findBySourceApp(id, function (err, docs) {
            if (err) {
                console.error('[apiAuth.posts] 失败：' + err.message);
                return res.json({success: false, msg: '服务端错误'});
            }
            var data = (docs || []).map(function (d) {
                return {
                    id: String(d._id),
                    name: d.name,
                    url: '/content/detail?id=' + String(d._id),
                    createTime: d.createTime,
                    status: d.status
                };
            });
            return res.json({success: true, data: data});
        });
};
