# 项目状态（PROJECT_STATE）

> 每次 Phase 切换、成员回传、需求变更后增量更新。新会话先读这一页。

## 1. 目标与阶段
- 当前会话主线（2026-11-17）：开放接口从「静态 Token / v2 应用凭证」升级为 **v3 全应用统一鉴权 + 零配置 + 后台页面修复**。设计语言 Phase 0–4 为上一阶段历史，见下。
- 一句话目标：所有开放 API（文章/分类/公告/告警）统一走「后台建应用 → AppID + Secret 签 HMAC 换短期 token → token 调用」；`settings.js` 零密钥（主密钥首次启动自动生成落 MongoDB）；JWT 用每个应用 Secret 派生（应用隔离）；公告/告警 API 仅管理员应用可调用；来源可溯源且不可去除。
- 本阶段状态：代码已实现（前后端），`scripts/test-api-credential.js` **32/32 PASS**、全量 `node --check` 通过、EJS 编译通过；`announce-release.js` 与 `test-alert-api.js` 正迁移到 v3 鉴权。**待联调收口 + 用户确认是否切生产**（静态 token 对全部开放 API 已废弃，切生产即不可逆对外生效）。
- 契约源：`.workbuddy/spec-api-app.md`（v3）；接口文档：`docs/article-api.md`（v3，按用户约定不提交）。

### v3 关键实现（实读要点，勿重复排查）
- 零配置：`models/SystemConfig.js` `getOrCreateMasterKey()` 原子生成/读取主密钥存 `system_config`；`apiCredential.init()` 在路由挂载前异步调用；env `API_APP_ENCRYPTION_KEY` 仅多实例共享可选覆盖；`settings.js`/`settings.example.js` 已删全部密钥字段。
- 应用隔离 JWT：`apiCredential.jwtKeyFor(secret)=HMAC_SHA256(secret,'nodelog-api-jwt-v3')`；A 应用 token 用 B Secret 验不过；无全局 tokenSecret。
- 统一鉴权工厂：`articleApi.authenticate({adminOnly})` 导出供文章/分类/公告/告警复用；流程 = Bearer → peek appId → 查应用解密 Secret → 派生密钥验签 → 校验应用/用户启用 → adminOnly 查 `role===0` → 挂 `req.apiApp`/`req.apiAuthor`。静态 `loadApiConfig`/`resolveToken` 保留函数体但不再被开放 API 使用。
- 权限模型：API 声明式 `adminOnly`；公告 `/api/announcements` 与告警 `/api/alert/status|probe` = adminOnly；文章/分类 = 普通。后台应用编辑弹窗只读展示该应用可调用 API 清单。
- 页面修复：`apiAuth.list` 用 `Content.countBySourceApps(ids)` 一次聚合替代 N+1；`views/manager/apiApp.ejs` 新增/编辑改模态弹窗（z-index 2000）、修 `<select>` 下拉、空用户提示、`data-role` 注入按角色展示权限、EJS 转义 + textContent 防 XSS。
- 来源溯源（v2 保持）：`Content.source`/`sourceAppId` immutable + controller 不读 + DAO 白名单不含；API 发布强制写来源与绑定用户作者。

### 历史阶段（上一条主线，已完成）
- 一句话目标：为 NODELOG 前台重定义一套独特、高端、统一、可落地的设计语言，解决「排版辨识度不足、风格偏普通」，并交付首页/列表页/文章页的明暗 × 移动端应用效果。
- 当前阶段：Phase 4（生产落地 · 方向切换）**已完成**——「云笺 · Cloudletter」已**替换**「登记簿 / The Numbered Register」落到生产：`public/css/theme.css` 令牌层与组件全面改写为蓝绿双色 + 柔光卡 + 胶囊按钮 + 720px 阅读栏 + featured/grid/compact 列表；改写 `views/**/*.ejs` 套用新结构。Phase 3 的登记簿令牌已整体退役。
- 档位：小组（交付总监 + 设计师 + 前端）
- 形态判定：**设计语言规范 + 高保真呈现页**（不是改生产代码，不动后端）。用户要的是「规范 + 关键参数 + 页面应用效果，便于直接用于前端实现」。

## 2. 已完成
> 只写产物路径，不写「做完了」。

