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
        callback(err);
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
module.exports = new LogDAO();