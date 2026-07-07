const CACHE = 'wapilot-v7.4.94';
const TILE_CACHE = 'wapilot-tiles-v7.4';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all([
        fetch('/WA-Pilotv2/index.html').then(res => {
          if (!res.ok) throw new Error('pre-cache fetch failed: index.html ' + res.status);
          return cache.put('index.html', res);
        }),
        fetch('/WA-Pilotv2/sql-wasm.js').then(res => {
          if (!res.ok) throw new Error('pre-cache fetch failed: sql-wasm.js ' + res.status);
          return cache.put('/WA-Pilotv2/sql-wasm.js', res);
        }),
        fetch('/WA-Pilotv2/sql-wasm.wasm').then(res => {
          if (!res.ok) throw new Error('pre-cache fetch failed: sql-wasm.wasm ' + res.status);
          return cache.put('/WA-Pilotv2/sql-wasm.wasm', res);
        })
      ])
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
    return;
  }

  // Cache-first for bundled sql.js engine — pre-cached on install, never depends on live reception
  if (url.includes('/WA-Pilotv2/sql-wasm.js') || url.includes('/WA-Pilotv2/sql-wasm.wasm')) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request))
    );
    return;
  }
});
