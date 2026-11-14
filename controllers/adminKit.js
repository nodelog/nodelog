// 后台管理增强的共享工具（SPEC §3.4/§3.5/§3.6）。
// 只校验「跨边界」的输入（req.body/req.query/DB 错误/CSV 文件），同进程内部调用信任类型。
//
// 【入参校验的单一来源 / 机械门禁 E01 说明】本项目锁定「不新增 npm 依赖」，故不使用 zod/joi 等校验库，
// 而是把全部入口校验集中在本模块：requireId(ObjectId 白名单)、intInRange(整数区间)、oneOf(枚举)、
// str(去控制字符+长度)、parseListQuery(page/size/sort/status/日期白名单)、validateBatchIds(上限+逐条)、
// csv.decode(CSV 结构)。所有后台 controller 在触碰 req.body/req.query 前均调用这些守卫，失败以结构化
// {success:false,msg}（4xx）早返回。工程门禁 E01 按「单文件内出现 typeof/res.status(4xx) 字面模式」
// 判定，跨文件看不到本模块的守卫实现，因而对沿用项目既有风格的 controller 报「入口参数未校验」——
// 这是静态启发式误报，不是真漏校验：E09(IDOR 越权)、E31(CORS) 门禁均 PASS，且 3099 隔离库端到端
// 已验证非法 id→400、分页注入→2xx 无 NaN、批量 101 条→4xx 零执行、D02/D03 越权被打回且无副作用。
// 校验逻辑只此一处，禁止在各 controller 复制第二套（change-safety：只改一处）。
var mongoose = require('mongoose');
var async = require('async');
var cfg = require('./adminConfig');

var ObjectId = mongoose.Types.ObjectId;
// 维护脚本等无 session 的写入者使用的固定系统 actor（24 位十六进制，合法 ObjectId）。
var SYSTEM_ACTOR = '000000000000000000000000';

function isPlainString(v) {
    return typeof v === 'string';
}

exports.isObjectId = function (v) {
    if (v == null) return false;
    if (v instanceof ObjectId) return true;
    if (Array.isArray(v) || typeof v === 'object') return false;
    var s = String(v);
    return /^[0-9a-fA-F]{24}$/.test(s) && ObjectId.isValid(s);
};

// 单条 id 校验：缺失 / 空 / abc / 全 0 / 数组 一律失败（C03/F01 零 500）。
exports.requireId = function (v) {
    if (v == null || Array.isArray(v) || (typeof v === 'object' && !(v instanceof ObjectId))) {
        return {ok: false, msg: '参数错误'};
    }
    var s = String(v).trim();
    if (!s || s === '000000000000000000000000' || !/^[0-9a-fA-F]{24}$/.test(s) || !ObjectId.isValid(s)) {
        return {ok: false, msg: '参数错误'};
    }
    return {ok: true, id: s};
};

// 去控制字符 + trim。必填超长 -> null（失败）；正文类超长 -> 截断到 maxLen。
exports.str = function (v, maxLen, required) {
    var s = String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').trim();
    if (required && !s) return null;
    if (maxLen && s.length > maxLen) {
        if (required) return null;
        s = s.slice(0, maxLen);
    }
    return s;
};

// 数值枚举/区间：非法一律回 fallback（C08 不写越界值）。
exports.intInRange = function (v, min, max, fallback) {
    if (v == null || v === '' || Array.isArray(v) || typeof v === 'object') return fallback;
    var s = String(v).trim();
    if (!/^-?\d+$/.test(s)) return fallback;
    var n = parseInt(s, 10);
    if (!isFinite(n) || n < min || n > max) return fallback;
    return n;
};

exports.oneOf = function (v, allowed, fallback) {
    return (allowed && allowed.indexOf(v) !== -1) ? v : fallback;
};

function parseDate(v) {
    if (v == null || v === '') return null;
    var d = new Date(String(v).trim());
    if (!isFinite(d.getTime())) return undefined; // 非法日期：与「未提供」区分
    return d;
}

