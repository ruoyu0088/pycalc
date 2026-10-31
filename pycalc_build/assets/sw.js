/*
 * PyCalc service worker.
 *
 * The build replaces the cache version with a hash of the final HTML and the
 * entry with the relative page ("./" for index.html, otherwise the output
 * filename).
 */
const CACHE_NAME = 'pycalc-__PYCALC_CACHE_VERSION__';
const ENTRY = __PYCALC_ENTRY__;
const ENTRY_URL = new URL(ENTRY, self.registration.scope).href;
const PRECACHE = [
  ENTRY_URL,
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('pycalc-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (self.location.protocol === 'file:') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The browser manages sw.js updates itself; never serve it from Cache Storage.
  if (url.pathname.endsWith('/sw.js')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const copy = response.clone();
          event.waitUntil(cache.put(request, copy).catch(() => {}));
        }
        return response;
      } catch (error) {
        if (request.mode === 'navigate') {
          const fallback = await cache.match(ENTRY_URL);
          if (fallback) return fallback;
        }
        throw error;
      }
    })()
  );
});
