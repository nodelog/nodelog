var filter = require('./filter');
var user = require('./../controllers/user');
var category = require('./../controllers/category');
var content = require('./../controllers/content');
var comment = require('./../controllers/comment');
var log = require('./../controllers/log');
var cmsUtils = require('./../controllers/cmsUtils');
var route = function (app) {
	app.get('/', function(req, res) {res.redirect("/index?page=1");});
    app.get('/index', filter.createUser, content.findByPage);
    app.get('/about', function (req, res) {
        res.render('about', { title: '关于我们'});
    });
    app.post('/user/login', user.login);
    app.post('/user/reg', user.addUser);
    app.get('/user/logout', user.logout);

    app.get('/manager', filter.authorize, function (req, res) {
        res.render('manager/index', { title: '解点日志'});
    });
    app.get('/manager/user', filter.authorize,  user.findByPage);
    app.get('/manager/category', filter.authorize, filter.authorizeAdmin, category.findByPage);
    app.get('/manager/content', filter.authorize, function (req, res) {
        var session = req.session;
        if (session != null) {
            var user = session.user;
            if (user != null) {
                var role = user.role;
                if (role == 0) {//管理员
                    content.findByPage(req, res);
                } else {//普通用户
                    content.findByUser(req, res);
                }
            } else {
                res.redirect("/");
            }
        } else {
            res.redirect("/");
        }
    });
	app.post('/manager/content/share', filter.authorize, content.share);
    app.get('/manager/content/detail', filter.authorize, content.findById);
    app.post('/manager/user/delete', filter.authorizeAdmin, user.delete);
    app.post('/manager/user/update', filter.authorize, user.update);
    app.post('/manager/category/add', filter.authorizeAdmin, category.add);
    app.post('/manager/category/modify', filter.authorizeAdmin, category.update);
    app.post('/manager/category/delete', filter.authorizeAdmin, category.delete);
    app.get('/manager/log', filter.authorizeAdmin, log.findByPage);
    app.get('/manager/log/addPage', filter.authorizeAdmin, function(req,res){res.render("manager/addLog",{title:"发布公告",template:"<br /><br /><br /><br />NODELOG ｜ 技术部<br />"+new Date().format("yyyy年MM月dd日")});});
    app.post('/manager/log/add', filter.authorizeAdmin, log.add);
    app.post('/manager/log/delete', filter.authorizeAdmin, log.delete);
    app.get('/log/detail',  log.findById);
    app.get('/manager/log/detail',filter.authorizeAdmin, log.findById);
    app.get('/log',log.findByPage);
    app.get('/category/all', category.findAll);
    app.get('/content/detail', content.findById);
    app.get('/content/edit', filter.authorize, content.findById);
    app.get('/content/category', content.findByCategory);
    app.post('/content/add', filter.authorize, content.add);
    app.get('/content/addPage', function (req, res) {
        res.render("addContent", {"title": "发表日志"});
    });
    app.post('/comment/add', filter.authorize, comment.add);
    app.get('/comment/all', comment.findByPageAndContent);
    app.get('/session', user.session);
    app.post('/session', user.session);
    app.get('/content/user', filter.authorize, content.findByUser);
    app.get('/content/search',content.findByWord);
    app.post('/content/search',content.findByWordJson);
    //日志路由
    app.get('/log',filter.log);
    app.get('/test', function(req, res){res.render('test');});
    app.get('/error',function(req,res){res.render('error', {title: '没有找到'});});
    // 下面的路由必须放到最后，404页面
    // app.get('*', function(req, res){res.redirect('/error');});
};
exports.route = route;
