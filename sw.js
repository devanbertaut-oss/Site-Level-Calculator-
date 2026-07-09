// Site Level Calculator service worker.
// Navigations are network-first so a new deploy always wins; the cache is
// only a fallback for offline use. Static assets (fonts, Leaflet, map tiles)
// are cache-first with opportunistic fill.
const CACHE = 'sitelevel-v103'; // bump every release alongside APP_VERSION

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c =>
    c.add(new Request('./', { cache: 'reload' })) // bypass HTTP cache when precaching
  ));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./'))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit ||
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
    )
  );
});
