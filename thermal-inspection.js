/* thermal-inspection.js — v335-C5r6
   الكشف الحراري الجديد: جلسة الخط، إدخال القياسات، حفظ القراءة الخام وقياس مدخل الخط.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند أول طلب فعلي؛ لا يعمل شيء منه عند بدء التطبيق ولا عند فتح قائمة الكشف الحراري.
   سكربت كلاسيكي: يشارك الربط العام (let/const/function) مع index.html. */
(function mount_thermalNewView() {
  // الواجهة تُركَّب عند أول تحميل للوحدة فقط (نفس المعرّفات والأحداث والتخطيط تماماً)
  const page = document.getElementById('page-thermal');
  if (!page || document.getElementById('thermalNewView')) return;
  page.insertAdjacentHTML('beforeend', `
  <div id="thermalNewView" style="display:none">
    <div class="page-title">➕ الكشف الحراري الجديد</div>

    <!-- شريط الخطوط النشطة حالياً (كشف حراري) -->
    <div class="active-lines-tabs" id="activeThermalTabs" style="display:none"></div>

    <!-- step 1: session setup -->
    <div class="form-card" id="thermalSessionForm">
      <h3>📌 بيانات الجلسة</h3>
      <div class="grid-3">
        <div class="field">
          <label>اسم الخط *</label>
          <select id="th_line_name"><option value="">-- اختر الخط --</option></select>
        </div>
        <div class="field"><label>تاريخ الكشف *</label><input type="date" id="th_date"></div>
        <div class="field"><label>درجة حرارة الجو °C *</label><input type="number" step="0.1" id="th_ambient" placeholder="مثال: 38"></div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="startThermalSession()">▶️ بدء الكشف</button>
      </div>
    </div>

    <!-- step 2: per-point readings -->
    <div id="thermalPointForm" style="display:none">
      <div class="thermal-session-summary">
        <span>📡 الخط: <b id="thSumLine"></b></span>
        <span>📅 التاريخ: <b id="thSumDate"></b></span>
        <span>🌤️ حرارة الجو: <b id="thSumAmbient"></b>°C</span>
        <button class="btn-sm btn-secondary" style="margin-right:auto" onclick="showThermalSetupForAnotherLine()">➕ كشف خط آخر</button>
        <button class="btn-sm btn-secondary" onclick="finishThermalSession()">⏹️ إنهاء الكشف</button>
      </div>
      <div class="form-card">
        <h3>📍 نقطة القياس</h3>
        <div class="field">
          <label>اختر البرج / المحطة *</label>
          <select id="th_point" onchange="onThermalPointChange()"><option value="">-- اختر --</option></select>
        </div>
      </div>
      <div class="insulator-section" id="thermalReadingsBox" style="display:none">
        <h3><img src="icon-thermal.png" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"> القياسات (°C)</h3>
        <div class="thermal-points-grid">
          <div class="thermal-phase-col">
            <div class="phase-title">الفيز R</div>
            <div class="field"><label>نقطة 1</label><input type="number" step="0.1" id="th_r1"></div>
            <div class="field"><label>نقطة 2</label><input type="number" step="0.1" id="th_r2"></div>
          </div>
          <div class="thermal-phase-col">
            <div class="phase-title">الفيز S</div>
            <div class="field"><label>نقطة 1</label><input type="number" step="0.1" id="th_s1"></div>
            <div class="field"><label>نقطة 2</label><input type="number" step="0.1" id="th_s2"></div>
          </div>
          <div class="thermal-phase-col">
            <div class="phase-title">الفيز T</div>
            <div class="field"><label>نقطة 1</label><input type="number" step="0.1" id="th_t1"></div>
            <div class="field"><label>نقطة 2</label><input type="number" step="0.1" id="th_t2"></div>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="thSaveBtn" onclick="saveThermalPoint()">✅ تم</button>
        </div>
      </div>

      <!-- فورم مدخل الخط (مختلف عن البرج العادي) -->
      <div class="insulator-section" id="lineEntryReadingsBox" style="display:none">
        <h3><img src="icon-thermal.png" style="width:18px;height:18px;vertical-align:middle;margin-left:4px"> قياسات مدخل الخط (°C)</h3>
        <div class="thermal-points-grid">
          <div class="thermal-phase-col">
            <div class="phase-title">الفيز R</div>
            <div class="field"><label>نزالات الخط</label><input type="number" step="0.1" id="le_r_landing"></div>
            <div class="field"><label>دخول صائدة الذبذبة</label><input type="number" step="0.1" id="le_r_wt_in"></div>
            <div class="field"><label>خروج صائدة الذبذبة</label><input type="number" step="0.1" id="le_r_wt_out"></div>
            <div class="field"><label>ربط Busbar</label><input type="number" step="0.1" id="le_r_busbar"></div>
          </div>
          <div class="thermal-phase-col">
            <div class="phase-title">الفيز S</div>
            <div class="field"><label>نزالات الخط</label><input type="number" step="0.1" id="le_s_landing"></div>
            <div class="field"><label>دخول صائدة الذبذبة</label><input type="number" step="0.1" id="le_s_wt_in"></div>
            <div class="field"><label>خروج صائدة الذبذبة</label><input type="number" step="0.1" id="le_s_wt_out"></div>
            <div class="field"><label>ربط Busbar</label><input type="number" step="0.1" id="le_s_busbar"></div>
          </div>
          <div class="thermal-phase-col">
            <div class="phase-title">الفيز T</div>
            <div class="field"><label>نزالات الخط</label><input type="number" step="0.1" id="le_t_landing"></div>
            <div class="field"><label>دخول صائدة الذبذبة</label><input type="number" step="0.1" id="le_t_wt_in"></div>
            <div class="field"><label>خروج صائدة الذبذبة</label><input type="number" step="0.1" id="le_t_wt_out"></div>
            <div class="field"><label>ربط Busbar</label><input type="number" step="0.1" id="le_t_busbar"></div>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="leSaveBtn" onclick="saveLineEntryPoint()">✅ تم</button>
        </div>
      </div>
    </div>
  </div>
`);
  document.getElementById('th_date').value = new Date().toISOString().split('T')[0];
  refreshThermalLineSelect();
})();

