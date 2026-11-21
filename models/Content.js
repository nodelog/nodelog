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
    contentType: {type: String, default: 'html', enum: ['html', 'markdown']}, // 内容格式
    htmlBackup: {type: String},  // 富文本原文备份（首次转 Markdown 时留存，供回滚）
    // ---- 开放接口来源溯源（immutable：创建后不可改，后台编辑无法抹除来源）----
    source: {type: String, enum: ['api', 'manual'], default: 'manual', immutable: true},
    sourceAppId: {type: ObjectId, default: null, immutable: true, index: true},
    // ---- Blog + Wiki 一体化（向后兼容：历史文档这些字段缺省，读取用 $ne 判定）----
    // 文档类型：与 contentType（正文格式）正交。默认 blog，历史文档缺字段按 blog 处理。
    docType: {type: String, enum: ['blog', 'wiki'], default: constants.DOC_TYPE_BLOG, index: true},
    // 全文检索派生纯文本：Markdown/富文本去标记后的正文，供 text 索引算相关度。服务端生成，禁前端直写。
    searchBody: {type: String, default: ''},
    // 空间与父页面：字段先预留，空间/页面树 UI 增强阶段启用。sparse 避免历史文档占位。
    spaceId: {type: ObjectId, default: null, sparse: true},
    parent: {type: ObjectId, default: null, sparse: true},
    wikiOrder: {type: Number, default: 0}  // 同级排序，增强阶段使用
}, {
    collection: "content" //对应mongodb的集合表
});

// 性能：为常用的列表排序与查询条件建立索引
ContentSchema.index({ createTime: -1 });           // 列表按时间倒序分页
ContentSchema.index({ author: 1, status: 1 });     // 我的日志 / 按作者+状态查询
ContentSchema.index({ category: 1, status: 1 });   // 按分类+状态查询
ContentSchema.index({ name: 1 });                  // 标题搜索
ContentSchema.index({ sourceAppId: 1, createTime: -1 }); // 应用来源溯源列表
ContentSchema.index({ docType: 1, createTime: -1 });     // 按文档类型筛选列表（Blog/Wiki）
ContentSchema.index({ parent: 1, status: 1 }, { sparse: true }); // 取子页面建树（增强阶段，避免 N+1）
// WP3 全文检索索引：{name, searchBody, tags} + 权重。
// - 每集合仅一个 text 索引；searchBody 是去标记后的正文纯文本（服务端生成），比直接索引 content(Markdown/HTML) 更干净。
// - default_language:'none' 关闭英文词干化，避免干扰中文；中文召回由应用层「两路召回」补足（见 searchText）。
// - 线上若仍是旧 {name,content,tags} 索引，须先跑 scripts/rebuild-search-index.js（drop 旧 + create 新），否则 autoIndex 不覆盖。
ContentSchema.index(
    { name: 'text', searchBody: 'text', tags: 'text' },
    { weights: { name: 10, tags: 5, searchBody: 1 }, default_language: 'none', name: 'content_text' }
);

