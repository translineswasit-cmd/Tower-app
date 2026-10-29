// ========================
// MEMO (مذكرة)
// v335-C6r18 (N23): محرّر Word مدمج (نموذج واحد MemoDoc + MemoEditor)، معاينة وPDF متعدد الصفحات وWord من نفس النموذج.
// ========================
let editingMemoId = null;
// v335-C5r5: العدد "المعتمد" = الذي أكّده الخادم لهذه المذكرة (null = لم يُحدَّد بعد). لا يُعتمد في الطباعة/التصدير الرسمي إلا هو.
// حقل العدد قابل للتعديل: الفارغ في مذكرة جديدة = تلقائي (يحدده الخادم عند الحفظ ضمن قفل الترقيم)، وأي رقم مكتوب = طلب يدوي صريح.
// الرقم المقترح المعروض قبل الحفظ ليس حجزاً ولا يتحول إلى رقم يدوي إلا إذا كتبه المستخدم بنفسه.
let memoOfficialNumber = null;
let memoSuggestedNumber = null;
let memoArchiveStale = { stale: false, at: null };

// ---- N23: حالة المذكرة (نموذج MemoDoc) ----
let memoState = null;          // {mode:'legacy'|'v1', from, subject:{r}, body:[], table:{c}|null, after:[], closing:{r}, base:{…}}
let memoOrig = null;           // نصوص المذكرة القديمة كما جاءت (تُرسل كما هي إن لم تتغيّر → لا تغيير صامت)
let memoEdMap = {};            // area → Ed (subject/body/after/closing)
let memoCellEds = [];          // محرّرات خلايا الجدول
let memoBar = null;
let memoActiveCell = null;     // {r,c}
const memoMD = () => window.MemoDoc, memoME = () => window.MemoEditor;
const MEMO_ALL_FACES = [['SA', 400], ['SA', 700], ['TA', 400], ['PT', 400], ['TNR', 400], ['TNR', 700]];
let memoFacesDrawn = '';
let memoFontTimer = null;

function memoFlagTouched() { if (memoState) { memoState.touched = true; if (memoState.mode === 'legacy') memoState.mode = 'v1'; } }
function memoFontNote(html) { const el = document.getElementById('memoFontNote'); if (el) el.innerHTML = html || ''; }
function memoRedrawEditors() {
  const E = memoME(), act = E.getActive();
  Object.keys(memoEdMap).concat([]).forEach(k => { const ed = memoEdMap[k]; const s = (act === ed) ? ed.sel() : null; ed.draw(s ? s.s : undefined, s ? s.e : undefined); });
  memoCellEds.forEach(ed => { const s = (act === ed) ? ed.sel() : null; ed.draw(s ? s.s : undefined, s ? s.e : undefined); });
}
// يضمن تحميل خطوط ما هو مكتوب الآن (الفشل يُعرض صراحةً؛ لا خط بديل صامت). يُعاد الرسم عند وصول خط جديد.
function memoEnsureFonts() {
  if (!memoState) return Promise.resolve(true);
  const D = memoMD(), faces = D.neededFaces(memoState), key = faces.map(f => f.join(':')).join('|');
  return D.ensureFonts(faces).then(r => {
    if (!r.ok) { memoFontNote('<span style="color:#c0392b;font-weight:700">⚠️ تعذّر تحميل الخط: ' + r.failed.join('، ') + ' — لن يُنشأ PDF/معاينة بهذا الخط (ولن يُستبدل بخط آخر). تأكد من الاتصال مرة واحدة ثم أعد المحاولة.</span>'); return false; }
    memoFontNote('');
    if (key !== memoFacesDrawn) { memoFacesDrawn = key; memoRedrawEditors(); }
    return true;
  });
}
function memoScheduleFonts() { clearTimeout(memoFontTimer); memoFontTimer = setTimeout(memoEnsureFonts, 250); }
function memoOnChange() { memoScheduleFonts(); }

function memoDestroyEditors() {
  const E = memoME(); Object.keys(memoEdMap).forEach(k => memoEdMap[k].destroy()); memoEdMap = {};
  memoCellEds.forEach(e => e.destroy()); memoCellEds = [];
}
function memoMountEditors() {
  const E = memoME();
  memoDestroyEditors();
  const line = (id, area, key) => new E.Ed(document.getElementById(id), { area, single: true, getBase: () => memoState.base[area], getParas: () => [memoState[key]], setParas: ps => { memoState[key] = { r: ps[0].r }; }, onChange: memoOnChange });
  const rich = (id, area) => new E.Ed(document.getElementById(id), { area, single: false, getBase: () => memoState.base[area], getParas: () => memoState[area], setParas: ps => { memoState[area] = ps; }, onChange: memoOnChange });
  memoEdMap.subject = line('memo_subject_ed', 'subject', 'subject');
  memoEdMap.body = rich('memo_body_ed', 'body');
  memoEdMap.after = rich('memo_after_ed', 'after');
  memoEdMap.closing = line('memo_closing_ed', 'closing', 'closing');
  if (!memoBar) {
    memoBar = new E.Bar(document.getElementById('memoFmtBar'), {
      getState: () => memoState, touch: memoFlagTouched, changed: memoOnChange,
      editorsOf: area => (memoEdMap[area] ? [memoEdMap[area]] : []), tableCells: () => memoCellEds
    });
    E.setBar(memoBar);
    const note = document.createElement('div'); note.id = 'memoFontNote'; note.style.cssText = 'font-size:0.74rem;margin-top:4px;line-height:1.6'; document.getElementById('memoFmtBar').appendChild(note);
    document.getElementById('memo_from').addEventListener('input', () => { if (memoState) { memoState.from = document.getElementById('memo_from').value; if (memoState.from.trim()) memoFlagTouched(); } });
  }
  renderMemoTableEditor();
  memoFacesDrawn = ''; memoEnsureFonts();
  setTimeout(() => { memoMD().ensureFonts(MEMO_ALL_FACES.filter(f => f[0] !== 'TNR')).catch(() => {}); }, 4000);     // تخزين مسبق هادئ للخطوط العربية (TNR عند أول استخدام)
}
function memoSetState(st, orig) {
  memoState = st; memoOrig = orig || null;
  document.getElementById('memo_from').value = st.from || '';
  memoMountEditors();
}

