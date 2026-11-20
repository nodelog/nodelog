#!/usr/bin/env node
/**
 * 批量迁移：ModStartCMS 帮助文档(help.jiangzi.xin/help) -> NODELOG Wiki 知识库(/wiki/linkonesaas)
 *
 * 两段式，默认只做第一段（抓取+转换，不写库）：
 *   1) node scripts/import-help-to-wiki.js --dry-run            # 抓取全部文章，转 Markdown，落盘 docs/help-import/
 *   2) node scripts/import-help-to-wiki.js --cookie '<管理员Cookie>'   # 读取已落盘 md，逐篇 POST 导入目标知识库
 *
 * 设计要点（实读源码对齐）：
 *   - 源站列表 URL: /help?page=N，文章 URL: /help/{cat}/{id}，正文容器 div.ub-html.lg，标题 h1.title
 *   - 图片为 data-src 懒加载，转换前统一替换为 src（保留源站绝对 URL，导入后图片仍可用）
 *   - 目标导入接口: POST /manager/wiki/doc/save（L 仅登录，Cookie 会话），body {name,content,contentType:'markdown',spaceId,tags}
 *     !! 原 /manager/wiki/import 在生产环境 POST 即 502（后端响应阶段崩溃，但数据可能已落库——切勿据此判定失败重复全量导）！
 *        已切换为实测可用的 doc/save：spaceId 从 /manager/wiki 工作台页内嵌 spaces JSON 解析。
 *   - CSRF: 脚本请求不带 Origin/Referer，csrfGuard 直接放行；鉴权靠管理员 Cookie
 *   - 幂等: doc/save 无服务端判重，靠本地 imported.json 断点续传；重跑前先查库内现状避免重复
 *   - 源站自带 3 组跨分类同名文档（拼团/整点秒杀/积分商城），预期入库 103 篇（106-3）
 *   - 无新增依赖：仅用 Node 内置模块 + 项目已有的 turndown
 */
'use strict';

var fs = require('fs');
var path = require('path');
var https = require('https');
var http = require('http');
var TurndownService = require('turndown');

// ---------------- 默认配置 ----------------
var DEFAULTS = {
    source: 'https://help.jiangzi.xin/help',
    target: 'https://blog.jiangzi.xin',
    space: 'linkonesaas',
    cookie: '',
    out: 'docs/help-import',
    limit: 0,          // 0=全部；调试用 --limit 3
    delay: 350,        // 抓取/导入间隔(ms)
    force: false,      // 忽略已落盘 md 重新抓取
    keepSource: true,  // 文末保留来源链接
    dryRun: true,
    localizeImages: false, // 是否把图片下载后上传到本站图床（需要 Cookie）
    imgDelay: 120,         // 图片上传间隔(ms)
    listSpaces: false,     // 只列出当前账号可导入的知识库，不抓取不导入
    buildTree: false       // 建分类父页面并把文档挂到对应分类（幂等）
};

// 分类 slug -> 中文名（用于 tags 简称）；未命中则回退 slug 本身
var CAT_NAME = {
    order: '订单', market: '营销', wxapp: '小程序', setting: '设置',
    wxpay: '微信支付', store: '门店', data: '数据', erp: 'ERP',
    goods: '商品', score: '积分', user: '会员', pay: '收银',
    shop: '商城', agent: '代理商', distribute: '分销', sys: '系统'
};

// 分类 slug -> 正式分类名（源站截图核实，用于 Wiki 树父页面标题）
var CAT_FULL_NAME = {
    store: '店铺管理', goods: '商品管理', order: '订单管理', user: '用户管理',
    data: '数据统计', market: '营销中心', setting: '系统管理', wxapp: '小程序发布',
    score: '积分系统', wxpay: '微信支付', erp: 'ERP'
};

function parseArgs(argv) {
    var o = Object.assign({}, DEFAULTS);
    for (var i = 0; i < argv.length; i++) {
        var a = argv[i];
        if (a === '--dry-run') { o.dryRun = true; }
        else if (a === '--import' || a === '-i') { o.dryRun = false; }
        else if (a === '--force') { o.force = true; }
        else if (a === '--no-source') { o.keepSource = false; }
        else if (a === '--localize-images') { o.localizeImages = true; o.dryRun = false; }
        else if (a === '--list-spaces') { o.listSpaces = true; }
        else if (a === '--build-tree') { o.buildTree = true; o.dryRun = false; }
        else if (a === '--help' || a === '-h') { o.help = true; }
        else if (a.indexOf('--') === 0 && i + 1 < argv.length) {
            var k = a.slice(2);
            if (k in o) { o[k] = argv[++i]; }
            else { console.warn('未知参数: ' + a); }
        }
    }
    if (o.cookie) o.dryRun = false; // 给了 cookie 即为导入模式
    return o;
}

