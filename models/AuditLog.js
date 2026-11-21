var mongodb = require('./mongodb');

var Schema = mongodb.mongoose.Schema;
var ObjectId = Schema.ObjectId;

// 操作日志（append-only，与公告 Log.js 完全独立的集合）。
// 建表六件套例外：纯日志表不要 version / 软删，只追加不改；保留 actor(审计) 与 time。
// 绝不记 PII：密码、正文、手机号、邮箱、令牌、req.body 一律不入库（§3.6/K02）。
var AuditLogSchema = new Schema({
    actor: {type: ObjectId, required: true},                 // 谁（session.user._id；系统写入者用固定 24 位 0 id）
    actorName: {type: String},                               // 冗余用户名，便于审计页展示
    action: {type: String, required: true,
        // SPEC-MODERATION §3.5：只新增 moderation，旧 9 个全部保留；用途靠 target + detail 区分。
        enum: ['create', 'update', 'delete', 'status', 'batch', 'import', 'export', 'audit_cleanup', 'tag_reconcile', 'moderation']},
    target: {type: String, required: true},                  // content/category/tag/link/user/comment/log/audit
    objectId: {type: [String], default: []},                 // 目标 id 数组（单条 1 个，批量/导入 N 个）
    time: {type: Date, default: Date.now, index: true},      // 可排序 / 保留期清理依据
    ip: {type: String},
    result: {type: Boolean, default: true},                  // 成功/失败尝试都记
    detail: {type: String}                                   // 仅字段名白名单（如 changed:['status']），不记值
}, {collection: 'audit_log'});

// 部分索引思想：软删无意义（append-only），按时间倒序 + 资源/动作组合检索。
AuditLogSchema.index({time: 1});
AuditLogSchema.index({target: 1, action: 1, time: -1});

var AuditLogModel = mongodb.mongoose.model('AuditLog', AuditLogSchema);

var AuditLogDAO = function () {};

// 追加一条（回调风格，与项目其余 DAO 一致）。
AuditLogDAO.prototype.save = function (doc, callback) {
    var entity = new AuditLogModel(doc);
    entity.save(function (err) { callback(err); });
};

// 分页查询：query 由 controller 组装（含 action/actor/target/result/objectId/from/to），
// DAO 只执行不猜来源。返回 {docs,total,page,totalPage}。
AuditLogDAO.prototype.findByPage = function (query, options, callback) {
    var where = query || {};
    var pageSize = (options && options.pageSize) || 9;
    var page = (options && options.page) || 1;
    var sort = (options && options.sort) || {time: -1};
    AuditLogModel.count(where, function (err, total) {
        if (err) return callback(err);
        AuditLogModel.find(where).sort(sort).limit(pageSize).skip((page - 1) * pageSize)
            .exec(function (err2, docs) {
                if (err2) return callback(err2);
                callback(null, {docs: docs, total: total, page: page,
                    totalPage: Math.ceil(total / pageSize)});
            });
    });
};

// 条件计数（QA 断言清理前后条数）。
AuditLogDAO.prototype.getCount = function (query, callback) {
    AuditLogModel.count(query || {}, function (err, total) { callback(err, total); });
};

// 按保留期物理删除（维护脚本调用，需带 NODE_OPTIONS 钩子连测试库）。
AuditLogDAO.prototype.deleteExpired = function (cutoffDate, callback) {
    AuditLogModel.deleteMany({time: {$lt: cutoffDate}}, function (err, result) {
        callback(err, result ? result.deletedCount : 0);
    });
};

module.exports = new AuditLogDAO();
module.exports.AuditLogModel = AuditLogModel;
