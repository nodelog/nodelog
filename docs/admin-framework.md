# NODELOG 后台管理框架（Admin Framework）

> 版本：2026-11-15 · 定位：**收口层**，不是第二套后台。
> 运行验证：`npm run admin:verify`（离线、零新增依赖、不连 MongoDB）。

---

## 1. 定位与设计原则

本项目**已经存在**一套后台能力骨架（`adminConfig` → `adminKit` → `adminCrud`/`adminIo` → `_adminDao` → 资源 controller → 路由 → `navConfig`），9~10 个资源按 cfg 描述符接入。因此本框架**不重写、不并联**，只做三件事：

1. **收口**：把散落在 7 个文件里的能力，聚合成「一处声明、四处生效」的声明式配置（菜单 / 列表 / 表单 / 权限 / 路由）。
2. **固化**：明确配置项与默认值，非法声明在启动期大声失败，消除"配置了但不生效"的死功能。
3. **验证**：提供可离线运行的基础门禁，保证框架契约不随后续迭代腐化。

**明确不做**（避免冗余与过度设计）：不新增 npm 依赖、不引入 ORM/校验库/前端框架、不重写既有 90+ 条路由、不自动挂载路由（零副作用）、不做多步表单/字段联动等当前用不到的能力。

---

## 2. 完整项目结构（框架部分）

```
NODELOG/
├── controllers/
│   ├── adminFramework.js      ★ 框架门面 / 契约层（唯一入口，本次新增）
│   ├── adminConfig.js           阈值单一定义点（21 常量 + 环境变量覆盖 + 启动校验）
│   ├── adminKit.js              跨边界纯函数（校验 / 错误归一化 / 审计 / CSV）
│   ├── adminCrud.js             通用编排：list/detail/status/remove/batch + buildWhere/writeScope
│   ├── adminIo.js               CSV 导入导出（复用 crud._internal）
│   ├── dashboard.js             概览看板（框架外，只读聚合）
│   └── <resource>.js            各业务资源：只组装 cfg 与 hooks，不写通用逻辑
├── models/
│   ├── _adminDao.js             DAO mixin：adminList/adminFindById/adminUpdate/adminSoftDelete
│   └── <Resource>.js            Mongoose Model + attach(_adminDao)
├── navConfig.js                 ★ 前后台导航单一配置源（app.locals.navConfig）
├── routes/
│   ├── index.js                 路由装配（守卫 + handler）
│   └── filter.js                authorize / authorizeAdmin / csrfGuard
├── views/
│   ├── common/
│   │   ├── adminToolbar.ejs    ★ 统一工具条（筛选/排序/批量/导入导出/新增）
│   │   ├── adminPager.ejs      ★ 带筛选参数的分页
│   │   ├── pager.ejs / pagination.ejs  / state.ejs（空/错/载态）
│   │   └── icons.ejs            SVG 图标符号表
│   └── manager/
│       ├── header.ejs / footer.ejs  ★ 统一后台布局（侧栏四组 + 顶栏 + 主题）
│       └── <resource>.ejs       列表页：include header + adminToolbar + adminPager + footer
├── public/
│   ├── js/common.js            ★ 后台统一交互委托（IIFE#2：表单/批量/单条/导入导出/筛选）
│   ├── js/ui.js                NL.toast / alert / modal / loading
│   └── css/theme.css, app.css  ★ 设计令牌 + .admin-* / .manager-* 样式
├── scripts/
│   ├── verify-admin-framework.js ★ 基础验证（本次新增，55 项）
│   └── verify-admin-api.js       表驱动 HTTP 接口自检（可选，需服务）
└── docs/admin-framework.md      本文档
```

**分层纪律**（自上而下单向依赖，禁止反向）：

