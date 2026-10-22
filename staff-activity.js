/* staff-activity.js — v335-C5r7
   تفاصيل أعمال الموظفين خلال فترة (كل الموظفين أو موظف واحد): جلب ست مجموعات بيانات عند الضغط على الزر فقط.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
// ========================
// STAFF PERIOD ACTIVITY DETAILS (تفاصيل الأعمال خلال فترة)
// ========================
function towerRangeLabel(nums) {
  const valid = nums.filter(n => n != null && !isNaN(n)).map(Number).sort((a,b)=>a-b);
  if (!valid.length) return '';
  const min = valid[0], max = valid[valid.length-1];
  return min === max ? `برج ${min}` : `من برج ${min} إلى ${max}`;
}
async function fetchPeriodActivity(fromDate, toDate) {
  const toPlus1 = new Date(toDate + 'T00:00:00'); toPlus1.setDate(toPlus1.getDate() + 1);
  const toPlus1Str = toPlus1.toISOString().split('T')[0];
  const gte = `gte.${fromDate}T00:00:00`;
  const lt = `lt.${toPlus1Str}T00:00:00`;

  const [insp, therm, lineTherm, treat, emg, tg] = await Promise.all([
    fetchAllPages(`inspections?select=created_by_name,line_name,tower_number,created_at&created_at=${gte}&created_at=${lt}`),
    fetchAllPages(`thermal_inspections?select=created_by_name,line_name,tower_number,created_at&created_at=${gte}&created_at=${lt}`),
    fetchAllPages(`line_entry_thermal?select=created_by_name,line_name,station_side,created_at&created_at=${gte}&created_at=${lt}`),
    fetchAllPages(`treatments?select=treated_by,line_name,tower_number,items_treated,treatment_date&treatment_date=gte.${fromDate}&treatment_date=lte.${toDate}`),
    fetchAllPages(`emergency_departures?select=created_by,treated_by,line_name,departure_type,created_at,treatment_date&created_at=${gte}&created_at=${lt}`),
    fetchAllPages(`work_telegrams?select=created_by,line_name,status,outage_from,created_at&created_at=${gte}&created_at=${lt}`)
  ]);

  const byEmp = {}; // name -> array of {sortDate, html}
  function ensure(name) { if (!byEmp[name]) byEmp[name] = []; return byEmp[name]; }

  // group inspections & thermal by (employee, line, date) for range display
  function groupByEmpLineDate(records, dateField) {
    const groups = {};
    records.forEach(r => {
      const name = r.created_by_name; if (!name) return;
      const date = (r[dateField]||'').split('T')[0];
      const key = name + '|' + r.line_name + '|' + date;
      if (!groups[key]) groups[key] = { name, line_name: r.line_name, date, towers: [] };
      if (r.tower_number != null) groups[key].towers.push(r.tower_number);
    });
    return Object.values(groups);
  }

  groupByEmpLineDate(insp, 'created_at').forEach(g => {
    const range = towerRangeLabel(g.towers);
    ensure(g.name).push({ date: g.date, html: `📋 كشف بصري — خط ${g.line_name}${range ? ' — '+range : ''} — ${g.date}` });
  });
  groupByEmpLineDate(therm, 'created_at').forEach(g => {
    const range = towerRangeLabel(g.towers);
    ensure(g.name).push({ date: g.date, html: `<img src="icon-thermal.png" style="width:15px;height:15px;vertical-align:middle"> كشف حراري — خط ${g.line_name}${range ? ' — '+range : ''} — ${g.date}` });
  });
  lineTherm.forEach(r => {
    if (!r.created_by_name) return;
    const date = (r.created_at||'').split('T')[0];
    ensure(r.created_by_name).push({ date, html: `<img src="icon-thermal.png" style="width:15px;height:15px;vertical-align:middle"> كشف حراري (مدخل خط) — خط ${r.line_name}${r.station_side?' — '+r.station_side:''} — ${date}` });
  });
  treat.forEach(r => {
    if (!r.treated_by) return;
    let items = r.items_treated; if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = []; } }
    const labels = Array.isArray(items) ? items.map(it => it.label || it.key).join('، ') : '';
    ensure(r.treated_by).push({ date: r.treatment_date, html: `🔧 معالجة — خط ${r.line_name} برج ${r.tower_number||'—'} (${labels}) — ${r.treatment_date}` });
  });
  emg.forEach(r => {
    const date = (r.created_at||'').split('T')[0];
    if (r.created_by) ensure(r.created_by).push({ date, html: `🚨 مغادرة طارئة (تسجيل) — خط ${r.line_name} — ${r.departure_type||''} — ${date}` });
    if (r.treated_by) ensure(r.treated_by).push({ date: r.treatment_date||date, html: `✅ مغادرة طارئة (معالجة) — خط ${r.line_name} — ${r.treatment_date||date}` });
  });
  tg.forEach(r => {
    if (!r.created_by) return;
    const date = (r.created_at||'').split('T')[0];
    ensure(r.created_by).push({ date, html: `📨 برقية عمل — خط ${r.line_name} — الحالة: ${r.status||'—'} — ${date}` });
  });

  Object.values(byEmp).forEach(list => list.sort((a,b) => (a.date||'').localeCompare(b.date||'')));
  return byEmp;
}
function renderEmployeeActivityGroups(byEmp, container) {
  const names = Object.keys(byEmp);
  if (!names.length) { container.innerHTML = '<div class="empty-state">لا توجد أعمال مسجلة بهذي الفترة</div>'; return; }
  names.sort((a,b) => byEmp[b].length - byEmp[a].length);
  container.innerHTML = names.map(name => `
    <div class="ss-activity-emp-card">
      <div class="ss-activity-emp-name">👤 ${name} — ${byEmp[name].length} عملية</div>
      ${byEmp[name].map(item => `<div class="ss-activity-item">${item.html}</div>`).join('')}
    </div>
  `).join('');
}
async function loadStaffPeriodDetailsImpl(tok) {
  const from = document.getElementById('ss_from').value;
  const to = document.getElementById('ss_to').value;
  const container = document.getElementById('staffPeriodDetails');
  if (!from || !to) { showToast('⚠️ حدد تاريخ من وإلى', 'error'); return; }
  container.innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  try {
    const byEmp = await fetchPeriodActivity(from, to);
    if (!stDataOk(tok)) return;
    renderEmployeeActivityGroups(byEmp, container);
  } catch { container.innerHTML = '<div class="empty-state">❌ تعذر تحميل التفاصيل</div>'; }
}
async function loadStaffEmployeeDetailedActivityImpl(tok) {
  const from = document.getElementById('ssEmp_from').value;
  const to = document.getElementById('ssEmp_to').value;
  const container = document.getElementById('ssEmpDetailedActivity');
  const empName = document.getElementById('ssDetailName').textContent.trim();
  if (!from || !to) { showToast('⚠️ حدد تاريخ من وإلى', 'error'); return; }
  container.innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  try {
    const byEmp = await fetchPeriodActivity(from, to);
    if (!stDataOk(tok)) return;
    const onlyThis = {};
    if (byEmp[empName]) onlyThis[empName] = byEmp[empName];
    renderEmployeeActivityGroups(onlyThis, container);
  } catch { container.innerHTML = '<div class="empty-state">❌ تعذر تحميل التفاصيل</div>'; }
}
(window.__staffModules = window.__staffModules || {}).activity = true;
