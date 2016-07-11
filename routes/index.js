var filter = require('./filter');
var user = require('./../controllers/user');
var site = require('./../controllers/site');
var category = require('./../controllers/category');
var content = require('./../controllers/content');
var comment = require('./../controllers/comment');
var log = require('./../controllers/log');
var link = require('./../controllers/link');
var route = function (app) {
	app.get('/', content.findByPage);
    app.get('/index', content.findByPage);
    app.get('/about', function (req, res) {
        res.render('about', { title: '关于我们'});
    });
    app.post('/user/login', user.login);
    app.post('/user/reg', user.addUser);
    app.get('/user/logout', user.logout);

    app.get('/manager', filter.authorize, function (req, res) {
        res.render('manager/index', { title: req.session.site.name,currentMenu:"home"});
    });
    app.post('/manager/site/update',  filter.authorize, filter.authorizeAdmin,  site.update);
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
    app.post('/manager/content/delete', filter.authorize, content.delete);
    app.post('/manager/user/delete', filter.authorizeAdmin, user.delete);
    app.post('/manager/user/update', filter.authorize, user.update);
    app.post('/manager/category/add', filter.authorizeAdmin, category.add);
    app.post('/manager/category/modify', filter.authorizeAdmin, category.update);
    app.post('/manager/category/delete', filter.authorizeAdmin, category.delete);
    app.get('/manager/log', filter.authorizeAdmin, log.findByPage);
    app.get('/manager/log/addPage', filter.authorizeAdmin, function(req,res){res.render("manager/addLog",{title:"发布公告",template:"<br /><br /><br /><br />管理员<br />"+new Date().format("yyyy年MM月dd日")});});
    app.post('/manager/log/add', filter.authorizeAdmin, log.add);
    app.post('/manager/log/delete', filter.authorizeAdmin, log.delete);
    app.get('/log/detail',  log.findById);
    app.get('/manager/log/detail',filter.authorizeAdmin, log.findById);
    app.get('/log',log.findByPage);
    app.post('/log/count', log.logCount);
    app.get('/category/all', category.findAll);
    app.get('/content/detail', content.findById);
    app.get('/content/edit', filter.authorize, content.findById);
    app.get('/content/category', content.findByCategory);
    app.post('/content/add', filter.authorize, content.add);
    app.get('/content/addPage', function (req, res) {
        res.render("addContent", {"title": "发表日志",currentMenu:"content"});
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
    app.get('/manager/link', function(req, res){res.render('manager/link',{currentMenu:"link",title:"链接管理"});});
    app.post('/manager/link/save', filter.authorizeAdmin, link.save);
    app.post('/link/list', link.findAll);
    app.post('/manager/link/delete', filter.authorizeAdmin, link.delete);
    app.get('/test', function(req, res){res.render('test');});
    app.get('/error', function(req,res){res.render('error', {title: '没有找到',state: '404'});});
    // 下面的路由必须放到最后，404页面
    // app.get('*', function(req, res){res.redirect('/error');});
    app.get('/clock', function(req, res){res.render('clock',{title:"html5时钟"})});
    app.get('/nodelog', function(req, res){res.render('nodelog',{title:"域名出售"})});
};
exports.route = route;
