var mongodb = require('./mongodb');//引入mongodb配置文件，同目录下mongodb.js文件，默认引入js文件。
var constants = require('./constants');//同上，引入常量类

var Schema = mongodb.mongoose.Schema;//获取mongodb schema
var ObjectId = Schema.ObjectId;//获取ObjectId

//sheme对象
var LinkSchema = new Schema({
    name: {type: String, required: true},
    url: {type: String, required: true},
    blank: {type: 'Number', default: 0, required: true, min: 0, max: 1}
}, {
    collection: "link" //对应mongodb的集合表
});
//构建model对象，所有对数据库操作都对该对象操作
var LinkModel = mongodb.mongoose.model("Link", LinkSchema);

//DAO接口
var LinkDAO = function () {
};
//通过prototype属性实现DAO接口
LinkDAO.prototype.save = function (obj, callback) {
    var LinkEntity = new LinkModel(obj);
    LinkEntity.save(function (err) {
        callback(err);
    });
};


/**
 * 更新信息
 * @param obj
 * @param callback
 */
LinkDAO.prototype.update = function (obj, callback) {
    LinkModel.update(
        {"_id": obj.id},
        {$set:{
            "name": obj.name,
            "url": obj.url,
            "blank": obj.blank }
        },
        function (err) {
            callback(err);
        });

};
LinkDAO.prototype.findAll = function (callback) {
    LinkModel.find(function (err, docs) {
            callback(err, docs);
        });
};
LinkDAO.prototype.delete = function (id, callback) {
    LinkModel.remove({_id: id},function (err) {
            callback(err);
        });
};
//把DAO接口开放出去给controller调用
module.exports = new LinkDAO();
