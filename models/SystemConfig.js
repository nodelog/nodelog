// 系统配置模型：存零配置自动生成的主密钥等内部值。
// 主密钥仅用于 AES 加密应用 Secret，首次启动时随机生成、落库后自动复用，
// 不写入 settings.js、不写入版本库——满足「零配置」要求。
'use strict';
var crypto = require('crypto');
var mongodb = require('./mongodb');

var Schema = mongodb.mongoose.Schema;
var SystemConfigSchema = new Schema({
    key: {type: String, required: true, unique: true, index: true},
    value: {type: String, required: true},
    createTime: {type: Date, default: Date.now},
    modifyTime: {type: Date, default: Date.now}
}, {collection: 'system_config'});

var SystemConfigModel = mongodb.mongoose.model('SystemConfig', SystemConfigSchema);

var SystemConfigDAO = function () {};

SystemConfigDAO.prototype.get = function (key, callback) {
    SystemConfigModel.findOne({key: key}, function (err, doc) {
        callback(err, doc ? doc.value : null);
    });
};

SystemConfigDAO.prototype.set = function (key, value, callback) {
    SystemConfigModel.updateOne(
        {key: key},
        {$set: {value: value, modifyTime: new Date()}},
        {upsert: true},
        function (err) { callback(err); }
    );
};

// 原子获取主密钥：存在即返回，不存在则生成 32 位 hex 落库后返回。
// 并发下用 findOneAndUpdate + upsert + $setOnInsert 保证只有一个值生效。
SystemConfigDAO.prototype.getOrCreateMasterKey = function (callback) {
    var KEY = 'apiAuth.masterKey';
    SystemConfigModel.findOneAndUpdate(
        {key: KEY},
        {$setOnInsert: {
            key: KEY,
            value: crypto.randomBytes(32).toString('hex'),
            createTime: new Date(),
            modifyTime: new Date()
        }},
        {upsert: true, new: true},
        function (err, doc) {
            if (err) return callback(err);
            callback(null, doc && doc.value);
        }
    );
};

module.exports = new SystemConfigDAO();
module.exports.Model = SystemConfigModel;
