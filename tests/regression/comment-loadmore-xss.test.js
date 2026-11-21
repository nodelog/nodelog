'use strict';
/**
 * 回归用例：加载更多评论 XSS（去框架化重写后）
 *
 * 背景：`public/js/common.js` 的「加载更多评论」与「首屏评论」两条路径
 * 都经由 `commentItem(val)` 渲染，而 `commentItem` 必须用 `window.NL.esc()`
 * 转义 userName / createTime / comment。旧实现（jQuery 时代）曾在「加载更多」
 * 分支把 userName / comment 裸拼进 `.html()`，userName 来自 User.realName
 *（入库只 trim），cleanComment() 只净化正文管不到用户名 —— 注入
 * `<img src=x onerror=...>` 会真执行。
 *
 * 去框架化后 common.js 不再依赖 jQuery / layer，本测试随之改为：
 *   1) 直接调用真实 `commentItem`（XSS 转义 + 结构）；
 *   2) 在最小 DOM/fetch 沙箱里加载「真实整份 common.js」，触发真实的
 *      「.js-more-comment-btn」click handler，验证 append 行为（不重解析
 *      整个面板、保留首屏、末页只提示）；
 *   3) 源码级守门：不得出现旧 list-group-item 结构、加载更多必须用
 *      insertAdjacentHTML('beforeend') 追加、commentItem 三处插值都过 esc。
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

// 生产代码里稳定的函数定义（重构时若改名测试会跟着失败，符合预期）
const formatDef = slice(commonSrc, 'Date.prototype.format = function', '\n  function fmtCommentTime', 'Date.prototype.format');
const fmtDef = slice(commonSrc, 'function fmtCommentTime(v) {', '\n  var sessionUser', 'fmtCommentTime');
const commentItemDef = slice(commonSrc, 'function commentItem(val) {', '\n  function loadComments', 'commentItem');
const escDef = slice(footerSrc, '  function esc(s) {', '  var ICON = {', 'footer esc');

const MALICIOUS = {
  userName: '<img src=x onerror=window.__QA_XSS=1>',
  comment: '<script>window.__QA_XSS2=1</script> & "quoted"',
  createTime: '2026-01-02T10:30:00.000Z'
};
const NORMAL = {
  userName: '张三 & 李四',
  comment: 'a < b 的说法',
  createTime: '2026-01-02T10:30:00.000Z'
};

// 把 footer.ejs 真实的 esc 暴露为 window.NL.esc
function makeNL() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(escDef + '\nwindow.NL = { esc: esc };', sandbox);
  return sandbox.window.NL;
}

/* ---------------- 1) commentItem 直接调用：XSS 转义 + 结构 ---------------- */
test('B1：commentItem 转义恶意 userName / comment / 时间，不产生可执行标签', function () {
  const NL = makeNL();
  const ctx = { NL: NL, console: console };
  vm.createContext(ctx);
  vm.runInContext(formatDef + '\n' + fmtDef + '\n' + commentItemDef, ctx);

  const out = ctx.commentItem(MALICIOUS);
  assert.match(out, /&lt;img src=x onerror=window\.__QA_XSS=1&gt;/, '用户名应被转义为纯文本');
  assert.match(out, /&lt;script&gt;window\.__QA_XSS2=1&lt;\/script&gt;/, '正文中的 script 应被转义');
  assert.match(out, /&quot;quoted&quot;/, '双引号应被转义');
  assert.doesNotMatch(out, /<img\b/i, '不得出现真实 <img> 标签');
  assert.doesNotMatch(out, /<script\b/i, '不得出现真实 <script> 标签');
});

test('B1：commentItem 渲染结构正确（.comment-item / author / time / body）', function () {
  const NL = makeNL();
  const ctx = { NL: NL, console: console };
  vm.createContext(ctx);
  vm.runInContext(formatDef + '\n' + fmtDef + '\n' + commentItemDef, ctx);

  const out = ctx.commentItem(NORMAL);
  assert.match(out, /<div class="comment-item"><div class="comment-item-head">/);
  assert.match(out, /<span class="comment-author">张三 &amp; 李四<\/span>/);
  assert.match(out, /<time class="color-gray">\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}<\/time>/,
    'Date.prototype.format 必须可用（普通页不再单独加载 dataFormat.js）');
  assert.match(out, /<div class="comment-item-body">a &lt; b 的说法<\/div>/);
  assert.doesNotMatch(out, /list-group-item/, '不得出现旧结构');
});

