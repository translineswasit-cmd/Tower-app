/* treatment-log-export.js — v335-C6r21 (P01-B1)
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
    <p id="depLogExportResultCount" style="margin-top:12px;color:#718096;font-size:0.82rem">يُجلب كل المعالجات المطابقة (وليس المعروضة فقط) على دفعات عند الضغط على PDF أو Excel.</p>
    <p id="depLogExportProgress" role="status" aria-live="polite" style="margin-top:8px;color:#2C5282;font-size:0.82rem;display:none"></p>
    <div class="form-actions" style="margin-top:18px;flex-direction:column;gap:10px">
      <button class="btn btn-primary" style="width:100%;background:#922b21" onclick="exportDepLogPDF()">📄 PDF</button>
      <button class="btn btn-primary" style="width:100%" onclick="exportDepLogExcel()">📊 Excel</button>
      <button class="btn btn-secondary" id="depLogExportCancelBtn" onclick="cancelDepLogExport()" style="width:100%;display:none">⛔ إلغاء التصدير</button>
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
let _lexpRun = null;

function openDepLogExportModalImpl() {
  const sel = document.getElementById('depLogExportFilterLine');
  const names = Object.keys(LINES_DATA || {}).sort((a, b) => a.localeCompare(b, 'ar'));   // v335-C6r21 (P01-B1): من LINES_DATA لا من جدول المعالجات
  sel.innerHTML = '<option value="">-- كل الخطوط --</option>' + names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  // ينسخ فلتر الصفحة الحالي كقيمة مبدئية بنافذة التصدير
  sel.value = document.getElementById('depLogFilterLine')?.value || '';
  document.getElementById('depLogExportFilterFrom').value = document.getElementById('depLogFilterFrom')?.value || '';
  document.getElementById('depLogExportFilterTo').value = document.getElementById('depLogFilterTo')?.value || '';
  updateDepLogExportTowerList(_digitsAscii(document.getElementById('depLogFilterTower')?.value || ''));
  depLogExportUi(false, '');
  document.getElementById('depLogExportModalBg').classList.add('show');
}

function closeDepLogExportModal() {
  if (_lexpRun) _lexpRun.cancelled = true;   // إغلاق النافذة أثناء الجلب = إلغاء؛ لا يُكتب أي ملف
  document.getElementById('depLogExportModalBg').classList.remove('show');
}

function cancelDepLogExport() { if (_lexpRun) { _lexpRun.cancelled = true; depLogExportUi(true, '⛔ جاري الإلغاء...'); } }

// قائمة أبراج الخط المختار (من بيانات الخطوط المحلية، بلا قراءة شبكة) — كلها محددة افتراضياً؛ preselect = برج فلتر الصفحة
function updateDepLogExportTowerList(preselect) {
  const wrap = document.getElementById('depLogExportTowersWrap');
  const line = document.getElementById('depLogExportFilterLine').value;
  if (!line) { wrap.innerHTML = '<div style="font-size:0.8rem;color:#718096;grid-column:1/-1">اختر خطاً لتحديد أبراج بعينها — بدون خط تُصدَّر كل المعالجات المطابقة للتاريخ</div>'; return; }
  const nums = [...new Set((getLineTowers(line) || []).map(tw => String(tw.num)).filter(v => v !== '' && v !== 'undefined' && v !== 'null'))];
  if (preselect && nums.indexOf(String(preselect)) < 0) nums.push(String(preselect));
  nums.sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0) || String(a).localeCompare(String(b)));
  if (!nums.length) { wrap.innerHTML = '<div style="font-size:0.8rem;color:#718096;grid-column:1/-1">لا توجد قائمة أبراج لهذا الخط — تُصدَّر كل أبراجه المطابقة</div>'; return; }
  wrap.innerHTML = nums.map(tn => `
    <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:2px 0">
      <input type="checkbox" class="depLogExportTowerChk" value="${escapeHtml(tn)}" ${(!preselect || String(preselect) === tn) ? 'checked' : ''}>
      <span>برج ${escapeHtml(tn)}</span>
    </label>`).join('');
}

function toggleAllDepLogExportTowers() {
  const boxes = document.querySelectorAll('.depLogExportTowerChk');
  if (!boxes.length) return;
  const allChecked = Array.from(boxes).every(b => b.checked);
  boxes.forEach(b => b.checked = !allChecked);
}

// فلاتر النافذة الحالية: towers = null (كل الأبراج) أو مصفوفة محددة
function getDepLogExportFilters() {
  const boxes = Array.from(document.querySelectorAll('.depLogExportTowerChk'));
  const chosen = boxes.filter(b => b.checked).map(b => b.value);
  return {
    line: document.getElementById('depLogExportFilterLine').value,
    from: document.getElementById('depLogExportFilterFrom').value,
    to: document.getElementById('depLogExportFilterTo').value,
    towers: (boxes.length && chosen.length < boxes.length) ? chosen : null,
    noTower: !!(boxes.length && !chosen.length)
  };
}
function depLogExportSig() { const f = getDepLogExportFilters(); return JSON.stringify([f.line, f.from, f.to, f.towers, f.noTower]); }

function depLogExportUi(busy, msg) {
  const pr = document.getElementById('depLogExportProgress'), cb = document.getElementById('depLogExportCancelBtn');
  if (pr) { pr.style.display = msg ? '' : 'none'; pr.textContent = msg || ''; }
  if (cb) cb.style.display = busy ? '' : 'none';
  ['depLogExportFilterLine', 'depLogExportFilterFrom', 'depLogExportFilterTo'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !!busy; });
  document.querySelectorAll('.depLogExportTowerChk').forEach(b => { b.disabled = !!busy; });
  document.querySelectorAll('#depLogExportModalBg .form-actions .btn-primary').forEach(b => { b.disabled = !!busy; });
}

function depLogExportBegin() {
  if (_lexpRun) { showToast('⏳ تصدير جارٍ بالفعل'); return null; }
  const f = getDepLogExportFilters();
  if (f.noTower) { showToast('⚠️ لم تحدد أي برج', 'error'); return null; }
  if (f.from && f.to && f.from > f.to) { showToast('⚠️ تاريخ البداية بعد تاريخ النهاية', 'error'); return null; }
  if (navigator.onLine === false) { showToast('📴 يلزم الاتصال لجلب كل المعالجات المطابقة للتصدير', 'error'); return null; }
  const run = { f, sess: _histSess(), sig: depLogExportSig(), cancelled: false };
  run.alive = () => _lexpRun === run && !run.cancelled && _histSessOk(run.sess) && depLogExportSig() === run.sig;
  _lexpRun = run;
  depLogExportUi(true, '⏳ جاري جلب المعالجات المطابقة...');
  return run;
}
function depLogExportEnd(run, msg) { if (_lexpRun === run) _lexpRun = null; depLogExportUi(false, msg || ''); }

// يجلب كل المطابق على دفعات محدودة؛ أي انقطاع/تغيّر جلسة/فلتر/إلغاء = استثناء aborted أو خطأ (لا نتيجة جزئية)
async function depLogExportCollect(run) {
  const f = run.f;
  const prog = n => { if (run.alive()) depLogExportUi(true, '⏳ جاري جلب المعالجات المطابقة: ' + n); };
  let rows = [];
  if (f.towers && f.towers.length <= 10) {
    for (const tn of f.towers) {
      const base = rows.length;
      const part = await histFetchAll({ line: f.line, tower: tn, from: f.from, to: f.to }, { alive: run.alive, onProgress: n => prog(base + n) });
      rows = rows.concat(part);
    }
  } else {
    rows = await histFetchAll({ line: f.line, from: f.from, to: f.to }, { alive: run.alive, onProgress: prog });
    if (f.towers) { const set = new Set(f.towers); rows = rows.filter(t => set.has(String(t.tower_number))); }
  }
  const seen = new Set();
  rows = rows.filter(t => { const k = String(t.id); if (seen.has(k)) return false; seen.add(k); return true; });
  return sortTreatmentsByLineTowerThenDate(rows);
}

function depLogExportFail(err, what) {
  if (err && (err.aborted || err.stale)) { showToast('⛔ أُلغي التصدير (تغيّر الفلتر/الجلسة أو أُلغي) — لم يُنشأ أي ملف'); return; }
  console.error(err);
  showToast('❌ تعذر تجهيز ' + what + ' — البيانات غير مكتملة فلم يُنشأ أي ملف', 'error');
}

(() => {   // v335-C5r8: الوحدة تُحمَّل بعد DOMContentLoaded؛ تُربط المستمعات فوراً بعد تركيب النافذة
  const ln = document.getElementById('depLogExportFilterLine');
  if (ln) ln.addEventListener('change', () => updateDepLogExportTowerList(''));
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
  const run = depLogExportBegin(); if (!run) return;
  try {
    const rows = await depLogExportCollect(run);
    if (!rows.length) { showToast('لا توجد معالجات مطابقة للتصدير', 'error'); depLogExportEnd(run); return; }
    depLogExportUi(true, '🖼️ جاري تجهيز PDF لـ ' + rows.length + ' معالجة...');
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
      if (!run.alive()) { const e = new Error('aborted'); e.aborted = true; throw e; }
      if (i % 10 === 0) depLogExportUi(true, '🖼️ جاري تجهيز PDF: ' + i + ' / ' + rows.length);
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
    if (!run.alive()) { const e = new Error('aborted'); e.aborted = true; throw e; }   // لا كتابة بعد تغيّر جلسة/فلتر
    await shareOrDownloadFile(blob, filename, 'application/pdf');
    showToast('✅ تم تجهيز PDF (' + rows.length + ' معالجة)');
    depLogExportEnd(run);
    closeDepLogExportModal();
  } catch (err) {
    depLogExportFail(err, 'PDF');
    depLogExportEnd(run);
  }
}

async function exportDepLogExcel() {
  const run = depLogExportBegin(); if (!run) return;
  try {
    const rows = await depLogExportCollect(run);
    if (!rows.length) { showToast('لا توجد معالجات مطابقة للتصدير', 'error'); depLogExportEnd(run); return; }
    depLogExportUi(true, '📊 جاري تجهيز Excel لـ ' + rows.length + ' معالجة...');
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
    if (!run.alive()) { const e = new Error('aborted'); e.aborted = true; throw e; }   // لا كتابة بعد تغيّر جلسة/فلتر
    await shareOrDownloadFile(blob, filename, blob.type);
    showToast('✅ تم تجهيز Excel (' + rows.length + ' معالجة)');
    depLogExportEnd(run);
    closeDepLogExportModal();
  } catch (err) {
    depLogExportFail(err, 'Excel');
    depLogExportEnd(run);
  }
}

(window.__featModules = window.__featModules || {}).lexp = true;
