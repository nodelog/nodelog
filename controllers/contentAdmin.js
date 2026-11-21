// Content 后台治理能力（SPEC §4.1 / §5.3）。从 content.js 拆出以满足单文件 ≤300 行门禁，
// 由 content.js 末尾 Object.assign 合并导出，对外接口与路由无感。
var Content = require('./../models/Content.js');
var Tag = require('./../models/Tag.js');
var kit = require('./adminKit');
var crud = require('./adminCrud');
var io = require('./adminIo');
var guard = require('./moderation/moderationGuard');
var sanitizeHtml = require('sanitize-html');

// 薄封装：只委托唯一计数实现 syncTags（经 Tag.reconcileForContent），不写第二套计数。
// 与 content.js 的同名函数逻辑一致；独立一份是为避免 content.js ⇄ contentAdmin.js 循环 require。
function reconcileTags(oldTags, newTags, note, cb) {
    Tag.reconcileForContent(oldTags, newTags, function (err) {
        if (err) console.warn('[content] tag reconcile failed (' + note + '): ' + err.message);
        cb(null); // 重算失败不回滚正文（§3.7），由 tag-reconcile 维护入口自愈
    });
}
var contentDesc = {
    soft: {status: {$ne: 1}, draft: {$ne: true}}, // 软删 status=1 + 草稿兼容
    owner: 'author', search: ['name'], category: true, tag: true, author: true, dateField: 'createTime',
    sortWhitelist: ['createTime', 'modifyTime', 'view', 'name'], defaultSortBy: 'createTime'
};
// 方案D：纯增量后台 JSON 列表端点（GET /manager/content/list），复用本文件 contentDesc。
// 不传 view → crud.list 自动返回纯 JSON {success,data,page,totalPage,total}；参数全走 req.query。
// desc.soft 原样保留（不借机扩大管理员可见范围）；statusRange 沿用 content.status/batch 的 [0,2]。
exports.adminList = crud.list({
    Model: Content, desc: contentDesc, target: 'content', statusRange: [0, 2],
    sortWhitelist: contentDesc.sortWhitelist, defaultSortBy: contentDesc.defaultSortBy
});
// 方案D-SSR：管理员专用页面级筛选/排序（GET /manager/content/admin）。
// 这是【新的】crud.list SSR 实例，与上方 JSON 端点的字段口径【分开定义】：
// decorate 只对整页 docs 批量补 realName/userName/categoryName（复用 Content.enrichDocs 的
// 两次批量查询口径，零逐条 N+1），并保留老模板 manager/content 要用的字段。
function contentSsrDecorate(docs, cb) {
    var plain = (docs || []).map(function (d) {
        return d && d.toObject ? d.toObject() : Object.assign({}, d || {});
    });
    function finish() {
        cb(null, plain.map(function (p) {
            return {
                _id: p._id, author: p.author, name: p.name,
                category: p.category, categoryName: p.categoryName || '未知',
                userName: p.userName || '佚名', realName: p.realName || '佚名',
                createTime: p.createTime, modifyTime: p.modifyTime, status: p.status
            };
        }));
    }
    // 关联查询失败不阻断列表，退化为显示名兜底（可观测：仅 warn）。
    Content.enrichDocs(plain, function (err) {
        if (err) console.warn('[content.adminPage] enrichDocs failed: ' + err.message);
        finish();
    });
}
exports.adminPage = crud.list({
    Model: Content, desc: contentDesc, target: 'content', statusRange: [0, 2],
    sortWhitelist: contentDesc.sortWhitelist, defaultSortBy: contentDesc.defaultSortBy,
    view: 'manager/content', urlPrefix: '/manager/content/admin',
    title: '文章管理', currentMenu: 'content', decorate: contentSsrDecorate
});
function contentBefore(id, where, req, cb) { Content.adminFindById(id, where, cb); }
function contentAfterTags(id, oldDoc, status, req, cb) {
    reconcileTags(oldDoc ? (oldDoc.tags || []) : [], [], 'status/batch', cb);
}

