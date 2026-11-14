#!/usr/bin/env node
/**
 * 内容风控自动化运维 CLI（Node 直跑，回调风格，不新增依赖）。
 *
 *   node scripts/moderation-automation.js                          # all，诊断模式（默认，零写入）
 *   node scripts/moderation-automation.js rescan --apply           # 存量文章/评论复扫，命中自动下架
 *   node scripts/moderation-automation.js dispose --apply           # 违规累计达阈值 → 自动禁言
 *   node scripts/moderation-automation.js collect --apply          # 违规热词候选清单（+ --promote 自动恢复误停用词）
 *   node scripts/moderation-automation.js classify --apply          # 存量文章补分类 / 补标签
 *   node scripts/moderation-automation.js all --apply --daemon      # 常驻，每 30 分钟一轮
 *
 * 安全约定：
 *   - 默认 dry-run：只扫描、只打印计划，绝不写库；显式 --apply 才执行写入。
 *   - 所有写操作都带幂等条件（status:0 / disposedLevel<2 / status:1），重复运行不会产生二次副作用。
 *   - 每次写入同步落一条 AuditLog（actor=SYSTEM_ACTOR），detail 只记字段名与计数，不记正文/PII。
 *   - 词库为空时跳过复扫（matcher 本就放行），避免空词库造成无意义全表扫描。
 *   - --daemon 仅允许单实例运行（多实例请改用系统 crontab，避免重复处置）。
 *
 * 告警：仅当 --apply 且本轮有事件时发一封汇总邮件；收件人独立配置（settings.alert.recipients
 * 或 ALERT_RECIPIENTS），未配置只写日志。--no-mail 可强制关闭。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var async = require('async');
var root = path.join(__dirname, '..');
var settings = require(path.join(root, 'settings'));
var cfg = require(path.join(root, 'controllers/adminConfig'));
var kit = require(path.join(root, 'controllers/adminKit'));
var matcher = require(path.join(root, 'controllers/moderation/moderationMatcher'));
var alert = require(path.join(root, 'services/alert'));
var autoClassify = require(path.join(root, 'services/autoClassify'));
var ViolationLog = require(path.join(root, 'models/ViolationLog'));
var SensitiveWord = require(path.join(root, 'models/SensitiveWord'));
var User = require(path.join(root, 'models/User'));
var Tag = require(path.join(root, 'models/Tag'));
var Category = require(path.join(root, 'models/Category'));
require(path.join(root, 'models/Content'));
require(path.join(root, 'models/Comment'));
var mongoose = require(path.join(root, 'models/mongodb')).mongoose;
var ObjectId = mongoose.Types.ObjectId;
var ContentModel = mongoose.model('Content');
var CommentModel = mongoose.model('Comment');
var UserModel = mongoose.model('User');
var LogModel = ViolationLog.ViolationLogModel;
var WordModel = SensitiveWord.SensitiveWordModel;
var SYSTEM_ACTOR = kit.SYSTEM_ACTOR;

var COMMANDS = ['rescan', 'dispose', 'collect', 'classify', 'all', 'probe', 'smtp-try'];
var opt = {
    cmd: 'all', apply: false, noMail: false, daemon: false, promote: false, smtpTry: false,
    limit: cfg.AUTOMATION_RESCAN_LIMIT,
    days: cfg.AUTOMATION_COLLECT_DAYS,
    interval: cfg.AUTOMATION_INTERVAL_MINUTES
};
process.argv.slice(2).forEach(function (a) {
    if (COMMANDS.indexOf(a) !== -1) opt.cmd = a;
    else if (a === '--apply') opt.apply = true;
    else if (a === '--no-mail') opt.noMail = true;
    else if (a === '--daemon') opt.daemon = true;
    else if (a === '--promote') opt.promote = true;
    else if (a === '--smtp-try') opt.smtpTry = true;
    else if (a.indexOf('--limit=') === 0) opt.limit = parseInt(a.slice(8), 10) || opt.limit;
    else if (a.indexOf('--days=') === 0) opt.days = parseInt(a.slice(7), 10) || opt.days;
    else if (a.indexOf('--interval=') === 0) opt.interval = parseInt(a.slice(11), 10) || opt.interval;
    else if (a === '--help' || a === '-h') {
        console.log('用法: node scripts/moderation-automation.js <rescan|dispose|collect|classify|all|probe|smtp-try> [--apply] [--no-mail] [--promote] [--smtp-try] [--limit=N] [--days=N] [--daemon] [--interval=N]\n' +
            '  probe      自动探测可用 SMTP 传输参数并真实发一封测试邮件；不连库、不写库。\n' +
            '             等价 HTTP 接口：POST /api/alert/probe（带 API Token）。\n' +
            '  smtp-try   只做连接 + 认证校验（不发邮件）并保存可用参数组合。');
        process.exit(0);
    }
});

function stamp() { return new Date().toISOString(); }
function log(s) { console.log('[' + stamp() + '] ' + s); }
function warn(s) { console.warn('[' + stamp() + '] WARN ' + s); }
function kv(k, v) { return {k: k, v: v}; }
function section(title, rows) { return {title: title, rows: rows}; }
function mode() { return opt.apply ? 'apply（已写库）' : 'dry-run（零写入）'; }

// ---------------------------------------------------------------------------
// 1) 存量复扫：词库新增/更新后，回溯检查已发布内容，命中自动下架 + 留痕 + 审计。
// ---------------------------------------------------------------------------
function fieldsOf(d, type) {
    if (type === 'content') {
        return {
            name: d.name, content: d.content, excerpt: d.excerpt, tags: d.tags || [],
            seoTitle: d.seo && d.seo.title, seoKeywords: d.seo && d.seo.keywords,
            seoDescription: d.seo && d.seo.description
        };
    }
    return {comment: d.comment};
}

function scanCollection(Model, type, cb) {
    var hits = [], scanned = 0, lastId = null;
    function done() { cb(null, {scanned: scanned, hits: hits}); }
    function next() {
        if (scanned >= opt.limit) return done();
        var q = type === 'content' ? {status: 0, draft: {$ne: true}} : {status: 0};
        if (lastId) q._id = {$gt: lastId};
        Model.find(q).select(type === 'content'
            ? 'name content excerpt tags seo author'
            : 'comment commenter content').sort({_id: 1}).limit(50).exec(function (err, docs) {
            if (err) return cb(err);
            if (!docs || !docs.length) return done();
            async.eachSeries(docs, function (d, step) {
                scanned++;
                lastId = d._id; // 已按 _id 升序，最后一个即本批最大 id（不依赖 apply 推进游标）
                matcher.check(fieldsOf(d, type), null, function (e, decision) {
                    if (e) { warn('matcher 不可用，跳过 ' + d._id + ': ' + e.message); return step(); }
                    if (decision && decision.hit) hits.push({type: type, doc: d, decision: decision});
                    step();
                });
            }, function () {
                if (docs.length < 50) return done();
                next();
            });
        });
    }
    next();
}

function applyHits(hits, cb) {
    var applied = 0, failed = 0;
    async.eachSeries(hits, function (h, step) {
        var d = h.doc, dec = h.decision;
        var Model = h.type === 'content' ? ContentModel : CommentModel;
        Model.updateOne({_id: d._id, status: 0}, {$set: {status: 1, modifyTime: new Date()}},
            function (err, r) {
                if (err || !r || !r.modifiedCount) {
                    failed++;
                    warn('下架失败 ' + d._id + ': ' + (err ? err.message : '状态已变更'));
                    return step();
                }
                applied++;
                var trace = new ObjectId().toString();
                var vlog = {
                    user: (d.author || d.commenter) || SYSTEM_ACTOR, userName: '',
                    source: h.type, refId: String(d._id), field: dec.field,
                    hitWord: dec.hitWord, hitWordId: dec.hitWordId,
                    traceId: trace, ip: '', time: new Date()
                };
                async.parallel([
                    function (p) {
                        ViolationLog.save(vlog, function (e) {
                            if (e) warn('违规留痕失败 ' + d._id + ': ' + e.message);
                            p();
                        });
                    },
                    function (p) {
                        kit.audit(null, {action: 'moderation', target: h.type,
                            objectId: [String(d._id)], detail: 'auto:rescan,blocked,trace=' + trace,
                            result: true}, function () { p(); });
                    },
                    function (p) {
                        if (h.type !== 'content') return p();
                        // 与人工下架同口径：重算受影响标签的 count
                        Tag.reconcileForContent(d.tags || [], [], function (e) {
                            if (e) warn('标签重算失败 ' + d._id + ': ' + e.message);
                            p();
                        });
                    }
                ], function () { step(); });
            });
    }, function () { cb(null, {applied: applied, failed: failed}); });
}

function taskRescan(report, cb) {
    SensitiveWord.findAllEnabled(function (err, words) {
        if (err) return cb(err); // DB 异常不当作「词库为空」静默跳过
        var count = (words || []).length;
        if (!count) {
            report.sections.push(section('存量复扫', [kv('结果', '启用词库为空，跳过（上线前须导入非空词库）')]));
            return cb(null);
        }
        scanCollection(ContentModel, 'content', function (e1, cr) {
            if (e1) return cb(e1);
            scanCollection(CommentModel, 'comment', function (e2, mr) {
                if (e2) return cb(e2);
                var hits = (cr.hits || []).concat(mr.hits || []);
                function finish(applied, failed) {
                    var rows = [
                        kv('启用词数', count),
                        kv('扫描文章 / 评论', cr.scanned + ' / ' + mr.scanned),
                        kv('命中', hits.length),
                        kv('自动下架', applied),
                        kv('失败', failed),
                        kv('模式', mode())
                    ];
                    hits.slice(0, 5).forEach(function (h) {
                        rows.push(kv('命中明细', h.type + ':' + String(h.doc._id) +
                            ' / 字段=' + h.decision.field + ' / 词=' + h.decision.hitWord));
                    });
                    report.sections.push(section('存量复扫', rows));
                    if (hits.length) report.hasEvents = true;
                    cb(null);
                }
                if (!opt.apply || !hits.length) return finish(0, 0);
                applyHits(hits, function (e3, r) {
                    if (e3) warn('复扫写入异常: ' + e3.message);
                    finish(r.applied, r.failed);
                });
            });
        });
    });
}

// ---------------------------------------------------------------------------
// 2) 阈值自动处置：violationCount 达阈值且未被处置/禁言已过期 → level=2 自动禁言。
//    复用 moderationDispose 的同一套幂等写（User $set + disposition 条件 push + 审计）。
// ---------------------------------------------------------------------------
function taskDispose(report, cb) {
    var now = new Date();
    var threshold = cfg.AUTOMATION_VIOLATION_THRESHOLD;
    var q = {$and: [
        {status: 0},
        {violationCount: {$gte: threshold}},
        {$or: [{disposedLevel: {$lt: 2}}, {disposedLevel: {$exists: false}}]},
        {$or: [{muteUntil: null}, {muteUntil: {$exists: false}}, {muteUntil: {$lte: now}}]}
    ]};
    UserModel.find(q).select('userName violationCount disposedLevel muteUntil lastViolationAt')
        .sort({lastViolationAt: -1}).limit(100).exec(function (err, users) {
        if (err) return cb(err);
        users = users || [];
        function finish(applied, skipped) {
            var rows = [
                kv('阈值（累计违规次数）', threshold),
                kv('命中账号', users.length),
                kv('自动禁言', applied),
                kv('无案底跳过', skipped),
                kv('禁言天数', cfg.MODERATION_MUTE_DAYS),
                kv('模式', mode())
            ];
            users.slice(0, 5).forEach(function (u) {
                rows.push(kv('账号明细', (u.userName || String(u._id)) + ' / ' + u.violationCount + ' 次'));
            });
            report.sections.push(section('阈值自动处置', rows));
            if (users.length) report.hasEvents = true;
            cb(null);
        }
        if (!opt.apply || !users.length) return finish(0, 0);
        var applied = 0, skipped = 0;
        async.eachSeries(users, function (u, step) {
            // 必须有案底才处置：不凭空造 ViolationLog，轨迹仍以 append-only 记录为准。
            LogModel.findOne({user: u._id}).sort({time: -1}).exec(function (e1, vlog) {
                if (e1 || !vlog) { skipped++; return step(); }
                var until = new Date(now.getTime() + cfg.MODERATION_MUTE_DAYS * 86400000);
                User.applyDisposition(u._id, {
                    disposedBy: SYSTEM_ACTOR,
                    moderationNote: '自动处置：违规累计 ' + u.violationCount + ' 次达到阈值 ' + threshold,
                    disposedLevel: 2, status: 0, muteUntil: until, bannedAt: null
                }, function (e2) {
                    if (e2) { warn('自动处置写入失败 ' + u._id + ': ' + e2.message); return step(); }
                    ViolationLog.findOneAndAddDisposition(vlog._id, 2, {
                        level: 2, by: SYSTEM_ACTOR, at: now,
                        reason: '系统自动处置：违规累计达到阈值 ' + threshold
                    }, function (e3) {
                        if (e3) warn('处置轨迹写入失败 ' + u._id + ': ' + e3.message);
                        applied++;
                        kit.audit(null, {action: 'moderation', target: 'user',
                            objectId: [String(u._id)],
                            detail: 'auto:dispose,level=2,threshold=' + threshold, result: true},
                            function () { step(); });
                    });
                });
            });
        }, function () { finish(applied, skipped); });
    });
}

// ---------------------------------------------------------------------------
// 3) 敏感词自动收集：聚合近期命中热词 → 生成待审候选清单 CSV（+ 邮件通知）。
//    注意：ViolationLog 按合规约定不记正文，因此「新词」只能来自命中记录/管理员确认；
//    --promote 仅自动恢复「曾启用、现在停用、近期仍高频命中」的词，绝不凭空新增陌生词。
// ---------------------------------------------------------------------------
function taskCollect(report, cb) {
    var since = new Date(Date.now() - opt.days * 86400000);
    LogModel.aggregate([
        {$match: {time: {$gte: since}}},
        {$group: {_id: '$hitWord', count: {$sum: 1}, users: {$addToSet: '$user'}, last: {$max: '$time'}}},
        {$sort: {count: -1}},
        {$limit: 50}
    ]).exec(function (err, rows) {
        if (err) return cb(err);
        rows = rows || [];
        WordModel.find({}).select('word wordNormalized status').exec(function (e2, words) {
            if (e2) warn('词库读取失败: ' + e2.message);
            var map = {};
            (words || []).forEach(function (w) {
                map[matcher.normalizeForMatch(w.wordNormalized)] = w;
            });
            function statusOf(word) {
                var w = map[matcher.normalizeForMatch(word)];
                return {doc: w, label: !w ? '不在词库' : (w.status === 0 ? '启用' : '已停用')};
            }
            var csvRows = rows.map(function (r) {
                var st = statusOf(r._id);
                var suggest = r.count >= cfg.AUTOMATION_HOT_HITS && st.doc && st.doc.status === 1
                    ? '高频命中且当前停用：建议恢复'
                    : (r.count >= cfg.AUTOMATION_HOT_HITS ? '高频命中：关注' : '观察');
                var last = r.last ? new Date(r.last) : null;
                return [r._id, r.count, (r.users || []).length,
                    (last && isFinite(last.getTime())) ? last.toISOString().slice(0, 10) : '',
                    st.label, suggest];
            });
            var outDir = path.join(root, '.automation-out');
            var file = '';
            try {
                if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
                file = path.join(outDir, 'sensitive-candidates-' + new Date().toISOString().slice(0, 10) + '.csv');
                fs.writeFileSync(file, kit.csv.encode(
                    ['命中词', '次数', '涉及账号数', '最近命中', '词库状态', '建议'], csvRows), 'utf8');
            } catch (e3) {
                warn('候选清单写入失败: ' + e3.message);
            }
            var reportRows = [
                kv('统计窗口', opt.days + ' 天'),
                kv('聚合热词数', rows.length),
                kv('候选清单', file || '(写入失败)'),
                kv('自动恢复误停用词', opt.apply && opt.promote ? '开启' : '关闭'),
                kv('模式', mode())
            ];
            rows.slice(0, 10).forEach(function (r, i) {
                reportRows.push(kv('Top' + (i + 1), r._id + ' × ' + r.count + ' 次 / ' + statusOf(r._id).label));
            });
            report.sections.push(section('敏感词候选收集', reportRows));
            if (rows.length) report.hasEvents = true;
            if (!opt.apply || !opt.promote) return cb(null);
            var targets = rows.filter(function (r) {
                var st = statusOf(r._id);
                return r.count >= cfg.AUTOMATION_HOT_HITS && st.doc && st.doc.status === 1;
            }).map(function (r) { return statusOf(r._id).doc; });
            async.eachSeries(targets, function (w, step) {
                WordModel.updateOne({_id: w._id, status: 1},
                    {$set: {status: 0, modifyTime: new Date()}}, function (e4, r) {
                    if (e4) warn('恢复停用词失败 ' + w.word + ': ' + e4.message);
                    else if (r && r.modifiedCount) log('已恢复停用词: ' + w.word);
                    step();
                });
            }, function () {
                if (targets.length) matcher.invalidate();
                cb(null);
            });
        });
    });
}

// ---------------------------------------------------------------------------
// 4) 服务端自动归类 / 打标签：只补空字段，自动标签也过风控，写入后重算标签计数。
// ---------------------------------------------------------------------------
function taskClassify(report, cb) {
    Category.findAll(function (err, cats) {
        if (err) { warn('分类读取失败: ' + err.message); cats = []; }
        var q = {$and: [
            {status: {$ne: 1}},
            {$or: [{category: null}, {category: {$exists: false}},
                   {tags: {$size: 0}}, {tags: {$exists: false}}]}
        ]};
        ContentModel.find(q).select('name content tags category contentType')
            .sort({_id: 1}).limit(opt.limit).exec(function (e1, docs) {
            if (e1) return cb(e1);
            var plans = [];
            (docs || []).forEach(function (d) {
                var set = {};
                if (!d.category) {
                    var m = autoClassify.matchCategory(cats || [], d.name, d.content);
                    if (m && m._id) set.category = m._id;
                }
                if (!d.tags || !d.tags.length) {
                    var tags = autoClassify.extractTags(d.name, d.content, d.contentType, 5);
                    if (tags.length) set.tags = tags;
                }
                if (Object.keys(set).length) plans.push({doc: d, set: set});
            });
            var withCat = plans.filter(function (p) { return !!p.set.category; }).length;
            var withTags = plans.filter(function (p) { return !!p.set.tags; }).length;
            function finish(applied, blocked) {
                var rows = [
                    kv('候选文章', plans.length),
                    kv('可补分类 / 可补标签', withCat + ' / ' + withTags),
                    kv('风控跳过（自动标签命中）', blocked),
                    kv('已写入', applied),
                    kv('模式', mode())
                ];
                plans.slice(0, 5).forEach(function (p) {
                    rows.push(kv('补全明细', String(p.doc._id) +
                        (p.set.category ? ' / 分类' : '') +
                        (p.set.tags ? ' / 标签=' + p.set.tags.join('|') : '')));
                });
                report.sections.push(section('服务端自动归类 / 打标签', rows));
                if (plans.length) report.hasEvents = true;
                cb(null);
            }
            if (!opt.apply || !plans.length) return finish(0, 0);
            var applied = 0, blocked = 0;
            async.eachSeries(plans, function (p, step) {
                // 自动生成的标签也必须过敏感词，避免「补标签」变成绕过口
                matcher.check({tags: p.set.tags || []}, null, function (me, dec) {
                    if (me || (dec && dec.hit)) { blocked++; return step(); }
                    var set = Object.assign({modifyTime: new Date()}, p.set);
                    ContentModel.updateOne({_id: p.doc._id, status: {$ne: 1}}, {$set: set},
                        function (ue, r) {
                            if (ue || !r || !r.modifiedCount) {
                                warn('归类写入失败 ' + p.doc._id + ': ' + (ue ? ue.message : '状态已变更'));
                                return step();
                            }
                            applied++;
                            if (!p.set.tags) return step();
                            Tag.reconcileForContent([], p.set.tags, function (te) {
                                if (te) warn('标签重算失败 ' + p.doc._id + ': ' + te.message);
                                step();
                            });
                        });
                });
            }, function () { finish(applied, blocked); });
        });
    });
}

// ---------------------------------------------------------------------------
// 编排 + 告警 + 收尾
// ---------------------------------------------------------------------------
var TASKS = {rescan: taskRescan, dispose: taskDispose, collect: taskCollect, classify: taskClassify};

function runOnce(done) {
    var report = {title: '', level: 'info', summary: '', sections: [], hasEvents: false};
    var names = opt.cmd === 'all' ? ['rescan', 'dispose', 'collect', 'classify'] : [opt.cmd];
    async.eachSeries(names, function (name, step) {
        log('--- ' + name + ' 开始 ---');
        TASKS[name](report, function (err) {
            if (err) {
                warn(name + ' 失败: ' + err.message);
                report.sections.push(section(name + '（失败）', [kv('错误', err.message)]));
                report.hasEvents = true;
            }
            step();
        });
    }, function () {
        report.title = '自动化运维结果 · ' + opt.cmd + (opt.apply ? '（已执行）' : '（诊断）');
        report.level = report.hasEvents ? 'warn' : 'info';
        report.summary = '本轮共 ' + report.sections.length + ' 个模块；' +
            (report.hasEvents ? '发现需关注事项，详见下表。' : '无异常，无需处理。');
        report.sections.forEach(function (s) {
            log('[' + s.title + '] ' + s.rows.map(function (r) { return r.k + '=' + r.v; }).join(' | '));
        });
        function close() { done(); }
        if (!opt.apply || !report.hasEvents || opt.noMail) return close();
        // 等 SMTP 返回再退出（否则 CLI 结束会丢邮件）；10 秒兜底防 SMTP 挂起。
        var timer = setTimeout(function () {
            warn('告警邮件超时，继续收尾');
            close();
        }, 10000);
        alert.digest(report, function (e, r) {
            clearTimeout(timer);
            log('汇总告警: ' + JSON.stringify(r) + (e ? ' err=' + e.message : ''));
            close();
        });
    });
}

var dbName = (String(settings.url || settings.dbUrl).match(/\/([^/?]+)(\?.*)?$/) || [])[1] || '(unknown)';
log('目标库=' + dbName + ' | 命令=' + opt.cmd + ' | 模式=' + mode() +
    ' | 告警=' + JSON.stringify(alert.getConfig()));

function exit(code) {
    try { mongoose.connection.close(); } catch (e) { /* 已关闭 */ }
    setTimeout(function () { process.exit(code || 0); }, 150);
}

