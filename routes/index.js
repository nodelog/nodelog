var filter = require('./filter');
var user = require('./../controllers/user');
var site = require('./../controllers/site');
var category = require('./../controllers/category');
var content = require('./../controllers/content');
var comment = require('./../controllers/comment');
var log = require('./../controllers/log');
var link = require('./../controllers/link');
var tag = require('./../controllers/tag');
var upload = require('./../controllers/upload');
var ai = require('./../controllers/ai');
var analytics = require('./../controllers/analytics');
var rateLimit = require('./../controllers/rateLimit');
var markdown = require('./../controllers/markdown');
var openAuth = require('./../controllers/openAuth');
var route = function (app) {
    // ===== LINK ONE 开放平台：扫码登录 + 公众号 JS-SDK 签名（按需求排除支付）=====
    // 上游 AppID / AppSecret 只在服务端使用，前端永远拿不到
    // 阈值按前端真实频率定：qr-login.js 每 1.5s 轮询一次 ≈ 40 次/分钟，
    // status 若只给 10~30 次/分钟会把正常扫码打回 429，故放宽到 90 次/分钟。
    app.get('/open/qrcode', rateLimit.limit({max: 15, windowMs: 60 * 1000, key: 'open-qrcode'}), openAuth.qrcode);
    app.get('/open/status', rateLimit.limit({max: 90, windowMs: 60 * 1000, key: 'open-status'}), openAuth.status);
    app.get('/open/jsConfig', rateLimit.limit({max: 60, windowMs: 60 * 1000, key: 'open-jsconfig'}), openAuth.jsConfig);
    app.get('/open/logout', openAuth.logout);
	app.get('/', content.findByPage);
    app.get('/index', content.findByPage);
    app.get('/about', function (req, res) {
        res.render('about', { title: '关于我们'});
    });
    app.post('/user/login', rateLimit.limit({max: 10, windowMs: 5 * 60 * 1000}), user.login);
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
        res.render("addContent", {"title": "写文章",currentMenu:"content"});
    });
    app.post('/comment/add', filter.authorize, rateLimit.limit({max: 10, windowMs: 60 * 1000}), comment.add);
    app.get('/comment/all', comment.findByPageAndContent);
    app.get('/session', user.session);
    app.post('/session', user.session);
    app.get('/content/user', filter.authorize, content.findByUser);
    app.get('/content/search',content.searchFull);
    app.post('/content/search',content.findByWordJson);
    // P0 图床上传（base64 -> public/uploads）
    app.post('/api/upload', filter.authorize, upload.upload);
    // P0 编辑器实时预览（服务端 markdown 渲染，与展示一致）
    app.post('/api/preview', filter.authorize, function (req, res) {
        res.json({ html: markdown.render(req.body.content || '') });
    });
    // P0/P1 标签体系
    app.get('/tag/:slug', tag.findBySlug);
    app.get('/tags', tag.list);
    // P2 AI 辅助（仅管理员，且需配置 AI_API_KEY）
    app.post('/api/ai/summary', filter.authorizeAdmin, ai.summary);
    // P2 运营统计
    app.get('/manager/analytics', filter.authorizeAdmin, analytics.overview);
    // 日志相关路由见上方 log.* （已清理重复的 /log 调试路由 filter.log）
    app.get('/manager/link', function(req, res){res.render('manager/link',{currentMenu:"link",title:"链接管理"});});
    app.post('/manager/link/save', filter.authorizeAdmin, link.save);
    app.post('/link/list', link.findAll);
    app.post('/manager/link/delete', filter.authorizeAdmin, link.delete);
    app.get('/error', function(req,res){res.render('error', {title: '没有找到',state: '404'});});
    // 下面的路由必须放到最后，404页面
    // app.get('*', function(req, res){res.redirect('/error');});
    app.get('/clock', function(req, res){res.render('clock',{title:"html5时钟"})});
    // sitemap 文件可能未生成，缺失时返回 404 而非 500
    function sendSitemap(req, res, file) {
        var p = require('path').join(__dirname, '..', file);
        if (require('fs').existsSync(p)) {
            res.sendFile(p);
        } else {
            res.status(404).render('error', { title: '没有找到', state: '404' });
        }
    }
    app.get('/sitemap.xml', function (req, res) { sendSitemap(req, res, 'sitemap.xml'); });
    app.get('/sitemap.html', function (req, res) { sendSitemap(req, res, 'sitemap.html'); });
    app.get('/google46e8392abe1a37f5.html', function(req, res){res.sendFile('google46e8392abe1a37f5.html')});
};
exports.route = route;
