/**
 * 站点更新公告（新功能 / 优化升级）的「唯一生成逻辑」：服务端 API 与本地 CLI 共用，
 * 保证同一 commit 在任何触发通道（git hook / CI / 手工补发）下生成的标题与正文完全一致。
 *
 * 纯函数模块：不 require settings / mongoose / express，便于单测。
 * 安全边界在服务端：所有来自 commit message 的文本一律转义后才拼进 HTML 正文，
 * 因为 /log/detail 模板用 <%- doc.content %> 原样输出 HTML。
 */
'use strict';

var FIELD = '\x1f';
var RECORD = '\x1e';

// conventional commits 的 feat / feature，兼容历史里的 "@ feat(admin): ..." 噪声前缀
var FEAT_RE = /^[@\s]*(?:feat|feature)\s*(?:\(([^)]*)\))?\s*[:：]\s*(.+)$/i;
// 中文写法：新增 / 新功能 / 上线 开头
var CN_FEAT_RE = /^[@\s]*(?:新增|新功能|上线)\s*[:：]?\s*(.+)$/;
// 优化类：重构 / 样式与体验升级 / 性能 / 明确的 optimize/ux 前缀
var OPT_RE = /^[@\s]*(?:refactor|style|perf|optimize|improvement|ux)\s*(?:\(([^)]*)\))?\s*[:：]\s*(.+)$/i;
// 中文优化关键词（不含单独的「调整」，避免把「调整代码格式」这类纯整理当公告）
var CN_OPT_RE = /优化|改进|升级|增强|精致化|重构|提升|简化|自适应|美化/;
// 明确排除的提交类型：缺陷修复、依赖/构建杂务、文档、文案、测试、合并
var EXCLUDE_RE = /^[@\s]*(?:fix|hotfix|chore|docs|doc|test|copy|ci|build|revert|merge|release)\s*(?:\([^)]*\))?\s*[:：]/i;

function limit(s, n) {
    return String(s == null ? '' : s).slice(0, n);
}

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 给提交分类：feature（新功能）/ optimization（优化升级）/ null（不发公告）。
 * 判定顺序固定：新功能 → 明确排除 → 英文优化前缀 → 中文优化关键词 → 自定义扩展。
 * feat 条目生成的标题与旧版完全一致（【新功能…】·短hash），保证历史 CSV 补发不重复。
 * @param {string} subject
 * @param {RegExp} [extra] 可选的自定义扩展规则（--pattern）
 * @returns {{kind:string, scope:string, text:string}|null}
 */
function classify(subject, extra) {
    var s = String(subject == null ? '' : subject).trim();
    var m = FEAT_RE.exec(s);
    if (m) return { kind: 'feature', scope: limit(m[1] || '', 30), text: limit(m[2], 200).trim() };
    m = CN_FEAT_RE.exec(s);
    if (m) return { kind: 'feature', scope: '', text: limit(m[1], 200).trim() };
    if (EXCLUDE_RE.test(s)) return null;
    m = OPT_RE.exec(s);
    if (m) return { kind: 'optimization', scope: limit(m[1] || '', 30), text: limit(m[2], 200).trim() };
    if (CN_OPT_RE.test(s)) return { kind: 'optimization', scope: '', text: limit(s, 200).trim() };
    if (extra instanceof RegExp) {
        extra.lastIndex = 0;
        if (extra.test(s)) return { kind: 'feature', scope: '', text: limit(s, 200).trim() };
    }
    return null;
}

/** 兼容旧调用：只问「是不是新功能」。 */
function featureOf(subject, extra) {
    var c = classify(subject, extra);
    return (c && c.kind === 'feature') ? { scope: c.scope, text: c.text } : null;
}

function labelOf(kind) {
    return kind === 'optimization' ? '优化升级' : '新功能';
}

function leadOf(kind) {
    return kind === 'optimization' ? '站点完成以下优化升级：' : '站点已上线以下新功能：';
}

