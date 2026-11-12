/**
 * 内容风控维护脚本（Node 直跑，回调风格，无新增依赖；SPEC-MODERATION §3.3/§6.5）。
 *   node scripts/moderation-maintenance.js violation-cleanup       清理超保留期违规记录（默认 180 天）
 *   node scripts/moderation-maintenance.js reconcile-disposition    修复 §6.5 中间态：User 有处置级别但轨迹缺失
 * 安全红线：require model 读 settings.url（本机指向生产 ctit），写前强制断言库名以 _qa 结尾，防误写生产。
 * 必须挂 QA 钩子：NODE_OPTIONS="--require D:/code/NODELOG/evidence/qa-db-hook.js" node scripts/moderation-maintenance.js <cmd>
 * 本脚本不硬编码库名、不自行切换连接；钩子由运维/QA 决定，断言只做最后一道拦截。
 */
'use strict';
var path = require('path');
var root = path.join(__dirname, '..');
var settings = require(path.join(root, 'settings'));
var cfg = require(path.join(root, 'controllers/adminConfig'));
var ViolationLog = require(path.join(root, 'models/ViolationLog'));
var User = require(path.join(root, 'models/User'));
var kit = require(path.join(root, 'controllers/adminKit'));
var LogModel = ViolationLog.ViolationLogModel;
var cmd = process.argv[2];

function stamp() { return new Date().toISOString(); }
function die(msg) { console.error('[' + stamp() + '] ERROR ' + msg); process.exit(1); }
function warn(msg) { console.warn('[' + stamp() + '] WARN ' + msg); }
// 库名断言：绝不误写生产库（与 evidence/qa-db-hook.js 的 ctit_qa 约定一致）。
function assertQaDb() {
    var dbName = (String(settings.url || settings.dbUrl).match(/\/([^/?]+)(\?.*)?$/) || [])[1];
    if (!/_qa$/i.test(dbName || '')) return die('拒绝写操作：库名 "' + dbName + '" 非测试库（需以 _qa 结尾）。请挂载 QA 钩子。');
    console.log('[' + stamp() + '] 目标库（已断言 _qa）: ' + dbName);
}
// 系统审计（无 req/session）：actor 用 SYSTEM_ACTOR，detail 只记条数，不记正文/PII。
function audit(target, detail, cb) {
    kit.audit(null, {action: 'moderation', target: target, objectId: [], detail: detail, result: true}, function (err) {
        if (err) warn('审计写入失败（不影响清理结果）: ' + err.message);
        if (cb) cb();
    });
}
// violation-cleanup：物理删 time < cutoff，清理自身写一条 moderation 审计。
function violationCleanup() {
    var cutoff = new Date(Date.now() - cfg.MODERATION_TTL_DAYS * 86400000);
    console.log('[' + stamp() + '] violation-cleanup 保留 ' + cfg.MODERATION_TTL_DAYS + ' 天，截止 < ' + cutoff.toISOString());
    ViolationLog.getCount({time: {$lt: cutoff}}, function (err, before) {
        if (err) return die('清理前计数失败: ' + err.message);
        console.log('[' + stamp() + '] 到期待清理 ' + before + ' 条');
        ViolationLog.deleteExpired(cutoff, function (err2, deleted) {
            if (err2) return die('清理失败: ' + err2.message);
            console.log('[' + stamp() + '] 已清理 ' + deleted + ' 条');
            audit('violation', 'cleanup:violation,deleted=' + deleted, function () {
                console.log('[' + stamp() + '] violation-cleanup 完成'); process.exit(0);
            });
        });
    });
}
// reconcile-disposition：修复 §6.5 中间态（User $set 成功、条件 push disposition 失败）。以 append-only
// 轨迹为准：User.disposedLevel>0 但所有案底都无该级别 disposition 时，幂等补回最近一条案底（$ne 闸门防重复）。
// 不改 User 状态字段，不覆盖管理员合法操作。
function reconcileDisposition() {
    User.adminList({disposedLevel: {$gt: 0}}, {page: 1, pageSize: 1000, sort: {modifyTime: -1}}, function (err, res) {
        if (err) return die('查询被处置用户失败: ' + err.message);
        var users = res.docs || [], i = 0, fixed = 0;
        console.log('[' + stamp() + '] 待对账被处置用户 ' + users.length + ' 名');
        (function next() {
            if (i >= users.length) {
                return audit('user', 'reconcile:disposition,checked=' + users.length + ',fixed=' + fixed, function () {
                    console.log('[' + stamp() + '] reconcile-disposition 完成，补全 ' + fixed + ' 条'); process.exit(0);
                });
            }
            var u = users[i++], level = u.disposedLevel || 0;
            LogModel.countDocuments({user: u._id, 'disposition.level': level}, function (e1, cnt) {
                if (e1) { warn('用户 ' + u._id + ' 轨迹计数失败，跳过: ' + e1.message); return next(); }
                if (cnt > 0) return next(); // 轨迹已含该级别 → 幂等跳过
                LogModel.findOne({user: u._id}).sort({time: -1}).exec(function (e2, log) {
                    if (e2 || !log) { warn('用户 ' + u._id + ' 无可用案底，跳过' + (e2 ? ': ' + e2.message : '')); return next(); }
                    var entry = {level: level, by: u.disposedBy || null, at: u.modifyTime || new Date(), reason: u.moderationNote || ''};
                    ViolationLog.findOneAndAddDisposition(log._id, level, entry, function (e3, matched) {
                        if (e3) warn('用户 ' + u._id + ' 补全失败: ' + e3.message);
                        else if (matched) { fixed++; console.log('[' + stamp() + '] 用户 ' + u._id + ' 补 level=' + level); }
                        next();
                    });
                });
            });
        })();
    });
}
if (cmd !== 'violation-cleanup' && cmd !== 'reconcile-disposition') {
    console.error('用法: node scripts/moderation-maintenance.js <violation-cleanup|reconcile-disposition>');
    process.exit(1);
}
assertQaDb();
if (cmd === 'violation-cleanup') violationCleanup();
else reconcileDisposition();
