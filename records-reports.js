
// كاش خاص بالتقارير (لا يوجد كاش عام مسبق للاستمارات الرسمية بالتطبيق)
let reportThermalFormsCache = [];
async function loadReportThermalForms() {
  try {
    reportThermalFormsCache = await fetchAllPages('thermal_official_forms?select=id,line_name,inspection_date,created_by,rows&order=inspection_date.desc');
  } catch (e) { reportThermalFormsCache = []; }
}

let _reportLineNames = [];   // v335-C6r7: أسماء الخطوط من الخادم (بلا قراءة حالة)

// v335-C6r8: بيانات التقرير الثانوية (المعالجات / استمارات الحراري الرسمية / القراءات الحرارية الخام).
// كل طلب مرتبط بنطاق ثابت مُلتقَط عند البدء (خطوط/تواريخ/أنواع) وبهوية الجلسة الحالية (جيل المصادقة + الرمز + المستخدم + عصر المسح).
// يُرجع reportEnsureAux حزمة مُصدَّقة لنطاقها {ok, failed, stale, scope, rows:{treat,forms,raw}}؛ المستهلك يستعمل الحزمة لا الخانة العامة.
// الخانة العامة _reportAux كاش فقط: لا تُكتب إلا من ردّ جلسة سليمة وهو أحدث طلب بدأ لتلك الخانة، وتُمسح عند مسح بيانات المستخدم.
// الحالة: null = لم تُحمَّل، {ok:true, rows} = حُمّلت (قد تكون فارغة فعلاً)، {ok:false} = فشلت. الفشل لا يُعرض صفراً.
let _reportAux = { treat: null, forms: null, raw: null };
const _reportAuxTicket = { treat: 0, forms: 0, raw: 0 };
let _reportCountSeq = 0, _reportTowersSeq = 0, _reportExportSeq = 0;
const REPORT_AUX_TTL = 120000;
function reportPurgeDerived() {
  reportInvalidateAux();
  _reportLineNames = [];
  _reportBasis = { kind: 'historical', stale: false, liveOff: false };
}
function _reportSess() { return { gen: _csAuthGen, tok: CS_AUTH.token, uid: currentUser ? String(currentUser.id) : null, epoch: _reportEpoch }; }
function _reportSessOk(s) { return !!s && s.gen === _csAuthGen && s.tok === CS_AUTH.token && s.epoch === _reportEpoch && !!currentUser && String(currentUser.id) === s.uid; }
function _reportAuxScopeKey(lines, from, to) { return (lines ? lines.slice().sort().join('|') : '*') + '#' + (from || '') + '#' + (to || ''); }
// بصمة كل مرشّحات التقرير الحالية (خطوط/تواريخ/أنواع/تصنيفات/نمط الأبراج): تغيّرها أثناء الانتظار = ردّ لنطاق آخر
function reportScopeSig() {
  const mode = (document.querySelector('input[name="repTowersMode"]:checked') || {}).value || 'all';
  return JSON.stringify([getReportSelectedLines(), document.getElementById('repFrom').value, document.getElementById('repTo').value, getReportSelectedTypes(), getReportSelectedCategories(), mode,
    document.getElementById('repTowerFrom').value, document.getElementById('repTowerTo').value, mode === 'specific' ? Array.from(document.querySelectorAll('.repTowerChk:checked')).map(b => b.value) : null]);
}
function reportCaptureScope() {
  return Object.freeze({ lines: getReportSelectedLines(), from: document.getElementById('repFrom').value, to: document.getElementById('repTo').value, types: getReportSelectedTypes(), sig: reportScopeSig(), listSig: reportListSig(), sess: _reportSess() });
}
// بصمة قائمة الأبراج: الخطوط + التواريخ + الأنواع فقط (اختيار الأبراج نفسه لا يعيد بناء القائمة)
function reportListSig() { return JSON.stringify([getReportSelectedLines(), document.getElementById('repFrom').value, document.getElementById('repTo').value, getReportSelectedTypes()]); }
async function _reportAuxFetch(table, extra, dateCol, lines, from, to) {
  // thermal_official_forms: the server allow-list (40_data_access) permits no line/date filter on this table, so it is read whole (only when the thermal type is selected) and scoped on the client by getReportFilteredThermalForms
  if (table === 'thermal_official_forms') { lines = null; from = ''; to = ''; }
  const out = [];
  const parts = [];
  if (from) parts.push(`${dateCol}=gte.${from}`);
  if (to) parts.push(`${dateCol}=lte.${to}`);
  if (extra) parts.push(extra);
  const tail = parts.length ? '&' + parts.join('&') : '';
  const targets = lines && lines.length ? lines : [null];
  for (const ln of targets) {
    const q = `${table}?select=${table === 'thermal_official_forms' ? 'id,line_name,inspection_date,created_by,rows' : '*'}` + (ln ? `&line_name=eq.${encodeURIComponent(ln)}` : '') + tail;
    (await fetchAllPages(q)).forEach(r => out.push(r));
  }
  return out;
}
// يضمن تحميل ما تحتاجه الأنواع المختارة لنطاق مُلتقَط. stale=true: انتهت الجلسة/المسح أثناء الانتظار (النتيجة لا تُستهلك).
async function reportEnsureAux(types, force, scope) {
  scope = scope || reportCaptureScope();
  const { lines, from, to, sess } = scope;
  const key = _reportAuxScopeKey(lines, from, to);
  const failed = []; const rows = { treat: [], forms: [], raw: [] };
  const run = async (slot, fn) => {
    const c = _reportAux[slot];
    if (!force && c && c.ok && c.key === key && (Date.now() - c.at) <= REPORT_AUX_TTL) { rows[slot] = c.rows; return true; }
    const my = ++_reportAuxTicket[slot];
    let res;
    try { res = { ok: true, key, at: Date.now(), rows: await fn() }; } catch (e) { res = { ok: false, key, at: Date.now(), rows: [] }; }
    if (!_reportSessOk(sess)) return null;                                    // جلسة/مسح تغيّر: لا يُكتب شيء
    if (my === _reportAuxTicket[slot]) _reportAux[slot] = res;               // الأحدث بدءاً فقط يملأ الكاش
    rows[slot] = res.rows;
    return res.ok;
  };
  let stale = false;
  if (types.includes('treatment')) {
    const r = await run('treat', async () => { const out = await _reportAuxFetch('treatments', 'order=created_at.desc', 'treatment_date', lines, from, to); if (csLiveEnabled() && !(await _reportEnsureMarks(force))) throw new Error('report_marks_unavailable'); return out; });
    if (r === null) stale = true; else if (!r) failed.push('treatment');
  }
  if (!stale && types.includes('thermal')) {
    const r1 = await run('forms', () => _reportAuxFetch('thermal_official_forms', 'order=inspection_date.desc', 'inspection_date', lines, from, to));
    const r2 = r1 === null ? null : await run('raw', () => _reportAuxFetch('thermal_inspections', 'point_type=eq.tower&order=inspection_date.desc', 'inspection_date', lines, from, to));
    if (r1 === null || r2 === null) stale = true; else if (!r1 || !r2) failed.push('thermal');
  }
  if (!_reportSessOk(sess)) stale = true;
  return { ok: !failed.length && !stale, failed, stale, scope, rows };
}
// جلسة + نطاق + تذكرة تصدير ما زالت هي الحالية (يُستدعى بعد كل انتظار وقبل الإخراج مباشرة)
function reportExportValid(scope, seq) { return seq === _reportExportSeq && reportScopeCurrent(scope); }
function reportScopeChangedText() { return '⚠️ تغيّرت المرشّحات أو الجلسة أثناء تجهيز التقرير — لم يُصدَّر شيء، أعد التصدير'; }
function reportAuxText(failed) {
  const names = { treatment: 'المعالجات', thermal: 'الكشف الحراري' };
  return '⚠️ تعذّر تحميل ' + failed.map(f => names[f] || f).join(' و') + ' — لا يُعرض صفراً ولا يُصدَّر تقرير ناقص';
}
// ردّ ما زال صالحاً لهذا النطاق: الجلسة نفسها والمرشّحات لم تتغيّر
function reportScopeCurrent(scope, listOnly) { return !!scope && _reportSessOk(scope.sess) && (listOnly ? reportListSig() === scope.listSig : reportScopeSig() === scope.sig); }
// يُبطل كاش التقارير الثانوي (بعد حذف/تعديل) ويمنع أي طلب جارٍ من إعادة ملئه
function reportInvalidateAux() { _reportAux = { treat: null, forms: null, raw: null }; Object.keys(_reportAuxTicket).forEach(k => { _reportAuxTicket[k]++; }); }
// v335-C6r7: الدخول = الهيكل + الخيارات + أسماء الخطوط فقط. المعالجات والاستمارات الحرارية والأرشيف الحراري والكشوفات لا تُقرأ هنا؛
// تُجلب عند حاجة التقرير/الإجراء المحدد وبنطاقه (reportEnsureAux / fetchInspectionsForReport).
async function openReportsPage() {
  reportInvalidateAux();
  await (csLiveEnabled() ? csLineNames().then(r => { if (r && r.ok) _reportLineNames = r.lines.slice(); }) : loadFullRecordsCache(true)).catch(()=>{});

  const lineSet = new Set();
  (fullRecordsCache||[]).forEach(r => { if (r.line_name) lineSet.add(r.line_name); });
  if (csLiveEnabled()) { _reportLineNames.forEach(n => lineSet.add(n)); Object.keys(LINES_DATA || {}).forEach(n => lineSet.add(n)); }
  const uniqueLines = [...lineSet].sort((a,b) => a.localeCompare(b, 'ar'));
  const linesWrap = document.getElementById('repLinesWrap');
  linesWrap.innerHTML = uniqueLines.map(n => `
    <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:2px 0">
      <input type="checkbox" class="repLineChk" value="${n.replace(/"/g,'&quot;')}" onchange="onReportLinesPick()">
      <span>${n}</span>
    </label>`).join('');
  document.getElementById('repLinesAll').checked = true;
  linesWrap.style.display = 'none';

  document.getElementById('repFrom').value = '';
  document.getElementById('repTo').value = '';
  document.querySelector('input[name="repTowersMode"][value="all"]').checked = true;
  document.getElementById('repTowerFrom').value = '';
  document.getElementById('repTowerTo').value = '';
  document.getElementById('repCategoryAll').checked = true;
  document.querySelectorAll('.repCatChk').forEach(cb => { cb.checked = false; cb.disabled = true; });
  // حماية: لو تغيّرت بنية أزرار اختيار الأبراج مستقبلاً، لا نُسقط تهيئة الصفحة كلها
  const allTowersRadio = document.querySelector('input[name="repTowersMode"][value="all"]');
  if (allTowersRadio) allTowersRadio.checked = true;
  // الدخول لا يحسب عدداً ولا يقرأ بيانات: يُحسب عند أول تغيير مرشّح أو إجراء
  document.getElementById('repTowersRangeWrap').style.display = 'none';
  document.getElementById('repTowersSpecificWrap').style.display = 'none';
  document.getElementById('repResultCount').textContent = 'ℹ️ اختر الخطوط/الأنواع — يُحسب العدد وتُقرأ البيانات عند التغيير أو عند التصدير';
}

