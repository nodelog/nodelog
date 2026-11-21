var mongodb = require('./mongodb');
var constants = require('./constants');
var async = require('async');

var Schema = mongodb.mongoose.Schema;
var ObjectId = Schema.ObjectId;

// P0/P1 标签体系：扁平标签，按名称去重，统计文章数用于标签云。
// 本轮仅 expand：加 status(0 正常/1 禁用) + modifyTime + 组合索引；不删字段、不改类型（§5.4）。
var TagSchema = new Schema({
    name: {type: String, required: true},
    slug: {type: String, index: true, unique: true},   // 永久链接；唯一约束 -> 11000 归一化
    count: {type: Number, default: 0},                 // 关联文章数（缓存，唯一写入者=syncTags）
    createTime: {type: Date, default: Date.now},
    status: {type: Number, default: 0, required: true, min: 0, max: 1},
    modifyTime: {type: Date, default: Date.now}
}, {
    collection: "tag"
});
// 软删过滤 + 标签云排序（data-modeling 部分索引思想：查询带 status:0 走此复合索引）
TagSchema.index({status: 1, count: -1});

var TagModel = mongodb.mongoose.model("Tag", TagSchema);

function slugify(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '');
}

var TagDAO = function () {};
TagDAO.prototype.save = function (obj, callback) {
    var entity = new TagModel(obj);
    entity.save(function (err, doc) { callback(err, doc); });
};
// 前台 /tags /tag/:slug 与后台详情共用：一律过滤软删，响应 {docs} 结构不变（I-3/I-5）。
TagDAO.prototype.findByName = function (name, callback) {
    TagModel.findOne({"name": name, "status": constants.CATEGORY_ENABLE_STATUS}, function (err, obj) { callback(err, obj); });
};
TagDAO.prototype.findByNameExclude = function (name, id, callback) {
    TagModel.findOne({"name": name, "_id": {$ne: id}, "status": constants.CATEGORY_ENABLE_STATUS}, function (err, obj) { callback(err, obj); });
};
TagDAO.prototype.findBySlug = function (slug, callback) {
    TagModel.findOne({"slug": slug, "status": constants.CATEGORY_ENABLE_STATUS}, function (err, obj) { callback(err, obj); });
};
TagDAO.prototype.findAll = function (callback) {
    TagModel.find({status: constants.CATEGORY_ENABLE_STATUS}).sort({count: -1, name: 1})
        .exec(function (err, docs) { callback(err, docs); });
};
// 同步文章标签：保证每个标签存在并按真实文章数重算 count。
// 这是全项目【唯一】的 count 写入实现（上游 4c47d5f 已改 $inc -> 重算，本轮不新增第二套算法）。
// 修复点：
//  1) 用 $set 而非 $setOnInsert 写 name —— 否则 name 只在首次插入时写入、之后被冻结，
//     导致 Tag.name 与 Content.tags 大小写/写法漂移后无法再对齐。
//  2) count 不再盲目 $inc，改为按 Content.getCountByTag(name, null, cb) 的真实公开可见数重算。
//  3) 本轮补：upsert 例外不带 status（软删标签原地复用，避免撞 slug unique 11000）；
//     updateOne 同时写 modifyTime；total>0 时条件性复活 status:0（有活跃文章必可见）。
TagDAO.prototype.syncTags = function (tagNames, callback) {
    tagNames = (tagNames || []).filter(function (t) { return t && t.trim(); }).map(function (t) { return t.trim(); });
    if (!tagNames.length) return callback(null);
    async.eachSeries(tagNames, function (name, cb) {
        var slug = slugify(name);
        // 例外：此处 upsert 不挂 status 条件 —— 软删标签必须原地复用同一文档。
        TagModel.findOneAndUpdate(
            {"slug": slug},
            {$set: {name: name, slug: slug}, $setOnInsert: {count: 0}},
            {upsert: true, new: true},
            function (err, doc) {
                if (err || !doc) return cb(err);
                var Content = require('./Content');
                // 必须传 null：传 sessionUser 会带上「我的私有/草稿」$or，count 随查看者变，G04 不可判定。
                Content.getCountByTag(name, null, function (e2, total) {
                    if (e2) return cb(e2);
                    var set = {count: total || 0, modifyTime: new Date()};
                    if ((total || 0) > 0) set.status = constants.CATEGORY_ENABLE_STATUS; // 活跃文章 -> 自动复活
                    TagModel.updateOne({_id: doc._id}, {$set: set}).exec(function (e3) { cb(e3); });
                });
            }
        );
    }, function (err) { callback(err); });
};

// 薄编排（§3.7）：仅对 oldTags ∪ newTags 去重后，委托 syncTags 一次；函数内禁止第二套 count 计算。
// 关键顺序：调用方必须在 Content.save/update/delete 成功后才调本函数（重算读已落盘状态）。
TagDAO.prototype.reconcileForContent = function (oldTags, newTags, callback) {
    var union = {}, names = [];
    (oldTags || []).concat(newTags || []).forEach(function (t) {
        var name = String(t == null ? '' : t).trim();
        if (name && !union[name]) { union[name] = 1; names.push(name); }
    });
    if (!names.length) return callback(null);
    TagDAO.prototype.syncTags(names, callback);
};

// 全量自愈：枚举所有标签名（含 status=1，顺带修正隐藏标签的历史漂移）→ 委托 syncTags。
// 会按上面的规则一并复活「被公开文章引用」的软删标签（展示一致优先，刻意行为）。
TagDAO.prototype.reconcileAllCounts = function (callback) {
    TagModel.find({}).select('name slug').exec(function (err, docs) {
        if (err) return callback(err);
        var names = (docs || []).map(function (d) { return d.name; }).filter(Boolean);
        if (!names.length) return callback(null);
        TagDAO.prototype.syncTags(names, callback);
    });
};

// 通用后台 DAO 方法（软删 status=1；查询由 controller 带 status:0）。
require('./_adminDao').attach(TagDAO, TagModel, {softStatus: constants.CATEGORY_UNABLE_STATUS});

module.exports = new TagDAO();
module.exports.slugify = slugify;
