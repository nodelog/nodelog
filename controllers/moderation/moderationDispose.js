// 四级账号处置（SPEC-MODERATION §6.4/§6.5）：唯一签发接口 POST /manager/moderation/user/dispose（A）。
// 无事务幂等顺序（§6.5）：① User 幂等 $set（失败不 push，可安全重试）
//   ② ViolationLog 单文档条件 push（'disposition.level':{$ne:level} = 幂等闸门）③ 审计仅首次写。
// 不做系统自动处置；不做跨文档事务；disposedBy 只从 session 取，绝不信 body。
var ViolationLog = require('../../models/ViolationLog');
var User = require('../../models/User');
var constants = require('../../models/constants');
var cfg = require('../adminConfig');
var kit = require('../adminKit');
var guard = require('./moderationGuard');

// 目标级别的 User $set 字段（§6.5 步骤 2）。disposedBy/moderationNote/disposedLevel 是
// 「当前最新处置快照」（§3.4）与 reason 的第二落点（§6.4），每一级都写；状态字段按级区分。
function buildUserSet(level, adminId, reason, muteDays, now) {
    var set = {disposedBy: adminId, moderationNote: reason || '', disposedLevel: level};
    if (level === 0) {
        set.status = constants.USER_ENABLE_STATUS;
        set.muteUntil = null;
        set.bannedAt = null;                       // 解除清封禁时点（§6.1）
    } else if (level === 2) {
        set.muteUntil = new Date(now.getTime() + muteDays * 86400000);
    } else if (level === 3) {
        set.status = constants.USER_UNABLE_STATUS; // 停用禁登录，不写 bannedAt（§6.5）
        set.muteUntil = null;
    } else if (level === 4) {
        set.status = constants.USER_DELETE_STATUS; // 封禁=软删 status=2
        set.muteUntil = null;
        set.bannedAt = now;                         // 封禁时间（与 lastViolationAt 语义分离）
    }
    return set;
}
function fail(res, status, msg) {
    return res.status(status).json({success: false, msg: msg});
}

exports.apply = function (req, res) {
    var body = req.body || {};
    // 入口形状守卫：畸形 body（数组/标量）直接 400，防后续 kit.* 取到非预期容器。
    if (typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({success: false, msg: '参数错误'});
    }
    var vid = kit.requireId(body.violationId);
    var level = kit.intInRange(body.level, 0, 4, null);
    var muteDays = kit.intInRange(body.muteDays, 1, 365, cfg.MODERATION_MUTE_DAYS);
    var reason = kit.str(body.reason, 200, false);
    if (!vid.ok || level === null || muteDays === null || reason === null) {
        return fail(res, 400, '参数错误');
    }
    var admin = req.session && req.session.user;
    if (!admin || !admin._id) return fail(res, 401, '未登录或无权限');

    // 处置写也过账号活跃守卫（GO 条件 3：status=1 用户不能产生任何业务写入）。
    guard.assertActive(req, function (err, active) {
        if (err) return fail(res, 500, '操作失败，请稍后重试');
        if (!active) return fail(res, 200, '账号已停用，无法执行处置');

        // 1) 案底存在性：不存在即 404，零副作用。
        ViolationLog.adminFindById(vid.id, {}, function (e1, doc) {
            if (e1) {
                var n = kit.normalizeDaoError(e1, 'dispose.find');
                return fail(res, n.status, n.msg);
            }
            if (!doc) return fail(res, 404, '违规记录不存在');

            var now = new Date();
            var set = buildUserSet(level, admin._id, reason, muteDays, now);
            var changed = Object.keys(set).filter(function (k) { return k !== 'modifyTime'; }).join(',');

            // 2) User 幂等 $set：失败 → 500，不 push disposition（可安全重试）。
            User.applyDisposition(doc.user, set, function (e2) {
                if (e2) {
                    console.error('[moderationDispose] User.applyDisposition failed: ' + e2.message);
                    return fail(res, 500, '处置失败，请稍后重试');
                }
                var entry = {level: level, by: admin._id, at: now, reason: reason || ''};

                // 3) 条件 push = 幂等闸门：同级别已存在 → matched=false → already:true，不重复记审计。
                ViolationLog.findOneAndAddDisposition(vid.id, level, entry, function (e3, matched) {
                    if (e3) {
                        console.error('[moderationDispose] findOneAndAddDisposition failed: ' + e3.message);
                        return fail(res, 500, '处置记录失败，请稍后重试');
                    }
                    if (!matched) {
                        return res.json({success: true, msg: '该级别已处置，未重复执行',
                            level: level, already: true});
                    }
                    // 4) 审计仅首次写：detail 只字段名 + violation id，不记 reason 值/正文。
                    kit.audit(req, {action: 'moderation', target: 'user', objectId: [String(doc.user)],
                        detail: 'dispose:level=' + level + ',violation=' + vid.id + ',changed:' + changed,
                        result: true}, function () {
                        res.json({success: true, msg: '已处置', level: level, already: false});
                    });
                });
            });
        });
    });
};
