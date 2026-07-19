const CACHE_NAME = 'tower-app-v179';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-thermal.png',
  './icon-stats.png',
  './icon-lines.png'
];
const EXTRA_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
  'https://unpkg.com/docx@8.5.0/build/index.js'
];

// Install: cache the app shell — الأساسيات يجب أن تنجح، والمكتبات الخارجية اختيارية
// (لو فشلت مكتبة خارجية بالتحميل، ما نوقف حفظ باقي التطبيق بسببها)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // مهم: نفرض تجاوز ذاكرة التخزين المؤقت للمتصفح (cache:'reload') حتى نضمن جلب أحدث نسخة فعلية
      // من الشبكة، وليس نسخة قديمة محفوظة بذاكرة المتصفح رغم تغيّر اسم الكاش
      await Promise.all(CORE_ASSETS.map(url =>
        cache.add(new Request(url, { cache: 'reload' }))
      )); // يجب أن تنجح هذي، وإلا التثبيت يفشل بالكامل (أمان)
      await Promise.all(EXTRA_ASSETS.map(url =>
        cache.add(new Request(url, { cache: 'reload' })).catch(err => console.log('Optional asset failed (non-critical):', url, err))
      ));
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches — لكن فقط بعد التأكد إن النسخة الجديدة فيها صفحة رئيسية صالحة
// (لو فشل تحميل النسخة الجديدة بسبب انقطاع الإنترنت، نحتفظ بالنسخة القديمة الشغالة كخطة بديلة)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (newCache) => {
      const hasValidIndex = await newCache.match('./index.html');
      if (hasValidIndex) {
        const keys = await caches.keys();
        return Promise.all(
          keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        );
      }
      console.log('New cache incomplete (offline during update?) — keeping old cache as fallback');
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
