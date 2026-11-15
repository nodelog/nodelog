# NODELOG 后台管理 UI 框架

> 范围：后台（`/manager`）**前端界面层**——统一布局、导航、数据列表、表单、反馈与权限的呈现契约。
> 设计原则：**收口而非重写**。项目已有一套职责清晰的 UI 骨架，本框架只是把它明确成「配置驱动 + 单点声明」，
> 并补齐最薄弱的「数据列表」环节（`views/common/admin-list.ejs`）。零新增运行时依赖，零业务行为回归。

---

## 1. 项目结构（UI 层切片）

```
views/
  manager/
    header.ejs            ★ 后台外壳：顶栏(品牌/返回前台/账号) + 分组侧栏 + 主内容容器
    footer.ejs            脚本装配（dataFormat / ui.js / common.js，去 jQuery/Bootstrap/layer）
    category.ejs          资源列表示例（新分支用 admin-list；legacy 分支 role=1 兜底）
    content.ejs | user.ejs | comment.ejs | tag.ejs | log.ejs
    | sensitiveWord.ejs | audit.ejs | violation.ejs   其余后台资源页
  common/
    adminToolbar.ejs      ★ 统一工具条（搜索/状态/筛选/排序/批量/导入导出/新增），bar 配置驱动
    admin-list.ejs        ★ 统一数据列表组件（columns 配置驱动，本次新增）
    adminPager.ejs        ★ 统一分页（自动并入筛选参数）
    pager.ejs             分页底层（adminPager 复用；legacy 分支仍直连）
    state.ejs             四类状态块（empty/loading/success/error，失败不降级空态）
navConfig.js              ★ 前后台导航单一配置源（菜单/角色/可见性）
public/
  js/ui.js                ★ 反馈层：NL.modal / NL.toast / NL.alert / NL.loading / NL.closeAll
  js/common.js            ★ 后台事件委托（IIFE#2）：批次/状态/编辑/删除/导入导出/筛选提交
  css/theme.css           ★ 设计令牌 + .manager.* 后台样式（含 .nl-admin-list）
controllers/
  adminFramework.js       框架门面（服务端契约层，与 UI 无关但同源）
  adminKit.js / adminCrud.js / adminIo.js / adminConfig.js   服务端编排（资源配置 → 路由/视图）
models/_adminDao.js       DAO 混入（adminList / FindById / Update / SoftDelete）
scripts/verify-admin-ui.js  离线基础门禁（编译 + 渲染 + 契约，不连库）
```

**依赖方向（单向）**：`navConfig → header/footer → 资源页 → common 组件 → ui.js/common.js → theme.css`。
视图层不直接依赖具体资源，资源只通过 `bar` / `list` / `docs` 等数据契约注入。

---

## 2. 核心组件

### 2.1 外壳 Shell（`header.ejs` + `footer.ejs` + `navConfig.js`）
- 顶栏：品牌 + 「返回前台」反向入口 + 账号菜单（退出）。fixed 深色顶栏，让位 68px 由 `.manager-shell` 承担。
- 侧栏：`<details>` 分组（来自 `navConfig.admin.groups`），当前组自动展开；`navConfig.visible(item, user)` 按角色过滤；`isCurrent` 高亮。
- 主内容：`.manager-shell` 网格（侧栏 200px + 流体主区），`.jumbotron` 卡片承载内容。
- 响应式：≤1023px 侧栏移到内容上方两列；≤767px 单列。

