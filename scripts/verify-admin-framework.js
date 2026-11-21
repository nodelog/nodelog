#!/usr/bin/env node
/**
 * 后台管理框架 · 基础验证（离线、零新增依赖、不连 MongoDB）
 * 用法：node scripts/verify-admin-framework.js   或   npm run admin:verify
 *
 * 覆盖：框架门面契约 / 配置项与默认值 / 声明校验与错误处理 / 路由表 /
 *       框架扩展点真实生效 / 前后端阈值一致性 / 模板可编译 / JS 语法 / 菜单契约。
 * 退出码：0 全通过；1 有失败项（可直接用于 CI 门禁）。
 */
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var total = 0, failed = 0, currentGroup = '';
function group(name) { currentGroup = name; console.log('\n== ' + name + ' =='); }
function ok(name, fn) {
    total++;
    try { fn(); console.log('  PASS  ' + name); }
    catch (e) { failed++; console.log('  FAIL  ' + name + '  ->  ' + (e && e.message)); }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function has(rel, text) { return read(rel).indexOf(text) !== -1; }

var fw = require('../controllers/adminFramework');
var cfg = require('../controllers/adminConfig');

/* ---------------- 1. 框架门面：默认值与契约 ---------------- */
group('1. 框架门面 · 配置项与默认值');
ok('仅加载门面不触发数据库连接（可离线验证）', function () {
    assert.strictEqual(require('mongoose').connection.readyState, 0);
});
ok('阈值类默认值与 adminConfig 单一来源一致', function () {
    assert.strictEqual(fw.DEFAULTS.pageSize, cfg.PAGE_SIZE);
    assert.strictEqual(fw.DEFAULTS.maxPageSize, cfg.MAX_PAGE_SIZE);
    assert.strictEqual(fw.DEFAULTS.batchLimit, cfg.BATCH_LIMIT);
    assert.strictEqual(fw.DEFAULTS.importMaxBytes, cfg.IMPORT_MAX_BYTES);
    assert.strictEqual(fw.DEFAULTS.importMaxRows, cfg.IMPORT_MAX_ROWS);
});
ok('行为类默认值明确且安全（默认管理员 / 降序 / 统一响应）', function () {
    assert.strictEqual(fw.DEFAULTS.roles, 'admin');
    assert.strictEqual(fw.DEFAULTS.order, 'desc');
    assert.strictEqual(fw.DEFAULTS.shape, 'success');
    assert.strictEqual(fw.ROLES.ADMIN, 0);
});
ok('FIELD_KINDS 与 openForm 实现一一对应（6 种）', function () {
    assert.deepStrictEqual(fw.FIELD_KINDS,
        ['text', 'textarea', 'select', 'number', 'date', 'password']);
    assert.ok(has('public/js/common.js', "['number', 'date', 'password']"));
});
ok('CAPABILITIES 与标准路由动作一一对应（10 项）', function () {
    assert.strictEqual(fw.CAPABILITIES.length, 10);
    assert.strictEqual(fw.ROUTE_SPEC.length, fw.CAPABILITIES.length);
    fw.ROUTE_SPEC.forEach(function (r) { assert.ok(fw.CAPABILITIES.indexOf(r.cap) !== -1); });
});

/* ---------------- 2. 资源声明：正常路径 ---------------- */
group('2. defineResource · 归一化与默认值');
var spec = {
    key: 'demo', label: '演示', model: {}, base: '/manager/demo',
    desc: {search: ['name'], extraFilters: ['kind']},
    list: {sortWhitelist: ['createTime', 'name'], sortBy: 'name', order: 'asc'},
    fields: [
        {n: 'name', t: '名称', k: 'text', req: true, max: 60},
        {n: 'kind', t: '类型', k: 'select', o: [{v: 'a', t: '甲'}, {v: 'b', t: '乙'}]}
    ],
    columns: ['名称', '类型'],
    capabilities: ['page', 'list', 'detail', 'add', 'modify', 'status'],
    roles: 'admin'
};
var res = fw.defineResource(spec);
ok('返回归一化描述符（key/label/base/pagePath/currentMenu/roles/shape）', function () {
    assert.strictEqual(res.key, 'demo');
    assert.strictEqual(res.currentMenu, 'demo');
    assert.strictEqual(res.pagePath, '/manager/demo/admin');
    assert.strictEqual(res.roles, 'admin');
    assert.strictEqual(res.shape, 'success');
    assert.strictEqual(res.__isResource, true);
});
ok('未声明项填入合理默认值', function () {
    assert.strictEqual(res.list.pageSize, cfg.PAGE_SIZE);
    assert.deepStrictEqual(res.desc.soft, {status: 0});
    assert.strictEqual(res.desc.dateField, 'createTime');
    assert.strictEqual(res.list.view, 'manager/demo');
    assert.strictEqual(res.list.title, '演示管理');
    assert.strictEqual(res.softStatus, 1);
});
ok('声明项原样保留（sortBy/order/extraFilters/search）', function () {
    assert.strictEqual(res.list.sortBy, 'name');
    assert.strictEqual(res.list.order, 'asc');
    assert.deepStrictEqual(res.desc.extraFilters, ['kind']);
    assert.deepStrictEqual(res.desc.search, ['name']);
});
ok('默认 capabilities 为全部 10 项', function () {
    var r = fw.defineResource({key: 'full', label: '全量', model: {}, base: '/manager/full'});
    assert.strictEqual(r.capabilities.length, 10);
    assert.deepStrictEqual(r.capabilities, fw.CAPABILITIES);
});
ok('字段描述符归一化（req/max/d 补齐、select.o 保留）', function () {
    assert.strictEqual(res.fields[0].req, true);
    assert.strictEqual(res.fields[0].max, 60);
    assert.strictEqual(res.fields[0].d, '');
    assert.strictEqual(res.fields[0].k, 'text');
    assert.deepStrictEqual(res.fields[1].o, [{v: 'a', t: '甲'}, {v: 'b', t: '乙'}]);
});

/* ---------------- 3. 错误处理：非法声明必须大声失败 ---------------- */
group('3. 错误处理 · 非法声明启动期抛错');
var badCases = [
    ['非对象声明', null],
    ['数组声明', []],
    ['key 缺失', {label: 'x', model: {}, base: '/manager/x'}],
    ['key 非法（中划线）', {key: 'bad-key', label: 'x', model: {}, base: '/manager/x'}],
    ['label 缺失', {key: 'a', model: {}, base: '/manager/a'}],
    ['model 缺失', {key: 'a', label: 'x', base: '/manager/a'}],
    ['base 非 /manager 前缀', {key: 'a', label: 'x', model: {}, base: '/api/a'}],
    ['base 带尾斜杠', {key: 'a', label: 'x', model: {}, base: '/manager/a/'}],
    ['sortBy 不在白名单', {key: 'a', label: 'x', model: {}, base: '/manager/a',
        list: {sortWhitelist: ['name'], sortBy: 'evil'}}],
    ['pageSize 越界', {key: 'a', label: 'x', model: {}, base: '/manager/a',
        list: {pageSize: 99999}}],
    ['capabilities 含未知动作', {key: 'a', label: 'x', model: {}, base: '/manager/a',
        capabilities: ['drop']}],
    ['roles 非法', {key: 'a', label: 'x', model: {}, base: '/manager/a', roles: 'root'}],
    ['desc.extra 非函数', {key: 'a', label: 'x', model: {}, base: '/manager/a',
        desc: {extra: 'oops'}}],
    ['desc.extraFilters 非法键', {key: 'a', label: 'x', model: {}, base: '/manager/a',
        desc: {extraFilters: ['bad-key']}}],
    ['fields 非数组', {key: 'a', label: 'x', model: {}, base: '/manager/a', fields: {}}],
    ['字段 n 重复', {key: 'a', label: 'x', model: {}, base: '/manager/a',
        fields: [{n: 'a', t: 'A'}, {n: 'a', t: 'B'}]}],
    ['字段 k 未知', {key: 'a', label: 'x', model: {}, base: '/manager/a',
        fields: [{n: 'a', t: 'A', k: 'richtext'}]}],
    ['select 缺 o', {key: 'a', label: 'x', model: {}, base: '/manager/a',
        fields: [{n: 'a', t: 'A', k: 'select'}]}],
    ['select.o 项缺 v/t', {key: 'a', label: 'x', model: {}, base: '/manager/a',
        fields: [{n: 'a', t: 'A', k: 'select', o: [{v: '1'}]}]}]
];
badCases.forEach(function (c) {
    ok('拒绝：' + c[0], function () {
        assert.throws(function () { fw.defineResource(c[1]); }, /adminFramework/);
    });
});

/* ---------------- 4. 路由表 / 菜单 ---------------- */
group('4. routesFor / navItem · 一处声明多处生效');
var routes = fw.routesFor(res);
ok('路由条数 = 声明的 capabilities 数', function () {
    assert.strictEqual(routes.length, res.capabilities.length);
});
ok('路由 method/path/handler/guard 正确，且无重复', function () {
    var seen = {};
    routes.forEach(function (r) {
        var id = r.method.toUpperCase() + ' ' + r.path;
        assert.ok(!seen[id], '重复路由 ' + id);
        seen[id] = true;
        assert.ok(fw.CAPABILITIES.indexOf(r.action) !== -1 || r.action === 'page');
        assert.strictEqual(r.guard, 'admin');
        assert.ok(/^\/manager\//.test(r.path));
    });
    assert.strictEqual(routes[0].path, '/manager/demo/admin');
    assert.strictEqual(routes[1].path, '/manager/demo/list');
});
ok("roles:'all' 时 guard 降为 login", function () {
    var r = fw.defineResource({key: 'open', label: '开放', model: {}, base: '/manager/open', roles: 'all'});
    fw.routesFor(r).forEach(function (x) { assert.strictEqual(x.guard, 'login'); });
});
ok('navItem 与 navConfig 契约一致', function () {
    assert.deepStrictEqual(fw.navItem(res),
        {key: 'demo', label: '演示', href: '/manager/demo/admin', roles: 'admin'});
});

/* ---------------- 5. 框架扩展点真实生效（非纸面配置） ---------------- */
group('5. 框架扩展点 · 真实调用验证');
var kit = require('../controllers/adminKit');
ok('extraFilters 声明的键进入 filters，未声明的键被忽略', function () {
    var p = kit.parseListQuery({parent: '__none__', kind: 'x', evil: 'y'},
        {sortWhitelist: ['order'], defaultSortBy: 'order', extraFilters: ['parent'], defaultOrder: 'asc'});
    assert.strictEqual(p.filters.parent, '__none__');
    assert.strictEqual(p.filters.kind, undefined);
    assert.strictEqual(p.filters.evil, undefined);
});
ok('defaultOrder 生效，显式 q.order 可覆盖', function () {
    var a = kit.parseListQuery({}, {defaultOrder: 'asc'});
    assert.strictEqual(a.order, 'asc');
    var b = kit.parseListQuery({order: 'desc'}, {defaultOrder: 'asc'});
    assert.strictEqual(b.order, 'desc');
    var c = kit.parseListQuery({}, {});
    assert.strictEqual(c.order, 'desc');
});
ok('回归：排序白名单 / 非法日期 / 分页上限守卫未被破坏', function () {
    assert.strictEqual(kit.parseListQuery({sortBy: 'evil'},
        {sortWhitelist: ['name'], defaultSortBy: 'name'}).sortBy, 'name');
    assert.ok(kit.parseListQuery({from: 'not-a-date'}, {}).error);
    assert.strictEqual(kit.parseListQuery({page: -3}, {}).page, 1);
    assert.strictEqual(kit.parseListQuery({pageSize: 99999}, {}).pageSize, cfg.MAX_PAGE_SIZE);
});
ok('category.desc 已声明 parent 筛选 + desc.extra 消费它（死功能已修复）', function () {
    assert.ok(has('controllers/category.js', "extraFilters: ['parent']"));
    assert.ok(has('controllers/category.js', 'filters.parent'));
});
ok('adminPager 自动并入自定义筛选键（翻页不丢筛选）', function () {
    assert.ok(has('views/common/adminPager.ejs', 'typeof filters'));
    assert.ok(has('views/common/adminPager.ejs', '_keys.push(k)'));
});
ok('adminToolbar 支持 bar.defaultOrder，与 desc.defaultOrder 对齐', function () {
    assert.ok(has('views/common/adminToolbar.ejs', 'bar.defaultOrder'));
    assert.ok(has('views/manager/category.ejs', "defaultOrder: 'asc'"));
});
ok('CSV 阈值文案由配置派生（消除第二真源）', function () {
    var src = read('controllers/adminIo.js');
    assert.ok(src.indexOf("'文件超过 2MB'") === -1);
    assert.ok(src.indexOf("'超过 1000 行'") === -1);
    assert.ok(src.indexOf('IMPORT_MAX_BYTES') !== -1 && src.indexOf('IMPORT_MAX_ROWS') !== -1);
});

/* ---------------- 6. 语法 / 模板 / 菜单契约 ---------------- */
group('6. 语法、模板与菜单契约');
var jsFiles = [
    'controllers/adminFramework.js', 'controllers/adminKit.js', 'controllers/adminCrud.js',
    'controllers/adminIo.js', 'controllers/adminConfig.js', 'controllers/category.js',
    'public/js/common.js', 'scripts/verify-admin-framework.js'
];
jsFiles.forEach(function (f) {
    ok('node --check ' + f, function () {
        cp.execFileSync(process.execPath, ['--check', path.join(ROOT, f)], {stdio: 'pipe'});
    });
});
var ejs = require('ejs');
var ejsFiles = [
    'views/common/adminToolbar.ejs', 'views/common/adminPager.ejs',
    'views/common/state.ejs', 'views/manager/category.ejs',
    'views/manager/header.ejs'
];
ejsFiles.forEach(function (f) {
    ok('ejs.compile ' + f, function () {
        ejs.compile(read(f), {filename: path.join(ROOT, f)});
    });
});
ok('统一布局：所有后台列表页均 include manager/header', function () {
    var dir = path.join(ROOT, 'views/manager');
    var list = fs.readdirSync(dir).filter(function (n) { return /\.ejs$/.test(n); });
    assert.ok(list.length >= 15);
    var missing = list.filter(function (n) {
        return !/header\.ejs$|footer\.ejs$/.test(n) && read('views/manager/' + n).indexOf("include('header')") === -1;
    });
    assert.deepStrictEqual(missing, []);
});
var nav = require('../navConfig');
ok('navConfig 后台菜单 key 唯一、href 合法、roles 合法', function () {
    var seen = {}, n = 0;
    nav.admin.groups.forEach(function (g) {
        g.items.forEach(function (it) {
            assert.ok(!seen[it.key], '重复菜单 key: ' + it.key);
            seen[it.key] = true;
            assert.ok(it.label && it.key, '菜单缺 key/label');
            assert.ok(!it.roles || ['admin', 'all', 'user'].indexOf(it.roles) !== -1 ||
                Array.isArray(it.roles), '非法 roles: ' + it.roles);
            var href = it.href || (it.hrefByRole && it.hrefByRole.admin) || '';
            assert.ok(/^\/(?!\/)/.test(href), '非法 href: ' + href);
            n++;
        });
    });
    assert.ok(n >= 10, '菜单项过少: ' + n);
});

/* ---------------- 汇总 ---------------- */
console.log('\n========================================');
console.log('  基础验证：' + (total - failed) + '/' + total + ' PASS' + (failed ? '，' + failed + ' FAIL' : ''));
console.log('========================================');
process.exit(failed ? 1 : 0);