function onReportCategoryAllToggle() {
  const allChecked = document.getElementById('repCategoryAll').checked;
  document.querySelectorAll('.repCatChk').forEach(cb => { cb.disabled = allChecked; if (allChecked) cb.checked = false; });
  updateReportResultCount();
}
function onReportCategoryPick() {
  const anyChecked = Array.from(document.querySelectorAll('.repCatChk')).some(cb => cb.checked);
  if (anyChecked) document.getElementById('repCategoryAll').checked = false;
  else document.getElementById('repCategoryAll').checked = true;
  document.querySelectorAll('.repCatChk').forEach(cb => cb.disabled = !anyChecked && document.getElementById('repCategoryAll').checked);
  updateReportResultCount();
}
// null = بدون تصفية تصنيف (كل الأبراج)
function getReportSelectedCategories() {
  if (document.getElementById('repCategoryAll').checked) return null;
  const picked = Array.from(document.querySelectorAll('.repCatChk:checked')).map(cb => cb.value);
  return picked.length ? picked : null;
}

function onReportLinesAllToggle() {
  const allChecked = document.getElementById('repLinesAll').checked;
  document.getElementById('repLinesWrap').style.display = allChecked ? 'none' : 'grid';
  if (allChecked) document.querySelectorAll('.repLineChk').forEach(cb => cb.checked = false);
  onReportFilterChange();
}
function onReportLinesPick() {
  const anyChecked = Array.from(document.querySelectorAll('.repLineChk')).some(cb => cb.checked);
  document.getElementById('repLinesAll').checked = !anyChecked;
  onReportFilterChange();
}
// null = بدون تصفية (كل الخطوط)
function getReportSelectedLines() {
  if (document.getElementById('repLinesAll').checked) return null;
  const picked = Array.from(document.querySelectorAll('.repLineChk:checked')).map(cb => cb.value);
  return picked.length ? picked : null;
}

function onReportTowersModeChange() {
  const mode = document.querySelector('input[name="repTowersMode"]:checked').value;
  document.getElementById('repTowersRangeWrap').style.display = mode === 'range' ? 'grid' : 'none';
  document.getElementById('repTowersSpecificWrap').style.display = mode === 'specific' ? '' : 'none';
  if (mode === 'specific') updateReportTowersList();
  updateReportResultCount();
}

function getReportSelectedTypes() {
  return Array.from(document.querySelectorAll('.repTypeChk:checked')).map(cb => cb.value);
}

// يرجّع كل أرقام الأبراج المتاحة ضمن فلتر الخط/التاريخ/النوع الحالي (بدون فلتر الأبراج نفسه) — لبناء قائمة "أبراج معينة"
// يجلب الكشوفات المطلوبة للتقارير مباشرة من السيرفر بفلترة الخط والتاريخ — بدل الاعتماد على كاش
// شامل محمَّل مسبقاً. هذا يعني حجم الطلب محدود بالفترة المختارة فقط، لا يكبر مع تراكم البيانات.
// v335-C4: أساس التقرير. بلا تاريخ (من/إلى فارغان) = "الحالة الحالية" من الحالة الحيّة المعتمدة (نفس fullRecordsCache + طبقة العمليات المعلّقة المحلية، بلا حاسبة حالة ثانية).
// بتاريخ = "تاريخي": كشوفات الفترة كما سُجّلت (جدول inspections) ولا تعكس المعالجات اللاحقة. الأصل في قاعدة البيانات لا يُلمس أبداً: الإلغاء الكامل إخفاء فقط.
let _reportBasis = { kind: 'historical', stale: false, liveOff: false };
function reportBasisText(ascii, basis) {
  const b = basis || _reportBasis;
  if (ascii) return b.kind === 'current' ? ('Basis: CURRENT state (after treatments)' + (b.stale ? ' - MAY BE STALE (refresh failed)' : '')) : ('Basis: HISTORICAL (inspections as recorded; later treatments not reflected)' + (b.liveOff ? ' - live state off' : ''));
  return b.kind === 'current'
    ? '📍 الأساس: الحالة الحالية (بعد المعالجات)' + (b.stale ? ' — ⚠️ قد تكون قديمة: تعذّر التحديث الحيّ' : '')
    : '🕘 الأساس: تاريخي — الكشوفات كما سُجّلت بالفترة (لا تعكس المعالجات اللاحقة)' + (b.liveOff ? ' — الحالة الحيّة غير مفعّلة' : '');
}
// علامات الإلغاء الكامل: إن تعذّر الحصول عليها حديثاً (والحالة الحيّة مفعّلة) لا نعرض تقريراً كاملاً بلا تصفية
async function _reportEnsureMarks(force) {
  if (!csLiveEnabled()) return true;
  if (!force && _opsMarks.ok && (Date.now() - _opsMarks.at) < 20000) return true;
  const t0 = Date.now();
  try { await opsLoadMarks(); } catch (e) {}
  return !!(_opsMarks.ok && _opsMarks.at >= t0);
}
// v335-C6r7: التقرير الحالي يقرأ نطاقه فقط (الخطوط المحددة، أو كل الخطوط عند التقرير الشامل الصريح) بقراءة تفصيلية وحداثة لكل خط؛
// نجاح النقل لا يعني اكتمال التغطية: برج غير مهيّأ/قيد الإصلاح داخل النطاق يمنع تقريراً «حالياً» كاملاً (PDF/Excel/أعداد) بسبب واضح، وخط غير ذي صلة خارج النطاق لا يمنعه.
function reportCoverageError(cov) {
  const e = new Error('report_coverage_incomplete'); e.coverage = cov; return e;
}
function reportErrorText(e) {
  const m = String(e && e.message);
  if (m === 'report_coverage_incomplete') {
    const c = e.coverage || {};
    return '⚠️ التقرير الحالي غير مكتمل التغطية: ' + csCoverageText(c) +
      ((c.incomplete || []).length ? ' — الخطوط: ' + c.incomplete.slice(0, 4).join('، ') + (c.incomplete.length > 4 ? '…' : '') : '') + ' — لا يُصدَّر تقرير حالي ناقص. يمكن إصدار تقرير تاريخي لنفس الفترة.';
  }
  if (m === 'report_current_unavailable') return '⚠️ تعذّر تحميل الحالة الحالية — لن يُنشأ تقرير غير مكتمل';
  return '⚠️ تعذّر التحقق من الكشوفات الملغاة — لن يُنشأ تقرير غير مُصفّى';
}
async function fetchInspectionsForReport(lines, from, to, force, out) {
  if (!(await _reportEnsureMarks(force))) throw new Error('report_marks_unavailable');
  let rows, basisNow = null;
  if (!from && !to && csLiveEnabled()) {
    const t0 = Date.now();
    const scope = lines && lines.length ? lines.slice() : null;
    // v335-C6r7: تماسك الملخّص/التفصيل. بعد القراءة كل صف بمعرّف ضمن النطاق يجب أن يكون تفصيلياً (ملاحظات/دورات من نفس إصدار الملخّص).
    // خط فقد تفصيله (ملخّص بإصدار أحدث / ردّ أقدم أُهمل / ختم أُبطل) يُعاد قراءته تفصيلاً مرة واحدة بالقوة، وإلا لا تقرير حالي.
    let sres = null, names = [], cov = null, scopeRows = [], lacking = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const only = attempt > 0 ? lacking : scope;
      try { sres = await csLoadScope(only, attempt > 0 ? true : !!force, 'detail'); } catch (e) { sres = null; }
      if (sres && (sres.aborted || sres.stale)) throw new Error('report_current_unavailable');
      if (attempt === 0) names = sres && sres.lines && sres.lines.length ? sres.lines : (scope || []);
      cov = csScopeCoverage(names, 'detail');
      scopeRows = (fullRecordsCache || []).filter(r => r && (!lines || lines.includes(r.line_name)));
      lacking = names.filter(ln => cov.unread.includes(ln) || scopeRows.some(r => r.line_name === ln && hasValidInspectionId(r.id) && !_rowHasDetail(r)));
      if (!lacking.length) break;
    }
    if (!names.length || lacking.length) throw new Error('report_current_unavailable');          // خط من النطاق بلا تفصيل متماسك: لا أساس حالياً
    const fresh = !!sres && sres.ok && names.every(ln => (loadedLineDetailAt[ln] || 0) >= t0 - (force ? 0 : 120000)) && !_cacheUnresolved;
    if (cov.incomplete.length) throw reportCoverageError(cov);
    _reportBasis = { kind: 'current', stale: !fresh, liveOff: false, coverage: cov, lines: names };
    basisNow = _reportBasis;
    rows = scopeRows;
  } else {
    _reportBasis = { kind: 'historical', stale: false, liveOff: !from && !to };
    basisNow = _reportBasis;
    if (!from && !to && !lines) {
      rows = await fetchAllPages('inspections?select=*&order=created_at.desc');
    } else {
      let query = 'inspections?select=*&order=created_at.desc';
      if (from) query += `&inspection_date=gte.${from}`;
      if (to) query += `&inspection_date=lte.${to}`;
      if (lines && lines.length === 1) query += `&line_name=eq.${encodeURIComponent(lines[0])}`;
      rows = await fetchAllPages(query);
      if (lines && lines.length > 1) rows = rows.filter(r => lines.includes(r.line_name));
    }
  }
  if (out && typeof out === 'object') out.basis = basisNow;   // v335-C6r8c: أساس هذه القراءة نفسها (لا المتغيّر العام المشترك)
  return rows.filter(r => !(csLiveEnabled() && opsIsVoided(r.id))).map(r => Object.assign({}, r, { _basis: basisNow }));   // إلغاء كامل = إخفاء (الأصل باقٍ في قاعدة البيانات)
}
// يُرجع المصفوفة أو null بعد تنبيه صريح (لا تقرير كامل غير مُصفّى بصمت)
async function reportLoadInspections(types, force, out) {
  try {
    if (!(await _reportEnsureMarks(force))) throw new Error('report_marks_unavailable');
    return types.includes('inspection') ? await getReportFilteredInspections(force, out) : [];
  } catch (e) {
    showToast(reportErrorText(e), 'error');
    return null;
  }
}