| 层 | 模块 | 只负责 | 明确不做 |
|---|---|---|---|
| 契约 | `adminFramework.js` | 声明校验、默认值、路由表、门面导出 | 不连库、不挂载路由、不产业务逻辑 |
| 配置 | `adminConfig.js` | 标量阈值 + 环境变量 + 启动期校验 | 不含业务逻辑 |
| 工具 | `adminKit.js` | 输入校验、错误归一化、审计、CSV 编解码 | 不组装 query |
| 编排 | `adminCrud.js` / `adminIo.js` | 解析→组装 query→DAO→归一化→响应→审计 | 不猜业务语义 |
| DAO | `_adminDao.js` | 执行已组装好的 query | 不校验归属、不判权限 |
| 资源 | `controllers/<res>.js` | 组装 cfg 与 hooks | 不复制通用流程 |
| 路由 | `routes/index.js` | 挂守卫与 handler | 不写业务分支 |
| 菜单 | `navConfig.js` | 入口可见性与高亮 | **不替代鉴权** |
| 视图 | `adminToolbar` / `adminPager` / `state` | 统一布局与交互 | 不硬编码资源字段 |
| 交互 | `common.js` IIFE#2 | data 属性驱动的事件委托 | 不覆盖 legacy IIFE#1 |

---

## 3. 配置项与默认值（唯一事实来源）

### 3.1 阈值类（`adminFramework.DEFAULTS` 直接引用 `adminConfig`，可被同名环境变量覆盖）

| 配置项 | 环境变量 | 默认值 | 约束 |
|---|---|---|---|
| `pageSize` | `ADMIN_PAGE_SIZE` | 9 | 1..100 |
| `maxPageSize` | `ADMIN_MAX_PAGE_SIZE` | 100 | 1..1000 |
| `batchLimit` | `ADMIN_BATCH_LIMIT` | 100 | 1..1000 |
| `importMaxBytes` | `ADMIN_IMPORT_MAX_BYTES` | 2 MB | 1KB..10MB |
| `importMaxRows` | `ADMIN_IMPORT_MAX_ROWS` | 1000 | 1..10000 |
| `AUDIT_WRITE_TIMEOUT_MS` | 同名 | 2000 | 100..30000 |
| `AUDIT_TTL_DAYS` | 同名 | 180 | 1..3650 |

启动期派生不变量：`PAGE_SIZE ≤ MAX_PAGE_SIZE`（否则抛错）。

### 3.2 行为类（`adminFramework.DEFAULTS`）

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `sortBy` / `order` | `createTime` / `desc` | 资源可用 `list.sortBy` / `list.order` 覆盖 |
| `sortWhitelist` | `['createTime']` | 防排序字段注入 |
| `searchFields` | `['name']` | 关键词检索字段 |
| `statusRange` | `[0, 2]` | 状态取值区间 |
| `soft` | `{status: 0}` | 列表可见性；软删语义不同时资源显式覆盖 |
| `softStatus` | `1` | 软删写入值（User 为 2，需显式覆盖） |
| `roles` | `'admin'` | **安全默认**：后台资源仅管理员 |
| `shape` | `'success'` | 统一响应 `{success, msg}` |
| `pageSuffix` | `'/admin'` | SSR 列表页相对 `base` 的路径 |

### 3.3 框架扩展点（本次修复为"真生效"）

| 声明位置 | 键 | 作用 |
|---|---|---|
| `desc.extraFilters` | `['parent']` | 让自定义筛选键进入 `filters`，供 `desc.extra()` 消费 |
| `desc.defaultOrder` / `cfg.defaultOrder` | `'asc'` | 默认排序方向（此前是死配置） |
| `bar.defaultOrder` | `'asc'` | 工具条「方向」下拉默认值与服务端对齐 |
| `desc.owner` | `'author'` | 数据归属（非管理员只能操作自己的） |
| `desc.extra(filters, req)` | 函数 | 注入额外 where 条件 |
| `decorate(docs, cb)` | 函数 | 列表批量补关联字段（避免 N+1） |
| `locals(docs, filters, req, cb)` | 函数 | 向 SSR 视图注入额外变量（如下拉选项） |

