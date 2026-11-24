/*
 * 生产库修复脚本：让前台 /tag/git 真正显示内容。
 *
 * 背景：后台「标签管理」里 git 显示 文章数=2，但前台 /tag/git 显示「共 0 篇」。
 *       根因是【数据漂移】——Tag.count 是 2（旧缓存），而实时查询 Content
 *       当前匹配不到 2 篇「公开 + 标签精确为 git」的文章。前台已经改为实时查询、
 *       不依赖 Tag.count，所以页面如实显示 0 篇。要让页面出内容，必须让那 2 篇
 *       git 文章在生产库里确实是「公开(status=0) 且 标签精确为 git」。
 *
 * 用法（在生产服务器上，代码已是最新）：
 *   node scripts/repair-git-tag.js            # 仅诊断：列出所有 git 相关文章与真实可见数
 *   node scripts/repair-git-tag.js --fix-tags # 额外：把 "Git"/"GIT"/"git " 等归一为精确 "git"
 *   node scripts/repair-git-tag.js --publish  # 额外：把带 git 标签但非公开的文章恢复为公开
 *   node scripts/repair-git-tag.js --fix-tags --publish   # 全部执行
 *
 * 注意：--publish 会修改文章公开状态，请先无参跑一次确认再决定。
 */
'use strict';
var mongodb = require('../models/mongodb');
var mongoose = mongodb.mongoose;
require('../models/Content');
require('../models/Tag');
var Content = require('../models/Content');
var Tag = require('../models/Tag');
var ContentModel = mongoose.model('Content');
var TagModel = mongoose.model('Tag');

var args = process.argv.slice(2);
var doFixTags = args.indexOf('--fix-tags') !== -1;
var doPublish = args.indexOf('--publish') !== -1;

function esc(s) { return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function done(code) {
  try { mongoose.connection.close(); } catch (e) {}
  process.exit(code || 0);
}

setTimeout(function () {
  console.log('===== 1) 前台实时查询看到的 git 文章数（getCountByTag）=====');
  Content.getCountByTag('git', null, function (e1, pub) {
    if (e1) { console.log('err:', e1.message); return done(1); }
    console.log('getCountByTag("git", 公开) =>', pub);

    console.log('\n===== 2) 含 git(不区分大小写) 的全部文章（含非公开）=====');
    ContentModel.find({ tags: { $regex: esc('git'), $options: 'i' } })
      .select('name status draft tags')
      .exec(function (e2, all) {
        if (e2) { console.log('scan err:', e2.message); return done(1); }
        console.log('匹配到', all ? all.length : 0, '篇：');
        (all || []).forEach(function (d) {
          var exact = (d.tags || []).some(function (t) { return /^\s*git\s*$/i.test(t); });
          var vis = (d.status === 0 && d.draft !== true);
          console.log('  -', JSON.stringify({
            name: d.name, status: d.status, draft: d.draft,
            tags: d.tags, 精确匹配正则: exact, 当前对公开可见: vis
          }));
        });

        if (!all || !all.length) {
          console.log('\n结论：没有任何文章的 tags 含 git。count=2 是历史脏数据。');
          console.log('建议：node scripts/admin-maintenance.js tag-reconcile  把后台计数校正为 0。');
          return done(0);
        }

        var exactDocs = (all || []).filter(function (d) {
          return (d.tags || []).some(function (t) { return /^\s*git\s*$/i.test(t); });
        });
        var nonPublic = exactDocs.filter(function (d) { return !(d.status === 0 && d.draft !== true); });

        console.log('\n===== 3) 诊断结论 =====');
        console.log('精确标签为 git 的文章：', exactDocs.length, '篇');
        console.log('其中当前非公开（status≠0 或 draft=true）：', nonPublic.length, '篇');

        if (!doFixTags && !doPublish) {
          console.log('\n[仅诊断模式] 未做任何修改。');
          console.log('  • 若想把 "Git"/"git " 等归一为精确 "git"：加 --fix-tags');
          console.log('  • 若想把带 git 标签但非公开的文章恢复公开：加 --publish');
          return done(0);
        }

        var pending = [];
        if (doFixTags) {
          (all || []).forEach(function (d) {
            var newTags = (d.tags || []).map(function (t) {
              return /git/i.test(t) ? 'git' : t;
            });
            if (JSON.stringify(newTags) !== JSON.stringify(d.tags)) {
              pending.push(function (cb) {
                ContentModel.updateOne({ _id: d._id }, { $set: { tags: newTags } }).exec(cb);
              });
            }
          });
        }
        if (doPublish) {
          nonPublic.forEach(function (d) {
            pending.push(function (cb) {
              ContentModel.updateOne({ _id: d._id }, { $set: { status: 0, draft: false } }).exec(cb);
            });
          });
        }

        if (!pending.length) {
          console.log('\n没有需要修改的文章，跳过写入。');
          return finishReconcile();
        }

        console.log('\n===== 4) 执行修复（' + pending.length + ' 个写操作）=====');
        var async = require('async');
        async.series(pending, function (err) {
          if (err) { console.log('修复写入失败：', err.message); return done(1); }
          console.log('修复写入完成。');
          finishReconcile();
        });

        function finishReconcile() {
          console.log('\n===== 5) 重算标签计数（同步后台显示）=====');
          Tag.reconcileAllCounts(function (e3) {
            if (e3) console.log('reconcile 警告：', e3.message);
            console.log('修复后再次实时查询 getCountByTag("git", 公开) =>');
            Content.getCountByTag('git', null, function (e4, after) {
              console.log('  =>', after);
              console.log(after > 0
                ? '\n✅ 现在 /tag/git 应显示 ' + after + ' 篇文章。请刷新前台（无需清缓存，页面已设 no-store）。'
                : '\n⚠️ 修复后仍为 0，请检查上述文章是否真的应公开，或联系排查。');
              done(0);
            });
          });
        }
      });
  });
}, 800);
