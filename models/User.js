var bcrypt = require('bcryptjs');
var mongodb = require('./mongodb');
var constants = require('./constants');

var Schema = mongodb.mongoose.Schema;
var UserSchema = new Schema({
    userName: {type: 'String', required: true},
    realName: {type: 'String', required: true},
    password: {type: 'String', required: true},
    email: {type: 'String', required: false},
    // ===== 开放平台（微信扫码登录）扩展字段 =====
    // 三者都不设 required，旧文档缺失该字段时不会触发校验失败。
    // openUserId 只建普通索引、不加 unique：历史文档该字段普遍缺失，唯一索引会冲突；
    // 重复创建的兜底由 findByOpenUserId 先查后建 + 后续收敛保证。
    openUserId: {type: 'String', index: true},
    phone: {type: 'String'},
    loginType: {type: 'String', default: 'local'},
    createTime: { type: Date, default: Date.now},
    modifyTime: {type: Date, default: Date.now},
    role: {type: 'Number', default: 1, required: true, min: 0, max: 1 },//0 super admin,1 normal user
    status: {type: 'Number', default: 0, required: true, min: 0, max: 2}//0 enable,1 disable
}, {
    collection: "user"
});

var UserModel = mongodb.mongoose.model("User", UserSchema);
//
var UserDAO = function () {
};
UserDAO.prototype.save = function (obj, callback) {
    var userEntity = new UserModel(obj);
    userEntity.save(function (err) {
        callback(err);
    });
};
UserDAO.prototype.findByName = function (name, callback) {
    UserModel.findOne(
        {"userName": name, "status": {$lt: constants.USER_DELETE_STATUS}},
        function (err, obj) {
            callback(err, obj);
        });
};
UserDAO.prototype.findById = function (id, callback) {
    UserModel.findOne(
        {_id: id, "status": {$lt: constants.USER_DELETE_STATUS}},
        function (err, obj) {
            callback(err, obj);
        });
};
UserDAO.prototype.findByPage = function (page, callback) {
    var query = UserModel.find({"status": {$lt: constants.USER_DELETE_STATUS}});
    query.sort({"modifyTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        callback(err, docs);
    });
};
UserDAO.prototype.findAll = function (callback) {
    UserModel.find(
        {"status": {$lt: constants.USER_DELETE_STATUS}},
        function (err, docs) {
            callback(err, docs);
        });
};
// 按 id 批量拉取（供 Content.enrichDocs 消 N+1，避免逐条查询）
UserDAO.prototype.findByIds = function (ids, callback) {
    if (!ids || !ids.length) return callback(null, []);
    UserModel.find({"_id": {$in: ids}}, function (err, docs) {
        callback(err, docs || []);
    });
};
UserDAO.prototype.getCount = function (callback) {
    UserModel.count(
        {"status": {$lt: constants.USER_DELETE_STATUS}},
        function (err, total) {
            callback(err, total);
        });
};
UserDAO.prototype.delete = function (id, callback) {
    UserModel.update(
        {"_id": id, "role": 1},
        {$set: {'status': constants.USER_DELETE_STATUS}},
        function (err) {
            callback(err);
        });
};
UserDAO.prototype.update = function (obj, callback) {
    UserModel.update(
        {'_id': obj._id},
        {$set: {
            'userName': obj.userName,
            'realName': obj.realName ? obj.realName : obj.userName,
            'password': obj.password,
            'status': obj.status,
            'role': obj.role,
            'email': obj.email || "",
            'modifyTime': new Date()}
        },
        function (err) {
            callback(err);
        });
};
// 按开放平台用户 ID 查本地账号（只取未删除的，status < 2）
UserDAO.prototype.findByOpenUserId = function (openUserId, callback) {
    UserModel.findOne(
        {"openUserId": openUserId, "status": {$lt: constants.USER_DELETE_STATUS}},
        function (err, obj) {
            callback(err, obj);
        });
};
// 创建开放平台用户；回调必须返回保存后的文档（含 _id），供调用方写入 session
UserDAO.prototype.createOpenUser = function (obj, callback) {
    var userEntity = new UserModel(obj);
    userEntity.save(function (err, doc) {
        callback(err, doc);
    });
};
UserDAO.prototype.updatePassword = function (callback) {
    var salt = bcrypt.genSaltSync(10);
    var password = '';
    UserModel.find({}, function (err, docs) {
        docs.forEach(function (doc, i) {
            if (doc.password.length < 30) {
                password = bcrypt.hashSync(doc.password, salt);
                UserModel.update(
                    {'_id': doc._id},
                    {$set: {
                        'password': password}
                    },
                    function (err) {
                        callback(err);
                    });
            }
        });
        callback(err);
    });
};
module.exports = new UserDAO();