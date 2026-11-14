// 风控守卫（SPEC-MODERATION §5.5/§6.2）：单一入口 enforce(req, fields, source, cb)，串联
// assertActive（异步读库判停用/禁言/封禁）→ matcher.check，任一拒绝即短路。守卫之后逻辑必须包进 cb，
// 命中即早返回，保证零业务写/零成功审计/零邮件。
var User = require('../../models/User');
var ViolationLog = require('../../models/ViolationLog');
var constants = require('../../models/constants');
var matcher = require('./moderationMatcher');
var cfg = require('../adminConfig');
var kit = require('../adminKit');
var alert = require('../../services/alert');
var ObjectId = require('mongoose').Types.ObjectId;

var BLOCK_MSG = '内容包含违规信息，请修改后重试';
var STOP_MSG = '账号已停用，请联系管理员';
var MUTE_MSG = '账号处于禁言期，暂不能发布内容';
var UNAVAILABLE_MSG = '内容校验暂不可用，请稍后重试';

// L4 实时兜底（§6.2）：读库内最新 status/muteUntil（session 里的 user 可能是旧的）。
// cb(err|null, state)：state={active, reason:'ok'|'muted'|'stopped'|'banned', user}。
// DB 错误 → cb(err)，由调用方归一化 500，不静默放行（§10.4）。
function classify(doc, fallbackUser, cb) {
    // User.findById 过滤 status<2：封禁(2) → null。
    if (!doc) return cb(null, {active: false, reason: 'banned', user: fallbackUser});
    if (doc.status === constants.USER_DELETE_STATUS) {
        return cb(null, {active: false, reason: 'banned', user: doc});
    }
    if (doc.status === constants.USER_UNABLE_STATUS) {
        return cb(null, {active: false, reason: 'stopped', user: doc});
    }
    if (doc.muteUntil && new Date(doc.muteUntil).getTime() > Date.now()) {
        return cb(null, {active: false, reason: 'muted', user: doc});
    }
    cb(null, {active: true, reason: 'ok', user: doc});
}

function readActive(req, cb) {
    // 开放 API（W6）：无 session，auth 已按 token 解析出完整 User 文档并挂 req._moderationActor。
    // 直接复用同一套状态判定，避免「无 session → 一律 banned」把合法 API 发文全打回。
    var actor = req && req._moderationActor;
    if (actor && actor._id) return classify(actor, actor, cb);
    var u = req && req.session && req.session.user;
    if (!u || !u._id) return cb(null, {active: false, reason: 'banned'});
    User.findById(u._id, function (err, doc) {
        if (err) return cb(err);
        classify(doc, u, cb);
    });
}

// 命中拒发的刻意例外留痕（§5.5）：恰好 1 条 ViolationLog + $inc + 1 条 result:false 审计。
// 三处靠同一 traceId 串联；任一失败只 console.error 仍坚持拒发。三条写完才回 cb（M1/M7 自包含断言）。
function recordViolation(req, source, decision, state, cb) {
    var traceId = new ObjectId().toString();
    var u = state.user || (req.session && req.session.user) || {};
    var xf = req.headers && req.headers['x-forwarded-for'];
    var ip = (xf ? String(xf).split(',')[0].trim() : '') || req.ip ||
        (req.connection && req.connection.remoteAddress) || '';
    // refId 仅审计溯源用：编辑命中记原内容 id。畸形 body（非对象）视为内部调用契约破坏，拒绝并记录。
    var body = req.body || {};
    if (typeof body !== 'object' || Array.isArray(body)) throw new TypeError('[moderationGuard] req.body 非对象');
    var refId = body.id ? String(body.id) : '';
    var doc = {user: u._id, userName: u.userName || u.realName || '',
        source: source, refId: refId,
        field: decision.field, hitWord: decision.hitWord, hitWordId: decision.hitWordId,
        traceId: traceId, ip: String(ip).slice(0, 64), time: new Date()};
    ViolationLog.save(doc, function (err) {
        if (err) console.error('[moderationGuard] ViolationLog.save failed: ' + err.message);
        function afterLog() {
            // CSV 导入命中（W5a/W5b）在 req._moderationRow 临时挂行号，审计 detail 带 row=N 便于定位；
            // 普通发布（W1–W4）不挂该字段，detail 逐字节不变。各调用串行，不串味。
            var row = (req && req._moderationRow != null) ? ',row=' + req._moderationRow : '';
            kit.audit(req, {action: 'moderation', target: source, objectId: [],
                detail: 'block:' + source + ',field=' + decision.field + ',trace=' + traceId + row,
                result: false}, function () { cb(traceId); });
        }
        if (!u._id) return afterLog();
        User.recordViolation(u._id, doc.time, function (e2) {
            if (e2) console.error('[moderationGuard] User.recordViolation failed: ' + e2.message);
            afterLog();
        });
    });
}

