// 风控子系统合并导出（SPEC-MODERATION §10.1，对外统一 moderation.xxx）。
// routes 与既有 handler 从此处按需取用；依赖只向下（G04），本文件不反向依赖任何调用方。
exports.matcher = require('./moderationMatcher');
exports.guard = require('./moderationGuard');
exports.dispose = require('./moderationDispose');
exports.sensitiveWordAdmin = require('./sensitiveWordAdmin');
exports.violationAdmin = require('./violationAdmin');
