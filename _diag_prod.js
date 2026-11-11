/* 生产服务器诊断 v2：直接调用真实查询函数，一锤定音
 * 用法：在服务器上 `node _diag_prod.js`（使用 settings.js 里的真实 MongoDB 连接）
 */
var mongodb = require('./models/mongodb');
var mongoose = mongodb.mongoose;
require('./models/Tag');
require('./models/Content');
var Tag = require('./models/Tag');
var Content = require('./models/Content');
var TagModel = mongoose.model('Tag');
var ContentModel = mongoose.model('Content');

function esc(s) { return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function done() { try { mongodb.mongoose.connection.close(); } catch (e) {} process.exit(0); }

console.log('===== 环境 =====');
console.log('cwd            :', process.cwd());
console.log('Content.js 路径 :', require.resolve('./models/Content.js'));
console.log('node 版本      :', process.version);

setTimeout(function () {
  console.log('\n===== 1) Tag 集合中 webhook（slug/name 不区分大小写）=====');
  TagModel.find({ $or: [
    { slug: { $regex: esc('webhook'), $options: 'i' } },
    { name: { $regex: esc('webhook'), $options: 'i' } }
  ] }).exec(function (e1, tags) {
    if (e1) console.log('err:', e1.message);
    console.log(tags.length ? tags.map(function (t) { return JSON.stringify({name: t.name, slug: t.slug, count: t.count}); }) : '（无匹配 Tag 文档）');

    console.log('\n===== 2) 真实调用 Content.getCountByTag（磁盘新代码）=====');
    Content.getCountByTag('webhook', null, function (e2, totalPub) {
      console.log('getCountByTag("webhook", 公开) =>', totalPub, '(期望 2)');
      Content.getCountByTag('webhook', {_id: '000000000000000000000000'}, function (e3, totalLogin) {
        console.log('getCountByTag("webhook", 已登录) =>', totalLogin, '(期望 2)');

        console.log('\n===== 3) 真实调用 Content.findByTag（取回文档）=====');
        Content.findByTag(1, 'webhook', null, function (e4, docs) {
          console.log('findByTag("webhook", 公开) 命中 =>', docs ? docs.length : 'ERR', '篇',
                      docs && docs.length ? '：' + docs.map(function(d){return d.name;}).join(' / ') : '');
          console.log('\n===== 4) 走完整链路 Tag.findBySlug -> getCountByTag =====');
          Tag.findBySlug('webhook', function (e5, tag) {
            if (e5 || !tag) { console.log('findBySlug 失败:', e5 && e5.message); return done(); }
            console.log('findBySlug 命中 name =', JSON.stringify(tag.name));
            Content.getCountByTag(tag.name, null, function (e6, t) {
              console.log('getCountByTag(tag.name=' + JSON.stringify(tag.name) + ') =>', t, '(期望 2)');
              var ok = (totalPub === 2 && docs && docs.length === 2 && t === 2);
              console.log(ok
                ? '\n=== 结论：磁盘上的新代码返回 2 篇，代码完全正确。线上仍 0 篇 = 运行的进程没加载这份代码（需重启/重载该进程）。==='
                : '\n=== 结论：新代码仍返回非 2，说明代码还有 bug，请把这段输出发我。===');
              done();
            });
          });
        });
      });
    });
  });
}, 800);
