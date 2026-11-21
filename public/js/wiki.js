/* Wiki 三栏文档中心交互：目录树折叠 + 移动端抽屉。零依赖，事件委托。 */
(function () {
  'use strict';

  // 目录树折叠：折叠状态由服务端渲染（_tree.ejs 按 openIds 算好当前页祖先链），
  // 这里只负责点击切换，不再在初始化时强制全折叠——否则会覆盖服务端展开的当前分类。

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

  // 返回顶部：桌面端中栏独立滚动，移动端整页滚动——按「谁真正在滚」动态判定。
  // 之前只看 .wiki-main 是否存在，但移动端它被媒体查询改成 overflow:visible，
  // scrollTop 恒为 0，按钮永远不显示。改为同时监听两处、取实际滚动值。
  var backTop = document.getElementById('wikiBackTop');
  var mainScroll = document.querySelector('.wiki-main');
  if (backTop) {
    function currentY() {
      // 取两处滚动位置的较大者：桌面中栏滚 or 移动端 window 滚，都能触发
      var mainY = mainScroll ? mainScroll.scrollTop : 0;
      var winY = window.pageYOffset || document.documentElement.scrollTop || 0;
      return Math.max(mainY, winY);
    }
    var onScroll = function () {
      backTop.classList.toggle('is-visible', currentY() > 320);
    };
    if (mainScroll) mainScroll.addEventListener('scroll', onScroll, {passive: true});
    window.addEventListener('scroll', onScroll, {passive: true});
    window.addEventListener('resize', onScroll);
    onScroll();
    backTop.addEventListener('click', function () {
      // 回滚时两处都归零（哪处在滚都生效，无需判断）
      if (mainScroll) mainScroll.scrollTo({top: 0, behavior: 'smooth'});
      window.scrollTo({top: 0, behavior: 'smooth'});
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
