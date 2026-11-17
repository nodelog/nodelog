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
 * 鉴权（v3 应用凭证，零静态 token）：
 *   先在后台「应用管理」创建应用并绑定一个管理员用户（role===0），复制其 AppID / AppSecret。
 *   凭据读取顺序：命令行 --app-id / --app-secret > 环境变量 ANNOUNCE_APP_ID / ANNOUNCE_APP_SECRET。
 *   脚本用 AppID + AppSecret 在本地做 HMAC-SHA256 签名，POST /api/auth/token 换取短期 access_token，
 *   再以 Bearer <access_token> 调用公告接口；token 进程内缓存，到期前 60 秒视为过期并重新换取。
 *   settings.js 已零密钥且被 gitignore，不再从中读取任何 token / secret。
 *   其余可用环境变量：ANNOUNCE_API_BASE（默认 https://blog.jiangzi.xin）、ANNOUNCE_REPO_URL。
 *   注意：公告接口为 adminOnly，应用必须绑定管理员用户，否则即使换到 token 调用公告接口仍会 401。
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
var crypto = require('crypto');
var cp = require('child_process');
var note = require('../services/releaseNote');

var ROOT = path.resolve(__dirname, '..');
var QUEUE_DIR = path.join(ROOT, '.announce-queue');
var DEFAULT_BASE = 'https://blog.jiangzi.xin';
var REQUEST_TIMEOUT_MS = 8000;

// access_token 进程内缓存；expiresAt 为绝对毫秒时间戳，提前 60 秒视为过期
var TOKEN_CACHE = { token: '', expiresAt: 0 };
var TOKEN_REFRESH_MARGIN_MS = 60000;

