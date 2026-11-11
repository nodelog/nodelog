/**
 * 后台管理维护脚本（Node 直跑，回调风格，无新增依赖）。
 *
 *   # 清理超保留期的审计日志（默认 180 天，可由 ADMIN_AUDIT_TTL_DAYS 覆盖），随后记一条 audit_cleanup
 *   node scripts/admin-maintenance.js audit-cleanup
 *
 *   # 全量重算所有标签的 count（委托上游唯一实现 syncTags），随后记一条 tag_reconcile
 *   node scripts/admin-maintenance.js tag-reconcile
 *
 *   # 一次性回填历史文档缺失/越界的 status（link/tag/comment，幂等；SPEC §5.5）
 *   node scripts/admin-maintenance.js migrate-status
 *
 * 安全红线：本脚本 require model 会读 settings.url（本机指向生产库 ctit）。
 * 在非隔离环境跑「写」操作前，务必用 QA 钩子把库指向测试库：
 *   NODE_OPTIONS="--require D:/code/NODELOG/evidence/qa-db-hook.js" node scripts/admin-maintenance.js <cmd>
 * 本脚本自身不硬编码任何库名，也不切换连接；钩子的存在与否由运维/QA 决定。
 */
'use strict';

var path = require('path');
var root = path.join(__dirname, '..');
var cfg = require(path.join(root, 'controllers/adminConfig'));
var AuditLog = require(path.join(root, 'models/AuditLog'));
var Tag = require(path.join(root, 'models/Tag'));
var kit = require(path.join(root, 'controllers/adminKit'));

var cmd = process.argv[2];

function stamp() { return new Date().toISOString(); }
function die(msg) { console.error('[' + stamp() + '] ERROR ' + msg); process.exit(1); }

// 系统写入者审计（无 req/session）：actor 用 adminKit 的固定 SYSTEM_ACTOR，不记 PII。
function systemAudit(action, detail, objectId, cb) {
    kit.audit(null, {action: action, target: 'audit', objectId: objectId || [],
        detail: detail, result: true}, function (err) {
        if (err) console.warn('[' + stamp() + '] 审计写入失败（不影响清理结果）: ' + err.message);
        if (cb) cb();
    });
}

// audit-cleanup：删 time < now - TTL*days，随后记一条 audit_cleanup（明细只记删除条数，不记内容）。
function auditCleanup() {
    var cutoff = new Date(Date.now() - cfg.AUDIT_TTL_DAYS * 24 * 60 * 60 * 1000);
    console.log('[' + stamp() + '] audit-cleanup 开始，保留期 ' + cfg.AUDIT_TTL_DAYS + ' 天，截止 < ' + cutoff.toISOString());
    AuditLog.getCount({time: {$lt: cutoff}}, function (err, before) {
        if (err) return die('清理前计数失败: ' + err.message);
        console.log('[' + stamp() + '] 到期待清理 ' + before + ' 条');
        AuditLog.deleteExpired(cutoff, function (err2, deleted) {
            if (err2) return die('清理失败: ' + err2.message);
            console.log('[' + stamp() + '] 已清理 ' + deleted + ' 条审计日志');
            systemAudit('audit_cleanup', 'deleted=' + deleted + ',cutoff=' + cutoff.toISOString(), [], function () {
                console.log('[' + stamp() + '] audit-cleanup 完成');
                process.exit(0);
            });
        });
    });
}

// tag-reconcile：全量重算 Tag.count（薄编排委托 syncTags，不写第二套计数），随后记一条 tag_reconcile。
function tagReconcile() {
    console.log('[' + stamp() + '] tag-reconcile 开始（委托 syncTags 全量重算）');
    Tag.reconcileAllCounts(function (err) {
        if (err) return die('标签计数重算失败: ' + err.message);
        var detail = 'reconciled:all-tags';
        console.log('[' + stamp() + '] 标签计数重算完成');
        systemAudit('tag_reconcile', detail, [], function () {
            console.log('[' + stamp() + '] tag-reconcile 完成');
            process.exit(0);
        });
    });
}

// migrate-status：expand 阶段的历史回填（SPEC §5.5），全部幂等（只补缺失/越界，不覆盖合法值）。
// 用 mongodb@4.17.2 原生驱动，集合名单数，与 QA 的 §5.5 模板完全一致。不记审计（数据迁移，非业务操作）。
function migrateStatus() {
    var MongoClient = require(path.join(root, 'node_modules/mongodb')).MongoClient;
    var settings = require(path.join(root, 'settings'));
    var uri = settings.url || settings.dbUrl;
    // 安全断言：绝不误连生产库。要求库名以 _qa 结尾（与 evidence/qa-db-hook.js 约定一致）。
    var dbName = (String(uri).match(/\/([^/?]+)(\?.*)?$/) || [])[1];
    if (!/_qa$/i.test(dbName || '')) {
        return die('拒绝执行回填：当前库名 "' + dbName + '" 不是测试库（需以 _qa 结尾）。请用 NODE_OPTIONS 挂载 QA 钩子。');
    }
    console.log('[' + stamp() + '] migrate-status 目标库: ' + dbName);
    MongoClient.connect(uri, function (err, client) {
        if (err) return die('连接失败: ' + err.message);
        var d = client.db(dbName);
        var jobs = [
            {name: 'link', filter: {status: {$exists: false}},
                update: {$set: {status: 0, createTime: new Date(), modifyTime: new Date()}}},
            {name: 'tag', filter: {status: {$exists: false}},
                update: {$set: {status: 0, modifyTime: new Date()}}},
            {name: 'comment', filter: {$or: [{status: {$exists: false}}, {status: {$nin: [0, 1]}}]},
                update: {$set: {status: 0}}}
        ];
        var i = 0;
        (function next() {
            if (i >= jobs.length) {
                client.close();
                console.log('[' + stamp() + '] migrate-status 完成');
                return process.exit(0);
            }
            var j = jobs[i++];
            d.collection(j.name).updateMany(j.filter, j.update, function (e, r) {
                if (e) { client.close(); return die(j.name + ' 回填失败: ' + e.message); }
                console.log('[' + stamp() + '] ' + j.name + ' 回填 modified=' + (r ? r.modifiedCount : 0));
                next();
            });
        })();
    });
}

if (cmd === 'audit-cleanup') auditCleanup();
else if (cmd === 'tag-reconcile') tagReconcile();
else if (cmd === 'migrate-status') migrateStatus();
else {
    console.error('用法: node scripts/admin-maintenance.js <audit-cleanup|tag-reconcile|migrate-status>');
    process.exit(1);
}
