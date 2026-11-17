// 开放接口应用凭证模型：AppID + 加密存储的 Secret + 绑定作者用户。
// 沿用项目 CommonJS + 回调风格；Secret 用 AES-256-GCM 加密落库，明文绝不入库。
'use strict';
var mongodb = require('./mongodb');
var constants = require('./constants');

var Schema = mongodb.mongoose.Schema;
var ObjectId = Schema.ObjectId;

var ApiAppSchema = new Schema({
    appId: {type: String, required: true, unique: true, index: true},   // app_ + 16 hex，公开标识
    secretHash: {type: String, required: true},                          // AES-256-GCM 密文，不存明文
    name: {type: String, required: true},                                // 应用名称
    userId: {type: ObjectId, required: true, index: true},               // 绑定站内用户（发布作者）
    status: {type: Number, default: 0, min: 0, max: 1},                  // 0 启用 / 1 停用（软删）
    description: {type: String, default: ''},
    lastUsedAt: {type: Date, default: null},
    createTime: {type: Date, default: Date.now},
    modifyTime: {type: Date, default: Date.now}
}, {collection: 'api_app'});

ApiAppSchema.index({status: 1, createTime: -1});

var ApiAppModel = mongodb.mongoose.model('ApiApp', ApiAppSchema);

var ApiAppDAO = function () {};
ApiAppDAO.prototype.save = function (obj, callback) {
    var entity = new ApiAppModel(obj);
    entity.save(function (err) { callback(err, err ? null : entity); });
};
ApiAppDAO.prototype.findByAppId = function (appId, callback) {
    ApiAppModel.findOne({appId: appId, status: 0}, callback);
};
// 含停用/软删的查询：后台编辑/重置密钥需要能取到
ApiAppDAO.prototype.findByAppIdAny = function (appId, callback) {
    ApiAppModel.findOne({appId: appId}, callback);
};
ApiAppDAO.prototype.findById = function (id, callback) {
    ApiAppModel.findOne({_id: id, status: 0}, callback);
};
ApiAppDAO.prototype.findByIdAny = function (id, callback) {
    ApiAppModel.findOne({_id: id}, callback);
};
ApiAppDAO.prototype.findAll = function (callback) {
    ApiAppModel.find({status: 0}).sort({createTime: -1}).exec(callback);
};
ApiAppDAO.prototype.update = function (obj, callback) {
    var set = {
        name: obj.name,
        userId: obj.userId,
        description: obj.description || '',
        status: obj.status == null ? 0 : obj.status,
        modifyTime: new Date()
    };
    if (obj.secretHash) set.secretHash = obj.secretHash;
    ApiAppModel.updateOne({_id: obj.id}, {$set: set}, function (err, result) {
        callback(err, err ? 0 : (result && result.modifiedCount != null ? result.modifiedCount : 1));
    });
};
ApiAppDAO.prototype.setStatus = function (id, status, callback) {
    ApiAppModel.updateOne({_id: id}, {$set: {status: status, modifyTime: new Date()}}, function (err, result) {
        callback(err, err ? 0 : (result && result.matchedCount != null ? result.matchedCount : 0));
    });
};
// 软删：status=1。appId 唯一索引仍在，重新创建同名需换 appId，符合预期。
ApiAppDAO.prototype.delete = function (id, callback) {
    ApiAppModel.updateOne({_id: id}, {$set: {status: 1, modifyTime: new Date()}}, function (err, result) {
        callback(err, err ? 0 : (result && result.matchedCount != null ? result.matchedCount : 0));
    });
};
ApiAppDAO.prototype.touch = function (id, callback) {
    ApiAppModel.updateOne({_id: id}, {$set: {lastUsedAt: new Date()}}, function (err) { callback(err); });
};
ApiAppDAO.prototype.getCountByUser = function (userId, callback) {
    ApiAppModel.countDocuments({userId: userId, status: 0}, callback);
};

module.exports = new ApiAppDAO();
module.exports.Model = ApiAppModel;
