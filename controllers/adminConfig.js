// 后台管理增强的单一阈值定义点（SPEC §3.2）。
// 纪律：所有阈值只在此定义一次；加载时 parseInt + 范围校验，非法即抛错（启动大声失败，
// 不把配置错误拖到第一次请求才炸 —— runtime-defensive.md「配置错必须大声失败」）。
// 可用同名环境变量覆盖（便于 QA/运维改选 D3/D4/D5，无需改代码）；覆盖值同样走范围校验。

function pickInt(name, def, min, max) {
    var raw = process.env[name];
    var value = (raw === undefined || raw === null || raw === '') ? def : parseInt(raw, 10);
    if (!isFinite(value) || value < min || value > max) {
        throw new Error('[adminConfig] ' + name + ' 非法：期望 ' + min + '..' + max + ' 的整数，实际=' + JSON.stringify(raw));
    }
    return value;
}

exports.BATCH_LIMIT = pickInt('ADMIN_BATCH_LIMIT', 100, 1, 1000);              // 批量单次上限（H03）
exports.IMPORT_MAX_BYTES = pickInt('ADMIN_IMPORT_MAX_BYTES', 2 * 1024 * 1024, 1024, 10 * 1024 * 1024); // 导入 2MB（J04）
exports.IMPORT_MAX_ROWS = pickInt('ADMIN_IMPORT_MAX_ROWS', 1000, 1, 10000);     // 导入行数（J04）
exports.AUDIT_TTL_DAYS = pickInt('ADMIN_AUDIT_TTL_DAYS', 180, 1, 3650);        // 审计保留期（K04）
exports.PAGE_SIZE = pickInt('ADMIN_PAGE_SIZE', 9, 1, 100);                     // 默认页大小（对齐 constants.PER_PAGE_COUNT）
exports.MAX_PAGE_SIZE = pickInt('ADMIN_MAX_PAGE_SIZE', 100, 1, 1000);          // 页大小上限
exports.AUDIT_WRITE_TIMEOUT_MS = pickInt('ADMIN_AUDIT_WRITE_TIMEOUT_MS', 2000, 100, 30000); // 审计写入兜底告警阈值

// 派生不变量：默认页大小不得超过上限，否则 parseListQuery 的 clamp 会静默改写默认值。
if (exports.PAGE_SIZE > exports.MAX_PAGE_SIZE) {
    throw new Error('[adminConfig] PAGE_SIZE 不得大于 MAX_PAGE_SIZE');
}
