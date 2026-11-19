# Blog + Wiki 一体化文档工作台升级方案

> 目标：在不破坏现有博客的前提下，把 NODELOG 扩展为对标 ThinkWiki 的 Blog + Wiki 一体化文档工作台。
> 性质：架构与实施计划，不含代码实现。方案基于对现有仓库的实读，关键结论均可核对。
> 版本锚定（2026-11-20 已确认）：Express 4.21 / EJS 3 / Mongoose 6.13 / 本地 Vditor / markdown-it + sanitize-html / turndown；服务端 **MongoDB 4.4.6、Node v16.20.2**。核心决策已按该版本逐条核对成立，修正点与 EOL 风险见 §5.2 与 §11。

---

## 0. 方案摘要与统领决策

**一句话结论**：不新建 Wiki 系统，而是在现有 `content` 单集合上加 `docType` 区分 Blog/Wiki，补齐检索体验的四个缺口（全文搜索复用、快捷键、分类/标签过滤、关键词高亮）。底层能力已具备约八成，正确姿势是「薄增量 + 强回归」，而非推倒重建。

| 决定 | 选型 | 人话理由 | 代价 |
|---|---|---|---|
| 存储形态 | 单 `content` 集合 + `docType` 枚举 | 博客和 Wiki 是同一种文档，只是类型不同；搜索要一次覆盖两者才是「一体化」 | 字段表略宽，历史数据需回填 |
| 文档类型枚举 | **`docType: blog \| wiki`** | 与表述一致；`contentType`（html/markdown）是格式，正交，绝不复用 | 无 |
| Wiki 层级 | `Content.parent` 自引用（多层），MVP 仅预留字段 | 页面挂在页面下；不用 `Category.parent`（它只有两级且语义是分类） | 增强阶段需防环 |
| 空间 | 新增 `spaces` 集合 + `content.spaceId`，MVP 仅预留字段 | 一个知识库=一个空间；文章不属于空间 | 增强阶段多一套 CRUD |
| 可见性 | 扩展 `visibleTerm(currentUser)`，不加鉴权中间件 | 前台路由继续公开，过滤发生在查询条件里 | 过滤口径必须唯一 |
| 搜索 | 复用唯一 text 索引 + 重建 weights，中文走混合召回 | 不引入 Meilisearch/ES，零新增依赖 | 中文相关度一般，真分词列二期 |
| 页面树/空间 UI | **不进 MVP**，放增强阶段 | 用户点名的是录入/导入/分类标签/检索四件套，未点名页面树 | 增强阶段才做树 UI |

**明确不碰的三条硬边界**：
1. `contentType`（html|markdown，格式）绝不作文档类型。
2. `source` / `sourceAppId` 是 immutable，且 `scripts/test-api-credential.js:141-144` 有静态断言——新增字段名一律避开 `source` 子串，不得在 `ContentDAO.prototype.update` 前 900 字符或 `controllers/content.js` 引入 `req.body.source`。
3. 前台共享接口绝不加鉴权中间件（沿用 `routes/index.js:167-168` 既定约束）。

---

## 1. 现状基线（实读确认，作为方案底座）

- **已有能力**：分类（两级 `parent`）、标签（字符串数组 + `syncTags` 计数自愈）、Vditor 本地 Markdown 编辑器、HTML↔MD 双向转换（`turndown` + `markdown-it`）与可回滚迁移脚本、后台 CSV 导入、图片 base64 上传（5MB）。
- **已有搜索**：`GET /content/search` 走 MongoDB `$text`（name/content/tags）+ textScore 相关度排序；顶栏联想只查标题。
- **检索四缺口**：① 无全局快捷键（仅回车提交、Esc 收起）；② 无关键词高亮（`<%= %>` 转义输出，无 `<mark>`）；③ 无分类/标签/类型/时间组合过滤；④ `$text` 未配 weights/default_language/中文分词，中文按空格标点切分的行为需实测。
- **数据模型要点**：`status` 0正常/1禁用软删/2私有；`draft` 布尔；`tags` 存名字字符串非 ObjectId；每集合只能有一个 text 索引（已被 `{name,content,tags}` 占用）。

---

## 2. 模块划分

### 2.1 分层与依赖方向

只允许上层依赖下层，反向 import 判失败：

```
视图层   views/wiki/*.ejs · navConfig.js · header/footer/search 组件 · public/js/wiki.js
   ↓
控制器   controllers/wiki.js · space.js · indexAdmin.js ｜ 改造 content.js / contentAdmin.js / 搜索线
   ↓
服务层   services/wikiTree.js（建树/防环/面包屑）· services/searchQuery.js（组合过滤/分词/高亮）
   ↓
数据层   models/Space.js（新增）· 改造 models/Content.js / constants.js ｜ Tag.js / Category.js 结构不变
```

### 2.2 新增模块