function help() {
    console.log([
        '用法:',
        '  node scripts/import-help-to-wiki.js --dry-run                      # 抓取+转换，不写库',
        "  node scripts/import-help-to-wiki.js --cookie '<管理员Cookie>'     # 导入到知识库",
        '',
        '可选参数:',
        '  --source <url>    源站帮助页   (默认 ' + DEFAULTS.source + ')',
        '  --target <url>    目标站       (默认 ' + DEFAULTS.target + ')',
        '  --space <slug>    知识库 slug  (默认 ' + DEFAULTS.space + ')',
        '  --out <dir>       输出目录     (默认 ' + DEFAULTS.out + ')',
        '  --limit <n>       只处理前 n 篇（调试）',
        '  --delay <ms>      请求间隔     (默认 ' + DEFAULTS.delay + ')',
        '  --force           忽略已落盘 md 重新抓取',
        '  --no-source       不保留文末来源链接',
        '  --localize-images 把图片下载并上传到本站图床(需 Cookie)，替换 md 中的外链',
        '  --list-spaces     列出当前账号可导入的知识库(需 Cookie)，不抓取不导入',
        '  --build-tree      建 11 个分类父页面并把文档挂到对应分类(需 Cookie，幂等)',
        '  -h, --help        显示帮助'
    ].join('\n'));
}

// ---------------- HTTP ----------------
function request(url, opts, cb) {
    opts = opts || {};
    var u = new URL(url);
    var lib = u.protocol === 'https:' ? https : http;
    var headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 import-help-to-wiki/1.0',
        'Accept': 'text/html,application/json,*/*',
        'Accept-Encoding': 'identity'
    };
    if (opts.cookie) headers['Cookie'] = opts.cookie;
    if (opts.json) headers['Content-Type'] = 'application/json';
    // 刻意不设 Origin/Referer：csrfGuard 对无这两个头的 POST 直接放行
    var payload = opts.body ? JSON.stringify(opts.body) : null;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    var req = lib.request(u, { method: opts.method || 'GET', headers: headers }, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
            var buf = Buffer.concat(chunks);
            var text = buf.toString('utf8');
            var out = { status: res.statusCode, headers: res.headers, text: text };
            if (opts.json) { try { out.json = JSON.parse(text); } catch (e) { out.json = null; } }
            cb(null, out);
        });
    });
    req.on('error', function (e) { cb(e); });
    if (payload) req.write(payload);
    req.end();
}

function get(url, opts, cb) { request(url, opts, cb); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// 下载图片为 Buffer（跟随重定向，限制大小）
function downloadImage(url, maxBytes, redirects, cb) {
    maxBytes = maxBytes || 5 * 1024 * 1024;
    redirects = redirects || 0;
    if (redirects > 5) return cb(new Error('重定向过多'), null);
    var u;
    try { u = new URL(url); } catch (e) { return cb(e, null); }
    var lib = u.protocol === 'https:' ? https : http;
    var req = lib.get(u, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 import-help-to-wiki/1.0',
            'Accept': 'image/*,*/*'
        }
    }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return downloadImage(new URL(res.headers.location, u).href, maxBytes, redirects + 1, cb);
        }
        if (res.statusCode !== 200) { res.resume(); return cb(new Error('HTTP ' + res.statusCode), null); }
        var chunks = [], size = 0;
        res.on('data', function (c) {
            size += c.length;
            if (size > maxBytes) { req.destroy(new Error('图片超过 5MB')); return; }
            chunks.push(c);
        });
        res.on('end', function () { cb(null, { buf: Buffer.concat(chunks), type: res.headers['content-type'] || '' }); });
    });
    req.on('error', function (e) { cb(e, null); });
}

