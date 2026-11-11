/* 生产服务器诊断：看清 webhook 标签在库里的真实存储（空格/大小写/特殊字符）
 * 用法：在服务器上 `node _diag_prod.js`（会使用 settings.js 里的真实 MongoDB 连接）
 */
var mongodb = require('./models/mongodb');
var mongoose = mongodb.mongoose;
require('./models/Tag');
require('./models/Content');
var TagModel = mongoose.model('Tag');
var ContentModel = mongoose.model('Content');

function esc(s) { return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function done() { try { mongodb.mongoose.connection.close(); } catch (e) {} process.exit(0); }

setTimeout(function () {
  console.log('===== 1) Tag 集合中 webhook（slug/name 不区分大小写）=====');
  TagModel.find({ $or: [
    { slug: { $regex: esc('webhook'), $options: 'i' } },
    { name: { $regex: esc('webhook'), $options: 'i' } }
  ] }).exec(function (e1, tags) {
    if (e1) console.log('err:', e1.message);
    console.log(tags.length ? tags.map(function (t) { return JSON.stringify({name: t.name, slug: t.slug, count: t.count}); }) : '（无匹配 Tag 文档）');

    console.log('\n===== 2) Content 中 tags 含 webhook 的文章（真实字节）=====');
    ContentModel.find({ tags: { $regex: esc('webhook'), $options: 'i' } })
      .select('name status draft author tags')
      .exec(function (e2, docs) {
        if (e2) { console.log('err:', e2.message); return done(); }
        console.log('共 ' + docs.length + ' 篇');
        docs.forEach(function (d) {
          console.log('---');
          console.log('  name  :', d.name);
          console.log('  status:', d.status, ' draft:', JSON.stringify(d.draft));
          // JSON.stringify 会把看不见的空格/换行/全角空格暴露出来
          console.log('  tags  :', JSON.stringify(d.tags));
          // 逐个标签判断：旧精确匹配 vs 新正则匹配
          (d.tags || []).forEach(function (t) {
            var exact = (t === 'webhook');
            var re = /^\s*webhook\s*$/i.test(t);
            console.log('     · ' + JSON.stringify(t) + '  旧精确= ' + exact + '  新正则= ' + re);
          });
        });
        done();
      });
  });
}, 800);