### 2.2 工具条 Toolbar（`adminToolbar.ejs`）
配置对象 `bar`（由资源页 `include` 传入）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `res` / `base` | string | 资源键 / 列表基础路径（驱动委托与分页） |
| `keyword` | bool | 关键词搜索框 |
| `status` | `[{v,t}]` | 状态下拉（如 正常/禁用） |
| `sort` | `[{v,t}]` | 排序字段下拉；配合 `defaultOrder`（`asc`/`desc`，默认 `desc`） |
| `parentFilter` | `[{v,t}]` | 父级筛选（分类专用，需 `desc.extraFilters:['parent']` 配合） |
| `extra` | `'audit'` | 审计专用筛选（动作/操作者/资源/结果/起止） |
| `batch` / `batchStatuses` | bool / `[{v,t}]` | 批量选择与批量改状态 |
| `io` | bool | 导入/导出 CSV |
| `add` | `{label, api, editApi, fields}` | 新增按钮 + 表单字段描述（见 2.4） |
| `keep` | `{k:v}` | 透传隐藏字段（如固定 `categoryId`） |

### 2.3 数据列表 List（`admin-list.ejs`）★ 本次新增
配置对象 `list`（由资源页 `include` 传入）：

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `columns` | `[{key,label,type,width,align,default}]` | **必填** | 列定义；`type`：`index`(序号)/`text`(默认)/`link`/`status`/`date`/`raw` |
| `selectable` | bool | `false` | 首列批次复选框 |
| `rowKey` | string | `'_id'` | 行 id 字段 |
| `rowData` | `{data属性: 行字段}` | `{}` | 输出到 `<tr data-xxx>`，供编辑弹层回填与防环 |
| `actions` | `true` / `false` / `[{type,base?,api?,title?}]` | `true`→编辑+删除 | 操作列；`type`：`detail`/`edit`/`delete` |
| `linkBase` | string | `''` | `type:'link'` 列的统一跳转前缀（`?id=<行id>`） |
| `res` / `base` | string | `''` | 语义标注（委托多从 `.admin-toolbar` 读取） |
| `emptyTitle` / `emptyHint` | string | 按是否带筛选自动判断 | 空态文案 |

**契约对齐**：组件输出的 DOM 类名/属性与 8 个既有后台页手写表格**完全一致**
（`js-batch-check`、`js-admin-status`、`js-admin-edit`、`js-admin-delete`、`data-id` 等），
因此**无需改动 `common.js` 任何委托代码**即可生效。日期列优先用全局 `format`（`app.locals.format`），缺失时降级为本地 `YYYY-MM-DD HH:mm`。

### 2.4 表单 Form
- **触发**：工具条「新增」按钮（`.js-admin-add`）或行内「编辑」（`.js-admin-edit`）。
- **实现**：`common.js openForm` 读取 `data-form`(JSON 字段描述) 在 `NL.modal` 内用 DOM API 构建表单，
  支持 `text/textarea/select/number/date/password` 六种类型（与 `adminFramework.FIELD_KINDS` 对齐，未知类型降级 `text`）。
- **校验**：`noValidate` + 就地错误（`admin-form-error`，`role=alert`），不触发浏览器气泡；必填 / 最大长度由 `req`/`max` 驱动。
- **防环**：编辑分类时从前台 `data-parent` 出发移除自身及后代，避免循环引用使整棵下拉清空。

### 2.5 状态 State（`state.ejs`）
四类唯一组件：`empty`/`loading`/`success`/`error`。**失败绝不降级成空态**——`error`/`fail` 必带重试按钮且不改动已渲染内容。
骨架屏（`state-skeleton`）用于加载态；遵循 `prefers-reduced-motion` 降级为静态灰块。

### 2.6 分页 Pager（`adminPager.ejs` → `pager.ejs`）
- 自动并入当前筛选参数（来自父级 `locals.filters`，含 `desc.extraFilters` 声明的自定义键如 `parent`/`source`），翻页不丢筛选。
- 旧 `pager.ejs` 仅作为底层被 `adminPager` 复用；双轨页面的 legacy `else` 分支仍直连它（role=1 兜底，预期保留）。

### 2.7 反馈 Feedback（`ui.js` + `common.js`）
- `NL.toast(msg)` 轻提示；`NL.modal({title,onOpen,...})` 弹层（表单/确认共用）；`NL.closeAll()` 关闭。
- `confirmBox(msg, cb)`（在 `common.js`）用于删除二次确认。
- 服务端统一响应契约：`{success:bool, msg:string, ...}`；前端 `post()` 失败解析 `e.message` 展示，绝不静默吞错。

