var mongodb = require('./mongodb');
var constants = require('./constants');

var Schema = mongodb.mongoose.Schema;
var UserSchema = new Schema({
    userName: {type: 'String', required: true},
    realName: {type: 'String', required: true},
    password: {type: 'String', required: true},
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
            'realName': obj.realName?obj.realName:obj.userName,
            'password': obj.password,
            'status': obj.status,
            'role': obj.role,
            'modifyTime': new Date()}
        },
        function (err) {
            callback(err);
        });
};
module.exports = new UserDAO();