// 新内容默认发布状态；草稿不进公开列表。
// 注意：draft 是 P0 新增字段，历史文档没有该字段。MongoDB 中 {draft:false} 不会匹配「字段不存在」的文档，
// 会把 P0 之前发布的所有文章一并过滤掉（首页变「暂无内容」/空白）。统一用 {draft:{$ne:true}} 兼容新旧数据。
// 博客前台可见性基准：只返回博客文章，Wiki 文档走独立知识库路由，绝不混入博客列表。
function visibleTerm(currentUser) {
    if (currentUser == null) {
        return {
            docType: constants.DOC_TYPE_BLOG,
            "status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}
        };
    }
    return {
        docType: constants.DOC_TYPE_BLOG,
        $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ]
    };
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
            User.findByIds(authorIds, function (e, us) { cb(e, us || []); });
        },
        cats: function (cb) {
            if (!catIds.length) return cb(null, []);
            Category.findByIds(catIds, function (e, cs) { cb(e, cs || []); });
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
        // 追加返回新建文档（含 _id）供导入/审计定位；旧调用方只取第 1 个 err，不受影响。
        callback(err, err ? null : ContentEntity);
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
    query.select('name author category createTime modifyTime view status original slug cover excerpt tags docType');
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        if (err) return callback(err, docs);
        enrichDocs(docs, callback);
    });
};
ContentDAO.prototype.findByCategory = function (page, category, currentUser, callback) {
    var term = {"category": category, "docType": constants.DOC_TYPE_BLOG};
    if (currentUser == null) {
        term = {"category": category, "docType": constants.DOC_TYPE_BLOG, "status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}};
    } else {
        term = {"category": category, "docType": constants.DOC_TYPE_BLOG, $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ]};
    }
    var query = ContentModel.find(term);
    query.select('name author category modifyTime view original slug cover excerpt tags docType');
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        if (err) return callback(err, docs);
        enrichDocs(docs, callback);
    });
};
ContentDAO.prototype.findByWord = function (page, word, currentUser, callback) {
    var nameTerm = {"name": new RegExp(escapeRegExp(word), 'i')};
    if (currentUser == null) {
        term = {"name": nameTerm.name, "docType": constants.DOC_TYPE_BLOG, "status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}};
    } else {
        term = {"name": nameTerm.name, "docType": constants.DOC_TYPE_BLOG, $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ]};
    }
    var query = ContentModel.find(term);
    query.select('name author category modifyTime view original slug cover excerpt tags docType');
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        if (err) return callback(err, docs);
        enrichDocs(docs, callback);
    });
};
// WP3 检索底座：混合召回（$text 主召回 + 中文子串 $regex 兜底）+ 组合过滤 + 分页。
// opts: {docType, spaceId, tag, category}；docType 缺省 blog（文档不混入博客搜索）。
// 中文没有空格分词，$text(default_language:none) 对「链付收银」这类连写召回差，
// 故并行跑一路 searchBody/name 的子串正则兜底，合并去重、$text 命中优先。
ContentDAO.prototype.searchHybrid = function (page, word, currentUser, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    opts = opts || {};
    page = Math.max(1, parseInt(page, 10) || 1);
    var docType = opts.docType || constants.DOC_TYPE_BLOG;
    var regex = new RegExp(escapeRegExp(word), 'i');
    var pageSize = Math.max(1, parseInt(opts.limit, 10) || constants.PER_PAGE_COUNT);
    // 召回池至少覆盖本页所需；两路各取，本地 932 篇足够；避免无界查询
    var LIMIT = Math.max(200, pageSize * 2);

    // 可见性基准（复用逻辑但与 visibleTerm 分开，因为要叠加组合过滤）
    function baseTerm() {
        var t = {docType: docType};
        if (docType === constants.DOC_TYPE_WIKI && opts.spaceId) {
            t.spaceId = opts.spaceId; // ObjectId 由调用方校验，避免非法值
        }
        if (opts.category) t.category = opts.category;
        if (opts.tag) t.tags = tagRegex(opts.tag);
        if (currentUser == null) {
            t.status = constants.CONTENT_ENABLE_STATUS;
            t.draft = {$ne: true};
        } else {
            t.$or = [
                {status: constants.CONTENT_ENABLE_STATUS, draft: {$ne: true}},
                {author: currentUser._id, status: {$ne: constants.CONTENT_UNABLE_STATUS}}
            ];
        }
        return t;
    }
    // objectId 合法性：spaceId 非法时直接返回空，避免 cast 异常打断搜索
    if (opts.spaceId && !mongodb.mongoose.Types.ObjectId.isValid(String(opts.spaceId))) {
        return callback(null, {docs: [], total: 0});
    }

    function mergeTerm(extra) {
        var t = baseTerm();
        Object.keys(extra).forEach(function (k) { t[k] = extra[k]; });
        return t;
    }

    async.parallel({
        // 路A：$text 主召回（标题权重高，按 textScore 排序）
        text: function (cb) {
            ContentModel.find(mergeTerm({$text: {$search: word}}), {score: {$meta: "textScore"}})
                .select('name author category modifyTime view original slug cover excerpt tags docType searchBody spaceId')
                .sort({score: {$meta: "textScore"}}).limit(LIMIT)
                .exec(function (err, docs) { cb(err, docs || []); });
        },
        // 路B：中文子串兜底（标题 / 正文纯文本）
        regex: function (cb) {
            ContentModel.find(mergeTerm({$or: [{name: regex}, {searchBody: regex}]}))
                .select('name author category modifyTime view original slug cover excerpt tags docType searchBody spaceId')
                .sort({createTime: -1}).limit(LIMIT)
                .exec(function (err, docs) { cb(err, docs || []); });
        }
    }, function (err, results) {
        if (err) return callback(err, {docs: [], total: 0});
        // 合并去重：路A 优先（相关度序），路B 仅补未命中者
        var seen = {}, merged = [];
        (results.text || []).forEach(function (d) {
            var k = String(d._id);
            if (!seen[k]) { seen[k] = true; merged.push(d); }
        });
        (results.regex || []).forEach(function (d) {
            var k = String(d._id);
            if (!seen[k]) { seen[k] = true; merged.push(d); }
        });
        var total = merged.length;
        var start = (page - 1) * pageSize;
        var slice = merged.slice(start, start + pageSize);
        enrichDocs(slice, function (e2, docs) {
            if (e2) return callback(e2, {docs: [], total: total});
            callback(null, {docs: docs, total: total});
        });
    });
};

