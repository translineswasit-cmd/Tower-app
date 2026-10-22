/* thermal-archive.js — v335-C5r6
   أرشيف الكشف الحراري الخام: الفلاتر والعرض والحذف. جلب البيانات نفسه (loadThermalArchive) يبقى في index.html ويُنفَّذ عند فتح الأرشيف فقط.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند أول طلب فعلي؛ لا يعمل شيء منه عند بدء التطبيق ولا عند فتح قائمة الكشف الحراري.
   سكربت كلاسيكي: يشارك الربط العام (let/const/function) مع index.html. */
(function mount_thermalArchiveView() {
  // الواجهة تُركَّب عند أول تحميل للوحدة فقط (نفس المعرّفات والأحداث والتخطيط تماماً)
  const page = document.getElementById('page-thermal');
  if (!page || document.getElementById('thermalArchiveView')) return;
  page.insertAdjacentHTML('beforeend', `
  <div id="thermalArchiveView" style="display:none">
    <div class="records-toolbar">
      <div class="page-title" style="margin:0">📂 أرشيف الكشف الحراري</div>
      <div class="toolbar-right">
        <button class="btn-excel" onclick="printThermalArchive()">🖨️ طباعة</button>
        <button class="btn btn-primary" onclick="loadThermalArchive()" style="padding:9px 18px">🔄 تحديث</button>
        <button class="btn btn-del" id="thermalBulkDeleteBtn" onclick="bulkDeleteThermal()" style="display:none">🗑️ حذف الكل المطابق للفلتر</button>
      </div>
    </div>
    <div class="filters-bar">
      <div class="field">
        <label>📡 تصفية بالخط</label>
        <select id="thFilterLine" onchange="renderThermalArchive()"><option value="">-- كل الخطوط --</option></select>
      </div>
      <div class="field"><label>📅 من تاريخ</label><input type="date" id="thFilterDateFrom" onchange="renderThermalArchive()"></div>
      <div class="field"><label>📅 إلى تاريخ</label><input type="date" id="thFilterDateTo" onchange="renderThermalArchive()"></div>
      <div class="field"><label>🗼 برج محدد (اختياري)</label><input type="text" id="thFilterTower" placeholder="مثال: 5" oninput="renderThermalArchive()"></div>
      <div class="field" style="justify-content:flex-end">
        <label>&nbsp;</label>
        <button class="btn btn-secondary" onclick="document.getElementById('thFilterLine').value='';document.getElementById('thFilterDateFrom').value='';document.getElementById('thFilterDateTo').value='';document.getElementById('thFilterTower').value='';renderThermalArchive();">🔄 مسح التصفية</button>
      </div>
    </div>
    <div id="thermalArchiveBody"><div class="empty-state">⏳ جاري التحميل...</div></div>
  </div>
`);
})();

const HOT_THRESHOLD = 70;
let filteredThermal = [];