var opt = {
    mode: 'head',
    dryRun: false,
    quiet: false,
    since: '',
    limit: 0,
    pattern: null,
    base: '',
    appId: '',
    appSecret: '',
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
        else if (a.indexOf('--app-id=') === 0) opt.appId = a.slice(9);
        else if (a.indexOf('--app-secret=') === 0) opt.appSecret = a.slice(13);
        else if (a.indexOf('--token=') === 0) {
            fail('--token 已废弃：v3 已移除静态 Token，请改用 --app-id= 与 --app-secret=。' + credentialHint());
        }
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

function credentialHint() {
    return '请在后台「应用管理」创建应用并绑定管理员用户，复制其 AppID/AppSecret 到环境变量 ' +
        'ANNOUNCE_APP_ID / ANNOUNCE_APP_SECRET（也可用 --app-id= / --app-secret= 传入）。' +
        '公告接口仅允许绑定管理员用户的应用调用。';
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
        '  --app-id=APPID      应用 AppID（或环境变量 ANNOUNCE_APP_ID）',
        '  --app-secret=SECRET 应用 AppSecret（或环境变量 ANNOUNCE_APP_SECRET）',
        '  --repo-url=URL      代码仓库地址（用于公告里的变更链接）',
        '  --csv=FILE          导出后台批量导入格式的 CSV（无需换 token 即可补发）',
        '  --no-queue          禁用失败排队重试',
        '  --quiet             精简输出',
        '鉴权：后台创建绑定管理员用户的应用，复制 AppID/AppSecret 到 ANNOUNCE_APP_ID / ANNOUNCE_APP_SECRET。',
        '      ' + credentialHint()
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

// v3：不再读 settings.js / 静态 token，凭据只来自 CLI 参数或环境变量
function credentials() {
    var appId = String(opt.appId || process.env.ANNOUNCE_APP_ID || '').trim();
    var appSecret = String(opt.appSecret || process.env.ANNOUNCE_APP_SECRET || '').trim();
    return { appId: appId, appSecret: appSecret };
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
// 统一 POST JSON：tok 非空时带 Bearer 头。返回 { status, body } 或 { err }。
function httpJson(baseUrl, pathname, bodyObj, tok) {
    return new Promise(function (resolve) {
        var url;
        try { url = new URL(pathname, baseUrl); }
        catch (e) { return resolve({ err: '站点地址非法：' + baseUrl }); }
        var mod = url.protocol === 'https:' ? https : http;
        var data = Buffer.from(JSON.stringify(bodyObj), 'utf8');
        var headers = {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': data.length
        };
        if (tok) headers['Authorization'] = 'Bearer ' + tok;
        var req = mod.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: headers,
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

// 用 AppID + AppSecret 在本地做 HMAC-SHA256 签名，换取短期 access_token。
// 签名串与服务端 services/apiCredential.js 的 sign() 完全一致：
//   HMAC_SHA256(secretPlain, appId + "\n" + timestamp + "\n" + nonce) 的小写 hex。
function getAccessToken(baseUrl, appId, appSecret, force) {
    var now = Date.now();
    if (!force && TOKEN_CACHE.token && now < TOKEN_CACHE.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
        return Promise.resolve(TOKEN_CACHE.token);
    }
    var timestamp = Date.now();
    var nonce = crypto.randomBytes(16).toString('hex');
    var signature = crypto.createHmac('sha256', String(appSecret))
        .update(String(appId) + '\n' + String(timestamp) + '\n' + nonce)
        .digest('hex');
    return httpJson(baseUrl, '/api/auth/token', {
        appId: appId,
        timestamp: timestamp,
        nonce: nonce,
        signature: signature
    }, null).then(function (r) {
        if (r.err) return null;
        var b = r.body || {};
        if (r.status === 200 && b.success === true && b.access_token) {
            var ttl = parseInt(b.expires_in, 10) || 3600;
            TOKEN_CACHE.token = b.access_token;
            TOKEN_CACHE.expiresAt = Date.now() + ttl * 1000;
            return TOKEN_CACHE.token;
        }
        log('[announce] 换 token 失败：HTTP ' + r.status + ' ' + (b.msg || ''), true);
        return null;
    }).catch(function () { return null; });
}

function sendAnnouncement(payload, accessToken) {
    return httpJson(base(), '/api/announcements', payload, accessToken);
}

// 公告接口 401（token 过期/失效）时强制换一次 token 并重试一次。
function post(payload, accessToken, appId, appSecret) {
    return sendAnnouncement(payload, accessToken).then(function (r) {
        if (r && r.status === 401 && appId && appSecret) {
            return getAccessToken(base(), appId, appSecret, true).then(function (fresh) {
                if (!fresh) return r;   // 换 token 失败：原样返回 401 交给调用方处理
                return sendAnnouncement(payload, fresh);
            });
        }
        return r;
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

    // CSV 与 dry-run 都是纯本地产物：不需要凭据、不换 token、不调用接口
    if (opt.csv) { writeCsv(payloads); return; }
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

    // 其余分支：先取凭据，再换取 token
    var cred = credentials();
    if (!cred.appId || !cred.appSecret) {
        if (opt.mode === 'head') {
            // hook 场景：不报错、不影响 commit，落队列等配置完成后自动补发
            payloads.forEach(function (p) { enqueue(p, '缺少 ANNOUNCE_APP_ID / ANNOUNCE_APP_SECRET'); });
            log('[announce] 未配置 AppID/AppSecret，本次提交已排队；' + credentialHint(), true);
            return;
        }
        fail('缺少 AppID/AppSecret：' + credentialHint());
    }

    var tok = await getAccessToken(base(), cred.appId, cred.appSecret);
    if (!tok) {
        if (opt.mode === 'head') {
            // 换 token 失败同样不得阻塞 git commit
            payloads.forEach(function (p) { enqueue(p, '换取 access_token 失败'); });
            log('[announce] 换取 access_token 失败，本次提交已排队；请检查 AppID/AppSecret 是否正确、应用是否绑定管理员用户。', true);
            return;
        }
        fail('换取 access_token 失败：请检查 AppID/AppSecret 是否正确、应用是否启用并绑定管理员用户。');
    }

    var stat = { created: 0, duplicate: 0, queued: 0, failed: 0 };
    for (var i = 0; i < payloads.length; i++) {
        var p = payloads[i];
        var built = note.buildAnnouncement(p);
        var r = await post(p, tok, cred.appId, cred.appSecret);
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
