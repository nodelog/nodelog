// 历史富文本（bootstrap-wysiwyg / contenteditable）HTML -> Markdown
// 用途一：编辑页打开老文章时即时转换（controllers/content.js findById）
// 用途二：scripts/migrate-html-to-md.js 批量迁移
// 说明：turndown@7.2.0 为纯 CJS（main: lib/turndown.cjs.js），兼容生产 Node 16；
//       用 DOM 解析而非正则，才能正确处理正文里被转义成实体的代码片段（如 &lt;div&gt;）。
var TurndownService = require('turndown');
var sanitizeHtml = require('sanitize-html');

var td = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined'
});

// bootstrap-wysiwyg 用 <div> 作为回车容器，默认规则会把相邻 div 粘成一坨。
td.addRule('wysiwygDiv', {
    filter: 'div',
    replacement: function (content) { return '\n\n' + content.trim() + '\n\n'; }
});

// 纯样式标签只保留文字，避免 <font>/<span>/<u> 变成多余的 Markdown 噪声
['font', 'span', 'u'].forEach(function (tag) {
    td.addRule('plain_' + tag, {
        filter: tag,
        replacement: function (content) { return content; }
    });
});

var allowedTags = sanitizeHtml.defaults.allowedTags.concat([
    'div', 'span', 'font', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'img', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'del', 's', 'hr', 'br'
]);

// 只识别「真的含 HTML 标签」的内容；纯文本里写了 <div> 字面量（已转义成 &lt;div&gt;）不算。
// 仅对 contentType != 'markdown' 的历史文档调用，不会误伤新文章。
exports.isHtml = function (src) {
    return /<\s*(div|p|br|span|font|h[1-6]|ul|ol|li|pre|table|a|img|b|strong|i|em)\b[^>]*>/i.test(String(src || ''));
};

exports.convert = function (html) {
    var src = String(html || '');
    if (!src) return '';
    // 先清脚本 / 事件处理器，避免把危险内容带进 Markdown（老 HTML 从未经 sanitize 直接渲染过）
    var clean = sanitizeHtml(src, {
        allowedTags: allowedTags,
        allowedAttributes: {
            a: ['href', 'title'],
            img: ['src', 'alt', 'title', 'width', 'height'],
            code: ['class'],
            pre: ['class'],
            td: ['colspan', 'rowspan'],
            th: ['colspan', 'rowspan']
        },
        allowedSchemes: ['http', 'https', 'mailto', 'data']
    });
    return td.turndown(clean)
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim() + '\n';
};