function showThermalArchiveImpl() {
  pushLevel(showThermalHome);
  thermalShowView('thermalArchiveView');
  loadThermalArchive();
}
async function bulkDeleteThermal() {
  if (!(currentUser.role === 'admin')) {
    showToast('⚠️ الحذف من صلاحيات المدير أو المشرف فقط', 'error');
    return;
  }
  const n = filteredThermal.length;
  if (!n) { showToast('⚠️ لا توجد نتائج مطابقة للفلتر الحالي', 'error'); return; }
  if (!confirm(`🗑️ تأكيد حذف ${n} نشاط كشف حراري مطابق للفلتر الحالي؟ هذا الإجراء لا يمكن التراجع عنه نهائيًا.`)) return;
  showToast('⏳ جاري الحذف...');
  const lines = [...new Set(filteredThermal.map(r => r.line_name).filter(Boolean))];
  let success = 0;
  for (const r of filteredThermal) {
    try {
      const res = await sbFetch(`thermal_inspections?id=eq.${r.id}`, { method: 'DELETE' });
      if (res.ok) success++;
      else console.warn('[tower-app] فشل حذف قياس حراري', r.id, 'HTTP', res.status);
    } catch (e) { console.warn('[tower-app] فشل حذف قياس حراري', r.id, e); }
  }
  showToast(success === n ? `🗑️ تم حذف ${success} من ${n} نشاط` : `⚠️ تم حذف ${success} من ${n} نشاط فقط — راجع سجل المتصفح لمعرفة السبب`, success === n ? undefined : 'error');
  await loadThermalArchive();
  // تحقق من برقيات عمل غير منفذة لنفس الخطوط المتأثرة
  for (const lineName of lines) {
    try {
      const tgRes = await sbFetch(`work_telegrams?line_name=eq.${encodeURIComponent(lineName)}&status=neq.تنفذت&select=id`);
      const telegrams = await tgRes.json();
      if (telegrams.length && confirm(`⚠️ يوجد ${telegrams.length} برقية عمل غير منفذة لخط "${lineName}". حذفها أيضًا؟`)) {
        await Promise.all(telegrams.map(t => sbFetch(`work_telegrams?id=eq.${t.id}`, { method: 'DELETE' })));
        showToast('🗑️ تم حذف برقيات العمل المرتبطة بخط ' + lineName);
      }
    } catch (e) { console.warn('[tower-app] فشل التحقق من برقيات العمل لخط', lineName, e); }
  }
}
async function deleteThermalRecord(id, lineName) {
  if (!(currentUser.role === 'admin')) {
    showToast('⚠️ الحذف من صلاحيات المدير أو المشرف فقط', 'error');
    return;
  }
  if (!confirm('🗑️ تأكيد حذف هذا النشاط من الكشف الحراري؟ هذا الإجراء لا يمكن التراجع عنه.')) return;
  try {
    const res = await sbFetch(`thermal_inspections?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    showToast('🗑️ تم حذف النشاط');
    await loadThermalArchive();
    // تحقق من وجود برقية عمل جاهزة لنفس الخط، ونعرض خيار حذفها أيضًا
    if (lineName) {
      try {
        const tgRes = await sbFetch(`work_telegrams?line_name=eq.${encodeURIComponent(lineName)}&status=neq.تنفذت&select=id,status,created_at`);
        const telegrams = await tgRes.json();
        if (telegrams.length) {
          if (confirm(`⚠️ يوجد ${telegrams.length} برقية عمل غير منفذة لنفس الخط "${lineName}". هل تريد حذفها أيضًا؟`)) {
            await Promise.all(telegrams.map(t => sbFetch(`work_telegrams?id=eq.${t.id}`, { method: 'DELETE' })));
            showToast('🗑️ تم حذف برقيات العمل المرتبطة');
          }
        }
      } catch (e) { /* تجاهل، الحذف الأساسي نجح بالفعل */ }
    }
  } catch (e) {
    showToast('❌ تعذر الحذف', 'error');
  }
}
function isHotRecord(r) {
  return [r.r1,r.r2,r.s1,r.s2,r.t1,r.t2].some(v => v !== null && v !== undefined && parseFloat(v) > HOT_THRESHOLD);
}
function fmtTemp(r, val) {
  if (val === null || val === undefined || val === '') return '—';
  const cls = parseFloat(val) > HOT_THRESHOLD ? 'hot-val' : '';
  return `<span class="${cls}">${val}</span>`;
}
function renderThermalArchive() {
  const lineFilter = document.getElementById('thFilterLine').value;
  const dateFrom = document.getElementById('thFilterDateFrom').value;
  const dateTo = document.getElementById('thFilterDateTo').value;
  const towerFilterRaw = document.getElementById('thFilterTower').value.trim();
  // يدعم برج واحد أو أبراج محددة مفصولة بفاصلة: مثال "5" أو "5,8,12"
  const towerList = towerFilterRaw ? towerFilterRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  filteredThermal = thermalRecords.filter(r => {
    const mLine = !lineFilter || r.line_name === lineFilter;
    const mFrom = !dateFrom || (r.inspection_date && r.inspection_date >= dateFrom);
    const mTo = !dateTo || (r.inspection_date && r.inspection_date <= dateTo);
    const mTower = !towerList.length || (r.tower_number != null && towerList.includes(String(r.tower_number)));
    return mLine && mFrom && mTo && mTower;
  });

  const bulkBtn = document.getElementById('thermalBulkDeleteBtn');
  if (bulkBtn) bulkBtn.style.display = (currentUser.role==='admin') ? '' : 'none';

  const body = document.getElementById('thermalArchiveBody');
  if (!filteredThermal.length) { body.innerHTML = '<div class="empty-state">لا توجد قياسات</div>'; return; }

  // group by date, then by line
  const byDate = {};
  filteredThermal.forEach(r => {
    byDate[r.inspection_date] = byDate[r.inspection_date] || {};
    byDate[r.inspection_date][r.line_name] = byDate[r.inspection_date][r.line_name] || [];
    byDate[r.inspection_date][r.line_name].push(r);
  });

  const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a));
  let html = '';
  dates.forEach(date => {
    html += `<div class="thermal-archive-group"><div class="thermal-date-header">📅 ${date}</div>`;
    const lines = Object.keys(byDate[date]).sort((a,b) => a.localeCompare(b,'ar'));
    lines.forEach(line => {
      const rows = byDate[date][line];
      const ambient = rows[0].ambient_temp ?? '—';
      html += `<div class="thermal-line-header"><span>📡 ${line}</span><span>🌤️ حرارة الجو: ${ambient}°C — عدد النقاط: ${rows.length}</span></div>`;
      html += `<table class="thermal-points-table"><thead><tr>
        <th>النقطة</th><th>R1</th><th>R2</th><th>S1</th><th>S2</th><th>T1</th><th>T2</th><th>الموظف</th><th></th>
      </tr></thead><tbody>`;
      rows.sort((a,b) => (a.tower_number||0) - (b.tower_number||0));
      rows.forEach(r => {
        const flag = isHotRecord(r) ? '<span class="hot-flag">🔴 </span>' : '';
        html += `<tr>
          <td>${flag}${r.point_label||''}</td>
          <td>${fmtTemp(r, r.r1)}</td><td>${fmtTemp(r, r.r2)}</td>
          <td>${fmtTemp(r, r.s1)}</td><td>${fmtTemp(r, r.s2)}</td>
          <td>${fmtTemp(r, r.t1)}</td><td>${fmtTemp(r, r.t2)}</td>
          <td>${r.created_by_name||'—'}</td>
          <td>${(currentUser.role==='admin')?`<button class="btn-sm btn-del" onclick="deleteThermalRecord('${r.id}','${(line||'').replace(/'/g,"\\'")}')">🗑️</button>`:''}</td>
        </tr>`;
      });
      html += `</tbody></table>`;
    });
    html += `</div>`;
  });
  body.innerHTML = html;
}

// ربط واجهة الأرشيف بجالب البيانات الدائم في index.html (loadThermalArchive): نفس التسلسل الأصلي بالضبط
thermalArchiveUI = {
  busy() {
    const body = document.getElementById('thermalArchiveBody');
    body.innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  },
  ready() {
    const lineSel = document.getElementById('thFilterLine');
    const uniqueLines = [...new Set(thermalRecords.map(r => r.line_name).filter(Boolean))].sort();
    const currentVal = lineSel.value;
    lineSel.innerHTML = '<option value="">-- كل الخطوط --</option>' + uniqueLines.map(n => `<option value="${n}">${n}</option>`).join('');
    if (uniqueLines.includes(currentVal)) lineSel.value = currentVal;
    renderThermalArchive();
  }
};
(window.__thermalModules = window.__thermalModules || {}).archive = true;
