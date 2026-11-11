'use strict';
/**
 * 回归用例：加载更多评论 XSS（QA Phase 4 · B1）
 *
 * 背景：`public/js/common.js` 的 `.js-more-comment-btn` handler 曾把
 * `val.userName` / `val.comment` 裸拼进 `.html()`。`userName` 来自
 * `User.realName`（`controllers/user.js` 入库只 trim），`cleanComment()`
 * 只净化评论正文，管不到用户名 —— 注入 `<img src=x onerror=...>` 会真执行。
 * 主渲染 `loadComments()` 已用 `window.NL.esc()`，此路径漏了。
 *
 * 本测试不新增任何依赖：用 node:test + node:vm，把**真实源码片段**
 * （common.js 的 Date.prototype.format / 更多评论 handler、footer.ejs 的 esc）
 * 抽出来在最小 jQuery 桩里执行，避免测试与实现各自漂移。
 *
 * 运行：node --test tests/regression/comment-loadmore-xss.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const commonSrc = fs.readFileSync(path.join(ROOT, 'public/js/common.js'), 'utf8');
const footerSrc = fs.readFileSync(path.join(ROOT, 'views/footer.ejs'), 'utf8');

function slice(src, startMark, endMark, label) {
  const s = src.indexOf(startMark);
  assert.ok(s >= 0, `找不到「${label}」起始标记：${startMark}`);
  const e = src.indexOf(endMark, s + startMark.length);
  assert.ok(e > s, `找不到「${label}」结束标记：${endMark}`);
  return src.slice(s, e);
}

// 生产代码的三块真实片段，任何一处被改坏，测试都会跟着变
const formatDef = slice(commonSrc, '//日期格式化', '//jquery函数', 'Date.prototype.format');
const handlerSrc = slice(commonSrc, '    //更多评论', '    //评论触发登录', '更多评论 handler');
const fmtDef = slice(commonSrc, '    function fmtCommentTime(v) {', '    //更多评论', 'fmtCommentTime');
const escDef = slice(footerSrc, '  function esc(s) {', '  var ICON = {', 'footer esc');

const FIRST_PAGE_HTML =
  '<div class="comment-item"><div class="comment-item-body">第 1 页正常评论</div></div>';

/**
 * 最小 jQuery 桩：只实现「更多评论」handler 实际调用到的 API。
 * 返回可观测的 dom / data，便于断言副作用。
 */
function createHarness(response, opts) {
  opts = opts || {};
  const dom = { panelHtml: FIRST_PAGE_HTML, hidden: false, msg: null, getCalls: [] };
  const data = {
    'data-page': String(opts.page || 1),
    'data-totalPage': String(opts.totalPage || 2),
    'data-id': 'doc-qa-1'
  };
  const btnElement = { __qaMoreCommentBtn: true };
  let clickHandler = null;

  function $(arg) {
    const isBtn = arg === btnElement || arg === '.js-more-comment-btn';
    const isPanel = arg === '.js-comment-panel';
    const isMore = arg === '.js-more-comment';
    const stub = {
      click(fn) { if (isBtn) clickHandler = fn; return stub; },
      attr(name, value) {
        if (isBtn) {
          if (arguments.length === 1) return data[name];
          data[name] = String(value);
        }
        return stub;
      },
      addClass(cls) { if (isMore && cls === 'hide') dom.hidden = true; return stub; },
      removeClass() { return stub; },
      html(v) {
        if (isPanel) {
          if (v === undefined) return dom.panelHtml;
          dom.panelHtml = v;
        }
        return stub;
      },
      append(v) { if (isPanel) dom.panelHtml += v; return stub; },
      on() { return stub; },
      each() { return stub; },
      find() { return stub; },
      val() { return ''; },
      text() { return ''; },
      prop() { return stub; },
      length: 0
    };
    return stub;
  }

  $.get = function (url, params, cb) {
    dom.getCalls.push({ url: url, params: params });
    if (cb) cb(response);
    return { fail: function () { return this; } };
  };
  $.each = function (arr, fn) {
    (arr || []).forEach(function (v, i) { fn(i, v); });
  };

  const sandbox = {
    window: { NL: {} },
    console: console,
    $: $,
    myMsg: function (m) { dom.msg = m; }
  };
  vm.createContext(sandbox); // Date / String / RegExp 等由 vm 上下文自带，不污染宿主全局
  vm.runInContext(formatDef, sandbox);
  vm.runInContext(fmtDef, sandbox);
  vm.runInContext(escDef + '\nwindow.NL = { esc: esc };', sandbox);
  vm.runInContext(handlerSrc, sandbox);

  return {
    sandbox: sandbox,
    dom: dom,
    data: data,
    click: function () {
      assert.ok(clickHandler, '未捕获到 .js-more-comment-btn 的 click handler');
      clickHandler.call(btnElement);
    }
  };
}

const MALICIOUS = {
  docs: [{
    userName: '<img src=x onerror=window.__QA_XSS=1>',
    comment: '<script>window.__QA_XSS2=1</script> & "quoted"',
    createTime: '2026-01-02T10:30:00.000Z'
  }],
  page: 2,
  totalPage: 2,
  total: 2
};

