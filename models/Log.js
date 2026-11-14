var mongodb = require('./mongodb');
var constants = require('./constants');

var Schema = mongodb.mongoose.Schema;
var ObjectId = Schema.ObjectId;

var LogSchema = new Schema({
    name: {type: 'String', required: true},
    content:{type:'Object',required: true},
    createTime: { type: Date, default: Date.now},
    modifyTime: {type: Date, default: Date.now},
    status: {type: 'Number', default: 0, required: true, min: 0, max: 1}
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