---
name: NODELOG 前台设计契约
phase: 2
owner: 颜好看 (UI/UX)
mode: Read（内容优先）；仅首页首屏含一处 Persuade 式主角
register: Product（设计服务内容）+ Read
status: 继承 theme.css 既有身份，做系统性收口，不换视觉世界
colors:
  bg: "#f9fafb"
  surface: "#ffffff"
  surface-2: "#f2f4f7"
  border: "#e0e3e6"
  border-strong: "#8b939e"
  ink: "#171b21"
  muted: "#606a76"
  accent: "#1d4ed8"
  on-accent: "#ffffff"
  danger: "#c32d28"
  warning: "#8a5a0a"
  success: "#2f7d5d"
  info: "#1d4ed8"
  ring: "#1d4ed8"
typography:
  display:
    fontSize: 61px
    fontWeight: 500
    lineHeight: 1.30
    letterSpacing: 0
  title:
    fontSize: 46px
    fontWeight: 500
    lineHeight: 1.30
    letterSpacing: 0
  h2:
    fontSize: 34px
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: 0
  lead:
    fontSize: 22px
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: 0
  body:
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: 0
  caption:
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0.01em
rounded:
  none: 0px
  sm: 8px
  md: 12px
  control: 999px
spacing:
  xs: 4px
  s: 8px
  m: 12px
  l: 16px
  xl: 24px
  xxl: 32px
  section: 48px
  gap: 72px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    radius: "{rounded.sm}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    radius: "{rounded.md}"
  state:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    radius: "{rounded.md}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    radius: "{rounded.sm}"
---

# NODELOG 前台设计契约 · Phase 2

> 本文件是唯一设计源。前端按 `design-tokens.json` 取值，QA 按 `design-choice.json` 对账。
> 硬约束：保留全部路由、数据接口、内容结构，以及所有 `js-*` / `data-*` / `id="tagCloud"` 钩子；不新增标签功能、不新增依赖、不换框架。

## 0. 主张与两处自定决定

**一句话主张**：「首屏是一篇文章，导航是一条检索」——NODELOG 自称「打造最快的搜索体验」（`common/meta.ejs:20`），所以顶栏右端常驻搜索与建议下拉、首屏不写 Slogan，把最新一篇的真实标题 / 日期 / 分类 / 阅读次数 / 阅读时长放大成唯一主角。技术博客的身份由「真实文章元数据 + 等宽代码块 + 68ch 阅读行宽」构成，不是 Hero 口号、图标卡或抽象图形。换成任何不强调全文检索的站点，这个「导航即检索 + 首屏即正文」的组合不成立。

**自己定的决定（不是化妆）**

1. **详情页撤掉 280px 侧栏，正文收成单列 68ch**：把「读」从「浏览」里分离。文章页不再与侧栏争注意力，标题、元信息、正文共用一条左沿；侧栏只留在列表/分类/搜索/我的文章/公告页。这是结构决定，不是调色。
2. **四类状态收敛为唯一 `common/state.ejs`，并立硬规则「失败绝不降级成空态」**：实证 `common/sidebar.ejs:20` 把 `/tags` 请求失败写成「暂无标签」、`contentDetail.ejs:35-36` 把「暂无评论」与「加载评论…」混成两种裸文本。错误被伪装成空数据会让人以为内容真的不存在，也不会去重试。统一组件强制错误态带重试、保留原内容与输入。

**模式判断**：本项目是 **Read**（文档/文章/帮助），不是 Persuade 落地页。故不套用「100vw 字压场 + 一个 CTA + 三张功能卡」；`design-voice.md §二` 的首屏三做法对本产品不适用，改用「满宽浅色带 + 一篇真实文章作主角」。此项为有意偏离，已登记。

## 1. 配色九槽（实测 WCAG，计算式 sRGB 相对亮度）

浅色 `data-theme="light"`：`bg #f9fafb` / `surface #ffffff` / `surface-2 #f2f4f7` / `border #e0e3e6` / `ink #171b21` / `muted #606a76` / `accent #1d4ed8` / `on-accent #ffffff` / `danger #c32d28`。

| 组合 | 浅色 | 深色 |
|---|---|---|
| ink / bg | **16.54:1** | **16.15:1** |
| ink / surface | **17.28:1** | **14.59:1** |
| ink / surface-2 | **15.68:1** | **13.08:1** |
| muted / bg | **5.26:1** | **7.25:1** |
| muted / surface | **5.50:1** | **6.55:1** |
| muted / surface-2 | **4.99:1** | **5.87:1** |
| accent / surface（普通链接文字） | **6.70:1** | **6.70:1** |
| accent / bg | **6.41:1** | **7.41:1** |
| on-accent / accent（按钮） | **6.70:1** | **7.67:1** |
| danger / surface | **5.64:1** | **5.81:1** |
| border / surface（仅装饰分隔） | 1.29:1 | 1.36:1 |

**替换 `#387fdc`（实测 4.01:1 白底 / 3.84:1 页面底 / 4.01:1 白字按钮，三处全部 < 4.5:1）→ `#1d4ed8`**（6.70 / 6.41 / 6.70），hover `#1a43b8`（8.27）。选中态 `--accent-weak #e8f0fe`，其上的强调文字 5.85:1。深色保持不变 `#6aa6ff`（7.41 / 6.70 / 7.67），`--accent-ink #0d1117`。

**顺带修两处实测不达标**：`--warn #a86a12` 只有 **4.43:1** → `#8a5a0a`（5.92:1 白底 / 5.66:1 页面底）；`--border` 作控件边界只有 **1.29:1**（WCAG 1.4.11 需 ≥3:1）→ 新增 `--border-strong #8b939e`（3.10:1 白底），深色 `#667080`（3.30:1 on `#1b1f26`）。`--border` 继续只用于装饰性分隔线/卡片描边。

深色九槽：`bg #12151a` / `surface #1b1f26` / `surface-2 #232830` / `border #303640` / `border-strong #667080` / `ink #eef1f5` / `muted #9aa4b2` / `accent #6aa6ff` / `on-accent #0d1117` / `danger #f0736e`。三级明度递进表达层级，不用纯黑。

**语义四件套**（tint 8–12% 面积 + 深一档文字，实测值）：

| 语义 | 浅 tint / ink | 对比 | 深 tint / ink | 对比 |
|---|---|---|---|---|
| info | `#e8f0fe` / `#1d4ed8` | 5.85:1 | `#1b2a42` / `#a8c8ff` | 8.49:1 |
| warning | `#fdf3e2` / `#8a5a0a` | 5.38:1 | `#332a17` / `#e8bd6a` | 8.03:1 |
| danger | `#fdeceb` / `#a3221e` | 6.55:1 | `#3a1f1e` / `#ff9d99` | 7.55:1 |
| success | `#e8f5ee` / `#1f6349` | 6.37:1 | `#173027` / `#8edcae` | 8.73:1 |

**硬提醒**：tint 与 surface 只有 1.10–1.17:1，**绝不能只靠底色传达状态**。每个状态必须同时有「内联 SVG 图标 + 深一档文字 + 说清下一步的文案」三重信号（`accessibility.md §一`）。强调色面积 ≤5%，只出现在主按钮、当前选中、链接三处。

## 2. 字号八档 / 行高 / 行宽 / 尺度差

沿用 `theme.css` 已有八档令牌名与值，补行高、字重、字距（中文一律 **0**，不负字距；字重上限 **500**，把 `theme.css:106` 的 `font-weight:700` 改为 500）：

| 令牌 | 值 | 行高 | 字重 | 字距 | 用途 |
|---|---|---|---|---|---|
| `--fs-small` | 13px | 1.50 | 400 | 0.01em | 日期/阅读数/计数/角标 |
| `--fs-body-sm` | 15px | 1.60 | 400 | 0 | 侧栏、按钮、表单、分页、摘要 |
| `--fs-body` | 17px | **1.75** | 400 | 0 | 文章正文 |
| `--fs-lead` | 22px | 1.45 | 500 | 0 | 卡片标题、导语 |
| `--fs-h3` | 26px | 1.40 | 500 | 0 | 小节标题 |
| `--fs-h2` | 34px | 1.35 | 500 | 0 | 页面标题 |
| `--fs-h1` | 46px | 1.30 | 500 | 0 | 详情主标题 |
| `--fs-display` | 61px | **1.30** | 500 | 0 | 首页首篇标题 |

- **每页最多启用 5 档**（`measured-craft.md §二` 理想 5）；13/15 与 26 定义为「同层辅助尺寸」，不参与层级比判定。
- **阅读行宽**：正文 `max-width: 68ch`（17px ≈ **578px ≈ 34 汉字/行**，满足「中文 ≤40 字」）；列表摘要 `max-width: 42ch`；侧栏 280px 内 15px 约 20 字/行；标题最长 2 行、每行 ≤16 汉字，用 `text-wrap: balance` 后必须人工看断行。
- **尺度差**：首页首篇 61px / 正文 17px = **3.59 倍**（`design-voice.md §四` ≥3 倍成立）；详情页 46px / 17px = 2.71 倍，靠 68ch 行宽与 72px 节间补偿，登记为 P2 而非硬改数值。移动端 display→40px、h1→34px、h2→28px（沿用 `theme.css:482`），正文仍 17px 不缩（避免 iOS 输入框强制缩放）。
- **字体栈**（补 3 个中文回退，`visual-defect-taxonomy.md §八`）：`-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif`；等宽 `"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace` 只给代码块与数字。字体家族 ≤2，全大写英文标签一律 0.08em 字距（本设计不使用小标签）。

## 3. 间距 / 圆角 / 容器 / 列宽 / 层级

- **间距刻度**：`4 / 8 / 12 / 16 / 24 / 32 / 48 / 72`（8 档，全 4px 倍数）。`padding/margin/gap` 只能取这些值，禁止 5/10/18/20/30。
- **容器**：`--wrap: 1040px`（≥1280 视口 `1200px`），左右内边距 24px，<768px 为 16px。**全站所有节共享同一左沿**（顶栏、页头、列表、侧栏、页脚），文本块左沿最多 2 种 x 位置。
- **圆角刻度**：`0`（顶栏/全幅块）/ `8`（按钮、输入、chip 外的控件）/ `12`（卡片、面板、状态块）/ `999`（仅输入框与 chip 两类，非按钮）。禁止 10/14/18/24 孤立值。所有 `<button>` / `.btn` 统一 8px 方角；主题切换是唯一的 44×44 圆形图标按钮。
- **z-index 七层**（禁 9999）：`0 base / 100 dropdown / 200 sticky nav / 300 overlay / 400 modal / 500 toast / 600 tooltip`。`theme.css:131` 的 `z-index:50` 改为 `--z-sticky:200`。
- **三处主内容列宽**（1040 容器、内边距 24×2、gap 32）：

| 页面 | 主内容列 | 侧栏 | 说明 |
|---|---|---|---|
| 首页 | 992px（网格 2 列各 488px，gap 16px；首篇跨 992px） | 无 | 首屏不放侧栏，让主角独占 |
| 列表 / 分类 / 搜索 / 我的文章 / 公告 | **680px** | **280px** | `minmax(0,1fr) 280px` + 32px gap |
| 文章详情 / 关于 / 错误 / 公告详情 | **68ch ≈ 578px** | **0** | 单列，左沿与列表页主列对齐（不居中漂移） |

- **高度二选一**：浮起表面（弹层/Toast）用阴影 + `border:0`；平面表面（卡片/输入）用 1px 描边 + 无阴影。两者永不叠加于同一元素；`theme.css` 的 `.card` 同时有 `border` 和 `box-shadow`，本次去掉 `.card` 的 `box-shadow-sm`。

## 4. 逐页编排（7 页，版式家族 ≥4 种）

