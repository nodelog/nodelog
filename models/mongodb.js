var mongoose = require('mongoose');//引入mongoose模块实现mongodb的连接和数据库操作
var settings = require('../settings');//引入配置
// 兼容两种配置键名：新版 settings 用 url，旧版（settings.bak.js）用 dbUrl
var mongoUrl = settings.url || settings.dbUrl || process.env.MONGO_URL || process.env.MONGODB_URI;
if (!mongoUrl) {
    throw new Error('[NODELOG] 未配置 MongoDB 连接串：请在 settings.js 设置 url(或 dbUrl)，或注入环境变量 MONGO_URL / MONGODB_URI');
}
mongoose.connect(mongoUrl);//连接mongodb
exports.mongoose = mongoose;//导出mongodb的连接器mongoose