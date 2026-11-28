// 细聊 PWA Service Worker：缓存静态资源，提升 iOS「添加到主屏幕」后的启动体验。
// 采用网络优先、缓存兜底策略，保证聊天数据始终取最新；仅静态资源走缓存。
const CACHE = 'xiliao-pwa-v1';
const STATIC = ['/', '/logo.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 只缓存同源的静态资源；API / WebSocket 不缓存
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) return;

  event.respondWith(
    fetch(req).then((resp) => {
      if (resp && resp.status === 200 && resp.type === 'basic') {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return resp;
    }).catch(() => caches.match(req).then((r) => r || caches.match('/')))
  );
});
