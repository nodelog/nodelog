#!/usr/bin/env node
/**
 * 站点更新公告自动发布 CLI —— 服务端 /api/announcements 的调用方。
 *
 * 用法：
 *   node scripts/announce-release.js --head                # 处理最新一次 commit（post-commit hook 默认）
 *   node scripts/announce-release.js --backfill            # 补发全部历史「新功能 + 优化升级」commit
 *   node scripts/announce-release.js --backfill --dry-run  # 只列出将补发的公告，不写库
 *   node scripts/announce-release.js --backfill --scope=optimization   # 只补发优化类
 *   node scripts/announce-release.js --backfill --scope=feature        # 只补发新功能（旧行为）
 *   node scripts/announce-release.js --head --base=http://127.0.0.1:3000
 *
 * Token 读取顺序（与文章发布 API 保持同一套配置习惯）：
 *   命令行 --token > 环境变量 > settings.js 的 announcementApi.tokens > settings.js 的 articleApi.tokens。
 *   因此本机/服务器只要已有 settings.js 的 articleApi 配置即可开箱运行，无需新增环境变量；
 *   CI 上没有 settings.js（已 gitignore），用 Secret ANNOUNCE_API_TOKEN 注入。
 *   其余可用环境变量：ANNOUNCE_API_BASE（默认 https://blog.jiangzi.xin）、ANNOUNCE_REPO_URL。
 *
 * 设计要点：
 *   - 新功能/优化判定与公告文案生成全部复用 services/releaseNote.js，与服务端零分叉。
 *   - 幂等由服务端 commitHash 保证；重复/并发触发都只会有一条公告。
 *   - 网络失败 / 生产尚未部署新接口(404) 时把 payload 落到 .announce-queue/，
 *     下次任意一次运行（含 hook / CI）自动重试，提交永不丢失，且绝不阻塞 git commit。
 *   - 零第三方依赖，只使用 Node 内置模块。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');
var cp = require('child_process');
var note = require('../services/releaseNote');

var ROOT = path.resolve(__dirname, '..');
var QUEUE_DIR = path.join(ROOT, '.announce-queue');
var DEFAULT_BASE = 'https://blog.jiangzi.xin';
var REQUEST_TIMEOUT_MS = 8000;

var opt = {
    mode: 'head',
    dryRun: false,
    quiet: false,
    since: '',
    limit: 0,
    pattern: null,
    base: '',
    token: '',
    repoUrl: '',
    queue: true,
    csv: '',
    scope: 'update'   // update(默认)=新功能+优化 | feature=仅新功能 | optimization=仅优化
};

function parseArgs(argv) {
    argv.forEach(function (a) {
        if (a === '--head') opt.mode = 'head';
        else if (a === '--backfill') opt.mode = 'backfill';
        else if (a === '--dry-run') opt.dryRun = true;
        else if (a === '--quiet') opt.quiet = true;
        else if (a === '--no-queue') opt.queue = false;
        else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
        else if (a.indexOf('--since=') === 0) opt.since = a.slice(8);
        else if (a.indexOf('--limit=') === 0) opt.limit = parseInt(a.slice(8), 10) || 0;
        else if (a.indexOf('--base=') === 0) opt.base = a.slice(7);
        else if (a.indexOf('--token=') === 0) opt.token = a.slice(8);
        else if (a.indexOf('--repo-url=') === 0) opt.repoUrl = a.slice(11);
        else if (a.indexOf('--csv=') === 0) opt.csv = a.slice(6);
        else if (a.indexOf('--scope=') === 0) {
            var sc = a.slice(8);
            if (['update', 'feature', 'optimization'].indexOf(sc) === -1) {
                fail('--scope 只支持 update / feature / optimization');
            }
            opt.scope = sc;
        }
        else if (a.indexOf('--pattern=') === 0) {
            try { opt.pattern = new RegExp(a.slice(10), 'i'); }
            catch (e) { fail('--pattern 不是合法正则：' + e.message); }
        } else {
            fail('未知参数：' + a);
        }
    });
}

function printHelp() {
    console.log([
        '站点更新公告自动发布 / 历史补发（默认：新功能 + 优化升级）',
        '  --head              仅处理 HEAD（默认，供 post-commit hook 使用）',
        '  --backfill          按时间正序补发全部历史提交',
        '  --scope=update     新功能 + 优化升级（默认）',
        '  --scope=feature    仅新功能（feat/新增，兼容旧行为）',
        '  --scope=optimization  仅优化升级（重构/样式体验/中文优化关键词）',
        '  --dry-run           只打印清单，不调用接口',
        '  --since=YYYY-MM-DD 只处理该日期之后的提交',
        '  --limit=N           最多处理 N 条提交',
        '  --pattern=REGEX     额外的自定义匹配规则',
        '  --base=URL          站点地址（默认 ' + DEFAULT_BASE + '）',
        '  --token=TOKEN       API Token',
        '  --repo-url=URL      代码仓库地址（用于公告里的变更链接）',
        '  --csv=FILE          导出后台批量导入格式的 CSV（无需部署新接口即可补发）',
        '  --no-queue          禁用失败排队重试',
        '  --quiet             精简输出'
    ].join('\n'));
}

function log(msg, force) {
    if (!opt.quiet || force) console.log(msg);
}
function fail(msg) {
    console.error('[announce] ' + msg);
    process.exit(1);
}

function git(args) {
    var r = cp.spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (r.status !== 0) throw new Error('git 命令失败：' + (r.stderr || '').trim().slice(0, 200));
    return r.stdout || '';
}

function repoUrl() {
    if (opt.repoUrl) return opt.repoUrl;
    var fromEnv = process.env.ANNOUNCE_REPO_URL;
    var raw = fromEnv;
    if (!raw) {
        try { raw = git(['remote', 'get-url', 'origin']).trim().split(/\r?\n/)[0]; } catch (e) { raw = ''; }
    }
    raw = String(raw || '').trim();
    var ssh = /^git@([^:]+):(.+)$/.exec(raw);
    if (ssh) return 'https://' + ssh[1] + '/' + ssh[2];
    return raw;
}

function firstToken(list) {
    if (!Array.isArray(list)) return '';
    for (var i = 0; i < list.length; i++) {
        if (list[i] && typeof list[i].token === 'string' && list[i].token.trim()) {
            return list[i].token.trim();
        }
    }
    return '';
}

function token() {
    var fromEnv = opt.token ||
        String(process.env.ANNOUNCE_API_TOKEN || '').trim() ||
        String(process.env.ANNOUNCEMENT_API_TOKENS || '').split(',')[0].trim() ||
        String(process.env.ARTICLE_API_TOKENS || '').split(',')[0].trim();
    if (fromEnv) return fromEnv;

    // 与文章发布 API 同一套配置：直接复用 settings.js 里的 articleApi.tokens。
    // settings.js 被 gitignore，CI 上不存在，此时 catch 后由环境变量/Secret 兜底。
    try {
        var s = require('../settings');
        return firstToken(s && s.announcementApi && s.announcementApi.tokens) ||
            firstToken(s && s.articleApi && s.articleApi.tokens);
    } catch (e) {
        return '';
    }
}

function base() {
    return (opt.base || String(process.env.ANNOUNCE_API_BASE || '').trim() || DEFAULT_BASE)
        .replace(/\/+$/, '');
}

function collectCommits() {
    var args = ['log', '--format=' + note.GIT_FORMAT];
    if (opt.mode === 'head') {
        args.push('-1');
    } else {
        args.push('--reverse');
        if (opt.since) args.push('--since=' + opt.since);
        if (opt.limit > 0) args.push('--max-count=' + opt.limit);
    }
    return note.parseGitLog(git(args));
}

function buildPayload(c) {
    // --pattern 匹配到的非标准写法，在本地先规范化成 feat: 前缀再提交，
    // 保证服务端（只认标准规则）能生成同样的公告，避免 400。
    var subject = c.subject;
    if (!note.featureOf(subject) && note.featureOf(subject, opt.pattern)) {
        subject = 'feat: ' + subject;
    }
    return {
        commit: c.commit,
        subject: subject,
        body: c.body,
        author: c.author,
        date: c.date,
        repoUrl: repoUrl()
    };
}

// ---------- 失败队列：接口不可用 / 未部署时不丢提交 ----------
function queuePath(hash) { return path.join(QUEUE_DIR, hash.slice(0, 12) + '.json'); }
function enqueue(payload, reason) {
    if (!opt.queue) return;
    try {
        fs.mkdirSync(QUEUE_DIR, { recursive: true });
        var file = queuePath(payload.commit);
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
            log('  ↳ 已排队待重试（' + reason + '）：' + path.basename(file), true);
        }
    } catch (e) {
        log('  ↳ 排队失败：' + e.message, true);
    }
}
function dequeue(hash) {
    if (!opt.queue) return;   // --no-queue 时既不写队列，也不动已有队列
    try {
        var f = queuePath(hash);
        if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch (e) { /* 清理失败不影响主流程 */ }
}
function readQueue() {
    if (!fs.existsSync(QUEUE_DIR)) return [];
    var out = [];
    fs.readdirSync(QUEUE_DIR).filter(function (f) { return /\.json$/.test(f); }).forEach(function (f) {
        try {
            var p = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, f), 'utf8'));
            if (p && /^[0-9a-f]{7,40}$/i.test(String(p.commit || ''))) out.push(p);
        } catch (e) { /* 损坏的队列文件跳过 */ }
    });
    return out;
}