// 通道自检：打印脱敏配置、自动试端口、发测试邮件并给出可照做的修复步骤；不连库、不写库。
function printSmtpFix(err) {
    var ex = alert.explainSmtpError(err || alert.lastError(), alert.describe().smtp);
    warn('诊断结论: ' + ex.title);
    ex.steps.forEach(function (s, i) { warn('  ' + (i + 1) + '. ' + s); });
}

function runVerify(done) {
    log('SMTP 连接 / 认证校验中（自动枚举传输参数，不发邮件、不改配置）…');
    alert.probeAuth(function (e, r) {
        if (e) warn('校验异常: ' + e.message);
        (r.tried || []).forEach(function (t) {
            log('  尝试 ' + (t.id || '-') + ' port=' + t.port + ' secure=' + t.secure +
                ' auth=' + t.authMethod + ' user=' + t.userForm + ' pass=' + t.passForm +
                ' tls=' + (t.tlsLoose ? 'loose' : 'strict') +
                ' host=' + (t.hostForm || 'configured') +
                ' -> ' + (t.ok ? '通过' : '失败：' + t.error));
        });
        if (r.ok) {
            log('可用传输参数组合（已保存，后续告警自动复用）: ' + JSON.stringify(r.profile));
        } else if (r.reason === 'auth') {
            printSmtpFix({message: (r.tried[0] && r.tried[0].error) || 'Authentication failure'});
        } else {
            warn('未找到可用组合：' + (r.reason || 'unknown'));
        }
        done(r);
    });
}

