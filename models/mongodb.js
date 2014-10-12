var mongoose = require('mongoose');
var settings = require('../settings');
mongoose.connect(settings.url);
exports.mongoose = mongoose;