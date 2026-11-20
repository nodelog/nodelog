#!/usr/bin/env node
/**
 * WP3 检索底座：重建全文检索 text 索引（旧 {name,content,tags} → 新 {name,searchBody,tags}+weights）
 *
 * 在项目根目录执行：
 *   node scripts/rebuild-search-index.js --report   # 只读：列出当前所有索引及 text 索引定义
 *   node scripts/rebuild-search-index.js --apply    # 重建：drop 旧 text 索引 + create 新索引（幂等）
 *
 * 为什么必须手动重建：MongoDB 每集合只允许一个 text 索引，Mongoose autoIndex 不会
 * 自动修改已存在的同类型索引定义——改了 schema 但线上索引仍是旧定义，检索仍走旧字段。
 *
 * 连接串优先读 MONGO_URL / MONGODB_URI，其次 settings.js 的 url / dbUrl（与 migrate-doc-type.js 一致）。
 */
var mongoose = require('mongoose');

var argv = process.argv.slice(2);
function has(flag) { return argv.indexOf(flag) !== -1; }

var mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URI;
if (!mongoUrl) {
    try {
        var settings = require('../settings');
        mongoUrl = settings.url || settings.dbUrl;
    } catch (e) { /* settings.js 在生产环境单独放置 */ }
}
if (!mongoUrl) {
    console.error('[!] 缺少 MongoDB 连接串：设置 MONGO_URL / MONGODB_URI，或在 settings.js 配 url / dbUrl');
    process.exit(1);
}
function safeUrl(u) { return String(u).replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'); }

// 目标索引定义：与 models/Content.js 的 ContentSchema.index(...) 完全一致
var NEW_INDEX = {
    name: 'text', searchBody: 'text', tags: 'text'
};
var NEW_OPTIONS = {
    weights: {name: 10, tags: 5, searchBody: 1},
    default_language: 'none',
    name: 'content_text'
};

function findTextIndex(indexes) {
    // text 索引的特征：key 里至少一个字段值为 'text'
    return indexes.find(function (idx) {
        return Object.keys(idx.key || {}).some(function (k) { return idx.key[k] === 'text'; });
    });
}
function describe(idx) {
    return idx ? JSON.stringify({name: idx.name, key: idx.key, weights: idx.weights, default_language: idx.default_language}) : '（无 text 索引）';
}
function isTarget(idx) {
    if (!idx) return false;
    var k = idx.key || {};
    // 比对字段集合是否精确为 name/searchBody/tags（顺序无关）
    var keys = Object.keys(k).sort().join(',');
    return keys === 'name,searchBody,tags' &&
        k.name === 'text' && k.searchBody === 'text' && k.tags === 'text';
}

async function main() {
    console.log('连接：' + safeUrl(mongoUrl));
    await mongoose.connect(mongoUrl, {useNewUrlParser: true, useUnifiedTopology: true});
    var col = mongoose.connection.db.collection('content');
    var indexes = await col.indexes();
    var textIdx = findTextIndex(indexes);
    console.log('当前 text 索引：' + describe(textIdx));

    if (has('--report')) {
        console.log('\n全部索引：');
        indexes.forEach(function (idx) { console.log('  - ' + idx.name + ' ' + JSON.stringify(idx.key)); });
        if (!textIdx) console.log('\n[!] 无 text 索引，搜索的 $text 查询会报错——需 --apply 重建');
        else if (!isTarget(textIdx)) console.log('\n[!] text 索引是旧定义，需 --apply 重建');
        else console.log('\n[OK] text 索引已是新定义');
        return;
    }
    if (!has('--apply')) {
        console.log('\n用法：--report（只读诊断） / --apply（重建索引）');
        return;
    }

    if (isTarget(textIdx)) {
        console.log('\n[OK] text 索引已是新定义，无需重建（幂等）');
        return;
    }
    if (textIdx && textIdx.name) {
        console.log('\n删除旧 text 索引：' + textIdx.name);
        await col.dropIndex(textIdx.name);
    }
    console.log('创建新 text 索引：' + JSON.stringify(NEW_INDEX) + ' 选项 ' + JSON.stringify(NEW_OPTIONS));
    await col.createIndex(NEW_INDEX, NEW_OPTIONS);
    var after = findTextIndex(await col.indexes());
    console.log('\n重建完成：' + describe(after));
    if (!isTarget(after)) {
        console.error('[!] 重建后校验失败，索引定义不符预期');
        process.exitCode = 1;
    }
}

main().catch(function (e) {
    console.error('[!] 重建失败：' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
}).finally(function () {
    return mongoose.disconnect();
});
