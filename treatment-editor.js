/* treatment-editor.js — v335-C5r8
   محرر معالجة المغادرات: اختيار الخط/البرج، عناصر المعالجة، رسم العوازل والسلاسل التفاعلي، استبدال المادة، الحفظ المحلي في الطابور الموحّد.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
// ---------------------------------------------------------------------------------------------------------
// بناء عملية معالجة من واجهة المعالجة (يُستدعى من saveTreatment المعدَّلة)
// ---------------------------------------------------------------------------------------------------------
function opsBuildTreatment(r, ctx) {
  // ctx: { pure:{ins1:{R,S,T}, ins2:{...}}, replLog, otherState, items, sevPicks, svgs, isDouble, chainTypes1, chainTypes2, state1, bizDate }
  const treated = {}, replace = [], text = [];
  const inRepl = (circuit, ph, i) => ctx.replLog.some(e => (e.circuit === 2 ? 2 : 1) === circuit && e.phase === ph && i >= e.offsetIdx && i < e.offsetIdx + e.rows);
  OPS_PH.forEach(ph => { const a = ctx.pure.ins1[ph].filter(i => !inRepl(1, ph, i)); if (a.length) treated['ins_' + ph] = a.sort((x, y) => x - y); });
  if (ctx.isDouble) OPS_PH.forEach(ph => { const a = ctx.pure.ins2[ph].filter(i => !inRepl(2, ph, i)); if (a.length) treated['ins2_' + ph] = a.sort((x, y) => x - y); });
  ctx.replLog.forEach(e => {
    const ct = e.circuit === 2 ? ctx.chainTypes2 : ctx.chainTypes1, saved = e.circuit === 2 ? r.insulator_chain_types_2 : r.insulator_chain_types;
    const item = { comp: (e.circuit === 2 ? 'ins2_' : 'ins_') + e.phase, chain_idx: e.chainIdx, to: e.toType };
    if (!saved) item.chains_full = (ct[e.phase] || []).slice();
    replace.push(item);
  });
  const textKeys = /^(iron|foundation|attachment|wire_[rst]1(_c2)?|ground_[12]|fire|washing)$/;
  const notes = [];
  Object.keys(ctx.otherState).forEach(k => {
    if (!ctx.otherState[k]) return;
    if (textKeys.test(k)) { text.push(k); return; }
    notes.push(k);       // مفتاح غير نصّي معروف: يُمنع الحفظ (لا تخمين). بلاستك/خزف تُعالَج عبر واجهة العوازل نفسها
  });
  const sev = {};
  Object.keys(ctx.sevPicks || {}).forEach(f => { if (ctx.sevPicks[f]) sev[f] = ctx.sevPicks[f]; });
  const payload = { kind: 'treatment', op_id: ctx.opId, line_name: r.line_name, tower_number: String(r.tower_number), business_date: ctx.bizDate, treated, replace, text_items: text, sev,
    items_treated: ctx.items.map(i => i.count === undefined ? { key: i.key, label: i.label } : { key: i.key, label: i.label, count: i.count }), row: Object.assign({ notes: '' }, ctx.svgs || {}) };
  if (hasValidInspectionId(r.id)) payload.inspection_id = r.id;
  return { payload, unmapped: notes };
}

function goToTreatThisTowerImpl(lineName, towerNum) {
  // نروح لتاب المعالجة ونختار الخط والبرج تلقائياً
  const tabs = document.querySelectorAll('.dep-tab');
  const treatTabBtn = Array.from(tabs).find(b => b.textContent.includes('معالجة'));
  switchDepTab('treat', treatTabBtn || tabs[1]);
  setTimeout(() => {
    populateTreatLines();
    const lineSel = document.getElementById('treatLine');
    // نتأكد الخط موجود بالقائمة (قد يحتاج إضافته لو مفلتر)
    if (![...lineSel.options].some(o => o.value === lineName)) {
      const opt = document.createElement('option'); opt.value = lineName; opt.textContent = lineName;
      lineSel.appendChild(opt);
    }
    lineSel.value = lineName;
    Promise.resolve(onTreatLineChange()).then(() => {   // v335-C6r7: اختيار الخط يقرأ ملخّصه أولاً؛ بعده يُختار البرج
      if (document.getElementById('treatLine').value !== lineName) return;
      const towerSel = document.getElementById('treatTower');
      if (![...towerSel.options].some(o => o.value === towerNum)) {
        const opt = document.createElement('option'); opt.value = towerNum; opt.textContent = 'برج ' + towerNum;
        towerSel.appendChild(opt);
      }
      towerSel.value = towerNum;
      towerSel.disabled = false;
      onTreatTowerChange();
    });
  }, 50);
}

function populateTreatLines() {
  const sel = document.getElementById('treatLine');
  const _prevTreatLine = sel.value; // v335: نحافظ على الخط المختار إن بقي ضمن القائمة
  sel.innerHTML = '<option value="">-- اختر الخط --</option>';
  const g400 = document.createElement('optgroup'); g400.label = '400 ك.ف';
  const g132 = document.createElement('optgroup'); g132.label = '132 ك.ف';
  // نستخدم فهرس "آخر سجل لكل برج" بدل مسح كل التاريخ — أسرع بكثير (لا يكبر مع تراكم الكشوفات
  // القديمة) وأدق أيضاً (يعكس الحالة الحالية فقط، مو كشف قديم انصلح لاحقاً)
  // v335-C6r7: الحالة الحيّة = أسماء كل خطوط التطبيق فوراً دون أي قراءة (لا يُعرف أي خط فيه مغادرات قبل قراءته)؛ الخط المختار يُقرأ وحده في onTreatLineChange
  const linesWithDeps = csLiveEnabled()
    ? Array.from(new Set(Object.keys(LINES_DATA || {}).concat(Object.keys(latestRecordsIndex)))).sort()
    : Object.keys(latestRecordsIndex).filter(lineName =>
        Object.values(latestRecordsIndex[lineName]).some(r => extractDepsFromRecord(r).some(d => !isTreatedInDB(r.id, d.key, r)))
      ).sort();
  linesWithDeps.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if (name.includes('400')) g400.appendChild(opt); else g132.appendChild(opt);
  });
  sel.appendChild(g400); sel.appendChild(g132);
  if (_prevTreatLine && [...sel.options].some(o => o.value === _prevTreatLine)) sel.value = _prevTreatLine;
}

function onTreatLineChange() {
  // تغيير الخط يُبطل أي اختيار برج جارٍ جلبه: يُصفَّر السجل وتُخفى البطاقة قبل أي خروج، وتسلسل الاختيار يتقدّم فيُرفض الطلب القديم عند عودته
  _treatSelectSeq++;
  currentTreatRecord = null;
  document.getElementById('treatItemsCard').style.display = 'none';
  const lineName = document.getElementById('treatLine').value;
  const towerSel = document.getElementById('treatTower');
  towerSel.innerHTML = '<option value="">-- اختر رقم البرج --</option>';
  if (!lineName) { towerSel.disabled = true; return; }
  if (csLiveEnabled()) return _treatLoadLineTowers(lineName, _treatSelectSeq);   // v335-C6r7: قراءة ملخّص الخط المختار وحده (طلب واحد) ثم ملء الأبراج
  _treatFillTowers(lineName, null);
}

// v335-C6r7: أبراج الخط ذات المغادرات من ملخّص الخط المقروء. coverage غير مكتملة = أبراج غير مهيّأة/قيد الإصلاح: تُعلَن ولا تُعدّ خالية من المغادرات.
function _treatFillTowers(lineName, coverage) {
  const towerSel = document.getElementById('treatTower');
  towerSel.innerHTML = '<option value="">-- اختر رقم البرج --</option>';
  // نفس التحسين: من فهرس آخر سجل لهذا الخط بس، بدل مسح كل الكشوفات التاريخية له
  const bucket = latestRecordsIndex[lineName] || {};
  const towersWithDeps = Object.values(bucket)
    .filter(r => extractDepsFromRecord(r).some(d => !isTreatedInDB(r.id, d.key, r)))
    .map(r => r.tower_number)
    .sort((a,b) => parseInt(a)-parseInt(b));
  const unk = coverage && coverage.complete === false ? ((coverage.uninitialised || 0) + (coverage.card_pending || 0)) : 0;
  const unkTxt = unk ? ' — ⚠️ ' + unk + ' برج غير معروف الحالة (غير مهيّأ/قيد الإصلاح)' : '';
  if (!towersWithDeps.length) { towerSel.innerHTML = '<option value="">' + (unk ? '-- لا مغادرات بين الأبراج المعروفة' + unkTxt : '-- لا توجد مغادرات') + ' --</option>'; towerSel.disabled = true; return; }
  if (unk) towerSel.options[0].textContent = '-- اختر رقم البرج' + unkTxt + ' --';
  towersWithDeps.forEach(tn => { const o = document.createElement('option'); o.value = tn; o.textContent = 'برج ' + tn; towerSel.appendChild(o); });
  towerSel.disabled = false;
}

async function _treatLoadLineTowers(lineName, mySeq) {
  const towerSel = document.getElementById('treatTower');
  towerSel.innerHTML = '<option value="">⏳ جارٍ قراءة الخط…</option>'; towerSel.disabled = true;
  let res = null, err = false;
  try { res = await loadLineRecordsCache(lineName, true, 'summary'); } catch (e) { err = true; }
  // اختيار آخر (خط/برج) تقدّم أثناء القراءة: الردّ القديم لا يملأ القائمة الجديدة
  if (mySeq !== _treatSelectSeq || document.getElementById('treatLine').value !== lineName) return;
  if (err || (res && res.ok === false)) {
    if (!loadedLineCacheAt[lineName]) { towerSel.innerHTML = '<option value="">⚠️ تعذّرت قراءة الخط — أعد اختيار الخط للمحاولة</option>'; towerSel.disabled = true; return; }
    try { showToast('⚠️ تعذّر تحديث الخط — المعروض من آخر ما حُمّل', 'error'); } catch (e2) {}
  }
  _treatFillTowers(lineName, res && res.coverage || ((_csLineCov[lineName] || {}).sum || {}).coverage || null);
}

let _treatSelectSeq = 0;

async function onTreatTowerChange() {
  const mySeq = ++_treatSelectSeq;
  const lineName = document.getElementById('treatLine').value;
  const towerNum = document.getElementById('treatTower').value;
  const card = document.getElementById('treatItemsCard');
  // لا يُستعمل سجل اختيار سابق: يُصفَّر قبل أي فحص أو جلب، وتُخفى البطاقة حتى يُقبل الاختيار الجديد
  currentTreatRecord = null;
  card.style.display = 'none';
  if (!lineName || !towerNum) return;
  // حارس قبل أي جلب: وجود كشف معلّق لنفس الخط والبرج (أي تاريخ) يمنع الجلب كي لا يستبدل loadFullTowerRecord كشفاً محلياً معلّقاً
  const early = treatmentBlockReason(lineName, towerNum, null);
  if (early) { showToast(early, 'error'); return; }
  // نجيب السجل الكامل لهذا البرج بالذات (طلب صغير وفوري) — شاشة المعالجة تحتاج تفاصيل غير متوفرة
  // بالتحميل المختصر لشبكة الأبراج (دورة المعالجة، مادة سلاسل الدائرة الثانية، الملاحظات)
  const r = navigator.onLine ? (await loadFullTowerRecord(lineName, towerNum)) || getLatestRecordForTower(lineName, towerNum) : getLatestRecordForTower(lineName, towerNum);
  // لا نقبل السجل إلا لو بقي الاختيار نفسه: التسلسل لم يتقدّم والخط والبرج الحاليان يطابقان ما بدأ به الطلب
  if (mySeq !== _treatSelectSeq || document.getElementById('treatLine').value !== lineName || document.getElementById('treatTower').value !== towerNum) return;
  { const _ti = csLiveEnabled() ? csTowerInfo(lineName, towerNum) : null;   // v335-C6r7: برج غير مهيّأ في المخزن: صريح، ولا تُبنى معالجة من صف قديم محفوظ
    if (_ti && _ti.basis === 'uninitialized') { showToast('⚠️ ' + csReasonsText(['uninitialized']), 'error'); return; } }
  if (!r) return;
  const late = treatmentBlockReason(lineName, towerNum, r); // نفس الحراس مع معرّف السجل المجلوب (id صالح + لا عمليات معلّقة له)
  if (late) { showToast(late, 'error'); return; }
  currentTreatRecord = r;
  otherDepTreatState = {};
  card.style.display = 'block';
  renderTreatItems();
}

function renderTreatItems() {
  const body = document.getElementById('treatItemsBody');
  if (!currentTreatRecord) return;
  const r = currentTreatRecord;
  const stalePrompt = document.getElementById('treatSeverityPrompts');
  if (stalePrompt) stalePrompt.remove();
  const saveBtn = document.querySelector('#treatItemsCard .btn-primary');
  if (saveBtn) saveBtn.disabled = false; // ضمان دائم: الزر يفضل مفعّل بكل مرة نفتح فيها برج جديد للمعالجة
  const deps = extractDepsFromRecord(r);
  if (!deps.length) { body.innerHTML = '<div class="empty-state">✅ لا توجد مغادرات</div>'; return; }

  if (r.insulator_state) {
    treatInsulatorState = safeParseJSON(r.insulator_state) ? JSON.parse(JSON.stringify(safeParseJSON(r.insulator_state))) : {R:[],S:[],T:[]};
  } else { treatInsulatorState = {R:[],S:[],T:[]}; }

  // نوع مادة كل سلسلة (زجاج/بلاستك) — يُقرأ من آخر حفظ، ويصفَّر سجل التبديلات مع كل برج جديد
  treatChainTypes = r.insulator_chain_types ? (safeParseJSON(r.insulator_chain_types) || {R:[],S:[],T:[]}) : {R:[],S:[],T:[]};
  ['R','S','T'].forEach(p => { if (!treatChainTypes[p]) treatChainTypes[p] = []; });
  treatChainTypes2 = r.insulator_chain_types_2 ? (safeParseJSON(r.insulator_chain_types_2) || {R:[],S:[],T:[]}) : {R:[],S:[],T:[]};
  ['R','S','T'].forEach(p => { if (!treatChainTypes2[p]) treatChainTypes2[p] = []; });
  chainReplacementLog = [];

  // مستوى دورة المعالجة يُقرأ مباشرة من السجل (r.insulator_cycle) — يعكس الحقيقة الحالية الفعلية دائماً
  treatCycleState = { R: Array((treatInsulatorState.R||[]).length).fill(0), S: Array((treatInsulatorState.S||[]).length).fill(0), T: Array((treatInsulatorState.T||[]).length).fill(0) };
  if (r.insulator_cycle) {
    try {
      const cyc = safeParseJSON(r.insulator_cycle);
      ['R','S','T'].forEach(phase => { if (cyc[phase]) treatCycleState[phase] = cyc[phase]; });
    } catch(e) { console.warn('[tower-app] فشل تحليل مستوى دورة المعالجة (الدائرة الأولى) للسجل', r.id, e); }
  }

  const isDouble = isDoubleCircuitLine(r.line_name, r.insulator_state_2);
  if (isDouble) {
    if (r.insulator_state_2) {
      treatInsulatorState2 = safeParseJSON(r.insulator_state_2) ? JSON.parse(JSON.stringify(safeParseJSON(r.insulator_state_2))) : {R:[],S:[],T:[]};
    } else { treatInsulatorState2 = {R:[],S:[],T:[]}; }
    treatCycleState2 = { R: Array((treatInsulatorState2.R||[]).length).fill(0), S: Array((treatInsulatorState2.S||[]).length).fill(0), T: Array((treatInsulatorState2.T||[]).length).fill(0) };
    if (r.insulator_cycle_2) {
      try {
        const cyc2 = safeParseJSON(r.insulator_cycle_2);
        ['R','S','T'].forEach(phase => { if (cyc2[phase]) treatCycleState2[phase] = cyc2[phase]; });
      } catch(e) { console.warn('[tower-app] فشل تحليل مستوى دورة المعالجة (الدائرة الثانية) للسجل', r.id, e); }
    }
  }

  let html = '';
  const insulatorDeps = deps.filter(d => d.type === 'insulator');
  const insulatorDeps2 = deps.filter(d => d.type === 'insulator2');
  if (insulatorDeps.length) {
    html += `<div style="margin-bottom:16px">
      <div style="font-weight:700;color:#2E4057;margin-bottom:8px;font-size:0.9rem">🔘 ${isDouble?'عوازل الدائرة الأولى':'العوازل'} — اضغط على المتضرر (أحمر) ليتحول أخضر بعد المعالجة</div>
      <div class="phases-wrap" id="treatPhasesWrap"></div>
      <div class="insulator-legend" style="margin-top:8px">
        <div class="legend-item"><div class="legend-box ok"></div><span>سليم</span></div>
        <div class="legend-item"><div class="legend-box dmg"></div><span>متضرر</span></div>
        <div class="legend-item"><div style="width:16px;height:12px;border-radius:2px;border:1.5px solid #276749;background:#48BB78;display:inline-block;vertical-align:middle"></div><span style="margin-right:4px">تمت المعالجة</span></div>
      </div></div>`;
  }
  if (insulatorDeps2.length) {
    html += `<div style="margin-bottom:16px">
      <div style="font-weight:700;color:#2E4057;margin-bottom:8px;font-size:0.9rem">🔘 عوازل الدائرة الثانية — اضغط على المتضرر (أحمر) ليتحول أخضر بعد المعالجة</div>
      <div class="phases-wrap" id="treatPhasesWrap2"></div>
      <div class="insulator-legend" style="margin-top:8px">
        <div class="legend-item"><div class="legend-box ok"></div><span>سليم</span></div>
        <div class="legend-item"><div class="legend-box dmg"></div><span>متضرر</span></div>
        <div class="legend-item"><div style="width:16px;height:12px;border-radius:2px;border:1.5px solid #276749;background:#48BB78;display:inline-block;vertical-align:middle"></div><span style="margin-right:4px">تمت المعالجة</span></div>
      </div></div>`;
  }
  const otherDeps = deps.filter(d => d.type !== 'insulator' && d.type !== 'insulator2');
  if (otherDeps.length) {
    html += `<div style="margin-top:16px"><div style="font-weight:700;color:#2E4057;margin-bottom:10px;font-size:0.9rem">🔧 مغادرات أخرى</div><div class="treat-items-grid">`;
    otherDeps.forEach(d => {
      const treated = isTreatedInDB(r.id, d.key);
      html += `<button class="treat-item-btn ${treated?'fixed':'damaged'}" onclick="toggleOtherDep('${d.key}',this)" data-key="${d.key}" data-treated="${treated}">${treated?'✅':'🔴'} ${d.label}</button>`;
    });
    html += '</div></div>';
  }
  body.innerHTML = html;
  if (insulatorDeps.length) buildTreatInsulatorUI(r.voltage||132, r.tower_type||'', r.line_name||'', 1);
  if (insulatorDeps2.length) buildTreatInsulatorUI(r.voltage||132, r.tower_type||'', r.line_name||'', 2);
}

function toggleOtherDep(key, btn) {
  const newState = btn.dataset.treated !== 'true';
  btn.dataset.treated = String(newState);
  btn.className = 'treat-item-btn ' + (newState?'fixed':'damaged');
  const label = btn.textContent.trim().replace(/^[✅🔴]\s*/,'');
  btn.textContent = (newState?'✅ ':'🔴 ') + label;
  otherDepTreatState[key] = newState;
}

