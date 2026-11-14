/**
 * 开放文章发布 API：供其他系统 / AI 工具以编程方式自动发布文章。
 *
 * 设计要点（与现有后台完全解耦、零改既有路由/行为）：
 *   - 鉴权：无状态 API Token（Authorization: Bearer <token> 或 X-API-Token 头），
 *     不走 session / cookie，因此天然不受 CSRF 守卫约束（csrfGuard 已对带 token 的
 *     /api/articles、/api/categories 放行）。Token 用 timingSafeEqual 常量时间比较，不外泄。
 *   - 复用：字段归一化复用 content.buildFields；落库复用 Content.save；标签重算复用
 *     Tag.reconcileForContent；分类/作者解析复用 Category.findByName / User.findByName；
 *     html 正文入库前复用 markdown.sanitize 兜底 XSS。
 *   - 响应：机器友好 JSON，含创建后的 id 与可访问的公开 URL，便于 AI 工具回链。
 *
 * 保持项目风格：CommonJS + var + 回调，不引入任何新依赖。
 */
'use strict';

var crypto = require('crypto');
var settings = require('../settings');
var content = require('./content');           // exports.buildFields
var Content = require('./../models/Content.js');
var Category = require('./../models/Category.js');
var User = require('./../models/User.js');
var Tag = require('./../models/Tag.js');
var markdown = require('./markdown');
var autoClassify = require('./../services/autoClassify');   // 分类语义匹配 + 标签提取
var guard = require('./moderation/moderationGuard');          // W6：与后台编辑器同一套风控守卫

var constants = require('./../models/constants');
var OID_RE = /^[a-f\d]{24}$/i;

