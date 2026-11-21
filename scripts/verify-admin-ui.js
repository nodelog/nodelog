#!/usr/bin/env node
/* =============================================================================
 * NODELOG 后台 UI 框架 · 基础验证脚本（零依赖，不连 MongoDB）
 *
 * 覆盖：
 *   1) 编译所有后台 partial（views/manager + views/common）的 EJS 语法；
 *   2) 独立渲染 admin-list 组件（用分类页的真实列配置 + mock 行），断言输出
 *      与 common.js 委托契约一致（批次/状态/编辑/删除按钮、linkBase 详情链接、
 *      父分类列、统一 class），且不落入「缺少列」错误态；
 *   3) 完整渲染 category.ejs（桩 locals），证明其通过 admin-list 正确装配，
 *      无模板运行时错误；
 *   4) 契约回归保护：分类页确实 include 了 admin-list 并传入 list 配置；
 *   5) 遗留分页残留：除 known-legacy 外，不应再有老 pager.ejs 直接 include。
 *
 * 退出码：任一检查失败返回 1（可直接进 CI）。
 * ===========================================================================*/
'use strict';
var fs = require('fs');
var path = require('path');
var ejs = require('ejs');

var ROOT = path.resolve(__dirname, '..');
var VIEWS = path.join(ROOT, 'views');
var pass = 0, fail = 0;
function ok(name) { pass++; console.log('  ✓ ' + name); }
function bad(name, detail) { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }

/* ---- 1. 编译所有后台 partial ---- */
console.log('\n[1] 编译后台 partial（EJS 语法）');
var partialDirs = [path.join(VIEWS, 'manager'), path.join(VIEWS, 'common')];
var compiled = 0;
partialDirs.forEach(function (dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(function (f) {
    if (!/\.ejs$/.test(f)) return;
    var full = path.join(dir, f);
    try { ejs.compile(fs.readFileSync(full, 'utf8'), { filename: full }); compiled++; }
    catch (e) { bad('compile ' + path.relative(ROOT, full), e.message); }
  });
});
if (compiled) ok('编译 ' + compiled + ' 个 partial 通过');

/* ---- 2. 独立渲染 admin-list（分类列配置） ---- */
console.log('\n[2] 渲染 admin-list 组件（分类列配置 + mock 行）');
var listCfg = {
  selectable: true,
  res: 'category',
  linkBase: '/manager/category/detail',
  rowKey: '_id',
  rowData: { name: 'name', slug: 'slug', order: 'order', keywords: 'keywords', parent: 'parent', status: 'status' },
  actions: [{ type: 'edit', api: '/manager/category/modify', title: '分类' }, { type: 'delete' }],
  columns: [
    { key: 'seq', label: '编号', type: 'index' },
    { key: 'name', label: '名称', type: 'link' },
    { key: 'parentName', label: '父分类', type: 'text', default: '—' },
    { key: 'keywords', label: '触发词' },
    { key: 'slug', label: '标识' },
    { key: 'order', label: '排序' },
    { key: 'createTime', label: '创建时间', type: 'date' },
    { key: 'modifyTime', label: '修改时间', type: 'date' },
    { key: 'status', label: '状态', type: 'status' }
  ]
};
var mockDocs = [
  { _id: '507f1f77bcf86cd799439011', name: 'UI', slug: 'ui', order: 1, keywords: '界面', parent: '507f1f77bcf86cd7994390aa', parentName: '产品与设计', status: 0, createTime: new Date(), modifyTime: new Date() },
  { _id: '507f1f77bcf86cd7994390aa', name: '产品与设计', slug: 'design', order: 2, keywords: '', parent: null, parentName: '—', status: 0, createTime: new Date(), modifyTime: new Date() }
];
var adminListPath = path.join(VIEWS, 'common', 'admin-list.ejs');
try {
    var html = ejs.render(fs.readFileSync(adminListPath, 'utf8'), {
      list: listCfg, docs: mockDocs, locals: {}, format: require(path.join(ROOT, 'controllers', 'cmsUtils')).format
    }, { filename: adminListPath });
  var checks = [
    ['统一 class nl-admin-list', /nl-admin-list/],
    ['批次复选 js-batch-check', /js-batch-check/],
    ['状态开关 js-admin-status', /js-admin-status/],
    ['编辑按钮 js-admin-edit', /js-admin-edit/],
    ['删除按钮 js-admin-delete', /js-admin-delete/],
    ['linkBase 详情链接', /\/manager\/category\/detail\?id=507f1f77bcf86cd799439011/],
    ['父分类列显示子级', /产品与设计/],
    ['编辑 API 正确（非 admin/modify）', /data-edit-api="\/manager\/category\/modify"/],
    ['data-parent 回传（子级）', /data-parent="507f1f77bcf86cd7994390aa"/],
    ['顶级行无 data-parent', /<tr data-id="507f1f77bcf86cd7994390aa"[^>]*>(?!.*data-parent)/]
  ];
  checks.forEach(function (c) { if (c[1].test(html)) ok(c[0]); else bad(c[0]); });
  if (/list\.columns/.test(html)) bad('未落入「缺少列」错误态'); else ok('未落入「缺少列」错误态');
} catch (e) { bad('渲染 admin-list', e.message); }

