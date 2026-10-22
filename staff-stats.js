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

async function loadStaffStatsImpl(tok) {
  const wrap = document.getElementById('staffStatsList');
  wrap.innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  try {
    const [users, insp, therm, lineTherm, treat, emg, tg] = await Promise.all([
      csUsersNames(),
      fetchAllPages('inspections?select=created_by_name,created_at'),
      fetchAllPages('thermal_inspections?select=created_by_name,created_at'),
      fetchAllPages('line_entry_thermal?select=created_by_name,created_at'),
      fetchAllPages('treatments?select=treated_by,treatment_date'),
      fetchAllPages('emergency_departures?select=created_by,treated_by,treatment_date,created_at'),
      fetchAllPages('work_telegrams?select=created_by,created_at')
    ]);
    if (!stDataOk(tok)) return;      // المستخدم غادر الصفحة أو تغيّرت الجلسة أثناء الجلب: لا نرسم بيانات شخص آخر

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
    if (e && e.stale) return;
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
