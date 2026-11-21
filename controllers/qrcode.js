// 二维码生成：把当前页面 URL 编成 PNG data URL，供 Wiki/博客分享弹层扫码访问。
// 安全：只接受本站点 http(s) URL，限制长度，杜绝被当开放二维码生成器滥用。
// 依赖 qrcode@1.5.4（Node >=10.13，兼容生产 Node 16）；不引 CDN。
var QRCode = require('qrcode');

var MAX_LEN = 512;

// 只接受绝对 http(s) URL，且 host 必须与请求 host 一致（防止生成任意外链二维码）
function safeUrl(raw, req) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s || s.length > MAX_LEN) return '';
    var parsed;
    try { parsed = new URL(s); } catch (e) { return ''; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    // 允许的 host：请求 host（去掉端口），以及 settings 里配置的站点域名由前端保证传对
    var host = String(req.headers.host || '').split(':')[0].toLowerCase();
    var target = String(parsed.hostname || '').toLowerCase();
    if (host && target !== host && target !== 'localhost' && target !== '127.0.0.1') return '';
    return s;
}

// GET /api/qrcode?text=<当前页URL> —— 公开、只读、限流（路由层挂 rateLimit）
exports.generate = function (req, res) {
    var url = safeUrl(req.query.text, req);
    if (!url) return res.status(400).json({success: false, msg: '无效的链接'});
    QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 240,
        color: {dark: '#1E293B', light: '#FFFFFF'}
    }, function (err, dataUrl) {
        if (err) {
            console.error('[qrcode] ' + err.message);
            return res.status(500).json({success: false, msg: '二维码生成失败'});
        }
        res.json({success: true, url: dataUrl});
    });
};
