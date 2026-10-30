/* treatment-history.js — v335-C6r21 (P01-B1)
   سجل المعالجات (التبويب + فلاتر) ونافذة تعديل المعالجة (تاريخ/منفّذ/ملاحظات/إزالة عناصر).
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
(function mount_treatmentEditModalBg() {
  if (document.getElementById('treatmentEditModalBg')) return;
  const html = `
<div class="treat-modal-bg" id="treatmentEditModalBg">
  <div class="treat-modal">
    <h3>✏️ تعديل المعالجة</h3>
    <div class="field" style="margin-top:14px">
      <label>تاريخ المعالجة</label>
      <input type="date" id="teEditDate" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
    </div>
    <div class="field" style="margin-top:12px">
      <label>المعالج</label>
      <input type="text" id="teEditTreatedBy" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
    </div>
    <div class="field" style="margin-top:12px">
      <label>العناصر المعالَجة (احذف أي عنصر أُضيف بالخطأ)</label>
      <div id="teEditItemsWrap" style="margin-top:6px;border:1.5px solid #E2E8F0;border-radius:8px;padding:8px;max-height:180px;overflow-y:auto"></div>
    </div>
    <div class="field" style="margin-top:12px">
      <label>ملاحظات</label>
      <textarea id="teEditNotes" rows="3" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%"></textarea>
    </div>
    <div class="form-actions" style="margin-top:18px;flex-direction:column;gap:10px">
      <button class="btn btn-primary" onclick="saveTreatmentEdit()" style="width:100%">💾 حفظ التعديل</button>
      <button class="btn btn-secondary" onclick="closeTreatmentEditModal()" style="width:100%">إلغاء</button>
    </div>
  </div>
</div>
`;
  const anchor = document.getElementById('printLinesModalBg');
  if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else document.body.insertAdjacentHTML('beforeend', html);
})();
// ========================================================================================================
// v335-C6r21 (P01-B1): سجل المعالجات عند الطلب، بصفحات من 50، بترقيم keyset دقيق عبر app_data_read نفسه.
//  - لا قراءة للمعالجات عند فتح الشاشة؛ الفلاتر (خط من LINES_DATA، برج، من، إلى) ثم زر «عرض النتائج».
//  - الترتيب المعروض = ترتيب الخادم: treatment_date تنازلي ← created_at تنازلي ← id تنازلي (محدِّد تعادل حتمي).
//  - مخزن مستقل (_histStore) — لا يُكتب شيء منه إلى treatmentsCache إطلاقاً.
//  - الترقيم لا يستخدم offset إطلاقاً (باستثناء لا شيء): المؤشر = آخر صف خام (date, created_at) + عدّاد تعادلاتهما.
// ========================================================================================================
const HIST_PAGE = 50;       // حجم الصفحة المعروضة
const HIST_CAP = 500;       // سقف الصفوف المحمّلة للعرض (10 صفحات) — يمنع نمو الذاكرة/DOM بلا حد
const HIST_BATCH = 100;     // دفعة التصدير/الحذف الجماعي (البطاقات تحمل SVG كبيرة: حمولة محدودة)
const HIST_SLIM_BATCH = 999;    // دفعة الفهرس الخفيف للأرشيف (أعمدة قليلة): 999 + صف استباق = 1000 = أقصى صفحة يسمح بها الخادم (max_page)
const HIST_FLOOR = 'treatment_date=gte.0001-01-01';   // يُقصي صفوف NULL (لا عامل IS NULL في app_data_read)
const HIST_ORD = 'treatment_date.desc,created_at.desc,id.desc';

function _histSess() { return { gen: _csAuthGen, tok: CS_AUTH.token, uid: currentUser ? String(currentUser.id) : null, epoch: _reportEpoch }; }
function _histSessOk(s) { return !!s && s.gen === _csAuthGen && s.tok === CS_AUTH.token && s.epoch === _reportEpoch && !!currentUser && String(currentUser.id) === s.uid; }

function histParts(f) {
  const p = [];
  if (f.line) p.push('line_name=eq.' + encodeURIComponent(f.line));
  if (f.tower) p.push('tower_number=eq.' + encodeURIComponent(f.tower));
  if (f.from) p.push('treatment_date=gte.' + encodeURIComponent(f.from));
  if (f.to) p.push('treatment_date=lte.' + encodeURIComponent(f.to));
  return p;
}

async function _histQ(parts, sel, order, limit) {
  const res = await sbFetch('treatments?select=' + (sel || '*') + (parts.length ? '&' + parts.join('&') : '') + '&order=' + order + '&limit=' + limit);
  if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
  const j = await res.json();
  if (!Array.isArray(j)) throw new Error('bad_response');
  return j;
}

// ---- الصفحة التالية: لا تُعدّل حالة المُرقِّم إلا بعد نجاح كل الطلبات (إعادة المحاولة آمنة) ----
// المؤشر cur = آخر صف خام مأخوذ (treatment_date, created_at, id). كل ما يلي المؤشر في الترتيب (date↓,created_at↓,id↓) يقع في
// ثلاثة أقسام منفصلة تماماً ومرتَّبة (لا تداخل ولا فجوة)، وكلها تُجلب بالتوازي بـ AND فقط (يدعمه app_data_read):
//   Q2: date = d  ∧ created_at = c ∧ id < cid        Q1: date = d ∧ created_at < c        Q3: date < d
// الصفحة = أول n+1 من (Q2 ثم Q1 ثم Q3) — الصف الإضافي يكشف وجود المزيد بلا طلب إضافي. لا offset ولا عدّادات تعادل ولا إزالة تكرار.
function histPagerNew(filters, opts) {
  return { f: filters || {}, sel: (opts && opts.select) || '*', phase: 'dated', cur: null, started: false, hasNull: false, done: false };
}

async function histPagerNext(pg, n) {
  if (pg.done) return { rows: [], more: false };
  const base = histParts(pg.f), sel = pg.sel, nullPhase = pg.phase === 'null';
  const enc = encodeURIComponent, lim = n + 1;
  let cand = [], hasNull = pg.hasNull;
  if (!nullPhase) {
    if (!pg.cur) {
      // الصفحة الأولى بلا حدّ أدنى: صفوف NULL (إن وُجدت) تأتي أولاً في DESC → تُكتشف من الصف الأول دون طلب إضافي
      let rows = await _histQ(pg.started ? base.concat([HIST_FLOOR]) : base, sel, HIST_ORD, lim);
      if (!pg.started && rows.length && rows[0].treatment_date == null) { hasNull = true; rows = await _histQ(base.concat([HIST_FLOOR]), sel, HIST_ORD, lim); }
      cand = rows;
    } else {
      const d = enc(pg.cur.treatment_date), c = enc(pg.cur.created_at), id = enc(pg.cur.id);
      const [q2, q1, q3] = await Promise.all([
        _histQ(base.concat(['treatment_date=eq.' + d, 'created_at=eq.' + c, 'id=lt.' + id]), sel, HIST_ORD, lim),
        _histQ(base.concat(['treatment_date=eq.' + d, 'created_at=lt.' + c]), sel, HIST_ORD, lim),
        _histQ(base.concat(['treatment_date=lt.' + d]), sel, HIST_ORD, lim)
      ]);
      cand = q2.concat(q1, q3);
    }
  } else {
    // مرحلة صفوف treatment_date = NULL (تظهر أولاً في DESC): قسمان (created_at = c ∧ id < cid) ثم (created_at < c)؛ ينتهي كل قسم عند أول صف له تاريخ
    const nulls = rows => { const k = rows.findIndex(r => r.treatment_date != null); return { rows: k < 0 ? rows : rows.slice(0, k), ended: k >= 0 }; };
    if (!pg.cur) cand = nulls(await _histQ(base, sel, HIST_ORD, lim)).rows;
    else {
      const c = enc(pg.cur.created_at), id = enc(pg.cur.id);
      const [r2, r1] = await Promise.all([_histQ(base.concat(['created_at=eq.' + c, 'id=lt.' + id]), sel, HIST_ORD, lim), _histQ(base.concat(['created_at=lt.' + c]), sel, HIST_ORD, lim)]);
      const a = nulls(r2), b2 = nulls(r1);
      cand = (a.ended || r2.length < lim) ? a.rows.concat(b2.rows) : a.rows;   // القسم الأول ممتلئ بصفوف NULL ⇒ يكفي وحده
    }
  }
  const moreRaw = cand.length > n;
  const taken = cand.slice(0, n);
  let more = moreRaw, nextPhase = pg.phase;
  if (!moreRaw && !nullPhase && hasNull) { nextPhase = 'null'; more = true; }
  // ---- التثبيت (بعد نجاح كل الطلبات) ----
  pg.hasNull = hasNull; pg.started = true; pg.done = !more;
  if (nextPhase !== pg.phase) { pg.phase = nextPhase; pg.cur = null; }
  else if (taken.length) { const last = taken[taken.length - 1]; pg.cur = { treatment_date: last.treatment_date, created_at: last.created_at, id: last.id }; }
  return { rows: taken, more };
}

// ---- علامات الإلغاء (من الخادم) تُطبَّق على الصفوف المعروضة دون لمس المؤشر ----
function histMarkRows(rows) {
  const M = (typeof _opsMarks !== 'undefined' && _opsMarks) ? _opsMarks : null;
  if (!M) return rows.slice();
  const out = M.voidedIds && M.voidedIds.size ? rows.filter(t => !M.voidedIds.has(String(t.id))) : rows.slice();
  (M.partial || []).forEach(v => {
    const t = out.find(x => String(x.id) === String(v.source_id)); if (!t || !Array.isArray(t.items_treated)) return;
    const rm = new Set((v.removed_items || []).map(x => typeof x === 'string' ? x : (x && x.key)));
    t.items_treated = t.items_treated.filter(i => !(i && rm.has(i.key)));
  });
  return out;
}

async function histMarksFresh() { try { if (typeof opsLoadMarks === 'function') await opsLoadMarks(); } catch (e) {} }

// ---- جلب كل المطابق على دفعات محدودة (تصدير/حذف جماعي/فهرس الأرشيف). مقاطعة آمنة عبر alive() ----
async function histFetchAll(filters, o) {
  o = o || {};
  const pg = histPagerNew(filters, { select: o.select });
  const all = [], ids = new Set();
  const abort = () => { const e = new Error('aborted'); e.aborted = true; return e; };
  const marksP = o.marks === false ? Promise.resolve() : histMarksFresh();
  while (!pg.done) {
    const r = await histPagerNext(pg, o.batch || HIST_BATCH);
    if (o.alive && !o.alive()) throw abort();
    for (const t of r.rows) if (!ids.has(t.id)) { ids.add(t.id); all.push(t); }
    if (o.onProgress) o.onProgress(all.length);
    if (o.max && all.length >= o.max && !pg.done) { const e = new Error('capped'); e.capped = true; e.rows = all; throw e; }
  }
  await marksP;
  if (o.alive && !o.alive()) throw abort();
  return o.marks === false ? all : histMarkRows(all);
}

// ========================================================================================================
// شاشة السجل
// ========================================================================================================
let _histStore = null, _histStoreSeq = 0;

function histViewVisible() {
  const v = document.getElementById('depLogView'), p = document.getElementById('page-departures');
  return !!(v && v.style.display !== 'none' && p && p.classList.contains('active'));
}
function histLive(st) { return st === _histStore && _histSessOk(st.sess); }
function histNewStore(filters) {
  return { id: ++_histStoreSeq, sess: _histSess(), filters, pg: histPagerNew(filters), rows: [], ids: new Set(), status: 'idle', err: null, more: false, busy: false, capped: false, stale: false, banner: '' };
}
function _digitsAscii(s) { return String(s || '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0)).trim(); }
function histReadFilters() {
  const g = id => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  return { line: g('depLogFilterLine'), tower: _digitsAscii(g('depLogFilterTower')), from: g('depLogFilterFrom'), to: g('depLogFilterTo') };
}

function histPopulateLines() {
  const sel = document.getElementById('depLogFilterLine'); if (!sel) return;
  if (sel.options.length > 1) return;
  const names = Object.keys(LINES_DATA || {}).sort((a, b) => a.localeCompare(b, 'ar'));
  sel.innerHTML = '<option value="">-- كل الخطوط --</option>' + names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
}

function histCardHtml(t) {

    const items = t.items_treated||[];
    const m = treatmentDisplayModel(t);
    const hasCircuit2 = !!(t.insulator_svg_r_2 || t.insulator_svg_s_2 || t.insulator_svg_t_2);
    return `<div class="dep-card" style="border-right-color:#48BB78">
      <div class="dep-card-header">
        <div class="dep-card-title" style="overflow-wrap:anywhere">✅ ${escapeHtml(m.line)} — برج ${escapeHtml(m.tower)}</div>
        <div class="dep-card-meta" style="overflow-wrap:anywhere">📅 ${escapeHtml(m.date)} | 👤 ${escapeHtml(m.by||'—')}</div>
        ${(currentUser.role==='admin')?`<button class="btn-sm" style="background:#EBF0F5;color:#2E4057;border:1px solid #CBD5E0;border-radius:6px;padding:4px 10px;font-size:0.78rem;cursor:pointer;margin-left:6px" onclick="openTreatmentEditModal('${t.id}')">✏️ تعديل</button><button class="btn-sm btn-del" onclick="deleteTreatmentRecord('${t.id}')">🗑️ حذف</button>`:''}
      </div>
      ${hasCircuit2?'<div style="font-size:0.72rem;font-weight:700;color:#4A5568;margin-top:10px">الدائرة الأولى</div>':''}
      <div style="display:flex;gap:12px;margin-top:${hasCircuit2?'4px':'10px'};flex-wrap:wrap">
        ${t.insulator_svg_r?`<div style="text-align:center"><div style="font-size:0.72rem;color:#718096;margin-bottom:4px">R</div>${t.insulator_svg_r}</div>`:''}
        ${t.insulator_svg_s?`<div style="text-align:center"><div style="font-size:0.72rem;color:#718096;margin-bottom:4px">S</div>${t.insulator_svg_s}</div>`:''}
        ${t.insulator_svg_t?`<div style="text-align:center"><div style="font-size:0.72rem;color:#718096;margin-bottom:4px">T</div>${t.insulator_svg_t}</div>`:''}
      </div>
      ${hasCircuit2?`<div style="font-size:0.72rem;font-weight:700;color:#4A5568;margin-top:10px">الدائرة الثانية</div>
      <div style="display:flex;gap:12px;margin-top:4px;flex-wrap:wrap">
        ${t.insulator_svg_r_2?`<div style="text-align:center"><div style="font-size:0.72rem;color:#718096;margin-bottom:4px">R</div>${t.insulator_svg_r_2}</div>`:''}
        ${t.insulator_svg_s_2?`<div style="text-align:center"><div style="font-size:0.72rem;color:#718096;margin-bottom:4px">S</div>${t.insulator_svg_s_2}</div>`:''}
        ${t.insulator_svg_t_2?`<div style="text-align:center"><div style="font-size:0.72rem;color:#718096;margin-bottom:4px">T</div>${t.insulator_svg_t_2}</div>`:''}
      </div>`:''}
      ${items.length?`<div class="dep-items" style="margin-top:8px">${items.map(i=>`<span class="dep-item fixed">✅ ${escapeHtml(i && i.label)}</span>`).join('')}</div>`:''}
      ${m.notes?`<div class="dep-notes" style="margin-top:8px;font-size:0.82rem;color:#4A5568;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word">📝 ${escapeHtml(m.notes)}</div>`:''}
    </div>`;
}

function histStatusMsg(kind, msg, retry) {
  const cls = kind === 'error' ? 'background:#FEF3C7;color:#92400E' : kind === 'offline' ? 'background:#EBF4FF;color:#2C5282' : '';
  return `<div class="empty-state" style="${cls};border-radius:8px;padding:12px" role="${kind === 'error' ? 'alert' : 'status'}">${msg}${retry ? '<div style="margin-top:10px"><button class="btn-sm btn-primary" onclick="histRetry()">🔄 إعادة المحاولة</button></div>' : ''}</div>`;
}

function histSetLive(text) { const el = document.getElementById('depLogStatus'); if (el) el.textContent = text || ''; }

// رسم كامل للحالة الحالية (لا قراءة شبكة هنا أبداً)
function histRender() {
  const body = document.getElementById('depLogBody'); if (!body) return;
  const st = _histStore;
  const bulkBtn = document.getElementById('depLogBulkDeleteBtn');
  if (bulkBtn) bulkBtn.style.display = (currentUser && currentUser.role === 'admin') ? '' : 'none';
  const showBtn = document.getElementById('depLogShowBtn'); if (showBtn) showBtn.disabled = !!(st && st.busy && !st.rows.length);
  body.setAttribute('aria-busy', st && st.busy ? 'true' : 'false');
  if (!st || (st.status === 'idle' && !st.rows.length)) {
    body.innerHTML = '<div class="empty-state" role="status">🔎 اختر الفلاتر ثم اضغط «عرض النتائج» — لا تُحمَّل المعالجات إلا بعد ذلك</div>';
    histSetLive(''); return;
  }
  if (!st.rows.length) {
    if (st.status === 'loading') { body.innerHTML = '<div class="empty-state" role="status">⏳ جاري التحميل...</div>'; histSetLive('جاري التحميل'); return; }
    if (st.status === 'offline') { body.innerHTML = histStatusMsg('offline', '📴 لا يوجد اتصال بالإنترنت — يلزم الاتصال لعرض سجل المعالجات. المعالجات المحفوظة على الجهاز تُرسل تلقائياً عند عودة الاتصال.', true); histSetLive('لا يوجد اتصال'); return; }
    if (st.status === 'error') { body.innerHTML = histStatusMsg('error', '⚠️ تعذّر تحميل سجل المعالجات (خطأ بالخادم أو الاتصال). هذا لا يعني عدم وجود معالجات.', true); histSetLive('تعذّر التحميل'); return; }
    body.innerHTML = '<div class="empty-state" role="status">لا توجد معالجات مطابقة للفلتر</div>'; histSetLive('لا توجد نتائج'); return;
  }
  body.innerHTML = (st.banner ? `<div class="empty-state" style="color:#92400E;background:#FEF3C7;border-radius:8px;padding:10px;margin-bottom:10px" role="alert">${st.banner}</div>` : '') +
    '<div id="depLogList">' + st.rows.map(histCardHtml).join('') + '</div><div id="depLogFooter"></div>';
  histRenderFooter();
}

function histRenderFooter() {
  const st = _histStore, f = document.getElementById('depLogFooter'); if (!f || !st) return;
  let h = `<div style="text-align:center;font-size:0.8rem;color:#4A5568;margin:10px 0" id="depLogCount">المعروض: ${st.rows.length} معالجة</div>`;
  if (st.status === 'offline') h += histStatusMsg('offline', '📴 انقطع الاتصال — المعروض محفوظ. أعد المحاولة عند عودة الاتصال.', true);
  else if (st.status === 'error') h += histStatusMsg('error', '⚠️ تعذّر تحميل الصفحة التالية — المعروض سليم.', true);
  else if (st.more && st.rows.length >= HIST_CAP) h += `<div class="empty-state" role="status">عُرض أول ${HIST_CAP} معالجة. لمزيد من النتائج ضيّق الفلاتر (خط/برج/تاريخ)، أو استخدم «تصدير» للحصول على كل المطابق.</div>`;
  else if (st.more) h += `<div style="text-align:center"><button class="btn btn-secondary" id="depLogMoreBtn" onclick="histLoadMoreClick()" ${st.busy ? 'disabled' : ''}>${st.busy ? '⏳ جاري التحميل...' : '⬇️ عرض المزيد'}</button></div>`;
  else h += '<div style="text-align:center;font-size:0.78rem;color:#718096;margin-bottom:6px">— نهاية النتائج —</div>';
  f.innerHTML = h;
  histSetLive(`المعروض ${st.rows.length} معالجة` + (st.more ? '، يوجد المزيد' : ''));
}

function histAppendRows(newRows) {
  const list = document.getElementById('depLogList');
  if (!list) { histRender(); return; }
  list.insertAdjacentHTML('beforeend', newRows.map(histCardHtml).join(''));
}

function histNetErr(e) { return !!(e && (e.name === 'TypeError' || /Failed to fetch|NetworkError|network/i.test(String(e.message || '')))) || (typeof navigator !== 'undefined' && navigator.onLine === false); }

// تحميل صفحة (الأولى أو التالية): كل ردّ يُفحص (مخزن حالي + جلسة + الشاشة ظاهرة) وإلا يُهمل دون لمس أي حالة
async function histLoad(st, first) {
  if (!histLive(st) || st.busy) return;
  if (!first && (!st.more || st.rows.length >= HIST_CAP || st.status === 'loading')) return;
  st.busy = true; st.err = null;
  if (first) st.status = 'loading';
  else if (st.status === 'error' || st.status === 'offline') st.status = 'ready';
  if (first || !document.getElementById('depLogList')) histRender(); else histRenderFooter();
  try {
    if (navigator.onLine === false) { const e = new Error('offline'); e.offline = true; throw e; }
    const marksP = first ? histMarksFresh() : null;
    let added = 0;
    const fresh = [];
    for (let tries = 0; tries < 4 && added < HIST_PAGE && !st.pg.done; tries++) {
      const r = await histPagerNext(st.pg, HIST_PAGE);
      if (!histLive(st) || !histViewVisible()) { st.busy = false; if (first && !st.rows.length) st.status = 'idle'; return; }   // ردّ متأخر: يُهمل
      if (marksP && tries === 0) await marksP;
      if (!histLive(st) || !histViewVisible()) { st.busy = false; if (first && !st.rows.length) st.status = 'idle'; return; }
      const shown = histMarkRows(r.rows).filter(t => !st.ids.has(t.id));
      shown.forEach(t => { st.ids.add(t.id); st.rows.push(t); fresh.push(t); });
      added += shown.length; st.more = r.more;
      if (st.rows.length >= HIST_CAP) break;
    }
    st.more = !st.pg.done; st.status = 'ready'; st.busy = false;
    if (first) histRender(); else { histAppendRows(fresh); histRenderFooter(); }
  } catch (e) {
    if (!histLive(st)) return;
    st.busy = false;
    if (e && e.stale) { st.status = 'idle'; histRender(); return; }
    st.status = (e && e.offline) || histNetErr(e) ? 'offline' : 'error';
    console.warn('[tower-app] تعذّر تحميل سجل المعالجات', e);
    if (st.rows.length) histRenderFooter(); else histRender();
  }
}

async function histShowResults() {
  const f = histReadFilters();
  if (f.from && f.to && f.from > f.to) {
    _histStore = null;
    const body = document.getElementById('depLogBody');
    if (body) body.innerHTML = histStatusMsg('error', '⚠️ تاريخ البداية بعد تاريخ النهاية — صحّح التواريخ.', false);
    histSetLive('تاريخ البداية بعد تاريخ النهاية'); return;
  }
  const st = histNewStore(f);
  _histStore = st;                       // يحلّ محل أي مخزن/طلب سابق؛ ردوده المتأخرة تُهمل
  return histLoad(st, true);
}
function histLoadMoreClick() { const st = _histStore; if (st) return histLoad(st, false); }
function histRetry() { const st = _histStore; if (!st) return; return histLoad(st, !st.rows.length); }

// ---- نقطة الدخول من التبويب: لا قراءة. إن وُجد مخزن لنفس الجلسة يُعاد رسمه فقط ----
async function renderDepLogImpl() {
  histPopulateLines();
  const st = _histStore;
  if (st && !_histSessOk(st.sess)) _histStore = null;
  if (_histStore && _histStore.stale && !_histStore.busy) { histRefresh(); return; }
  histRender();
}

// ---- بعد المزامنة/تغيّر الخادم: إبطال الصفحات المحمّلة (بلا إعادة تحميل الجدول): صفحة أولى واحدة فقط إن كانت الشاشة ظاهرة ----
function histInvalidate() {
  try { if (typeof hubTreatInvalidate === 'function') hubTreatInvalidate(); } catch (e) {}
  const st = _histStore; if (!st) return;
  st.stale = true;
  if (histViewVisible() && !st.busy) histRefresh();
}
async function histRefresh() {
  const old = _histStore; if (!old || !_histSessOk(old.sess) || !histViewVisible()) return;
  if (navigator.onLine === false) { old.banner = '📴 تغيّرت البيانات بعد المزامنة ولا يوجد اتصال — المعروض قد يكون قديماً.'; histRender(); return; }
  const nst = histNewStore(old.filters);
  nst.status = 'loading';
  // الصفحة الأولى فقط تُجلب؛ نستبدل المخزن عند النجاح ونُبقي القديم معروضاً أثناء ذلك
  old.busy = true;
  try {
    const marksP = histMarksFresh();
    const r = await histPagerNext(nst.pg, HIST_PAGE);
    await marksP;
    if (_histStore !== old || !_histSessOk(old.sess) || !histViewVisible()) { old.busy = false; return; }
    const shown = histMarkRows(r.rows);
    shown.forEach(t => { nst.ids.add(t.id); nst.rows.push(t); });
    nst.more = !nst.pg.done; nst.status = 'ready'; _histStore = nst;
    histRender();
  } catch (e) {
    old.busy = false;
    if (_histStore === old) { old.banner = '⚠️ تعذّر تحديث النتائج بعد المزامنة — المعروض قد يكون قديماً. اضغط «عرض النتائج» للتحديث.'; histRender(); }
  }
}

function histPurge() {
  _histStore = null;
  try { const b = document.getElementById('depLogBody'); if (b) b.innerHTML = '<div class="empty-state">🔎 اختر الفلاتر ثم اضغط «عرض النتائج» — لا تُحمَّل المعالجات إلا بعد ذلك</div>'; } catch (e) {}
  try { ['depLogFilterLine', 'depLogFilterTower', 'depLogFilterFrom', 'depLogFilterTo'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; }); } catch (e) {}
  try { if (typeof hubTreatReset === 'function') hubTreatReset(); } catch (e) {}
}

// ---- الصفوف المعروفة محلياً (تفحصها الإلغاءات المرتبطة والتعديل): مخزن السجل + يوم الأرشيف المفتوح + الكاش القديم ----
function histKnownRows() {
  const out = [];
  if (_histStore && _histSessOk(_histStore.sess)) out.push(..._histStore.rows);
  try { if (typeof hubTreatDayRows === 'function') out.push(...hubTreatDayRows()); } catch (e) {}
  return out;
}
function histFindRow(id) {
  const sid = String(id);
  return histKnownRows().find(x => String(x.id) === sid) || (typeof treatmentsCache !== 'undefined' ? treatmentsCache.find(x => String(x.id) === sid) : null) || null;
}
// يطبَّق من opsSaveTreatmentEdit على الصف المعدَّل (في مخزن السجل وفي يوم الأرشيف) — تحديث موضعي بلا قراءة
function histPatchRow(id, meta) {
  const sid = String(id);
  histKnownRows().forEach(x => { if (String(x.id) === sid) Object.assign(x, meta); });
  if (meta && meta.treatment_date !== undefined && _histStore && typeof sortTreatmentsByDateDesc === 'function') _histStore.rows = sortTreatmentsByDateDesc(_histStore.rows);
}
// علامات إلغاء جديدة (بعد المزامنة): تصفية المعروض دون إعادة جلب
function histApplyMarks() {
  try { if (typeof hubTreatApplyMarks === 'function') hubTreatApplyMarks(); } catch (e) {}
  const st = _histStore; if (!st || !_histSessOk(st.sess) || st.busy) return;
  const before = st.rows.length;
  st.rows = histMarkRows(st.rows);
  if (st.rows.length !== before) { st.ids = new Set(st.rows.map(t => t.id)); if (histViewVisible()) histRender(); }
}

// ---- تعديل/إلغاء الكل المطابق: يُجلب كل المطابق على دفعات (وليس المعروض فقط) ----
let _histBulk = null;
async function histBulkDelete() {
  if (!(currentUser && currentUser.role === 'admin')) { showToast('⚠️ الحذف من صلاحيات المدير فقط', 'error'); return; }
  const st = _histStore;
  if (!st || !histLive(st)) { showToast('⚠️ اعرض النتائج أولاً ثم استخدم الحذف الجماعي', 'error'); return; }
  if (_histBulk) { showToast('⏳ عملية جارية بالفعل'); return; }
  if (navigator.onLine === false) { showToast('📴 يلزم الاتصال لتحديد كل المعالجات المطابقة', 'error'); return; }
  const run = { st, sess: _histSess(), sig: histSig(st.filters) };
  _histBulk = run;
  const alive = () => _histBulk === run && histLive(st) && histSig(st.filters) === run.sig;
  let rows;
  try {
    rows = await histFetchAll(st.filters, { alive, onProgress: n => showToast('⏳ جاري حصر المعالجات المطابقة: ' + n) });
  } catch (e) {
    _histBulk = null;
    if (!e || !e.aborted) showToast('❌ تعذّر حصر كل المعالجات المطابقة — لم يُسجَّل شيء', 'error');
    return;
  }
  _histBulk = null;
  if (!rows.length) { showToast('⚠️ لا توجد معالجات مطابقة للفلتر الحالي', 'error'); return; }
  const n = rows.length;
  if (!confirm(`🗑️ تأكيد إلغاء ${n} معالجة مطابقة للفلتر الحالي (كل الصفحات)؟ لا يُحذف الأصل؛ يُسجَّل إلغاء بسبب. تُستعاد حالة البرج فقط حيث تكون المعالجة آخر كاتب لها.`)) return;
  if (!histLive(st)) { showToast('⚠️ تغيّرت الجلسة أو النتائج — لم يُسجَّل شيء', 'error'); return; }
  const done = await opsDeleteTreatments(rows);
  showToast(done === n ? `📦 سُجّل إلغاء ${done} من ${n} معالجة وسيُرسل` : `⚠️ سُجّل إلغاء ${done} من ${n} معالجة فقط`, done === n ? undefined : 'error');
}
function histSig(f) { return JSON.stringify([f.line || '', f.tower || '', f.from || '', f.to || '']); }

// ========================
// تعديل المعالجة (مودال مشترك بين المغادرات والمركز الموحّد)
// ========================
let treatmentEditingId = null;

let treatmentEditingItems = [];

function openTreatmentEditModalImpl(id) {
  const t = histFindRow(id);   // v335-C6r21 (P01-B1): من مخزن السجل/يوم الأرشيف (أي صفحة محمّلة) وليس من الكاش الكامل
  if (!t) { showToast('⚠️ تعذر إيجاد هذي المعالجة', 'error'); return; }
  treatmentEditingId = id;
  treatmentEditingItems = JSON.parse(JSON.stringify(t.items_treated || []));
  document.getElementById('teEditDate').value = t.treatment_date || '';
  document.getElementById('teEditTreatedBy').value = t.treated_by || '';
  document.getElementById('teEditNotes').value = t.notes || '';
  renderTreatmentEditItems();
  document.getElementById('treatmentEditModalBg').classList.add('show');
}

function renderTreatmentEditItems() {
  const wrap = document.getElementById('teEditItemsWrap');
  if (!treatmentEditingItems.length) { wrap.innerHTML = '<p style="font-size:0.8rem;color:#718096">لا توجد عناصر — احفظ الحذف كامل من زر الحذف بدل هذا</p>'; return; }
  wrap.innerHTML = treatmentEditingItems.map((it, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #F0F2F5">
      <span style="font-size:0.82rem">${it.label}</span>
      <button type="button" class="btn-sm btn-del" onclick="removeTreatmentEditItem(${i})">✕</button>
    </div>`).join('');
}

function removeTreatmentEditItem(i) {
  treatmentEditingItems.splice(i, 1);
  renderTreatmentEditItems();
}

function closeTreatmentEditModal() {
  document.getElementById('treatmentEditModalBg').classList.remove('show');
  treatmentEditingId = null;
}

async function saveTreatmentEdit() {
  if (!treatmentEditingId) return;
  if (!treatmentEditingItems.length) { showToast('⚠️ لازم يبقى عنصر واحد على الأقل بالمعالجة، أو ألغِها بالكامل من زر الحذف', 'error'); return; }
  const t = histFindRow(treatmentEditingId);
  if (!t) { showToast('⚠️ تعذر إيجاد هذي المعالجة', 'error'); return; }
  const edit = {
    treatment_date: document.getElementById('teEditDate').value,
    treated_by: document.getElementById('teEditTreatedBy').value,
    notes: document.getElementById('teEditNotes').value,
    items: treatmentEditingItems
  };
  // v335-C4: التاريخ/المنفّذ/الملاحظات = تعديل موثَّق لا يُعيد حساب الحالة؛ إزالة عناصر معالجة = إلغاء بعناصر (يعيد الحالة فقط حيث تكون المعالجة آخر كاتب)
  const ok = await opsSaveTreatmentEdit(t, edit);
  if (!ok) return;
  showToast('📦 حُفظ التعديل على الجهاز — سيُؤكَّد عند الإرسال');
  closeTreatmentEditModal();
  if (histViewVisible()) { const y = window.scrollY; histRender(); try { window.scrollTo(0, y); } catch (e) {} }   // إعادة رسم المحمَّل فقط (بلا قراءة)
  try { if (typeof hubTreatRefreshView === 'function') hubTreatRefreshView(); } catch (e) {}
}

(window.__featModules = window.__featModules || {}).hist = true;
