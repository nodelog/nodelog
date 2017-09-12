var async = require("async");//异步回调组件
var utils = require("util");//工具组件
var Content = require('./../models/Content.js');//Content DAO接口和Model等
var User = require('./../models/User.js');
var Category = require('./../models/Category.js');
var cmsUtils = require('./cmsUtils.js');//自定义util工具
var sessionUser;
var getCount = function (callback) {
    Content.getCount(sessionUser, function (err, total) {
        callback(err, total);
    });
};
var getCountByCategory = function (category, callback) {
    Content.getCountByCategory(category, sessionUser, function (err, total) {
        callback(err, total);
    });
};
var getCountByUser = function (author, callback) {
    Content.getCountByUser(author, function (err, total) {
        callback(err, total);
    });
};
var getCountByWord = function (word, callback) {
    Content.getCountByWord(word, sessionUser, function (err, total) {
        callback(err, total);
    });
};

exports.findByPage = function (req, res) {
    var total = 0, page = 0, totalPage = 0, docs = {};
	sessionUser = req.session.user;
    async.auto({
        totalCount: function (callback, results) {
            getCount(function (err, count) {
                total = count;
                callback(null);
            });
        },
        pageDocs: ["totalCount", function (callback, results) {
            var pageObj = cmsUtils.page(req.query.page, total);
            page = pageObj.page;
            totalPage = pageObj.totalPage;
            if (totalPage > 0) {
                Content.findByPage(page, sessionUser, function (err, objects) {
                    docs = objects;
                    callback(null);
                });
            } else {
                callback(null);
            }
        }],
        initUser: ["pageDocs", function (callback, results) {
            var count = 0;
            async.whilst(//sync floor
                function () {
                    return count < docs.length
                },
                function (callbackThis) {
                    var doc = docs[count];
                    User.findById(doc.author, function (err, obj) {
					
                        if (obj != null) {
                            doc.userName = obj.userName;
                            doc.realName = obj.realName;
                        } else {
                            console.log(doc.name + "'s user not found");
                            doc.userName = "未知";//
                        }
						count++;
                        callbackThis();
                    });
                },
                function (err) {
                    callback(err);
                }
            );
        }],
        initCategory: ["initUser", function (callback, results) {
            var count = 0;
            async.whilst(//sync floor
                function () {
                    return count < docs.length;
                },
                function (callbackThis) {
                    var doc = docs[count];
                    Category.findById(doc.category, function (err, obj) {
                        if (obj != null) {
                            doc.categoryName = obj.name;
                        } else {
                            console.log(doc.name + "'s category not found");
                            doc.categoryName = "未知";//
                        }
                        count++;
                        callbackThis();
                    });
                },
                function (err) {
                    callback(err);
                }
            );
        }]
    }, function (err, results) {
        var login = false;
        if (req.query.login === "true") {
            login = true;
        }
        var view = "index";
        var url = "/index?";
        var title = req.session.site.name;
        var currentMenu = "home";
        if (req.query.manager === "true") {
            view = "manager/content";
            url = "/manager/content?manager=true&";
            title = "日志管理";
            currentMenu = "content";
        }
        res.render(view, {docs: docs, title: title, login: login, page: page, totalPage: totalPage, total: total,url: url,currentMenu:currentMenu});
    });

};


