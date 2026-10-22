/* staff-roster-print.js — v335-C5r7
   نافذة اختيار الأعمدة/الأعضاء وتصدير PDF لكادر القسم. تقرأ كاش الكادر من index.html وفلتر الموقع من staff-roster.js (يُحمَّل معها دائماً).
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
(function mount_printStaffRosterModalBg() {
  const page = document.getElementById('page-staffStats');
  if (!page || document.getElementById('printStaffRosterModalBg')) return;
  page.insertAdjacentHTML('afterend', `
<div class="treat-modal-bg" id="printStaffRosterModalBg">
  <div class="treat-modal" style="max-height:90vh;overflow-y:auto">
    <h3>🖨️ طباعة كادر القسم</h3>
    <p style="color:#718096;font-size:0.82rem;margin-top:-6px">عمود "الاسم الثلاثي" يُطبع دائماً. اختر بقية الأعمدة:</p>
    <div style="margin-top:6px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <label style="font-weight:700;font-size:0.88rem">الأعمدة</label>
        <button class="btn btn-secondary btn-sm" onclick="togglePrintStaffColumnsSelectAll()" id="printStaffColumnsSelectAllBtn">إلغاء التحديد</button>
      </div>
      <div id="printStaffColumnsWrap" style="max-height:220px;overflow-y:auto;border:1.5px solid #E2E8F0;border-radius:8px;padding:8px"></div>
      <label style="display:flex;align-items:center;gap:8px;padding:8px 2px 2px;font-size:0.85rem;font-weight:700">
        <input type="checkbox" id="printStaffNotesColChk" checked>
        <span>إضافة عمود "الملاحظات" (فارغ للتعبئة اليدوية)</span>
      </label>
    </div>
    <div style="margin-top:14px">
      <div id="printStaffLocationQuickBtns" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <label style="font-weight:700;font-size:0.88rem">الأعضاء</label>
        <button class="btn btn-secondary btn-sm" onclick="togglePrintStaffMembersSelectAll()" id="printStaffMembersSelectAllBtn">إلغاء التحديد</button>
      </div>
      <div id="printStaffMembersWrap" style="max-height:220px;overflow-y:auto;border:1.5px solid #E2E8F0;border-radius:8px;padding:8px"></div>
    </div>
    <p style="margin-top:10px;color:#718096;font-size:0.82rem;text-align:center" id="printStaffRosterNote"></p>
    <div class="form-actions" style="margin-top:14px;flex-direction:column;gap:8px">
      <button class="btn btn-primary" style="width:100%" onclick="confirmPrintStaffRoster()">🖨️ طباعة</button>
      <button class="btn btn-secondary" style="width:100%" onclick="closePrintStaffRosterModal()">إغلاق</button>
    </div>
  </div>
</div>
`);
})();

// ---- طباعة كادر القسم (اختيار الأعمدة) ----
let _printStaffMembersSnapshot = []; // لقطة ثابتة تضمن تطابق data-idx حتى لو تغيّرت البيانات أثناء فتح النافذة
function openPrintStaffRosterModalImpl() {
  document.getElementById('printStaffNotesColChk').checked = true;
  const cols = staffRosterColumnsCache;
  const wrap = document.getElementById('printStaffColumnsWrap');
  wrap.innerHTML = cols.map((c, i) => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:0.82rem;border-bottom:1px solid #F0F2F5">
      <input type="checkbox" class="printStaffColChk" data-idx="${i}" checked>
      <span>${c.label}</span>
    </label>`).join('') || '<div class="empty-state">لا توجد أعمدة إضافية</div>';
  document.getElementById('printStaffColumnsSelectAllBtn').textContent = 'إلغاء التحديد';

  // قائمة الأعضاء (لقطة ثابتة) — نُحدد افتراضياً حسب فلتر الموقع المفعّل حالياً بالشاشة، وتقدر تعدّل الاختيار بحرية
  _printStaffMembersSnapshot = staffRosterMembersCache;
  const filterSel = document.getElementById('staffRosterLocationFilter');
  const activeLocation = (filterSel.style.display !== 'none' && filterSel.value !== 'all') ? filterSel.value : null;
  const membersWrap = document.getElementById('printStaffMembersWrap');
  membersWrap.innerHTML = _printStaffMembersSnapshot.map((m, i) => {
    const loc = (m.values && m.values.location) || '';
    const preChecked = activeLocation ? (loc === activeLocation) : true;
    return `<label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:0.82rem;border-bottom:1px solid #F0F2F5">
      <input type="checkbox" class="printStaffMemberChk" data-idx="${i}" data-location="${loc.replace(/"/g,'&quot;')}" ${preChecked ? 'checked' : ''} onchange="updatePrintStaffRosterNote()">
      <span style="flex:1">${m.name}</span>
      ${loc ? `<span style="color:#718096;font-size:0.75rem">${loc}</span>` : ''}
    </label>`;
  }).join('') || '<div class="empty-state">لا يوجد أعضاء</div>';
  document.getElementById('printStaffMembersSelectAllBtn').textContent = 'إلغاء التحديد';

  // أزرار اختيار سريع حسب المواقع الفعلية الموجودة بالبيانات
  const locations = [...new Set(_printStaffMembersSnapshot.map(m => (m.values && m.values.location) || '').filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar'));
  const quickBtnsWrap = document.getElementById('printStaffLocationQuickBtns');
  quickBtnsWrap.innerHTML = locations.map(loc =>
    `<button class="btn btn-secondary btn-sm" onclick="quickSelectPrintStaffLocation('${loc.replace(/'/g,"\\'")}')">${loc} فقط</button>`
  ).join('');

  updatePrintStaffRosterNote();
  document.getElementById('printStaffRosterModalBg').classList.add('show');
}
function updatePrintStaffRosterNote() {
  const total = document.querySelectorAll('.printStaffMemberChk').length;
  const checked = document.querySelectorAll('.printStaffMemberChk:checked').length;
  document.getElementById('printStaffRosterNote').textContent = `تم تحديد ${checked} من أصل ${total} عضو`;
}
function togglePrintStaffMembersSelectAll() {
  const boxes = document.querySelectorAll('.printStaffMemberChk');
  const btn = document.getElementById('printStaffMembersSelectAllBtn');
  const allChecked = Array.from(boxes).every(b => b.checked);
  boxes.forEach(b => b.checked = !allChecked);
  btn.textContent = allChecked ? 'تحديد الكل' : 'إلغاء التحديد';
  updatePrintStaffRosterNote();
}
function quickSelectPrintStaffLocation(loc) {
  document.querySelectorAll('.printStaffMemberChk').forEach(cb => { cb.checked = (cb.dataset.location === loc); });
  document.getElementById('printStaffMembersSelectAllBtn').textContent = 'تحديد الكل';
  updatePrintStaffRosterNote();
}
function closePrintStaffRosterModal() {
  document.getElementById('printStaffRosterModalBg').classList.remove('show');
}
function togglePrintStaffColumnsSelectAll() {
  const boxes = document.querySelectorAll('.printStaffColChk');
  const btn = document.getElementById('printStaffColumnsSelectAllBtn');
  const allChecked = Array.from(boxes).every(b => b.checked);
  boxes.forEach(b => b.checked = !allChecked);
  btn.textContent = allChecked ? 'تحديد الكل' : 'إلغاء التحديد';
}
async function confirmPrintStaffRoster() {
  const allCols = staffRosterColumnsCache;
  const selectedCols = Array.from(document.querySelectorAll('.printStaffColChk:checked')).map(cb => allCols[Number(cb.dataset.idx)]).filter(Boolean);
  const selectedRows = Array.from(document.querySelectorAll('.printStaffMemberChk:checked')).map(cb => _printStaffMembersSnapshot[Number(cb.dataset.idx)]).filter(Boolean);
  if (!selectedRows.length) { showToast('⚠️ اختر عضواً واحداً على الأقل', 'error'); return; }
  closePrintStaffRosterModal();
  showToast('⏳ جاري تحضير ملف PDF...');

  // الاتجاه: طولي تلقائياً لو أعمدة البيانات (ت + الاسم + المختارة، بدون الملاحظات) أقل من 4
  const includeNotes = document.getElementById('printStaffNotesColChk').checked;
  const totalDataCols = 2 + selectedCols.length + (includeNotes ? 1 : 0);
  const orientation = totalDataCols < 4 ? 'portrait' : 'landscape';

  // كل عمود ياخذ عرضه حسب أطول محتوى فيه فعلياً؛ عمود الملاحظات وحده بعرض ثابت (فاضي دائماً)
  const columns = [
    { label: 'ت' },
    { label: 'الاسم الثلاثي' },
    ...selectedCols.map(c => ({ label: c.label, key: c.key })),
    ...(includeNotes ? [{ label: 'الملاحظات', fixedPct: 20 }] : [])
  ];
  const rows = selectedRows.map((row, i) => [
    String(i + 1),
    row.name || '-',
    ...selectedCols.map(c => (row.values && row.values[c.key]) || '-'),
    ...(includeNotes ? [''] : [])
  ]);

  try {
    const pages = buildTableReportPages('كادر قسم الخطوط', columns, rows, {
      contentBasedWidth: true, orientation, multiBlock: true, headerFontSize: 18, cellFontSize: 16, titleGap: 65
    });
    await exportCanvasReportPDF(pages, 'كادر_قسم_الخطوط_' + new Date().toISOString().split('T')[0] + '.pdf', orientation);
    showToast('✅ تم تجهيز ملف PDF');
  } catch (e) {
    showToast('❌ تعذر تجهيز الملف: ' + (e && e.message ? e.message : 'خطأ غير معروف'), 'error');
  }
}
(window.__staffModules = window.__staffModules || {}).rosterPrint = true;
