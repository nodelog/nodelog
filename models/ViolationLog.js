// 违规记录（SPEC-MODERATION §3.3）。append-only：不挂 adminSoftDelete、无 update/delete 路由。
// 不记正文/邮箱/电话：只存命中词、字段、traceId、归属与四级处置轨迹（合规最小必要 + E16 脱敏）。
var mongodb = require('./mongodb');

var Schema = mongodb.mongoose.Schema;
var ObjectId = Schema.ObjectId;

var ViolationLogSchema = new Schema({
    user:        {type: ObjectId, required: true, index: true},      // 归属：只从 session.user._id 取
    userName:    {type: String},                                      // 冗余快照（管理员列表展示）
    source:      {type: String, required: true, enum: ['content', 'comment']},
    refId:       {type: String, default: ''},                         // 被拒内容未落库 → 空串；编辑命中填原 id
    field:       {type: String, required: true,
                   enum: ['name', 'content', 'excerpt', 'tags', 'seoTitle', 'seoKeywords',
                          'seoDescription', 'comment']},
    hitWord:     {type: String, required: true},                      // 命中的原词（管理员需知道拦了哪个词）
    hitWordId:   {type: ObjectId, required: true},                    // 关联 sensitive_word._id，改词后可追溯
    traceId:     {type: String, required: true},                      // 24 位 ObjectId hex，串联 audit_log.detail
    ip:          {type: String},                                      // 截断 64，与 kit.audit 同口径
    time:        {type: Date, default: Date.now, index: true},
    disposition: {type: [{
        level:  {type: Number, min: 0, max: 4},                       // 0 解除 / 1 警告 / 2 禁言 / 3 停用 / 4 封禁
        by:     {type: ObjectId},                                      // 操作人 _id，只从 session 取
        at:     {type: Date, default: Date.now},
        reason: {type: String}                                         // ≤200，禁填正文/PII
    }], default: []}
}, {collection: 'violation_log'});

// append-only 日志表：不要 version / deleted_at（data-modeling 六件套例外，与 AuditLog 一致）。
ViolationLogSchema.index({user: 1, time: -1});
ViolationLogSchema.index({time: -1});
ViolationLogSchema.index({source: 1, field: 1, time: -1});
ViolationLogSchema.index({traceId: 1}, {unique: true});

var ViolationLogModel = mongodb.mongoose.model('ViolationLog', ViolationLogSchema);

var ViolationLogDAO = function () {};

ViolationLogDAO.prototype.save = function (doc, callback) {
    var entity = new ViolationLogModel(doc);
    entity.save(function (err, saved) { callback(err, err ? null : saved); });
};

// 分页查询（违规记录页）。where 由 controller 的 buildWhere 组装（含 source/field/disposition/user/时间）。
ViolationLogDAO.prototype.findByPage = function (where, opts, callback) {
    var q = where || {}, o = opts || {};
    var pageSize = parseInt(o.pageSize, 10) || 9;
    var page = parseInt(o.page, 10) || 1;
    if (page < 1) page = 1;
    if (pageSize < 1) pageSize = 9;
    var sort = o.sort || {time: -1};
    ViolationLogModel.countDocuments(q, function (err, total) {
        if (err) return callback(err);
        ViolationLogModel.find(q).sort(sort).limit(pageSize).skip((page - 1) * pageSize)
            .exec(function (err2, docs) {
                if (err2) return callback(err2);
                callback(null, {docs: docs, total: total, page: page,
                    totalPage: Math.ceil(total / pageSize)});
            });
    });
};
// crud.list/detail 依赖通用签名：adminList 同 findByPage；adminFindById 带 where。
ViolationLogDAO.prototype.adminList = ViolationLogDAO.prototype.findByPage;
ViolationLogDAO.prototype.adminFindById = function (id, query, callback) {
    if (typeof id === 'string' && !/^[0-9a-fA-F]{24}$/.test(id.trim())) {
        var e = new Error('Cast to ObjectId failed for value "' + id + '"');
        e.name = 'CastError';
        return callback(e);
    }
    var q = Object.assign({_id: id}, query || {});
    ViolationLogModel.findOne(q, function (err, doc) { callback(err, doc || null); });
};

ViolationLogDAO.prototype.getCount = function (where, callback) {
    ViolationLogModel.countDocuments(where || {}, function (err, total) { callback(err, total); });
};

// TTL 保留期物理删除（维护脚本，带 QA 钩子连 ctit_qa）。
ViolationLogDAO.prototype.deleteExpired = function (cutoff, callback) {
    ViolationLogModel.deleteMany({time: {$lt: cutoff}}, function (err, result) {
        callback(err, result ? result.deletedCount : 0);
    });
};

// 四级处置幂等闸门（§6.5）：单文档原子条件更新。'disposition.level':{$ne:level} 保证同级别只 push 一次。
// cb(err, matched)：matched=true 本次真正写入（modified），false=已有同级别（already，不重复记审计）。
ViolationLogDAO.prototype.findOneAndAddDisposition = function (id, level, entry, callback) {
    ViolationLogModel.findOneAndUpdate(
        {_id: id, 'disposition.level': {$ne: level}},
        {$push: {disposition: entry}},
        {new: true},
        function (err, doc) {
            if (err) return callback(err);
            // Mongoose 6 返回更新后的 doc（matched=true）或 null（条件不满足=已有同级别 / 案底不存在）。
            callback(null, !!doc);
        });
};

module.exports = new ViolationLogDAO();
module.exports.ViolationLogModel = ViolationLogModel;
