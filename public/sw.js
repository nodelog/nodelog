// NODELOG Service Worker：离线缓存静态资源，/api 走网络优先降级
var CACHE = 'nodelog-v1';
var PRECACHE = [
  '/',
  '/css/style.css',
  '/css/theme.css',
  '/css/bootstrap.css',
  '/js/main.js',
  '/js/common.js',
  '/js/editor.js',
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
        if (k !== CACHE) return caches.delete(k);
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return; // 不缓存写请求
  var url = new URL(req.url);

  // 上传/接口：网络优先，失败回退缓存
  if (url.pathname.indexOf('/api/') === 0) {
    e.respondWith(fetch(req).catch(function () { return caches.match(req); }));
    return;
  }

  // 用户上传的图片：缓存优先，缺失则网络并写入缓存
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

  // 其余静态资源：缓存优先，缺失则网络并写入缓存
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
