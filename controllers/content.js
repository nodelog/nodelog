// Content 控制器主文件：写操作（新增/编辑/删除/分享/历史重命名）+ 归属越权修复（越权点 2、3）。
// 前台查询接口位移到 contentQuery.js、后台治理能力位移到 contentAdmin.js，均为纯代码位移、行为零改动；
// 末尾 Object.assign 合并导出，老 URL 与路由引用（content.findByPage 等）全部不变。
var async = require("async");
var Content = require('./../models/Content.js');
var User = require('./../models/User.js');
var Category = require('./../models/Category.js');
var cmsUtils = require('./cmsUtils.js');
var Tag = require('./../models/Tag.js');
var kit = require('./adminKit');
var guard = require('./moderation/moderationGuard');

function buildFields(req) {
    var name = (req.body.name || '').trim();
    var content = (req.body.content || '').trim();
    var category = req.body.category;
    var original = req.body.original;
    var slug = (req.body.slug || '').trim();
    var excerpt = (req.body.excerpt || '').trim();
    var cover = req.body.cover || '';
    var draft = req.body.draft === true || req.body.draft === 'true';
    var contentType = req.body.contentType === 'markdown' ? 'markdown' : 'html';
    var tags = Array.isArray(req.body.tags)
        ? req.body.tags
        : String(req.body.tags || '').split(',');
    // 归一化：去首尾空格、合并中间连续空白，防止「看不见的空格」让标签匹配失效（上游 8f68829 修复，不得回退）
    tags = tags.map(function (t) { return String(t == null ? '' : t).trim().replace(/\s+/g, ' '); }).filter(Boolean);
    var seo = {
        title: req.body['seo[title]'] || req.body.seoTitle || '',
        keywords: req.body['seo[keywords]'] || '',
        description: req.body['seo[description]'] || ''
    };
    var readingTime = contentType === 'markdown' ? Math.max(1, Math.ceil(content.length / 350)) : 0;
    return {
        name: name, content: content, category: category, original: original,
        slug: slug, excerpt: excerpt, cover: cover, tags: tags, seo: seo,
        draft: draft, contentType: contentType, readingTime: readingTime
    };
}

// 审计收尾：主写/重算完成后才回响应，审计失败只 warn 不改响应键集合（§3.6）。
function finish(req, res, meta, body) {
    kit.audit(req, meta, function () { res.json(body); });
}
function contentMeta(action, id, detail, result) {
    return {action: action, target: 'content', objectId: id ? [String(id)] : [], detail: detail || 'changed:name,content,tags', result: result !== false};
}
function reconcileTags(oldTags, newTags, note, cb) {
    Tag.reconcileForContent(oldTags, newTags, function (err) {
        if (err) console.warn('[content] tag reconcile failed (' + note + '): ' + err.message);
        cb(null); // 重算失败不回滚正文（§3.7），由 tag-reconcile 维护入口自愈
    });
}

// 删除：保留 {success,msg}；删前读旧 tags（带归属作用域），删后重算，审计。
exports.delete = function (req, res) {
    var chk = kit.requireId(req.body.id);
    var sessionUser = req.session.user;
    if (!chk.ok) return res.status(400).json({success: false, msg: '参数错误'});
    var where = kit.scopeTerm(sessionUser, 'author', {});
    Content.adminFindById(chk.id, where, function (err, doc) {
        if (err) {
            var n = kit.normalizeDaoError(err, 'content.delete');
            return res.status(n.status).json({success: false, msg: n.msg});
        }
        if (!doc) return res.json({success: false, msg: '文章不存在或无权删除'});
        Content.delete(chk.id, sessionUser, function (err2) {
            var success = !err2;
            var respond = function () {
                finish(req, res, contentMeta('delete', chk.id, 'changed:status', success),
                    {success: success, msg: success ? '删除成功' : '删除失败'});
            };
            if (!success) return respond();
            reconcileTags(doc.tags || [], [], 'delete', respond);
        });
    });
};

// 状态/分享（越权点 3）：归属早拒绝 + DAO where 带 author + 写后重算 + 审计；{success,msg} 不变。
exports.share = function (req, res) {
    var chk = kit.requireId(req.body.id);
    var status = kit.intInRange(req.body.status, 0, 2, null);
    if (!chk.ok || status === null || status === 1) {
        return res.status(400).json({success: false, msg: '参数错误'});
    }
    var sessionUser = req.session.user;
    var where = kit.scopeTerm(sessionUser, 'author', {status: {$ne: 1}});
    Content.adminFindById(chk.id, where, function (err, doc) {
        if (err) {
            var n = kit.normalizeDaoError(err, 'content.share');
            return res.status(n.status).json({success: false, msg: n.msg});
        }
        if (!doc) return res.json({success: false, msg: '无权操作或文章不存在'});
        Content.share(chk.id, status, sessionUser, function (err2) {
            var success = !err2;
            var respond = function () {
                finish(req, res, contentMeta('status', chk.id, 'changed:status', success),
                    {success: success, msg: success ? '成功' : '失败'});
            };
            if (!success) return respond();
            reconcileTags(doc.tags || [], [], 'share', respond);
        });
    });
};

var findByName = function (name, callback) {
    Content.findByName(name, function (err, obj) { callback(err, obj); });
};

