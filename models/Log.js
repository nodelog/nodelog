var mongodb = require('./mongodb');
var constants = require('./constants');

var Schema = mongodb.mongoose.Schema;
var ObjectId = Schema.ObjectId;

var LogSchema = new Schema({
    name: {type: 'String', required: true},
    content:{type:'Object',required: true},
    createTime: { type: Date, default: Date.now},
    modifyTime: {type: Date, default: Date.now},
    status: {type: 'Number', default: 0, required: true, min: 0, max: 1},
    // 自动发布公告的来源 commit（全 40 位小写 hex）。人工公告无此字段，不受影响。
    // 用于 /api/announcements 的幂等查重，避免 hook 与 CI 重复发同一条公告。
    commitHash: {type: 'String', default: ''}
}, {
    collection: "log"
});

var LogModel = mongodb.mongoose.model("Log", LogSchema);
//
var LogDAO = function () {
};
LogDAO.prototype.save = function (obj, callback) {
    var logEntity = new LogModel(obj);
    logEntity.save(function (err) {
        // 追加返回新建文档（含 _id）供导入/审计定位；旧调用方只取第 1 个 err，不受影响。
        callback(err, err ? null : logEntity);
    });
};
LogDAO.prototype.findByName = function (name, callback) {
    LogModel.findOne({"name": name, "status": constants.LOG_ENABLE_STATUS}, function (err, obj) {
        callback(err, obj);
    });
};
// 自动公告幂等查重：按完整 commit hash 精确匹配，**含已下架(status=1)**。
// 管理员撤下公告是明确的「不想展示」意图，必须继续阻止 hook/CI 自动重发；
// 否则每次 commit 或 CI 补发都会把它重新放出来，永远删不掉。
LogDAO.prototype.findAnyByCommitHash = function (hash, callback) {
    LogModel.findOne({"commitHash": hash}, function (err, obj) {
        callback(err, obj);
    });
};
// 同上，按标题查重（兼容后台 CSV 导入的无 commitHash 公告）。
LogDAO.prototype.findAnyByName = function (name, callback) {
    LogModel.findOne({"name": name}, function (err, obj) {
        callback(err, obj);
    });
};
LogDAO.prototype.findById = function (id, callback) {
    LogModel.findOne({"_id": id, "status": constants.LOG_ENABLE_STATUS}, function (err, obj) {
        callback(err, obj);
    });
};

LogDAO.prototype.findByPage = function (page, callback) {
    var query = LogModel.find({"status": constants.LOG_ENABLE_STATUS});
    query.sort({"modifyTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        callback(err, docs);
    });
};
LogDAO.prototype.findAll = function (callback) {
    LogModel.find({"status": constants.LOG_ENABLE_STATUS},{},{sort:{"modifyTime":-1}}, function (err, docs) {
        callback(err, docs);
    });
};
LogDAO.prototype.getCount = function (callback) {
    LogModel.count({"status": constants.LOG_ENABLE_STATUS}, function (err, total) {
        callback(err, total);
    });
};
// 看板用：已下架(status=1)公告数，即待复核/待恢复
LogDAO.prototype.getCountDisabled = function (callback) {
    LogModel.count({"status": constants.LOG_UNABLE_STATUS}, function (err, total) {
        callback(err, total || 0);
    });
};
LogDAO.prototype.delete = function (id, callback) {
    LogModel.update({"_id": id}, {$set: {'status': constants.LOG_UNABLE_STATUS }}, function (err) {
        callback(err);
    });
};
LogDAO.prototype.update = function (obj, callback) {
    LogModel.update({"_id": obj._id}, {$set: {"name": obj.name,"content":obj.content, "modifyTime": new Date()}}, function (err) {
        callback(err);
    });
};
// 通用后台 DAO 方法（软删 status=1）。公告写操作的审计走独立 AuditLog，不写本集合。
require('./_adminDao').attach(LogDAO, LogModel, {softStatus: constants.LOG_UNABLE_STATUS});

module.exports = new LogDAO();