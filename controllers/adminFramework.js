// NODELOG 后台管理框架 · 门面 / 契约层（唯一入口）
// ---------------------------------------------------------------------------
// 定位：本文件【不重写】任何业务能力，只把已经存在、但散落在 7 个文件里的
// 后台能力收口成「一处声明、四处生效」的声明式配置，并做启动期校验。
//   adminConfig(阈值) → adminKit(纯函数) → adminCrud/adminIo(编排) → _adminDao(DAO)
//   → navConfig(菜单) / adminToolbar+adminPager+state(视图) / common.js(交互)
// 依赖：零新增。仅顶层加载纯常量 adminConfig；其余下层用惰性 getter 暴露，
//      保证本模块可离线 require（验证脚本无需 MongoDB）。
// 纪律：非法声明立即抛错（配置错必须大声失败），不把错误拖到第一次请求。

var cfg = require('./adminConfig');   // 纯常量，加载不连库

var PREFIX = '[adminFramework]';
function fail(msg) { return new Error(PREFIX + ' ' + msg); }

/* ============ 1. 明确的配置项与合理默认值（唯一事实来源） ============ */
// 阈值类直接引用 adminConfig，避免产生第二真源；行为类在此给出默认值。
var DEFAULTS = {
    pageSize:       cfg.PAGE_SIZE,            // 9   列表每页条数
    maxPageSize:    cfg.MAX_PAGE_SIZE,        // 100 页大小上限
    batchLimit:     cfg.BATCH_LIMIT,          // 100 批量操作单次上限
    importMaxBytes: cfg.IMPORT_MAX_BYTES,     // 2MB CSV 导入体积上限
    importMaxRows:  cfg.IMPORT_MAX_ROWS,      // 1000 CSV 导入行数上限
    sortBy:         'createTime',             // 默认排序字段
    order:          'desc',                   // 默认排序方向
    statusRange:    [0, 2],                   // 默认状态取值区间
    sortWhitelist:  ['createTime'],           // 默认排序白名单
    searchFields:   ['name'],                 // 默认关键词检索字段
    soft:           {status: 0},              // 默认「列表可见性」条件（软删值为 1）
    softStatus:     1,                        // 默认软删写入值
    roles:          'admin',                  // 安全默认：后台资源仅管理员
    shape:          'success',                // 统一响应契约 {success, msg}
    pageSuffix:     '/admin'                  // SSR 列表页相对 base 的路径
};

// 表单字段类型：与 public/js/common.js 的 openForm 一一对应（新增类型须同步两处）。
var FIELD_KINDS = ['text', 'textarea', 'select', 'number', 'date', 'password'];
// 标准能力 = 标准路由动作；资源可显式裁剪（如只读资源只保留 page/list/detail）。
var CAPABILITIES = ['page', 'list', 'detail', 'add', 'modify', 'delete',
    'status', 'batch', 'import', 'export'];
var ROLES = {ADMIN: 0, USER: 1};
var KEY_RE = /^[a-z][a-zA-Z0-9]*$/;

/* ============ 2. 表单字段描述符：校验 + 归一化 ============ */
// fields[] = {n:字段名, t:显示名, k:类型, o:[{v,t,p}], req:必填, max:长度, d:默认值}
function normalizeFields(fields, where) {
    if (fields == null) return [];
    if (!Array.isArray(fields)) throw fail(where + '.fields 必须是数组');
    var seen = {};
    return fields.map(function (f, i) {
        var at = where + '.fields[' + i + ']';
        if (!f || typeof f !== 'object' || Array.isArray(f)) throw fail(at + ' 必须是对象');
        if (!f.n || !KEY_RE.test(f.n)) throw fail(at + '.n 缺失或非法（需小驼峰标识符）：' + f.n);
        if (seen[f.n]) throw fail(at + '.n 重复：' + f.n);
        seen[f.n] = true;
        if (!f.t || typeof f.t !== 'string') throw fail(at + '.t 显示名不能为空');
        var k = f.k || 'text';
        if (FIELD_KINDS.indexOf(k) === -1) {
            throw fail(at + '.k 非法：' + k + '（允许 ' + FIELD_KINDS.join('/') + '）');
        }
        var out = {n: f.n, t: f.t, k: k, req: !!f.req,
            max: parseInt(f.max, 10) > 0 ? parseInt(f.max, 10) : 0,
            d: f.d == null ? '' : String(f.d)};
        if (k === 'select') {
            if (!Array.isArray(f.o) || !f.o.length) throw fail(at + '.o 必须是非空数组');
            out.o = f.o.map(function (o, j) {
                if (!o || o.v == null || o.t == null) throw fail(at + '.o[' + j + '] 需含 v/t');
                var item = {v: String(o.v), t: String(o.t)};
                if (o.p != null) item.p = String(o.p);   // 父级 id，供编辑态防环
                return item;
            });
        }
        return out;
    });
}