// ---------------------------------------------------------------------------
// 配置读取：环境变量优先，其次 settings.articleApi。
//   ARTICLE_API_TOKENS  逗号分隔的 token 列表（每个 32 位十六进制），全部归属默认作者
//   ARTICLE_API_AUTHOR  默认作者用户名（token 未单独指定 author 时使用）
//   settings.articleApi = { tokens:[{token,author,label,scopes}], defaultAuthor }
// ---------------------------------------------------------------------------
function loadApiConfig() {
    var cfg = (settings && settings.articleApi) || {};
    var entries = [];
    if (Array.isArray(cfg.tokens)) {
        cfg.tokens.forEach(function (t) {
            if (t && typeof t.token === 'string' && t.token) {
                entries.push({
                    token: t.token,
                    author: typeof t.author === 'string' ? t.author : '',
                    label: typeof t.label === 'string' ? t.label : '',
                    scopes: Array.isArray(t.scopes) ? t.scopes : []
                });
            }
        });
    }
    var envTokens = (process.env.ARTICLE_API_TOKENS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var envAuthor = process.env.ARTICLE_API_AUTHOR || cfg.defaultAuthor || '';
    envTokens.forEach(function (tok) {
        entries.push({ token: tok, author: envAuthor, label: 'env', scopes: [] });
    });
    return { entries: entries, defaultAuthor: envAuthor };
}

// 供公告发布 API 复用同一套无状态 Token（不改变本文件的任何既有行为）
exports.loadApiConfig = loadApiConfig;
exports.resolveToken = resolveToken;

function siteBase() {
    var host = (settings && settings.openPlatform && settings.openPlatform.siteHost)
        || process.env.SITE_HOST || 'blog.jiangzi.xin';
    return 'https://' + String(host).split(',')[0].trim();
}

function articleUrl(id) {
    return siteBase() + '/content/detail?id=' + id;
}

function resolveToken(req, cfg) {
    var header = req.headers['authorization'] || req.headers['x-api-token'] || '';
    var provided;
    if (typeof header === 'string' && header.indexOf('Bearer ') === 0) {
        provided = header.slice('Bearer '.length).trim();
    } else {
        provided = String(header).trim();
    }
    if (!provided) return null;
    var matched = null;
    for (var i = 0; i < cfg.entries.length; i++) {
        var cand = cfg.entries[i].token;
        if (typeof cand !== 'string' || cand.length === 0) continue;
        if (cand.length !== provided.length) continue;
        // 长度不等已短路；等长再用 timingSafeEqual，避免 RangeError 且抗时序
        if (crypto.timingSafeEqual(Buffer.from(cand, 'utf8'), Buffer.from(provided, 'utf8'))) {
            matched = cfg.entries[i];
            break;
        }
    }
    return matched;
}

// ---------------------------------------------------------------------------
// 鉴权中间件：解析 token → 解析作者账号 → 挂到 req.apiAuthor。失败一律 401/503。
// ---------------------------------------------------------------------------
exports.auth = function (req, res, next) {
    var cfg = loadApiConfig();
    if (!cfg.entries.length) {
        return res.status(503).json({ success: false, msg: '文章发布接口未启用：请配置 ARTICLE_API_TOKENS 或 settings.articleApi.tokens' });
    }
    var entry = resolveToken(req, cfg);
    if (!entry) {
        return res.status(401).json({ success: false, msg: 'API Token 无效或缺失' });
    }

    // 作者解析优先级：请求体 author > token 绑定 author > 默认作者
    var authorName = (req.body && typeof req.body.author === 'string' && req.body.author.trim())
        ? req.body.author.trim()
        : (entry.author || cfg.defaultAuthor);
    if (!authorName) {
        return res.status(400).json({ success: false, msg: '未指定发布作者，请在请求体设置 author 或配置默认作者' });
    }

    User.findByName(authorName, function (err, u) {
        if (err) {
            console.error('[articleApi.auth] 查询作者失败：' + err.message);
            return res.status(500).json({ success: false, msg: '服务端错误' });
        }
        if (!u) {
            return res.status(403).json({ success: false, msg: '作者账号不存在：' + authorName });
        }
        if (u.status !== constants.USER_ENABLE_STATUS) {
            return res.status(403).json({ success: false, msg: '作者账号已停用：' + authorName });
        }
        // W6：无 session 链路也必须遵守禁言期（后台由 guard.assertActive 兜底，API 在 auth 先挡一次）。
        if (u.muteUntil && new Date(u.muteUntil).getTime() > Date.now()) {
            return res.status(403).json({ success: false, msg: '作者账号处于禁言期：' + authorName });
        }
        req.apiAuthor = u;
        req.apiTokenEntry = entry;
        next();
    });
};

// ---------------------------------------------------------------------------
// POST /api/articles  发布（或存草稿）一篇文章
//   - category 为空：用 autoClassify.matchCategory 语义匹配（与后台编辑器同源）
//   - tags 为空：用 autoClassify.extractTags 从标题/正文轻量分词取 Top5
// ---------------------------------------------------------------------------
exports.publish = function (req, res) {
    var f = content.buildFields(req);

    if (!f.name) return res.status(400).json({ success: false, msg: '标题不能为空' });
    if (!f.content) return res.status(400).json({ success: false, msg: '内容不能为空' });

    // 可见性：draft=true → 草稿（不对公开列表可见）；private=true → 仅自己可见(status=2)
    var visibility = (req.body && req.body.visibility) || (f.draft ? 'draft' : 'public');
    if (req.body && req.body.private === true) visibility = 'private';
    var status = constants.CONTENT_ENABLE_STATUS; // 0
    var draft = false;
    if (visibility === 'draft') { draft = true; }
    else if (visibility === 'private') { status = constants.CONTENT_SELF_STATUS; } // 2

    // 一次性加载分类，用于：①显式分类名→id 解析 ②空分类时语义自动匹配
    Category.findAll(function (catErr, cats) {
        if (catErr) {
            console.error('[articleApi.publish] 分类查询失败：' + catErr.message);
            return res.status(500).json({ success: false, msg: '服务端错误' });
        }
        cats = cats || [];

        // 解析分类：显式提供（ObjectId 或名称）→ 按原逻辑；为空 → 语义自动匹配
        var provided = req.body.category;
        var catId = null;
        if (provided == null || provided === '') {
            var m = autoClassify.matchCategory(cats, f.name, f.content);
            catId = m ? String(m._id) : null;                 // 匹配不到则未分类(null)
        } else if (OID_RE.test(String(provided))) {
            catId = String(provided);
        } else {
            var hit = null;
            var pname = String(provided).trim();
            for (var i = 0; i < cats.length; i++) {
                if (cats[i].name && cats[i].name.trim() === pname) { hit = cats[i]; break; }
            }
            if (!hit) return res.status(400).json({ success: false, msg: '分类不存在：' + provided });
            catId = String(hit._id);
        }

        // 标签：为空时自动从标题/正文提取 Top5（带停用词过滤）
        if (!f.tags || !f.tags.length) {
            f.tags = autoClassify.extractTags(f.name, f.content, f.contentType, 5);
        }

        f.category = catId;                       // null 或 ObjectId 字符串
        f.author = req.apiAuthor._id;
        f.draft = draft;

        // html 格式正文入库前清洗（markdown 由渲染层兜底，原样存储）
        if (f.contentType === 'html') {
            f.content = markdown.sanitize(f.content);
        }

        // 标题去重：与后台编辑器一致，重名直接拒绝并返回已有文章信息
        Content.findByName(f.name, function (nameErr, exist) {
            if (nameErr) {
                console.error('[articleApi.publish] 查重失败：' + nameErr.message);
                return res.status(500).json({ success: false, msg: '服务端错误' });
            }
            if (exist) {
                return res.status(409).json({
                    success: false,
                    msg: '文章已存在',
                    id: exist._id,
                    url: articleUrl(exist._id)
                });
            }

            var obj = {
                name: f.name,
                content: f.content,
                author: f.author,
                category: f.category,
                original: f.original,
                slug: f.slug,
                excerpt: f.excerpt,
                cover: f.cover,
                tags: f.tags,
                seo: f.seo,
                draft: f.draft,
                contentType: f.contentType,
                readingTime: f.readingTime,
                status: status
            };

            // W6（开放 API 风控）：与后台 content.add 同一套 8 字段守卫，且覆盖自动生成的标签。
            // 开放 API 无 session：auth 已把解析出的 User 文档挂 req._moderationActor，
            // guard.readActive 会优先使用它，避免「无 session → banned」把合法请求全打回。
            req._moderationActor = req.apiAuthor;
            var modFields = {
                name: f.name, content: f.content, excerpt: f.excerpt, tags: f.tags,
                seoTitle: f.seo.title, seoKeywords: f.seo.keywords, seoDescription: f.seo.description
            };
            guard.enforce(req, modFields, 'content', function (gErr, verdict) {
                if (gErr) {
                    console.error('[articleApi.publish] 风控守卫异常: ' + gErr.message);
                    return res.status(500).json({ success: false, msg: '服务端错误' });
                }
                if (!verdict.allowed) {
                    // 命中/停用/禁言：零业务写、零成功审计、零标签重算；违规留痕与告警由 guard 完成。
                    return res.status(403).json({ success: false, msg: verdict.msg, reason: verdict.reason });
                }
                Content.save(obj, function (saveErr, saved) {
                    if (saveErr || !saved) {
                        console.error('[articleApi.publish] 保存失败：' + (saveErr && saveErr.message));
                        return res.status(500).json({ success: false, msg: '发表文章失败' });
                    }
                    Tag.reconcileForContent([], f.tags, function () {
                        return res.status(201).json({
                            success: true,
                            msg: draft ? '草稿已保存' : '发表成功',
                            id: saved._id,
                            slug: saved.slug || '',
                            url: articleUrl(saved._id),
                            status: status,
                            draft: draft,
                            visibility: visibility,
                            publishedAt: saved.createTime
                        });
                    });
                });
            });
        });
    });
};

// ---------------------------------------------------------------------------
// GET /api/categories  列出可用分类（便于调用方解析 category 名 → id）
// ---------------------------------------------------------------------------
exports.listCategories = function (req, res) {
    Category.findAll(function (err, docs) {
        if (err) {
            console.error('[articleApi.listCategories] 失败：' + err.message);
            return res.status(500).json({ success: false, msg: '服务端错误' });
        }
        var data = (docs || []).map(function (c) {
            return { id: c._id, name: c.name, slug: c.slug || '', description: c.description || '' };
        });
        res.json({ success: true, data: data });
    });
};

// ---------------------------------------------------------------------------
// GET /api/articles/:id  获取已发布文章（机器友好，含原文与渲染所需元信息）
// ---------------------------------------------------------------------------
exports.getArticle = function (req, res) {
    var id = req.params.id;
    if (!OID_RE.test(String(id || ''))) {
        return res.status(400).json({ success: false, msg: '文章 id 格式错误' });
    }
    Content.findById(id, function (err, doc) {
        if (err) {
            console.error('[articleApi.getArticle] 失败：' + err.message);
            return res.status(500).json({ success: false, msg: '服务端错误' });
        }
        if (!doc) return res.status(404).json({ success: false, msg: '文章不存在' });
        res.json({
            success: true,
            data: {
                id: doc._id,
                name: doc.name,
                slug: doc.slug || '',
                content: doc.content,
                contentType: doc.contentType,
                excerpt: doc.excerpt || '',
                cover: doc.cover || '',
                category: doc.category || null,
                tags: doc.tags || [],
                seo: doc.seo || {},
                original: doc.original || '',
                status: doc.status,
                draft: doc.draft === true,
                url: articleUrl(doc._id),
                view: doc.view || 0,
                createTime: doc.createTime,
                modifyTime: doc.modifyTime
            }
        });
    });
};