节间节奏按 Read 模式缩放（`design-voice.md §三` 的 96–112px 是营销页值，内容站收敛）：**节内 16–24px，节间 48px，全页仅一处 72px**（首页首篇与其余列表之间）。相邻两节版式家族不得重复。

| 页面 / 路由 | 首屏放什么 | 版式家族 | 节间 | 行业必备项 |
|---|---|---|---|---|
| 首页 `/` | 13px 统计条「共 N 篇 · 最近更新 MM-DD」+ **首篇文章作唯一主角**（61px 标题、日期/分类/阅读次数/阅读时长、3 行摘要、16:9 封面）；**去掉「记录技术，分享思考」这类 Slogan** | 满宽主角 + 2 列网格 | 主角后 72px，网格 gap 16px，分页上 48px | 分类入口、搜索建议、分页、主题切换、侧栏（移到主角区之后） |
| 文章列表 / 分类 / 搜索 / 我的文章 | 34px 页标题 + 13px「共 N 篇」+ 面包屑（分类/搜索页） | **索引列表**（`border-top` 分隔的条目：22px 标题 + 15px 两行摘要 + 13px 元信息行），**不用卡片网格** | 条目间 24px，页头到列表 32px，分页 48px | 分类高亮 `aria-current`、搜索关键词回显、分页、空/错状态 |
| 文章详情 `/content/detail` | 面包屑 → 46px 标题 → 13px 元信息行 → 正文首段（首屏就能读到正文，不是一张封面图） | 单栏阅读 | 段落间 0.8em，正文/评论/发表评论三块各 24px | 原文链接、作者编辑入口、评论列表、发表评论、返回分类 |
| 分类 `/content/category` | 分类名 + 「分类 · 共 N 篇」+ 顶栏分类下拉当前项高亮 | 索引列表（同列表页，但页头带分类语境） | 同列表页 | 分类下拉（`.js-category-menu` 保留）、分页；**不新增标签页** |
| 关于/联系 `/about` | 34px 标题 + 一段 17px/68ch 陈述 | 陈述式单栏 | 48px | 技术栈说明、联系入口；不加团队卡片/头像网格 |
| 错误 `/error` | 居中完整错误态（`state.ejs` block/error），无自动跳转 | 居中状态 | 48px | 「回首页」+「去搜索」两个动作 |
| 公告 `/log` `/log/detail` | 公告标题 + 「共 N 条」 | 时间线列表 / 单栏阅读 | 条目 24px | 分页、日期、空/错状态 |

标题层级：全页唯一 `<h1>`；首页 `<h1>` 是首篇文章标题（页头改 `<p>`），列表页 `<h1>` 是页标题、条目标题用 `<h2>`，详情页 `<h1>` 是文章标题、评论区用 `<h2>`（把 `contentDetail.ejs:34,43` 的 `<h3>` 提为 `<h2>`），不允许跳级。

## 5. 四类状态反馈统一规范（本次重点）

**唯一组件**：`views/common/state.ejs`，参数 `{ kind, size, title, text, retryUrl, retryLabel, actionHref, actionText }`。`kind ∈ empty | loading | error | success | fail`，`size ∈ block | inline`。以下为可直接照抄的参考实现（前端落地，本契约不写进 views 以免与 Phase 3 冲突）：

```ejs
<%
  var k = (typeof kind !== 'undefined') ? kind : 'empty';
  var s = (typeof size !== 'undefined') ? size : 'block';
  var isErr = (k === 'error' || k === 'fail');
%>
<div class="state state--<%= k %> state--<%= s %>" data-state="<%= k %>"
     role="<%= isErr ? 'alert' : 'status' %>"
     aria-live="<%= isErr ? 'assertive' : 'polite' %>" aria-atomic="true">
<% if (k === 'loading') { %>
  <div class="state-skeleton" aria-hidden="true">
    <span class="sk sk--title"></span><span class="sk sk--line"></span><span class="sk sk--line sk--short"></span>
  </div>
  <span class="sr-only">正在加载</span>
<% } else { %>
  <span class="state-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"
    fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
    <% if (isErr) { %><path d="M12 3 2 20h20L12 3z"/><path d="M12 9v5"/><circle cx="12" cy="17.5" r=".8"/>
    <% } else if (k === 'success') { %><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>
    <% } else if (k === 'empty') { %><circle cx="12" cy="12" r="9"/><path d="M8 13h8"/>
    <% } else { %><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".8"/><% } %>
  </svg></span>
  <div class="state-body">
    <% if (typeof title !== 'undefined' && title) { %><p class="state-title"><%= title %></p><% } %>
    <% if (typeof text  !== 'undefined' && text)  { %><p class="state-text"><%= text %></p><% } %>
    <% if (typeof retryUrl !== 'undefined' && retryUrl) { %>
      <button type="button" class="btn btn-sm js-state-retry" data-retry="<%= retryUrl %>"><%= retryLabel || '重试' %></button><% } %>
    <% if (typeof actionHref !== 'undefined' && actionHref) { %>
      <a class="state-link" href="<%= actionHref %>"><%= actionText %></a><% } %>
  </div>
<% } %>
</div>
```

**DOM 骨架统一为**：容器（role/live/data-state）+ 图标或骨架（aria-hidden）+ body（title / text / actions）。图标是内联线性 SVG（16/20/24px，stroke 1.75，viewBox 24），**零 emoji、零图标字体、零依赖**；主题切换按钮也改用内联 SVG（替换 `theme.css:207` 的 `content:"\263E"` / `"\2600"` 字符 glyph，避免命中 P0-1 扫描且跨平台字形不一致）。

| 状态 | DOM | 文案语气 | 颜色令牌 | 重试 | 尺寸 |
|---|---|---|---|---|---|
| 空 empty | `role=status` / `polite`；图标 + 标题 + 一句引导 + 动作链接 | 「还没有评论 · 来写第一条」，不写「暂无数据」 | `--surface-2` 底 + `--muted` 字 + `--border` 虚线 | 无（给下一步动作） | block / inline |
| 加载 loading | `role=status` / `polite`；3 条骨架 + `.sr-only` 文本，**界面上不写「加载中…」** | 仅读屏可读「正在加载」 | 骨架 `--surface-2`，无彩色 | 无 | block 3 行 / inline 1 行 |
| 失败 error（请求/渲染失败） | `role=alert` / `assertive`；图标 + 标题 + 一句 + **重试按钮** | 「标签没加载出来」「评论没读出来」，不说错误码 | danger tint `#fdeceb` + ink `#a3221e` | **必须有** | block / inline |
| 操作成功 success / 操作失败 fail | 全局 Toast，`role=status` / `polite`；只报结果 | 「已保存」「评论已发布」「删除失败，内容还在」 | success / danger tint | fail 带「重试」 | 仅 inline（ Toast ） |

**尺寸**：`block` → `min-height:200px; padding:48px 24px; 居中; 图标 24px; 标题 22px; 文字 15px; 动作上距 16px`。`inline` → `min-height:44px; padding:12px 16px; flex 横排; gap:12px; 图标 16px; 单行文字 15px; 重试按钮视觉高 32px 但触控区补到 44×44`。骨架尺寸贴近真实内容：标题 `22px×60%`、行 `15px×100%`、短行 `15px×72%`，间隔 12px，圆角 8px；shimmer 1.2s，`prefers-reduced-motion` 下改为静态灰块（占位不消失）。

**骨架屏 vs spinner 的理由**（`ui-judgment.md §六`「一页只有一种加载处理」）：
- 列表、评论、侧栏标签、搜索建议、分页 → **骨架屏**。这些区域条目数与行高可预判，骨架保住布局尺寸（CLS≈0）、不遮挡已有内容、用户可继续操作；符合 `design_query` UX 的「骨架尺寸接近真实内容」与「图片固定比例占位」。
- **整页首次路由加载** → 居中裸 spinner（页面内容完全未知）。同一页绝不混用两种；绝不把 spinner 放角落。
- 不用 spinner 表达局部刷新：旋转体在窄侧栏里没有信息量，还会与骨架争注意力。

**Toast 宿主**：`<div id="nl-toast-host" class="toast-host" role="status" aria-live="polite" aria-atomic="true"></div>` 挂在 `<body>` **直属**（不能放进 `footer.ejs:7` 的 `.hide` 弹层容器，也不能放进会被卸载的评论面板内 —— `ui-judgment.md §二`：宿主必须比触发者活得久）。`position:fixed; z-index:var(--z-toast)=500; bottom:24px; right:24px`；手机 `left/right:16px; bottom:calc(16px + env(safe-area-inset-bottom))`。只报「已完成/失败」，**不做进度条、不报「还在进行中」**，4s 自动消失且可手动关闭；失败时原数据与输入一律保留。

**复用点（保留全部钩子，只替换内部 HTML）**：

| 位置 | 现有 DOM | 覆盖状态 | 尺寸 | 必须保留 |
|---|---|---|---|---|
| 首页 / contentPanel / 分类 / 搜索 / 我的文章 / 公告 | `.empty` | empty、error | block | 无钩子；`index.ejs:16`、`contentPanel.ejs:15`、`log.ejs:16` 各自文案统一 |
| 侧栏标签 | `#tagCloud` | loading、empty、**error** | inline | `id="tagCloud"`、`fetch('/tags')` 保留；`sidebar.ejs:20` 的 catch **改 error + 重试**，不再写「暂无标签」 |
| 评论区 · 首屏渲染 | `.js-comment-panel` / `.js-all-comment`，`loadComments(reqPage)` | loading、empty、error、success(Toast) | block + Toast | 全部 `js-*`：`.js-comment-title`、`.js-more-comment`、`.js-more-comment-btn`、`.js-comment-input`、`.js-post-comment-btn`、`.js-open-comment-btn` |
| 评论区 · 更多评论（**独立异步路径**） | `.js-more-comment-btn` → `$.get('/comment/all', {page: page+1})`，`common.js:543-577` | loading、empty、**error 带重试**、success(Toast) **四态与首屏同等要求**（R17 补登记，此前漏检） | block + Toast | `data-page` / `data-totalPage` / `data-id` / `.js-comment-panel` / `.js-more-comment` 全部保留；失败时**已渲染评论不得丢失**、不得静默 |
| 搜索建议 | `.js-search-panel` | loading、empty、error | inline | `.js-search`、`.js-search-panel`、`data-toggle="dropdown"` |
| 分页（前台主） | `common/pagination.ejs` → `.pagination > .pager-list > .pager-link` | 纯 `<a href>` 服务端分页，**无异步失败态** | — | `rel=prev/next`、`aria-current="page"`、逐页 `aria-label`，可键盘 / 深链接 / 无 JS 可用 |
| 分页（遗留 JS 版） | `common/pager.ejs` → `.pager` / `js-pre-page` / `js-next-page` | error | inline | `data-url` / `data-page` / `data-total` 与 `common.js:342/354` 钩子**原样保留**，供仍依赖 JS 的页面使用 |
| 错误页 | `error.ejs` `.empty` | error | block | 去掉自动跳转文案 |
| 文章不存在 | `contentDetail.ejs:55` | empty | block | `.js-doc-id` 等隐藏输入 |

**文案对照（统一「人话」，≤2 句、句末不写句号、说清发生了什么 + 下一步）**：

| 场景 | 现在 | 改成 |
|---|---|---|
| 标签接口失败 | 暂无标签 | 标签没加载出来 · 重试 |
| 评论加载中 | 加载评论…（裸文本） | 3 行骨架，界面不写字 |
| 无评论 | 暂无评论（alert） | 还没有评论 · 来写第一条 |
| 搜索无结果 | 没有找到文章 | 没找到「关键词」· 换个词或按分类浏览 |
| 文章不存在 | 文章不存在 | 这篇文章可能已被删除 · 返回首页 |
| 404 | 5 秒后自动返回首页 | 页面不存在 · 回首页（可点链接，无自动跳转） |
| 评论发布成功 | 无反馈 | 评论已发布（Toast） |
| 评论发布失败 | 无反馈 | 评论没发出去，内容还在 · 重试 |