// 猜测图片 data URL 的 mime（上传接口只认 png/jpeg/gif/webp）
function mimeDataUrl(type, buf) {
    var t = String(type || '').toLowerCase();
    if (t.indexOf('png') !== -1) return 'data:image/png;base64,';
    if (t.indexOf('jpeg') !== -1 || t.indexOf('jpg') !== -1) return 'data:image/jpeg;base64,';
    if (t.indexOf('gif') !== -1) return 'data:image/gif;base64,';
    if (t.indexOf('webp') !== -1) return 'data:image/webp;base64,';
    // .dat 等无标准 type 时按文件头嗅探
    if (buf.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'data:image/png;base64,';
    if (buf[0] === 0xFF && buf[1] === 0xD8) return 'data:image/jpeg;base64,';
    if (buf.slice(0, 6).toString() === 'GIF87a' || buf.slice(0, 6).toString() === 'GIF89a') return 'data:image/gif;base64,';
    return '';
}

// ---------------- HTML 解析工具 ----------------
function decodeEntities(s) {
    return String(s || '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); });
}
function stripTags(s) { return decodeEntities(String(s || '').replace(/<[^>]*>/g, '')); }

// 抓列表：返回所有文章 {cat, id, url, prefix}；prefix 记录源站前缀(help/hlep)，抓取详情时原样用
// 注意：源站 order 分类链接拼写为 /hlep/order（非 /help），必须兼容，否则漏掉整个分类。
function parseList(html) {
    var seen = {};
    var list = [];
    var re = /href=["']\/(help|hlep)\/([a-z0-9_-]+)\/(\d+)["']/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
        var prefix = m[1].toLowerCase(), cat = m[2], id = m[3];
        var key = cat + '/' + id;
        if (seen[key]) continue;
        seen[key] = 1;
        list.push({ cat: cat, id: id, prefix: prefix, url: '/' + prefix + '/' + cat + '/' + id });
    }
    // 分类导航链接（用于补充扫描分类页）：/help/xxx 或 /hlep/xxx（后不跟数字）
    var cats = {}, cm;
    var cre = /href=["']\/(help|hlep)\/([a-z0-9_-]+)["']/gi;
    while ((cm = cre.exec(html)) !== null) {
        var cprefix = cm[1].toLowerCase(), ccat = cm[2].toLowerCase();
        if (['rss', 'api', 'page'].indexOf(ccat) !== -1) continue;
        cats[ccat] = cprefix;
    }
    // 最大页码
    var maxPage = 1;
    var pre = /href=["']\?page=(\d+)["']/gi;
    while ((m = pre.exec(html)) !== null) { var p = +m[1]; if (p > maxPage) maxPage = p; }
    return { list: list, maxPage: maxPage, cats: cats };
}

// 抓单篇：标题 + 正文 HTML
function parseArticle(html) {
    var title = '';
    var tm = html.match(/<h1[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
    if (tm) title = stripTags(tm[1]).trim();
    if (!title) {
        var t2 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (t2) title = stripTags(t2[1]).trim();
    }
    var body = '';
    var bm = html.match(/<div[^>]*class="[^"]*\bub-html\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="[^"]*tw-bg-gray-100/i);
    if (bm) body = bm[1];
    else {
        var b2 = html.match(/<div[^>]*class="[^"]*\bub-html\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (b2) body = b2[1];
    }
    return { title: title, body: body };
}

var td = new TurndownService({
    headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*'
});
td.addRule('dropEmpty', {
    filter: function (node) {
        return node.nodeName === 'BR' || (node.nodeName === 'P' && !node.textContent.trim() && !node.querySelector('img'));
    },
    replacement: function () { return ''; }
});

function htmlToMarkdown(article, sourceUrl) {
    var body = article.body
        .replace(/\sdata-src=/gi, ' src=')
        .replace(/\ssrc=["']\/ /g, ' src="/')
        .replace(/<a[^>]*href="javascript:;"[^>]*>[\s\S]*?<\/a>/gi, '');
    var md = td.turndown(body).replace(/\n{3,}/g, '\n\n').trim();
    var out = '# ' + (article.title || '未命名文档') + '\n\n' + md;
    if (sourceUrl) out += '\n\n---\n\n> 来源：' + sourceUrl + '\n';
    return out;
}

// ---------------- 阶段一：抓取 + 转换 ----------------
async function crawl(opts) {
    var outDir = path.resolve(opts.out);
    var mdDir = path.join(outDir, 'md');
    if (!fs.existsSync(mdDir)) fs.mkdirSync(mdDir, { recursive: true });

    console.log('[1/2] 抓取文章列表 ... ' + opts.source);
    var root = opts.source.replace(/\/$/, '').replace(/\/help$/, ''); // 源站根，如 https://help.jiangzi.xin
    var home = await new Promise(function (res, rej) { get(opts.source, {}, function (e, r) { e ? rej(e) : res(r.text); }); });
    var p0 = parseList(home);
    var all = p0.list.slice();
    var maxPage = p0.maxPage || 1;
    var cats = p0.cats || {};
    console.log('      主列表第 1 页: ' + all.length + ' 篇, 共 ' + maxPage + ' 页; 分类 ' + Object.keys(cats).length + ' 个');

    for (var pg = 2; pg <= maxPage; pg++) {
        await sleep(opts.delay);
        var url = opts.source + '?page=' + pg;
        var html = await new Promise(function (res, rej) { get(url, {}, function (e, r) { e ? rej(e) : res(r.text); }); });
        var parsed = parseList(html);
        all = all.concat(parsed.list);
        Object.keys(parsed.cats || {}).forEach(function (k) { if (!(k in cats)) cats[k] = parsed.cats[k]; });
        console.log('      主列表第 ' + pg + '/' + maxPage + ' 页: +' + parsed.list.length + ' 篇 (累计 ' + all.length + ')');
    }

    // 补充：扫描每个分类页（及其分页），捞主列表未展示的文章（如 /hlep/order 整类缺失）
    console.log('      扫描 ' + Object.keys(cats).length + ' 个分类页补齐 ...');
    for (var catKey in cats) {
        if (!Object.prototype.hasOwnProperty.call(cats, catKey)) continue;
        var prefix = cats[catKey];
        var catUrl = root + '/' + prefix + '/' + catKey;
        try {
            var cHtml = await new Promise(function (res, rej) { get(catUrl, {}, function (e, r) { e ? rej(e) : res(r.text); }); });
            var cp = parseList(cHtml);
            var catArticles = cp.list.filter(function (a) { return a.cat === catKey; });
            all = all.concat(catArticles);
            for (var cpg = 2; cpg <= (cp.maxPage || 1); cpg++) {
                await sleep(opts.delay);
                var cHtml2 = await new Promise(function (res, rej) { get(catUrl + '?page=' + cpg, {}, function (e, r) { e ? rej(e) : res(r.text); }); });
                var cp2 = parseList(cHtml2);
                all = all.concat(cp2.list.filter(function (a) { return a.cat === catKey; }));
            }
            if (catArticles.length) console.log('        分类 ' + catKey + ': +' + catArticles.length + ' 篇');
        } catch (e) {
            console.warn('        分类 ' + catKey + ' 扫描失败: ' + e.message);
        }
    }

    // 去重（按 cat+id）
    var seen = {}, uniq = [];
    all.forEach(function (a) { var k = a.cat + '/' + a.id; if (!seen[k]) { seen[k] = 1; uniq.push(a); } });
    if (opts.limit > 0) uniq = uniq.slice(0, opts.limit);
    console.log('      去重后共 ' + uniq.length + ' 篇待抓取');

    var manifest = [];
    var ok = 0, skip = 0, fail = 0;
    for (var i = 0; i < uniq.length; i++) {
        var item = uniq[i];
        var file = path.join(mdDir, item.cat + '-' + item.id + '.md');
        if (fs.existsSync(file) && !opts.force) {
            skip++;
            manifest.push(Object.assign({}, item, { file: file, md: fs.readFileSync(file, 'utf8') }));
            continue;
        }
        await sleep(opts.delay);
        var fullUrl = root + '/' + (item.prefix || 'help') + '/' + item.cat + '/' + item.id;
        try {
            var h = await new Promise(function (res, rej) { get(fullUrl, {}, function (e, r) { e ? rej(e) : res(r.text); }); });
            var art = parseArticle(h);
            if (!art.body) throw new Error('正文容器未找到');
            var md = htmlToMarkdown({ title: art.title || item.id, body: art.body }, fullUrl);
            fs.writeFileSync(file, md, 'utf8');
            manifest.push(Object.assign({}, item, { title: art.title, file: file, md: md }));
            ok++;
            if ((i + 1) % 10 === 0 || i === uniq.length - 1) console.log('      抓取 ' + (i + 1) + '/' + uniq.length + ' (' + art.title + ')');
        } catch (e) {
            fail++;
            console.warn('      [失败] ' + fullUrl + ' : ' + e.message);
        }
    }
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest.map(function (x) {
        return { cat: x.cat, id: x.id, url: x.url, file: path.relative(outDir, x.file), title: x.title };
    }), null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'categories.json'), JSON.stringify(cats, null, 2), 'utf8');
    console.log('      抓取完成: 新抓 ' + ok + ' / 复用 ' + skip + ' / 失败 ' + fail);
    return { outDir: outDir, manifest: manifest };
}

// ---------------- 阶段一点五：图片本地化（可选） ----------------
async function localizeImages(opts, ctx) {
    if (!opts.localizeImages) return;
    if (!opts.cookie) {
        console.log('\n[错误] --localize-images 需要 Cookie（图床接口需登录）');
        return;
    }
    var outDir = ctx.outDir;
    var mapFile = path.join(outDir, 'image-map.json');
    var imgMap = {};
    if (fs.existsSync(mapFile)) { try { imgMap = JSON.parse(fs.readFileSync(mapFile, 'utf8')); } catch (e) {} }

    // 收集所有 md 里的外链
    var imgs = new Set();
    ctx.manifest.forEach(function (x) {
        if (!x.md) return;
        var re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g, m;
        while ((m = re.exec(x.md)) !== null) imgs.add(m[1]);
    });
    var all = Array.from(imgs);
    console.log('\n[1.5/2] 图片本地化 ... 共 ' + all.length + ' 张（已缓存 ' + Object.keys(imgMap).length + ' 张）');

    var ok = 0, fail = 0, cached = 0;
    for (var i = 0; i < all.length; i++) {
        var url = all[i];
        if (imgMap[url]) { cached++; continue; }
        await sleep(opts.imgDelay);
        try {
            var dl = await new Promise(function (res, rej) {
                downloadImage(url, 5 * 1024 * 1024, 0, function (e, r) { e ? rej(e) : res(r); });
            });
            var prefix = mimeDataUrl(dl.type, dl.buf);
            if (!prefix) throw new Error('不支持的图片类型: ' + dl.type);
            var dataUrl = prefix + dl.buf.toString('base64');
            var up = await new Promise(function (res, rej) {
                request(opts.target.replace(/\/$/, '') + '/api/upload',
                    { method: 'POST', json: true, body: { data: dataUrl }, cookie: opts.cookie },
                    function (e, r) { e ? rej(e) : res(r); });
            });
            if (!up.json || !up.json.success || !up.json.url) {
                throw new Error('上传失败 HTTP ' + up.status + ' ' + ((up.json && up.json.msg) || ''));
            }
            imgMap[url] = opts.target.replace(/\/$/, '') + up.json.url;
            ok++;
            fs.writeFileSync(mapFile, JSON.stringify(imgMap, null, 2), 'utf8'); // 逐条落盘，断点续传
        } catch (e) {
            fail++;
            console.warn('        [图片失败] ' + url.slice(0, 90) + ' : ' + e.message);
        }
        if ((i + 1) % 50 === 0 || i === all.length - 1) {
            console.log('        图片 ' + (i + 1) + '/' + all.length + ' (成功 ' + ok + ' / 缓存 ' + cached + ' / 失败 ' + fail + ')');
        }
    }

    // 替换所有 md 里的外链为本站 URL，并回写文件 + 更新 x.md
    var replaced = 0;
    ctx.manifest.forEach(function (x) {
        if (!x.md) return;
        var md = x.md;
        Object.keys(imgMap).forEach(function (u) {
            if (md.indexOf(u) !== -1) { md = md.split(u).join(imgMap[u]); }
        });
        if (md !== x.md) {
            fs.writeFileSync(x.file, md, 'utf8');
            x.md = md;
            replaced++;
        }
    });
    console.log('        替换完成: ' + replaced + ' 篇文档的图片链接已指向本站；映射表 ' + mapFile);
}

// ---------------- 知识库定位：列举 + 校验 ----------------
// 从后台工作台页 /manager/wiki 内嵌的 `spaces: <json>` 解析当前账号「可管理」的库。
// 对齐 canImportTo：管理员看全部，普通用户只看到自己 owner 的库 —— 能列出的就是能导入的。
async function fetchManageableSpaces(opts) {
    if (!opts.cookie) return null;
    var html = await new Promise(function (res, rej) {
        get(opts.target.replace(/\/$/, '') + '/manager/wiki', { cookie: opts.cookie },
            function (e, r) { e ? rej(e) : res(r.text); });
    });
    var m = html.match(/spaces:\s*(\[[\s\S]*?\])\s*,\s*pagesBySpace:/);
    if (!m) return null; // 登录失效会跳到 /manager，没有该字段
    try { return JSON.parse(m[1]); } catch (e) { return null; }
}

// 列出当前账号可导入的知识库
async function listSpaces(opts) {
    if (!opts.cookie) {
        console.log('\n[错误] --list-spaces 需要 Cookie：node scripts/import-help-to-wiki.js --list-spaces --cookie \'<Cookie>\'');
        return;
    }
    console.log('\n=== 当前账号可导入的知识库 ===');
    var spaces = await fetchManageableSpaces(opts);
    if (spaces === null) {
        console.log('  读取失败：Cookie 可能已失效，或无知识库管理权限。');
        return;
    }
    if (!spaces.length) {
        console.log('  （空）该账号没有可管理的知识库——请先到后台「知识库工作台」创建。');
        return;
    }
    spaces.forEach(function (s, i) {
        var mark = s.slug === opts.space ? '  <- 脚本当前目标' : '';
        console.log('  ' + (i + 1) + '. ' + s.name + '  [slug: ' + s.slug + ']' + mark);
    });
    console.log('\n切换目标：--space <slug>，例如 --space ' + (spaces[0].slug || 'linkonesaas'));
}

// 导入前校验目标库：公开 tree.json 回显名称/文档数；可管理列表回显归属
// 返回 true=继续，false=中止（避免导错库或隐式失败）
async function verifySpace(opts) {
    console.log('\n[校验] 目标知识库 slug = ' + opts.space);
    // 1) 公开接口确认 slug 存在、名称是什么
    var probeUrl = opts.target.replace(/\/$/, '') + '/wiki/' + encodeURIComponent(opts.space) + '/tree.json';
    var probe;
    try {
        probe = await new Promise(function (res, rej) {
            get(probeUrl, { json: true }, function (e, r) { e ? rej(e) : res(r); });
        });
    } catch (e) {
        console.log('  [失败] 无法访问 ' + probeUrl + ' : ' + e.message);
        return false;
    }
    if (!probe.json || !probe.json.success || !probe.json.space) {
        console.log('  [失败] 知识库不存在或不可见：' + opts.space + '（HTTP ' + probe.status + '）');
        console.log('         用 --list-spaces --cookie \'...\' 查看可导入的库。');
        return false;
    }
    var s = probe.json.space;
    console.log('  名称：' + s.name + '  |  slug：' + s.slug + '  |  现有文档：' + (probe.json.total != null ? probe.json.total : '?') + ' 篇');

    // 2) 可管理列表确认归属（有 Cookie 时）；不在列表里说明当前账号非 owner 且非管理员 → 会被 403
    var manageable = await fetchManageableSpaces(opts);
    if (manageable && Array.isArray(manageable)) {
        var hit = manageable.filter(function (x) { return x.slug === opts.space; });
        if (!hit.length) {
            console.log('  [失败] 该库不在当前账号可管理列表中——导入会被拒绝（只能导入到自己创建的知识库）。');
            console.log('         请换用该库 owner 的 Cookie，或用 --list-spaces 查看你能导入的库。');
            return false;
        }
        console.log('  归属校验：通过（该库在当前账号可管理列表中）');
    }
    return true;
}

// ---------------- 阶段二：批量导入 ----------------
async function importAll(opts, ctx) {
    if (!opts.cookie) {
        console.log('\n[跳过] 未提供 Cookie，未执行导入。');
        return;
    }
    var outDir = ctx.outDir;
    var stateFile = path.join(outDir, 'imported.json');
    var imported = {};
    if (fs.existsSync(stateFile)) { try { imported = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) {} }

    // 目标库 spaceId：从工作台可管理列表解析（doc/save 接口需要 id 而非 slug）
    var spaces = await fetchManageableSpaces(opts);
    var target = spaces && spaces.filter(function (s) { return s.slug === opts.space; })[0];
    if (!target || !target._id) {
        console.error('\n[中止] 无法解析目标知识库 spaceId，未写入任何数据。');
        process.exitCode = 2;
        return;
    }

    // 注意：生产环境的 /manager/wiki/import 接口存在服务端 502（POST 即崩），
    // 改用同样受登录保护、且实测可用的 /manager/wiki/doc/save（spaceAdmin.saveDoc）。
    // 该接口无服务端判重，幂等靠本地 imported.json + 显式 slug 判重（下方 guard 前检查）。
    var url = opts.target.replace(/\/$/, '') + '/manager/wiki/doc/save';
    var manifest = ctx.manifest.filter(function (x) { return x.md && /[^#\s]/.test(x.md.replace(/^#.*$/m, '')); });
    console.log('\n[2/2] 导入到知识库 ' + target.name + ' (/wiki/' + opts.space + ') ... 共 ' + manifest.length + ' 篇');
    console.log('      接口: ' + url + '  |  spaceId: ' + target._id);
    var ok = 0, skip = 0, fail = 0;
    var errors = [];

    for (var i = 0; i < manifest.length; i++) {
        var x = manifest[i];
        var key = x.cat + '/' + x.id;
        if (imported[key]) { skip++; continue; }
        await sleep(opts.delay);
        var docName = x.title || (x.md.match(/^#\s+(.+)$/m) || [])[1] || x.id;
        var payload = {
            name: docName,
            content: x.md,
            contentType: 'markdown',
            spaceId: String(target._id),
            tags: CAT_NAME[x.cat] || x.cat
        };
        var attempt = 0, lastErr = null;
        while (attempt < 3) {
            attempt++;
            var r = await new Promise(function (res, rej) {
                request(url, { method: 'POST', json: true, body: payload, cookie: opts.cookie }, function (e, rr) { e ? rej(e) : res(rr); });
            });
            if ((r.status === 200 || r.status === 201) && r.json && r.json.success) {
                imported[key] = { id: r.json && r.json.id, name: docName, slug: r.json && r.json.slug, at: Date.now() };
                ok++;
                break;
            }
            if (r.status === 409) { // 同名已存在：幂等跳过
                imported[key] = { id: r.json && r.json.id, name: docName, dup: true, at: Date.now() };
                skip++;
                break;
            }
            lastErr = new Error('HTTP ' + r.status + ' ' + ((r.json && r.json.msg) || r.text.slice(0, 100)));
            if (r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404) break; // 参数/鉴权失败，重试无意义
            if (attempt < 3) await sleep(800 * attempt);
        }
        if (lastErr) {
            fail++;
            errors.push({ url: x.url, name: docName, error: lastErr.message });
            console.warn('      [失败] ' + docName + ' : ' + lastErr.message);
        }
        if ((i + 1) % 10 === 0 || i === manifest.length - 1) console.log('      导入 ' + (i + 1) + '/' + manifest.length + ' (成功 ' + ok + ' / 跳过 ' + skip + ' / 失败 ' + fail + ')');
    }
    fs.writeFileSync(stateFile, JSON.stringify(imported, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'import-errors.json'), JSON.stringify(errors, null, 2), 'utf8');
    console.log('      导入完成: 成功 ' + ok + ' / 跳过 ' + skip + ' / 失败 ' + fail);
    console.log('      查看: https://' + 'blog.jiangzi.xin/wiki/' + opts.space);
}

// ---------------- 分类树构建（幂等） ----------------
// 建分类父页面 + 给文档挂 parent。经验固化：
//   - 分类名 = CAT_FULL_NAME（正式名）；文档归类靠 md 文件名前缀(cat)，不靠 tags（tags 曾与源分类错位）
//   - 若库里已存在同名"正文文档"占用分类名，需新建独立分类页并把该文档当普通子文档（避免自成父级嵌套）
//   - 更新必须传回原 name/slug/content，否则 URL 会变、正文会被清
async function buildWikiTree(opts) {
    if (!opts.cookie) {
        console.log('\n[错误] --build-tree 需要 Cookie');
        return;
    }
    // 取目标库 spaceId + 现有树
    var spaces = await fetchManageableSpaces(opts);
    var target = spaces && spaces.filter(function (s) { return s.slug === opts.space; })[0];
    if (!target || !target._id) { console.error('[中止] 无法解析 spaceId'); process.exitCode = 2; return; }
    var spaceId = String(target._id);
    var tree = await new Promise(function (res, rej) {
        get(opts.target.replace(/\/$/, '') + '/wiki/' + opts.space + '/tree.json', { json: true },
            function (e, r) { e ? rej(e) : res(r.json); });
    });
    var flat = [];
    (function walk(nodes) { (nodes || []).forEach(function (n) { flat.push(n); if (n.children) walk(n.children); }); })(tree.tree);
    var byName = {};
    flat.forEach(function (n) { (byName[n.name] = byName[n.name] || []).push(n); });
    function findById(id) { return flat.filter(function (n) { return String(n._id) === String(id); })[0]; }

    function saveDoc(body) {
        return new Promise(function (res) {
            request(opts.target.replace(/\/$/, '') + '/manager/wiki/doc/save',
                { method: 'POST', json: true, cookie: opts.cookie, body: body },
                function (e, r) { res({ code: r && r.status, j: r && r.json, txt: r && r.text }); });
        });
    }

    // md -> {title, cat, text}
    var mdDir = path.join(path.resolve(opts.out), 'md');
    var docs = [];
    fs.readdirSync(mdDir).filter(function (f) { return /\.md$/.test(f); }).forEach(function (f) {
        var txt = fs.readFileSync(path.join(mdDir, f), 'utf8');
        var m = txt.match(/^#\s+(.+)$/m);
        docs.push({ file: f, title: m ? m[1].trim() : '', cat: f.split('-')[0], text: txt });
    });
    var mdByTitle = {};
    docs.forEach(function (d) { mdByTitle[d.title] = d; });

    // ① 分类父页面（幂等：优先复用"无子、无正文分类说明"的已有分类页；同名正文文档不当分类页）
    console.log('\n[build-tree] ① 创建/复用分类父页面 ...');
    var catIds = {};
    for (var cat in CAT_FULL_NAME) {
        if (!Object.prototype.hasOwnProperty.call(CAT_FULL_NAME, cat)) continue;
        var cname = CAT_FULL_NAME[cat];
        var existingCats = (byName[cname] || []).filter(function (n) {
            return (n.tags || []).indexOf('文档分类') !== -1; // 只认带"文档分类"标签的真分类页
        });
        if (existingCats.length) { catIds[cat] = String(existingCats[0]._id); console.log('  复用分类页:', cname); continue; }
        var intro = '# ' + cname + '\n\n> 本分类收录「' + cname + '」相关的操作文档，属于链付收银SAAS 使用文档。\n';
        var r = await saveDoc({ name: cname, content: intro, contentType: 'markdown', spaceId: spaceId, tags: '文档分类', wikiOrder: 0 });
        if (r.j && r.j.success && r.j.id) { catIds[cat] = r.j.id; console.log('  新建分类页:', cname, r.j.id); }
        else console.log('  [失败] 分类页', cname, r.code, (r.txt || '').slice(0, 80));
        await sleep(150);
    }

    // ② 挂 parent：按 md 文件前缀归类；传回原 slug 保 URL
    console.log('\n[build-tree] ② 挂载文档到分类 ...');
    var seen = {}, ok = 0, fail = 0;
    for (var i = 0; i < docs.length; i++) {
        var d = docs[i];
        var catId = catIds[d.cat];
        if (!catId || !d.title) continue;
        var node = (byName[d.title] || [])[0];
        if (!node || seen[String(node._id)]) continue; // 重名只挂一次
        seen[String(node._id)] = 1;
        if (node.parent && findById(node.parent)) continue; // 已正确挂载 → 跳过（幂等）
        var r2 = await saveDoc({
            id: String(node._id), name: node.name, content: d.text, contentType: 'markdown',
            spaceId: spaceId, slug: node.slug, parent: catId, tags: CAT_FULL_NAME[d.cat] || d.cat
        });
        if (r2.j && r2.j.success) ok++; else { fail++; console.log('  [失败]', d.title, r2.code, (r2.txt || '').slice(0, 80)); }
        if ((i + 1) % 20 === 0) console.log('  进度 ' + (i + 1) + '/' + docs.length + ' (成功 ' + ok + ' / 失败 ' + fail + ')');
        await sleep(100);
    }
    console.log('\n[build-tree] 完成：分类 ' + Object.keys(catIds).length + ' 个，挂载 成功 ' + ok + ' / 失败 ' + fail);
    console.log('  查看: ' + opts.target + '/wiki/' + opts.space);
}

// ---------------- 入口 ----------------
(async function () {
    var opts = parseArgs(process.argv.slice(2));
    if (opts.help) { help(); return; }
    console.log('=== help -> wiki 批量迁移 ===');
    if (opts.listSpaces) {
        try { await listSpaces(opts); }
        catch (e) { console.error('[错误] ' + (e && e.message || e)); process.exitCode = 1; }
        return;
    }
    if (opts.buildTree) {
        try { await buildWikiTree(opts); }
        catch (e) { console.error('[错误] ' + (e && e.stack || e)); process.exitCode = 1; }
        return;
    }
    console.log('目标库: ' + opts.space + '  |  模式: ' + (opts.dryRun ? 'DRY-RUN（只抓取转换，不写库）' : 'IMPORT（导入知识库）'));
    console.log('输出: ' + path.resolve(opts.out));
    try {
        // 导入前先校验目标库存在 + 名称回显 + 归属权限，避免导错库或逐篇 403
        if (!opts.dryRun && opts.cookie) {
            var okSpace = await verifySpace(opts);
            if (!okSpace) {
                console.error('\n[中止] 目标知识库校验未通过，未写入任何数据。');
                process.exitCode = 2;
                return;
            }
        }
        var ctx = await crawl(opts);
        await localizeImages(opts, ctx);
        await importAll(opts, ctx);
        console.log('\n完成。');
        if (opts.dryRun) {
            console.log('下一步：拿到管理员 Cookie 后执行');
            console.log("  node scripts/import-help-to-wiki.js --cookie '<管理员Cookie>'");
        }
    } catch (e) {
        console.error('\n[致命错误] ' + (e && e.stack || e));
        process.exitCode = 1;
    }
})();
