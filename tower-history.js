/* tower-history.js — v335-C6r24 (P02)
   سجل البرج الواحد: أرشيف تاريخي للقراءة فقط (كشوف + معالجات) منفصل تماماً عن الحالة الحالية الموثوقة.
   يُحمَّل ويُنفَّذ مرة واحدة عند أول ضغطة على «سجل البرج» (featLoadModule 'thist' ← يعتمد على 'hist' لمُرقِّم المعالجات). سكربت كلاسيكي يشارك الربط العام مع index.html.
   القواعد (انظر تقرير P02):
    • مخزن مستقل (_thStore) بختم جلسة؛ لا يُكتب شيء إلى fullRecordsCache / treatmentsCache / latestRecordsIndex / _csMem / _opsMarks / الطوابير.
    • استعلامات البرج الواحد فقط (line_name = eq لكل صيغ اسم الخط المعروفة × tower_number = eq)، أعمدة خفيفة (بلا SVG)، ترقيم keyset بلا offset.
    • دمج التيارات (كشوف/معالجات × صيغ الاسم) بقاعدة الأفق: لا يظهر حدث أقدم قبل حدث أحدث لم يُجلب بعد.
    • حالة الإلغاء من app_op_marks فقط (قراءة مستقلة)؛ تعذّرها = «تعذّر التحقق من الإلغاء» لا «نشط». طلب الإلغاء المعلّق ≠ ملغى.
    • لا تعديل ولا إلغاء من هذه الشاشة. */
(function mount_towerHistoryView() {
  if (document.getElementById('towerHistoryView')) return;
  const anchor = document.getElementById('towerDetailView');
  const html = `<div id="towerHistoryView" style="display:none">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div class="page-title" id="towerHistoryTitle" style="margin:0">📜 سجل البرج</div>
    </div>
    <div id="towerHistoryBody" aria-live="polite"></div>
  </div>`;
  if (anchor) anchor.insertAdjacentHTML('afterend', html); else document.body.insertAdjacentHTML('beforeend', html);
})();

const TH_PAGE = 50;          // حجم الصفحة المعروضة (حدث)
const TH_CAP = 500;          // سقف الأحداث المعروضة
const TH_ROUNDS = 6;         // أقصى جولات جلب لكل ضغطة «المزيد» (يحدّ الطلبات)
const TH_I_SEL = 'id,client_uuid,line_name,tower_number,inspection_date,created_at,updated_at,created_by_name,insulator_state,insulator_state_2,insulator_washing,iron_intersections,tower_foundations,tower_attachments,wires_r1,wires_s1,wires_t1,wires_r1_c2,wires_s1_c2,wires_t1_c2,ground_1,ground_2,fire_causes,fire_causes_notes,sev_fire,road_access,road_access_notes,notes';
const TH_T_SEL = 'id,client_uuid,line_name,tower_number,inspection_id,created_at,treatment_date,treated_by,items_treated,notes';
const TH_I_ORD = 'inspection_date.desc,created_at.desc,id.desc';
const TH_I_FLOOR = 'inspection_date=gte.0001-01-01';
const TH_FIRE = { simple: 'مغادرة بسيطة', moderate: 'مغادرة متوسطة', below_critical: 'مغادرة دون الحرجة', critical: 'مغادرة حرجة' };
const TH_WASH = { needs_washing: 'يحتاج غسل', very_dirty: 'ملوثة جداً', clean: 'نظيفة' };
const TH_COMP = { iron: 'تقاطعات الحديد', foundation: 'قواعد البرج', attachment: 'ملحقات البرج', ground_1: 'الأرضي 1', ground_2: 'الأرضي 2', fire: 'مسببات الحرائق', road: 'الطريق', washing: 'نظافة العوازل',
  wire_r1: 'أسلاك R', wire_s1: 'أسلاك S', wire_t1: 'أسلاك T', wire_r1_c2: 'أسلاك R (دائرة 2)', wire_s1_c2: 'أسلاك S (دائرة 2)', wire_t1_c2: 'أسلاك T (دائرة 2)' };

let _thStore = null, _thSeq = 0, _thScrollY = 0, _thSigTimer = null;

// ---------------------------------------------------------------- الجلسة والمخزن
function _thSess() { return { gen: _csAuthGen, tok: CS_AUTH.token, uid: currentUser ? String(currentUser.id) : null, epoch: _reportEpoch }; }
function _thSessOk(s) { return !!s && s.gen === _csAuthGen && s.tok === CS_AUTH.token && s.epoch === _reportEpoch && !!currentUser && String(currentUser.id) === s.uid; }
function thVisible() { const v = document.getElementById('towerHistoryView'); return !!(v && v.style.display !== 'none'); }
function thLive(st) { return !!st && st === _thStore && _thSessOk(st.sess) && thVisible(); }

// صيغ اسم الخط التي يعتبرها الخادم هوية واحدة (tower_cs.line_candidates): الاسم، بدون «400/132 ك.ف»، ومع كل منهما — مرتّبة بلا تكرار
function thLineCands(name) {
  const t = String(name == null ? '' : name); if (!t) return [];
  const bare = t.replace(/\s*(400|132)\s*ك\.ف\s*$/, '').trim();
  const out = []; [t, bare, bare + ' 400 ك.ف', bare + ' 132 ك.ف'].forEach(x => { if (x && out.indexOf(x) < 0) out.push(x); });
  return out;
}

function thNewStore(line, tower, filter) {
  const cands = thLineCands(line), streams = [];
  cands.forEach(l => { streams.push({ k: 'i', line: l, cur: null, done: false, nullWarn: false, err: null }); streams.push({ k: 't', line: l, pg: histPagerNew({ line: l, tower: String(tower) }, { select: TH_T_SEL }), cur: null, done: false, err: null }); });
  return { id: ++_thSeq, sess: _thSess(), line, tower: String(tower), cands, filter: filter || 'all', streams, ev: [], ids: new Set(), limit: TH_PAGE, status: 'idle', err: null, busy: false,
    marks: null, open: new Set(), shown: [], sig: '', stale: false, firstDone: false, hadNet: false };
}

