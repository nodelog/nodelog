// P0 轻量级限流：基于内存的固定窗口计数（无需额外依赖）。
// 注意：进程内计数，重启即清空；多实例部署应改用 Redis。仅作基础防刷。
var store = {};

// 定时清理过期计数，避免内存无限增长
setInterval(function () {
    var now = Date.now();
    Object.keys(store).forEach(function (k) {
        if (store[k].resetAt <= now) delete store[k];
    });
}, 5 * 60 * 1000);

// opts: { max: 次数, windowMs: 窗口毫秒, key: 维度后缀, keyFunction?: (req)=>string }
// SPEC-MODERATION §7.1：keyFunction 可选；不传的既有调用点逐字节同行为（仍按 req.ip）。
exports.limit = function (opts) {
    opts = opts || {};
    var max = opts.max || 10;
    var windowMs = opts.windowMs || 60 * 1000;
    return function (req, res, next) {
        var keyBase = (typeof opts.keyFunction === 'function')
            ? String(opts.keyFunction(req) || 'anonymous') : (req.ip || 'unknown');
        var key = keyBase + ':' + (opts.key || req.path);
        var now = Date.now();
        var rec = store[key];
        if (!rec || now > rec.resetAt) {
            rec = store[key] = {count: 0, resetAt: now + windowMs};
        }
        rec.count++;
        if (rec.count > max) {
            return res.status(429).json({success: false, msg: '操作过于频繁，请稍后再试'});
        }
        next();
    };
};