// ---- الجدول ----
const memoCellText = c => memoMD().runsText(c.r).trim();
function addMemoTable() {
  if (!memoState) return;
  memoState.table = memoMD().plainToTable([['', ''], ['', '']]);
  renderMemoTableEditor();
}
function memoTablePopulated() { return memoState && memoState.table ? memoState.table.c.reduce((a, row) => a + row.filter(c => memoCellText(c) !== '').length, 0) : 0; }
async function removeMemoTable() {
  if (!memoState || !memoState.table) return;
  const D = memoMD(), filled = memoTablePopulated(), hasAfter = D.afterHasText(memoState);
  if (filled || hasAfter) {
    const msg = '🗑️ تأكيد حذف الجدول؟' + (filled ? ' يحتوي ' + filled + ' خلية مكتوبة ولا يمكن التراجع.' : '') + (hasAfter ? ' نص ما بعد الجدول لن يُحذف، سيُنقل إلى نهاية المتن.' : '');
    if (!confirm(msg)) return;
  }
  if (hasAfter) memoMoveAfterToBody();
  memoState.table = null; memoActiveCell = null;
  memoState.after = [{ r: [] }];
  renderMemoTableEditor();
  const ed = memoEdMap.body; if (ed) ed.draw();
  if (hasAfter) showToast('ℹ️ نُقل نص ما بعد الجدول إلى نهاية المتن (لم يُحذف)');
}
// يُلحق فقرات ما بعد الجدول بالمتن مع تثبيت مظهرها (أساس حقل ما بعد الجدول → تنسيق صريح على كل مقطع)
function memoMoveAfterToBody() {
  const D = memoMD(), bb = memoState.base.body, ab = memoState.base.after, moved = D.cleanParas(memoState.after);
  moved.forEach(p => { p.r = p.r.map(r => { const o = Object.assign({}, r); ['f', 's', 'b', 'i'].forEach(k => { if (o[k] == null && ab[k] !== bb[k]) o[k] = ab[k]; }); return o; }); });
  const body = memoState.body.slice();
  if (body.length === 1 && !body[0].r.length) body.length = 0;
  memoState.body = D.cleanParas(body.concat(moved));
  memoFlagTouched();
}
function addMemoTableRow() {
  if (!memoState || !memoState.table) return;
  const cols = memoState.table.c[0].length;
  memoState.table.c.push(Array.from({ length: cols }, () => ({ r: [] })));
  renderMemoTableEditor();
}
function addMemoTableCol() {
  if (!memoState || !memoState.table) return;
  memoState.table.c.forEach(row => row.push({ r: [] }));
  renderMemoTableEditor();
}
function deleteMemoTableRow() {
  const t = memoState && memoState.table; if (!t) return;
  if (!memoActiveCell) { showToast('اضغط داخل خلية من الصف المراد حذفه أولاً', 'error'); return; }
  if (t.c.length <= 1) { showToast('⚠️ هذا آخر صف — استخدم «حذف الجدول» لإزالة الجدول', 'error'); return; }
  const r = memoActiveCell.r, filled = t.c[r].filter(c => memoCellText(c) !== '').length;
  if (filled && !confirm('🗑️ حذف الصف ' + (r + 1) + '؟ يحتوي ' + filled + ' خلية مكتوبة ولا يمكن التراجع. بقية الخلايا تبقى كما هي.')) return;
  t.c.splice(r, 1); memoActiveCell = { r: Math.min(r, t.c.length - 1), c: memoActiveCell.c };
  renderMemoTableEditor();
}
function deleteMemoTableCol() {
  const t = memoState && memoState.table; if (!t) return;
  if (!memoActiveCell) { showToast('اضغط داخل خلية من العمود المراد حذفه أولاً', 'error'); return; }
  if (t.c[0].length <= 1) { showToast('⚠️ هذا آخر عمود — استخدم «حذف الجدول» لإزالة الجدول', 'error'); return; }
  const c = memoActiveCell.c, filled = t.c.filter(row => memoCellText(row[c]) !== '').length;
  if (filled && !confirm('🗑️ حذف العمود ' + (c + 1) + '؟ يحتوي ' + filled + ' خلية مكتوبة ولا يمكن التراجع. بقية الخلايا تبقى كما هي.')) return;
  t.c.forEach(row => row.splice(c, 1)); memoActiveCell = { r: memoActiveCell.r, c: Math.min(c, t.c[0].length - 1) };
  renderMemoTableEditor();
}
function memoMarkActiveCell() {
  const tbl = document.getElementById('memoTableEl'); if (!tbl) return;
  tbl.querySelectorAll('td').forEach(td => { td.classList.toggle('mc-row', !!memoActiveCell && +td.dataset.r === memoActiveCell.r); td.classList.toggle('mc-col', !!memoActiveCell && +td.dataset.c === memoActiveCell.c); });
  const hint = document.getElementById('memoCellHint');
  if (hint) hint.textContent = memoActiveCell ? 'الخلية المحدّدة: صف ' + (memoActiveCell.r + 1) + '، عمود ' + (memoActiveCell.c + 1) + ' — «حذف الصف/العمود» يحذف المظلَّل فقط.' : 'اضغط داخل خلية لتحديد الصف/العمود المراد حذفه (يظهر مظلَّلاً).';
}
function renderMemoTableEditor() {
  const wrap = document.getElementById('memoTableWrap'), addBtn = document.getElementById('memoAddTableBtn'), afterWrap = document.getElementById('memoAfterWrap');
  memoCellEds.forEach(e => e.destroy()); memoCellEds = [];
  const t = memoState && memoState.table;
  if (!t) { wrap.style.display = 'none'; addBtn.style.display = ''; if (afterWrap) afterWrap.style.display = 'none'; memoActiveCell = null; return; }
  addBtn.style.display = 'none'; wrap.style.display = 'block'; if (afterWrap) afterWrap.style.display = '';
  const E = memoME(), tbl = document.getElementById('memoTableEl'); tbl.textContent = '';
  t.c.forEach((row, r) => {
    const tr = document.createElement('tr');
    row.forEach((cell, c) => {
      const td = document.createElement('td'); td.style.cssText = 'border:1px solid #ddd;padding:2px'; td.dataset.r = r; td.dataset.c = c;
      const div = document.createElement('div'); div.className = 'memo-ed memo-cell'; td.appendChild(div); tr.appendChild(td);
      memoCellEds.push(new E.Ed(div, { area: 'table', single: true, row: r, col: c, getBase: () => memoState.base.table, getParas: () => [memoState.table.c[r][c]], setParas: ps => { memoState.table.c[r][c] = { r: ps[0].r }; }, onChange: memoOnChange, onActive: () => { memoActiveCell = { r, c }; memoMarkActiveCell(); } }));
    });
    tbl.appendChild(tr);
  });
  if (memoActiveCell && (memoActiveCell.r >= t.c.length || memoActiveCell.c >= t.c[0].length)) memoActiveCell = null;
  memoMarkActiveCell();
  if (memoBar) memoBar.refresh();
  memoScheduleFonts();
}