function towerHistPurge() {   // يُستدعى من csPurgeUserData: لا تاريخ يبقى لحساب سابق
  _thStore = null; _thSeq++;
  try { const b = document.getElementById('towerHistoryBody'); if (b) b.innerHTML = ''; const v = document.getElementById('towerHistoryView'); if (v) v.style.display = 'none'; } catch (e) {}
}

// ---------------------------------------------------------------- مفاتيح الترتيب (تنازلي: تاريخ العمل ← created_at ← id)
function thKey(kind, r) {
  const day = kind === 'i' ? r.inspection_date : r.treatment_date;
  return { day: day == null ? '￿' : String(day), at: r.created_at == null ? '' : String(r.created_at), id: String(r.id) };
}
function thCmp(a, b) {   // > 0 إذا كان a أحدث من b
  if (a.day !== b.day) return a.day > b.day ? 1 : -1;
  if (a.at !== b.at) return a.at > b.at ? 1 : -1;
  return a.id === b.id ? 0 : (a.id > b.id ? 1 : -1);
}

// ---------------------------------------------------------------- الجلب (صفحات keyset لكل تيار)
async function _thQ(parts, sel, ord, lim) {
  const res = await sbFetch('inspections?select=' + sel + (parts.length ? '&' + parts.join('&') : '') + '&order=' + ord + '&limit=' + lim);
  if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
  const j = await res.json(); if (!Array.isArray(j)) throw new Error('bad_response'); return j;
}
// الصفحة التالية لتيار الكشوف. المؤشر = آخر صف خام (date, created_at, id)؛ ثلاثة أقسام منفصلة تماماً بـAND فقط (يدعمها app_data_read):
//   Q2: date = d ∧ created_at = c ∧ id < cid    Q1: date = d ∧ created_at < c    Q3: date < d.  لا يُحدَّث المؤشر إلا بعد نجاح كل الطلبات.
async function thInspNext(s, tower, n) {
  const enc = encodeURIComponent, base = ['line_name=eq.' + enc(s.line), 'tower_number=eq.' + enc(tower)], lim = n + 1; let cand, nullWarn = s.nullWarn;
  if (!s.cur) {
    let rows = await _thQ(base, TH_I_SEL, TH_I_ORD, lim);
    if (rows.length && rows[0].inspection_date == null) { nullWarn = true; rows = await _thQ(base.concat([TH_I_FLOOR]), TH_I_SEL, TH_I_ORD, lim); }   // صفوف بلا تاريخ تأتي أولاً في DESC ولا يمكن ترقيمها بـkeyset: تُستبعد مع تحذير صريح
    cand = rows;
  } else {
    const d = enc(s.cur.inspection_date), c = enc(s.cur.created_at), id = enc(s.cur.id);
    const [q2, q1, q3] = await Promise.all([
      _thQ(base.concat(['inspection_date=eq.' + d, 'created_at=eq.' + c, 'id=lt.' + id]), TH_I_SEL, TH_I_ORD, lim),
      _thQ(base.concat(['inspection_date=eq.' + d, 'created_at=lt.' + c]), TH_I_SEL, TH_I_ORD, lim),
      _thQ(base.concat(['inspection_date=lt.' + d]), TH_I_SEL, TH_I_ORD, lim)]);
    cand = q2.concat(q1, q3);
  }
  const taken = cand.slice(0, n), more = cand.length > n;
  s.nullWarn = nullWarn; s.done = !more; if (taken.length) s.cur = taken[taken.length - 1];
  return taken;
}
async function thTreatNext(s, n) { const r = await histPagerNext(s.pg, n); s.done = !r.more; if (r.rows.length) s.cur = r.rows[r.rows.length - 1]; return r.rows; }

function thStreamKey(s) { return s.cur ? thKey(s.k, s.cur) : null; }
function thActive(st) { return st.streams.filter(s => st.filter === 'all' || (st.filter === 'i' ? s.k === 'i' : s.k === 't')); }
// الأحداث الآمنة العرض: مفتاحها ≥ الأكبر (الأحدث) بين مؤشرات التيارات غير المنتهية. تيار لم يُقرأ بعد = لا شيء آمن.
function thSafe(st) {
  const act = thActive(st), unf = act.filter(s => !s.done);
  const evs = st.ev.filter(e => st.filter === 'all' || e.k === st.filter);
  let horizon = null;
  for (const s of unf) { const k = thStreamKey(s); if (!k) return []; if (!horizon || thCmp(k, horizon) > 0) horizon = k; }
  const out = horizon ? evs.filter(e => thCmp(e.key, horizon) >= 0) : evs.slice();
  out.sort((a, b) => thCmp(b.key, a.key));
  return out;
}
// يجلب حتى يكفي ما هو آمن للحدّ المطلوب أو تنتهي التيارات أو تبلغ الجولات حدّها. لا يجلب إلا التيارات المحدِّدة للأفق (الأعلى مؤشراً).
async function thEnsure(st, rounds) {
  for (let r = 0; r < (rounds || TH_ROUNDS); r++) {
    const need = Math.min(st.limit, TH_CAP), safe = thSafe(st), unf = thActive(st).filter(s => !s.done);
    if (!unf.length || safe.length >= need) return;
    let pick = unf.filter(s => !s.cur);
    if (!pick.length) { let hz = null; unf.forEach(s => { const k = thStreamKey(s); if (!hz || thCmp(k, hz) > 0) hz = k; }); pick = unf.filter(s => thCmp(thStreamKey(s), hz) === 0); }
    const res = await Promise.allSettled(pick.map(s => s.k === 'i' ? thInspNext(s, st.tower, TH_PAGE) : thTreatNext(s, TH_PAGE)));
    if (!thLive(st)) return;
    let failed = null;
    res.forEach((x, i) => {
      if (x.status === 'fulfilled') { pick[i].err = null; x.value.forEach(row => { const id = pick[i].k + row.id; if (!st.ids.has(id)) { st.ids.add(id); st.ev.push({ k: pick[i].k, row, key: thKey(pick[i].k, row) }); } }); }
      else { pick[i].err = x.reason; failed = failed || x.reason; }
    });
    if (failed) throw failed;
  }
}