// ---- v335-C4: عرض حالة المكوّن في التقارير (لا حاسبة حالة ثانية) ----
// التقرير الحالي: يُستعمل حكم الخادم المخزَّن عند الاستيعاب (condition/data_status/applicability) + طبقة المعلّقات المحلية (opsPendingObserved / csPendingTreated).
// التقرير التاريخي: لا يُستعمل أي حكم «اليوم»؛ الفارغ/المفقود = «غير مسجَّل» لا «سليم».
// v335-C6r8c: صف التقرير يحمل أساسه المُلتقَط (_basis)؛ الأساس العام المشترك احتياط فقط
function reportIsCurrent(r) { const b = (r && r._basis) || _reportBasis; return !!b && b.kind === 'current'; }
function reportAuthComp(r, key) {
  if (!reportIsCurrent(r) || !r || typeof csComps !== 'function') return null;
  const info = csComps(r.line_name, r.tower_number);
  if (!info || info.sid == null || String(info.sid) !== String(r.id)) return null;   // الحكم يخصّ صف المصدر الحالي نفسه فقط
  return { comp: info.byK[key] || null, complete: !!info.complete };
}
function reportPendObserved(r, key) { try { return !!opsPendingObserved(r.id, key); } catch (e) { return false; } }
function reportPendTreated(r, key) { try { const p = csPendingTreated(r.id); return !!(p && p.has(key)); } catch (e) { return false; } }
// 'defect' | 'treated' | 'healthy' | 'unknown' | 'invalid' | 'na'
function reportTextStatus(r, key, text) {
  const t = (text == null ? '' : String(text)).trim();
  if (reportIsCurrent(r)) {
    const po = reportPendObserved(r, key);
    if (!po) {
      const a = reportAuthComp(r, key);
      if (a && a.comp) {
        const c = a.comp;
        if (c.ap === 'not_applicable') return 'na';
        if (c.ds === 'invalid') return 'invalid';
        if (c.ds !== 'known') return 'unknown';
        if (c.cond === 'treated') return 'treated';
        if (c.cond === 'defect') return reportPendTreated(r, key) ? 'treated' : 'defect';
        if (c.cond === 'ok') return 'healthy';   // تعداد الخادم الفعلي: ok/defect/treated/unknown (لا يُغيَّر؛ يُترجَم هنا لعرض التقرير فقط)
        return 'unknown';
      }
      if (a && a.complete && !a.comp) return 'unknown';
    }
    if (t !== '' && reportPendTreated(r, key)) return 'treated';
  }
  if (t === '') return 'unknown';
  return t === 'سليم' ? 'healthy' : 'defect';
}
// مرحلة عوازل لفيز: 'damaged' | 'healthy' | 'treated' | 'unknown' | 'invalid' | 'na' (+ arr)
function reportPhaseInfo(r, circuit, ph) {
  const key = (circuit === 2 ? 'ins2_' : 'ins_') + ph;
  const st = safeParseJSON(circuit === 2 ? r.insulator_state_2 : r.insulator_state);
  const arr = st && typeof st === 'object' && Array.isArray(st[ph]) ? st[ph] : null;
  const shape = !arr || !arr.length ? 'unknown' : (opsIsBoolArr(arr) ? 'ok' : 'invalid');
  let comp = null;
  if (reportIsCurrent(r) && !reportPendObserved(r, key)) { const a = reportAuthComp(r, key); comp = a && a.comp; }
  if (comp) {
    if (comp.ap === 'not_applicable') return { st: 'na' };
    if (comp.ds === 'invalid') return { st: 'invalid' };
    if (comp.ds !== 'known' || shape !== 'ok') return { st: shape === 'invalid' ? 'invalid' : 'unknown' };
    if (arr.some(Boolean)) return { st: 'damaged', arr };
    if (comp.cond === 'treated' || comp.cond === 'defect') return { st: 'treated', arr };
    return comp.cond === 'ok' ? { st: 'healthy', arr } : { st: 'unknown' };   // defect بلا ضرر متبقٍ في الصف = معالجة معلّقة محلياً
  }
  if (shape !== 'ok') return { st: shape };
  if (arr.some(Boolean)) return { st: 'damaged', arr };
  if (reportIsCurrent(r) && reportPendTreated(r, key)) return { st: 'treated', arr };
  return { st: 'healthy', arr };
}
function reportCircuitInsEval(r, circuit, label) {
  const phases = ['R', 'S', 'T'].map(ph => Object.assign({ ph }, reportPhaseInfo(r, circuit, ph)));
  const dmg = phases.filter(p => p.st === 'damaged'), bad = phases.filter(p => p.st === 'unknown' || p.st === 'invalid');
  const trt = phases.filter(p => p.st === 'treated'), na = phases.filter(p => p.st === 'na');
  const lines = [];
  if (bad.length) lines.push(`${label}: بيانات الفيز ${bad.map(p => p.ph).join('، ')} ${bad.some(p => p.st === 'invalid') ? 'غير صالحة' : 'غير معروفة/غير مسجَّلة'} — لا تُعدّ سليمة`);
  if (trt.length) lines.push(`${label}: ✔ تمت المعالجة (الفيز ${trt.map(p => p.ph).join('، ')})` + (dmg.length ? ' — ويتبقى ضرر بفيز آخر (في الصورة)' : ' — لا ضرر متبقٍ'));
  if (!dmg.length && !bad.length && !trt.length) lines.push(na.length === 3 ? `${label}: غير منطبق` : `${label}: سليمة (لا يوجد ضرر مسجّل)`);
  let stateJSON = null;
  if (dmg.length) { const o = {}; phases.forEach(p => { o[p.ph] = p.arr && (p.st === 'damaged' || p.st === 'healthy' || p.st === 'treated') ? p.arr : []; }); stateJSON = JSON.stringify(o); }
  return { damaged: dmg.length > 0, lines, stateJSON };
}
const REPORT_CELL_KEYS = {
  'تقاطعات الحديد': ['iron', 'iron_intersections'], 'قواعد البرج': ['foundation', 'tower_foundations'], 'ملحقات البرج': ['attachment', 'tower_attachments'],
  'أسلاك R': ['wire_r1', 'wires_r1'], 'أسلاك S': ['wire_s1', 'wires_s1'], 'أسلاك T': ['wire_t1', 'wires_t1'],
  'أسلاك R (الدائرة الثانية)': ['wire_r1_c2', 'wires_r1_c2'], 'أسلاك S (الدائرة الثانية)': ['wire_s1_c2', 'wires_s1_c2'], 'أسلاك T (الدائرة الثانية)': ['wire_t1_c2', 'wires_t1_c2'],
  'الأرضي 1': ['ground_1', 'ground_1'], 'الأرضي 2': ['ground_2', 'ground_2'], 'مسببات الحرائق': ['fire', null]
};
const REPORT_INS_COLS = { 'عوازل الدائرة الأولى R': [1, 'R'], 'عوازل الدائرة الأولى S': [1, 'S'], 'عوازل الدائرة الأولى T': [1, 'T'], 'عوازل الدائرة الثانية R': [2, 'R'], 'عوازل الدائرة الثانية S': [2, 'S'], 'عوازل الدائرة الثانية T': [2, 'T'] };
function reportFireText(r) { const n = (r.fire_causes_notes == null ? '' : String(r.fire_causes_notes)).trim(); return n || (r.sev_fire ? 'مسبب مسجَّل بدرجة خطورة' : ''); }
// خلية Excel لتقرير الكشف: عوازل (حالياً وتاريخياً: لا «سليم» للمجهول)، ونصوص (الحالي فقط: معالَج/غير معروف/غير منطبق)
function reportCell(c, r) {
  const ins = REPORT_INS_COLS[c.label];
  if (ins) {
    if (ins[0] === 2 && !isDoubleCircuitLine(r.line_name, r.insulator_state_2)) return '';
    const pi = reportPhaseInfo(r, ins[0], ins[1]);
    return ({ na: 'غير منطبق', invalid: 'بيانات غير صالحة', unknown: 'غير معروف / غير مسجَّل', healthy: 'سليم', treated: '✔ تمت المعالجة (لا ضرر متبقٍ)' })[pi.st] || c.get(r);
  }
  const m = REPORT_CELL_KEYS[c.label];
  if (m && reportIsCurrent(r)) {
    const raw = m[0] === 'fire' ? reportFireText(r) : r[m[1]];
    const t = (raw == null ? '' : String(raw)).trim();
    const st = reportTextStatus(r, m[0], raw);
    if (st === 'na') return 'غير منطبق';
    if (st === 'invalid') return 'بيانات غير صالحة';
    if (st === 'unknown') return 'غير مسجَّل / غير معروف';
    if (st === 'treated') return '✔ تمت المعالجة' + (t && t !== 'سليم' ? ' (الوصف الأصلي: ' + t + ')' : '');
    if (st === 'healthy') return 'سليم';
  }
  return c.get(r);
}

// v335-C6r8: يرجع null إن تغيّر النطاق/الجلسة أثناء الانتظار (ردّ قديم لا يُستهلك)
async function getReportAvailableTowers(scope) {
  scope = scope || reportCaptureScope();
  const { lines, from, to, types } = scope;
  const towers = new Set();
  const aux = await reportEnsureAux(types, false, scope);
  if (aux.stale || !reportScopeCurrent(scope, true)) return null;
  if (!aux.ok) showToast(reportAuxText(aux.failed), 'error');
  if (types.includes('inspection')) {
    let rows;
    try { rows = await fetchInspectionsForReport(lines, from, to); }
    catch (e) { showToast(String(e && e.message) === 'report_coverage_incomplete' ? reportErrorText(e) : '⚠️ تعذّر تحميل قائمة الأبراج (الحالة/الإلغاءات غير متاحة)', 'error'); rows = []; }
    rows.forEach(r => { if (r.tower_number != null) towers.add(String(r.tower_number)); });
  }
  if (types.includes('treatment')) {
    (aux.rows.treat || []).forEach(t => {
      if (!opsIsVoided(t.id) && (!lines || lines.includes(t.line_name)) && (!from || (t.treatment_date||'') >= from) && (!to || (t.treatment_date||'') <= to) && t.tower_number != null) {
        towers.add(String(t.tower_number));
      }
    });
  }
  if (types.includes('thermal')) {
    (aux.rows.forms || []).forEach(f => {
      if (lines && !lines.includes(f.line_name)) return;
      if (from && (f.inspection_date||'') < from) return;
      if (to && (f.inspection_date||'') > to) return;
      (Array.isArray(f.rows) ? f.rows : []).forEach(row => { if (row.tower_number) towers.add(String(row.tower_number)); });
    });
    // القراءات الخام أيضاً — بدونها ما تظهر بقائمة الاختيار الأبراج اللي إلها قراءة ميدانية بس
    (aux.rows.raw || []).forEach(r => {
      if (r.point_type !== 'tower') return;
      if (lines && !lines.includes(r.line_name)) return;
      if (from && (r.inspection_date||'') < from) return;
      if (to && (r.inspection_date||'') > to) return;
      if (r.tower_number != null) towers.add(String(r.tower_number));
    });
  }
  if (!reportScopeCurrent(scope, true)) return null;
  return [...towers].sort((a,b) => (parseInt(a)||0) - (parseInt(b)||0) || a.localeCompare(b));
}

