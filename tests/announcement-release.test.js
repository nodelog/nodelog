/**
 * 新功能公告生成逻辑回归测试（零依赖、零数据库）。
 * 运行：node tests/announcement-release.test.js
 */
'use strict';

var assert = require('assert');
var note = require('../services/releaseNote');

var passed = 0;
function t(name, fn) {
    fn();
    passed++;
    console.log('  ✓ ' + name);
}

console.log('releaseNote 单元测试');

t('识别 feat / feat(scope) / 带噪声前缀 / 中文新增', function () {
    assert.deepStrictEqual(note.featureOf('feat: 开放文章发布 API'), { scope: '', text: '开放文章发布 API' });
    assert.deepStrictEqual(note.featureOf('feat(admin): 概览看板增强'), { scope: 'admin', text: '概览看板增强' });
    assert.deepStrictEqual(note.featureOf('@ feat(admin): 后台管理增强'), { scope: 'admin', text: '后台管理增强' });
    assert.ok(note.featureOf('新增：扫码登录'));
    assert.ok(note.featureOf('新功能 支持 Markdown'));
});

t('featureOf 兼容旧语义：只把 feat 系判为新功能', function () {
    ['fix(editor): 修复草稿串稿', 'style(theme): 暗色重构', 'chore(tag): 诊断脚本',
        'refactor(tag): 重建标签页', 'docs: 更新 README', '修复：分类显示未分类',
        'copy(sidebar): 品牌卡文案'].forEach(function (s) {
        assert.strictEqual(note.featureOf(s), null, s);
    });
});

t('优化类：refactor/style/perf 前缀与中文优化关键词 → optimization', function () {
    assert.strictEqual(note.classify('refactor(nav): 建立导航单一配置源 navConfig.js').kind, 'optimization');
    assert.strictEqual(note.classify('style(frontend): 首页精致化升级').kind, 'optimization');
    assert.strictEqual(note.classify('perf(list): 首屏渲染提速').kind, 'optimization');
    assert.strictEqual(note.classify('分页优化简化').kind, 'optimization');
    assert.strictEqual(note.classify('导航自适应--首页菜单图标和菜单边距调整美观').kind, 'optimization');
    assert.strictEqual(note.classify('feat: 新功能优先').kind, 'feature');
});

t('fix/chore/docs/copy 与纯格式调整仍不发公告（含中文「升级」也不误收）', function () {
    ['fix(admin): 修复批量操作', 'chore: 升级依赖到安全版本并迁移 EJS 模板语法',
        'docs: 更新 README', 'copy(sidebar): 品牌卡文案', '调整代码格式',
        '修复：分类显示未分类'].forEach(function (s) {
        assert.strictEqual(note.classify(s), null, s);
    });
});

t('feat 标题保持旧格式不变；优化公告改用【优化升级】前缀', function () {
    var feat = note.buildAnnouncement({ commit: 'abc1234', subject: 'feat(tag): 标签计数一键重算' });
    assert.strictEqual(feat.name, '【新功能·tag】标签计数一键重算 · abc1234');
    var opt = note.buildAnnouncement({ commit: 'def5678', subject: 'refactor(ui): 统一设计系统并精简前后台视图' });
    assert.strictEqual(opt.name, '【优化升级·ui】统一设计系统并精简前后台视图 · def5678');
    assert.ok(opt.content.indexOf('站点完成以下优化升级') !== -1);
    assert.ok(note.buildPlainText({ commit: 'def5678', subject: 'refactor(ui): 统一设计系统' })
        .indexOf('站点完成以下优化升级') === 0);
});

t('--pattern 扩展规则生效', function () {
    assert.strictEqual(note.featureOf('去框架化：移除 jQuery'), null);
    assert.ok(note.featureOf('去框架化：移除 jQuery', /^去框架化/));
});

t('git log 输出解析：含换行 body 与控制字符分隔', function () {
    var F = note.FIELD, R = note.RECORD;
    var sample = [
        'abc1234def5678901234567890abcdef12345678' + F + '张三' + F + '2026-11-15T02:00:00+08:00' + F +
        'feat(editor): 编辑器增强' + F + '第一行说明\n第二行说明' + R,
        'bbb1234def5678901234567890abcdef12345678' + F + 'lisi' + F + '2026-11-14T10:00:00+08:00' + F +
        'fix: 不发布' + F + '' + R
    ].join('\n');
    var rows = note.parseGitLog(sample);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].subject, 'feat(editor): 编辑器增强');
    assert.ok(rows[0].body.indexOf('第二行说明') !== -1);
    assert.strictEqual(rows[1].body, '');
});

t('公告标题带 7 位 hash，正文 HTML 完整转义 XSS', function () {
    var built = note.buildAnnouncement({
        commit: 'abc1234def5678901234567890abcdef12345678',
        subject: 'feat(xss): <script>alert(1)</script> & "注入"',
        author: '<img src=x onerror=alert(1)>',
        date: '2026-11-15T02:00:00+08:00',
        body: '说明 <b>带标签</b>\n第二行',
        repoUrl: 'https://github.com/nodelog/nodelog.git'
    });
    assert.ok(built.name.indexOf('abc1234') !== -1, '标题应含短 hash');
    assert.ok(built.content.indexOf('<script>') === -1, '不得出现可执行标签');
    assert.ok(built.content.indexOf('&lt;script&gt;') !== -1, '标签应被转义');
    assert.ok(built.content.indexOf('onerror=alert(1)') === -1 || built.content.indexOf('&lt;img') !== -1);
    assert.ok(built.content.indexOf('<br>') !== -1, '换行应转 <br>');
    assert.ok(built.content.indexOf('https://github.com/nodelog/nodelog/commit/abc1234de') !== -1);
    assert.strictEqual(built.commitHash, 'abc1234def5678901234567890abcdef12345678');
    assert.strictEqual(built.status, 0);
});

t('非法 commit / 非功能提交 / javascript: 仓库地址一律拒绝', function () {
    assert.strictEqual(note.buildAnnouncement({ commit: 'not-a-hash', subject: 'feat: x' }), null);
    assert.strictEqual(note.buildAnnouncement({ commit: 'abc1234', subject: 'fix: x' }), null);
    var built = note.buildAnnouncement({
        commit: 'abc1234', subject: 'feat: 正常标题', repoUrl: 'javascript:alert(1)'
    });
    assert.ok(built.content.indexOf('查看本次代码变更') === -1, '危险 URL 不应渲染链接');
});

console.log('\n全部通过：' + passed + ' 项');
