var mongodb = require('./mongodb');//引入mongodb配置文件，同目录下mongodb.js文件，默认引入js文件。
var constants = require('./constants');//同上，引入常量类
var async = require('async');

var Schema = mongodb.mongoose.Schema;//获取mongodb schema
var ObjectId = Schema.ObjectId;//获取ObjectId

//sheme对象
var ContentSchema = new Schema({
    name: {type: String, required: true},
    content: {type: String, required: true},
    author: {type: ObjectId},//外键
    category: {type: ObjectId},//外键
    createTime: { type: Date, default: Date.now},
    modifyTime: {type: Date, default: Date.now},
    view: {type: Number, default: 0},
    original: {type: String},//原文链接 输入即为转载
    status: {type: 'Number', default: 0, required: true, min: 0, max: 2},
    // ---- P0 内容模型扩展（向后兼容：旧数据这些字段为 undefined）----
    slug: {type: String, index: true, sparse: true},        // 永久链接
    excerpt: {type: String},                                // 摘要
    cover: {type: String},                                  // 封面图 URL
    tags: {type: [String], index: true, default: []},       // 标签
    seo: {                                                  // SEO 元数据
        title: {type: String},
        keywords: {type: String},
        description: {type: String}
    },
    draft: {type: Boolean, default: false},                 // 是否草稿
    readingTime: {type: Number, default: 0},                // 预计阅读分钟
    contentType: {type: String, default: 'html', enum: ['html', 'markdown']} // 内容格式
}, {
    collection: "content" //对应mongodb的集合表
});

// 性能：为常用的列表排序与查询条件建立索引
ContentSchema.index({ createTime: -1 });           // 列表按时间倒序分页
ContentSchema.index({ author: 1, status: 1 });     // 我的日志 / 按作者+状态查询
ContentSchema.index({ category: 1, status: 1 });   // 按分类+状态查询
ContentSchema.index({ name: 1 });                  // 标题搜索
// P1 全文检索：标题 + 正文 + 标签（注意正文较大，索引会占用空间，按需建立）
ContentSchema.index({ name: 'text', content: 'text', tags: 'text' });

