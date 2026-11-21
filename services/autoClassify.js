/**
 * 服务端自动分类 + 自动标签（供开放文章发布 API 在 category / tags 为空时复用）。
 *
 * 分类匹配与前端 `public/js/common.js` 的 `matchCategory` 同源：分类【名称】命中绝对主导，
 * 其次该分类的 `keywords` 触发词，最后内置别名词典 `CATEGORY_ALIAS` 兜底（用户给分类配了
 * keywords 则以用户配置为准）。保证开放 API 与后台编辑器语义一致、零漂移。
 *
 * 标签提取为轻量无依赖分词：拉丁/数字词（长度>=3）+ 中文连续段 bigram（长度<=4 的整词额外加权），
 * 按词频 + 标题加权取 TopN。质量有限、可能产出噪声标签（已在产品层面确认接受）。
 *
 * 保持项目风格：CommonJS + var + 纯同步函数（不引入任何新依赖）。
 */
'use strict';

// 内置别名/触发词兜底词典（与前端一致）：分类未单独配置 keywords 时，按【名称】命中下列同义触发词。
var CATEGORY_ALIAS = {
    'ui': ['界面', '前端', '交互', '用户体验', 'ux', 'ui设计', '原型', '视觉'],
    '前端': ['frontend', 'js', 'javascript', 'css', 'html', '网页', 'web前端', '浏览器', 'vue', 'react'],
    '后端': ['backend', '服务端', 'server', 'api', '接口', '微服务'],
    '运维': ['devops', '部署', '服务器', 'linux', 'docker', 'k8s', 'kubernetes', '监控', 'ci', 'cdn', 'nginx'],
    '数据库': ['db', 'mysql', 'mongodb', 'redis', 'sql', 'nosql', 'postgres'],
    '算法': ['algorithm', '数据结构', 'leetcode', '刷题'],
    '人工智能': ['ai', '机器学习', '深度学习', 'ml', 'llm', '大模型', '神经网络', 'gpt'],
    '安全': ['security', '漏洞', 'xss', 'csrf', '注入', '加密', '渗透'],
    '移动端': ['android', 'ios', 'app', '小程序', '移动开发', 'flutter'],
    '工具': ['tool', '效率', '插件', '脚本', 'cli', '命令行', 'ide'],
    '架构': ['architecture', '系统设计', '高可用', '分布式', '微服务'],
    '网络': ['network', 'http', 'tcp', 'dns', '协议']
};

// 停用词（中文功能词 + 常见英文）：命中直接丢弃，降低噪声标签。
var STOPWORDS = {};
(function () {
    var zh = '的,了,和,是,在,我,你,他,她,它,我们,你们,他们,这,那,这个,那个,一个,一些,可以,如何,怎么,什么,为什么,' +
        '因为,所以,但是,如果,对于,通过,以及,或者,进行,使用,需要,已经,可能,应该,这样,那样,这些,那些,不是,就是,' +
        '还是,没有,有着,自己,这里,那里,现在,然后,之后,之前,这种,那种,一种,不会,不能,自己,一直,一直,有着,只是,' +
        '被,把,让,给,与,及,或,等,之,其,此,该,各,诸,并,且,而,则,于,以,为,从,到,向,对,关于,由于,根据,按照,比如,' +
        '例如,包括,主要,一般,通常,目前,一直,不会,不能,都,也,就,还,很,更,最,有着,这样,那样,一个,没有';
    zh.split(',').forEach(function (w) { if (w) STOPWORDS[w] = true; });
    var en = 'the,a,an,and,or,but,if,then,for,to,of,in,on,at,by,with,from,as,is,are,was,were,be,been,being,' +
        'this,that,these,those,it,its,we,you,they,he,she,i,my,your,our,their,not,no,yes,do,does,did,has,have,had,' +
        'will,would,can,could,should,may,might,must,about,into,over,under,out,up,down,also,very,more,most,such,' +
        'than,there,here,when,where,which,who,whom,how,what,why,all,any,each,both,etc,via,per,vs';
    en.split(',').forEach(function (w) { if (w) STOPWORDS[w] = true; });
})();

