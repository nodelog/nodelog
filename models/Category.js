var mongodb = require('./mongodb');
var constants = require('./constants');

var Schema = mongodb.mongoose.Schema;
var ObjectId = Schema.ObjectId;

var CategorySchema = new Schema({
    name: {type: 'String', required: true},
    createTime: { type: Date, default: Date.now},
    modifyTime: {type: Date, default: Date.now},
    status: {type: 'Number', default: 0, required: true, min: 0, max: 1},
    // ---- P0/P1 分类体系扩展 ----
    slug: {type: String, index: true, sparse: true},     // 永久链接
    parent: {type: ObjectId, default: null},             // 父分类（层级）
    description: {type: String},                         // 分类描述（SEO/列表）
    cover: {type: String},                              // 封面图
    order: {type: Number, default: 0}                   // 排序
}, {
    collection: "category"
});

CategorySchema.index({order: 1, name: 1});

var CategoryModel = mongodb.mongoose.model("Category", CategorySchema);
//
var CategoryDAO = function () {
};
CategoryDAO.prototype.save = function (obj, callback) {
    var categoryEntity = new CategoryModel(obj);
    categoryEntity.save(function (err) {
        // 追加返回新建文档（含 _id）供导入/审计定位；旧调用方只取 err，不受影响。
        callback(err, err ? null : categoryEntity);
    });
};
CategoryDAO.prototype.findByName = function (name, callback) {
    CategoryModel.findOne({"name": name, "status": constants.CATEGORY_ENABLE_STATUS}, function (err, obj) {
        callback(err, obj);
    });
};
CategoryDAO.prototype.findByNameExclude = function (name, id, callback) {
    CategoryModel.findOne({"name": name, "_id": {$ne: id}, "status": constants.CATEGORY_ENABLE_STATUS}, function (err, obj) {
        callback(err, obj);
    });
};
CategoryDAO.prototype.findById = function (id, callback) {
    CategoryModel.findOne({"_id": id, "status": constants.CATEGORY_ENABLE_STATUS}, function (err, obj) {
        callback(err, obj);
    });
};
CategoryDAO.prototype.findByParent = function (parent, callback) {
    CategoryModel.find({"parent": parent, "status": constants.CATEGORY_ENABLE_STATUS}).sort({order: 1, name: 1}).exec(function (err, docs) {
        callback(err, docs);
    });
};
CategoryDAO.prototype.findByPage = function (page, callback) {
    CategoryModel.find({"status": constants.CATEGORY_ENABLE_STATUS})
        .sort({order: 1, name: 1})
        .limit(constants.PER_PAGE_COUNT)
        .skip((page - 1) * constants.PER_PAGE_COUNT)
        .exec(function (err, docs) {
            callback(err, docs);
        });
};
CategoryDAO.prototype.findAll = function (callback) {
    CategoryModel.find({"status": constants.CATEGORY_ENABLE_STATUS}, {}, {sort: {order: 1, name: 1}}, function (err, docs) {
        callback(err, docs);
    });
};
// 按 id 批量拉取（供 Content.enrichDocs 消 N+1，避免逐条查询）
CategoryDAO.prototype.findByIds = function (ids, callback) {
    if (!ids || !ids.length) return callback(null, []);
    CategoryModel.find({"_id": {$in: ids}}, function (err, docs) {
        callback(err, docs || []);
    });
};
CategoryDAO.prototype.getCount = function (callback) {
    CategoryModel.count({"status": constants.CATEGORY_ENABLE_STATUS}, function (err, total) {
        callback(err, total);
    });
};
CategoryDAO.prototype.delete = function (id, callback) {
    // 先检查是否有子分类，避免产生孤儿
    CategoryModel.count({"parent": id, "status": constants.CATEGORY_ENABLE_STATUS}, function (err, childCount) {
        if (err) return callback(err);
        if (childCount > 0) return callback(new Error('HAS_CHILD'));
        CategoryModel.update({"_id": id}, {$set: {'status': constants.CATEGORY_UNABLE_STATUS }}, function (err) {
            callback(err);
        });
    });
};
CategoryDAO.prototype.update = function (id, fields, callback) {
    var set = {"modifyTime": new Date()};
    if (fields.name !== undefined) set.name = fields.name;
    if (fields.slug !== undefined) set.slug = fields.slug;
    if (fields.parent !== undefined) set.parent = fields.parent;
    if (fields.description !== undefined) set.description = fields.description;
    if (fields.cover !== undefined) set.cover = fields.cover;
    if (fields.order !== undefined) set.order = fields.order;
    CategoryModel.update({"_id": id}, {$set: set}, function (err) {
        callback(err);
    });
};
// 通用后台 DAO 方法（软删 status=1）；findByNameExclude 供编辑自身判重（F02）。
require('./_adminDao').attach(CategoryDAO, CategoryModel, {softStatus: constants.CATEGORY_UNABLE_STATUS});

module.exports = new CategoryDAO();
