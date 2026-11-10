var constants = require('./../models/constants');

// 转义正则特殊字符，防止把用户输入当作正则（正则注入 / ReDoS）
exports.escapeRegExp = function (str) {
    if (!str) return '';
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

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

// 兼容旧模板的日期格式化（替代 EJS 旧版 `<%=: x | format %>` 过滤器）。
// 支持 moment 风格的 YYYY/MM/DD/HH/mm/ss 标记（本质上复用 Date.prototype.format，仅将 YYYY 映射为 yyyy）。
exports.format = function (value, pattern) {
    var d;
    if (value instanceof Date) {
        d = value;
    } else if (value === undefined || value === null || value === '') {
        d = new Date();
    } else {
        d = new Date(value);
    }
    if (!(d instanceof Date) || isNaN(d.getTime())) {
        d = new Date();
    }
    var p = pattern || 'YYYY-MM-DD HH:mm:ss';
    p = p.replace(/YYYY/g, 'yyyy').replace(/YY/g, 'yy').replace(/DD/g, 'dd');
    return d.format(p);
};