/* ============ 3. 资源描述符：一处声明，菜单/列表/表单/权限/路由共用 ============ */
/**
 * @param {Object} spec
 *   key       {String} 必填，资源标识（小驼峰，同时作为 navConfig 的 currentMenu / 审计 target）
 *   label     {String} 必填，中文名（菜单、页面标题、按钮）
 *   model     {Object} 必填，Mongoose Model 或已 attach(_adminDao) 的 DAO
 *   base      {String} 必填，API 基路径，须以 /manager/ 开头且无尾斜杠
 *   desc      {Object} 可选，buildWhere 描述符：soft/search/dateField/owner/extraFilters/extra
 *   list      {Object} 可选，列表配置：sortWhitelist/sortBy/order/statusRange/pageSize/view/title
 *   fields    {Array}  可选，新增/编辑表单字段描述符
 *   columns   {Array}  可选，列表列名（文档与自检用）
 *   capabilities {Array} 可选，默认全部 10 项
 *   roles     {String} 可选，'admin'(默认) | 'all'（仅控制菜单可见性与推荐鉴权链）
 *   pagePath  {String} 可选，SSR 列表页路径，默认 base + '/admin'
 * @return {Object} 归一化描述符（纯数据，无副作用）
 */
function defineResource(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw fail('资源声明必须是对象');
    var key = String(spec.key == null ? '' : spec.key).trim();
    if (!KEY_RE.test(key)) throw fail('key 非法（需小驼峰，如 sensitiveWord）：' + key);
    if (!spec.label || typeof spec.label !== 'string') throw fail(key + '.label 不能为空');
    if (!spec.model) throw fail(key + '.model 必需');
    var base = String(spec.base == null ? '' : spec.base).trim();
    if (base.indexOf('/manager/') !== 0 || /\/$/.test(base)) {
        throw fail(key + '.base 必须以 /manager/ 开头且不以 / 结尾：' + base);
    }

    var d = spec.desc || {};
    var extraFilters = d.extraFilters || [];
    if (!Array.isArray(extraFilters) || extraFilters.some(function (k) { return !KEY_RE.test(k); })) {
        throw fail(key + '.desc.extraFilters 必须是合法字段名数组');
    }
    var desc = {
        soft: d.soft == null ? Object.assign({}, DEFAULTS.soft) : d.soft,
        search: d.search || DEFAULTS.searchFields.slice(),
        dateField: d.dateField || 'createTime',
        extraFilters: extraFilters.slice()
    };
    if (d.owner) desc.owner = d.owner;
    if (d.extra) {
        if (typeof d.extra !== 'function') throw fail(key + '.desc.extra 必须是函数');
        desc.extra = d.extra;
    }

    var l = spec.list || {};
    var list = {
        sortWhitelist: l.sortWhitelist || DEFAULTS.sortWhitelist.slice(),
        sortBy: l.sortBy || DEFAULTS.sortBy,
        order: DEFAULTS.order,
        statusRange: l.statusRange || DEFAULTS.statusRange.slice(),
        pageSize: l.pageSize || DEFAULTS.pageSize,
        view: l.view || ('manager/' + key),
        title: l.title || (spec.label + '管理')
    };
    if (l.order === 'asc' || l.order === 'desc') list.order = l.order;
    if (!Array.isArray(list.sortWhitelist) || list.sortWhitelist.indexOf(list.sortBy) === -1) {
        throw fail(key + '.list.sortBy 必须包含在 sortWhitelist 内：' + list.sortBy);
    }
    if (list.pageSize < 1 || list.pageSize > DEFAULTS.maxPageSize) {
        throw fail(key + '.list.pageSize 超出 1..' + DEFAULTS.maxPageSize);
    }

    var caps = spec.capabilities == null ? CAPABILITIES.slice() : spec.capabilities;
    if (!Array.isArray(caps) || caps.some(function (c) { return CAPABILITIES.indexOf(c) === -1; })) {
        throw fail(key + '.capabilities 含未知动作（允许 ' + CAPABILITIES.join('/') + '）');
    }

    var roles = spec.roles || DEFAULTS.roles;
    if (['admin', 'all'].indexOf(roles) === -1) throw fail(key + ".roles 只能是 'admin' 或 'all'");
    var pagePath = spec.pagePath || (base + DEFAULTS.pageSuffix);

    return {
        __isResource: true,
        key: key, label: spec.label, model: spec.model, base: base,
        pagePath: pagePath, currentMenu: key, roles: roles,
        shape: DEFAULTS.shape, softStatus: DEFAULTS.softStatus,
        desc: desc, list: list,
        fields: normalizeFields(spec.fields, key),
        columns: Array.isArray(spec.columns) ? spec.columns.slice() : [],
        capabilities: caps.slice()
    };
}

