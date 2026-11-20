# Wiki 体系设计（产品骨架定案）

> 定案时间：2026-11-20。性质：产品与数据骨架，不含代码实现。
> 触发：开工 WP3 前，用户要求先明确「知识库体系是什么」。参考 ThinkWiki 企业知识中心截图。
> 约束：不破坏原有博客功能；WP1 已预留 `docType/spaceId/parent/wikiOrder` 字段；WP2 已完成在线录入与 .md 导入。

---

## 1. 四类决策（用户已拍板，全部选推荐项）

| # | 决策点 | 结论 | 含义 |
|---|---|---|---|
| D1 | 知识库数量与归属 | **不限制数量** | 每个登录用户可建任意多个知识库，各自独立目录树。可同时拥有「链付收银SAAS」「链付收银博客」两个。 |
| D2 | 入口与链接 | **独立一级入口 + 语义链接** | 前台主导航新增「知识库」入口；知识库首页 `/wiki/<space-slug>`，每篇文档 `/wiki/<space-slug>/<page-slug>`。 |
| D3 | 展示布局 | **三栏文档中心**（对照 ThinkWiki 截图） | 左栏可折叠目录树 + 中栏正文 + 右栏相关资源/文档类别。 |
| D4 | 可见性 | **公开为主，预留私有** | 知识库默认公开（游客可读）；模型预留 private 开关，MVP 先做公开。 |

---

## 2. 术语与概念模型（先把话说清）

一个容易混淆的点：用户口中的「一个 Wiki 文档含多篇文档内容」，在体系里拆成三层，不要再用同一个词：

| 层级 | 名称 | 对应数据 | 例子 | URL |
|---|---|---|---|---|
| L1 | **知识库（Space）** | `spaces` 集合一条文档 | 链付收银SAAS | `/wiki/linkon-saas` |
| L2 | **页面（Page）** | `content` 集合一条 `docType:'wiki'` 文档 | 快速入门 | `/wiki/linkon-saas/quick-start` |
| L3 | **页面层级** | `Content.parent` 自引用 | 快速入门 → 安装部署 → Windows 安装 | （由 L2 的 slug 路径体现） |

**关键口径**：
- 一个知识库 = 一棵页面树 + 一套配置（名称、slug、描述、可见性、 owner）。
- 「链付收银SAAS」和「链付收银博客」= 两个 Space，各自一棵树，**不是**一个 Space 下的两篇文档。
- 页面正文仍是 `Content.content`（Markdown），沿用 Vditor 编辑器与 WP2 的导入接口。
- 博客文章（`docType:'blog'`）不属于任何 Space（`spaceId:null`），完全走原有博客路由，互不干扰。

---

## 3. 数据模型（在 WP1 预留字段基础上补齐）

### 3.1 新增 `spaces` 集合

| 字段 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| `name` | String | required | 知识库名称，如「链付收银SAAS」 |
| `slug` | String | required, unique, lowercase | URL 语义标识，如 `linkon-saas`；用 `Tag.slugify` 同源口径 |
| `description` | String | '' | 简介，展示在知识库首页 |
| `visibility` | String enum `public`/`private` | `public` | D4：默认公开，private 预留（MVP 不实现权限判定，仅存字段） |
| `owner` | ObjectId → User | required | 创建者；D1 不限制数量，归属用于「我的知识库」列表与越权判定 |
| `cover` | String | '' | 可选封面 |
| `order` | Number | 0 | 知识库列表排序 |
| `createTime` / `modifyTime` | Date | Date.now | 时间戳 |

索引：`{slug:1}` unique、`{owner:1, status:1}`（如需软删则加 status）、`{visibility:1, order:1}`。

### 3.2 `content` 集合（WP1 已加，此处确认够用）

WP1 预留的 5 个字段**恰好覆盖**体系需要，无需再加新字段：

| 已有字段 | 在新体系中的角色 |
|---|---|
| `docType` (`blog`/`wiki`) | 区分博客文章与 Wiki 页面 |
| `spaceId` | 指向所属 Space；`null` = 博客文章 |
| `parent` | 页面树父节点；`null` = 根页面 |
| `wikiOrder` | 同级页面排序 |
| `searchBody` | 全文检索派生纯文本（回填已完成 932 篇） |

