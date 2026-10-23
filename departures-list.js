/* departures-list.js — v335-C6r6 (landing = line names only; a line is read when opened; all-lines counts only on an explicit action)
   قائمة المغادرات الحالية: الخطوط ← أبراج الخط ← تفاصيل البرج. القراءة من فهرس الحالة الحالية (getActiveDepartureTowers في index.html).
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
async function loadDeparturesImpl(tok) {
  showDepLinesList();
  if (csLiveEnabled()) {
    // v335-C6r6: شاشة الدخول لا تقرأ شيئاً من الخادم: لا loadTreatments ولا حالة الخطوط الـ33. الخط يُقرأ عند فتحه، وأعداد كل الخطوط بطلب صريح.
    renderDepLinesList();
    return;
  }
  renderDepLinesList(true); // مرحلة أولى: أسماء الخطوط فوراً من البيانات المحلية، بدون انتظار الشبكة
  await Promise.all([loadTreatments(), loadFullRecordsCache(false)]);
  if (!featDataOk(tok)) return;      // غادر المستخدم الصفحة أو تغيّرت الجلسة أثناء الجلب: لا نرسم بيانات لحساب آخر
  renderDepLinesList(); // مرحلة ثانية: الأعداد الحقيقية بعد اكتمال التحميل
  try { if (treatUI) treatUI.populateLines(); } catch (e) { console.error('[tower-app] populateTreatLines', e); }   // اختياري: لا يُحمَّل محرر المعالجة لأجل ذلك
}

function backToDepLinesList() {
  document.getElementById('depLineTowersView').style.display = 'none';
  document.getElementById('depTowerDetailView').style.display = 'none';
  document.getElementById('depLinesListView').style.display = '';
}

function backToDepLineTowers() {
  document.getElementById('depTowerDetailView').style.display = 'none';
  document.getElementById('depLineTowersView').style.display = '';
  // نستعيد موضع التمرير المحفوظ (بعد لحظة قصيرة حتى تكتمل إعادة رسم القائمة أولاً)
  setTimeout(() => window.scrollTo(0, depLineTowersScrollY), 0);
}

function showDepLinesList() {
  document.getElementById('depLineTowersView').style.display = 'none';
  document.getElementById('depTowerDetailView').style.display = 'none';
  document.getElementById('depLinesListView').style.display = '';
  renderDepLinesList();
}

function renderDepLinesList(preliminary) {
  const body = document.getElementById('depLinesListBody');
  if (preliminary) {
    // عرض فوري بأسماء الخطوط من البيانات المحلية (بدون شبكة) — رسالة مؤقتة لحد ما تكتمل الأعداد الحقيقية
    const names = Object.keys(LINES_DATA).sort((a,b) => a.localeCompare(b, 'ar'));
    body.innerHTML = names.map(lineName => `
      <div class="form-card" style="margin-bottom:10px;padding:14px;border-right:4px solid #CBD5E0">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="font-weight:700;color:#1a2e4a;font-size:0.92rem">${lineName}</div>
          <span style="background:#EDF2F7;color:#718096;padding:3px 12px;border-radius:20px;font-size:0.78rem">⏳ جاري الحساب...</span>
        </div>
      </div>`).join('');
    return;
  }
  const live = csLiveEnabled();
  // الحالة الحيّة: كل خطوط التطبيق تظهر؛ الخط غير المقروء بعد يُعرض «لم يُقرأ» لا «سليم»
  const allRead = live && !!fullRecordsCacheLoadedAt && fullRecordsCache.length > 0;   // an explicit all-lines read has completed (and no later write invalidated it)
  const uniqueLines = (live && !allRead) ? Object.keys(LINES_DATA).sort() : [...new Set(fullRecordsCache.map(r => r.line_name).filter(Boolean))].sort();

  if (!uniqueLines.length) { body.innerHTML = '<div class="empty-state">لا توجد بيانات</div>'; return; }
  const isLoaded = (ln) => !live || allRead || !!loadedLineCacheAt[ln];

  const isIssue = s => s && s !== 'ok';
  const rows = uniqueLines.map(lineName => {
    if (!isLoaded(lineName)) return { lineName, notLoaded: true, count: -1, elCount: 0, mCount: 0, fireCount: 0, washCount: 0 };
    const activeTowers = getActiveDepartureTowers(lineName);
    let elCount = 0, mCount = 0, fireCount = 0, washCount = 0;
    activeTowers.forEach(({r}) => {
      if (isIssue(r.sev_insulator) || isIssue(r.sev_wires) || isIssue(r.sev_ground)) elCount++;
      if (isIssue(r.sev_iron) || isIssue(r.sev_foundation)) mCount++;
      if (isIssue(r.sev_fire)) fireCount++;
      if (r.insulator_washing && r.insulator_washing !== '' && r.insulator_washing !== 'clean') washCount++;
    });
    return { lineName, count: activeTowers.length, elCount, mCount, fireCount, washCount, unk: live ? csUnknownCount(((_csLineCov[lineName] || {}).sum || {}).coverage) : 0 };
  });

  // الخطوط اللي فيها مغادرات تظهر أول، مرتبة تنازلياً، والسليمة بالأسفل
  rows.sort((a,b) => b.count - a.count || a.lineName.localeCompare(b.lineName,'ar'));

  const allBtn = live ? `<div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn btn-secondary btn-sm" onclick="loadAllDepartureLines()" id="depAllLinesBtn">📊 قراءة أعداد كل الخطوط</button><span style="font-size:0.74rem;color:#718096">اضغط خطاً لقراءته وحده، أو اقرأ الكل بطلب صريح.</span></div>` : '';
  body.innerHTML = allBtn + rows.map(({lineName, count, elCount, mCount, fireCount, washCount, notLoaded, unk}) => {
    if (notLoaded) {
      return `<div class="form-card" style="margin-bottom:10px;padding:14px;border-right:4px solid #CBD5E0;cursor:pointer" onclick="openDepLineTowers('${lineName.replace(/'/g,"\\'")}')">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="font-weight:700;color:#1a2e4a;font-size:0.92rem">${lineName} 🔍</div>
          <span style="background:#EDF2F7;color:#4A5568;padding:3px 12px;border-radius:20px;font-size:0.78rem">لم يُقرأ بعد — اضغط للفتح</span>
        </div></div>`;
    }
    const borderColor = count > 0 ? '#FC4444' : (unk ? '#ED8936' : '#48BB78');
    const unkBadge = unk ? ` <span style="background:#FEEBC8;color:#7B341E;padding:3px 10px;border-radius:20px;font-size:0.74rem;font-weight:700">⚠️ ${unk} برج غير معروف</span>` : '';
    const badge = (count > 0
      ? `<span style="background:#FED7D7;color:#822727;padding:3px 12px;border-radius:20px;font-size:0.78rem;font-weight:700">🔴 ${count} مغادرة</span>`
      : (unk ? `<span style="background:#FEEBC8;color:#7B341E;padding:3px 12px;border-radius:20px;font-size:0.78rem;font-weight:700">لا مغادرات بين المعروف</span>` : `<span style="background:#C6F6D5;color:#22543D;padding:3px 12px;border-radius:20px;font-size:0.78rem;font-weight:700">✅ سليم</span>`)) + unkBadge;
    //
    const clickable = (count > 0 || unk) ? ` onclick="openDepLineTowers('${lineName.replace(/'/g,"\\'")}')" style="cursor:pointer"` : '';
    const breakdownParts = [];
    if (elCount > 0) breakdownParts.push(`<span style="color:#2B6CB0">⚡ كهربائية: ${elCount}</span>`);
    if (mCount > 0) breakdownParts.push(`<span style="color:#C05621">⚙️ ميكانيكية: ${mCount}</span>`);
    if (fireCount > 0) breakdownParts.push(`<span style="color:#C53030">🔥 حرائق: ${fireCount}</span>`);
    if (washCount > 0) breakdownParts.push(`<span style="color:#2B6CB0">💧 نظافة: ${washCount}</span>`);
    const breakdown = breakdownParts.length
      ? `<div style="margin-top:6px;font-size:0.74rem;font-weight:700;display:flex;gap:12px;flex-wrap:wrap">${breakdownParts.join('')}</div>`
      : '';
    return `<div class="form-card" style="margin-bottom:10px;padding:14px;border-right:4px solid ${borderColor}"${clickable}>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div style="font-weight:700;color:#1a2e4a;font-size:0.92rem">${lineName}${count>0?' 🔍':''}</div>
        ${badge}
      </div>
      ${breakdown}
    </div>`;
  }).join('');
}

let depLineTowersCurrentLine = null;

let depLineTowersCategoryFilter = null; // null = عرض الكل | 'electrical'|'mechanical'|'fire'|'washing'

async function openDepLineTowers(lineName) {
  const tok = featTok('dep', true);
  pushLevel(backToDepLinesList);
  document.getElementById('depLinesListView').style.display = 'none';
  document.getElementById('depLineTowersView').style.display = '';
  document.getElementById('depLineTowersTitle').textContent = '🗼 أبراج خط ' + lineName + ' — المغادرات';
  depLineTowersCategoryFilter = null; // نبدأ من غير فلتر عند فتح خط جديد
  if (csLiveEnabled()) {
    // v335-C6r6: قراءة الخط المختار وحده من مخزن الحالة (طلب واحد)؛ لا loadTreatments ولا خطوط أخرى
    document.getElementById('depLineTowersBody').innerHTML = '<div class="empty-state">⏳ جارٍ قراءة الخط…</div>';
    let ok = true;
    try { await loadLineRecordsCache(lineName, true); } catch (e) { ok = false; }
    if (!featEntryOk(tok)) return;
    if (!ok && !loadedLineCacheAt[lineName] && !latestRecordsIndex[lineName]) {
      document.getElementById('depLineTowersBody').innerHTML = '<div class="empty-state">⚠️ تعذّرت قراءة حالة هذا الخط من الخادم — تحقق من الاتصال وحاول مرة أخرى<br><button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="openDepLineTowers(\'' + lineName.replace(/'/g, "\\'") + '\')">🔄 إعادة المحاولة</button></div>';
      return;
    }
    if (!ok) { try { showToast('⚠️ تعذّر تحديث الخط — المعروض من آخر ما حُمّل', 'error'); } catch (e) {} }
  }
  renderDepLineTowers(lineName);
}

// قراءة صريحة لأعداد كل الخطوط (تقرير شامل): لا تعمل عند فتح الشاشة، فقط بالضغط
async function loadAllDepartureLines() {
  const tok = featTok('dep', true);
  const btn = document.getElementById('depAllLinesBtn'); if (btn) { btn.disabled = true; btn.textContent = '⏳ جارٍ قراءة كل الخطوط…'; }
  try { await loadFullRecordsCache(true); } catch (e) {}
  if (!featEntryOk(tok)) return;
  renderDepLinesList();
}

// الضغط على بطاقة تصنيف يفلتر الأبراج تحتها لهذا النوع بس — ضغطها ثانية يلغي الفلتر ويرجّع عرض الكل
function filterDepLineByCategory(cat) {
  depLineTowersCategoryFilter = (depLineTowersCategoryFilter === cat) ? null : cat;
  renderDepLineTowers(depLineTowersCurrentLine);
}

function renderDepLineTowers(lineName) {
  depLineTowersCurrentLine = lineName;
  const body = document.getElementById('depLineTowersBody');
  const activeTowers = getActiveDepartureTowers(lineName);

  // v335-C6r7: لا «لا توجد مغادرات» مطلقة مع بقاء أبراج غير معروفة الحالة (غير مهيّأة/قيد الإصلاح): العبارة مقيَّدة بالأبراج المعروفة
  const _unk = csLiveEnabled() ? csUnknownCount(((_csLineCov[lineName] || {}).sum || {}).coverage) : 0;
  if (!activeTowers.length) { body.innerHTML = csLineBanner(lineName) + (_unk ? '<div class="empty-state">لا توجد مغادرات نشطة بين الأبراج المعروفة — ⚠️ ' + _unk + ' برج غير معروف الحالة (لا يمكن القول إن الخط خالٍ)</div>' : '<div class="empty-state">✅ لا توجد مغادرات نشطة بهذا الخط</div>'); return; }

  activeTowers.sort((a,b) => parseInt(a.r.tower_number) - parseInt(b.r.tower_number));

  // عدّادات + وسم كل برج بفئاته — نفس آلية الحساب السابقة، بس نخزّن الفئات على كل برج حتى نقدر نفلتر بيها
  const isIssue = s => s && s !== 'ok';
  let elCount = 0, mCount = 0, fireCount = 0, washCount = 0;
  activeTowers.forEach(item => {
    const r = item.r;
    item._cats = [];
    if (isIssue(r.sev_insulator) || isIssue(r.sev_wires) || isIssue(r.sev_ground)) { elCount++; item._cats.push('electrical'); }
    if (isIssue(r.sev_iron) || isIssue(r.sev_foundation)) { mCount++; item._cats.push('mechanical'); }
    if (isIssue(r.sev_fire)) { fireCount++; item._cats.push('fire'); }
    if (r.insulator_washing && r.insulator_washing !== '' && r.insulator_washing !== 'clean') { washCount++; item._cats.push('washing'); }
  });

  const filter = depLineTowersCategoryFilter;
  const CAT_LABELS = { electrical: '⚡ مغادرات كهربائية', mechanical: '⚙️ مغادرات ميكانيكية', fire: '🔥 مسببات الحرائق', washing: '💧 نظافة العوازل' };
  const cardStyle = (cat, active, base) => active
    ? `${base};outline:3px solid #2D3748;cursor:pointer;transform:scale(1.02)`
    : `${base};cursor:pointer`;

  let html = csLineBanner(lineName) + `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    <div onclick="filterDepLineByCategory('electrical')" style="${cardStyle('electrical', filter==='electrical', 'flex:1;min-width:140px;background:#EBF8FF;border:1.5px solid #90CDF4;border-radius:10px;padding:10px;text-align:center')}">
      <div style="font-size:0.75rem;color:#2C5282;font-weight:700">⚡ مغادرات كهربائية</div>
      <div style="font-size:1.3rem;font-weight:700;color:#2B6CB0">${elCount}</div>
    </div>
    <div onclick="filterDepLineByCategory('mechanical')" style="${cardStyle('mechanical', filter==='mechanical', 'flex:1;min-width:140px;background:#FFFAF0;border:1.5px solid #F6AD55;border-radius:10px;padding:10px;text-align:center')}">
      <div style="font-size:0.75rem;color:#7B341E;font-weight:700">⚙️ مغادرات ميكانيكية</div>
      <div style="font-size:1.3rem;font-weight:700;color:#C05621">${mCount}</div>
    </div>
    <div onclick="filterDepLineByCategory('fire')" style="${cardStyle('fire', filter==='fire', 'flex:1;min-width:140px;background:#FFF5F5;border:1.5px solid #FC8181;border-radius:10px;padding:10px;text-align:center')}">
      <div style="font-size:0.75rem;color:#742A2A;font-weight:700">🔥 مسببات الحرائق</div>
      <div style="font-size:1.3rem;font-weight:700;color:#C53030">${fireCount}</div>
    </div>
    ${washCount > 0 ? `<div onclick="filterDepLineByCategory('washing')" style="${cardStyle('washing', filter==='washing', 'flex:1;min-width:140px;background:#EBF8FF;border:1.5px solid #90CDF4;border-radius:10px;padding:10px;text-align:center')}">
      <div style="font-size:0.75rem;color:#2B6CB0;font-weight:700">💧 نظافة العوازل</div>
      <div style="font-size:1.3rem;font-weight:700;color:#2B6CB0">${washCount}</div>
    </div>` : ''}
  </div>`;

  if (filter) {
    html += `<div style="display:flex;align-items:center;justify-content:space-between;background:#EDF2F7;border-radius:8px;padding:8px 12px;margin-bottom:10px">
      <span style="font-size:0.82rem;color:#2D3748">🔍 مفلتَر حسب: <b>${CAT_LABELS[filter]}</b></span>
      <button class="btn btn-secondary btn-sm" onclick="filterDepLineByCategory('${filter}')">✕ إلغاء التصفية</button>
    </div>`;
  }

  const visibleTowers = filter ? activeTowers.filter(item => item._cats.includes(filter)) : activeTowers;
  if (filter && !visibleTowers.length) {
    body.innerHTML = html + '<div class="empty-state">لا توجد أبراج بهذا التصنيف</div>';
    return;
  }

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">';
  visibleTowers.forEach(({r, deps}) => {
    const level = getTowerCriticalityLevel(r);
    const meta = TOWER_LEVEL_META[level] || TOWER_LEVEL_META.red;
    const catIconsHTML = buildCategoryIconsHTML(r);
    html += `<div onclick="openDepTowerDetail('${lineName.replace(/'/g,"\\'")}','${r.tower_number}')"
      style="cursor:pointer;border:2px solid ${meta.border};border-radius:10px;padding:10px;text-align:center;background:${meta.bg};position:relative">
      ${catIconsHTML}
      <div style="font-weight:700;color:#1a2e4a;font-size:0.9rem">برج ${r.tower_number}</div>
      <div style="font-size:0.72rem;color:#718096;margin:2px 0">${TOWER_TYPES[r.tower_type]||r.tower_type||''}</div>
      <div style="font-size:0.78rem;font-weight:700;color:${meta.text}">🔴 ${deps.length} مغادرة</div>
      ${csUnresolvedBadge(lineName, r.tower_number)}
    </div>`;
  });
  html += '</div>';
  body.innerHTML = html;
}

let depLineTowersScrollY = 0;

async function openDepTowerDetail(lineName, towerNum) {
  depLineTowersScrollY = window.scrollY; // نحفظ موضع التمرير الحالي حتى نرجع له عند "رجوع"
  pushLevel(backToDepLineTowers);
  document.getElementById('depLineTowersView').style.display = 'none';
  document.getElementById('depTowerDetailView').style.display = '';
  document.getElementById('depTowerDetailTitle').textContent = `🗼 ${lineName} — برج ${towerNum}`;
  if (navigator.onLine) { try { await loadFullTowerRecord(lineName, towerNum); } catch(e) { console.warn('[tower-app] فشل تحميل السجل الكامل لتفاصيل برج المغادرة', e); } }
  renderDepTowerDetail(lineName, towerNum);
}

function renderDepTowerDetail(lineName, towerNum) {
  const body = document.getElementById('depTowerDetailBody');
  const latestRecs = getLatestRecordsPerTower(lineName);
  const r = latestRecs.find(x => String(x.tower_number) === String(towerNum));
  if (!r) { body.innerHTML = '<div class="empty-state">لا توجد بيانات</div>'; return; }

  const deps = extractDepsFromRecord(r);
  const voltage = r.voltage || LINE_VOLTAGE[lineName] || 132;
  const mode = getInsulatorMode(voltage, r.tower_type||'', lineName, r.tower_number);
  const [stA, stB] = lineEndpoints(lineName);

  let html = csTowerBanner(lineName, towerNum) + `<div class="form-card" style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div style="font-weight:700;color:#1a2e4a">📋 آخر كشف</div>
      <div style="font-size:0.78rem;color:#718096">📅 ${r.inspection_date} | 👤 ${r.created_by_name||'—'}</div>
    </div>
  </div>`;

  // العوازل (إن وجدت مغادرات عليها) — الدائرة الأولى
  const isDoubleDetail = isDoubleCircuitLine(lineName);
  const hasInsulatorDeps = deps.some(d => d.type === 'insulator');
  if (hasInsulatorDeps && r.insulator_state) {
    let state;
    state = safeParseJSON(r.insulator_state);
    if (state) {
      html += `<div class="form-card" style="margin-bottom:14px">
        <h3>🔘 ${isDoubleDetail ? 'عوازل الدائرة الأولى' : 'العوازل'}</h3>
        <div class="insulator-legend" style="margin-bottom:10px">
          <div class="legend-item"><div class="legend-box ok"></div><span>سليم</span></div>
          <div class="legend-item"><div class="legend-box dmg"></div><span>متضرر</span></div>
          <div class="legend-item"><div style="width:16px;height:12px;border-radius:2px;border:1.5px solid #276749;background:#48BB78;display:inline-block;vertical-align:middle"></div><span style="margin-right:4px">تمت معالجته</span></div>
        </div>
        <div id="depTowerInsulators" style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center"></div>
      </div>`;
      let insCycleDep = {R:[],S:[],T:[]};
      if (r.insulator_cycle) { insCycleDep = safeParseJSON(r.insulator_cycle) || {R:[],S:[],T:[]}; }
      const treatedIdxDep = getInsulatorTreatedIdx(state, insCycleDep);
      setTimeout(() => renderTowerDetailInsulators(state, treatedIdxDep, mode, stA, stB, 'depTowerInsulators', insCycleDep), 10);
    }
  }

  // العوازل — الدائرة الثانية (كانت غير موجودة إطلاقاً بهذي الشاشة، فتضررها يظهر نصاً فقط بدون شكل مرسوم)
  const hasInsulatorDeps2 = deps.some(d => d.type === 'insulator2');
  if (hasInsulatorDeps2 && r.insulator_state_2) {
    const state2 = safeParseJSON(r.insulator_state_2);
    if (state2) {
      html += `<div class="form-card" style="margin-bottom:14px">
        <h3>🔘 عوازل الدائرة الثانية</h3>
        <div class="insulator-legend" style="margin-bottom:10px">
          <div class="legend-item"><div class="legend-box ok"></div><span>سليم</span></div>
          <div class="legend-item"><div class="legend-box dmg"></div><span>متضرر</span></div>
          <div class="legend-item"><div style="width:16px;height:12px;border-radius:2px;border:1.5px solid #276749;background:#48BB78;display:inline-block;vertical-align:middle"></div><span style="margin-right:4px">تمت معالجته</span></div>
        </div>
        <div id="depTowerInsulators2" style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center"></div>
      </div>`;
      let insCycleDep2 = {R:[],S:[],T:[]};
      if (r.insulator_cycle_2) { insCycleDep2 = safeParseJSON(r.insulator_cycle_2) || {R:[],S:[],T:[]}; }
      const treatedIdxDep2 = getInsulatorTreatedIdx(state2, insCycleDep2);
      setTimeout(() => renderTowerDetailInsulators(state2, treatedIdxDep2, mode, stA, stB, 'depTowerInsulators2', insCycleDep2), 10);
    }
  }

  // باقي المغادرات (نوعا العازل insulator/insulator2 مستثنيان لأنهما معروضان أعلاه كشكل مرسوم مباشرة، مو نص)
  const otherDeps = deps.filter(d => d.type !== 'insulator' && d.type !== 'insulator2');
  html += `<div class="form-card" style="margin-bottom:14px"><h3>🚨 المغادرات المسجلة</h3><div class="dep-items">`;
  if (otherDeps.length) {
    otherDeps.forEach(d => {
      html += `<span class="dep-item damaged">🔴 ${d.label}</span>`;
    });
  } else {
    html += `<span class="dep-item" style="color:#1e8449">✅ لا توجد مغادرات نصية أخرى</span>`;
  }
  html += `</div>`;
  // تنبيه الطريق — منفصل عن المغادرات، يظهر فقط إذا غير متاح
  if (r && r.road_access && r.road_access !== 'متاح' && r.road_access !== '') {
    const roadNote = r.road_access_notes && r.road_access_notes.trim() ? ` — ${r.road_access_notes.trim()}` : '';
    html += `<div style="margin-top:10px;background:rgba(197,48,48,0.1);border:1px solid rgba(197,48,48,0.35);border-radius:8px;padding:8px 12px;font-size:0.82rem;color:#C53030">⚠️ الطريق غير متاح${roadNote}</div>`;
  }
  html += `</div>`;

  body.innerHTML = html;

  // زر المعالجة المباشرة
  const actionBar = document.createElement('div');
  actionBar.className = 'form-actions';
  actionBar.innerHTML = `<button class="btn btn-primary" onclick="goToTreatThisTower('${lineName.replace(/'/g,"\\'")}','${towerNum}')">🔧 معالجة هذا البرج</button>`;
  body.appendChild(actionBar);
}

// إتاحة تحديث القائمة للمزامنة الخلفية دون تحميل هذه الوحدة من أجلها
depUI = { renderLines: renderDepLinesList };

(window.__featModules = window.__featModules || {}).dep = true;
