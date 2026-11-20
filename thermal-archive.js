/* thermal-archive.js — v335-C5r6 + N25-R23
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
// N25-R23a: حالة التحميل. أثناء طلب تحديث جارٍ لا طباعة ولا حذف، ولا يُعاد ملء filteredThermal من بيانات قديمة (حتى لو تغيّر الفلتر)؛ والردّ القديم المتأخر يُهمَل كلياً.
let _thLoadSeq = 0, _thBusy = false;
loadThermalArchive = async function loadThermalArchive() {
  const my = ++_thLoadSeq; _thBusy = true; filteredThermal = [];
  if (thermalArchiveUI) thermalArchiveUI.busy();
  let recs;
  try {
    recs = await fetchAllPages('thermal_inspections?select=*&order=inspection_date.desc,line_name.asc');
    if (my !== _thLoadSeq) return;                 // طلب أحدث بدأ بعد هذا: ردّ قديم، لا يلمس البيانات ولا الكاش ولا الإجراءات
    try { localStorage.setItem(THERMAL_DB_KEY, JSON.stringify(recs.slice(0, 200))); } catch (e) { try { localStorage.removeItem(THERMAL_DB_KEY); } catch (e2) {} }
  } catch (e) {
    if (my !== _thLoadSeq) return;
    try { recs = JSON.parse(localStorage.getItem(THERMAL_DB_KEY) || '[]'); } catch (e2) { recs = []; }
    showToast('⚠️ تعذر الاتصال، عرض بيانات محفوظة', 'error');
  }
  thermalRecords = recs; _thBusy = false;
  if (thermalArchiveUI) thermalArchiveUI.ready();
};
const TH_BUSY_MSG = '⏳ جارٍ تحديث الأرشيف — الطباعة والحذف الجماعي متوقفان حتى يكتمل التحميل؛ لم يُنفَّذ شيء';
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
  if (_thBusy) { showToast(TH_BUSY_MSG, 'error'); return; }   // N25-R23a
  if (_thPending.length) { showToast('⛔ لم يُثبَّت البرج المحدد بعد (' + _thPending.join('، ') + ') — راجع اللوحة أعلاه واعتمده صراحةً؛ لم يُحذف شيء', 'error'); return; }   // N25-R23: لا حذف عند نقص الإثبات
  const delRows = filteredThermal.slice(), delSeq = _thLoadSeq;   // N25-R23a: لقطة ما هو معروض وقت الضغط
  const n = delRows.length;
  if (!n) { showToast('⚠️ لا توجد نتائج مطابقة للفلتر الحالي', 'error'); return; }
  if (!confirm(`🗑️ تأكيد حذف ${n} نشاط كشف حراري مطابق للفلتر الحالي؟ هذا الإجراء لا يمكن التراجع عنه نهائيًا.`)) return;
  if (_thBusy || delSeq !== _thLoadSeq) { showToast(TH_BUSY_MSG, 'error'); return; }   // بدأ تحديث أثناء التأكيد: لا نحذف صفوفاً قد لا تكون معروضة
  showToast('⏳ جاري الحذف...');
  const lines = [...new Set(delRows.map(r => r.line_name).filter(Boolean))];
  let success = 0;
  for (const r of delRows) {
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
  if (_thBusy) { showToast(TH_BUSY_MSG, 'error'); return; }   // N25-R23a
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
// ===== N25-R23: هوية برج مرشّح الرقم تُثبَّت عند الاختيار من دليل متماسك، ولا تُعاد حلّ الرقم لاحقاً =====
// _thPin = { raw, lines:{ خط: {rev, tids:Set} }, held:{ خط:true } }
//  • مرشّح برج مكتوب والخط بلا هوية متماسكة (دليل لم يصل/غير متاح) ⇒ held: المدخل محفوظ، لا صفوف لذلك الخط، ولا يُوسَّع إلى كل الخط.
//  • وصول الدليل لاحقاً (أو تغيّر الترقيم) لا يُحوّل المدخل المحجوز إلى «صاحب الرقم الجديد» تلقائياً: لوحة مراجعة + اعتماد صريح (thConfirmPin).
//  • مرشّح كُتب والهوية متماسكة لحظتها ⇒ يُثبَّت فوراً بـtower_id (والمطابقة بعدها بالهوية لا بالرقم، حتى لو تغيّر الترقيم).
let _thPin = null, _thPending = [], _thReviewLines = [];
function thTowerList() {
  const raw = (document.getElementById('thFilterTower') || { value: '' }).value.trim();
  return { raw, list: raw ? raw.split(',').map(t => t.trim()).filter(Boolean) : [] };
}
function thPinLine(line, list, p) {            // يثبّت هوية الأبراج المكتوبة للخط من حالته المتماسكة الآن؛ false إن لم تكن متماسكة
  const st = csIdentState(line), tids = new Set();
  if (st === 'map') { const m = csMap(line); list.forEach(n => { const t = m.byNum[String(n)]; if (t) tids.add(String(t)); }); p.lines[line] = { rev: m.rev, tids, zero: false }; return true; }
  if (st === 'zero') {
    const d = csDirGet(line); if (d && d.byNum) list.forEach(n => { const t = d.byNum[String(n)]; if (t) tids.add(String(t)); });
    thermalRecords.forEach(r => { if (r.line_name === line && r.tower_id && list.includes(String(r.tower_number))) tids.add(String(r.tower_id)); });
    p.lines[line] = { rev: 0, tids, zero: true }; return true;
  }
  return false;
}
function thRowMatches(r, list) {
  const pl = _thPin && _thPin.lines[r.line_name]; if (!pl) return false;
  if (r.tower_id && pl.tids.has(String(r.tower_id))) return true;
  return pl.zero && csIsZero(r.line_name) && !r.tower_id && r.tower_number != null && list.includes(String(r.tower_number));   // صفر مثبَت فقط والصف بلا هوية: المسار القديم بالرقم
}
function thConfirmPin(i) {
  const line = _thReviewLines[i], tl = thTowerList(); if (!line || !tl.list.length || !_thPin || _thPin.raw !== tl.raw) return;
  if (!thPinLine(line, tl.list, _thPin)) { showToast('⚠️ دليل الأبراج غير متاح الآن — لا يمكن اعتماد البرج', 'error'); return; }
  delete _thPin.held[line]; renderThermalArchive();
}
// تجميع اليوم: التواريخ تنازلياً، وداخل كل يوم الخطوط بترتيب القائمة (400 ثم 132) — يُستعمل في العرض والـPDF معاً
function thermalGroups(rows) {
  const byDate = {};
  rows.forEach(r => { (byDate[r.inspection_date] = byDate[r.inspection_date] || {}); (byDate[r.inspection_date][r.line_name] = byDate[r.inspection_date][r.line_name] || []).push(r); });
  return Object.keys(byDate).sort((a, b) => b.localeCompare(a)).map(date => ({ date, lines: sortLineNames(Object.keys(byDate[date])).map(line => ({ line, rows: byDate[date][line].slice().sort((a, b) => (a.tower_number || 0) - (b.tower_number || 0)) })) }));
}
function renderThermalArchive() {
  if (_thBusy) { filteredThermal = []; const b0 = document.getElementById('thermalArchiveBody'); if (b0) b0.innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>'; return; }   // N25-R23a
  const lineFilter = document.getElementById('thFilterLine').value;
  const dateFrom = document.getElementById('thFilterDateFrom').value;
  const dateTo = document.getElementById('thFilterDateTo').value;
  const { raw: towerFilterRaw, list: towerList } = thTowerList();

  // N25-R23: تثبيت الهوية. تغيّر نص المرشّح = اختيار جديد (يُعاد التقييم من الدليل المتماسك الحالي)؛ بدون تغيّر لا يُعاد حلّ الرقم.
  if (!towerList.length) _thPin = null;
  else if (!_thPin || _thPin.raw !== towerFilterRaw) _thPin = { raw: towerFilterRaw, lines: {}, held: {} };
  _thPending = []; _thReviewLines = [];
  const scopeLines = towerList.length ? [...new Set(thermalRecords.filter(r => (!lineFilter || r.line_name === lineFilter) && r.line_name).map(r => r.line_name))] : [];
  const nodirLines = [], reviewLines = [];
  scopeLines.forEach(l => {
    if (_thPin.lines[l]) return;
    if (csIdentState(l) === 'unavailable') { _thPin.held[l] = true; nodirLines.push(l); return; }
    if (_thPin.held[l]) { reviewLines.push(l); return; }      // كُتب المدخل قبل إثبات الهوية، وقد وصل الدليل الآن: لا اختيار تلقائي
    thPinLine(l, towerList, _thPin);
  });
  _thPending = nodirLines.concat(reviewLines); _thReviewLines = reviewLines.slice();

  filteredThermal = thermalRecords.filter(r => {
    const mLine = !lineFilter || r.line_name === lineFilter;
    const mFrom = !dateFrom || (r.inspection_date && r.inspection_date >= dateFrom);
    const mTo = !dateTo || (r.inspection_date && r.inspection_date <= dateTo);
    const mTower = !towerList.length || thRowMatches(r, towerList);   // بلا هوية مثبتة ⇒ لا مطابقة (لا توسيع إلى كل الخط ولا ربط بصاحب الرقم الجديد)
    return mLine && mFrom && mTo && mTower;
  });

  const bulkBtn = document.getElementById('thermalBulkDeleteBtn');
  if (bulkBtn) bulkBtn.style.display = (currentUser.role==='admin') ? '' : 'none';

  const body = document.getElementById('thermalArchiveBody');
  let unavHtml = '';
  if (nodirLines.length) unavHtml += '<div id="thTowerHeld" class="empty-state" style="background:#FFFAF0;color:#7B341E;border-radius:8px;padding:10px;margin-bottom:8px" role="alert">⚠️ ' + escapeHtml(CS_IDENT_UNAVAILABLE_TEXT) + ' — المدخل «' + escapeHtml(towerFilterRaw) + '» محفوظ ولم يُطبَّق على: ' + nodirLines.map(escapeHtml).join('، ') + '. عند وصول الدليل ستُطلب منك مراجعة الاختيار وتأكيده صراحةً قبل عرض/طباعة نتائج برج محدد.</div>';
  if (reviewLines.length) unavHtml += '<div id="thTowerReview" class="empty-state" style="background:#FFF5F5;color:#742A2A;border-radius:8px;padding:10px;margin-bottom:8px;text-align:right" role="alert">⛔ وصل دليل الأبراج بعد كتابة المدخل «' + escapeHtml(towerFilterRaw) + '» (قد يكون الترقيم تغيّر) — لم يُحدَّد أي برج تلقائياً ولا تُعرض/تُطبع نتائج برج محدد قبل اعتماد صريح:' + reviewLines.map((l, i) => {
    const m = csMap(l), z = csIsZero(l), d = csDirGet(l);
    const what = towerList.map(n => { const tid = m ? m.byNum[String(n)] : (d && d.byNum ? d.byNum[String(n)] : null); const cnt = tid ? thermalRecords.filter(r => r.line_name === l && String(r.tower_id) === String(tid)).length : 0; return 'رقم ' + escapeHtml(n) + ' ← ' + (tid ? 'البرج الفعّال حالياً بهذا الرقم (' + cnt + ' قياس)' : 'لا برج فعّال بهذا الرقم'); }).join('، ');
    return '<div style="margin-top:6px"><b>' + escapeHtml(l) + '</b> (نسخة الترقيم ' + (m ? m.rev : 0) + '): ' + what + ' <button class="btn-sm btn-primary thPinConfirm" onclick="thConfirmPin(' + i + ')">اعتماد الترقيم الحالي لهذا الخط</button></div>'; }).join('') + '</div>';
  { const ch = Object.keys(_thPin ? _thPin.lines : {}).filter(l => _thPin.lines[l].rev !== csKnownRev(l)); if (ch.length) unavHtml += '<div id="thTowerChanged" class="empty-state" style="background:#EBF8FF;color:#2A4365;border-radius:8px;padding:10px;margin-bottom:8px" role="status">ℹ️ تغيّر ترقيم الخط (' + ch.map(escapeHtml).join('، ') + ') بعد تثبيت اختيارك: المعروض هو البرج نفسه الذي اخترته أصلاً (هويته)، وقد يختلف رقمه الحالي — انظر ملاحظة «رقمه الحالي» في كل صف.</div>'; }
  if (!filteredThermal.length) { body.innerHTML = unavHtml + '<div class="empty-state">لا توجد قياسات</div>'; return; }

  const groups = thermalGroups(filteredThermal);
  let html = '';
  groups.forEach(g => {
    html += `<div class="thermal-archive-group"><div class="thermal-date-header">📅 ${g.date}</div>`;
    g.lines.forEach(({ line, rows }) => {
      const ambient = rows[0].ambient_temp ?? '—';
      html += `<div class="thermal-line-header"><span>📡 ${line}</span><span>🌤️ حرارة الجو: ${ambient}°C — عدد النقاط: ${rows.length}</span></div>`;
      html += `<table class="thermal-points-table"><thead><tr>
        <th>النقطة</th><th>R1</th><th>R2</th><th>S1</th><th>S2</th><th>T1</th><th>T2</th><th>الموظف</th><th></th>
      </tr></thead><tbody>`;
      rows.forEach(r => {
        const flag = isHotRecord(r) ? '<span class="hot-flag">🔴 </span>' : '';
        html += `<tr>
          <td>${flag}${r.point_label||''}${(function(){ const n = csRowNote(r); return n ? '<div style="font-size:0.7rem;color:#7B341E">' + escapeHtml(n) + '</div>' : ''; })()}</td>
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
  body.innerHTML = unavHtml + html;
}

// ربط واجهة الأرشيف بجالب البيانات الدائم في index.html (loadThermalArchive): نفس التسلسل الأصلي بالضبط
thermalArchiveUI = {
  busy() {
    const body = document.getElementById('thermalArchiveBody');
    body.innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  },
  ready() {
    const lineSel = document.getElementById('thFilterLine');
    const uniqueLines = sortLineNames([...new Set(thermalRecords.map(r => r.line_name).filter(Boolean))]);   // N25-R6s
    const currentVal = lineSel.value;
    lineSel.innerHTML = '<option value="">-- كل الخطوط --</option>' + uniqueLines.map(n => `<option value="${n}">${n}</option>`).join('');
    if (uniqueLines.includes(currentVal)) lineSel.value = currentVal;
    renderThermalArchive();
    try { csDirsEnsure(uniqueLines).then(() => { if (document.getElementById('thermalArchiveBody')) renderThermalArchive(); }); } catch (e) {}   // N25-R5: ملاحظات الهوية بعد وصول دليل الأبراج
  }
};
(window.__thermalModules = window.__thermalModules || {}).archive = true;
