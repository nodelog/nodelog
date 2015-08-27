function getBrowserInfo() {
    var agent = navigator.userAgent.toLowerCase();
    var regStr_ie = /msie [\d.]+;/gi;
    var regStr_ff = /firefox\/[\d.]+/gi
    var regStr_chrome = /chrome\/[\d.]+/gi;
    var regStr_saf = /safari\/[\d.]+/gi;
    var regStr_360 = /360\/[\d.]+/gi;
//IE
    if (agent.indexOf("msie") > 0) {
        return agent.match(regStr_ie);
    }

//firefox
    if (agent.indexOf("firefox") > 0) {
        return agent.match(regStr_ff);
    }
    //360
    if (agent.indexOf("360") > 0 && agent.indexOf("chrome") > 0) {
        return agent.match(regStr_saf);
    }

//Chrome
    if (agent.indexOf("chrome") > 0) {
        return agent.match(regStr_chrome);
    }

//Safari
    if (agent.indexOf("safari") > 0 && agent.indexOf("chrome") < 0) {
        return agent.match(regStr_saf);
    }
}
document.getElementById("browser").innerHTML = "您的浏览器名称为："+getBrowserInfo();

var NV = {};
var UA = navigator.userAgent.toLowerCase();
try
{
    NV.name=!-[1,]?'ie':
        (UA.indexOf("firefox")>0)?'firefox':
            (UA.indexOf("chrome")>0)?'chrome':
                window.opera?'opera':
                    window.openDatabase?'safari':
                        'unkonw';
}catch(e){};
try
{
    NV.version=(NV.name=='ie')?UA.match(/msie ([\d.]+)/)[1]:
        (NV.name=='firefox')?UA.match(/firefox\/([\d.]+)/)[1]:
            (NV.name=='chrome')?UA.match(/chrome\/([\d.]+)/)[1]:
                (NV.name=='opera')?UA.match(/opera.([\d.]+)/)[1]:
                    (NV.name=='safari')?UA.match(/version\/([\d.]+)/)[1]:
                        '0';
}catch(e){};
try
{
    NV.shell=(UA.indexOf('360ee')>-1)?'360极速浏览器':
        (UA.indexOf('360se')>-1)?'360安全浏览器':
            (UA.indexOf('se')>-1)?'搜狗浏览器':
                (UA.indexOf('aoyou')>-1)?'遨游浏览器':
                    (UA.indexOf('theworld')>-1)?'世界之窗浏览器':
                        (UA.indexOf('worldchrome')>-1)?'世界之窗极速浏览器':
                            (UA.indexOf('greenbrowser')>-1)?'绿色浏览器':
                                (UA.indexOf('qqbrowser')>-1)?'QQ浏览器':
                                    (UA.indexOf('baidu')>-1)?'百度浏览器':
                                        '未知或无壳';
}catch(e){};
alert('浏览器UA='+UA+
    '\n\n浏览器名称='+NV.name+
    '\n\n浏览器版本='+parseInt(NV.version)+
    '\n\n浏览器外壳='+NV.shell);

