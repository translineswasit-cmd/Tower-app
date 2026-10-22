/* treatment-log-export.js — v335-C5r8
   تصدير سجل المعالجات (PDF/Excel): نافذة الاختيار والفلاتر والتصدير.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
(function mount_depLogExportModalBg() {
  if (document.getElementById('depLogExportModalBg')) return;
  const html = `
<div class="treat-modal-bg" id="depLogExportModalBg">
  <div class="treat-modal">
    <h3>📤 تصدير سجل المعالجات</h3>
    <div class="field" style="margin-top:14px">
      <label>اسم الخط</label>
      <select id="depLogExportFilterLine" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
        <option value="">-- كل الخطوط --</option>
      </select>
    </div>
    <div class="grid-2" style="margin-top:12px">
      <div class="field">
        <label>من تاريخ</label>
        <input type="date" id="depLogExportFilterFrom" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
      </div>
      <div class="field">
        <label>إلى تاريخ</label>
        <input type="date" id="depLogExportFilterTo" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
      </div>
    </div>
    <div class="field" style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin:0">الأبراج</label>
        <button type="button" class="btn-sm" style="border:1px solid #CBD5E0;border-radius:6px;background:#F7FAFC;padding:2px 8px;font-size:0.75rem;cursor:pointer" onclick="toggleAllDepLogExportTowers()">تحديد الكل / إلغاء الكل</button>
      </div>
      <div id="depLogExportTowersWrap" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px 8px;max-height:160px;overflow-y:auto;margin-top:6px;padding:8px;border:1.5px solid #E2E8F0;border-radius:8px"></div>
    </div>
    <p id="depLogExportResultCount" style="margin-top:12px;color:#718096;font-size:0.82rem"></p>
    <div class="form-actions" style="margin-top:18px;flex-direction:column;gap:10px">
      <button class="btn btn-primary" style="width:100%;background:#922b21" onclick="exportDepLogPDF()">📄 PDF</button>
      <button class="btn btn-primary" style="width:100%" onclick="exportDepLogExcel()">📊 Excel</button>
      <button class="btn btn-secondary" onclick="closeDepLogExportModal()" style="width:100%">إغلاق</button>
    </div>
  </div>
</div>
`;
  const anchor = document.getElementById('printLinesModalBg');
  if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else document.body.insertAdjacentHTML('beforeend', html);
})();

// ========================
// EXPORT MODAL — سجل المعالجات (PDF / Excel عبر قائمة المشاركة الأصلية)
// ========================
function openDepLogExportModalImpl() {
  const sel = document.getElementById('depLogExportFilterLine');
  const uniqueLines = [...new Set(treatmentsCache.map(t => t.line_name).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">-- كل الخطوط --</option>' +
    uniqueLines.map(n => `<option value="${n}">${n}</option>`).join('');
  // ينسخ فلتر الصفحة الحالي كقيمة مبدئية بنافذة التصدير
  sel.value = document.getElementById('depLogFilterLine')?.value || '';
  document.getElementById('depLogExportFilterFrom').value = document.getElementById('depLogFilterFrom')?.value || '';
  document.getElementById('depLogExportFilterTo').value = document.getElementById('depLogFilterTo')?.value || '';
  updateDepLogExportTowerList();
  document.getElementById('depLogExportModalBg').classList.add('show');
}

function closeDepLogExportModal() {
  document.getElementById('depLogExportModalBg').classList.remove('show');
}

// يرجّع السجلات المطابقة لفلتر الخط + التاريخ فقط (بدون فلتر الأبراج) — تُستخدم لبناء قائمة الأبراج المتاحة للاختيار
function getDepLogExportFilteredByLineDate() {
  const line = document.getElementById('depLogExportFilterLine').value;
  const from = document.getElementById('depLogExportFilterFrom').value;
  const to = document.getElementById('depLogExportFilterTo').value;
  return treatmentsCache.filter(t => {
    const mLine = !line || t.line_name === line;
    const mFrom = !from || (t.treatment_date||'') >= from;
    const mTo = !to || (t.treatment_date||'') <= to;
    return mLine && mFrom && mTo;
  });
}

// يبني قائمة الأبراج (checkboxes) المتاحة ضمن فلتر الخط/التاريخ الحالي — كلها محددة افتراضياً
function updateDepLogExportTowerList() {
  const wrap = document.getElementById('depLogExportTowersWrap');
  const rows = getDepLogExportFilteredByLineDate();
  const uniqueTowers = [...new Set(rows.map(t => t.tower_number).filter(v => v !== undefined && v !== null && v !== ''))]
    .sort((a,b) => (parseInt(a)||0) - (parseInt(b)||0) || String(a).localeCompare(String(b)));
  if (!uniqueTowers.length) {
    wrap.innerHTML = '<div style="font-size:0.8rem;color:#718096;grid-column:1/-1">لا توجد أبراج مطابقة</div>';
    updateDepLogExportResultCount();
    return;
  }
  wrap.innerHTML = uniqueTowers.map(tn => `
    <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:2px 0">
      <input type="checkbox" class="depLogExportTowerChk" value="${tn}" checked>
      <span>برج ${tn}</span>
    </label>`).join('');
  wrap.querySelectorAll('.depLogExportTowerChk').forEach(cb => cb.addEventListener('change', updateDepLogExportResultCount));
  updateDepLogExportResultCount();
}

function toggleAllDepLogExportTowers() {
  const boxes = document.querySelectorAll('.depLogExportTowerChk');
  if (!boxes.length) return;
  const allChecked = Array.from(boxes).every(b => b.checked);
  boxes.forEach(b => b.checked = !allChecked);
  updateDepLogExportResultCount();
}

function getDepLogExportSelectedTowers() {
  return new Set(Array.from(document.querySelectorAll('.depLogExportTowerChk:checked')).map(b => b.value));
}

// يرجّع السجلات النهائية المطابقة (خط + تاريخ + الأبراج المحددة) — هذي المستخدمة فعلياً بالتصدير
function getDepLogExportFiltered() {
  const rows = getDepLogExportFilteredByLineDate();
  const selectedTowers = getDepLogExportSelectedTowers();
  if (!selectedTowers.size) return [];
  return sortTreatmentsByLineTowerThenDate(rows.filter(t => selectedTowers.has(String(t.tower_number))));
}

function updateDepLogExportResultCount() {
  const n = getDepLogExportFiltered().length;
  document.getElementById('depLogExportResultCount').textContent = `📋 عدد المعالجات المطابقة: ${n}`;
}

(() => {   // v335-C5r8: الوحدة تُحمَّل بعد DOMContentLoaded؛ تُربط المستمعات فوراً بعد تركيب النافذة
  ['depLogExportFilterLine','depLogExportFilterFrom','depLogExportFilterTo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', updateDepLogExportTowerList);
  });
})();

// عنوان PDF عربي عبر مسار الرسم العربي الموجود (doc.text لا يدعم العربية)؛ يُرسم بمحاذاة اليمين، والتاريخ باليسار
function pdfDrawArabicTitle(doc, pageW, marginX, title) {
  try {
    const img = drawArabicTextPNG([{ text: title, fontSize: 15, fontWeight: 'bold', padY: 2 }], 260);
    doc.addImage(img.dataUrl, 'JPEG', pageW - marginX - img.w, 6, img.w, img.h);
  } catch (e) {
    console.warn('[tower-app] تعذّر رسم عنوان PDF العربي', e);
    doc.text('Report', pageW / 2, 26, { align: 'center' });
  }
  doc.setFontSize(9);
  doc.text(new Date().toLocaleDateString('en-GB'), marginX, 30);
}

async function exportDepLogPDF() {
  const rows = getDepLogExportFiltered();
  if (!rows.length) { showToast('لا توجد معالجات مطابقة للتصدير', 'error'); return; }
  showToast('⏳ جاري تحضير PDF...');

  try {
    await ensureJsPDFLoaded(); // Lazy load: يضمن اكتمال تحميل jsPDF قبل الاستخدام
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 30, marginTop = 50, marginBottom = 26;
    let y = marginTop;

    pdfDrawArabicTitle(doc, pageW, marginX, 'سجل المعالجات');

    const drawW = pageW - marginX*2;
    // أقصى ارتفاع لجزء بطاقة (بكسل-بطاقة) من مساحة الصفحة الفعلية بعد الهوامش وفاصل البطاقات وعرض الرسم
    const maxPartH = Math.floor((pageH - marginTop - marginBottom - 8) / (drawW / 760));
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i];
      const card = await buildTreatLogRecordCanvas(t, { seq: i + 1, maxPartH }); // ترقيم التصدير فقط: رقم واحد لكل أجزاء العملية
      for (const part of (card.parts || [card])) { // كل الأجزاء تُرسم (لا الاكتفاء بالأول)
        const drawH = part.h * (drawW / part.w);
        // لا نقفز لصفحة جديدة إلا لو فيه محتوى مرسوم أصلاً بالصفحة الحالية (يمنع صفحة أولى فارغة)
        if (y > marginTop && y + drawH > pageH - marginBottom) { doc.addPage(); y = marginTop; }
        doc.addImage(part.dataUrl, 'JPEG', marginX, y, drawW, drawH);
        y += drawH + 8;
      }
    }

    const blob = doc.output('blob');
    const filename = 'سجل_المعالجات_' + new Date().toISOString().split('T')[0] + '.pdf';
    await shareOrDownloadFile(blob, filename, 'application/pdf');
    showToast('✅ تم تجهيز PDF (' + rows.length + ' معالجة)');
    closeDepLogExportModal();
  } catch (err) {
    console.error(err);
    showToast('❌ تعذر تجهيز PDF', 'error');
  }
}

async function exportDepLogExcel() {
  const rows = getDepLogExportFiltered();
  if (!rows.length) { showToast('لا توجد معالجات مطابقة للتصدير', 'error'); return; }
  try {
    await ensureExcelJSLoaded(); // Lazy load: يضمن اكتمال تحميل ExcelJS قبل الاستخدام
    const wb = new ExcelJS.Workbook();
    // صفحة من اليمين لليسار + تثبيت صف الترويسة. لا نحدد ارتفاع صفوف (التفاف النص يترك الارتفاع للبرنامج فلا يُخفى محتوى)
    const ws = wb.addWorksheet('سجل المعالجات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = [{ width: 8 },{ width: 34 },{ width: 10 },{ width: 14 },{ width: 24 },{ width: 50 },{ width: 60 }];

    const headers = ['تسلسل', 'اسم الخط', 'رقم البرج', 'تاريخ المعالجة', 'المعالج', 'العناصر المعالجة', 'الملاحظات'];
    headers.forEach((label, i) => {
      const cell = ws.getCell(1, i + 1);
      cell.value = label;
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    rows.forEach((t, rIdx) => {
      const rowNum = rIdx + 2;
      const values = [
        rIdx + 1, // تسلسل العملية (نفس ترقيم PDF)
        t.line_name || '',
        t.tower_number || '',
        t.treatment_date || '', // نص YYYY-MM-DD كما كان
        t.treated_by || '',
        (t.items_treated || []).map(it => it.label).join('، '),
        treatmentDisplayModel(t).notes // الملاحظات كاملة بأسطرها (العمود دائماً موجود حتى لو فارغاً)
      ];
      values.forEach((val, ci) => {
        const cell = ws.getCell(rowNum, ci + 1);
        cell.value = val;
        const isText = (ci === 1 || ci === 4 || ci === 5 || ci === 6); // الخط والمنفّذ والعناصر والملاحظات: يمين + التفاف
        cell.alignment = isText ? { horizontal: 'right', vertical: 'top', wrapText: true } : { horizontal: 'center', vertical: 'top' };
      });
    });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const filename = 'سجل_المعالجات_' + new Date().toISOString().split('T')[0] + '.xlsx';
    await shareOrDownloadFile(blob, filename, blob.type);
    showToast('✅ تم تجهيز Excel (' + rows.length + ' معالجة)');
    closeDepLogExportModal();
  } catch (err) {
    showToast('❌ تعذر تجهيز Excel', 'error');
  }
}

(window.__featModules = window.__featModules || {}).lexp = true;
