const CACHE_NAME = 'tower-app-lite-v1';

// الأساسيات الحرجة فقط: بدونها التطبيق لا يعمل offline إطلاقاً
const CRITICAL_ASSETS = [
  './',
  './lite.html'
];

// أصول مساندة: مرغوبة لكن فشلها يجب ألا يُسقط التثبيت بالكامل
const OPTIONAL_ASSETS = [
  './lite-manifest.json',
  './icon192.png',
  './icon512.png'
];

// Install: الأساسيات يجب أن تنجح، وكل ما عداها اختياري
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(CRITICAL_ASSETS);
      await Promise.all(OPTIONAL_ASSETS.map(async (url) => {
        try { await cache.add(url); } catch (e) {}
      }));
    })
  );
  self.skipWaiting();
});

// Activate: نحذف أي كاش قديم من إصدار سابق للنسخة الخفيفة (لا يمس كاش التطبيق الأصلي)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME && key.startsWith('tower-app-lite-'))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: شبكة أولاً مع سقوط للكاش عند الفشل (يضمن أحدث نسخة أونلاين، ويشتغل أوفلاين)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