// P1 全文检索（基于 MongoDB $text 索引）——保留给旧调用；新代码走 searchHybrid
ContentDAO.prototype.searchText = function (page, word, currentUser, callback) {
    var term = {"$text": {$search: word}};
    if (currentUser == null) {
        term = {"$text": {$search: word}, "docType": constants.DOC_TYPE_BLOG, "status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}};
    } else {
        term = {"$text": {$search: word}, "docType": constants.DOC_TYPE_BLOG, $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ]};
    }
    var query = ContentModel.find(term, {score: {$meta: "textScore"}});
    query.select('name author category modifyTime view original slug cover excerpt tags docType');
    query.sort({"score": {$meta: "textScore"}});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        if (err) return callback(err, docs);
        enrichDocs(docs, callback);
    });
};
ContentDAO.prototype.findAllByWord = function (word, currentUser, callback) {
    var term = {"name": new RegExp(escapeRegExp(word), 'i'), "docType": constants.DOC_TYPE_BLOG, "status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}};
    if (currentUser != null) {
        term = {"name": new RegExp(escapeRegExp(word), 'i'), "docType": constants.DOC_TYPE_BLOG, $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}},
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
    var query = ContentModel.find({"author": author, "docType": constants.DOC_TYPE_BLOG, "status": {$ne: constants.CONTENT_UNABLE_STATUS}});
    query.select('name author category createTime modifyTime view status original slug cover excerpt tags docType');
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        callback(err, docs);
    });
};
// 标签名匹配：转义正则元字符 + 大小写不敏感，避免 "Webhook" 与 "webhook"、
// "node.js" 与 "nodeXjs" 因大小写/点号而无法命中（穿透「代码看起来对」的精确匹配陷阱）
function escapeRegex(s) {
    return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// 容忍首尾空白（防止看不见的空格/全角空格导致匹配失败），并大小写不敏感
function tagRegex(tag) {
    return {"$regex": "^\\s*" + escapeRegex(tag) + "\\s*$", "$options": "i"};
}
// docTypes: 可选，要查询的文档类型数组（如 ['blog','wiki']）；缺省 ['blog'] 保持旧调用不变
function tagTermWithTypes(tag, currentUser, docTypes) {
    var types = Array.isArray(docTypes) && docTypes.length ? docTypes : [constants.DOC_TYPE_BLOG];
    var term = {"tags": tagRegex(tag), "docType": {$in: types}};
    if (currentUser == null) {
        term.status = constants.CONTENT_ENABLE_STATUS;
        term.draft = {$ne: true};
    } else {
        term.$or = [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": {$ne: true}},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ];
    }
    return term;
}
ContentDAO.prototype.findByTag = function (page, tag, currentUser, callback, docTypes) {
    var query = ContentModel.find(tagTermWithTypes(tag, currentUser, docTypes));
    query.select('name author category createTime modifyTime view status original slug cover excerpt tags docType spaceId');
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        if (err) return callback(err, docs);
        enrichDocs(docs, callback);
    });
};
ContentDAO.prototype.getCountByTag = function (tag, currentUser, callback, docTypes) {
    ContentModel.count(tagTermWithTypes(tag, currentUser, docTypes), function (err, total) { callback(err, total); });
};
ContentDAO.prototype.getCount = function (currentUser, callback) {
    ContentModel.count(visibleTerm(currentUser), function (err, total) {
        callback(err, total);
    });
};
// 看板用：待发布/待审核内容 = 草稿 或 私有(status=2)，即尚未对全站公开的文章
ContentDAO.prototype.getPendingCount = function (callback) {
    ContentModel.count({$or: [{draft: true}, {status: constants.CONTENT_SELF_STATUS}]}, function (err, total) {
        callback(err, total || 0);
    });
};
// 看板用：按 UTC 自然日聚合最近 days 天每日新建文章数
ContentDAO.prototype.getTrend = function (days, callback) {
    var start = new Date(Date.now() - days * 86400000);
    ContentModel.aggregate([
        {$match: {createTime: {$gte: start}}},
        {$group: {_id: {$dateToString: {format: '%Y-%m-%d', date: '$createTime'}}, count: {$sum: 1}}},
        {$sort: {_id: 1}}
    ]).exec(function (err, rows) { callback(err, rows || []); });
};
ContentDAO.prototype.getCountByCategory = function (category, currentUser, callback) {
    var term;
    if (currentUser == null) {
        term = {"category": category, "docType": constants.DOC_TYPE_BLOG, "status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}};
    } else {
        term = {"category": category, "docType": constants.DOC_TYPE_BLOG, $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}},
            {"author": currentUser._id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}
        ]};
    }
    ContentModel.count(term, function (err, total) {
        callback(err, total);
    });
};
ContentDAO.prototype.getCountByCategoryOnly = function (category, callback) {
    ContentModel.count({"category": category, "docType": constants.DOC_TYPE_BLOG, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}, function (err, total) {
        callback(err, total);
    });
};
ContentDAO.prototype.getCountByUser = function (author, callback) {
    ContentModel.count({"author": author, "docType": constants.DOC_TYPE_BLOG, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}, function (err, total) {
        callback(err, total);
    });
};
// 开放接口来源溯源：按应用 id 统计/查询其发布的文章。
ContentDAO.prototype.countBySourceApp = function (appId, callback) {
    ContentModel.count({"sourceAppId": appId, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}, function (err, total) {
        callback(err, total);
    });
};
ContentDAO.prototype.findBySourceApp = function (appId, callback) {
    ContentModel.find({"sourceAppId": appId})
        .select('name createTime status draft')
        .sort({createTime: -1}).limit(200).exec(function (err, docs) {
            callback(err, docs || []);
        });
};
// 一次聚合统计多个应用的文章数，消除 list 里的 N+1 查询。返回 {appIdString: count}。
ContentDAO.prototype.countBySourceApps = function (appIds, callback) {
    if (!appIds || !appIds.length) return callback(null, {});
    var ObjectIdType = mongodb.mongoose.Types.ObjectId;
    var oids = [];
    appIds.forEach(function (id) {
        try { oids.push(new ObjectIdType(String(id))); } catch (e) { /* 跳过非法 id */ }
    });
    if (!oids.length) return callback(null, {});
    // maxTimeMS：单条慢聚合不得拖住整个 list 接口；超时走 err 分支降级为空统计。
    ContentModel.aggregate([
        {$match: {sourceAppId: {$in: oids}, status: {$ne: constants.CONTENT_UNABLE_STATUS}}},
        {$group: {_id: '$sourceAppId', n: {$sum: 1}}}
    ]).option({maxTimeMS: 2000}).exec(function (err, rows) {
        if (err) return callback(err);
        var map = {};
        (rows || []).forEach(function (r) { map[String(r._id)] = r.n; });
        callback(null, map);
    });
};
ContentDAO.prototype.getCountByWord = function (word, currentUser, callback) {
    var term;
    if (currentUser == null) {
        term = {"name": new RegExp(escapeRegExp(word), 'i'), "docType": constants.DOC_TYPE_BLOG, "status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}};
    } else {
        term = {"name": new RegExp(escapeRegExp(word), 'i'), "docType": constants.DOC_TYPE_BLOG, $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}},
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
        term = {"$text": {$search: word}, "docType": constants.DOC_TYPE_BLOG, "status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}};
    } else {
        term = {"$text": {$search: word}, "docType": constants.DOC_TYPE_BLOG, $or: [
            {"status": constants.CONTENT_ENABLE_STATUS, "draft": {"$ne": true}},
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
    ContentModel.update(term, {$set: {"status": constants.CONTENT_UNABLE_STATUS }}, function (err) {
        callback(err);
    });
};
// 越权点 3 修法（§2.3）：归属写进 Mongo 查询条件，不「查出来再判断」。
// scope = {_id, status:oldStatus} + (普通用户 ? {author: session._id} : {})；管理员豁免。
ContentDAO.prototype.share = function (id, status, currentUser, callback) {
    var oldStatus = constants.CONTENT_ENABLE_STATUS;
    // status=1 为非法值，零写入（控制器另做早拒绝）。用内容领域常量，勿用 COMMENT_UNABLE_STATUS。
    if (status == constants.CONTENT_UNABLE_STATUS) {
        callback(null); // 保持原 share 语义：status=1 为非法值，零写入（控制器另做早拒绝）
    } else {
        if (status == constants.CONTENT_ENABLE_STATUS) {
            oldStatus = constants.CONTENT_SELF_STATUS;
        } else if (status == constants.CONTENT_SELF_STATUS) {
            oldStatus = constants.CONTENT_ENABLE_STATUS;
        }
        var scope = {"_id": id, "status": oldStatus};
        if (!currentUser || currentUser.role !== 0) {
            scope.author = (currentUser && currentUser._id) ? currentUser._id : new ObjectId();
        }
        ContentModel.update(scope, {$set: {"status": status, "modifyTime": new Date()}}, function (err) {
            callback(err);
        });
    }
};
// 越权点 2 修法（§2.3）：改签名为 update(obj, currentUser, callback)，归属进 where。
// 保留 htmlBackup / contentType 迁移逻辑，enrichDocs 不动。
ContentDAO.prototype.update = function (obj, currentUser, callback) {
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
    // Blog+Wiki：文档类型、派生检索文本、空间与父页面。字段逐个判 undefined，
    // 历史调用方不传这些字段时保持原样，编辑旧文章不会把缺省值写回去。
    if (obj.docType !== undefined) set.docType = obj.docType;
    if (obj.searchBody !== undefined) set.searchBody = obj.searchBody;
    if (obj.spaceId !== undefined) set.spaceId = obj.spaceId;
    if (obj.parent !== undefined) set.parent = obj.parent;
    // D6 纵深防御(L3)：仅管理员可改归属；普通用户即便直接调用 DAO 传 author 也静默忽略，
    // 防止将来别的调用方绕过 controller 的 D6 早拒绝。管理员豁免严格 role === 0。
    if (obj.author !== undefined && currentUser && currentUser.role === 0) {
        set.author = obj.author;
    }
    // 首次把历史富文本文章保存为 Markdown 时，自动留档原始 HTML（可回滚）。
    // 以数据库当前值判定，不信任前端传参；已迁移过的文章不会覆盖既有备份。
    ContentModel.findById(obj.id, function (findErr, oldDoc) {
        if (!findErr && oldDoc && oldDoc.contentType !== 'markdown' && obj.contentType === 'markdown') {
            set.htmlBackup = oldDoc.content;
        }
        // L3 权威：管理员按 _id 改任意；普通用户必须命中 author=session._id。
        var where = {"_id": obj.id};
        if (!currentUser || currentUser.role !== 0) {
            where.author = (currentUser && currentUser._id) ? currentUser._id : new ObjectId();
        }
        ContentModel.update(where, {$set: set}, function (err) {
            callback(err);
        });
    });
};
ContentDAO.prototype.addView = function (obj, callback) {
    ContentModel.update({"_id": obj.id}, {$set: {"view": (obj.view + 1)}}, function (err) {
        callback(err);
    });
};

// ---- Wiki：按知识库查询页面（WP1 索引 {docType,spaceId,status,createTime} 的配套方法）----
// 一次取回该库全部可见 wiki 页面，供 services/wikiTree 在内存建树，避免逐层 N+1。
// 只取建树/列表所需字段，正文 content 由 findPageBySlug 单独取。
ContentDAO.prototype.findBySpace = function (spaceId, currentUser, callback) {
    var term = {
        docType: constants.DOC_TYPE_WIKI,
        spaceId: spaceId,
        status: constants.CONTENT_ENABLE_STATUS,
        draft: {$ne: true}
    };
    // 私有库里的页面可见性由 Space 层控制；这里只保证不返回禁用/草稿。
    var query = ContentModel.find(term);
    query.select('name slug parent wikiOrder createTime modifyTime tags excerpt');
    query.sort({wikiOrder: 1, createTime: 1});
    query.exec(callback);
};
// 按「知识库 + 页面 slug」取单篇（URL 用两段语义链接，slug 在库内唯一即可）
ContentDAO.prototype.findPageBySlug = function (spaceId, slug, currentUser, callback) {
    var term = {
        docType: constants.DOC_TYPE_WIKI,
        spaceId: spaceId,
        slug: slug,
        status: constants.CONTENT_ENABLE_STATUS,
        draft: {$ne: true}
    };
    // 可见性：公开内容，或登录用户自己的草稿/私有不受此处限制（Wiki MVP 先只公开）
    if (currentUser != null) {
        term = {$and: [
            {docType: constants.DOC_TYPE_WIKI, spaceId: spaceId, slug: slug},
            {$or: [
                {status: constants.CONTENT_ENABLE_STATUS, draft: {$ne: true}},
                {author: currentUser._id, status: {$ne: constants.CONTENT_UNABLE_STATUS}}
            ]}
        ]};
    }
    ContentModel.findOne(term, callback);
};
// 工作台一次取全部库的页面（按 spaceId 分组由 controller 处理），避免逐库 N+1。
ContentDAO.prototype.findPagesBySpaces = function (spaceIds, callback) {
    ContentModel.find({
        docType: constants.DOC_TYPE_WIKI,
        spaceId: {$in: spaceIds},
        status: {$ne: constants.CONTENT_UNABLE_STATUS}
    }).select('name slug content contentType tags excerpt parent wikiOrder spaceId')
      .sort({wikiOrder: 1, createTime: 1}).exec(callback);
};
// 工作台编辑用：取某库全部页面的正文（供点击页面后灌入 Vditor）
ContentDAO.prototype.findPagesForEdit = function (spaceId, callback) {
    ContentModel.find({
        docType: constants.DOC_TYPE_WIKI,
        spaceId: spaceId,
        status: {$ne: constants.CONTENT_UNABLE_STATUS}
    }).select('name slug content contentType tags excerpt parent wikiOrder')
      .sort({wikiOrder: 1, createTime: 1}).exec(callback);
};
// 统计某库的页面数（右栏「本库信息」用）
ContentDAO.prototype.countBySpace = function (spaceId, callback) {
    ContentModel.count({
        docType: constants.DOC_TYPE_WIKI,
        spaceId: spaceId,
        status: constants.CONTENT_ENABLE_STATUS,
        draft: {$ne: true}
    }, callback);
};

// 转义正则特殊字符，防止把搜索关键词当作正则（正则注入 / ReDoS）
function escapeRegExp(s) {
    return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 通用后台 DAO 方法（adminList/adminFindById/adminUpdate/adminSoftDelete），软删 status=1。
require('./_adminDao').attach(ContentDAO, ContentModel, {softStatus: constants.CONTENT_UNABLE_STATUS});

//把DAO接口开放出去给controller调用
module.exports = new ContentDAO();
// enrichDocs 为模块内私有函数，但 controllers/content.js 的 findByUser 会跨模块调用，
// 必须挂到导出实例上，否则 Content.enrichDocs === undefined → TypeError。
// 注：此前同名修复因历史重写丢失，此处重新补回。
module.exports.enrichDocs = enrichDocs;
