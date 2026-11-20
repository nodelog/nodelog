#!/usr/bin/env node
/**
 * 图片本地化迁移：把 Wiki 文档正文里的外部图片下载到本站图床，并回写文档正文。
 *
 * 背景：源站 help.jiangzi.xin 即将关闭；外站 help.zjhejiang.com(.dat) 是第三方图床。
 * 两类都必须搬到本地，否则知识库截图会大面积失效。res.wx.qq.com 稳定，跳过。
 *
 * 流程（幂等，可反复运行）：
 *   1) 扫 docs/help-import/md/*.md 里所有图片外链（读现成的 image-urls.txt 亦可）
 *   2) 下载每张图 -> 嗅探真实类型 -> POST /api/upload -> 得到本站 /uploads/xxx
 *   3) 映射表 image-map.json 逐条落盘（断点续传，已搬的跳过）
 *   4) 用映射表替换每篇 md 正文里的外链 -> doc/save 带 id 回写（保留 name/slug/spaceId/parent）
 *   5) 回写进度 written.json 逐条落盘；失败记录 migrate-errors.json
 *
 * 用法：
 *   node scripts/migrate-images.js --dry-run          # 只统计，不下载不写库
 *   node scripts/migrate-images.js --cookie '<Cookie>' # 执行迁移
 *   node scripts/migrate-images.js --cookie '<Cookie>' --only-download  # 只搬图不回写正文
 *   node scripts/migrate-images.js --cookie '<Cookie>' --only-write     # 只回写（图已搬完）
 */
'use strict';
var fs = require('fs'), path = require('path'), https = require('https'), http = require('http');

var DEFAULTS = {
    target: 'https://blog.jiangzi.xin',
    space: 'linkonesaas',
    cookie: '',
    out: 'docs/help-import',
    imgDelay: 100,
    writeDelay: 150,
    dryRun: true,
    onlyDownload: false,
    onlyWrite: false,
    limit: 0
};
function parseArgs(argv) {
    var o = Object.assign({}, DEFAULTS);
    for (var i = 0; i < argv.length; i++) {
        var a = argv[i];
        if (a === '--dry-run') o.dryRun = true;
        else if (a === '--only-download') { o.onlyDownload = true; o.dryRun = false; }
        else if (a === '--only-write') { o.onlyWrite = true; o.dryRun = false; }
        else if (a === '--help' || a === '-h') o.help = true;
        else if (a.indexOf('--') === 0 && i + 1 < argv.length) {
            var k = a.slice(2);
            if (k in o) o[k] = argv[++i];
        }
    }
    if (o.cookie) o.dryRun = false;
    return o;
}

