var MarkdownIt = require('markdown-it');
var sanitizeHtml = require('sanitize-html');

var md = new MarkdownIt({html: false, linkify: true, breaks: true, typographer: true});

var allowedTags = sanitizeHtml.defaults.allowedTags.concat([
    'img', 'h1', 'h2', 'h3', 'h4', 'pre', 'code', 'table', 'thead', 'tbody',
    'tr', 'th', 'td', 'del', 'input', 'span'
]);
var allowedAttributes = Object.assign({}, sanitizeHtml.defaults.allowedAttributes, {
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    code: ['class'],
    span: ['class'],
    pre: ['class']
});

// 将 Markdown 渲染为安全的 HTML（XSS 已由 sanitize-html 兜底）
exports.render = function (src) {
    if (!src) return '';
    var html = md.render(String(src));
    return sanitizeHtml(html, {
        allowedTags: allowedTags,
        allowedAttributes: allowedAttributes,
        transformTags: {
            'a': sanitizeHtml.simpleTransform('a', {rel: 'noopener noreferrer', target: '_blank'})
        }
    });
};

// 仅做 HTML 清洗（不渲染），供开放文章 API 在存储 html 格式正文前兜底 XSS。
// 与 render 共用同一份白名单，保证「存进去的」和「渲染出来的」安全口径一致。
exports.sanitize = function (src) {
    if (!src) return '';
    return sanitizeHtml(String(src), {
        allowedTags: allowedTags,
        allowedAttributes: allowedAttributes,
        transformTags: {
            'a': sanitizeHtml.simpleTransform('a', {rel: 'noopener noreferrer', target: '_blank'})
        }
    });
};

// 纯文本摘要（去掉 Markdown 标记），用于列表/分享卡片
exports.excerpt = function (src, len) {    var text = String(src || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/[#>*_`~\[\]()!-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (len && text.length > len) text = text.slice(0, len) + '…';
    return text;
};

// 全文检索派生纯文本（供 buildFields 与回填脚本共用同一口径，避免两套实现漂移）。
// 与 excerpt 的区别：不截断、并额外剥离 HTML 标签与常见实体——因为历史正文可能是富文本。
// 输出只用于 text 索引算相关度，永不作为正文渲染，故可放心激进去标记。
exports.toSearchBody = function (src, contentType) {
    var text = String(src == null ? '' : src);
    if (contentType === 'html') {
        text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    } else {
        text = text.replace(/```[\s\S]*?```/g, ' ');
    }
    // 共用 excerpt 的 Markdown 标记剥离 + 空白归一（不传 len 即不截断）
    return exports.excerpt(text);
};