### R17 异步路径四态对账清单（QA 真机 CDP 证据）

**§5 的硬规则对所有异步路径一视同仁**：「失败绝不降级成空态、错误态必须带重试且保留已渲染内容与输入」。此前复用点表格把评论区写成一行，实际它是**两条独立异步请求**，只验首屏会把另一条漏掉。QA 用真 Chrome CDP 注入 `createTime:null` 到第二页评论，实证 `common.js:543-577` 的「更多评论」handler 仍是旧链（`$.get` 只有 success、无 `.fail()`），`new Date(val.createTime.toLocaleString())` 抛 `TypeError: Cannot read properties of null (reading 'toLocaleString')`；后果是整页分页评论**静默丢失**：items 仍 1、`[data-state=error]`=0、`.js-state-retry`=0、`.js-more-comment` 不隐藏、`data-page` 卡在 1，连点 2 次重复请求 `page=2` 且每次抛异常。首屏 `loadComments()` 虽已换成 `fmtCommentTime()` + `.fail()` + `retry:'comments'`，但 `fmtCommentTime()` 用 `isNaN(d.getTime())` **判不住 `new Date(null)`**（合法 epoch），会显示假的 `1970-01-01 08:00` 且 0 异常——「失败回落」这一档必须显式判空，不能只靠 `isNaN`。

**定性（沿用 QA，不改判定）**：**P1 advisory**，归决策 A（同一「无失败反馈」根因），**不判 P0**（需脏数据触发，常规 ISO 日期不触发；不资损 / 不越权 / 无 XSS），属会话期并发改动，**不推翻 `verdict: pass`**。设计侧不裁修法、不改任何业务代码、不新开豁免（waivers 仍 W1–W6）。

**四态对账清单（授权落地后逐条验，别只验主渲染）**：

| 异步路径 | 入口 | 必验 |
|---|---|---|
| 首屏评论 | `loadComments(reqPage)` | 四态 + 失败保留标题与已渲染项 + `retry:'comments'` |
| **更多评论** | `.js-more-comment-btn` / `page+1` | 四态 + `.fail()` + 独立 `data-retry` **只重发 `page+1`**（不重发整页）+ 失败时已渲染评论保留、`.js-more-comment` 不隐藏、`data-page` 不前进 |
| 侧栏标签 | `fetch('/tags')` | catch → error + 重试，保留已渲染 chips |
| 分类 / 搜索建议 | `js-*` 下拉 | loading / empty / error 三态，失败不写「暂无」 |
| 评论发布 | `.js-post-comment-btn` | success Toast / fail 带重试且保留输入 |

**QA 给的四条追加复验判据**（一并登记，供排期时对账）：① 首屏与更多评论**统一** `fmtCommentTime()`，并对 `null` 显式判空（不得只靠 `isNaN`）；② `createTime` **5 种形状**兜底（正常 ISO / `null` / `undefined` / 空串 / 非法字符串）均不抛异常、不显示假 epoch；③ 更多评论用**独立 `data-retry`**、重试只重发 `page+1`，`data-page` 仅在成功后前进；④ 回归集补这 5 种形状。归属与裁决见 `W6.openDecisionsOutsideDesign` 的 QA-A，设计侧不代为决定。

**R19 捕获边界（前端技术输入，务必按此读清单）**：③ 的「补 `.fail()` + 独立 `data-retry`」**不能替代 ①②**，也不足以修 `null` 崩溃。`.fail()` 挂在 `$.get(...).fail(...)` 上（`common.js:169/633/741` 同型），只捕 jqXHR 的**网络 / HTTP 失败**；`createTime.toLocaleString()` 的 `TypeError` 是在 success 回调内 `$.each` 里**同步抛出**，此时 jqXHR 已 resolve，`.fail()` 接不住，异常冒泡为全局未捕获、渲染中断。因此必须**同时**在 handler 内复用 `fmtCommentTime()`、加 5 形状兜底并显式判空（首屏的 `isNaN(d.getTime())` 同样判不住 `new Date(null)` 的合法 epoch 假日期）。四态对账时 ①–④ 是一组，缺任一都不算通过，别只验「有没有 `.fail()`」。

**R20 error 态的两条正交失败源与修复顺序（QA 真机补正，防 QA-A 假绿）**：R19 已定「`.fail()` 不够」，本版把它上升为 **§5 四态里 `error` 态的定义**——`error` 态覆盖**两条正交失败源**：**(A) 网络失败**（jqXHR reject → `.fail()` + `data-retry` + 保留已渲染内容）；**(B) success 回调内的数据形状异常**（`fmtCommentTime()` 显式判空 / 5 形状兜底 / `try-catch`，让本批次渲染不中断并落到 `error` 态）。二者不可互相替代，**仅验证 (A) 的 `.fail()` 存在不构成四态达标证据**，也不足以把 QA-A 判为已落地。

**修复与验收顺序：①② 先于 ③**。先做形状兜底（统一 `fmtCommentTime` + 显式判空 + 5 形状），再做网络失败链（`.fail()` + 独立 `data-retry`）；倒过来做会在只补 `.fail()` 的中间态被误判成「QA-A 已关闭」。排期对账按此顺序验，别只看「有没有 `.fail()`」。

**整批丢失机制（QA 追加实测，解释为何比「静默丢失」更彻底）**：`common.js:560-568` 的 `html +=` 在 `$.each` 内同步累加、`:575` 的 `$('.js-comment-panel').append(html)` 在循环**外**；把 `null` 放在第二页 5 条里的第 3 条，抛错中断后**连 `null` 之前的合法条目也一起不落地**（items 仍 = 1，只剩首屏已渲染内容），对照全合法时 items = 6、0 异常。jQuery 1.10.2 实测 `$.Deferred().done(抛异常).fail(...)` → `failCalled=false`、异常从 `resolve()` 冒泡，印证 (B) 不走 reject 路径；QA 另做「只给 jqXHR 挂 `.fail()`」的模拟（不改业务代码），注入 `null` 后 `failHandlerCalled=false`、items=1、无 error / 重试、`data-page` 仍 1、仍 1 次未捕获异常——**这是 QA-A 假绿的直接证据**。

**QA 报给主理人的决策 A 第 5 条硬判据**（与上面四条并列、登记进 `W6.openDecisionsOutsideDesign` 的 QA-A）：5 种 `createTime` 形状注入均零异常、无假 `1970`；**该页评论含 `null` 之前的合法条目全部落地**；`null` 场景下 `data-page` 不前进且 **`error` 态 + 重试出现**。定性不变：P1 advisory、归 QA-A、不判 P0、不推翻 `verdict: pass`、不新开豁免（waivers 仍 W1–W6）；设计侧只补契约清单，不改业务代码、不裁修法。

## 6. 响应式三断点

| 断点 | 导航 | 网格 | 侧栏 | 阅读行宽 |
|---|---|---|---|---|
| **桌面 ≥1024px**（≥1280 用 1200 容器，仅前台） | 左区主导航：首页 / 分类下拉 / 公告；右区工具：写文章 CTA / 搜索框 180px / 主题切换 / 账号菜单（分区见 §6.1）；`.nav-tools` 靠右（`margin-left:auto`） | 首页 2 列 + lead 跨列；列表页单列索引 | 右侧 280px，随主列 `align-items:start` | 68ch ≈578px |
| **平板 768–1023px** | 保留「站名 + 分类 + 搜索 + 主题」4 项，其余收进 `.navbar-collapse`（Bootstrap `data-toggle`/`data-target` 钩子保留，只改 CSS）；搜索框宽 160px | 首页 2 列，lead 仍跨列 | **移到主内容下方**、页脚之前，`aside` 不删除（`#tagCloud` 依赖 DOM） | 同 68ch，`min(68ch, 100% - 48px)` |
| **手机 <768px**（重点 375 / 390） | `.navbar-toggle` 显示，`.navbar-collapse` 收为面板；搜索框在面板内 **100% 宽独占一行**（替换 `theme.css:485` 的 130px） | 全部 1 列，lead 不跨列但保留 34px 标题 | 主内容之后、页脚之前，卡片间距 16px | `min(68ch, 100% - 32px)`，正文 17px **不缩** |

- `.layout` 单列断点从现有的 `max-width:900px` 改为 **`1024px`**，这样 `visual-defect-taxonomy.md §三` 点名的 **834px（iPad 竖屏）** 明确落在单列区，不会三列挤成一团。
- 一律 `minmax(0,1fr)` + `flex-wrap`，禁止整页横向滚动；在 320/375/414/768/**834**/1024/1280/1440 八个宽度实测。
- 所有可交互元素 ≥44×44px，相邻间距 ≥8px；`.pager` 的页码点击区（现 `padding:6px 12px`）补到 44×44。
- 固定/吸顶元素用 `env(safe-area-inset-top/bottom)`；移动端弹层用底部 ActionSheet，桌面用居中 Modal（沿用 layer，不新增组件库）。

### 6.1 导航信息架构契约（前台 + 后台，Phase 4 收口）

原实现的问题不是视觉，而是结构：`currentMenu` 字符串散落在 15+ 个 controller / route，两个 header 各自硬编码菜单项、链接、角色判断与高亮规则，`sensitiveWord` / `sensitive-word` 两种写法并存，后台 13 项一级平铺且与 fixed 顶栏的 `flex-wrap` 冲突。本节为收口后的唯一口径。

**单一配置源**：`navConfig.js`（根目录，经 `app.js` 挂到 `app.locals.navConfig`）。每项为 `{ key, label, href, zone, roles, aliases, hrefByRole, labelByRole, defaultCurrent }`。`key` **沿用既有 `currentMenu` 取值**，controller 与 `routes/index.js` 零改动；别名由 `aliases` 兼容。`isCurrent / visible / hrefFor / labelFor / groupOf` 为纯函数，供 EJS 直接调用。前台 `front.zones` 由 `groups[].zone` 派生（`primary / cta / account`），是同一份配置的索引、不是第二真源；后台 `admin.account` 定义账号菜单。搜索框、主题切换属功能控件，**不是导航项**，不纳入配置。

| | 前台 `navConfig.front` | 后台 `navConfig.admin` |
|---|---|---|
| 分区 | **三区**：`primary` 主导航（首页 / 分类 / 公告，只放内容目的地）；`cta` 创作动作（写文章，按钮而非文字链接）；`account` 账号域（我的文章 / 管理后台 / 退出登录） | 侧栏四组：概览；内容（文章 / 分类 / 标签 / 公告 / 链接）；社区（用户 / 评论）；治理与系统（操作日志 / 敏感词 / 违规记录 / 设置）；另有顶栏账号域 |
| 载体 | `header.ejs` 顶栏两个 `<ul>`：`.nav-primary` 靠左、`.nav-tools` 靠右（CTA / 搜索 / 主题 / 账号下拉）；未登录时工具区只显示「扫码登录」 | `manager/header.ejs` 左侧栏四组 `<details>`（原生、零 JS、可键盘折叠）；顶栏左侧「品牌 + 返回前台」，右侧账号下拉 |
| 桌面 ≥1024px | 两区横向展开，账号菜单右对齐 `.dropdown-menu--right` | **全宽流体**：200px 侧栏 + `minmax(0,1fr)` 主内容吃满视口，不套 1200 居中容器；仅 24px 安全内边距；fixed 顶栏 68px 让位由 `.manager-shell` 承担，顶栏 padding 同步覆盖前台居中值以对齐内容 |
| 平板 768–1023px | 沿用 §6 三断点表 | 侧栏移到主内容上方，四组排成两列，顶栏不换行 |
| 手机 <768px | 沿用 §6：`navbar-collapse` 面板、两个 `<ul>` 纵向堆叠、搜索 100% 宽独占一行 | 侧栏四组单列；账号昵称截断到 72px，避免 375px 挤压 |

