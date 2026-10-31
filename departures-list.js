/* departures-list.js — v335-C6r9 (landing = ONLY lines with confirmed CURRENT departures, from ONE small server-side line aggregate over the current store (app_departure_index); no tower detail / history is read; a line is read when opened)
   قائمة المغادرات الحالية: الخطوط ← أبراج الخط ← تفاصيل البرج. القراءة من فهرس الحالة الحالية (getActiveDepartureTowers في index.html).
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
async function loadDeparturesImpl(tok) {
  showDepLinesList();
  if (csLiveEnabled()) {
    // v335-C6r9: الدخول يقرأ فهرساً صغيراً واحداً (الخطوط ذات المغادرات الحالية فقط) — لا loadTreatments ولا حالة الخطوط الـ33 ولا تفاصيل الأبراج؛ الخط يُقرأ عند فتحه.
    _depIdx.error = null; _depIdx.last = 0;   // every deliberate ENTRY may make one fresh attempt (never a render-driven loop)
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

// ---- v335-C6r9: the departures landing (live mode) -------------------------------------------------------------------------------------------------------
// The index is a CONFIRMED lower bound: unknown coverage (uninitialised towers) and incomplete towers are shown separately and are never counted as healthy or as zero.
// Guards: session generation + token (a reply for another account is dropped), request sequence (an older reply never replaces a newer one), write generation (a reply that
// started before a local write / sync is re-read once), purge on account change.
// C6r9b: refresh policy (bounded): ONE request in flight; a request is started by (a) an entry/explicit retry, (b) the first paint with nothing attempted yet, (c) ONE re-read per write generation, (d) one age refresh per 60 s of a SETTLED OK state.
// A failed / offline attempt SETTLES (error shown, last index kept as unverified) and waits for an explicit retry or the next deliberate entry - rendering never starts a request while an error is set.
let _depIdx = { data: null, at: null, wgen: -1, tried: -2, last: 0, req: 0, loading: false, error: null };
function depIndexReset() { _depIdx = { data: null, at: null, wgen: -1, tried: -2, last: 0, req: (_depIdx.req || 0) + 1, loading: false, error: null }; }   // req keeps growing: an in-flight reply of the old account is ignored
function depResolveLine(name) {
  if (typeof LINES_DATA === 'undefined' || !name) return null;
  if (LINES_DATA[name]) return name;
  const volt = n => { const m = String(n).match(/\b(400|132)\s*ك\.ف\s*$/); return m ? m[1] : null; }, bare = n => String(n).replace(/\s*(400|132)\s*ك\.ف\s*$/, '').trim();
  const hits = Object.keys(LINES_DATA).filter(k => bare(k) === bare(name) && (!volt(name) || volt(k) === volt(name)));
  return hits.length === 1 ? hits[0] : null;   // ambiguous or unknown: never guess a line
}
// merge server rows that resolve to the same application line; rows that resolve to none are kept (shown, not clickable)
function depIndexRows(data) {
  const m = new Map();
  (data && Array.isArray(data.lines) ? data.lines : []).forEach(l => {
    if (!l || typeof l.line_name !== 'string') return;
    const key = depResolveLine(l.line_name) || l.line_name, o = m.get(key) || { line: key, known: !!depResolveLine(l.line_name), towers: 0, electrical: 0, mechanical: 0, fire: 0, washing: 0, incomplete: 0, uninitialised: 0 };
    ['towers', 'electrical', 'mechanical', 'fire', 'washing', 'incomplete', 'uninitialised'].forEach(f => { o[f] += Number(l[f]) || 0; });
    m.set(key, o);
  });
  return Array.from(m.values());
}
async function depIndexLoad() {
  if (!csLiveEnabled() || _depIdx.loading) return;   // one in-flight request
  const gen = _csAuthGen, tok = CS_AUTH.token, uid = currentUser && currentUser.id, my = ++_depIdx.req, wgen = _csWriteGen;
  _depIdx.loading = true; _depIdx.error = null; _depIdx.tried = wgen; _depIdx.last = Date.now();
  const still = () => gen === _csAuthGen && tok === CS_AUTH.token && currentUser && String(currentUser.id) === String(uid) && my === _depIdx.req;
  const fail = (code) => { _depIdx.loading = false; _depIdx.error = code; };
  try {
    if (!navigator.onLine) throw new Error('offline');
    const r = await csCall('app_departure_index', {});
    if (!still()) return;   // another account / purge / newer request owns the state now
    if (!r) throw new Error('error');
    if (r.stale) throw new Error('stale');
    if (r.ok !== true || !Array.isArray(r.lines) || r.lines.some(l => !l || typeof l.line_name !== 'string' || !Number.isFinite(Number(l.towers)) || !Number.isFinite(Number(l.uninitialised)))) throw new Error(r && r.code ? r.code : 'bad_index');
    // a write that landed while this was in flight is picked up by ONE follow-up read (tried != _csWriteGen); that is bounded by the number of writes, never by renders
    _depIdx = { data: r, at: r.as_of || new Date().toISOString(), ts: Date.now(), wgen, tried: wgen, last: Date.now(), req: _depIdx.req, loading: false, error: null };
  } catch (e) {
    if (!still()) return;
    fail((!navigator.onLine || (e && e.message === 'offline')) ? 'offline' : ((e && e.message) || 'error'));
  }
  try { if (document.getElementById('depLinesListView').style.display !== 'none') renderDepLinesList(); } catch (e) {}
}
function depIndexNeedsLoad() {
  if (_depIdx.loading || _depIdx.error) return false;                        // in flight / settled in failure: only an explicit retry or a new entry restarts
  if (!_depIdx.last) return true;                                           // nothing attempted yet
  if (_depIdx.tried !== _csWriteGen) return true;                           // a write / sync happened since the last attempt: one re-read
  return !!_depIdx.data && Date.now() - _depIdx.last > 60000;               // age refresh of a settled OK state (the attempt time moves on every try)
}
function renderDepLanding() {
  const body = document.getElementById('depLinesListBody');
  if (depIndexNeedsLoad()) setTimeout(depIndexLoad, 0);   // never synchronous: a render can not recurse into a request
  const d = _depIdx.data, esc = v => (typeof _csEsc === 'function' ? _csEsc(v) : String(v));
  let pend = 0; try { const rd = opsRead(); if (rd.ok) pend = rd.items.length; } catch (e) {}
  const refresh = `<button class="btn btn-secondary btn-sm" onclick="_depIdx.error = null; depIndexLoad()">🔄 تحديث</button>`;
  let html = `<div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:0.76rem;color:#4A5568">${refresh}<span>الخطوط ذات مغادرات حالية مؤكدة فقط — من الحالة المخزَّنة على الخادم${d && _depIdx.at ? ' (قراءة ' + esc(String(_depIdx.at).replace('T', ' ').slice(0, 16)) + ')' : ''}</span></div>`;
  if (pend) html += `<div style="margin-bottom:10px;padding:8px 12px;background:#FFFAF0;border:1px solid #F6AD55;border-radius:8px;font-size:0.78rem;color:#7B341E">⏳ ${pend} عملية معلّقة على هذا الجهاز لم تُؤكَّد بعد — الأعداد أدناه لا تتضمنها</div>`;
  if (_depIdx.error) html += `<div style="margin-bottom:10px;padding:8px 12px;background:#FFF5F5;border:1px solid #FC8181;border-radius:8px;font-size:0.78rem;color:#822727">${_depIdx.error === 'offline' ? '📴 دون اتصال' : '⚠️ تعذّر تحديث فهرس المغادرات'}${d ? ' — المعروض آخر فهرس مقروء' : ' — لا يوجد فهرس مقروء بعد'}</div>`;
  if (!d) { body.innerHTML = html + (_depIdx.error ? '' : '<div class="empty-state">⏳ جارٍ قراءة فهرس المغادرات…</div>'); return; }
  const rows = depIndexRows(d);
  const dep = rows.filter(r => r.towers > 0).sort((a, b) => b.towers - a.towers || a.line.localeCompare(b.line, 'ar'));
  const unkOnly = rows.filter(r => r.towers === 0 && r.uninitialised > 0).sort((a, b) => b.uninitialised - a.uninitialised || a.line.localeCompare(b.line, 'ar'));
  const tot = d.totals || {}, unkTot = Number(tot.uninitialised_towers) || 0, incTot = Number(tot.incomplete_towers) || 0;
  const open = (r) => r.known ? ` onclick="openDepLineTowers(${JSON.stringify(r.line).replace(/"/g, '&quot;')})" style="cursor:pointer"` : '';
  const chip = (txt, bg, fg) => `<span style="background:${bg};color:${fg};padding:2px 9px;border-radius:20px;font-size:0.72rem;font-weight:700">${txt}</span>`;
  if (!dep.length) {
    html += `<div class="empty-state">${unkTot || incTot ? 'لا مغادرات مؤكدة بين الأبراج المعروفة' + (unkTot ? ' — ⚠️ ' + unkTot + ' برج غير مهيّأ/غير معروف' : '') + (incTot ? ' — ' + incTot + ' برج بياناتها غير مكتملة' : '') : 'لا توجد مغادرات حالية مؤكدة'}</div>`;
  }
  html += dep.map(r => {
    const parts = [];
    if (r.electrical) parts.push(`<span style="color:#2B6CB0">⚡ كهربائية: ${r.electrical}</span>`);
    if (r.mechanical) parts.push(`<span style="color:#C05621">⚙️ ميكانيكية: ${r.mechanical}</span>`);
    if (r.fire) parts.push(`<span style="color:#C53030">🔥 حرائق: ${r.fire}</span>`);
    if (r.washing) parts.push(`<span style="color:#2B6CB0">💧 نظافة: ${r.washing}</span>`);
    return `<div class="form-card dep-line-row" data-dep-line="${esc(r.line)}" style="margin-bottom:10px;padding:14px;border-right:4px solid #FC4444"${open(r)}>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><div style="font-weight:700;color:#1a2e4a;font-size:0.92rem">${esc(r.line)} 🔍</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${chip('🔴 ' + r.towers + ' برج', '#FED7D7', '#822727')}${r.uninitialised ? chip('⚠️ ' + r.uninitialised + ' غير معروف', '#FEEBC8', '#7B341E') : ''}${r.incomplete ? chip(r.incomplete + ' غير مكتمل', '#EDF2F7', '#4A5568') : ''}</div></div>
      ${parts.length ? `<div style="margin-top:6px;font-size:0.74rem;font-weight:700;display:flex;gap:12px;flex-wrap:wrap">${parts.join('')}</div>` : ''}${r.known ? '' : '<div style="font-size:0.72rem;color:#7B341E;margin-top:4px">خط غير معرّف في التطبيق</div>'}</div>`;
  }).join('');
  if (unkOnly.length) html += `<div class="form-card" id="depUnknownStrip" style="margin-top:14px;padding:12px;border-right:4px solid #ED8936;background:#FFFAF0"><div style="font-weight:700;color:#7B341E;font-size:0.84rem">⚠️ خطوط فيها أبراج حالتها غير معروفة (لا تُعدّ سليمة ولا صفراً)</div>
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">${unkOnly.map(r => `<div${open(r)} style="font-size:0.8rem;color:#4A5568;display:flex;justify-content:space-between;gap:8px"><span>${esc(r.line)}</span><span>${r.uninitialised} برج غير معروف</span></div>`).join('')}</div></div>`;
  body.innerHTML = html;
}

function renderDepLinesList(preliminary) {
  if (!preliminary && csLiveEnabled()) return renderDepLanding();
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

  const allBtn = false ? `<div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn btn-secondary btn-sm" onclick="loadAllDepartureLines()" id="depAllLinesBtn">📊 قراءة أعداد كل الخطوط</button><span style="font-size:0.74rem;color:#718096">اضغط خطاً لقراءته وحده، أو اقرأ الكل بطلب صريح.</span></div>` : '';
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

// P01-B2: نمط N03 (لقطة محفوظة + تحقق قسري) لقائمة أبراج المغادرات. اللقطة = ما قُرئ سابقاً لهذا الخط في هذه الجلسة فقط (loadedLineCacheAt/latestRecordsIndex تُمسح عند الخروج/تبديل الحساب)
// وتُرسم فوراً بوسم «محفوظة — قيد التحقق»؛ القراءة القسرية الواحدة (loadLineRecordsCache(line,true)) تجري دائماً وهي وحدها التي ترفع الوسم. لا طلبات إضافية في المسار العادي.
let _depListSeq = 0, _depHeld = null, _depOpenLine = null;
function _depHeldAt(lineName) {
  if (!csLiveEnabled() || !CS_AUTH.token) return 0;
  const at = loadedLineCacheAt[lineName];
  if (!at) return 0;
  return Object.keys(latestRecordsIndex[lineName] || {}).length ? at : 0;   // خط بلا سجل محمّل لا يُعرض كلقطة
}
function _depRender(lineName, held) {   // الرسم البديل يحفظ موضع التمرير (استبدال اللقطة بالمحقَّق لا يقفز بالصفحة)
  const y = window.scrollY; renderDepLineTowers(lineName, held);
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
}
async function _depListVerify(lineName, tok, heldAt) {
  const seq = ++_depListSeq;
  let res = null, failed = false;
  for (let a = 0; a < 2; a++) {        // ردّ «أقدم من قراءة طُبّقت» لا يُعدّ تحققاً: قراءة طازجة واحدة إضافية (حالة نادرة) ثم وسم صريح
    try { res = await loadLineRecordsCache(lineName, true); } catch (e) { failed = true; break; }
    if (res && res.ok && !res.superseded) break;
  }
  if (seq !== _depListSeq || !featEntryOk(tok) || _depOpenLine !== lineName) return;   // انتقل المستخدم/تبدّل اللسان/الجلسة/طُلب خط آخر: لا نرسم
  const verified = !failed && res && res.ok && !res.superseded;
  if (verified) { _depHeld = null; _depRender(lineName); return; }
  if (!heldAt && !loadedLineCacheAt[lineName] && !latestRecordsIndex[lineName]) {
    _depHeld = null;
    document.getElementById('depLineTowersBody').innerHTML = '<div class="empty-state">⚠️ تعذّرت قراءة حالة هذا الخط من الخادم — تحقق من الاتصال وحاول مرة أخرى<br><button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="retryDepLineTowers()">🔄 إعادة المحاولة</button></div>';
    return;
  }
  try { showToast('⚠️ تعذّر تحديث الخط — المعروض من آخر ما حُمّل', 'error'); } catch (e) {}
  _depHeld = { line: lineName, state: 'error', at: loadedLineCacheAt[lineName] || heldAt || 0, offline: !navigator.onLine, retry: 'retryDepLineTowers()' };
  _depRender(lineName, _depHeld);
}
function retryDepLineTowers() {
  const lineName = _depOpenLine; if (!lineName || !csLiveEnabled()) return;
  const tok = featTok('dep', true), heldAt = _depHeldAt(lineName);
  if (heldAt) { _depHeld = { line: lineName, state: 'pending', at: heldAt, retry: 'retryDepLineTowers()' }; renderDepLineTowers(lineName, _depHeld); }
  else { _depHeld = null; document.getElementById('depLineTowersBody').innerHTML = '<div class="empty-state">⏳ جارٍ قراءة الخط…</div>'; }
  return _depListVerify(lineName, tok, heldAt);
}

async function openDepLineTowers(lineName) {
  const tok = featTok('dep', true);
  pushLevel(backToDepLinesList);
  document.getElementById('depLinesListView').style.display = 'none';
  document.getElementById('depLineTowersView').style.display = '';
  document.getElementById('depLineTowersTitle').textContent = '🗼 أبراج خط ' + lineName + ' — المغادرات';
  depLineTowersCategoryFilter = null; // نبدأ من غير فلتر عند فتح خط جديد
  _depOpenLine = lineName; _depHeld = null;
  if (csLiveEnabled()) {
    // v335-C6r6: قراءة الخط المختار وحده من مخزن الحالة (طلب واحد)؛ لا loadTreatments ولا خطوط أخرى
    const heldAt = _depHeldAt(lineName);
    if (heldAt) { _depHeld = { line: lineName, state: 'pending', at: heldAt, retry: 'retryDepLineTowers()' }; renderDepLineTowers(lineName, _depHeld); }
    else document.getElementById('depLineTowersBody').innerHTML = '<div class="empty-state">⏳ جارٍ قراءة الخط…</div>';
    return _depListVerify(lineName, tok, heldAt);
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
  renderDepLineTowers(depLineTowersCurrentLine, (_depHeld && _depHeld.line === depLineTowersCurrentLine) ? _depHeld : undefined);
}

function renderDepLineTowers(lineName, held) {
  depLineTowersCurrentLine = lineName;
  const body = document.getElementById('depLineTowersBody');
  const activeTowers = getActiveDepartureTowers(lineName);

  // v335-C6r7: لا «لا توجد مغادرات» مطلقة مع بقاء أبراج غير معروفة الحالة (غير مهيّأة/قيد الإصلاح): العبارة مقيَّدة بالأبراج المعروفة
  const _unk = csLiveEnabled() ? csUnknownCount(((_csLineCov[lineName] || {}).sum || {}).coverage) : 0;
  if (!activeTowers.length) { body.innerHTML = csLineBanner(lineName, held) + (_unk ? '<div class="empty-state">لا توجد مغادرات نشطة بين الأبراج المعروفة — ⚠️ ' + _unk + ' برج غير معروف الحالة (لا يمكن القول إن الخط خالٍ)</div>' : '<div class="empty-state">✅ لا توجد مغادرات نشطة بهذا الخط</div>'); return; }

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

  let html = csLineBanner(lineName, held) + `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
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
    // v335-C6r29 (N24-B1): these towers HAVE an open departure (deps) - a missing / "ok" severity never turns them green. N24-B1a: rdy is 'complete' here only because this list states departures, never health (a recorded simple grade keeps its colour)
    const _dInfo = { rdy: 'complete', stale: false, comps: null, pendTreated: null, openAny: !!(deps && deps.length) };
    const level = towerCardLevel(r, _dInfo);
    const meta = TOWER_LEVEL_META[level] || TOWER_LEVEL_META.red;
    const catIconsHTML = buildCategoryIconsHTML(r, towerOpenFields(r, _dInfo));
    html += `<div onclick="openDepTowerDetail('${lineName.replace(/'/g,"\\'")}','${r.tower_number}')"
      style="cursor:pointer;border:2px solid ${meta.border};border-radius:10px;padding:10px;text-align:center;background:${meta.bg};position:relative">
      ${catIconsHTML}
      <div style="font-weight:700;color:#1a2e4a;font-size:0.9rem">برج ${r.tower_number}</div>
      <div style="font-size:0.72rem;color:#718096;margin:2px 0">${TOWER_TYPES[r.tower_type]||r.tower_type||''}</div>
      <div style="font-size:0.78rem;font-weight:700;color:${meta.text}">🔴 ${deps.length} مغادرة</div>
      ${held ? `<div data-held="1" style="font-size:0.68rem;color:#92400E;margin-top:2px">${held.state === 'pending' ? '📴 محفوظة — قيد التحقق' : '📴 آخر حالة محفوظة'}</div>` : ''}
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
