var mongodb = require('./mongodb');
var constants = require('./constants');

var Schema = mongodb.mongoose.Schema;
var ObjectId = Schema.ObjectId;

var CommentSchema = new Schema({
    comment: {type: String, required: true},
    commenter: {type: ObjectId},
    content: {type: ObjectId},
    createTime: { type: Date, default: Date.now},
    modifyTime: {type: Date, default: Date.now},
    status: {type: Number, default: 0},
    userName: {type: String}//不保存数据库中，只在页面显示。
}, {
    collection: "comment"
});

var CommentModel = mongodb.mongoose.model("Comment", CommentSchema);
//
var CommentDAO = function () {
};
CommentDAO.prototype.save = function (obj, callback) {
    var CommentEntity = new CommentModel(obj);
    CommentEntity.save(function (err) {
        callback(err);
    });
};
CommentDAO.prototype.findByName = function (name, callback) {
    CommentModel.findOne({"name": name, "status": constants.COMMENT_ENABLE_STATUS}, function (err, obj) {
        callback(err, obj);
    });
};
CommentDAO.prototype.findById = function (id, callback) {
    CommentModel.findOne({"_id": id, "status": constants.COMMENT_ENABLE_STATUS}, function (err, obj) {
        callback(err, obj);
    });
};
CommentDAO.prototype.findByPage = function (page, callback) {
    var query = CommentModel.find({"status": constants.COMMENT_ENABLE_STATUS});
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        callback(err, docs);
    });
};
CommentDAO.prototype.findByContent = function (page, content, callback) {
    var query = CommentModel.find({"content": content, "status": constants.COMMENT_ENABLE_STATUS});
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        callback(err, docs);
    });
};

CommentDAO.prototype.getCount = function (callback) {
    CommentModel.count({"status": constants.COMMENT_ENABLE_STATUS}, function (err, total) {
        callback(err, total);
    });
};

CommentDAO.prototype.getCountByContent = function (content, callback) {
    CommentModel.count({"content": content, "status": constants.COMMENT_ENABLE_STATUS}, function (err, total) {
        callback(err, total);
    });
};
CommentDAO.prototype.delete = function (id, callback) {
    CommentModel.update({"_id": id}, {$set: {'status': constants.COMMENT_UNABLE_STATUS}}, function (err) {
        callback(err);
    });
};
CommentDAO.prototype.update = function (obj, callback) {
    CommentModel.update({"_id": obj.id}, {$set: {"comment": obj.comment, "modifyTime": new Date()}}, function (err) {
        callback(err);
    });
};
module.exports = new CommentDAO();