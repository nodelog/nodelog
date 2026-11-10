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

    // 邮件服务（评论通知使用，nodemailer）
    email: {
        host: 'smtp.example.com',
        port: 465,           // 非加密 25，SSL 465，STARTTLS 587
        secure: true,        // 端口 465 时 true
        user: 'sender@example.com',
        pass: 'smtp-password'
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
    }
};
