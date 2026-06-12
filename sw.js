const CACHE = 'wapilot-v7.4.79';
const TILE_CACHE = 'wapilot-tiles-v7.4';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      fetch('/WA-Pilotv2/index.html').then(res => {
        if (!res.ok) throw new Error('pre-cache fetch failed: ' + res.status);
        return cache.put('index.html', res);
      })
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
    )).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Network-first for the app shell — try network, cache fresh copy, fall back to cache if offline
  if (url.endsWith('/') || url.includes('index.html')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(cache => cache.put(e.request, res.clone()));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for Mapbox tiles
  if (url.includes('api.mapbox.com/v4/') || url.includes('api.mapbox.com/styles/') || url.includes('api.mapbox.com/fonts/') || url.includes('api.mapbox.com/sprites/')) {
    e.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(e.request).then(r => r || fetch(e.request).then(res => {
          cache.put(e.request, res.clone());
          return res;
        }))
      )
    );
  }
});
