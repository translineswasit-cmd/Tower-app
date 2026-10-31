const CACHE_NAME = 'tower-app-v335-C6r33-N24B3B';   // مرشّح اختبار — ليس إصداراً معتمداً
// N23: خطوط المذكرة في كاش مستقل غير مرتبط برقم الإصدار (≈1.9MB): لا تُعاد تنزيلها مع كل إصدار، وتُخزَّن عند أول استخدام للمذكرة (دون إبطاء بدء التطبيق).
const FONT_CACHE = 'tower-memo-fonts-v1';


// v335-C6r28 (P03-C4): مكتبات التصدير المحلية (jsPDF/XLSX/ExcelJS) في كاش مستقل غير مرتبط برقم إصدار التطبيق (≈2.2MB): لا تُعاد تنزيلها مع كل إصدار.
// لا تدخل CRITICAL_ASSETS فلا تؤخّر التثبيت ولا بدء التطبيق؛ تُخزَّن (أ) بعد خمول الصفحة بإنترنت عبر رسالة 'precache-export-libs' من الصفحة،
// و(ب) عند أول جلب فعلي. لا تُخزَّن أي استجابة إلا إن طابقت الحجم وبصمة SHA-256 المثبّتين (يحمي من صفحة تسجيل دخول واي فاي مقيِّد أو تنزيل ناقص).
// عند تغيير أي ملف مكتبة: عدّل LIB_PINS وارفع لاحقة LIB_CACHE (v1→v2) ليحذف التنشيط الكاش القديم.
const LIB_CACHE = 'tower-export-libs-v1';
const LIB_PINS = {
  'jspdf.umd.min.js': { bytes: 364463, sha256: '98ccf17aa10c20bb1301762618fcc9b6ab3a4e7f26b6071d64d0b41154df3875' },
  'xlsx.full.min.js': { bytes: 881727, sha256: 'c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99' },
  'exceljs.min.js': { bytes: 947702, sha256: '7e49da68588e250dbb8bba190d2caa8ab3787cc0284bda1d8b2f805c4df742c9' }
};
const LIB_RE = /\/vendor\/(jspdf\.umd\.min\.js|xlsx\.full\.min\.js|exceljs\.min\.js)$/;
async function libStoreIfPinned(cache, url, response) {
  try {
    const name = url.split('/').pop(), pin = LIB_PINS[name];
    if (!pin || !response || !response.ok || response.status !== 200) return false;
    const buf = await response.clone().arrayBuffer();
    if (buf.byteLength !== pin.bytes) return false;
    const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map(x => x.toString(16).padStart(2, '0')).join('');
    if (h !== pin.sha256) return false;
    await cache.put(url, response);
    return true;
  } catch (e) { return false; }
}
async function precacheExportLibs() {
  try {
    const c = await caches.open(LIB_CACHE);
    for (const name of Object.keys(LIB_PINS)) {
      const url = new URL('./vendor/' + name, self.registration.scope).href;
      if (await c.match(url)) continue;
      try { const r = await fetch(url, { cache: 'reload' }); await libStoreIfPinned(c, url, r); } catch (e) {}
    }
  } catch (e) {}
}
self.addEventListener('message', (event) => {
  if (event.data === 'precache-export-libs') event.waitUntil(precacheExportLibs());
});