test('B1：commentItem 三个插值点全部经过 NL.esc（源码级防回归）', function () {
  const escCount = (commentItemDef.match(/NL\.esc\(/g) || []).length;
  assert.ok(escCount >= 3, `commentItem 需要 3 处转义，实际 ${escCount} 处`);
  assert.doesNotMatch(commentItemDef, /\+\s*val\.userName\s*\+/, 'userName 不得裸拼');
  assert.doesNotMatch(commentItemDef, /\+\s*val\.comment\s*\+/, 'comment 不得裸拼');
  assert.doesNotMatch(commentItemDef, /\+\s*fmtCommentTime\(val\.createTime\)\s*\+/, '时间字段也不得裸拼');
});

/* ---------------- 2) 整份 common.js 沙箱：触发真实「加载更多」handler ---------------- */
function buildHarness(page1Resp, page2Resp) {
  // 单例元素：同一 selector 返回同一实例，使 loadComments 写入的 data-* 能被 handler 读到
  const elements = {};
  function makeEl(tag) {
    const el = {
      tagName: tag, _html: '', _adj: [], _attrs: {}, _classes: {},
      setAttribute(n, v) { this._attrs[n] = String(v); },
      getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null; },
      addEventListener() {}, removeEventListener() {}, appendChild() {},
      querySelector() { return null; }, querySelectorAll() { return []; },
      focus() {}, blur() {}, click() {},
      insertAdjacentHTML(pos, html) { this._adj.push(html); this._html += html; },
      style: {}, disabled: false, value: '', textContent: ''
    };
    el.classList = {
      add: (c) => { el._classes[c] = true; },
      remove: (c) => { delete el._classes[c]; },
      toggle: (c) => { if (el._classes[c]) { delete el._classes[c]; return false; } el._classes[c] = true; return true; },
      contains: (c) => !!el._classes[c]
    };
    Object.defineProperty(el, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; } });
    return el;
  }
  function getEl(sel) { if (!elements[sel]) elements[sel] = makeEl('div'); return elements[sel]; }

  const clickHandlers = [];
  const documentStub = {
    readyState: 'complete',
    addEventListener(type, fn) { if (type === 'click') clickHandlers.push(fn); },
    removeEventListener() {},
    querySelector(sel) { return getEl(sel); },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement(tag) { return makeEl(tag); },
    body: makeEl('body'),
    documentElement: makeEl('html'),
    contains() { return true; }
  };
  const NL = makeNL();
  // 其余 NL 方法在测试里只作占位
  NL.toast = function () {}; NL.alert = function () {}; NL.modal = function () {};
  NL.loading = function () {}; NL.closeAll = function () {}; NL.closeLayer = function () {};
  NL.state = function () { return '<div class="state"></div>'; };

  const fetchCalls = [];
  function route(url) {
    if (url.indexOf('/session') !== -1) return { user: { _id: 'u1' } };
    if (url.indexOf('/category/all') !== -1) return { docs: [] };
    if (url.indexOf('/log/count') !== -1) return { count: 0 };
    if (url.indexOf('/link/list') !== -1) return { success: true, data: [] };
    if (url.indexOf('/comment/all') !== -1) {
      if (url.indexOf('page=2') !== -1) return page2Resp;
      return page1Resp;
    }
    return {};
  }
  function fetchStub(url) {
    fetchCalls.push(url);
    const body = route(url);
    return Promise.resolve({ json: () => Promise.resolve(body) });
  }

  const sandbox = {
    window: {
      NL: NL, open() {}, addEventListener() {}, removeEventListener() {},
      scrollTo() {}, innerHeight: 800, pageYOffset: 0, screen: { width: 1280 }
    },
    document: documentStub,
    location: { href: 'http://localhost/content/detail?view=contentDetail&id=doc-qa-1' },
    NL: NL,
    fetch: fetchStub,
    URLSearchParams: URLSearchParams,
    setTimeout: setTimeout,
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(commonSrc, sandbox);

  return {
    sandbox: sandbox,
    elements: elements,
    getEl: getEl,
    fetchCalls: fetchCalls,
    clickHandlers: clickHandlers,
    flush() { return new Promise((res) => { let n = 0; (function tick() { if (++n > 25) return res(); setTimeout(tick, 0); })(); }); },
    triggerMore() {
      const btn = getEl('.js-more-comment-btn');
      const ev = { target: { closest: (s) => (s === '.js-more-comment-btn' ? btn : null) }, preventDefault() {} };
      clickHandlers.forEach((h) => h(ev));
    }
  };
}