| 层 | 模块（建议路径） | 职责 | 阶段 |
|---|---|---|---|
| 数据 | `models/Space.js` | `name/slug/description/visibility/owner/时间戳`，slug 唯一 | 增强 |
| 服务 | `services/wikiTree.js` | 一次查询建树、排序、循环引用检测、生成面包屑 | 增强 |
| 服务 | `services/searchQuery.js` | 组合过滤拼装、中文 token 化、安全高亮 | MVP |
| 控制器 | `controllers/indexAdmin.js` | text 索引重建/状态、回填进度 | MVP |
| 控制器 | `controllers/wiki.js` / `space.js` | Wiki 页面树 / 空间管理 | 增强 |
| 迁移 | `scripts/migrate-doc-type.js` | `docType`/`searchBody` 回填，风格对齐 `migrate-html-to-md.js` 的 `--report/--backup/--apply/--rollback` | MVP |
| 前端 | `public/js/wiki.js` | 快捷键唤起、高亮渲染、目录树折叠（树部分增强） | MVP/增强 |

### 2.3 改造模块

| 文件 | 改造点 | 不改的部分 |
|---|---|---|
| `models/Content.js` | 加字段；扩展 `visibleTerm`；`update` 白名单；重建 text 索引定义 | `searchText`/`enrichDocs`/`addView`/admin 混入不动 |
| `models/constants.js` | 加 `DOC_TYPE`、`SPACE_VISIBILITY` 枚举 | `PER_PAGE_COUNT=9`、状态 0/1/2 不动 |
| `controllers/content.js` 的 `buildFields()`（~13-41） | 归一化 `docType/spaceId/parent`，生成 `searchBody` | 现有归一化主线不动 |
| `controllers/contentAdmin.js`（columns 85,136） | **实现期修正：不改 columns**——CSV 导入是严格表头匹配（`adminIo.js:32`），加列会让全部旧 CSV 失效。Wiki 字段走编辑器/API 与 WP2 独立 `.md` 导入 | 2MB/1000 行限制不动 |
| `navConfig.js` / `header.ejs` / `footer.ejs` | 前台加 Wiki 入口；后台加管理组 | `zones.primary.forEach` 机制不动 |
| `search.ejs`→`contentPanel.ejs`→`postCard.ejs` | 接高亮片段；加 `/` 与 Ctrl/Cmd+K 唤起 `#nlSiteSearch` | 保持 `<%= %>` 默认转义 |

---

## 3. 核心数据模型及字段关系

### 3.1 新增字段（全部落在 `content`，除非标注）

| 字段 | 类型 | 约束 | 默认 | 说明 |
|---|---|---|---|---|
| `docType` | String enum `blog`\|`wiki` | 必填（schema 层） | `blog` | 文档类型；与 `contentType` 正交，绝不复用 |
| `spaceId` | ObjectId → `spaces` | 可空；索引 | `null` | 所属空间；`null`=默认空间/普通博客。**MVP 预留，增强启用** |
| `parent` | ObjectId → `content` | 可空；sparse 索引；写入防环 | `null` | Wiki 父页面；`null`=根页，多层。**MVP 预留，增强启用** |
| `searchBody` | String | 服务端派生，禁前端直写 | `''` | Markdown 去标记纯文本，供 text 索引算相关度；MVP 即用 |
| `wikiOrder` | Number | 可空；索引末位 | `0` | 同级排序；MVP 可用 `createTime` 代替 |

`spaces` 集合（增强）：`name`(必填)、`slug`(唯一)、`description`、`visibility` enum `public|private`(默认 public)、`owner`(ObjectId→User)、时间戳。

### 3.2 关系口径

- Blog 文章 = `docType:'blog'` + `spaceId:null` + `parent:null`。
- Wiki 页 = `docType:'wiki'` + `spaceId` 指向空间 + `parent` 指向父页。
- Category 维持原两级分类语义，作为 Blog/Wiki **共用**的分类维度，**不承载 Wiki 树**。
- Tag 仍以名字字符串存 `Content.tags`，经 `Tag` 文档的 `name/slug` 对应。

### 3.3 复用 / 新增 / 禁止复用

- **复用**：`status`、`draft`、`slug`、`tags`、`seo`、`category`、`author`、`visibleTerm`、`searchText`、`syncTags/reconcileForContent`。
- **新增**：上表 5 字段 + `spaces` 集合。
- **禁止复用**：`contentType`（只是 html/markdown 格式）、`source`/`sourceAppId`（immutable + 静态断言）、`Category.parent`（两级分类，非页面树）。
- 不为 Wiki 新增布尔开关字段——用 `docType` 枚举判定，从根上规避 `draft` 那种「历史文档缺字段被 `false` 漏掉」的坑。

### 3.4 写入白名单三处同步清单（漏一处就存不进/读不出）

