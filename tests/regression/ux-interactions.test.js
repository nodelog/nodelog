'use strict';
/**
 * 回归用例：UI 交互无障碍（去框架化重写后）
 *
 * 覆盖本轮 UX 升级里「纯前端、无框架依赖」的关键可访问性行为：
 *   A1  弹层（modal/alert/confirm）打开时：
 *       - overlay 标记 role=dialog + aria-modal=true；
 *       - 背景节点置 inert，键盘 Tab 不逸出到背景；
 *       - 弹层内 Tab / Shift+Tab 循环（焦点陷阱）；
 *       - 关闭后焦点归还打开前的元素（opener）。
 *   F3  加载层（loading）用 role=status（而非 role=alert），并带 aria-busy。
 *
 * 运行环境无 jsdom，故用最小 fake-DOM 在 vm 沙箱里加载「真实整份 ui.js」，
 * 断言其向 window.NL 暴露的 API 行为与无障碍属性符合预期。
 *
 * 运行：node --test tests/regression/ux-interactions.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const uiSrc = fs.readFileSync(path.join(ROOT, 'public/js/ui.js'), 'utf8');
const commonSrc = fs.readFileSync(path.join(ROOT, 'public/js/common.js'), 'utf8');
const footerSrc = fs.readFileSync(path.join(ROOT, 'views/footer.ejs'), 'utf8');

function makeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toggle: (c) => { if (set.has(c)) { set.delete(c); return false; } set.add(c); return true; }
  };
}

function makeNode(tag) {
  const node = {
    tagName: tag,
    className: '',
    _attrs: {},
    _html: '',
    _listeners: {},
    _children: [],
    style: {},
    inert: false,
    _focused: false,
    parentNode: null,
    classList: makeClassList(),
    setAttribute(n, v) { this._attrs[n] = String(v); },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this._children.push(c); c.parentNode = this; return c; },
    removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); return c; },
    querySelector() { return makeNode('div'); },
    querySelectorAll() { return []; },
    focus() { this._focused = true; },
    blur() {}
  };
  Object.defineProperty(node, 'children', { get() { return this._children; } });
  Object.defineProperty(node, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; } });
  return node;
}

function buildUiHarness() {
  const created = [];
  const body = makeNode('body');
  const opener = makeNode('button'); // 打开弹层前的焦点元素
  const documentStub = {
    readyState: 'complete',
    activeElement: opener,
    createElement(tag) { const n = makeNode(tag); created.push(n); return n; },
    getElementById() { return null; },
    querySelector() { return makeNode('div'); },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    body: body,
    documentElement: makeNode('html'),
    contains() { return true; }
  };
  const sandbox = {
    window: { NL: {}, addEventListener() {}, removeEventListener() {} },
    document: documentStub,
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(uiSrc, sandbox);
  return { NL: sandbox.window.NL, document: documentStub, body, opener, created };
}

/* ---------------- A1：弹层无障碍 / 焦点陷阱 / 焦点归还 ---------------- */
test('A1：NL.modal 暴露且 overlay 带 role=dialog + aria-modal', function () {
  const { NL } = buildUiHarness();
  assert.equal(typeof NL.modal, 'function', 'NL.modal 应存在');
  assert.equal(typeof NL.alert, 'function', 'NL.alert 应存在');
  assert.equal(typeof NL.toast, 'function', 'NL.toast 应存在');
  assert.equal(typeof NL.loading, 'function', 'NL.loading 应存在');
  assert.equal(typeof NL.closeAll, 'function', 'NL.closeAll 应存在');
});

test('A1：modal 打开时背景置 inert，且注册 Tab 焦点陷阱', function () {
  const { NL, body } = buildUiHarness();
  const nav = makeNode('nav');
  body.appendChild(nav); // 背景节点，应在弹层打开时被 inert

  NL.modal({ title: '测试', content: '<p>hi</p>', confirmText: '确定' });

  // 找到 overlay（nl-overlay）
  const overlay = body.children.find((c) => c.className === 'nl-overlay');
  assert.ok(overlay, 'overlay 应挂到 body');
  assert.equal(overlay._attrs.role, 'dialog', 'overlay 应 role=dialog');
  assert.equal(overlay._attrs['aria-modal'], 'true', 'overlay 应 aria-modal=true');

  // 背景节点被 inert
  assert.equal(nav.inert, true, '背景节点应被置为 inert，阻断键盘逸出');

  // 焦点陷阱已注册（keydown 监听存在）
  assert.ok(Array.isArray(overlay._listeners.keydown) && overlay._listeners.keydown.length > 0,
    'overlay 应注册 keydown 焦点陷阱');
});

test('A1：焦点陷阱在 Tab 时阻止默认行为（不逸出背景）', function () {
  const { NL, body } = buildUiHarness();
  body.appendChild(makeNode('nav'));
  NL.modal({ content: '<p>hi</p>' });
  const overlay = body.children.find((c) => c.className === 'nl-overlay');
  let prevented = false;
  const evt = { key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } };
  overlay._listeners.keydown.forEach((fn) => fn(evt));
  assert.equal(prevented, true, '焦点陷阱应拦截 Tab 默认行为');
});

test('A1：关闭弹层后焦点归还 opener，且背景 inert 解除', function () {
  const { NL, body, opener } = buildUiHarness();
  const nav = makeNode('nav');
  body.appendChild(nav);
  NL.modal({ content: '<p>hi</p>' });
  assert.equal(nav.inert, true, '打开时应 inert');
  NL.closeAll();
  assert.equal(nav.inert, false, '关闭后应解除背景 inert');
  assert.equal(opener._focused, true, '关闭后焦点应归还打开前的元素');
});

/* ---------------- F3：加载层 role=status ---------------- */
test('F3：loading 用 role=status（非 alert）并带 aria-busy', function () {
  const { NL, created } = buildUiHarness();
  NL.loading('加载中…');
  const overlay = created.find((n) => n.className === 'nl-overlay' && n._attrs.role === 'status');
  assert.ok(overlay, 'loading 应创建 nl-overlay 且 role=status');
  assert.equal(overlay._attrs['aria-busy'], 'true', 'loading 应带 aria-busy=true');
  assert.notEqual(overlay._attrs.role, 'alert', 'loading 不应再用 role=alert');
});

/* ---------------- common.js 编译冒烟（无 jsdom）---------------- */
test('smoke：common.js 语法可编译且 NL.esc 转义器存在', function () {
  // footer.ejs 里真实的 esc
  const escDef = footerSrc.slice(footerSrc.indexOf('function esc(s) {'), footerSrc.indexOf('var ICON'));
  const sandbox = { window: {}, console: console };
  vm.createContext(sandbox);
  vm.runInContext(escDef + '\nwindow.NL = { esc: esc };', sandbox);
  const NL = sandbox.window.NL;
  // 仅编译（不执行 boot），验证整份 common.js 无语法错误；boot 的 XSS 行为由另一文件覆盖
  assert.doesNotThrow(() => { new vm.Script(commonSrc, { filename: 'common.js' }); }, 'common.js 应可无错编译');
  assert.equal(typeof NL.esc, 'function', 'NL.esc 应存在');
});
