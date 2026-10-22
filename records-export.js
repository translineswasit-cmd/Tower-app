/* records-export.js — v335-C5r8
   تصدير سجلات الكشف (Excel/PDF): نافذة اختيار الفلاتر والأعمدة والتصدير.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
(function mount_exportModalBg() {
  if (document.getElementById('exportModalBg')) return;
  const html = `
<div class="treat-modal-bg" id="exportModalBg">
  <div class="treat-modal">
    <h3>📊 تصدير التقرير</h3>
    <div class="field" style="margin-top:14px">
      <label>اسم الخط</label>
      <select id="exportFilterLine" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
        <option value="">-- كل الخطوط --</option>
      </select>
    </div>
    <div class="grid-2" style="margin-top:12px">
      <div class="field">
        <label>من تاريخ</label>
        <input type="date" id="exportFilterFrom" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
      </div>
      <div class="field">
        <label>إلى تاريخ</label>
        <input type="date" id="exportFilterTo" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
      </div>
    </div>
    <p id="exportResultCount" style="margin-top:12px;color:#718096;font-size:0.82rem"></p>
    <div style="margin-top:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <label style="font-weight:700;font-size:0.85rem">أعمدة ملف Excel</label>
        <button class="btn btn-secondary btn-sm" onclick="toggleExportColumnsSelectAll()" id="exportColumnsSelectAllBtn">إلغاء التحديد</button>
      </div>
      <div id="exportColumnsWrap" style="max-height:170px;overflow-y:auto;border:1.5px solid #E2E8F0;border-radius:8px;padding:8px"></div>
      <p style="margin-top:5px;color:#a0aec0;font-size:0.74rem">ينطبق على Excel فقط — تصدير PDF يعرض بطاقة كاملة لكل برج</p>
    </div>
    <div class="form-actions" style="margin-top:18px;flex-direction:column;gap:10px">
      <button class="btn btn-primary" onclick="confirmExportExcel()" style="width:100%">📊 تصدير Excel</button>
      <button class="btn btn-primary" onclick="confirmExportPDF()" style="width:100%;background:#922b21">📄 تصدير PDF (بصور العوازل)</button>
      <button class="btn btn-secondary" onclick="closeExportModal()" style="width:100%">إغلاق</button>
    </div>
  </div>
</div>
`;
  const anchor = document.getElementById('printLinesModalBg');
  if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else document.body.insertAdjacentHTML('beforeend', html);
})();

// ========================
// EXPORT MODAL (Excel + PDF مع فلترة)
// ========================
function openExportModalImpl() {
  const sel = document.getElementById('exportFilterLine');
  const uniqueLines = [...new Set(records.map(r => r.line_name).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">-- كل الخطوط --</option>' +
    uniqueLines.map(n => `<option value="${n}">${n}</option>`).join('');

  // ترث النافذة فلاتر شاشة السجلات المطبّقة حالياً بدل ما تبدأ فاضية
  // (سابقاً كانت تُفرَّغ، فيصدّر المستخدم كل السجلات وهو يظن أنه يصدّر المعروض أمامه فقط)
  const curLine = (document.getElementById('filterLine') || {}).value || '';
  const curFrom = (document.getElementById('filterDateFrom') || {}).value || '';
  const curTo = (document.getElementById('filterDateTo') || {}).value || '';
  sel.value = uniqueLines.includes(curLine) ? curLine : '';
  document.getElementById('exportFilterFrom').value = curFrom;
  document.getElementById('exportFilterTo').value = curTo;

  renderExportColumnPicker();
  updateExportResultCount();
  document.getElementById('exportModalBg').classList.add('show');
}

function closeExportModal() {
  document.getElementById('exportModalBg').classList.remove('show');
}

function getExportFilteredRecords() {
  const line = document.getElementById('exportFilterLine').value;
  const from = document.getElementById('exportFilterFrom').value;
  const to = document.getElementById('exportFilterTo').value;
  const rows = records.filter(r => {
    const mLine = !line || r.line_name === line;
    const mFrom = !from || (r.inspection_date||'') >= from;
    const mTo = !to || (r.inspection_date||'') <= to;
    return mLine && mFrom && mTo;
  });
  return sortByLineThenTower(rows, 'tower_number');
}

function updateExportResultCount() {
  const n = getExportFilteredRecords().length;
  document.getElementById('exportResultCount').textContent = `📋 عدد السجلات المطابقة: ${n}`;
}

(() => {   // v335-C5r8: الوحدة تُحمَّل بعد DOMContentLoaded؛ تُربط المستمعات فوراً بعد تركيب النافذة
  ['exportFilterLine','exportFilterFrom','exportFilterTo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', updateExportResultCount);
  });
})();

function renderExportColumnPicker() {
  const wrap = document.getElementById('exportColumnsWrap');
  if (!wrap) return;
  wrap.innerHTML = EXPORT_COLUMNS.map((c, i) => `
    <label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.82rem;border-bottom:1px solid #F0F2F5">
      <input type="checkbox" class="exportColChk" data-idx="${i}" checked>
      <span>${c.label}</span>
    </label>`).join('');
  const btn = document.getElementById('exportColumnsSelectAllBtn');
  if (btn) btn.textContent = 'إلغاء التحديد';
}

function toggleExportColumnsSelectAll() {
  const boxes = document.querySelectorAll('.exportColChk');
  const btn = document.getElementById('exportColumnsSelectAllBtn');
  const allChecked = Array.from(boxes).every(b => b.checked);
  boxes.forEach(b => b.checked = !allChecked);
  btn.textContent = allChecked ? 'تحديد الكل' : 'إلغاء التحديد';
}

async function confirmExportExcel() {
  const rows = getExportFilteredRecords();
  if (!rows.length) { showToast('لا توجد بيانات مطابقة للتصدير', 'error'); return; }
  const cols = Array.from(document.querySelectorAll('.exportColChk:checked'))
    .map(cb => EXPORT_COLUMNS[Number(cb.dataset.idx)]).filter(Boolean);
  if (!cols.length) { showToast('⚠️ اختر عموداً واحداً على الأقل', 'error'); return; }
  const data = rows.map(r => {
    const o = {};
    cols.forEach(c => { o[c.label] = c.get(r); });
    return o;
  });
  await ensureXLSXLoaded(); // Lazy load: يضمن اكتمال تحميل XLSX قبل الاستخدام
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'كشف الأبراج');
  XLSX.writeFile(wb, 'كشف_الأبراج_' + new Date().toLocaleDateString('ar-IQ') + '.xlsx');
  showToast('✅ تم تصدير Excel (' + rows.length + ' سجل · ' + cols.length + ' عمود)');
  closeExportModal();
}

async function confirmExportPDF() {
  const rows = getExportFilteredRecords();
  if (!rows.length) { showToast('لا توجد بيانات مطابقة للتصدير', 'error'); return; }
  showToast('⏳ جاري تحضير PDF...');
  closeExportModal();

  try {
    await ensureJsPDFLoaded(); // Lazy load: يضمن اكتمال تحميل jsPDF قبل الاستخدام
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 30;
    const usableW = pageW - margin * 2;
    let y = margin;

    // العنوان — مرسوم بالكانفاس ليدعم العربية (خطوط jsPDF المدمجة لا تحوي حروفاً عربية إطلاقاً)
    const titleImg = drawArabicTextPNG([
      { text: '📋 تقرير كشف الأبراج', fontSize: 17, fontWeight: 'bold', color: '#1a2e4a', padY: 4 },
      { text: `عدد السجلات: ${rows.length}  —  تاريخ التصدير: ${new Date().toLocaleDateString('en-GB')}`, fontSize: 11, color: '#555', padY: 3 }
    ], 700, {});
    if (titleImg) {
      const h = usableW * (titleImg.h / titleImg.w);
      doc.addImage(titleImg.dataUrl, 'JPEG', margin, y, usableW, h);
      y += h + 10;
    }

    let exported = 0;
    for (const r of rows) {
      const dmgText = insulatorStateToText(r.insulator_state);
      const items = [
        { text: `🗼 ${r.line_name || '-'} — برج ${r.tower_number || '-'} — ${r.tower_type || '-'} — ${r.voltage || ''} ك.ف`, fontSize: 13, fontWeight: 'bold', color: '#1a2e4a', bg: '#eef2f7', padY: 4 },
        { text: `📅 تاريخ الكشف: ${r.inspection_date || '-'}   |   👤 ${r.created_by_name || '-'}`, fontSize: 10, color: '#666', padY: 3 }
      ];
      const addLine = (label, val, color) => {
        if (val && String(val).trim() && String(val).trim() !== 'سليم') {
          items.push({ text: `🔴 ${label}: ${val}`, fontSize: 10.5, color: color || '#922b21', padY: 3 });
        }
      };
      addLine('تقاطعات الحديد', r.iron_intersections);
      addLine('قواعد البرج', r.tower_foundations);
      addLine('ملحقات البرج', r.tower_attachments);
      addLine('أسلاك R', r.wires_r1); addLine('أسلاك S', r.wires_s1); addLine('أسلاك T', r.wires_t1);
      // أسلاك الدائرة الثانية: addLine يطبع الوصف غير الفارغ فقط (لا "سليم" ولا شيء للحقل الفارغ/الغائب) — فلا تظهر لخط مفرد بلا بيانات لها، ولا يُسقط وصف محفوظ لغياب insulator_state_2
      addLine('أسلاك R (الدائرة الثانية)', r.wires_r1_c2); addLine('أسلاك S (الدائرة الثانية)', r.wires_s1_c2); addLine('أسلاك T (الدائرة الثانية)', r.wires_t1_c2);
      addLine('الأرضي 1', r.ground_1); addLine('الأرضي 2', r.ground_2);
      addLine('مسببات الحرائق', r.fire_causes);
      if (r.fire_causes_notes && r.fire_causes_notes.trim()) items.push({ text: `🔥 ${r.fire_causes_notes.trim()}`, fontSize: 10, color: '#922b21', padY: 3 });
      if (r.road_access) {
        const roadColor = r.road_access === 'متاح' ? '#1e8449' : '#922b21';
        let t = `🛣️ الطريق: ${r.road_access}`;
        if (r.road_access_notes && r.road_access_notes.trim()) t += ` — ${r.road_access_notes.trim()}`;
        items.push({ text: t, fontSize: 10, color: roadColor, padY: 3 });
      }
      items.push({ text: `🔘 العوازل: ${dmgText}`, fontSize: 10, color: dmgText.includes('متضرر') ? '#922b21' : '#1e8449', padY: 3 });
      if (r.notes && r.notes.trim()) items.push({ text: `📝 ملاحظات: ${r.notes.trim()}`, fontSize: 10, color: '#555', padY: 3 });

      const infoImg = drawArabicTextPNG(items, 760, { border: true });
      // رسم العوازل بالطريقة المثبتة (Canvas 2D مباشرة) — بديل foreignObject الذي يُنتج صوراً فارغة على iOS Safari
      const insImg = buildInsulatorExportPNG(r.insulator_state, r.voltage, r.tower_type, r.line_name, r.insulator_cycle, r.insulator_state_2, r.insulator_cycle_2, r.tower_number, r.insulator_chain_types, r.insulator_chain_types_2);

      const infoH = infoImg ? usableW * (infoImg.h / infoImg.w) : 0;
      const insH = insImg ? usableW * (insImg.h / insImg.w) : 0;
      const blockH = infoH + (infoImg ? 6 : 0) + insH + 14;

      if (y > margin && y + blockH > pageH - margin) { doc.addPage(); y = margin; }

      if (infoImg) { doc.addImage(infoImg.dataUrl, 'JPEG', margin, y, usableW, infoH); y += infoH + 6; }
      if (insImg)  { doc.addImage(insImg.dataUrl, 'PNG', margin, y, usableW, insH); y += insH + 6; }
      y += 8;
      exported++;
    }

    const blob = doc.output('blob');
    await shareOrDownloadFile(blob, 'كشف_الأبراج_' + new Date().toISOString().split('T')[0] + '.pdf', 'application/pdf');
    showToast('✅ تم تصدير PDF (' + exported + ' سجل)');
  } catch (e) {
    console.error('PDF export error:', e);
    showToast('❌ تعذر تصدير PDF: ' + (e && e.message ? e.message : e), 'error');
  }
}

(window.__featModules = window.__featModules || {}).rexp = true;