- [x] 现状诊断（读 `DESIGN.md` / `design-tokens.json` / `design-choice.json` / `public/css/theme.css` / 三页面 EJS）→ 口头结论 + 本文件
- [x] 编排单按内容站形态重取（`design_query.py --brief`，否决 `--plan` 误判的营销页编排）
- [x] 团队与任务台账 → `nodelog-design-language`
- [x] 真渲染验收链路（本机 Chrome 无头截图，替代缺失的 python playwright）→ `design-language/.gates/shots.sh` + `.gates/shots/*.png`（12 张）
- [x] 设计契约 `design-language/DESIGN_LANGUAGE.md`（504 行 / 58KB，14 节 + 6 子节，全参数 hex/px/ms/断点）
- [x] 可落地 tokens `design-language/tokens.css`（315 行，九槽 + 语义四件套 + 8 档字号 + 间距/圆角/动效/焦点环，含现有 EJS 类名映射骨架）
- [x] 高保真呈现页 `design-language/index.html`（1758 行，零依赖、内联 SVG、三页 × 明暗 × 桌面/移动 12 组合，URL 协议 `?page&theme&vp`）
- [x] 门禁 + 真渲染验收（见 §3 结论）
- [x] Phase 3 生产落地（用户授权「授权落地改生产文件」后执行）：
  - `public/css/theme.css`：令牌层已就位（九槽/语义四件套/8 档字号/间距/圆角 0·4·8·12/`--wrap:1120`/`--measure:680px`/`--font-ui:sans`/动效变量/登记轨变量）；**删 9 类贴皮**：`bg-gray` 点阵底、14.5「精致化升级」段（kicker 渐变条 / 封面 scale / 头条实体浮起面板 / `#1d4ed8`·`#0891b2` 渐变 / accent-2 / 卡片悬浮抬升 / brand-card 渐变 / color-mix / 发光）、`.card` box-shadow、`.post-grid` 两列网格；**新增**：`.register`/`.reg-rail`/`.reg-tick`（绝对定位 72px 左缘登记轨，≥768 右对齐 mono + 1px 基线竖线）、文章 `.article-rail`（72/680/232 栅格左缘）、移动端 `--rail:48px` 收轨。`:root` 重建 `--accent-2: var(--accent-press)` 后台兼容别名，避免弄坏 `views/manager/index.ejs` 的渐变。
  - `views/common/postCard.ejs`：封面统一为扁平 `.post-cover`（去 `--lead` 渐变容器与 shine 光晕）；非 lead 条目注入 `.reg-rail`（№ 序号 + 日期 + 年份），序号由父循环下标 `i+1` 传入。
  - `views/index.ejs`：`.post-grid` 挂 `register`；非首篇由 `grid` 变 `list`（连续编年登记流），首篇为透明登记带 lead。
  - `views/contentPanel.ejs`：`.post-list` 挂 `register`，传入 `index`。
  - `views/contentDetail.ejs`：`.article-detail` 内注入 `.article-rail`（发布日期 + 阅读时长），移动端隐藏。
  - `views/common/sidebar.ejs`：删终端 `❯` glyph 与营销腔「专业级技术写作引擎…稳得不像话」，改为登记簿口吻。
  - `views/header.ejs`：去 `bg-gray` 点阵类。
  - 自查：P0 红项 grep —— `transition:all`=0、`backdrop-filter`=0、`ch` 仅注释、`color-mix` 仅注释、贴皮 emoji 符号=0；`postCard.ejs` 经 ejs 编译校验通过（输出含 `reg-rail`/`№03`、无 `--lead`/shine）。
  - 未做：本环境无 `mongod`，未跑真渲染截图（上次 12 张真渲染用于规范页，生产落地为机械式 CSS/EJS 改，建议用户本地 `node ./bin/www` + Chrome 复验。