| # | 位置 | 必须改什么 |
|---|---|---|
| ① | `ContentDAO.prototype.update`（显式 `$set`，~404-423） | 加 `docType/spaceId/parent/searchBody`；`searchBody` 由调用方传已生成值；**不得出现 `source` 字样** |
| ② | `buildFields()`（~13-41，API 与表单共用唯一入口） | 解析 `docType`（枚举白名单，非法即 400）、`spaceId/parent`（ObjectId 校验）、生成 `searchBody`（MD→纯文本）；默认值走显式 resolve |
| ③ | 各查询 `select(...)`（已补 `docType`）；**`contentAdmin.js` 的 columns 故意不改**——CSV 严格表头匹配，加列破坏旧 CSV。如需导出文档类型，另起独立端点，不改现有 columns |

补充：`_adminDao.adminUpdate` 自身只 `delete _id`、无字段白名单，故必须在 controller 层做入口校验。开放 API 复用 `buildFields()`，一处改全局生效。

### 3.5 索引设计

**保留全部现有索引**。新增 B-tree 索引：

| 索引 | 用途 |
|---|---|
| `{docType:1, spaceId:1, status:1, createTime:-1}` | 空间内文档列表（增强） |
| `{parent:1, status:1}`（sparse） | 取子页面建树，避免 N+1（增强） |
| `{spaceId:1, parent:1, wikiOrder:1}` | 空间树排序（增强） |
| `{docType:1, createTime:-1}` | 按类型筛选列表（MVP） |

**唯一 text 索引的处理（关键）**：不新建第二个，低峰期 drop 重建同一个：

- 字段由 `{name,content,tags}` 调整为 `{name,searchBody,tags}`——`content` 是带 `#`/``` 的 Markdown 原文，标记干扰分词且索引体积大，改用派生纯文本 `searchBody`。
- weights 建议 `name:10, tags:5, searchBody:1`；`default_language` 实测后定：中文为主设 `none` 关闭无意义词干化。**索引实际名称以 `db.content.getIndexes()` 为准，不臆造**。

---

## 4. 关键接口

沿用现有响应包装，不臆造新格式。分页默认 9、上限 50。
**权限缩写**：公开=无鉴权中间件、可见性由 `visibleTerm` 在数据层过滤；L=登录+controller 内归属判定；A=管理员（role===0）。

### 4.1 前台公开（沿用既有路由扩展，MVP）

| 路径 | 方法 | 入参 | 出参 | 权限/状态 |
|---|---|---|---|---|
| `/content/search` | GET | `word,page,docType?,categoryId?,tag?,from?,to?` | `docs[]`(每项含高亮字段)、`total/page/totalPage/url` | 公开；`visibleTerm` 过滤；老调用零变化 |
| `/content/search` | POST | `word` | 标题联想列表（220ms 防抖+AbortController 沿用） | 公开；仅标题正则 |
| `/content/category` | GET | `categoryId,docType?,page?` | 分页列表 | 公开；扩展 docType 过滤 |
| `/tag/:slug` | GET | `slug,docType?,page?` | 分页列表 | 公开；扩展 docType 过滤 |
| `/content/detail` | GET | `id/slug` | 正文 + 面包屑（Wiki 页 parent 链） | 公开；`visibleTerm` 过滤，不可见 404 |

### 4.2 后台 /manager（MVP）

| 路径 | 方法 | 入参 | 出参 | 权限/状态 |
|---|---|---|---|---|
| `/manager/wiki/import` | POST | `.md` 文本或 CSV（2MB/1000 行上限沿用） | 成功/失败逐行报告 | A；`.md`→`contentType:'markdown'`+`docType:'wiki'`；按 `slug+spaceId` 幂等 |
| `/manager/index/rebuild` | POST | `reason?` | 任务 id/状态 | A；单任务锁防并发；低峰执行 |
| `/manager/index/status` | GET | — | 当前索引定义、`searchBody` 覆盖率、上次重建结果与时间 | A |
| `/manager/content/add`(或复用 `/content/add`) | POST | 现有字段 **+ `docType,spaceId,parent`** | 文档 id/结果 | L + owner 判定；Wiki 页写入需 space owner 或管理员（增强）；入参无 source |

### 4.3 增强阶段新增

| 路径 | 方法 | 入参 | 出参 | 权限/状态 |
|---|---|---|---|---|
| `/wiki/spaces` | GET | — | 空间数组（仅 public 或自己 owner） | 公开；查询层过滤 |
| `/wiki/tree` | GET | `spaceId` | `[{id,slug,name,parent,children[]}]` | 公开；只返回可见页面 |
| `/wiki/pages` | GET | `spaceId,parentId?,page?,limit?` | 子页面分页列表 | 公开 |
| `/wiki/page/:slug` | GET | `slug` | 正文 + `breadcrumb` | 公开；`visibleTerm` 过滤 |
| `/manager/wiki/space` | POST/PUT | `name,slug,description,visibility` | 空间 id/结果 | A |
| `/api/upload/attachment` | POST | 附件二进制 + 业务校验 | 附件 id/下载签名 URL | L；魔数嗅探、随机重命名、非 Web 根存储 |

> 分类/标签管理 CRUD 全部沿用现有 `/manager` 路由，columns 不动（见 §3.4 实现期修正）。

---

## 5. 搜索设计与索引更新策略

### 5.1 检索体验四件套如何在现有 `$text` 上落地

1. **全文搜索**：`GET /content/search` 已走 `$text`+textScore，扩展参数即可复用；默认搜全部（blog+wiki 一体），`docType` 可选收窄。
2. **快捷键唤起**：`/` 与 Ctrl/Cmd+K 唤起现有 `#nlSiteSearch` 浮层并聚焦，Esc 关闭——纯前端改造，复用 `footer.ejs` 里的开关；在含输入框的页面不劫持原输入行为。
3. **分类/标签过滤**：服务端把 `docType/categoryId/tag/from/to` 作为普通条件与 `$text` **同层 AND**（单查询只能有一个 `$text`，不许包在 `$or` 里再放另一个），排序仍用 `{score:{$meta:'textScore'}}`。MVP 支持单维切换，增强支持叠加。
4. **关键词高亮（安全底线）**：保持 `<%= %>` 默认转义不变。流程固定为 **escape → 对转义后文本按 token 包裹 `<mark class="nl-hit">` → 仅此片段以 `<%- %>` 输出**；绝不对原始 HTML 或 `content` 原文直接 `<%- %>`。含 `<script>` 的 query 必须原样显示为文本。