/* ---- 3. 完整渲染 category.ejs（桩 locals） ---- */
console.log('\n[3] 完整渲染 category.ejs（桩 locals，证明通过 admin-list 装配）');
var navConfig, cmsFormat;
try { navConfig = require(path.join(ROOT, 'navConfig')); cmsFormat = require(path.join(ROOT, 'controllers', 'cmsUtils')).format; }
catch (e) { bad('加载 navConfig / cmsUtils', e.message); }
var categoryPath = path.join(VIEWS, 'manager', 'category.ejs');
var parentOpts = [{ v: '', t: '（顶级分类）' }, { v: '507f1f77bcf86cd7994390aa', t: '产品与设计', p: '' }];
var parentFilterOpts = [{ v: '__none__', t: '仅顶级分类' }].concat(parentOpts.filter(function (o) { return o.v !== ''; }));
var catLocals = {
  navConfig: navConfig,
  session: { user: { userName: 'tester', realName: '测试员' }, site: { name: 'NODELOG' } },
  locals: { filters: {} },
  filters: {},
  url: '/manager/category/admin',
  page: 1,
  totalPage: 1,
  docs: mockDocs,
  parentOptions: parentOpts,
  parentFilterOpts: parentFilterOpts,
  format: cmsFormat
};
try {
  var catHtml = ejs.render(fs.readFileSync(categoryPath, 'utf8'), catLocals, { filename: categoryPath });
  if (/分类管理/.test(catHtml)) ok('渲染含「分类管理」标题'); else bad('渲染含「分类管理」标题');
  if (/nl-admin-list/.test(catHtml)) ok('分类页经 admin-list 装配表格'); else bad('分类页经 admin-list 装配表格');
  if (/js-admin-toolbar|admin-toolbar/.test(catHtml)) ok('分类页含统一工具条'); else bad('分类页含统一工具条');
  if (/js-batch-all/.test(catHtml)) ok('分类页含批量全选'); else bad('分类页含批量全选');
} catch (e) { bad('渲染 category.ejs', e.message); }

/* ---- 4. 契约回归：分类页 include admin-list 且传入 list ---- */
console.log('\n[4] 契约回归保护');
var catSrc = fs.readFileSync(categoryPath, 'utf8');
if (/include\('..\/common\/admin-list'/.test(catSrc) && /list:\s*\{/.test(catSrc)) ok('分类页 include admin-list 并传入 list 配置');
else bad('分类页 include admin-list 并传入 list 配置');

/* ---- 5. 遗留分页残留（仅当某页「只」用老 pager、未双轨到 adminPager 才算违规） ---- */
console.log('\n[5] 遗留分页残留检查');
var offenders = [];
var legacyFallback = [];
fs.readdirSync(path.join(VIEWS, 'manager')).forEach(function (f) {
  if (!/\.ejs$/.test(f)) return;
  var p = path.join(VIEWS, 'manager', f);
  var src = fs.readFileSync(p, 'utf8');
  var hasLegacyPager = /common\/pager'/.test(src);   // 老 pager.ejs
  var hasAdminPager = /adminPager/.test(src);          // 新 adminPager.ejs
  if (hasLegacyPager && !hasAdminPager) offenders.push(f);     // 仅老 pager：真违规
  else if (hasLegacyPager && hasAdminPager) legacyFallback.push(f); // 双轨兜底：预期保留
});
if (!offenders.length) ok('无「仅用老 pager 未双轨」的页面（双轨兜底页：' + (legacyFallback.join(', ') || '无') + '）');
else bad('发现仅用老 pager 的页面', offenders.join(', '));

console.log('\n========================================');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('========================================');
process.exitCode = fail ? 1 : 0;
