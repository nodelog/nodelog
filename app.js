//require加载库
var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var compress = require('compression');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var settings = require('./settings');
var session = require('express-session');
//connect-mongo @3 -> @4
// var MongoStore = require('connect-mongo')(session);
var MongoStore = require('connect-mongo');
var routes = require('./routes/index');
var filter = require('./routes/filter');
//初始化express框架
var app = express();
//设置view层页面路径
app.set('views', path.join(__dirname, 'views'));
//设置view层使用的模板引擎
app.set('view engine', 'ejs');
// 视图层全局可用的日期格式化辅助（替代旧版 EJS `| format` 过滤器，兼容 YYYY-MM-DD 等标记）
var cmsUtils = require('./controllers/cmsUtils');
app.locals.format = cmsUtils.format;

// app.use(favicon());//网站图标
app.use(logger('dev'));//日志级别
app.use(compress());//压缩
// 基础安全响应头（无需额外依赖）
app.use(function (req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});
// app.use(bodyParser.json());//json
// app.use(bodyParser.urlencoded());//url编码
// 收紧请求体上限：富文本文章通常远小于 15MB，原 50MB 易被滥用造成内存压力
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ limit: '15mb', extended: true }));

app.use(cookieParser());//cookie组件
app.use(express.static(path.join(__dirname, 'public')));//静态资源路径，
app.use(favicon(__dirname + '/public/images/favicon.ico'));
// 动态页面（服务端渲染的 HTML）与接口一律不缓存：登录态、文章列表、公告数都是实时数据，
// 被浏览器/CDN 缓存会导致强刷后看到过期空页或登录态错乱。静态资源已在上面命中并直接返回，不受影响。
app.use(function (req, res, next) {
    if (req.method === 'GET') res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    next();
});
//session配置，这里使用mongodb作为session存储
app.use(session({
    resave: false, //添加 resave 选项
    saveUninitialized: false, // 不为匿名访客创建空 session，减少 MongoDB 写入
    secret: process.env.SESSION_SECRET || settings.cookieSecret,
    store: MongoStore.create({
        // 兼容两种配置键名：新版 settings 用 url，旧版（settings.bak.js）用 dbUrl
        mongoUrl: settings.url || settings.dbUrl || process.env.MONGO_URL || process.env.MONGODB_URI,
    }),
    cookie: {
        httpOnly: true, // 禁止客户端脚本读取 cookie
        secure: process.env.NODE_ENV === 'production', // 生产(HTTPS)环境启用 secure
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 天
    }
    // store: new MongoStore({
    //  url: settings.url
    // })
}));
//接受请求
app.use(function (req, res, next) {
    res.locals.session = req.session;
    //初始化网站配置信息
    filter.initSite(req, res, next);
});
// 状态变更请求的同源校验（防 CSRF），对正常同源提交无影响
app.use(filter.csrfGuard);
//装载路由
routes.route(app);

//404错误处理
app.use(function (req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});
// 404 / 500 错误处理：接住上面 next(err) 抛出的错误，返回友好页面（不暴露堆栈）
app.use(function (err, req, res, next) {
    var status = err.status || 500;
    res.status(status);
    if (status === 404) {
        res.render('error', { title: '没有找到', state: '404' });
    } else {
        // 非 404 错误：堆栈只记在服务端日志，不回传给客户端
        console.error('[' + new Date().toISOString() + '] ' + (err && err.stack ? err.stack : err));
        res.render('error', { title: '出错了', state: String(status) });
    }
});

//var debug = require('debug')('my-application'); // debug模块
//module.exports = app;

app.set('port', process.env.PORT || settings.port); // 设定监听端口

module.exports = app; //这是 4.x 默认的配置，分离了 app 模块,将它注释即可，上线时可以重新改回来

//启动监听
//var server = app.listen(app.get('port'), function () {
  //  console.log('Express server listening on port ' + server.address().port);
//});
