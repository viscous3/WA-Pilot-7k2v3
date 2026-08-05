const CACHE = 'wapilot-v7.4.108';
const TILE_CACHE = 'wapilot-tiles-v7.4';

// FIX 89 (Session 68) — how long the app shell waits for the network before it
// gives up and serves the copy already on the phone. 3s, NOT 2s: the one real
// field measurement is 1927ms first-byte on a MILD 1-bar launch that completed
// fine, and a 2s cut-off sits on top of it and would needlessly downgrade
// ordinary launches to cache. Against a hang measured in MINUTES, 2s vs 3s is
// invisible, so the margin is bought cheaply.
const SHELL_TIMEOUT_MS = 3000;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all([
        fetch('/WA-Pilot-7k2v3/index.html').then(res => {
          if (!res.ok) throw new Error('pre-cache fetch failed: index.html ' + res.status);
          return cache.put('index.html', res);
        }),
        fetch('/WA-Pilot-7k2v3/sql-wasm.js').then(res => {
          if (!res.ok) throw new Error('pre-cache fetch failed: sql-wasm.js ' + res.status);
          return cache.put('/WA-Pilot-7k2v3/sql-wasm.js', res);
        }),
        fetch('/WA-Pilot-7k2v3/sql-wasm.wasm').then(res => {
          if (!res.ok) throw new Error('pre-cache fetch failed: sql-wasm.wasm ' + res.status);
          return cache.put('/WA-Pilot-7k2v3/sql-wasm.wasm', res);
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

  // Network-first for the app shell, BUT with a 3s ceiling — FIX 89 (Session 68).
  //
  // THE BUG THIS FIXES: the old code was fetch(...).then(...).catch(() => cache).
  // `.catch()` fires only when the network REJECTS. On ~1 bar of reception a
  // request opens but never completes — it neither resolves nor rejects — so the
  // fallback never ran and the app sat waiting MINUTES for an HTML file already
  // on the phone. PROVEN by running the old code against a never-settling fetch:
  // it served nothing at all, while the cached page was available the whole time.
  // Airplane mode was always fine precisely because that REJECTS, so it fell
  // straight to cache — which is why the app worked offline but hung on 1 bar.
  //
  // The network fetch is deliberately NOT aborted when the timer wins: it keeps
  // running so its .then() still refreshes the cache for the next launch.
  //
  // The Server-Timing tag records which path answered; the page reads it in the
  // load handler and writes ONE line into the debug log. It is the standing
  // answer to "did the timeout fire, and did it help?" — and a slow launch with
  // NO such entry says the service worker was NOT the cause.
  if (url.endsWith('/') || url.includes('index.html')) {
    const started = Date.now();

    // Rebuild rather than mutate: headers on a fetched/cached Response are
    // immutable. Verified against the real Fetch API that res.clone() for the
    // cache write does NOT lock the original body, so this still works on every
    // good-reception launch. Tagging must NEVER cost the pilot the page, hence
    // the catch returning the untagged response.
    const tag = (res, source) => {
      try {
        const h = new Headers(res.headers);
        h.set('Server-Timing', 'wapshell;desc="' + source + '";dur=' + (Date.now() - started));
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
      } catch (err) {
        return res;
      }
    };

    const network = fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE).then(cache => cache.put(e.request, res.clone()));
      return res;
    });

    // Resolves (never rejects) at the deadline, so it can only ADD an outcome —
    // it can never turn a good network response into a failure.
    const deadline = new Promise(resolve => setTimeout(() => resolve(undefined), SHELL_TIMEOUT_MS));

    e.respondWith(
      Promise.race([network.catch(() => undefined), deadline]).then(winner => {
        if (winner) return tag(winner, 'network');          // network won: as before
        return caches.match(e.request).then(cached => {
          if (cached) return tag(cached, 'cache-timeout');  // THE FIX FIRING
          // Nothing cached (first-ever launch). Wait for the network rather than
          // fail — a slow launch beats a broken one. If the network has ALREADY
          // rejected, this re-raises that real error so the browser can show its
          // own connection-failure page. That corner cannot be saved: there is
          // no page anywhere to serve. Today's code is equally broken there.
          return network.then(res => tag(res, 'network-late'));
        });
      })
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
  if (url.includes('/WA-Pilot-7k2v3/sql-wasm.js') || url.includes('/WA-Pilot-7k2v3/sql-wasm.wasm')) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request))
    );
    return;
  }
});