function buildTreatInsulatorUI(voltage, towerType, lineName, circuit) {
  circuit = circuit || 1;
  const wrapId = circuit === 2 ? 'treatPhasesWrap2' : 'treatPhasesWrap';
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  wrap.innerHTML = '';
  const mode = getInsulatorMode(voltage||132, towerType||'', lineName||'', csFlagOn() && currentTreatRecord ? currentTreatRecord.tower_number : (typeof towerNumber !== 'undefined' ? towerNumber : null));
  const count = getInsulatorCount(mode);
  const stateObj = circuit === 2 ? treatInsulatorState2 : treatInsulatorState;
  const cycleObj = circuit === 2 ? treatCycleState2 : treatCycleState;
  ['R','S','T'].forEach(phase => {
    if (!stateObj[phase]||!stateObj[phase].length)
      stateObj[phase] = Array(count).fill(false);
    if (!cycleObj[phase]||cycleObj[phase].length!==stateObj[phase].length)
      cycleObj[phase] = Array(stateObj[phase].length).fill(0).map((v,i)=>(cycleObj[phase]&&cycleObj[phase][i])||0);
    const block = document.createElement('div'); block.className = 'phase-block';
    const lbl = document.createElement('div'); lbl.className = 'phase-label'; lbl.textContent = 'الفيز '+phase;
    block.appendChild(lbl);
    // buildTreatVisual يقرأ من treatInsulatorState/treatCycleState العامة مباشرة — نبدّلها مؤقتاً للدائرة الثانية
    const backupState = treatInsulatorState, backupCycle = treatCycleState;
    _currentTreatCircuit = circuit;
    if (circuit === 2) { treatInsulatorState = treatInsulatorState2; treatCycleState = treatCycleState2; }
    block.appendChild(buildTreatVisual(phase, mode));
    if (circuit === 2) { treatInsulatorState = backupState; treatCycleState = backupCycle; }
    wrap.appendChild(block);
  });
}