**账号域标准口径（回答「点用户名进后台是否合理」）**：不合理。导航是「去某个内容目的地」，账号菜单是「与当前身份相关的操作」，两者不同域，混在同一排就是不规范。四个元素的标准语义与位置如下，前后台一律遵守：

| 元素 | 标准语义 | 标准位置 | 本项目落地 |
|---|---|---|---|
| 用户名 / 头像 | 身份标识 + **账号菜单触发器**，不是页面链接 | 顶栏最右 | `data-nav-toggle` 触发 `.dropdown-menu--right`，`href` 不再是 `/manager` |
| 进入后台 | 显式命名、带权限的**管理入口**，不能让用户猜「点名字会去哪」 | 前台账号菜单内 | 菜单项「管理后台」→ `/manager` |
| 返回前台 / 查看站点 | 「离开管理界面」的**反向入口**，独立可见 | 后台顶栏品牌旁 | `.manager-back-link`，不塞进账号菜单 |
| 退出登录 | 会话操作，账号菜单**最后一项** | 账号菜单内 | `js-logout-btn` + `role="button" tabindex="0"`，不再与导航项平级 |

配套：`common.js` 用统一的 `[data-nav-toggle]` 处理分类 / 账号下拉，同一时刻只开一个，点击外部或 Esc 关闭并把焦点还给触发器；登录态按「已登录块 / 未登录块」整体切换（`.js-when-logged-in` / `.js-when-logged-out`），不再逐个隐藏块内 `<a>` 留下空白占位。

**权限边界（重要）**：`roles` 只决定**是否渲染入口**，不替代、不修改任何路由鉴权（`filter.authorize` / `filter.authorizeAdmin`）。管理员可见 12 项；普通用户可见 3 项（概览 / 文章 / 我的资料）。`labelByRole` 把普通用户的「用户」改为「我的资料」，因为 `/manager/user` 对非管理员只渲染本人信息（`controllers/user.js:45-46`）——这是文案与落地页对齐，**不是鉴权变更**。

**链接与可访问性硬口径**：

1. 所有导航项必须是真实 `href`，可深链接、可中键打开、无 JS 可用。「我的文章」为 `/content/user?page=1`（在账号菜单内），未登录时由 `common.js` 的 `.js-my-content-menu` 拦截并唤起扫码登录；禁止回退到 `href="javascript:;"` + `location.href`。「写文章」是 CTA 按钮（`.btn.btn-primary.nav-cta`），不再是主导航文字链接，且去掉遗留的 `?view=addContent`。
2. 分类下拉是 JS 动态填充，**必须有静态兜底**：`header.ejs` 预置「全部文章 → `/`」；`common.js` 在成功渲染与失败态中都保留同一入口，失败态仍按 §5 给 error + 重试，不得写成「暂无分类」。
3. 当前项同时输出 `class="current-menu"` 与 `aria-current="page"`（前台顶栏 + 后台侧栏）；`<nav>` 有 `aria-label`；后台补 `skip-link`、`<main id="main">`、`<aside>`，退出链接补 `role="button" tabindex="0"`，Space 键垫片同时存在于前台与后台 footer。
4. `href="javascript:;"` 只允许出现在登录 / 退出等非导航控件上，并须带 `role="button" tabindex="0"`。

**非导航项定性（防止 QA 误报）**：`/manager/analytics` 是 `controllers/analytics.js` 的 **JSON 数据接口**（`res.json`），不是页面，不纳入导航；`manager/index.ejs` 的 8 张统计卡是数据概览入口，与侧栏不冲突，不视为第二套导航。

**验收**：管理员 / 普通用户两种角色各渲染一次 header，核对后台可见项数（12 / 3）、`aria-current` 唯一命中、别名 `sensitive-word` 命中敏感词；前台核对三区归属（主导航仅 3 个目的地、写文章为 CTA、账号菜单含显式「管理后台」且用户名不是 `/manager` 链接）、登录 / 未登录两态只显示对应的账号块；在 375 / 768 / 834 / 1024 / 1440 五个宽度核对后台顶栏不换行、侧栏按断点切换、**内容区左右无居中留白且顶栏与内容对齐**；禁用 JavaScript 后前台主导航与分类兜底仍可到达内容页；键盘验证账号 / 分类下拉的 Enter / Space / Esc 与焦点归还。

## 7. 可访问性与动效约束（含实证违规项）

**必须修的 4 处实证**：

1. `common/meta.ejs:7` `maximum-scale=1` → 改为 `content="width=device-width, initial-scale=1"`，允许 200% 缩放（WCAG 1.4.4）。
2. `common/meta.ejs:18` `<meta http-equiv="refresh" content="5;url=/">` → **删除**；`error.ejs:4`「5 秒后自动返回首页」改成可点击的「回首页」。禁止自动 meta refresh 跳转（WCAG 2.2.1 / 2.2.2 / 3.2.5）。
3. `header.ejs:68` 用 `<article>` 包住 `.container.page-shell`，而 `index.ejs:8` 内又有 `<main>` → **全站唯一 `<main id="main" tabindex="-1">`**，`<nav role="navigation">`（已有）、`<aside>`（已有）、`<footer>` 各一个；`common/links.ejs` 若为页脚需包 `<footer>`。
4. `theme.css:106` `font-weight:700` 与 `theme.css:207` 字符 glyph 图标 → 字重改 500、图标改内联 SVG。

**清单**：

- **焦点环**：`:focus-visible { outline:2px solid var(--ring); outline-offset:2px }`（浅 `#1d4ed8` 6.70:1 / 深 `#6aa6ff` 6.70:1，均 ≥3:1）；不得被 `overflow:hidden` 裁切；`outline:none` 只在提供等价可见样式时允许。
- **跳转链接**：`<a class="skip-link" href="#main">跳到正文</a>` 作为第一可聚焦元素，聚焦时可见（`top:8px; left:8px; padding:12px 16px; z-index:600`）。
- **landmark / 标题**：唯一 `<h1>`，h1→h2→h3 不跳级；按钮用 `<button>`（现 `header.ejs` 的登录/注册是 `<a href="javascript:;">`，因 JS 钩子依赖不可改标签，须补 `role="button" tabindex="0"` 与键盘 Enter/Space 处理）。
- **aria-current**：现有 `class="current-menu"` 保留（CSS/JS 依赖），渲染时**同时输出** `aria-current="page"`；分类下拉当前项同理；分页当前页 `<span class="current" aria-current="page">`。
- **aria-live**：状态组件按 §5 表；Toast 宿主 `polite`；错误 `assertive`；不在输入过程中用 `role="alert"` 轰炸（改为失焦校验）。
- **表单**：所有 `<label for>` 已有（登录/注册/评论），保留；错误用 `aria-describedby` + `aria-invalid="true"`，提交后焦点移到第一个错误字段；必填除颜色外有文字说明；失败不清空输入。
- **信息不只靠颜色**：每个状态有 SVG 图标 + 文字；错误/成功/必填均有第二信号。
- **图片**：信息性 `alt` 描述结论，装饰性 `alt=""`；`postCard.ejs:2` 的封面 `alt="<%= doc.name %>"` 合格，补 `width`/`height` 或 `aspect-ratio:16/9`（`.cover` 已有）、`loading="lazy"`（**首屏 lead 封面不懒加载**，保 LCP）、`decoding="async"`。
- **动效**：只 3 处 —— 链接色 150ms、按钮 hover 150ms（背景加深或抬 1px）、章节入场 300ms（位移 8px + 淡入，只一次）。骨架 shimmer 1.2s 属加载指示不属装饰。全部进 `@media (prefers-reduced-motion: reduce)` 降级（`theme.css:490` 已有，保留并补 shimmer 静态化）。无高频闪烁（≤3 次/秒）、无自动轮播、无装饰性微动效。
- **纯键盘**：Tab 走完全流程；分类下拉 / 搜索建议 / 登录注册弹层可 Esc 关闭、有焦点陷阱、关闭后焦点归还触发元素；删除列表项后焦点移到相邻项而非 body。

## 8. 性能与依赖约束（不引入任何新依赖）

- 前台每页 CSS 从 7 份收敛到 **≤3 个 `<link>`（R10：仅 HTML 源码级计数）**：`theme.css`（唯一视觉源）+ 弹层/折叠结构所需的最小 CSS + 编辑器页独占 CSS（**按需加载，不进前台**）。`bootstrap.css` / `docs.min.css` / `bootstrap-switch.min.css` / `font-awesome.css` / `style.css` 的全量 `<link>` 从前台移除；它们的结构类名已由 `theme.css` 覆盖。**运行时普通页实测 4 份**（多出 `layer.js` 自注入的 `/js/need/layer.css`，404），按源码 `<link>` 数判据达标、注入另登记，详见 §8「R10 运行时精度修订」。
- `footer.ejs:4` 的 `require.js` + `/js/main`（编辑器全家桶）**只在编辑相关页加载**，列表 / 详情 / 分类 / 关于 / 错误 / 公告页不加载。
- 主题 `data-theme` 的内联脚本已在 `<head>`（`meta.ejs:30`），确认保留，避免深浅闪白；不引入任何 Web 字体 CDN（系统字体栈已满足）。
- 图片尺寸声明、`loading="lazy"`、`decoding="async"`；不新增图标库、不新增标签路由/标签页/标签管理。**既有** `common/sidebar.ejs` 的标签卡与 `common/postCard.ejs` 的 `doc.tags` 一律保留，仅统一状态呈现并降为次要视觉权重。
- **R5 精确化（编辑页样式表请求数）**：上面首条的「≤3 个 `<link>`」只适用于**普通前台页且为源码级计数**（源码 `bootstrap.css` + `layer/need/layer.css` + `theme.css` = **3 份**，已达标；运行时 4 份见 R10）。编辑页 `meta-front.ejs` 合计 6 份（公共段 2 + `needEditor` 分支 3 + 公共段 `theme.css` 1），`editor.ejs:18` 再内联一份 `/vendor/vditor/dist/index.css`，**源码共 7 份**（运行时 9 份见 R9① / R10），入口分裂在 `meta-front.ejs` 与 `editor.ejs` 两处。**判据已由 R7 修正为分层式**，见下方「R7 判据可达性修正」；不得再把「≤6 且单一入口」当合取放行条件。

### R7 判据可达性修正（前端技术核对后）

**更正 R5 的一处数字表述**：7 份的精确分解是 `meta-front.ejs` 公共段 2 份（`:19 bootstrap.css`、`:20 layer.css`）+ `needEditor` 分支 3 份（`:23 font-awesome.css`、`:24 index.css`、`:25 prettify.css`）+ 公共段 1 份（`:27 theme.css`）= **meta-front 合计 6 份**；`editor.ejs:18` 内联 `/vendor/vditor/dist/index.css` = 第 **7** 份。R5 写的「needEditor 6 份」应读作「meta-front 合计 6 份，其中 needEditor 分支 3 份」。普通前台页 3 份达标，数字不变。

**R5 判据有一处不可达，R7 拆成分层判据**：原判据「≤6 **且** 必须由 `meta-front.ejs` 的 needEditor 分支单一入口输出」是合取式，而达成「单一入口」必须删 `editor.ejs:18` 并把 link 搬进 `meta-front.ejs` —— `views/editor.ejs` 属任务书 §二.1 明令禁改、且是用户 `9865e95` 的提交。即便获授权搬运，`needEditor` 分支会变成 4 份、`meta-front` 合计 7 份、**源码总仍是 7**（只是位置变了，数量没变），**须裁 1 份才 ≤6 —— 这 1 份就是 `prettify.css`，不是额外第 2 份**。**R11 算式订正**：本句成立的前提是「尚未裁 `prettify.css`」；若已把裁它列为动作之一，再写「再裁 1 份」就是重复计数。若还想裁 `font-awesome.css` 降到 5 份，须先把 `editor.ejs:14` 的 `icon-info-sign` 换内联 SVG（消费者消失后才可裁），属**带依赖链的可选优化**，不是判据必要动作。把不可达条件写进判据等于没有判据，故改为三层：

