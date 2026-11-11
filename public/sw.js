// NODELOG Service Worker
// 原则：**服务端渲染的动态 HTML 页面绝不缓存**（登录态、文章列表、公告数都是实时数据），
// 一律网络优先；只有静态资源（css/js/图片）才缓存优先。
// v1 曾把首页 HTML 预缓存并 cache-first，导致强刷拿到旧快照、退出登录不生效、部署后白屏。
// v5：本次又改了 /js/common.js（退出后整页刷新以反映服务端登出态），必须再升版本，
// 否则 cache-first 会让已安装 SW 的用户永远跑旧的 common.js。
var CACHE = 'nodelog-v5';
var PRECACHE = [
  '/css/theme.css',
  '/css/bootstrap.css',
  '/js/layer/need/layer.css',
  '/js/jquery-1.10.2.min.js',
  '/js/bootstrap.js',
  '/js/layer/layer.js',
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
function isDynamicRequest(req, url) {
  var p = url.pathname;
  return isHtmlRequest(req) ||
    p.indexOf('/api/') === 0 ||
    p.indexOf('/open/') === 0 ||
    p === '/comment/all' ||
    p.indexOf('/session') === 0;
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

  // 3) 其余静态资源：缓存优先，缺失则网络并写入缓存
  e.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (resp) {
        if (resp && resp.status === 200 && (resp.type === 'basic' || url.origin === self.location.origin)) {
          var cp = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, cp); });
        }
        return resp;
      });
    })
  );
});
