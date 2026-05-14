const CACHE_NAME = 'unitime-v5';
const STATIC_ASSETS = [
  '/',
  '/mascot-512.png',
  '/mascot.svg',
  '/manifest.json'
];

// Install: Cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching static assets');
      // Use map to catch individual failures so the whole install doesn't crash
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url))
      );
    })
  );
  self.skipWaiting();
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

  const url = new URL(event.request.url);

  // ✅ CRITICAL FIX: DO NOT CACHE Supabase API calls or any other external API requests.
  // This ensures the application always sees the latest data from the database.
  if (url.hostname.includes('supabase.co') || url.hostname.includes('postgrest')) {
    return; // Pass through to network, do not interfere
  }

  // Network-First for Navigation (the main page)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return response;
          }
          return caches.match(event.request);
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-First with Network Fallback for assets
  event.respondWith(
    (async () => {
      try {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          // Verify it's not a 404 cached previously (though we shouldn't cache 404s)
          if (cachedResponse.status === 200) return cachedResponse;
        }

        const networkResponse = await fetch(event.request);
        
        // Only cache successful responses
        if (networkResponse && networkResponse.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkResponse.clone());
        }
        
        return networkResponse;
      } catch (error) {
        console.error('[SW] Fetch failed for:', event.request.url, error);
        
        // If it's a script failure, we might want to trigger a reload or show an error
        if (event.request.destination === 'script') {
          console.warn('[SW] Script failed to load, potentially a stale hash issue.');
        }

        return fetch(event.request);
      }
    })()
  );
});