exports.delete = function (req, res) {
    var id = req.body.id;
    sessionUser = req.session.user;
    Content.delete(id,sessionUser, function (err) {
        if (!err) {
            res.json({'success': true, 'msg': "删除成功"});
        } else {
            res.json({'success': false, 'msg': "删除失败"});
        }
    });
};
exports.share = function (req, res) {
	var id = req.body.id;
	var status = req.body.status;
    console.log(status);
    Content.share(id, status, function (err) {
        if (!err) {
            res.json({'success': true, 'msg': "成功"});
        } else {
            res.json({'success': false, 'msg': "失败"});
        }
    });
}
exports.findById = function (req, res) {
    var id = req.query.id;
    var view = req.query.view;
    var doc = null;
    async.auto({
        getContent: function (callback, results) {
            Content.findById(id, function (err, obj) {
                if (!err) {
                    doc = obj;
                } else {
                    console.log("data err");
                }
                callback(null);
            });
        },
        initUser: ["getContent", function (callback, results) {
            if (doc != null) {
                User.findById(doc.author, function (err, obj) {
                    if (obj != null) {
                        doc.userName = obj.userName;
                        doc.realName = obj.realName;
                        doc.email = obj.email;
                    } else {
                        console.log(doc.name + "'s user not found");
                        doc.userName = "佚名";//
                        doc.realName = "佚名";
                        doc.email = '';
                    }
                    callback(null);
                });
            } else {
                callback(null);
            }
        }],
        initCategory: ["initUser", function (callback, results) {
            if (doc != null) {
                Category.findById(doc.category, function (err, obj) {
                    if (obj != null) {
                        doc.categoryName = obj.name;
                    } else {
                        console.log(doc.name + "'s user not found");
                        doc.categoryName = "未知";//
                    }
                    callback(null);
                });
            } else {
                callback(null);
            }
        }]
    }, function (err, results) {
		if(doc == null){
			res.redirect("/error");
			return;
		}
        if (view == "editContent") {
            if (req.session.user._id != doc.author) {
                res.redirect("/");
            }
        }
        if (view == "contentDetail") {
            Content.addView(doc, function (err) {
                if (err) {
                    console.log("add view failure");
                }else{
                    doc.view = (doc.view+1);
                }
                res.render(view, {"doc": doc, "title": doc != null ? doc.name : "日志没有找到"});
            });
        } else {
            res.render(view, {"doc": doc, "title": doc != null ? doc.name : "日志没有找到"});
        }

    });
};
exports.findByCategory = function (req, res) {
    var category = {},categoryId, total = 0, page = 0, totalPage = 0, docs = {};
	sessionUser = req.session.user;
    async.auto({
        getCategoryById: function (callback, results) {
            categoryId = req.query.categoryId;
            Category.findById(categoryId, function (err, obj) {
                category = obj;
				if(category==null||category=={}){
					res.redirect('error');
					return;
				}
                callback(null);
            });
        },
        totalCount: ["getCategoryById", function (callback, results) {
            getCountByCategory(category._id, function (err, count) {
                total = count;
				console.log(total+" in category");
                callback(null);
            });
        }],
        getContentByPage: ["totalCount", function (callback, results) {
            var pageObj = cmsUtils.page(req.query.page, total);
            page = pageObj.page;
            totalPage = pageObj.totalPage;
            if (totalPage > 0) {
                Content.findByCategory(page, category._id, sessionUser, function (err, objects) {
                    docs = objects;
                    callback(null);
                });
            } else {
                console.log("data error");
                callback(null);
            }
        }],
        initUser: ["getContentByPage", function (callback, results) {
			
            var count = 0;
            async.whilst(//sync floor
                function () {
                    return count < docs.length
                },
                function (callbackThis) {
                    var doc = docs[count];
                    User.findById(doc.author, function (err, obj) {
                        if (obj != null) {
                            doc.userName = obj.userName;
                            doc.realName = obj.realName;
                        } else {
                            console.log(doc.name + "'s user not found");
                            doc.userName = "佚名";//
                            doc.realName = "佚名";//
                        }
                        count++;
                        callbackThis();
                    });
                },
                function (err) {
                    callback(err);
                }
            );
        }],
        initCategory: ["initUser", function (callback, results) {
            for (var i = 0; i < docs.length; i++) {
                docs[i].categoryName = category.name;
            }
            callback(null);
        }]
    }, function (err, results) {
		if(docs.length==0){
			res.redirect('error');
			return;
		}
        res.render("categoryContent", {docs: docs, category: category, title: category.name + " 相关日志",
            page: page, totalPage: totalPage, total: total, url:"/content/category?categoryId="+categoryId+"&",
            currentMenu:"category"});
		
    });
};
exports.findByUser = function (req, res) {
    var user = null, total = 0, page = 0, totalPage = 0, docs = {};
	console.log(new Date());
    async.auto({
        getUserById: function (callback, results) {
            var userId = req.query.userId;
            var session = req.session;
            if (userId == null && session != null) {
                userId = session.user._id;
            }
            if (userId != null) {
                User.findById(userId, function (err, obj) {
                    user = obj;
                    callback(null);
                });
            } else {
                callback(null);
            }
        },
        totalCount: ["getUserById", function (callback, results) {
            if (user != null) {
                getCountByUser(user._id, function (err, count) {
                    total = count;
                    callback(null);
                });
            } else {
                callback(null);
            }
        }],
        getContentByPage: ["totalCount", function (callback, results) {
            var pageObj = cmsUtils.page(req.query.page, total);
            page = pageObj.page;
            totalPage = pageObj.totalPage;
            if (totalPage > 0) {
                Content.findByUser(page, user._id, function (err, objects) {
                    docs = objects;
                    callback(null);
                });
            } else {
                console.log("data error");
                callback(null);
            }
        }],
        initUser: ["getContentByPage", function (callback, results) {
            for (var i = 0; i < docs.length; i++) {
                docs[i].userName = user.userName;
                docs[i].realName = user.realName;
            }
            callback(null);
        }],
        initCategory: ["initUser", function (callback, results) {
            var count = 0;
            async.whilst(//sync floor
			
                function () {
                    return count < docs.length;
                },
                function (callbackThis) {
                    var doc = docs[count];
					
                    Category.findById(doc.category, function (err, obj) {
                        if (obj != null) {
                            doc.categoryName = obj.name;
                        } else {
                            console.log(doc.name + "'s user not found");
                            doc.categoryName = "UNKNOWN CATEGORY";//
                        }
                        count++;
                        callbackThis();
                    });
                },
                function (err) {
                    callback(err);
                }
            );
        }]
    }, function (err, results) {
        var view = "myContent";
        var title = "我的日志";
        var currentMenu = "mycontent";
        if (req.query.manager === "true") {
            view = "manager/content";
            title = "日志管理";
            currentMenu = "content";
        }
		console.log(new Date());
        res.render(view, {docs: docs, title: title, page: page, totalPage: totalPage, total: total, url:"/content/user?",currentMenu:"mycontent"});
    });
};
exports.findByWord = function (req, res) {
    var word =null, total = 0, page = 0, totalPage = 0, docs = {};
    sessionUser = req.session.user;
    async.auto({
        totalCount: function (callback, results) {
            word = req.query.word;
            if (word != null) {
                getCountByWord(word, function (err, count) {
                    total = count;
                    callback(null);
                });
            } else {
                callback(null);
            }
        },
        getContentByPage: ["totalCount", function (callback, results) {
            var pageObj = cmsUtils.page(req.query.page, total);
            page = pageObj.page;
            totalPage = pageObj.totalPage;
            if (totalPage > 0) {
                Content.findByWord(page, word, sessionUser, function (err, objects) {
                    docs = objects;
                    callback(null);
                });
            } else {
                console.log("data error");
                callback(null);
            }
        }],
        initUser: ["getContentByPage", function (callback, results) {

            var count = 0;
            async.whilst(//sync floor
                function () {
                    return count < docs.length
                },
                function (callbackThis) {
                    var doc = docs[count];
                    User.findById(doc.author, function (err, obj) {
                        if (obj != null) {
                            doc.userName = obj.userName;
                            doc.realName = obj.realName;
                        } else {
                            console.log(doc.name + "'s user not found");
                            doc.userName = "UNKNOWN AUTHOR";//
                        }
                        count++;
                        callbackThis();
                    });
                },
                function (err) {
                    callback(err);
                }
            );
        }],
        initCategory: ["initUser", function (callback, results) {
            var count = 0;
            async.whilst(//sync floor

                function () {
                    return count < docs.length;
                },
                function (callbackThis) {
                    var doc = docs[count];

                    Category.findById(doc.category, function (err, obj) {
                        if (obj != null) {
                            doc.categoryName = obj.name;
                        } else {
                            console.log(doc.name + "'s user not found");
                            doc.categoryName = "UNKNOWN CATEGORY";//
                        }
                        count++;
                        callbackThis();
                    });
                },
                function (err) {
                    callback(err);
                }
            );
        }]
    }, function (err, results) {
        if (req.query.type != "json") {
            res.render("search", {docs: docs, title: "标题包含 \""+word+"\" 的日志的搜索结果", key: word, page: page, totalPage: totalPage, total: total});
        } else {
            res.json({docs:docs});
        }
    });
};
exports.findByWordJson = function (req, res) {
    sessionUser = req.session.user;
    Content.findAllByWord(req.body.word, sessionUser, function (err, docs) {
        res.json({docs:docs});
    });
};

