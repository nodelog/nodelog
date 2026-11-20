// Wiki 知识库（Space）模型：一个 Space = 一棵页面树 + 一套配置。
// 用户可建任意多个（体系定案 D1）；默认公开、预留 private（D4）。
// 风格对齐 Category.js；slug 唯一、口径沿用 Tag.slugify。
var mongodb = require('./mongodb');
var constants = require('./constants');

var Schema = mongodb.mongoose.Schema;
var ObjectId = Schema.ObjectId;

var SpaceSchema = new Schema({
    name: {type: String, required: true},                 // 知识库名称，如「链付收银SAAS」
    slug: {type: String, required: true, unique: true, index: true}, // URL 语义标识
    description: {type: String, default: ''},             // 简介
    visibility: {
        type: String,
        enum: [constants.SPACE_VISIBILITY_PUBLIC, constants.SPACE_VISIBILITY_PRIVATE],
        default: constants.SPACE_VISIBILITY_PUBLIC
    },
    owner: {type: ObjectId, required: true},              // 创建者 → User._id
    cover: {type: String, default: ''},
    order: {type: Number, default: 0},
    status: {type: Number, default: 0, required: true, min: 0, max: 1}, // 0 正常 / 1 软删
    createTime: {type: Date, default: Date.now},
    modifyTime: {type: Date, default: Date.now}
}, {collection: 'space'});

SpaceSchema.index({visibility: 1, status: 1, order: 1});
SpaceSchema.index({owner: 1, status: 1});

var SpaceModel = mongodb.mongoose.model('Space', SpaceSchema);

// 与 Tag.slugify 同源口径：小写、空白转 -、只留中英文数字与连字符。
// 独立一份是为了避免 model 层 require controller（分层方向反），两处逻辑一致即可。
function slugify(name) {
    return String(name == null ? '' : name).trim().toLowerCase()
        .replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '');
}

var SpaceDAO = function () {};

SpaceDAO.prototype.save = function (obj, callback) {
    var entity = new SpaceModel(obj);
    entity.save(function (err) { callback(err, err ? null : entity); });
};
SpaceDAO.prototype.findBySlug = function (slug, callback) {
    SpaceModel.findOne({slug: slug, status: 0}, callback);
};
SpaceDAO.prototype.findById = function (id, callback) {
    SpaceModel.findOne({_id: id, status: 0}, callback);
};
SpaceDAO.prototype.findByName = function (name, callback) {
    SpaceModel.findOne({name: name, status: 0}, callback);
};
SpaceDAO.prototype.findByNameExclude = function (name, id, callback) {
    SpaceModel.findOne({name: name, _id: {$ne: id}, status: 0}, callback);
};
SpaceDAO.prototype.findBySlugExclude = function (slug, id, callback) {
    SpaceModel.findOne({slug: slug, _id: {$ne: id}, status: 0}, callback);
};
// 公开列表：游客只看 public；登录用户额外看自己 owner 的 private（可见性收敛在数据层，路由不加鉴权）
SpaceDAO.prototype.findVisible = function (currentUser, callback) {
    var term;
    if (currentUser == null) {
        term = {status: 0, visibility: constants.SPACE_VISIBILITY_PUBLIC};
    } else {
        term = {status: 0, $or: [
            {visibility: constants.SPACE_VISIBILITY_PUBLIC},
            {visibility: constants.SPACE_VISIBILITY_PRIVATE, owner: currentUser._id}
        ]};
    }
    SpaceModel.find(term).sort({order: 1, name: 1}).exec(callback);
};
SpaceDAO.prototype.findByOwner = function (owner, callback) {
    SpaceModel.find({owner: owner, status: 0}).sort({order: 1, name: 1}).exec(callback);
};
// 管理员工作台：列出全部未软删的知识库（普通用户用 findByOwner 只看自己的）
SpaceDAO.prototype.findAllForAdmin = function (callback) {
    SpaceModel.find({status: 0}).sort({order: 1, name: 1}).exec(callback);
};
// 单个可见性判定（供文档详情复用）：公开或自己是 owner
SpaceDAO.prototype.isVisible = function (space, currentUser) {
    if (!space) return false;
    if (space.visibility === constants.SPACE_VISIBILITY_PUBLIC) return true;
    if (currentUser && space.owner && String(space.owner) === String(currentUser._id)) return true;
    return currentUser && currentUser.role === 0; // 管理员豁免
};
SpaceDAO.prototype.update = function (id, fields, callback) {
    var set = Object.assign({modifyTime: new Date()}, fields || {});
    delete set._id;
    delete set.owner;   // 归属不可改
    SpaceModel.update({_id: id, status: 0}, {$set: set}, callback);
};
SpaceDAO.prototype.delete = function (id, callback) {
    SpaceModel.update({_id: id}, {$set: {status: 1, modifyTime: new Date()}}, callback);
};
module.exports = new SpaceDAO();
module.exports.slugify = slugify;
module.exports.Model = SpaceModel;
