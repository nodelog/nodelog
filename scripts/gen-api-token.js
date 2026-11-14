/**
 * 生成一个开放文章发布 API 用的 Token（32 位十六进制）。
 * 用法：node scripts/gen-api-token.js
 * 输出示例：
 *   TOKEN=9f2c...   (32 hex)
 *   将其加入 settings.articleApi.tokens[].token 或环境变量 ARTICLE_API_TOKENS（逗号分隔），
 *   并确保 author 指向站内已存在的启用账号（如 admin）。
 */
'use strict';

var crypto = require('crypto');

var token = crypto.randomBytes(16).toString('hex'); // 16 bytes => 32 hex chars
console.log(token);
console.log('');
console.log('配置示例（环境变量，推荐）：');
console.log('  ARTICLE_API_TOKENS=' + token + ' ARTICLE_API_AUTHOR=admin npm start');
console.log('');
console.log('或写入 settings.js 的 articleApi.tokens：');
console.log('  { token: \'' + token + '\', author: \'admin\', label: \'my-ai-tool\', scopes: [] }');