| 层级 | 要求 | 可达性 | 落点 |
|---|---|---|---|
| 硬指标（放行判据） | **HTML 源码中** `<link rel="stylesheet">` 数 **≤6**（R9 可测化：不是运行时 DOM 的 link 数） | 可达，零禁改冲突 | 只改 `meta-front.ejs`，裁 `:25` 的 `/js/external/google-code-prettify/prettify.css`（675 B） |
| 目标态（登记，不作放行判据） | 样式表**单一入口** | 需授权改 `editor.ejs` 且裁 1 份（这 1 份即 `prettify.css`，见 R11 算式订正，非额外第 2 份） | 未达成期间登记在 `design-choice.json` W6 的 `singleEntry`，**不算缺陷** |
| 必做（与请求数正交） | **`dist/index.css` + `content-theme/*.css`** 一并令牌覆盖（R10 扩范围：后者是运行时注入、自带配色、不随站点主题切换） | 可达，不需改 `editor.ejs`，只改 `theme.css` | `--accent`、圆角 8/12、中文字体栈、`focus-visible` 2px ring、浅深双主题（含暗色下覆盖 light.css 的背景与文字色） |

**三份旧 CSS 的真实消费者（前端技术核对 + 本轮实读取证）**：

| 资源 | 体积 | 消费者 | 结论 |
|---|---|---|---|
| `prettify.css` | 675 B / gzip 335 B | **零**：全库 `prettyprint` 类 0、`prettify.js` / `run_prettify.js` 加载 0（`footer.ejs:66-72` 的 `needEditor` 分支已换成标准链，无 `require.js` / `main.js`）、后台 `common/meta.ejs:21` 那条是注释 | 裁它零功能代价，是收口到 6 份的首选 |
| `index.css` | 976 B / gzip 428 B | `:3 #editor` 命中 `editor.ejs:11` 的隐藏 textarea，Vditor 正常路径不生效；仅 Vditor 未加载的 textarea 兜底路径才需要 `height/max-height 250px`。`:31 div[data-role="editor-toolbar"]` 只存在于备份 `views/editor.ejs~`，非运行时 | 裁它风险低但会削掉兜底排版，不作首选 |
| `font-awesome.css` | 15.7 KB / gzip 3.5 KB | **一个真实消费者**：`editor.ejs:14` 的 `<i class="icon-info-sign">` 提示图标。`header.ejs:13-15` 的 `.icon-bar` 来自 `bootstrap.css` 自带，不依赖它；后台 `common/meta.ejs:22` 是独立 head，裁前台不影响后台 | **不得单独裁掉**：会让提示图标消失。虽是体积大头，但属禁改边界问题 |

**顺带实证一处红线偏离**：`editor.ejs:14` 的 `<i class="icon-info-sign">` 是**图标字体**，违反 §5「零 emoji、零图标字体、零依赖」与 §10 Don't。它**不命中 P0 三条**（非 emoji 功能图标、非紫粉渐变、非 AI 模板味），因此不按 P0 处理、也不开豁免；但落在禁改文件内，登记为「已登记的实现偏离」第 4 条。**复审触发**：用户日后若自行修改 `editor.ejs`，必须把该图标换成内联 SVG（16/20/24px、viewBox 24、stroke 1.75、`currentColor`）；届时 `font-awesome.css` 才具备裁掉条件。

**单列决策项（与 emoji 取舍正交）**：R6 已把 emoji 面板裁定完毕，**不需要**决策卡；但「是否授权改 `views/editor.ejs`」是独立的范围/授权决策，不能并进 emoji 那题，否则裁完 emoji 仍会发现 CSS 项落不了地。四个候选与代价见 `design-choice.json` W6 的 `openDecision`；设计侧不代为决定。默认建议沿革：R7 为 A（不授权）→ R8 因发现数据完整性缺陷改为 B（完整授权）→ **R11 改为 D（分级授权）**：B 隐含「全授权或全不授权」，而 V2 的 1 行修复与视觉 / DOM 三件事可拆，把最小修复从大礼包里拆出来能显著降低用户点头门槛（详见 §8「R11 算式订正与分级授权」）。

**基线证据边界**：`views/editor.ejs~` / `views/header.ejs~` 两个备份实测存在但 `git status` 无输出（未纳入版本控制），非运行时文件；`header.ejs~` 里残留旧 prettify link，**不得当作当前基线证据**。若后续落 `gates.config.json` 且 `ext` 含 `.ejs`，`~` 后缀不会被扫到，不构成门禁风险。`common/meta.ejs` 是后台独立 head，其 `:18` 的 meta refresh 受 `<%if(locals.state){%>` 条件包裹且不在前台渲染链上；§7 的「删 meta refresh」判据只适用前台 `meta-front.ejs`，QA 不按后台文件对前台账。

### R5 归属与决策性质更正

`9865e95 feat(editor): 用 Vditor 替换手写 textarea 编辑器（所见即所得 + 本地化，存储仍走 Markdown）` 作者是 `jiangzixin`（用户），`git diff --numstat -- views/editor.ejs` 为空证明团队未改该文件；任务书 §二.1 亦明令 `views/editor.ejs` 属用户改动、不许碰。因此**「是否启用 vditor」不是待决策项，是用户已做好的决定**——提交信息还确认「存储仍走 Markdown」，内容结构未变，符合本契约硬约束。此前回报的候选 ③「回退既有编辑器」**不可由团队自主执行**，除非用户明确要求撤销自己的提交。决策已由 R6 收敛：**vditor 保留**（用户 `9865e95` 已决定），emoji 面板按 §10「R6 裁决」判**不命中 P0-1、无需改代码**；405 个 vendor 文件已全部入库（`git ls-files public/vendor/vditor` = 405、`git status --short public/vendor/vditor` = **0，仅该目录**），「未跟踪资产」的交付风险已消除。**R9 数据订正**：全局 `git status --short` 实为 **20 个 M + 4 个 ??**（未跟踪的正是 `DESIGN.md` / `design-choice.json` / `design-tokens.json` 三份契约与 `tests/` 回归用例），此前写的全局 `= 0` 是把目录级结果误写成全局，已订正；三份契约未入库属交付动作，不是视觉资产风险。**仅就视觉 / 性能范围而言**，仍待收口的是第 7 份 CSS、样式表入口分裂（R7 已降为目标态偏离、不算缺陷），以及 `dist/index.css` + `content-theme/*.css` 的令牌覆盖；这些属性能与视觉一致性，**不属 P0**。**限定词不可省**：全项目范围另有 QA 按 P0 报的 V2（草稿回灌 / 每次加载均抛 `TypeError` 导致文章内容丢失，见 §10「R8 范围边界声明」）与 B2 两项 P0 仍待修，`release: no-go` 由它们支撑；本段不得被读成「全项目只剩两项、且都非 P0」。

### R9 对账收口（QA 撤回 V1 后的可测化与数据订正）

QA 按 R6 A/B 双判据重跑真机后**正式撤回 V1（emoji 功能图标 P0）**：入口 `[data-type=emoji]` 是 SVG `<use>`，面板 8 个 button 的 `data-value` 与显示字符一致，点击后 `getValue()` 在草稿正文前插入了与该值完全相同的字符，判据 B 成立；展开 Vditor 全部 10 个面板后面板外 emoji 节点 0、面板内 `a` / `nav role` 0；普通页浮层与输入「火箭」触发的搜索建议均 0。静态侧补 `.ejs` 后 94 文件、三个接线点全在扫描集，G01 PASS。**R6 裁定维持，不开 W7。**

**① 判据可测化（原本 QA 给不出 PASS/FAIL）**：「编辑页 ≤6」与「普通前台页 ≤3」的计数口径**统一固定为 HTML 源码里的 `<link rel="stylesheet">` 数**，不含 JS 运行时注入（R10 补：两类页面同等适用）。QA 实测编辑页运行时 `link[rel=stylesheet]` 为 **9** 份，多出的 2 份是 `/js/need/layer.css`（`layer.js` 注入，**404** 且控制台 MIME `text/html` 拒绝应用）与 `/vendor/vditor/dist/css/content-theme/light.css`（Vditor 注入，200 / 2560 B）；网络请求 9 次、实际生效 8 份；即便裁掉 `prettify.css`，源码变 6 份、运行时仍 8 次。前端 CDP 独立复现并补出**普通页同源事实**：`/` 的 DOM `link[rel=stylesheet]` = **4**、CSS 网络请求 = 4，多出的仍是 `layer.js` 自注入的 `/js/need/layer.css`（`id="layermcss"`、`rel="styleSheet"`、curl 直连 404、SW 控制下状态 `-`）。**运行时注入单独登记，不计入设计契约的样式表数判据**；`layer.css` 404 属资源缺陷，由前端 / QA 对账，不属视觉契约。

**② 门禁自动化状态**：W6 `conditions[2]`「接线点必须纳入 P0 与可访问性扫描」目前是**人工执行**，不是可重复门禁——真实项目根 `gates.py --root` 的 `files=1`（只命中 `tests`），只有显式 config 才 `files=94` 且含三个接线点。落 `gates.config.json`（`src` 含 `views`、`ext` 显式加 `.ejs`、`exclude` 含 `vendor`）需主理人授权新增项目文件，前端不擅自创建。授权前 QA 按 R6 双轨基线（静态扫描 + 真机展开浮层）人工取证有效，但不得宣称「已由自动化门禁覆盖」。

**③ 数据订正**：见本节上方「R5 归属与决策性质更正」的 R9 订正——`git status --short public/vendor/vditor` = 0 是**目录级**结果，全局实为 20 M + 4 ??（未跟踪的是三份契约与 `tests/`）。`W6.warn` 的「529 个未跟踪文件」标注为历史告警字段，以 `vendorStatus` 为准；`design-choice.json` 中三份 CSS 消费者表的结构化路径是 `waivers[W6].cssConsumers`（R9 由 `performanceEvidence` 提升为顶层键），不是 W6 原有的隐式字段，QA 按此路径对账。

**④ 编辑器可访问性已知限制（P2，登记待修、不重复报缺陷）**：R7 第 4 条只覆盖了「图标字体」，QA 补的三处同属第三方 / 禁改边界，一并登记：`editor.ejs:14` 的 `<i>` 无 `aria-hidden` / `aria-label`；8 个候选 button 无 `aria-label` / `title`，可访问名只有该 emoji 字形（按 R6 判据 B 它们是内容样本，理想读屏应为「插入该字符」而非字形名）；`.vditor-wysiwyg [contenteditable=true]` 无 `role` / `aria-label` / `aria-multiline`。三者需改第三方渲染或用户禁改文件，复审触发与第 4 条相同：用户日后自行改 `editor.ejs` 时一并补可访问名与 `aria-hidden`。

**⑤ 令牌覆盖（P1）运行时证据**：QA 实测 `theme.css` 及 13 份项目自有 CSS 的 vditor 选择器 = **0**，运行时按钮 `border-radius: 0px`、字体栈 `Helvetica Neue…`，与 `--radius: 12px` / 中文字体栈不一致——与 R7「必做」同向，是「第二套视觉语言」的实证而非推测。**R10 扩范围**：前端以 `localStorage['nl-theme']='dark'` 导航编辑页，实测 `data-theme=dark` 但 Vditor 注入的仍是 `content-theme/light.css`，`.vditor` 无 `data-theme` 属性、背景透明——即除 `editor.ejs:18` 的 `dist/index.css` 外，还有一份**运行时注入、自带配色、不随站点主题切换**的样式。因此「浅深双主题」覆盖对象必须是 **`dist/index.css` + `content-theme/*.css` 两者**，只覆盖前者会漏掉暗色路径；两者都只需在 `theme.css` 里覆盖，不必碰禁改的 `editor.ejs`。仍属零禁改冲突两项之一，等主理人排期。

