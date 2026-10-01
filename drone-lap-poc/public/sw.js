// Network-first for same-origin GETs, cache fallback so the app opens offline after one visit.
const CACHE = 'lap-counter-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())));

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  e.respondWith(fetch(request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
    return res;
  }).catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit ?? caches.match('./index.html'))));
});