// ---------------------------------------------------------------------------
// 语义分类匹配：从已有分类中挑最相关的一个。categories 为 Category.findAll 的结果数组，
// 每个元素需含 name（必填）、keywords（可选）与 parent（可选，二级分类指向父级 id）。
// 二级架构约定：父子同分/同相关度时，优先更具体的二级（叶子）分类。
// ---------------------------------------------------------------------------
function matchCategory(categories, title, content) {
    if (!categories || !categories.length) return null;
    var titleLow = (title || '').toLowerCase();
    var textLow = ((title || '') + '\n' + (content || '')).toLowerCase();
    var best = null, bestScore = 0, bestParent = null;
    categories.forEach(function (c) {
        var name = (c.name || '').trim().toLowerCase();
        if (!name || name.length < 2) return;               // 跳过过短分类名，降低误命中
        var terms = [];
        var kwRaw = (c.keywords || '').trim();
        if (kwRaw) {
            kwRaw.split(/[,，\s]+/).forEach(function (s) { var t = s.trim().toLowerCase(); if (t) terms.push(t); });
        } else if (CATEGORY_ALIAS[name]) {
            CATEGORY_ALIAS[name].forEach(function (t) { terms.push(t.toLowerCase()); });
        }
        // 超短拉丁缩写（UI/API/DB/JS/CSS 等）：区分度极低，仅在标题命中才参与，正文忽略
        var isShortLatin = /^[a-z0-9]+$/.test(name) && name.length <= 3;
        var score = 0;
        var nameTitle = titleLow.indexOf(name) !== -1;
        var nameBody = textLow.indexOf(name) !== -1;
        if (!(isShortLatin && !nameTitle)) {
            if (nameTitle) score += 50;
            else if (nameBody) score += 1;
        }
        terms.forEach(function (t) {
            if (!t) return;
            var tTitle = titleLow.indexOf(t) !== -1;
            var tBody = textLow.indexOf(t) !== -1;
            if (t.length >= 2) {
                if (tTitle) score += 30;
                if (tBody) score += 8;
            } else {
                if (tTitle) score += 30;                     // 极短触发词只在标题命中
            }
        });
        var cParent = c.parent ? String(c.parent) : null;
        if (score > bestScore) {
            bestScore = score; best = c; bestParent = cParent;
        } else if (score === bestScore && score > 0 && !bestParent && cParent) {
            // 父子同分：优先更具体的二级（叶子）分类，贴合「发布选二级」的站点约定
            best = c; bestParent = cParent;
        }
    });
    return bestScore > 0 ? best : null;
}

// ---------------------------------------------------------------------------
// 正文转纯文本：html 去标签；markdown 去代码块/链接/标题/强调等噪音。
// ---------------------------------------------------------------------------
function plainText(content, contentType) {
    if (!content) return '';
    var s = String(content);
    if (contentType === 'html') {
        s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/&#\d+;/g, ' ');
    } else {
        s = s.replace(/```[\s\S]*?```/g, ' ')
            .replace(/`[^`]*`/g, ' ')
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/^#{1,6}\s+/gm, ' ')
            .replace(/[*_>#~=\-]+/g, ' ');
    }
    return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// 轻量标签提取：拉丁词(length>=3) + 中文 bigram（<=4 字整词额外加权），按词频 + 标题加权取 TopN。
//   title/content 为原文；contentType 决定去噪方式；maxTags 默认 5。
// ---------------------------------------------------------------------------
function extractTags(title, content, contentType, maxTags) {
    maxTags = maxTags || 5;
    var text = plainText(content, contentType);
    var titleLow = (title || '').toLowerCase();
    var corpus = ((title || '') + '\n' + text).toLowerCase();
    var freq = {};

    function add(term, weight) {
        term = (term || '').trim();
        if (!term) return;
        if (STOPWORDS[term]) return;
        if (/^[\d.]+$/.test(term)) return;                   // 纯数字不要
        if (/^[a-z0-9]$/i.test(term)) return;                // 单字符拉丁不要
        freq[term] = (freq[term] || 0) + weight;
    }

    // 1) 正文词频（权重 1）
    var latin = corpus.match(/[a-z0-9][a-z0-9+#.\-]{2,}/g) || [];
    latin.forEach(function (w) { add(w, 1); });
    var cjkRuns = corpus.match(/[一-龥]+/g) || [];
    cjkRuns.forEach(function (run) {
        if (run.length === 1) return;
        if (run.length <= 4) add(run, 3);                    // 短整词加权
        for (var i = 0; i + 2 <= run.length; i++) add(run.substr(i, 2), 1); // bigram
    });

    // 2) 标题命中额外加权（权重 +3），让标题里的关键词更优先
    var titleLatin = titleLow.match(/[a-z0-9][a-z0-9+#.\-]{2,}/g) || [];
    titleLatin.forEach(function (w) { add(w, 3); });
    var titleCjk = titleLow.match(/[一-龥]+/g) || [];
    titleCjk.forEach(function (run) {
        if (run.length === 1) return;
        if (run.length <= 4) add(run, 9);
        for (var i = 0; i + 2 <= run.length; i++) add(run.substr(i, 2), 3);
    });

    var arr = Object.keys(freq).map(function (k) { return { t: k, s: freq[k] }; });
    arr.sort(function (a, b) { return b.s - a.s; });
    return arr.slice(0, maxTags).map(function (x) { return x.t; });
}

exports.matchCategory = matchCategory;
exports.extractTags = extractTags;
exports.CATEGORY_ALIAS = CATEGORY_ALIAS;
