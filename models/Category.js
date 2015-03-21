var mongodb = require('./mongodb');
var constants = require('./constants');

var Schema = mongodb.mongoose.Schema;
var ObjectId = Schema.ObjectId;

var CategorySchema = new Schema({
    name: {type: 'String', required: true},
    createTime: { type: Date, default: Date.now},
    modifyTime: {type: Date, default: Date.now},
    status: {type: 'Number', default: 0, required: true, min: 0, max: 1}
}, {
    collection: "category"
});

var CategoryModel = mongodb.mongoose.model("Category", CategorySchema);
//
var CategoryDAO = function () {
};
CategoryDAO.prototype.save = function (obj, callback) {
    var categoryEntity = new CategoryModel(obj);
    categoryEntity.save(function (err) {
        callback(err);
    });
};
CategoryDAO.prototype.findByName = function (name, callback) {
    CategoryModel.findOne({"name": name, "status": constants.CATEGORY_ENABLE_STATUS}, function (err, obj) {
        callback(err, obj);
    });
};
CategoryDAO.prototype.findById = function (id, callback) {
    CategoryModel.findOne({"_id": id, "status": constants.CATEGORY_ENABLE_STATUS}, function (err, obj) {
        callback(err, obj);
    });
};

CategoryDAO.prototype.findByPage = function (page, callback) {
    var query = CategoryModel.find({"status": constants.CATEGORY_ENABLE_STATUS});
    query.sort({"name": 1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        callback(err, docs);
    });
};
CategoryDAO.prototype.findAll = function (callback) {
    CategoryModel.find({"status": constants.CATEGORY_ENABLE_STATUS},{},{sort:{"name":1}}, function (err, docs) {
        callback(err, docs);
    });
};
CategoryDAO.prototype.getCount = function (callback) {
    CategoryModel.count({"status": constants.CATEGORY_ENABLE_STATUS}, function (err, total) {
        callback(err, total);
    });
};
CategoryDAO.prototype.delete = function (id, callback) {
    CategoryModel.update({"_id": id}, {$set: {'status': constants.CATEGORY_UNABLE_STATUS }}, function (err) {
        callback(err);
    });
};
CategoryDAO.prototype.update = function (id, name, callback) {
    CategoryModel.update({"_id": id}, {$set: {"name": name, "modifyTime": new Date()}}, function (err) {
        callback(err);
    });
};
module.exports = new CategoryDAO();