// 后台 /manager/log 的 CSV 批量导入格式：表头 name,content,status（见 controllers/logAdmin.js）。
// 用于「生产还没部署新接口」时先手工补发；服务端 name 查重保证之后 API 不会重复发同一条。
function writeCsv(payloads) {
    function cell(v) {
        return '"' + String(v == null ? '' : v).replace(/\r?\n/g, ' ').replace(/"/g, '""') + '"';
    }
    var lines = [['name', 'content', 'status'].map(cell).join(',')];
    payloads.forEach(function (p) {
        var built = note.buildAnnouncement(p);
        if (!built) return;
        lines.push([built.name, note.buildPlainText(p), 0].map(cell).join(','));
    });
    var out = path.resolve(opt.csv);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, '\ufeff' + lines.join('\r\n') + '\r\n', 'utf8');
    log('[announce] 已导出 ' + (lines.length - 1) + ' 条后台导入 CSV：' + out, true);
}

// ---------- HTTP ----------
function post(payload, tok) {
    return new Promise(function (resolve) {
        var url;
        try { url = new URL('/api/announcements', base()); }
        catch (e) { return resolve({ err: '站点地址非法：' + base() }); }
        var mod = url.protocol === 'https:' ? https : http;
        var data = Buffer.from(JSON.stringify(payload), 'utf8');
        var req = mod.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': data.length,
                'Authorization': 'Bearer ' + tok
            },
            // hook 场景尽量少占用 commit 时间；补发场景可稍长
            timeout: opt.mode === 'head' ? 3000 : REQUEST_TIMEOUT_MS
        }, function (res) {
            var buf = '';
            res.setEncoding('utf8');
            res.on('data', function (c) { buf += c; });
            res.on('end', function () {
                var body = {};
                try { body = JSON.parse(buf); } catch (e) { /* 非 JSON 响应按状态码处理 */ }
                resolve({ status: res.statusCode, body: body });
            });
        });
        req.on('timeout', function () { req.destroy(new Error('请求超时')); });
        req.on('error', function (e) { resolve({ err: e.message }); });
        req.write(data);
        req.end();
    });
}

