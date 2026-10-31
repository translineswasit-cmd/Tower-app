/* staff-stats.js — v335-C5r7
   ملخّص إحصائيات الموظفين (القائمة + نافذة تفاصيل الموظف). تفاصيل الفترة تُحمَّل من staff-activity.js عند الطلب.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
(function mount_staffStatsDetailModal() {
  const page = document.getElementById('page-staffStats');
  if (!page || document.getElementById('staffStatsDetailModal')) return;
  page.insertAdjacentHTML('afterend', `
<div class="modal-bg" id="staffStatsDetailModal">
  <div class="modal-box" style="max-width:480px;text-align:right">
    <h3 style="text-align:center;margin-bottom:4px"><img src="icon-stats.png" style="width:24px;height:24px;vertical-align:middle;margin-left:6px"><span id="ssDetailName">تفاصيل</span></h3>
    <div id="ssDetailBody" style="margin-top:14px"></div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <input type="date" id="ssEmp_from" style="padding:8px 10px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.8rem;flex:1">
      <input type="date" id="ssEmp_to" style="padding:8px 10px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.8rem;flex:1">
    </div>
    <button class="btn btn-secondary" style="margin-top:8px;width:100%" onclick="loadStaffEmployeeDetailedActivity()">🔍 عرض تفاصيل أعماله بهذي الفترة</button>
    <div id="ssEmpDetailedActivity" style="margin-top:10px"></div>
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn btn-secondary" onclick="document.getElementById('staffStatsDetailModal').classList.remove('show')">إغلاق</button>
    </div>
  </div>
</div>
`);
})();

// ========================
// STAFF STATISTICS (إحصائيات الموظفين)
// ========================
let staffStatsCache = null;

// v335-C6r27 (P03B1): نفس الاستعلامات والترتيب (الخادم يضيف id كفاصل ثابت) لكن بترقيم متزامن محدود.
// • جدولة تكيّفية: الصفحة 0 للمجموعات الست + أسماء المستخدمين تنطلق معاً (7 طلبات كما في الأساس، بلا انتظار). لا توسيع إلا لمجموعة ثبت أنها كبيرة:
//   المجموعة الممتلئة (1000) تتابع بصفحة واحدة في الجولتين الأولين (مطابق للمتسلسل: لا صفحات تخمينية لمجموعات < 3000 صف)،
//   ثم تتوسع نافذتها 2 ثم 4 ثم 8 (SS_WMAX). النتيجة = الصفحات بترتيب الإزاحة حتى أول صفحة ناقصة (نفس قاعدة fetchAllPages). صفحات بعد النهاية تُهمل.
// • حد عام مشترك SS_CONC=8 طلب صفحة في الجو (بوابة FIFO واحدة بين المجموعات والتحميلات = عدالة بلا تجويع). لا عدّ مسبق (app_data_read لا يعيد عدداً).
// • لا لقطة متسقة: الإزاحة تتأثر بإدراج/حذف أثناء الجلب كما كان؛ لا ادّعاء عكس ذلك.
// • تحميل أحدث (أو خروج/تبديل حساب/مغادرة الصفحة) يوقف إصدار صفحات جديدة ويُسقط كتابة النتيجة القديمة.
const SS_PAGE = 1000, SS_CONC = 8, SS_WMAX = 8, SS_LEAD = 2;
let _ssSeq = 0;
function ssGate(max) {
  let active = 0; const wait = [];
  const next = () => { while (active < max && wait.length) { active++; const w = wait.shift(); w(); } };
  return fn => new Promise((res, rej) => { wait.push(() => { Promise.resolve().then(fn).then(res, rej).finally(() => { active--; next(); }); }); next(); });
}
const _ssGate = ssGate(SS_CONC);   // بوابة واحدة مشتركة بين كل التحميلات: لا يتجاوز مجموع طلبات الصفحات الجارية 8 حتى مع إعادة الفتح السريع
async function ssFetchAll(baseQuery, gate, alive) {
  const sep = baseQuery.includes('?') ? '&' : '?';
  const page = async off => {
    if (!alive()) { const e = new Error('superseded'); e.stale = true; throw e; }
    return gate(async () => {
      if (!alive()) { const e = new Error('superseded'); e.stale = true; throw e; }
      const res = await sbFetch(`${baseQuery}${sep}limit=${SS_PAGE}&offset=${off}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const chunk = await res.json();
      if (!Array.isArray(chunk)) throw new Error('استجابة غير متوقعة');
      return chunk;
    });
  };
  let all = [], off = 0;
  const first = await page(0); all = first; off = SS_PAGE;
  if (first.length < SS_PAGE) return all;
  for (let r = 0; ; r++) {
    const w = r < SS_LEAD ? 1 : Math.min(2 ** (r - SS_LEAD + 1), SS_WMAX);   // نافذة 1، 2، 4، 4… : تُقلّل الصفحات الزائدة بعد النهاية (≤ w-1) لمجموعات متوسطة الحجم
    const batch = await Promise.all(Array.from({ length: w }, (_, i) => page(off + i * SS_PAGE)));
    for (const chunk of batch) { all = all.concat(chunk); if (chunk.length < SS_PAGE) return all; }
    off += w * SS_PAGE;
  }
}

async function loadStaffStatsImpl(tok) {
  const wrap = document.getElementById('staffStatsList');
  wrap.innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  let failed = false;
  const seq = ++_ssSeq, alive = () => seq === _ssSeq && !failed && stDataOk(tok), gate = _ssGate;
  try {
    const all = fn => ssFetchAll(fn, gate, alive);
    const parts = await Promise.all([
      gate(() => csUsersNames()),
      all('inspections?select=created_by_name,created_at'),
      all('thermal_inspections?select=created_by_name,created_at'),
      all('line_entry_thermal?select=created_by_name,created_at'),
      all('treatments?select=treated_by,treatment_date'),
      all('emergency_departures?select=created_by,treated_by,treatment_date,created_at'),
      all('work_telegrams?select=created_by,created_at')
    ].map(p => { p.catch(() => {}); return p; }));
    const [users, insp, therm, lineTherm, treat, emg, tg] = parts;
    if (!alive()) return;      // المستخدم غادر الصفحة أو تغيّرت الجلسة أو بدأ تحميل أحدث أثناء الجلب: لا نكتب نتيجة قديمة

    const stats = {}; // name -> { inspections, thermal, lineThermal, treatments, emergencyReported, emergencyResolved, telegrams, lastActivity }
    function ensure(name) {
      if (!name) return null;
      if (!stats[name]) stats[name] = { inspections:0, thermal:0, lineThermal:0, treatments:0, emergencyReported:0, emergencyResolved:0, telegrams:0, lastActivity:null };
      return stats[name];
    }
    function bump(name, key, dateStr) {
      const s = ensure(name); if (!s) return;
      s[key]++;
      if (dateStr && (!s.lastActivity || dateStr > s.lastActivity)) s.lastActivity = dateStr;
    }

    insp.forEach(r => bump(r.created_by_name, 'inspections', r.created_at));
    therm.forEach(r => bump(r.created_by_name, 'thermal', r.created_at));
    lineTherm.forEach(r => bump(r.created_by_name, 'lineThermal', r.created_at));
    treat.forEach(r => bump(r.treated_by, 'treatments', r.treatment_date));
    emg.forEach(r => {
      bump(r.created_by, 'emergencyReported', r.created_at);
      if (r.treated_by) bump(r.treated_by, 'emergencyResolved', r.treatment_date);
    });
    tg.forEach(r => bump(r.created_by, 'telegrams', r.created_at));

    // التأكد من ظهور كل الأعضاء حتى لو بدون أي نشاط
    users.forEach(u => { if (u.role !== 'admin' || true) ensure(u.full_name); });

    staffStatsCache = { stats, users };
    renderStaffStats();
  } catch (e) {
    failed = true;   // يوقف إصدار صفحات جديدة من بقية المجموعات
    if (e && e.stale) return;
    if (seq !== _ssSeq) return;   // فشل تحميل قديم لا يمسح شاشة تحميل أحدث
    wrap.innerHTML = '<div class="empty-state">❌ تعذر تحميل الإحصائيات</div>';
  }
}

function staffStatTotal(s) {
  return s.inspections + s.thermal + s.lineThermal + s.treatments + s.emergencyReported + s.emergencyResolved + s.telegrams;
}
function renderStaffStats() {
  if (!staffStatsCache) return;
  const { stats } = staffStatsCache;
  const names = Object.keys(stats);
  const now = new Date();
  const rows = names.map(name => {
    const s = stats[name];
    const total = staffStatTotal(s);
    let daysSince = null;
    if (s.lastActivity) daysSince = Math.floor((now - new Date(s.lastActivity)) / 86400000);
    const isActive = daysSince !== null && daysSince <= 30;
    return { name, s, total, daysSince, isActive };
  }).sort((a,b) => b.total - a.total);

  const wrap = document.getElementById('staffStatsList');
  if (!rows.length) { wrap.innerHTML = '<div class="empty-state">لا يوجد أعضاء بعد</div>'; return; }

  wrap.innerHTML = rows.map(r => {
    const safe = r.name.replace(/'/g, "\\'");
    const badge = r.s.lastActivity
      ? `<span class="staff-badge ${r.isActive ? 'active' : 'inactive'}">${r.isActive ? '🟢 نشط' : '🔴 غير نشط'}</span>`
      : `<span class="staff-badge inactive">⚪ بدون نشاط</span>`;
    const lastTxt = r.s.lastActivity ? `آخر نشاط: ${r.s.lastActivity.split('T')[0]}` : 'لا يوجد نشاط مسجل';
    return `<div class="staff-stat-card" onclick="showStaffStatDetail('${safe}')">
      <div>
        <div class="staff-stat-name">👤 ${r.name}</div>
        <div class="staff-stat-sub">${badge}${lastTxt}</div>
      </div>
      <div class="staff-stat-total">${r.total} عملية</div>
    </div>`;
  }).join('');
}
function showStaffStatDetail(name) {
  if (!staffStatsCache) return;
  const s = staffStatsCache.stats[name];
  if (!s) return;
  document.getElementById('ssDetailName').textContent = name;
  const rows = [
    ['📋 كشوفات أبراج (عادي)', s.inspections],
    ['<img src="icon-thermal.png" style="width:15px;height:15px;vertical-align:middle"> كشوفات حرارية', s.thermal],
    ['<img src="icon-thermal.png" style="width:15px;height:15px;vertical-align:middle"> كشف حراري (مدخل خط)', s.lineThermal],
    ['🔧 معالجات منفذة', s.treatments],
    ['🚨 مغادرات طارئة (تسجيل)', s.emergencyReported],
    ['✅ مغادرات طارئة (معالجة)', s.emergencyResolved],
    ['📨 برقيات عمل', s.telegrams],
  ];
  const lastTxt = s.lastActivity ? s.lastActivity.split('T')[0] : '—';
  document.getElementById('ssDetailBody').innerHTML =
    rows.map(([label, val]) => `<div class="ss-detail-row"><span>${label}</span><b>${val}</b></div>`).join('') +
    `<div class="ss-detail-row"><span>📅 آخر نشاط</span><b>${lastTxt}</b></div>` +
    `<div class="ss-detail-row"><span>الإجمالي</span><b>${staffStatTotal(s)}</b></div>`;
  document.getElementById('ssEmpDetailedActivity').innerHTML = '';
  document.getElementById('ssEmp_from').value = '';
  document.getElementById('ssEmp_to').value = '';
  document.getElementById('staffStatsDetailModal').classList.add('show');
}
(window.__staffModules = window.__staffModules || {}).stats = true;
