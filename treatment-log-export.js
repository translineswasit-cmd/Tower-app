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
  fillLineSelect(sel, { placeholder: '-- كل الخطوط --' });   // N25-R6s3: الفهرس الموحّد
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

// قائمة أبراج الخط المختار. N25-R22: عند وجود دليل ترقيم متماسك (خريطة) تُبنى القائمة من دليل الأبراج (app_tower_directory — قراءة صغيرة، لا تاريخ) فتضم الفعّال والمؤرشف،
// وقيمة كل خانة = الهوية الدائمة (tower_id) لحظة العرض لا رقمه؛ وإلا (نسخة 0 مثبتة / دليل غير متاح) تبقى قائمة الأرقام كما كانت. كلها محددة افتراضياً؛ preselect = برج فلتر الصفحة.
let _lexpListSeq = 0;
// N25-R22a: الصفوف المعروضة تُبنى من دليل هوية صالح فقط (الخريطة المتماسكة لنسخة > 0، أو دليل نسخة 0 المثبتة)، ولكل صف هويته من الدليل نفسه لحظة الرسم.
// بغياب الدليل لا تُعرض خانات أبراج (تحديد أبراج بعينها غير متاح حتى يصل)، ولا تُلصق هوية من دليل أحدث بخانة كانت بلا هوية؛ برج الفلتر المكتوب (preselect) لا يُحوَّل لتحديد صريح بعد وصول متأخر.
function depLogDirList(line) {   // {rev, act, arc, byNum} أو null
  try {
    const d = csDirGet(line); if (!d || !d.byId) return null;
    const rev = Number(d.rev);
    if (rev > 0) { const m = csMap(line); if (csIdentState(line) !== 'map' || !m || !m.full || Number(m.rev) !== rev) return null; }
    else if (!csIsZero(line)) return null;
    const ent = Object.keys(d.byId).map(tid => ({ tid, n: d.byId[tid].n, r: !!d.byId[tid].r, rn: d.byId[tid].rn }));
    const num = v => parseInt(v) || 0;
    const act = ent.filter(e => !e.r && e.n != null).sort((x, y) => num(x.n) - num(y.n) || String(x.n).localeCompare(String(y.n)));
    const byNum = {}; act.forEach(e => { byNum[String(e.n)] = e.tid; });
    return { rev, act, arc: ent.filter(e => e.r).sort((x, y) => num(x.rn) - num(y.rn) || String(x.tid).localeCompare(String(y.tid))), byNum };
  } catch (e) { return null; }
}
function updateDepLogExportTowerList(preselect, keep) {
  const wrap = document.getElementById('depLogExportTowersWrap');
  const line = document.getElementById('depLogExportFilterLine').value;
  const seq = ++_lexpListSeq;
  const msg = (t) => '<div style="font-size:0.8rem;color:#718096;grid-column:1/-1">' + t + '</div>';
  if (!line) { delete wrap.dataset.pending; delete wrap.dataset.pre; wrap.innerHTML = msg('اختر خطاً لتحديد أبراج بعينها — بدون خط تُصدَّر كل المعالجات المطابقة للتاريخ'); return; }
  const wasPending = !!keep && wrap.dataset.pending === '1';
  const prevBoxes = keep && !wasPending ? Array.from(document.querySelectorAll('.depLogExportTowerChk')) : [];
  const prevByTid = new Map(); prevBoxes.forEach(b => { const k = b.dataset.mode === 'id' ? b.value : (b.dataset.tid || ''); if (k) prevByTid.set(k, b.checked); });   // التحديد يتبع الهوية الملتقطة وقت العرض لا رقم صاحبها الآن
  const prevAll = prevBoxes.length > 0 && prevBoxes.every(b => b.checked);
  const L = depLogDirList(line);
  if (L) {
    const lateWithPre = wasPending && !!(wrap.dataset.pre || preselect);
    const pre = (!prevBoxes.length && !wasPending && preselect) ? (L.byNum[String(preselect)] || null) : null;
    const chk = tid => prevBoxes.length ? (prevByTid.has(tid) ? !!prevByTid.get(tid) : prevAll) : (wasPending ? !lateWithPre : (preselect ? tid === pre : true));
    const idMode = L.rev > 0;
    const lbl = (e, txt) => `<label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:2px 0"><input type="checkbox" class="depLogExportTowerChk" data-mode="${idMode ? 'id' : 'num'}" data-tid="${escapeHtml(e.tid)}" data-ret="${e.r ? 1 : 0}" value="${escapeHtml(idMode ? e.tid : String(e.n))}" ${chk(e.tid) ? 'checked' : ''}><span>${txt}</span></label>`;
    let h = (lateWithPre ? msg('وصل دليل الأبراج الآن — راجع القائمة واختر البرج المطلوب صراحةً (لم يُحدَّد شيء تلقائياً)') : '') + L.act.map(e => lbl(e, 'برج ' + escapeHtml(e.n))).join('');
    if (L.arc.length) h += '<div style="grid-column:1/-1;font-size:0.74rem;font-weight:700;color:#7B341E;border-bottom:1px solid #E2E8F0;padding:3px 0;margin-top:4px">أبراج مؤرشفة (خرجت من الخط — سجلها محفوظ)</div>' + L.arc.map(e => lbl(e, 'برج مؤرشف — كان رقمه ' + escapeHtml(e.rn == null ? '؟' : e.rn))).join('');
    if (!L.act.length && !L.arc.length) h = msg('لا توجد قائمة أبراج لهذا الخط — تُصدَّر كل أبراجه المطابقة');
    wrap.innerHTML = h; wrap.dataset.rev = String(L.rev); delete wrap.dataset.pending; delete wrap.dataset.pre;
  } else {
    // لا دليل هوية صالح: لا خانات ولا تحديد خاص؛ «كل الخط» يبقى متاحاً (لا يعتمد على الأرقام). فلتر برج مكتوب مع غياب الدليل = رفض عند التصدير
    wrap.innerHTML = msg('⏳ جارٍ تحميل دليل أبراج الخط… تحديد أبراج بعينها غير متاح حتى يصل (تصدير كل الخط متاح)');
    wrap.dataset.pending = '1'; if (preselect) wrap.dataset.pre = String(preselect); else if (!wasPending) delete wrap.dataset.pre; delete wrap.dataset.rev;
  }
  // قراءة الدليل (مخزَّنة ≤15 ث): عند وصوله بعد الرسم أو تغيّر نسخته تُعاد الرسم من الدليل نفسه مع حفظ التحديد بالهوية؛ ولا تُعاد أثناء تصدير جارٍ
  Promise.resolve().then(() => csDirLoad(line, 15000)).then(() => {
    if (seq !== _lexpListSeq || _lexpRun || document.getElementById('depLogExportFilterLine').value !== line) return;
    const L2 = depLogDirList(line);
    if (L2 && (wrap.dataset.pending === '1' || String(L2.rev) !== wrap.dataset.rev)) updateDepLogExportTowerList(preselect, true);
    else if (!L2 && wrap.dataset.pending === '1') wrap.innerHTML = msg('تعذّر تحميل دليل أبراج الخط — تحديد أبراج بعينها غير متاح الآن (تصدير كل الخط متاح)');
  }).catch(() => {});
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
    idMode: !!(boxes.length && boxes.every(b => b.dataset.mode === 'id')),   // N25-R22: القيم هويات دائمة لا أرقام
    tids: boxes.filter(b => b.checked).map(b => b.dataset.tid || ''),
    pendingPre: !!(document.getElementById('depLogExportTowersWrap').dataset.pending === '1' && document.getElementById('depLogExportTowersWrap').dataset.pre),   // N25-R22a: فلتر برج مكتوب والدليل لم يصل
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
  // N25-R5: على خط أُعيد ترقيمه يُحلّ كل رقم مختار إلى هويته الدائمة فتُجلب معالجاته بأرقامه السابقة ولا تُجلب معالجات من حمل رقمه سابقاً
  let idents = null;
  if (f.pendingPre) { const e = new Error('identity_stale'); e.idStale = true; throw e; }   // N25-R22a: لا يتحول غياب الدليل إلى «كل الأبراج» ولا إلى رقم دون هوية
  if (f.towers && f.line) {
    // N25-R22: تحديد أبراج بعينها = هويات ثُبّتت عند العرض؛ لا يُحلّ الرقم لصاحبه وقت الضغط. الدليل يُقرأ طازجاً (فشل القراءة ≠ دليل قديم صالح).
    const t0 = Date.now(); let d = await csDirLoad(f.line, 0);
    if (!d || !(d.at >= t0)) d = await csDirLoad(f.line, 0);
    if (!d || !(d.at >= t0) || !d.byId) { const e = new Error('identity_unavailable'); e.idUnavailable = true; throw e; }
    const rev = Number(d.rev);
    if (f.idMode) {
      if (f.towers.some(t => !d.byId[t])) { const e = new Error('identity_stale'); e.idStale = true; throw e; }
      idents = f.towers.map(t => ({ mode: 'id', tid: String(t), rev }));
    } else if (rev > 0) {   // قائمة أرقام رُسمت عند نسخة 0 ثم أُعيد ترقيم الخط: لا انتقال لصاحب الرقم الجديد؛ الهوية الملتقطة وحدها أو لا تصدير
      if (!f.tids || f.tids.length !== f.towers.length || f.tids.some(t => !t || !d.byId[t])) { const e = new Error('identity_stale'); e.idStale = true; throw e; }
      idents = f.tids.map(t => ({ mode: 'id', tid: String(t), rev }));
    } else { idents = []; for (const tn of f.towers) idents.push(await csHistIdent(f.line, tn)); }   // نسخة 0 مثبتة طازجاً: المسار القديم بالرقم كما كان
  }
  if (idents && idents.some(x => x.mode === 'unavailable')) { const e = new Error('identity_unavailable'); e.idUnavailable = true; throw e; }   // لا تصدير بالرقم حين تُجهَل هوية الأبراج: لا ملف ناقص ولا مخلوط
  const byId = idents && idents.some(x => x.mode === 'id' || x.mode === 'none');
  if (f.towers && byId) {
    const tids = idents.filter(x => x.mode === 'id').map(x => x.tid);
    if (tids.length <= 10) {
      for (const tid of tids) {
        const base = rows.length;
        const part = await histFetchAll({ tid, from: f.from, to: f.to }, { alive: run.alive, onProgress: n => prog(base + n) });
        rows = rows.concat(part);
      }
    } else {
      rows = await histFetchAll({ line: f.line, from: f.from, to: f.to }, { alive: run.alive, onProgress: prog });
      const set = new Set(tids); rows = rows.filter(t => t.tower_id && set.has(String(t.tower_id)));
    }
  } else if (f.towers && f.towers.length <= 10) {
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
  // N25-R5: ملاحظة الهوية لكل صف (الرقم الحالي / برج محذوف / غير مرتبط) — اللقطة التاريخية نفسها لا تتغيّر
  const lines = [...new Set(rows.map(t => t.line_name).filter(Boolean))];
  for (const ln of lines) await csDirLoad(ln, 15000);
  rows.forEach(t => { try { t._idNote = csRowNote(t); } catch (e) { t._idNote = ''; } });
  // N25-R22: ترتيب الخطوط بترتيب المشروع (400 ثم 132 ثم المجهول وأبجدياً داخل المجموعة) بالدالة المشتركة؛ الترتيب الثابت يُبقي الأبراج ثم التاريخ داخل كل خط كما كانا
  const sorted = sortTreatmentsByLineTowerThenDate(rows);
  const rk = new Map(sortLineNames([...new Set(sorted.map(t => t.line_name).filter(Boolean))]).map((n, i) => [n, i]));
  return sorted.sort((a, b) => (rk.has(a.line_name) ? rk.get(a.line_name) : 1e9) - (rk.has(b.line_name) ? rk.get(b.line_name) : 1e9));
}

function depLogExportFail(err, what) {
  if (err && err.idUnavailable) { showToast('⛔ ' + CS_IDENT_UNAVAILABLE_TEXT + ' — لم يُنشأ أي ملف', 'error'); return; }
  if (err && err.idStale) { showToast('⛔ تغيّر ترقيم الخط أو لم يعد أحد الأبراج المحددة معروفاً — حدّث الاختيار (أعد فتح النافذة) — لم يُنشأ أي ملف', 'error'); return; }
  if (err && (err.aborted || err.stale)) { showToast('⛔ أُلغي التصدير (تغيّر الفلتر/الجلسة أو أُلغي) — لم يُنشأ أي ملف'); return; }
  console.error(err);
  showToast('❌ تعذر تجهيز ' + what + ' — البيانات غير مكتملة فلم يُنشأ أي ملف', 'error');
}

(() => {   // v335-C5r8: الوحدة تُحمَّل بعد DOMContentLoaded؛ تُربط المستمعات فوراً بعد تركيب النافذة
  const ln = document.getElementById('depLogExportFilterLine');
  if (ln) ln.addEventListener('change', () => updateDepLogExportTowerList('', false));
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
    ws.columns = [{ width: 8 },{ width: 34 },{ width: 10 },{ width: 14 },{ width: 24 },{ width: 50 },{ width: 60 },{ width: 36 }];

    const headers = ['تسلسل', 'اسم الخط', 'رقم البرج', 'تاريخ المعالجة', 'المعالج', 'العناصر المعالجة', 'الملاحظات', 'هوية البرج'];
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
        treatmentDisplayModel(t).notes, // الملاحظات كاملة بأسطرها (العمود دائماً موجود حتى لو فارغاً)
        t._idNote || ''
      ];
      values.forEach((val, ci) => {
        const cell = ws.getCell(rowNum, ci + 1);
        cell.value = val;
        const isText = (ci === 1 || ci === 4 || ci === 5 || ci === 6 || ci === 7); // الخط والمنفّذ والعناصر والملاحظات: يمين + التفاف
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