// ---------------------------------------------------------------- علامات الإلغاء (قراءة مستقلة: لا تلمس _opsMarks ولا أي كاش)
async function thLoadMarks(st) {
  let r = null;
  try { r = await csCall('app_op_marks', { p_line_name: null }); } catch (e) { r = null; }
  if (!thLive(st)) return;
  if (r && r.stale) return;
  if (!(r && r.ok === true)) { st.marks = { ok: false, code: r && r.code || 'network' }; return; }
  const whole = new Map(), partial = new Map(), corr = new Map(), ann = new Map();
  (r.voided || []).forEach(v => {
    if (!v || !v.source_id) return;
    const sid = String(v.source_id), rm = Array.isArray(v.removed_items) ? v.removed_items : [];
    if (rm.length) { const o = partial.get(sid) || { keys: new Set(), by: v.by, at: v.at, reason: v.reason }; rm.forEach(x => o.keys.add(typeof x === 'string' ? x : (x && x.key))); partial.set(sid, o); }
    else if (!whole.has(sid)) whole.set(sid, { by: v.by, at: v.at, reason: v.reason });
  });
  (r.corrections || []).forEach(c => { if (c && c.target) corr.set(String(c.target), c); });
  (r.annotations || []).forEach(a => { if (a && a.target) ann.set(String(a.target), a); });
  st.marks = { ok: true, whole, partial, corr, ann, at: Date.now() };
}

// ---------------------------------------------------------------- الأعمال المعلّقة محلياً (قراءة فقط من ops_outbox)
function thPendingInfo(st) {
  const rd = opsRead();
  if (!rd.ok) return { ok: false, events: [], voids: new Map(), other: 0, applied: 0 };
  const cands = new Set(st.cands), mine = rd.items.filter(e => cands.has(e.line) && String(e.tower) === st.tower);
  const confirmedUuid = new Set(); st.ev.forEach(e => { if (e.row.client_uuid) confirmedUuid.add(String(e.row.client_uuid)); });
  const events = [], voids = new Map(); let other = 0, applied = 0;
  mine.forEach(e => {
    if (e.kind === 'observation' || e.kind === 'treatment') { if (confirmedUuid.has(String(e.id))) { applied++; return; } events.push(e); }
    else if (e.kind === 'void' && e.payload && e.payload.target_source_id) voids.set(String(e.payload.target_source_id), e);
    else other++;
  });
  events.sort((a, b) => (b.seq || 0) - (a.seq || 0));
  return { ok: true, events, voids, other, applied };
}
function thPendSig(st) { const p = thPendingInfo(st); return p.ok ? p.events.map(e => e.id + ':' + e.status).concat([...p.voids.values()].map(e => e.id + ':' + e.status), ['o' + p.other]).join(',') : 'unreadable'; }