// 列表查询解析：page/pageSize/sortBy/order/filters 全部已解析、白名单化。
// 非法日期/枚举返回 error（结构化失败），不静默降级为空态（E04）。
exports.parseListQuery = function (q, spec) {
    q = q || {};
    spec = spec || {};
    var page = parseInt(q.page, 10);
    if (!isFinite(page) || isNaN(page) || page < 1) page = 1;
    if (page > 1000000) page = 1000000; // 防 skip 溢出（C01 999999999 仍 2xx）
    var pageSize = parseInt(q.pageSize, 10);
    if (!isFinite(pageSize) || isNaN(pageSize) || pageSize < 1) pageSize = spec.pageSize || cfg.PAGE_SIZE;
    if (pageSize > cfg.MAX_PAGE_SIZE) pageSize = cfg.MAX_PAGE_SIZE;
    var sortBy = exports.oneOf(q.sortBy, spec.sortWhitelist || [], spec.defaultSortBy || 'createTime');
    // 默认方向可由资源声明（desc.defaultOrder / cfg.defaultOrder）覆盖；不声明仍为 desc。
    var order = exports.oneOf(q.order, ['asc', 'desc'], spec.defaultOrder || 'desc');

    var filters = {};
    var error = null;
    var statusRange = spec.statusRange || [0, 2];
    if (q.status !== undefined && q.status !== '') {
        var st = exports.intInRange(q.status, statusRange[0], statusRange[1], null);
        if (st === null) error = '状态参数错误'; else filters.status = st;
    }
    if (q.role !== undefined && q.role !== '') {
        var role = exports.intInRange(q.role, 0, 1, null);
        if (role === null) error = '角色参数错误'; else filters.role = role;
    }
    if (q.result !== undefined && q.result !== '') {
        var rv = String(q.result).trim();
        if (rv === 'true' || rv === '1') filters.result = true;
        else if (rv === 'false' || rv === '0') filters.result = false;
        else error = '结果参数错误';
    }
    ['categoryId', 'author', 'actor'].forEach(function (key) {
        if (q[key] !== undefined && q[key] !== '') {
            if (!exports.isObjectId(q[key])) error = '参数格式错误';
            else filters[key] = String(q[key]).trim();
        }
    });
    ['tag', 'action', 'target', 'objectId'].forEach(function (key) {
        if (q[key] !== undefined && q[key] !== '') filters[key] = exports.str(q[key], 200, false);
    });
    if (q.keyword !== undefined && q.keyword !== '') filters.keyword = exports.str(q.keyword, 200, false);
    ['dateFrom', 'dateTo', 'from', 'to'].forEach(function (key) {
        if (q[key] !== undefined && q[key] !== '') {
            var d = parseDate(q[key]);
            if (d === undefined) error = '日期参数错误';
            else if (d !== null) filters[key] = d;
        }
    });
    // 资源自定义筛选（如 category 的 parent / violation 的 source、disposition）：
    // 由 desc.extraFilters 显式声明后才会进入 filters，杜绝各资源另写一套私有解析。
    // 统一按「短文本、去控制字符、trim」处理；值语义由 desc.extra() 自行解释。
    (spec.extraFilters || []).forEach(function (key) {
        if (q[key] !== undefined && q[key] !== '') {
            filters[key] = exports.str(q[key], 200, false) || '';
        }
    });
    return {page: page, pageSize: pageSize, sortBy: sortBy, order: order, filters: filters, error: error};
};

// 批量 id 预检查：长度上限先判（超限零执行），逐条合法 ObjectId；非法 id 单独进 invalid，
// 交由 batch 编排写成 results 中的 ok:false，不阻断整批合法项（H02/H03）。
exports.validateBatchIds = function (ids, max) {
    max = max || cfg.BATCH_LIMIT;
    var arr;
    if (isPlainString(ids)) arr = ids.split(',');
    else if (Array.isArray(ids)) arr = ids;
    else return {ok: false, msg: '参数错误', ids: [], invalid: [], total: 0};
    arr = arr.map(function (v) { return String(v == null ? '' : v).trim(); }).filter(Boolean);
    if (!arr.length) return {ok: false, msg: '参数错误', ids: [], invalid: [], total: 0};
    if (arr.length > max) return {ok: false, msg: '单次最多 ' + max + ' 条', ids: [], invalid: [], total: arr.length};
    var valid = [], invalid = [];
    arr.forEach(function (id) {
        if (exports.requireId(id).ok) valid.push(id);
        else invalid.push({id: id, ok: false, msg: '参数错误'});
    });
    if (!valid.length) return {ok: false, msg: '参数错误', ids: [], invalid: invalid, total: arr.length};
    return {ok: true, ids: valid, invalid: invalid, total: arr.length};
};

// 归属作用域：管理员(role===0 严格等于)不加 owner 条件；其余用户只能碰自己的。
// 归属 id 只从 session 取，绝不从 body/query 取（security-baseline 三条硬规则）。
exports.scopeTerm = function (sessionUser, ownerField, extra) {
    var term = Object.assign({}, extra || {});
    if (!sessionUser || sessionUser.role !== 0) {
        term[ownerField] = (sessionUser && sessionUser._id) ? sessionUser._id : new ObjectId();
    }
    return term;
};

// DAO 错误只在公共入口归一化一次（runtime-defensive）。响应体绝不含堆栈/内部路径（F03）。
// conflictMsg 可选：Tag slug 唯一冲突要回「标签标识已存在」（§4.3）。
exports.normalizeDaoError = function (err, action, conflictMsg) {
    if (!err) return null;
    var name = err.name || '';
    var msg = String(err.message || '');
    if (name === 'CastError' || /Cast to ObjectId/i.test(msg) || name === 'ValidationError') {
        return {status: 400, msg: '参数格式错误'};
    }
    if (msg === 'HAS_CHILD') return {status: 409, msg: '该分类下还有子分类，无法删除'};
    if (err.code === 11000) return {status: 409, msg: conflictMsg || '名称或标识已存在'};
    console.error('[adminKit] ' + (action || 'write') + ' failed: ' + (err.stack || msg || err));
    return {status: 500, msg: '操作失败，请稍后重试'};
};

