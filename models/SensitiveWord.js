// 敏感词库（SPEC-MODERATION §3.2）。词库存 MongoDB，进程内缓存由 moderationMatcher 维护，
// 写后由 sensitiveWordAdmin 调 matcher.invalidate() 热更新。DAO 沿用项目 err-first callback 单例风格。
// 软删 status=1（partial unique：启用词不重，软删后可重建同名词）。
var mongodb = require('./mongodb');
var adminDao = require('./_adminDao');

var Schema = mongodb.mongoose.Schema;
var ObjectId = Schema.ObjectId;

var SensitiveWordSchema = new Schema({
    word:           {type: String, required: true},                       // 原词，后台展示
    wordNormalized: {type: String, required: true},                       // normalizeForMatch(word)，匹配唯一依据
    category:       {type: String, default: 'custom',
                      enum: ['politics', 'porn', 'ad', 'abuse', 'custom']},
    status:         {type: Number, default: 0, required: true, min: 0, max: 1}, // 0 启用 / 1 软删停用
    createdBy:      {type: ObjectId},                                     // 只从 session.user._id 取
    createTime:     {type: Date, default: Date.now},
    modifyTime:     {type: Date, default: Date.now}
}, {collection: 'sensitive_word'});

// 启用词不重（partial：软删后可重建同名词，普通 unique 会永久占坑）；后台列表筛选排序。
SensitiveWordSchema.index({wordNormalized: 1}, {unique: true, partialFilterExpression: {status: 0}});
SensitiveWordSchema.index({status: 1, category: 1, createTime: -1});

var SensitiveWordModel = mongodb.mongoose.model('SensitiveWord', SensitiveWordSchema);

var SensitiveWordDAO = function () {};

// cb(err, doc)；11000 冲突由 controller 的 kit.normalizeDaoError 映射「该敏感词已存在」。
SensitiveWordDAO.prototype.save = function (obj, callback) {
    var entity = new SensitiveWordModel(obj);
    entity.save(function (err, doc) { callback(err, err ? null : doc); });
};

// 仅取启用词供 matcher 加载/刷新。含 word 原词：命中时需写 ViolationLog.hitWord（§3.3/M5），
// 比"返回 hitWordId 后再查一次库"省一次 DB 读（性能预算 §11.2）。
SensitiveWordDAO.prototype.findAllEnabled = function (callback) {
    SensitiveWordModel.find({status: 0}).select('_id word wordNormalized category')
        .exec(function (err, docs) { callback(err, docs || []); });
};

// 查重（含软删，用于提示「已停用可恢复」）。
SensitiveWordDAO.prototype.findByNormalized = function (wordNormalized, callback) {
    SensitiveWordModel.findOne({wordNormalized: wordNormalized}, function (err, doc) {
        callback(err, doc || null);
    });
};

adminDao.attach(SensitiveWordDAO, SensitiveWordModel, {softStatus: 1});

module.exports = new SensitiveWordDAO();
module.exports.SensitiveWordModel = SensitiveWordModel;