async function updateReportTowersList() {
  const wrap = document.getElementById('repTowersWrap');
  wrap.innerHTML = '<div style="font-size:0.8rem;color:#718096;grid-column:1/-1">⏳ جاري التحميل...</div>';
  const mySeq = ++_reportTowersSeq;
  const towers = await getReportAvailableTowers(reportCaptureScope());
  if (towers === null || mySeq !== _reportTowersSeq) return;   // v335-C6r8: ردّ لنطاق/جلسة قديمة لا يكتب القائمة
  if (!towers.length) { wrap.innerHTML = '<div style="font-size:0.8rem;color:#718096;grid-column:1/-1">لا توجد أبراج مطابقة</div>'; return; }
  wrap.innerHTML = towers.map(tn => `
    <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:2px 0">
      <input type="checkbox" class="repTowerChk" value="${tn}" checked onchange="updateReportResultCount()">
      <span>برج ${tn}</span>
    </label>`).join('');
}
function toggleAllReportTowers() {
  const boxes = document.querySelectorAll('.repTowerChk');
  if (!boxes.length) return;
  const allChecked = Array.from(boxes).every(b => b.checked);
  boxes.forEach(b => b.checked = !allChecked);
  updateReportResultCount();
}

// دالة تحقق موحّدة: هل رقم برج معيّن يمر فلتر الأبراج الحالي (كل / نطاق / معيّنة)؟
function reportTowerPasses(towerNumber) {
  const mode = document.querySelector('input[name="repTowersMode"]:checked').value;
  if (mode === 'all') return true;
  if (mode === 'range') {
    const from = parseFloat(document.getElementById('repTowerFrom').value);
    const to = parseFloat(document.getElementById('repTowerTo').value);
    const n = parseFloat(towerNumber);
    if (isNaN(n)) return false;
    if (!isNaN(from) && n < from) return false;
    if (!isNaN(to) && n > to) return false;
    return true;
  }
  // specific
  const selected = new Set(Array.from(document.querySelectorAll('.repTowerChk:checked')).map(b => b.value));
  return selected.has(String(towerNumber));
}

function onReportFilterChange() {
  if (document.querySelector('input[name="repTowersMode"]:checked').value === 'specific') updateReportTowersList();
  updateReportResultCount();
}

const isIssueSev = s => !!(s && s !== 'ok');

function treatmentMatchesCategories(t, categories) {
  if (!categories) return true;
  const items = t.items_treated || [];
  return categories.some(cat => {
    const prefixes = REPORT_CATEGORY_TREATMENT_PREFIXES[cat] || [];
    return items.some(it => prefixes.some(p => (it.key||'').startsWith(p) || (it.key||'') === p));
  });
}

// لو نفس البرج انسجّل أكثر من مرة بنفس التاريخ (تعديل متكرر أثناء نفس جلسة الكشف مثلاً)، نبقي آخر
// تسجيل فقط (الأحدث حسب created_at) — بدون هذا كان يظهر نفس البرج مكرر بالتقرير عدة مرات
function dedupeLatestPerTowerDate(rows, dateField) {
  const map = new Map();
  rows.forEach(r => {
    const key = r.line_name + '||' + r.tower_number + '||' + (r[dateField] || '');
    const existing = map.get(key);
    if (!existing || (r.created_at || '') > (existing.created_at || '')) map.set(key, r);
  });
  return [...map.values()];
}

async function getReportFilteredInspections(force, out) {
  const lines = getReportSelectedLines(); // null = كل الخطوط
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  const rows = await fetchInspectionsForReport(lines, from, to, force, out);
  const base = rows.filter(r => reportTowerPasses(r.tower_number));
  // ملاحظة مهمة: لا نفلتر بالتصنيف هنا — كل برج مطابق للخط/التاريخ/نطاق الأبراج يظهر بالتقرير دائماً،
  // والتصنيف المختار يتحكم بس بشنو المعلومات تُعرض بكل بطاقة (سليم أو تفاصيل الضرر) — راجع buildReportInspectionCardCanvas
  return sortByLineThenTower(dedupeLatestPerTowerDate(base, 'inspection_date'), 'tower_number');
}
function getReportFilteredTreatments(auxRows) {
  const lines = getReportSelectedLines();
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  const categories = getReportSelectedCategories();
  const base = (auxRows || []).filter(t =>
    !(csLiveEnabled() && opsIsVoided(t.id)) &&   // v335-C4: إلغاء كامل فقط؛ الإلغاء الجزئي لا يُخفي المعالجة كلها
    (!lines || lines.includes(t.line_name)) &&
    (!from || (t.treatment_date||'') >= from) &&
    (!to || (t.treatment_date||'') <= to) &&
    reportTowerPasses(t.tower_number)
  );
  const latest = dedupeLatestPerTowerDate(base, 'treatment_date');
  return sortByLineThenTower(latest.filter(t => treatmentMatchesCategories(t, categories)), 'tower_number');
}
function getReportFilteredThermalForms(auxRows) {
  const lines = getReportSelectedLines();
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  // التصنيف يُتجاهل هنا (متفق عليه) — الكشف الحراري بيانات حرارة بس، ماله علاقة بقواعد/حديد/عوازل
  // فلتر الأبراج يُطبَّق على مستوى الصفوف داخل كل استمارة (استمارة واحدة تغطي عدة أبراج)
  return (auxRows || [])
    .filter(f => (!lines || lines.includes(f.line_name)) && (!from || (f.inspection_date||'') >= from) && (!to || (f.inspection_date||'') <= to))
    .map(f => ({
      ...f,
      rows: (Array.isArray(f.rows) ? f.rows : [])
        .filter(row => row.tower_number && reportTowerPasses(row.tower_number))
        .sort((a,b) => (parseInt(a.tower_number)||0) - (parseInt(b.tower_number)||0))
    }))
    .filter(f => f.rows.length);
}

// القراءات الحرارية الخام (من شاشة "كشف حراري ← جديد") — مصدر منفصل عن الاستمارات الرسمية
function getReportFilteredThermalRaw(auxRows) {
  const lines = getReportSelectedLines();
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  return (auxRows || []).filter(r =>
    r.point_type === 'tower' &&
    (!lines || lines.includes(r.line_name)) &&
    (!from || (r.inspection_date||'') >= from) &&
    (!to || (r.inspection_date||'') <= to) &&
    reportTowerPasses(r.tower_number)
  );
}

// حد الحرارة المرتفعة الخاص بملاحظات هذا التقرير (منفصل عمداً عن HOT_THRESHOLD العام المستخدم بشاشة أرشيف الكشف الحراري)
const REPORT_HOT_THRESHOLD = 80;
const IRAQI_MONTH_NAMES = ['كانون الثاني','شباط','آذار','نيسان','أيار','حزيران','تموز','آب','أيلول','تشرين الأول','تشرين الثاني','كانون الأول'];
function monthNameFromDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return IRAQI_MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
}

// يبني كل ملاحظات الكشف الحراري الخاصة ببرج معيّن (من القراءات الخام + صفوف الاستمارات الرسمية)
function getThermalNotesForTower(lineName, towerNumber, thermalRaw, thermalForms) {
  const notes = [];
  thermalRaw.forEach(r => {
    if (r.line_name !== lineName || String(r.tower_number) !== String(towerNumber)) return;
    const phases = [['R', [r.r1, r.r2]], ['S', [r.s1, r.s2]], ['T', [r.t1, r.t2]]];
    let hot = [];
    phases.forEach(([p, vals]) => {
      vals.forEach(v => { if (v != null && parseFloat(v) >= REPORT_HOT_THRESHOLD) hot.push(`⚠️ بتاريخ ${r.inspection_date}، وجود ارتفاع حرارة على الفيز ${p} بمقدار ${v}°`); });
    });
    if (hot.length) notes.push(...hot);
    else notes.push(`✅ هذا البرج تم كشفه حرارياً بتاريخ ${r.inspection_date} والنتيجة سليم`);
  });
  thermalForms.forEach(f => {
    if (f.line_name !== lineName) return;
    (f.rows||[]).forEach(row => {
      if (String(row.tower_number) !== String(towerNumber)) return;
      const phases = [['R', row.r], ['S', row.s], ['T', row.t]];
      let hot = [];
      phases.forEach(([p, v]) => { if (v != null && parseFloat(v) >= REPORT_HOT_THRESHOLD) hot.push(`⚠️ بتاريخ ${f.inspection_date}، وجود ارتفاع حرارة على الفيز ${p} بمقدار ${v}°`); });
      if (hot.length) notes.push(...hot);
      else notes.push(`📄 هذا البرج مذكور باستمارة الكشف الحراري الرسمية لشهر ${monthNameFromDate(f.inspection_date)}`);
    });
  });
  return notes;
}