async function main() {
    parseArgs(process.argv.slice(2));

    var commits = collectCommits();
    // 清单类输出只看 git 历史；失败队列是运行时待重试数据，不混入补发清单
    var queued = (opt.csv || opt.dryRun || !opt.queue) ? [] : readQueue();
    var seen = {};
    var payloads = [];
    var skipped = 0;
    var counts = { feature: 0, optimization: 0 };

    commits.forEach(function (c) {
        var info = note.classify(c.subject, opt.pattern);
        if (!info || (opt.scope === 'feature' && info.kind !== 'feature') ||
            (opt.scope === 'optimization' && info.kind !== 'optimization')) {
            skipped++;
            return;
        }
        counts[info.kind]++;
        seen[c.commit] = true;
        payloads.push(buildPayload(c));
    });
    queued.forEach(function (p) {
        if (seen[p.commit]) return;
        seen[p.commit] = true;
        var q = note.classify(p.subject, opt.pattern);
        if (q) counts[q.kind]++;
        payloads.push(p);
    });

    var countsText = '新功能 ' + counts.feature + ' / 优化升级 ' + counts.optimization;
    if (!payloads.length) {
        log('[announce] 没有需要发布的提交' + (skipped ? '（跳过 ' + skipped + ' 条）' : ''));
        return;
    }

    // CSV 是纯本地产物，不需要 token / 不调用接口，导出后即结束
    if (opt.csv) { writeCsv(payloads); return; }

    var tok = token();
    if (opt.dryRun) {
        log('[announce] dry-run：共 ' + payloads.length + ' 条（' + countsText +
            '；跳过 ' + skipped + ' 条）\n', true);
        payloads.forEach(function (p, i) {
            var built = note.buildAnnouncement(p);
            log((i + 1) + '. ' + (built ? built.name : p.subject) + '  [' + String(p.commit).slice(0, 7) + '  ' + p.date + ']', true);
        });
        log('\n[dry-run] 未调用接口、未写库。去掉 --dry-run 即会实际发布。', true);
        return;
    }
    if (!tok) {
        if (opt.mode === 'head') {
            // hook 场景：不报错、不影响 commit，落队列等配置完成后自动补发
            payloads.forEach(function (p) { enqueue(p, '缺少 ANNOUNCE_API_TOKEN'); });
            log('[announce] 未配置 API Token，本次提交已排队；配置后执行 --backfill 即可补发。', true);
            return;
        }
        fail('缺少 API Token：请设置 ANNOUNCE_API_TOKEN（或 --token=...）。');
    }

    var stat = { created: 0, duplicate: 0, queued: 0, failed: 0 };
    for (var i = 0; i < payloads.length; i++) {
        var p = payloads[i];
        var built = note.buildAnnouncement(p);
        var r = await post(p, tok);
        if (r.err) {
            stat.queued++;
            enqueue(p, r.err);
            continue;
        }
        if (r.status === 201) {
            stat.created++;
            dequeue(p.commit);
            log('  ✓ 已发布：' + (built ? built.name : p.subject));
        } else if (r.status === 200 && r.body && r.body.duplicate) {
            stat.duplicate++;
            dequeue(p.commit);
            log('  = 已存在，跳过：' + String(p.commit).slice(0, 7));
        } else if (r.status === 404 || r.status >= 500) {
            stat.queued++;
            enqueue(p, '接口 ' + r.status + '（生产可能尚未部署新版本）');
        } else {
            stat.failed++;
            log('  ✗ 失败(' + r.status + ')：' + String(p.commit).slice(0, 7) + ' ' + (r.body && r.body.msg ? r.body.msg : ''), true);
        }
    }

    log('[announce] 完成：新建 ' + stat.created + ' / 已存在 ' + stat.duplicate +
        ' / 排队重试 ' + stat.queued + ' / 失败 ' + stat.failed +
        '（' + countsText + '；跳过 ' + skipped + ' 条）', true);
    if (stat.failed > 0) process.exitCode = 1;
}

main().catch(function (e) {
    // hook 场景下任何异常都不得影响 git commit 的结果
    console.error('[announce] ' + (e && e.message ? e.message : e));
    if (opt.mode === 'head') process.exitCode = 0;
    else process.exitCode = 1;
});
