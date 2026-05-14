const CACHE_NAME = 'unitime-v6';

// Never cache these — always fetch fresh so icon/manifest updates are instant
const NEVER_CACHE = [
  '/manifest.json',
  '/mascot.svg',
  '/mascot-512.png',
  '/pwa-icon.png',
  '/logo.png',
  '/logo-full.svg',
];

const STATIC_ASSETS = ['/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url)));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Always pass through: external APIs
  if (url.hostname.includes('supabase.co') || url.hostname.includes('postgrest')) {
    return;
  }

  // Always pass through: icon/manifest files — never serve stale versions
  if (NEVER_CACHE.some(path => url.pathname === path || url.pathname.startsWith(path))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-First for navigation
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
            return response;
          }
          return caches.match(event.request);
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-First with Network Fallback for all other assets
  event.respondWith(
    (async () => {
      try {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse && cachedResponse.status === 200) return cachedResponse;

        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (error) {
        console.error('[SW] Fetch failed:', event.request.url, error);
        return fetch(event.request);
      }
    })()
  );
});
