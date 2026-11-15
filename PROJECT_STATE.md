# 项目状态（PROJECT_STATE）

> 每次 Phase 切换、成员回传、需求变更后增量更新。新会话先读这一页。

## 1. 目标与阶段
- 一句话目标：为 NODELOG 前台重定义一套独特、高端、统一、可落地的设计语言，解决「排版辨识度不足、风格偏普通」，并交付首页/列表页/文章页的明暗 × 移动端应用效果。
- 当前阶段：Phase 3（生产落地）**已完成**——「登记簿 / The Numbered Register」已落到 `public/css/theme.css` + 改写 `views/**/*.ejs`，删尽 9 类贴皮，新增登记轨系统。
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
| 视觉方向 | **采纳「登记簿 / The Numbered Register」**（用户确认） |
| 是否落地生产 | **授权落地改生产文件**（用户确认）；参考站 jiangzi.xin / saas.jiangzi.xin 经实抓分析判定**不参考**（两套体系不统一、品类不匹配、手法触发 P0） |

## 5. 下一步
1. 用户本地 `node ./bin/www`（需 MongoDB）起服，Chrome 复验首页/列表/文章三页明暗 × 桌面/移动，重点看 72px 左缘登记轨三页对齐、17px 不缩、移动端零横向滚动。
2. 若需微调：深色 `--muted` 小字号偏淡（已知小项）可按 §3 微调；登记轨序号当前为分页内 1-based，如需全站连续序号由路由传入全局序号。

## 6. 边界与约束（实读事实，勿重复排查）
- 工作区 `master` 已有他人未提交改动，**本轮只在 `design-language/` 新建文件**，不碰 `theme.css` / `views` / `DESIGN.md` / `design-tokens.json` / `design-choice.json`。
- 既有契约是上一轮继承式产物，本次是「换视觉世界」不是收口。
- 现有视觉问题根因：`theme.css:148–207` 终端贴皮 + 通用墨蓝 `#1d4ed8` + 系统字体一把梭 + 卡片网格到底。
- 站点自称「打造最快的搜索体验」，作者「匠子心」，无可用真实摄影图（故头条默认「登记带」而非封面）。
- 反模板：避开第一波（紫渐变/三卡/emoji）与第三波（米黄奶油底+陶土锈橙+高对比衬线+满屏发丝线报纸腔）。
- P0：禁 emoji 图标、禁紫粉渐变、禁渐变文字/发光、禁居中 Hero+三卡、禁 rounded-2xl、禁贴皮极客符号；零新增依赖。
- 门禁只认目录根下 `.html`；须 `--root design-language` 避免全项目历史 CSS 假红。