// بطاقة ملاحظات الكشف الحراري لبرج معيّن — نص فقط، بنفس أسلوب باقي بطاقات التقرير
async function buildThermalNotesCardCanvas(lineName, towerNumber, notes) {
  const CARD_W = 760, PAD = 18;
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  mctx.font = '13px Tahoma, Arial, sans-serif';
  const wrapped = [];
  notes.forEach(line => wrapArabicText(mctx, line, CARD_W - PAD*2).forEach(l => wrapped.push(l)));

  const headerH = 40;
  const bodyH = wrapped.length * 18 + 10;
  const totalH = headerH + bodyH + PAD;
  const scale = 1.3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(CARD_W * scale);
  canvas.height = Math.ceil(totalH * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CARD_W, totalH);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';

  let y = PAD + 12;
  ctx.fillStyle = '#1A2A46';
  ctx.font = 'bold 14px Tahoma, Arial, sans-serif';
  ctx.fillText(`الخط: ${lineName||'-'}   |   برج: ${towerNumber||'-'}   |   🌡️ الكشف الحراري`, CARD_W - PAD, y);
  y += 18;
  ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(CARD_W - PAD, y); ctx.stroke();
  y += 20;

  ctx.font = '13px Tahoma, Arial, sans-serif';
  ctx.fillStyle = '#3C3C3C';
  wrapped.forEach(line => { ctx.fillText(line, CARD_W - PAD, y); y += 18; });

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.5), w: CARD_W, h: totalH };
}

async function updateReportResultCount() {
  // v335-C6r8: النطاق والجلسة مُلتقَطان عند البدء؛ ردّ قديم (نطاق آخر/طلب أحدث/جلسة منتهية) لا يكتب العدد ولا يُظهر فشله.
  const scope = reportCaptureScope(); const types = scope.types; const mySeq = ++_reportCountSeq;
  const mine = () => mySeq === _reportCountSeq && reportScopeCurrent(scope);
  const el = document.getElementById('repResultCount');
  el.textContent = '⏳ جاري الحساب...';
  let parts = [];
  const aux = await reportEnsureAux(types, false, scope);
  if (aux.stale || !mine()) return;
  if (types.includes('inspection')) {
    try { const n = (await getReportFilteredInspections()).length; if (!mine()) return; parts.push(`📋 كشف: ${n} — ${reportBasisText(false)}`); }
    catch (e) { if (!mine()) return; parts.push(String(e && e.message) === 'report_coverage_incomplete' ? reportErrorText(e) : '⚠️ تعذّر تحميل الكشوفات (الحالة الحالية/الإلغاءات غير متاحة)'); }
  }
  if (types.includes('treatment')) parts.push(aux.failed.includes('treatment') ? '🔧 معالجة: ⚠️ تعذّر التحميل' : `🔧 معالجة: ${getReportFilteredTreatments(aux.rows.treat).length}`);
  if (types.includes('thermal') && aux.failed.includes('thermal')) parts.push('🌡️ كشف حراري: ⚠️ تعذّر التحميل');
  else if (types.includes('thermal')) {
    // نحسب عدد الأبراج المشمولة (من المصدرين معاً: القراءات الخام + صفوف الاستمارات الرسمية)
    // بدل عدد الاستمارات — لأن التقرير صار يعرض ملاحظة لكل برج لا جدول لكل استمارة
    const towers = new Set();
    getReportFilteredThermalRaw(aux.rows.raw).forEach(r => towers.add(r.line_name + '||' + r.tower_number));
    getReportFilteredThermalForms(aux.rows.forms).forEach(f => (f.rows||[]).forEach(row => towers.add(f.line_name + '||' + row.tower_number)));
    parts.push(`🌡️ كشف حراري: ${towers.size} برج`);
  }
  if (!mine()) return;
  el.textContent = parts.length ? parts.join(' | ') : 'اختر نوع بيانات واحد على الأقل';
}

// بطاقة كشف واحدة (كانفاس) — تعرض بس التصنيفات المختارة (أو كل شي لو "الكل")
// يحمّل صورة (Image) من data URL جاهز — بديل بسيط لا يحتاج تحويل SVG (svgStringToImageEl مخصصة لنصوص SVG فقط)
function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function buildReportInspectionCardCanvas(r, categories) {
  const CARD_W = 760, PAD = 18;
  const lines = [];
  // نفس تسميات درجات الخطورة المستخدمة بالاستمارة بالضبط — تُذكر قرب كل عنصر متضرر
  const SEV_LABELS = { critical: 'حرجة', moderate: 'متوسطة', simple: 'بسيطة', below_critical: 'دون الحرجة' };
  // كل تصنيف مختار يظهر دائماً — لو ما فيه ضرر يكتب "سليم"، لو فيه يكتب التفاصيل + درجة الخطورة.
  // بدون هذا، كان البرج السليم يختفي كلياً من التقرير المصنَّف بدل ما يظهر ويوضَّح إنه سليم.
  const addCat = (label, text, sevCode, key) => {
    const st = reportTextStatus(r, key, text);
    const t = (text == null ? '' : String(text)).trim();
    if (st === 'na') lines.push(`${label}: غير منطبق`);
    else if (st === 'invalid') lines.push(`${label}: بيانات غير صالحة — لا تُعتمد`);
    else if (st === 'unknown') lines.push(`${label}: غير مسجَّل / غير معروف`);
    else if (st === 'treated') lines.push(`${label}: ✔ تمت المعالجة` + (t && t !== 'سليم' ? ` (الوصف الأصلي: ${t})` : ''));
    else if (st === 'healthy') lines.push(`${label}: سليم`);
    else {
      const sevText = (sevCode && SEV_LABELS[sevCode]) ? ` — (${SEV_LABELS[sevCode]})` : '';
      lines.push(`${label}: ${t}${sevText}`);
    }
  };

  const showAll = !categories;
  const showInsulator = showAll || categories.includes('insulator');

  if (showAll || categories.includes('foundation')) addCat('🧱 قواعد البرج', r.tower_foundations, r.sev_foundation, 'foundation');
  if (showAll || categories.includes('iron')) { addCat('🔩 تقاطعات الحديد', r.iron_intersections, r.sev_iron, 'iron'); addCat('🔩 ملحقات البرج', r.tower_attachments, r.sev_iron, 'attachment'); }
  if (showAll || categories.includes('wires')) { addCat('〰️ أسلاك R', r.wires_r1, r.sev_wires, 'wire_r1'); addCat('〰️ أسلاك S', r.wires_s1, r.sev_wires, 'wire_s1'); addCat('〰️ أسلاك T', r.wires_t1, r.sev_wires, 'wire_t1'); }
  if (showAll || categories.includes('ground')) { addCat('🌍 الأرضي 1', r.ground_1, r.sev_ground, 'ground_1'); addCat('🌍 الأرضي 2', r.ground_2, r.sev_ground, 'ground_2'); }
  // ملاحظة: لا يوجد حقل fire_causes منفصل محفوظ فعلياً بقاعدة البيانات (fire_causes_notes هو الحقل الحقيقي الوحيد) —
  // الإشارة القديمة لـr.fire_causes كانت دائماً فارغة (مرجع لحقل غير موجود)، فما كانت تظهر أي قيمة إطلاقاً
  if (showAll || categories.includes('fire')) addCat('🔥 مسببات الحرائق', reportFireText(r), r.sev_fire, 'fire');
  if (showAll || categories.includes('road')) {
    lines.push(`🛣️ الطريق: ${r.road_access || 'لم يُسجَّل'}`);
    if (r.road_access_notes && r.road_access_notes.trim()) lines.push(`🛣️ ملاحظات الطريق: ${r.road_access_notes.trim()}`);
  }

  // الملاحظات العامة لآخر كشف — تظهر دائماً إذا كان فيها أي نص، بغض النظر عن التصنيف المختار
  if (r.notes && String(r.notes).trim()) lines.push(`📝 ملاحظات: ${r.notes.trim()}`);

  // صور العوازل — منفصلة كلياً عن بطاقة النص، وموزَّعة كل وحدة لحالها. هذا مهم جداً: لو رسمنا
  // الدائرتين بصورة واحدة مدمجة وكانت الاثنتان متضررتان، الصورة تتجاوز ارتفاع الصفحة بسهولة (تأكدنا
  // رياضياً: ممكن توصل لأكثر من ضعف الارتفاع المتاح)، فتنقطع الدائرة الثانية بصمت تام بلا أي أثر.
  // الحل: كل دائرة متضررة تُرسم كصورة PNG مستقلة، توزَّع على الصفحات بشكل مستقل بنفس آلية باقي البطاقات.
  const insuratorImageCards = [];
  if (showInsulator) {
    const isDouble = isDoubleCircuitLine(r.line_name, r.insulator_state_2);
    const names = isDouble ? { 1: '⚡ عوازل الدائرة الأولى', 2: '⚡ عوازل الدائرة الثانية' } : { 1: '⚡ العوازل' };
    let matNote = false;
    for (const c of (isDouble ? [1, 2] : [1])) {
      // v335-C4: لا يُكتب «سليمة» لما لا بيانات له (مفقود/غير صالح/غير معروف)؛ المعالَج يُسمّى معالَجاً في التقرير الحالي؛ التاريخي يعتمد الكشف نفسه
      const ev = reportCircuitInsEval(r, c, names[c]);
      ev.lines.forEach(l => lines.push(l));
      if (!ev.damaged) continue;
      // كل دائرة متضررة تُبنى كصورة مستقلة (forceSingleCircuit=true) بعنوانها الخاص — بدل صورة واحدة مدمجة
      const img = buildInsulatorExportPNG(ev.stateJSON, r.voltage, r.tower_type, r.line_name, c === 2 ? r.insulator_cycle_2 : r.insulator_cycle, null, null, r.tower_number, c === 2 ? r.insulator_chain_types_2 : r.insulator_chain_types, null, true);
      if (img) insuratorImageCards.push(await buildInsulatorImageCard(r, img, names[c]));
      if (!matNote && reportIsCurrent(r)) {
        const inf = (typeof csTowerInfo === 'function') ? csTowerInfo(r.line_name, r.tower_number) : null;
        if (inf && ['missing', 'incomplete', 'invalid'].indexOf(inf.materialsStatus) >= 0) { matNote = true; lines.push('⚠️ مادة السلاسل غير معروفة/غير مكتملة بالحالة الحيّة — الرسم لا يدلّ على نوع المادة'); }
      }
    }
  }
  if (!lines.length && !insuratorImageCards.length) lines.push('لا توجد بيانات لهذا التصنيف بهذا الكشف');

  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  mctx.font = '13px Tahoma, Arial, sans-serif';
  const wrapped = [];
  lines.forEach(line => wrapArabicText(mctx, line, CARD_W - PAD*2).forEach(l => wrapped.push(l)));

  const headerH = 40;
  const bodyH = wrapped.length ? (wrapped.length * 18 + 10) : 0;
  const totalH = headerH + bodyH + PAD*2;
  const scale = 1.3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(CARD_W * scale);
  canvas.height = Math.ceil(totalH * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CARD_W, totalH);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';

  let y = PAD + 12;
  ctx.fillStyle = '#1A2A46';
  ctx.font = 'bold 14px Tahoma, Arial, sans-serif';
  ctx.fillText(`الخط: ${r.line_name||'-'}   |   برج: ${r.tower_number||'-'}   |   التاريخ: ${r.inspection_date||'-'}   |   الفني: ${r.created_by_name||'-'}`, CARD_W - PAD, y);
  y += 18;
  ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(CARD_W - PAD, y); ctx.stroke();
  y += 20;

  if (wrapped.length) {
    ctx.font = '13px Tahoma, Arial, sans-serif';
    ctx.fillStyle = '#3C3C3C';
    wrapped.forEach(line => { ctx.fillText(line, CARD_W - PAD, y); y += 18; });
  }

  const textCard = { dataUrl: canvas.toDataURL('image/jpeg', 0.5), w: CARD_W, h: totalH };
  return [textCard, ...insuratorImageCards];
}