// ---- قسم المرفقات (اختياري) — قائمة أسطر تترقم تلقائياً عند العرض/التصدير ----
let memoAttachments = null; // مصفوفة نصوص اختيارية، null = لا يوجد قسم مرفقات

function addMemoAttachments() {
  memoAttachments = [''];
  renderMemoAttachmentsEditor();
}
function removeMemoAttachments() {
  memoAttachments = null;
  renderMemoAttachmentsEditor();
}
function addMemoAttachmentLine() {
  if (!memoAttachments) return;
  memoAttachments.push('');
  renderMemoAttachmentsEditor();
}
function removeMemoAttachmentLine(i) {
  if (!memoAttachments) return;
  memoAttachments.splice(i, 1);
  if (!memoAttachments.length) memoAttachments.push('');
  renderMemoAttachmentsEditor();
}
function updateMemoAttachmentLine(i, val) {
  if (memoAttachments) memoAttachments[i] = val;
}
function renderMemoAttachmentsEditor() {
  const wrap = document.getElementById('memoAttachmentsWrap');
  const addBtn = document.getElementById('memoAddAttachmentsBtn');
  if (!memoAttachments) {
    wrap.style.display = 'none';
    addBtn.style.display = '';
    return;
  }
  addBtn.style.display = 'none';
  wrap.style.display = 'block';
  const listWrap = document.getElementById('memoAttachmentsListWrap');
  listWrap.innerHTML = memoAttachments.map((line, i) => `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
      <span style="font-weight:700;min-width:18px">${i+1}.</span>
      <input type="text" value="${(line||'').replace(/"/g,'&quot;')}" oninput="updateMemoAttachmentLine(${i},this.value)" style="flex:1;padding:8px 10px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.9rem">
      <button class="btn-sm btn-del" onclick="removeMemoAttachmentLine(${i})">✕</button>
    </div>`).join('');
}

function showMemoHome() {
  document.getElementById('memoHomeView').style.display = 'block';
  document.getElementById('memoNewView').style.display = 'none';
  document.getElementById('memoArchiveView').style.display = 'none';
}

