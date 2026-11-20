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

// 剥离文末「> 来源：URL」溯源行：旧帮助站将关闭，该链接是死链，
// 数据层保留溯源信息，仅在渲染时隐藏，避免制造指向旧站的死链。
function stripSourceLine(src) {
    return String(src || '').replace(/^\s*>+\s*来源[：:]\s*https?:\/\/[^\s]*\s*$/gim, '');
}
exports.stripSourceLine = stripSourceLine;

// 将 Markdown 渲染为安全的 HTML（XSS 已由 sanitize-html 兜底）
exports.render = function (src) {
    if (!src) return '';
    var html = md.render(stripSourceLine(src));
    return sanitizeHtml(html, {
        allowedTags: allowedTags,
        allowedAttributes: allowedAttributes,
        transformTags: {
            'a': sanitizeHtml.simpleTransform('a', {rel: 'noopener noreferrer', target: '_blank'})
        }
    });
};

// 渲染并返回目录（TOC）：给 h2/h3 注入稳定 id（sec-N），供 Wiki 右侧「本页目录」锚点跳转。
// html=false 已禁止原始 HTML 注入，id 由服务端生成，安全；sanitize 白名单放行 heading 的 id。
exports.renderWithToc = function (src) {
    if (!src) return {html: '', toc: []};
    var toc = [], counter = 0;
    // 用 markdown-it 的 renderer rule 在标题 token 上加 id
    var render = md.renderer.rules.heading_open;
    md.renderer.rules.heading_open = function (tokens, idx, options, env, self) {
        var token = tokens[idx];
        var level = token.tag; // h1..h6
        if (level === 'h2' || level === 'h3') {
            var id = 'sec-' + (++counter);
            token.attrSet('id', id);
            // 取该标题的内联文本作为目录文字
            var text = '';
            var inline = tokens[idx + 1];
            if (inline && inline.children) {
                inline.children.forEach(function (c) { if (c.content) text += c.content; });
            }
            toc.push({id: id, level: Number(level.slice(1)), text: String(text).trim().slice(0, 60)});
        }
        return render ? render(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    };
    try {
        var html = md.render(stripSourceLine(src));
        return {html: sanitizeRender(html), toc: toc};
    } finally {
        // 还原 rule，避免影响其它 render 调用（模块单例）
        md.renderer.rules.heading_open = render;
    }
};

function sanitizeRender(html) {
    var attrs = Object.assign({}, allowedAttributes);
    attrs.h2 = ['id']; attrs.h3 = ['id'];
    return sanitizeHtml(html, {
        allowedTags: allowedTags,
        allowedAttributes: attrs,
        transformTags: {
            'a': sanitizeHtml.simpleTransform('a', {rel: 'noopener noreferrer', target: '_blank'})
        }
    });
}

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

// 全文检索派生纯文本（供 buildFields 与回填脚本共用同一口径，避免两套实现漂移）。
// 与 excerpt 的区别：不截断、并剥离 HTML 标签与常见实体——因为历史正文可能是富文本。
// 输出只用于 text 索引算相关度，永不作为正文渲染，故可放心激进去标记。
//
// 关键：不能靠 contentType 判定是否剥标签。历史文档（如 2015 年的文章）根本没有
// contentType 字段，若只在 contentType==='html' 时剥离，会把 <p style=...> 原样写进
// searchBody，污染索引。改为「先剥代码块，再无条件剥 HTML 标签」：代码块先移除，
// 避免把代码里的 < > 当标签；正文里出现的标签一律剥掉，与正文格式无关。
exports.toSearchBody = function (src, contentType) {
    var text = String(src == null ? '' : src);
    // 1) 先移除代码块（含 ``` 围栏），避免代码里的比较符 < > 被误当标签
    text = text.replace(/```[\s\S]*?```/g, ' ');
    // 2) HTML 实体先还原为字符：这样 &lt;tag&gt; 会变成 <tag> 并在下一步被当作标签剥掉，
    //    而不是把尖括号原样带进索引。&amp; 还原出的 & 是普通文本，不影响标签剥离。
    text = text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&'); // &amp; 放最后，避免 &lt; 里的 & 被提前还原干扰
    // 3) 无条件剥离 HTML 标签：标准标签（可含属性/引号）
    text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
    // 4) 畸形/残缺标签（如老编辑器留下的 <u<strike<i<b 而无 >）：剥掉裸的 <tag 与 </tag
    text = text.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*/g, ' ');
    // 5) 共用 excerpt 的 Markdown 标记剥离 + 空白归一（不传 len 即不截断）
    return exports.excerpt(text);
};
