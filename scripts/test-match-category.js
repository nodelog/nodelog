/*
 * 离线验证 matchCategory v2（方案 B）逻辑。
 * 函数与 public/js/common.js 中提交版本逐字一致，仅把 allCategories 改为参数传入。
 * 运行：node scripts/test-match-category.js
 */
'use strict';

var CATEGORY_ALIAS = {
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

function matchCategory(allCategories, title, content) {
  if (!allCategories || !allCategories.length) return null;
  var titleLow = (title || '').toLowerCase();
  var textLow = ((title || '') + '\n' + (content || '')).toLowerCase();
  var best = null, bestScore = 0;
  allCategories.forEach(function (c) {
    var name = (c.name || '').trim().toLowerCase();
    if (!name || name.length < 2) return;
    var terms = [];
    var kwRaw = (c.keywords || '').trim();
    if (kwRaw) {
      kwRaw.split(/[,，\s]+/).forEach(function (s) { var t = s.trim().toLowerCase(); if (t) terms.push(t); });
    } else if (CATEGORY_ALIAS[name]) {
      CATEGORY_ALIAS[name].forEach(function (t) { terms.push(t.toLowerCase()); });
    }
    var isShortLatin = /^[a-z0-9]+$/.test(name) && name.length <= 3;
    var score = 0;
    var nameTitle = titleLow.indexOf(name) !== -1;
    var nameBody = textLow.indexOf(name) !== -1;
    if (!(isShortLatin && !nameTitle)) {
      if (nameTitle) score += 50;
      else if (nameBody) score += 1;
    }
    terms.forEach(function (t) {
      if (!t) return;
      var tTitle = titleLow.indexOf(t) !== -1;
      var tBody = textLow.indexOf(t) !== -1;
      if (t.length >= 2) {
        if (tTitle) score += 30;
        if (tBody) score += 8;
      } else {
        if (tTitle) score += 30;
      }
    });
    if (score > bestScore) { bestScore = score; best = c; }
  });
  return bestScore > 0 ? best : null;
}

// 模拟生产常见分类（含无 keywords 走别名、含显式 keywords 覆盖别名、纯名称三类）
var cats = [
  { _id: 'ui', name: 'UI' },
  { _id: 'qian', name: '前端' },
  { _id: 'hou', name: '后端' },
  { _id: 'yun', name: '运维' },
  { _id: 'shu', name: '数据库' },
  { _id: 'sheng', name: '生活' },                                  // 纯名称，无别名
  { _id: 'ai', name: 'AI', keywords: '机器学习,深度学习,gpt' },     // 显式 keywords 覆盖别名
  { _id: 'suan', name: '算法', keywords: '动态规划' }                // 显式 keywords 覆盖别名(leetcode/刷题)
];

var cases = [
  {
    name: '原误命中 UI 的服务器文章',
    title: '服务器 .git 涨到 5GB：一次从诊断到重构的完整复盘', content: '',
    expect: function (r) { return r && r.name === '运维' && r.name !== 'UI'; },   // 修复：不再误选 UI
    desc: '应选「运维」(标题含"服务器")，且绝不能选「UI」'
  },
  {
    name: '前端标题+vue正文',
    title: '前端性能优化实战', content: '用 vue 做了个组件',
    expect: function (r) { return r && r.name === '前端'; },
    desc: '应选「前端」'
  },
  {
    name: 'UI 设计语义',
    title: '聊聊 UI 设计与原型', content: '',
    expect: function (r) { return r && r.name === 'UI'; },
    desc: '应选「UI」(名称+别名 ui设计/原型)'
  },
  {
    name: '数据库语义',
    title: '数据库索引优化', content: 'mysql 慢查询',
    expect: function (r) { return r && r.name === '数据库'; },
    desc: '应选「数据库」'
  },
  {
    name: '无关生活内容',
    title: '今天做了顿饭', content: '番茄炒蛋',
    expect: function (r) { return r === null; },
    desc: '应返回 null（无匹配，不误选）'
  },
  {
    name: 'AI 显式 keywords 命中(gpt 未出现名称)',
    title: '写摘要', content: '用 gpt 生成了一段文字',
    expect: function (r) { return r && r.name === 'AI'; },
    desc: '应选「AI」(keywords 命中)'
  },
  {
    name: '显式 keywords 覆盖别名(leetcode 不再命中算法)',
    title: '用 leetcode 刷题', content: '',
    expect: function (r) { return r === null; },
    desc: '算法显式 keywords=动态规划，应忽略自带别名 leetcode/刷题，且无其他分类命中，返回 null'
  }
];

var pass = 0, fail = 0;
cases.forEach(function (c) {
  var r = matchCategory(cats, c.title, c.content);
  var ok = c.expect(r);
  var got = r ? ('「' + r.name + '」') : 'null';
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + c.name + ' => ' + got + '  (' + c.desc + ')');
  if (ok) pass++; else fail++;
});
console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