- [x] Phase 4 生产落地（用户回复 `1` 选「采用云笺替换登记簿」，再回复「开始落地」后执行）：以 `design-language/cloudletter-design-language.md` 为契约、`cloudletter-preview.html` 为呈现页验收，把「云笺 · Cloudletter」落到生产，**整体替换** Phase 3 的登记簿。
  - `public/css/theme.css`：令牌层全面改写——蓝 `#2563EB` + 绿 `#10B981` 双色、`--bg:#EEF2FA` 浅薰衣草蓝底、`--surface:#FFF`、`--ink:#1F2937`；8 档字阶（正文 17/1.8 不缩）；间距 `--sp-1..9`；圆角刻度 `xs6/sm8/12/lg16/pill999`；阴影三档 `--shadow-sm/--shadow/--shadow-lg` + `--glow-accent` 彩色微光；栅格 `--wrap:1200`/`--measure:720`/`--aside:280`；动效变量沿用。**删登记簿**：`.register`/`.reg-rail`/`.article-rail`/`.post-flag`(保留样式)/登记轨变量/九槽青绿全部移除。**新增 Cloudletter 组件**：`.card`(白底+16px圆角+柔光+`.hov` hover 抬升)/`.post-card--lead`(featured 大卡，封面 21/9 圆角)/`.post-card--grid`(两列卡)/`.post-card--list`(紧凑归档行，mono 日期+标题+基线分隔)/`.cat`(pastel 胶囊分类)/`.pill`+`.section-head`(栏目头范式)/`.reading`+`.lead`(720 阅读栏+首段导读)/`.comments`(评论卡)/`.btn-accent2`(绿次按钮)/品牌 `.brand-mark`+`.card--brand`；导航新增 `.brand-mark-sq` 渐变方标 + `.blog-tag` + 分类菜单 hover/current `::after` 下划线滑入；`.navbar` 改为 `surface` 白底 + `--shadow-sm`；`:root` 重建 `--accent-2:#10B981` 后台兼容别名（保 `views/manager/index.ejs` 渐变）。
  - `views/common/postCard.ejs`：三形态——lead=featured 大卡(`.card.hov`+封面 21/9+`.cat`+h1+`.post-flag`+excerpt+`.post-readmore`+chips)；grid=两列卡(`.card.hov`+顶圆角封面+`.cat`+h3+excerpt+chips)；list=紧凑行(无卡，`.post-date` 为 grid 直接子列 + h2 + meta)；删 `.reg-rail`。
  - `views/index.ejs`：首篇 lead(featured) + `.section-head`(栏目头) + 其余 `.post-grid` 两列；删 `register` 类与 kicker 重复。
  - `views/contentPanel.ejs`：`.post-grid` 两列卡（category/search/myContent 共用）；删 `register`。
  - `views/contentDetail.ejs`：`.article-detail.reading`(720 左对齐) 去 `.article-rail`；新增 `.lead` 首段导读(取 `doc.excerpt`)；评论区 `<section class="card comments">`；整页用 `.article-shell` 收进 720 居中壳层（文章页无侧栏，避免右侧大片留白 + 表单卡与正文等宽对齐）。
  - `views/common/sidebar.ejs`：品牌文案去「登记簿」口吻，改云笺文案。
  - `views/header.ejs`：品牌加 `.brand-mark-sq` 渐变方标 + `.blog-tag` BLOG 胶囊；CTA 由 `btn-primary` 改 `btn-accent2`(绿)。
  - 验收：EJS 全量编译 + 含 include 的整页渲染冒烟（mock 数据）通过；本机 Chrome 无头真渲染截图（首页 light/dark 1280×2200、文章 light 1280×2400）确认——白吸顶栏+渐变 N 标+BLOG 胶囊、featured 柔光大卡、两列网格卡、栏目头、侧栏、页脚、720 阅读栏(标题40/blockquote 4px 竖条/code 块/表格)、评论卡、深色 navy 调性均正确；零横向溢出。
  - 已知小项（非阻断）：文章页无侧栏故阅读栏居中而非左对齐（刻意，避免右侧空）；网格卡无封面时高度参差（生产文章普遍有封面）；P0 红项 grep 全 0（无 `transition:all`/`backdrop-filter`/`color-mix`/`ch`/emoji 图标）。

