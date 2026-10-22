/* lines-pages.js — v335-C5r9
   صفحتا «بيانات الخطوط» و«حالة الخطوط» وتفاصيل أبراج الخط (عرض فقط). مزوّدات البيانات (linesInfoCache، getLineTowers، calcLineHealthWithTreatments) تبقى في index.html.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
function showLinesInfoImpl() {
  pushLevel(showLinesHome);
  document.getElementById('linesHomeView').style.display = 'none';
  document.getElementById('linesInfoView').style.display = '';
  document.getElementById('linesStatusView').style.display = 'none';
  const addBtn = document.getElementById('btnAddLine');
  if (addBtn) addBtn.style.display = currentUser && currentUser.role === 'admin' ? '' : 'none';
  renderLinesInfo();
}

async function showLinesStatusImpl(tok) {
  pushLevel(showLinesHome);
  document.getElementById('linesHomeView').style.display = 'none';
  document.getElementById('linesInfoView').style.display = 'none';
  document.getElementById('linesStatusView').style.display = '';
  document.getElementById('linesStatusBody').innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  try {
    await Promise.all([loadTreatments(), loadFullRecordsCache()]);
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
  const filtered = data.filter(l => filter === 'all' || String(l.voltage) === filter);
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

// v333: كتلة الحالة الكهربائية لدائرة واحدة. c = عنصر من health.circuits. النتيجة null تُعرض «لا يوجد تقييم مكتمل» (لا 0 ولا 100).
function renderElectricalCircuitBlock(label, c, getColor, getLbl) {
  const bar = (c.score == null)
    ? '<div style="display:flex;align-items:center;gap:10px"><div style="flex:1;background:#ecf0f1;border-radius:10px;height:18px"></div><div style="min-width:90px;text-align:right;font-weight:700;color:#7f8c8d;font-size:13px">لا يوجد تقييم مكتمل</div></div>'
    : makeBar(c.score, getColor(c.score), getLbl(c.score));
  let note = 'النسبة محسوبة من ' + c.complete + ' أبراج مكتملة من أصل ' + c.inspected + ' برج مكشوف';
  if (c.incomplete > 0) note += ' — ' + c.incomplete + ' برج غير مكتمل التقييم';
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

function renderLinesStatus() {
  const filter = document.getElementById('linesStatusFilter').value;
  const body = document.getElementById('linesStatusBody');
  const data = getLinesInfoData();
  const filtered = data.filter(l => filter === 'all' || String(l.voltage) === filter);
  let html = '';
  filtered.forEach(l => {
    const vc = l.voltage === 400 ? '#c0392b' : '#1a5276';
    const _n400 = l.name+' 400 ك.ف', _n132 = l.name+' 132 ك.ف';
    const lineName = (LINES_DATA[_n400]||lineTowersCache[_n400]) ? _n400 : ((LINES_DATA[_n132]||lineTowersCache[_n132]) ? _n132 : null);
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
        ? renderElectricalCircuitBlock('الحالة الكهربائية — الدائرة الأولى', health.circuits[0], getColor, getLbl) +
          renderElectricalCircuitBlock('الحالة الكهربائية — الدائرة الثانية', health.circuits[1], getColor, getLbl)
        : renderElectricalCircuitBlock('الحالة الكهربائية', health.circuits[0], getColor, getLbl);
      mBar = makeBar(health.mechanicalScore, getColor(health.mechanicalScore), getLbl(health.mechanicalScore));
      // حساب مؤشر النظافة: نسبة الأبراج النظيفة
      const recs = lineName ? getLatestRecordsPerTower(lineName) : [];
      const withWash = recs.filter(r => r.insulator_washing && r.insulator_washing !== '');
      const cleanCount = withWash.filter(r => r.insulator_washing === 'clean').length;
      const washPct = withWash.length > 0 ? Math.round(cleanCount / withWash.length * 100) : 100;
      washBar = makeBar(washPct, getWashColor(washPct), getWashLbl(washPct));
    }
    const clickAttr = lineName ? ` onclick="openLineTowerDetails('${lineName.replace(/'/g,"\\'")}')" style="cursor:pointer"` : '';
    html += '<div class="form-card" style="margin-bottom:12px;padding:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">' +
      '<div' + clickAttr + ' style="font-weight:700;font-size:14px;color:#1a5276;' + (lineName?'text-decoration:underline;':'') + '">' + l.name + (lineName?' 🔍':'') + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="background:' + vc + ';color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">' + l.voltage + ' ك.ف</span>' + badge + '</div></div>' +
      elBar +
      '<div style="margin-bottom:8px"><div style="font-size:12px;color:#555;margin-bottom:4px">الحالة الميكانيكية</div>' + mBar + '</div>' +
      '<div><div style="font-size:12px;color:#555;margin-bottom:4px">💧 نظافة العوازل</div>' + washBar + '</div></div>';
  });
  // v333: المعالجات المحفوظة قد تكون قديمة بعد فشل التحديث — تنبيه صريح (العلم treatmentsLoadFailed الموجود)
  const staleNote = (typeof treatmentsLoadFailed !== 'undefined' && treatmentsLoadFailed)
    ? '<div style="color:#92400E;background:#FEF3C7;border-radius:8px;padding:10px;margin-bottom:10px;font-size:12px">⚠️ تعذّر تحديث سجل المعالجات — احتساب الأسلاك يعتمد على نسخة محفوظة قد تكون قديمة.</div>' : '';
  body.innerHTML = staleNote + (html || '<div class="empty-state">لا توجد بيانات</div>');
}

// ========================
// تفاصيل أبراج الخط (الضغط على اسم الخط بحالة الخطوط)
// ========================
let currentDrilldownLine = null;

async function openLineTowerDetails(lineName) {
  const tok = featTok('lpg', true);
  pushLevel(backToLinesStatus);
  currentDrilldownLine = lineName;
  document.getElementById('linesStatusView').style.display = 'none';
  document.getElementById('lineTowerListView').style.display = '';
  document.getElementById('lineTowerListTitle').textContent = '🗼 أبراج خط ' + lineName;
  document.getElementById('lineTowerListBody').innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  await Promise.all([loadTreatments(), loadFullRecordsCache()]);
  if (!featEntryOk(tok)) return;
  renderLineTowerList(lineName);
}

function backToLinesStatus() {
  document.getElementById('lineTowerListView').style.display = 'none';
  document.getElementById('linesStatusView').style.display = '';
}

function backToTowerList() {
  document.getElementById('towerDetailView').style.display = 'none';
  document.getElementById('lineTowerListView').style.display = '';
}

function renderLineTowerList(lineName) {
  const body = document.getElementById('lineTowerListBody');
  const towers = getLineTowers(lineName);
  const latestRecs = getLatestRecordsPerTower(lineName);
  const recByTower = {}; latestRecs.forEach(r => { recByTower[r.tower_number] = r; });

  if (!towers.length) { body.innerHTML = '<div class="empty-state">لا توجد بيانات أبراج لهذا الخط</div>'; return; }

  let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">';
  towers.forEach(t => {
    const r = recByTower[t.num];
    let statusBadge, borderColor;
    if (!r) {
      statusBadge = '⚪ لم يُكشف'; borderColor = '#BDC3C7';
    } else {
      const deps = extractDepsFromRecord(r);
      const allTreated = deps.length > 0 && isFullyTreated(r.id, deps, r);
      if (!deps.length) { statusBadge = '✅ سليم'; borderColor = '#48BB78'; }
      else if (allTreated) { statusBadge = '✅ معالج'; borderColor = '#48BB78'; }
      else { statusBadge = '🔴 مغادرات'; borderColor = '#FC4444'; }
    }
    const catIconsHTML = buildCategoryIconsHTML(r);
    html += `<div onclick="openTowerDetail('${lineName.replace(/'/g,"\\'")}','${t.num}')"
      style="cursor:pointer;border:2px solid ${borderColor};border-radius:10px;padding:10px;text-align:center;background:white;position:relative">
      ${catIconsHTML}
      <div style="font-weight:700;color:#1a2e4a;font-size:0.9rem">برج ${t.num}</div>
      <div style="font-size:0.72rem;color:#718096;margin:2px 0">${t.type||''}</div>
      <div style="font-size:0.78rem;font-weight:700">${statusBadge}</div>
    </div>`;
  });
  html += '</div>';
  body.innerHTML = html;
}

// ========================
// صفحة تفاصيل برج واحد (مزيج الكشف + المعالجات)
// ========================
async function openTowerDetail(lineName, towerNum) {
  const tok = featTok('lpg', true);
  pushLevel(backToTowerList);
  document.getElementById('lineTowerListView').style.display = 'none';
  document.getElementById('towerDetailView').style.display = '';
  document.getElementById('towerDetailTitle').textContent = `🗼 ${lineName} — برج ${towerNum}`;
  document.getElementById('towerDetailBody').innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  await Promise.all([loadTreatments(), loadFullRecordsCache()]);
  if (!featEntryOk(tok)) return;
  renderTowerDetail(lineName, towerNum);
}

function renderTowerDetail(lineName, towerNum) {
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
  if (!hasAny) html += '<div class="empty-state" style="padding:10px">✅ لا توجد ملاحظات — البرج بحالة سليمة</div>';
  html += '</div></div>';

  body.innerHTML = html;
}

(window.__featModules = window.__featModules || {}).lpg = true;
