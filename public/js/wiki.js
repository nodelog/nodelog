/* Wiki 三栏文档中心交互：目录树折叠 + 移动端抽屉。零依赖，事件委托。 */
(function () {
  'use strict';

  // 目录树折叠：点箭头切换 .is-collapsed，同时更新 aria-expanded
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.wiki-tree__toggle') : null;
    if (!btn || btn.classList.contains('is-empty')) return;
    var row = btn.closest('.wiki-tree__row');
    if (!row) return;
    var collapsed = row.classList.toggle('is-collapsed');
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });

  // 移动端目录抽屉
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('.wiki-aside__toggle-mobile') : null;
    if (!t) return;
    var aside = t.closest('.wiki-aside');
    if (!aside) return;
    var open = aside.classList.toggle('is-open');
    t.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // 搜索交互（点图标 / Ctrl+K / 边输入边搜）统一由 cmd-search.js 命令面板接管。
})();
