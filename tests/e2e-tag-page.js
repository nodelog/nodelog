/*
 * 端到端验证：前台 /tag/git 是否真正渲染出内容。
 * 用 mongodb-memory-server 起一个真实内存 MongoDB，引导【真实 app.js】，
 * 注入与生产同口径的数据（一个 git 标签 + 2 篇公开且标签精确为 git 的文章），
 * 再真实发起 GET /tag/git，断言返回的 HTML 里出现了这两篇文章的标题与“共 2 篇”。
 *
 * 用法： npm install --no-save mongodb-memory-server@9 && node tests/e2e-tag-page.js
 *       （首次运行会自动下载约 500MB 的 mongod 二进制，之后走本地缓存）
 * 退出码 0 = 页面有内容（通过）；非 0 = 失败。
 */
'use strict';
const http = require('http');
const { MongoMemoryServer } = require('mongodb-memory-server');

const PORT = process.env.E2E_PORT || 3999;

(async function main() {
  // 1) 先启动内存 Mongo，拿到 URI
  console.log('[1/6] 启动内存 MongoDB ...');
  const mem = new MongoMemoryServer();
  await mem.start();
  const uri = mem.getUri();
  // 必须在 require('./app') 之前注入。注意 models/mongodb.js 连接优先级是
  // settings.url || settings.dbUrl || process.env.MONGO_URL，而 settings.js
  // 里硬编码了 url，所以必须直接覆盖 settings.url（require 缓存同一对象）才会生效。
  require('../settings').url = uri;
  process.env.MONGO_URL = uri;
  process.env.PORT = String(PORT);
  process.env.NODE_ENV = 'test';

  // 2) 引导真实应用（会连上内存 Mongo）
  console.log('[2/6] 加载真实 app.js（连接内存库）...');
  const app = require('../app');
  const mongodb = require('../models/mongodb');
  const mongoose = mongodb.mongoose;

  // 3) 等待 Mongoose 真正连上
  if (mongoose.connection.readyState !== 1) {
    await new Promise(function (resolve, reject) {
      mongoose.connection.once('open', resolve);
      mongoose.connection.once('error', reject);
      setTimeout(function () { reject(new Error('mongoose 连接超时')); }, 30000);
    });
  }
  console.log('      Mongoose 已连接，状态 =', mongoose.connection.readyState);

  // 4) 注入数据
  console.log('[3/6] 注入测试数据 ...');
  const Tag = require('../models/Tag');
  const Content = require('../models/Content');

  // 4a) git 标签（slug=git, status=0）
  await new Promise(function (resolve, reject) {
    Tag.save({
      name: 'git', slug: 'git', count: 99 /*故意写一个错误缓存值，验证页面不依赖它*/,
      status: 0, createTime: new Date(), modifyTime: new Date()
    }, function (err) { err ? reject(err) : resolve(); });
  });

  // 4b) 第 1 篇：公开 + 标签精确 'git'（应出现在页面）
  await new Promise(function (resolve, reject) {
    Content.save({
      name: 'Git 入门教程', content: '这是一篇关于 git 的文章',
      tags: ['git'], status: 0, draft: false, createTime: new Date()
    }, function (err) { err ? reject(err) : resolve(); });
  });

  // 4c) 第 2 篇：公开 + 标签精确 'git'（应出现在页面）
  await new Promise(function (resolve, reject) {
    Content.save({
      name: 'Git 工作流最佳实践', content: '分支模型与 rebase',
      tags: ['git'], status: 0, draft: false, createTime: new Date()
    }, function (err) { err ? reject(err) : resolve(); });
  });

  // 4d) 反例 A：非 git 标签（不应出现在 git 标签页）
  await new Promise(function (resolve, reject) {
    Content.save({
      name: 'Docker 速查', content: '容器',
      tags: ['docker'], status: 0, draft: false, createTime: new Date()
    }, function (err) { err ? reject(err) : resolve(); });
  });

  // 4e) 反例 B：git 标签但草稿（不应出现在公开标签页）
  await new Promise(function (resolve, reject) {
    Content.save({
      name: 'Git 草稿（不应显示）', content: '草稿内容',
      tags: ['git'], status: 0, draft: true, createTime: new Date()
    }, function (err) { err ? reject(err) : resolve(); });
  });

  // 4f) 反例 C：git 标签但已禁用 status=1（不应出现在公开标签页）
  await new Promise(function (resolve, reject) {
    Content.save({
      name: 'Git 已禁用（不应显示）', content: '禁用内容',
      tags: ['git'], status: 1, draft: false, createTime: new Date()
    }, function (err) { err ? reject(err) : resolve(); });
  });

  // 5) 启动 HTTP 服务并发起真实请求
  console.log('[4/6] 监听 ' + PORT + ' 并发起 GET /tag/git ...');
  await new Promise(function (resolve) { app.listen(PORT, resolve); });

  const body = await new Promise(function (resolve, reject) {
    http.get('http://127.0.0.1:' + PORT + '/tag/git', function (res) {
      let data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
    }).on('error', reject);
  });

  // 6) 断言
  console.log('[5/6] 校验返回内容 ...');
  const checks = [];
  function check(label, cond) { checks.push({ label: label, ok: !!cond }); }

  check('HTTP 200', body.status === 200);
  check('出现第1篇标题「Git 入门教程」', body.body.indexOf('Git 入门教程') !== -1);
  check('出现第2篇标题「Git 工作流最佳实践」', body.body.indexOf('Git 工作流最佳实践') !== -1);
  check('出现计数「共 2 篇」或 total=2', /共\s*2\s*篇/.test(body.body) || body.body.indexOf('total:2') !== -1 || body.body.indexOf('total = 2') !== -1);
  check('不出现非git文章「Docker 速查」', body.body.indexOf('Docker 速查') === -1);
  check('不出现 git 草稿「Git 草稿（不应显示）」', body.body.indexOf('Git 草稿（不应显示）') === -1);
  check('不出现 git 已禁用「Git 已禁用（不应显示）」', body.body.indexOf('Git 已禁用（不应显示）') === -1);
  check('未回退到空状态「这个标签下还没有文章」', body.body.indexOf('这个标签下还没有文章') === -1);

  console.log('[6/6] 结果：');
  let allOk = true;
  checks.forEach(function (c) {
    console.log('  ' + (c.ok ? '✅' : '❌') + ' ' + c.label);
    if (!c.ok) allOk = false;
  });

  // 清理
  try { await mem.stop(); } catch (e) {}
  try { mongoose.connection.close(); } catch (e) {}
  console.log(allOk ? '\n===== PASS：/tag/git 页面正确渲染出 2 篇 git 文章 =====' : '\n===== FAIL：页面未按要求渲染 =====');
  process.exit(allOk ? 0 : 1);
})().catch(function (err) {
  console.error('测试异常：', err && err.stack ? err.stack : err);
  process.exit(2);
});
