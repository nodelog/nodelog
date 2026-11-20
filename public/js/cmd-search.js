/* =========================================================================
   NODELOG · cmd-search.js — WP3 全局命令面板（ThinkWiki 式 ⌘K 搜索）
   零依赖、原生 DOM。博客前台与知识库前台共用：
     - 点顶栏搜索图标 / 按钮、按 Ctrl+K / ⌘K 都弹出同一个模态面板
     - 边输入边搜（防抖 + AbortController），结果按「博客文章 / 知识库文档」分组
     - ↑↓ 导航、Enter 打开、Esc 关闭；搜索框内标注 Ctrl K / ⌘K 徽标
   依赖：app.css 的 .nl-* 令牌与 .btn；面板样式见 theme.css 的 .cmdp-*。
   端点：POST /api/search/suggest {word, docType, spaceId}
   ========================================================================= */
(function () {
  'use strict';
  var state = {
    panel: null, input: null, list: null, footer: null, scopeBtn: null,
    open: false, items: [], active: -1, timer: null, ctl: null,
    homeType: 'blog',   // 当前页面归属：blog / wiki（默认只搜自己）
    crossMode: false,   // 是否开启「同时搜索对方」
    spaceId: '', seq: 0
  };
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var KEY_HINT = isMac ? '⌘K' : 'Ctrl K';

  // 实际请求的 docType：默认只搜自己；开启跨库后搜两者
  function effectiveDocType() { return state.crossMode ? 'all' : state.homeType; }
  // 开关文案：告诉用户「点一下会发生什么」
  function scopeLabel() {
    if (state.homeType === 'wiki') return state.crossMode ? '仅搜知识库' : '同时搜博客文章';
    return state.crossMode ? '仅搜博客文章' : '同时搜知识库';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  }
  function hrefFor(d) {
    if (d.docType === 'wiki') {
      return (d.spaceSlug && d.slug)
        ? '/wiki/' + encodeURIComponent(d.spaceSlug) + '/' + encodeURIComponent(d.slug)
        : '/wiki';
    }
    return '/content/detail?id=' + encodeURIComponent(d.id);
  }
  function icon(file) {
    return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (file === 'wiki'
        ? '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>'
        : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>') + '</svg>';
  }

  function build() {
    if (state.panel) return;
    var cfg = window.CMD_SEARCH_CONFIG || {};
    // home 由页面声明：知识库页配 wiki，博客页不配即默认 blog。
    // 兼容旧配置 docType（若显式给了 wiki 也认作 wiki）。
    state.homeType = (cfg.homeType === 'wiki' || cfg.docType === 'wiki') ? 'wiki' : 'blog';
    state.spaceId = cfg.spaceId || '';
    state.crossMode = false;

    var overlay = document.createElement('div');
    overlay.className = 'cmdp-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '全站搜索');
    overlay.innerHTML =
      '<div class="cmdp-panel">' +
        '<div class="cmdp-head">' +
          '<svg class="cmdp-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
          '<input type="search" class="cmdp-input" placeholder="' + esc(cfg.placeholder || '搜索文章、文档、标签…') + '" aria-label="搜索" autocomplete="off" spellcheck="false"/>' +
          '<kbd class="cmdp-kbd">' + KEY_HINT + '</kbd>' +
          '<button type="button" class="cmdp-clear" aria-label="清空" hidden><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
        '</div>' +
        '<div class="cmdp-list" role="listbox" aria-label="搜索结果"></div>' +
        '<div class="cmdp-foot">' +
          '<span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>' +
          '<span><kbd>Enter</kbd> 打开</span>' +
          '<span><kbd>Esc</kbd> 关闭</span>' +
          '<button type="button" class="cmdp-scope" id="cmdpScope" aria-pressed="false" title="切换搜索范围">' + scopeLabel() + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    state.panel = overlay;
    state.input = overlay.querySelector('.cmdp-input');
    state.list = overlay.querySelector('.cmdp-list');
    state.footer = overlay.querySelector('.cmdp-foot');
    state.scopeBtn = overlay.querySelector('.cmdp-scope');
    var clear = overlay.querySelector('.cmdp-clear');

    // 右下角范围开关：默认只搜自己，点开叠加对方
    state.scopeBtn.addEventListener('click', function () {
      state.crossMode = !state.crossMode;
      state.scopeBtn.textContent = scopeLabel();
      state.scopeBtn.setAttribute('aria-pressed', state.crossMode ? 'true' : 'false');
      state.scopeBtn.classList.toggle('is-on', state.crossMode);
      if (state.input.value.trim()) onInput();   // 有词则按新范围重搜
      else render([]);
      state.input.focus();
    });

    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    state.input.addEventListener('input', function () {
      clear.hidden = !state.input.value;
      onInput();
    });
    clear.addEventListener('click', function () {
      state.input.value = ''; clear.hidden = true; state.input.focus(); render([]);
    });
    state.list.addEventListener('mousemove', function (e) {
      var row = e.target.closest ? e.target.closest('.cmdp-item') : null;
      if (row) setActive(parseInt(row.getAttribute('data-i'), 10));
    });
    state.list.addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('.cmdp-item') : null;
      if (row) { e.preventDefault(); go(parseInt(row.getAttribute('data-i'), 10)); }
    });
    overlay.addEventListener('keydown', onKey);
  }

  function onInput() {
    var word = state.input.value.trim();
    if (state.timer) clearTimeout(state.timer);
    if (state.ctl) { try { state.ctl.abort(); } catch (e) {} }
    if (!word) { render([]); return; }
    state.ctl = ('AbortController' in window) ? new AbortController() : null;
    var seq = ++state.seq, ctrl = state.ctl;
    state.list.innerHTML = '<div class="cmdp-hint">搜索中…</div>';
    state.timer = setTimeout(function () {
      fetch('/api/search/suggest', {
        method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({word: word, docType: effectiveDocType(), spaceId: state.spaceId}).toString(),
        signal: ctrl ? ctrl.signal : null
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (seq !== state.seq) return; // 旧响应丢弃
        render((d && d.docs) || []);
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        if (seq !== state.seq) return;
        state.list.innerHTML = '<div class="cmdp-hint">搜索失败，请重试</div>';
      });
    }, 200);
  }

  function render(docs) {
    state.items = docs || [];
    state.active = state.items.length ? 0 : -1;
    if (!state.items.length) {
      var w = state.input.value.trim();
      state.list.innerHTML = '<div class="cmdp-empty">' + (w ? '没有找到与「' + esc(w) + '」相关的内容' : '输入关键词开始搜索') + '</div>';
      return;
    }
    var groups = [
      {type: 'blog', label: '博客文章', icon: 'blog'},
      {type: 'wiki', label: '知识库文档', icon: 'wiki'}
    ];
    var html = '', idx = 0;
    groups.forEach(function (g) {
      var list = state.items.filter(function (d) { return d.docType === g.type; });
      if (!list.length) return;
      html += '<div class="cmdp-group"><div class="cmdp-group-title">' + g.label + ' <span>' + list.length + '</span></div>';
      list.forEach(function (d) {
        var i = state.items.indexOf(d);
        html += '<a class="cmdp-item' + (i === state.active ? ' is-active' : '') + '" data-i="' + i + '" href="' + esc(hrefFor(d)) + '" role="option" aria-selected="' + (i === state.active) + '">' +
          '<span class="cmdp-item-icon">' + icon(g.type) + '</span>' +
          '<span class="cmdp-item-body"><span class="cmdp-item-name">' + esc(d.name) + '</span>' +
          (d.excerpt ? '<span class="cmdp-item-desc">' + esc(d.excerpt) + '</span>' : '') + '</span>' +
          (d.spaceSlug ? '<span class="cmdp-item-tag">知识库</span>' : '') +
          '</a>';
      });
      html += '</div>';
    });
    // 面板最多显示若干条；给「查看完整结果」出口，口径与面板默认范围一致。
    // 注：完整搜索页暂只支持单一 docType，跨库模式下此链接指向博客全量搜索（Wiki 结果已在面板内可点开）。
    var word = state.input.value.trim();
    var full = '/content/search?word=' + encodeURIComponent(word);
    if (state.homeType === 'wiki') {
      full += '&docType=wiki';
      if (state.spaceId) full += '&spaceId=' + encodeURIComponent(state.spaceId);
    }
    html += '<a class="cmdp-more" href="' + esc(full) + '">查看完整搜索结果 →</a>';
    state.list.innerHTML = html;
  }

  function setActive(i) {
    if (i < 0 || i >= state.items.length) return;
    state.active = i;
    var rows = state.list.querySelectorAll('.cmdp-item');
    for (var n = 0; n < rows.length; n++) {
      var on = parseInt(rows[n].getAttribute('data-i'), 10) === i;
      rows[n].classList.toggle('is-active', on);
      rows[n].setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) rows[n].scrollIntoView({block: 'nearest'});
    }
  }
  function go(i) {
    var d = state.items[i];
    if (!d) return;
    close();
    location.href = hrefFor(d);
  }
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(state.active + 1, state.items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(state.active - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(state.active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }
  function open() {
    build();
    state.panel.hidden = false;
    state.open = true;
    state.input.value = '';
    var clear = state.panel.querySelector('.cmdp-clear'); if (clear) clear.hidden = true;
    render([]);
    setTimeout(function () { state.input.focus(); }, 0);
  }
  function close() {
    if (!state.panel) return;
    state.panel.hidden = true;
    state.open = false;
    if (state.timer) clearTimeout(state.timer);
    if (state.ctl) { try { state.ctl.abort(); } catch (e) {} }
  }
  function toggle() { state.open ? close() : open(); }

  // 全局触发：Ctrl+K / ⌘K；所有带 data-cmd-search 的元素点击也触发
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      toggle();
    }
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-cmd-search], #nlSearchToggle, #wikiSearchToggle, .wiki-search__input, #nl-site-search') : null;
    if (!t) return;
    // 命令面板自身的输入框不触发（避免点面板内输入框时 toggle 关闭）
    if (e.target.closest && e.target.closest('.cmdp-panel')) return;
    e.preventDefault();
    toggle();
  });

  // 暴露给页面（可选）
  window.CMDSearch = {open: open, close: close, toggle: toggle};
})();