### 3.3 关系图

```
User (owner) ──1:N──> Space ──1:N──> Content(docType:wiki, spaceId=Space._id)
                                          │
                                          └──self──> parent (页面树，多层，需防环)
Blog 文章：Content(docType:blog, spaceId:null)  ← 完全独立，走原博客路由
```

---

## 4. 路由与入口（D2）

### 4.1 前台公开路由（不加鉴权中间件，可见性在数据层过滤）

| 路径 | 用途 | 渲染/数据 |
|---|---|---|
| `/wiki` | 知识库列表（全部公开 Space） | 三栏页，中栏为知识库卡片列表 |
| `/wiki/:spaceSlug` | 知识库首页 | 三栏页，中栏为该库的简介 + 根页面列表；无根页面时引导创建 |
| `/wiki/:spaceSlug/:pageSlug` | 单篇文档 | 三栏页，中栏正文；左栏树高亮当前页，右栏相关资源 |

> 页面树层级由 `parent` 表达，URL 只用 **space-slug + page-slug** 两段（page-slug 全局唯一于该 space 内即可），不把树深度摊进 URL——这样页面移动父节点不会导致 URL 变化（呼应方案里「页面树移动后 URL 不断链」的验收点）。

### 4.2 需登录的创作路由

| 路径 | 用途 |
|---|---|
| `/wiki/:spaceSlug/new` | 在该库新建页面（复用 Vditor，docType 固定 wiki，spaceId 自动带上） |
| `/wiki/:spaceSlug/:pageSlug/edit` | 编辑页面（归属判定：owner 或管理员） |
| `/manager/wiki/space` | 后台知识库管理（列表/新建/编辑/删除） |

### 4.3 导航接入

- 前台 `navConfig.js` 的 `primary` 区新增「知识库」入口（href `/wiki`），放在「分类」「标签」之间。
- 已有「新建文档」入口（cta 区）保留，但改为指向知识库选择或 `/wiki/:slug/new`。
- 后台 `admin.groups` 的内容组新增「知识库管理」。

---

## 5. 展示方式（D3，对照 ThinkWiki 截图）

### 5.1 三栏结构

```
┌──────────────────────────────────────────────────────────────┐
│ 顶部：站点导航（复用 header）+ 全局搜索框（复用现有搜索浮层）   │
├──────────────┬───────────────────────────────┬───────────────┤
│ 左栏 目录树   │ 中栏 正文卡片                  │ 右栏 相关资源   │
│ (可折叠)      │                               │               │
│ ▸ 概览        │ 面包屑: SAAS > 快速入门        │ 本库相关信息    │
│ ▾ 快速入门    │ ─────────────────────         │ - 标签云        │
│   ▸ 安装部署  │ # 快速入门                     │ - 同标签文档    │
│   ▸ 配置      │ 正文（markdown 渲染）          │ - 最近更新      │
│ ▸ 用户指南    │                               │               │
│ ▸ 常见问题    │                               │               │
└──────────────┴───────────────────────────────┴───────────────┘
```

### 5.2 每栏要素（对照截图逐项落位）

**左栏 · 目录树**
- 顶部显示知识库名称（如「链付收银SAAS 文档」），可点回 `/wiki/:slug`。
- 页面按 `parent` 构成多层树，`wikiOrder` 排序，`▸/▾` 折叠展开。
- 当前页高亮（对照截图「功能特色」高亮态）。
- 底部放折叠按钮（对照截图左下角 « 按钮）。
- 根页面无层级时平铺；深层页面缩进。

**中栏 · 正文**
- 顶部面包屑：知识库名 → 父页面 → 当前页。
- 标题 + Markdown 渲染正文（复用现有 `markdown.render`）。
- 沿用 WP1/WP2 的 `docType`/标签；正文底部可显示标签 chips。

**右栏 · 相关资源**
- 「本库信息」：页面数、最近更新时间、owner。
- 「相关文档」：同标签/同空间的其他页面（复用 `tags` 数组匹配）。
- 「标签」：该库的标签云（复用 `/tags` 数据口径）。
- 截图里的推广位（ThinkChat 广告）**不照搬**——换成自有内容或留空，避免给开源项目植入广告。

### 5.3 响应式

