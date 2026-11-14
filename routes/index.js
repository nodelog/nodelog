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
var cfgConst = require('./../controllers/adminConfig');
var dashboard = require('./../controllers/dashboard');
var moderation = require('./../controllers/moderation');
var markdown = require('./../controllers/markdown');
var openAuth = require('./../controllers/openAuth');
var audit = require('./../controllers/audit');
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

    app.get('/manager', filter.authorize, dashboard.overview);
    // 博客设置：原先误置于概览页的站点配置表单，独立成 /manager/setting（仅管理员）
    app.get('/manager/setting', filter.authorize, filter.authorizeAdmin, function (req, res) {
        res.render('manager/setting', { title: '博客设置', currentMenu: 'setting' });
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
    app.get('/log/count', log.logCount);
    app.get('/category/all', category.findAll);
    app.get('/content/detail', content.findById);
    app.get('/content/edit', filter.authorize, content.findById);
    app.get('/content/category', content.findByCategory);
    // P0 风控（§7.2）：content/add 按用户限流（默认 3 次/60s，按 session.user._id 分桶，NAT 多用户互不干扰）。
    app.post('/content/add', filter.authorize,
        rateLimit.limit({
            max: cfgConst.MODERATION_CONTENT_MAX,
            windowMs: cfgConst.MODERATION_CONTENT_WINDOW_MS,
            key: 'content-add',
            keyFunction: function (req) {
                return (req.session && req.session.user && req.session.user._id)
                    ? String(req.session.user._id) : (req.ip || 'unknown');
            }
        }),
        content.add);
    app.get('/content/addPage', function (req, res) {
        res.render("addContent", {"title": "写文章",currentMenu:"content"});
    });
    app.post('/comment/add', filter.authorize, rateLimit.limit({max: 10, windowMs: 60 * 1000}), comment.add);
    app.get('/comment/all', comment.findByPageAndContent);
    app.get('/session', user.session);
    app.post('/session', user.session);
    app.get('/content/user', filter.authorize, content.findByUser);
    // 前台作者自助删除（复用 content.delete，DAO 层按 author 归属软删，管理员豁免）
    app.post('/content/delete', filter.authorize, content.delete);
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
    // ==================== 开放文章发布 API（供外部系统 / AI 工具调用）====================
    // 无状态 Token 鉴权，不走 session/cookie，故 csrfGuard 对带 token 的这些路径放行（见 filter.csrfGuard）。
    var articleApi = require('./../controllers/articleApi');
    app.post('/api/articles', rateLimit.limit({max: 60, windowMs: 60 * 1000, key: 'api-articles'}), articleApi.auth, articleApi.publish);
    app.get('/api/articles/:id', articleApi.auth, articleApi.getArticle);
    app.get('/api/categories', articleApi.auth, articleApi.listCategories);
    // ==================== 新功能公告自动发布 API（git hook / CI / 补发脚本）====================
    // 按 commitHash 幂等：重复 POST 不会产生第二条公告。无状态 Token，已由 csrfGuard 放行。
    var announcementApi = require('./../controllers/announcementApi');
    app.post('/api/announcements',
        rateLimit.limit({max: 120, windowMs: 60 * 1000, key: 'api-announcements'}),
        announcementApi.auth, announcementApi.publish);
    // P2 运营统计
    app.get('/manager/analytics', filter.authorizeAdmin, analytics.overview);
    // 日志相关路由见上方 log.* （已清理重复的 /log 调试路由 filter.log）
    // 越权点 1 修复：后台友链页必须登录 + 管理员（D2/R1）。公开 /link/list 在下方保持无鉴权。
    app.get('/manager/link', filter.authorize, filter.authorizeAdmin, function(req, res){res.render('manager/link',{currentMenu:"link",title:"链接管理"});});
    app.post('/manager/link/save', filter.authorizeAdmin, link.save);
    app.get('/link/list', link.findAll);
    app.post('/manager/link/delete', filter.authorizeAdmin, link.delete);

    // ==================== 后台管理模块增强 · 新增路由（SPEC §5.3）====================
    // 全部走新增 /manager/* 路由；前台共享接口（/tags /category/all /link/list /comment/all
    // /log /log/detail /log/count /content/detail /content/search /tag/:slug）绝不加鉴权。
    // 权限：A = authorize + authorizeAdmin；L = authorize（归属在 controller/DAO 内部按 session 判定）。
    function A(req, res, next) { return filter.authorize(req, res, function () { return filter.authorizeAdmin(req, res, next); }); }
    var L = filter.authorize;

    // ---- Content（modify/status 为 L+归属；batch/import/export 为 A）----
    app.post('/manager/content/modify', L, content.modify);
    app.post('/manager/content/status', L, content.status);
    app.post('/manager/content/batch', A, content.batch);
    app.post('/manager/content/import', A, content['import']);
    app.get('/manager/content/export', A, content['export']);
    // ---- Category（全部 A）----
    app.get('/manager/category/detail', A, category.detail);
    app.post('/manager/category/status', A, category.status);
    app.post('/manager/category/batch', A, category.batch);
    app.post('/manager/category/import', A, category['import']);
    app.get('/manager/category/export', A, category['export']);
    // ---- Tag（全部 A；列表页与详情）----
    app.get('/manager/tag', A, tag.adminList);
    app.get('/manager/tag/detail', A, tag.detail);
    app.post('/manager/tag/add', A, tag.add);
    app.post('/manager/tag/modify', A, tag.modify);
    app.post('/manager/tag/delete', A, tag.delete);
    app.post('/manager/tag/status', A, tag.status);
    app.post('/manager/tag/batch', A, tag.batch);
    app.post('/manager/tag/import', A, tag['import']);
    app.get('/manager/tag/export', A, tag['export']);
    app.post('/manager/tag/reconcile', A, tag.reconcile); // 一键重算标签计数（自愈）
    // ---- Link（写沿用 /manager/link/save、/manager/link/delete；以下为新增）----
    app.get('/manager/link/detail', A, link.detail);
    app.post('/manager/link/list', A, link.adminList);
    app.post('/manager/link/status', A, link.status);
    app.post('/manager/link/batch', A, link.batch);
    app.post('/manager/link/import', A, link['import']);
    app.get('/manager/link/export', A, link['export']);
    // ---- User（update/delete 老路由保留在上方；以下为新增，全部 A）----
    app.post('/manager/user/add', A, user.adminAdd);
    app.get('/manager/user/detail', A, user.detail);
    app.post('/manager/user/status', A, user.status);
    app.post('/manager/user/batch', A, user.batch);
    app.post('/manager/user/import', A, user['import']);
    app.get('/manager/user/export', A, user['export']);
    // ---- Comment（/comment/add、/comment/all 老路由保留在上方且公开；以下全部 A）----
    app.get('/manager/comment', A, comment.adminList);
    app.get('/manager/comment/detail', A, comment.detail);
    app.post('/manager/comment/modify', A, comment.modify);
    app.post('/manager/comment/delete', A, comment.delete);
    app.post('/manager/comment/status', A, comment.status);
    app.post('/manager/comment/batch', A, comment.batch);
    app.post('/manager/comment/import', A, comment['import']);
    app.get('/manager/comment/export', A, comment['export']);
    // ---- Log（/manager/log/add 带 id 兼容分支保留在上方；以下全部 A）----
    app.post('/manager/log/modify', A, log.modify);
    app.post('/manager/log/status', A, log.status);
    app.post('/manager/log/batch', A, log.batch);
    app.post('/manager/log/import', A, log['import']);
    app.get('/manager/log/export', A, log['export']);
    // ---- Audit（仅管理员只读；JSON + 页面）----
    app.get('/manager/audit', A, audit.list);
    app.get('/manager/audit/page', A, audit.auditPage);

    // ---- 方案D：4 条纯增量后台 JSON 列表端点（只读、A）----
    // 与下方 4 个 SSR 页 /manager/{content,category,user,log} 并存、不混：那 4 页继续承担 E01 分页兼容，
    // 这 4 条只做筛选/搜索/排序的 JSON 数据供应（E03/E04/E05），全部走 req.query，不碰任何共享前台 handler。
    app.get('/manager/content/list', A, content.adminList);
    app.get('/manager/category/list', A, category.adminList);
    app.get('/manager/user/list', A, user.adminList);
    app.get('/manager/log/list', A, log.adminList);

    // ---- 方案D-SSR：4 条管理员专用页面级筛选/排序 SSR 路由（老 4 条 SSR 路由零改动）----
    // 复用 crud.list 的 SSR 分支（传 view + urlPrefix），locals 含 docs/filters/散开的筛选字段/url，
    // 供升级后的 manager/{content,category,user,log} 模板里的 adminToolbar/adminPager 消费。
    // 与上方 4 条 JSON 端点、4 条老 SSR 路由、公开 / /index /log /category/all 全部并存不混。
    app.get('/manager/content/admin', A, content.adminPage);
    app.get('/manager/category/admin', A, category.adminPage);
    app.get('/manager/user/admin', A, user.adminPage);
    app.get('/manager/log/admin', A, log.adminPage);

    // ---- 内容风控与账号处置（SPEC-MODERATION §8.1，全部 A；公开前台接口零改动）----
    // 敏感词库写后 controller 调 matcher.invalidate；违规记录 append-only；处置走独立幂等接口。
    app.get('/manager/sensitive-word', A, moderation.sensitiveWordAdmin.page);
    app.get('/manager/sensitive-word/list', A, moderation.sensitiveWordAdmin.list);
    app.post('/manager/sensitive-word/add', A, moderation.sensitiveWordAdmin.add);
    app.post('/manager/sensitive-word/modify', A, moderation.sensitiveWordAdmin.modify);
    app.post('/manager/sensitive-word/delete', A, moderation.sensitiveWordAdmin.delete);
    app.post('/manager/sensitive-word/status', A, moderation.sensitiveWordAdmin.status);
    app.post('/manager/sensitive-word/batch', A, moderation.sensitiveWordAdmin.batch);
    app.post('/manager/sensitive-word/import', A, moderation.sensitiveWordAdmin['import']);
    app.get('/manager/sensitive-word/export', A, moderation.sensitiveWordAdmin['export']);
    app.get('/manager/violation', A, moderation.violationAdmin.page);
    app.get('/manager/violation/list', A, moderation.violationAdmin.list);
    app.get('/manager/violation/detail', A, moderation.violationAdmin.detail);
    app.post('/manager/moderation/user/dispose', A, moderation.dispose.apply);

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