### 5.2 Markdown 相关度与中文召回

- `searchBody` 在 `buildFields()` 中由 MD 原文生成（渲染后剥标签取纯文本），随文档写入即更新，与 `name/tags` 一起进 weights，textScore 排序与组合过滤可共存。
- 中文分词是 MongoDB text 索引的硬约束（不能靠配置解决）。**MVP 混合召回**：先跑 `$text` 主召回，再对中文 query 安全 token 化后跑标题/标签/`searchBody` 的 `$regex` 兜底，**两路查询在应用层合并、去重、按 `textScore` 优先排序**。token 转义正则元字符、单 token ≤32 字符、最多 8 个 token，防 ReDoS。真中文分词（Meilisearch/ES）列二期，由召回红线结果触发。
  - **修正（版本核对后，重要）**：不得把 `$text` 与 `$regex` 塞进同一个 `$or`。MongoDB 规定 `$text` 出现在 `$or` 时所有分支都必须有索引（`$regex` 分支做不到），且聚合管道里 `$text` 根本不能进 `$or`/`$not`。两路独立查询 + 应用层 merge 是唯一稳妥做法。
- **版本适配（MongoDB 4.4.6 已确认）**：4.4 支持 text 索引 `weights`、`$meta:textScore`、`default_language:none`、sparse/复合索引——索引重建方案成立，无需调整。4.4 支持多文档事务但需副本集，方案本就不强上事务（靠 `reconcileAllCounts` 对账），故不受部署拓扑影响。实施前只需记录一次部署拓扑（standalone / 副本集）备查。

### 5.3 索引更新三时机

| 时机 | 做法 |
|---|---|
| 实时 | text 索引由 MongoDB 随写入自动维护，**无需自建同步任务**；守住的点是 `searchBody` 必须在写路径生成 |
| 增量回填 | 对 `searchBody` 缺失/为空的历史文档批量生成：幂等（只更新空值）、分批 1000、批间 50ms、记录断点可中断 |
| 全量重建 | `/manager/index/rebuild` 低峰执行：「备份当前索引定义 → dropIndex → 按新字段/weights createIndex → 回填校验 → 记录结果」；单任务锁防并发 |

**失败降级**：重建窗口内 `$text` 不可用，搜索自动切到标题正则路径，UI 显示「索引维护中」；失败按备份定义恢复原索引。降级不白屏、不 500。

---

## 6. 与现有博客数据/页面的衔接