// ---------------------------------------------------------------- تصنيف القيم (لقطة تاريخية فقط؛ لا «قيد المعالجة» ولا حالة قائمة)
function thJ(v) { if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return undefined; } }
function thFree(v) { if (v == null) return { k: 'missing' }; const t = String(v).trim(); return (t === '' || t === 'سليم') ? { k: 'ok', t: t === '' ? 'بلا ملاحظة' : 'سليم' } : { k: 'note', t }; }
function thInsul(raw) {
  const o = thJ(raw); if (o === null) return { k: 'missing' }; if (o === undefined || typeof o !== 'object' || Array.isArray(o)) return { k: 'invalid' };
  const ph = []; let any = false, miss = [], bad = [];
  ['R', 'S', 'T'].forEach(p => { const a = o[p]; if (!Array.isArray(a) || !a.length) { miss.push(p); return; } if (!a.every(x => typeof x === 'boolean')) { bad.push(p); return; } any = true; ph.push({ p, n: a.filter(Boolean).length, total: a.length }); });
  return any ? { k: 'known', ph, miss, bad } : { k: bad.length ? 'invalid' : 'missing' };
}
// يبني أقسام لقطة الكشف: [{c: 0|1|2, label, k: 'ok'|'note'|'missing'|'invalid', t}]
function thInspSections(r, double) {
  const S = [], add = (c, label, v) => { const x = thFree(v); S.push({ c, label, k: x.k, t: x.t || '' }); };
  const ins1 = thInsul(r.insulator_state), ins2 = thInsul(r.insulator_state_2);
  const insRow = (c, label, x) => {
    if (x.k === 'missing') S.push({ c, label, k: 'missing', t: '' });
    else if (x.k === 'invalid') S.push({ c, label, k: 'invalid', t: 'بيانات غير صالحة' });
    else { const dm = x.ph.reduce((a, y) => a + y.n, 0); S.push({ c, label, k: dm ? 'note' : 'ok', t: x.ph.map(y => y.p + ': ' + (y.n ? y.n + ' متضرر من ' + y.total : 'سليم')).join(' · ') + (x.miss.length ? ' · غير مسجّل: ' + x.miss.join('،') : '') + (x.bad.length ? ' · غير صالح: ' + x.bad.join('،') : '') }); }
  };
  insRow(1, 'العوازل', ins1);
  const w = r.insulator_washing; if (w == null) S.push({ c: 0, label: 'نظافة العوازل', k: 'missing', t: '' }); else { const t = String(w).trim(); S.push({ c: 0, label: 'نظافة العوازل', k: t === 'clean' ? 'ok' : (TH_WASH[t] ? 'note' : (t === '' ? 'missing' : 'invalid')), t: TH_WASH[t] || (t === '' ? '' : 'قيمة غير مفهومة') }); }
  add(0, 'تقاطعات الحديد', r.iron_intersections); add(0, 'قواعد البرج', r.tower_foundations); add(0, 'ملحقات البرج', r.tower_attachments);
  add(1, 'أسلاك R', r.wires_r1); add(1, 'أسلاك S', r.wires_s1); add(1, 'أسلاك T', r.wires_t1);
  add(0, 'الأرضي 1', r.ground_1); add(0, 'الأرضي 2', r.ground_2);
  // مسببات الحرائق: sev_fire (النموذج الحالي) وإلا النص القديم
  if (r.sev_fire != null) { const sv = String(r.sev_fire).trim(); S.push({ c: 0, label: 'مسببات الحرائق', k: sv === 'ok' ? 'ok' : (sv === '' ? 'missing' : 'note'), t: sv === 'ok' ? 'لا يوجد' : [TH_FIRE[sv] || sv, r.fire_causes_notes].filter(Boolean).join(' — ') }); }
  else if (r.fire_causes != null) { const x = thFree(r.fire_causes === 'لا يوجد' ? 'سليم' : r.fire_causes); S.push({ c: 0, label: 'مسببات الحرائق', k: x.k, t: x.k === 'note' ? [x.t, r.fire_causes_notes].filter(Boolean).join(' — ') : (x.t || '') }); }
  else S.push({ c: 0, label: 'مسببات الحرائق', k: 'missing', t: '' });
  if (r.road_access == null) S.push({ c: 0, label: 'الطريق', k: 'missing', t: '' }); else { const t = String(r.road_access).trim(); S.push({ c: 0, label: 'الطريق', k: t === 'متاح' ? 'ok' : (t === '' ? 'missing' : 'note'), t: t === 'متاح' ? 'متاح' : [t, r.road_access_notes].filter(Boolean).join(' — ') }); }
  const has2 = ins2.k !== 'missing' || r.wires_r1_c2 != null || r.wires_s1_c2 != null || r.wires_t1_c2 != null;
  if (double || has2) { insRow(2, 'العوازل', ins2); add(2, 'أسلاك R', r.wires_r1_c2); add(2, 'أسلاك S', r.wires_s1_c2); add(2, 'أسلاك T', r.wires_t1_c2); }
  return S;
}
function thItems(v) {   // عناصر المعالجة بصيغها المعروفة؛ null = صيغة غير مفهومة
  let a = v; if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { return null; } }
  if (a && !Array.isArray(a) && typeof a === 'object' && Array.isArray(a.items)) a = a.items;
  if (!Array.isArray(a)) return null;
  const out = []; for (const i of a) { if (typeof i === 'string') out.push({ key: i, label: TH_COMP[i] || i }); else if (i && typeof i === 'object' && (i.key || i.label)) out.push({ key: String(i.key || i.label), label: String(i.label || TH_COMP[i.key] || i.key), count: i.count }); else return null; }
  return out;
}
function thItemCircuit(key) { const k = String(key); if (/^ins2_/.test(k) || /_c2$/.test(k) || /^chainreplace_.*_2$/.test(k)) return 2; if (/^ins_/.test(k) || /^chainreplace_.*_1$/.test(k)) return 1; return 0; }

// ---------------------------------------------------------------- حالة الحدث (مؤكد/ملغى/معلّق/غير معروف)
function thStatus(st, e, pend) {
  const id = String(e.row.id), m = st.marks, out = { chips: [], cancelled: false, partial: null, modified: [] };
  const pv = pend.ok ? pend.voids.get(id) : null;
  if (!m) out.chips.push({ c: 'info', t: '⏳ جاري التحقق من الإلغاء' });
  else if (!m.ok) out.chips.push({ c: 'warn', t: '⚠️ تعذّر التحقق من الإلغاء' });
  else if (m.whole.has(id)) { const v = m.whole.get(id); out.cancelled = true; out.chips.push({ c: 'bad', t: '🚫 ملغى (مؤكد من الخادم)' + (v.at ? ' — ' + String(v.at).slice(0, 10) : '') + (v.by ? ' — ' + v.by : '') + (v.reason ? ' — ' + v.reason : '') }); }
  else out.chips.push({ c: 'ok', t: '✔ مؤكد على الخادم' });
  if (m && m.ok && !out.cancelled) {
    if (m.partial.has(id)) out.partial = m.partial.get(id);
    if (m.corr.has(id)) out.modified.push('تصحيح'); if (m.ann.has(id)) out.modified.push('تعديل بيانات وصفية');
  }
  if (pv && !out.cancelled) {
    if (pv.status === 'pending') out.chips.push({ c: 'pend', t: '⏳ طلب إلغاء معلّق — لم يُؤكَّد بعد' });
    else out.chips.push({ c: 'warn', t: '⛔ طلب إلغاء ' + (pv.status === 'conflict' ? 'متعارض' : 'مرفوض') + (pv.err === 'later_ops' ? ' (عمليات أحدث على نفس المكوّنات)' : '') + ' — الحدث ما زال قائماً على الخادم' });
  }
  return out;
}

// ---------------------------------------------------------------- الرسم
function _e(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v == null ? '' : String(v)) : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const TH_CHIP = { ok: 'background:#F0FFF4;color:#276749;border:1px solid #9AE6B4', bad: 'background:#FFF5F5;color:#742A2A;border:1px solid #FEB2B2', warn: 'background:#FFFAF0;color:#7B341E;border:1px solid #F6AD55', pend: 'background:#FEFCBF;color:#744210;border:1px solid #ECC94B', info: 'background:#EBF8FF;color:#2A4365;border:1px solid #90CDF4', mod: 'background:#EDF2F7;color:#2D3748;border:1px solid #CBD5E0' };
const thChip = c => `<span style="display:inline-block;margin:2px 0 0 4px;padding:2px 8px;border-radius:10px;font-size:0.72rem;${TH_CHIP[c.c] || TH_CHIP.info}">${_e(c.t)}</span>`;

