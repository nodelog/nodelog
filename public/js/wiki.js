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
  // 移动端搜索折叠：点搜索图标展开顶栏下方搜索条，点其它处/Esc 收起
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('.wiki-search-toggle') : null;
    var form = document.querySelector('.wiki-search');
    if (!form) return;
    if (t) {
      var open = form.classList.toggle('is-open');
      t.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { var input = form.querySelector('input'); if (input) input.focus(); }
      return;
    }
    // 点搜索条外部则收起（移动端）
    if (form.classList.contains('is-open') && !e.target.closest('.wiki-search')) {
      form.classList.remove('is-open');
      var btn = document.getElementById('wikiSearchToggle');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var form = document.querySelector('.wiki-search');
    if (form && form.classList.contains('is-open')) {
      form.classList.remove('is-open');
      var btn = document.getElementById('wikiSearchToggle');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  });
})();
