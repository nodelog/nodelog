var async = require('async');
var Tag = require('./../models/Tag');
var Content = require('./../models/Content');
var cmsUtils = require('./cmsUtils');

// 标签页：/tag/:slug （slug 或名称均可）
exports.findBySlug = function (req, res) {
    var slug = req.params.slug;
    var page = parseInt(req.query.page, 10) || 1;
    var sessionUser = req.session.user;
    Tag.findBySlug(slug, function (err, tag) {
        if (err || !tag) {
            // 回退：按名称查找（兼容未 slugify 的链接）
            Tag.findByName(decodeURIComponent(slug), function (e2, byName) {
                if (e2 || !byName) { res.redirect('/error'); return; }
                renderTag(byName);
            });
            return;
        }
        renderTag(tag);
    });
    function renderTag(tag) {
        async.auto({
            totalCount: function (cb) {
                Content.getCountByTag(tag.name, sessionUser, function (e, t) { cb(null, t || 0); });
            },
            pageDocs: ['totalCount', function (cb, results) {
                var pageObj = cmsUtils.page(page, results.totalCount);
                if (pageObj.totalPage > 0) {
                    Content.findByTag(pageObj.page, tag.name, sessionUser, function (e, docs) {
                        cb(null, {docs: docs || [], page: pageObj.page, totalPage: pageObj.totalPage, total: results.totalCount});
                    });
                } else {
                    cb(null, {docs: [], page: 1, totalPage: 0, total: 0});
                }
            }]
        }, function (e, r) {
            res.render('tag', {
                tag: tag, docs: r.docs, title: '标签：' + tag.name,
                page: r.page, totalPage: r.totalPage, total: r.total,
                url: '/tag/' + encodeURIComponent(slug) + '?'
            });
        });
    }
};

// 标签云（JSON，供前端/首页调用）
exports.list = function (req, res) {
    Tag.findAll(function (err, docs) {
        if (err) return res.json({docs: []});
        res.json({docs: docs});
    });
};