// بطاقة صورة عازل مستقلة (دائرة واحدة فقط) — تُستخدم بدل تضمين الصورة داخل بطاقة النص، حتى تُوزَّع
// على الصفحات بشكل مستقل ولا تنقطع لو تجاوزت المساحة المتبقية بالصفحة الحالية
async function buildInsulatorImageCard(r, insImg, titleLabel) {
  const CARD_W = 760, PAD = 18;
  const insImgEl = await loadImageFromDataUrl(insImg.dataUrl);
  const insDrawW = Math.min(CARD_W - PAD*2, 680);
  const insDrawH = insImgEl ? insDrawW * (insImg.h / insImg.w) : 0;
  const headerH = 34;
  const totalH = headerH + insDrawH + PAD*1.5;
  const scale = 1.3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(CARD_W * scale);
  canvas.height = Math.ceil(totalH * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CARD_W, totalH);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';

  let y = PAD;
  ctx.fillStyle = '#1A2A46';
  ctx.font = 'bold 13px Tahoma, Arial, sans-serif';
  ctx.fillText(`${titleLabel} — الخط: ${r.line_name||'-'} | برج: ${r.tower_number||'-'}`, CARD_W - PAD, y);
  y += 16;

  if (insImgEl) {
    const insX = CARD_W - PAD - insDrawW;
    try { ctx.drawImage(insImgEl, insX, y, insDrawW, insDrawH); } catch(e) { console.warn('[tower-app] فشل رسم صورة العازل المستقلة بالتقرير', e); }
  }

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.5), w: CARD_W, h: totalH };
}
// تحويل تصنيفات التقرير إلى أعمدة Excel مطابقة (من نفس تعريف EXPORT_COLUMNS الموحّد أصلاً)
const REPORT_CATEGORY_EXPORT_COLUMN_LABELS = {
  foundation: ['قواعد البرج'],
  iron: ['تقاطعات الحديد', 'ملحقات البرج'],
  insulator: ['عوازل الدائرة الأولى R', 'عوازل الدائرة الأولى S', 'عوازل الدائرة الأولى T', 'عوازل الدائرة الثانية R', 'عوازل الدائرة الثانية S', 'عوازل الدائرة الثانية T'],
  wires: ['أسلاك R', 'أسلاك S', 'أسلاك T'],
  ground: ['الأرضي 1', 'الأرضي 2'],
  fire: ['مسببات الحرائق'],
  road: ['وجود طريق', 'ملاحظات الطريق']
};
const REPORT_ALWAYS_COLUMNS = ['اسم الخط', 'تاريخ الكشف', 'رقم البرج', 'نوع البرج', 'الجهد', 'الموظف'];
function getReportExcelColumns(categories) {
  if (!categories) return EXPORT_COLUMNS; // "الكل" = كل الأعمدة
  const labels = new Set(REPORT_ALWAYS_COLUMNS);
  labels.add('ملاحظات');
  categories.forEach(cat => (REPORT_CATEGORY_EXPORT_COLUMN_LABELS[cat]||[]).forEach(l => labels.add(l)));
  return EXPORT_COLUMNS.filter(c => labels.has(c.label));
}

async function exportUnifiedReportExcel() {
  const types = getReportSelectedTypes();
  if (!types.length) { showToast('⚠️ اختر نوع بيانات واحد على الأقل', 'error'); return; }
  const categories = getReportSelectedCategories();
  showToast('⏳ جاري تجهيز البيانات...');

  const scopeE = reportCaptureScope(); const seqE = ++_reportExportSeq;
  const basisE = {};
  const inspections = await reportLoadInspections(types, true, basisE);
  if (inspections === null) return;
  const auxE = await reportEnsureAux(types, true, scopeE);
  // v335-C6r8: تغيّر المرشّحات/الجلسة أو تصدير أحدث أثناء التحضير = إلغاء صريح (لا خلط نطاقات ولا ناتج فارغ كاذب)
  if (auxE.stale || seqE !== _reportExportSeq || !reportScopeCurrent(scopeE)) { showToast(reportScopeChangedText(), 'error'); return; }
  if (!auxE.ok) { showToast(reportAuxText(auxE.failed), 'error'); return; }
  const treatments = types.includes('treatment') ? getReportFilteredTreatments(auxE.rows.treat) : [];
  const thermalForms = types.includes('thermal') ? getReportFilteredThermalForms(auxE.rows.forms) : [];
  const thermalRaw = types.includes('thermal') ? getReportFilteredThermalRaw(auxE.rows.raw) : [];

  if (!inspections.length && !treatments.length && !thermalForms.length && !thermalRaw.length) {
    showToast('⚠️ لا توجد بيانات مطابقة لإصدار تقرير', 'error');
    return;
  }

  await ensureXLSXLoaded(); // Lazy load: يضمن اكتمال تحميل XLSX قبل الاستخدام
  if (!reportExportValid(scopeE, seqE)) { showToast(reportScopeChangedText(), 'error'); return; }   // v335-C6r8c: بعد انتظار المكتبة
  const wb = XLSX.utils.book_new();

  if (inspections.length) {
    const cols = getReportExcelColumns(categories);
    const data = inspections.map(r => { const o = {}; cols.forEach(c => { o[c.label] = reportCell(c, r); }); return o; });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'كشف');
  }
  if (treatments.length) {
    const data = treatments.map(t => ({
      'اسم الخط': t.line_name,
      'رقم البرج': t.tower_number,
      'تاريخ المعالجة': t.treatment_date,
      'المعالج': t.treated_by || '',
      'العناصر المعالَجة': (t.items_treated||[]).map(i => i.label).join('، ')
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'معالجات');
  }
  if (thermalForms.length || thermalRaw.length) {
    const data = [];
    // المصدر الأول: القراءات الخام (شاشة "كشف حراري ← جديد")
    thermalRaw.forEach(r => {
      data.push({
        'اسم الخط': r.line_name,
        'تاريخ الكشف': r.inspection_date,
        'المصدر': 'قراءة ميدانية',
        'الفني': r.created_by_name || '',
        'رقم البرج': r.tower_number,
        'R': r.r1, 'S': r.s1, 'T': r.t1,
        'الحمل (MW)': '',
        'الحرارة المحيطة': r.ambient_temp,
        'ملاحظات': ''
      });
    });
    // المصدر الثاني: صفوف الاستمارات الرسمية
    thermalForms.forEach(f => {
      (f.rows||[]).forEach(row => {
        data.push({
          'اسم الخط': f.line_name,
          'تاريخ الكشف': f.inspection_date,
          'المصدر': 'استمارة رسمية',
          'الفني': f.created_by || '',
          'رقم البرج': row.tower_number,
          'R': row.r, 'S': row.s, 'T': row.t,
          'الحمل (MW)': row.load_mw,
          'الحرارة المحيطة': row.ambient,
          'ملاحظات': row.notes || ''
        });
      });
    });
    data.sort((a,b) => (a['اسم الخط']||'').localeCompare(b['اسم الخط']||'', 'ar') || (parseInt(a['رقم البرج'])||0) - (parseInt(b['رقم البرج'])||0));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'كشف حراري');
  }

  if (types.includes('inspection')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 'أساس بيانات الكشف': reportBasisText(false, basisE.basis) }]), 'أساس التقرير');
  if (!reportExportValid(scopeE, seqE)) { showToast(reportScopeChangedText(), 'error'); return; }   // v335-C6r8c: فوراً قبل كتابة الملف
  XLSX.writeFile(wb, 'تقرير_' + (types.includes('inspection') ? ((basisE.basis || _reportBasis).kind === 'current' ? 'حالي_' : 'تاريخي_') : '') + new Date().toISOString().split('T')[0] + '.xlsx');
  showToast('✅ تم تصدير Excel');
}

