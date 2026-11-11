var mongodb = require('./mongodb');
var constants = require('./constants');

var Schema = mongodb.mongoose.Schema;
var ObjectId = Schema.ObjectId;

// 友链（D8 软删）：expand 加 status(0 正常/1 已删) + createTime/modifyTime + 组合索引。
// 历史文档无 status 时由查询 status:{$ne:1} 兼容 + 迁移脚本回填 status:0（§5.5，幂等）。
var LinkSchema = new Schema({
    name: {type: String, required: true},
    url: {type: String, required: true},
    blank: {type: 'Number', default: 0, required: true, min: 0, max: 1},
    status: {type: 'Number', default: 0, required: true, min: 0, max: 1},
    createTime: {type: Date, default: Date.now},
    modifyTime: {type: Date, default: Date.now}
}, {
    collection: "link"
});
LinkSchema.index({status: 1, createTime: -1});

// 构建model对象，所有对数据库操作都对该对象操作
var LinkModel = mongodb.mongoose.model("Link", LinkSchema);

//DAO接口
var LinkDAO = function () {};
//通过prototype属性实现DAO接口
LinkDAO.prototype.save = function (obj, callback) {
    var LinkEntity = new LinkModel(obj);
    LinkEntity.save(function (err) {
        // 追加返回新建文档（含 _id）供导入/审计定位；旧调用方只取 err，不受影响。
        callback(err, err ? null : LinkEntity);
    });
};

/**
 * 更新信息（带 status:0 过滤：软删后不可再编辑）
 */
LinkDAO.prototype.update = function (obj, callback) {
    LinkModel.update(
        {"_id": obj.id, "status": 0},
        {$set:{
            "name": obj.name,
            "url": obj.url,
            "blank": obj.blank,
            "modifyTime": new Date()
        }},
        function (err) {
            callback(err);
        });
};
// 前台 /link/list 与后台共用；保持签名与响应 {success:true,data} 不变，仅过滤软删。
LinkDAO.prototype.findAll = function (callback) {
    LinkModel.find({"status": 0}, {}, {sort: {createTime: -1}}, function (err, docs) {
        callback(err, docs);
    });
};
// 后台分页列表（与公开 findAll 并存不混）
LinkDAO.prototype.findByPage = function (page, callback) {
    LinkModel.find({"status": 0})
        .sort({createTime: -1})
        .limit(constants.PER_PAGE_COUNT)
        .skip((page - 1) * constants.PER_PAGE_COUNT)
        .exec(function (err, docs) { callback(err, docs); });
};
// D8：由硬删 remove 改软删 status=1，响应 {success,msg} 不变，可恢复。
LinkDAO.prototype.delete = function (id, callback) {
    LinkModel.update({_id: id, status: 0}, {$set: {status: 1, modifyTime: new Date()}}, function (err) {
        callback(err);
    });
};

// 通用后台 DAO 方法（软删 status=1）。
require('./_adminDao').attach(LinkDAO, LinkModel, {softStatus: constants.CATEGORY_UNABLE_STATUS});

//把DAO接口开放出去给controller调用
module.exports = new LinkDAO();
