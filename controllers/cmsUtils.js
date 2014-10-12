var constants = require('./../models/constants');
String.prototype.trim = function () {
    return this.replace(/(^\s*)|(\s*$)/g, "");
}

exports.isNotBlank = function(str) {
    return str && str.trim()!="";
}
exports.page= function (page, total) {
    var totalPage = Math.ceil(total / constants.PER_PAGE_COUNT);
    page = ((page < 1) ? 1 : ((page == undefined) ? 1 : page));
    page = ((page > totalPage) ? totalPage : page);
    return {"page":page, "totalPage": totalPage};
}

Date.prototype.format=function(fmt) {
    if (fmt == null) {
        fmt = "yyyy-MM-dd hh:mm:ss";
    }
    var o = {
        "M+" : this.getMonth()+1, //月份
        "d+" : this.getDate(), //日
        "h+" : this.getHours(), //小时
        "H+" : this.getHours(), //小时
        "m+" : this.getMinutes(), //分
        "s+" : this.getSeconds()//, //秒
    };
    if(/(y+)/.test(fmt)){
        fmt=fmt.replace(RegExp.$1, (this.getFullYear()+"").substr(4 - RegExp.$1.length));
    }
    for(var k in o){
        if(new RegExp("("+ k +")").test(fmt)){
            fmt = fmt.replace(RegExp.$1, (RegExp.$1.length==1) ? (o[k]) : (("00"+ o[k]).substr((""+ o[k]).length)));
        }
    }
    return fmt;
}