**⑥ V2 已由 R8 登记**：`editor.ejs:90` 的草稿回灌数据丢失缺陷已落在 `W6.functionalDefect` 与 §10「R8 范围边界声明」，并已作为决策卡动因 D2 回报主理人；QA 不重复报「契约未登记」。

### R10 运行时精度修订（前端 CDP 补证 + QA 措辞限定）

三条新增事实，均**不改变既有裁定**，只收紧口径：

1. **「源码级计数」对两类页面同等适用**：普通前台页源码 3 / 运行时 4（`/js/need/layer.css` 404 注入）；编辑页源码 7 / 运行时 9（同一份 404 + `content-theme/light.css` 200）。§8 首条「≤3」与 R7「≤6」都按**源码 `<link>` 数**判定；运行时注入统一另登记，不进判据。
2. **令牌覆盖对象扩为两份**：`dist/index.css` **＋** `content-theme/*.css`。暗色实测 `data-theme=dark` 仍注 `light.css`、`.vditor` 无 `data-theme`、背景透明——「浅深双主题」必须在 `theme.css` 里同时压住这两份，只覆盖前者会留一条暗色漏网路径。
3. **V2 触发面**：`after` 回调**每次加载都抛 `TypeError`**，不限草稿回灌；属功能缺陷，仍按 §10「R8 范围边界声明」单列，不得被视觉口径关掉。

**QA 措辞限定**：§8「R5 归属与决策性质更正」末句的「仍待收口的只有…」已加「**仅就视觉 / 性能范围而言**」限定，并明确全项目另有 V2 / B2 两个 P0 仍待修、`release: no-go` 由它们支撑——避免被读成「全项目只剩两项且都非 P0」。

**`hardGate` 口径**：`design-choice.json` W6 `singleEntry.hardGate` 在 R9 已写为「HTML 源码中 `<link rel=stylesheet>` 数 ≤6…计数不含 JS 运行时注入」，与 §8 R7 表格一致；QA 若读到「编辑页样式表请求 ≤6」属 R9 前快照。R10 另把 `singleEntry.mustDo` 的覆盖对象同步扩为两份，消除 JSON 与 §8 的分叉。

### R11 算式订正与分级授权（前端复核后）

**① B 方案算式重复，已订正**：当前源码总 7 = `meta-front.ejs` 6（公共 2 + `needEditor` 分支 3 + `theme.css` 1）+ `editor.ejs:18` 1。B 把 link 搬进分支后 → 分支 4 / `meta-front` 7 / **源码总仍是 7**（只是位置变了，数量没变）；裁 `prettify.css` **1 份** → 分支 3 / `meta-front` 6 / 源码总 **6**，≤6 达成。所以**只需裁 1 份**。R7 原句「搬 link 后仍须再裁 1 份」成立的前提是「尚未裁 `prettify.css`」，B 把它与「裁 `prettify.css`」并列就重复计了一次。若还想裁 `font-awesome.css` 降到 5 份，须先把 `editor.ejs:14` 的 `icon-info-sign` 换内联 SVG（消费者消失后才可裁），属**带依赖链的可选优化**，不是判据必要动作——**不得让 QA 按「必裁 2 份」验收，也不得顺手裁掉仍有消费者的 `font-awesome.css`**。

**② 授权可分级，决策卡补第四个候选 D**：B 隐含「用户要么全授权、要么全不授权」，但 V2 的 1 行修复与视觉 / DOM 三件事**可以拆**。`views/editor.ejs` 是用户明令禁改的提交，让他一次授权 4 处（含 DOM）比只授权 1 行修复难得多；而 V2 是 P0 数据丢失，**与 B2 共同支撑** `release: no-go`（R13 订正：V2 不是唯一卡点）。

| 档 | 内容 | 是否需授权 | 效果 |
|---|---|---|---|
| 零授权 | 裁 `meta-front.ejs:25` 的 `prettify.css`（源码 ≤6）+ `theme.css` 补 `.vditor` 覆盖规则（含 `content-theme/*.css`） | 否，只改前端交付文件 | 视觉 / 性能收口，可与任何授权档并行 |
| 最小授权 | 只改 `editor.ejs:90` 一行：`after: function(){ sync(vd.getValue()); }`（`window.__vditor` 已挂） | 是，但授权面仅 1 行 | **清掉 V2 这一项 P0**，不动 DOM / 图标 / link；是清 V2 的最短路径，但 **`release: no-go` 仍被 B2 卡住，须 B2 单独复验后才谈解除** |
| 完整授权 | 再加图标字体换内联 SVG + 搬 link + 可选裁 `font-awesome.css` | 是，4 处含 DOM | 三层判据全部达成 |

`openDecision` 现为 A（完全不授权，V2 未修、`release: no-go` 不解除）/ B（完整授权，算式已订正）/ C（7 份全留挂豁免）/ **D（分级授权，R11 起为设计侧默认建议）**。**设计侧只补候选，不代用户决定**；D 的代价是单一入口仍为目标态偏离、图标字体维持已登记偏离、15.7 KB `font-awesome.css` 保留。

**③ dist 双证据源互认**：未压缩版 `dist/index.js:2528` / `:15840` 均为 `mergedOptions.after();`，压缩版 `index.min.js` 为 `after&&i.after()`（变量名压缩差异），两者指向同一根因——`this` 绑到配置对象而非 Vditor 实例。`functionalDefect.evidence` 可放心引用。

**④ §9 过时陈述已清理**：此前 §9 把 `about.ejs:8`「分类与标签体系」列为「待主理人 / PM 决策」，实为**已落地**——前端按任务书 §四.15 已改为「支持 Markdown 写作、全文检索，以及按分类浏览文章。」（`about.ejs:12`），全文「标签」0 命中，新增「联系」区块，`:8` 现为 `<p class="kicker">` 站名。我未核实实现状态就连续多轮复述，已改为事实陈述并同步 `design-choice.json` advisory；QA 勿按旧口径误报「待 PM 决策未落地」，主理人也不必再为此发卡。

### R12 资产清单与资源缺陷定性（QA / 前端双向补证）

**① `content-theme/` 现有资产（此前契约未登记）**：vendor 自带 `content-theme/light.css` 与 `content-theme/dark.css`，两份均 HTTP 200、各带一套色值 token。**计数权威口径见下方「R14 定稿」表**（R12/R13 的「13 hex token / 2851 B / 10 去重」等旧标签已作废，勿再引用）；两组数字指同一批文件，差异是「去重数 vs 出现次数」「字符数 vs 字节数」「两个不同文件」，不是两份资产、也不矛盾，结论一致。`content-theme/*.css` 的通配写法已覆盖后者，但契约此前只写了 `light.css`，**没有登记「有一份现成暗色主题资产可用」**。双向实测：暗色下 `data-theme=dark` 仍注 `light.css`、`.vditor` 无 `data-theme`、背景透明——**不是缺文件，是有文件没用**。这更支持「必须在 `theme.css` 里压盖」，而非改 Vditor 配置。

**② 必做项的两条实现路线（设计侧只登记资产与成本，不代定）**：
- **路线甲**：在 `theme.css` 里同时压盖 `light.css` 与 `dark.css` 的色值 token，站点深浅各用一套覆盖；不动 Vditor 配置、不碰 `editor.ejs`。
- **路线乙**：先让暗色切到 vendor 的 `dark.css`，再在 `theme.css` 里压盖使其与全站令牌一致；需改 Vditor 配置或注入逻辑，成本更高但起始色更接近。

两条都只改前端交付文件、零禁改冲突；**选哪条由前端与主理人排期时定**。判据不变：浅深两套下按钮圆角 8/12、`--accent`、中文字体栈、`focus-visible` 2px ring 全部对齐。

**③ `/js/need/layer.css` 404 定性**：QA 归因到既有 vendor 行为（`git diff --numstat HEAD -- public/js/layer/layer.js` 为空，HEAD `meta.ejs:26` 已链接 `/js/layer/need/layer.css`），属 **P2 资源缺陷、非本次重构回归**，已由 `runtimeInjection.injected[0].classification` 登记；建议 backlog 单列，不重复报缺陷，也不计入设计契约的样式表数判据。

**④ 两条非缺陷口径**：`window.NL.esc` 全项目真实调用点 **8 处**（`common.js` 7 + `sidebar.ejs:22` 1，`common.js:563` 是注释），B1 完好；单次干净导航的 CSS 请求权威值为**普通页 4 / 编辑页 9**（此前「13 次」是两次导航累计），与 `runtimeInjection.normalFrontend` 的 3/4/4 一致。

### R13 放行门槛订正与资产计数口径（QA advisory）

**① 「最小授权可解除 `release: no-go`」是误导上线的表述，已订正**：R11 分级表与 `openDecision.options[D]` 原把只改 `editor.ejs:90` 一行写成「解除 `release: no-go` 的最短路径」。QA 指出不成立——**`release: no-go` 由 V2 + B2 两项 P0 共同支撑**，只修 V2 仅清掉其中一项。B2 现状：`controllers/log.js:76` 的 `res.render(view,{title:doc.name,doc:doc})` 未改、`git status --short -- controllers/log.js` 与 `models/Log.js` 均为空；此前 3002 实例复现 `TypeError` + Unhandled 'error' event 打死进程，QA 按已存档证据 + 源码未变认定（未再打共享服务，以免打死 3000 / 3001）。**R14 补前端无意触发的只读复现入口**：`/log/detail?view=logDetail`（不带有效 id）当场打崩进程，stderr 完整堆栈 `TypeError: Cannot read properties of null (reading 'name')` at `controllers/log.js:76` ← `models/Log.js:34`，Unhandled 'error' event；实读两处源码确认 `doc` 为 null 时取 `doc.name` 即崩，前端已重启恢复、未改任何代码。这条给了 `releaseGate.v2RetestCriteria` 末项「B2 单独复验」一个可操作触发条件；**复验必须在隔离实例上做，禁止在共享 3000 / 3001 上触发**（会打死进程）。**结论：清掉 V2 这一项 P0；`no-go` 仍需 B2 修复并单独复验后才可解除**。R11 三处误导表述（§8 分级表效果列、§8 ② 段、§10「R8 范围边界声明」）与 `design-choice.json` 的 `decisionScope` / `options[D].cost` 已全部改为该口径；**R15 补漏**：`openDecision.recommended` 此前仍是 R11 原文「V2 是卡上线的 P0」单因措辞，也已改为「V2 是卡上线的 P0 之一，与未修的 B2 共同支撑 `release: no-go`」，至此 `openDecision` 内所有相关字段口径一致。

**② B2 不属设计契约范围，但排期 / 放行不得漏**：B2 是控制器渲染缺陷，修复归前端 / 主理人；设计侧不裁等级、不裁修法，只在 `W6.releaseGate` 登记其状态与复验门槛。QA 给的最小授权复验硬判据一并登记：只改 `editor.ejs:90` 一处 → 清空 localStorage 后 `Runtime.exceptionThrown=0` → 种草稿重载后隐藏 textarea 非空且等于 `vd.getValue()` → 保存路径读到非空 → 全量回归重跑 → **B2 单独复验后才谈解除 `no-go`**。

**③ QA 上报的另两项决策仍未落地，排期别漏**：决策 A（更多评论 `.fail()` 静默）与决策 B（`/comment/all`、`/session` 的 cache-first）均未落地。`decisionScope` 的「仅剩一个独立决策项」虽有 R10「仅指设计契约 / 视觉性能范围」限定，但排期时仍须把 A / B 单列，不得因该限定被读成全项目只剩一张卡。已登记进 `W6.openDecisionsOutsideDesign`。

