/**
 * 离线验证 services/autoClassify.js（不连 MongoDB）：
 *   - matchCategory：语义分类匹配（名称/keywords/别名词典）
 *   - extractTags：轻量分词取 Top5 + 停用词过滤
 * 运行：node scripts/test-auto-classify.js
 */
'use strict';
var ac = require('./../services/autoClassify');

var cats = [
    { _id: 'c1', name: '前端', keywords: '' },
    { _id: 'c2', name: '运维', keywords: 'docker,k8s,nginx,部署' },
    { _id: 'c3', name: '人工智能', keywords: 'llm,大模型,gpt' },
    { _id: 'c4', name: '数据库', keywords: '' }
];

var pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name); }
}

console.log('matchCategory:');
var m1 = ac.matchCategory(cats, '如何部署 Docker 容器', '用 nginx 做反向代理，k8s 编排');
check('运维被命中(docker/nginx/k8s)', m1 && m1._id === 'c2');

var m2 = ac.matchCategory(cats, 'React 前端组件开发', 'vue 与 react 对比');
check('前端被命中(react/vue)', m2 && m2._id === 'c1');

var m3 = ac.matchCategory(cats, '用 GPT 做大模型应用', 'llm 推理');
check('人工智能被命中(gpt/llm)', m3 && m3._id === 'c3');

var m4 = ac.matchCategory(cats, '今天天气真好', '随便写点东西');
check('无匹配返回 null', m4 === null);

var m5 = ac.matchCategory([], 'React 前端', '');
check('空分类列表返回 null', m5 === null);

console.log('extractTags:');
var t1 = ac.extractTags('使用 Redis 做缓存', 'redis 是高性能的 key-value 数据库，我们用 redis 缓存热点数据，提升性能', 'markdown', 5);
check('返回数组', Array.isArray(t1));
check('包含 redis（标题+正文拉丁词）', t1.indexOf('redis') !== -1);
check('停用词「我们」被过滤', t1.indexOf('我们') === -1);
check('停用词「的」被过滤', t1.indexOf('的') === -1);
check('不超过 maxTags(5)', t1.length <= 5);

var t2 = ac.extractTags('前端性能优化实践', '本文讲前端性能优化，包括 webpack 打包与浏览器渲染', 'markdown', 5);
check('中文标题整词「前端」被提取', t2.indexOf('前端') !== -1);
check('返回 TopN 且非空', t2.length > 0 && t2.length <= 5);

var t3 = ac.extractTags('', '<p>这是一段 <b>html</b> 正文，包含 script 与样式</p>', 'html', 5);
check('html 正文被去标签且能提取中文词', t3.indexOf('正文') !== -1);
check('标签语法未泄漏（无 < 或 >）', t3.every(function (x) { return x.indexOf('<') === -1 && x.indexOf('>') === -1; }));
check('单字符标签名 b 不出现', t3.indexOf('b') === -1);

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
