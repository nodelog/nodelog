/**
 * 新功能公告的「唯一生成逻辑」：服务端 API 与本地 CLI 共用，保证同一 commit
 * 在任何触发通道（git hook / CI / 手工补发）下生成的标题与正文完全一致。
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
 * 判断一条 commit subject 是否属于「新功能」。
 * @param {string} subject
 * @param {RegExp} [extra] 可选的自定义扩展规则（--pattern）
 * @returns {{scope:string, text:string}|null}
 */
function featureOf(subject, extra) {
    var s = String(subject == null ? '' : subject).trim();
    var m = FEAT_RE.exec(s);
    if (m) return { scope: limit(m[1] || '', 30), text: limit(m[2], 200).trim() };
    m = CN_FEAT_RE.exec(s);
    if (m) return { scope: '', text: limit(m[1], 200).trim() };
    if (extra instanceof RegExp) {
        extra.lastIndex = 0;
        if (extra.test(s)) return { scope: '', text: limit(s, 200).trim() };
    }
    return null;
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
    var info = featureOf(p.subject);
    if (!info || !info.text) return null;

    var hash = String(p.commit).toLowerCase();
    var short = hash.slice(0, 7);
    var title = '【新功能' + (info.scope ? '·' + info.scope : '') + '】' + info.text + ' · ' + short;
    var name = limit(title, 120);

    var repo = safeRepoUrl(p.repoUrl);
    var commitUrl = repo ? repo.replace(/\.git$/, '') + '/commit/' + hash : '';

    var html = '<p>站点已上线以下新功能：</p>' +
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
    var info = featureOf(p.subject);
    if (!info || !info.text) return '';
    var parts = [
        '站点已上线以下新功能：' + info.text,
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
    featureOf: featureOf,
    parseGitLog: parseGitLog,
    buildAnnouncement: buildAnnouncement,
    buildPlainText: buildPlainText
};
