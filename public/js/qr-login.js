/**
 * NODELOG 全站微信扫码登录（纯原生 JS，前后台通用）
 *
 * 1. document 捕获阶段拦截 .js-login-btn 点击：e.preventDefault() +
 *    e.stopPropagation()，抢在 common.js 直接绑定在元素上的 click handler
 *    之前，阻止其 310x200 的 layer 登录弹层；逐级向上查找，兼容 <a> 内子元素。
 * 2. common.js 有 6+ 处 $('.js-login-btn').click() 程序化触发。jQuery 1.10.2
 *    对 <a> 的 trigger('click') 只做手动派发、不产生原生事件，捕获阶段收不到，
 *    因此额外用 MutationObserver 监听 body 子节点：一旦出现「含登录表单」的
 *    layer 弹层，立即关闭它并改开二维码弹层（回调在渲染前执行，用户看不到旧弹层）。
 * 3. 二维码 /open/qrcode，状态轮询 /open/status?token=xxx；confirmed 后
 *    会话与 30 天免登录 cookie 已由后端写好，前端只需 location.reload()。
 * 4. 关闭 / 刷新时 clearInterval + AbortController + 递增序号三重取消，
 *    杜绝多个轮询并发与旧响应覆盖新状态。
 * 5. 二维码 src 仅接受 data:image/ 或 https:// 开头，防止注入。
 */
