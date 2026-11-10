#!/usr/bin/env node
/**
 * 历史富文本文章 HTML -> Markdown 批量迁移（可回滚）
 *
 * 在服务器项目根目录执行：
 *   node scripts/migrate-html-to-md.js --report                    # 只读：统计 + 3 篇转换对照
 *   node scripts/migrate-html-to-md.js --backup                    # 导出原始 HTML 到 JSON
 *   node scripts/migrate-html-to-md.js --apply --limit 20         # 先小批试跑（会自动先备份）
 *   node scripts/migrate-html-to-md.js --apply                    # 全量转换
 *   node scripts/migrate-html-to-md.js --rollback --file <备份文件>
 *
 * 连接串优先读环境变量 MONGO_URL / MONGODB_URI，其次 settings.js 的 url / dbUrl。
 * 只处理 contentType 缺失或 != 'markdown' 且正文确实含 HTML 标签的文档。
 */
var fs = require('fs');
var path = require('path');
var mongoose = require('mongoose');
var html2md = require('../controllers/html2md');

var argv = process.argv.slice(2);
function has(flag) { return argv.indexOf(flag) !== -1; }
function valueOf(flag, fallback) {
    var i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

var mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URI;
if (!mongoUrl) {
    try {
        var settings = require('../settings');
        mongoUrl = settings.url || settings.dbUrl;
    } catch (e) { /* settings.js 不在版本库，生产环境单独放置 */ }
}
if (!mongoUrl) {
    console.error('[!] 缺少 MongoDB 连接串：设置 MONGO_URL / MONGODB_URI，或在 settings.js 配 url / dbUrl');
    process.exit(1);
}

var backupDir = path.join(__dirname, '..', '.workbuddy', 'backup');
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function safeUrl(u) { return String(u).replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'); }

function query() {
    return { $or: [
        { contentType: { $exists: false } },
        { contentType: { $ne: 'markdown' } }
    ]};
}

async function main() {
    await mongoose.connect(mongoUrl);
    var col = mongoose.connection.db.collection('content');
    var all = await col.find(query(), { projection: { name: 1, content: 1, contentType: 1 } }).toArray();
    var targets = all.filter(function (d) { return html2md.isHtml(d.content); });
    var limit = parseInt(valueOf('--limit', '0'), 10) || 0;
    var batch = limit > 0 ? targets.slice(0, limit) : targets;

    console.log('连接：' + safeUrl(mongoUrl));
    console.log('历史/非 Markdown 文档：' + all.length + ' 篇；含 HTML 标签需转换：' + targets.length + ' 篇；本次处理：' + batch.length + ' 篇');

    if (has('--report')) {
        batch.slice(0, 3).forEach(function (d, i) {
            var md = html2md.convert(d.content);
            console.log('\n--- 样例 ' + (i + 1) + '：' + d.name + ' (' + String(d._id) + ') ---');
            console.log('[转换前] ' + String(d.content).slice(0, 220).replace(/\n/g, ' '));
            console.log('[转换后] ' + md.slice(0, 320).replace(/\n/g, ' '));
        });
        console.log('\n--report 为只读，未改动任何数据。确认样例后执行 --apply。');
        return;
    }

    if (has('--rollback')) {
        var file = valueOf('--file', '');
        if (!file || !fs.existsSync(file)) {
            console.error('[!] --rollback 需要 --file 指向 --backup/--apply 生成的 JSON');
            process.exitCode = 1;
            return;
        }
        var saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        var restored = 0;
        for (var k = 0; k < saved.length; k++) {
            var row = saved[k];
            await col.updateOne({ _id: row._id }, {
                $set: { content: row.content, contentType: row.contentType || 'html' },
                $unset: { htmlBackup: '' }
            });
            restored++;
        }
        console.log('已回滚 ' + restored + ' 篇（content / contentType 复原，htmlBackup 清除）');
        return;
    }

    if (!has('--backup') && !has('--apply')) {
        console.log('未指定动作。可用：--report / --backup / --apply / --rollback');
        return;
    }

    // --backup 与 --apply 都先落一份原始 HTML，保证可回滚
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    var backupFile = path.join(backupDir, 'content-html-' + stamp() + '.json');
    var snapshot = batch.map(function (d) {
        return { _id: d._id, name: d.name, content: d.content, contentType: d.contentType || 'html' };
    });
    fs.writeFileSync(backupFile, JSON.stringify(snapshot, null, 2), 'utf8');
    console.log('已备份 ' + snapshot.length + ' 篇原文 -> ' + backupFile);
    console.log('回滚命令：node scripts/migrate-html-to-md.js --rollback --file "' + backupFile + '"');

    if (has('--backup')) return;

    var ok = 0, skipped = 0, failed = 0;
    for (var i = 0; i < batch.length; i++) {
        var d = batch[i];
        try {
            var md = html2md.convert(d.content);
            // 以原始 content 作为乐观锁：迁移期间被用户编辑过的文章不会被覆盖
            var r = await col.updateOne(
                { _id: d._id, content: d.content },
                { $set: { content: md, contentType: 'markdown', htmlBackup: d.content } }
            );
            if (r.matchedCount === 0) { skipped++; console.log('  跳过（内容已变更）：' + d.name); }
            else ok++;
        } catch (e) {
            failed++;
            console.error('  失败：' + d.name + ' -> ' + e.message);
        }
    }
    console.log('\n完成：转换 ' + ok + ' 篇，跳过 ' + skipped + ' 篇，失败 ' + failed + ' 篇');
    if (failed > 0) process.exitCode = 1;
}

main().catch(function (e) {
    console.error('[!] 迁移失败：' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
}).finally(function () {
    return mongoose.disconnect();
});