function memoDigits(v) {
  return String(v == null ? '' : v).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776)).trim();
}
// نيّة العدد من حقل الشاشة: {mode:'auto'|'manual'|'keep', number?, error?}
function memoNumberIntent() {
  const v = memoDigits(document.getElementById('memo_number').value);
  const existing = !!editingMemoId && memoOfficialNumber !== null;
  if (existing) {
    if (v === String(memoOfficialNumber)) return { mode: 'keep' };
    if (v === '') return { error: 'اكتب رقماً للمذكرة أو أعد رقمها الحالي ' + memoOfficialNumber };
  } else if (v === '') return { mode: 'auto' };
  if (!/^[1-9][0-9]{0,14}$/.test(v)) return { error: 'العدد أرقام فقط (بدون أصفار بادئة أو رموز)' };
  return { mode: 'manual', number: v };
}
function memoUpdateNumberHint() {
  const el = document.getElementById('memoNumberHint'); if (!el) return;
  const it = memoNumberIntent();
  let h = '';
  if (it.error) h = '<span style="color:#c0392b">⚠️ ' + it.error + '</span>';
  else if (it.mode === 'auto') h = '🔢 <b>تلقائي</b> — يُحدِّد الخادم العدد النهائي عند الحفظ' + (memoSuggestedNumber ? ' (المقترح الآن ' + memoSuggestedNumber + '، وليس محجوزاً)' : ' (يُحدَّد عند الاتصال)');
  else if (it.mode === 'manual') h = '✍️ <b>عدد يدوي صريح: ' + it.number + '</b> — يُحفظ كما هو إن كان متاحاً، وإلا يُرفض بدون تغيير أي عدد آخر ' + '<a href="#" onclick="memoSetAuto();return false" style="margin-right:8px">↺ تلقائي</a>';
  else h = '🔒 العدد الحالي <b>' + memoOfficialNumber + '</b> — يبقى كما هو مع تعديل المحتوى، غيّره هنا فقط إن أردت تغييراً صريحاً';
  el.style.color = '#4A5568'; el.innerHTML = h;
}
function memoSetAuto() { const f = document.getElementById('memo_number'); f.value = (editingMemoId && memoOfficialNumber !== null) ? String(memoOfficialNumber) : ''; memoUpdateNumberHint(); }
function memoSetStatus(html) { const el = document.getElementById('memoSaveStatus'); if (el) el.innerHTML = html || ''; }
function ensureMemoNumberUI() {
  const f = document.getElementById('memo_number');
  f.readOnly = false; f.setAttribute('inputmode', 'numeric'); f.setAttribute('autocomplete', 'off');
  f.oninput = memoUpdateNumberHint;
  if (!document.getElementById('memoNumberHint')) {
    const h = document.createElement('div'); h.id = 'memoNumberHint'; h.style.cssText = 'font-size:0.74rem;margin-top:4px;line-height:1.6';
    f.parentNode.appendChild(h);
  }
  if (!document.getElementById('memoSaveStatus')) {
    const st = document.createElement('div'); st.id = 'memoSaveStatus'; st.style.cssText = 'font-size:0.8rem;margin:8px 0';
    const actions = document.querySelector('#memoNewView .form-actions'); if (actions) actions.parentNode.insertBefore(st, actions);
  }
}
// العدد المسموح بظهوره في الطباعة/التصدير الرسمي: المعتمد من الخادم فقط (لا عدد مؤقت ولا مقترح ولا غير محفوظ)
function memoGuardOfficialOutput() {
  const v = memoDigits(document.getElementById('memo_number').value);
  if (memoOfficialNumber === null) { showToast('⚠️ العدد لم يُحدَّد بعد — احفظ المذكرة (والعدد يُحدَّد بالخادم عند توفر الاتصال) ثم اطبع/صدّر', 'error'); return false; }
  if (v !== String(memoOfficialNumber)) { showToast('⚠️ غيّرت العدد ولم يُحفظ التغيير بعد — احفظ أولاً ليُؤكَّد العدد', 'error'); return false; }
  return true;
}

async function showMemoNew() {
  pushLevel(showMemoHome);
  document.getElementById('memoHomeView').style.display = 'none';
  document.getElementById('memoNewView').style.display = 'block';
  document.getElementById('memoArchiveView').style.display = 'none';
  editingMemoId = null; memoOfficialNumber = null;       // «مذكرة جديدة» تبدأ مذكرة جديدة دائماً (سابقاً: يبقى معرّف التعديل السابق)
  document.getElementById('memo_date').value = new Date().toISOString().split('T')[0];
  ensureMemoNumberUI(); memoSetStatus('');
  document.getElementById('memo_number').value = '';
  document.getElementById('memo_to').value = 'الى / السيـد المـديـر الـمحتـرم...';
  document.getElementById('memo_sender_title').value = '';
  document.getElementById('memo_sender_name').value = '';
  memoActiveCell = null;
  memoSetState(memoMD().newState(), null);
  memoAttachments = null;
  renderMemoAttachmentsEditor();
  memoSuggestedNumber = null; memoUpdateNumberHint();
  memoSuggestedNumber = await generateNextMemoNumber();     // اقتراح فقط، يُعرض ولا يُحجز ولا يُملأ بالحقل
  if (!editingMemoId) memoUpdateNumberHint();
}

function showMemoArchive() {
  pushLevel(showMemoHome);
  document.getElementById('memoHomeView').style.display = 'none';
  document.getElementById('memoNewView').style.display = 'none';
  document.getElementById('memoArchiveView').style.display = 'block';
  renderMemoArchive();
}