| 衔接点 | 方案 |
|---|---|
| 历史数据纳入 | `docType` 默认 `blog` 只对新文档生效，历史文档确实缺字段；回填脚本补 `docType:'blog'`+`searchBody`。回填完成前的过渡期，博客列表查询用 `{docType:{$ne:'wiki'}}` 而非 `{docType:'blog'}`（draft 教训）。回填后 `count({docType:{$exists:false}})=0` 验证 |
| 路由/页面复用 | 现有详情/列表路由与 `contentPanel.ejs`/`postCard.ejs` 原样复用；Wiki 只新增 `/wiki/*`（增强），不改任何现有 URL，SEO 与收藏不失效 |
| 草稿/可见性 | Wiki 页复用 `status`(0/1/2)+`draft`+Vditor 本地会话草稿，不新字段；`visibleTerm` 扩展为：public 空间沿用原口径，private 空间仅 owner+管理员可见。游客 `currentUser=null` 自动只看公开——路由仍公开，过滤在查询条件里 |
| 标签计数不漂移 | Wiki 页与博客文章走**同一个** `syncTags/reconcileForContent(oldTags,newTags)`；所有写 tags 路径都要调用：新建、编辑、删除/软删、`.md` 导入。content 与 tag count 跨文档不强上事务，失败记日志并用 `reconcileAllCounts` 定时对账 |
| 导航接入 | 只改 `navConfig.js`：primary 加「Wiki/知识库」入口、cta 区扩为「写文章/新建 Wiki 页」；admin.groups 加「Wiki 管理」组（页面/导入/索引状态）。`header.ejs` 机制不动 |
| 已知取舍 | `tag.count` 仍是全集合口径（含 Wiki），标签页按 `visibleTerm+docType` 过滤展示，计数可能略大于展示数。MVP 接受并写入已知限制；精确计数列二期 |

---

## 7. 分阶段交付计划

### 7.1 优先级排序（RICE）

`Score = (Reach × Impact × Confidence) / Effort`，Reach/Effort 为 1–10 相对值，Impact∈{0.25,0.5,1,2,3}。

| 排名 | 候选功能 | R | I | C | E | Score | 阶段 |
|:---:|---|:-:|:-:|:-:|:-:|:---:|---|
| 1 | `docType` 字段扩展（含默认回填） | 10 | 2 | 100% | 1 | **20.0** | MVP·前置依赖 |
| 2 | 文档在线录入（复用 Vditor） | 6 | 3 | 100% | 2 | **9.0** | MVP |
| 3 | 搜索快捷键唤起 | 8 | 1 | 100% | 1 | **8.0** | MVP |
| 4 | 分类/标签过滤（单维） | 8 | 2 | 80% | 2 | **6.4** | MVP |
| 5 | 搜索结果关键词高亮 | 8 | 1 | 100% | 2 | **4.0** | MVP |
| 6 | 文档上传导入（.md 单文件/小批量） | 4 | 2 | 80% | 2 | **3.2** | MVP |
| 7 | 中文分词增强 | 8 | 3 | 50% | 5 | 2.4 | 红线触发→增强 P0 |
| 8 | 多维组合过滤（分类+标签+时间+类型） | 5 | 1 | 80% | 3 | 1.33 | 增强 |
| 9 | 页面树 / 层级组织 | 5 | 2 | 50% | 5 | 1.0 | 增强 |
| 9 | 检索引擎升级（ES/Meilisearch） | 8 | 2 | 50% | 8 | 1.0 | 后续 |
| 11 | 更多导入格式（docx/PDF/ZIP） | 3 | 1 | 80% | 4 | 0.6 | 增强 |
| 12 | 协同编辑（OT/CRDT） | 3 | 3 | 50% | 9 | 0.5 | 后续 |

**为什么 MVP 先做前 6 项**：三者同时成立——(a) 复用既有能力，Effort 低；(b) 用户原话点名，Confidence 高；(c) 全是追加式改动，对既有路由和数据结构零语义改动，破坏风险最低。第 1 项是其余功能的前置依赖，不作为独立用户价值交付。第 7 项 Impact 高但成本高、确信度低，用召回红线先证伪再投入。

### 7.2 MVP 阶段

**圈定标准**：① 不破坏原博客（追加式、默认行为不变）；② 用户能感知 Wiki 价值（检索可见升级 + 能录入/导入文档）。

**包含**：`docType` 扩展与回填；文档在线录入（Vditor）；.md 上传导入；文档复用分类/标签并可浏览；全文搜索复用并支持 docType 过滤；搜索快捷键；关键词高亮；单维分类/标签过滤；索引重建/状态与降级。

**不包含（附理由）**：独立 Wiki 集合（搜索分裂、回归面翻倍）；页面树（现有分类仅两级，MVP 用分类+标签二维满足导航）；多维组合过滤（UX 与查询复杂度高，先验证需求）；中文分词/引擎替换（高成本不确定）；PDF/docx/ZIP 导入（依赖外部解析）；文档级权限/协同/ACL（role 0/1 够用）；前台加鉴权（硬约束）。

### 7.3 增强阶段

| 能力 | 内容 | 依赖 | 不确定性 |
|---|---|---|---|
| 中文分词增强（红线触发则为 P0） | 提升中文召回与相关度 | 需先有 MVP 召回实测数据 | 中 |
| 多维组合过滤 | 分类+标签+时间+docType 叠加，可保存筛选视图 | MVP 单维过滤埋点 | 低 |
| 页面树 / 层级组织 | 启用 `spaceId`/`parent`，空间与父子页面、面包屑、树形导航 | 防环机制；与两级分类兼容策略 | 中 |
| 更多导入格式 | HTML、docx→MD、ZIP 批量 | 文档解析组件 | 中 |
| 文档版本历史 | 把 HTML↔MD 可回滚机制做成用户可见版本列表与回滚 | MVP 文档模型 | 低 |
| 权限细化 | 公开/登录可见/指定角色三档，仅在 /manager 配置 | 现有 session 鉴权 | 中 |