function request(url, opts, cb) {
    opts = opts || {};
    var u = new URL(url), lib = u.protocol === 'https:' ? https : http;
    var headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 migrate-images/1.0', 'Accept': '*/*', 'Accept-Encoding': 'identity' };
    if (opts.cookie) headers.Cookie = opts.cookie;
    if (opts.json) headers['Content-Type'] = 'application/json';
    var payload = opts.body ? JSON.stringify(opts.body) : null;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    var req = lib.request(u, { method: opts.method || 'GET', headers: headers }, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
            var buf = Buffer.concat(chunks), text = buf.toString('utf8'), out = {status: res.statusCode, headers: res.headers, text: text, buf: buf};
            if (opts.json) { try { out.json = JSON.parse(text); } catch (e) { out.json = null; } }
            cb(null, out);
        });
    });
    req.on('error', function (e) { cb(e); });
    if (payload) req.write(payload);
    req.end();
}
function downloadImage(url, maxBytes, redirects, cb) {
    maxBytes = maxBytes || 8 * 1024 * 1024; redirects = redirects || 0;
    if (redirects > 5) return cb(new Error('重定向过多'), null);
    var u; try { u = new URL(url); } catch (e) { return cb(e, null); }
    var lib = u.protocol === 'https:' ? https : http;
    var req = lib.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 migrate-images/1.0', 'Accept': 'image/*,*/*' } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return downloadImage(new URL(res.headers.location, u).href, maxBytes, redirects + 1, cb);
        }
        if (res.statusCode !== 200) { res.resume(); return cb(new Error('HTTP ' + res.statusCode), null); }
        var chunks = [], size = 0;
        res.on('data', function (c) { size += c.length; if (size > maxBytes) { req.destroy(new Error('图片超过 8MB')); return; } chunks.push(c); });
        res.on('end', function () { cb(null, { buf: Buffer.concat(chunks), type: res.headers['content-type'] || '' }); });
    });
    req.on('error', function (e) { cb(e, null); });
}
function mimeDataUrl(type, buf) {
    var t = String(type || '').toLowerCase();
    if (t.indexOf('png') !== -1) return 'data:image/png;base64,';
    if (t.indexOf('jpeg') !== -1 || t.indexOf('jpg') !== -1) return 'data:image/jpeg;base64,';
    if (t.indexOf('gif') !== -1) return 'data:image/gif;base64,';
    if (t.indexOf('webp') !== -1) return 'data:image/webp;base64,';
    if (buf.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'data:image/png;base64,';
    if (buf[0] === 0xFF && buf[1] === 0xD8) return 'data:image/jpeg;base64,';
    if (buf.slice(0, 6).toString() === 'GIF87a' || buf.slice(0, 6).toString() === 'GIF89a') return 'data:image/gif;base64,';
    if (buf.slice(8, 12).toString() === 'WEBP') return 'data:image/webp;base64,';
    return '';
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function loadJson(file, def) { if (fs.existsSync(file)) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {} } return def; }

// 需要搬运的图片：排除已稳定的微信图床 + 已是本站的
function collectUrls(outDir) {
    var files = fs.readdirSync(path.join(outDir, 'md')).filter(function (f) { return /\.md$/.test(f); });
    var urls = {};
    files.forEach(function (f) {
        var txt = fs.readFileSync(path.join(outDir, 'md', f), 'utf8');
        var re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g, m;
        while ((m = re.exec(txt)) !== null) {
            var u = m[1];
            if (u.indexOf('res.wx.qq.com') !== -1) continue;
            if (u.indexOf('/uploads/') !== -1) continue;
            urls[u] = 1;
        }
    });
    return Object.keys(urls);
}

async function downloadPhase(opts, urls, mapFile) {
    var imgMap = loadJson(mapFile, {});
    var errs = [];
    var todo = urls.filter(function (u) { return !imgMap[u]; });
    if (opts.limit) todo = todo.slice(0, opts.limit);
    console.log('\n[下载上传] 共 ' + urls.length + ' 张，已搬 ' + (urls.length - todo.length) + ' 张，待处理 ' + todo.length + ' 张');
    var ok = 0, fail = 0;
    for (var i = 0; i < todo.length; i++) {
        var url = todo[i];
        await sleep(opts.imgDelay);
        try {
            var dl = await new Promise(function (res, rej) { downloadImage(url, 8 * 1024 * 1024, 0, function (e, r) { e ? rej(e) : res(r); }); });
            var prefix = mimeDataUrl(dl.type, dl.buf);
            if (!prefix) throw new Error('未知图片类型 type=' + dl.type);
            var dataUrl = prefix + dl.buf.toString('base64');
            var up = await new Promise(function (res) {
                request(opts.target.replace(/\/$/, '') + '/api/upload', { method: 'POST', json: true, cookie: opts.cookie, body: { data: dataUrl } }, function (e, r) { res(r || {}); });
            });
            if (!up.json || !up.json.success || !up.json.url) throw new Error('上传失败 HTTP ' + up.status + ' ' + ((up.json && up.json.msg) || ''));
            imgMap[url] = opts.target.replace(/\/$/, '') + up.json.url;
            ok++;
            fs.writeFileSync(mapFile, JSON.stringify(imgMap, null, 2), 'utf8');
        } catch (e) { fail++; errs.push({ url: url, error: e.message }); console.warn('  [图失败] ' + url.slice(0, 80) + ' : ' + e.message); }
        if ((i + 1) % 20 === 0 || i === todo.length - 1) console.log('  图片 ' + (i + 1) + '/' + todo.length + ' (成功 ' + ok + ' / 失败 ' + fail + ')');
    }
    fs.writeFileSync(path.join(opts.out, 'image-errors.json'), JSON.stringify(errs, null, 2), 'utf8');
    console.log('  图片迁移完成: 成功 ' + ok + ' / 失败 ' + fail);
}

async function fetchSpaceDocs(opts) {
    var r = await new Promise(function (res) { request(opts.target.replace(/\/$/, '') + '/wiki/' + opts.space + '/tree.json', { json: true }, function (e, rr) { res(rr || {}); }); });
    var flat = [];
    (function walk(nodes) { (nodes || []).forEach(function (n) { flat.push(n); if (n.children) walk(n.children); }); })((r.json && r.json.tree) || []);
    return flat;
}
async function fetchSpaceId(opts) {
    var html = await new Promise(function (res) { request(opts.target.replace(/\/$/, '') + '/manager/wiki', { cookie: opts.cookie }, function (e, r) { res((r && r.text) || ''); }); });
    var m = html.match(/spaces:\s*(\[[\s\S]*?\])\s*,\s*pagesBySpace:/);
    if (!m) return '';
    var spaces = JSON.parse(m[1]);
    var t = spaces.filter(function (s) { return s.slug === opts.space; })[0];
    return t ? String(t._id) : '';
}

async function writePhase(opts, mapFile) {
    var imgMap = loadJson(mapFile, {});
    var stateFile = path.join(opts.out, 'images-written.json');
    var written = loadJson(stateFile, {});
    var mdDir = path.join(opts.out, 'md');
    var docs = fs.readdirSync(mdDir).filter(function (f) { return /\.md$/.test(f); });
    var spaceId = await fetchSpaceId(opts);
    var libDocs = await fetchSpaceDocs(opts);
    var byName = {};
    libDocs.forEach(function (n) { (byName[n.name] = byName[n.name] || []).push(n); });
    if (!spaceId) { console.error('[中止] 无法解析 spaceId'); process.exitCode = 2; return; }
    console.log('\n[回写正文] md 文件 ' + docs.length + ' 篇，已回写 ' + Object.keys(written).length + ' 篇');
    var ok = 0, fail = 0, skip = 0, errs = [];
    for (var i = 0; i < docs.length; i++) {
        var f = docs[i];
        var key = f;
        if (written[key]) { skip++; continue; }
        var md = fs.readFileSync(path.join(mdDir, f), 'utf8');
        var replaced = md;
        Object.keys(imgMap).forEach(function (u) { if (replaced.indexOf(u) !== -1) replaced = replaced.split(u).join(imgMap[u]); });
        if (replaced === md) { written[key] = { skipped: true, at: Date.now() }; skip++; fs.writeFileSync(stateFile, JSON.stringify(written, null, 2), 'utf8'); continue; }
        var tm = replaced.match(/^#\s+(.+)$/m);
        var title = tm ? tm[1].trim() : '';
        var lib = (byName[title] || [])[0];
        if (!lib) { fail++; errs.push({ file: f, error: '库内找不到同名文档: ' + title }); console.warn('  [失败] ' + f + ' 库内无同名文档'); continue; }
        await sleep(opts.writeDelay);
        var payload = {
            id: String(lib._id), name: lib.name, content: replaced, contentType: 'markdown',
            spaceId: spaceId, slug: lib.slug || '', parent: lib.parent || '', tags: (lib.tags || [])
        };
        var r = await new Promise(function (res) {
            request(opts.target.replace(/\/$/, '') + '/manager/wiki/doc/save', { method: 'POST', json: true, cookie: opts.cookie, body: payload }, function (e, rr) { res(rr || {}); });
        });
        if (r.json && r.json.success) { ok++; written[key] = { id: lib._id, at: Date.now() }; fs.writeFileSync(stateFile, JSON.stringify(written, null, 2), 'utf8'); }
        else { fail++; errs.push({ file: f, error: 'HTTP ' + r.status + ' ' + ((r.json && r.json.msg) || '') }); console.warn('  [失败] ' + f + ' HTTP ' + r.status); }
        if ((i + 1) % 20 === 0 || i === docs.length - 1) console.log('  回写 ' + (i + 1) + '/' + docs.length + ' (成功 ' + ok + ' / 跳过 ' + skip + ' / 失败 ' + fail + ')');
    }
    fs.writeFileSync(path.join(opts.out, 'write-errors.json'), JSON.stringify(errs, null, 2), 'utf8');
    console.log('  回写完成: 成功 ' + ok + ' / 跳过 ' + skip + ' / 失败 ' + fail);
}

(async function () {
    var opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log(['用法:', '  node scripts/migrate-images.js --dry-run                        # 只统计',
            "  node scripts/migrate-images.js --cookie '<Cookie>'             # 完整迁移",
            "  node scripts/migrate-images.js --cookie '<Cookie>' --only-download  # 只搬图",
            "  node scripts/migrate-images.js --cookie '<Cookie>' --only-write     # 只回写（图已搬完）"
        ].join('\n')); return;
    }
    var urls = collectUrls(opts.out);
    var byHost = {};
    urls.forEach(function (u) { var h = new URL(u).host; byHost[h] = (byHost[h] || 0) + 1; });
    console.log('=== 图片迁移 ===');
    console.log('待处理图片 ' + urls.length + ' 张:', JSON.stringify(byHost));
    var mapFile = path.join(opts.out, 'image-map.json');
    var existing = loadJson(mapFile, {});
    console.log('已搬运记录:', Object.keys(existing).length, '张');
    if (opts.dryRun) { console.log('\n[DRY-RUN] 未下载、未写库。执行请加 --cookie'); return; }
    if (!opts.cookie) { console.error('[错误] 需要 Cookie'); process.exitCode = 1; return; }
    try {
        if (!opts.onlyWrite) await downloadPhase(opts, urls, mapFile);
        if (!opts.onlyDownload) await writePhase(opts, mapFile);
        console.log('\n完成。');
    } catch (e) { console.error('[致命错误] ' + (e.stack || e)); process.exitCode = 1; }
})();
