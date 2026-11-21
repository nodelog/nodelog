// P2 运营统计：聚合各集合计数，供后台看板使用（轻量、无额外依赖）
var Content = require('./../models/Content');
var User = require('./../models/User');
var Comment = require('./../models/Comment');
var Category = require('./../models/Category');
var Log = require('./../models/Log');
var Tag = require('./../models/Tag');
var constants = require('./../models/constants');

exports.overview = function (req, res) {
    var result = {};
    var done = 0, total = 6;
    function tick() { if (++done === total) res.json({success: true, data: result}); }
    Content.getCount(null, function (e, c) { result.content = c || 0; tick(); });
    User.getCount(function (e, c) { result.user = c || 0; tick(); });
    Comment.getCount(function (e, c) { result.comment = c || 0; tick(); });
    Category.getCount(function (e, c) { result.category = c || 0; tick(); });
    Log.getCount(function (e, c) { result.log = c || 0; tick(); });
    Tag.findAll(function (e, docs) { result.tag = (docs || []).length; tick(); });
};