- 桌面（≥1024px）：三栏。
- 平板（768–1023px）：左栏可抽屉化，中栏 + 右栏。
- 手机（<768px）：单栏正文，左目录树改为顶部抽屉按钮，右栏移到正文底部。

---

## 6. 与现有博客的衔接（不破坏原则）

| 衔接点 | 处理方式 |
|---|---|
| 博客文章 | `docType:'blog'`、`spaceId:null`，完全走原 `/`、`/content/detail` 路由，展示零变化 |
| 已有数据 | 932 篇已回填 `docType:'blog'`，天然不是 Wiki 页面，不需额外迁移 |
| 搜索 | `/content/search` 已支持 `docType/spaceId` 过滤（WP3 实现），Wiki 搜索与博客搜索共用一套 `$text`，可全站搜或限定知识库 |
| 编辑器 | 复用 Vditor；新建 Wiki 页时 docType 固定 wiki、spaceId 自动注入，用户无感 |
| 导入 | WP2 的 `.md` 导入已写 `docType:'wiki'`，但当时没有 spaceId——需扩展导入接口支持指定目标知识库（WP3 待办） |
| 标签/分类 | Wiki 页面与博客共用 `tags`/`category`，标签计数 `syncTags` 口径不变 |

---

## 7. 对既有代码的影响清单（给实施阶段）

| 类型 | 文件/位置 | 改动 |
|---|---|---|
| 新增模型 | `models/Space.js` | 本文件 §3.1 的 schema + DAO |
| 新增常量 | `models/constants.js` | `SPACE_VISIBILITY_*` 已在 WP1 加好，无需再动 |
| 新增控制器 | `controllers/wiki.js` | 知识库/页面查询、树构建、面包屑 |
| 新增服务 | `services/wikiTree.js` | 一次查询建树、防环、排序 |
| 新增视图 | `views/wiki/{list,space,page}.ejs` | 三栏文档中心（可抽公共 layout） |
| 新增样式 | `public/css/wiki.css` 或 theme.css 增段 | 三栏栅格 + 树样式 + 响应式 |
| 新增脚本 | `public/js/wiki.js` | 目录树折叠、当前页高亮 |
| 路由 | `routes/index.js` | §4 的前台与创作路由 |
| 导航 | `navConfig.js` | 前台「知识库」入口、后台管理组 |
| 改造 | `controllers/wikiImport.js` | 导入时支持指定 `spaceId`（§6） |

---

## 8. 待办与顺序（承接 WP1/WP2）

- **WP3 检索底座**：text 索引重建 + 组合过滤 + 中文两路召回（已排期，不变）。
- **WP4 知识库体系**：本次定案的 Space 模型 + 三栏展示 + 语义路由（原增强阶段内容，因用户明确要求提前到核心范围）。
- **WP2 补丁**：`.md` 导入接口加 `spaceId` 参数，导入到指定知识库。

> 说明：用户本次把「知识库体系」从原方案的增强阶段提升为核心诉求，故 WP4 从「页面树 UI」升级为「完整 Space 体系」。WP1 预留字段无需返工，这是当时的设计余量发挥作用。

---

## 9. WP4 实施状态（2026-11-20，前端第一版待确认）

**已落地**（代码在仓库，未上线）：
- `models/Space.js`：Space 模型与 DAO（findBySlug/findVisible/findByOwner/isVisible 等），slug 唯一。
- `models/Content.js`：补 `findBySpace`/`findPageBySlug`/`countBySpace` 三个 Wiki 查询方法（WP1 索引的配套）。
- `services/wikiTree.js`：一次查询建树、面包屑、防环、摊平，纯函数。
- `controllers/wiki.js`：知识库列表 / 库首页 / 文档详情 / 树 JSON 四个接口，可见性走数据层。
- `views/wiki/{list,space,page,_tree}.ejs` + `public/css/wiki.css` + `public/js/wiki.js`：三栏文档中心，内联 SVG 图标（无 emoji/无紫粉渐变），响应式。
- 路由 `/wiki`、`/wiki/:spaceSlug`、`/wiki/:spaceSlug/:pageSlug`、`/wiki/:spaceSlug/tree.json`；前台导航加「知识库」入口。
- `controllers/wikiImport.js` 补 `spaceSlug` 参数，导入可归入指定知识库、库内幂等判重。
- 后台建库能力：`controllers/spaceAdmin.js` + `views/manager/wikiSpace.ejs` + 4 条 `/manager/wiki/space/*` 路由（列表页/增/改/软删；软删前有页面则拒绝，防孤儿）。后台导航加「知识库」「导入文档」。至此体系可从后台完整落地，无需直接操作 DB。

