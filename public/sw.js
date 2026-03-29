const CACHE_NAME = 'unitime-v2'; // Incrementing to force update
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/pwa-icon.png',
  '/manifest.json',
  '/index.css'
];

// Install: Cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting(); // Force update
});

// Activate: Clean up old caches
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
  self.clients.claim(); // Take control immediately
});

// Fetch: Fail-safe logic
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      try {
        // 1. Try to find in cache
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        // 2. Not in cache, try network
        return await fetch(event.request);
      } catch (error) {
        console.error('[SW] Fetch failed for:', event.request.url, error);
        
        // 3. Last resort: If fetch fails (network error), just try to fetch again bypassing SW
        // or return the cached version if possible.
        // For navigation requests, we should at least serve index.html if possible
        if (event.request.mode === 'navigate') {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match('/index.html')) || (await fetch(event.request));
        }
        
        // Final fallback: just let the browser handle it if we can
        return fetch(event.request);
      }
    })()
  );
});