### 2.8 权限 Permissions（`routes/filter.js` + `navConfig.js`）
- 三级：`authorize`（登录即可）、`authorizeAdmin`（需管理员角色）、路由级 CSRF 同源校验。
- 菜单可见性：`navConfig.visible(item, user)` 按 `item.roles`（`'all'`/`'user'`/`'admin'`）过滤；安全默认 `roles:'admin'`。

---

## 3. 新增一个后台资源（5 步范式）

以「分类」为例，其余资源同理：

1. **Model 接入 DAO**：`CategorySchema` 经 `_adminDao.attach(Category)` 获得 `adminList/FindById/Update/SoftDelete`。
2. **声明资源**：`category.js` 调 `adminFramework.defineResource({key,label,model,fields,...})`（或沿用 `crud.list` 描述符），配置 `desc`（搜索字段、排序白名单、状态范围、筛选键 `extraFilters`、装饰 `decorate`/`locals`）。
3. **挂路由**：`routesFor(res)` 生成路由表后挂载（list/add/modify/status/remove/batch/import/export/detail），统一套 `authorizeAdmin`。
4. **写列表页**：`views/manager/category.ejs` 只做三件事——
   - `include('../common/adminToolbar', {bar})` 配置工具条；
   - `include('../common/admin-list', {list, docs})` 配置列表；
   - `include('../common/adminPager', {url,page,totalPage})` 分页。
5. **菜单 + 验证**：在 `navConfig.admin.groups` 加菜单项（`roles:'admin'`）；跑 `npm run admin:ui:verify` 确认编译/渲染/契约通过。

---

## 4. 错误与 UX 契约
- 任何失败都向用户呈现**人话 + 颜色 + 图标**三重线索，不只靠颜色（见 `theme.css` 语义 tint）。
- 批量操作逐条结果：`{success, results:[{id,ok,msg}], failed}`；失败行**就地标注**保留，绝不整体刷红伪装全失败。
- 单条状态/删除失败**回滚原行**（恢复开关/保留 DOM），不丢数据。
- 网络错误统一 `toast` 提示，不跳转、不崩页。

---

## 5. 可访问性
- 侧栏 `<nav aria-label>`、跳过链接 `.skip-link`、表单 `label`/`aria-required`、状态块 `role=alert/status` + `aria-live`。
- 键盘：`Space` 触发 `role=button` 链接（footer 统一绑定）；`:focus-visible` 蓝色 ring。
- 暗色模式：`:root[data-theme="dark"]` 全套令牌覆盖，后台顶栏独立深色变量不污染前台。

---

## 6. 迁移状态（渐进，避免回归）
| 页面 | 列表组件 | 分页 | 说明 |
|---|---|---|---|
| category | **admin-list**（新） | adminPager | 本次重构为框架接入示例 |
| content / user / comment / tag / log / sensitiveWord / audit | 手写 table | adminPager | 待按 category 范式迁移 |
| violation | 手写 table | adminPager(extraParams) | 审计专用筛选，迁移时复用 `bar.extra` |

> 新资源一律只走新分支（adminToolbar + admin-list + adminPager）。legacy `else` 分支与老 `pager.ejs` 仅作为 role=1 兜底，待全量迁移后删除。

---

## 7. 基础验证
```
npm run admin:ui:verify        # 离线、不连 MongoDB
```
覆盖：① 编译全部后台 partial（EJS 语法）；② 独立渲染 `admin-list`（分类列配置 + mock 行）断言委托契约与无错误态；
③ 完整渲染 `category.ejs`（桩 locals）证明经 `admin-list` 正确装配；④ 契约回归（分类页确实 include admin-list 并传 list）；
⑤ 遗留分页残留（仅老 pager 未双轨才算违规）。任一失败返回退出码 1，可直接进 CI。
