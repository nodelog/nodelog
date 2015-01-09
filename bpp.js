//require
var express = require('express');
var path = require('path');
var favicon = require('static-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var settings = require('./settings');
var session = require('express-session');
var MongoStore = require('connect-mongo')(session);
var routes = require('./routes/index');
var zlib = require("zlib");
var app = express();
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');



app.use(favicon());
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: settings.cookieSecret,
    store: new MongoStore({
        db: settings.db
    })
}));
app.use(function (req, res, next) {
    res.locals.session = req.session;
    next();
});
routes.route(app);

/// catch 404 and forward to error handler
app.use(function (req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

/// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function (err, req, res, next) {
        res.status(err.status || 500);
        res.redirect('/error');
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    res.redirect('/error');
    /* res.redirect('error', {
     title: '没有找到',
     message: err.message,
     error: {}
     });*/
});


var debug = require('debug')('my-application'); // debug模块
module.exports = app;

app.set('port', process.env.PORT || settings.port1); // 设定监听端口

// Environment sets...

//module.exports = app; //这是 4.x 默认的配置，分离了 app 模块,将它注释即可，上线时可以重新改回来

//启动监听
var server = app.listen(app.get('port'), function () {
    console.log('Express server listening on port ' + server.address().port);
});
