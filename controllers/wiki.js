// Wiki 前台控制器：知识库列表、库首页、文档详情、目录树数据。
// 前台路由公开（无鉴权中间件）；可见性在数据层按 Space.visibility + visibleTerm 过滤。
var Space = require('./../models/Space.js');
var Content = require('./../models/Content.js');
var wikiTree = require('./../services/wikiTree.js');

// GET /wiki —— 全部可见知识库
exports.list = function (req, res) {
    Space.findVisible(req.session.user, function (err, spaces) {
        if (err) {
            console.error('[wiki.list] ' + err.message);
            spaces = [];
        }
        res.render('wiki/list', {
            title: '知识库', currentMenu: 'wiki', spaces: spaces || []
        });
    });
};

// 载入 space + 该库全部页面（一次查询建树），供 space/page 两页共用
function loadSpaceWithTree(req, res, next) {
    Space.findBySlug(req.params.spaceSlug, function (err, space) {
        if (err || !space) { res.redirect('/error'); return; }
        if (!Space.isVisible(space, req.session.user)) { res.redirect('/error'); return; }
        Content.findBySpace(space._id, req.session.user, function (e, docs) {
            if (e) { console.error('[wiki.load] ' + e.message); }
            var pages = docs || [];
            next(space, pages, wikiTree.buildTree(pages));
        });
    });
}

// GET /wiki/:spaceSlug —— 知识库首页（简介 + 根页面 + 页面总数）
exports.space = function (req, res) {
    loadSpaceWithTree(req, res, function (space, pages, tree) {
        res.render('wiki/space', {
            title: space.name, currentMenu: 'wiki',
            space: space, tree: tree, rootPages: tree, pageCount: pages.length,
            ogTitle: space.name + ' - 知识库',
            ogDesc: String(space.description || '').trim().slice(0, 120) || (space.name + ' 的知识库文档'),
            ogImage: (/^https?:\/\//i.test(String(space.cover || '')) && !/['"\\<>\s]/.test(space.cover)) ? space.cover : ''
        });
    });
};

// GET /wiki/:spaceSlug/:pageSlug —— 单篇文档（三栏 + 面包屑 + 相关资源）
exports.page = function (req, res) {
    loadSpaceWithTree(req, res, function (space, pages, tree) {
        Content.findPageBySlug(space._id, req.params.pageSlug, req.session.user, function (err, doc) {
            if (err || !doc) { res.redirect('/error'); return; }
            // 正文渲染：Wiki 页面一律 markdown（导入/新建均固定 markdown），html 兜底兼容
            var markdown = require('./markdown.js');
            var rendered, toc = [];
            if (doc.contentType === 'markdown') {
                var rr = markdown.renderWithToc(doc.content);
                rendered = rr.html; toc = rr.toc || [];
            } else {
                rendered = String(doc.content || '');
            }
            var crumbs = wikiTree.breadcrumb(pages, doc._id);
            // 相关资源：同库内共享任一标签的其他页面（最多 8 条），标签为空时退化为最近更新
            var docTags = doc.tags || [];
            var related = [];
            if (docTags.length) {
                related = pages.filter(function (p) {
                    return String(p._id) !== String(doc._id) &&
                        (p.tags || []).some(function (t) { return docTags.indexOf(t) !== -1; });
                }).slice(0, 8);
            }
            if (!related.length) {
                related = pages.filter(function (p) { return String(p._id) !== String(doc._id); })
                    .sort(function (a, b) { return new Date(b.modifyTime || 0) - new Date(a.modifyTime || 0); })
                    .slice(0, 8);
            }
            // 标签云：整库标签计数（复用 Content.tags 字符串数组口径）
            var tagCount = {};
            pages.forEach(function (p) {
                (p.tags || []).forEach(function (t) { tagCount[t] = (tagCount[t] || 0) + 1; });
            });
            var tags = Object.keys(tagCount).map(function (t) { return {name: t, count: tagCount[t]}; })
                .sort(function (a, b) { return b.count - a.count; }).slice(0, 20);

            // 摘要与封面：取正文派生摘要，封面走标准 http(s) URL 校验（与博客文章页一致）
            var ogDesc = String(doc.excerpt || '').replace(/<[^>]*>/g, '').trim().slice(0, 120) ||
                (String(doc.name || '').slice(0, 60) + ' - ' + space.name);
            var ogImage = (/^https?:\/\//i.test(String(doc.cover || '')) && !/['"\\<>\s]/.test(doc.cover)) ? doc.cover : '';
            res.render('wiki/page', {
                title: doc.name + ' - ' + space.name, currentMenu: 'wiki',
                space: space, doc: doc, rendered: rendered, toc: toc,
                tree: tree, breadcrumb: crumbs, currentId: doc._id,
                related: related, tags: tags, pageCount: pages.length,
                ogTitle: doc.name + ' - ' + space.name, ogDesc: ogDesc, ogImage: ogImage
            });
        });
    });
};

// GET /wiki/:spaceSlug/tree.json —— 目录树 JSON（供前端折叠/刷新用，可选）
exports.treeJson = function (req, res) {
    loadSpaceWithTree(req, res, function (space, pages, tree) {
        res.json({success: true, space: {name: space.name, slug: space.slug}, tree: tree, total: pages.length});
    });
};