function thSecRow(s) {
  const mark = s.k === 'ok' ? '✔' : s.k === 'note' ? '📌' : s.k === 'invalid' ? '⚠️' : '▫️';
  const txt = s.k === 'missing' ? '<span style="color:#718096">غير مسجّل</span>' : s.k === 'ok' ? '<span style="color:#276749">' + _e(s.t || 'سليم') + ' — مسجّل</span>' : s.k === 'invalid' ? '<span style="color:#7B341E">' + _e(s.t) + '</span>' : '<span style="color:#2D3748">' + _e(s.t) + '</span>';
  return `<div style="font-size:0.8rem;padding:3px 0;overflow-wrap:anywhere">${mark} <strong style="color:#2E4057">${_e(s.label)}:</strong> ${txt}</div>`;
}
function thInspCard(st, e, pend) {
  const r = e.row, id = String(r.id), s = thStatus(st, e, pend), dbl = (typeof isDoubleCircuitLine === 'function') ? !!isDoubleCircuitLine(st.line) : false;
  const S = thInspSections(r, dbl), notes = S.filter(x => x.k === 'note'), oks = S.filter(x => x.k === 'ok'), miss = S.filter(x => x.k === 'missing' || x.k === 'invalid');
  const created = r.created_at ? String(r.created_at) : '', cday = created.slice(0, 10), later = cday && r.inspection_date && cday !== String(r.inspection_date);
  const upd = r.updated_at && r.created_at && (Date.parse(r.updated_at) - Date.parse(r.created_at)) > 60000;
  const col = (c, title) => { const rows = S.filter(x => x.c === c); return rows.length ? `<div style="flex:1;min-width:150px"><div style="font-size:0.74rem;font-weight:700;color:#4A5568;margin-bottom:2px">${title}</div>${rows.map(thSecRow).join('')}</div>` : ''; };
  const sum = `${notes.length ? '📌 ' + notes.length + ' مسجّل' : '— لا ملاحظات مسجّلة'} · ✔ ${oks.length} سليم مسجّل · ▫️ ${miss.length} غير مسجّل`;
  const topNotes = notes.slice(0, 2).map(x => _e(x.label + ': ' + x.t)).join(' | ');
  return `<div class="form-card th-card" data-id="${_e(id)}" style="margin-bottom:10px;${s.cancelled ? 'opacity:0.7;' : ''}border-right:4px solid ${s.cancelled ? '#A0AEC0' : '#4299E1'}">
    <details data-th="${_e(id)}" ${st.open.has('i' + id) ? 'open' : ''}><summary style="cursor:pointer;list-style:none">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><strong style="color:#1a2e4a">📋 كشف — ${_e(r.inspection_date || 'بلا تاريخ')}</strong><span style="font-size:0.76rem;color:#718096">👤 ${_e(r.created_by_name || 'غير مسجّل')}</span></div>
      <div style="font-size:0.8rem;color:#4A5568;margin-top:3px;overflow-wrap:anywhere">${sum}${topNotes ? '<br>' + topNotes : ''}</div>
      <div>${s.chips.map(thChip).join('')}${s.modified.length ? thChip({ c: 'mod', t: '✎ عُدِّل لاحقاً (' + s.modified.join('، ') + ')' }) : ''}</div></summary>
      <div style="margin-top:8px;border-top:1px dashed #E2E8F0;padding-top:8px">
        <div style="display:flex;gap:14px;flex-wrap:wrap">${col(1, 'الدائرة الأولى')}${col(2, 'الدائرة الثانية')}${col(0, 'عام')}</div>
        ${r.notes ? `<div style="font-size:0.8rem;margin-top:6px;white-space:pre-wrap;overflow-wrap:anywhere">📝 ${_e(r.notes)}</div>` : ''}
        <div style="font-size:0.72rem;color:#718096;margin-top:8px;line-height:1.7">لقطة تاريخية لما سُجّل في هذا اليوم — لا تدل على أن الحالة قائمة الآن. الكشف اليومي صف واحد قد يضم عدة عمليات رصد في اليوم؛ لا تُعرض قيم وسيطة أو قيم ما قبل التعديل.${later ? '<br>سُجّل في: ' + _e(created.slice(0, 16).replace('T', ' ')) + ' (توقيت الخادم)' : ''}${upd ? '<br>عُدِّل بعد إنشائه (آخر تحديث ' + _e(String(r.updated_at).slice(0, 16).replace('T', ' ')) + ') — القيم الأصلية غير متاحة' : ''}</div>
      </div></details></div>`;
}
function thTreatCard(st, e, pend, byId) {
  const r = e.row, id = String(r.id), s = thStatus(st, e, pend), items = thItems(r.items_treated), rm = s.partial ? s.partial.keys : new Set();
  const insp = r.inspection_id ? byId.get(String(r.inspection_id)) : null;
  const chip = i => { const c = thItemCircuit(i.key), removed = rm.has(i.key), cl = c ? `<span style="color:#718096;font-size:0.7rem"> (دائرة ${c})</span>` : ''; return `<span style="display:inline-block;margin:2px 0 0 4px;padding:2px 8px;border-radius:10px;font-size:0.76rem;${removed ? 'background:#EDF2F7;color:#718096;text-decoration:line-through;border:1px solid #CBD5E0' : 'background:#F0FFF4;color:#276749;border:1px solid #9AE6B4'}">${_e(i.label)}${i.count ? ' ×' + _e(i.count) : ''}${cl}</span>${removed ? '<span style="font-size:0.7rem;color:#7B341E"> أُزيلت لاحقاً</span>' : ''}`; };
  return `<div class="form-card th-card" data-id="${_e(id)}" style="margin-bottom:10px;${s.cancelled ? 'opacity:0.7;' : ''}border-right:4px solid ${s.cancelled ? '#A0AEC0' : '#48BB78'}">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><strong style="color:#1a2e4a">🔧 معالجة — ${_e(r.treatment_date || 'بلا تاريخ')}</strong><span style="font-size:0.76rem;color:#718096">👤 ${_e(r.treated_by || 'غير مسجّل')}</span></div>
    <div style="margin-top:4px">${items === null ? '<span style="font-size:0.78rem;color:#7B341E">تفاصيل العناصر غير متاحة بهذه الصيغة القديمة</span>' : (items.length ? items.map(chip).join('') : '<span style="font-size:0.78rem;color:#7B341E">لا عناصر مسجّلة</span>')}</div>
    ${r.notes ? `<div style="font-size:0.8rem;margin-top:6px;white-space:pre-wrap;overflow-wrap:anywhere">📝 ${_e(r.notes)}</div>` : ''}
    <div style="font-size:0.74rem;color:#718096;margin-top:6px">${r.inspection_id ? (insp ? 'مرتبطة بكشف ' + _e(insp.inspection_date) : 'مرتبطة بكشف غير محمَّل في القائمة الحالية') : 'غير مرتبطة بكشف محدد'}${s.partial ? ' · أُزيلت بعض عناصرها بعملية إلغاء جزئي مؤكدة' : ''}</div>
    <div>${s.chips.map(thChip).join('')}${s.modified.length ? thChip({ c: 'mod', t: '✎ عُدِّل لاحقاً (' + s.modified.join('، ') + ')' }) : ''}</div></div>`;
}
function thPendCard(e) {
  const p = e.payload || {}, obs = e.kind === 'observation';
  const keys = obs ? Object.keys(p.comps || {}) : ((p.items_treated || []).map(i => i && (i.label || i.key)).filter(Boolean).concat(p.text_items && !(p.items_treated || []).length ? p.text_items : []).concat(Object.keys(p.treated || {})));
  const lab = k => TH_COMP[k] || (/^ins2_/.test(k) ? 'عوازل الدائرة 2 ' + k.slice(5) : /^ins_/.test(k) ? 'عوازل الدائرة 1 ' + k.slice(4) : k);
  const status = e.status === 'pending' ? (e.sent_at ? '⏳ معلّق — أُرسل ولم يصل الرد' : '⏳ معلّق — لم يُؤكَّد بعد') : e.status === 'conflict' ? '⚠️ متعارض — بانتظار قرار' : '⛔ مرفوض' + (e.err ? ' (' + e.err + ')' : '');
  return `<div class="form-card th-pend" data-id="${_e(e.id)}" style="margin-bottom:10px;border:2px dashed #ECC94B;background:#FFFFF0"><strong style="color:#744210">${obs ? '📋 كشف' : '🔧 معالجة'} (محلي) — ${_e(p.business_date || '—')}</strong> <span style="font-size:0.76rem;color:#718096">👤 ${_e(e.uname || 'غير مسجّل')}</span>
    <div style="font-size:0.8rem;margin-top:4px;overflow-wrap:anywhere">${keys.length ? keys.map(k => _e(lab(k))).join('، ') : 'لا تفاصيل'}</div><div>${thChip({ c: e.status === 'pending' ? 'pend' : 'warn', t: status })}</div>
    <div style="font-size:0.72rem;color:#718096;margin-top:4px">لم يُؤكَّد على الخادم ولا يُحسب ضمن التاريخ المؤكد.</div></div>`;
}