**自检结论**：node --check 8 文件全过；EJS 编译 5 页全过；静态断言 32/32；树服务单测 9/9（建树/孤儿提升/面包屑/防环/摊平）。

**真渲染验证**：无头浏览器截图 `.design/wiki-shots/{desktop,mobile}.png`。桌面三栏清晰、无横向溢出、层级分明。移动端用 DOM 探针验证：`match767=true`、目录树 `display:none`（折叠生效）、`scrollW==clientW`（无横向溢出）——此前截图里的"裁切"是 headless 窗口实际视口 488px 而截图裁剪到 390px 的工具假象，非真实 bug。**像素级排版待在服务器真实页面（含 header/完整 CSS）确认**。

**待确认后继续**：① 前端方向确认（三栏/配色/文案）；② WP3 检索底座（text 索引重建 + 组合过滤）。

> 后台 Space CRUD 已在同批次补齐（原列为待办，因「不补就无法从界面建库」而提前完成）。

---

## 10. 方向修正（2026-11-20 第二轮，用户反馈后）

用户对 WP4 第一版提出 5 点修正，已采纳并落地：

| # | 用户意见 | 修正实现 |
|---|---|---|
| 1 | 知识库前台应独立，不跟博客集成；菜单新标签打开；内容 100% 宽、不留白 | 新增 `views/wiki/_header.ejs`/`_footer.ejs` 独立壳层（独立顶栏：品牌+知识库标识+搜索+返回博客），三栏页面改用独立壳；`wiki.css` 全宽化（去 760px 阅读栏→1080px、padding 收紧、三栏占满视口）；导航项加 `target:_blank`，`header.ejs` 透传 target |
| 2 | 前台不该有录入入口，前台专给博客 | 删除 navConfig cta 区「新建文档」入口 |
| 3 | 后台「知识库」「导入文档」两个菜单应合并 | 合并为单一「知识库」菜单 → `/manager/wiki` 统一工作台 |
| 4 | 知识库后台也应独立全宽 | 新增 `views/manager/wiki/_header.ejs` 独立后台顶栏 + `wiki-admin.css` 全宽布局 |
| 5 | 导入页纯文本框不合适，应用编辑器 | 统一工作台 `/manager/wiki` 三 tab（文档编辑/导入/知识库管理）；文档编辑用本地 **Vditor**（隐藏源 + getValue 同步）；支持新建/编辑/删除页面、库 CRUD、导入——全部在一个全宽页面完成 |

**新增文件**：`views/wiki/_header.ejs`、`views/wiki/_footer.ejs`、`views/manager/wikiWorkspace.ejs`、`views/manager/wiki/_header.ejs`、`views/manager/wiki/_footer.ejs`、`public/css/wiki-admin.css`、`public/js/wiki-admin.js`。
**新增接口**：`GET /manager/wiki`（工作台）、`POST /manager/wiki/doc/save`、`POST /manager/wiki/doc/delete`；`Content.findPagesForEdit`、`spaceAdmin.workspace/saveDoc/deleteDoc`；导入接口兼容 `spaceId` 参数。

**真渲染验证**：1600px 截图 `.design/wiki-shots/independent.png` 确认独立顶栏 + 全宽三栏 + 无溢出。

**边界**：`views/manager/wikiSpace.ejs`、`views/manager/wikiImport.ejs` 保留为兼容页面（直接访问 URL 仍可用），但主入口已统一到工作台。

---

## 11. 第三轮修正（2026-11-20，用户 5 点反馈）