/**
 * 解析 `git log --format=%H<FS>%an<FS>%aI<FS>%s<FS>%b<RS>` 的输出。
 * 用不可见控制字符分隔，避免 subject / body 里的换行、逗号、冒号破坏解析。
 */
function parseGitLog(stdout) {
    var out = [];
    String(stdout || '').split(RECORD).forEach(function (chunk) {
        var raw = chunk.replace(/^[\r\n]+/, '');
        if (!raw.trim()) return;
        var p = raw.split(FIELD);
        if (p.length < 4 || !/^[0-9a-f]{7,40}$/i.test(p[0])) return;
        out.push({
            commit: p[0],
            author: limit(p[1], 60).trim(),
            date: limit(p[2], 40).trim(),
            subject: limit(p[3], 300).trim(),
            body: limit(p.slice(4).join(FIELD), 4000).trim()
        });
    });
    return out;
}

// 只允许常规 https/http 仓库地址进 <a href>，其余一律不渲染链接
function safeRepoUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(s)) return '';
    return s.slice(0, 300);
}

/**
 * 由 commit 元数据构造落库对象。
 * @returns {{name:string, content:string, commitHash:string, status:number}|null}
 */
function buildAnnouncement(p) {
    if (!p || !/^[0-9a-f]{7,40}$/i.test(String(p.commit || ''))) return null;
    var info = classify(p.subject);
    if (!info || !info.text) return null;

    var hash = String(p.commit).toLowerCase();
    var short = hash.slice(0, 7);
    var title = '【' + labelOf(info.kind) + (info.scope ? '·' + info.scope : '') + '】' + info.text + ' · ' + short;
    var name = limit(title, 120);

    var repo = safeRepoUrl(p.repoUrl);
    var commitUrl = repo ? repo.replace(/\.git$/, '') + '/commit/' + hash : '';

    var html = '<p>' + leadOf(info.kind) + '</p>' +
        '<h3>' + esc(info.text) + '</h3>';

    if (p.body) {
        html += '<p>' + esc(limit(p.body, 1200)).replace(/\r?\n/g, '<br>') + '</p>';
    }
    html += '<ul>' +
        '<li>提交：<code>' + esc(short) + '</code></li>' +
        '<li>范围：' + esc(info.scope || '站点功能') + '</li>' +
        (p.author ? '<li>提交者：' + esc(limit(p.author, 60)) + '</li>' : '') +
        (p.date ? '<li>提交时间：' + esc(limit(p.date, 40)) + '</li>' : '') +
        '</ul>';
    if (commitUrl) {
        html += '<p><a href="' + esc(commitUrl) + '" target="_blank" rel="noopener noreferrer">查看本次代码变更</a></p>';
    }

    return {
        name: name,
        content: html,
        commitHash: hash,
        status: 0
    };
}

/**
 * 纯文本版正文：供「后台 CSV 批量导入」补发路径使用。
 * 后台 import 会去掉所有 HTML 标签，因此这里直接给无标签的单行文本。
 */
function buildPlainText(p) {
    var info = classify(p.subject);
    if (!info || !info.text) return '';
    var parts = [
        leadOf(info.kind) + info.text,
        '提交：' + String(p.commit).slice(0, 7),
        '范围：' + (info.scope || '站点功能')
    ];
    if (p.author) parts.push('提交者：' + limit(p.author, 60));
    if (p.date) parts.push('提交时间：' + limit(p.date, 40));
    if (p.body) parts.push('说明：' + limit(String(p.body).replace(/\s+/g, ' '), 400));
    return parts.join('；').replace(/[\r\n\t]/g, ' ');
}

module.exports = {
    FIELD: FIELD,
    RECORD: RECORD,
    GIT_FORMAT: '%H' + FIELD + '%an' + FIELD + '%aI' + FIELD + '%s' + FIELD + '%b' + RECORD,
    escapeHtml: esc,
    classify: classify,
    featureOf: featureOf,
    parseGitLog: parseGitLog,
    buildAnnouncement: buildAnnouncement,
    buildPlainText: buildPlainText
};