// N25-R6s: قائمة خط «كشف حراري جديد» = الخطوط المدمجة + الخطوط المُهيَّأة (line_towers_custom / lines_info) بنفس اكتشاف قائمة الكشف، بلا اشتراط تاريخ حراري سابق ولا لاحقة جهد.
// السبب الجذري: القائمة كانت تُبنى مرة واحدة عند تحميل هذه الوحدة من LINES_DATA الثابتة فقط، بلا اكتشاف للخطوط المُهيَّأة ولا إعادة بناء بعد وصول الإعدادات.
function refreshThermalLineSelect() {   // N25-R6s3: الفهرس الموحّد (lineCatalogNames) + تسجيل في مُحدِّثات القوائم
  const sel = document.getElementById('th_line_name'); if (!sel) return;
  try { registerConfiguredLineVoltages(); } catch (e) {}
  fillLineSelect(sel, { placeholder: '-- اختر الخط --' });
  try { refreshThermalPointOptions(); } catch (e) {}
}
try { registerLineSelector('thermal', refreshThermalLineSelect); } catch (e) {}
// أبراج الخط الجاري بعد وصول إعدادات جديدة (إعادة ترقيم/إدراج/إخراج): تُبنى الخيارات من الأبراج الحالية دون مسّ ما كُتب.
// N25-R6s2: النقطة المختارة وهويتها الملتقطة وقراءاتها تبقى كما هي إن بقيت هويتها وأهليتها ووصفها كما هي. وإن تغيّر شيء منها (حُذف، لم يعد برج شد، تغيّر وصفه، أو صار الرقم لبرج آخر بهوية دائمة مختلفة):
// تُحفظ القراءات المكتوبة، ويُفرَّغ الاختيار، وتظهر رسالة مراجعة، ويُمنع الحفظ حتى يختار المستخدم النقطة صراحةً من القائمة.
let _thReview = null, _thChk = null, _thChkSeq = 0;
function thermalReviewShow(msg) {
  const ptSel = document.getElementById('th_point'); if (!ptSel) return;
  let el = document.getElementById('thPickReviewNote');
  if (!el) { el = document.createElement('div'); el.id = 'thPickReviewNote'; el.setAttribute('role', 'alert'); el.style.cssText = 'margin:8px 0;padding:10px 12px;background:#FFFAF0;border:1.5px solid #F6AD55;border-radius:8px;font-size:0.82rem;color:#7B341E;line-height:1.7'; ptSel.parentNode.insertBefore(el, ptSel.nextSibling); }
  el.textContent = msg; el.style.display = msg ? 'block' : 'none';
}
function thermalReviewSet(num, why) {
  _thReview = { num, why };
  const ptSel = document.getElementById('th_point'); if (ptSel) ptSel.value = '';
  _thPickSeq++; _thPick = null;
  thermalReviewShow('⚠️ راجع اختيار البرج: القياسات التي كتبتَها لـ «برج ' + num + '» ما زالت محفوظة هنا، لكن ' + why + '. اختر النقطة الصحيحة من القائمة صراحةً (القياسات لن تُمسح) ثم احفظ — لا يُحفظ القياس على برج آخر دون اختيارك.');
}
function thermalReviewClear() { _thReview = null; thermalReviewShow(''); }
function refreshThermalPointOptions() {
  const ptSel = document.getElementById('th_point'); if (!ptSel || !currentThermalLine || !activeThermalSessions[currentThermalLine]) return;
  const form = document.getElementById('thermalPointForm'); if (!form || form.style.display === 'none') return;
  const opts = buildThermalPointOptions(currentThermalLine);
  const have = Array.prototype.map.call(ptSel.options, o => o.value + '|' + o.textContent).filter(v => v.indexOf('|') > 0 && v[0] !== '|');
  const want = opts.map(o => o.value + '|' + o.label);
  if (have.length === want.length && have.every((v, i) => v === want[i])) return;
  const prevVal = ptSel.value, prevTxt = ptSel.selectedIndex > 0 ? ptSel.options[ptSel.selectedIndex].textContent : '';
  ptSel.innerHTML = '<option value="">-- اختر --</option>' + opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  if (_thReview) return;                                  // مراجعة قائمة أصلاً: لا شيء مختار
  if (!prevVal) return;                                   // لا نقطة مختارة: لا شيء يُحمى
  const same = opts.find(o => o.value === prevVal), [kind, lab] = prevVal.split('::'), num = parseInt(lab), line = currentThermalLine;
  if (same) ptSel.value = prevVal;                        // الاختيار يبقى (بلا حدث change، فلا يُعاد تعبئة القراءات)
  if (kind === 'LINE_ENTRY') { if (!same) thermalReviewSet(lab, 'مدخل الخط هذا لم يعد في قائمة النقاط'); return; }
  if (!same) { thermalReviewSet(num, 'هذا البرج لم يعد ضمن نقاط الكشف الحراري لهذا الخط (حُذف أو لم يعد برج شد)'); return; }
  if (same.label !== prevTxt) { thermalReviewSet(num, 'تغيّر وصف/نوع هذا البرج في إعداد الخط'); return; }
  const pk = _thPick, my = ++_thChkSeq;                   // تغيّر الرقم لبرج آخر؟ تُحدَّث خريطة الهويات ثم تُقارَن الهوية الملتقطة بصاحب الرقم الآن
  const chk = (async () => {
    if (navigator.onLine) { try { await csLineIdentLoad(line); } catch (e) {} }
    if (my !== _thChkSeq || currentThermalLine !== line || document.getElementById('th_point').value !== prevVal) return;
    const cur = csIdentSnap(line, String(num), { mapOnly: true }), had = pk && pk.line === line && pk.num === num && pk.snap && pk.snap.tower_id;
    if (had) { if (!cur || cur.blocked || cur.tower_id !== pk.snap.tower_id) thermalReviewSet(num, 'رقم ' + num + ' صار الآن لبرج آخر (هوية دائمة مختلفة) أو تعذّر التحقق منه بعد تحديث الترقيم'); }
    else if (cur && cur.tower_id && !cur.blocked) thermalReviewSet(num, 'ترقيم الخط تغيّر (لم تكن هوية البرج ملتقطة وقت الاختيار)');
  })();
  _thChk = chk.finally(() => { if (_thChk === chkP) _thChk = null; }); const chkP = _thChk;
}

