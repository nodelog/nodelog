var async = require("async");//异步回调组件
var utils = require("util");//工具组件
var Content = require('./../models/Content.js');//Content DAO接口和Model等
var User = require('./../models/User.js');
var Category = require('./../models/Category.js');
var cmsUtils = require('./cmsUtils.js');//自定义util工具
var markdown = require('./markdown.js');
var Tag = require('./../models/Tag.js');

function buildFields(req) {
    var name = (req.body.name || '').trim();
    var content = (req.body.content || '').trim();
    var category = req.body.category;
    var original = req.body.original;
    var slug = (req.body.slug || '').trim();
    var excerpt = (req.body.excerpt || '').trim();
    var cover = req.body.cover || '';
    var draft = req.body.draft === true || req.body.draft === 'true';
    var contentType = req.body.contentType === 'markdown' ? 'markdown' : 'html';
    var tags = Array.isArray(req.body.tags)
        ? req.body.tags
        : String(req.body.tags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    var seo = {
        title: req.body['seo[title]'] || req.body.seoTitle || '',
        keywords: req.body['seo[keywords]'] || '',
        description: req.body['seo[description]'] || ''
    };
    var readingTime = contentType === 'markdown' ? Math.max(1, Math.ceil(content.length / 350)) : 0;
    return {
        name: name, content: content, category: category, original: original,
        slug: slug, excerpt: excerpt, cover: cover, tags: tags, seo: seo,
        draft: draft, contentType: contentType, readingTime: readingTime
    };
}

exports.findByPage = function (req, res) {
    var total = 0, page = 0, totalPage = 0, docs = {};
    var sessionUser = req.session.user;
    async.auto({
        totalCount: function (callback) {
            Content.getCount(sessionUser, function (err, count) { total = count; callback(null); });
        },
        pageDocs: ["totalCount", function (callback) {
            var pageObj = cmsUtils.page(req.query.page, total);
            page = pageObj.page; totalPage = pageObj.totalPage;
            if (totalPage > 0) {
                Content.findByPage(page, sessionUser, function (err, objects) { docs = objects; callback(null); });
            } else { callback(null); }
        }]
    }, function (err) {
        var login = req.query.login === "true";
        var view = "index";
        var url = "/index?";
        var title = req.session.site.name;
        var currentMenu = "home";
        if (req.query.manager === "true") {
            view = "manager/content"; url = "/manager/content?manager=true&"; title = "文章管理"; currentMenu = "content";
        }
        res.render(view, {docs: docs, title: title, login: login, page: page, totalPage: totalPage, total: total, url: url, currentMenu: currentMenu});
    });
};

exports.delete = function (req, res) {
    var id = req.body.id;
    var sessionUser = req.session.user;
    Content.delete(id, sessionUser, function (err) {
        if (!err) res.json({'success': true, 'msg': "删除成功"});
        else res.json({'success': false, 'msg': "删除失败"});
    });
};
exports.share = function (req, res) {
    var id = req.body.id;
    var status = req.body.status;
    Content.share(id, status, function (err) {
        if (!err) res.json({'success': true, 'msg': "成功"});
        else res.json({'success': false, 'msg': "失败"});
    });
};
exports.findById = function (req, res) {
    var id = req.query.id;
    var view = req.query.view;
    if (!view) {
        if (req.path === '/content/edit') view = 'editContent';
        else if (req.path.indexOf('/manager') === 0) view = 'manager/contentDetail';
        else view = 'contentDetail';
    }
    var doc = null;
    async.auto({
        getContent: function (callback) {
            Content.findById(id, function (err, obj) { if (!err) doc = obj; else console.log("data err"); callback(null); });
        },
        render: ["getContent", function (callback) {
            if (!doc) return callback(null);
            if (doc.contentType === 'markdown') {
                doc.renderedContent = markdown.render(doc.content);
                if (!doc.excerpt) doc.excerpt = markdown.excerpt(doc.content, 120);
            } else {
                doc.renderedContent = doc.content;
                if (!doc.excerpt) doc.excerpt = markdown.excerpt(doc.content ? doc.content.replace(/<[^>]*>/g, '') : '', 120);
            }
            callback(null);
        }]
    }, function (err) {
        if (doc == null) { res.redirect("/error"); return; }
        if (view == "editContent") {
            if (req.session.user._id != doc.author) { res.redirect("/"); return; }
        }
        if (view == "contentDetail") {
            Content.addView(doc, function (err) {
                if (err) console.log("add view failure"); else doc.view = (doc.view + 1);
                res.render(view, {"doc": doc, "title": doc != null ? doc.name : "文章没有找到"});
            });
        } else {
            res.render(view, {"doc": doc, "title": doc != null ? doc.name : "文章没有找到"});
        }
    });
};
exports.findByCategory = function (req, res) {
    var category = {}, categoryId, total = 0, page = 0, totalPage = 0, docs = {};
    var sessionUser = req.session.user;
    async.auto({
        getCategoryById: function (callback) {
            categoryId = req.query.categoryId;
            Category.findById(categoryId, function (err, obj) {
                if (err || obj == null) { res.redirect('error'); return; }
                category = obj; callback(null);
            });
        },
        totalCount: ["getCategoryById", function (callback) {
            Content.getCountByCategory(category._id, sessionUser, function (err, count) { total = count; callback(null); });
        }],
        getContentByPage: ["totalCount", function (callback) {
            var pageObj = cmsUtils.page(req.query.page, total);
            page = pageObj.page; totalPage = pageObj.totalPage;
            if (totalPage > 0) {
                Content.findByCategory(page, category._id, sessionUser, function (err, objects) { docs = objects; callback(null); });
            } else { callback(null); }
        }]
    }, function (err) {
        if (docs.length == 0) { res.redirect('error'); return; }
        res.render("categoryContent", {
            docs: docs, category: category, title: category.name + " 相关文章",
            page: page, totalPage: totalPage, total: total, url: "/content/category?categoryId=" + categoryId + "&",
            currentMenu: "category"
        });
    });
};
exports.findByUser = function (req, res) {
    var user = null, total = 0, page = 0, totalPage = 0, docs = {};
    async.auto({
        getUserById: function (callback) {
            var userId = req.query.userId;
            var session = req.session;
            // session 对象存在不代表 session.user 存在（session 过期/重建/异常登录态）。
            // 原来直接取 session.user._id 会在异步回调里抛 TypeError，前端表现为 502。
            if (userId == null && session != null && session.user != null) userId = session.user._id;
            if (userId != null) {
                User.findById(userId, function (err, obj) {
                    if (!err && obj) user = obj;
                    callback(null);
                });
            } else { callback(null); }
        },
        totalCount: ["getUserById", function (callback) {
            if (user != null) Content.getCountByUser(user._id, function (err, count) { total = count; callback(null); });
            else callback(null);
        }],
        getContentByPage: ["totalCount", function (callback) {
            var pageObj = cmsUtils.page(req.query.page, total);
            page = pageObj.page; totalPage = pageObj.totalPage;
            if (totalPage > 0) {
                Content.findByUser(page, user._id, function (err, objects) { docs = objects; callback(null); });
            } else { callback(null); }
        }],
        // 复用与列表一致的批量补全（作者/分类/标签），消除 N+1 并补齐 categoryName
        enrich: ["getContentByPage", function (callback) {
            Content.enrichDocs(docs, callback);
        }]
    }, function (err) {
        var view = "myContent", title = "我的文章", currentMenu = "mycontent";
        if (req.query.manager === "true") { view = "manager/content"; title = "文章管理"; currentMenu = "content"; }
        res.render(view, {docs: docs, title: title, page: page, totalPage: totalPage, total: total, url: "/content/user?", currentMenu: currentMenu});
    });
};
exports.findByWord = function (req, res) {
    var word = null, total = 0, page = 0, totalPage = 0, docs = {};
    var sessionUser = req.session.user;
    async.auto({
        totalCount: function (callback) {
            word = req.query.word;
            if (word != null) Content.getCountByWord(word, sessionUser, function (err, count) { total = count; callback(null); });
            else callback(null);
        },
        getContentByPage: ["totalCount", function (callback) {
            var pageObj = cmsUtils.page(req.query.page, total);
            page = pageObj.page; totalPage = pageObj.totalPage;
            if (totalPage > 0) {
                Content.findByWord(page, word, sessionUser, function (err, objects) { docs = objects; callback(null); });
            } else { callback(null); }
        }]
    }, function (err) {
        if (req.query.type != "json") {
            res.render("search", {docs: docs, title: "标题包含 \"" + word + "\" 的文章搜索结果", key: word, page: page, totalPage: totalPage, total: total});
        } else {
            res.json({docs: docs});
        }
    });
};
// P1 全文检索结果页（基于 MongoDB $text 索引）
exports.searchFull = function (req, res) {
    var word = (req.query.word || '').trim();
    var page = parseInt(req.query.page, 10) || 1;
    var sessionUser = req.session.user;
    if (!word) { res.redirect('/'); return; }
    async.auto({
        totalCount: function (cb) {
            Content.getCountByText(word, sessionUser, function (err, total) { cb(null, total || 0); });
        },
        pageDocs: ["totalCount", function (cb, results) {
            var total = results.totalCount;
            var pageObj = cmsUtils.page(page, total);
            if (pageObj.totalPage > 0) {
                Content.searchText(pageObj.page, word, sessionUser, function (err, docs) {
                    cb(null, {docs: docs || [], page: pageObj.page, totalPage: pageObj.totalPage, total: total});
                });
            } else {
                cb(null, {docs: [], page: 1, totalPage: 0, total: 0});
            }
        }]
    }, function (err, results) {
        var r = results.pageDocs;
        res.render("search", {
            docs: r.docs, title: "全文搜索：" + word, key: word,
            page: r.page, totalPage: r.totalPage, total: r.total,
            url: "/content/search?word=" + encodeURIComponent(word) + "&"
        });
    });
};
exports.findByWordJson = function (req, res) {
    var sessionUser = req.session.user;
    Content.findAllByWord(req.body.word, sessionUser, function (err, docs) {
        res.json({docs: docs});
    });
};

var findByName = function (name, callback) {
    Content.findByName(name, function (err, obj) { callback(err, obj); });
};
//add
exports.add = function (req, res) {
    var id = req.body.id;
    var oldName = req.body.oldName;
    var f = buildFields(req);
    var msg = "", success = false, flag = false;
    if (f.name === "") msg = "标题不能为空";
    else if (f.content === "") msg = "内容不能为空";
    else {
        flag = true;
        findByName(f.name, function (err, obj) {
            if (id == null) {//add
                if (obj !== null) { msg = "文章已经存在"; res.json({'success': success, 'msg': msg}); }
                else {
                    var session = req.session;
                    f.author = session.user._id;
                    Tag.syncTags(f.tags, function () {});
                    Content.save(f, function (err) {
                        if (!err) { success = true; msg = "发表文章成功"; } else { console.log(err.message); msg = "发表文章失败"; }
                        res.json({'success': success, 'msg': msg});
                    });
                }
            } else {//update
                if (obj !== null && obj.name != oldName) { msg = "文章已经存在"; res.json({'success': success, 'msg': msg}); }
                else {
                    f.id = id;
                    Tag.syncTags(f.tags, function () {});
                    Content.update(f, function (err) {
                        if (!err) { success = true; msg = "编辑文章成功"; console.log("success"); } else { console.log(err.message); msg = "编辑文章失败"; }
                        res.json({'success': success, 'msg': msg, 'id': f.id});
                    });
                }
            }
        });
    }
    if (!flag) { res.json({'success': success, 'msg': msg}); }
};
//update（按名称重命名，历史接口保留）
exports.update = function (req, res) {
    var id = req.body.id;
    var name = (req.body.name || '').trim();
    var msg = "", success = false, flag = false;
    if (name == "") { msg = "Content Name is empty"; }
    else {
        flag = true;
        findByName(name, function (err, obj) {
            if (obj != null) { msg = "Content Name is exists"; res.json({'success': success, 'msg': msg}); }
            else {
                Content.update(id, name, function (err) {
                    if (!err) { success = true; msg = "Modify Content is success"; }
                    else { console.log(err.message); msg = "Modify Content is failure"; }
                    res.json({'success': success, 'msg': msg});
                });
            }
        });
    }
    if (!flag) { res.json({'success': success, 'msg': msg}); }
};
