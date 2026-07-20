const CACHE_NAME = 'tower-app-v201';

// الأساسيات الحرجة فقط: بدونها التطبيق لا يعمل offline إطلاقاً
const CRITICAL_ASSETS = [
  './',
  './index.html'
];

// أصول مساندة: مرغوبة لكن فشلها يجب ألا يُسقط التثبيت بالكامل
const OPTIONAL_ASSETS = [
  './manifest.json',
  './icon-thermal.png',
  './icon-stats.png',
  './icon-lines.png',
  './icon192.png',
  './icon512.png'
];

const EXTRA_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
  'https://unpkg.com/docx@8.5.0/build/index.js'
];

// Install: الأساسيات يجب أن تنجح، وكل ما عداها اختياري
// (سابقاً كان فشل أي أيقونة أو manifest يُفشل التثبيت كله ويعطّل العمل بدون إنترنت)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // cache:'reload' يفرض الجلب من الشبكة وتجاوز ذاكرة المتصفح
      await Promise.all(CRITICAL_ASSETS.map(url =>
        cache.add(new Request(url, { cache: 'reload' }))
      ));
      await Promise.all(OPTIONAL_ASSETS.map(url =>
        cache.add(new Request(url, { cache: 'reload' }))
          .catch(err => console.log('Optional asset missing (non-critical):', url, err))
      ));
      await Promise.all(EXTRA_ASSETS.map(url =>
        cache.add(new Request(url, { cache: 'reload' }))
          .catch(err => console.log('CDN asset failed (non-critical):', url, err))
      ));
    })
  );
  self.skipWaiting();
});

// Activate: لا نحذف الكاش القديم إلا بعد التأكد أن النسخة الجديدة تحتوي صفحة رئيسية صالحة
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

// Fetch:
// - طلبات Supabase: دائماً من الشبكة (لا تُخزَّن أبداً)
// - هيكل التطبيق: cache-first ليعمل بدون إنترنت
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // طلبات Supabase: لا تُعترض إطلاقاً — تذهب للشبكة مباشرة ليصل فشلها للتطبيق فيحفظ أوف لاين
  if (url.includes('supabase.co')) return;

  // أي طلب غير GET (POST/PATCH/DELETE): لا يُعترض ولا يُخزَّن — التخزين المؤقت للقراءة فقط
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse.ok) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(async () => {
        // صفحة الاحتياط تُقدَّم فقط لطلبات فتح صفحة (تنقّل)، لا لصورة أو سكربت
        // (سابقاً كانت تُرجَع index.html مكان أي ملف فاشل، فتظهر أخطاء غريبة بدل فشل نظيف)
        if (event.request.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