/* ============ 4. 标准路由表（纯数据，供接入与自检；不自动挂载，零副作用） ============ */
var ROUTE_SPEC = [
    {cap: 'page',    method: 'get',  action: 'page',    suffix: null,      handler: 'adminPage',  scope: 'page'},
    {cap: 'list',    method: 'get',  action: 'list',    suffix: '/list',   handler: 'adminList',  scope: 'api'},
    {cap: 'detail',  method: 'get',  action: 'detail',  suffix: '/detail', handler: 'detail',     scope: 'api'},
    {cap: 'add',     method: 'post', action: 'add',     suffix: '/add',    handler: 'add',        scope: 'api'},
    {cap: 'modify',  method: 'post', action: 'modify',  suffix: '/modify', handler: 'update',     scope: 'api'},
    {cap: 'delete',  method: 'post', action: 'delete',  suffix: '/delete', handler: 'delete',     scope: 'api'},
    {cap: 'status',  method: 'post', action: 'status',  suffix: '/status', handler: 'status',     scope: 'api'},
    {cap: 'batch',   method: 'post', action: 'batch',   suffix: '/batch',  handler: 'batch',      scope: 'api'},
    {cap: 'import',  method: 'post', action: 'import',  suffix: '/import', handler: 'import',     scope: 'api'},
    {cap: 'export',  method: 'get',  action: 'export',  suffix: '/export', handler: 'export',     scope: 'api'}
];
function routesFor(res) {
    var r = res && res.__isResource ? res : defineResource(res);
    var guard = r.roles === 'admin' ? 'admin' : 'login';
    var seen = {};
    var out = [];
    ROUTE_SPEC.forEach(function (s) {
        if (r.capabilities.indexOf(s.cap) === -1) return;
        var path = s.scope === 'page' ? r.pagePath : (r.base + s.suffix);
        var id = s.method.toUpperCase() + ' ' + path;
        if (seen[id]) throw fail(r.key + ' 路由冲突：' + id);
        seen[id] = true;
        out.push({method: s.method, path: path, action: s.action,
            handler: s.handler, guard: guard});
    });
    return out;
}

/* ============ 5. 菜单项：与 navConfig 契约一致 ============ */
function navItem(res) {
    var r = res && res.__isResource ? res : defineResource(res);
    return {key: r.key, label: r.label, href: r.pagePath, roles: r.roles};
}

/* ============ 6. 下层统一出口（惰性加载：离线 require 不触发 mongoose 连接） ============ */
function lazy(name, path) {
    Object.defineProperty(module.exports, name, {
        enumerable: true,
        get: function () { return require(path); }
    });
}
lazy('config', './adminConfig');
lazy('kit', './adminKit');
lazy('crud', './adminCrud');
lazy('io', './adminIo');
lazy('dao', './../models/_adminDao');
lazy('nav', './../navConfig');

/* ============ 7. 导出 ============ */
module.exports.DEFAULTS = DEFAULTS;
module.exports.FIELD_KINDS = FIELD_KINDS;
module.exports.CAPABILITIES = CAPABILITIES;
module.exports.ROLES = ROLES;
module.exports.ROUTE_SPEC = ROUTE_SPEC;
module.exports.defineResource = defineResource;
module.exports.normalizeFields = normalizeFields;
module.exports.routesFor = routesFor;
module.exports.navItem = navItem;
