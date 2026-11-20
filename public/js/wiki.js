/* Wiki 三栏文档中心交互：目录树折叠 + 移动端抽屉。零依赖，事件委托。 */
(function () {
  'use strict';

  // 目录树折叠：默认全部折叠，仅展开「当前页面所在路径」的祖先链
  function setRow(row, collapsed) {
    row.classList.toggle('is-collapsed', collapsed);
    var btn = row.querySelector(':scope > .wiki-tree__toggle');
    if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  function initTree() {
    document.querySelectorAll('.wiki-tree__row').forEach(function (row) {
      var toggle = row.querySelector(':scope > .wiki-tree__toggle');
      if (toggle && !toggle.classList.contains('is-empty')) setRow(row, true);
    });
    // 展开当前页及其祖先（当前页在树里带 is-current）
    var current = document.querySelector('.wiki-tree__row.is-current');
    if (current) {
      var row = current;
      while (row && row.classList) {
        setRow(row, false);
        var parentUl = row.parentElement;             // 当前 li 所在的 ul
        var parentLi = parentUl && parentUl.parentElement; // 父级 li
        row = parentLi && parentLi.querySelector(':scope > .wiki-tree__row');
      }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTree);
  else initTree();

  // 点箭头切换折叠
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.wiki-tree__toggle') : null;
    if (!btn || btn.classList.contains('is-empty')) return;
    var row = btn.closest('.wiki-tree__row');
    if (!row) return;
    var collapsed = row.classList.toggle('is-collapsed');
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });

  // 本页目录：点击在中栏内平滑滚动到锚点；滚动时高亮当前可见标题
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('[data-toc-anchor]') : null;
    if (!a) return;
    e.preventDefault();
    var id = a.getAttribute('data-toc-anchor');
    var target = document.getElementById(id);
    var main = document.querySelector('.wiki-main');
    if (!target) return;
    if (main) {
      main.scrollTo({top: target.offsetTop - 18, behavior: 'smooth'});
    } else {
      target.scrollIntoView({behavior: 'smooth', block: 'start'});
    }
    if (history.replaceState) history.replaceState(null, '', '#' + id);
    document.querySelectorAll('[data-toc-anchor]').forEach(function (x) { x.classList.remove('is-active'); });
    a.classList.add('is-active');
  });
  var mainEl = document.querySelector('.wiki-main');
  if (mainEl) {
    var headings = Array.prototype.slice.call(document.querySelectorAll('.wiki-doc__body h2[id], .wiki-doc__body h3[id]'));
    var links = {};
    document.querySelectorAll('[data-toc-anchor]').forEach(function (a) { links[a.getAttribute('data-toc-anchor')] = a; });
    if (headings.length) {
      var ticking = false;
      mainEl.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          var top = mainEl.getBoundingClientRect().top;
          var active = null;
          headings.forEach(function (h) { if (h.getBoundingClientRect().top - top <= 40) active = h.id; });
          Object.keys(links).forEach(function (id) { links[id].classList.toggle('is-active', id === active); });
          ticking = false;
        });
      }, {passive: true});
    }
  }

  // 返回顶部：中栏独立滚动，滚动超过一屏显示按钮
  var backTop = document.getElementById('wikiBackTop');
  var mainScroll = document.querySelector('.wiki-main');
  if (backTop) {
    var scrollEl = mainScroll || document.scrollingElement || document.documentElement;
    var onScroll = function () {
      var y = mainScroll ? scrollEl.scrollTop : (window.pageYOffset || document.documentElement.scrollTop || 0);
      backTop.classList.toggle('is-visible', y > 320);
    };
    if (mainScroll) mainScroll.addEventListener('scroll', onScroll, {passive: true});
    else window.addEventListener('scroll', onScroll, {passive: true});
    onScroll();
    backTop.addEventListener('click', function () {
      if (mainScroll) mainScroll.scrollTo({top: 0, behavior: 'smooth'});
      else window.scrollTo({top: 0, behavior: 'smooth'});
    });
  }

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