// اقتراح العدد التالي (أعلى عدد صالح محفوظ + 1) — للعرض فقط وليس حجزاً. null عند أي فشل/أوفلاين (لا رقم وهمي).
async function generateNextMemoNumber() {
  try {
    const out = await csCall('app_memo_info');
    if (out && out.ok === true && out.next != null) return String(out.next);
  } catch (e) {}
  return null;
}

// يبني حمولة الحفظ: الأعمدة النصية (إسقاط نصي للبحث/الأرشيف/الإصدارات الأقدم) + layout المنظَّم عند الحاجة فقط.
function memoBuildPayload(intent) {
  const D = memoMD(), st = memoState;
  st.from = document.getElementById('memo_from').value;
  let content = D.parasPlain(st.body), subject = D.runsText(st.subject.r).replace(/\n/g, ' '), table = D.plainTableData(st);
  if (memoOrig) {                                 // مذكرة قديمة لم يتغيّر نصها: تُرسل النصوص الأصلية حرفياً
    const big = 1e7;
    if (memoOrig.content != null && D.cleanText(memoOrig.content, big) === content) content = memoOrig.content;
    if (memoOrig.subject != null && D.cleanText(memoOrig.subject, big).replace(/\n/g, ' ') === subject) subject = memoOrig.subject;
    const norm = t => JSON.stringify(Array.isArray(t) && t.length ? t.map(r => (r || []).map(c => D.cleanText(c == null ? '' : c, big))) : null);
    if (memoOrig.table_data !== undefined && norm(memoOrig.table_data) === JSON.stringify(table)) table = memoOrig.table_data || null;
  }
  const payload = {
    memo_date: document.getElementById('memo_date').value, memo_to: document.getElementById('memo_to').value, subject, content,
    sender_title: document.getElementById('memo_sender_title').value, sender_name: document.getElementById('memo_sender_name').value,
    table_data: table, attachments: memoAttachments, number_mode: intent.mode
  };
  if (st.mode === 'v1') payload.layout = D.layoutFromState(st);
  return payload;
}

async function saveMemo() {
  if (!memoState) return;
  const date = document.getElementById('memo_date').value;
  if (!date || !memoMD().parasPlain(memoState.body).trim()) { showToast('⚠️ اكمل التاريخ ومحتوى المذكرة', 'error'); return; }
  const intent = memoNumberIntent();
  if (intent.error) { showToast('⚠️ ' + intent.error, 'error'); memoUpdateNumberHint(); return; }
  const payload = memoBuildPayload(intent);
  if (payload.layout && JSON.stringify(payload.layout).length > 250000) { showToast('⚠️ المذكرة أطول من الحد المسموح للتنسيق (≈250 ألف حرف مع التنسيق) — اختصرها أو قسّمها', 'error'); return; }
  if (intent.mode === 'manual') payload.memo_number = intent.number;
  // القيم كاملة + الهوية + نيّة العدد تُحفظ على الجهاز أولاً؛ فشل الحفظ = لا إرسال وتبقى الحقول. الهوية الدائمة تُثبَّت فوراً (حفظ ثانٍ يدمج بنفس المذكرة).
  const sentDigits = memoDigits(document.getElementById('memo_number').value);
  let myRef = null;
  const r = await docqSubmit('memo', editingMemoId, payload, (ref) => { myRef = ref; editingMemoId = ref; });
  if (!r.ok) {
    memoSetStatus('<span style="color:#c0392b;font-weight:700">⛔ لم يُحفظ: ' + (r.reason === 'other_user' ? 'هذه المذكرة المعلّقة تخص مستخدماً آخر' : 'تعذّر الحفظ على الجهاز (الذاكرة ممتلئة)') + ' — لم يُرسل شيء وبقيت الحقول</span>');
    showToast(r.reason === 'other_user' ? '⛔ هذه المذكرة المعلّقة تخص مستخدماً آخر على هذا الجهاز' : '⛔ تعذّر الحفظ على الجهاز — لم يُرسل شيء وبقيت الحقول', 'error');
    return;
  }
  if (String(editingMemoId) !== String(myRef)) {          // انتقل المستخدم لمذكرة أخرى أثناء الانتظار: لا نلمس شاشته
    showToast(r.state === 'confirmed' ? '✅ تم حفظ المذكرة السابقة (مؤكَّدة بالخادم)' : (r.state === 'rejected' ? '⛔ رفض الخادم المذكرة السابقة — بصفحة المعلّقة للمراجعة' : '📱 حُفظت المذكرة السابقة على الجهاز فقط'), r.state === 'rejected' ? 'error' : undefined);
    return;
  }
  if (r.state === 'confirmed' && r.row) {
    memoOfficialNumber = r.row.memo_number == null ? '' : String(r.row.memo_number);
    if (memoDigits(document.getElementById('memo_number').value) === sentDigits) document.getElementById('memo_number').value = memoOfficialNumber;     // لم يغيّره المستخدم أثناء الإرسال
    memoSetStatus(docqStatusHTML('confirmed') + ' — العدد: <b>' + memoOfficialNumber + '</b>');
    showToast('✅ ' + (intent.mode === 'auto' ? 'تم حفظ المذكرة بالأرشيف — العدد ' + memoOfficialNumber : 'تم حفظ المذكرة بالأرشيف'));
  } else if (r.state === 'rejected') {
    memoSetStatus(docqStatusHTML('rejected', r.code));
    showToast('⛔ ' + (DOCQ_MSG[r.code] || r.code), 'error');
  } else {
    memoSetStatus(docqStatusHTML('pending') + (intent.mode === 'auto' ? ' — العدد يُحدَّد عند المزامنة' : ''));
    showToast('📱 حُفظت المذكرة على الجهاز فقط — لم تُؤكَّد بالخادم بعد');
  }
  memoUpdateNumberHint();
}