(function () {
  'use strict';

  var QR_API = '/open/qrcode';
  var STATUS_API = '/open/status?token=';
  var POLL_MS = 1500;
  var MAX_MS = 300000;        // 总时长上限 300 秒
  var REQ_MS = 8000;          // 单次请求超时

  var state = { open: false, token: '', seq: 0, timer: null, deadline: 0 };
  var pending = [];           // 在途请求 { ctl, seq, timerId, done, resolve }
  var overlay = null, frame = null, qrImg = null, statusEl = null,
      refreshBtn = null, closeBtn = null;

  /* ---------------- 样式：全部复用 theme.css 令牌，深浅两套自适应 ---------------- */
  function injectStyle() {
    if (document.getElementById('nl-qr-style')) return;
    var css = [
      '.nl-qr-overlay{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;background:rgba(0,0,0,.55);display:none}',
      '.nl-qr-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:320px;max-width:90vw;box-sizing:border-box;padding:var(--space-6) var(--space-4) var(--space-4);background:var(--surface);color:var(--ink);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);font-family:var(--font);text-align:center}',
      '.nl-qr-close{position:absolute;right:var(--space-2);top:var(--space-1);padding:var(--space-1) var(--space-2);border:0;background:transparent;color:var(--muted);font-family:inherit;font-size:var(--fs-lead);line-height:1;cursor:pointer;transition:color 150ms ease}',
      '.nl-qr-close:hover{color:var(--ink)}',
      '.nl-qr-close:focus-visible,.nl-qr-refresh:focus-visible{outline:2px solid var(--ring);outline-offset:2px}',
      '.nl-qr-title{margin:0 0 var(--space-3);font-size:var(--fs-body);line-height:1.5;font-weight:600;color:var(--ink)}',
      '.nl-qr-status{margin:0 0 var(--space-3);min-height:var(--space-6);font-size:var(--fs-body-sm);line-height:1.5;color:var(--muted);word-break:break-all}',
      '.nl-qr-frame{display:none;margin:0 auto var(--space-3);padding:var(--space-1);width:234px;max-width:100%;box-sizing:border-box;background:#fff;border:1px solid var(--border);border-radius:var(--radius-sm)}',
      '.nl-qr-img{display:block;width:220px;max-width:100%;height:auto;background:#fff}',
      '.nl-qr-refresh{display:none;margin:0 auto;padding:var(--space-2) var(--space-4);font-family:inherit;font-size:var(--fs-body-sm);line-height:1.4;color:var(--ink);background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;transition:background-color 150ms ease}',
      '.nl-qr-refresh:hover{background:var(--accent-weak)}',
      '.nl-qr-refresh:active{background:var(--accent-weak)}',
      '.nl-qr-refresh.is-visible{display:inline-block}',
      '.nl-qr-hint{margin:var(--space-3) 0 0;font-size:var(--fs-small);line-height:1.5;color:var(--muted)}'
    ].join('\n');
    var tag = document.createElement('style');
    tag.id = 'nl-qr-style';
    tag.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(tag);
  }

  /* ---------------- 弹层结构（幂等构建） ---------------- */
  function build() {
    if (overlay) return;
    injectStyle();
    overlay = document.createElement('div');
    overlay.className = 'nl-qr-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '微信扫码登录');
    overlay.innerHTML = [
      '<div class="nl-qr-card">',
        '<button type="button" class="nl-qr-close" aria-label="关闭扫码登录">&times;</button>',
        '<h3 class="nl-qr-title">微信扫码登录</h3>',
        '<p class="nl-qr-status" role="status" aria-live="polite">正在获取二维码…</p>',
        '<div class="nl-qr-frame"><img class="nl-qr-img" alt="微信登录二维码，请使用微信扫一扫"></div>',
        '<button type="button" class="nl-qr-refresh">刷新二维码</button>',
        '<p class="nl-qr-hint">请使用微信扫一扫，在手机上确认登录</p>',
      '</div>'
    ].join('');
    (document.body || document.documentElement).appendChild(overlay);

    frame = overlay.querySelector('.nl-qr-frame');
    qrImg = overlay.querySelector('.nl-qr-img');
    statusEl = overlay.querySelector('.nl-qr-status');
    refreshBtn = overlay.querySelector('.nl-qr-refresh');
    closeBtn = overlay.querySelector('.nl-qr-close');

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    closeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      close();
    });
    refreshBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      loadQrcode();
    });
  }

  /* ---------------- 小工具 ---------------- */
  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || '';
  }
  function showRefresh(on) {
    if (!refreshBtn) return;
    if (on) refreshBtn.classList.add('is-visible');
    else refreshBtn.classList.remove('is-visible');
  }
  function isSafeSrc(u) {
    if (typeof u !== 'string') return false;
    u = u.replace(/^\s+|\s+$/g, '');
    return /^data:image\//i.test(u) || /^https:\/\//i.test(u);
  }
  function setQr(src) {
    if (!qrImg || !frame) return;
    if (!isSafeSrc(src)) src = '';      // 再次校验，杜绝注入
    if (src) {
      qrImg.src = src;
      frame.style.display = 'block';
    } else {
      qrImg.removeAttribute('src');
      frame.style.display = 'none';
    }
  }
  // 逐级向上找 .js-login-btn，兼容 <a> 内子元素与不支持 closest 的旧 WebView
  function findTrigger(node) {
    var el = node && node.nodeType === 3 ? node.parentNode : node;
    while (el && el.nodeType === 1 && el !== document) {
      var cls = el.className;
      if (cls && typeof cls === 'string' && (' ' + cls + ' ').indexOf(' js-login-btn ') > -1) return el;
      if (el.classList && el.classList.contains('js-login-btn')) return el;
      el = el.parentNode;
    }
    return null;
  }

  /* ---------------- 兜底：清理 common.js 的旧登录弹层 ----------------
     layer mobile v1.7 的弹层容器是 .layermbox，登录表单被移入其中。
     识别条件四重收紧，确保只命中「登录弹层」：
       1) 必须是 .layermbox 容器；
       2) 必须含登录表单专有按钮 .js-signIn-btn；
       3) 显式排除注册弹层（.js-register-panel / .js-signUp-btn / .js-register-username）；
       4) myMsg / myAlert / loading 等纯提示层没有登录表单，第 2 条天然排除。 */
  function isLegacyLoginBox(box) {
    if (!box || box.nodeType !== 1 || !box.querySelector) return false;
    var cls = typeof box.className === 'string' ? box.className : '';
    if (cls.indexOf('layermbox') < 0) return false;
    if (!box.querySelector('.js-signIn-btn')) return false;
    if (box.querySelector('.js-signUp-btn') ||
        box.querySelector('.js-register-panel') ||
        box.querySelector('.js-register-username')) return false;
    return true;
  }
  function removeLoginBoxes(boxes) {
    var hit = false;
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      if (!isLegacyLoginBox(box)) continue;
      hit = true;
      var idx = box.getAttribute('index');
      if (window.layer && typeof window.layer.close === 'function' && idx != null) {
        try { window.layer.close(idx); } catch (e1) { }
      }
      if (box.parentNode) box.parentNode.removeChild(box);
    }
    return hit;
  }
  function dismissLegacyLoginLayer() {
    try {
      return removeLoginBoxes(document.querySelectorAll('.layermbox'));
    } catch (e) { return false; }
  }

  /* ---------------- 请求层：超时 + 中断 + 代次，一律 resolve ---------------- */
  function settle(entry) {
    if (entry.done) return;
    entry.done = true;
    if (entry.timerId) { clearTimeout(entry.timerId); entry.timerId = 0; }
    var i = pending.indexOf(entry);
    if (i > -1) pending.splice(i, 1);
  }
  function requestJson(url) {
    if (typeof fetch !== 'function') {
      return Promise.resolve({ __error: '当前浏览器不支持网络请求，请升级浏览器' });
    }
    var seq = state.seq;
    var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
    var entry = { ctl: ctl, seq: seq, timerId: 0, done: false, resolve: null };
    var init = { credentials: 'same-origin' };
    if (ctl) init.signal = ctl.signal;
    pending.push(entry);

    return new Promise(function (resolve) {
      entry.resolve = resolve;
      function finish(payload) {
        if (entry.done) return;
        settle(entry);
        resolve(seq === state.seq ? payload : null);   // 旧代次响应直接丢弃
      }
      entry.timerId = setTimeout(function () {
        if (ctl) { try { ctl.abort(); } catch (e) { } }
        finish({ __error: '请求超时，请重试' });
      }, REQ_MS);
      try {
        fetch(url, init).then(function (r) {
          if (!r.ok) { finish({ __error: '服务暂不可用（' + r.status + '）' }); return; }
          r.json().then(function (data) { finish(data); },
                        function () { finish({ __error: '返回数据格式有误' }); });
        }).catch(function () { finish({ __error: '网络异常，请重试' }); });
      } catch (e) {
        finish({ __error: '网络异常，请重试' });
      }
    });
  }
  function cancelAll() {
    state.seq++;
    state.token = '';
    state.deadline = 0;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    var list = pending.slice();
    pending.length = 0;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.timerId) clearTimeout(e.timerId);
      if (e.ctl) { try { e.ctl.abort(); } catch (err) { } }
      e.done = true;
      if (e.resolve) e.resolve(null);   // 让在途 Promise 收敛，回调收到 null 自行忽略
    }
  }
  function stopPolling() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    state.seq++;   // 使在途状态响应失效，避免覆盖「已过期 / 已成功」
  }

  /* ---------------- 二维码与状态轮询 ---------------- */
  function onFailure(msg) {
    setQr('');
    setStatus(msg);
    showRefresh(true);
  }
  function loadQrcode() {
    cancelAll();
    setQr('');
    showRefresh(false);
    setStatus('正在获取二维码…');
    requestJson(QR_API).then(function (resp) {
      if (!resp || !state.open) return;
      if (resp.__error) { onFailure(resp.__error); return; }
      if (!resp.success) { onFailure(resp.msg || '获取二维码失败'); return; }
      var src = isSafeSrc(resp.qrcodeUrl) ? resp.qrcodeUrl : '';
      if (!src || !resp.token) { onFailure('二维码数据无效，请刷新重试'); return; }
      state.token = String(resp.token);
      var ttl = (typeof resp.expiresIn === 'number' && resp.expiresIn > 0)
        ? Math.min(resp.expiresIn * 1000, MAX_MS) : MAX_MS;
      state.deadline = Date.now() + ttl;
      setQr(src);
      setStatus('请使用微信扫一扫登录');
      showRefresh(false);
      startPolling(state.deadline, state.seq);
    });
  }
  function startPolling(deadline, seq) {
    if (state.timer) clearInterval(state.timer);
    var token = state.token;
    state.timer = setInterval(function () {
      if (!state.open || seq !== state.seq) {
        clearInterval(state.timer); state.timer = null; return;
      }
      if (Date.now() >= deadline) {
        stopPolling();
        setQr('');
        setStatus('二维码已过期，请刷新二维码');
        showRefresh(true);
        return;
      }
      pollOnce(token, seq);
    }, POLL_MS);
  }
  function pollOnce(token, seq) {
    requestJson(STATUS_API + encodeURIComponent(token)).then(function (resp) {
      if (!resp || !state.open || seq !== state.seq) return;
      if (resp.__error) { setStatus('等待扫码…（网络重试中）'); return; }
      if (!resp.success) {
        stopPolling();
        onFailure(resp.msg || '登录状态查询失败，请刷新二维码');
        return;
      }
      if (resp.status === 'confirmed') {
        stopPolling();
        setStatus('登录成功，正在跳转…');
        showRefresh(false);
        setTimeout(function () { location.reload(); }, 400);
      } else if (resp.status === 'expired') {
        stopPolling();
        setQr('');
        setStatus('二维码已过期，请刷新二维码');
        showRefresh(true);
      } else {
        setStatus('等待扫码…');
      }
    });
  }

  /* ---------------- 打开 / 关闭 ---------------- */
  function open() {
    if (state.open) return;      // 幂等：重复触发不重复请求
    build();
    overlay.style.display = 'block';
    state.open = true;
    loadQrcode();
  }
  function close() {
    if (!state.open) return;
    state.open = false;
    cancelAll();
    if (overlay) overlay.style.display = 'none';
  }
  function onCapture(e) {
    if (!findTrigger(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    dismissLegacyLoginLayer();
    open();
  }
  function onKeydown(e) {
    if (!state.open) return;
    if (e.key === 'Escape' || e.keyCode === 27) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  /* ---------------- 接管 jQuery 程序化触发 ---------------- */
  function watchLegacyLayer() {
    if (typeof MutationObserver !== 'function') return;
    var observer = new MutationObserver(function (records) {
      // 只检查「本次新增」的节点：注册弹层 / myMsg 提示层被插入时不会命中，
      // 也就不会误开扫码弹层（即便页面上恰好残留着旧的登录弹层）。
      var found = [];
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (!n || n.nodeType !== 1) continue;
          if (isLegacyLoginBox(n)) found.push(n);
          if (n.querySelectorAll) {
            var inner = n.querySelectorAll('.layermbox');
            for (var k = 0; k < inner.length; k++) {
              if (isLegacyLoginBox(inner[k])) found.push(inner[k]);
            }
          }
        }
      }
      if (!found.length) return;
      removeLoginBoxes(found);
      open();
    });
    observer.observe(document.body || document.documentElement,
                     { childList: true, subtree: true });
  }

  document.addEventListener('click', onCapture, true);
  document.addEventListener('keydown', onKeydown, true);
  watchLegacyLayer();
})();
