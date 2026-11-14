// 概览/面板：聚合后台核心计数，渲染管理后台首页看板。
// 原先 /manager 误把「博客配置」表单放在概览页，本控制器将其替换为运营概况看板。
var Content = require('./../models/Content');
var User = require('./../models/User');
var Comment = require('./../models/Comment');
var Category = require('./../models/Category');
var Log = require('./../models/Log');
var Tag = require('./../models/Tag');
var SensitiveWord = require('./../models/SensitiveWord');
var ViolationLog = require('./../models/ViolationLog');

exports.overview = function (req, res) {
    var data = { content: 0, user: 0, comment: 0, category: 0, tag: 0, log: 0, sensitiveWord: 0, violation: 0 };
    var done = 0, total = 8;
    function tick() {
        if (++done === total) {
            res.render('manager/index', {
                title: (req.session.site && req.session.site.name) || '管理后台',
                currentMenu: 'home',
                stats: data
            });
        }
    }
    Content.getCount(null, function (e, c) { if (!e && c) data.content = c; tick(); });
    User.getCount(function (e, c) { if (!e && c) data.user = c; tick(); });
    Comment.getCount(function (e, c) { if (!e && c) data.comment = c; tick(); });
    Category.getCount(function (e, c) { if (!e && c) data.category = c; tick(); });
    Log.getCount(function (e, c) { if (!e && c) data.log = c; tick(); });
    Tag.findAll(function (e, docs) { if (!e && docs) data.tag = docs.length; tick(); });
    if (typeof SensitiveWord.findAllEnabled === 'function') {
        SensitiveWord.findAllEnabled(function (e, docs) { if (!e && docs) data.sensitiveWord = docs.length; tick(); });
    } else { tick(); }
    if (typeof ViolationLog.getCount === 'function') {
        ViolationLog.getCount({}, function (e, c) { if (!e && c) data.violation = c; tick(); });
    } else { tick(); }
};