### 7.4 后续阶段

| 方向 | 内容 | 依赖 | 不确定性 |
|---|---|---|---|
| 检索引擎升级 | 迁 ES/Meilisearch，换分词、相关度与扩展能力 | 数据量上规模 + 召回仍不达标 + 运维能力 | 高 |
| 协同编辑 | OT/CRDT 实时多人编辑 | 真实协作需求验证 | 高 |
| ACL 细粒度授权 | 用户/组级授权矩阵 | 增强阶段权限三档有企业需求 | 中 |
| 双向链接/反链/知识图谱 | 页面引用网络 | 页面树稳定 + 内容规模 | 中 |
| 文档审阅发布工作流 | 多级审核、草稿/发布态 | 组织级流程需求 | 中 |
| 多语言 i18n | 界面与内容双语 | 海外用户信号 | 中 |

均不进入当前承诺范围，按验证信号与依赖成熟度逐项解冻。

### 7.5 验收要点

**MVP 放行条件 = A 全绿 + B 全绿 + R 全绿**；R-03 单独记录结论。

A. 功能可见性
- V-01 超管 `/manager` 见「新建文档」，Vditor 可保存为文档。
- V-02 前台有文档浏览入口，可按分类/标签浏览。
- V-03 任意前台页 Ctrl/Cmd+K 弹搜索、Esc 关。
- V-04 搜索命中词有视觉标记，一眼可辨。

B. 行为正确性（Given/When/Then）
- B-01 已存在博客文章，不带新参数访问 `GET /content/search` → 结果与升级前一致（排序不变）、无高亮、无 docType 泄漏。
- B-02 一篇 `docType=wiki` 文档含独有词「灰隼协议」，搜索该词 → 文档命中、词被高亮、文本与原文逐字一致。
- B-03（召回红线）3 篇中文关键词文档，用完整中文词搜索 → 至少 2/3 命中；不达标则中文分词在增强阶段提为 P0 并前置。
- B-04 搜索页选分类过滤 → 仅显示该分类内容；切换标签过滤同理，两种过滤不叠加。
- B-05 一个 `.md` 文件后台导入 → 生成 `docType=wiki` 记录，正文渲染正常、图片引用不丢。
- B-06 老数据无 `docType` → 列表/详情/搜索全部按博客渲染，无异常。

C. 不破坏回归基线（任一红项阻断发布）
- R-01 首页与列表条数/排序/分页与升级前一致。
- R-02 文章详情正文渲染、分类/标签、Markdown 图表正常。
- R-03 `GET /content/search` 原 URL 调用零变化（见 B-01）。
- R-04 分类页/标签页层级、计数、自愈正常，计数未因文档混入错乱。
- R-05 后台 CRUD（文章/分类/标签）照常可用。
- R-06 开放 API v3 只读响应结构不变，Wiki 数据不混入 v3 既有端点。
- R-07 快捷键无冲突：编辑页等含输入框处按 Ctrl/Cmd+K 不劫持原输入。

**增强/后续验收增量**：组合过滤交集语义正确；页面树移动后 URL 不断链；新格式导入正文与图片保真；版本回滚逐字一致；权限三档在匿名/普通/超管下可见性符合预期。

### 7.6 不破坏护栏（贯穿三阶段）

1. **追加而非替换**：只新增字段/路由/入口，不改既有字段语义、不用既有路由承载新语义。
2. **docType 向后兼容**：默认 `blog`，读路径对缺失字段一律当博客；任何阶段不反向批量改写老数据。
3. **搜索双轨**：`GET /content/search` 原契约永久保持；Wiki 增强走新参数或新入口，老客户端零感知。
4. **公开路由不加鉴权**：前台 Wiki 浏览与搜索匿名可读；鉴权仅在 /manager 边界。
5. **变更走可回滚迁移**：schema 变更必配正向+回滚脚本，上线前演练一次回滚。
6. **回归闸门**：R-01~R-07 每阶段上线前全跑，任一红项阻断。
7. **埋点不碰隐私**：只记事件与聚合属性，不上报正文原文/IP。

---

## 8. 风险与约束（每条可核对）

