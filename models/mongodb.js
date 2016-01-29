var mongoose = require('mongoose');//引入mongoose模块实现mongodb的连接和数据库操作
var settings = require('../settings');//引入配置
mongoose.connect(settings.url);//连接mongodb
exports.mongoose = mongoose;//导出mongodb的连接器mongoose