**修复记录**：此前 `parseListQuery` 白名单不含 `parent`，且 `adminPager` 白名单也不含它 → 后台「按父分类筛选」渲染了下拉但**不可达**，翻页还会丢筛选。现由 `extraFilters` 声明后，解析、where 注入、翻页回显三处自动打通；`adminPager` 会动态并入 `filters` 中所有已声明键，各页不再需要 `extraParams` 手工补。

---

## 4. 核心模块：`controllers/adminFramework.js`

顶层只加载纯常量 `adminConfig`；`kit`/`crud`/`io`/`dao`/`nav` 用**惰性 getter** 暴露，因此可离线 `require`（验证脚本无需 MongoDB）。

| 导出 | 签名 | 说明 |
|---|---|---|
| `DEFAULTS` | 对象 | 见 §3 |
| `FIELD_KINDS` | 数组 | `text / textarea / select / number / date / password` |
| `CAPABILITIES` | 数组 | `page/list/detail/add/modify/delete/status/batch/import/export` |
| `ROLES` | 对象 | `{ADMIN: 0, USER: 1}` |
| `defineResource(spec)` | → 归一化描述符 | 校验必填 + 填默认值 + 归一化字段；非法即抛 `[adminFramework] …` |
| `normalizeFields(fields, where)` | → 字段数组 | 校验 `n/t/k/o`，补 `req/max/d`，拒绝重复名与未知类型 |
| `routesFor(res)` | → `[{method,path,action,handler,guard}]` | 按 `capabilities` 生成标准路由表，**纯数据无副作用**，检测路径冲突 |
| `navItem(res)` | → `{key,label,href,roles}` | 与 `navConfig` 契约一致的菜单项 |
| `config/kit/crud/io/dao/nav` | getter | 下层统一出口，业务代码不再各处 `require` |

**错误处理**：所有非法声明在 `defineResource` 内抛带 `[adminFramework]` 前缀的 `Error`（19 类非法输入已被验证覆盖），遵循项目「配置错必须大声失败」纪律；不产生半初始化对象。

---

## 5. 四大基础能力如何覆盖

| 能力 | 单一来源 | 说明 |
|---|---|---|
| **菜单导航** | `navConfig.js`（`app.locals`） | 后台侧栏四组 `<details>`、前台三区；`isCurrent/visible/hrefFor/labelFor/groupOf` 纯函数驱动；`roles` **只控可见性** |
| **数据列表** | `adminCrud.list` + `adminToolbar` + `adminPager` + `state` | 分页/排序/筛选白名单、批量、导入导出、空错载态、脱敏（JSON 分支）统一 |
| **表单** | 字段描述符 `fields[]` + `common.js openForm` | DOM API 构建（用户值不进 HTML 字符串）、`data-*` 回填、必填就地校验、select 防环、6 种字段类型 |
| **用户与权限** | `routes/filter.js` + `ROLES` + `desc.owner` | 三级身份（匿名 / 登录 / 管理员 `role===0`）+ 一层数据归属；框架默认 `roles:'admin'` |

**权限链**（框架推荐统一写法，`routesFor` 输出的 `guard` 即对应它）：

```js
// guard === 'admin' → [authorize, authorizeAdmin]；guard === 'login' → [authorize]
// GET 未登录 → 302；非 GET 未登录/越权 → 401 {success:false,msg}
// csrfGuard 对同源 POST 放行，对带 token 的开放 API 放行
```

**错误处理链路**：DAO `CastError` → `kit.normalizeDaoError`（400 参数格式错误 / 409 冲突 / 500 通用文案，响应不含堆栈）→ 业务错误用 `err.userMsg` 透传友好文案 → `failBody` 统一 `{success:false,msg}` → `common.js post()` 解析 `body.msg` → `NL.toast`；批量失败逐行标红且保留结果。审计在响应前串行写入，失败仅告警不阻断。

**统一响应契约**：`{success:true,msg}` / `{success:false,msg}` / 列表 `{success:true,data,page,totalPage,total}` / 批量 `{success:true,results,failed}`。

---

## 6. 接入范式：新增一个后台资源