| # | 风险 | 规避与验证 |
|---|---|---|
| R1 | 触碰 source/sourceAppId 触发静态断言 | 新字段名避开 source 子串；跑 `test-api-credential.js:141-144`，grep update 前 900 字符 |
| R2 | 三处写入白名单漏改 → 存不进/读不出 | 新增文档后查库断言字段有值；导出含 docType；grep 三处 |
| R3 | 单 text 索引被误判「加不进去」 | `db.content.getIndexes()` 断言只有 1 个 text 索引；重建脚本含定义备份恢复 |
| R4 | 历史文档缺字段导致列表漏数据 | 回填后 `count({docType:{$exists:false}})=0`；保留 `$ne:'wiki'` 回归用例 |
| R5 | 前台被误加鉴权 | 公开路由零 authorize；游客访问公开页 200、私有页 404 两用例判死 |
| R6 | 越权看/改他人页面 | 归属条件进查询；A 用户编辑 B 用户页面 404 |
| R7 | 上传面扩大 | 魔数嗅探、随机重命名、大小上限、非 Web 根存储；新附件不沿用 `public/uploads`（存量风险） |
| R8 | 高亮引入 XSS | 转义后包 mark；query 含 `<script>` 输出纯文本且无脚本执行 |
| R9 | 标签计数漂移 | 四写入路径全覆盖 reconcile；迁移后 `reconcileAllCounts` 对账抽样一致 |
| R10 | Wiki 树 N+1/循环引用（增强） | 一次查询建树，DB 调用次数不随页面数增长；写入时检测自环与成环 |
| R11 | 性能无预算 | 搜索 P95≤500ms、树接口 P95≤300ms、读 TTFB≤500ms；`explain` 确认走索引；慢查询 3s 超时 |
| R12 | 备份/恢复缺位 | RPO≤24h、RTO≤4h（**待业务方确认**）；备份含 content/spaces/tags/users、uploads、配置、会话库；季度演练 |

**其他门禁**：不引入 emoji 图标（锁定一套本地 SVG 图标库，推荐 Lucide，全项目不混用）；禁紫→粉渐变；首屏 JS 增量≤30KB gzip（Vditor 是存量，不新增大库）。界面门与工程门分别报结果，不合并成一句「通过」。

---

## 9. 待业务方确认的三项（定了即可冻结方案）

1. **RPO/RTO**：暂定 RPO≤24h、RTO≤4h，需点头。
2. **私有空间可见语义**：暂定仅 owner + 管理员可见。
3. **标签计数口径**：MVP 接受 `tag.count` 含 Wiki 导致的轻微不一致（计数≥展示数）；精确计数列二期。

---

## 10. 端到端验证步骤（实施收尾即验收）

1. 备份 → `migrate-doc-type.js --report` → `--backup` → `--apply` → 断言 `docType:{$exists:false}` 为 0。
2. 新建 Wiki 页（MD 原文）→ 搜索中文词+docType+标签组合 → 结果含 mark、查询含 `<script>` 无脚本执行、P95≤500ms。
3. `.md` 导入重复执行 → 不产生第二条。
4. 编辑 tags → `tag.count` 与聚合一致。
5. 触发 `/manager/index/rebuild` → 期间搜索降级为标题正则且页面不 500 → 完成后索引定义/覆盖率正确、P95 复量达标。
6. 跑 `test-api-credential.js` + 上述门禁，真实输出贴齐。
7. 增强阶段：建空间→建父子页→树与面包屑正确、成环写入被拒；三档权限在三种身份下可见性正确。

---

## 11. 环境核对结论与开发任务排期（2026-11-20 增补）

### 11.1 环境核对结论

| 环境项 | 结论 | 对方案的影响 |
|---|---|---|
| MongoDB 4.4.6 | text 索引 weights / textScore / default_language:none / sparse / 复合索引全部支持 | 索引重建方案成立，无需改；单 text 索引限制仍在 |
| MongoDB 4.4.6 | `$text` 进 `$or` 时要求所有分支有索引；聚合 `$match` 中 `$text` 禁止进 `$or`/`$not` | **已修正** §5.2：中文兜底改为两路查询 + 应用层 merge |
| MongoDB 4.4.6 | 多文档事务需副本集；方案不强上事务 | 不受部署拓扑影响，实施前记录一次拓扑备查 |
| Node v16.20.2 | 是 Node 16 的最终版本 | 运行现有依赖无碍，但见下方 EOL 提醒 |

**业界提醒（不喧宾夺主）**：两个运行时均已停止官方安全支持——MongoDB 4.4 于 2024-02-29 EOL、Node 16 于 2023-09-11 EOL。不阻断本次开发，但建议列为独立的技术债任务择机升级（Node 升 LTS、MongoDB 升 7.0+），不要与 Wiki 功能混在一个 PR 里。

### 11.2 MVP 开发任务排期（WBS）

按依赖顺序分 5 个工作包（WP），WP 之间串行、WP 内部可并行。每个 WP 都带验收点，对应 §7.5。