// 可选独立编辑：复用 /content/add 的兼容分支，仅补 id 校验（响应键完全相同）。
exports.modify = function (req, res) {
    if (!kit.requireId(req.body.id).ok) return res.status(400).json({success: false, msg: '参数错误'});
    require('./content').add(req, res);
};
exports.status = crud.status({
    Model: Content, target: 'content', shape: 'success', statusRange: [0, 2], desc: contentDesc,
    statusMsg: '状态更新成功', beforeStatus: contentBefore, afterStatus: contentAfterTags
});
exports.batch = crud.batch({
    Model: Content, target: 'content', shape: 'success', statusRange: [0, 2], desc: contentDesc,
    beforeStatus: contentBefore, afterStatus: contentAfterTags,
    beforeDelete: contentBefore,
    afterDelete: function (id, oldDoc, docReq, cb) {
        reconcileTags(oldDoc ? (oldDoc.tags || []) : [], [], 'batch-delete', cb);
    }
});
exports['import'] = io.import({
    Model: Content, target: 'content',
    columns: ['name', 'content', 'category', 'slug', 'tags', 'status', 'draft', 'contentType'],
    rowToDoc: function (cells, ctx) {
        var name = kit.csv.sanitize(cells[0]);
        var rawContent = String(cells[1] == null ? '' : cells[1]);
        // 白名单净化：保正文结构，去 <script>/onerror；再剔控制字符（保留换行的正文排版）
        var content = sanitizeHtml(rawContent).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
        if (!name || !content.trim()) throw new Error('标题/内容不能为空');
        var category = String(cells[2] == null ? '' : cells[2]).trim();
        if (category && !kit.isObjectId(category)) throw new Error('分类 id 非法');
        var status = kit.intInRange(cells[5], 0, 2, 0);
        var tags = String(cells[4] == null ? '' : cells[4]).split(/[,，|]/)
            .map(function (t) { return kit.csv.sanitize(t); }).filter(Boolean);
        return {
            __row: ctx.row, __req: ctx.req, name: name, content: content,
            category: category || null, slug: kit.csv.sanitize(cells[3]), tags: tags,
            status: status, draft: /^(true|1|yes)$/i.test(String(cells[6] || '').trim()),
            contentType: String(cells[7] || '').trim() === 'markdown' ? 'markdown' : 'html',
            author: ctx.req.session.user._id, view: 0, readingTime: 0,
            seo: {title: '', keywords: '', description: ''},
            createTime: new Date(), modifyTime: new Date()
        };
    },
    insertDoc: function (doc, cb) {
        // W5a（§5.4）：直连 Content.save 绕过 add，必须单独挂守卫。命中行进 results（ok:false），不落库。
        // io.import 的 insertDoc 无 req 参数；rowToDoc 已把 req 存到 doc.__req（写库前会删除）。
        var req = doc.__req;
        delete doc.__req;
        req._moderationRow = doc.__row; // CSV 命中审计 detail 带 row=N（§5.4）
        guard.enforce(req, {name: doc.name, content: doc.content, excerpt: doc.excerpt,
            tags: doc.tags, seoTitle: '', seoKeywords: '', seoDescription: ''}, 'content', function (gErr, verdict) {
            if (gErr) return cb(gErr);
            if (!verdict.allowed) {
                var e = new Error('第 ' + doc.__row + ' 行包含违规信息');
                e.userMsg = e.message;
                return cb(e);
            }
            Content.findByName(doc.name, function (err, exists) {
                if (err) return cb(err);
                if (exists) return cb(new Error('文章已经存在'));
                Content.save(doc, function (e, saved) {
                    if (e) return cb(e);
                    reconcileTags([], doc.tags, 'import', function () {
                        cb(null, saved && saved._id ? String(saved._id) : '');
                    });
                });
            });
        });
    }
});
exports['export'] = io.export({
    Model: Content, target: 'content', desc: contentDesc,
    columns: ['name', 'slug', 'category', 'tags', 'status', 'draft', 'createTime', 'modifyTime', 'view'],
    docToRow: function (d) {
        return [d.name, d.slug || '', d.category ? String(d.category) : '', (d.tags || []).join('|'),
            d.status, d.draft ? 'true' : 'false',
            d.createTime ? d.createTime.toISOString() : '', d.modifyTime ? d.modifyTime.toISOString() : '', d.view || 0];
    }
});
