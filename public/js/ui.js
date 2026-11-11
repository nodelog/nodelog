/* =========================================================================
   NODELOG · ui.js  —  零依赖的原生弹层 / Toast / 确认 / 加载
   替代 layer.js（layer.open / layer.msg / layer.alert / layer.confirm /
   layer.load / layer.close / layer.closeAll）。
   仅向 window.NL 追加方法，不覆盖 footer.ejs 里已定义的 esc / state。
   依赖：app.css 中的 .nl-overlay / .nl-modal / .nl-toast 等样式。
   ========================================================================= */
(function () {
  'use strict';

  var NL = (window.NL = window.NL || {});

  var modalEl = null;     // 当前打开的 modal / alert 弹层
  var loadingEl = null;   // 当前加载层
  var escHandler = null;  // ESC 关闭处理器
  var lastOpener = null;  // 打开弹层前的焦点元素，关闭后归还，保证键盘可达性
  var inertedEls = [];    // 打开弹层时被设为 inert 的背景节点

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function restoreBackground() {
    inertedEls.forEach(function (el) { try { el.inert = false; } catch (e) {} });
    inertedEls = [];
  }
  // 焦点陷阱：弹层内 Tab / Shift+Tab 循环，焦点不逸出到背景
  function trapFocus(container, e) {
    if (e.key !== 'Tab') return;
    var sel = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
    var nodes = container.querySelectorAll(sel);
    if (!nodes.length) { e.preventDefault(); return; }
    var first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function removeExistingModal() {
    if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
    modalEl = null;
    restoreBackground();
    if (lastOpener && typeof lastOpener.focus === 'function') { try { lastOpener.focus(); } catch (e) {} }
    lastOpener = null;
  }

  function bindDismiss(el) {
    el.addEventListener('click', function (e) {
      if (e.target === el) closeAll();
    });
    if (!escHandler) {
      escHandler = function (e) {
        if (e.key === 'Escape' || e.keyCode === 27) {
          if (modalEl || loadingEl) { e.preventDefault(); closeAll(); }
        }
      };
      document.addEventListener('keydown', escHandler);
    }
  }

  /* 加载层：替代 layer.load / loading() */
  function loading(text) {
    if (!loadingEl) {
      loadingEl = document.createElement('div');
      loadingEl.className = 'nl-overlay';
      loadingEl.setAttribute('role', 'status');
      loadingEl.setAttribute('aria-busy', 'true');
      loadingEl.innerHTML = '<div class="nl-loading"><span class="nl-spinner" aria-hidden="true"></span><span class="nl-loading-text"></span></div>';
      document.body.appendChild(loadingEl);
      bindDismiss(loadingEl);
    }
    var t = loadingEl.querySelector('.nl-loading-text');
    if (t) t.textContent = text || '加载中…';
    return loadingEl;
  }
  function closeLoading() {
    if (loadingEl && loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
    loadingEl = null;
  }

  /* 通用 modal：替代 layer.open(type:1) / myPage */
  function modal(opts) {
    opts = opts || {};
    removeExistingModal();
    var overlay = document.createElement('div');
    overlay.className = 'nl-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    lastOpener = document.activeElement;

    var modal = document.createElement('div');
    modal.className = 'nl-modal';
    if (opts.size === 'large') modal.style.maxWidth = '560px';

    var html = '';
    if (opts.title) {
      html += '<div class="nl-modal-head">' + esc(opts.title) + '</div>';
    }
    html += '<div class="nl-modal-body">' + (opts.content || '') + '</div>';
    if (opts.confirmText || opts.cancelText) {
      html += '<div class="nl-modal-foot">';
      if (opts.cancelText) {
        html += '<button type="button" class="btn js-nl-cancel">' + esc(opts.cancelText) + '</button>';
      }
      if (opts.confirmText) {
        html += '<button type="button" class="btn btn-primary js-nl-confirm">' + esc(opts.confirmText) + '</button>';
      }
      html += '</div>';
    }
    modal.innerHTML = html;

    var closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'close';
    closeX.setAttribute('aria-label', '关闭');
    closeX.textContent = '×';
    (opts.title ? modal.querySelector('.nl-modal-head') : modal.querySelector('.nl-modal-body')).appendChild(closeX);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    modalEl = overlay;
    bindDismiss(overlay);
    // 背景节点置为 inert，阻断 Tab 进入背景；弹层内 Tab 循环
    Array.prototype.forEach.call(document.body.children, function (child) {
      if (child !== overlay) { try { child.inert = true; inertedEls.push(child); } catch (e) {} }
    });
    overlay.addEventListener('keydown', function (e) { trapFocus(modal, e); });

    closeX.addEventListener('click', function (e) { e.preventDefault(); closeAll(); });
    var cancelBtn = modal.querySelector('.js-nl-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      if (typeof opts.onCancel === 'function') opts.onCancel();
      closeAll();
    });
    var confirmBtn = modal.querySelector('.js-nl-confirm');
    if (confirmBtn) confirmBtn.addEventListener('click', function () {
      if (typeof opts.onConfirm === 'function') opts.onConfirm();
      closeAll();
    });

    if (typeof opts.onOpen === 'function') opts.onOpen(modal);
    var focusable = modal.querySelector('input,textarea,button.btn-primary,.js-nl-confirm');
    if (focusable) { try { focusable.focus(); } catch (e) {} }
    return modal;
  }

  /* 确认框：替代 layer.alert / myAlert(_msg, callback) */
  function alert(message, opts) {
    opts = opts || {};
    var onConfirm = opts.onConfirm || (typeof opts === 'function' ? opts : null);
    return modal({
      title: opts.title || 'NODELOG 温馨提示',
      content: '<p style="margin:0">' + esc(message) + '</p>',
      confirmText: opts.confirmText || '嗯',
      cancelText: opts.cancelText || '不要',
      onConfirm: onConfirm,
      onCancel: opts.onCancel
    });
  }

  /* Toast：替代 layer.msg / myMsg */
  function toast(message, ms) {
    var host = document.getElementById('nl-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'nl-toast-host';
      host.className = 'toast-host';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    var t = document.createElement('div');
    t.className = 'nl-toast';
    t.textContent = message;
    host.appendChild(t);
    var life = (typeof ms === 'number') ? ms : 2000;
    setTimeout(function () {
      t.style.opacity = '0';
      t.style.transition = 'opacity .2s ease';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 220);
    }, life);
    return t;
  }

  /* 关闭所有弹层（modal + loading），保留 toast */
  function closeAll() {
    removeExistingModal();
    closeLoading();
  }

  NL.loading = loading;
  NL.closeLoading = closeLoading;
  NL.modal = modal;
  NL.alert = alert;
  NL.toast = toast;
  NL.closeAll = closeAll;
  NL.closeLayer = closeAll; // 兼容旧 closeLayer()
})();
