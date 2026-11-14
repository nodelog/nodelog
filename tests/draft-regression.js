/* 回归测试：写新文章草稿回灌 BUG
 * 运行：node tests/draft-regression.js
 * 纯 Node、零外部依赖。用 vm 加载 views/editor.ejs 的内联脚本，
 * mock localStorage/sessionStorage/DOM/Vditor，验证真实草稿逻辑的行为。
 *
 * 覆盖：存量裸文本草稿自愈 / 保存成功后强清除 / 延迟 input 回调不写回 /
 *       同会话刷新续写 / 新会话不串稿 / 编辑已有文章不被草稿覆盖 /
 *       common.js 保存成功路径的清除契约。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const editorEjs = fs.readFileSync(path.join(ROOT, 'views/editor.ejs'), 'utf8');
const commonJs = fs.readFileSync(path.join(ROOT, 'public/js/common.js'), 'utf8');

const inline = editorEjs.match(/<script>([\s\S]*?)<\/script>/);
if (!inline) { console.error('ERROR views/editor.ejs 中未找到内联 <script>'); process.exit(1); }
const SCRIPT = inline[1];

let passed = 0, failed = 0;
function ok(cond, name, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); process.exitCode = 1; }
}

/* ---------------- 浏览器环境 mock ---------------- */
function Storage(seed) { this.map = new Map(Object.entries(seed || {})); }
Storage.prototype.getItem = function (k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; };
Storage.prototype.setItem = function (k, v) { this.map.set(String(k), String(v)); };
Storage.prototype.removeItem = function (k) { this.map.delete(String(k)); };
Storage.prototype.key = function (i) { const ks = Array.from(this.map.keys()); return i < ks.length ? ks[i] : null; };
Object.defineProperty(Storage.prototype, 'length', { get: function () { return this.map.size; } });
Storage.prototype.keys = function () { return Array.from(this.map.keys()); };
Storage.prototype.draftKeys = function () { return this.keys().filter(function (k) { return k.indexOf('nl-draft-') === 0; }); };

function open(opts) {
  opts = opts || {};
  const ls = opts.localStorage || new Storage(opts.seedLocal);
  const ss = opts.sessionStorage || new Storage(opts.seedSession);
  const ta = {
    value: opts.serverContent || '', style: {}, className: 'js-editor',
    setAttribute: function () {}, addEventListener: function () {}
  };
  const title = {
    getAttribute: function (n) { return n === 'data-id' ? (opts.docId != null ? opts.docId : null) : null; }
  };
  let captured = null;
  function Vditor(id, options) {
    captured = options;
    this.getValue = function () { return options.value || ''; };
    this.insertValue = function () {};
    this.tip = function () {};
    this.vditor = { currentMode: 'wysiwyg', wysiwyg: { element: null }, ir: {}, sv: {} };
    if (typeof options.after === 'function') options.after.call(this);
  }
  const sandbox = {
    document: {
      getElementById: function (id) { return id === 'editor' ? ta : null; },
      querySelector: function (sel) { return sel === '.js-add-content-name' ? title : null; },
      addEventListener: function () {}, readyState: 'complete'
    },
    localStorage: ls, sessionStorage: ss,
    Date: Date, Math: Math, JSON: JSON, console: console,
    FileReader: function () {}, fetch: function () {},
    Vditor: opts.noVditor ? undefined : Vditor
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox, { filename: 'views/editor.ejs:inline' });
  return {
    sandbox: sandbox, ls: ls, ss: ss, ta: ta,
    options: captured,
    value: function () { return captured ? captured.value : null; },
    type: function (v) { if (captured && captured.input) captured.input(v); },
    clear: function () {
      if (typeof sandbox.window.__nlClearDraft === 'function') sandbox.window.__nlClearDraft();
    }
  };
}

/* ---------------- 语法 ---------------- */
console.log('\n[语法]');
try { new vm.Script(SCRIPT, { filename: 'views/editor.ejs' }); ok(true, 'editor.ejs 内联脚本语法有效'); }
catch (e) { ok(false, 'editor.ejs 内联脚本语法有效', e.message); }
try { new vm.Script(commonJs, { filename: 'public/js/common.js' }); ok(true, 'common.js 语法有效'); }
catch (e) { ok(false, 'common.js 语法有效', e.message); }