function thCurrentStateLine(st) {
  try {
    const ent = _csMem.get(csKey(st.line, st.tower)), env = ent && ent.env;
    if (!env || env.basis !== 'operations' || !Array.isArray(env.components) || !env.row || typeof towerDetailModel !== 'function') return '⚠️ تعذّر التحقق من الحالة الحالية — راجع «تفاصيل البرج»';
    const m = towerDetailModel(env, {}), t = { open: 'توجد بنود قيد المعالجة', treated: 'كل الملاحظات المسجّلة معالجة', clear: 'لا ملاحظات مسجّلة (كل الأقسام المنطبقة معلومة)', unknown: 'توجد بيانات غير مسجّلة — لا يمكن الجزم' }[m.footer] || 'غير محسومة';
    return 'الحالة الحالية (من تفاصيل البرج): ' + t + (env.status === 'needs_review' ? ' — تحتاج مراجعة' : '');
  } catch (e) { return '⚠️ تعذّر التحقق من الحالة الحالية — راجع «تفاصيل البرج»'; }
}

function thVisibleEvents(st) { const safe = thSafe(st); return { safe, vis: safe.slice(0, Math.min(st.limit, TH_CAP)) }; }
function thMoreState(st) { const { safe, vis } = thVisibleEvents(st), unf = thActive(st).filter(s => !s.done).length; return { vis, more: safe.length > vis.length || unf > 0, capped: vis.length >= TH_CAP && (safe.length > vis.length || unf > 0) }; }

function thNetErr(e) { return !!(e && (e.name === 'TypeError' || /Failed to fetch|NetworkError|network/i.test(String(e.message || '')))) || (typeof navigator !== 'undefined' && navigator.onLine === false); }

function thFilterBar(st) {
  const b = (f, t) => `<button class="btn ${st.filter === f ? 'btn-primary' : 'btn-secondary'}" style="flex:1;padding:8px 6px;font-size:0.82rem" onclick="thSetFilter('${f}')" aria-pressed="${st.filter === f}">${t}</button>`;
  return `<div style="display:flex;gap:6px;margin:10px 0">${b('all', 'الكل')}${b('i', 'كشوف')}${b('t', 'معالجات')}</div>`;
}

