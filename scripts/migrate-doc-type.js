#!/usr/bin/env node
/**
 * Blog + Wiki 一体化：历史文档 docType / searchBody 回填（可回滚、幂等、可中断）
 *
 * 在项目根目录执行：
 *   node scripts/migrate-doc-type.js --report                    # 只读：统计缺口 + 3 篇派生样例
 *   node scripts/migrate-doc-type.js --backup                    # 导出待回填文档原字段到 JSON
 *   node scripts/migrate-doc-type.js --apply --limit 100         # 先小批试跑（自动先备份）
 *   node scripts/migrate-doc-type.js --apply                     # 全量回填
 *   node scripts/migrate-doc-type.js --verify                    # 核对：docType 缺失数应为 0
 *   node scripts/migrate-doc-type.js --rollback --file <备份文件> # 仅还原本次回填的字段
 *
 * 设计约束：
 *   1. 只补缺失字段，幂等：docType 已存在不覆盖（不把 wiki 误改回 blog）；
 *      searchBody 为空或非字符串才重写。
 *   2. 乐观锁：以回填读到的 content 原文作为匹配条件，迁移期间被编辑过的文档跳过，不覆盖新内容。
 *   3. searchBody 复用 controllers/markdown.js 的 toSearchBody，与写入口径一致，避免两套实现漂移。
 *   4. 不改变正文、标签、状态、来源等任何既有字段——只 set 四个新字段。
 *   5. 历史文档缺省按 blog（与 schema default / {$ne:'wiki'} 判定一致）。
 *
 * 连接串优先读 MONGO_URL / MONGODB_URI，其次 settings.js 的 url / dbUrl。
 */
var fs = require('fs');
var path = require('path');
var mongoose = require('mongoose');
var markdown = require('../controllers/markdown');

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

// 待回填：docType 缺失 或 searchBody 缺失/空。用 $or 覆盖，两个条件都是普通字段（无 $text）。
function query() {
    return {$or: [
        {docType: {$exists: false}},
        {searchBody: {$exists: false}},
        {searchBody: ''}
    ]};
}

// 单条派生结果（与写入口径同源）
function derive(d) {
    return {
        docType: d.docType === 'wiki' ? 'wiki' : 'blog', // 已是 wiki 不覆盖
        searchBody: markdown.toSearchBody(d.content, d.contentType)
    };
}

async function main() {
    await mongoose.connect(mongoUrl);
    var col = mongoose.connection.db.collection('content');
    var all = await col.find(query(), {
        projection: {name: 1, content: 1, contentType: 1, docType: 1, searchBody: 1}
    }).toArray();
    var limit = parseInt(valueOf('--limit', '0'), 10) || 0;
    var batch = limit > 0 ? all.slice(0, limit) : all;

    var total = await col.countDocuments({});
    var missingType = await col.countDocuments({docType: {$exists: false}});
    console.log('连接：' + safeUrl(mongoUrl));
    console.log('总文档：' + total + '；待回填：' + all.length + '；其中缺 docType：' + missingType + '；本次处理：' + batch.length);

    if (has('--verify')) {
        console.log('\n--- 核对结果 ---');
        console.log('缺 docType：' + missingType + '（应为 0）');
        console.log('缺/空 searchBody：' + await col.countDocuments({$or: [{searchBody: {$exists: false}}, {searchBody: ''}]}) + '（应为 0）');
        console.log('blog：' + await col.countDocuments({docType: 'blog'}) + '；wiki：' + await col.countDocuments({docType: 'wiki'}));
        return;
    }

    if (!all.length && !has('--report')) {
        console.log('无待回填文档，无需操作。');
        return;
    }

    if (has('--report')) {
        batch.slice(0, 3).forEach(function (d, i) {
            var x = derive(d);
            console.log('\n--- 样例 ' + (i + 1) + '：' + d.name + ' (' + String(d._id) + ') ---');
            console.log('docType: ' + (d.docType || '<缺失>') + ' -> ' + x.docType);
            console.log('searchBody 前 200 字：' + x.searchBody.slice(0, 200).replace(/\n/g, ' '));
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
            var unset = {}, set = {};
            // 回填前该字段不存在 → 回滚时 unset；存在（空值）→ 还原空值。
            if (row.hadDocType) set.docType = row.docType; else unset.docType = '';
            if (row.hadSearchBody) set.searchBody = row.searchBody; else unset.searchBody = '';
            var upd = {};
            if (Object.keys(set).length) upd.$set = set;
            if (Object.keys(unset).length) upd.$unset = unset;
            if (Object.keys(upd).length) {
                await col.updateOne({_id: row._id}, upd);
                restored++;
            }
        }
        console.log('已回滚 ' + restored + ' 篇（仅还原 docType / searchBody，正文未动）');
        return;
    }

    if (!has('--backup') && !has('--apply')) {
        console.log('未指定动作。可用：--report / --backup / --apply / --verify / --rollback');
        return;
    }

    // --backup 与 --apply 都先落一份原字段快照，保证可回滚
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, {recursive: true});
    var backupFile = path.join(backupDir, 'content-doc-type-' + stamp() + '.json');
    var snapshot = batch.map(function (d) {
        return {
            _id: d._id,
            name: d.name,
            hadDocType: d.docType !== undefined,
            docType: d.docType || null,
            hadSearchBody: d.searchBody !== undefined,
            searchBody: d.searchBody || ''
        };
    });
    fs.writeFileSync(backupFile, JSON.stringify(snapshot, null, 2), 'utf8');
    console.log('已备份 ' + snapshot.length + ' 篇原字段 -> ' + backupFile);
    console.log('回滚命令：node scripts/migrate-doc-type.js --rollback --file "' + backupFile + '"');

    if (has('--backup')) return;

    var ok = 0, skipped = 0, failed = 0;
    for (var i = 0; i < batch.length; i++) {
        var d = batch[i];
        try {
            var x = derive(d);
            var setDoc = {};
            // 只补缺字段：docType 已存在（含 wiki）不动
            if (d.docType === undefined) setDoc.docType = x.docType;
            setDoc.searchBody = x.searchBody;
            // 乐观锁：content 原文作为匹配条件，编辑中的文档跳过
            var r = await col.updateOne(
                {_id: d._id, content: d.content},
                {$set: setDoc}
            );
            if (r.matchedCount === 0) { skipped++; console.log('  跳过（内容已变更或已回填）：' + d.name); }
            else ok++;
        } catch (e) {
            failed++;
            console.error('  失败：' + d.name + ' -> ' + e.message);
        }
    }
    console.log('\n完成：回填 ' + ok + ' 篇，跳过 ' + skipped + ' 篇，失败 ' + failed + ' 篇');
    var remain = await col.countDocuments({$or: [{docType: {$exists: false}}, {searchBody: {$exists: false}}, {searchBody: ''}]});
    console.log('剩余待回填：' + remain + '（应为 0）');
    if (failed > 0 || remain > 0) process.exitCode = 1;
}

main().catch(function (e) {
    console.error('[!] 迁移失败：' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
}).finally(function () {
    return mongoose.disconnect();
});
