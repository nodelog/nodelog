// 敏感词匹配器（SPEC-MODERATION §4）：归一化 + 分块 indexOf + 进程内缓存。
// 判定本身同步，但对外 err-first 回调以对齐项目 DAO 约定并与异步 assertActive 组合（§5.5）。
// 只 require model + config，不 require 任何 handler（G04 单向依赖）。
var SensitiveWord = require('../../models/SensitiveWord');
var cfg = require('../adminConfig');

var ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060]/g;
var WHITESPACE = /\s+/g;

// §4.1 五步固定顺序；词库写入与待检文本必须同版本同顺序（改口径需全量重导 + ADR）。
function normalizeForMatch(s) {
    return String(s == null ? '' : s)
        .normalize('NFKC')
        .toLowerCase()
        .replace(ZERO_WIDTH, '')
        .replace(WHITESPACE, '');
}

// 进程内单例缓存（§4.5）。loaded 保证 findAllEnabled 只加载一次；invalidate 后下次 check 重载。
var cache = {items: [], maxLen: 0, version: 0, loaded: false};
var loading = false;
var waiters = [];

// §10.5 默认值显式 resolve，不在 check 内部 || 兜底；配置已在 adminConfig 加载时校验。
function resolveOptions() {
    return {
        chunkChars: cfg.MODERATION_CHUNK_CHARS,
        overlap: cfg.MODERATION_CHUNK_OVERLAP,
        maxWordChars: cfg.MODERATION_MAX_WORD_CHARS,
        wordBoundary: cfg.MODERATION_WORD_BOUNDARY,
        failMode: cfg.MODERATION_FAIL_MODE
    };
}

function applyDocs(docs) {
    var items = [], maxLen = 0;
    (docs || []).forEach(function (d) {
        var n = normalizeForMatch(d.wordNormalized);
        if (!n) return; // 全零宽/全空白的脏词跳过，不静默参与匹配
        if (n.length > cfg.MODERATION_MAX_WORD_CHARS) {
            throw new Error('[moderationMatcher] 词库超长词：wordNormalized 期望 ≤' +
                cfg.MODERATION_MAX_WORD_CHARS + '，实际=' + n.length + '（id=' + String(d._id) + '）');
        }
        items.push({id: String(d._id), word: String(d.word || ''), normalized: n});
        if (n.length > maxLen) maxLen = n.length;
    });
    cache.items = items;
    cache.maxLen = maxLen;
    cache.version++;
    cache.loaded = true;
    if (!items.length) console.warn('[moderationMatcher] 词库为空，当前不拦截任何内容（上线前须导入非空词库 C8）');
}

// 加载词库（仅 status:0）。并发 check 合并为一次 DB 读；失败不置 loaded，交给 guard 按 fail-open 处理。
function ensureLoaded(cb) {
    if (cache.loaded) return cb(null);
    waiters.push(cb);
    if (loading) return;
    loading = true;
    SensitiveWord.findAllEnabled(function (err, docs) {
        var list = waiters.slice();
        waiters.length = 0;
        loading = false;
        if (err) { list.forEach(function (w) { w(err); }); return; }
        try {
            applyDocs(docs);
            list.forEach(function (w) { w(null); });
        } catch (e) {
            cache.loaded = false; // 超长词等数据异常大声失败，走 matcher_unavailable（fail-open/closed）
            list.forEach(function (w) { w(e); });
        }
    });
}

// 写后热更新（§4.5）：清缓存，下一次 check 重新 findAllEnabled。失效仅 warn，不阻断主写入。
function invalidate() {
    cache.loaded = false;
    cache.items = [];
    cache.maxLen = 0;
    console.log('[moderationMatcher] 词库缓存已失效，下次匹配将重新加载');
}

// §4.4 分块 indexOf：块间重叠 > 最长词，保证跨块词不被切断；超长文本不截断，老行为零变更。
// 返回命中词项 {id,word,normalized} 或 null。全程 indexOf，不拼用户可控正则（无 ReDoS）。
function findHit(text, opts) {
    var items = cache.items;
    if (!text || !items.length) return null;
    var step = opts.chunkChars - opts.overlap;
    if (step < 1) step = opts.chunkChars;
    for (var start = 0; start < text.length; start += step) {
        var chunk = text.slice(start, start + opts.chunkChars);
        for (var i = 0; i < items.length; i++) {
            if (chunk.indexOf(items[i].normalized) !== -1) return items[i];
        }
        if (start + opts.chunkChars >= text.length) break;
    }
    return null;
}

// 对外唯一匹配入口（§10.4）：texts={fieldKey:rawValue}；fields=有序键数组（决定首个命中字段）。
// cb(err, {hit:true,hitWord,hitWordId,field}|null)。fail-open/closed 由 guard.check 决策。
exports.check = function (texts, fields, cb) {
    ensureLoaded(function (err) {
        if (err) return cb(err);
        var opts = resolveOptions();
        fields = fields || Object.keys(texts || {});
        for (var f = 0; f < fields.length; f++) {
            var key = fields[f];
            var raw = texts ? texts[key] : '';
            // tags[] 逐项：任一标签命中即返回 field='tags'（§4.3）。
            var values = Array.isArray(raw) ? raw : [raw];
            for (var v = 0; v < values.length; v++) {
                var norm = normalizeForMatch(values[v]);
                if (!norm) continue;
                var hit = findHit(norm, opts);
                if (hit) return cb(null, {hit: true, hitWord: hit.word, hitWordId: hit.id, field: key});
            }
        }
        cb(null, null);
    });
};

exports.normalizeForMatch = normalizeForMatch;
exports.invalidate = invalidate;
exports.resolveOptions = resolveOptions;