function thRender() {
  const body = document.getElementById('towerHistoryBody'), st = _thStore; if (!body || !st) return;
  const pend = thPendingInfo(st), kindOk = e => st.filter === 'all' || (st.filter === 'i' ? e.kind === 'observation' : e.kind === 'treatment');
  let h = `<div class="form-card" style="margin-bottom:8px;border-right:4px solid #2E4057"><div style="font-weight:700;color:#1a2e4a">🗼 ${_e(st.line)} — برج ${_e(st.tower)}</div>
    <div style="font-size:0.8rem;color:#2D3748;margin-top:4px">${_e(thCurrentStateLine(st))}</div>
    <div style="font-size:0.74rem;color:#7B341E;margin-top:4px">الأحداث أدناه لقطات تاريخية لما سُجّل، ولا تدل على أن عطلاً ما زال قائماً الآن.</div></div>`;
  if (st.stale) h += `<div class="empty-state" style="background:#EBF8FF;color:#2A4365;border-radius:8px;padding:10px;margin-bottom:8px" role="status">تغيّرت بيانات هذا البرج — <button class="btn-sm btn-primary" onclick="thRefresh()">تحديث</button></div>`;
  h += thFilterBar(st);
  if (!pend.ok) h += '<div class="empty-state" style="background:#FFFAF0;color:#7B341E;border-radius:8px;padding:10px;margin-bottom:8px" role="alert">⚠️ تعذّرت قراءة الأعمال المعلّقة محلياً — قد توجد أحداث معلّقة غير معروضة.</div>';
  const pe = pend.ok ? pend.events.filter(kindOk) : [];
  if (pe.length) h += `<div id="thPending"><div style="font-size:0.8rem;font-weight:700;color:#744210;margin:6px 0">⏳ معلّق محلياً (${pe.length}) — غير مؤكد</div>${pe.map(thPendCard).join('')}</div>`;
  if (pend.ok && (pend.other || pend.applied)) h += `<div style="font-size:0.74rem;color:#744210;margin-bottom:6px">${pend.other ? pend.other + ' عملية معلّقة أخرى لهذا البرج (تصحيح/تعليق) لا تُعرض كأحداث. ' : ''}${pend.applied ? pend.applied + ' عملية معلّقة ظهرت مؤكدة على الخادم (أُخفيت من المعلّقات).' : ''}</div>`;
  const hasRows = st.ev.length > 0;
  if (!hasRows && st.status === 'loading') h += '<div class="empty-state" role="status">⏳ جاري التحميل...</div>';
  else if (!hasRows && st.status === 'offline') h += `<div class="empty-state" style="background:#EBF4FF;color:#2C5282;border-radius:8px;padding:12px" role="status">📴 لا يوجد اتصال — السجل المؤكد يحتاج اتصالاً بالإنترنت. هذا لا يعني عدم وجود تاريخ.<div style="margin-top:8px"><button class="btn-sm btn-primary" onclick="thRetry()">إعادة المحاولة</button></div></div>`;
  else if (!hasRows && st.status === 'error') h += `<div class="empty-state" style="background:#FEF3C7;color:#92400E;border-radius:8px;padding:12px" role="alert">⚠️ تعذّر تحميل سجل البرج (خطأ بالخادم أو الاتصال). هذا لا يعني عدم وجود تاريخ.<div style="margin-top:8px"><button class="btn-sm btn-primary" onclick="thRetry()">إعادة المحاولة</button></div></div>`;
  else {
    const { vis, more, capped } = thMoreState(st), byId = new Map(); st.ev.forEach(e => { if (e.k === 'i') byId.set(String(e.row.id), e.row); });
    st.shown = vis.map(e => e.k + e.row.id);
    if (!vis.length && st.status === 'ready' && !more) h += '<div class="empty-state" role="status">لا توجد أحداث مسجّلة لهذا البرج على الخادم' + (st.filter !== 'all' ? ' ضمن هذا النوع' : '') + ' — لا يُستدل من ذلك على سلامة البرج.</div>';
    h += '<div id="thList">' + vis.map(e => e.k === 'i' ? thInspCard(st, e, pend) : thTreatCard(st, e, pend, byId)).join('') + '</div><div id="thFooter"></div>';
  }
  body.innerHTML = h; thFooter();
}

function thFooter() {
  const st = _thStore, f = document.getElementById('thFooter'); if (!st || !f) return;
  const { vis, more, capped } = thMoreState(st), warn = [];
  if (st.streams.some(s => s.nullWarn)) warn.push('توجد كشوف بلا تاريخ لا يمكن ترقيمها فلا تُعرض.');
  const variants = st.streams.filter(s => s.line !== st.line && s.cur).length; if (variants) warn.push('دُمجت سجلات مسجّلة بصيغ قديمة لاسم الخط.');
  if (st.marks && st.marks.ok === false) warn.push('تعذّر التحقق من الإلغاء لكل الأحداث — لا تُعتبر أياً منها نشطة.');
  if (st.srcMissing) warn.push('⚠️ الكشف المصدر للحالة الحالية غير موجود في الأرشيف — الأرشيف غير مكتمل.');
  let h = `<div style="text-align:center;font-size:0.8rem;color:#4A5568;margin:10px 0" id="thCount">المعروض: ${vis.length} حدث</div>`;
  if (st.status === 'offline') h += '<div class="empty-state" style="background:#EBF4FF;color:#2C5282;border-radius:8px;padding:10px" role="status">📴 انقطع الاتصال — المعروض محفوظ. <button class="btn-sm btn-primary" onclick="thRetry()">إعادة المحاولة</button></div>';
  else if (st.status === 'error') h += '<div class="empty-state" style="background:#FEF3C7;color:#92400E;border-radius:8px;padding:10px" role="alert">⚠️ تعذّر تحميل المزيد — المعروض سليم. <button class="btn-sm btn-primary" onclick="thRetry()">إعادة المحاولة</button></div>';
  else if (capped) h += `<div class="empty-state" role="status">عُرض أول ${TH_CAP} حدث (سقف العرض). التاريخ الأقدم موجود لكنه غير معروض هنا.</div>`;
  else if (more) h += `<div style="text-align:center"><button class="btn btn-secondary" id="thMoreBtn" onclick="thMore()" ${st.busy ? 'disabled' : ''}>${st.busy ? '⏳ جاري التحميل...' : '⬇️ عرض المزيد'}</button></div>`;
  else h += '<div style="text-align:center;font-size:0.78rem;color:#718096">— نهاية السجل —</div>';
  h += (warn.length ? `<div style="font-size:0.76rem;color:#7B341E;background:#FFFAF0;border:1px solid #F6AD55;border-radius:8px;padding:8px;margin-top:8px" role="alert">${warn.map(_e).join('<br>')}</div>` : '') +
    '<div style="font-size:0.72rem;color:#718096;margin-top:8px;line-height:1.7">يشمل السجل صيغ اسم الخط المعروفة (' + _e(st.cands.length) + ') ورقم البرج كما هو مسجّل حرفياً؛ سجلات بصيغ غير معتادة قد لا تظهر. الحالة الحالية الموثوقة في «تفاصيل البرج» فقط.</div>';
  f.innerHTML = h;
}

