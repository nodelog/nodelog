// NODELOG Service Worker
// 原则：**所有内容都以网络为准**——动态 HTML 页面绝不缓存（登录态/文章列表/公告数是实时数据），
// 静态资源（css/js/图片）虽写缓存兜底离线，但读取一律网络优先，保证改完部署即生效。
// v1 曾把首页 HTML 预缓存并 cache-first，导致强刷拿到旧快照、退出登录不生效、部署后白屏。
// v7：去框架化后，前台/后台不再加载 jQuery / Bootstrap / layer，改为
// theme.css + app.css（零依赖结构层）+ ui.js（原生弹层/Toast）+ common.js（原生 DOM/fetch）。
// v8：静态资源（css/js/图片/字体/第三方库）从「缓存优先」改为「网络优先」。
//     缓存优先会导致：改了 CSS/JS 后普通刷新仍拿旧文件、只有强刷才生效，而强刷又不回写缓存，
//     于是「强刷一次生效一次、不强刷又回退」。网络优先：每次先问服务器（未变更走 304，
//     开销极小），成功即写缓存，离线才回退缓存——改完部署后普通刷新即可生效，不再回退。
var CACHE = 'nodelog-v8';
var PRECACHE = [
  '/css/theme.css',
  '/css/app.css',
  '/js/ui.js',
  '/js/common.js',
  '/js/jweixin-1.6.0.js',
  // 下面两个带版本号：与前台实际加载的 URL 完全一致，cache-first 才能直接命中
  '/js/wechat-share.js?v=20261111',
  '/js/qr-login.js?v=20261111',
  '/images/favicon.ico'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(PRECACHE).catch(function () {}); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        // 升级时清掉旧版本缓存（含 v1 缓存的首页 HTML 快照）
        if (k !== CACHE) return caches.delete(k);
      }));
    })
  );
  self.clients.claim();
});

function isHtmlRequest(req) {
  // 导航请求（地址栏/刷新/点链接）一律视为动态页面
  if (req.mode === 'navigate') return true;
  var accept = req.headers.get('accept') || '';
  return accept.indexOf('text/html') !== -1;
}

// 动态请求一律网络优先且不写缓存。
// /open/* 是并发落地的微信扫码登录/开放平台接口：/open/status 是轮询接口，
// Accept 不是 text/html，若走静态资源 cache-first 会被缓存成旧响应，扫码登录会卡在「等待扫码」。
// 注意：之前 /tags 这类「应用数据接口」被当成静态资源走 cache-first，首屏拿到空结果后永远缓存，
// 导致标签云强刷才出现、普通刷新又消失 —— 所以凡是非静态资源的应用请求都归为动态。
function isStaticAsset(url) {
  var p = url.pathname;
  return p.indexOf('/css/') === 0 ||
    p.indexOf('/js/') === 0 ||
    p.indexOf('/images/') === 0 ||
    p.indexOf('/uploads/') === 0 ||
    p.indexOf('/vendor/') === 0 ||
    p.indexOf('/fonts/') === 0;
}
function isDynamicRequest(req, url) {
  return isHtmlRequest(req) ||
    !isStaticAsset(url) ||
    url.pathname.indexOf('/open/') === 0 ||
    url.pathname === '/comment/all' ||
    url.pathname.indexOf('/session') === 0;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return; // 不干预写请求
  var url = new URL(req.url);

  // 1) 动态 HTML / 接口（含 /open/* 轮询）：网络优先，且**不写入缓存**；断网时才回退已缓存的页面
  if (isDynamicRequest(req, url)) {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match(req).then(function (cached) {
          if (cached) return cached;
          if (isHtmlRequest(req)) {
            return new Response(
              '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>暂时离线</title>' +
              '<body style="font-family:sans-serif;padding:40px"><h2>暂时无法连接服务器</h2>' +
              '<p>请检查网络后 <a href="/">重新加载</a>。</p></body></html>',
              { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          }
          return new Response(JSON.stringify({ success: false, msg: 'offline' }),
            { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
        });
      })
    );
    return;
  }

  // 2) 用户上传的图片：缓存优先，缺失则网络并写入缓存
  if (url.pathname.indexOf('/uploads/') === 0) {
    e.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (resp) {
          if (resp && resp.status === 200) {
            var cp = resp.clone();
            caches.open(CACHE).then(function (c) { c.put(req, cp); });
          }
          return resp;
        });
      })
    );
    return;
  }

  // 3) 其余静态资源（css/js/fonts/vendor/images）：网络优先，成功即写缓存，离线才回退缓存。
  //    这样改完 CSS/JS 部署后，普通刷新就能拿到新版，不必强刷、也不会「强刷一次又回退」。
  //    未变更的资源服务器返回 304，浏览器直接用本地副本，额外成本只有一个轻量协商请求。
  e.respondWith(
    fetch(req).then(function (resp) {
      if (resp && resp.status === 200 && (resp.type === 'basic' || url.origin === self.location.origin)) {
        var cp = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(req, cp); });
      }
      return resp;
    }).catch(function () {
      // 网络失败（离线/服务器不可达）时才用缓存兜底，保证 PWA 离线可用
      return caches.match(req).then(function (cached) {
        if (cached) return cached;
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