// الأساسيات الحرجة فقط: بدونها التطبيق لا يعمل offline إطلاقاً
const CRITICAL_ASSETS = [
  './',
  './index.html',
  './lines-data.js',
  './stamp.png',
  './work-orders.js',
  './backup.js',
  './memo.js',
  './memo-doc.js',
  './memo-editor.js',
  './period-summary.js',
  './daily-report.js',
  './inventory.js',
  './records-reports.js',
  './period-stats.js',   // v335-C6r17 (N22): إحصائيات الفترة (تخزين مسبق للعمل بدون إنترنت؛ لا يُنفَّذ إلا عند فتح الصفحة)
  // v335-C5r6: وحدات الكشف الحراري (تُخزَّن للعمل بدون إنترنت؛ التخزين المسبق ليس تنفيذاً — تُنفَّذ عند الطلب فقط)
  './thermal-inspection.js',
  './thermal-archive.js',
  './thermal-archive-print.js',
  './official-form.js',
  './official-form-archive.js',
  './official-form-export.js',
  // v335-C5r7: وحدات إحصائيات الموظفين/كادر القسم (تخزين مسبق للعمل بدون إنترنت؛ لا تُنفَّذ إلا عند الطلب)
  './staff-stats.js',
  './staff-activity.js',
  './staff-roster.js',
  './staff-roster-print.js',
  // v335-C5r8: وحدات الكشف البصري/المغادرات/المعالجة/التصدير (تخزين مسبق للعمل بدون إنترنت؛ لا تُنفَّذ إلا عند الطلب)
  './inspection-editor.js',
  './tower-svg.js',
  './departures-list.js',
  './treatment-editor.js',
  './treatment-history.js',
  './tower-history.js',
  './treatment-log-export.js',
  './departures-export.js',
  './records-export.js',
  // v335-C5r9: وحدات بيانات الخطوط/الحسابات/المغادرات الطارئة/برقية العمل (تخزين مسبق للعمل بدون إنترنت؛ لا تُنفَّذ إلا عند الطلب)
  './lines-pages.js',
  './lines-admin.js',
  './lines-print.js',
  './accounts.js',
  './emergency-departures.js',
  './work-telegram.js'
];

// أصول مساندة: مرغوبة لكن فشلها يجب ألا يُسقط التثبيت بالكامل
const OPTIONAL_ASSETS = [
  './manifest.json',
  './icon-thermal.png',
  './icon-stats.png',
  './icon-lines.png',
  './icon192.png',
  './icon512.png',
  './icon-192.png',
  './icon-512.png'
];

const EXTRA_ASSETS = [
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
        await Promise.all(
          keys.filter(key => key !== CACHE_NAME && key !== FONT_CACHE && key !== LIB_CACHE).map(key => caches.delete(key))
        );
        // كاش المكتبات: يبقى؛ وتُحذف منه أي مادة خارج القائمة الحالية
        if (keys.includes(LIB_CACHE)) {
          const lc = await caches.open(LIB_CACHE);
          for (const r of await lc.keys()) if (!LIB_PINS[r.url.split('/').pop()]) await lc.delete(r);
        }
        return;
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

  // خطوط المذكرة ومكتبة docx المثبّتة للمذكرة: كاش مستقل، cache-first، تُخزَّن عند أول جلب ناجح
  if (/\/(fonts\/[^/]+\.ttf|vendor\/docx-[^/]+\.js)$/.test(url)) {
    event.respondWith(caches.open(FONT_CACHE).then(async (fc) => {
      const hit = await fc.match(event.request); if (hit) return hit;
      const net = await fetch(event.request);
      if (net.ok) fc.put(event.request, net.clone());
      return net;
    }));
    return;
  }
  // مكتبات التصدير المحلية: cache-first من كاش المكتبات (لا ينشئ كاشاً فارغاً)، وإلا الشبكة مع تخزين مشروط بالبصمة
  if (LIB_RE.test(url)) {
    event.respondWith((async () => {
      const hit = await caches.match(url, { cacheName: LIB_CACHE });
      if (hit) return hit;
      try {
        const net = await fetch(event.request);
        if (net.ok) { const copy = net.clone(); event.waitUntil((async () => { await libStoreIfPinned(await caches.open(LIB_CACHE), url, copy); })()); }   // النسخة تُؤخذ قبل أي await وقبل أن تستهلك الصفحة الجسم
        return net;
      } catch (e) { return new Response('', { status: 504, statusText: 'Offline' }); }
    })());
    return;
  }
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