// رسم عمود بلاستك مصغّر أثناء المعالجة — أخضر لو استُبدل بهذي الجلسة، رمادي عادي لو موجود من قبل
function buildTreatPlasticColumn(rows, justReplaced) {
  const w = 20, h = rows * 14 + (rows - 1) * 2;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  function el(tag, attrs) { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  const metal = '#5A5F63';
  const rodColor = justReplaced ? '#276749' : '#8A949C';
  const shedColor = justReplaced ? '#48BB78' : '#9AA4AC';
  const cx = w / 2, capH = Math.max(5, h * 0.08);
  svg.appendChild(el('circle', { cx, cy: capH * 0.4, r: 2.4, fill: metal }));
  svg.appendChild(el('rect', { x: cx - 2.2, y: 0, width: 4.4, height: capH, fill: metal }));
  const bodyTop = capH, bodyBottom = h - capH, bodyH = bodyBottom - bodyTop;
  svg.appendChild(el('rect', { x: cx - 1.5, y: bodyTop, width: 3, height: bodyH, fill: rodColor }));
  const nPairs = Math.max(2, Math.round(rows / 2));
  const step = bodyH / (nPairs * 2);
  const bigW = 11, smallW = 7.5;
  for (let i = 0; i < nPairs * 2; i++) {
    const y = bodyTop + step * (i + 0.5);
    const sw = (i % 2 === 0) ? bigW : smallW;
    const path = `M ${cx-1.2} ${y-2} C ${cx-sw/2} ${y-1.2}, ${cx-sw/2} ${y+1.2}, ${cx-1.3} ${y+2.4} L ${cx+1.3} ${y+2.4} C ${cx+sw/2} ${y+1.2}, ${cx+sw/2} ${y-1.2}, ${cx+1.2} ${y-2} Z`;
    svg.appendChild(el('path', { d: path, fill: shedColor }));
  }
  svg.appendChild(el('circle', { cx, cy: h - capH * 0.4, r: 2.4, fill: metal }));
  svg.appendChild(el('rect', { x: cx - 2.2, y: bodyBottom, width: 4.4, height: capH, fill: metal }));
  return svg;
}

// يبني عمود سلسلة واحد أثناء المعالجة (زجاج أو بلاستك حسب treatChainTypes)، مع زرّي تبديل كامل السلسلة
// رسم عمود خزف أثناء المعالجة (عرض فقط — الخزف لا يُستحدث جديداً أبداً، فقط يُستبدل لزجاج/بلاستك عند الضرر)
function buildTreatCeramicColumn(rows) {
  const w = 20, h = rows * 14 + (rows - 1) * 2;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  function el(tag, attrs) { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  const metal = '#7A7A7A', rodColor = '#5C2A21', shedColor = '#6B3025';
  const cx = w / 2, capH = Math.max(5, h * 0.09);
  svg.appendChild(el('rect', { x: cx - 3.2, y: 0, width: 6.4, height: capH, fill: metal }));
  const bodyTop = capH, bodyBottom = h - capH, bodyH = bodyBottom - bodyTop;
  svg.appendChild(el('rect', { x: cx - 2, y: bodyTop, width: 4, height: bodyH, fill: rodColor }));
  const nSheds = Math.max(3, Math.round(rows / 2));
  const step = bodyH / nSheds, shedW = 16;
  for (let i = 0; i < nSheds; i++) {
    const y = bodyTop + step * (i + 0.5);
    const path = `M ${cx-1.6} ${y-2.4} C ${cx-shedW/2} ${y-1.6}, ${cx-shedW/2} ${y+1.6}, ${cx-1.8} ${y+3.4} L ${cx+1.8} ${y+3.4} C ${cx+shedW/2} ${y+1.6}, ${cx+shedW/2} ${y-1.6}, ${cx+1.6} ${y-2.4} Z`;
    svg.appendChild(el('path', { d: path, fill: shedColor }));
  }
  svg.appendChild(el('rect', { x: cx - 3.2, y: bodyBottom, width: 6.4, height: capH, fill: metal }));
  return svg;
}

function buildTreatChainColumn(phase, chainIdx, rows, offsetIdx) {
  const circuitAtBuild = _currentTreatCircuit;
  const stateObj = circuitAtBuild === 2 ? treatInsulatorState2 : treatInsulatorState;
  const cycleObj = circuitAtBuild === 2 ? treatCycleState2 : treatCycleState;
  const ctypes = circuitAtBuild === 2 ? treatChainTypes2 : treatChainTypes;
  const material = (ctypes[phase] || [])[chainIdx] || 'glass';
  const justReplaced = chainReplacementLog.some(x => x.phase === phase && x.chainIdx === chainIdx && x.circuit === circuitAtBuild);

  const outer = document.createElement('div');
  outer.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px';

  if (material === 'plastic') {
    outer.appendChild(buildTreatPlasticColumn(rows, justReplaced));
  } else if (material === 'ceramic') {
    outer.appendChild(buildTreatCeramicColumn(rows));
  } else {
    const colDiv = document.createElement('div'); colDiv.className = 'chain-col';
    for (let row = 0; row < rows; row++) {
      const idx = offsetIdx + row, rect = document.createElement('div');
      const dmg = stateObj[phase][idx];
      const cyc = (cycleObj[phase] && cycleObj[phase][idx]) || 0;
      rect.className = 'ins-rect';
      rect.dataset.idx = idx; rect.dataset.treated = 'false';
      if (dmg) { rect.style.background = insShade(INS_RED_SHADES, cyc); rect.style.borderColor = '#9B0000'; }
      else if (cyc > 0) { rect.style.background = insShade(INS_GREEN_SHADES, cyc - 1); rect.style.borderColor = '#276749'; }
      rect.style.cursor = dmg ? 'pointer' : 'default';
      if (dmg) rect.addEventListener('click', () => {
        const fixed = rect.dataset.treated === 'true';
        rect.dataset.treated = fixed ? 'false' : 'true';
        rect.style.background = fixed ? insShade(INS_RED_SHADES, cyc) : insShade(INS_GREEN_SHADES, cyc);
        rect.style.borderColor = fixed ? '#9B0000' : '#276749';
      });
      colDiv.appendChild(rect);
    }
    outer.appendChild(colDiv);
  }

  // زرّا تبديل كامل السلسلة — متاحان دائماً بغض النظر عن المادة أو الحالة الحالية (حتى لو سليمة بالكامل)
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:2px;margin-top:2px';
  function mkBtn(label, toType) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font-size:0.5rem;padding:1px 3px;border-radius:4px;border:1px solid #ccc;background:#fff;cursor:pointer;white-space:nowrap;color:#4a5568';
    b.onclick = () => replaceChainMaterial(phase, chainIdx, rows, offsetIdx, toType, circuitAtBuild);
    return b;
  }
  btnRow.appendChild(mkBtn('🔄بلاستك', 'plastic'));
  btnRow.appendChild(mkBtn('🔄زجاج', 'glass'));
  outer.appendChild(btnRow);
  return outer;
}

// يستبدل سلسلة كاملة بمادة جديدة (زجاج أو بلاستك) — تُعتبر كل عوازلها سليمة ومعالجة بهذي الجلسة
function replaceChainMaterial(phase, chainIdx, rows, offsetIdx, toType, circuit) {
  const label = `الفيز ${phase} — سلسلة ${chainIdx + 1}${circuit === 2 ? ' (الدائرة الثانية)' : ''}`;
  const matLabel = toType === 'plastic' ? 'عوازل بلاستك' : 'عوازل زجاج جديدة';
  if (!confirm(`تبديل ${label} بالكامل بـ${matLabel}؟\nستُعتبر كل عوازل هذي السلسلة سليمة ومعالجة.`)) return;

  const stateObj = circuit === 2 ? treatInsulatorState2 : treatInsulatorState;
  const cycleObj = circuit === 2 ? treatCycleState2 : treatCycleState;
  const ctypes = circuit === 2 ? treatChainTypes2 : treatChainTypes;

  for (let i = offsetIdx; i < offsetIdx + rows; i++) {
    stateObj[phase][i] = false;
    cycleObj[phase][i] = (cycleObj[phase][i] || 0) + 1;
  }
  if (!ctypes[phase]) ctypes[phase] = [];
  ctypes[phase][chainIdx] = toType;

  chainReplacementLog = chainReplacementLog.filter(x => !(x.phase === phase && x.chainIdx === chainIdx && x.circuit === circuit));
  chainReplacementLog.push({ phase, chainIdx, offsetIdx, rows, circuit, toType, label: `${label} — استُبدلت بالكامل بـ${matLabel}` });

  const r = currentTreatRecord;
  buildTreatInsulatorUI(r.voltage || 132, r.tower_type || '', r.line_name || '', circuit);
  showToast('✅ تم تبديل السلسلة بالكامل');
}

function buildTreatVisual(phase, mode) {
  if (mode === 'v') {
    const N=28, svgW=140, svgH=110, gap=18, tipY=svgH-8, tipLX=svgW/2-gap/2, tipRX=svgW/2+gap/2, tlX=8, tlY=8, trX=svgW-8, trY=8, rw=12, rh=7;
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width',svgW); svg.setAttribute('height',svgH); svg.setAttribute('viewBox','0 0 '+svgW+' '+svgH);
    function addP(cx,cy,angle,idx) {
      const ca=Math.cos(angle),sa=Math.sin(angle);
      const pts=[[-rw/2,-rh/2],[rw/2,-rh/2],[rw/2,rh/2],[-rw/2,rh/2]].map(([x,y])=>[(cx+x*ca-y*sa).toFixed(2),(cy+x*sa+y*ca).toFixed(2)]);
      const el=document.createElementNS('http://www.w3.org/2000/svg','polygon');
      el.setAttribute('points',pts.map(p=>p.join(',')).join(' '));
      el.dataset.idx = idx;
      el.dataset.treated = 'false';
      const dmg=treatInsulatorState[phase][idx];
      const cyc=(treatCycleState[phase]&&treatCycleState[phase][idx])||0;
      const fillColor = dmg ? insShade(INS_RED_SHADES,cyc) : (cyc>0 ? insShade(INS_GREEN_SHADES,cyc-1) : 'white');
      const strokeColor = dmg ? '#9B0000' : (cyc>0 ? '#276749' : '#555');
      el.setAttribute('fill',fillColor); el.setAttribute('stroke',strokeColor); el.setAttribute('stroke-width','0.8');
      el.style.cursor=dmg?'pointer':'default';
      if(dmg) el.addEventListener('click',()=>{
        const fixed=el.dataset.treated==='true';
        el.dataset.treated = fixed?'false':'true';
        el.setAttribute('fill',fixed?insShade(INS_RED_SHADES,cyc):insShade(INS_GREEN_SHADES,cyc));
        el.setAttribute('stroke',fixed?'#9B0000':'#276749');
      });
      svg.appendChild(el);
    }
    const angL=Math.atan2(tlY-tipY,tlX-tipLX),angR=Math.atan2(trY-tipY,trX-tipRX);
    for(let i=0;i<N;i++){const t=i/(N-1); addP(tipLX+(tlX-tipLX)*t,tipY+(tlY-tipY)*t,angL,i); addP(tipRX+(trX-tipRX)*t,tipY+(trY-tipY)*t,angR,N+i);}
    return svg;
  }
  if (mode === 'straight4' || mode === 'chain4_12' || mode === 'chain2_12') {
    const totalCols = mode === 'chain2_12' ? 2 : 4;
    const rows = mode === 'straight4' ? 32 : 12;
    const colsPerGroup = totalCols / 2;
    const lineName = currentTreatRecord ? currentTreatRecord.line_name : '';
    const [stA, stB] = lineName ? lineEndpoints(lineName) : ['محطة A','محطة B'];
    const outer = document.createElement('div');
    outer.style.display='flex'; outer.style.flexDirection='column'; outer.style.alignItems='center'; outer.style.gap='4px';
    const groupsWrap = document.createElement('div'); groupsWrap.style.display='flex'; groupsWrap.style.gap='16px';
    function buildGroup(label, colOffset) {
      const gWrap=document.createElement('div'); gWrap.style.display='flex'; gWrap.style.flexDirection='column'; gWrap.style.alignItems='center'; gWrap.style.gap='4px';
      const lbl=document.createElement('div'); lbl.textContent=label;
      lbl.style.fontSize='0.68rem'; lbl.style.fontWeight='700'; lbl.style.color='#4A5568';
      lbl.style.background='#EBF0F5'; lbl.style.padding='2px 8px'; lbl.style.borderRadius='10px'; lbl.style.whiteSpace='nowrap';
      gWrap.appendChild(lbl);
      const colsWrap=document.createElement('div'); colsWrap.style.display='flex'; colsWrap.style.gap='6px';
      for(let c=0;c<colsPerGroup;c++){
        const col=c+colOffset;
        colsWrap.appendChild(buildTreatChainColumn(phase, col, rows, col*rows));
      }
      gWrap.appendChild(colsWrap);
      return gWrap;
    }
    groupsWrap.appendChild(buildGroup('🏭 جهة '+(stA||'محطة A'),0));
    groupsWrap.appendChild(buildGroup('🏭 جهة '+(stB||'محطة B'),colsPerGroup));
    outer.appendChild(groupsWrap);
    return outer;
  }
  if (mode === 'chain1_10') {
    const wrap=document.createElement('div'); wrap.className='chain-wrap';
    wrap.appendChild(buildTreatChainColumn(phase, 0, 10, 0));
    return wrap;
  }
  const cols=2, rows=mode==='chain2_10'?10:12;
  const wrap=document.createElement('div'); wrap.className='chain-wrap';
  for(let col=0;col<cols;col++){
    wrap.appendChild(buildTreatChainColumn(phase, col, rows, col*rows));
  }
  return wrap;
}

const SEVERITY_TREAT_SECTIONS = {
  insulator: { label: 'العوازل', field: 'sev_insulator' },
  iron: { label: 'تقاطعات الحديد', field: 'sev_iron', keys: ['iron'] },
  foundation: { label: 'قواعد البرج', field: 'sev_foundation', keys: ['foundation'] },
  wires: { label: 'الأسلاك', field: 'sev_wires', keys: ['wire_r1','wire_s1','wire_t1','wire_r1_c2','wire_s1_c2','wire_t1_c2'] },
  ground: { label: 'الأرضي', field: 'sev_ground', keys: ['ground_1','ground_2'] },
  fire: { label: 'مسببات الحرائق', field: 'sev_fire', keys: ['fire'] },
};

// يحدّد أي الأقسام عولجت بهذي الجلسة، وهل صار القسم سليم بالكامل (كل عناصره المفتوحة عولجت) أو لسا فيه متبقي
function getTouchedSeveritySections(r) {
  const allDeps = extractDepsFromRecord(r);
  const touched = [];

  // العوازل (الدائرة الأولى + الثانية لو خط مزدوج — الدرجة مشتركة تغطي الأسوأ بينهم)
  const wrap = document.getElementById('treatPhasesWrap');
  let insTouched = false, insResolved = true;
  if (wrap) {
    const mode = getInsulatorMode(r.voltage||132, r.tower_type||'', r.line_name||'', r.tower_number);
    const blocks = wrap.querySelectorAll('.phase-block');
    blocks.forEach((block, pi) => {
      const phase = ['R','S','T'][pi]; if (!phase) return;
      const els = mode === 'v' ? block.querySelectorAll('polygon') : block.querySelectorAll('.ins-rect');
      els.forEach(el => {
        const idx = parseInt(el.dataset.idx, 10);
        const dmg = (treatInsulatorState[phase]||[])[idx];
        const fixedNow = el.dataset.treated === 'true';
        if (dmg && fixedNow) insTouched = true;
        if (dmg && !fixedNow) insResolved = false; // باقي شي متضرر لسا
      });
    });
  }
  const wrap2 = document.getElementById('treatPhasesWrap2');
  if (wrap2) {
    const mode = getInsulatorMode(r.voltage||132, r.tower_type||'', r.line_name||'', r.tower_number);
    const blocks2 = wrap2.querySelectorAll('.phase-block');
    blocks2.forEach((block, pi) => {
      const phase = ['R','S','T'][pi]; if (!phase) return;
      const els = mode === 'v' ? block.querySelectorAll('polygon') : block.querySelectorAll('.ins-rect');
      els.forEach(el => {
        const idx = parseInt(el.dataset.idx, 10);
        const dmg = (treatInsulatorState2[phase]||[])[idx];
        const fixedNow = el.dataset.treated === 'true';
        if (dmg && fixedNow) insTouched = true;
        if (dmg && !fixedNow) insResolved = false;
      });
    });
  }
  // تبديلات كامل السلسلة (زجاج↔بلاستك) بهذي الجلسة تُعتبر "معالجة" أيضاً حتى لو ما فيها ضغط يدوي
  // على عوازل مفردة — بدون هذا السطر، تبديل سلسلة كاملة ما يُحسب "لمس" للقسم، وتبقى درجة الخطورة
  // القديمة (مثلاً "حرجة") عالقة للأبد رغم إن كل عوازلها استُبدلت فعلياً
  if (chainReplacementLog.length) insTouched = true;

  if (insTouched) touched.push({ key:'insulator', label: SEVERITY_TREAT_SECTIONS.insulator.label, field: SEVERITY_TREAT_SECTIONS.insulator.field, resolved: insResolved });

  // باقي الأقسام
  ['iron','foundation','wires','ground','fire'].forEach(sec => {
    const cfg = SEVERITY_TREAT_SECTIONS[sec];
    const sectionDeps = allDeps.filter(d => cfg.keys.includes(d.key));
    if (!sectionDeps.length) return;
    const touchedAny = sectionDeps.some(d => otherDepTreatState[d.key]);
    if (!touchedAny) return;
    const resolved = sectionDeps.every(d => otherDepTreatState[d.key]);
    touched.push({ key: sec, label: cfg.label, field: cfg.field, resolved });
  });

  return touched;
}

function renderSeverityPromptsBlock(touched) {
  const opts = [
    ['ok','🟢 سليم'], ['simple','⚪ مغادرة بسيطة'], ['moderate','🟡 مغادرة متوسطة'],
    ['below_critical','🟠 مغادرة دون الحرجة'], ['critical','🔴 مغادرة حرجة']
  ];
  return `<div id="treatSeverityPrompts" style="margin-top:18px;padding:14px;background:#FFFBEA;border:1.5px solid #F0C75E;border-radius:10px">
    <div style="font-weight:700;color:#7C5E10;margin-bottom:10px">⚠️ حدّد درجة الخطورة الجديدة بعد المعالجة لكل قسم لمسته:</div>
    ${touched.map(t => `
      <div class="field" style="margin-bottom:10px">
        <label>${t.label}</label>
        <select id="sevnew_${t.key}" data-field="${t.field}">
          <option value="">-- اختر --</option>
          ${opts.map(([v,l]) => `<option value="${v}" ${t.resolved && v==='ok' ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>`).join('')}
  </div>`;
}

async function saveTreatment() {
  if (!currentTreatRecord) return;
  const r = currentTreatRecord;

  // حراس v326 — قبل أي DOM أو تعديل محلي أو كتابة أو إرسال: id صالح، لا كشف معلّق لنفس البرج، لا عمليات معلّقة لنفس الكشف
  const blockMsg = treatmentBlockReason(r.line_name, r.tower_number, r);
  if (blockMsg) { showToast(blockMsg, 'error'); return; }

  // الخطوة 1: لو فيه أقسام عولجت بهذي الجلسة وما طلبنا منك تحدد درجتها الجديدة بعد، نطلبها أول
  const touched = getTouchedSeveritySections(r);
  const existingPrompt = document.getElementById('treatSeverityPrompts');
  if (touched.length && !existingPrompt) {
    const card = document.getElementById('treatItemsCard');
    const saveBtnRow = document.querySelector('#treatItemsCard .form-actions') || document.querySelector('#treatItemsCard .btn-primary');
    const promptHTML = renderSeverityPromptsBlock(touched);
    if (saveBtnRow && saveBtnRow.insertAdjacentHTML) saveBtnRow.insertAdjacentHTML('beforebegin', promptHTML);
    showToast('⚠️ حدّد درجة الخطورة الجديدة لكل قسم بالأسفل، ثم اضغط حفظ مرة ثانية', 'error');
    return;
  }
  if (existingPrompt) {
    const missing = touched.find(t => !document.getElementById('sevnew_'+t.key).value);
    if (missing) { showToast(`⚠️ حدّد درجة خطورة "${missing.label}" قبل الحفظ`, 'error'); return; }
  }

  const now = new Date().toISOString().split('T')[0];
  const mode = getInsulatorMode(r.voltage||132, r.tower_type||'', r.line_name||'', r.tower_number);
  const isDouble = isDoubleCircuitLine(r.line_name, r.insulator_state_2);
  const stateAfter = JSON.parse(JSON.stringify(treatInsulatorState));
  const cycleAfter = JSON.parse(JSON.stringify(treatCycleState));
  const stateAfter2 = isDouble ? JSON.parse(JSON.stringify(treatInsulatorState2)) : null;
  const cycleAfter2 = isDouble ? JSON.parse(JSON.stringify(treatCycleState2)) : null;
  // هل فعلاً انبنت واجهة تحرير هذي الدائرة بهذي الجلسة؟ لو لا (ما فيها أي مغادرة عوازل نشطة)، معناها
  // treatInsulatorState[2] ما تهيّأت من البيانات الحقيقية، فلازم لا نستخدمها لا للحفظ ولا لعرض السجل
  const circuit1Touched = !!(treatInsulatorState.R && treatInsulatorState.R.length);
  const circuit2Touched = isDouble && !!(treatInsulatorState2.R && treatInsulatorState2.R.length);
  // v335-C2: مادة سلاسل دائرة غير معروفة (لم تُحفظ) لا تُحفظ جزئياً (الترميز القديم يقرأ غير المذكور زجاجاً): كل السلاسل صراحةً أو لا شيء
  if (csFlagOn()) {
    const _per = getChainsPerPhase(mode), _bad = [];
    if (circuit1Touched && !r.insulator_chain_types && csChainsChosenCount(treatChainTypes) > 0 && !csChainsComplete(treatChainTypes, _per)) _bad.push('الأولى');
    if (circuit2Touched && !r.insulator_chain_types_2 && csChainsChosenCount(treatChainTypes2) > 0 && !csChainsComplete(treatChainTypes2, _per)) _bad.push('الثانية');
    if (_bad.length) { showToast('⛔ مادة سلاسل الدائرة ' + _bad.join(' و') + ' غير معروفة وقد بدّلتَ بعض سلاسلها فقط. بدّل كل سلاسلها أو لا تُبدّل أيّاً منها (لا تُحفظ مادة جزئية لأنها تُقرأ زجاجاً). لم يُحفظ شيء.', 'error'); return; }
  }
  const treatedIndices = { R: [], S: [], T: [] }; // مؤشرات العوازل المعالجة بهذي الجلسة (تظهر أخضر بالسجل)
  const treatedIndices2 = { R: [], S: [], T: [] };
  const items_treated = [];

  // اقرأ العوازل المعالجة (الأخضر) — الدائرة الأولى
  const wrap = document.getElementById('treatPhasesWrap');
  if (wrap) {
    const blocks = wrap.querySelectorAll('.phase-block');
    blocks.forEach((block, pi) => {
      const phase = ['R','S','T'][pi]; if (!phase) return;
      let treatedCount = 0;
      if (mode === 'v') {
        block.querySelectorAll('polygon').forEach((el) => {
          const idx = parseInt(el.dataset.idx, 10);
          if (el.dataset.treated==='true'){stateAfter[phase][idx]=false; cycleAfter[phase][idx]=((cycleAfter[phase][idx]||0)+1); treatedIndices[phase].push(idx); treatedCount++;}
        });
      } else {
        block.querySelectorAll('.ins-rect').forEach((el) => {
          const idx = parseInt(el.dataset.idx, 10);
          if(el.dataset.treated==='true'){stateAfter[phase][idx]=false; cycleAfter[phase][idx]=((cycleAfter[phase][idx]||0)+1); treatedIndices[phase].push(idx); treatedCount++;}
        });
      }
      if (treatedCount > 0) items_treated.push({key:`ins_${phase}`, label:`عوازل الفيز ${phase}`, count: treatedCount});
    });
  }

  // اقرأ العوازل المعالجة (الأخضر) — الدائرة الثانية (خطوط مزدوجة فقط)
  if (isDouble) {
    const wrap2 = document.getElementById('treatPhasesWrap2');
    if (wrap2) {
      const blocks2 = wrap2.querySelectorAll('.phase-block');
      blocks2.forEach((block, pi) => {
        const phase = ['R','S','T'][pi]; if (!phase) return;
        let treatedCount = 0;
        if (mode === 'v') {
          block.querySelectorAll('polygon').forEach((el) => {
            const idx = parseInt(el.dataset.idx, 10);
            if (el.dataset.treated==='true'){stateAfter2[phase][idx]=false; cycleAfter2[phase][idx]=((cycleAfter2[phase][idx]||0)+1); treatedIndices2[phase].push(idx); treatedCount++;}
          });
        } else {
          block.querySelectorAll('.ins-rect').forEach((el) => {
            const idx = parseInt(el.dataset.idx, 10);
            if(el.dataset.treated==='true'){stateAfter2[phase][idx]=false; cycleAfter2[phase][idx]=((cycleAfter2[phase][idx]||0)+1); treatedIndices2[phase].push(idx); treatedCount++;}
          });
        }
        if (treatedCount > 0) items_treated.push({key:`ins2_${phase}`, label:`عوازل الفيز ${phase} (الدائرة الثانية)`, count: treatedCount});
      });
    }
  }

  const _opsPure = { ins1: { R: treatedIndices.R.slice(), S: treatedIndices.S.slice(), T: treatedIndices.T.slice() }, ins2: { R: treatedIndices2.R.slice(), S: treatedIndices2.S.slice(), T: treatedIndices2.T.slice() } };   // v335-C4: المواضع المعالجة فرادى فقط (قبل إضافة مواضع تبديل السلاسل)
  // تبديلات كامل السلسلة (زجاج↔بلاستك) بهذي الجلسة: تُضاف كعنصر معالجة صريح، ومؤشراتها تُلوَّن أخضر بالأرشيف
  chainReplacementLog.forEach(entry => {
    const targetIndices = entry.circuit === 2 ? treatedIndices2 : treatedIndices;
    for (let i = entry.offsetIdx; i < entry.offsetIdx + entry.rows; i++) {
      if (!targetIndices[entry.phase].includes(i)) targetIndices[entry.phase].push(i);
    }
    items_treated.push({ key: `chainreplace_${entry.phase}_${entry.chainIdx}_${entry.circuit}`, label: entry.label });
  });

  // المغادرات الأخرى
  Object.entries(otherDepTreatState).forEach(([key, treated]) => {
    if (treated) {
      const dep = extractDepsFromRecord(r).find(d => d.key === key);
      if (dep) items_treated.push({key, label: dep.label});
    }
  });

  if (!items_treated.length) { showToast('⚠️ لم تحدد أي عنصر للمعالجة', 'error'); return; }

  // SVG عادي (للأرشيف العام: أحمر/أبيض) — يُستخدم بحقول insulator_svg_x
  function svgForMode(state) {
    if (mode === 'v') return generateVShapeSVG(state);
    if (mode === 'straight4') return generateQuadChainSVG(state, 4, 32);
    if (mode === 'chain4_12') return generateQuadChainSVG(state, 4, 12);
    if (mode === 'chain2_12') return generateQuadChainSVG(state, 2, 12);
    if (mode === 'chain2_10') return generateChainSVG(state, 2, 10);
    if (mode === 'chain1_10') return generateSingleChainSVG(state, 10);
    return generateChainSVG(state, 2, 12);
  }
  // SVG ثلاثي الألوان (لسجل المعالجات: أحمر=لسا متضرر، أخضر=عولج بهذي الجلسة، أبيض=سليم)
  // phaseChainTypes: مادة كل سلسلة بهذا الفيز (زجاج/بلاستك/خزف) — تُستخدم لرسم الشكل الصحيح بدل مربعات الزجاج دائماً
  function svg3ColorForMode(state, treatedIdx, cycleArr, phaseChainTypes) {
    const dims = mode === 'v' ? null
      : mode === 'straight4' ? [4,32]
      : mode === 'chain4_12' ? [4,12]
      : mode === 'chain2_12' ? [2,12]
      : mode === 'chain2_10' ? [2,10]
      : mode === 'chain1_10' ? [1,10]
      : [2,12];
    if (mode === 'v') return generateVShapeSVG3Color(state, treatedIdx, cycleArr);
    return generateChainSVG3Color(state, treatedIdx, dims[0], dims[1], cycleArr, phaseChainTypes);
  }
  // يبني صور الفيزات الثلاثة لدائرة معيّنة لسجل المعالجات: لو الدائرة اتلمست فعلاً هذي الجلسة نستخدم
  // بياناتها الحيّة (فيها الأخضر)، ولو لأ نبني الصورة من الحالة الحقيقية المحفوظة حالياً بسجل الكشف
  // (بدون أي أخضر، لأنه ما صار فيها شي هذي الجلسة) — هذا يضمن ظهور "حالة البرج الحالية" الصحيحة دائماً
  // بما فيها شكل البلاستك/الخزف الفعلي، حتى لو الفني ما فتح هذي الدائرة إطلاقاً
  function buildCircuitSvgs(touched, liveState, liveCycle, liveChainTypes, liveTreatedIdx, rawStateJSON, rawCycleJSON, rawChainTypesJSON) {
    let state, cycle, chainTypes, treatedIdx;
    if (touched) {
      state = liveState; cycle = liveCycle; chainTypes = liveChainTypes; treatedIdx = liveTreatedIdx;
    } else {
      state = (rawStateJSON && safeParseJSON(rawStateJSON)) || { R: [], S: [], T: [] };
      cycle = (rawCycleJSON && safeParseJSON(rawCycleJSON)) || { R: [], S: [], T: [] };
      chainTypes = (rawChainTypesJSON && safeParseJSON(rawChainTypesJSON)) || { R: [], S: [], T: [] };
      treatedIdx = { R: [], S: [], T: [] };
    }
    return {
      r: svg3ColorForMode(state.R||[], treatedIdx.R||[], cycle.R||[], chainTypes.R),
      s: svg3ColorForMode(state.S||[], treatedIdx.S||[], cycle.S||[], chainTypes.S),
      t: svg3ColorForMode(state.T||[], treatedIdx.T||[], cycle.T||[], chainTypes.T),
    };
  }
  const svgs1 = buildCircuitSvgs(circuit1Touched, treatInsulatorState, treatCycleState, treatChainTypes, treatedIndices, r.insulator_state, r.insulator_cycle, r.insulator_chain_types);
  const _svgs = { insulator_svg_r: svgs1.r, insulator_svg_s: svgs1.s, insulator_svg_t: svgs1.t };
  // صور عوازل الدائرة الثانية (خطوط مزدوجة فقط)
  if (isDouble) {
    const svgs2 = buildCircuitSvgs(circuit2Touched, treatInsulatorState2, treatCycleState2, treatChainTypes2, treatedIndices2, r.insulator_state_2, r.insulator_cycle_2, r.insulator_chain_types_2);
    _svgs.insulator_svg_r_2 = svgs2.r; _svgs.insulator_svg_s_2 = svgs2.s; _svgs.insulator_svg_t_2 = svgs2.t;
  }
  // v335-C4: لا PATCH على سجل الكشف إطلاقاً. المعالجة عملية واحدة بهوية دائمة؛ الخادم يتحقق من الشروط المسبقة على الحالة الحالية ويحسب الدورات
  const sevPicks = {};
  if (existingPrompt) touched.forEach(t => { const sel = document.getElementById('sevnew_' + t.key); if (sel && sel.value) sevPicks[t.field] = sel.value; });
  const built = opsBuildTreatment(r, { opId: genUUID(), pure: _opsPure, replLog: chainReplacementLog.slice(), otherState: Object.assign({}, otherDepTreatState), items: items_treated,
    sevPicks, svgs: _svgs, isDouble, chainTypes1: treatChainTypes, chainTypes2: treatChainTypes2, bizDate: now });
  if (built.unmapped.length) { showToast('⛔ عناصر معالجة غير معروفة التصنيف (' + built.unmapped.join('، ') + ') — لم يُحفظ شيء', 'error'); return; }

  // العرض المحلي بعد ضمان الحفظ المحلي: بلا انتظار للشبكة
  function finishLocalSave() {
    otherDepTreatState = {};
    chainReplacementLog = [];
    currentTreatRecord = null;
    try { onTreatLineChange(); } catch (e) { console.error(e); }
    const towerSel = document.getElementById('treatTower');
    if (towerSel) towerSel.value = '';
    const card2 = document.getElementById('treatItemsCard');
    if (card2) card2.style.display = 'none';
    try { if (depUI) depUI.renderLines(); } catch (e) { console.error(e); }
  }
  const btn = document.querySelector('#treatItemsCard .btn-primary');
  if (btn) btn.disabled = true;
  try {
    const rr = opsEnqueue(opsNewEntry('treatment', built.payload, {}));
    if (!rr.ok) {
      showToast(rr.reason === 'storage'
        ? '❌ لم تُحفظ المعالجة (ذاكرة الجهاز ممتلئة) ولم تُرسَل إلى السيرفر. حقولك واختياراتك باقية — حرّر مساحة واضغط حفظ ثانيةً'
        : '❌ لم تُحفظ المعالجة ولم تُرسَل: ' + (rr.reason === 'migration_refused' ? (_opsMig.msg || 'قائمة معلّقات قديمة غير قابلة للترحيل') : MSG_QUEUE_UNREADABLE) + ' اختياراتك باقية — أبلغ المسؤول', 'error');
      return;
    }
    opsApplyEntryToCache(rr.entry);
    showToast('✅ حُفظت المعالجة محلياً — لم تُؤكَّد على السيرفر بعد وستُرسل تلقائياً');
    finishLocalSave();
    opsSyncSoon();
  } finally {
    if (btn) btn.disabled = false;
  }
}

// إتاحة تعبئة قائمة الخطوط من تحميل المغادرات دون تحميل هذه الوحدة من أجلها
treatUI = { populateLines: populateTreatLines };

(window.__featModules = window.__featModules || {}).treat = true;
