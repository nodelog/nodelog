var mongodb = require('./mongodb');//引入mongodb配置文件，同目录下mongodb.js文件，默认引入js文件。
var constants = require('./constants');//同上，引入常量类

var Schema = mongodb.mongoose.Schema;//获取mongodb schema
var ObjectId = Schema.ObjectId;//获取ObjectId

//sheme对象
var SiteSchema = new Schema({
    name: {type: String, required: true},
    copyRight: {type: String, required: true},
    icp: {type: String},
    version: {type: String, required: true},
    phone: { type: String},
    address: {type: String}
}, {
    collection: "site" //对应mongodb的集合表
});
//构建model对象，所有对数据库操作都对该对象操作
var SiteModel = mongodb.mongoose.model("Site", SiteSchema);

//DAO接口
var SiteDAO = function () {
};
//通过prototype属性实现DAO接口
SiteDAO.prototype.save = function (obj, callback) {
    var SiteEntity = new SiteModel(obj);
    SiteEntity.save(function (err) {
        callback(err);
    });
};

/**
 * 根据id查询
 * @param id
 * @param callback
 */
SiteDAO.prototype.findById = function (id, callback) {
    SiteModel.findOne({"_id": id}, function (err, obj) {
        callback(err, obj);
    });
};

/**
 * 查询网站信息
 * @param callback
 */
SiteDAO.prototype.findOne = function (callback) {
    SiteModel.findOne(function (err, docs) {
        callback(err, docs);
    });
};
/**
 * 更新站点信息
 * @param obj
 * @param callback
 */
SiteDAO.prototype.update = function (obj, callback) {
    SiteModel.update(
        {"_id": obj.id},
        {$set:{
            "name": obj.name,
            "copyRight": obj.copyRight,
            "icp": obj.icp,
            "version": obj.version,
            "phone": obj.phone,
            "address": obj.address }
        },
        function (err) {
        callback(err);
    });
};

//把DAO接口开放出去给controller调用
module.exports = new SiteDAO();