## 3. 验收结论（门禁红项全部误判 / 设计意图内，无真实阻断）
- `design_presence_check`：4 FAIL 因把**内容站误判为营销页**（满宽色块 / 展示级 ≥3.5× 大标题 / 插画大图 / 2+ 种 section 内边距 均为营销标准）；内容站相关的 构图多样性 / 非卡片内容块 / 示意图 / 明度层级 4 项 PASS。
- `layout_variety_check`：10 FAIL 因把「连续编年登记流」（A 决策，故意不用卡片网格）记为家族重复 + 真实长文章标题超 20 字营销上限。
- `visual_metrics`：VM33(3 h1)=`<template>` 惰性块静态误报，运行时唯一；VM37(kicker)=编辑式 eyebrow，h1 仍主导；VM13(5 色相)=accent+语义四件套，语义色只出现在状态块/速览；VM50(控制条选中态)=预览脚手架。
- `craft_baseline`：彩色侧边框 = 导航 current 竖线（accent 4 类位置之一）；卡片圆角 8px = 刻意扁平（规范规定圆角只 0/4/8/12，不用 16）。
- 真渲染 12 张：辨识度高（编辑/登记簿气质，不像模板）、暗色沉稳克制、移动端零横向滚动、17px 不缩、左缘登记轨三页同位置同尺寸。
- 已知小项（非阻断）：深色模式 12px 辅助文字（SVG 编号 / 头条 flag）用 `--muted`=`#A6B8BE` on `#121D22` = 8.35:1，实测达标，仅小字号观感偏淡；如需更稳可微调 `--muted` 深色档。

## 4. 已决策（原待决策已闭环）
| 问题 | 结论 |
|---|---|
| 视觉方向 | **先采纳「登记簿 / The Numbered Register」**（Phase 3 落地）；后对照参考站 `saas.jiangzi.xin` 母本出「云笺 · Cloudletter」呈现页验收，用户回复「开始落地」**切换为 Cloudletter 并替换登记簿**（Phase 4） |
| 是否落地生产 | **授权落地改生产文件**（用户确认）；参考站 jiangzi.xin / saas.jiangzi.xin 经实抓分析判定**不参考**（两套体系不统一、品类不匹配、手法触发 P0）——但 saas 的「蓝绿双色 / 圆润 / 柔光 / 留白」调性被抽取为 Cloudletter 母本 |

## 5. 下一步
1. **当前（2026-11-18）**：新增前台公开「开发平台」入口 + 独立开放 API v3 文档页 `/dev`（小组档，前端成员产出 `views/openPlatform.ejs`，主理人集成 `navConfig.js` / `routes/index.js`）；博客版文档保留。完成后需部署生产并 Chrome 复验桌面/移动。
2. 用户本地 `node ./bin/www`（需 MongoDB）起服，Chrome 复验首页/列表/文章三页明暗 × 桌面/移动，重点看蓝绿双色、featured/grid 卡片、720 阅读栏、评论卡、深色 navy 调性是否对齐呈现页 `design-language/cloudletter-preview.html`。
3. 后台 `views/manager/**` 仍走 `style.css`/`docs.min.css`，本次只动了前台 `theme.css` 令牌——后台渐变依赖 `--accent-2` 已从青绿改为绿 `#10B981`，需顺手在后台起服时扫一眼导航/按钮配色。

## 6. 边界与约束（实读事实，勿重复排查）
- 工作区 `master` 已有他人未提交改动；Phase 3 曾约束「只在 `design-language/` 新建文件」，Phase 4（用户授权「开始落地」）**已解除该约束**，正式改 `public/css/theme.css` 与 `views/**/*.ejs`。
- 既有契约是上一轮继承式产物，本次是「换视觉世界」不是收口。
- 现有视觉问题根因：`theme.css:148–207` 终端贴皮 + 通用墨蓝 `#1d4ed8` + 系统字体一把梭 + 卡片网格到底。
- 站点自称「打造最快的搜索体验」，作者「匠子心」，无可用真实摄影图（故头条默认「登记带」而非封面）。
- 反模板：避开第一波（紫渐变/三卡/emoji）与第三波（米黄奶油底+陶土锈橙+高对比衬线+满屏发丝线报纸腔）。
- P0：禁 emoji 图标、禁紫粉渐变、禁渐变文字/发光、禁居中 Hero+三卡、禁 rounded-2xl、禁贴皮极客符号；零新增依赖。
- 门禁只认目录根下 `.html`；须 `--root design-language` 避免全项目历史 CSS 假红。