**④ `content-theme/*.css` 计数口径精确化（R14 定稿，QA / 前端双向校正 + 设计侧独立复算）**：R12 把两套数字并列、R13 解释成「10/13 去重色值数」仍不准——**10 是 `dark.css`、13 是 `light.css`，是两个不同文件的值，不是同一文件的两个口径**；且「26 次出现」是 `dark.css`，`light.css` 的对应值是 24。设计侧按字节流重算四组数字，与双方实测逐格一致：

| 文件 | 字节数 | 字符数 | hex 出现 / 去重 | hex+`rgb()` 出现 / 去重 | HTTP |
|---|---|---|---|---|---|
| `light.css` | 2560 | 2556 | 21 / 11 | **24 / 13** | 200 |
| `dark.css` | 2855 | 2851 | 24 / 9 | **26 / 10** | 200 |

权威口径：**「10 / 13」= 两个文件各自的 hex+`rgb()` 去重值**（`dark` 10、`light` 13），**不是 hex-only**（hex-only 去重分别为 9 / 11）；**「26 / 24」= hex+`rgb()` 出现次数**（含变量值引用）；**2851 / 2556 是字符数，2855 / 2560 是字节数**，同一文件因含非 ASCII 字符而有差值，不是两份资产。R12 的资产清单、甲 / 乙两条实现路线与「有文件没用」结论不变。此表为下轮对账的唯一权威标签，勿再引用 R12 的「13 hex token / 2851 B」。

## 9. 签字与交接

- 上游消费：`PRD` / 项目现状。下游验收：前端按 `design-tokens.json` 实现，QA 按本文件 §1/§5/§7 逐条对账。
- 三轴刻度：`DESIGN_VARIANCE=3`（可预测、左对齐、非对称仅在首页 lead）、`MOTION_INTENSITY=2`（仅 hover/active）、`VISUAL_DENSITY=5`（内容站日常密度）。
- 签名特征自查：**命中 0 条**（无 emoji、无紫粉渐变、无渐变文字、无发光、无居中 Hero+三卡、无 rounded-2xl 一把梭、无 italic serif、无等距留白、无无意义微动效、无库存插画、无三档定价表）。理由：① 主色 `#1d4ed8` 取自「链接文字必须 ≥4.5:1」的实算结果，不是审美偏好；② 圆角 8/12 按「按钮 vs 卡片」角色分档，不是统一 `rounded-2xl`；③ 字体沿用项目系统栈并补齐中文回退，不引入展示字体。遮住站名，仍能靠「顶栏常驻检索 + 首屏真实文章元数据 + 68ch 正文」认出这是 NODELOG。
- 知识库落地：`ROUTER.md §一/二` 路由 → `design-voice.md §二/三/四/五`（≥3 倍尺度差、节间节奏、强调色 ≤5%）、`measured-craft.md §二/四之一`（正文 ≥16px、行宽 ≤88 字符、44px 触控、对比度实算、P0 评级）、`ui-judgment.md §二/六`（反馈按寿命选表面、一页一种加载态、字重 ≤500）、`visual-defect-taxonomy.md §一/二`（7 档间距、834 断点、z-index 七层、中文字体栈、安全区）、`accessibility.md §一/三/五`（4.5:1、focus-visible、reduced-motion）。
- **已落地（R11 订正，此前误列为待决策）**：`views/about.ejs` 的「分类与标签体系」文案已由前端按主理人任务书 §四.15 改为「支持 Markdown 写作、全文检索，以及按分类浏览文章。」（`about.ejs:12`），全文「标签」**0 命中**；同批加了面包屑、`kicker` 类名、`prose-single`，并新增「联系」区块（`:14-23`，读 `session.site.phone/email/address` 兜底）。`git diff -- views/about.ejs` 有明确的 `-分类与标签体系` → `+按分类浏览文章`，前台真机 `/about` 已渲染新文案。**归属：前端实现，非 PM 待决项**；本契约不动内容、不新增标签功能。此前 §9 把它写成「待主理人决策」且行号停在 `:8`（现 `:8` 是 `<p class="kicker">` 站名），属未核实实现状态的过时陈述，已删除；`design-choice.json` advisory 同步改。

## 10. Do's and Don'ts

**Do**：所有值从 `design-tokens.json` 取；每页启用 ≤5 档字号；节间 48px（全页仅一处 72px）；四类状态一律走 `common/state.ejs`；错误必带重试且保留输入；所有 `js-*` / `data-*` / `id="tagCloud"` 钩子原样保留；每对文字/背景在浅深两套主题下都验过 4.5:1；浮层三验（可关闭、贴边翻转有终态、不被 overflow 裁剪）。

**Don't**：组件内不写裸 hex（只允许 `var(--token)`）；不用 emoji / 图标字体 / 紫粉渐变 / 渐变文字 / 发光；不新增标签功能、标签路由或任何依赖；不用六张等大卡片从头排到尾；不把加载失败写成「暂无…」；不用 `maximum-scale=1` 或 meta refresh 自动跳转；不在同一元素上叠加 border 与 shadow；不把 Toast 放进可能被卸载的面板内；不靠加粗（>500）或阴影堆叠做层级。

### 已登记的实现偏离（Phase 3 复核）

前端实现复核结论：`theme.css` :root 的九槽、语义四件套、深色全套、八档字号、间距/圆角/z 七层、中文字体栈与 `design-tokens.json` **逐值一致，无数值漂移**；`common/state.ejs` 的 DOM 骨架、`role`/`aria-live`、骨架 + `.sr-only`、内联 SVG 规格、`.js-state-retry` 全部符合 §5；`common/meta-front.ejs` 已无 `maximum-scale=1` 与 meta refresh；`error.ejs` 按 404/500 分态并给两个可点动作；`common/sidebar.ejs` 的 catch 为 error + 重试，且失败时保留已渲染 chips。以下三条是有意偏离，QA 按此口径对账，不算缺陷：

1. **配色字面量**：`design-choice.json` 登记库 id `ink-blue-light`（库基线 primary `#2b67b6`，实测 **5.65 / 5.40 / 5.65:1，本身已达标**），项目按「更大对比度余量 + 深色 `#6aa6ff` 配对 + hover 阶 `#1a43b8`」落地 `#1d4ed8`（6.70 / 6.41 / 6.70）。库 122 套配色无一 primary 等于 `#1d4ed8`，故 `design_choice_check` 的「CSS 里没找到所选配色主色」WARN 无法靠换库 id 消除，登记豁免。**不得为让门禁绿而把实现改回 `#2b67b6`**——那既降低余量又要同步改三份契约文件。
2. **Toast 宿主**：`#nl-toast-host` 保持 BODY 直属但为空，瞬时操作结果反馈走既有 layer 弹层，不造第二套 Toast 视觉语言。layer 反馈仍须遵守 §5：只报「已完成/失败」、不报进行中、失败保留输入。
3. **整页加载**：本站是 SSR + 浏览器原生导航，进度由浏览器指示，不额外插居中 spinner；局部异步刷新一律骨架屏。符合「一页只有一种加载形态」。
4. **编辑页图标字体（R7 新增）**：`views/editor.ejs:14` 的 `<i class="icon-info-sign">` 是图标字体，违反 §5「零图标字体」。它属用户 `9865e95` 提交、任务书 §二.1 明令禁改，且**不命中 P0 三条**（非 emoji 功能图标、非紫粉渐变、非 AI 模板味），故不按 P0 处理、不开豁免，登记为禁改边界内的既有资产。**复审触发**：用户日后自行修改 `editor.ejs` 时须换成内联 SVG（16/20/24px、viewBox 24、stroke 1.75、`currentColor`）；在此之前 `font-awesome.css` 不得单独裁掉，否则提示图标消失。详见 §8「R7 判据可达性修正」。

`typePair` 已从 `geist-geist` 更正为库内 `app-type`（SF Pro / system-ui + system-ui，`overused=false`），与项目实际的零依赖系统字体栈一致，`design_choice_check` 的「高频默认字体」WARN 随之消除。

### R3 复核补登记（后台令牌 / 分页双实现 / 漂移门禁口径）

- **后台导航令牌**：`theme.css:28-32` 的 `--manager-nav-bg/-fg/-line/-hover/-edge` 是**既有后台深色顶栏身份的令牌化**（重构前就写死 `#1f2530` + 白字），不是前台第二套调色板。仅在 `:root` 定义段出现裸 hex，深色在 `:root[data-theme="dark"]`（92-93 行）覆盖为 `#12151a` / `#eef1f5`；组件内全部 `var(--manager-nav-*)`，实测 theme.css 第 100 行之后**零裸 hex**。对比度实测：浅色 `#ffffff` on `#1f2530` = **15.38:1**，深色 `#eef1f5` on `#12151a` = **16.15:1**。已补登记进 `design-tokens.json` 的 `managerNav` 段；**前台组件不得引用这些令牌**。
- **分页双实现**：前台主分页收敛为 `common/pagination.ejs` 的纯链接数字分页（`.pager-link`、`aria-current="page"`、`rel=prev/next`、逐页 `aria-label`），无 JS 也能用、可深链接，优于旧 `href="####"` + JS 跳转。遗留 `common/pager.ejs` 的 `js-pre-page` / `js-next-page` / `data-url` / `data-page` / `data-total` 与 `common.js:342/354` 钩子**全部保留**给仍依赖 JS 的页面。纯链接分页不存在异步失败态，`state.ejs` 的 error 态只适用于 JS 版分页、评论区、搜索建议与侧栏标签；QA 不要把「新分页没有 error 态」当缺陷。
- **`design_drift_check` 口径**：本轮跑出 5 处，**P0=0**。DR02/DR03/DR04/DR06 的 171 个色值 / 17 个字号 / 6 个圆角 / 未声明字重**全部命中第三方遗留 CSS**（`bootstrap.css`、`bootstrap-switch.min.css`、`font-awesome.css`、`bootstrap-combined.no-icons.min.css`），前台实际只加载 3 份 CSS（`meta-front.ejs:18-27` 已收敛），门禁按目录全扫把未加载的遗留文件也算进来，属扫描范围问题，登记豁免 W4。DR08 的 15 个「定义未引用」令牌是兼容别名（`--primary` / `--primary-weak`）、语义四件套完整位（`--info-tint` / `--info-ink`）与刻度占位，**不得因该告警删除**——删掉 info 位，下次做提示条时前端只能自创色，登记豁免 W5。
- **R18 扫描范围边界：`.design/*-profile` 工具产物会造成门禁假红（QA 备案，非缺陷、不提单）**：`design_drift_check` 的 `SKIP` 集合（`node_modules` / `.git` / `dist` / `build` / `.next` / `.nuxt` / `vendor` / `coverage` / `.gates` / `__pycache__`）**不含 `.design`**，其 `rglob` 会扫进 CDP 临时 profile 里 Chrome 扩展自带的 `antd.min.css` / `content.css` / `main.css`，报 `[P0] DR07 未定义令牌 63 个`。QA 构造排除 `.design` 的临时根重跑得 P0=0 / exit=0，随后该 profile 被并行清理，真实根自动恢复 exit=0 / P0=0；前台 3 份、编辑页 7 份 CSS 均不含这些文件。**按误报纪律：不删门禁规则、不加全局 ignore、不新开豁免（waivers 仍 W1–W6）**；处置为**交付前清理 `.design/*-profile`**，若长期免打扰需把 `.design` 加入门禁 `exclude`——那是主理人授权动作，设计侧 / QA 均不擅改。本条与 §5 R17 里 `design_choice_check` 的 `FileNotFoundError` 是**同一污染源、同一类环境竞态**（工具产物在扫描遍历期间被创建或清理），共同支撑「并行采样不作裁决依据」：以稳定态连续采样为准。

### R4 / W6：vditor 编辑器的 P0-1 边界（条件性条款）

