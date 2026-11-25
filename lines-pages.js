/* lines-pages.js — v335-C6r6 (line status: no all-lines read on open; per-line / explicit all-lines read)
   صفحتا «بيانات الخطوط» و«حالة الخطوط» وتفاصيل أبراج الخط (عرض فقط). مزوّدات البيانات (linesInfoCache، getLineTowers، calcLineHealthWithTreatments) تبقى في index.html.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
function showLinesInfoImpl() {
  pushLevel(showLinesHome);
  document.getElementById('linesHomeView').style.display = 'none';
  document.getElementById('linesInfoView').style.display = '';
  document.getElementById('linesStatusView').style.display = 'none';
  const addBtn = document.getElementById('btnAddLine');
  if (addBtn) addBtn.style.display = currentUser && currentUser.role === 'admin' ? '' : 'none';
  { const tb = document.getElementById('btnTopo'); if (tb) tb.style.display = currentUser && currentUser.role === 'admin' ? '' : 'none'; }   // N25-R6
  renderLinesInfo();
}

async function showLinesStatusImpl(tok) {
  pushLevel(showLinesHome);
  document.getElementById('linesHomeView').style.display = 'none';
  document.getElementById('linesInfoView').style.display = 'none';
  document.getElementById('linesStatusView').style.display = '';
  document.getElementById('linesStatusBody').innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  try {
    // v335-C6r6: الحالة الحيّة = شاشة الدخول لا تقرأ حالة الخطوط (لا loadTreatments ولا الخطوط الـ33)؛ كل خط يُقرأ بطلب منه أو بطلب «قراءة الكل» الصريح
    if (!csLiveEnabled()) await Promise.all([loadTreatments(), loadFullRecordsCache()]);
    if (!featEntryOk(tok)) return;   // غادر المستخدم الصفحة/تغيّرت الجلسة/طُلب غيرها أثناء الجلب: لا نرسم
    renderLinesStatus();
  } catch (err) {
    document.getElementById('linesStatusBody').innerHTML = '<div class="empty-state">⚠️ تعذر الاتصال بالخادم — تحقق من الإنترنت وحاول مرة أخرى<br><button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="showLinesStatus()">🔄 إعادة المحاولة</button></div>';
  }
}

function renderLinesInfo() {
  const filter = document.getElementById('linesInfoFilter').value;
  const body = document.getElementById('linesInfoBody');
  const data = getLinesInfoData();
  const filtered = sortLineRows(data.filter(l => filter === 'all' || String(l.voltage) === filter), l => l.name, l => l.voltage);   // N25-R6s: idx الأصلي يبقى للتعديل/الحذف
  const isAdmin = currentUser && currentUser.role === 'admin';
  if (!filtered.length) { body.innerHTML = '<div class="empty-state">لا توجد بيانات</div>'; return; }
  let html = '';
  filtered.forEach(l => {
    const idx = data.indexOf(l);
    const vc = l.voltage === 400 ? '#c0392b' : '#1a5276';
    const notes = l.notes && l.notes !== 'None' ? l.notes : '';
    const editBtns = isAdmin ? '<div style="display:flex;gap:6px"><button class="btn btn-secondary btn-sm" onclick="editLine(' + idx + ')">✏️</button><button class="btn btn-secondary btn-sm" onclick="deleteLine(' + idx + ')">🗑️</button></div>' : '';
    html += '<div class="form-card" style="margin-bottom:12px;padding:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">' +
      '<div style="font-weight:700;font-size:15px;color:#1a2e4a">' + l.name + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px"><span style="background:' + vc + ';color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">' + l.voltage + ' ك.ف</span>' + editBtns + '</div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">' +
      '<div><span style="color:#777">الطول:</span> <strong>' + (l.length||'-') + ' كم</strong></div>' +
      '<div><span style="color:#777">عدد الأبراج:</span> <strong>' + (l.towers||'-') + '</strong></div>' +
      '<div><span style="color:#777">أبراج الشد:</span> <strong>' + (l.tension_towers||'-') + '</strong></div>' +
      '<div><span style="color:#777">السعة:</span> <strong>' + (l.capacity||'-') + ' MVA</strong></div>' +
      '<div><span style="color:#777">نوع السلك:</span> <strong>' + (l.wire_type||'-') + '</strong></div>' +
      '<div><span style="color:#777">السلك الأرضي:</span> <strong>' + (l.ground_wire||'-') + '</strong></div>' +
      '<div><span style="color:#777">حدود المسؤولية:</span> <strong>' + (l.responsibility||'-') + '</strong></div>' +
      '<div><span style="color:#777">سنة الدخول:</span> <strong>' + (l.year||'-') + '</strong></div>' +
      '<div><span style="color:#777">الحالة:</span> <strong style="color:' + (l.status==='بالعمل'?'#1e8449':'#c0392b') + '">' + (l.status||'-') + '</strong></div>' +
      '</div>' +
      (notes ? '<div style="margin-top:8px;padding:8px;background:#fef9e7;border-radius:6px;font-size:12px;color:#7d6608"><strong>ملاحظة:</strong> ' + notes + '</div>' : '') +
      '</div>';
  });
  body.innerHTML = html;
}

function makeBar(pct, color, lbl) {
  return '<div style="display:flex;align-items:center;gap:10px"><div style="flex:1;background:#ecf0f1;border-radius:10px;height:18px;overflow:hidden"><div style="width:' + pct + '%;background:' + color + ';height:100%;border-radius:10px"></div></div><div style="min-width:90px;text-align:right;font-weight:700;color:' + color + ';font-size:13px">' + pct + '% — ' + lbl + '</div></div>';
}

// N24-B2a: every percentage computed from a SUBSET of towers states its denominator and the excluded count - always, including 100% / zero-excluded results.
// used = towers that entered the percentage; assessed = towers with an inspection record; total = towers of the line (null = unknown); what = the excluded reason.
function _lsDenom(used, assessed, total, what) {
  const ex = Math.max(0, assessed - used);
  let t = 'محسوبة من ' + used + ' برج من أصل ' + assessed + ' برج مكشوف — المستبعد: ' + ex + ' برج' + (ex > 0 && what ? ' (' + what + ')' : '');
  if (total != null && total > assessed) t += ' — لم يُكشف ' + (total - assessed) + ' برج من ' + total + ' في الخط';
  return t;
}
// v333: كتلة الحالة الكهربائية لدائرة واحدة. c = عنصر من health.circuits. النتيجة null تُعرض «لا يوجد تقييم مكتمل» (لا 0 ولا 100).
function renderElectricalCircuitBlock(label, c, getColor, getLbl, total) {
  // N24-B2: a circuit that is explicitly NOT applicable on every tower is shown as such - never as a missing / zero assessment
  if (c.inspected === 0 && c.notApplicable > 0) return '<div style="margin-bottom:8px"><div style="font-size:12px;color:#555;margin-bottom:4px">' + label + '</div><div style="font-size:12px;color:#7f8c8d;font-weight:700">غير منطبقة — لا دائرة ثانية على أبراج هذا الخط (' + c.notApplicable + ' برج)</div></div>';
  const bar = (c.score == null)
    ? '<div style="display:flex;align-items:center;gap:10px"><div style="flex:1;background:#ecf0f1;border-radius:10px;height:18px"></div><div style="min-width:90px;text-align:right;font-weight:700;color:#7f8c8d;font-size:13px">لا يوجد تقييم مكتمل</div></div>'
    : makeBar(c.score, getColor(c.score), getLbl(c.score));
  let note = _lsDenom(c.complete, c.inspected, total, c.incomplete > 0 ? 'غير مكتمل التقييم' : '');
  if (c.notApplicable > 0) note += ' — ' + c.notApplicable + ' برج دائرته الثانية غير منطبقة (لا تُحتسب ناقصة)';
  if (c.inferred > 0) note += ' — ' + c.inferred + ' برج نُسبت درجة أسلاكه إلى هذه الدائرة بالاستدلال من الوصف';
  return '<div style="margin-bottom:8px"><div style="font-size:12px;color:#555;margin-bottom:4px">' + label + '</div>' + bar +
    '<div style="font-size:11px;color:#7f8c8d;margin-top:3px">' + note + '</div></div>';
}

function calcLineHealth(lineName) {
  const allRec = JSON.parse(localStorage.getItem('inspections_cache') || '[]');
  const rec = allRec.filter(r => r.line_name === lineName);
  if (!rec.length) return null;
  const towers = getLineTowers(lineName);
  const coverage = towers.length > 0 ? new Set(rec.map(r => r.tower_number)).size / towers.length : 0;
  let elIss = 0, elTot = 0, mIss = 0, mTot = 0;
  rec.forEach(r => {
    ['wires_r','wires_s','wires_t','ground_r','ground_s','ground_t'].forEach(f => {
      if (r[f] != null && r[f] !== '') { elTot++; if (['خلل','ضعيف','تالف'].includes(r[f])) elIss++; }
    });
    ['iron_intersections','tower_foundations','tower_attachments'].forEach(f => {
      if (r[f] != null && r[f] !== '') { mTot++; if (['خلل','ضعيف','تالف','يحتاج صيانة'].includes(r[f])) mIss++; }
    });
  });
  const elScore = Math.round(elTot > 0 ? (1-elIss/elTot)*100 : 70);
  const mScore = Math.round(mTot > 0 ? (1-mIss/mTot)*100 : 70);
  return { coverage, electricalScore: elScore, mechanicalScore: mScore };
}

// P01-B2: رسم انتقائي لبطاقات حالة الخطوط. _ls.html = نص كل بطاقة كما رُسم آخر مرة؛ بصمة التخطيط تغطي الفلتر وترتيب الخطوط وتنبيه المعالجات وزر «قراءة الكل».
let _ls = { html: null };
function _lsLayoutSig(filter, filtered) {
  const stale = (typeof treatmentsLoadFailed !== 'undefined' && treatmentsLoadFailed) ? 1 : 0;
  return filter + '|' + stale + '|' + (csLiveEnabled() ? 1 : 0) + '|' + _csAuthGen + '|' + ((typeof currentUser !== 'undefined' && currentUser && currentUser.id) || '') + '|' + filtered.map(l => l.name + '#' + l.voltage).join('\u0001');
}
// يعيد true إذا حدّث البطاقات المتغيّرة فقط (نفس النتيجة النهائية لإعادة الرسم الكاملة)، وfalse إن لزمت إعادة رسم كاملة (تخطيط/فلتر/ترتيب/تنبيه مشترك تغيّر أو DOM غير متوقع).
// كل بطاقة تُقارَن بنصها السابق، فلا تبقى بطاقة قديمة حتى لو تغيّرت بياناتها في الخلفية.
function _lsPatchCards() {
  const fe = document.getElementById('linesStatusFilter'), body = document.getElementById('linesStatusBody');
  if (!fe || !body || !_ls.html || body.dataset.lsSig == null) return false;
  const filter = fe.value, filtered = sortLineRows(getLinesInfoData().filter(l => filter === 'all' || String(l.voltage) === filter), l => l.name, l => l.voltage);
  if (body.dataset.lsSig !== _lsLayoutSig(filter, filtered) || _ls.html.length !== filtered.length) return false;
  const nodes = Array.prototype.filter.call(body.children, e => e.hasAttribute && e.hasAttribute('data-ls-line'));
  if (nodes.length !== filtered.length) return false;
  const next = filtered.map(l => _lsCardHtml(l)), repl = [];
  for (let i = 0; i < next.length; i++) {
    if (next[i] === _ls.html[i]) continue;
    const t = document.createElement('template'); t.innerHTML = next[i];
    const el = t.content.firstElementChild; if (!el || t.content.childElementCount !== 1) return false;
    repl.push([nodes[i], el, i]);
  }
  repl.forEach(([old, el, i]) => { old.replaceWith(el); _ls.html[i] = next[i]; });
  return true;
}

// P01-B2: بطاقة خط واحد — نفس شيفرة حلقة renderLinesStatus السابقة حرفياً (أُخرجت لدالة ليُعاد رسم بطاقة واحدة)؛ أضيف فقط data-ls-line.
function _lsAttr(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function _lsCardHtml(l) {
  let html = '';
    const vc = l.voltage === 400 ? '#c0392b' : '#1a5276';
    // N25-R6s4: صف «بيانات الخطوط» يُربَط بخطه بنفس جهده فقط: «الاسم + جهد الصف ك.ف» (مدمج أو محفوظ)، ثم الاسم المجرّد لخط مُهيَّأ جهده لا يخالف جهد الصف؛ خط بجهد آخر باسم أساسي مشابه لا يُستعار.
    try { registerConfiguredLineVoltages(); } catch (e) {}
    const _nv = l.name + ' ' + Number(l.voltage) + ' ك.ف';
    const _plainOk = !!(lineTowersCache[l.name] && lineTowersCache[l.name].length) && (LINE_VOLTAGE[l.name] == null || Number(LINE_VOLTAGE[l.name]) === Number(l.voltage));
    const lineName = (LINES_DATA[_nv] || (lineTowersCache[_nv] && lineTowersCache[_nv].length)) ? _nv : (_plainOk ? l.name : null);
    if (lineName && csLiveEnabled() && !loadedLineCacheAt[lineName]) {      // لم يُقرأ بعد: ليس «لم يتم الكشف» ولا «سليم»
      html += '<div class="form-card" data-ls-line="' + _lsAttr(lineName) + '" style="margin-bottom:12px;padding:14px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">' +
        '<div style="font-weight:700;font-size:14px;color:#1a5276">' + l.name + '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="background:' + vc + ';color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">' + l.voltage + ' ك.ف</span>' +
        '<span style="background:#EDF2F7;color:#4A5568;padding:3px 10px;border-radius:20px;font-size:11px">لم تُقرأ حالته بعد</span>' +
        '<button class="btn btn-secondary btn-sm" onclick="loadLineStatusOne(\'' + lineName.replace(/'/g,"\\'") + '\')">قراءة الحالة</button></div></div></div>';
      return html;
    }
    const health = lineName ? calcLineHealthWithTreatments(lineName) : null;
    let badge, elBar, mBar, washBar;
    const getColor = s => s>=80?'#1e8449':s>=60?'#f39c12':'#c0392b';
    const getLbl = s => s>=80?'جيد':s>=60?'متوسط':'ضعيف';
    const getWashColor = pct => pct>=90?'#1e8449':pct>=60?'#f39c12':'#c0392b';
    const getWashLbl = pct => pct>=90?'نظيف':pct>=60?'يحتاج متابعة':'يحتاج غسل';
    if (!health) {
      badge = '<span style="background:#95a5a6;color:white;padding:3px 10px;border-radius:20px;font-size:11px">لم يتم الكشف</span>';
      elBar = '<div style="margin-bottom:8px"><div style="font-size:12px;color:#555;margin-bottom:4px">الحالة الكهربائية</div>' + makeBar(0, '#95a5a6', 'لم يتم الكشف') + '</div>';
      mBar = makeBar(0, '#95a5a6', 'لم يتم الكشف');
      washBar = makeBar(0, '#95a5a6', 'لم يتم الكشف');
    } else {
      const cov = Math.round(health.coverage*100);
      badge = cov>=95 ? '<span style="background:#1e8449;color:white;padding:3px 10px;border-radius:20px;font-size:11px">مكشوف بالكامل</span>' : '<span style="background:#2980b9;color:white;padding:3px 10px;border-radius:20px;font-size:11px">مكشوف (' + cov + '%)</span>';
      elBar = health.isDouble
        ? renderElectricalCircuitBlock('الحالة الكهربائية — الدائرة الأولى', health.circuits[0], getColor, getLbl, health.towersTotal) +
          renderElectricalCircuitBlock('الحالة الكهربائية — الدائرة الثانية', health.circuits[1], getColor, getLbl)
        : renderElectricalCircuitBlock('الحالة الكهربائية', health.circuits[0], getColor, getLbl, health.towersTotal);
      // N24-B2: mechanical score only from towers whose iron AND foundation are recorded; unrecorded ones are named, never scored as healthy
      const _mc = health.mechanical || { complete: 0, incomplete: 0, inspected: 0 };
      mBar = (health.mechanicalScore == null
          ? '<div style="display:flex;align-items:center;gap:10px"><div style="flex:1;background:#ecf0f1;border-radius:10px;height:18px"></div><div style="min-width:90px;text-align:right;font-weight:700;color:#7f8c8d;font-size:13px">لا يوجد تقييم مكتمل</div></div>'
          : makeBar(health.mechanicalScore, getColor(health.mechanicalScore), getLbl(health.mechanicalScore))) +
        '<div style="font-size:11px;color:#7f8c8d;margin-top:3px">' + _lsDenom(_mc.complete, _mc.inspected, health.towersTotal, 'حديده/قواعده غير مسجّلة بشدّة صالحة') + '</div>';
      // حساب مؤشر النظافة: نسبة الأبراج النظيفة
      const recs = lineName ? getLatestRecordsPerTower(lineName) : [];
      const withWash = recs.filter(r => r.insulator_washing && r.insulator_washing !== '');
      const cleanCount = withWash.filter(r => r.insulator_washing === 'clean').length;
      // N24-B2: no recorded washing state at all is unknown ("لا توجد بيانات"), never 100% clean; partial coverage is stated
      const washPct = withWash.length > 0 ? Math.round(cleanCount / withWash.length * 100) : null;
      washBar = washPct == null
        ? '<div style="display:flex;align-items:center;gap:10px"><div style="flex:1;background:#ecf0f1;border-radius:10px;height:18px"></div><div style="min-width:90px;text-align:right;font-weight:700;color:#7f8c8d;font-size:13px">لا توجد بيانات نظافة</div></div>'
        : makeBar(washPct, getWashColor(washPct), getWashLbl(washPct)) + '<div style="font-size:11px;color:#7f8c8d;margin-top:3px">' + _lsDenom(withWash.length, recs.length, health.towersTotal, 'نظافتها غير مسجّلة') + '</div>';
    }
    const _cv = lineName ? ((_csLineEnv.get(lineName) || {}).coverage) : null;   // v335-C6r6: تغطية مخزن الحالة — لا يُدّعى اكتمال تقرير ناقص
    if (_cv && _cv.complete === false) badge += ' <span style="background:#C53030;color:#fff;padding:3px 10px;border-radius:20px;font-size:11px">⚠️ تغطية غير مكتملة: ' + _cv.uninitialised + ' برج غير مهيّأ</span>';
    const clickAttr = lineName ? ` onclick="openLineTowerDetails('${lineName.replace(/'/g,"\\'")}')" style="cursor:pointer"` : '';
    html += '<div class="form-card" data-ls-line="' + _lsAttr(lineName) + '" style="margin-bottom:12px;padding:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">' +
      '<div' + clickAttr + ' style="font-weight:700;font-size:14px;color:#1a5276;' + (lineName?'text-decoration:underline;':'') + '">' + l.name + (lineName?' 🔍':'') + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="background:' + vc + ';color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">' + l.voltage + ' ك.ف</span>' + badge + '</div></div>' +
      elBar +
      '<div style="margin-bottom:8px"><div style="font-size:12px;color:#555;margin-bottom:4px">الحالة الميكانيكية</div>' + mBar + '</div>' +
      '<div><div style="font-size:12px;color:#555;margin-bottom:4px">💧 نظافة العوازل</div>' + washBar + '</div></div>';
  return html;
}

function renderLinesStatus() {
  const filter = document.getElementById('linesStatusFilter').value;
  const body = document.getElementById('linesStatusBody');
  const data = getLinesInfoData();
  const filtered = sortLineRows(data.filter(l => filter === 'all' || String(l.voltage) === filter), l => l.name, l => l.voltage);
  let html = '';
  const cardHtml = filtered.map(l => _lsCardHtml(l));
  html = cardHtml.join('');
  // v333: المعالجات المحفوظة قد تكون قديمة بعد فشل التحديث — تنبيه صريح (العلم treatmentsLoadFailed الموجود)
  const staleNote = (typeof treatmentsLoadFailed !== 'undefined' && treatmentsLoadFailed)
    ? '<div style="color:#92400E;background:#FEF3C7;border-radius:8px;padding:10px;margin-bottom:10px;font-size:12px">⚠️ تعذّر تحديث سجل المعالجات — احتساب الأسلاك يعتمد على نسخة محفوظة قد تكون قديمة.</div>' : '';
  const allBtn = csLiveEnabled() ? '<div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn btn-secondary btn-sm" id="linesStatusAllBtn" onclick="loadAllLinesStatus()">📊 قراءة حالة كل الخطوط</button><span style="font-size:0.74rem;color:#718096">اقرأ خطاً واحداً من بطاقته، أو كل الخطوط بطلب صريح.</span></div>' : '';
  body.innerHTML = staleNote + allBtn + (html || '<div class="empty-state">لا توجد بيانات</div>');
  _ls.html = cardHtml; body.dataset.lsSig = _lsLayoutSig(filter, filtered);
}

// قراءة خط واحد من مخزن الحالة ثم إعادة رسم الصفحة (طلب واحد)
async function loadLineStatusOne(lineName) {
  const tok = featTok('lpg', true);
  try { await loadLineRecordsCache(lineName, true); } catch (e) { try { showToast('⚠️ تعذّرت قراءة حالة الخط من الخادم', 'error'); } catch (e2) {} return; }
  if (!featEntryOk(tok)) return;
  if (!_lsPatchCards()) renderLinesStatus();   // P01-B2: بطاقات متغيّرة فقط عند ثبات التخطيط؛ وإلا إعادة رسم كاملة
}
// قراءة صريحة لكل الخطوط (تقرير شامل بالحالة الحالية)
async function loadAllLinesStatus() {
  const tok = featTok('lpg', true);
  const btn = document.getElementById('linesStatusAllBtn'); if (btn) { btn.disabled = true; btn.textContent = '⏳ جارٍ قراءة كل الخطوط…'; }
  try { await loadFullRecordsCache(true); } catch (e) {}
  if (!featEntryOk(tok)) return;
  renderLinesStatus();
}

// ========================
// تفاصيل أبراج الخط (الضغط على اسم الخط بحالة الخطوط)
// ========================
let currentDrilldownLine = null;

// N03-A: قائمة أبراج الخط. لقطة محفوظة صالحة (قراءة ناجحة سابقة لهذا الخط في هذه الجلسة؛ تُمسح كلها عند الخروج/تبديل الحساب) تُرسم فوراً بوسم صريح «محفوظة — قيد التحقق»،
// ثم تبقى القراءة القسرية للخادم إلزامية وهي وحدها التي ترفع الوسم. فشل القراءة/انقطاع الاتصال = وسم «آخر حالة محفوظة» لا «حالة حيّة». لا قراءة قسرية أقل ولا نافذة حداثة جديدة.
// تفاصيل البرج ونموذج الكشف لا تتأثران: كلاهما يقرأ حالة البرج الحيّة بنفسه.
let _lineListSeq = 0;
function _lineHeldAt(lineName) {
  if (!csLiveEnabled() || !CS_AUTH.token) return 0;
  const at = loadedLineCacheAt[lineName];
  if (!at) return 0;
  return Object.keys(latestRecordsIndex[lineName] || {}).length ? at : 0;   // خط بلا أي سجل محمّل لا يُعرض كلقطة (لا «لم يُكشف» من بيانات غير موجودة)
}
async function openLineTowerDetails(lineName) {
  const tok = featTok('lpg', true);
  pushLevel(backToLinesStatus);
  currentDrilldownLine = lineName; _tlScroll = null;
  document.getElementById('linesStatusView').style.display = 'none';
  document.getElementById('lineTowerListView').style.display = '';
  document.getElementById('lineTowerListTitle').textContent = '🗼 أبراج خط ' + lineName;
  if (csLiveEnabled()) {   // v335-C6r6: الخط المختار وحده (طلب واحد) — لا loadTreatments ولا بقية الخطوط
    const heldAt = _lineHeldAt(lineName);
    if (heldAt) renderLineTowerList(lineName, { state: 'pending', at: heldAt });
    else document.getElementById('lineTowerListBody').innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
    return _lineListVerify(lineName, tok, heldAt);
  }
  document.getElementById('lineTowerListBody').innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  await Promise.all([loadTreatments(), loadFullRecordsCache()]);
  if (!featEntryOk(tok)) return;
  renderLineTowerList(lineName);
}
async function _lineListVerify(lineName, tok, heldAt) {
  const seq = ++_lineListSeq;
  let res = null, failed = false;
  for (let a = 0; a < 2; a++) {        // ردّ «أقدم من قراءة طُبّقت» لا يُعدّ تحققاً: قراءة طازجة واحدة إضافية ثم وسم صريح
    try { res = await loadLineRecordsCache(lineName, true); } catch (e) { failed = true; break; }
    if (res && res.ok && !res.superseded) break;
  }
  // الاستعمال: نفس الصفحة والجلسة (featDataOk) وهذا آخر طلب تحقق وما زال هذا الخط معروضاً. فتح تفاصيل برج لا يُبطله (القائمة المخفية تبقى صحيحة الوسم)
  if (seq !== _lineListSeq || !featDataOk(tok) || currentDrilldownLine !== lineName) return;
  const verified = !failed && res && res.ok && !res.superseded;
  if (verified) { _lineListRender(lineName); return; }
  if (!heldAt && !loadedLineCacheAt[lineName]) {
    const pk = await lpkGet(lineName);   // N25-R28: لا بيانات محمّلة في هذه الجلسة (مثلاً بعد إعادة التشغيل دون اتصال): الحزمة المنزّلة إن وُجدت، بوسم «نسخة محفوظة»
    if (seq !== _lineListSeq || !featDataOk(tok) || currentDrilldownLine !== lineName) return;
    if (pk) { renderLpkList(lineName, pk); return; }
  }
  if (!heldAt && !loadedLineCacheAt[lineName]) { document.getElementById('lineTowerListBody').innerHTML = '<div class="empty-state">⚠️ تعذّرت قراءة حالة هذا الخط من الخادم — تحقق من الاتصال وحاول مرة أخرى<br><button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="retryLineTowerList()">🔄 إعادة المحاولة</button></div>'; return; }
  _lineListRender(lineName, { state: 'error', at: loadedLineCacheAt[lineName] || heldAt, offline: !navigator.onLine });
}
function _lineListRender(lineName, held) {   // الرسم البديل يحفظ موضع التمرير (استبدال اللقطة بالمحقَّق لا يقفز بالصفحة)
  const lv = document.getElementById('lineTowerListView'), vis = lv && lv.style.display !== 'none';
  const y = window.scrollY; renderLineTowerList(lineName, held);
  if (vis && Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);   // v335-C6r26: لا نمرّر الصفحة إن كانت القائمة مخفية (التفاصيل/السجل ظاهران)
}
function retryLineTowerList() {
  const lineName = currentDrilldownLine; if (!lineName || !csLiveEnabled()) return;
  const tok = featTok('lpg', true), heldAt = _lineHeldAt(lineName);
  if (heldAt) renderLineTowerList(lineName, { state: 'pending', at: heldAt });
  else document.getElementById('lineTowerListBody').innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  return _lineListVerify(lineName, tok, heldAt);
}

function backToLinesStatus() {
  _tlScroll = null;
  document.getElementById('lineTowerListView').style.display = 'none';
  document.getElementById('linesStatusView').style.display = '';
}

function backToTowerList() {
  try { if (typeof towerHistHide === 'function') towerHistHide(); } catch (e) {}
  document.getElementById('towerDetailView').style.display = 'none';
  document.getElementById('lineTowerListView').style.display = '';
  _tlScrollRestore();
}
// v335-C6r26 (P02-F2): موضع تمرير قائمة الأبراج يُحفظ عند فتح تفاصيل برج منها ويُستعاد عند العودة (سجل البرج يمرّ عبر التفاصيل فيعود للقائمة بنفس الموضع). مفتاحه الخط + وسم الجلسة؛ لا يُستعاد لخط آخر ولا بعد الخروج.
let _tlScroll = null;
function _tlScrollSave(lineName) {
  try {
    const lv = document.getElementById('lineTowerListView');
    if (lv && lv.style.display !== 'none' && currentDrilldownLine === lineName) _tlScroll = { line: lineName, y: Math.round(window.scrollY), sess: featSessionTag() };
  } catch (e) {}
}
function _tlScrollRestore() {
  const sv = _tlScroll; if (!sv || sv.line !== currentDrilldownLine || sv.sess !== featSessionTag()) return;
  const ok = () => { const lv = document.getElementById('lineTowerListView'); return _tlScroll === sv && lv && lv.style.display !== 'none' && currentDrilldownLine === sv.line; };
  const apply = () => { if (ok() && Math.abs(window.scrollY - sv.y) > 2) window.scrollTo(0, sv.y); };
  apply(); requestAnimationFrame(() => { apply(); requestAnimationFrame(apply); }); setTimeout(apply, 150); setTimeout(apply, 500);   // بعد اكتمال التخطيط؛ iOS قد يصفّر التمرير بعد إظهار العنصر
}

function renderLineTowerList(lineName, held) {
  const body = document.getElementById('lineTowerListBody');
  const towers = getLineTowers(lineName);
  const latestRecs = getLatestRecordsPerTower(lineName);
  const recByTower = {}; latestRecs.forEach(r => { recByTower[r.tower_number] = r; });

  if (!towers.length) { body.innerHTML = '<div class="empty-state">لا توجد بيانات أبراج لهذا الخط</div>'; return; }

  let html = (csLiveEnabled() ? lpkBarHtml(lineName) : '') + (typeof csLineBanner === 'function' ? csLineBanner(lineName, held) : '') + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">';
  towers.forEach(t => {
    const r = recByTower[t.num];
    let statusBadge, borderColor, completeLine = '', _openF = null;
    const _inf = (typeof csTowerInfo === 'function' && csLiveEnabled()) ? csTowerInfo(lineName, t.num) : null;
    if (!r && _inf && _inf.status === 'uninitialized') {
      statusBadge = '⚠️ غير مهيّأ'; borderColor = '#E53E3E';
    } else if (!r) {
      statusBadge = '⚪ لم يُكشف'; borderColor = '#BDC3C7';
    } else {
      const deps = extractDepsFromRecord(r);
      const allTreated = deps.length > 0 && isFullyTreated(r.id, deps, r);
      // v335-C6r9d: border colour = recorded severity (same rule/palette as the tower cards); completeness is a SEPARATE concise line; grey only for a tower never inspected
      // v335-C6r29 (N24-B1): same decision as the tower cards (towerCardLevel) - no healthy colour from absent / all-"ok" severities, unknown or unverified state, or an open defect without a matching severity
      const _rdy = csLiveEnabled() ? (hasValidInspectionId(r.id) ? csTowerCompleteness(_inf && _inf.readiness ? { readiness: _inf.readiness } : null, null, r) : 'unverified') : 'complete';
      const _ck = csKey(lineName, t.num), _card = csLiveEnabled() ? _csCards.get(_ck) : null;
      const _cinfo = csLiveEnabled() ? towerCardInfo(lineName, t.num, _card, _csMem.get(_ck), r, _rdy, !!held) : { rdy: _rdy, stale: false, comps: null, pendTreated: null };
      const _lvl = towerCardLevel(r, _cinfo);
      _openF = _cinfo.openFields || null;
      borderColor = (TOWER_LEVEL_META[_lvl] || TOWER_LEVEL_META.none).border;
      if (_cinfo.unmatchedOpen) completeLine = '🔴 ضرر مفتوح بلا درجة مطابقة';
      else if (_lvl === 'review' && _cinfo.why === 'noevidence') completeLine = '⚠️ لا دليل على السلامة — راجع التفاصيل';
      else if (_lvl === 'review' && _cinfo.why === 'simple') completeLine = '📝 درجة مسجّلة: بسيطة — الحالة غير مؤكدة';
      if (csLiveEnabled() && !_cinfo.unmatchedOpen && !(_lvl === 'review' && (_cinfo.why === 'noevidence' || _cinfo.why === 'simple'))) { completeLine = csCompletenessText(_rdy); if (_rdy === 'complete') { const _en = csEngineeringNote(_inf && _inf.readiness, _inf); if (_en) completeLine += ' · ' + _en; } }   // N24-B2
      if (!deps.length) statusBadge = (csLiveEnabled() && (_rdy !== 'complete' || _lvl === 'review')) ? '⚪ لا مغادرات معروفة' : '✅ سليم';
      else if (allTreated) statusBadge = (csLiveEnabled() && (_rdy !== 'complete' || _lvl === 'review')) ? '✅ المعروف معالج' : '✅ معالج';
      else statusBadge = '🔴 مغادرات';
    }
    const catIconsHTML = buildCategoryIconsHTML(r, _openF);
    html += `<div onclick="openTowerDetail('${lineName.replace(/'/g,"\\'")}','${t.num}')"
      style="cursor:pointer;border:2px solid ${borderColor};border-radius:10px;padding:10px;text-align:center;background:white;position:relative">
      ${catIconsHTML}
      <div style="font-weight:700;color:#1a2e4a;font-size:0.9rem">برج ${t.num}</div>
      <div style="font-size:0.72rem;color:#718096;margin:2px 0">${t.type||''}</div>
      <div style="font-size:0.78rem;font-weight:700">${statusBadge}</div>
      ${held ? `<div class="tower-box-complete" data-held="1" style="font-size:0.68rem;color:#92400E;margin-top:2px">${held.state === 'pending' ? '📴 محفوظة — قيد التحقق' : '📴 آخر حالة محفوظة'}</div>` : ''}
      ${completeLine ? `<div class="tower-box-complete" style="font-size:0.7rem;color:#975A16;margin-top:2px">${completeLine}</div>` : ''}
    </div>`;
  });
  html += '</div>';
  body.innerHTML = html;
  if (csLiveEnabled()) lpkBarRefresh(lineName);
}

// ========================
// صفحة تفاصيل برج واحد (مزيج الكشف + المعالجات)
// ========================
let _towerDetailCtx = null;   // v335-C6r9: { line, tower, live } of the last detail read (live = confirmed by the server in this open; false = held copy)
// N25-R6: إدارة ترقيم الأبراج ومواصفات البرج (مدير فقط). التسجيل في FEAT_MODULE_SRC هنا أيضاً لأن هذه الوحدة قد تُحمَّل داخل صفحة index.html أقدم.
function _topoReg() { try { if (typeof FEAT_MODULE_SRC === 'object' && !FEAT_MODULE_SRC.topo) FEAT_MODULE_SRC.topo = './topology-admin.js'; } catch (e) {} }
function openTopoAdmin() {
  if (!(currentUser && currentUser.role === 'admin')) { showToast('هذه الأداة للمدير فقط', 'error'); return; }
  _topoReg(); return featRun(['topo'], () => topoOpenImpl(''), 'topo');
}
function openTowerSpec(lineName, towerNum) {
  if (!(currentUser && currentUser.role === 'admin')) { showToast('تعديل المواصفات للمدير فقط', 'error'); return; }
  _topoReg(); return featRun(['topo'], () => topoSpecOpenImpl(lineName, String(towerNum)), 'topo');
}
// v335-C6r24 (P02): سجل البرج — وحدة تُحمَّل عند الضغط فقط؛ للقراءة فقط
function openTowerHistory(lineName, towerNum) {
  // v335-C6r25 (P02-F1): هذه الوحدة قد تُحمَّل من الكاش الجديد داخل صفحة مفتوحة من index.html قديم (skipWaiting + claim) فتغيب 'thist' عن خريطة الوحدات؛ نسجّلها هنا (تعديل في الذاكرة فقط) بدل الفشل
  try { if (typeof FEAT_MODULE_SRC === 'object' && !FEAT_MODULE_SRC.thist) { FEAT_MODULE_SRC.thist = './tower-history.js'; FEAT_MODULE_DEPS.thist = ['hist']; } } catch (e) {}
  return featRun(['thist'], () => towerHistOpen(lineName, towerNum), 'thist');
}

// N25-R26: لقطة تفاصيل برج صالحة للعرض الفوري فقط (من الكاش الموجود، بلا أي طلب إضافي). تُقبل فقط إذا: مفتاح الحساب الحالي (الكاش لكل حساب ويُمسح عند الخروج)،
// غلاف صالح لنفس الخط والبرج بتفاصيل تشغيلية، وهوية/نسخة الترقيم مطابقة لنسخة الخط المعروفة الآن (برج بهويته في خريطة الخط؛ أو صفر مثبَت). غير ذلك: null = حالة التحميل المعتادة.
let _tdOpenSeq = 0;
function _tdSnapshotFor(lineName, towerNum) {
  try {
    if (!csLiveEnabled() || !currentUser || !CS_AUTH || !CS_AUTH.token) return null;
    const ent = _csMem.get(csKey(lineName, towerNum)), env = ent && ent.env;
    if (!env || ent.line !== lineName || String(ent.tower) !== String(towerNum) || !csEnvValid(env, lineName, towerNum)) return null;
    if (env.resolution !== 'resolved' || env.basis !== 'operations' || !Array.isArray(env.components) || !env.row || typeof env.row !== 'object') return null;
    if (env.status === 'uninitialized' || env.status === 'no_source' || !hasValidInspectionId(env.row.id)) return null;
    const known = csKnownRev(lineName); if (known == null) return null;
    if ((Number(env.topology_rev) || 0) !== known) return null;
    if (known > 0) { const m = csMap(lineName); if (!m || !env.tower_id || String(m.byNum[String(towerNum)]) !== String(env.tower_id)) return null; }
    return env;
  } catch (e) { return null; }
}
async function openTowerDetail(lineName, towerNum) {
  const tok = featTok('lpg', true);
  _tlScrollSave(lineName);
  pushLevel(backToTowerList);
  try { if (typeof towerHistHide === 'function') towerHistHide(); } catch (e) {}
  document.getElementById('lineTowerListView').style.display = 'none';
  document.getElementById('towerDetailView').style.display = '';
  document.getElementById('towerDetailTitle').textContent = `🗼 ${lineName} — برج ${towerNum}`;
  document.getElementById('towerDetailBody').innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  // v335-C6r2: برج واحد = قراءة حالة هذا البرج وحدها (لا loadTreatments ولا إعادة تحميل خط/خطوط). المعالجة تأتي من حالة البرج نفسها.
  if (csLiveEnabled()) {
    const mySeq = ++_tdOpenSeq;
    let previewed = false;
    if (_tdSnapshotFor(lineName, towerNum)) {   // N25-R26: لقطة صالحة تُعرض فوراً (للعرض فقط)، والقراءة الحيّة أدناه نفسها دون طلب إضافي
      _towerDetailCtx = { line: lineName, tower: String(towerNum), live: false, verifying: true };
      try { renderTowerDetail(lineName, towerNum); previewed = true; } catch (e) { previewed = false; document.getElementById('towerDetailBody').innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>'; }
    }
    let f = null; try { f = await _fetchFullTowerRecord(lineName, towerNum); } catch (e) { f = null; }
    if (!featEntryOk(tok) || mySeq !== _tdOpenSeq) return;
    const live = !!(f && f.ok && f.cs && f.cs.ok && f.cs.source !== 'cache');
    _towerDetailCtx = { line: lineName, tower: String(towerNum), live };
    if (live) _applyConfirmedTowerEnv(lineName, towerNum, f.cs.env);
    else if (!previewed && !(f && f.ok && f.record) && await (async () => {   // N25-R28: لا حالة محمّلة لهذا البرج (خارج آخر 40 / بعد إعادة التشغيل): الحزمة المنزّلة للعرض فقط
      const pe = await lpkEnvFor(lineName, towerNum);
      if (!featEntryOk(tok) || mySeq !== _tdOpenSeq) return 'gone';
      if (!pe) return false;
      _towerDetailCtx = { line: lineName, tower: String(towerNum), live: false, pack: true };
      if (pe.blocked) document.getElementById('towerDetailBody').innerHTML = lpkBannerHtml(pe.pk) + '<div class="empty-state">⚠️ ترقيم الخط تغيّر بعد تنزيل الحزمة — حدّثها وأنت متصل</div>';
      else renderTowerDetail(lineName, towerNum, pe);
      return 'done';
    })()) return;
    else if (previewed) { try { showToast('⚠️ تعذّر التحقق من الخادم — المعروض لقطة محفوظة لم تُؤكَّد', 'error'); } catch (e) {} }   // تبقى اللقطة بوسم «لم تُؤكَّد» (يُعاد الرسم بالوسم غير المتحقَّق)
    else if (!getLatestRecordForTower(lineName, towerNum)) {
      document.getElementById('towerDetailBody').innerHTML = '<div class="empty-state">⚠️ تعذّرت قراءة حالة هذا البرج من الخادم — تحقق من الاتصال وحاول مرة أخرى</div>';
      return;
    } else { try { showToast('⚠️ تعذّرت القراءة الحيّة — المعروض من آخر ما حُمّل على الجهاز', 'error'); } catch (e) {} }
  } else {
    await Promise.all([loadTreatments(), loadFullRecordsCache()]);
  }
  if (!featEntryOk(tok)) return;
  renderTowerDetail(lineName, towerNum);
}

function renderTowerDetailLegacy(lineName, towerNum) {
  const body = document.getElementById('towerDetailBody');
  const latestRecs = getLatestRecordsPerTower(lineName);
  const r = latestRecs.find(x => String(x.tower_number) === String(towerNum));

  if (!r) { body.innerHTML = '<div class="empty-state">لم يتم كشف هذا البرج بعد</div>'; return; }

  const voltage = r.voltage || LINE_VOLTAGE[lineName] || 132;
  const mode = getInsulatorMode(voltage, r.tower_type||'', lineName, r.tower_number);
  const [stA, stB] = lineEndpoints(lineName);

  let html = `<div class="form-card" style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div style="font-weight:700;color:#1a2e4a">📋 آخر كشف</div>
      <div style="font-size:0.78rem;color:#718096">📅 ${r.inspection_date} | 👤 ${r.created_by_name||'—'}</div>
    </div>
    <div style="font-size:0.85rem;color:#4A5568;margin-top:6px">نوع البرج: <strong>${TOWER_TYPES[r.tower_type]||r.tower_type||'—'}</strong> | الجهد: <strong>${voltage} ك.ف</strong></div>
  </div>`;

  // العوازل التفاعلية (للعرض فقط — readonly)
  if (r.insulator_state) {
    let state;
    state = safeParseJSON(r.insulator_state);
    if (state) {
      // مستوى الدورة + المعالَج يُقرآن مباشرة من السجل (يعكسان الحقيقة الحالية الفعلية دائماً)
      let insCycle = {R:[],S:[],T:[]};
      if (r.insulator_cycle) { insCycle = safeParseJSON(r.insulator_cycle) || {R:[],S:[],T:[]}; }
      const treatedIdx = getInsulatorTreatedIdx(state, insCycle);

      html += `<div class="form-card" style="margin-bottom:14px">
        <h3>🔘 العوازل</h3>
        <div class="insulator-legend" style="margin-bottom:10px">
          <div class="legend-item"><div class="legend-box ok"></div><span>سليم</span></div>
          <div class="legend-item"><div class="legend-box dmg"></div><span>متضرر</span></div>
          <div class="legend-item"><div style="width:16px;height:12px;border-radius:2px;border:1.5px solid #276749;background:#48BB78;display:inline-block;vertical-align:middle"></div><span style="margin-right:4px">تمت معالجته</span></div>
        </div>
        <div id="towerDetailInsulators" style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center"></div>
      </div>`;

      setTimeout(() => renderTowerDetailInsulators(state, treatedIdx, mode, stA, stB, null, insCycle), 10);
    }
  }

  // باقي عناصر الكشف (نص) مع حالة المعالجة
  const textFields = [
    ['iron_intersections', 'تقاطعات الحديد'],
    ['tower_foundations', 'قواعد البرج'],
    ['tower_attachments', 'ملحقات البرج'],
    ['wires_r1', 'أسلاك R'], ['wires_s1', 'أسلاك S'], ['wires_t1', 'أسلاك T'],
    ['ground_1', 'الأرضي 1'], ['ground_2', 'الأرضي 2'],
    ['fire_causes', 'مسببات الحرائق', 'fire_causes_notes'],
    ['road_access', 'الطريق', 'road_access_notes'],
    ['notes', 'ملاحظات']
  ];
  html += `<div class="form-card"><h3>📝 تفاصيل الكشف</h3><div style="display:flex;flex-direction:column;gap:8px">`;
  let hasAny = false;
  textFields.forEach(([field, label, notesField]) => {
    let val = r[field];
    const notesVal = notesField ? r[notesField] : null;
    if (field === 'fire_causes' && val === 'لا يوجد') val = '';
    if (field === 'road_access' && val === 'متاح') val = '';
    if (val === 'سليم') val = '';
    // لو القائمة المنسدلة فاضية بس فيه ملاحظة مكتوبة، نعرض الملاحظة بدلها
    const display = val && notesVal ? `${val} — ${notesVal}` : (val || notesVal);
    if (!display) return;
    hasAny = true;
    const key = field === 'iron_intersections' ? 'iron' : field === 'tower_foundations' ? 'foundation' : field === 'tower_attachments' ? 'attachment' :
      field.startsWith('wires_') ? 'wire_' + field.replace('wires_','') : field;
    const treated = isTreatedInDB(r.id, key);
    const color = treated ? '#48BB78' : '#FC4444';
    const icon = treated ? '✅' : '🔴';
    html += `<div style="display:flex;justify-content:space-between;align-items:start;gap:8px;padding:8px;background:#F8FAFC;border-radius:8px;border-right:3px solid ${color}">
      <div><strong style="color:#2E4057">${label}:</strong> <span style="color:#4A5568">${display}</span></div>
      <span style="font-size:0.78rem;font-weight:700;color:${color};white-space:nowrap">${icon} ${treated?'معالج':'قيد المعالجة'}</span>
    </div>`;
  });
  if (!hasAny) html += '<div class="empty-state" style="padding:10px">لا توجد ملاحظات نصية مسجّلة — لا يُستدل من ذلك على سلامة البرج (الحالة التفصيلية غير متاحة)</div>';
  html += '</div></div>';

  body.innerHTML = html;
}

// =====================================================================================================================================================
// v335-C6r9: tower detail from the AUTHORITATIVE current state (one selected-tower envelope: components + meta + source row).
//  * both applicable circuits are drawn (damage + treated cycles); an unknown phase / unknown circuit applicability / unknown cycles / unknown materials is LABELLED, never drawn as
//    healthy, never given invented glass / zero cycles / a circuit count;
//  * text sections take their status (open / treated / ok / unknown) from the components (+ pending overlays); the loaded treatment log is never consulted;
//  * the footer claims "no recorded observations" only when every applicable section is known.
// =====================================================================================================================================================
const TD_SECTIONS = [
  ['iron', 'تقاطعات الحديد', 'iron_intersections'], ['foundation', 'قواعد البرج', 'tower_foundations'], ['attachment', 'ملحقات البرج', 'tower_attachments'],
  ['wire_r1', 'أسلاك R', 'wires_r1'], ['wire_s1', 'أسلاك S', 'wires_s1'], ['wire_t1', 'أسلاك T', 'wires_t1'],
  ['wire_r1_c2', 'أسلاك R (الدائرة 2)', 'wires_r1_c2'], ['wire_s1_c2', 'أسلاك S (الدائرة 2)', 'wires_s1_c2'], ['wire_t1_c2', 'أسلاك T (الدائرة 2)', 'wires_t1_c2'],
  ['ground_1', 'الأرضي 1', 'ground_1'], ['ground_2', 'الأرضي 2', 'ground_2'],
  ['fire', 'مسببات الحرائق', 'fire_causes_notes'], ['road', 'الطريق', 'road_access', 'road_access_notes'], ['washing', 'نظافة العوازل', 'insulator_washing']
];
const TD_FIRE_SEV = { simple: 'مغادرة بسيطة', moderate: 'مغادرة متوسطة', below_critical: 'مغادرة دون الحرجة', critical: 'مغادرة حرجة' };
const TD_WASH = { needs_washing: 'يحتاج غسل', very_dirty: 'ملوثة جداً', clean: 'نظيفة' };

// pure: no DOM, no globals except the optional overlay callbacks in opts
function towerDetailModel(env, opts) {
  opts = opts || {};
  const comps = {}; (Array.isArray(env.components) ? env.components : []).forEach(c => { if (c && typeof c.k === 'string') comps[c.k] = c; });
  const row = env.row && typeof env.row === 'object' ? env.row : {}, meta = env.meta || {};
  const circuits = [1, 2].map(n => {
    const pre = n === 1 ? 'ins_' : 'ins2_', phases = {};
    // N25-R8: circuit 2 is single by the project rule (all 400 kV, 132 kV single lines) - the SERVER already resolved it in meta.circuits (read-time overlay of the same rule). Stored circuit-2 rows that were seeded «unknown» and never
    // held data follow that resolution; a row with recorded data (known / invalid) is never overridden. No guess: only the server's own resolution is used.
    const c2single = n === 2 && !!(meta.circuits && meta.circuits.circuit2_applicability === 'not_applicable');
    ['R', 'S', 'T'].forEach(ph => {
      const c = comps[pre + ph];
      if (c2single && (!c || (c.ap === 'unknown' && c.ds !== 'known' && c.ds !== 'invalid'))) { phases[ph] = { state: 'not_applicable', ap: 'not_applicable', fromMeta: true }; return; }
      if (!c) phases[ph] = { state: 'unknown', ap: null };
      else if (c.ap === 'not_applicable') phases[ph] = { state: 'not_applicable', ap: c.ap };
      else if (c.ds !== 'known' || !c.v || !_tdBoolArr(c.v.damaged)) phases[ph] = { state: 'unknown', ap: c.ap, flags: c.fl || [], invalid: c.ds === 'known' };   // known-but-malformed damage arrays are NOT drawn and NOT read as healthy
      else {
        const cy = c.v.cycle, okCy = Array.isArray(cy) && cy.length === c.v.damaged.length && cy.every(x => Number.isInteger(x) && x >= 0);
        const dm = c.v.damaged, openN = dm.filter(Boolean).length, badCnt = c.v.damaged_count !== undefined && c.v.damaged_count !== null && c.v.damaged_count !== openN;   // N24-B3B: the authoritative damaged[] gives the CURRENT open count; a disagreeing damaged_count is not shown as a number
        // N25-R8: the treated positions of the CURRENT state (component value.treated_positions) - used when present and valid; only an older row without it falls back to the cycle inference below
        const tp = Array.isArray(c.v.treated_positions) && c.v.treated_positions.every(i => Number.isInteger(i) && i >= 0 && i < dm.length) ? Array.from(new Set(c.v.treated_positions)).filter(i => !dm[i]).sort((a, b) => a - b) : null;
        phases[ph] = { state: 'known', ap: c.ap, cond: c.cond, damaged: dm, cycle: okCy ? cy : null, cycleState: okCy ? 'ok' : (cy == null ? 'missing' : 'invalid'), flags: c.fl || [], treated: tp,
          openCount: badCnt ? null : openN, total: dm.length,
          recurrent: okCy ? dm.filter((d, i) => d && cy[i] > 0).length : null,       // damaged now AND a recorded replacement cycle at the same position (when it happened is NOT known)
          priorOk: okCy ? dm.filter((d, i) => !d && cy[i] > 0).length : null };      // sound now with a recorded replacement cycle (NOT proven to belong to any damage episode)   // a missing / malformed cycle never becomes zero or "treated"
      }
    });
    const aps = ['R', 'S', 'T'].map(ph => phases[ph].state === 'not_applicable' ? 'not_applicable' : (phases[ph].ap === 'applicable' ? 'applicable' : 'unknown'));
    const applicability = n === 1 ? 'applicable' : (aps.every(a => a === 'not_applicable') ? 'not_applicable' : aps.every(a => a === 'applicable') ? 'applicable' : 'unknown');
    const mm = meta.materials && typeof meta.materials === 'object' ? (n === 2 ? meta.materials.circuit2 : meta.materials.circuit1) : null;
    const ms = mm && typeof mm === 'object' && typeof mm.status === 'string' ? mm.status : null;
    // 'complete' = every phase explicitly saved; 'legacy_interpretable' = implicit legacy convention (not an observation); anything else, or no meta at all = unknown
    const materialsState = ms === 'complete' ? 'known' : ms === 'legacy_interpretable' ? 'legacy' : 'unknown';
    return { n, applicability, phases, materialsState, materialsUnknown: materialsState !== 'known' };
  });
  const sections = [], unknown = [], gaps = []; let open = 0, treated = 0, priorIns = 0, textTreated = 0;   // unknown = applicable sections without a known value; gaps = provenance of what IS known (cycles, materials) - kept separate from observed damage
  circuits.forEach(c => {
    if (c.applicability === 'unknown') { unknown.push('انطباق الدائرة ' + c.n); return; }
    if (c.applicability !== 'applicable') return;
    const unk = ['R', 'S', 'T'].filter(ph => c.phases[ph].state !== 'known');
    if (unk.length) unknown.push('عوازل الدائرة ' + c.n + ' (' + unk.join('، ') + ')');
    const noCy = ['R', 'S', 'T'].filter(ph => c.phases[ph].state === 'known' && !c.phases[ph].cycle);
    if (noCy.length) gaps.push('دورات المعالجة غير معروفة/غير صالحة — الدائرة ' + c.n + ' (' + noCy.join('، ') + ')');
    if (c.materialsState === 'unknown') gaps.push('مادة سلاسل الدائرة ' + c.n + ' غير معروفة');
    else if (c.materialsState === 'legacy') gaps.push('مادة سلاسل الدائرة ' + c.n + ' غير مؤكدة (عرف قديم لا رصد فعلي)');
    ['R', 'S', 'T'].forEach(ph => { const x = c.phases[ph]; if (x.state === 'known') { if (x.cond === 'defect') open++; else if (x.cond === 'treated') { treated++; priorIns++; } } });
  });
  const c2on = circuits[1].applicability === 'applicable';
  TD_SECTIONS.forEach(([k, label, field, notesField]) => {
    if (/_c2$/.test(k) && !c2on) return;
    const c = comps[k];
    if (!c) { if (k !== 'attachment') unknown.push(label); return; }
    if (c.ap === 'not_applicable') return;
    if (c.ds !== 'known') { if (k !== 'attachment') unknown.push(label); return; }
    let state = c.cond === 'defect' ? 'open' : c.cond === 'treated' ? 'treated' : 'ok';
    if (state === 'open' && opts.pendingTreated && opts.pendingTreated(k)) state = 'treated';
    else if (state === 'treated' && opts.pendingObserved && opts.pendingObserved(k)) state = 'open';
    if (state === 'ok') return;
    let display = row[field], notes = notesField ? row[notesField] : null;
    if (k === 'fire') display = [TD_FIRE_SEV[row.sev_fire] || row.sev_fire, row.fire_causes_notes].filter(Boolean).join(' — ');
    else if (k === 'washing') display = TD_WASH[display] || display;
    else if (display && notes) display = display + ' — ' + notes;
    else if (!display) display = notes;
    const pend = (c.cond === 'defect' && state === 'treated') ? 'treated' : (c.cond === 'treated' && state === 'open') ? 'observed' : null;   // N24-B3B: a queued local operation changed this line - labelled, never presented as confirmed
    sections.push({ k, label, state, pend, display: display || '' });
    if (state === 'open') open++; else { treated++; textTreated++; }
  });
  return { circuits, sections, unknown, gaps, open, treated, priorIns, textTreated, footer: open > 0 ? 'open' : (unknown.length || gaps.length) ? 'unknown' : treated > 0 ? 'treated' : 'clear' };   // 'clear' only when every applicable section AND its cycles/materials are known
}

function _tdBoolArr(a) { return Array.isArray(a) && a.length > 0 && a.every(x => typeof x === 'boolean'); }
function _tdEsc(v) { return (typeof _csEsc === 'function') ? _csEsc(v) : String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

// N24-B3B: exact CURRENT open counts per phase from the authoritative damaged[]; recorded replacement cycles are history of the POSITION only - never of the current damage.
function _tdPhaseLines(c) {
  return ['R', 'S', 'T'].map(ph => {
    const x = c.phases[ph], st = 'font-size:0.82rem;padding:2px 0;';
    if (x.state !== 'known') return '<div style="' + st + 'color:#7B341E">الفيز ' + ph + ': ' + ((x.flags || []).indexOf('equipment_replaced') >= 0 ? 'غير معروف — المعدّة استُبدلت ولم تُكشف بعد' : 'غير مسجّل') + '</div>';
    let t = 'الفيز ' + ph + ': ' + (x.openCount == null ? '<span style="color:#7B341E">عدد المتضرر غير متّسق مع المصفوفة — لا يُعرض رقم</span>' : '<strong>' + x.openCount + '</strong> موضع متضرر مفتوح حالياً من ' + x.total);
    if (x.cycle) {
      if (x.recurrent > 0) t += ' — <span style="color:#9B2C2C">' + x.recurrent + ' منها متضرر مجدداً في موضع استُبدل سابقاً (دورة مسجّلة، دون تحديد وقت حدوثه)</span>';
      if (x.treated) { if (x.treated.length > 0) t += ' — <span style="color:#276749"><strong>' + x.treated.length + '</strong> موضع معالَج (مواضع ' + x.treated.map(i => i + 1).join('، ') + ')</span>'; }
      else if (x.priorOk > 0) t += ' — ' + x.priorOk + ' موضع سليم الآن وله دورة استبدال مسجّلة سابقاً (لا يُعرف ضمن أي ضرر)';
    } else t += (x.treated && x.treated.length ? ' — <span style="color:#276749"><strong>' + x.treated.length + '</strong> موضع معالَج</span>' : '') + ' — <span style="color:#7B341E">الدورات غير معروفة: لا يمكن تمييز الاستبدال السابق أو تكرار الضرر</span>';
    if ((x.flags || []).indexOf('equipment_replaced') >= 0) t += ' — <span style="color:#2B6CB0">معدّة مستبدلة (حالتها مسجّلة عند الاستبدال)</span>';
    return '<div style="' + st + '">' + t + '</div>';
  }).join('');
}

// N25-R6w: «نوع البرج» في التفاصيل = المواصفات الحالية المعتمدة للبرج (بعد أي تصحيح)، لا نوع آخر كشف قديم؛ سجل الكشف نفسه يبقى كما سُجّل
function _tdCurrentType(lineName, towerNum) {
  try { const t = getLineTowers(lineName).find(x => String(x.num) === String(towerNum)); return t && t.type ? t.type : null; } catch (e) { return null; }
}
function renderTowerDetail(lineName, towerNum, pk) {   // pk (N25-R28) = { pk, env } من حزمة الخط المنزّلة: عرض فقط بوسم «نسخة محفوظة»؛ لا تُلمس به كاشات الحالة
  const body = document.getElementById('towerDetailBody');
  if (!(typeof csLiveEnabled === 'function' && csLiveEnabled())) return renderTowerDetailLegacy(lineName, towerNum);
  const ent = pk ? { env: pk.env } : _csMem.get(csKey(lineName, towerNum)), env = ent && ent.env;
  const msg = t => { body.innerHTML = (pk ? lpkBannerHtml(pk.pk) : '') + '<div class="empty-state">' + t + '</div>'; };
  if (!env) return msg('⚠️ حالة هذا البرج غير متاحة حالياً (لم تُقرأ من الخادم ولا يوجد نسخة محفوظة)');
  if (env.status === 'uninitialized') return msg('⚠️ حالة هذا البرج لم تُهيّأ بعد' + (env.failed ? ' (فشلت التهيئة)' : '') + ' — يلزم إجراء المدير؛ لا تُعرض حالة مستنتجة من التاريخ');
  if (env.resolution === 'no_source' || env.status === 'no_source') {
    msg('لم يُكشف هذا البرج بعد (لا يوجد كشف معتمد في الحالة الحالية)');
    if (!pk) { try {   // N25-R34: برج نشط لم يُكشف بعد يبقى قابلاً لالتقاط موقعه (الموقع لا يتبع الكشف)
      body.insertAdjacentHTML('beforeend', '<div id="towerLocCard" style="margin-top:14px"></div>');
      const c0 = _towerDetailCtx && _towerDetailCtx.line === lineName && _towerDetailCtx.tower === String(towerNum) ? _towerDetailCtx : null, sn0 = csIdentSnap(lineName, towerNum);
      towerLocCardMount({ line: lineName, number: String(towerNum), ident: sn0 || null, live: !!(c0 && c0.live), uid: (currentUser && currentUser.id != null) ? String(currentUser.id) : null });
    } catch (e) { console.warn('[tower-app] loc card', e); } }
    return;
  }
  if (env.basis !== 'operations' || !Array.isArray(env.components) || !env.row || typeof env.row !== 'object') return msg('⚠️ تفاصيل هذا البرج غير متاحة حالياً (قراءة تفصيلية غير مكتملة) — تحقق من الاتصال وأعد الفتح');
  const ctx = !pk && _towerDetailCtx && _towerDetailCtx.line === lineName && _towerDetailCtx.tower === String(towerNum) ? _towerDetailCtx : null;
  const r = env.row, iid = r.id;
  const model = towerDetailModel(env, {
    pendingTreated: k => { try { const s = csPendingTreated(iid); return !!(s && s.has(k)); } catch (e) { return false; } },
    pendingObserved: k => { try { return !!opsPendingObserved(iid, k); } catch (e) { return false; } }
  });
  const meta = env.meta || {}, vv = r.voltage != null ? r.voltage : (meta.voltage && meta.voltage.value != null ? meta.voltage.value : (LINE_VOLTAGE[lineName] || null));
  const [stA, stB] = lineEndpoints(lineName);
  let pendingN = 0; try { const rd = opsRead(); if (rd.ok) pendingN = rd.items.filter(e => e.line === lineName && String(e.tower) === String(towerNum)).length; } catch (e) {}
  let html = '';
  if (pk) html += lpkBannerHtml(pk.pk);
  else if (ctx && ctx.verifying) html += '<div class="form-card" id="towerSnapBanner" style="margin-bottom:10px;border-right:4px solid #ED8936;font-size:0.8rem;color:#7B341E">📴 محفوظة — قيد التحقق (للعرض فقط؛ تُحدَّث عند وصول القراءة الحيّة)</div>';
  else if (!(ctx && ctx.live)) html += '<div class="form-card" style="margin-bottom:10px;border-right:4px solid #ED8936;font-size:0.8rem;color:#7B341E">📴 آخر حالة محفوظة على الجهاز — لم تُؤكَّد من الخادم في هذا الفتح (الأعداد والمواضع أدناه من هذه النسخة المحفوظة)</div>';
  if (env.status === 'needs_review') html += '<div class="form-card" style="margin-bottom:10px;border-right:4px solid #E53E3E;font-size:0.8rem;color:#822727">⚠️ حالة هذا البرج تحتاج مراجعة' + ((env.unresolved_reasons || []).length ? ': ' + _tdEsc(env.unresolved_reasons.join('، ')) : '') + '</div>';
  if (pendingN) html += '<div class="form-card" style="margin-bottom:10px;border-right:4px solid #F6C23E;font-size:0.8rem;color:#7C4A03">⏳ ' + pendingN + ' عملية معلّقة لهذا البرج لم تُؤكَّد بعد — <strong>لا تنعكس</strong> على مواضع العوازل وأعدادها أدناه (المؤكَّد على الخادم فقط)، وقد تختلف بطاقة البرج لأنها تُظهر المعلّق. البنود النصية المتأثرة بعملية معلّقة موسومة ⏳.</div>';
  html += `<div class="form-card" style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div style="font-weight:700;color:#1a2e4a">📋 آخر كشف</div>
      <div style="font-size:0.78rem;color:#718096">📅 ${_tdEsc(r.inspection_date || '—')} | 👤 ${_tdEsc(r.created_by_name || '—')}</div>
    </div>
    <div style="font-size:0.85rem;color:#4A5568;margin-top:6px">نوع البرج: <strong>${_tdEsc(_tdCurrentType(lineName, towerNum) || TOWER_TYPES[r.tower_type] || r.tower_type || 'غير معروف')}</strong> | الجهد: <strong>${vv != null ? _tdEsc(vv) + ' ك.ف' : 'غير معروف'}</strong></div>
  </div>`;
  if (!pk) html += `<button class="btn btn-secondary" id="towerHistoryBtn" style="width:100%;margin-bottom:14px" onclick="openTowerHistory(${_tdEsc(JSON.stringify(lineName))}, ${_tdEsc(JSON.stringify(String(towerNum)))})">📜 سجل البرج</button>`;
  if (!pk && currentUser && currentUser.role === 'admin') html += `<button class="btn btn-secondary" id="towerSpecBtn" style="width:100%;margin-bottom:14px"${ctx && ctx.verifying ? ' disabled title="يتاح بعد التحقق من الخادم"' : ''} onclick="openTowerSpec(${_tdEsc(JSON.stringify(lineName))}, ${_tdEsc(JSON.stringify(String(towerNum)))})">⚙️ مواصفات البرج (تصحيح)</button>`;   // N25-R6   // v335-C6r24 (P02)
  let _locId = null; if (!pk) { try { const sn = csIdentSnap(lineName, towerNum); _locId = sn && !sn.blocked ? sn : (sn || null); } catch (e) { _locId = null; } }   // N25-R34: هوية البرج الدائمة من نفس لقطة الهوية التي تستعملها نماذج الحفظ (لا حلّ من الرقم)
  if (!pk) html += '<div id="towerLocCard" style="margin-bottom:14px"></div>';
  const draws = [], geoGaps = [];
  model.circuits.forEach(c => {
    if (c.applicability === 'not_applicable') { html += '<div class="form-card" style="margin-bottom:14px;color:#718096;font-size:0.82rem">🔘 الدائرة الثانية: غير منطبقة على هذا البرج</div>'; return; }
    if (c.applicability === 'unknown') { html += '<div class="form-card" style="margin-bottom:14px;color:#7B341E;font-size:0.82rem">🔘 الدائرة ' + c.n + ': انطباقها على هذا البرج غير معروف — لا تُعرض لها بيانات</div>'; return; }
    const cid = 'towerDetailInsulators_c' + c.n, geo = meta.geometry || {};
    let mode = null, modeNote = '';
    if (['agreed', 'single_source', 'inferred'].indexOf(geo.status) >= 0 && geo.mode) mode = geo.mode;
    const known = ['R', 'S', 'T'].filter(ph => c.phases[ph].state === 'known');
    if (!mode && vv != null && known.length) {
      try { const am = getInsulatorMode(Number(vv), r.tower_type || '', lineName, r.tower_number); if (known.every(ph => c.phases[ph].damaged.length === getInsulatorCount(am))) { mode = am; modeNote = 'الهندسة من إعداد التطبيق (غير مؤكدة في الحالة المحفوظة)'; } } catch (e) {}
    }
    let lenBad = false;
    if (mode) { try { const cnt = getInsulatorCount(mode); if (!(cnt > 0) || known.some(ph => c.phases[ph].damaged.length !== cnt)) { lenBad = true; mode = null; modeNote = ''; } } catch (e) { lenBad = true; mode = null; } }   // stored arrays must match the geometry before anything is drawn
    if (!mode) geoGaps.push('هندسة سلاسل الدائرة ' + c.n + (lenBad ? ' لا تطابق أطوال المصفوفات المحفوظة' : ' غير محسومة'));
    html += `<div class="form-card" style="margin-bottom:14px"><h3>🔘 العوازل — الدائرة ${c.n}</h3>`;
    if (mode) {
      html += `<div class="insulator-legend" style="margin-bottom:10px"><div class="legend-item"><div class="legend-box ok"></div><span>سليم</span></div><div class="legend-item"><div class="legend-box dmg"></div><span>متضرر</span></div><div class="legend-item"><div style="width:16px;height:12px;border-radius:2px;border:1.5px solid #276749;background:#48BB78;display:inline-block;vertical-align:middle"></div><span style="margin-right:4px">استبدال مسجّل سابقاً (سليم الآن)</span></div></div>`;
      html += `<div id="${cid}" style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center"></div>`;
      const st = {}, cy = {}, ti = {}, unk = [];
      ['R', 'S', 'T'].forEach(ph => { const x = c.phases[ph]; if (x.state === 'known') { st[ph] = x.damaged; cy[ph] = x.cycle || []; ti[ph] = x.treated ? x.treated.slice() : (x.cycle ? x.damaged.map((d, i) => (!d && (x.cycle[i] || 0) > 0) ? i : -1).filter(i => i >= 0) : []); } else { st[ph] = []; cy[ph] = []; ti[ph] = []; unk.push(ph); } });
      draws.push(() => renderTowerDetailInsulators(st, ti, mode, stA, stB, cid, cy, unk));
      html += '<div style="margin-top:8px">' + _tdPhaseLines(c) + '</div>';
    } else {
      html += '<div style="font-size:0.8rem;color:#7B341E;margin-bottom:6px">هندسة السلاسل غير محسومة — تُعرض الأعداد دون رسم</div>';
      html += _tdPhaseLines(c);
    }
    if (modeNote) html += '<div style="font-size:0.74rem;color:#7B341E;margin-top:6px">' + modeNote + '</div>';
    const noCycle = known.filter(ph => !c.phases[ph].cycle);
    if (noCycle.length) html += '<div style="font-size:0.76rem;color:#7B341E;margin-top:6px">دورات المعالجة غير معروفة للفيز: ' + noCycle.join('، ') + ' — لا يُفترض أنها صفر</div>';
    if (c.materialsUnknown) html += '<div style="font-size:0.76rem;color:#7B341E;margin-top:4px">مادة سلاسل هذه الدائرة ' + (c.materialsState === 'legacy' ? 'غير مؤكدة (عرف قديم)' : 'غير معروفة (لم تُحفظ)') + ' — لا يُفترض زجاج</div>';
    html += '</div>';
  });
  html += '<div class="form-card"><h3>📝 تفاصيل الكشف</h3><div style="display:flex;flex-direction:column;gap:8px">';
  model.sections.forEach(sx => {
    const tr = sx.state === 'treated', color = sx.pend ? '#D69E2E' : tr ? '#48BB78' : '#FC4444';
    html += `<div style="display:flex;justify-content:space-between;align-items:start;gap:8px;padding:8px;background:#F8FAFC;border-radius:8px;border-right:3px solid ${color}">
      <div><strong style="color:#2E4057">${_tdEsc(sx.label)}:</strong> <span style="color:#4A5568">${_tdEsc(sx.display)}</span></div>
      <span style="font-size:0.78rem;font-weight:700;color:${color};white-space:nowrap">${sx.pend === 'treated' ? '⏳ معالجة معلّقة (غير مؤكدة)' : sx.pend === 'observed' ? '⏳ رصد معلّق (غير مؤكد)' : tr ? '✅ معالج' : '🔴 قيد المعالجة'}</span></div>`;
  });
  if (r.notes) html += '<div style="padding:8px;background:#F8FAFC;border-radius:8px;border-right:3px solid #A0AEC0"><strong style="color:#2E4057">ملاحظات:</strong> <span style="color:#4A5568">' + _tdEsc(r.notes) + '</span></div>';
  if (model.footer === 'open') html += '<div class="empty-state" style="padding:10px">🔴 توجد بنود قيد المعالجة في هذا البرج</div>';
  if (model.unknown.length) html += '<div style="padding:10px;background:#FFFAF0;border:1px solid #F6AD55;border-radius:8px;color:#7B341E;font-size:0.82rem">⚠️ بيانات غير مسجّلة: ' + model.unknown.map(_tdEsc).join('، ') + '<br>لا يمكن الجزم بسلامة هذه الأقسام.</div>';
  const allGaps = model.gaps.concat(geoGaps);
  if (allGaps.length) html += '<div style="padding:10px;background:#FFFAF0;border:1px solid #F6AD55;border-radius:8px;color:#7B341E;font-size:0.82rem">⚠️ بيانات الدورات/المواد/الهندسة غير مكتملة: ' + allGaps.map(_tdEsc).join('؛ ') + '<br>الأضرار المعروضة مرصودة، لكن لا يُجزم بالمعالجة أو السلامة الكاملة.</div>';
  if (model.footer === 'treated' && !geoGaps.length) html += '<div class="empty-state" style="padding:10px">✅ لا ضرر مفتوح حالياً — توجد معالجات/استبدالات مسجّلة سابقاً' + [model.priorIns ? 'عوازل: ' + model.priorIns + ' فيز' : '', model.textTreated ? 'بنود نصية: ' + model.textTreated : ''].filter(Boolean).map((x, i) => (i ? ' ؛ ' : ' (') + x).join('') + (model.priorIns || model.textTreated ? ')' : '') + '، ولا يُعرف إن كانت ضمن الضرر الحالي</div>';
  if (model.footer === 'clear' && !geoGaps.length) html += '<div class="empty-state" style="padding:10px">✅ لا توجد ملاحظات مسجّلة — كل الأقسام المنطبقة معروفة وسليمة</div>';
  html += '</div></div>';
  body.innerHTML = html;
  if (!pk) { try { towerLocCardMount({ line: lineName, number: String(towerNum), ident: _locId, live: !!(ctx && ctx.live), uid: (currentUser && currentUser.id != null) ? String(currentUser.id) : null }); } catch (e) { console.warn('[tower-app] loc card', e); } }   // N25-R34
  setTimeout(() => draws.forEach(d => { try { d(); } catch (e) { console.warn('[tower-app] فشل رسم عوازل التفاصيل', e); } }), 10);
}

// =====================================================================================================================================================
// N25-R28: حزمة خط واحد للاستخدام دون اتصال (تنزيل بطلب المستخدم). مستقلة عن كاش آخر 40 برجاً وعن الطابور المعلّق.
//  • تُقرأ بمسارات القراءة والصلاحيات الموجودة (app_tower_directory / app_line_identity / app_line_state عبر csCall) وتُخزَّن في مخزن مستقل (lpkGet/lpkIdb في index.html).
//  • لا تدخل أبداً في _csMem/_csInfo/_csDirs/_csLineId: لا ترقيم ولا أساس حفظ/تعبئة مسبقة منها (checkPreviousInspection لا يقرأها). للعرض فقط بوسم «نسخة محفوظة» وتاريخها.
//  • تُعتمد فقط بعد اكتمال كل الأبراج والتحقق من ثبات الترقيم (الدليل والهوية قبل وبعد؛ نسخة الترقيم وهوية كل غلاف). الفشل/الانقطاع/فشل التخزين يُبقي الحزمة السابقة.
// =====================================================================================================================================================
let _lpkRun = null, _lpkSeq = 0;
const _lpkFail = {};            // line -> { at, code }   (آخر محاولة فاشلة؛ في الذاكرة فقط)
const _lpkDelArm = {};          // line -> true بعد أول ضغطة على «حذف الحزمة»
const LPK_BATCH = 50;
const LPK_ERR = {
  offline: 'لا يوجد اتصال بالإنترنت', auth: 'الجلسة غير صالحة', busy: 'تنزيل آخر جارٍ', cancelled: 'أُلغي التنزيل', session_changed: 'تغيّر الحساب/الجلسة أثناء التنزيل',
  numbering_unavailable: 'تعذّر قراءة ترقيم الخط', numbering_changed: 'تغيّر ترقيم الخط أثناء التنزيل', incomplete: 'ردّ الخادم ناقص (لم تصل كل الأبراج)', read: 'تعذّرت قراءة حالة الأبراج من الخادم',
  no_towers: 'لا أبراج معرّفة لهذا الخط', config_mismatch: 'تكوين الخط المحلي لا يطابق أبراج الخادم النشطة', completeness_unproven: 'تعذّر إثبات اكتمال الخط (هويات/دليل الخادم ناقصة)', storage: 'فشل التخزين على الجهاز (مساحة/صلاحية)', verify: 'تعذّر التحقق من الحزمة بعد حفظها', network: 'انقطع الاتصال أثناء التنزيل'
};
function _lpkFmt(ts) {
  if (!ts) return '—'; const d = new Date(ts); if (isNaN(d)) return '—';
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function _lpkDirMap(r) {         // رد app_tower_directory -> { rev, byNum, count } (للمقارنة فقط؛ لا يُخزَّن في _csDirs)
  if (!r || r.ok !== true || !Array.isArray(r.towers)) return null;
  const byNum = {}; r.towers.forEach(t => { if (t && t.tower_id && !t.retired && t.number != null) byNum[String(t.number)] = String(t.tower_id); });
  return { rev: Number(r.topology_rev) || 0, byNum, byId: (function () { const o = {}; r.towers.forEach(t => { if (t && t.tower_id) o[t.tower_id] = { n: t.number == null ? null : String(t.number), r: !!t.retired }; }); return o; })() };
}
function _lpkSameSet(a, b) { const x = new Set(a), y = new Set(b); return x.size === y.size && a.every(k => y.has(k)); }
function _lpkSameMap(a, b) {
  const ka = Object.keys(a || {}).sort(), kb = Object.keys(b || {}).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && String(a[k]) === String(b[kb[i]]));
}
function _lpkProg(run, done, total, phase) {
  run.prog = { done, total, phase: phase || 'towers' };
  const el = document.getElementById('lpkProg'); if (el && currentDrilldownLine === run.line) { el.textContent = _lpkProgText(run); const b = document.getElementById('lpkProgBar'); if (b) b.style.width = (run.prog.total ? Math.round(100 * run.prog.done / run.prog.total) : 0) + '%'; }
}
function _lpkProgText(run) {
  const p = run.prog || { done: 0, total: 0, phase: 'prepare' };
  if (p.phase === 'prepare') return '⏳ التحقق من ترقيم الخط…';
  if (p.phase === 'verify') return '⏳ التحقق من ثبات الترقيم قبل الاعتماد…';
  if (p.phase === 'save') return '⏳ حفظ الحزمة على الجهاز…';
  return '⏳ تنزيل أبراج الخط: ' + p.done + ' / ' + p.total;
}
async function lpkDownload(line) {
  if (_lpkRun) return { ok: false, code: 'busy' };
  if (!currentUser || !CS_AUTH.token || !csLiveEnabled()) return { ok: false, code: 'auth' };
  if (!navigator.onLine) { _lpkFail[line] = { at: Date.now(), code: 'offline' }; return { ok: false, code: 'offline' }; }
  const uid = String(currentUser.id), gen = _csAuthGen, tok = CS_AUTH.token;
  const run = _lpkRun = { line, uid, id: ++_lpkSeq, cancelled: false, prog: { done: 0, total: 0, phase: 'prepare' }, startedAt: Date.now() };
  const alive = () => _lpkRun === run && gen === _csAuthGen && !!currentUser && String(currentUser.id) === uid && CS_AUTH.token === tok;
  const fail = (code, why) => { if (_lpkRun === run) _lpkRun = null; _lpkFail[line] = { at: Date.now(), code, why: why || null }; lpkBarRefresh(line); return { ok: false, code }; };
  const bad = () => !alive() ? (run.cancelled ? 'cancelled' : 'session_changed') : null;
  lpkBarRefresh(line);
  try {
    const readNum = async () => {
      const d = await csCall('app_tower_directory', { p_line_name: line }), i = await csCall('app_line_identity', { p_line_name: line });
      const dm = _lpkDirMap(d);
      if (!dm || !i || i.ok !== true || !i.towers || (Number(i.topology_rev) || 0) !== dm.rev) return null;
      const idm = {}; Object.keys(i.towers).forEach(n => { idm[String(n)] = String(i.towers[n]); });
      if (dm.rev > 0 && !_lpkSameMap(dm.byNum, idm)) return null;                      // الدليل وخريطة الهوية يجب أن يتطابقا
      return { rev: dm.rev, byNum: dm.byNum, byId: dm.byId, ident: idm };
    };
    const n1 = await readNum(); let e = bad(); if (e) return fail(e);
    if (!n1) return fail(navigator.onLine ? 'numbering_unavailable' : 'network');
    const cfgTowers = JSON.parse(JSON.stringify(getLineTowers(line) || []));
    const nums = cfgTowers.map(t => String(t.num));
    if (!nums.length) return fail('no_towers');
    // N25-R28a: إثبات الاكتمال قبل أي اعتماد — مجموعة أرقام التكوين (بلا تكرار) = مجموعة الأبراج النشطة الكاملة في مرجع الخادم لنفس النسخة (لا عدد الطلبات)
    if (new Set(nums).size !== nums.length) return fail('config_mismatch', 'أرقام مكررة في تكوين الخط');
    const proof = (cfgN, ref) => {
      const srv = Object.keys(ref.byNum), idn = Object.keys(ref.ident);
      if (!srv.length || !idn.length) return ['completeness_unproven', 'دليل الخادم أو خريطة الهوية فارغ'];
      const c = new Set(cfgN), sv = new Set(srv), id = new Set(idn);
      const miss = srv.filter(x => !c.has(x)), extra = cfgN.filter(x => !sv.has(x)), noId = srv.filter(x => !id.has(x)), idX = idn.filter(x => !sv.has(x));
      if (noId.length || idX.length) return ['completeness_unproven', 'هويات الخادم لا تغطي كل الأبراج النشطة'];
      if (miss.length || extra.length) return ['config_mismatch', 'محلي ' + cfgN.length + ' / خادم ' + srv.length + (miss.length ? ' — ناقص محلياً: ' + miss.slice(0, 8).join('، ') : '') + (extra.length ? ' — زائد محلياً: ' + extra.slice(0, 8).join('، ') : '')];
      return null;
    };
    { const bad1 = proof(nums, n1); if (bad1) return fail(bad1[0], bad1[1]); }
    _lpkProg(run, 0, nums.length);
    const staged = {}, towerIds = {};
    for (let i = 0; i < nums.length; i += LPK_BATCH) {
      const part = nums.slice(i, i + LPK_BATCH);
      const r = await csCall('app_line_state', { p_line_name: line, p_towers: part });
      e = bad(); if (e) return fail(e);
      if (!r || r.ok !== true || !r.towers || typeof r.towers !== 'object') return fail(r && r.net ? 'network' : 'read');
      if ((Number(r.topology_rev) || 0) !== n1.rev) return fail('numbering_changed', 'نسخة ترقيم الردّ ' + (Number(r.topology_rev) || 0) + ' ≠ ' + n1.rev);
      for (const n of part) {
        const env = r.towers[n];
        if (!csEnvValid(env, line, n)) return fail('incomplete');
        const tid = r.tower_ids && r.tower_ids[n] != null ? String(r.tower_ids[n]) : null;   // هوية البرج تأتي في ردّ الخط (tower_ids)، لا داخل كل غلاف
        if (n1.rev > 0 && (!tid || String(n1.byNum[n]) !== tid)) return fail('numbering_changed', 'برج ' + n + ': هويته في ردّ الحالة لا تطابق خريطة الخط');
        if (tid) towerIds[n] = tid;
        staged[n] = env;
      }
      _lpkProg(run, Math.min(i + LPK_BATCH, nums.length), nums.length);
    }
    _lpkProg(run, nums.length, nums.length, 'verify');
    const n2 = await readNum(); e = bad(); if (e) return fail(e);
    if (!n2) return fail(navigator.onLine ? 'numbering_unavailable' : 'network');
    if (n2.rev !== n1.rev || !_lpkSameMap(n1.byNum, n2.byNum) || !_lpkSameMap(n1.ident, n2.ident)) return fail('numbering_changed');
    { const bad2 = proof(nums, n2); if (bad2) return fail(bad2[0], bad2[1]); }                       // المرجع بعد التنزيل أيضاً يثبت الاكتمال
    if (!_lpkSameSet(Object.keys(staged), Object.keys(n2.byNum))) return fail('completeness_unproven', 'الأبراج المنزّلة ≠ أبراج الخادم النشطة');
    const noInsp = [], uninit = [];
    for (const n of nums) {
      const env = staged[n];
      if ((Number(env.topology_rev) || 0) > n1.rev) return fail('numbering_changed', 'برج ' + n + ': نسخة غلافه أحدث من نسخة الخط');
      if (env.tower_id && towerIds[n] && String(env.tower_id) !== towerIds[n]) return fail('numbering_changed', 'برج ' + n + ': هوية غلافه لا تطابق هويته في ردّ الخط');
      const noSrc = env.resolution === 'no_source' || env.status === 'no_source', un = env.status === 'uninitialized';
      if (un) uninit.push(n); else if (noSrc) noInsp.push(n);
    }
    let info = null; try { const ks = lineAliasKeys(line); for (const k of ks) { if (linesInfoCache[k]) { info = JSON.parse(JSON.stringify(linesInfoCache[k])); break; } } } catch (er) {}
    const rec = {
      key: lpkKey(uid, line), fmt: LPK_FMT, uid, line, rev: n1.rev,
      lineIdent: { rev: n1.rev, towers: n1.ident }, dir: { rev: n1.rev, byNum: n1.byNum, byId: n1.byId },
      cfg: { towers: cfgTowers, info, live: !!(typeof _lineCfgMeta === 'object' && _lineCfgMeta.towers), at: (typeof _lineCfgMeta === 'object' && _lineCfgMeta.towersAt) || null },
      envs: staged, towerIds, noInspection: noInsp, uninitialized: uninit,
      counts: { total: nums.length, withInspection: nums.length - noInsp.length - uninit.length, noInspection: noInsp.length, uninitialized: uninit.length },
      startedAt: run.startedAt, completedAt: Date.now(), complete: true
    };
    _lpkProg(run, nums.length, nums.length, 'save');
    if (!alive()) return fail(run.cancelled ? 'cancelled' : 'session_changed');
    const w = await lpkIdb('readwrite', st => st.put(rec));            // معاملة واحدة: السابقة تبقى إن فشلت
    if (!w.ok) return fail('storage');
    const back = await lpkGet(line);
    if (!back || back.counts.total !== nums.length || Object.keys(back.envs).length !== nums.length) return fail('verify');
    if (_lpkRun === run) _lpkRun = null; delete _lpkFail[line];
    lpkBarRefresh(line);
    return { ok: true, pack: back };
  } catch (er) { return fail(navigator.onLine ? 'read' : 'network'); }
}
function lpkStartCur() { const l = currentDrilldownLine; if (!l) return; _lpkDelArm[l] = false; lpkDownload(l).then(r => { if (r && r.ok) { try { showToast('✅ اكتملت حزمة الخط للاستخدام دون اتصال', 'success'); } catch (e) {} } else if (r && r.code !== 'busy') { try { showToast('⚠️ ' + (LPK_ERR[r.code] || 'فشل التنزيل') + ' — الحزمة السابقة (إن وُجدت) بقيت كما هي', 'error'); } catch (e) {} } }); lpkBarRefresh(l); }
function lpkCancelCur() { if (_lpkRun) { _lpkRun.cancelled = true; _lpkRun = null; } if (currentDrilldownLine) lpkBarRefresh(currentDrilldownLine); }
async function lpkDeleteCur() {
  const l = currentDrilldownLine; if (!l) return;
  if (!_lpkDelArm[l]) { _lpkDelArm[l] = true; lpkBarRefresh(l); return; }
  _lpkDelArm[l] = false; const r = await lpkDelete(l);
  try { showToast(r && r.ok ? '🗑 حُذفت حزمة الخط من الجهاز (المعلّقات وكاش الأبراج لم يُمسّا)' : '⚠️ تعذّر حذف الحزمة', r && r.ok ? 'success' : 'error'); } catch (e) {}
  lpkBarRefresh(l);
  const lv = document.getElementById('lineTowerListView'); if (lv && lv.style.display !== 'none' && l === currentDrilldownLine && document.getElementById('lpkPackList')) { renderLineTowerList(l, { state: 'error', at: null, offline: !navigator.onLine }); }
}
function lpkBarHtml(line) { return '<div id="lpkBar" data-line="' + _tdEsc(line) + '" style="margin-bottom:10px"></div>'; }
async function lpkBarRefresh(line) {
  const el = document.getElementById('lpkBar'); if (!el || el.getAttribute('data-line') !== line) return;
  const pk = _lpkRun && _lpkRun.line === line ? null : await lpkGet(line);
  const el2 = document.getElementById('lpkBar'); if (!el2 || el2.getAttribute('data-line') !== line || currentDrilldownLine !== line) return;
  const st = 'border:1px solid #CBD5E0;border-radius:8px;padding:8px 10px;font-size:0.78rem;background:#F7FAFC;color:#2D3748;line-height:1.8;';
  const bt = 'margin-inline-start:6px;', off = !navigator.onLine;
  let h = '';
  if (_lpkRun && _lpkRun.line === line) {
    const p = _lpkRun.prog || { done: 0, total: 0 };
    h = '<div style="' + st + '"><div id="lpkProg">' + _lpkProgText(_lpkRun) + '</div><div style="height:6px;background:#E2E8F0;border-radius:4px;margin:6px 0"><div id="lpkProgBar" style="height:6px;background:#3182CE;border-radius:4px;width:' + (p.total ? Math.round(100 * p.done / p.total) : 0) + '%"></div></div><button class="btn btn-secondary btn-sm" onclick="lpkCancelCur()">إلغاء</button></div>';
  } else {
    const f = _lpkFail[line];
    h = '<div style="' + st + '">';
    if (pk) {
      h += '📦 حزمة دون اتصال — <strong>آخر تنزيل ناجح: ' + _tdEsc(_lpkFmt(pk.completedAt)) + '</strong> — ' + pk.counts.total + ' برج (' + pk.counts.withInspection + ' بكشف، ' + pk.counts.noInspection + ' بلا كشف' + (pk.counts.uninitialized ? '، ' + pk.counts.uninitialized + ' غير مهيّأ' : '') + ')' + (pk.stale ? '<div style="color:#9B2C2C">⚠️ تغيّر ترقيم الخط بعد هذا التنزيل — حدّث الحزمة؛ لا تُعرض أبراجها حتى ذلك الحين</div>' : '');
    } else h += '📦 لم تُنزَّل حزمة لهذا الخط على هذا الجهاز';
    if (f) h += '<div style="color:#9B2C2C">⚠️ آخر محاولة فاشلة (' + _tdEsc(_lpkFmt(f.at)) + '): ' + _tdEsc(LPK_ERR[f.code] || f.code) + (f.why ? ' (' + _tdEsc(f.why) + ')' : '') + (pk ? ' — الحزمة السابقة بقيت كما هي' : '') + '</div>';
    h += '<div style="margin-top:4px"><button id="lpkDlBtn" class="btn btn-secondary btn-sm" ' + (off ? 'disabled title="يتطلب اتصالاً"' : '') + ' onclick="lpkStartCur()">' + (pk ? '🔄 تحديث الحزمة' : '⬇️ تنزيل الخط للاستخدام دون اتصال') + '</button>';
    if (pk) h += '<button id="lpkDelBtn" class="btn btn-secondary btn-sm" style="' + bt + '" onclick="lpkDeleteCur()">' + (_lpkDelArm[line] ? '⚠️ اضغط مرة أخرى لتأكيد حذف الحزمة' : '🗑 حذف الحزمة') + '</button>';
    h += '</div>';
    if (pk) h += '<div style="font-size:0.7rem;color:#718096">الحذف يشمل حزمة هذا الخط فقط؛ العمليات المعلّقة وكاش آخر الأبراج لا يتأثران.</div>';
    h += '</div>';
  }
  el2.innerHTML = h;
}
// أبراج الحزمة: برج واحد (غلاف + الحزمة) للعرض فقط
async function lpkEnvFor(line, tower) {
  const pk = await lpkGet(line); if (!pk) return null;
  if (pk.stale) return { pk, blocked: 'stale' };
  const env = pk.envs[String(tower)]; if (!env || !csEnvValid(env, line, tower)) return null;
  return { pk, env };
}
function lpkBannerHtml(pk) {
  return '<div class="form-card" id="lpkSavedBanner" style="margin-bottom:10px;border-right:4px solid #805AD5;font-size:0.8rem;color:#44337A">📦 <strong>نسخة محفوظة</strong> — تاريخ التنزيل: ' + _tdEsc(_lpkFmt(pk.completedAt)) + ' — للعرض فقط دون اتصال؛ لا تُستعمل للترقيم ولا كأساس للحفظ أو التعبئة المسبقة. الحالة الحيّة تُقرأ من الخادم عند توفر الاتصال.</div>';
}
function renderLpkList(line, pk) {
  const body = document.getElementById('lineTowerListBody');
  let html = lpkBarHtml(line) + '<div id="lpkPackList">' + lpkBannerHtml(pk) + '</div>';
  if (pk.stale) { body.innerHTML = lpkBarHtml(line) + '<div class="empty-state" id="lpkPackList">⚠️ هذه الحزمة بترقيم قديم (تغيّر ترقيم الخط بعد تنزيلها) — حدّثها وأنت متصل</div>'; lpkBarRefresh(line); return; }
  if (pk.counts.noInspection || pk.counts.uninitialized) {
    html += '<div style="font-size:0.76rem;color:#4A5568;margin-bottom:8px">⚪ أبراج بلا كشف معتمد في الحزمة (' + pk.counts.noInspection + '): ' + (pk.noInspection.length ? _tdEsc(pk.noInspection.join('، ')) : '—') + (pk.counts.uninitialized ? '<br>⚠️ أبراج غير مهيّأة (' + pk.counts.uninitialized + '): ' + _tdEsc(pk.uninitialized.join('، ')) : '') + '</div>';
  }
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">';
  pk.cfg.towers.forEach(t => {
    const n = String(t.num), env = pk.envs[n];
    let badge, border, sub = '';
    if (!env || env.status === 'no_source' || env.resolution === 'no_source') { badge = '⚪ لا كشف لهذا البرج'; border = '#BDC3C7'; }
    else if (env.status === 'uninitialized') { badge = '⚠️ غير مهيّأ'; border = '#E53E3E'; }
    else if (env.basis !== 'operations' || !Array.isArray(env.components) || !env.row) { badge = '⚠️ تفاصيل غير مكتملة'; border = '#ED8936'; }
    else {
      let m = null; try { m = towerDetailModel(env, {}); } catch (e) { m = null; }
      if (!m) { badge = '⚠️ تفاصيل غير مكتملة'; border = '#ED8936'; }
      else if (m.footer === 'open') { badge = '🔴 ' + m.open + ' مفتوح'; border = '#E53E3E'; }
      else if (m.footer === 'treated') { badge = '✅ معالج'; border = '#48BB78'; }
      else if (m.footer === 'clear') { badge = '✅ سليم'; border = '#48BB78'; }
      else { badge = '⚪ غير مكتمل المعرفة'; border = '#ED8936'; }
      sub = '📅 ' + _tdEsc(env.row.inspection_date || '—');
    }
    html += '<div class="lpk-card" data-tower="' + _tdEsc(n) + '" onclick="openTowerDetail(' + _tdEsc(JSON.stringify(line)) + ',' + _tdEsc(JSON.stringify(n)) + ')" style="cursor:pointer;border:2px solid ' + border + ';border-radius:10px;padding:10px;text-align:center;background:white">' +
      '<div style="font-weight:700;color:#1a2e4a;font-size:0.9rem">برج ' + _tdEsc(n) + '</div><div style="font-size:0.72rem;color:#718096;margin:2px 0">' + _tdEsc(t.type || '') + '</div>' +
      '<div style="font-size:0.78rem;font-weight:700">' + badge + '</div>' + (sub ? '<div style="font-size:0.7rem;color:#718096">' + sub + '</div>' : '') +
      '<div class="tower-box-complete" data-pack="1" style="font-size:0.68rem;color:#44337A;margin-top:2px">📦 نسخة محفوظة ' + _tdEsc(_lpkFmt(pk.completedAt).slice(0, 10)) + '</div></div>';
  });
  html += '</div>';
  body.innerHTML = html; lpkBarRefresh(line);
}

(window.__featModules = window.__featModules || {}).lpg = true;
