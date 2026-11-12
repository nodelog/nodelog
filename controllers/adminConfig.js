// 后台管理增强 + 内容风控的单一阈值定义点（SPEC §3.2 / SPEC-MODERATION §7.3）。
// 纪律：所有阈值只在此定义一次；加载时校验 + 范围约束，非法即抛错（启动大声失败，
// 不把配置错误拖到第一次请求才炸 —— runtime-defensive.md「配置错必须大声失败」）。
// 可用同名环境变量覆盖（便于 QA/运维改选，无需改代码）；覆盖值同样走校验。
function pickInt(name, def, min, max) {
    var raw = process.env[name];
    var value = (raw === undefined || raw === null || raw === '') ? def : parseInt(raw, 10);
    if (!isFinite(value) || value < min || value > max) {
        throw new Error('[adminConfig] ' + name + ' 非法：期望 ' + min + '..' + max + ' 的整数，实际=' + JSON.stringify(raw));
    }
    return value;
}
function pickEnum(name, def, allowed) {
    var raw = process.env[name];
    var v = (raw == null || raw === '') ? def : String(raw).trim();
    if (allowed.indexOf(v) === -1) throw new Error('[adminConfig] ' + name + ' 非法：期望 ' + allowed.join('|') + '，实际=' + JSON.stringify(raw));
    return v;
}

exports.BATCH_LIMIT = pickInt('ADMIN_BATCH_LIMIT', 100, 1, 1000);
exports.IMPORT_MAX_BYTES = pickInt('ADMIN_IMPORT_MAX_BYTES', 2 * 1024 * 1024, 1024, 10 * 1024 * 1024);
exports.IMPORT_MAX_ROWS = pickInt('ADMIN_IMPORT_MAX_ROWS', 1000, 1, 10000);
exports.AUDIT_TTL_DAYS = pickInt('ADMIN_AUDIT_TTL_DAYS', 180, 1, 3650);
exports.PAGE_SIZE = pickInt('ADMIN_PAGE_SIZE', 9, 1, 100);
exports.MAX_PAGE_SIZE = pickInt('ADMIN_MAX_PAGE_SIZE', 100, 1, 1000);
exports.AUDIT_WRITE_TIMEOUT_MS = pickInt('ADMIN_AUDIT_WRITE_TIMEOUT_MS', 2000, 100, 30000);

// 风控增量九个单点开关（SPEC-MODERATION §7.3 / §10.5）
exports.MODERATION_CONTENT_MAX = pickInt('MODERATION_CONTENT_MAX', 3, 1, 100);
exports.MODERATION_CONTENT_WINDOW_MS = pickInt('MODERATION_CONTENT_WINDOW_MS', 60000, 1000, 3600000);
exports.MODERATION_MUTE_DAYS = pickInt('MODERATION_MUTE_DAYS', 7, 1, 365);
exports.MODERATION_TTL_DAYS = pickInt('MODERATION_TTL_DAYS', 180, 1, 3650);
exports.MODERATION_CHUNK_CHARS = pickInt('MODERATION_CHUNK_CHARS', 60000, 1000, 200000);
exports.MODERATION_CHUNK_OVERLAP = pickInt('MODERATION_CHUNK_OVERLAP', 2000, 128, 10000);
exports.MODERATION_MAX_WORD_CHARS = pickInt('MODERATION_MAX_WORD_CHARS', 64, 1, 256);
exports.MODERATION_WORD_BOUNDARY = pickEnum('MODERATION_WORD_BOUNDARY', 'false', ['true', 'false']) === 'true';
exports.MODERATION_FAIL_MODE = pickEnum('MODERATION_FAIL_MODE', 'open', ['open', 'closed']);

// 派生不变量（配置错启动即炸）：默认页大小不超上限；分块重叠必须 > 最长词，否则切断词漏检。
if (exports.PAGE_SIZE > exports.MAX_PAGE_SIZE) throw new Error('[adminConfig] PAGE_SIZE 不得大于 MAX_PAGE_SIZE');
if (exports.MODERATION_CHUNK_OVERLAP <= exports.MODERATION_MAX_WORD_CHARS) {
    throw new Error('[adminConfig] MODERATION_CHUNK_OVERLAP 必须大于 MODERATION_MAX_WORD_CHARS（否则分块切断词导致漏检）');
}