let memoArchiveCache = [];

function renderMemoCards(list) {
  const body = document.getElementById('memoArchiveBody');
  const banner = memoArchiveStale.stale ? docqStaleBanner(memoArchiveStale.at) : '';
  if (!list.length) { body.innerHTML = banner + '<div class="empty-state">لا توجد نتائج</div>'; return; }
  body.innerHTML = banner + list.map(m => {
    const preview = m.subject || (m.content || '').split('\n').map(l => l.trim()).filter(l => l)[0] || 'بدون عنوان';
    const num = (m._pending && m.number_mode === 'manual') ? (m.memo_number + ' (مطلوب)') : (m.memo_number || (m._pending === 'create' ? 'يُحدَّد عند المزامنة' : '—'));
    const badge = docqBadge(m);
    const canDel = !(m._pending === 'create' || docqIsLocal(m.id));
    return `
    <div class="dep-card" style="cursor:pointer" onclick="openMemoFromArchive('${m.id}')">
      <div class="dep-card-header">
        <div class="dep-card-title">📝 ${String(preview).replace(/</g, '&lt;')}</div>
        <div class="dep-card-meta">🔢 العدد: ${String(num).replace(/</g, '&lt;')} | 📅 ${m.memo_date} | 👤 ${String(m.created_by || '—').replace(/</g, '&lt;')}</div>
        ${badge ? '<div style="font-size:12px;margin-top:4px">' + badge + '</div>' : ''}
      </div>
      <div style="margin-top:8px">
        <button class="btn-sm btn-del" onclick="event.stopPropagation();deleteMemoFromArchive('${m.id}')">🗑️ حذف</button>
      </div>
    </div>`;
  }).join('');
}

function filterMemoArchive(q) {
  if (!q || !q.trim()) { renderMemoCards(memoArchiveCache); return; }
  const terms = q.trim().toLowerCase().split(/\s+/);
  const filtered = memoArchiveCache.filter(m => {
    const hay = [m.subject||'', m.content||'', m.memo_number||''].join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
  });
  renderMemoCards(filtered);
}

async function renderMemoArchive() {
  const body = document.getElementById('memoArchiveBody');
  body.innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  const searchInput = document.getElementById('memoSearchInput');
  if (searchInput) searchInput.value = '';
  let list, stale = false, at = null;
  try {
    const res = await sbFetch('memos?select=id,memo_number,memo_date,subject,content,created_by,client_uuid&order=memo_date.desc');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    list = await res.json();
    if (!Array.isArray(list)) throw new Error('bad');
    at = Date.now(); docqCachePut('memo', list, false);
  } catch (e) { const c = docqCacheGet('memo'); list = c.rows; stale = true; at = c.at; }     // بلا اتصال: آخر نسخة محفوظة على الجهاز (قديمة دائماً) + المعلّقة
  memoArchiveStale = { stale, at };
  memoArchiveCache = docqMerge('memo', list);
  if (!memoArchiveCache.length) { body.innerHTML = (stale ? docqStaleBanner(at) : '') + '<div class="empty-state">لا توجد مذكرات محفوظة بعد</div>'; return; }
  renderMemoCards(memoArchiveCache);
}

