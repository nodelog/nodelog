var User = require('./../models/User');
var os = require('os');
exports.authorize = function (req, res, next) {
    if (!req.session.user) {
        res.redirect('/');
    } else {
        next();
    }
};
exports.authorizeAdmin = function (req, res, next) {
    if (!req.session.user) {
        res.redirect('/');
    } else if (req.session.user.role != 0) {
	res.redirect('/manager');
    } else {
        next();
    }
};
exports.createUser = function (req, res, next) {
    User.findByName("admin", function (err, obj) {
        if (obj == null) {
            obj = {
                userName: "admin",
                password: "admin",
                role: 0,//0 super admin,1 normal user
                status: 0
            };
            User.save(obj,function (err) {
                next();
            });
        } else {
            next();
        }
    });
};
function getDate()
{
	var date = new Date();
    
    var format="yyyy-MM-dd hh:mm:ss";
     
    var o = {
        "M+" : date.getMonth() + 1,
        "d+" : date.getDate(),
        "h+" : date.getHours(),
        "m+" : date.getMinutes(),
        "s+" : date.getSeconds(),
        "q+" : Math.floor((date.getMonth() + 3) / 3),
        "S" : date.getMilliseconds()
    }
    if (/(y+)/.test(format))
    {
        format = format.replace(RegExp.$1, (date.getFullYear() + "").substr(4
            - RegExp.$1.length));
    }

    for (var k in o)
    {
        if (new RegExp("(" + k + ")").test(format))
        {
            format = format.replace(RegExp.$1, RegExp.$1.length == 1
                ? o[k]
                : ("00" + o[k]).substr(("" + o[k]).length));
        }
    }
    return format;
}
exports.log = function(req, res){
    console.log("==============================================================");
	console.log("current request time:\t"+getDate());
    // var _ip = req.headers['x-forwarded-for'] ||
    //     req.connection.remoteAddress ||
    //     req.socket.remoteAddress ||
    //     req.connection.socket.remoteAddress;
    var _ip = req.query._ip;
    console.log("request ip address:");
    console.log(_ip);
    console.log("==============================================================");
	res.json({});

};

 
    


