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

// 纯文本摘要（去掉 Markdown 标记），用于列表/分享卡片
exports.excerpt = function (src, len) {
    var text = String(src || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/[#>*_`~\[\]()!-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (len && text.length > len) text = text.slice(0, len) + '…';
    return text;
};