test('B1：恶意 userName / comment 被转义，不产生可执行标签', function () {
  const h = createHarness(MALICIOUS);
  h.click();
  const out = h.dom.panelHtml;

  assert.match(out, /&lt;img src=x onerror=window\.__QA_XSS=1&gt;/, '用户名应被转义为纯文本');
  assert.match(out, /&lt;script&gt;window\.__QA_XSS2=1&lt;\/script&gt;/, '正文中的 script 应被转义');
  assert.match(out, /&quot;quoted&quot;/, '双引号应被转义');
  assert.doesNotMatch(out, /<img\b/i, '不得出现真实 <img> 标签');
  assert.doesNotMatch(out, /<script\b/i, '不得出现真实 <script> 标签');
  assert.equal(h.sandbox.window.__QA_XSS, undefined, '不得执行 onerror 里的脚本');
  assert.equal(h.sandbox.window.__QA_XSS2, undefined, '不得执行 <script> 里的脚本');
});

test('B1：追加结构与主渲染 loadComments() 一致（.comment-item，不再是 list-group-item）', function () {
  const h = createHarness(MALICIOUS);
  h.click();
  const out = h.dom.panelHtml;

  assert.match(out, /<div class="comment-item"><div class="comment-item-head">/);
  assert.match(out, /<span class="comment-author">/);
  assert.match(out, /<time class="color-gray">/);
  assert.match(out, /<div class="comment-item-body">/);
  assert.doesNotMatch(out, /list-group-item/, '旧结构会让追加后视觉跳变');
  assert.doesNotMatch(handlerSrc, /list-group-item/, '源码里也不该再有旧结构');
});

test('B1：append 保留已渲染的第 1 页内容，且不重新解析整个面板', function () {
  const h = createHarness(MALICIOUS);
  h.click();
  const out = h.dom.panelHtml;

  assert.match(out, /第 1 页正常评论/, '失败/翻页时原数据不许消失');
  assert.ok(
    out.indexOf('第 1 页正常评论') < out.indexOf('&lt;img'),
    '新评论应追加在已有内容之后'
  );
  assert.doesNotMatch(handlerSrc, /\.html\(\$\('\.js-comment-panel'\)\.html\(\)\s*\+\s*html\)/,
    '不应再用 .html(existing + html) 重新解析');
  assert.equal(h.dom.hidden, true, '已到最后一页时隐藏「更多评论」');
});

test('B1：三个插值点全部经过 window.NL.esc（源码级防回归）', function () {
  const escCalls = (handlerSrc.match(/window\.NL\.esc\(/g) || []).length;
  assert.ok(escCalls >= 3, `更多评论 handler 需要 3 处转义，实际 ${escCalls} 处`);
  assert.doesNotMatch(handlerSrc, /\+\s*val\.userName\s*\+/, 'userName 不得裸拼');
  assert.doesNotMatch(handlerSrc, /\+\s*val\.comment\s*\+/, 'comment 不得裸拼');
  assert.doesNotMatch(
    handlerSrc,
    /'\s*\+\s*new Date\(val\.createTime\.toLocaleString\(\)\)\.format\(\)\s*\+/,
    '时间字段也不得裸拼'
  );
  assert.ok(
    (commonSrc.match(/window\.NL\.esc\(/g) || []).length >= 6,
    '主渲染与更多评论应共用同一套转义器，不得只修一半'
  );
});

test('功能不回归：正常中文评论按结构渲染，日期仍走 common.js:52 的 Date.prototype.format', function () {
  const h = createHarness({
    docs: [{
      userName: '张三 & 李四',
      comment: 'a < b 的说法',
      createTime: '2026-01-02T10:30:00.000Z'
    }],
    page: 2, totalPage: 3, total: 3
  }, { page: 1, totalPage: 3 });
  h.click();
  const out = h.dom.panelHtml;

  assert.match(out, /<span class="comment-author">张三 &amp; 李四<\/span>/);
  assert.match(out, /<div class="comment-item-body">a &lt; b 的说法<\/div>/);
  assert.match(out, /<time class="color-gray">\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}<\/time>/,
    'Date.prototype.format 必须可用（普通页已不加载 dataFormat.js）');
  assert.equal(h.dom.getCalls.length, 1);
  assert.equal(h.dom.getCalls[0].url, '/comment/all');
  assert.equal(h.dom.getCalls[0].params.page, 2, '应请求第 2 页');
  assert.equal(h.dom.getCalls[0].params.cententId, 'doc-qa-1');
  assert.equal(h.data['data-page'], '2', '还有后续页时应推进 data-page');
  assert.equal(h.dom.hidden, false);
});

test('边界：已到最后一页时不再发请求，只提示', function () {
  const h = createHarness(MALICIOUS, { page: 2, totalPage: 2 });
  h.click();
  assert.equal(h.dom.getCalls.length, 0);
  assert.equal(h.dom.msg, '没有更多的评论了');
  assert.equal(h.dom.panelHtml, FIRST_PAGE_HTML, '不得清空已渲染评论');
});

test('边界：docs 为空时不清空已渲染内容', function () {
  const h = createHarness({ docs: [], page: 2, totalPage: 2, total: 1 });
  h.click();
  assert.equal(h.dom.panelHtml, FIRST_PAGE_HTML);
});
