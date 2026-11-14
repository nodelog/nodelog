/* 生产服务器诊断 v3：针对 git 标签「前台 0 篇 / 后台计数 2」的专项排查
 * 用法（在生产服务器上，确保已部署含 4c47d5f + e8cd5db 修复的代码）：
 *   node _diag_prod_git.js
 * 脚本会直接用【当前运行进程所加载】的代码去查，从而一锤定音：
 *   - 若新代码返回 2 但线上页面仍 0 篇 → 是运行进程没加载新代码（需重启/重载该进程）。
 *   - 若新代码本身就返回 0 → 是数据本身问题（文章非公开/标签写法漂移），看第 4 步原始标签。
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
  console.log('\n===== 1) Tag 集合中 git（slug/name 不区分大小写）=====');
  TagModel.find({ $or: [
    { slug: { $regex: esc('git'), $options: 'i' } },
    { name: { $regex: esc('git'), $options: 'i' } }
  ] }).exec(function (e1, tags) {
    if (e1) console.log('err:', e1.message);
    console.log(tags.length ? tags.map(function (t) {
      return JSON.stringify({ name: t.name, slug: t.slug, count: t.count, status: t.status });
    }) : '（无匹配 Tag 文档）');

    console.log('\n===== 2) 真实调用 Content.getCountByTag（当前运行代码）=====');
    Content.getCountByTag('git', null, function (e2, totalPub) {
      console.log('getCountByTag("git", 公开) =>', totalPub);
      Content.getCountByTag('git', { _id: '000000000000000000000000' }, function (e3, totalLogin) {
        console.log('getCountByTag("git", 已登录) =>', totalLogin);

        console.log('\n===== 3) 真实调用 Content.findByTag（取回文档 + 可见性）=====');
        Content.findByTag(1, 'git', null, function (e4, docs) {
          if (e4) console.log('findByTag err:', e4.message);
          console.log('findByTag("git", 公开) 命中 =>', docs ? docs.length : 'ERR', '篇');
          if (docs && docs.length) docs.forEach(function (d) {
            console.log('  -', JSON.stringify({ name: d.name, status: d.status, draft: d.draft, tags: d.tags }));
          });

          console.log('\n===== 4) 原始扫描：tags 含 git(不区分大小写) 的全部文章（含非公开）=====');
          ContentModel.find({ tags: { $regex: esc('git'), $options: 'i' } })
            .select('name status draft tags')
            .exec(function (e5, all) {
              if (e5) console.log('scan err:', e5.message);
              console.log('tags 含 git 的文章共', all ? all.length : 'ERR', '篇：');
              if (all && all.length) all.forEach(function (d) {
                console.log('  -', JSON.stringify({
                  name: d.name, status: d.status, draft: d.draft,
                  tags: d.tags // 真实存储的标签数组，重点看是否有首尾空格/大小写差异
                }));
              });

              console.log('\n===== 5) 对照：旧精确匹配 {"tags":"git"} 能否命中 =====');
              ContentModel.find({ tags: 'git' }).count().exec(function (e6, oldExact) {
                if (e6) console.log('oldExact err:', e6.message);
                console.log('旧精确匹配 {"tags":"git"} 命中 =>', oldExact);

                console.log('\n===== 结论=====');
                if (totalPub === 2) {
                  console.log('当前运行代码对 git 返回 2 篇 ⇒ 代码已修复。');
                  console.log('若线上页面仍显示 0 篇 ⇒ 运行进程未加载新代码，请重启/重载 Node 进程（pm2 restart / 重新 node app.js）。');
                } else if (totalPub === 0 && all && all.length === 0) {
                  console.log('没有任何文章的 tags 含 git ⇒ 标签计数 2 是历史脏数据，运行 `node scripts/admin-maintenance.js tag-reconcile` 即可把后台计数校正为 0。');
                } else if (totalPub === 0 && all && all.length > 0) {
                  console.log('文章存在但均非公开可见(status≠0 或 draft=true) ⇒ 前台显示 0 篇是正确行为；如需展示请改为公开，再跑 tag-reconcile 同步后台计数。');
                  console.log('若文章的 tags 里 git 带了首尾空格/大小写差异，新代码(^\s*git\s*$ 不区分大小写)已能命中；oldExact 为 0 即证明是写法漂移导致旧逻辑漏匹配。');
                } else {
                  console.log('返回值为', totalPub, '，与后台计数 2 不一致，请把这段输出发我进一步分析。');
                }
                done();
              });
            });
        });
      });
    });
  });
}, 800);
