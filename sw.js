// Site Level Calculator service worker.
//
// Navigations are network-first so a new deploy always wins; the cache is only a
// fallback for offline use. Static assets (fonts, Leaflet, map tiles) are
// cache-first with opportunistic fill.
//
// The shell cache name is derived from the ?v= on the registration URL
// (`register('./sw.js?v=' + APP_VERSION)`), so bumping APP_VERSION in index.html
// is the whole release procedure — there is no second constant to forget.
const VER          = new URL(self.location).searchParams.get('v') || 'dev';
const SHELL_CACHE  = 'sitelevel-shell-' + VER;
// Map tiles live OUTSIDE the versioned cache. They used to share it, so every
// release threw away whatever offline coverage the crew had accumulated.
const TILE_CACHE   = 'sitelevel-tiles-v1';
const TILE_MAX     = 500;
// A weak signal or a captive portal can leave fetch() neither resolving nor
// rejecting. respondWith() then stays pending and the browser paints NOTHING —
// while a complete, working copy of the app sits in the cache on the device.
// That is the most common way an offline-capable PWA fails in the field.
const NET_TIMEOUT_MS = 2500;

const SHELL = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/fonts/Oswald-var.woff2',
  './vendor/fonts/RobotoMono-var.woff2'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(SHELL_CACHE).then(c =>
      // The document is fetched with cache:'reload' to bypass the HTTP cache.
      // The rest are added individually so a single 404 cannot fail the whole
      // install the way addAll() (all-or-nothing) would.
      c.add(new Request('./', { cache: 'reload' })).then(() =>
        Promise.all(SHELL.map(u => c.add(u).catch(() => {})))
      )
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k !== TILE_CACHE)   // keep accumulated tiles
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Only durable, successful, readable responses are worth storing. Caching an
// opaque or error response pins it until the cache name changes.
function cacheable(res){
  return !!res && res.ok && res.status === 200 && res.type !== 'opaque';
}

// Keep the tile cache from growing without bound on an old phone.
async function trimTiles(cache){
  const keys = await cache.keys();
  if(keys.length <= TILE_MAX) return;
  await Promise.all(keys.slice(0, keys.length - TILE_MAX).map(k => cache.delete(k)));
}

function isTile(url){
  return /(^|\.)tile\.openstreetmap\.org$/.test(url.hostname);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch(err){ return; }

  // ---- Navigations: network-first, but never hang ----
  if(req.mode === 'navigate'){
    e.respondWith((async () => {
      const cached = await caches.match('./');
      const net = fetch(req).then(res => {
        if(cacheable(res)){
          const copy = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put('./', copy)).catch(() => {});
        }
        return res;
      });
      // With a cached shell available, a stalled network loses the race after
      // NET_TIMEOUT_MS and the crew gets the working app instead of a white
      // screen. With no cached shell there is nothing better to show, so we wait
      // for the network however long it takes.
      if(!cached) return net;
      const timeout = new Promise(resolve => setTimeout(() => resolve(null), NET_TIMEOUT_MS));
      const winner = await Promise.race([net.catch(() => null), timeout]);
      return winner || cached;
    })());
    return;
  }

  // ---- Map tiles: cache-first into their own unversioned, trimmed cache ----
  if(isTile(url)){
    e.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if(hit) return hit;
      const res = await fetch(req);
      if(cacheable(res)){
        cache.put(req, res.clone()).then(() => trimTiles(cache)).catch(() => {});
      }
      return res;
    })());
    return;
  }

  // ---- Everything else: cache-first with opportunistic fill ----
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if(hit) return hit;
    const res = await fetch(req);
    if(cacheable(res)){
      const copy = res.clone();
      caches.open(SHELL_CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  })());
});