if (opt.cmd === 'smtp-try') {
    log('当前 SMTP（脱敏）: ' + JSON.stringify(alert.describe().smtp));
    runVerify(function (r) { exit(r.ok ? 0 : 1); });
} else if (opt.cmd === 'probe') {
    var ac = alert.getConfig();
    var smtpView = alert.describe().smtp;
    log('当前告警配置（脱敏）: ' + JSON.stringify(alert.describe()));
    log('收件人=' + (ac.recipients.join(', ') || '未配置→发给发件账号自己') +
        ' | 发件账号=' + smtpView.user + ' | 发件主机=' + smtpView.host + ':' + smtpView.port +
        ' | 服务商=' + smtpView.provider + ' | 密码=' + (smtpView.passSet ? '已配置（不显示）' : '未配置'));
    if (!ac.enabled) {
        warn('尚未配置收件人 / 发件凭据：自检仍会尝试（未配收件人时发给发件账号自己）。' +
            '生产请配置 settings.alert.recipients 或 ALERT_RECIPIENTS。');
    }
    // 与 POST /api/alert/probe 同一条链路：自动枚举传输参数 → 找到可用组合 → 真实发一封。
    // 不再先发一封失败再靠后台自愈，而是本轮直接探测到成功组合后投递。
    log('自动探测可用 SMTP 传输参数（认证机制 / TLS / 端口，账号配置一字不改）…');
    alert.sendTest({}, function (e, r) {
        if (e) warn('自检异常: ' + e.message);
        ((r && r.tried) || []).forEach(function (t) {
            log('  尝试 ' + (t.id || '-') + ' port=' + t.port + ' secure=' + t.secure +
                ' auth=' + t.authMethod + ' user=' + t.userForm + ' pass=' + t.passForm +
                ' tls=' + (t.tlsLoose ? 'loose' : 'strict') +
                ' host=' + (t.hostForm || 'configured') +
                ' -> ' + (t.ok ? '通过' : '失败：' + t.error));
        });
        if (r && r.profile) log('可用组合（脱敏，已持久化）: ' + JSON.stringify(r.profile));
        log('自检结果: ' + JSON.stringify({
            sent: !!(r && r.sent), reason: r && r.reason,
            messageId: r && r.messageId, accepted: r && r.accepted
        }));
        if (r && r.sent) {
            log('邮件已真实投递给 SMTP，请检查收件箱（含垃圾邮件文件夹）。');
        } else {
            warn('全部传输参数组合均失败，原因: ' + (r && r.reason));
            var st = r && r.advice && r.advice.steps;
            if (st && st.length) {
                warn('备用排查项（不是「配置错误」结论）:');
                st.forEach(function (s, i) { warn('  ' + (i + 1) + '. ' + s); });
            } else {
                printSmtpFix(e || alert.lastError());
            }
        }
        exit(r && r.sent ? 0 : 1);
    });
} else if (mongoose.connection.readyState === 1) {
    begin();
} else {
    // 连接预检：无 MongoDB 时快速失败，避免每个任务各等一次 10s 缓冲超时。
    log('等待数据库连接…');
    var settled = false;
    var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        warn('数据库连接超时：请检查 settings.url / MONGO_URL，或确认 mongod 已启动');
        exit(1);
    }, 15000);
    mongoose.connection.once('open', function () {
        if (settled) return;
        settled = true; clearTimeout(timer); begin();
    });
    mongoose.connection.on('error', function (e) {
        if (settled) return;
        settled = true; clearTimeout(timer);
        warn('数据库连接失败: ' + (e && e.message ? e.message : e));
        exit(1);
    });
}

function begin() {
    if (opt.daemon) {
        log('常驻模式：每 ' + opt.interval + ' 分钟一轮（单实例运行；多实例请改用系统 crontab）');
        setInterval(function () { runOnce(function () {}); }, opt.interval * 60000);
        runOnce(function () {});
    } else {
        runOnce(function () { exit(0); });
    }
}