async function generateUnifiedReportPDF() {
  const types = getReportSelectedTypes();
  if (!types.length) { showToast('⚠️ اختر نوع بيانات واحد على الأقل', 'error'); return; }
  const categories = getReportSelectedCategories();

  const scopeP = reportCaptureScope(); const seqP = ++_reportExportSeq;
  const basisP = {};
  const inspections = await reportLoadInspections(types, true, basisP);
  if (inspections === null) return;
  const auxP = await reportEnsureAux(types, true, scopeP);
  if (auxP.stale || seqP !== _reportExportSeq || !reportScopeCurrent(scopeP)) { showToast(reportScopeChangedText(), 'error'); return; }
  if (!auxP.ok) { showToast(reportAuxText(auxP.failed), 'error'); return; }
  const treatments = types.includes('treatment') ? getReportFilteredTreatments(auxP.rows.treat) : [];
  const thermalRaw = types.includes('thermal') ? getReportFilteredThermalRaw(auxP.rows.raw) : [];
  const thermalForms = types.includes('thermal') ? getReportFilteredThermalForms(auxP.rows.forms) : [];

  if (!inspections.length && !treatments.length && !thermalRaw.length && !thermalForms.length) {
    showToast('⚠️ لا توجد بيانات مطابقة لإصدار تقرير', 'error');
    return;
  }

  showToast('⏳ جاري تحضير التقرير...');

  // قائمة موحّدة لكل (خط، برج) مذكور بأي من الأنواع المختارة — بدل أقسام منفصلة، كل برج يطلع
  // مرة وحدة وتحته كل بياناته بالترتيب: كشف ← معالجة ← ملاحظات الكشف الحراري (لو وُجدت)
  const towerMap = new Map();
  function addTower(line_name, tower_number) {
    if (!line_name || tower_number == null || tower_number === '') return;
    const key = line_name + '||' + tower_number;
    if (!towerMap.has(key)) towerMap.set(key, { line_name, tower_number });
  }
  inspections.forEach(r => addTower(r.line_name, r.tower_number));
  treatments.forEach(t => addTower(t.line_name, t.tower_number));
  thermalRaw.forEach(r => addTower(r.line_name, r.tower_number));
  thermalForms.forEach(f => (f.rows||[]).forEach(row => addTower(f.line_name, row.tower_number)));
  const towerList = sortByLineThenTower([...towerMap.values()], 'tower_number');

  // v335-C6r8c: كل انتظار غير متزامن (مكتبة/بطاقات/مشاركة) يُتبع بإعادة التحقق من الجلسة والنطاق وتذكرة التصدير؛ الإبطال يوقف الإخراج
  const stopIfStale = () => { if (!reportExportValid(scopeP, seqP)) { const e = new Error('report_export_aborted'); e.aborted = true; throw e; } };
  try {
    await ensureJsPDFLoaded(); // Lazy load: يضمن اكتمال تحميل jsPDF قبل الاستخدام
    stopIfStale();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 30, marginTop = 50, marginBottom = 26;
    let y = marginTop;

    function ensureSpace(h) {
      // لا نقفز لصفحة جديدة إلا لو فيه محتوى مرسوم أصلاً بالصفحة الحالية — بدون هذا الشرط،
      // أول بطاقة كبيرة كانت تدفع فوراً لصفحة ثانية وتترك الصفحة الأولى شبه فارغة (بس العنوان)
      if (y > marginTop && y + h > pageH - marginBottom) { doc.addPage(); y = marginTop; }
    }
    async function drawCard(card) {
      stopIfStale();
      const drawW = pageW - marginX*2;
      const drawH = card.h * (drawW / card.w);
      ensureSpace(drawH + 8);
      doc.addImage(card.dataUrl, 'JPEG', marginX, y, drawW, drawH);
      y += drawH + 8;
    }

    doc.setFontSize(13); doc.setTextColor(0,0,0);
    doc.text('Unified Report', pageW/2, 26, { align: 'center' });
    doc.setFontSize(9);
    doc.text(new Date().toLocaleDateString('en-GB') + (types.includes('inspection') ? '  |  ' + reportBasisText(true, basisP.basis) : ''), pageW/2, 38, { align: 'center' });
    y = 50;

    for (const { line_name, tower_number } of towerList) {
      const insForTower = inspections.filter(r => r.line_name === line_name && String(r.tower_number) === String(tower_number));
      const treatForTower = treatments.filter(t => t.line_name === line_name && String(t.tower_number) === String(tower_number));
      const thermalNotes = types.includes('thermal') ? getThermalNotesForTower(line_name, tower_number, thermalRaw, thermalForms) : [];

      for (const r of insForTower) { for (const card of await buildReportInspectionCardCanvas(r, categories)) await drawCard(card); }
      for (const t of treatForTower) await drawCard(await buildTreatLogRecordCanvas(t));
      if (thermalNotes.length) await drawCard(await buildThermalNotesCardCanvas(line_name, tower_number, thermalNotes));
    }

    stopIfStale();
    const blob = doc.output('blob');
    const filename = 'تقرير_' + (types.includes('inspection') ? ((basisP.basis || _reportBasis).kind === 'current' ? 'حالي_' : 'تاريخي_') : '') + new Date().toISOString().split('T')[0] + '.pdf';
    stopIfStale();
    await shareOrDownloadFile(blob, filename, 'application/pdf');
    showToast('✅ تم تجهيز التقرير');
  } catch (err) {
    if (err && err.aborted) { showToast(reportScopeChangedText(), 'error'); return; }
    console.error(err);
    showToast('❌ تعذر تجهيز التقرير', 'error');
  }
}

// ========================
// المركز الموحّد: تصفح خط ← تاريخ ← تفاصيل (كشف بصري / كشف حراري / سجل معالجات)
// ========================
let hubBrowseType = null; // 'visual' | 'thermal' | 'treat'
let hubSelectedLine = null;
let hubSelectedDate = null;

function showHubView(id) {
  ['hubHomeView','hubLinesView','hubDatesView','hubDetailView'].forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = (v === id) ? '' : 'none';
  });
}

async function openRecordsHub() {
  showHubView('hubHomeView');
  hubBrowseType = null; hubSelectedLine = null; hubSelectedDate = null;
  await openReportsPage(); // يهيّئ فلاتر ونتائج قسم التصدير (كما هو تماماً)
}

// يرجّع كل المجموعات (خط+تاريخ) لنوع معيّن، بكل عناصرها
function getHubGroups(type) {
  const map = new Map();
  function ensure(line, date) {
    const key = line + '||' + date;
    if (!map.has(key)) map.set(key, { line_name: line, date, items: [], raw: [], forms: [] });
    return map.get(key);
  }
  if (type === 'visual') {
    // نستخدم "records" (كاش آخر 6 أشهر، محدود الحجم أصلاً) بدل fullRecordsCache — لأن الأخير صار
    // يحتوي "آخر حالة لكل برج" بس (رؤية latest_inspections)، وما يصلح لتصفّح تواريخ متعددة بالتاريخ
    (records||[]).forEach(r => { if (r.line_name && r.inspection_date) ensure(r.line_name, r.inspection_date).items.push(r); });
  } else if (type === 'treat') {
    (treatmentsCache||[]).forEach(t => { if (t.line_name && t.treatment_date) ensure(t.line_name, t.treatment_date).items.push(t); });
  } else if (type === 'thermal') {
    (thermalRecords||[]).forEach(r => { if (r.line_name && r.inspection_date) ensure(r.line_name, r.inspection_date).raw.push(r); });
    (reportThermalFormsCache||[]).forEach(f => { if (f.line_name && f.inspection_date) ensure(f.line_name, f.inspection_date).forms.push(f); });
  }
  return map;
}

const HUB_TYPE_LABELS = { visual: '👁️ الكشف البصري', thermal: '🌡️ الكشف الحراري', treat: '🔧 سجل المعالجات' };

async function openHubBrowse(type) {
  hubBrowseType = type;
  pushLevel(() => { showHubView('hubHomeView'); });
  showToast('⏳ جاري التحميل...');
  if (type === 'visual') await loadRecords().catch(()=>{});
  if (type === 'treat') await loadTreatments().catch(()=>{});
  if (type === 'thermal') await Promise.all([loadThermalArchive().catch(()=>{}), loadReportThermalForms().catch(()=>{})]);
  renderHubLines();
  showHubView('hubLinesView');
}

function renderHubLines() {
  const map = getHubGroups(hubBrowseType);
  const perLine = new Map();
  [...map.values()].forEach(g => { perLine.set(g.line_name, (perLine.get(g.line_name)||0) + 1); });
  const lines = [...perLine.keys()].sort((a,b) => a.localeCompare(b, 'ar'));
  const list = document.getElementById('hubLinesList');
  if (!lines.length) { list.innerHTML = `<div class="empty-state">لا توجد بيانات ${HUB_TYPE_LABELS[hubBrowseType]} بعد</div>`; return; }
  list.innerHTML = `<div class="page-title" style="grid-column:1/-1;font-size:1.05rem">${HUB_TYPE_LABELS[hubBrowseType]} — اختر الخط</div>` +
    lines.map(line => `<div class="card" onclick="openHubDates('${line.replace(/'/g,"\\'")}')"><span class="icon">⚡</span><span class="label">${line}</span><span class="sublabel">${perLine.get(line)} تاريخ كشف</span></div>`).join('');
}

function openHubDates(line) {
  hubSelectedLine = line;
  pushLevel(() => { showHubView('hubLinesView'); });
  renderHubDates();
  showHubView('hubDatesView');
}

function renderHubDates() {
  const map = getHubGroups(hubBrowseType);
  const groups = [...map.values()].filter(g => g.line_name === hubSelectedLine).sort((a,b) => (b.date||'').localeCompare(a.date||''));
  const list = document.getElementById('hubDatesList');
  if (!groups.length) { list.innerHTML = '<div class="empty-state">لا توجد تواريخ</div>'; return; }
  list.innerHTML = `<div class="page-title" style="grid-column:1/-1;font-size:1.05rem">${hubSelectedLine} — اختر التاريخ</div>` +
    groups.map(g => {
      let count, unit;
      if (hubBrowseType === 'thermal') { count = g.raw.length + g.forms.length; unit = 'قراءة/استمارة'; }
      else { count = g.items.length; unit = hubBrowseType === 'treat' ? 'معالجة' : 'برج'; }
      return `<div class="card" onclick="openHubDetail('${(g.date||'').replace(/'/g,"\\'")}')"><span class="icon">📅</span><span class="label">${g.date}</span><span class="sublabel">${count} ${unit}</span></div>`;
    }).join('');
}

function openHubDetail(date) {
  hubSelectedDate = date;
  pushLevel(() => { showHubView('hubDatesView'); });
  renderHubDetail();
  showHubView('hubDetailView');
}

function getCurrentHubGroup() {
  const map = getHubGroups(hubBrowseType);
  return map.get(hubSelectedLine + '||' + hubSelectedDate);
}