// add（/content/add 新增 + 带 id 编辑兼容分支不可移除；/manager/content/modify 复用本 handler）
// 越权点 2：调用写操作【之前】早拒绝，越权零副作用；DAO 侧 update 再带 author 条件（L3）。
// W1+W2（§5.2）：校验之后、findByName 之前插【一处】风控前置守卫，同时覆盖新增/带 id 编辑两分支。
// 命中即早返回，重名检查/归属早拒绝/Content.save/update/Tag 重算/成功审计全不可达（§5.5 零副作用）。
exports.add = function (req, res) {
    var id = req.body.id;
    // 前台 URLSearchParams 会把 JS null 序列化为字符串 "null"，归一化以保证「新增」分支正确命中
    // （否则发表新文章会被误判为编辑分支 → requireId("null") 校验失败 → 报「参数错误」）
    if (id === 'null' || id === '') id = null;
    var oldName = req.body.oldName;
    if (oldName === 'null') oldName = null;
    var f = buildFields(req);
    var isModifyRoute = req.path === '/manager/content/modify';
    var meta = contentMeta('create', null, 'changed:name,content,tags', true);

    function finishBody(body, ok, objectId) {
        meta.result = !!ok;
        if (objectId) meta.objectId = [String(objectId)];
        kit.audit(req, meta, function () { res.json(body); });
    }

    if (f.name === "") return finishBody({success: false, msg: "标题不能为空"}, false);
    if (f.content === "") return finishBody({success: false, msg: "内容不能为空"}, false);
    if (isModifyRoute && !kit.requireId(id).ok) return finishBody({success: false, msg: "参数错误"}, false);

    // 风控字段：键顺序 = 首个命中字段的报告顺序（§4.3）；tags 数组逐项匹配。
    var modFields = {
        name: f.name, content: f.content, excerpt: f.excerpt, tags: f.tags,
        seoTitle: f.seo.title, seoKeywords: f.seo.keywords, seoDescription: f.seo.description
    };
    guard.enforce(req, modFields, 'content', function (gErr, verdict) {
        // 账号状态守卫 DB 错误 → 归一化 500（§6.2 不静默放行）；命中/停用/禁言 → 老失败键 {success,msg}。
        if (gErr) {
            var n = kit.normalizeDaoError(gErr, 'content.guard');
            return res.status(n.status).json({success: false, msg: n.msg});
        }
        if (!verdict.allowed) return res.json({success: false, msg: verdict.msg});

        findByName(f.name, function (err, obj) {
            if (id == null) {//add
                if (obj !== null) return finishBody({success: false, msg: "文章已经存在"}, false);
                f.author = req.session.user._id;
                Content.save(f, function (err, saved) {
                    if (err) {
                        console.error('[content.add] save failed: ' + err.message);
                        return finishBody({success: false, msg: "发表文章失败"}, false);
                    }
                    reconcileTags([], f.tags, 'add', function () {
                        finishBody({success: true, msg: "发表文章成功"}, true, saved && saved._id);
                    });
                });
            } else {//update（兼容分支不可移除）
                var chk = kit.requireId(id);
                if (!chk.ok) return finishBody({success: false, msg: "参数错误"}, false);
                if (obj !== null && obj.name != oldName) return finishBody({success: false, msg: "文章已经存在"}, false);
                var current = req.session.user;
                var isAdmin = current && current.role === 0;
                // L2 早拒绝：先按 id 取正文做归属比对（管理员豁免，D6），零副作用。
                Content.findById(id, function (err2, doc) {
                    if (err2 || !doc) return finishBody({success: false, msg: "文章不存在"}, false);
                    if (!isAdmin && String(doc.author) !== String(current._id)) {
                        return finishBody({success: false, msg: "无权编辑他人文章"}, false);
                    }
                    var oldTags = doc.tags || [];
                    f.id = id;
                    meta.action = 'update';
                    // D6：管理员改 author 记审计（只记字段名，不记归属值）
                    if (isAdmin && req.body.author && kit.isObjectId(req.body.author) &&
                        String(req.body.author) !== String(doc.author)) {
                        f.author = req.body.author;
                        meta.detail = 'changed:name,content,tags,author';
                    }
                    Content.update(f, current, function (err3) {
                        if (err3) {
                            console.error('[content.add] update failed: ' + err3.message);
                            meta.detail = 'changed:none';
                            return finishBody({success: false, msg: "编辑文章失败"}, false, id);
                        }
                        reconcileTags(oldTags, f.tags, 'edit', function () {
                            finishBody({success: true, msg: "编辑文章成功", id: id}, true, id);
                        });
                    });
                });
            }
        });
    });
};
// 历史按名称重命名接口（无路由挂载）：保留导出，改用新 DAO 签名避免 TypeError。
exports.update = function (req, res) {
    var chk = kit.requireId(req.body.id);
    var name = (req.body.name || '').trim();
    if (!chk.ok) return res.json({success: false, msg: '参数错误'});
    if (!name) return res.json({success: false, msg: '标题不能为空'});
    var where = kit.scopeTerm(req.session.user, 'author', {});
    Content.adminUpdate(chk.id, where, {name: name}, function (err, changed) {
        var ok = !err && changed > 0;
        kit.audit(req, contentMeta('update', chk.id, 'changed:name', ok), function () {
            res.json({success: ok, msg: ok ? '修改成功' : '修改失败'});
        });
    });
};

// 前台查询接口 + 后台治理能力合并导出（纯代码位移，行为零改动，老 URL 全保留）。
Object.assign(exports, require('./contentQuery'), require('./contentAdmin'));