test('B1：加载更多走真实 handler —— 追加（不重解析）、转义、保留首屏', async function () {
  const page1 = {
    docs: [{ userName: '正常用户A', comment: '第 1 页正常评论', createTime: '2026-01-01T10:00:00.000Z' }],
    page: 1, totalPage: 2, total: 2
  };
  const page2 = { docs: [MALICIOUS], page: 2, totalPage: 2, total: 2 };

  const h = buildHarness(page1, page2);
  await h.flush(); // 等 boot -> session -> init -> loadComments(1)

  const panel = h.elements['.js-comment-panel'];
  assert.ok(panel, '评论面板元素应存在');
  assert.match(panel.innerHTML, /第 1 页正常评论/, '首屏评论应已渲染');

  h.triggerMore();
  await h.flush(); // 等加载更多 fetch 完成

  const combined = panel.innerHTML;
  assert.match(combined, /第 1 页正常评论/, '首屏内容在「加载更多」后不得丢失');
  assert.match(combined, /&lt;img src=x onerror=window\.__QA_XSS=1&gt;/, '加载更多的恶意用户名应被转义');
  assert.match(combined, /&lt;script&gt;window\.__QA_XSS2=1&lt;\/script&gt;/, '加载更多的恶意正文应被转义');
  assert.doesNotMatch(combined, /<img\b/i, '不得出现真实 <img> 标签');
  assert.doesNotMatch(combined, /<script\b/i, '不得出现真实 <script> 标签');
  assert.match(combined, /<div class="comment-item">/, '追加内容应复用 .comment-item 结构');
  assert.ok(h.fetchCalls.some((u) => u.indexOf('/comment/all') !== -1 && u.indexOf('page=2') !== -1),
    '应当请求第 2 页评论');
});

test('B1：末页时「加载更多」不再发请求，只提示，且不清空已渲染评论', async function () {
  const page1 = {
    docs: [{ userName: '正常用户A', comment: '第 1 页正常评论', createTime: '2026-01-01T10:00:00.000Z' }],
    page: 1, totalPage: 2, total: 2
  };
  const h = buildHarness(page1, page1);
  await h.flush();

  const panel = h.elements['.js-comment-panel'];
  const beforeHtml = panel.innerHTML;
  const callsBefore = h.fetchCalls.length;

  // 模拟已翻到末页：把 data-page 调成与 totalPage 持平
  h.getEl('.js-more-comment-btn').setAttribute('data-page', '2');
  h.triggerMore();
  await h.flush();

  assert.equal(h.fetchCalls.length, callsBefore, '末页不应再发 /comment/all 请求');
  assert.equal(panel.innerHTML, beforeHtml, '不得清空已渲染评论');
});

test('B1：源码级守门 —— 无旧结构、追加用 insertAdjacentHTML、三处转义', function () {
  assert.doesNotMatch(commonSrc, /list-group-item/, '源码不应再有旧 list-group-item 结构');
  assert.match(commonSrc, /insertAdjacentHTML\('beforeend'/,
    '加载更多应追加到面板末尾，而非重新解析整个面板');
  assert.doesNotMatch(commonSrc, /\.js-comment-panel'\)\.innerHTML\s*=\s*html\s*\+/,
    '加载更多 handler 不得用 innerHTML = 已有 + 新 的方式重解析');
  const allEsc = (commonSrc.match(/NL\.esc\(/g) || []).length;
  // 直接数 commentItem 内的 esc（已在上一用例断言 >=3）；这里确认全文件转义器存在
  assert.ok(allEsc >= 3, `全文件至少应有 3 处 NL.esc 调用，实际 ${allEsc}`);
});
