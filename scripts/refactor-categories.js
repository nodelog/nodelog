/*
 * 分类重构 CLI（方案 B 配套）。
 *
 * 复用 services/categoryRefactor（单一事实来源）。
 *   node scripts/refactor-categories.js            # 仅诊断（预览执行计划）
 *   node scripts/refactor-categories.js --apply    # 执行（新建标准分类 + 改挂文章 + 软删旧分类）
 *
 * 后台也可在「分类重构」页面点按钮执行，无需 SSH。
 */
'use strict';
var svc = require('../services/categoryRefactor');
var mongoose = require('../models/mongodb').mongoose;

var apply = process.argv.slice(2).indexOf('--apply') !== -1;

svc.run(apply, function (err, plan) {
  function close(code) { try { mongoose.connection.close(); } catch (e) {} process.exit(code || 0); }
  if (err) { console.log('执行失败:', err.message); return close(1); }
  console.log('\n===== ' + (apply ? '执行结果' : '预览（DRY-RUN，未写入）') + ' =====');
  console.log('将新建标准分类:', plan.create.length, plan.create);
  console.log('将更新(规范化)分类:', plan.update.length, plan.update);
  console.log('将改挂文章的旧分类:', plan.reassign.length);
  plan.reassign.forEach(function (p) { console.log('  ' + p.from + '  ->  ' + p.to + '  (' + (p.articles || 0) + ' 篇)'); });
  console.log('合计迁移文章:', plan.articleTotal, '篇；将软删旧分类:', plan.deleteCount, '个');
  if (plan.result) console.log('实际：迁移', plan.result.moved, '篇；软删', plan.result.deleted, '个；失败', plan.result.failed, '个。');
  if (!apply) console.log('\n确认无误后执行：node scripts/refactor-categories.js --apply');
  close(0);
});