| # | 用户反馈 | 处理 |
|---|---|---|
| 1 | 写文章就是博客的，不用选文档类型 | 删除 addContent/editContent 的 docType 下拉；common.js 提交固定 `docType:'blog'`。Wiki 录入只在后台工作台 |
| 2 | 后台知识库链接 502 | **真 bug**：`spaceAdmin.workspace` 直接调 `Content.find()`，但 Content 是 DAO 实例无 find 方法 → TypeError 崩溃 → 502。新增 `ContentDAO.findPagesBySpaces()` 封装 Model.find，控制器改调它；全局排查无其它同类调用 |
| 3 | 前台知识库要能连后台 | 独立顶栏加「管理」按钮（仅 role===0 管理员可见）→ `/manager/wiki` |
| 4 | 排版缺留白、文字贴边框 | 左栏 padding 加大、中栏 `space-8 + clamp(6,4vw,10)`、右栏 `space-8/6`、块间距 `space-8`、目录行距与面包屑间距加大。1600px 真渲染确认透气无溢出 |
| 5 | Wiki 要能分享 + 二维码 | 新增 `views/wiki/_share.ejs` 分享弹层（微博/QQ/复制 + **二维码**）；新增 `qrcode@1.5.4` 依赖（Node≥10.13，兼容生产16）；新增 `GET /api/qrcode?text=` 后端生成 PNG data URL（限流30/min，只接受本站 http(s) URL 防滥用）；Wiki page 传 ogTitle/ogDesc/ogImage，复用微信 JS-SDK 分享 |

**502 根因教训（重要）**：`module.exports = new ContentDAO()` 导出的是 DAO 实例，不是 Mongoose Model——任何 `Content.find()/Content.count()/Content.findOne()` 直接调用都会抛 TypeError 让进程崩溃。必须用 DAO 上已定义的 `findByXxx/countByXxx` 方法，或先在 DAO 上封装。排查命令：`grep -rn "Content\.find(" controllers/ services/ routes/`。

---

## 12. 第四轮修正（2026-11-20，用户 6 点反馈）

| # | 反馈 | 根因 / 处理 |
|---|---|---|
| 1 | 「管理」改「工作台」；hover 文字消失 | 文案改为「工作台」，文字用 span 包裹并显式设 `--accent-ink`；hover 改用 `filter:brightness` 不强改文字色，`white-space:nowrap` 防压缩 |
| 2 | 工作台找不到已建知识库 | **与 #3 同源**：注入脚本的注释里写了字面量 `</script>`，浏览器提前截断脚本 → `window.__WIKI_ADMIN__` 未执行 → 下拉数据空。改注释措辞后恢复 |
| 3 | 工作台底部泄漏「需转移，防止提前闭合脚本」文字 | 同上，那段注释被当成 HTML 文本显示。已消除裸闭合标签。EJS 渲染验证：`initialSpace` 赋值在首个 `</script>` 之前完整、无泄漏 |
| 4 | 中栏内容贴边框 | **根因：CSS 用了不存在的令牌** `--space-5/7/9/10/11`（项目只有 1/2/3/4/6/8/12/18），导致 padding 声明整条失效。全量替换为有效令牌，中栏 padding 实测 48px 生效 |
| 5 | 空首页滚动条能拉很高 | `.wiki-grid` 的 `min-height:calc(100vh-112px)` + 三栏 inherit 撑高页面。去掉强制高度改自然高度。探针实测 `scrollH==clientH`，无多余滚动 |
| 6 | 知识库首页看不到分享按钮 | 之前只有文档详情页有。给 `space.ejs` 加分享按钮 + `include _share`（shareLabel 可配），控制器传 ogTitle/ogDesc/ogImage；分享出去显示知识库名与简介 |

**CSS 令牌教训（重要）**：项目可用间距令牌只有 `--space-1/2/3/4/6/8/12/18`。用不存在的令牌（如 `--space-5`）会导致整条 CSS 声明静默失效——表现为"样式没生效/贴边"。排查：`grep -o -- "--space-[0-9]*" 文件 | sort -u` 对照 theme.css 定义。

---

## 13. 第五轮：提示体系统一 + 编辑器分屏 + 博客二维码（2026-11-20）

**全系统提示审计结论**：项目去框架化后其实已统一到 `ui.js` 的 `window.NL`（toast/alert/modal）+ app.css 的 `.nl-toast/.nl-modal`；`myMsg` 只是 `NL.toast` 的薄别名。唯一"第二套"是 wiki 工作台的 `.wa-msg` 内联提示 + `.wa-btn` 按钮。