以 `demo` 为例，共 5 步，**无需改动任何框架文件**。

### Step 1 · Model 挂 DAO mixin

```js
// models/Demo.js 末尾
require('./_adminDao').attach(DemoDAO, DemoModel, {softStatus: 1});
```

### Step 2 · 声明资源（唯一配置点）

```js
// controllers/demoAdmin.js
var fw = require('./adminFramework');
var crud = require('./adminCrud');
var Demo = require('./../models/Demo');

var RES = fw.defineResource({
    key: 'demo', label: '演示', model: Demo, base: '/manager/demo',
    desc: {soft: {status: 0}, search: ['name', 'slug'], sortWhitelist: ['createTime', 'name'],
           defaultSortBy: 'createTime', dateField: 'createTime', extraFilters: []},
    list: {view: 'manager/demo', title: '演示管理'},
    fields: [
        {n: 'name', t: '名称', k: 'text', req: 1, max: 60},
        {n: 'slug', t: '标识', k: 'text', max: 60},
        {n: 'type', t: '类型', k: 'select', o: [{v: 'a', t: '甲'}, {v: 'b', t: '乙'}]}
    ],
    columns: ['编号', '名称', '标识', '状态'],
    roles: 'admin'
});

exports.adminPage = crud.list({Model: Demo, desc: RES.desc, target: RES.key,
    view: RES.list.view, urlPrefix: RES.base + fw.DEFAULTS.pageSuffix,
    title: RES.list.title, currentMenu: RES.currentMenu,
    sortWhitelist: RES.desc.sortWhitelist, defaultSortBy: RES.desc.defaultSortBy});
exports.adminList = crud.list({Model: Demo, desc: RES.desc, target: RES.key});
exports.detail    = crud.detail({Model: Demo, desc: RES.desc, target: RES.key, view: 'manager/detail'});
exports.status    = crud.status({Model: Demo, desc: RES.desc, target: RES.key, statusRange: [0, 1]});
exports.batch     = crud.batch({Model: Demo, desc: RES.desc, target: RES.key, statusRange: [0, 1]});
exports.add / exports.update / exports.delete / exports.import / exports.export = ...; // 按业务补齐
module.exports.RES = RES;
```

> `defineResource` 会在加载时校验 `base`、排序白名单、字段类型等；写错立即抛错，不会等到第一次请求。

### Step 3 · 挂路由（用 `routesFor` 生成的表，含守卫）

```js
// routes/index.js
var demo = require('./../controllers/demoAdmin');
var fw2 = require('./../controllers/adminFramework');
var guards = {
    admin: [filter.authorize, filter.authorizeAdmin],
    login: [filter.authorize]
};
fw2.routesFor(demo.RES).forEach(function (r) {
    var handler = demo[r.handler];
    if (!handler) throw new Error('demo 缺少 handler: ' + r.handler);
    app[r.method].apply(app, [r.path].concat(guards[r.guard], [handler]));
});
```

`routesFor` **不自动挂载**（零副作用），只产出声明式表；`guard` 由 `roles` 推导，默认 `admin`。

### Step 4 · 列表页（统一布局）

```ejs
<%- include('header') %>
<h3><%= title %></h3>
<div class="admin-list">
  <%- include('../common/adminToolbar', { bar: {
      res: 'demo', base: '/manager/demo/admin', keyword: true,
      status: [{v:'0',t:'正常'},{v:'1',t:'禁用'}],
      sort: [{v:'createTime',t:'创建时间'},{v:'name',t:'名称'}],
      batch: true, io: true,
      add: { label:'新增演示', fields: [
        {n:'name',t:'名称',k:'text',req:1,max:60},
        {n:'slug',t:'标识',k:'text',max:60},
        {n:'type',t:'类型',k:'select',o:[{v:'a',t:'甲'},{v:'b',t:'乙'}]}
      ]}
  } }) %>
  <table class="table table-hover">
    <!-- 每行 <tr data-id data-name data-slug data-type data-status> 供编辑回填 -->
  </table>
  <%- include('../common/adminPager', {url:url, page:page, totalPage:totalPage}) %>
</div>
<%- include('footer') %>
```

