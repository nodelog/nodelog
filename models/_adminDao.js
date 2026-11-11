// 后台通用 DAO 方法 mixin（SPEC §4 通用模式）。
// 只执行 controller 已组装好的 query，不猜来源、不校验归属（归属由 controller 的 scopeTerm
// 与 query 条件负责，L3 权威条件进 where）。七个资源共用这一份实现，避免 7× 复制产生口径漂移。
// 用法：require('./_adminDao').attach(XxxDAO, XxxModel, {softStatus: 1});

function toCount(result) {
    if (!result) return 0;
    if (result.modifiedCount != null) return result.modifiedCount;
    if (result.nModified != null) return result.nModified;
    if (result.n != null) return result.n;
    return 0;
}

function castError(id) {
    var e = new Error('Cast to ObjectId failed for value "' + id + '"');
    e.name = 'CastError';
    return e;
}

function attach(DAO, Model, options) {
    options = options || {};
    var softStatus = (options.softStatus == null) ? 1 : options.softStatus;

    // cb(err, {docs, total, page, totalPage})
    DAO.prototype.adminList = function (query, opts, callback) {
        var q = query || {};
        var o = opts || {};
        var pageSize = parseInt(o.pageSize, 10) || 9;
        var page = parseInt(o.page, 10) || 1;
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 9;
        var sort = o.sort || {createTime: -1};
        Model.countDocuments(q, function (err, total) {
            if (err) return callback(err);
            Model.find(q).sort(sort).limit(pageSize).skip((page - 1) * pageSize)
                .exec(function (err2, docs) {
                    if (err2) return callback(err2);
                    callback(null, {docs: docs, total: total, page: page,
                        totalPage: Math.ceil(total / pageSize)});
                });
        });
    };

    // cb(err, doc|null) —— id 非法直接给 CastError，避免同步抛异常穿透成 500。
    DAO.prototype.adminFindById = function (id, query, callback) {
        if (typeof id === 'string' && !/^[0-9a-fA-F]{24}$/.test(id.trim())) return callback(castError(id));
        var q = Object.assign({_id: id}, query || {});
        Model.findOne(q, function (err, doc) { callback(err, doc || null); });
    };

    // cb(err, modifiedCount)
    DAO.prototype.adminUpdate = function (id, query, fields, callback) {
        if (typeof id === 'string' && !/^[0-9a-fA-F]{24}$/.test(id.trim())) return callback(castError(id));
        var q = Object.assign({_id: id}, query || {});
        var set = Object.assign({modifyTime: new Date()}, fields || {});
        delete set._id;
        Model.update(q, {$set: set}, function (err, result) {
            callback(err, err ? 0 : toCount(result));
        });
    };

    // cb(err, modifiedCount) —— 软删 status 固定写 softStatus。
    DAO.prototype.adminSoftDelete = function (id, query, callback) {
        return DAO.prototype.adminUpdate.call(this, id, query, {status: softStatus}, callback);
    };

    return DAO;
}

module.exports = {attach: attach, toCount: toCount};
