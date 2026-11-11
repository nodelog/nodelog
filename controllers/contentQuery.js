// Content 前台查询/展示接口。从 content.js 位移以满足单文件 ≤300 行门禁，
// 逻辑逐字保留（行为零改动），由 content.js 末尾 Object.assign 合并导出，老 URL 全部不变。
var async = require("async");
var Content = require('./../models/Content.js');
var User = require('./../models/User.js');
var Category = require('./../models/Category.js');
var cmsUtils = require('./cmsUtils.js');
var markdown = require('./markdown.js');
var html2md = require('./html2md.js');

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
            if (String(view).indexOf('editContent') !== -1 &&
                doc.contentType !== 'markdown' && html2md.isHtml(doc.content)) {
                doc.htmlBackup = doc.content;
                doc.content = html2md.convert(doc.content);
                doc.contentType = 'markdown';
                doc.legacyHtmlPending = true;
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
