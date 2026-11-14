// NODELOG 运行配置模板
// 用法：复制本文件为 settings.js 并填入真实值。
// settings.js 已被 .gitignore 忽略，不会进入版本库，避免泄露密钥。
// 注意：app.js 读取的字段为 port / cookieSecret / url / email。
// MongoDB 连接串兼容旧键名 dbUrl（来自早期 settings.bak.js），也可通过环境变量 MONGO_URL / MONGODB_URI 注入。
module.exports = {
    // HTTP 监听端口
    port: 3000,

    // Session 签名密钥，请替换为足够随机的长字符串。
    // 生产环境建议通过环境变量注入：process.env.SESSION_SECRET
    cookieSecret: 'replace-with-a-long-random-secret',

    // MongoDB 连接串（mongoose 使用）
    url: 'mongodb://127.0.0.1:27017/ctit',

    // 邮件服务（评论通知 + 风控告警共用同一套 SMTP，nodemailer）
    email: {
        host: 'smtp.example.com',
        port: 465,           // 非加密 25，SSL 465，STARTTLS 587
        secure: true,        // 端口 465 时 true
        user: 'sender@example.com',
        pass: 'smtp-password'
    },

    // ===== 风控告警通知（收件人单独配置，与上面的发件账号解耦）=====
    // 触发时机：敏感词命中拒发（实时、带节流）、自动化脚本每轮结果（汇总）。
    // 推荐用环境变量注入收件地址，配置文件里不落任何收件人：
    //   ALERT_RECIPIENTS=you@example.com,ops@example.com npm start
    // 未配置收件人时告警只写服务端日志，绝不发信；ALERT_ENABLED=0 可强制关闭。
    alert: {
        enabled: true,
        // 收件人数组；也可写 'a@example.com,b@example.com'。环境变量 ALERT_RECIPIENTS 优先。
        // 例：recipients: ['you@example.com']
        recipients: [],
        // 同一事件（相同 key）在该时间窗内只发一次，防命中刷屏；0 = 不去重
        throttleMinutes: 30,
        // 实时命中告警开关；关掉后只保留自动化脚本的每轮汇总邮件（ALERT_REALTIME=0 同效）
        realtime: true,
        subjectPrefix: '[NODELOG 风控]',
        fromName: 'NODELOG 风控'
    },

    // ===== LINK ONE 开放平台（扫码登录 + 公众号 JS-SDK 签名，不含支付）=====
    // 申请入口：LINK ONE 商家管理后台 →「开放平台」→ 立即申请，得到 AppID / AppSecret。
    // 强烈建议用环境变量注入密钥，不要把 AppSecret 写进任何会被提交的文件：
    //   OPEN_APP_ID=xxx OPEN_APP_SECRET=xxx OPEN_ADMIN_PHONES=13800138000 npm start
    openPlatform: {
        // 开放平台 API 域名（一般不用改）
        apiBase: process.env.OPEN_API_BASE || 'https://ai.jiangzi.xin',

        // 开放平台应用 AppID / AppSecret。AppSecret 仅用于服务端 HS256 验签，绝不下发前端。
        appId: process.env.OPEN_APP_ID || '',
        appSecret: process.env.OPEN_APP_SECRET || '',

        // 扫码登录后授予管理员(role=0)的手机号白名单，逗号分隔。
        // 留空 = 所有扫码用户都是普通用户(role=1)，此时后台管理需继续使用原有账号密码登录。
        adminPhones: (process.env.OPEN_ADMIN_PHONES || '').split(',')
            .map(function (s) { return s.trim(); }).filter(Boolean),

        // 微信分享卡片封面：必须 HTTPS 绝对地址、>=300x300、静态直连可 GET。
        // 已随项目提供 public/images/share-cover.png (480x480)。
        shareCover: process.env.OPEN_SHARE_COVER || 'https://blog.jiangzi.xin/images/share-cover.png',

        // 生成 og:url 时使用的站点域名（反向代理场景取 X-Forwarded-Host 优先）
        siteHost: process.env.SITE_HOST || 'blog.jiangzi.xin'
    },

    // ===== 开放文章发布 API（供外部系统 / AI 工具自动发文）=====
    // 启用方式二选一：① 用环境变量（推荐，密钥不落文件）：
    //   ARTICLE_API_TOKENS=abcd...32hex,efgh...32hex ARTICLE_API_AUTHOR=admin npm start
    // ② 或在下面直接配置（settings.js 已被 gitignore，不会入库）。
    // token 建议用 `node scripts/gen-api-token.js` 生成（32 位十六进制）。
    // author 为「发布作者」的用户名（必须是站内已存在的启用账号，role 不限）。
    // 调用方也可在请求体里用 author 字段临时覆盖某一篇的作者。
    articleApi: {
        // 每个 token 可单独绑定 author / 备注 label / 作用域 scopes（当前未强制校验 scopes）
        tokens: [
            // { token: 'replace-with-a-32-hex-token', author: 'admin', label: 'ai-tool', scopes: [] }
        ],
        // 未给 token 单独指定 author 时使用的默认作者
        defaultAuthor: ''
    },

    // ===== 站点更新公告自动发布 API（git commit / CI 调用，见 scripts/announce-release.js）=====
    // 默认无需新增任何配置：接口和调用方脚本都会自动复用上面 articleApi.tokens[0].token，
    // 与文章发布 API 保持同一套 settings.js 配置习惯。
    // 如需与发文权限隔离，可单独配置本节（优先级高于 articleApi.tokens），
    // 或用环境变量 ANNOUNCEMENT_API_TOKENS=abcd...32hex npm start。
    // CI 上没有 settings.js（已 gitignore），改由 Secret ANNOUNCE_API_TOKEN 注入。
    // 站点地址可用 ANNOUNCE_API_BASE 覆盖，默认 https://blog.jiangzi.xin。
    announcementApi: {
        tokens: [
            // { token: 'replace-with-a-32-hex-token', label: 'git-hook' }
        ]
    }
};
