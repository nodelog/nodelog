// Wiki 文档导入：接收 Markdown 文本（或 data URL base64），落成 docType:'wiki' 的文档。
// 复用现有 buildFields / 风控守卫 / 标签重算 / 审计口径，不新造第二套逻辑。
// 故意不改 CSV import/export 的 columns——那条路是严格表头匹配，加列会让旧 CSV 全失效。
var Content = require('./../models/Content.js');
var Tag = require('./../models/Tag.js');
var Space = require('./../models/Space.js');
var content = require('./content.js');       // buildFields（唯一字段归一化入口）
var guard = require('./moderation/moderationGuard');
var kit = require('./adminKit');

var MAX_BYTES = 2 * 1024 * 1024; // 2MB，与后台导入上限一致

// 从入参提取 Markdown 原文：支持纯文本(markdown/content)与 data:text/markdown;base64,...
function extractMarkdown(req) {
    var body = req.body || {};
    var raw = body.markdown != null ? body.markdown : body.content;
    if (typeof raw !== 'string' || !raw.trim()) return {error: '文档内容不能为空'};
    var text = raw;
    // data URL：data:text/markdown;base64,XXXX 或 data:application/octet-stream;base64,XXXX
    if (text.indexOf('base64,') !== -1 && /^data:[^;]+;base64,/i.test(text)) {
        try {
            text = Buffer.from(text.split('base64,')[1], 'base64').toString('utf8');
        } catch (e) {
            return {error: '文件解码失败'};
        }
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return {error: '文档超过 2MB 上限'};
    return {text: text};
}

// 标题：优先显式 name，否则取首个 Markdown 一级标题，再否则取首行非空文本。
function resolveName(explicit, text) {
    if (explicit && String(explicit).trim()) return String(explicit).trim().slice(0, 100);
    var m = text.match(/^#\s+(.+)$/m);
    if (m && m[1].trim()) return m[1].trim().slice(0, 100);
    var line = text.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean)[0] || '';
    return line.slice(0, 100);
}

function auditImport(req, id, name, result) {
    kit.audit(req, {
        action: 'wiki-import', target: 'content', objectId: id ? [String(id)] : [],
        detail: 'name=' + name, result: result
    }, function () {});
}

// 供自检/回归使用（生产无副作用）：暴露两个纯函数，避免为测试另起一份口径。
exports._internals = {extractMarkdown: extractMarkdown, resolveName: resolveName};

// POST /manager/wiki/import  （路由层已挂 A=管理员）
exports.import = function (req, res) {
    var got = extractMarkdown(req);
    if (got.error) return res.status(400).json({success: false, msg: got.error});
    var text = got.text;
    var name = resolveName(req.body.name, text);
    if (!name) return res.status(400).json({success: false, msg: '无法确定文档标题，请传入 name'});
    var spaceSlug = String(req.body.spaceSlug || '').trim();
    var spaceId = kit.isObjectId(req.body.spaceId) ? String(req.body.spaceId) : '';

    function saveWithSpace(spaceId) {
        // 构造伪 req 复用 buildFields，保证与编辑器/API 同源归一化（docType 固定 wiki、格式 markdown）。
        var body = {
            name: name, content: text, contentType: 'markdown', docType: 'wiki',
            category: req.body.category, tags: req.body.tags || ''
        };
        if (spaceId) { body.spaceId = String(spaceId); body.slug = Space.slugify(name); }
        var f = content.buildFields({body: body});

        var modFields = {
            name: f.name, content: f.content, excerpt: f.excerpt, tags: f.tags,
            seoTitle: f.seo.title, seoKeywords: f.seo.keywords, seoDescription: f.seo.description
        };
        guard.enforce(req, modFields, 'content', function (gErr, verdict) {
            if (gErr) {
                var n = kit.normalizeDaoError(gErr, 'wikiImport.guard');
                return res.status(n.status).json({success: false, msg: n.msg});
            }
            if (!verdict.allowed) return res.status(403).json({success: false, msg: verdict.msg});

            // 幂等：指定知识库时按「库内 slug」判重，否则沿用全站同名判重。
            function afterDuplicateCheck(exists) {
                if (exists) {
                    return res.status(409).json({success: false, msg: '该知识库中同名文档已存在', id: exists._id});
                }
                f.author = req.session.user._id;
                Content.save(f, function (saveErr, saved) {
                    if (saveErr || !saved) {
                        console.error('[wikiImport] save failed: ' + (saveErr && saveErr.message));
                        auditImport(req, null, f.name, false);
                        return res.status(500).json({success: false, msg: '导入失败'});
                    }
                    Tag.reconcileForContent([], f.tags, 'wiki-import', function () {
                        auditImport(req, saved._id, f.name, true);
                        return res.status(201).json({
                            success: true, msg: '导入成功', id: saved._id,
                            name: f.name, docType: f.docType, tags: f.tags,
                            spaceSlug: spaceSlug || null, slug: f.slug || null
                        });
                    });
                });
            }
            if (spaceId) {
                Content.findPageBySlug(spaceId, f.slug, req.session.user, function (e, dup) {
                    if (e) { var ne = kit.normalizeDaoError(e, 'wikiImport.dup'); return res.status(ne.status).json({success: false, msg: ne.msg}); }
                    afterDuplicateCheck(dup);
                });
            } else {
                Content.findByName(f.name, function (findErr, exists) {
                    if (findErr) { var ne2 = kit.normalizeDaoError(findErr, 'wikiImport.find'); return res.status(ne2.status).json({success: false, msg: ne2.msg}); }
                    afterDuplicateCheck(exists);
                });
            }
        });
    }

    if (spaceSlug) {
        Space.findBySlug(spaceSlug, function (sErr, space) {
            if (sErr || !space) return res.status(404).json({success: false, msg: '知识库不存在：' + spaceSlug});
            saveWithSpace(space._id);
        });
    } else if (spaceId) {
        Space.findById(spaceId, function (sErr, space) {
            if (sErr || !space) return res.status(404).json({success: false, msg: '知识库不存在'});
            saveWithSpace(space._id);
        });
    } else {
        saveWithSpace(null);
    }
};