function renderHubDetail() {
  const g = getCurrentHubGroup();
  const summary = document.getElementById('hubDetailSummary');
  const list = document.getElementById('hubDetailList');
  if (!g) { summary.innerHTML = '<p>لا توجد بيانات</p>'; list.innerHTML = ''; return; }

  if (hubBrowseType === 'visual') {
    const withIssues = g.items.filter(r => ['sev_foundation','sev_iron','sev_insulator','sev_wires','sev_ground','sev_fire'].some(f => isIssueSev(r[f])));
    summary.innerHTML = `
      <h3 style="margin-top:0">${g.line_name} — ${g.date}</h3>
      <p style="font-size:0.85rem;color:#4A5568">🗼 عدد الأبراج المكشوفة: <b>${g.items.length}</b> | ⚠️ فيها ضرر: <b>${withIssues.length}</b></p>
      <button class="btn btn-del" style="margin-top:10px" onclick="deleteWholeHubDate()">🗑️ حذف هذا الكشف بالكامل (كل أبراج هذا التاريخ)</button>
      <button class="btn btn-primary" style="margin-top:6px" onclick="exportHubGroupNow()">📄 تصدير هذا الكشف (PDF)</button>
    `;
    list.innerHTML = g.items.sort((a,b)=>(a.tower_number||0)-(b.tower_number||0)).map(r => `
      <div class="dep-card">
        <div class="dep-card-header">
          <div class="dep-card-title">🗼 برج ${r.tower_number}</div>
          <div class="dep-card-meta">${r.tower_type||''} | 👤 ${r.created_by_name||'—'}</div>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button class="btn-sm" style="background:#EBF0F5;color:#2E4057;border:1px solid #CBD5E0;border-radius:6px;padding:4px 10px;font-size:0.78rem;cursor:pointer" onclick="editRecord('${r.id}')">✏️ تعديل</button>
          ${(currentUser.role==='admin')?`<button class="btn-sm btn-del" onclick="hubDeleteSingleInspection('${r.id}')">🗑️ حذف</button>`:''}
        </div>
      </div>`).join('');

  } else if (hubBrowseType === 'treat') {
    summary.innerHTML = `
      <h3 style="margin-top:0">${g.line_name} — ${g.date}</h3>
      <p style="font-size:0.85rem;color:#4A5568">🔧 عدد المعالجات: <b>${g.items.length}</b></p>
      <button class="btn btn-del" style="margin-top:10px" onclick="deleteWholeHubDate()">🗑️ حذف كل معالجات هذا التاريخ</button>
      <button class="btn btn-primary" style="margin-top:6px" onclick="exportHubGroupNow()">📄 تصدير هذا الكشف (PDF)</button>
    `;
    list.innerHTML = g.items.sort((a,b)=>(a.tower_number||0)-(b.tower_number||0)).map(t => `
      <div class="dep-card">
        <div class="dep-card-header">
          <div class="dep-card-title">🗼 برج ${t.tower_number}</div>
          <div class="dep-card-meta">👤 ${t.treated_by||'—'}</div>
        </div>
        <div class="dep-items" style="margin-top:8px">${(t.items_treated||[]).map(i=>`<span class="dep-item fixed">✅ ${i.label}</span>`).join('')}</div>
        <div style="margin-top:8px;display:flex;gap:8px">
          ${(currentUser.role==='admin')?`<button class="btn-sm" style="background:#EBF0F5;color:#2E4057;border:1px solid #CBD5E0;border-radius:6px;padding:4px 10px;font-size:0.78rem;cursor:pointer" onclick="openTreatmentEditModal('${t.id}')">✏️ تعديل</button><button class="btn-sm btn-del" onclick="hubDeleteSingleTreatment('${t.id}')">🗑️ حذف</button>`:''}
        </div>
      </div>`).join('');

  } else if (hubBrowseType === 'thermal') {
    summary.innerHTML = `
      <h3 style="margin-top:0">${g.line_name} — ${g.date}</h3>
      <p style="font-size:0.85rem;color:#4A5568">🌡️ قراءات خام: <b>${g.raw.length}</b> | 📄 استمارات رسمية: <b>${g.forms.length}</b></p>
      <button class="btn btn-primary" style="margin-top:6px" onclick="exportHubGroupNow()">📄 تصدير هذا الكشف (PDF)</button>
    `;
    let html = '';
    if (g.forms.length) {
      html += '<h4 style="margin:10px 0 6px">📄 الاستمارات الرسمية</h4>' + g.forms.map(f => `
        <div class="dep-card">
          <div class="dep-card-header">
            <div class="dep-card-title">📄 استمارة (${(f.rows||[]).length} برج)</div>
            <div class="dep-card-meta">👤 ${f.created_by||'—'}</div>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px">
            <button class="btn-sm" style="background:#EBF0F5;color:#2E4057;border:1px solid #CBD5E0;border-radius:6px;padding:4px 10px;font-size:0.78rem;cursor:pointer" onclick="openOfficialFormFromArchive('${f.id}')">✏️ فتح/تعديل</button>
            ${(currentUser.role==='admin')?`<button class="btn-sm btn-del" onclick="hubDeleteOfficialForm('${f.id}')">🗑️ حذف</button>`:''}
          </div>
        </div>`).join('');
    }
    if (g.raw.length) {
      html += '<h4 style="margin:10px 0 6px">🌡️ القراءات الخام</h4>' + g.raw.map(r => `
        <div class="dep-card">
          <div class="dep-card-header">
            <div class="dep-card-title">🗼 ${r.point_label||('برج '+(r.tower_number||''))}</div>
            <div class="dep-card-meta">R:${r.r1??'-'} S:${r.s1??'-'} T:${r.t1??'-'} | 👤 ${r.created_by_name||'—'}</div>
          </div>
          <div style="margin-top:8px">
            ${(currentUser.role==='admin')?`<button class="btn-sm btn-del" onclick="hubDeleteRawThermal('${r.id}')">🗑️ حذف</button>`:''}
          </div>
        </div>`).join('');
    }
    list.innerHTML = html || '<div class="empty-state">لا توجد قراءات</div>';
  }
}

async function hubDeleteSingleInspection(id) {
  if (!(currentUser.role === 'admin')) { showToast('⚠️ الحذف من صلاحيات المدير فقط', 'error'); return; }
  if (!confirm('🗑️ إلغاء كشف هذا البرج؟ لا يُحذف الأصل: يُسجَّل إلغاء بسبب ويُخفى من السجلات، وتُعاد الحالة الحالية فقط إن كان هو آخر كاتب لها.')) return;
  try {
    await opsDeleteInspection(id);   // v335-C4: عملية void مسجَّلة (لا DELETE مباشر)؛ يُخفى السجل بعد تأكيد السيرفر
    renderHubDetail();
  } catch (e) { showToast('❌ تعذّر تسجيل الإلغاء', 'error'); }
}
async function hubDeleteSingleTreatment(id) {
  await deleteTreatmentRecord(id); // نفس الدالة المستخدمة بشاشة المغادرات — يضمن التزامن بكل مكان
  renderHubDetail();
}
async function hubDeleteOfficialForm(id) {
  await deleteOfficialFormFromArchive(id);
  await loadReportThermalForms();
  reportInvalidateAux();
  renderHubDetail();
}
async function hubDeleteRawThermal(id) {
  if (!(currentUser.role === 'admin')) { showToast('⚠️ الحذف من صلاحيات المدير فقط', 'error'); return; }
  if (!confirm('🗑️ تأكيد حذف هذي القراءة؟')) return;
  try {
    const res = await sbFetch(`thermal_inspections?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    thermalRecords = thermalRecords.filter(r => r.id !== id);
    reportInvalidateAux();
    showToast('🗑️ تم الحذف');
    renderHubDetail();
  } catch (e) { showToast('❌ تعذر الحذف', 'error'); }
}

async function deleteWholeHubDate() {
  if (!(currentUser.role === 'admin')) { showToast('⚠️ الحذف من صلاحيات المدير فقط', 'error'); return; }
  const g = getCurrentHubGroup();
  if (!g) return;
  const n = g.items.length;
  if (!confirm(`🗑️ تأكيد إلغاء كل بيانات ${hubSelectedLine} بتاريخ ${hubSelectedDate} (${n} سجل)؟ لا يُحذف الأصل: يُسجَّل إلغاء بسبب ويُخفى من السجلات، وتُعاد الحالة الحالية لكل برج فقط إن كان هذا السجل آخر كاتب لها.`)) return;
  if (hubBrowseType === 'visual' || hubBrowseType === 'treat') {   // v335-C4: عمليات void مسجَّلة بدل DELETE مباشر
    const rows = g.items.slice();
    const done = hubBrowseType === 'visual' ? await opsDeleteInspections(rows) : await opsDeleteTreatments(rows);
    showToast(done === n ? `📦 سُجّل إلغاء ${done} من ${n} وسيُرسل` : `⚠️ سُجّل إلغاء ${done} من ${n} فقط`, done === n ? undefined : 'error');
    goBackFromOperation();
    return;
  }
  showToast('⏳ جاري الحذف...');
  const table = hubBrowseType === 'visual' ? 'inspections' : 'treatments';
  const ids = g.items.map(x => x.id);
  const succeededIds = [];
  for (const id of ids) {
    try {
      const res = await sbFetch(`${table}?id=eq.${id}`, { method: 'DELETE' });
      if (res.ok) succeededIds.push(id);
      else console.warn('[tower-app] فشل حذف', table, id, 'HTTP', res.status);
    } catch (e) { console.warn('[tower-app] فشل حذف', table, id, e); }
  }
  // نمسح من الكاش بس اللي فعلاً انحذف — قبل كذا كان يُمسح الكل من الكاش حتى لو فشل الحذف الحقيقي بالسيرفر
  if (hubBrowseType === 'visual') {
    fullRecordsCache = fullRecordsCache.filter(r => !succeededIds.includes(r.id));
    rebuildLatestRecordsIndex();
    records = records.filter(r => !succeededIds.includes(r.id));
  }
  else treatmentsCache = treatmentsCache.filter(t => !succeededIds.includes(t.id));
  reportInvalidateAux();
  const success = succeededIds.length;
  showToast(success === n ? `🗑️ تم حذف ${success} من ${n}` : `⚠️ تم حذف ${success} من ${n} فقط — راجع سجل المتصفح لمعرفة السبب`, success === n ? undefined : 'error');
  goBackFromOperation(); // نرجع لقائمة التواريخ لأن هذا التاريخ ما عاد موجود
}

// تصدير سريع لنفس الخط والتاريخ المعروضين حالياً — يهيّئ فلاتر قسم التصدير تلقائياً ثم يصدّر PDF
async function exportHubGroupNow() {
  showHubView('hubHomeView');
  // نحدد بس هذا الخط بخانات الاختيار المتعددة (نلغي "الكل" ونعلّم خانة هذا الخط تحديداً)
  document.getElementById('repLinesAll').checked = false;
  document.getElementById('repLinesWrap').style.display = 'grid';
  document.querySelectorAll('.repLineChk').forEach(cb => { cb.checked = (cb.value === hubSelectedLine); });
  document.getElementById('repFrom').value = hubSelectedDate;
  document.getElementById('repTo').value = hubSelectedDate;
  // ترجمة صريحة بين تسميات المركز الموحّد وتسميات قسم التصدير — بدونها كان التصدير من قسم
  // المعالجات يفشل بصمت لأن 'treat' لا تطابق قيمة الـcheckbox 'treatment'
  const HUB_TYPE_TO_REPORT_TYPE = { visual: 'inspection', treat: 'treatment', thermal: 'thermal' };
  const wantedType = HUB_TYPE_TO_REPORT_TYPE[hubBrowseType];
  document.querySelectorAll('.repTypeChk').forEach(cb => { cb.checked = (cb.value === wantedType); });
  document.querySelector('input[name="repTowersMode"][value="all"]').checked = true;
  onReportTowersModeChange();
  await generateUnifiedReportPDF();
}

