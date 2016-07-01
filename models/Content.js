var mongodb = require('./mongodb');//引入mongodb配置文件，同目录下mongodb.js文件，默认引入js文件。
var constants = require('./constants');//同上，引入常量类

var Schema = mongodb.mongoose.Schema;//获取mongodb schema
var ObjectId = Schema.ObjectId;//获取ObjectId

//sheme对象
var ContentSchema = new Schema({
    name: {type: String, required: true},
    content: {type: String, required: true},
    author: {type: ObjectId},//外键
    category: {type: ObjectId},//外键
    createTime: { type: Date, default: Date.now},
    modifyTime: {type: Date, default: Date.now},
    view: {type: Number,default:1},
    original: {type: String},//原文链接 输入即为转载
    status: {type: 'Number', default: 0, required: true, min: 0, max: 2}
}, {
    collection: "content" //对应mongodb的集合表
});
//构建model对象，所有对数据库操作都对该对象操作
var ContentModel = mongodb.mongoose.model("Content", ContentSchema);

//DAO接口
var ContentDAO = function () {
};
//通过prototype属性实现DAO接口
ContentDAO.prototype.save = function (obj, callback) {
    var ContentEntity = new ContentModel(obj);
    ContentEntity.save(function (err) {
        callback(err);
    });
};
ContentDAO.prototype.findByName = function (name, callback) {
    ContentModel.findOne({"name": name, "status": constants.CONTENT_ENABLE_STATUS}, function (err, obj) {
        callback(err, obj);
    });
};
ContentDAO.prototype.findById = function (id, callback) {
    ContentModel.findOne({"_id": id, "status": {$ne: constants.CONTENT_UNABLE_STATUS}}, function (err, obj) {
        callback(err, obj);
    });
};
ContentDAO.prototype.findByPage = function (page, currentUser, callback) {
	var term;
	if (currentUser == null) {
		term = {"status": constants.CONTENT_ENABLE_STATUS};
	}  else {
		term = {$or:[{"status": constants.CONTENT_ENABLE_STATUS},{"author": currentUser._id,  "status":{$ne: constants.CONTENT_UNABLE_STATUS}}]};

	}
	var query = ContentModel.find(term);
    query.select('name author category createTime modifyTime view status original');
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        callback(err, docs);
    });
};
ContentDAO.prototype.findByCategory = function (page, category, currentUser, callback) {
	var term;
	if (currentUser == null) {
		term = {"category": category, "status": constants.CONTENT_ENABLE_STATUS};
	}  else {
		term = {"category": category, $or:[{"status": constants.CONTENT_ENABLE_STATUS},{"author": currentUser._id,  "status":{$ne: constants.CONTENT_UNABLE_STATUS}}]};

	}
	var query = ContentModel.find(term);
    query.select('name author category modifyTime view original');
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        callback(err, docs);
    });
};
ContentDAO.prototype.findByWord = function (page, word, currentUser, callback) {
	var term;
	if (currentUser == null) {
		term = {"name":new RegExp(word, 'i'), "status": constants.CONTENT_ENABLE_STATUS};
	}  else {
		term = {"name":new RegExp(word, 'i'), $or:[{"status": constants.CONTENT_ENABLE_STATUS},{"author": currentUser._id,  "status":{$ne: constants.CONTENT_UNABLE_STATUS}}]};

	}
	var query = ContentModel.find(term);
    query.select('name author category modifyTime view original');
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        callback(err, docs);
    });
};
ContentDAO.prototype.findAllByWord = function (word, currentUser, callback) {
	var term;
	if (currentUser == null) {
		term = {"name":new RegExp(word, 'i'), "status": constants.CONTENT_ENABLE_STATUS};
	}  else {
		term = {"name":new RegExp(word, 'i'), $or:[{"status": constants.CONTENT_ENABLE_STATUS},{"author": currentUser._id,  "status":{$ne: constants.CONTENT_UNABLE_STATUS}}]};

	}
	var query = ContentModel.find(term);
    query.select('name');
    query.sort({"createTime": -1});
    query.exec(function (err, docs) {
        callback(err, docs);
    });
};
ContentDAO.prototype.findByUser = function (page, author, callback) {
    var query = ContentModel.find({"author": author, "status":{$ne: constants.CONTENT_UNABLE_STATUS}});
    query.select('name author category createTime modifyTime view status original');
    query.sort({"createTime": -1});
    query.limit(constants.PER_PAGE_COUNT);
    query.skip((page - 1) * constants.PER_PAGE_COUNT);
    query.exec(function (err, docs) {
        callback(err, docs);
    });
};
ContentDAO.prototype.getCount = function (currentUser,callback) {
	var term;
	if (currentUser == null) {
		term = {"status": constants.CONTENT_ENABLE_STATUS};
	}  else {
		term = {$or:[{"status": constants.CONTENT_ENABLE_STATUS},{"author": currentUser._id,  "status":{$ne: constants.CONTENT_UNABLE_STATUS}}]};
	}
    ContentModel.count(term, function (err, total) {
        callback(err, total);
    });
};
ContentDAO.prototype.getCountByCategory = function (category, currentUser, callback) {
    var term;
    if (currentUser == null) {
        term = {"category": category, "status": constants.CONTENT_ENABLE_STATUS};
    }  else {
        term = {"category": category, $or:[{"status": constants.CONTENT_ENABLE_STATUS},{"author": currentUser._id,  "status":{$ne: constants.CONTENT_UNABLE_STATUS}}]};
    }
    ContentModel.count(term, function (err, total) {
        callback(err, total);
    });
};
ContentDAO.prototype.getCountByCategoryOnly = function (category, callback) {
    ContentModel.count({"category": category, "status":{$ne: constants.CONTENT_UNABLE_STATUS}}, function (err, total) {
        callback(err, total);
    });
};
ContentDAO.prototype.getCountByUser = function (author, callback) {
    ContentModel.count({"author": author,  "status":{$ne: constants.CONTENT_UNABLE_STATUS}}, function (err, total) {
        callback(err, total);
    });
};
ContentDAO.prototype.getCountByWord = function (word, currentUser, callback) {
    var term;
    if (currentUser == null) {
        term = {"name": new RegExp(word, 'i'), "status": constants.CONTENT_ENABLE_STATUS};
    }  else {
        term = {"name":new RegExp(word, 'i'), $or:[{"status": constants.CONTENT_ENABLE_STATUS},{"author": currentUser._id,  "status":{$ne: constants.CONTENT_UNABLE_STATUS}}]};
    }

    ContentModel.count(term, function (err, total) {
        callback(err, total);
    });
};
ContentDAO.prototype.delete = function (id,currentUser, callback) {
    var term;
    if (currentUser.role == 0) {
        term = {"_id": id};
    } else {
        term = {"_id": id,"author": currentUser._id};
    }
    ContentModel.update(term, {$set: {"status": constants.COMMENT_UNABLE_STATUS }}, function (err) {
        callback(err);
    });
};
ContentDAO.prototype.share = function (id, status, callback) {
	var oldStatus = constants.CONTENT_ENABLE_STATUS;
	if (status == constants.COMMENT_UNABLE_STATUS){
		callback(err);
	}else{
		if (status == constants.CONTENT_ENABLE_STATUS){
			oldStatus = constants.CONTENT_SELF_STATUS;
		} else if (status == constants.CONTENT_SELF_STATUS){
			oldStatus = constants.CONTENT_ENABLE_STATUS;
		}
		ContentModel.update({"_id": id, "status": oldStatus}, {$set: {"status": status, "modifyTime": new Date()}}, function (err) {
			callback(err);
		});
	}
	
};
ContentDAO.prototype.update = function (obj, callback) {
    ContentModel.update({"_id": obj.id}, {$set: {"name": obj.name, "content": obj.content, "category": obj.category,"original": obj.original, "modifyTime": new Date()}}, function (err) {
        callback(err);
    });
};
ContentDAO.prototype.addView = function (obj, callback) {
    ContentModel.update({"_id": obj.id}, {$set: {"view": (obj.view+1)}}, function (err) {
        callback(err);
    });
};

//把DAO接口开放出去给controller调用
module.exports = new ContentDAO();
