/**
 * 微信 JS-SDK 自定义分享初始化 v3（可视化调试 + 策略可切换）
 *
 * 依赖：页面已加载 jweixin-1.6.0.js（由 HTML 注入）
 *
 * 签名来源：/open/jsConfig?url=<页面URL去#>（本站开放平台代理，不再直连上游）
 *   返回 { data: { config: { appId, timestamp, nonceStr, signature, jsApiList } } }
 *
 * 【v3 修复的核心问题】v2 在 wx.ready 内把 4 个分享接口「同一时刻同步连调」
 *   （onMenuShareAppMessage / onMenuShareTimeline / updateAppMessageShareData /
 *    updateTimelineShareData）。微信分享设置是「后设覆盖先设」的全局状态，
 *   同步连调会让彼此互相覆盖 —— 每个调用都各自返回 :ok，但最终没有任何一个
 *   真正生效，分享出去仍是裸链接。本版改为「单一策略 + 错峰串行」。
 *
 * 【策略切换】URL 加 ?mode= 可切换，便于真机实测哪种生效：
 *   ?mode=new     仅新版（默认，微信 1.4.0+ 官方推荐）
 *   ?mode=legacy  仅旧版（部分老版本/安卓 WebView 只认这套）
 *   ?mode=both    新旧都调用，但错峰串行（间隔 350ms），非同步连调
 *
 * 【调试面板】URL 加 ?debug=1 时，页面右下角显示实时状态面板：
 *   脚本版本 / 签名与 config 结果 / 实际下发的分享数据 / 缩略图可达性 /
 *   checkJsApi 结果 / 每个分享接口的 ok|fail。
 *   目的：把「调用成功≠内容生效」这类黑盒问题变成肉眼可见的白盒信息。
 */