| # | 优化 | 处理 |
|---|---|---|
| 1 | 工作台保存无提示 + 全系统提示/按钮统一 | wiki-admin.js 的 `msg()` 改走 `NL.toast`（kind 映射 ok→success/error→error）；wiki 独立页补 toast 宿主 + ui.js（ui.js 提前到工作台脚本前加载）；`.wa-btn` 全部换 `.btn/.btn-primary/.btn-danger`，删除 wa-btn 死样式 |
| 2 | 编辑器默认分屏预览 | 两处 `new Vditor` 的 `mode` 从 `wysiwyg` 改 `sv`（splitView，Vditor 3.10.8 确认支持）：`views/editor.ejs`（博客）、`public/js/wiki-admin.js`（Wiki） |
| 3 | 博客分享加二维码 | `views/contentDetail.ejs` 分享弹层加 `.nl-share__qr`（复用 `/api/qrcode`）；二维码样式提取到 theme.css 的 `.nl-share__qr`，Wiki 分享弹层也统一用它，删除 wiki.css 的重复样式——博客与 Wiki 分享弹层共用一套 |

**一位一码**：分享二维码样式只定义在 theme.css；toast 只有 NL.toast 一套；按钮只有 `.btn` 一套；Vditor mode 两处口径一致（sv）。

自检：node --check 3 文件、EJS 编译 8 页、静态断言 32/32、Vditor sv 枚举确认、分享弹层真渲染无错位，全过。

---

## 14. 移动端顶栏适配修复（2026-11-20）

**问题**：用户截图显示 390px 手机上顶栏元素严重挤压——品牌名被截断、"知识库"胶囊竖排飘到搜索框上方、"返回博客"被压成竖排两字。

**根因**：顶栏塞了品牌+胶囊/搜索框/主题/返回/工作台 5 组元素，品牌用 `flex:1 1 auto` 吃掉剩余空间把工具区推到右缘，且缺 nowrap 保护导致文字换行竖排。

**修复**（`views/wiki/_header.ejs` + `public/css/wiki.css` + `public/js/wiki.js`）：
- 移动端搜索框默认折叠为图标按钮，点击在顶栏下方展开一行搜索条（点外部/Esc 收起）；桌面端仍是常驻搜索框，切换按钮仅移动端显示。
- 隐藏"知识库"胶囊；品牌 `flex:0 1 auto` + 站名省略号截断；返回/工作台只留图标（文字 `.wiki-topbar__label` 隐藏）；所有工具元素 `flex:none; white-space:nowrap` 防竖排。
- 真机 390px 容器探针验证：品牌[12,122]、搜索[216,252]、主题、返回[300,336]、工作台[342,378]，`topbarScrollW==clientW==390` 无溢出；截图确认一行完整显示、无竖排无重叠。

---

## 15. Wiki 文档混入博客前台修复（2026-11-20）

**问题**：用户发现 Wiki 文档出现在博客前端页面。根因是 WP1 加 `docType` 后，博客前台所有查询都没排除 `docType:'wiki'`——`visibleTerm()`（首页/总数）与 findByCategory/findByWord/searchText/findAllByWord/findByTag/findByUser 及各 count 方法全部漏过滤。

**修复**（`models/Content.js`）：给 14 个博客前台查询/计数方法的查询 term 加 `docType: DOC_TYPE_BLOG`（与 `$or` 并列，MongoDB 里是 AND）：
- `visibleTerm()`（findByPage + getCount 间接覆盖）
- findByCategory / findByWord / searchText / findAllByWord / findByUser / findByTag
- getCountByTag / getCountByCategory / getCountByCategoryOnly / getCountByUser / getCountByWord / getCountByText

**不改的**：后台看板统计（getPendingCount/getTrend/sourceApp 系列）口径仍含所有内容类型；`findByName`（判重用，不展示）未动，避免扩大范围。Wiki 自己的查询（findBySpace/findPageBySlug/findPagesBySpaces）本就限定 `DOC_TYPE_WIKI`，不受影响。

**验证**：14 个方法脚本断言全部含 docType 过滤；node --check、静态断言 32/32 全过。

**教训**：给已有集合加"类型"字段时，必须回头把所有既有查询补上过滤——否则新类型数据会静默混入旧类型的所有列表/计数。排查：`grep -n "constants.CONTENT_ENABLE_STATUS" models/Content.js` 逐条看是否带类型约束。
