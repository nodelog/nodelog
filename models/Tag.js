var mongodb = require('./mongodb');
var constants = require('./constants');

var Schema = mongodb.mongoose.Schema;
var ObjectId = Schema.ObjectId;

// P0/P1 标签体系：扁平标签，按名称去重，统计文章数用于标签云
var TagSchema = new Schema({
    name: {type: String, required: true},
    slug: {type: String, index: true, unique: true},   // 永久链接
    count: {type: Number, default: 0},                 // 关联文章数（缓存）
    createTime: {type: Date, default: Date.now}
}, {
    collection: "tag"
});

var TagModel = mongodb.mongoose.model("Tag", TagSchema);

function slugify(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '');
}

var TagDAO = function () {
};
TagDAO.prototype.save = function (obj, callback) {
    var entity = new TagModel(obj);
    entity.save(function (err) { callback(err); });
};
TagDAO.prototype.findByName = function (name, callback) {
    TagModel.findOne({"name": name}, function (err, obj) { callback(err, obj); });
};
TagDAO.prototype.findBySlug = function (slug, callback) {
    TagModel.findOne({"slug": slug}, function (err, obj) { callback(err, obj); });
};
TagDAO.prototype.findAll = function (callback) {
    TagModel.find({}).sort({count: -1, name: 1}).exec(function (err, docs) { callback(err, docs); });
};
// 同步文章标签：保证每个标签存在并刷新计数
// 修复点：
//  1) 用 $set 而非 $setOnInsert 写 name —— 否则 name 只在首次插入时写入、之后被冻结，
//     导致 Tag.name 与 Content.tags 大小写/写法漂移后无法再对齐。
//  2) count 不再盲目 $inc（每次保存 +1、永不递减，会严重失真），改为按 Content 真实匹配重算。
TagDAO.prototype.syncTags = function (tagNames, callback) {
    tagNames = (tagNames || []).filter(function (t) { return t && t.trim(); }).map(function (t) { return t.trim(); });
    if (!tagNames.length) return callback(null);
    var async = require('async');
    async.eachSeries(tagNames, function (name, cb) {
        var slug = slugify(name);
        TagModel.findOneAndUpdate(
            {"slug": slug},
            {$set: {name: name, slug: slug}, $setOnInsert: {count: 0}},
            {upsert: true, new: true},
            function (err, doc) {
                if (err || !doc) return cb(err);
                // 用与查询一致的大小写不敏感匹配，从 Content 真实统计文章数
                var Content = require('./Content');
                Content.getCountByTag(name, null, function (e2, total) {
                    if (e2) return cb(e2);
                    TagModel.updateOne({_id: doc._id}, {$set: {count: total || 0}}).exec(function (e3) { cb(e3); });
                });
            }
        );
    }, function (err) { callback(err); });
};
module.exports = new TagDAO();
module.exports.slugify = slugify;
