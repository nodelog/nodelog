// WP3 检索底座：后台查看/重建 text 索引（管理员专用）
// 重建会短暂影响 $text 查询，端点仅 POST + authorizeAdmin；前端二次确认由调用方负责。
var mongoose = require('mongoose');

var TARGET_KEYS = 'name,searchBody,tags';
var NEW_INDEX = {name: 'text', searchBody: 'text', tags: 'text'};
var NEW_OPTIONS = {weights: {name: 10, tags: 5, searchBody: 1}, default_language: 'none', name: 'content_text'};

function textIndex(indexes) {
    return (indexes || []).find(function (idx) {
        var k = idx.key || {};
        return k._fts === 'text' || Object.keys(k).some(function (f) { return k[f] === 'text'; });
    });
}
function isTarget(idx) {
    if (!idx) return false;
    // MongoDB text 索引 key 是 {_fts:'text',_ftsx:1}，字段集合要看 weights（不是 key）
    var w = idx.weights || {};
    return Object.keys(w).sort().join(',') === TARGET_KEYS;
}
function brief(idx) {
    return idx ? {name: idx.name, key: idx.key, weights: idx.weights, default_language: idx.default_language} : null;
}

exports.status = function (req, res) {
    mongoose.connection.db.collection('content').indexes().then(function (indexes) {
        var idx = textIndex(indexes);
        res.json({
            success: true, current: brief(idx), isTarget: isTarget(idx),
            target: {key: NEW_INDEX, options: NEW_OPTIONS}
        });
    }).catch(function (err) {
        res.status(500).json({success: false, msg: err.message});
    });
};

exports.rebuild = function (req, res) {
    var col = mongoose.connection.db.collection('content');
    col.indexes().then(function (indexes) {
        var idx = textIndex(indexes);
        if (isTarget(idx)) return res.json({success: true, msg: '索引已是最新，无需重建', current: brief(idx)});
        var chain = (idx && idx.name) ? col.dropIndex(idx.name) : Promise.resolve();
        return chain.then(function () { return col.createIndex(NEW_INDEX, NEW_OPTIONS); });
    }).then(function () {
        return col.indexes();
    }).then(function (after) {
        var now = textIndex(after);
        if (!isTarget(now)) return res.status(500).json({success: false, msg: '重建后校验失败'});
        res.json({success: true, msg: '索引重建完成', current: brief(now)});
    }).catch(function (err) {
        res.status(500).json({success: false, msg: err.message});
    });
};
