const CACHE_NAME = 'tower-app-v51';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-thermal.png',
  './icon-stats.png',
  './icon-lines.png',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'
];

// Install: cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.log('Cache addAll error (non-critical):', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch strategy:
// - For Supabase API calls: always go to network (never cache data)
// - For app shell (HTML/JS/CSS): cache-first, so it works offline
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Never cache Supabase API requests - these need fresh data or should fail naturally for offline queueing
  if (url.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // App shell: cache-first strategy
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Cache new requests to CDN scripts etc.
        if (event.request.method === 'GET' && networkResponse.ok) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // If both cache and network fail, return the cached index.html as fallback
        return caches.match('./index.html');
      });
    })
  );
});