/* ---------------- T1 存量脏数据自愈 ---------------- */
console.log('\n[T1] 旧版遗留的裸文本 nl-draft-new 必须被清除，且绝不回灌');
{
  const r = open({ seedLocal: { 'nl-draft-new': '上一篇已经发布过的文章内容' } });
  ok(r.value() === '', '新建页初始内容为空', JSON.stringify(r.value()));
  ok(r.ls.getItem('nl-draft-new') === null, '遗留固定 key 已被删除');
  ok(r.ls.draftKeys().length === 0, '未重新写回任何草稿');
}

/* ---------------- T2 保存成功后强清除 ---------------- */
console.log('\n[T2] 保存成功后：清全部草稿 / 关闭延迟写入 / 下次写新文章为空白');
{
  const ls = new Storage({ 'nl-draft-new': '历史脏数据' });
  const ss = new Storage();
  const a = open({ localStorage: ls, sessionStorage: ss });
  a.type('文章A正文');
  ok(a.ls.draftKeys().some(function (k) { return k.indexOf('nl-draft-new-') === 0; }),
     '编辑中按会话写入独立草稿（不再共用固定 key）');
  a.clear();
  ok(a.ls.draftKeys().length === 0, '保存成功后 nl-draft-* 全部清空', JSON.stringify(a.ls.draftKeys()));
  ok(a.ss.getItem('nl-draft-sid') === null, '会话 id 已轮换');
  a.type('迟到的 Vditor input 回调');
  ok(a.ls.draftKeys().length === 0, '清除后延迟回调未把内容写回');
  const b = open({ localStorage: ls, sessionStorage: new Storage() });
  ok(b.value() === '', '下一次「写新文章」为空白编辑器', JSON.stringify(b.value()));
}

/* ---------------- T3 会话隔离 ---------------- */
console.log('\n[T3] 同一标签页刷新可续写，换会话绝不串稿');
{
  const ls = new Storage(), ss = new Storage();
  const a = open({ localStorage: ls, sessionStorage: ss });
  a.type('还没保存的草稿');
  const b = open({ localStorage: ls, sessionStorage: ss });
  ok(b.value() === '还没保存的草稿', '同会话刷新续写草稿', JSON.stringify(b.value()));
  const c = open({ localStorage: ls, sessionStorage: new Storage() });
  ok(c.value() === '', '新会话不回灌上一次的草稿', JSON.stringify(c.value()));
  ok(c.ls.draftKeys().length === 0, '其它会话的遗留草稿已被回收');
}

/* ---------------- T4 编辑已有文章 ---------------- */
console.log('\n[T4] 编辑已有文章：服务端内容优先，历史脏 key 顺手清掉');
{
  const r = open({
    docId: 'doc-42', serverContent: '服务端原文',
    seedLocal: { 'nl-draft-new': '旧草稿', 'nl-draft-doc-42': '旧版裸文本草稿' }
  });
  ok(r.value() === '服务端原文', '不被任何草稿覆盖', JSON.stringify(r.value()));
  ok(r.ls.getItem('nl-draft-new') === null, '历史固定 key 被清');
}

/* ---------------- T5 Vditor 未加载的兜底路径 ---------------- */
console.log('\n[T5] Vditor 加载失败时仍能自愈，且不会回灌');
{
  const r = open({ noVditor: true, seedLocal: { 'nl-draft-new': '上次的内容' } });
  ok(r.ta.value === '', '纯文本框回退时内容为空', JSON.stringify(r.ta.value));
  ok(r.ls.getItem('nl-draft-new') === null, '遗留草稿同样被清');
}

/* ---------------- T6 common.js 契约 ---------------- */
console.log('\n[T6] common.js 保存成功路径必须调用强清除');
{
  ok(/if \(data\.success\)\s*\{[\s\S]{0,400}?clearDraft\(id\)/.test(commonJs),
     '成功回调里调用 clearDraft(id)');
  ok(/function clearDraft\(id\)[\s\S]{0,900}?__nlClearDraft[\s\S]{0,900}?nl-draft-new-/.test(commonJs),
     'clearDraft 同时具备编辑器钩子与遍历兜底');
  ok(/sessionStorage\.removeItem\('nl-draft-sid'\)/.test(commonJs),
     '保存成功后轮换会话 id');
}

console.log('\n' + (failed ? 'FAILED' : 'ALL PASS') + ' · ' + passed + ' 项通过 / ' + failed + ' 项失败\n');
