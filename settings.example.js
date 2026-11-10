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
    }
};