let thermalSession = null;   // { line_name, inspection_date, ambient_temp } -- derived from current active line
let activeThermalSessions = {};  // { line_name: { inspection_date, ambient_temp } }
let currentThermalLine = null;
try { activeThermalSessions = JSON.parse(localStorage.getItem('active_thermal_sessions') || '{}'); } catch { activeThermalSessions = {}; }

function showThermalNewImpl() {
  try { refreshThermalLineSelect(); } catch (e) {}
  pushLevel(showThermalHome);
  thermalShowView('thermalNewView');
  renderActiveThermalTabs();
  if (!currentThermalLine) {
    document.getElementById('thermalSessionForm').style.display = 'block';
    document.getElementById('thermalPointForm').style.display = 'none';
  } else {
    switchToThermalTab(currentThermalLine);
  }
}

// خطوط مدخلها من جهة واحدة فقط (الطرف الثاني تحت مسؤولية شبكة أخرى)
const SINGLE_ENTRY_LINES = [
  'واسط الحرارية - الامين رقم 1',
  'واسط الحرارية - الامين رقم 2',
  'واسط - شطرة',
  'واسط - ميسان',
  'الحي - رفاعي'
];
function isSingleEntryLine(lineName) {
  return SINGLE_ENTRY_LINES.some(name => lineName && lineName.startsWith(name));
}
function buildThermalPointOptions(lineName) {
  try { registerConfiguredLineVoltages(); } catch (e) {}   // N25-R6s: جهد الخط المُهيَّأ من «بيانات الخطوط» قبل تصفية أبراج الشد
  const towers = getLineTowers(lineName);
  const voltage = LINE_VOLTAGE[lineName];
  const [stA, stB] = lineEndpoints(lineName);
  const singleEntry = isSingleEntryLine(lineName);
  const filtered = towers.filter(t => isThermalRelevantTower(t, voltage));
  const opts = [];
  opts.push({ value: 'LINE_ENTRY::' + stA, label: '⚡ مدخل الخط — جهة ' + stA });
  filtered.forEach(t => opts.push({ value: 'TOWER::' + t.num, label: 'برج ' + t.num + ' — ' + (TOWER_TYPES[t.type] || t.type) }));
  if (!singleEntry) {
    opts.push({ value: 'LINE_ENTRY::' + stB, label: '⚡ مدخل الخط — جهة ' + stB });
  }
  return opts;
}
function persistThermalSessions() { safeSetItem('active_thermal_sessions', JSON.stringify(activeThermalSessions)); }
function startThermalSession() {
  const line = document.getElementById('th_line_name').value;
  const date = document.getElementById('th_date').value;
  const ambient = document.getElementById('th_ambient').value;
  if (!line || !date || ambient === '') { showToast('⚠️ عبّي كل الحقول (الخط، التاريخ، حرارة الجو)', 'error'); return; }

  activeThermalSessions[line] = { inspection_date: date, ambient_temp: parseFloat(ambient) };
  persistThermalSessions();
  currentThermalLine = line;
  switchToThermalTab(line);
}
function renderActiveThermalTabs() {
  const wrap = document.getElementById('activeThermalTabs');
  const lines = Object.keys(activeThermalSessions);
  if (!lines.length) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
  wrap.style.display = 'flex';
  wrap.innerHTML = lines.map(ln => {
    const isActive = ln === currentThermalLine ? ' active' : '';
    const safe = String(ln).replace(/'/g,"\\'");
    return `<div class="line-tab${isActive}">
      <span class="line-tab-name" onclick="switchToThermalTab('${safe}')">${ln}</span>
      <button class="line-tab-end" onclick="endThermalLine('${safe}')">⏹️ إنهاء</button>
    </div>`;
  }).join('');
}
function switchToThermalTab(lineName) {
  const sess = activeThermalSessions[lineName];
  if (!sess) return;
  currentThermalLine = lineName;
  thermalSession = { line_name: lineName, inspection_date: sess.inspection_date, ambient_temp: sess.ambient_temp };
  try { csLineIdentLoad(lineName); } catch (e) {}   // N25-R4: خريطة (رقم → tower_id) + نسخة الترقيم للخط؛ عند الانقطاع تبقى آخر خريطة معروفة

  document.getElementById('thSumLine').textContent = lineName;
  document.getElementById('thSumDate').textContent = sess.inspection_date;
  document.getElementById('thSumAmbient').textContent = sess.ambient_temp;

  const ptSel = document.getElementById('th_point');
  ptSel.innerHTML = '<option value="">-- اختر --</option>' +
    buildThermalPointOptions(lineName).map(o => `<option value="${o.value}">${o.label}</option>`).join('');

  document.getElementById('thermalSessionForm').style.display = 'none';
  document.getElementById('thermalPointForm').style.display = 'block';
  resetThermalReadingInputs();
  renderActiveThermalTabs();
}
function showThermalSetupForAnotherLine() {
  document.getElementById('thermalPointForm').style.display = 'none';
  document.getElementById('thermalSessionForm').style.display = 'block';
  document.getElementById('th_line_name').value = '';
  document.getElementById('th_ambient').value = '';
  document.getElementById('th_date').value = new Date().toISOString().split('T')[0];
}
function endThermalLine(lineName) {
  delete activeThermalSessions[lineName];
  persistThermalSessions();
  if (currentThermalLine === lineName) {
    const remaining = Object.keys(activeThermalSessions);
    if (remaining.length) {
      switchToThermalTab(remaining[remaining.length - 1]);
    } else {
      currentThermalLine = null;
      thermalSession = null;
      document.getElementById('thermalPointForm').style.display = 'none';
      document.getElementById('thermalSessionForm').style.display = 'block';
      document.getElementById('th_ambient').value = '';
      document.getElementById('th_date').value = new Date().toISOString().split('T')[0];
      renderActiveThermalTabs();
    }
  } else {
    renderActiveThermalTabs();
  }
  showToast('✅ تم إنهاء الكشف الحراري على هذا الخط');
}
function autoFillThermalBoxes(ids) {
  if (!thermalSession) return;
  const ambient = thermalSession.ambient_temp;
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = Math.round(ambient + 7 + Math.random() * 3);
  });
}
// N25-R4a: هوية البرج المختار تُلتقط لحظة الاختيار (مع قائمة النقاط التي جاء منها) وتبقى ثابتة حتى الحفظ؛ تحديث الخريطة أثناء التحرير لا يغيّرها،
// واختيار جديد بعد التحديث يلتقط صاحب الرقم الحالي. لا يُعاد حلّ الرقم عند الحفظ.
let _thPick = null, _thPickSeq = 0;
async function thermalCapturePick(line, label) {
  const my = ++_thPickSeq; _thPick = null;
  const num = parseInt(label); if (!line || !Number.isFinite(num)) return;
  let sn = csIdentSnap(line, String(num), { mapOnly: true });
  if (!sn && navigator.onLine) { await csLineIdentLoad(line); sn = csIdentSnap(line, String(num), { mapOnly: true }); }
  if (my !== _thPickSeq) return;                      // اختيار أحدث حلّ محلّه: ردّ متأخر يُهمل
  _thPick = { line, num, snap: sn };
}
function onThermalPointChange() {
  const v = document.getElementById('th_point').value;
  const hadReview = !!_thReview; if (v && hadReview) thermalReviewClear();   // اختيار صريح بعد رسالة المراجعة: يلتقط صاحب الرقم الحالي، والقراءات المكتوبة تبقى
  try { const [_k, _l] = v.split('::'); if (v && _k !== 'LINE_ENTRY' && thermalSession) thermalCapturePick(thermalSession.line_name, _l); else { _thPickSeq++; _thPick = null; } } catch (e) {}
  const isLineEntry = v.startsWith('LINE_ENTRY::');
  document.getElementById('thermalReadingsBox').style.display = (v && !isLineEntry) ? 'block' : 'none';
  document.getElementById('lineEntryReadingsBox').style.display = (v && isLineEntry) ? 'block' : 'none';
  if (hadReview) { /* مسودة القراءات محفوظة: لا تعبئة تلقائية فوقها */ }
  else if (v && !isLineEntry) {
    autoFillThermalBoxes(['th_r1','th_r2','th_s1','th_s2','th_t1','th_t2']);
  } else if (v && isLineEntry) {
    autoFillThermalBoxes(['le_r_landing','le_r_wt_in','le_r_wt_out','le_r_busbar',
      'le_s_landing','le_s_wt_in','le_s_wt_out','le_s_busbar',
      'le_t_landing','le_t_wt_in','le_t_wt_out','le_t_busbar']);
  }
}
function resetThermalReadingInputs() {
  ['th_r1','th_r2','th_s1','th_s2','th_t1','th_t2'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['le_r_landing','le_r_wt_in','le_r_wt_out','le_r_busbar',
   'le_s_landing','le_s_wt_in','le_s_wt_out','le_s_busbar',
   'le_t_landing','le_t_wt_in','le_t_wt_out','le_t_busbar'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('th_point').value = ''; _thPickSeq++; _thPick = null; _thChkSeq++; thermalReviewClear();
  document.getElementById('thermalReadingsBox').style.display = 'none';
  document.getElementById('lineEntryReadingsBox').style.display = 'none';
}
// N25-R4: رموز الهوية التي يرجعها الخادم لقياس حراري؛ لا إعادة إرسال تلقائي لها (القياس محفوظ للمراجعة، لا يُلصق برقم برج آخر)
const THERMAL_IDENTITY_CODES = ['identity_required', 'stale_topology_identity', 'tower_retired', 'unknown_tower_id', 'future_topology_revision'];
function thermalIdentityCode(bodyText) { for (const c of THERMAL_IDENTITY_CODES) if (String(bodyText || '').indexOf(c) >= 0) return c; return null; }
function thermalIdentityMsg(c) {
  return ({ identity_required: 'تغيّر ترقيم هذا الخط ولا تتوفر هوية البرج لهذا القياس (حدّث الصفحة وأنت متصل)', stale_topology_identity: 'رقم البرج لم يعد يخص هذا البرج بعد تغيير الترقيم',
           tower_retired: 'هذا البرج أُخرج من الخدمة', unknown_tower_id: 'هوية البرج غير معروفة للخادم', future_topology_revision: 'نسخة ترقيم الخط أحدث من علم الخادم — أعد المحاولة بعد المزامنة' })[c] || c;
}
async function saveThermalPoint() {
  if (_thChk) { try { await _thChk; } catch (e) {} }   // فحص هوية معلّق بعد تحديث الترقيم يُنهى قبل أي حفظ
  if (_thReview) { showToast('⚠️ راجع اختيار البرج أولاً: اختر النقطة صراحةً من القائمة (القراءات محفوظة)', 'error'); return; }
  const ptVal = document.getElementById('th_point').value;
  if (!ptVal) { showToast('⚠️ اختر البرج أو المحطة أولاً', 'error'); return; }

  const [kind, label] = ptVal.split('::');
  if (kind === 'LINE_ENTRY') { showToast('⚠️ استخدم نموذج مدخل الخط', 'error'); return; }
  const readings = {
    r1: document.getElementById('th_r1').value, r2: document.getElementById('th_r2').value,
    s1: document.getElementById('th_s1').value, s2: document.getElementById('th_s2').value,
    t1: document.getElementById('th_t1').value, t2: document.getElementById('th_t2').value,
  };
  const nums = Object.values(readings).filter(v => v !== '').map(parseFloat);
  if (!nums.length) { showToast('⚠️ أدخل قياس واحد على الأقل', 'error'); return; }
  const maxTemp = Math.max(...nums);

  const rec = {
    line_name: thermalSession.line_name,
    inspection_date: thermalSession.inspection_date,
    ambient_temp: thermalSession.ambient_temp,
    point_type: 'tower',
    point_label: 'برج ' + label,
    tower_number: parseInt(label),
    r1: readings.r1 === '' ? null : parseFloat(readings.r1),
    r2: readings.r2 === '' ? null : parseFloat(readings.r2),
    s1: readings.s1 === '' ? null : parseFloat(readings.s1),
    s2: readings.s2 === '' ? null : parseFloat(readings.s2),
    t1: readings.t1 === '' ? null : parseFloat(readings.t1),
    t2: readings.t2 === '' ? null : parseFloat(readings.t2),
    max_temp: maxTemp,
    created_by_name: currentUser.full_name,
    client_uuid: genUUID(),
  };
  // N25-R4: الهوية الدائمة والنسخة تُثبَّتان في السجل نفسه قبل أي إرسال/تخزين محلي؛ الرقم المسجَّل يبقى لقطة وقت الحدث
  { const pk = _thPick;       // لقطة الاختيار؛ لا قراءة لخريطة قابلة للتغيّر عند الحفظ
    if (pk && pk.line === rec.line_name && pk.num === rec.tower_number && pk.snap) {
      if (pk.snap.blocked) { showToast(csIdentBlockMsg(pk.snap.blocked), 'error'); return; }
      rec.tower_id = pk.snap.tower_id; rec.topology_rev = pk.snap.topology_rev;
    } }

  const btn = document.getElementById('thSaveBtn');
  btn.disabled = true;
  try {
    const res = await sbFetch('thermal_inspections?on_conflict=client_uuid', { method: 'POST', headers:{'Prefer':'resolution=ignore-duplicates'}, body: JSON.stringify(rec) });
    if (res.ok) showToast('✅ تم حفظ القياس — ' + rec.point_label);
    else {
      let bt = ''; try { bt = await res.text(); } catch (e) {}
      const idc = thermalIdentityCode(bt);
      if (idc) { rec._conflict = idc; addToThermalQueue(rec); showToast('⚠️ ' + thermalIdentityMsg(idc) + ' — حُفظ القياس على الجهاز ولم يُكتب على أي برج آخر', 'error'); btn.disabled = false; resetThermalReadingInputs(); return; }
      throw new Error(`HTTP ${res.status}`);
    }
  } catch {
    addToThermalQueue(rec);
    const msg = navigator.onLine ? '📦 خطأ بالإرسال، حُفظ محلياً' : '📦 حُفظ أوف لاين، سيُرسل تلقائياً';
    showToast(msg);
  }
  btn.disabled = false;
  resetThermalReadingInputs();
}
async function saveLineEntryPoint() {
  const ptVal = document.getElementById('th_point').value;
  if (!ptVal) { showToast('⚠️ اختر مدخل الخط أولاً', 'error'); return; }
  const [kind, label] = ptVal.split('::');
  if (kind !== 'LINE_ENTRY') { showToast('⚠️ خطأ بنوع النقطة', 'error'); return; }

  const fields = {
    r_landing: 'le_r_landing', r_wt_in: 'le_r_wt_in', r_wt_out: 'le_r_wt_out', r_busbar: 'le_r_busbar',
    s_landing: 'le_s_landing', s_wt_in: 'le_s_wt_in', s_wt_out: 'le_s_wt_out', s_busbar: 'le_s_busbar',
    t_landing: 'le_t_landing', t_wt_in: 'le_t_wt_in', t_wt_out: 'le_t_wt_out', t_busbar: 'le_t_busbar',
  };
  const readings = {};
  Object.entries(fields).forEach(([key, id]) => { readings[key] = document.getElementById(id).value; });

  const nums = Object.values(readings).filter(v => v !== '').map(parseFloat);
  if (!nums.length) { showToast('⚠️ أدخل قياس واحد على الأقل', 'error'); return; }
  const maxTemp = Math.max(...nums);

  const rec = {
    line_name: thermalSession.line_name,
    inspection_date: thermalSession.inspection_date,
    ambient_temp: thermalSession.ambient_temp,
    station_side: label,
    r_landing: readings.r_landing === '' ? null : parseFloat(readings.r_landing),
    r_wt_in: readings.r_wt_in === '' ? null : parseFloat(readings.r_wt_in),
    r_wt_out: readings.r_wt_out === '' ? null : parseFloat(readings.r_wt_out),
    r_busbar: readings.r_busbar === '' ? null : parseFloat(readings.r_busbar),
    s_landing: readings.s_landing === '' ? null : parseFloat(readings.s_landing),
    s_wt_in: readings.s_wt_in === '' ? null : parseFloat(readings.s_wt_in),
    s_wt_out: readings.s_wt_out === '' ? null : parseFloat(readings.s_wt_out),
    s_busbar: readings.s_busbar === '' ? null : parseFloat(readings.s_busbar),
    t_landing: readings.t_landing === '' ? null : parseFloat(readings.t_landing),
    t_wt_in: readings.t_wt_in === '' ? null : parseFloat(readings.t_wt_in),
    t_wt_out: readings.t_wt_out === '' ? null : parseFloat(readings.t_wt_out),
    t_busbar: readings.t_busbar === '' ? null : parseFloat(readings.t_busbar),
    max_temp: maxTemp,
    created_by_name: currentUser.full_name,
    client_uuid: genUUID(),
  };

  const btn = document.getElementById('leSaveBtn');
  btn.disabled = true;
  if (navigator.onLine) {
    try {
      const res = await sbFetch('line_entry_thermal?on_conflict=client_uuid', { method: 'POST', headers:{'Prefer':'resolution=ignore-duplicates'}, body: JSON.stringify(rec) });
      if (res.ok) showToast('✅ تم حفظ قياسات مدخل الخط — جهة ' + label);
      else throw new Error();
    } catch {
      addToLineEntryQueue(rec);
      showToast('📦 حُفظ محلياً، سيُرسل عند الاتصال');
    }
  } else {
    addToLineEntryQueue(rec);
    showToast('📦 حُفظ أوف لاين، سيُرسل تلقائياً');
  }
  btn.disabled = false;
  resetThermalReadingInputs();
}
function finishThermalSession() {
  if (currentThermalLine) endThermalLine(currentThermalLine);
  showThermalHome();
}
(window.__thermalModules = window.__thermalModules || {}).inspection = true;
