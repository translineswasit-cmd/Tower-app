/* treatment-history.js — v335-C5r8
   سجل المعالجات (التبويب + فلاتر) ونافذة تعديل المعالجة (تاريخ/منفّذ/ملاحظات/إزالة عناصر).
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
(function mount_treatmentEditModalBg() {
  if (document.getElementById('treatmentEditModalBg')) return;
  const html = `
<div class="treat-modal-bg" id="treatmentEditModalBg">
  <div class="treat-modal">
    <h3>✏️ تعديل المعالجة</h3>
    <div class="field" style="margin-top:14px">
      <label>تاريخ المعالجة</label>
      <input type="date" id="teEditDate" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
    </div>
    <div class="field" style="margin-top:12px">
      <label>المعالج</label>
      <input type="text" id="teEditTreatedBy" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
    </div>
    <div class="field" style="margin-top:12px">
      <label>العناصر المعالَجة (احذف أي عنصر أُضيف بالخطأ)</label>
      <div id="teEditItemsWrap" style="margin-top:6px;border:1.5px solid #E2E8F0;border-radius:8px;padding:8px;max-height:180px;overflow-y:auto"></div>
    </div>
    <div class="field" style="margin-top:12px">
      <label>ملاحظات</label>
      <textarea id="teEditNotes" rows="3" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%"></textarea>
    </div>
    <div class="form-actions" style="margin-top:18px;flex-direction:column;gap:10px">
      <button class="btn btn-primary" onclick="saveTreatmentEdit()" style="width:100%">💾 حفظ التعديل</button>
      <button class="btn btn-secondary" onclick="closeTreatmentEditModal()" style="width:100%">إلغاء</button>
    </div>
  </div>
</div>
`;
  const anchor = document.getElementById('printLinesModalBg');
  if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else document.body.insertAdjacentHTML('beforeend', html);
})();

async function renderDepLogImpl() {
  const body = document.getElementById('depLogBody');
  body.innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  await loadTreatments();
  const staleBanner = treatmentsLoadFailed
    ? '<div class="empty-state" style="color:#92400E;background:#FEF3C7;border-radius:8px;padding:10px;margin-bottom:10px">⚠️ تعذّر تحديث سجل المعالجات — المعروض نسخة محفوظة سابقاً وقد تكون قديمة وغير مكتملة</div>'
    : '';
  if (!treatmentsCache.length) {
    body.innerHTML = treatmentsLoadFailed
      ? '<div class="empty-state">⚠️ تعذّر تحميل سجل المعالجات (لا اتصال أو خطأ بالخادم) ولا توجد نسخة محفوظة لعرضها — هذا لا يعني عدم وجود معالجات</div>'
      : '<div class="empty-state">لا توجد معالجات مسجلة بعد</div>';
    return;
  }

  // تحديث فلتر الخطوط (يحافظ على القيمة المختارة)
  const lineSel = document.getElementById('depLogFilterLine');
  if (lineSel) {
    const currentLine = lineSel.value;
    const uniqueLines = [...new Set(treatmentsCache.map(t => t.line_name).filter(Boolean))].sort();
    lineSel.innerHTML = '<option value="">-- كل الخطوط --</option>' +
      uniqueLines.map(n => `<option value="${escapeHtml(n)}" ${n===currentLine?'selected':''}>${escapeHtml(n)}</option>`).join('');
  }

  const rows = getDepLogFiltered();
  currentDepLogRows = rows;
  const bulkBtn = document.getElementById('depLogBulkDeleteBtn');
  if (bulkBtn) bulkBtn.style.display = (currentUser.role==='admin') ? '' : 'none';
  if (!rows.length) { body.innerHTML = staleBanner + '<div class="empty-state">لا توجد معالجات مطابقة للفلتر</div>'; return; }

  body.innerHTML = staleBanner + rows.map(t => {
    const items = t.items_treated||[];
    const m = treatmentDisplayModel(t);
    const hasCircuit2 = !!(t.insulator_svg_r_2 || t.insulator_svg_s_2 || t.insulator_svg_t_2);
    return `<div class="dep-card" style="border-right-color:#48BB78">
      <div class="dep-card-header">
        <div class="dep-card-title" style="overflow-wrap:anywhere">✅ ${escapeHtml(m.line)} — برج ${escapeHtml(m.tower)}</div>
        <div class="dep-card-meta" style="overflow-wrap:anywhere">📅 ${escapeHtml(m.date)} | 👤 ${escapeHtml(m.by||'—')}</div>
        ${(currentUser.role==='admin')?`<button class="btn-sm" style="background:#EBF0F5;color:#2E4057;border:1px solid #CBD5E0;border-radius:6px;padding:4px 10px;font-size:0.78rem;cursor:pointer;margin-left:6px" onclick="openTreatmentEditModal('${t.id}')">✏️ تعديل</button><button class="btn-sm btn-del" onclick="deleteTreatmentRecord('${t.id}')">🗑️ حذف</button>`:''}
      </div>
      ${hasCircuit2?'<div style="font-size:0.72rem;font-weight:700;color:#4A5568;margin-top:10px">الدائرة الأولى</div>':''}
      <div style="display:flex;gap:12px;margin-top:${hasCircuit2?'4px':'10px'};flex-wrap:wrap">
        ${t.insulator_svg_r?`<div style="text-align:center"><div style="font-size:0.72rem;color:#718096;margin-bottom:4px">R</div>${t.insulator_svg_r}</div>`:''}
        ${t.insulator_svg_s?`<div style="text-align:center"><div style="font-size:0.72rem;color:#718096;margin-bottom:4px">S</div>${t.insulator_svg_s}</div>`:''}
        ${t.insulator_svg_t?`<div style="text-align:center"><div style="font-size:0.72rem;color:#718096;margin-bottom:4px">T</div>${t.insulator_svg_t}</div>`:''}
      </div>
      ${hasCircuit2?`<div style="font-size:0.72rem;font-weight:700;color:#4A5568;margin-top:10px">الدائرة الثانية</div>
      <div style="display:flex;gap:12px;margin-top:4px;flex-wrap:wrap">
        ${t.insulator_svg_r_2?`<div style="text-align:center"><div style="font-size:0.72rem;color:#718096;margin-bottom:4px">R</div>${t.insulator_svg_r_2}</div>`:''}
        ${t.insulator_svg_s_2?`<div style="text-align:center"><div style="font-size:0.72rem;color:#718096;margin-bottom:4px">S</div>${t.insulator_svg_s_2}</div>`:''}
        ${t.insulator_svg_t_2?`<div style="text-align:center"><div style="font-size:0.72rem;color:#718096;margin-bottom:4px">T</div>${t.insulator_svg_t_2}</div>`:''}
      </div>`:''}
      ${items.length?`<div class="dep-items" style="margin-top:8px">${items.map(i=>`<span class="dep-item fixed">✅ ${escapeHtml(i && i.label)}</span>`).join('')}</div>`:''}
      ${m.notes?`<div class="dep-notes" style="margin-top:8px;font-size:0.82rem;color:#4A5568;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word">📝 ${escapeHtml(m.notes)}</div>`:''}
    </div>`;
  }).join('');
}

// ========================
// تعديل المعالجة (مودال مشترك بين المغادرات والمركز الموحّد)
// ========================
let treatmentEditingId = null;

let treatmentEditingItems = [];

function openTreatmentEditModalImpl(id) {
  const t = treatmentsCache.find(x => x.id === id);
  if (!t) { showToast('⚠️ تعذر إيجاد هذي المعالجة', 'error'); return; }
  treatmentEditingId = id;
  treatmentEditingItems = JSON.parse(JSON.stringify(t.items_treated || []));
  document.getElementById('teEditDate').value = t.treatment_date || '';
  document.getElementById('teEditTreatedBy').value = t.treated_by || '';
  document.getElementById('teEditNotes').value = t.notes || '';
  renderTreatmentEditItems();
  document.getElementById('treatmentEditModalBg').classList.add('show');
}

function renderTreatmentEditItems() {
  const wrap = document.getElementById('teEditItemsWrap');
  if (!treatmentEditingItems.length) { wrap.innerHTML = '<p style="font-size:0.8rem;color:#718096">لا توجد عناصر — احفظ الحذف كامل من زر الحذف بدل هذا</p>'; return; }
  wrap.innerHTML = treatmentEditingItems.map((it, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #F0F2F5">
      <span style="font-size:0.82rem">${it.label}</span>
      <button type="button" class="btn-sm btn-del" onclick="removeTreatmentEditItem(${i})">✕</button>
    </div>`).join('');
}

function removeTreatmentEditItem(i) {
  treatmentEditingItems.splice(i, 1);
  renderTreatmentEditItems();
}

function closeTreatmentEditModal() {
  document.getElementById('treatmentEditModalBg').classList.remove('show');
  treatmentEditingId = null;
}

async function saveTreatmentEdit() {
  if (!treatmentEditingId) return;
  if (!treatmentEditingItems.length) { showToast('⚠️ لازم يبقى عنصر واحد على الأقل بالمعالجة، أو ألغِها بالكامل من زر الحذف', 'error'); return; }
  const t = treatmentsCache.find(x => x.id === treatmentEditingId);
  if (!t) { showToast('⚠️ تعذر إيجاد هذي المعالجة', 'error'); return; }
  const edit = {
    treatment_date: document.getElementById('teEditDate').value,
    treated_by: document.getElementById('teEditTreatedBy').value,
    notes: document.getElementById('teEditNotes').value,
    items: treatmentEditingItems
  };
  // v335-C4: التاريخ/المنفّذ/الملاحظات = تعديل موثَّق لا يُعيد حساب الحالة؛ إزالة عناصر معالجة = إلغاء بعناصر (يعيد الحالة فقط حيث تكون المعالجة آخر كاتب)
  const ok = await opsSaveTreatmentEdit(t, edit);
  if (!ok) return;
  showToast('📦 حُفظ التعديل على الجهاز — سيُؤكَّد عند الإرسال');
  closeTreatmentEditModal();
  const depPage = document.getElementById('page-departures');
  if (depPage && depPage.classList.contains('active')) renderDepLog();
}

(window.__featModules = window.__featModules || {}).hist = true;