// 新内容默认发布状态；草稿不进公开列表
function visibleTerm(currentUser) {
    if (currentUser == null) {
        return {"status": constants.CONTENT_ENABLE_STATUS, "draft": false};
    }
    return {$or: [
        {"status": constants.CONTENT_ENABLE_STATUS, "draft": false},
        {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
    ]};
}

// 批量补全作者/分类信息，替代原先逐条 async.whilst 的 N+1 查询
function enrichDocs(docs, callback) {
    if (!docs || !docs.length) {
        return callback(null, docs);
    }
    var authorIds = [], catIds = [];
    docs.forEach(function (d) {
        if (d.author) authorIds.push(d.author);
        if (d.category) catIds.push(d.category);
    });
    var User = require('./User');
    var Category = require('./Category');
    async.parallel({
        users: function (cb) {
            if (!authorIds.length) return cb(null, []);
            User.find({_id: {$in: authorIds}}, function (e, us) { cb(e, us || []); });
        },
        cats: function (cb) {
            if (!catIds.length) return cb(null, []);
            Category.find({_id: {$in: catIds}}, function (e, cs) { cb(e, cs || []); });
        }
    }, function (e, r) {
        var um = {}, cm = {};
        (r.users || []).forEach(function (u) { um[String(u._id)] = u; });
        (r.cats || []).forEach(function (c) { cm[String(c._id)] = c; });
        docs.forEach(function (d) {
            var u = d.author ? um[String(d.author)] : null;
            var c = d.category ? cm[String(d.category)] : null;
            d.userName = u ? u.userName : '佚名';
            d.realName = u ? (u.realName || u.userName) : '佚名';
            d.email = u ? (u.email || '') : '';
            d.categoryName = c ? c.name : '未知';
        });
        callback(e, docs);
    });
}

//构建model对象，所有对数据库操作都对该对象操作
var ContentModel = mongodb.mongoose.model("Content", ContentSchema);

//DAO接口
var ContentDAO = function () {
};
//通过prototype属性实现DAO接口
ContentDAO.prototype.save = function (obj, callback) {
    var ContentEntity = new ContentModel(obj);
    ContentEntity.save(function (err) {
        callback(err);
    });
};
ContentDAO.prototype.findByName = function (name, callback) {
    ContentModel.findOne({"name": name, "status": constants.CONTENT_ENABLE_STATUS}, function (err, obj) {
        callback(err, obj);
    });
};
ContentDAO.prototype.findById = function (id, callback) {
    ContentModel.findOne({"_id": id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}, function (err, obj) {
        callback(err, obj);
    });
};
ContentDAO.prototype.findByPage = function (page, currentUser, callback) {
    var query = ContentModel.find(visibleTerm(currentUser));
    query.select('name author category createTime modifyTime view status original slug cover excerpt tags');
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        if (err) return callback(err, docs);
        enrichDocs(docs, callback);
    });
};
ContentDAO.prototype.findByCategory = function (page, category, currentUser, callback) {
    var term = {"category": category};
    if (currentUser == null) {
        term = {"category": category, "status": constants.CONTENT_ENABLE_STATUS, "draft": false};
    } else {
        term = {"category": category, $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": false},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ]};
    }
    var query = ContentModel.find(term);
    query.select('name author category modifyTime view original slug cover excerpt tags');
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        if (err) return callback(err, docs);
        enrichDocs(docs, callback);
    });
};
ContentDAO.prototype.findByWord = function (page, word, currentUser, callback) {
    var term = {"name": new RegExp(escapeRegExp(word), 'i')};
    if (currentUser == null) {
        term = {"name": new RegExp(escapeRegExp(word), 'i'), "status": constants.CONTENT_ENABLE_STATUS, "draft": false};
    } else {
        term = {"name": new RegExp(escapeRegExp(word), 'i'), $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": false},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ]};
    }
    var query = ContentModel.find(term);
    query.select('name author category modifyTime view original slug cover excerpt tags');
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        if (err) return callback(err, docs);
        enrichDocs(docs, callback);
    });
};
// P1 全文检索（基于 MongoDB $text 索引）
ContentDAO.prototype.searchText = function (page, word, currentUser, callback) {
    var term = {"$text": {$search: word}};
    if (currentUser == null) {
        term = {"$text": {$search: word}, "status": constants.CONTENT_ENABLE_STATUS, "draft": false};
    } else {
        term = {"$text": {$search: word}, $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": false},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ]};
    }
    var query = ContentModel.find(term, {score: {$meta: "textScore"}});
    query.select('name author category modifyTime view original slug cover excerpt tags');
    query.sort({"score": {$meta: "textScore"}});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        if (err) return callback(err, docs);
        enrichDocs(docs, callback);
    });
};
ContentDAO.prototype.findAllByWord = function (word, currentUser, callback) {
    var term = {"name": new RegExp(escapeRegExp(word), 'i'), "status": constants.CONTENT_ENABLE_STATUS, "draft": false};
    if (currentUser != null) {
        term = {"name": new RegExp(escapeRegExp(word), 'i'), $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": false},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ]};
    }
    var query = ContentModel.find(term);
    query.select('name');
    query.sort({"createTime": -1});
    query.exec(function (err, docs) {
        callback(err, docs);
    });
};
ContentDAO.prototype.findByUser = function (page, author, callback) {
    var query = ContentModel.find({"author": author, "status": {$ne: constants.CONTENT_UNABLE_STATUS}});
    query.select('name author category createTime modifyTime view status original slug cover excerpt tags');
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        callback(err, docs);
    });
};
ContentDAO.prototype.findByTag = function (page, tag, currentUser, callback) {
    var term;
    if (currentUser == null) {
        term = {"tags": tag, "status": constants.CONTENT_ENABLE_STATUS, "draft": false};
    } else {
        term = {"tags": tag, $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": false},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ]};
    }
    var query = ContentModel.find(term);
    query.select('name author category createTime modifyTime view status original slug cover excerpt tags');
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        if (err) return callback(err, docs);
        enrichDocs(docs, callback);
    });
};
ContentDAO.prototype.getCountByTag = function (tag, currentUser, callback) {
    var term;
    if (currentUser == null) {
        term = {"tags": tag, "status": constants.CONTENT_ENABLE_STATUS, "draft": false};
    } else {
        term = {"tags": tag, $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": false},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ]};
    }
    ContentModel.count(term, function (err, total) { callback(err, total); });
};
ContentDAO.prototype.getCount = function (currentUser, callback) {
    ContentModel.count(visibleTerm(currentUser), function (err, total) {
        callback(err, total);
    });
};
ContentDAO.prototype.getCountByCategory = function (category, currentUser, callback) {
    var term;
    if (currentUser == null) {
        term = {"category": category, "status": constants.CONTENT_ENABLE_STATUS, "draft": false};
    } else {
        term = {"category": category, $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": false},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ]};
    }
    ContentModel.count(term, function (err, total) {
        callback(err, total);
    });
};
ContentDAO.prototype.getCountByCategoryOnly = function (category, callback) {
    ContentModel.count({"category": category, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}, function (err, total) {
        callback(err, total);
    });
};
ContentDAO.prototype.getCountByUser = function (author, callback) {
    ContentModel.count({"author": author, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}, function (err, total) {
        callback(err, total);
    });
};
ContentDAO.prototype.getCountByWord = function (word, currentUser, callback) {
    var term;
    if (currentUser == null) {
        term = {"name": new RegExp(escapeRegExp(word), 'i'), "status": constants.CONTENT_ENABLE_STATUS, "draft": false};
    } else {
        term = {"name": new RegExp(escapeRegExp(word), 'i'), $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": false},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ]};
    }
    ContentModel.count(term, function (err, total) {
        callback(err, total);
    });
};
ContentDAO.prototype.getCountByText = function (word, currentUser, callback) {
    var term;
    if (currentUser == null) {
        term = {"$text": {$search: word}, "status": constants.CONTENT_ENABLE_STATUS, "draft": false};
    } else {
        term = {"$text": {$search: word}, $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": false},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ]};
    }
    ContentModel.count(term, function (err, total) {
        callback(err, total);
    });
};
ContentDAO.prototype.delete = function (id, currentUser, callback) {
    var term;
    if (currentUser.role == 0) {
        term = {"_id": id};
    } else {
        term = {"_id": id, "author": currentUser._id};
    }
    ContentModel.update(term, {$set: {"status": constants.COMMENT_UNABLE_STATUS }}, function (err) {
        callback(err);
    });
};
ContentDAO.prototype.share = function (id, status, callback) {
    var oldStatus = constants.CONTENT_ENABLE_STATUS;
    if (status == constants.COMMENT_UNABLE_STATUS) {
        callback(null);
    } else {
        if (status == constants.CONTENT_ENABLE_STATUS) {
            oldStatus = constants.CONTENT_SELF_STATUS;
        } else if (status == constants.CONTENT_SELF_STATUS) {
            oldStatus = constants.CONTENT_ENABLE_STATUS;
        }
        ContentModel.update({"_id": id, "status": oldStatus}, {$set: {"status": status, "modifyTime": new Date()}}, function (err) {
            callback(err);
        });
    }
};
ContentDAO.prototype.update = function (obj, callback) {
    var set = {
        "name": obj.name,
        "content": obj.content,
        "category": obj.category,
        "original": obj.original,
        "modifyTime": new Date()
    };
    if (obj.slug !== undefined) set.slug = obj.slug;
    if (obj.excerpt !== undefined) set.excerpt = obj.excerpt;
    if (obj.cover !== undefined) set.cover = obj.cover;
    if (obj.tags !== undefined) set.tags = obj.tags;
    if (obj.seo !== undefined) set.seo = obj.seo;
    if (obj.draft !== undefined) set.draft = obj.draft;
    if (obj.readingTime !== undefined) set.readingTime = obj.readingTime;
    if (obj.contentType !== undefined) set.contentType = obj.contentType;
    ContentModel.update({"_id": obj.id}, {$set: set}, function (err) {
        callback(err);
    });
};
ContentDAO.prototype.addView = function (obj, callback) {
    ContentModel.update({"_id": obj.id}, {$set: {"view": (obj.view + 1)}}, function (err) {
        callback(err);
    });
};

// 转义正则特殊字符，防止把搜索关键词当作正则（正则注入 / ReDoS）
function escapeRegExp(s) {
    return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

//把DAO接口开放出去给controller调用
module.exports = new ContentDAO();
