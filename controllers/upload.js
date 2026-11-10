// P0 图床上传：接收 base64 图片，落盘到 public/uploads，返回可访问 URL。
// 不引入新依赖（用内置 fs/crypto）；若需对象存储/CDN，替换 saveToStorage 即可。
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var extMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp'
};
var MAX_BYTES = 5 * 1024 * 1024; // 5MB

exports.upload = function (req, res) {
    var data = req.body && req.body.data;
    if (typeof data !== 'string' || data.indexOf('base64,') < 0) {
        return res.status(400).json({success: false, msg: '无效的文件数据'});
    }
    var mimeMatch = data.match(/data:([^;]+);base64,/);
    var mimeType = mimeMatch ? mimeMatch[1] : '';
    var ext = extMap[mimeType];
    if (!ext) {
        return res.status(400).json({success: false, msg: '不支持的图片类型：' + mimeType});
    }
    var buf = Buffer.from(data.split('base64,')[1], 'base64');
    if (buf.length > MAX_BYTES) {
        return res.status(413).json({success: false, msg: '图片过大（上限 5MB）'});
    }
    var dir = path.join(__dirname, '../public/uploads');
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
    } catch (e) {
        return res.status(500).json({success: false, msg: '目录创建失败'});
    }
    var fname = crypto.randomUUID() + ext;
    fs.writeFile(path.join(dir, fname), buf, function (err) {
        if (err) return res.status(500).json({success: false, msg: '保存失败'});
        res.json({success: true, url: '/uploads/' + fname});
    });
};