async function deleteMemoFromArchive(id) {
  const _m = memoArchiveCache.find(m => String(m.id) === String(id));
  if (docqIsLocal(id) || (_m && _m._pending === 'create')) { showToast('⚠️ هذه المذكرة لم تُؤكَّد بالخادم بعد: أكمل مزامنتها أو ألغِها من صفحة «المعلّقة»', 'error'); return; }
  if (!confirm('🗑️ تأكيد حذف هذه المذكرة من الأرشيف؟ هذا الإجراء لا يمكن التراجع عنه نهائيًا.')) return;
  try {
    const res = await sbFetch(`memos?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('فشل الحذف');
    showToast('✅ تم حذف المذكرة');
    memoArchiveCache = memoArchiveCache.filter(m => String(m.id) !== String(id));
    const q = document.getElementById('memoSearchInput');
    filterMemoArchive(q ? q.value : '');
  } catch (e) {
    showToast('❌ تعذر حذف المذكرة، تحقق من الاتصال', 'error');
  }
}

async function openMemoFromArchive(id) {
  try {
    const pend = docqEntries('memo').find(e => docqMatch(e, 'memo', id) && (!currentUser || String(e.uid) === String(currentUser.id)));
    let m = null, official = null, wantNumber = null;
    if (docqIsLocal(id)) {
      if (!pend) { showToast('❌ غير موجود', 'error'); return; }
      m = Object.assign({}, pend.payload, { id });
    } else {
      let base = null;
      try {
        const res = await sbFetch(`memos?id=eq.${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const list = await res.json();
        if (!Array.isArray(list)) throw new Error('bad');
        if (!list.length) { showToast('❌ غير موجود', 'error'); return; }
        base = list[0];
      } catch (e) {
        if (!pend) throw e;                       // بلا اتصال: تُفتح فقط المذكرة التي لها تعديل معلّق محفوظ كاملاً على الجهاز
        base = Object.assign({}, docqCacheGet('memo').rows.find(x => String(x.id) === String(id)) || { id });
      }
      m = Object.assign({}, base, pend ? pend.payload : {});     // حمولة قديمة بلا layout لا تمحو layout المخزَّن: يُصالَح نصها مع التنسيق (stateFromLayout)
      official = base.memo_number == null ? (base.memo_number === undefined ? null : '') : String(base.memo_number);
      if (pend && pend.payload.number_mode === 'manual') wantNumber = pend.payload.memo_number;
    }
    editingMemoId = docqIsLocal(id) ? id : (m.id != null ? m.id : id);
    memoOfficialNumber = official;
    document.getElementById('memoHomeView').style.display = 'none';
    document.getElementById('memoNewView').style.display = 'block';
    document.getElementById('memoArchiveView').style.display = 'none';
    ensureMemoNumberUI();
    const numberField = document.getElementById('memo_number');
    numberField.value = wantNumber != null ? String(wantNumber) : (pend && pend.payload.number_mode === 'manual' ? String(pend.payload.memo_number) : (official !== null ? official : ''));
    document.getElementById('memo_date').value = m.memo_date || '';
    document.getElementById('memo_to').value = m.memo_to || 'الى / السيـد المـديـر الـمحتـرم...';
    document.getElementById('memo_sender_title').value = m.sender_title || '';
    document.getElementById('memo_sender_name').value = m.sender_name || '';
    const D = memoMD();
    let st = m.layout ? D.stateFromLayout(m.layout, m) : null;
    if (!st) st = D.legacyState(m);
    memoActiveCell = null;
    memoSetState(st, st.mode === 'legacy' ? { content: m.content, subject: m.subject, table_data: m.table_data } : null);
    memoAttachments = m.attachments || null;
    renderMemoAttachmentsEditor();
    memoSetStatus(pend ? docqStatusHTML(pend.rejected ? 'rejected' : 'pending', pend.rejected && pend.rejected.code) : '');
    memoUpdateNumberHint();
    if (st.notes && st.notes.length) showToast('ℹ️ عُدِّل ' + st.notes.map(n => ({ body: 'المتن', subject: 'الموضوع', table: 'الجدول' }[n] || n)).join('، ') + ' من نسخة أقدم من التطبيق؛ أُعيد تنسيق هذه الأجزاء إلى الافتراضي وبقي غيرها', undefined);
    else showToast('📂 تم تحميل المذكرة، تكدر تعدّلها');
  } catch (e) { showToast('❌ تعذر الفتح', 'error'); }
}

// ---- المخرجات: نموذج واحد → معاينة / PDF / Word ----
function memoOutputState() {
  const D = memoMD(); const st = JSON.parse(JSON.stringify(memoState)); st.from = document.getElementById('memo_from').value || '';
  return st;
}
function memoHdr(official) {
  return {
    number: official ? (document.getElementById('memo_number').value || '') : '', date: document.getElementById('memo_date').value || '', to: document.getElementById('memo_to').value || '',
    from: (document.getElementById('memo_from').value || '').trim(), attachments: (memoAttachments || []).slice(), senderTitle: document.getElementById('memo_sender_title').value || '', senderName: document.getElementById('memo_sender_name').value || ''
  };
}
function memoFontFailMsg(e) { return '❌ تعذّر تحميل الخط (' + (e.failed || []).join('، ') + ') — لم يُنشأ الملف ولم يُستبدل الخط بآخر. اتصل بالإنترنت مرة واحدة وأعد المحاولة'; }

async function previewMemo() {
  if (!memoState) return;
  const official = memoOfficialNumber !== null && memoDigits(document.getElementById('memo_number').value) === String(memoOfficialNumber);
  showToast('⏳ جاري تحضير المعاينة...');
  try {
    const { canvases } = await memoMD().renderPages(memoOutputState(), memoHdr(official), 2);
    const ov = document.createElement('div'); ov.id = 'memoPreviewOv'; ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(20,24,32,.88);overflow:auto;-webkit-overflow-scrolling:touch;padding:12px';
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:10px;align-items:center;justify-content:space-between;color:#fff;margin-bottom:10px;font-size:0.85rem';
    const ttl = document.createElement('div'); ttl.textContent = 'معاينة — ' + canvases.length + ' صفحة (هي نفسها صفحات PDF)' + (official ? '' : ' — العدد غير معتمد بعد فلا يظهر');
    const x = document.createElement('button'); x.textContent = '✕ إغلاق'; x.style.cssText = 'padding:8px 14px;border:none;border-radius:8px;font-family:inherit;font-weight:700'; x.onclick = () => ov.remove();
    bar.append(ttl, x); ov.appendChild(bar);
    canvases.forEach((cv, i) => { cv.style.cssText = 'display:block;width:min(100%,560px);height:auto;margin:0 auto 12px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.4)'; cv.setAttribute('aria-label', 'صفحة ' + (i + 1)); ov.appendChild(cv); });
    const old = document.getElementById('memoPreviewOv'); if (old) old.remove();
    document.body.appendChild(ov);
  } catch (e) { showToast(e && e.code === 'FONT_FAIL' ? memoFontFailMsg(e) : '❌ تعذرت المعاينة: ' + (e && e.message ? e.message : 'خطأ غير معروف'), 'error'); }
}