**事实（Phase 4 实读，不再是前瞻）**：`views/editor.ejs:9-19,66-92` 已实例化 Vditor（`mode:'wysiwyg'`、`cdn:'/vendor/vditor'`），并被 `views/addContent.ejs:14`、`views/editContent.ejs:17` include，即 `/content/addPage` 与 `/content/edit` 两个编辑页已加载 `public/vendor/vditor/**`。`dist/index.js:14403+` 的 41 处 emoji 是 shortcode→unicode 映射表（`"+1"` → U+1F44D、`"rocket"` → U+1F680），`dist/index.js:5050` 的 `toolbar.elements.emoji` 是 SVG 按钮、其 `lastElementChild` 才是面板。

**设计侧裁定（只判视觉边界，不替主理人决定要不要用 vditor）**：P0-1 的原文例外是「emoji 仅允许出现在用户生成内容（UGC）中，绝不作为 UI 功能图标」。上述映射表的用途是把 `:rocket:` 转成字符**插入文章正文**，属 UGC，因此**不违规**。但接线必须满足三条：

1. toolbar 按钮、emoji 面板控件、编辑器内所有功能图标一律用项目锁定的内联 SVG（16/20/24px、viewBox 24、stroke 1.75、`currentColor`），**不得用 emoji 字符当功能图标**；§5 的状态图标规格同样适用于编辑器内的上传/保存反馈。
2. `editor.ejs:18` 内联的 `dist/index.css` 自带配色/圆角/字体/按钮形态，是**第二套视觉语言的入口**（比 emoji 更实质）。**R10 扩范围**：覆盖对象是 `dist/index.css` **＋** Vditor 运行时注入的 `content-theme/*.css`（暗色下仍注 `light.css`、`.vditor` 无 `data-theme`、背景透明，只覆盖前者会漏掉暗色路径）。必须由 `theme.css` 令牌覆盖到与全站一致（`--accent: #1d4ed8`、圆角 8/12、中文字体栈、`focus-visible` 2px ring、浅深双主题含暗色背景与文字色）；两份都只改 `theme.css`，不碰禁改的 `editor.ejs`。**「单一入口」已由 §8 R7 降为目标态登记，不作放行判据、不算缺陷**（达成需授权改 `editor.ejs` 且裁 1 份，即 `prettify.css`，见 R11 算式订正）；放行判据只有 **HTML 源码 `<link rel=stylesheet>` 数 ≤6**（§8 R5：≤3 只适用普通前台页，同为源码级计数；R11 统一口径）。`theme.css` 里 `.vditor` / `vditor-` 覆盖规则实测 **0 条**，此项连起步都没有，须与裁 `prettify.css` 一起作为零禁改冲突组合排期。
3. 门禁 `exclude:["vendor"]` **只跳过第三方源码本身**；接线点 `editor.ejs` / `addContent.ejs` / `editContent.ejs` 必须纳入 P0 扫描与可访问性检查，不得因资源在 vendor 就把整条链路排除在契约之外。

**条件性**：本条仅在 vditor 被保留时适用；若用户主动要求移除该编辑器，W6 自动失效，不必改写契约。**归属更正见 §8「R5 归属与决策性质更正」**：`9865e95` 是用户自己的提交、`views/editor.ejs` 明令不许碰，因此「是否启用 vditor」不是待决策项；此前回报的候选「回退既有编辑器」不可由团队自主执行。**R6 更新（R12 数据订正）**：405 个 vendor 文件已全部入库（`git ls-files public/vendor/vditor` = 405，`git status --short public/vendor/vditor` = **0，仅该目录**），「未跟踪资产」的交付风险已消除；全局 `git status --short` 实为 **20 M + 4 ??**（三份契约 + `tests/`），与 §8「R5 归属与决策性质更正」的 R9 订正一致。此处原把目录级结果写成全局，R9 只订正了 `:343` 漏了本行，R12 补齐。emoji 面板的性质判定见下方「R6 裁决」。

### R6 裁决：emoji 面板的 P0-1 性质判定（真机证据）

**QA 的发现属实，不是误报**：CDP 在 `/content/addPage` 展开 Vditor emoji 面板后，实测 8 个 `<button>` 内含 `<span class="vditor-emojis__icon">` 候选字符；工具栏 `data-type="emoji"` 入口按钮本身是 SVG。源码证据 `dist/index.js:12907-12917`：遍历 `vditor.options.hint.emoji` 生成 `<button data-value=":key: " ...>` 或 `<button data-value="[字符] " ...>`，按钮上显示的字符**就是要插入正文的值**；另一分支用 `<img class="vditor-emojis__icon">` 贴图。

**裁定：不命中 P0-1，且这不是豁免。** P0 不可豁免（waiver 协议禁止），无需也不得为此开 W7。理由是这些字符**不属于 P0-1 的定义域「UI 功能图标」**：P0-1 禁的是「用 emoji 代表一个操作 / 状态 / 导航目标」（如用 U+1F680 代表发布、U+1F4CA 代表看板），而这里字符是**内容选择器的候选样本**——换成别的字符就改变了插入结果，与颜色选择器的色块、字体选择器的字母样本同类；入口按钮本体是 SVG。R4 的单判据「这个字符是否在充当按钮图标」在此边界情况上不够可操作，R6 细化为 A/B 双判据（**是细化，不是放宽**）：

- **判据 A → P0 违规**：字符代表一个操作 / 状态 / 导航目标，换成任意别的字符不改变按钮的功能语义。
- **判据 B → 不违规**：字符就是要被插入 / 选择的内容本身，换字符即换结果，且只出现在明确的内容候选面板内。

**三条硬约束（防止判据 B 被滥用）**：① 此类字符只允许出现在 `vditor-emojis` 这类明确的内容候选面板内；② 面板入口按钮（工具栏 `data-type="emoji"`）必须保持 SVG；③ 面板不得被复用作导航或操作区。**复审触发**：面板外任何位置（导航、工具栏按钮本体、状态提示、标签、Toast、空态、按钮文案）出现 emoji 当图标，或入口按钮换成 emoji 字符，或面板被改作操作区 → 立即升级 P0，无需再裁定。

**对 QA 三个选项的回应**：① 去掉 `emoji` 工具栏项 —— 不采纳，会砍掉用户 `9865e95` 已决定的所见即所得能力，且无必要；② 登记豁免 —— 不采纳该形式（P0 不可豁免），但采纳其中「写清边界 + 复审条件」的实质，已落在上述双判据与硬约束；③ 换成语义 SVG —— 不采纳，自相矛盾：候选样本必须显示字符本身，换成 SVG 用户就不知道要插入什么，且需改第三方渲染。**结论：emoji 面板不需要改任何代码**——范围限定见下方「R8 范围边界声明」：只指视觉与图标边界，不覆盖编辑器功能缺陷。

**验证方式（写进验收基线）**：P0-1 **不能只靠静态 grep 判定**。本次静态 G01 扫描（补 `.ejs` 后 94 文件）PASS，但边界现象只出现在运行时渲染的 DOM。P0-1 的验收 = 静态源码扫描（接线点三 EJS 必须纳入、vendor 源码可排除）**＋** 真机展开所有浮层 / 下拉 / 面板检查运行时 DOM，两者都过才算过。必查清单：分类下拉、搜索建议、登录 / 注册弹层、评论加载更多、主题切换、Vditor 工具栏全部面板（emoji / 上传 / 大纲 / 帮助）。

**G18 误报登记**：`views/header.ejs:58-59` 的搜索输入已有 `role="searchbox"`、`aria-label="搜索文章"`、`aria-autocomplete="list"`、`aria-controls="nl-search-suggest"`，且 `:59` 的 `<ul id="nl-search-suggest" role="menu" aria-label="搜索建议" aria-live="polite">` 与之对应，符合 WCAG 4.1.2 与 3.3.2 的可访问名称要求。`<label>` 不是唯一形式，G18 命中属**误报，记为 PASS**；按误报纪律登记理由，不删规则、不加全局 ignore。

### P0-1 补充：UGC 例外

§10 Don't 的「不用 emoji」指**功能图标**，不是禁止用户内容出现 emoji。文章正文、评论、标题中由作者/访客输入的 emoji 属 UGC，允许原样保留；判定线是「这个字符是否在充当按钮、状态、导航或标签的图标」。是 → 违规；否 → 合法内容。

### R8 范围边界声明：R6 / R7 的「不需要改代码」不能外推到功能缺陷

**触发**：前端指出 QA 本轮报的是**两个** P0，R6 只裁了 emoji 面板那个；「草稿回灌后保存提交空内容」仍在，且同属用户禁改文件。这条我此前完全没见过，实读取证后确认成立。

**取证**：`views/editor.ejs:90` 是 `after: function () { sync(this.getValue()); }`；`public/vendor/vditor/dist/index.js:2528` 与 `:15840` 均为 `mergedOptions.after()` 直接调用，`this` 绑到配置对象而非 Vditor 实例，`getValue` 未定义。`input: sync(value)`（`:89`）只覆盖输入路径，草稿回灌不走这条，隐藏 `.js-editor`（`:11`）留空，`common.js` 保存时读空 → **用户文章内容丢失**。**R10 补触发面**：前端 CDP 打开编辑页**不写草稿**也会抛 `Uncaught (in promise) TypeError: this.getValue is not a function`（栈 `Object.after (addPage:223)` ← `dist/index.min.js`），即 `after` 回调**每次加载都失败**，不只草稿回灌时；QA 在新 footer 脚本链上复现「草稿重载后隐藏 textarea 为空 + 2 次 TypeError」。归属与结论不变（仍是 `9865e95`、禁改文件），但说明 Vditor 链路的视觉与运行时行为都需在 W6 边界登记里留痕。`window.__vditor = vd`（`:92`）已挂载；前端给出的 1 行闭包修法（`vd.getValue()`）属实现层，设计侧不裁修法。

**定性**：这是**数据完整性 / 功能缺陷**，不属设计契约的视觉边界。设计侧不裁定其 P0 等级（QA 已按 P0 报）、不裁技术修法、更不因 R6「emoji 不命中 P0-1」把它连带关掉。**R6 的 `codeChangeRequired: false` 与 R7 的「不需要改代码」只覆盖视觉与图标边界**（emoji 面板、UGC 例外、CSS 请求数与入口、令牌覆盖口径），不覆盖编辑器功能缺陷。QA 对账须把它单列，不得标成「已由设计侧裁定为不需改码」。

**它是「是否授权改 `views/editor.ejs`」的第二个、且更严重的动因**：CSS 收口是性能与一致性，这个是数据丢失。因此 R7 给出的默认建议 A（不授权 + 只裁 `prettify.css`）**不再成立**——A 会让该缺陷继续挂着。**R11 更正**：R8 一度改为 B（完整授权四件事），但 B 隐含「全授权或全不授权」；V2 的 1 行修复与视觉 / DOM 三件事**可以拆**。**设计侧默认建议改为 D（分级授权）**：最小授权只改 `editor.ejs:90` 一行修 V2（清掉 V2 这一项 P0 的最短路径；**`release: no-go` 仍被 B2 卡住**，见 §8「R13 放行门槛订正」），零授权两项并行，完整视觉收口留待用户后续意愿。仍由主理人 / 用户决定；若用户拒绝任何授权，须把该缺陷转单独立项并明确记录「未修」，不得因视觉口径关掉。详见 §8「R11 算式订正与分级授权」。

**零禁改冲突的两项不必等授权**：① 裁 `meta-front.ejs:25` 的 `prettify.css`（达成 ≤6）；② 在 `theme.css` 补 `.vditor` 覆盖规则（`--accent`、圆角 8/12、中文字体栈、`focus-visible` 2px ring、浅深双主题）。第 ② 项实测 `theme.css` 中 `.vditor` / `vditor-` 规则数 = **0**，连起步都没有；两项都只改前端自己的交付文件，可与授权决策并行排期。
