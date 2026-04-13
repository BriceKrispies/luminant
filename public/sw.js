/**
 * Luminant service worker.
 *
 * Strategy:
 *   - index.html: network-first (so new deploys are picked up immediately)
 *   - Hashed assets (JS/CSS with content hash in filename): cache-first (immutable)
 *   - Everything else (WASM, manifest, icons): stale-while-revalidate
 *
 * The __BUILD_HASH__ token is replaced at build time by vite.config.js,
 * giving each deploy a unique cache name. Old caches are purged on activate.
 * In dev mode the token stays as-is, which is fine — SW is a no-op in dev.
 */

const CACHE_NAME = 'luminant-__BUILD_HASH__';

self.addEventListener('install', () => {
  // Activate new SW immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// Allow client to trigger skipWaiting if the SW is in waiting state
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  // Purge every cache that isn't the current version
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

/**
 * Returns true for Vite-hashed filenames like /assets/main-Ab3Cd4Ef.js
 * These are content-addressed and safe to cache forever.
 */
function isHashedAsset(url) {
  return /\/assets\/[^/]+-[a-zA-Z0-9]{8,}\.(js|css)$/.test(url.pathname);
}

/** Returns true for navigation requests (HTML pages) */
function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // ── HTML / navigation: network-first ──
  // Always try network so new deploys are picked up.
  // Fall back to cache for offline support.
  if (isNavigationRequest(event.request) || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ── Hashed assets: cache-first (immutable) ──
  if (isHashedAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // ── Everything else (WASM, manifest, icons): stale-while-revalidate ──
  // Serve cached version immediately, but fetch fresh copy in background.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return response;
      });
      return cached || networkFetch;
    })
  );
});