var findByName = function (name, callback) {
    Content.findByName(name, function (err, obj) {
        callback(err, obj);
    });
};
//add
exports.add = function (req, res) {
	console.log("add content");
    var id = req.body.id;
    var name = req.body.name.trim();
    var oldName = req.body.oldName;
    var content = req.body.content;
    var category = req.body.category;
    var original = req.body.original;
    var msg = "";
    var success = false;
    var falg = false;//callback
    if (name === "") {
        msg = "标题不能为空";
    } else if (content === "") {
        msg = "内容不能为空";
    } else {
        flag = true;
        findByName(name, function (err, obj) {
            if (id == null) {//add
                if (obj !== null) {
                    msg = "日志已经存在";
                    res.json({'success': success, 'msg': msg});
                } else {
                    var session = req.session;
		  //  var view = parseInt(Math.random()*10000 + 1000, 10);
                    obj = {
                        "name": name,
                        "content": content,
                        "author": session.user._id,
                        "category": category,
                        "original": original
//			"view":parseInt(Math.random()*10000 + 1000, 10)
                    };
                    Content.save(obj, function (err) {
                        if (!err) {
                            success = true;
                            msg = "发表日志成功";
                        } else {
                            console.log(err.message);
                            msg = "发表日志失败";
                        }
                        res.json({'success': success, 'msg': msg});
                    });
                }
            } else {//update
                if (obj !== null && obj.name != oldName) {
                    msg = "日志已经存在";
                    res.json({'success': success, 'msg': msg});
                } else {
                    obj = {
                        "id": id,
                        "name": name,
                        "content": content,
                        "category": category,
                        "original": original
                    };
                    Content.update(obj, function (err) {
                        if (!err) {
                            success = true;
                            msg = "编辑日志成功";
                            console.log("success");
                        } else {
                            console.log(err.message);
                            msg = "编辑日志失败";
                        }
                        res.json({'success': success, 'msg': msg, 'id': obj.id});
                    });
                }
            }
        });
    }//end else
    if (!flag) {// no callback
        res.json({'success': success, 'msg': msg});
    }
};
//update
exports.update = function (req, res) {
    var id = req.body.id;
    var name = req.body.name.trim();
    var msg = "";
    var success = false;
    var falg = false;//callback
    if (name == "") {
        msg = "Content Name is empty";
    } else {
        flag = true;
        findByName(name, function (err, obj) {
            if (obj != null) {
                msg = "Content Name is exists";
                res.json({'success': success, 'msg': msg});
            } else {
                Content.update(id, name, function (err) {
                    if (!err) {
                        success = true;
                        msg = "Modify Content is success";
                    } else {
                        console.log(err.message);
                        msg = "Modify Content is failure";
                    }
                    res.json({'success': success, 'msg': msg});
                });
            }
        });
    }//end else
    if (!flag) {// no callback
        res.json({'success': success, 'msg': msg});
    }
};

//exports.findByManager = function (req, res) {
//
//}

