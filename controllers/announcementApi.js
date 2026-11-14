/**
 * 开放公告发布 API：供 git hook / CI / 补发脚本自动发布「站点更新公告」（新功能 + 优化升级）。
 *
 * 契约：
 *   POST /api/announcements
 *   Header: Authorization: Bearer <token>  或  X-API-Token: <token>
 *   Body:   { commit, subject, body?, author?, date?, repoUrl? }
 *
 * 设计要点：
 *   1) 无状态 Token 鉴权，复用 articleApi 的 token 体系；也可用专用环境变量
 *      ANNOUNCEMENT_API_TOKENS / settings.announcementApi.tokens 单独授权。
 *   2) 幂等：按 commitHash 查重。同一个提交无论被 hook、CI、补发脚本触发多少次，
 *      站内只产生一条公告；重复调用返回 {success:true, duplicate:true}。
 *   3) 标题与 HTML 正文一律由 services/releaseNote.js 在服务端生成并转义，
 *      不接受调用方传入 HTML，避免 /log/detail 的 <%- %> 渲染成为 XSS 入口。
 *   4) 不改变任何既有后台路由与响应；公告落库走 Log.save（status=0，前台立即可见）。
 */
'use strict';

var settings = require('../settings');
var articleApi = require('./articleApi');
var releaseNote = require('../services/releaseNote');
var Log = require('../models/Log.js');

function loadTokenConfig() {
    var cfg = (settings && settings.announcementApi) || {};
    var own = [];
    if (Array.isArray(cfg.tokens)) {
        cfg.tokens.forEach(function (t) {
            if (t && typeof t.token === 'string' && t.token) own.push({ token: t.token, label: 'announcement' });
        });
    }
    String(process.env.ANNOUNCEMENT_API_TOKENS || '').split(',').forEach(function (t) {
        t = t.trim();
        if (t) own.push({ token: t, label: 'env' });
    });
    // 与文章发布 API 同一套配置习惯：未单独配置公告 token 时，
    // 直接复用 settings.js 的 articleApi.tokens（本机/生产通常已有，无需新增密钥）。
    // articleApi.loadApiConfig 同时兼容环境变量 ARTICLE_API_TOKENS。
    if (own.length) return { entries: own };
    return { entries: articleApi.loadApiConfig().entries };
}

exports.auth = function (req, res, next) {
    var cfg = loadTokenConfig();
    if (!cfg.entries.length) {
        return res.status(503).json({
            success: false,
            msg: '公告发布接口未启用：请配置 ANNOUNCEMENT_API_TOKENS 或 ARTICLE_API_TOKENS'
        });
    }
    if (!articleApi.resolveToken(req, cfg)) {
        return res.status(401).json({ success: false, msg: 'API Token 无效或缺失' });
    }
    next();
};

exports.publish = function (req, res) {
    var b = req.body || {};
    var note = releaseNote.buildAnnouncement({
        commit: b.commit,
        subject: b.subject,
        body: b.body,
        author: b.author,
        date: b.date,
        repoUrl: b.repoUrl
    });
    if (!note) {
        return res.status(400).json({ success: false, msg: 'commit 格式非法，或该提交不属于新功能/优化升级公告范围' });
    }

    function duplicate(exist) {
        return res.json({
            success: true,
            duplicate: true,
            msg: '该提交已发布过公告',
            id: String(exist._id),
            name: exist.name
        });
    }

    Log.findByCommitHash(note.commitHash, function (err, exist) {
        if (err) {
            console.error('[announcementApi.publish] 查重失败：' + err.message);
            return res.status(500).json({ success: false, msg: '服务端错误' });
        }
        if (exist) return duplicate(exist);

        // 二次兜底：若管理员已用后台 CSV 导入过同一条公告（无 commitHash 字段），
        // 按标题识别，避免 API 与人工补发撞出两条同名公告。
        Log.findByName(note.name, function (nameErr, byName) {
            if (nameErr) {
                console.error('[announcementApi.publish] 标题查重失败：' + nameErr.message);
                return res.status(500).json({ success: false, msg: '服务端错误' });
            }
            if (byName) return duplicate(byName);

            publishNew();
        });
    });

    function publishNew() {
        Log.save(note, function (saveErr, saved) {
            if (saveErr || !saved) {
                console.error('[announcementApi.publish] 保存失败：' + (saveErr && saveErr.message));
                return res.status(500).json({ success: false, msg: '发布公告失败' });
            }
            return res.status(201).json({
                success: true,
                duplicate: false,
                msg: '公告已发布',
                id: String(saved._id),
                name: saved.name,
                commitHash: note.commitHash,
                url: '/log/detail?id=' + String(saved._id)
            });
        });
    }
};