### Step 5 · 菜单 + 验证

```js
// navConfig.js 的 admin.groups 内容组加一项（字段由 navItem 生成）
{ key: 'demo', label: '演示', href: '/manager/demo/admin?page=1', roles: 'admin' }
```

```bash
npm run admin:verify     # 55 项基础门禁，失败返回非 0
node scripts/verify-admin-api.js --base http://127.0.0.1:3000 --cookie '<会话>'  # 可选真机自检
```

---

## 7. 统一布局与交互契约（必须遵守）

- 每个后台页 `include('header')` + `include('footer')`；列表页必须 include `adminToolbar` + `adminPager`，空态用 `state.ejs`。
- 视觉只用 `theme.css` 令牌（`--surface`/`--accent`/`--ink`…）与 `.admin-*` / `.manager-*` 类；**禁止裸 hex**、禁止 emoji 当图标（用 `icons.ejs` 的 `#i-*`）。
- 交互只靠 data 属性委托（`.js-admin-*`），**不写页内 IIFE**、不引 jQuery/Bootstrap JS。
- 编辑回填靠 `<tr data-<字段名>>`；`select` 的 `o[].p` 用于编辑时移除自身及后代，防循环引用。
- 所有 API 走 `post()`（解析 `body.msg`）；失败必须给用户可读文案，状态开关失败回滚原状。
- 新代码一律用统一响应 `{success,msg}`；禁止再造 `{result}` 契约。

---

## 8. 基础验证结果

```bash
$ npm run admin:verify
== 1. 框架门面 · 配置项与默认值 ==            5 PASS
== 2. defineResource · 归一化与默认值 ==       5 PASS
== 3. 错误处理 · 非法声明启动期抛错 ==        19 PASS
== 4. routesFor / navItem ==                   4 PASS
== 5. 框架扩展点 · 真实调用验证 ==             7 PASS
== 6. 语法、模板与菜单契约 ==                 15 PASS
========================================
  基础验证：55/55 PASS
========================================
```

覆盖：`node --check` 8 个 JS、`ejs.compile` 5 个模板、全部管理页 include header、菜单 key 唯一/href 合法/roles 合法、19 类非法声明拒绝、扩展点真实调用（非静态 grep）。**离线可跑，不连 MongoDB，可直接作 CI 门禁**（非零退出码）。

---

## 9. 已知历史包袱与迁移建议

框架**未**改动既有业务行为，以下历史包袱仍在，属可渐进迁移项，不阻塞使用：

| 项 | 现状 | 建议 |
|---|---|---|
| 4 页双轨 UI | `category/content/user/log.ejs` 有 `if filters / else` 两套分支 | 新资源一律只写新分支；待老路由下线后再删 `else` 与 legacy 脚本 |
| 3 套分页 | 后台 `adminPager→pager`、legacy `pager`、前台 `pagination` | 保留（前台语义不同），不再新增第四套 |
| 个别页自治 | `link.ejs` 页内 IIFE、`violation.ejs` 自写工具条 | 后续按 §6 范式迁移；本次 `adminPager` 已消除其 `extraParams` 刚需 |
| 老响应契约 | 少量老接口仍用 `{result}` | 新代码禁用；不改动老接口以免回归 |
| 鉴权写法 | 老路由段混用 4 种守卫写法 | 新路由统一用 `routesFor().guard` 映射 |
| `dashboard` | 框架外、手写 17 路并行 | 保持只读聚合；若要纳入框架需先定义非列表型资源 |

**扩展指引**：加字段类型 → 同时改 `adminFramework.FIELD_KINDS` 与 `common.js openForm`（验证脚本会检查二者一致）；加筛选 → 在 `desc.extraFilters` 声明并在 `desc.extra` 消费（翻页自动保留）；加减能力 → 改 `capabilities`，路由表与菜单随之裁剪。
