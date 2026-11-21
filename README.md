# NODELOG

> 一个基于 Node.js + MongoDB 的内容站源码：博客 + 独立知识库（Wiki）一体化。
> 本站 [链付收银博客](https://blog.jiangzi.xin) 即基于本源码搭建；NODELOG 是源码项目名，不是站点名。
>
> **授权**：自 2026-11-21 起本软件为商业授权软件，商用部署需取得授权，详见 [`LICENSE`](LICENSE)。
> 此前版本仍按 Apache 2.0 授权（见 [`LICENSE-APACHE-2.0`](LICENSE-APACHE-2.0)）。个人学习/本地试用不受限制。

## 特性

- **博客前台**：文章列表 / 详情 / 分类 / 标签 / 归档 / 全文搜索、评论、扫码登录、深色模式、二维码分享。
- **知识库（Wiki）**：多知识库（Space）、页面树、面包屑、三栏文档中心、`/wiki/:spaceSlug/:pageSlug` 语义路由；文档归作者所有，登录用户可建自己的库与文档，管理员可管理全部。
- **搜索**：MongoDB `$text` 索引（标题/标签/正文派生文本，带权重）+ 中文子串两路召回；`Ctrl+K` / `⌘K` 全局命令面板，边输入边搜、结果分组、面板内分页（←→ 翻页）、博客/知识库范围隔离与跨库开关。
- **后台管理**：文章/分类/标签/用户/评论/公告/链接/风控告警/开放平台应用管理，统一 UI 组件（NL.toast / NL.alert / NL.modal）。
- **开放能力**：扫码登录、公众号 JS-SDK 分享签名、文章发布 API v3（应用凭证鉴权）、站点公告 API。
- **运维友好**：限流、风控守卫、审计日志、备份/迁移/自检脚本齐全。

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Node.js（Express 4.x） |
| 模板 | EJS 3 |
| 数据库 | MongoDB 4+（Mongoose 6） |
| 会话 | express-session + connect-mongo |
| 前端 | 原生 JS（无打包）、Vditor 编辑器、CSS 变量主题（tokens.css / theme.css / app.css） |
| 进程管理 | pm2 |
| 反向代理 | Nginx（可选，生产推荐） |

主要依赖及版本见 [`package.json`](package.json)。

## 快速开始

### 1. 环境要求

- Node.js（建议 16+，项目使用 Express 4 / Mongoose 6）
- MongoDB（本地或远程，4.x+）
- npm

### 2. 安装依赖

```bash
git clone https://gitee.com/nodelog/nodelog.git
cd nodelog
npm install
```

> 也可从 GitHub 克隆：`git clone https://github.com/nodelog/nodelog.git`

### 3. 配置

复制配置模板并填入真实值（**`settings.js` 已被 git 忽略，不会进版本库**）：

```bash
cp settings.example.js settings.js
```

最小配置只需改三处：

```js
module.exports = {
  port: 3000,
  cookieSecret: '换成足够随机的长字符串',
  url: 'mongodb://127.0.0.1:27017/ctit'   // 或旧键名 dbUrl
};
```

MongoDB 连接串也可用环境变量注入：`MONGO_URL` / `MONGODB_URI`（优先级见 [`models/mongodb.js`](models/mongodb.js)）。
邮件（评论通知/风控告警）、开放平台、API 等可选配置及环境变量说明见 [`settings.example.js`](settings.example.js) 内注释。

### 4. 启动 MongoDB

```bash
# 示例：后台运行，自定义数据与日志目录
mongod --fork --dbpath=/usr/local/mongodb/data --logpath=/usr/local/mongodb/log/mongodb.log --logappend
```

### 5. 启动应用

```bash
# 开发：直接启动
npm start                       # = node ./bin/www

# 生产：pm2 守护（-i max 按 CPU 核数起集群）
pm2 start bin/www -i max
pm2 logs                        # 查看日志
pm2 restart all                 # 重启
pm2 reload all                  # 0 秒停机重载
```

访问 <http://127.0.0.1:3000>。

### 6. Nginx 反向代理（生产可选）

要点：**静态资源指向 `public/`，其余反代到 Node 端口**，并拒绝隐藏文件访问。

```nginx
server {
    listen 80;
    server_name blog.example.com;
    root /path/to/nodelog;

    location ~ ^/(images/|js/|css/|font/|fonts/) {
        root /path/to/nodelog/public;
        access_log off;
        expires max;
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location ~ /\.(ht|svn|git) { deny all; }
}
```

## 目录结构

```
nodelog/
├── app.js                 应用入口（中间件/路由装配）
├── bin/www                HTTP 启动文件
├── routes/index.js        全部路由声明
├── models/                Mongoose 模型与 DAO（Content / Space / User / Category / Tag…）
├── controllers/           业务逻辑（content / wiki / spaceAdmin / contentQuery / api…）
│   └── moderation/        风控守卫
├── services/              告警、树构建、主题等无状态服务
├── views/                 EJS 模板（前台 + manager/ 后台 + wiki/ 知识库）
├── public/
│   ├── css/               tokens.css / theme.css / app.css（设计令牌→语义→结构）
│   ├── js/                common.js / ui.js / cmd-search.js（命令面板）/ wiki*.js …
│   └── images/            图片资源（含分享封面 share-cover.png）
├── scripts/               迁移 / 自检 / 运维脚本（见下）
├── tests/                 离线单测
├── docs/                  产品与设计文档
└── settings.example.js    配置模板（复制为 settings.js 使用）
```

## 路由速览

| 类别 | 路径 |
|---|---|
| 前台 | `/`、`/content/detail`、`/content/category`、`/tag/:slug`、`/tags/all`、`/about`、`/log` |
| 知识库 | `/wiki`（全部公开库）、`/wiki/:spaceSlug`（某库）、`/wiki/:spaceSlug/:pageSlug`（文档） |
| 创作 | `/content/addPage`、`/content/edit` |
| 搜索 | `/content/search`、`POST /api/search/suggest`（命令面板建议） |
| 后台 | `/manager`（概览）、`/manager/content`、`/manager/wiki`（知识库工作台）、`/manager/category`、`/manager/tag`、`/manager/user`、`/manager/index/status`（索引状态） |
| 开放 API | `/api/auth/token`、`/api/articles`、`/api/announcements`、`/api/alert/*`、`/open/jsConfig`（公众号签名）、`/open/qrcode` |
| 上传/会话 | `POST /api/upload`、`/session` |

## 常用命令

`package.json` 中已定义的脚本：

```bash
npm start                      # 启动应用
npm run automation             # 风控自动化（全量）
npm run automation:probe       # 探测告警 SMTP 并真实发一封测试邮件
npm run test:automation        # 风控离线单测
npm run test:alert-api         # 告警 API 链路测试（本地 SMTP，无需生产凭据）
npm run admin:verify           # 后台框架自检
npm run admin:ui:verify        # 后台 UI 自检
npm run announce:dry-run       # 站点公告回填预演
```

其他运维/迁移脚本（直接在项目根执行）：

```bash
# 全文检索索引：改了索引定义后必须重建（旧 {name,content,tags} → 新 {name,searchBody,tags}）
node scripts/rebuild-search-index.js --report    # 查看当前 text 索引
node scripts/rebuild-search-index.js --apply     # 重建（幂等）

# 历史数据回填 / 迁移
node scripts/migrate-doc-type.js --report        # docType / searchBody 回填诊断
node scripts/migrate-html-to-md.js               # 正文 HTML → Markdown
node scripts/import-help-to-wiki.js              # 帮助文档导入知识库

# 自检
node scripts/test-api-credential.js              # 静态断言
node scripts/verify-open-platform.js             # 开放平台自检
```

## 文档

- [`docs/WIKI_SYSTEM_DESIGN.md`](docs/WIKI_SYSTEM_DESIGN.md) — 知识库体系设计定案与 WP1~WP4 / 搜索底座全部迭代记录（**功能全貌以此为准**）
- [`docs/BLOG_WIKI_UPGRADE_PLAN.md`](docs/BLOG_WIKI_UPGRADE_PLAN.md) — 博客 + Wiki 升级总体方案
- [`docs/article-api.md`](docs/article-api.md) — 开放文章发布 API v3
- [`docs/open-platform.md`](docs/open-platform.md) — 开放平台（扫码登录 / JS-SDK）
- [`docs/admin-framework.md`](docs/admin-framework.md)、[`docs/admin-ui-framework.md`](docs/admin-ui-framework.md) — 后台框架约定

## 部署检查清单

1. `settings.js` 配置正确（端口、cookieSecret、MongoDB、邮件/开放平台可选）。
2. MongoDB 可连接，应用能启动：`npm start` 无报错。
3. 全文索引已重建（见上方 `rebuild-search-index.js`）——否则 `$text` 仍走旧字段。
4. 静态资源路径在 Nginx 中正确指向 `public/`（否则 JS/CSS 404）。
5. pm2 集群启动后用 `pm2 logs` 观察无异常。

## 源码仓库与授权

- Gitee：<https://gitee.com/nodelog/nodelog>
- GitHub：<https://github.com/nodelog/nodelog>

仓库用于源码展示与个人学习。**商用部署（含企业/客户站点、二次分发）需取得商业授权**，
授权范围、价格与支持方式见 [`LICENSE`](LICENSE) 或访问项目站点的「源码授权」页（`https://blog.jiangzi.xin/license/`）咨询。
历史版本（2026-11-21 前）仍以 Apache 2.0 授权，见 [`LICENSE-APACHE-2.0`](LICENSE-APACHE-2.0)。