// ---------------------------------------------------------------- التشغيل
async function thLoad(st, first) {
  st.busy = true; st.status = st.ev.length ? 'ready' : 'loading'; if (first || !st.ev.length) thRender(); else thFooter();
  const marksP = (!st.marks || !st.marks.ok) ? thLoadMarks(st) : Promise.resolve();
  try {
    await thEnsure(st); await marksP;
    if (!thLive(st)) return;
    st.status = 'ready'; st.err = null; st.firstDone = true; st.hadNet = true;
    thSourceCheck(st);
  } catch (e) {
    await marksP.catch(() => {});
    if (!thLive(st)) return;
    st.err = e; st.status = thNetErr(e) ? 'offline' : 'error';
  } finally { if (st === _thStore) { st.busy = false; } }
  if (!thLive(st)) return;
  st.sig = thPendSig(st); thRender();
}
// تحقق سلامة الهوية: الكشف المصدر للحالة الحالية (من app_tower_state) يجب أن يكون ضمن الأرشيف عند اكتماله
function thSourceCheck(st) {
  st.srcMissing = false;
  try {
    const ent = _csMem.get(csKey(st.line, st.tower)), env = ent && ent.env, sid = env && env.source && (env.source.inspection_id || env.source.id);
    if (!sid) return;
    const done = st.streams.filter(s => s.k === 'i').every(s => s.done);
    if (done && !st.ev.some(e => e.k === 'i' && String(e.row.id) === String(sid)) && !(st.marks && st.marks.ok && st.marks.whole.has(String(sid)))) st.srcMissing = true;
  } catch (e) {}
}

function thOpenImpl(line, tower) {
  _thScrollY = window.scrollY;
  pushLevel(towerHistBack);
  const dv = document.getElementById('towerDetailView'); if (dv) dv.style.display = 'none';
  document.getElementById('towerHistoryView').style.display = '';
  document.getElementById('towerHistoryTitle').textContent = `📜 سجل البرج — ${line} — برج ${tower}`;
  const prev = _thStore; const st = thNewStore(line, tower, 'all'); _thStore = st; window.scrollTo(0, 0);
  thLoad(st, true);
}
function towerHistOpen(line, tower) { return thOpenImpl(line, tower); }
function towerHistBack() {
  const v = document.getElementById('towerHistoryView'); if (v) v.style.display = 'none';
  const dv = document.getElementById('towerDetailView'); if (dv) dv.style.display = '';
  _thStore = null; _thSeq++;   // إغلاق الشاشة يلغي أي ردّ متأخر ويُحرّر الذاكرة
  const b = document.getElementById('towerHistoryBody'); if (b) b.innerHTML = '';
  const y = _thScrollY; setTimeout(() => { try { window.scrollTo(0, y); } catch (e) {} }, 0);
}
function towerHistHide() { const v = document.getElementById('towerHistoryView'); if (v && v.style.display !== 'none') { v.style.display = 'none'; _thStore = null; _thSeq++; } }

async function thMore() {
  const st = _thStore; if (!thLive(st) || st.busy) return;
  const before = Math.min(st.limit, TH_CAP); st.limit = Math.min(st.limit + TH_PAGE, TH_CAP);
  await thLoad(st, false);   // thLoad يعيد الرسم الكامل؛ حالة فتح البطاقات محفوظة في st.open
}
async function thRetry() { const st = _thStore; if (!thLive(st) || st.busy) return; st.status = st.ev.length ? 'ready' : 'loading'; if (st.marks && !st.marks.ok) st.marks = null; await thLoad(st, !st.ev.length); }
function thSetFilter(f) {
  const st = _thStore; if (!thLive(st) || st.filter === f) return; st.filter = f; st.limit = TH_PAGE; st.status = st.ev.length ? 'ready' : st.status;
  thRender(); if (!st.busy) thLoad(st, false);
}
async function thRefresh() {   // إعادة تحميل كاملة بنفس المرشّح؛ تُستبدل القائمة عند نجاح الصفحة الأولى فقط
  const old = _thStore; if (!thLive(old)) return;
  const st = thNewStore(old.line, old.tower, old.filter); st.open = old.open; _thStore = st;
  old.stale = false; await thLoad(st, true);
}
// إبطال: يُستدعى من csNoteWrites / updatePendingBadge (مؤخَّر): يعيد رسم المعلّق فوراً، ويحدّث القائمة المؤكدة إذا اختفى معلّق (أي زامن)
function towerHistNote() {
  if (!_thStore || !thVisible()) return;
  clearTimeout(_thSigTimer);
  _thSigTimer = setTimeout(() => {
    const st = _thStore; if (!thLive(st) || st.busy) return;
    const sig = thPendSig(st); if (sig === st.sig) return;
    const had = st.sig ? st.sig.split(',').filter(x => x && !/^o\d+$/.test(x)).length : 0, now = sig.split(',').filter(x => x && !/^o\d+$/.test(x)).length;
    st.sig = sig;
    if (sig === 'unreadable' || now >= had) { thRender(); return; }
    thRender(); thRefresh();   // اختفى معلّق: غالباً تأكّد على الخادم → أعد القراءة (يمنع التكرار ويُظهر المؤكد)
  }, 200);
}
document.addEventListener('toggle', ev => { const d = ev.target; if (d && d.tagName === 'DETAILS' && d.dataset && d.dataset.th && _thStore) { const k = 'i' + d.dataset.th; if (d.open) _thStore.open.add(k); else _thStore.open.delete(k); } }, true);

(window.__featModules = window.__featModules || {}).thist = true;
