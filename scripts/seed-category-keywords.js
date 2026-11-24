/*
 * 生产库分类 keywords 回填脚本（方案 B 懒人模式）。
 *
 * 背景：matchCategory 现在支持「触发词(别名)」语义匹配——分类配置了 keywords 后，
 *       写文章时会按触发词自动预选分类。但老分类没有 keywords。本脚本按【分类名称】
 *       查内置别名词典，为尚无 keywords 的分类回填触发词，省去人工逐个填写。
 *
 * 用法（在生产服务器上，代码已是最新）：
 *   node scripts/seed-category-keywords.js          # 仅诊断：列出将回填的分类与触发词
 *   node scripts/seed-category-keywords.js --apply  # 实际写入（每个分类仅当 keywords 为空时才填）
 *
 * 注意：
 *   - 仅回填 keywords 为空的分类；已有配置的不会被覆盖。
 *   - 内置词典只覆盖常见技术分类名；不在词典里的分类保持为空，请在后台手动补充。
 *   - --apply 会写库，请先无参跑一次确认无误再执行。
 */
'use strict';
var mongodb = require('../models/mongodb');
var mongoose = mongodb.mongoose;
require('../models/Category');
var CategoryModel = mongoose.model('Category');

var args = process.argv.slice(2);
var apply = args.indexOf('--apply') !== -1;

// 与 public/js/common.js 的 CATEGORY_ALIAS 保持一致（仅 key 命中才回填）
var ALIAS = {
  'ui': ['界面', '前端', '交互', '用户体验', 'ux', 'ui设计', '原型', '视觉'],
  '前端': ['frontend', 'js', 'javascript', 'css', 'html', '网页', 'web前端', '浏览器', 'vue', 'react'],
  '后端': ['backend', '服务端', 'server', 'api', '接口', '微服务'],
  '运维': ['devops', '部署', '服务器', 'linux', 'docker', 'k8s', 'kubernetes', '监控', 'ci', 'cdn', 'nginx'],
  '数据库': ['db', 'mysql', 'mongodb', 'redis', 'sql', 'nosql', 'postgres'],
  '算法': ['algorithm', '数据结构', 'leetcode', '刷题'],
  '人工智能': ['ai', '机器学习', '深度学习', 'ml', 'llm', '大模型', '神经网络', 'gpt'],
  '安全': ['security', '漏洞', 'xss', 'csrf', '注入', '加密', '渗透'],
  '移动端': ['android', 'ios', 'app', '小程序', '移动开发', 'flutter'],
  '工具': ['tool', '效率', '插件', '脚本', 'cli', '命令行', 'ide'],
  '架构': ['architecture', '系统设计', '高可用', '分布式', '微服务'],
  '网络': ['network', 'http', 'tcp', 'dns', '协议']
};

function done(code) {
  try { mongoose.connection.close(); } catch (e) {}
  process.exit(code || 0);
}

CategoryModel.find({ status: 0 }, function (err, docs) {
  if (err) { console.log('查询失败:', err.message); return done(1); }
  var plan = [];
  (docs || []).forEach(function (d) {
    var name = (d.name || '').trim().toLowerCase();
    var kw = (d.keywords || '').trim();
    if (kw) return;                       // 已有配置，跳过
    var list = ALIAS[name];
    if (!list || !list.length) return;    // 不在词典，跳过
    plan.push({ id: String(d._id), name: d.name, keywords: list.join(',') });
  });

  console.log('分类总数:', (docs || []).length, '｜将回填:', plan.length, apply ? '（执行写入）' : '（诊断模式，未写入）');
  if (!plan.length) { console.log('无需回填。'); return done(0); }

  console.log('\n编号 | 分类 | 将写入触发词');
  plan.forEach(function (p, i) {
    console.log((i + 1) + '. ' + p.name + '  ->  ' + p.keywords);
  });

  if (!apply) {
    console.log('\n以上为诊断结果。确认无误后执行：node scripts/seed-category-keywords.js --apply');
    return done(0);
  }

  var pending = plan.length;
  var failed = 0;
  plan.forEach(function (p) {
    CategoryModel.update({ _id: p.id }, { $set: { keywords: p.keywords, modifyTime: new Date() } }, function (e) {
      if (e) { failed++; console.log('回填失败 ' + p.name + ': ' + e.message); }
      pending--;
      if (pending === 0) {
        console.log('\n回填完成：成功 ' + (plan.length - failed) + ' 条，失败 ' + failed + ' 条。');
        done(failed ? 1 : 0);
      }
    });
  });
});