async function exportMemoPDF() {
  if (!memoGuardOfficialOutput()) return;
  showToast('⏳ جاري تحضير ملف PDF...');
  try {
    const D = memoMD();
    const { canvases } = await D.renderPages(memoOutputState(), memoHdr(true), 3);
    await ensureJsPDFLoaded(); // Lazy load: يضمن اكتمال تحميل jsPDF قبل الاستخدام
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    const pageW = doc.internal.pageSize.getWidth(), w = 555, h = w * D.H / D.W;       // نفس هوامش PDF السابق (20pt) وعرض الصفحة 555pt
    canvases.forEach((cv, i) => { if (i) doc.addPage(); doc.addImage(cv.toDataURL('image/png'), 'PNG', (pageW - w) / 2, 20, w, h); });
    const blob = doc.output('blob');
    const filename = 'مذكرة_' + (document.getElementById('memo_date').value || '') + '.pdf';
    await shareOrDownloadFile(blob, filename, 'application/pdf');
    showToast('✅ تم تجهيز ملف PDF (' + canvases.length + ' صفحة، بدون أي نص زائد)');
  } catch (e) {
    showToast(e && e.code === 'FONT_FAIL' ? memoFontFailMsg(e) : '❌ تعذر تجهيز الملف: ' + (e && e.message ? e.message : 'خطأ غير معروف'), 'error');
  }
}

// ---- مكتبة docx الخاصة بالمذكرة: نسخة مثبّتة 9.7.1 (MIT) من ملف التطبيق نفسه، بلا شبكة وبفحص SHA-256 ----
// معزولة تماماً: تُنفَّذ داخل دالة فلا تلمس window.docx ولا ensureDocxLoaded (وهما لميزات أخرى تحمّل 8.5.0 من unpkg).
const MEMO_DOCX_URL = './vendor/docx-9.7.1.iife.js', MEMO_DOCX_SHA256 = 'd5ec4f5a8b99740845974f5f6f020d6e5b1b6c27026195befc67eb37035c84c7';
let _memoDocxP = null;
function memoLoadDocx() {
  if (_memoDocxP) return _memoDocxP;
  _memoDocxP = (async () => {
    const res = await fetch(MEMO_DOCX_URL); if (!res.ok) throw new Error('docx HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    if (window.crypto && crypto.subtle) { const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map(x => x.toString(16).padStart(2, '0')).join(''); if (h !== MEMO_DOCX_SHA256) throw new Error('docx hash mismatch'); }
    const lib = (new Function(new TextDecoder().decode(buf) + '\n;return docx;'))();
    if (!lib || !lib.Packer || !lib.Document) throw new Error('docx invalid');
    return lib;
  })().catch(e => { _memoDocxP = null; throw e; });
  return _memoDocxP;
}

// ملاحظة Word: أسماء الخطوط تُكتب كما هي في الملف ولا تُضمَّن به؛ تظهر بنفس الشكل فقط إذا كان الخط مثبّتاً على جهاز القارئ، وإلا يستبدله Word.
async function shareMemoWord() {
  if (!memoGuardOfficialOutput()) return;
  showToast('⏳ جاري تحضير ملف Word...');
  try {
    let lib; try { lib = await memoLoadDocx(); } catch (e) { throw new Error('LIB_MISSING'); }      // مكتبة docx مثبّتة ومعزولة لمسار المذكرة فقط
    const blob = await memoMD().buildDocxBlob(memoOutputState(), memoHdr(true), lib);
    const filename = 'مذكرة_' + (document.getElementById('memo_date').value || '') + '.docx';
    await shareOrDownloadFile(blob, filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    showToast('✅ تم تجهيز ملف Word — الخطوط بأسمائها (غير مضمَّنة): تظهر كما صُمِّمت فقط إن كانت مثبّتة عند فاتح الملف');
  } catch (e) {
    if (e && e.message === 'LIB_MISSING') {
      // فشل تحميل مكتبة Word (مشكلة اتصال بالإنترنت) — نستخدم نسخة احتياطية أبسط (كل نص مستخدم مُهرَّب)
      try {
        const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
          <head><meta charset="utf-8"><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
          </head><body>${memoMD().buildDocHtml(memoOutputState(), memoHdr(true))}</body></html>`;
        const blob = new Blob(['﻿', html], { type: 'application/msword' });
        const filename = 'مذكرة_' + (document.getElementById('memo_date').value || '') + '.doc';
        await shareOrDownloadFile(blob, filename, 'application/msword');
        showToast('⚠️ تم تجهيز نسخة احتياطية (تأكد من الإنترنت لجودة أفضل بالمرة القادمة)');
      } catch (e2) {
        showToast('❌ تعذر تجهيز الملف، تأكد من اتصال الإنترنت وحاول مرة ثانية', 'error');
      }
    } else {
      showToast('❌ تعذر تجهيز الملف: ' + (e && e.message ? e.message : 'خطأ غير معروف'), 'error');
    }
  }
}