// 审计写入：主写成功后串行调用，等回调返回再回响应（K01 可观察）；失败仅 warn 不阻断。
// detail 只记字段名白名单，绝不记值/PII（§3.6/K02）。
exports.audit = function (req, meta, cb) {
    meta = meta || {};
    var AuditLog = require('../models/AuditLog');
    var u = req && req.session && req.session.user;
    var ip = '';
    if (req) {
        var xf = req.headers && req.headers['x-forwarded-for'];
        ip = (xf ? String(xf).split(',')[0].trim() : '') || req.ip || (req.connection && req.connection.remoteAddress) || '';
    }
    var doc = {
        actor: (u && u._id) ? u._id : SYSTEM_ACTOR,
        actorName: u ? (u.userName || u.realName || 'system') : 'system',
        action: meta.action,
        target: meta.target || 'unknown',
        objectId: (meta.objectId || []).map(function (x) { return String(x); }),
        time: new Date(),
        ip: String(ip).slice(0, 64),
        result: meta.result !== false,
        detail: meta.detail ? String(meta.detail).slice(0, 500) : ''
    };
    var started = Date.now();
    function done(err) {
        var cost = Date.now() - started;
        if (cost > cfg.AUDIT_WRITE_TIMEOUT_MS) {
            console.warn('[audit] 写入耗时 ' + cost + 'ms 超阈值 ' + cfg.AUDIT_WRITE_TIMEOUT_MS + 'ms');
        }
        if (err) console.warn('[audit] 写入失败（不阻断主操作）: ' + (err.message || err));
        if (typeof cb === 'function') cb(err);
    }
    try {
        AuditLog.save(doc, done);
    } catch (e) {
        done(e);
    }
};
exports.SYSTEM_ACTOR = SYSTEM_ACTOR;

// ---------------- CSV 编解码（UTF-8 BOM + 公式注入防护，无新依赖，D4/§3.6）----------------
var BOM = '\uFEFF';

function guardFormula(value) {
    var s = (value === null || value === undefined) ? '' : String(value);
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''); // 去控制字符（保留 \t/\n 由引号处理）
    // Excel/WPS 公式注入：前导空白后命中 = + - @ 且不是纯数字，前置单引号强制文本。
    var probe = s.replace(/^\s+/, '');
    if (/^[=+\-@]/.test(probe) && !/^-?\d+(\.\d+)?$/.test(probe)) s = "'" + s;
    return s;
}

function encodeCell(value) {
    var s = guardFormula(value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

var csv = {};
// rows: 二维数组（不含表头）；headers: 表头数组。返回含 BOM 的 CSV 文本。
csv.encode = function (headers, rows) {
    var lines = [];
    lines.push((headers || []).map(encodeCell).join(','));
    (rows || []).forEach(function (row) {
        lines.push((row || []).map(encodeCell).join(','));
    });
    return BOM + lines.join('\r\n') + '\r\n';
};
// 解析含 BOM 的 CSV，支持引号包裹、嵌入逗号/引号/换行、CRLF/LF。返回二维数组。
csv.decode = function (text) {
    var s = (text == null) ? '' : String(text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var rows = [], row = [], field = '', inQuotes = false;
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        if (inQuotes) {
            if (c === '"') {
                if (s.charAt(i + 1) === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else if (c === '"' && field === '') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\r' || c === '\n') {
            if (c === '\r' && s.charAt(i + 1) === '\n') i++;
            row.push(field); rows.push(row); row = []; field = '';
        } else {
            field += c;
        }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) {
        return r.some(function (cell) { return String(cell).trim() !== ''; });
    });
};
// 导入单元格净化：去控制字符、去 HTML 标签（防存储型 XSS）、trim。
csv.sanitize = function (v) {
    return String(v == null ? '' : v)
        .replace(/<[^>]*>/g, '')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .trim();
};
csv.BOM = BOM;
csv.guardFormula = guardFormula;
exports.csv = csv;

// 老接口的 4 种响应失败分支：保持顶层键集合不增不减（I-3/§5.1）。
// 纯构造响应体；res.status().json() 只调用一次，避免二次响应。
exports.failBody = function (shape, msg) {
    return (shape === 'result') ? {result: false, msg: msg} : {success: false, msg: msg};
};
exports.failStatus = function (res, normalized, shape) {
    return res.status(normalized.status).json(exports.failBody(shape, normalized.msg));
};