// 命中告警（W6）：fire-and-forget，节流键按「来源 + 命中词」聚合，30 分钟内同词只发一封。
// 只带字段名/命中词/账号名/计数，绝不带正文、邮箱、IP（与 ViolationLog 的最小必要口径一致）。
function alertHit(req, source, decision, state, traceId) {
    try {
        var u = state.user || {};
        alert.notify({
            level: 'warn',
            title: '敏感词命中，已自动拒发',
            summary: '发布/编辑请求在业务写入前被风控守卫拦截，内容未落库。',
            key: 'hit:' + source + ':' + decision.hitWord,
            rows: [
                {k: '来源', v: source === 'content' ? '文章' : '评论'},
                {k: '命中字段', v: decision.field},
                {k: '命中词', v: decision.hitWord},
                {k: '操作账号', v: u.userName || u.realName || '(API/未登录)'},
                {k: '自动留痕', v: '违规记录 + 用户违规计数 + 审计（trace=' + traceId + '）'},
                {k: '后续处置', v: '需人工在后台「违规记录」页签发警告/禁言/停用/封禁'}
            ]
        });
    } catch (e) {
        console.error('[moderationGuard] alert.notify failed: ' + (e && e.message ? e.message : e));
    }
}

// matcher/词库异常（§4.6）：默认 open 放行 + console.error + 一条 matcher_unavailable 审计；
// 切 closed 则拒发（键集合仍由调用方组装为 {success,msg}）。
function onUnavailable(req, source, err, cb) {
    console.error('[moderationGuard] matcher_unavailable: ' + (err && err.message ? err.message : err));
    try {
        alert.notify({
            level: 'critical',
            title: '敏感词匹配器不可用',
            summary: '词库加载/解析失败，当前按 MODERATION_FAIL_MODE 降级，请尽快检查词库与数据库连接。',
            key: 'matcher_unavailable',
            rows: [
                {k: '降级模式', v: cfg.MODERATION_FAIL_MODE === 'closed' ? 'closed（拒发）' : 'open（放行）'},
                {k: '触发来源', v: source},
                {k: '错误信息', v: String(err && err.message ? err.message : err).slice(0, 200)}
            ]
        });
    } catch (e) {
        console.error('[moderationGuard] alert.notify(matcher_unavailable) failed: ' + (e && e.message ? e.message : e));
    }
    kit.audit(req, {action: 'moderation', target: source, objectId: [],
        detail: 'matcher_unavailable', result: false}, function () {
        cb(null, cfg.MODERATION_FAIL_MODE === 'closed'
            ? {allowed: false, msg: UNAVAILABLE_MSG, reason: 'unavailable'}
            : {allowed: true, reason: 'fail_open'});
    });
}

function ModerationGuard() {}

// 账号活跃判定（§10.4）：cb(err|null, active)。DB 错误 → cb(err)，调用方归一化 500。
ModerationGuard.prototype.assertActive = function (req, cb) {
    readActive(req, function (err, state) { if (err) return cb(err); cb(null, state.active); });
};

// 对外单一入口（W1–W5 + 处置写复用）。fields={fieldKey:rawValue}（键顺序决定首个命中字段；
// tags 传数组逐项匹配）；source='content'|'comment'。cb(err|null, verdict)：
//   {allowed:true} | {allowed:false, msg, reason:'muted'|'stopped'|'banned'|'hit'|'unavailable', traceId?, decision?}
// 调用方【必须】只在 allowed=true 时继续业务写入；否则 res.json({success:false,msg}) 并 return。
ModerationGuard.prototype.enforce = function (req, fields, source, cb) {
    readActive(req, function (err, state) {
        if (err) return cb(err);
        if (!state.active) {
            return cb(null, {allowed: false, reason: state.reason,
                msg: state.reason === 'muted' ? MUTE_MSG : STOP_MSG});
        }
        matcher.check(fields || {}, null, function (err2, decision) {
            if (err2) return onUnavailable(req, source, err2, cb);
            if (!decision || !decision.hit) return cb(null, {allowed: true, reason: 'clean'});
            recordViolation(req, source, decision, state, function (traceId) {
                alertHit(req, source, decision, state, traceId);
                cb(null, {allowed: false, msg: BLOCK_MSG, reason: 'hit',
                    traceId: traceId, decision: decision});
            });
        });
    });
};

module.exports = new ModerationGuard();
