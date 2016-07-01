//require加载库
var express = require('express');
var path = require('path');
var favicon = require('static-favicon');
var compress = require('compression');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var settings = require('./settings');
var session = require('express-session');
var MongoStore = require('connect-mongo')(session);
var routes = require('./routes/index');
var filter = require('./routes/filter');
//初始化express框架
var app = express();
//设置view层页面路径
app.set('views', path.join(__dirname, 'views'));
//设置view层使用的模板引擎
app.set('view engine', 'ejs');

app.use(favicon());//网站图标
app.use(logger('dev'));//日志级别
app.use(compress());//压缩
app.use(bodyParser.json());//json
app.use(bodyParser.urlencoded());//url编码
app.use(cookieParser());//cookie组件
app.use(express.static(path.join(__dirname, 'public')));//静态资源路径，
//session配置，这里使用mongodb作为session存储
app.use(session({
    secret: settings.cookieSecret,
    store: new MongoStore({
     url: settings.url
    })
}));
//接受请求
app.use(function (req, res, next) {
    res.locals.session = req.session;
    //初始化网站配置信息
    filter.initSite(req, res, next);
});
//装载路由
routes.route(app);

//404错误处理
app.use(function (req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});
//环境设置和服务器500错误处理
if (app.get('env') === 'development') {
    app.use(function (err, req, res, next) {
        res.status(err.status || 500);
        res.redirect('/error');
    });
}
// 500错误页面
app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    res.redirect('/error');
   /* res.redirect('error', {
        title: '没有找到',
        message: err.message,
        error: {}
    });*/
});

//var debug = require('debug')('my-application'); // debug模块
//module.exports = app;

app.set('port', process.env.PORT || settings.port); // 设定监听端口

module.exports = app; //这是 4.x 默认的配置，分离了 app 模块,将它注释即可，上线时可以重新改回来

//启动监听
//var server = app.listen(app.get('port'), function () {
  //  console.log('Express server listening on port ' + server.address().port);
//});