(function () {
  if (typeof wx === 'undefined') return; // 非微信环境直接跳过
  if (!/MicroMessenger/i.test(navigator.userAgent)) return;

  var VERSION = 'v4-20261011';
  var cfg = window.WX_SHARE_CONFIG || {};
  var api = cfg.api || '/open/jsConfig';

  function meta(prop) {
    var el = document.querySelector('meta[property="' + prop + '"]');
    return el ? (el.getAttribute('content') || '') : '';
  }

  // 绝对地址解析（不用 location.origin，部分微信 WebView 里为 undefined）
  var baseHost = location.protocol + '//' + location.host;
  function absUrl(u) {
    if (!u) return '';
    u = String(u).trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (u.indexOf('//') === 0) return location.protocol + u;
    return baseHost + (u.charAt(0) === '/' ? u : '/' + u);
  }

  var signUrl = location.href.split('#')[0];
  // 【v4 关键修复】分享 link 必须与当前页面 URL 严格一致（含 query）。
  // 此前版本把 ?debug=1 等参数剥掉，导致 link ≠ 当前页面 URL，
  // 微信不会把自定义分享数据挂载到当前会话 —— 表现就是
  // 「config:ok / update:ok 全部正常，但转发出去仍是裸链接」。
  var shareLink = signUrl;

  var rawTitle = meta('og:title') || document.title || '';
  var rawDesc = meta('og:description') || '';
  if (!rawDesc) rawDesc = rawTitle;

  var shareData = {
    title: rawTitle,
    desc: rawDesc,
    link: shareLink,
    imgUrl: absUrl(meta('og:image') || cfg.imgUrl || '')
  };

  var qs = location.search;
  var isDebug = (cfg.debug === true) || /(^|[?&])debug=1(&|$)/.test(qs);
  var mode = 'new';
  var mMode = qs.match(/[?&]mode=(new|legacy|both)(&|$)/);
  if (mMode) mode = mMode[1];

  /* ---------------- 调试面板（白盒） ---------------- */
  var panel = null;
  function log(msg, kind) {
    if (!isDebug) return;
    if (!panel) return;
    var row = document.createElement('div');
    row.setAttribute('style', kind === 'ok' ? 'color:#5ed6c5;padding:1px 0;word-break:break-all'
      : (kind === 'err' ? 'color:#ff8f8f;padding:1px 0;word-break:break-all'
        : 'color:#c9d5e0;padding:1px 0;word-break:break-all'));
    row.textContent = msg;
    panel.appendChild(row);
    panel.scrollTop = panel.scrollHeight;
  }
  function buildPanel() {
    if (!isDebug || panel) return;
    panel = document.createElement('div');
    panel.setAttribute('style', [
      'position:fixed', 'right:8px', 'bottom:8px', 'z-index:2147483647',
      'width:300px', 'max-height:62vh', 'overflow:auto',
      'background:#0b1622', 'color:#e6edf3', 'border:1px solid #2b3947',
      'border-radius:8px', 'padding:10px 12px',
      'font:12px/1.55 Menlo,Consolas,monospace',
      'box-shadow:0 6px 24px rgba(0,0,0,.35)', '-webkit-text-size-adjust:100%'
    ].join(';'));
    var head = document.createElement('div');
    head.setAttribute('style', 'font-weight:700;margin-bottom:6px;color:#5ed6c5');
    head.textContent = '微信分享调试 v4';
    panel.appendChild(head);
    (document.body || document.documentElement).appendChild(panel);
  }

  /* ---------------- 分享设置（单一策略 + 错峰串行） ---------------- */
  function applyShare() {
    var appMsg = { title: shareData.title, desc: shareData.desc, link: shareData.link };
    var timeline = { title: shareData.title, link: shareData.link };
    if (shareData.imgUrl) {
      appMsg.imgUrl = shareData.imgUrl;
      timeline.imgUrl = shareData.imgUrl;
    }

    // 每次调用包一层 success/fail，让面板能确认「调用是否真的成功」
    function wrap(name, fn, payload) {
      if (typeof fn !== 'function') { log('接口不存在 ' + name, 'err'); return; }
      try {
        fn({
          title: payload.title, desc: payload.desc, link: payload.link,
          imgUrl: payload.imgUrl,
          success: function () { log('[ok] ' + name); },
          fail: function (e) { log('[fail] ' + name + ' ' + JSON.stringify(e), 'err'); },
          cancel: function () { }
        });
      } catch (e) {
        log('[throw] ' + name + ' ' + e, 'err');
      }
    }

    var steps;
    if (mode === 'legacy') {
      steps = [
        function () { wrap('onMenuShareAppMessage', wx.onMenuShareAppMessage, appMsg); },
        function () { wrap('onMenuShareTimeline', wx.onMenuShareTimeline, timeline); }
      ];
    } else if (mode === 'both') {
      steps = [
        function () { wrap('onMenuShareAppMessage', wx.onMenuShareAppMessage, appMsg); },
        function () { wrap('onMenuShareTimeline', wx.onMenuShareTimeline, timeline); },
        function () { wrap('updateAppMessageShareData', wx.updateAppMessageShareData, appMsg); },
        function () { wrap('updateTimelineShareData', wx.updateTimelineShareData, timeline); }
      ];
    } else {
      steps = [
        function () { wrap('updateAppMessageShareData', wx.updateAppMessageShareData, appMsg); },
        function () { wrap('updateTimelineShareData', wx.updateTimelineShareData, timeline); }
      ];
    }

    log('策略 mode=' + mode + '，串行设置 ' + steps.length + ' 步（间隔 350ms）');
    var i = 0;
    (function next() {
      if (i >= steps.length) {
        log('分享数据设置完毕，现在可用「···」分享验证', 'ok');
        return;
      }
      steps[i++]();
      setTimeout(next, 350);
    })();
  }

  /* ---------------- 启动 ---------------- */
  buildPanel();
  log('脚本版本 ' + VERSION + '（若看不到本行，说明微信仍在用缓存的旧脚本）');
  log('当前页面 ' + location.href);
  log('分享链接 ' + shareLink);
  log(shareLink === location.href.split('#')[0] ? '链接一致性 OK（与当前页面完全相同）'
                                              : '警告：分享链接与当前页面不一致', 'ok');
  log('标题长度 ' + shareData.title.length + '，摘要长度 ' + shareData.desc.length);
  if (!shareData.title) log('警告：标题为空', 'err');
  if (!shareData.desc) log('警告：摘要为空', 'err');
  if (!shareData.imgUrl) log('警告：无缩略图，微信会退化为纯文本链接', 'err');
  else {
    var probe = new Image();
    probe.onload = function () { log('缩略图可访问 ' + shareData.imgUrl); };
    probe.onerror = function () { log('缩略图加载失败（会退化）', 'err'); };
    probe.src = shareData.imgUrl;
  }

  fetch(api + '?url=' + encodeURIComponent(signUrl))
    .then(function (r) { return r.json(); })
    .then(function (resp) {
      var d = resp && resp.data;
      if (d && typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { } }
      var c = (d && d.config) ? d.config
            : (resp && resp.config) ? resp.config
            : (resp || null);
      if (!c || !c.signature) {
        log('未拿到签名配置：' + JSON.stringify(resp), 'err');
        return;
      }
      log('签名获取成功 appId=' + c.appId);

      // jsApiList 只声明实际使用的分享接口，不把支付/定位等无关接口混进来
      var jsApiList = ['updateAppMessageShareData', 'updateTimelineShareData',
                       'onMenuShareAppMessage', 'onMenuShareTimeline'];

      wx.config({
        debug: isDebug || !!c.debug,
        appId: c.appId,
        timestamp: c.timestamp,
        nonceStr: c.nonceStr,
        signature: c.signature,
        jsApiList: jsApiList
      });

      wx.ready(function () {
        log('wx.ready 触发，开始设置分享数据', 'ok');
        if (wx.checkJsApi) {
          wx.checkJsApi({
            jsApiList: jsApiList,
            success: function (r) { log('checkJsApi ' + JSON.stringify(r.checkResult)); }
          });
        }
        applyShare();
      });

      wx.error(function (err) { log('wx.config 失败 ' + JSON.stringify(err), 'err'); });
    })
    .catch(function (e) { log('签名请求失败 ' + e, 'err'); });
})();