| WP | 工作包 | 主要任务 | 依赖 | 交付物 | 验收点 |
|---|---|---|---|---|---|
| **WP1** | 数据地基 | 新增 `docType/searchBody/spaceId/parent` 字段与枚举；改三处写入白名单；写 `migrate-doc-type.js` 回填脚本 | 无 | Schema + 迁移脚本 | `count({docType:{$exists:false}})=0`；`test-api-credential.js` 静态断言通过 |
| **WP2** | 录入与导入 | 后台"新建文档"入口（复用 Vditor）；`.md` 导入接口；分类/标签接入文档；`buildFields` 生成 searchBody | WP1 | 录入页 + 导入接口 | V-01/V-02、B-05、B-06 |
| **WP3** | 检索底座 | 重建 text 索引（`{name,searchBody,tags}` + weights）；`GET /content/search` 扩展 docType/category/tag 过滤；中文两路召回 | WP1 | 索引 + 搜索服务 | B-01~B-04、R-03；单 text 索引断言 |
| **WP4** | 检索体验 | 快捷键（`/`、Ctrl/Cmd+K）；关键词高亮（安全 escape→mark）；搜索页与卡片接高亮片段 | WP3 | 前端交互 | V-03/V-04、R-07、R-08（XSS） |
| **WP5** | 回归与放行 | R-01~R-07 全量回归；索引重建降级演练；门禁与性能复量；Go/No-Go | WP1~WP4 | 验收报告 | MVP 放行条件全绿；B-03 单独记录结论 |

**并行建议**：WP2 与 WP3 可并行（一个动录入、一个动检索，交集仅在 WP1 的字段）；WP4 必须等 WP3。

**每条任务的实现约束**（写 Spec 时逐条转成 Checklist，防止实现期打折扣）：
1. 任何新增字段名不得含 `source` 子串；不在 `ContentDAO.update` 前 900 字符或 `content.js` 出现 `req.body.source`。
2. 新增字段三处同步：`ContentDAO.update` 显式 `$set`、`buildFields()` 归一化、各 query 的 `select(...)` + `contentAdmin.js` 的 columns。
3. 历史数据判定一律用 `{$ne:'wiki'}`，不用等值（draft 教训）。
4. `Content.tags` 写入后必调 `reconcileForContent`；导入路径同样覆盖。
5. 高亮只对 escape 后文本包 `<mark>`，仅片段用 `<%- %>`；原始正文永不以 `<%- %>` 输出。
6. 公开路由零鉴权中间件；可见性只在 `visibleTerm` 里做。
7. 索引重建脚本必须含定义备份与失败恢复，重建期搜索降级到标题正则且不 500。

### 11.3 实施前置确认（不阻塞排期，WP1 开工前拍板即可）

1. **部署拓扑**：MongoDB 4.4.6 是 standalone 还是副本集？——只影响是否可用事务（本方案不依赖），记录备查即可。
2. **三项业务确认**（沿用 §9）：RPO/RTO（暂定 24h/4h）、私有空间可见语义、tag.count 轻微不一致是否接受。
3. **是否按此排期开工**：WP1 只动 Schema + 迁移脚本，风险最低、可回滚，适合作为第一枪。

### 11.4 WP1 实施记录（2026-11-20 已落地）

**状态**：已实现，待在具备 MongoDB 的环境执行回填脚本。

改动文件：
- `models/constants.js`：新增 `DOC_TYPE_BLOG/WIKI`、`SPACE_VISIBILITY_PUBLIC/PRIVATE`。
- `models/Content.js`：新增 `docType/searchBody/spaceId/parent/wikiOrder` 字段；新增 `{docType:1,createTime:-1}`、`{parent:1,status:1}` sparse 索引；列表 `select` 补 `docType`；`update` 白名单补四字段。**text 索引定义保持不动**（留 WP3 drop+create）。
- `controllers/markdown.js`：新增 `toSearchBody(src,contentType)`——剥离 Markdown 标记/HTML 标签/代码块，不截断，供写入与回填共用同一口径。
- `controllers/content.js`：`buildFields` 新增 docType 枚举白名单（非法回退 blog）、spaceId/parent ObjectId 校验、searchBody 派生。
- `controllers/articleApi.js`：API 发布显式写 `docType/searchBody`，否则 API 文章进不了全文索引。
- `scripts/migrate-doc-type.js`：可回滚/幂等/乐观锁回填脚本，支持 report/backup/apply/verify/rollback。

自检结果：`node --check` 6 文件全过；`test-api-credential.js` **32 通过 / 0 失败**（来源静态断言保住）；`buildFields` 与 `toSearchBody` 口径单测 ALL PASS。

**待执行（需真实 MongoDB）**：`node scripts/migrate-doc-type.js --report` → `--apply` → `--verify` 确认 `docType` 缺失数为 0。本机无 mongod（`ECONNREFUSED 127.0.0.1:27017`），未跑实际回填；该报错是 require 时连接触发的既有行为，非本次改动引入。

下一步 WP2：后台"新建文档"入口 + `.md` 导入接口。
