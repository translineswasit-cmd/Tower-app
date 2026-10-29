/* period-stats.js — v335-C6r17 (N22)
   إحصائيات الفترة المتكاملة: ملخّص + رسوم + مقارنة خطوط + تفاصيل عند الطلب حتى السجل. تُحمَّل كسولاً عند أول فتح للصفحة فقط (لا طلبات ولا تنفيذ عند بدء التطبيق).
   المصدر الوحيد: الخادم (app_period_stats / app_period_stats_detail — قراءة فقط). لا تنزيل لأي سجل تاريخ كامل، ولا كتابة، ولا تخزين دائم.
   سكربت كلاسيكي يشارك الربط العام مع index.html (csCall, pageNavigationRequestSeq, staffSessionTag, getTotalPendingCount, showToast, dlgSync, currentUser). */
(function () {
  'use strict';
  const ROLES = ['admin', 'supervisor', 'readonly'];
  const MAX_DAYS = 800;
  const FRESH_MS = 20000;          // نتيجة أحدث من هذا لا يُعاد طلبها عند الرجوع للصفحة
  const PAGE = 40;                 // حجم صفحة التفاصيل
  const MONTHS_AR = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
  const COL = { insp: '#2B6CB0', treat: '#2F855A', emg: '#C53030', issued: '#718096' };
  const TYPES = {
    insulator_fix: { n: 'معالجة العوازل', c: '#2B6CB0', u: 'عازل' },
    chain_replace: { n: 'استبدال سلاسل', c: '#6B46C1', u: 'سلسلة' },
    chain_material: { n: 'تغيير مادة السلاسل', c: '#9F7AEA', u: 'سلسلة' },
    washing: { n: 'غسيل', c: '#0987A0' },
    iron: { n: 'حديد البرج', c: '#DD6B20' },
    attachment: { n: 'ملحقات', c: '#B7791F' },
    foundation: { n: 'أساسات', c: '#975A16' },
    wire: { n: 'أسلاك', c: '#D53F8C' },
    ground: { n: 'أسلاك الأرضي', c: '#2F855A' },
    fire: { n: 'حرائق', c: '#E53E3E' },
    road: { n: 'طريق الوصول', c: '#718096' },
    other: { n: 'أخرى (مفتاح غير معروف)', c: '#A0AEC0' },
    unclassified: { n: 'بند بلا مفتاح', c: '#A0AEC0' },
    no_items: { n: 'بلا بنود مسجّلة', c: '#CBD5E0' }
  };
  const UNIT_AR = { insulator: 'عازل', chain: 'سلسلة' };
  const SERIES = [{ k: 'insp', n: 'كشوفات الأبراج', c: COL.insp, u: 'كشف يومي' }, { k: 'treat', n: 'المعالجات', c: COL.treat, u: 'معالجة' }, { k: 'emg', n: 'المغادرات الطارئة', c: COL.emg, u: 'مغادرة' }];

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });
  const tmeta = t => TYPES[t] || { n: t, c: '#A0AEC0' };

  // ---------- Baghdad calendar helpers (string dates 'YYYY-MM-DD' only; no local-timezone Date math) ----------
  function todayBaghdad() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  const p2 = n => String(n).padStart(2, '0');
  function ymd(y, m, d) { return y + '-' + p2(m) + '-' + p2(d); }
  function parts(s) { const a = String(s).split('-').map(Number); return { y: a[0], m: a[1], d: a[2] }; }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function addMonths(y, m, k) { const t = y * 12 + (m - 1) + k; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; }
  function dayNum(s) { const q = parts(s); return Math.round(Date.UTC(q.y, q.m - 1, q.d) / 86400000); }
  function spanDays(a, b) { return dayNum(b) - dayNum(a) + 1; }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }
  function monthStart(ym) { return ym + '-01'; }
  function monthEnd(ym) { const q = ym.split('-').map(Number); return ymd(q[0], q[1], daysIn(q[0], q[1])); }
  function fmtMD(s) { const q = parts(s); return q.d + '/' + q.m; }
  function monthName(s) { const q = parts(s); return MONTHS_AR[q.m - 1] + ' ' + q.y; }
  function presetRange(k) {
    const t = todayBaghdad(), q = parts(t);
    if (k === 'm0') return { from: ymd(q.y, q.m, 1), to: t };
    if (k === 'm1') { const a = addMonths(q.y, q.m, -1); return { from: ymd(a.y, a.m, 1), to: ymd(a.y, a.m, daysIn(a.y, a.m)) }; }
    const back = k === 'm3' ? -2 : k === 'm6' ? -5 : -11;
    const a = addMonths(q.y, q.m, back);
    return { from: ymd(a.y, a.m, 1), to: t };
  }
  function clampToday(to) { const t = todayBaghdad(); return to > t ? t : to; }
  function fmtStamp(ms) {
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)); }
    catch (e) { return ''; }
  }
  function agoText(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'قبل لحظات';
    if (s < 3600) return 'قبل ' + Math.round(s / 60) + ' د';
    if (s < 86400) return 'قبل ' + Math.round(s / 3600) + ' س';
    return 'قبل ' + Math.round(s / 86400) + ' يوم';
  }

  // ---------- state ----------
  const S = {
    preset: 'm0', from: null, to: null, msg: '',
    cache: new Map(), sess: '', cur: null, loading: false, err: null, seq: 0,
    tok: null, series: 'insp', emgMode: 'reported', pick: null, shownLines: 8, sortBy: 'insp', mounted: false, defsOpen: false, qualOpen: false
  };
  const SH = { stack: [], seq: 0, tok: null };

  function sessTag() { try { return staffSessionTag(); } catch (e) { return ''; } }
  function navSeq() { try { return pageNavigationRequestSeq; } catch (e) { return -1; } }
  function pageActive() { const p = $('page-periodStats'); return !!(p && p.classList.contains('active')); }
  function tokOk(tok) { return !!tok && tok.p === navSeq() && tok.s === sessTag() && pageActive(); }
  function roleOk() { try { return !!currentUser && ROLES.indexOf(currentUser.role) >= 0; } catch (e) { return false; } }
  function pendingCount() { try { return typeof getTotalPendingCount === 'function' ? getTotalPendingCount() : 0; } catch (e) { return 0; } }
  function online() { return navigator.onLine !== false; }

  // ---------- styles + mount ----------
  const CSS = `
#psRoot{--ps-ink:#1a2e4a;--ps-mut:#718096;--ps-line:#E2E8F0;--ps-bg:#fff}
.ps-bar{background:#fff;border-radius:14px;padding:12px;box-shadow:0 2px 8px rgba(0,0,0,.06);margin-bottom:12px}
.ps-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.ps-chips::-webkit-scrollbar{display:none}
.ps-chip{flex:0 0 auto;border:1.5px solid #CBD5E0;background:#fff;color:#2E4057;border-radius:999px;padding:7px 13px;font:inherit;font-size:.8rem;font-weight:600;cursor:pointer;white-space:nowrap}
.ps-chip.on{background:#2E4057;border-color:#2E4057;color:#fff}
.ps-inputs{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.ps-inputs label{flex:1;min-width:130px;font-size:.72rem;color:var(--ps-mut);display:flex;flex-direction:column;gap:3px}
.ps-inputs input{padding:9px 10px;border:1.5px solid var(--ps-line);border-radius:9px;font:inherit;font-size:.85rem;width:100%;box-sizing:border-box;background:#fff}
.ps-range{margin-top:9px;font-size:.78rem;color:#2E4057;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
.ps-range b{font-weight:700}
.ps-warn{margin-top:8px;font-size:.78rem;color:#C05621;background:#FFFAF0;border:1px solid #FBD38D;border-radius:9px;padding:7px 10px}
.ps-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:.74rem;color:var(--ps-mut);margin:0 2px 10px}
.ps-status .grow{flex:1}
.ps-badge{border-radius:999px;padding:2px 9px;font-size:.7rem;font-weight:700}
.ps-b-live{background:#C6F6D5;color:#22543D}.ps-b-cache{background:#FEFCBF;color:#744210}.ps-b-off{background:#FED7D7;color:#822727}
.ps-refresh{border:none;background:#EDF2F7;color:#2E4057;border-radius:999px;padding:6px 12px;font:inherit;font-size:.74rem;font-weight:700;cursor:pointer}
.ps-refresh:disabled{opacity:.5}
.ps-pend{background:#FFFAF0;border:1px solid #F6AD55;color:#7B341E;border-radius:12px;padding:9px 12px;font-size:.78rem;margin-bottom:10px;line-height:1.6}
.ps-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.ps-kpi{background:#fff;border-radius:14px;padding:11px 8px 10px;box-shadow:0 2px 8px rgba(0,0,0,.06);border-top:4px solid var(--c);text-align:center;min-width:0}
.ps-kpi .n{font-size:1.55rem;font-weight:800;color:var(--ps-ink);line-height:1.15}
.ps-kpi .l{font-size:.72rem;font-weight:700;color:var(--c);margin-top:2px}
.ps-kpi .s{font-size:.66rem;color:var(--ps-mut);margin-top:4px;line-height:1.5}
.ps-sec{background:#fff;border-radius:14px;padding:14px 12px;box-shadow:0 2px 8px rgba(0,0,0,.06);margin-bottom:12px}
.ps-sec.issued{background:#F7FAFC;border:1.5px dashed #A0AEC0;box-shadow:none}
.ps-h{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.ps-h i{width:10px;height:10px;border-radius:3px;background:var(--c);display:inline-block;flex:0 0 auto}
.ps-h h3{font-size:.98rem;color:var(--ps-ink);margin:0;border:none;padding:0}
.ps-sub{font-size:.72rem;color:var(--ps-mut);line-height:1.7;margin:0 0 10px}
.ps-h2{font-size:.82rem;font-weight:700;color:#2E4057;margin:14px 0 6px}
.ps-seg{display:flex;gap:0;border-radius:10px;overflow:hidden;border:1.5px solid #CBD5E0;margin-bottom:8px}
.ps-seg button{flex:1;border:none;background:#fff;padding:7px 4px;font:inherit;font-size:.74rem;font-weight:700;color:#4A5568;cursor:pointer}
.ps-seg button.on{background:var(--c);color:#fff}
.ps-chart{direction:ltr;width:100%}
.ps-chart svg{width:100%;height:auto;display:block;touch-action:manipulation}
.ps-chart text{font-family:inherit}
.ps-pick{background:#F7FAFC;border-radius:10px;padding:8px 10px;font-size:.78rem;color:#2E4057;display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;min-height:20px}
.ps-link{border:none;background:none;color:#2B6CB0;font:inherit;font-size:.78rem;font-weight:700;cursor:pointer;padding:4px 2px;white-space:nowrap}
.ps-row{display:block;width:100%;text-align:right;border:none;background:none;font:inherit;padding:8px 2px;border-bottom:1px solid #EDF2F7;cursor:pointer;color:inherit}
.ps-row:last-child{border-bottom:none}
.ps-row.static{cursor:default}
.ps-rt{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:.82rem}
.ps-rt .nm{font-weight:700;color:var(--ps-ink);overflow-wrap:anywhere}
.ps-rt .vl{font-weight:800;color:var(--ps-ink);white-space:nowrap}
.ps-rt .vl small{font-weight:600;color:var(--ps-mut);font-size:.68rem}
.ps-track{height:9px;background:#EDF2F7;border-radius:6px;margin-top:5px;overflow:hidden}
.ps-fill{height:100%;border-radius:6px;background:var(--c);min-width:3px}
.ps-note{font-size:.7rem;color:var(--ps-mut);margin-top:3px;line-height:1.6}
.ps-note b{color:#C05621}
.ps-tri{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:6px}
.ps-tri div{min-width:0}
.ps-tri .t{font-size:.64rem;color:var(--ps-mut);display:flex;justify-content:space-between}
.ps-tri .t b{color:var(--ps-ink);font-size:.74rem}
.ps-tri .ps-track{height:6px;margin-top:3px}
.ps-sortbar{display:flex;gap:6px;margin:4px 0 8px;flex-wrap:wrap}
.ps-sortbar button{border:1.5px solid #CBD5E0;background:#fff;border-radius:999px;padding:4px 10px;font:inherit;font-size:.7rem;font-weight:700;color:#4A5568;cursor:pointer}
.ps-sortbar button.on{background:#EDF2F7;border-color:#2E4057;color:#2E4057}
.ps-vb{display:inline-block;background:#FEFCBF;color:#744210;border-radius:6px;font-size:.62rem;font-weight:700;padding:1px 6px;margin-right:4px}
.ps-empty{text-align:center;padding:30px 12px;color:#4A5568;line-height:1.9}
.ps-empty .big{font-size:2.2rem}
.ps-err{background:#FFF5F5;border:1px solid #FEB2B2;color:#822727;border-radius:12px;padding:14px;text-align:center;margin-bottom:12px;line-height:1.8}
.ps-skel{background:linear-gradient(90deg,#EDF2F7 25%,#F7FAFC 50%,#EDF2F7 75%);background-size:200% 100%;animation:psSk 1.2s infinite;border-radius:14px;height:92px;margin-bottom:12px}
@keyframes psSk{0%{background-position:200% 0}100%{background-position:-200% 0}}
.ps-det{background:#fff;border-radius:14px;padding:4px 12px;box-shadow:0 2px 8px rgba(0,0,0,.06);margin-bottom:12px}
.ps-det summary{cursor:pointer;font-weight:700;color:var(--ps-ink);font-size:.86rem;padding:10px 0}
.ps-det ul{margin:0 0 10px;padding:0 18px 0 0;font-size:.76rem;color:#4A5568;line-height:1.9}
.ps-q li{margin-bottom:2px}
.ps-bg{align-items:flex-end;padding:0}
.ps-sheet{background:#fff;width:100%;max-width:560px;margin:0 auto;border-radius:18px 18px 0 0;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 -8px 30px rgba(0,0,0,.25)}
.ps-sh-head{display:flex;align-items:center;gap:8px;padding:12px 12px 10px;border-bottom:1px solid #EDF2F7}
.ps-sh-head .ic{border:none;background:#EDF2F7;border-radius:50%;width:34px;height:34px;font:inherit;font-size:1rem;cursor:pointer;color:#2E4057;flex:0 0 auto}
.ps-sh-t{flex:1;min-width:0}
.ps-sh-t .a{font-size:.95rem;font-weight:800;color:var(--ps-ink,#1a2e4a);overflow-wrap:anywhere}
.ps-sh-t .b{font-size:.7rem;color:#718096;line-height:1.5;margin-top:2px}
.ps-sh-body{overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:6px 12px 22px;flex:1}
.ps-card{border:1px solid #E2E8F0;border-radius:12px;padding:10px;margin:8px 0;font-size:.8rem}
.ps-card .top{display:flex;justify-content:space-between;gap:8px;font-weight:700;color:#1a2e4a}
.ps-card .mut{color:#718096;font-size:.72rem;margin-top:3px;line-height:1.6}
.ps-pills{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}
.ps-pill{font-size:.68rem;font-weight:700;border-radius:999px;padding:3px 9px;color:#fff;background:var(--c,#718096)}
.ps-pill.soft{background:#EDF2F7;color:#2E4057}
.ps-orph{margin-top:6px;font-size:.7rem;color:#C05621;background:#FFFAF0;border:1px solid #FBD38D;border-radius:8px;padding:4px 8px}
.ps-more{display:block;width:100%;margin:10px 0 0;padding:11px;border:1.5px solid #2E4057;background:#fff;color:#2E4057;border-radius:10px;font:inherit;font-weight:700;font-size:.82rem;cursor:pointer}
.ps-more:disabled{opacity:.5}
.ps-cnt{font-size:.7rem;color:#718096;text-align:center;margin-top:8px}
`;

  function mount() {
    if (!$('psStyle')) { const st = document.createElement('style'); st.id = 'psStyle'; st.textContent = CSS; document.head.appendChild(st); }
    const root = $('psRoot');
    if (root && !S.mounted) {
      root.innerHTML = '<div id="psBar"></div><div id="psBody"></div>';
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
    }
    if (!$('psSheet')) {
      const page = $('page-periodStats');
      page.insertAdjacentHTML('afterend', `
<div class="modal-bg ps-bg" id="psSheet" onclick="if(event.target===this){closePeriodStatsSheet();}">
  <div class="ps-sheet" role="dialog" aria-modal="true" aria-labelledby="psShTitle">
    <div class="ps-sh-head"><button class="ic" id="psShBack" data-sh="back" aria-label="رجوع">›</button><div class="ps-sh-t"><div class="a" id="psShTitle"></div><div class="b" id="psShSub"></div></div><button class="ic" data-sh="close" aria-label="إغلاق">✕</button></div>
    <div class="ps-sh-body" id="psShBody"></div>
  </div>
</div>`);
      $('psSheet').addEventListener('click', onSheetClick);
      try { if (typeof dlgScan === 'function') dlgScan(); } catch (e) {}
    }
    S.mounted = true;
  }

  // ---------- period bar ----------
  const PRESETS = [['m0', 'هذا الشهر'], ['m1', 'الشهر الماضي'], ['m3', '3 أشهر'], ['m6', '6 أشهر'], ['m12', '12 شهراً'], ['month', 'شهر محدد'], ['months', 'عدة أشهر'], ['custom', 'تواريخ مخصّصة']];

  function renderBar() {
    const el = $('psBar'); if (!el) return;
    const chips = PRESETS.map(p => `<button class="ps-chip${S.preset === p[0] ? ' on' : ''}" data-act="preset" data-k="${p[0]}">${p[1]}</button>`).join('');
    let inputs = '';
    if (S.preset === 'month') inputs = `<div class="ps-inputs"><label>الشهر<input type="month" id="psMonth" value="${esc(S.from ? S.from.slice(0, 7) : '')}"></label></div>`;
    else if (S.preset === 'months') inputs = `<div class="ps-inputs"><label>من شهر<input type="month" id="psMonthA" value="${esc(S.from ? S.from.slice(0, 7) : '')}"></label><label>إلى شهر<input type="month" id="psMonthB" value="${esc(S.to ? S.to.slice(0, 7) : '')}"></label></div>`;
    else if (S.preset === 'custom') inputs = `<div class="ps-inputs"><label>من تاريخ<input type="date" id="psFrom" value="${esc(S.from || '')}"></label><label>إلى تاريخ<input type="date" id="psTo" value="${esc(S.to || '')}"></label></div>`;
    const range = S.from && S.to ? `<div class="ps-range"><span>الفترة: <b>${esc(S.from)}</b> ← <b>${esc(S.to)}</b></span><span>${spanDays(S.from, S.to)} يوماً · شاملة الطرفين · توقيت بغداد</span></div>` : '';
    el.innerHTML = `<div class="ps-bar"><div class="ps-chips" role="tablist">${chips}</div>${inputs}${range}${S.msg ? `<div class="ps-warn">${esc(S.msg)}</div>` : ''}</div>`;
  }

  function setRange(from, to, preset) {
    S.msg = '';
    if (!validDate(from) || !validDate(to)) { S.msg = 'اختر تاريخاً صحيحاً.'; renderBar(); return; }
    if (from > to) { S.msg = 'تاريخ البداية بعد تاريخ النهاية.'; renderBar(); return; }
    if (spanDays(from, to) > MAX_DAYS) { S.msg = 'الفترة أطول من ' + MAX_DAYS + ' يوماً — اختر فترة أقصر.'; renderBar(); return; }
    S.from = from; S.to = to; S.preset = preset; S.pick = null; S.shownLines = 8; S.shownCmp = 8;
    renderBar();
    load(false);
  }

  function onPreset(k) {
    if (k === 'month' || k === 'months' || k === 'custom') {
      S.preset = k; S.msg = '';
      if (!S.from) { const r = presetRange('m0'); S.from = r.from; S.to = r.to; }
      renderBar();
      return;
    }
    const r = presetRange(k);
    setRange(r.from, r.to, k);
  }

  function onChange(e) {
    const id = e.target && e.target.id;
    if (id === 'psMonth') { const v = e.target.value; if (/^\d{4}-\d{2}$/.test(v)) setRange(monthStart(v), clampToday(monthEnd(v)), 'month'); }
    else if (id === 'psMonthA' || id === 'psMonthB') {
      const a = $('psMonthA').value, b = $('psMonthB').value;
      if (/^\d{4}-\d{2}$/.test(a) && /^\d{4}-\d{2}$/.test(b)) setRange(monthStart(a), clampToday(monthEnd(b)), 'months');
    } else if (id === 'psFrom' || id === 'psTo') {
      const a = $('psFrom').value, b = $('psTo').value;
      if (validDate(a) && validDate(b)) setRange(a, b, 'custom');
    }
  }

  // ---------- loading the summary ----------
  function key() { return S.from + '|' + S.to; }

  function ensureSession() {
    const t = sessTag();
    if (S.sess !== t) { S.cache.clear(); S.cur = null; S.err = null; S.sess = t; closeSheetHard(); }
  }

  async function load(force) {
    ensureSession();
    if (!roleOk()) { S.cur = null; S.err = { code: 'forbidden' }; renderBody(); return; }
    const tok = S.tok, k = key(), seq = ++S.seq;
    const cached = S.cache.get(k) || null;
    S.cur = cached; S.err = null;
    if (cached && !force && Date.now() - cached.at < FRESH_MS && online()) { S.loading = false; renderBody(); return; }
    if (!online()) { S.loading = false; if (!cached) S.err = { code: 'offline' }; renderBody(); return; }
    if (typeof csLiveEnabled === 'function' && !csLiveEnabled()) { S.loading = false; S.err = { code: 'no_live' }; renderBody(); return; }
    S.loading = true; renderBody();
    let r;
    try { r = await csCall('app_period_stats', { p_from: S.from, p_to: S.to }); } catch (e) { r = { ok: false, code: 'network' }; }
    if (seq !== S.seq || !tokOk(tok)) return;      // رد متأخر لفترة سابقة أو لصفحة/جلسة أخرى: يُهمَل كلياً
    S.loading = false;
    if (r && r.stale) { return; }
    if (r && r.ok === true && r.insp && r.treat && r.emg) {
      S.cache.set(k, { data: r, at: Date.now() });
      S.cur = S.cache.get(k); S.err = null;
      if (S.cache.size > 12) S.cache.delete(S.cache.keys().next().value);
    } else {
      S.err = { code: (r && r.code) || 'bad_response' };
    }
    renderBody();
  }

  // ---------- rendering the body ----------
  function errText(c) {
    switch (c) {
      case 'offline': case 'network': return 'لا يوجد اتصال بالإنترنت، ولا توجد نسخة محفوظة لهذه الفترة.';
      case 'forbidden': return 'ما عندك صلاحية لعرض إحصائيات الفترة.';
      case 'no_live': return 'هذه الصفحة تحتاج جلسة دخول متصلة بالخادم.';
      case 'range_too_large': return 'الفترة أطول من الحد المسموح.';
      case 'invalid_range': return 'الفترة غير صحيحة.';
      default: return 'تعذر تحميل الإحصائيات (' + esc(c) + ').';
    }
  }

  function statusBar() {
    const c = S.cur;
    if (!c && !S.loading && !S.err) return '';
    let badge = '', when = '';
    if (c) {
      const live = online() && Date.now() - c.at < 90000 && !S.err;
      badge = !online() ? '<span class="ps-badge ps-b-off">غير متصل — نسخة محفوظة</span>' : (live ? '<span class="ps-badge ps-b-live">محدّث من الخادم</span>' : '<span class="ps-badge ps-b-cache">نسخة محفوظة</span>');
      when = `آخر تحديث: ${esc(fmtStamp(c.at))} (${agoText(c.at)})`;
    } else if (S.loading) badge = '<span class="ps-badge ps-b-cache">جارٍ التحميل…</span>';
    return `<div class="ps-status">${badge}<span class="grow">${when}</span><button class="ps-refresh" data-act="refresh"${S.loading ? ' disabled' : ''}>${S.loading ? '…' : '↻ تحديث'}</button></div>`;
  }

  function pendingBanner() {
    const n = pendingCount();
    if (!n) return '';
    return `<div class="ps-pend">⏳ لديك <b>${n}</b> عملية محلية لم تُرفع بعد. هذه الإحصائيات من الخادم فقط، <b>ولا تشمل</b> العمل المعلّق على هذا الجهاز.</div>`;
  }

  function skeleton() { return '<div class="ps-skel"></div><div class="ps-skel" style="height:190px"></div><div class="ps-skel"></div>'; }

  function renderBody() {
    const el = $('psBody'); if (!el) return;
    let h = statusBar() + pendingBanner();
    const d = S.cur && S.cur.data;
    if (S.err) h += `<div class="ps-err">${errText(S.err.code)}${S.err.code === 'forbidden' ? '' : '<br><button class="btn btn-primary" style="margin-top:8px" data-act="refresh">إعادة المحاولة</button>'}</div>`;
    if (d) h += body(d);
    else if (S.loading) h += skeleton();
    // حفظ موضع التمرير (إعادة الرسم لا تقفز بالصفحة)
    el.innerHTML = h;
  }

  function body(d) {
    const ins = d.insp, tr = d.treat, em = d.emg, iss = d.issued || {};
    const none = !ins.tower_days && !tr.records && !em.reported && !em.resolved;
    let h = '';
    if (none) {
      h += `<div class="ps-sec"><div class="ps-empty"><div class="big">📭</div><b>لا توجد كشوفات أو معالجات أو مغادرات طارئة مسجّلة في هذه الفترة</b><br><span style="font-size:.78rem;color:#718096">جرّب فترة أوسع. السجلات بلا تاريخ لا تُنسب إلى أي فترة.</span></div></div>`;
    } else {
      h += kpis(d) + seriesSection(d) + inspSection(d) + treatSection(d) + compareSection(d) + emgSection(d);
    }
    h += issuedSection(iss) + qualitySection(d) + definitions();
    return h;
  }

  function kpis(d) {
    const ins = d.insp, tr = d.treat, em = d.emg;
    return `<div class="ps-kpis">
<div class="ps-kpi" style="--c:${COL.insp}"><div class="n">${fmt(ins.tower_days)}</div><div class="l">كشف يومي للأبراج</div><div class="s">${fmt(ins.towers)} برجاً مختلفاً<br>${fmt(ins.lines)} خطاً · ${fmt(ins.days)} يوم كشف</div></div>
<div class="ps-kpi" style="--c:${COL.treat}"><div class="n">${fmt(tr.records)}</div><div class="l">معالجة فعلية</div><div class="s">${fmt(tr.towers)} برجاً<br>${fmt(tr.lines)} خطاً</div></div>
<div class="ps-kpi" style="--c:${COL.emg}"><div class="n">${fmt(em.reported)}</div><div class="l">مغادرة طارئة</div><div class="s">عولج ${fmt(em.resolved)} في الفترة<br>${fmt(em.pending_now)} قيد المعالجة</div></div>
</div>`;
  }

  // ----- time series (inline SVG, bars) -----
  function niceMax(m) {
    if (m <= 4) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(m))), f = m / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function bucketLabel(b, kind) {
    if (kind === 'day') return String(parts(b.from).d);
    if (kind === 'week') return fmtMD(b.from);
    const q = parts(b.from); return q.m + '/' + String(q.y).slice(2);
  }
  function bucketFull(b, kind) {
    if (kind === 'day') return b.from;
    if (kind === 'week') return b.from + ' ← ' + b.to;
    const full = parts(b.from).d === 1 && parts(b.to).d === daysIn(parts(b.to).y, parts(b.to).m);
    return monthName(b.from) + (full ? '' : ' (' + fmtMD(b.from) + '–' + fmtMD(b.to) + ')');
  }
  function seriesSection(d) {
    const sc = SERIES.find(x => x.k === S.series) || SERIES[0], ser = d.series || [], kind = d.bucket;
    const vals = ser.map(b => b[sc.k] || 0), mx = niceMax(Math.max.apply(null, vals.concat([0])));
    const W = 340, H = 168, L = 30, R = 6, T = 10, B = 24, cw = W - L - R, ch = H - T - B, n = Math.max(ser.length, 1), slot = cw / n, bw = Math.max(Math.min(slot * 0.68, 30), 2);
    let g = '';
    [0, 0.5, 1].forEach(f => { const y = T + ch - ch * f; g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#E2E8F0" stroke-width="1"/><text x="${L - 4}" y="${y + 3}" font-size="9" fill="#718096" text-anchor="end">${fmt(mx * f)}</text>`; });
    const every = n <= 12 ? 1 : n <= 16 ? 2 : 5;
    ser.forEach((b, i) => {
      const v = vals[i], x = L + slot * i + (slot - bw) / 2, hh = v ? Math.max(ch * v / mx, 2) : 0, y = T + ch - hh, on = S.pick === i;
      if (on) g += `<rect x="${(L + slot * i).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${ch}" fill="${sc.c}" opacity="0.08"/>`;
      if (v) g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" rx="2.5" fill="${sc.c}" opacity="${S.pick == null || on ? 1 : 0.4}"/>`;
      else g += `<rect x="${x.toFixed(1)}" y="${(T + ch - 1.5).toFixed(1)}" width="${bw.toFixed(1)}" height="1.5" fill="#CBD5E0"/>`;
      if (i % every === 0 || i === n - 1 && every === 1) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" font-size="9" fill="${on ? '#1a2e4a' : '#718096'}" font-weight="${on ? 700 : 400}" text-anchor="middle">${esc(bucketLabel(b, kind))}</text>`;
    });
    const total = vals.reduce((a, b) => a + b, 0);
    let pick = `<div class="ps-pick"><span>المجموع في الفترة: <b>${fmt(total)}</b> ${sc.u} — المس عموداً لعرض يومه/أسبوعه/شهره</span></div>`;
    if (S.pick != null && ser[S.pick]) {
      const b = ser[S.pick], v = vals[S.pick];
      pick = `<div class="ps-pick"><span><b>${esc(bucketFull(b, kind))}</b>: ${fmt(v)} ${sc.u}</span>${v ? `<button class="ps-link" data-act="bucket" data-i="${S.pick}">عرض التفاصيل ‹</button>` : ''}</div>`;
    }
    const seg = SERIES.map(x => `<button class="${x.k === S.series ? 'on' : ''}" style="--c:${x.c}" data-act="series" data-k="${x.k}">${x.n}</button>`).join('');
    const nm = { day: 'يومياً', week: 'أسبوعياً (7 أيام من بداية الفترة)', month: 'شهرياً' }[kind] || '';
    return `<div class="ps-sec"><div class="ps-h" style="--c:${sc.c}"><i></i><h3>التطوّر عبر الفترة</h3></div><p class="ps-sub">${nm}. الكشف = كشف يومي مميّز لبرج. المغادرات حسب تاريخ التبليغ.</p>
<div class="ps-seg" style="--c:${sc.c}">${seg}</div><div class="ps-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(sc.n)}" data-chart="${n}" data-l="${L}" data-w="${W}" data-slot="${slot.toFixed(3)}">${g}</svg></div>${pick}</div>`;
  }

  // ----- inspection -----
  function inspSection(d) {
    const ins = d.insp, lines = ins.by_line || [], mx = Math.max.apply(null, lines.map(l => l.tower_days).concat([1]));
    const shown = lines.slice(0, S.shownLines);
    const rows = shown.map((l, i) => `<button class="ps-row" data-act="insp-line" data-i="${i}">
<div class="ps-rt"><span class="nm">${esc(l.line)}${variantBadge(l)}</span><span class="vl">${fmt(l.tower_days)} <small>كشف يومي</small></span></div>
<div class="ps-track"><div class="ps-fill" style="--c:${COL.insp};width:${(100 * l.tower_days / mx).toFixed(1)}%"></div></div>
<div class="ps-note">${fmt(l.towers)} برجاً مختلفاً · ${fmt(l.days)} يوم كشف · بين ${fmt(l.min_per_day)} و${fmt(l.max_per_day)} برجاً باليوم${l.raw_rows > l.tower_days ? ` · <b>${fmt(l.raw_rows - l.tower_days)}</b> سجل مكرّر لنفس البرج واليوم عُدّ مرة` : ''}</div></button>`).join('');
    return `<div class="ps-sec"><div class="ps-h" style="--c:${COL.insp}"><i></i><h3>نشاط الكشف</h3></div>
<p class="ps-sub">عدد الأبراج التي كُشف عليها وأيام الكشف لكل خط. هذا <b>لا يعني</b> أن الخط كُشف بالكامل — الأبراج المكشوفة فقط هي المحسوبة. اضغط خطاً لرؤية أبراجه.</p>
${rows || '<div class="ps-note">لا كشوفات في هذه الفترة.</div>'}
${lines.length > shown.length ? `<button class="ps-more" data-act="more-insp">عرض باقي الخطوط (${lines.length - shown.length})</button>` : ''}
${lines.length ? `<button class="ps-more" style="margin-top:8px" data-act="insp-all">كل الكشوفات اليومية في الفترة (${fmt(ins.tower_days)}) ‹</button>` : ''}</div>`;
  }
  function variantBadge(l) { return l.variant_of && l.variant_of.length ? ` <span class="ps-vb" title="${esc(l.variant_of.join(' | '))}">⚠ اسم مشابه</span>` : ''; }

  // ----- treatments -----
  // known / partial / wholly unknown: null = unknown (never 0); a recorded 0 is shown as "0 <unit>"
  function qtyPlain(o) {
    if (!o || !o.unit) return '';
    const u = UNIT_AR[o.unit] || o.unit, pt = o.pt || 0, un = o.un || 0;
    if (o.qty == null) return 'الكمية غير مسجّلة' + (un ? ' (' + fmt(un) + ' سجل)' : '');
    let t = fmt(o.qty) + ' ' + u;
    if (pt) t += ' · مجموع جزئي: ' + fmt(pt) + ' سجل فيه بنود بلا عدد';
    if (un) t += ' · ' + fmt(un) + ' سجل بلا عدد (غير محسوب)';
    return t;
  }
  const qo = x => ({ unit: x.unit, qty: x.qty, pt: x.qty_partial_records, un: x.qty_unknown_records });
  function treatSection(d) {
    const tr = d.treat, types = tr.by_type || [], mx = Math.max.apply(null, types.map(t => t.records).concat([1]));
    const rows = types.map((t, i) => {
      const m = tmeta(t.type);
      const q = t.unit ? (t.qty == null ? '<b>' + esc(qtyPlain(qo(t))) + '</b>' : 'الكمية المسجّلة: <b style="color:#1a2e4a">' + esc(qtyPlain(qo(t))) + '</b>') + (t.qty != null && t.qty_unknown_records ? ' <span title="غير المسجّل لا يُعدّ صفراً">(غير المسجّل لا يُعدّ صفراً)</span>' : '') : 'لا تُسجَّل كمية لهذا النوع';
      return `<button class="ps-row" data-act="treat-type" data-i="${i}">
<div class="ps-rt"><span class="nm"><span style="color:${m.c}">●</span> ${esc(m.n)}</span><span class="vl">${fmt(t.records)} <small>سجل</small></span></div>
<div class="ps-track"><div class="ps-fill" style="--c:${m.c};width:${(100 * t.records / mx).toFixed(1)}%"></div></div>
<div class="ps-note">${q}</div></button>`;
    }).join('');
    return `<div class="ps-sec"><div class="ps-h" style="--c:${COL.treat}"><i></i><h3>المعالجات الفعلية</h3></div>
<p class="ps-sub">أعمال نُفِّذت فعلاً (سجلات المعالجة بتاريخ التنفيذ). كل سجل يُعدّ <b>مرة واحدة</b> في المجموع (${fmt(tr.records)})، لكن السجل الذي يضم أكثر من نوع يظهر في كل نوع منها (${fmt(tr.multi_type)} سجل كهذا) — لذلك مجموع الأنواع قد يزيد على عدد السجلات. «معالجة العوازل» تعني عوازل عولجت وليست بالضرورة مستبدلة. اضغط نوعاً لرؤية خطوطه وأبراجه وسجلاته.</p>
${rows || '<div class="ps-note">لا معالجات في هذه الفترة.</div>'}
${tr.records ? `<button class="ps-more" data-act="treat-all">كل سجلات المعالجة في الفترة (${fmt(tr.records)}) ‹</button>` : ''}</div>`;
  }

  // ----- line comparison -----
  function mergedLines(d) {
    const m = new Map(), get = k => { if (!m.has(k)) m.set(k, { line: k, insp: 0, treat: 0, emg: 0, towers: 0, variant: null }); return m.get(k); };
    (d.insp.by_line || []).forEach(l => { const o = get(l.line); o.insp = l.tower_days; o.towers = l.towers; if (l.variant_of && l.variant_of.length) o.variant = l.variant_of; });
    (d.treat.by_line || []).forEach(l => { const o = get(l.line); o.treat = l.records; if (l.variant_of && l.variant_of.length) o.variant = l.variant_of; });
    (d.emg.by_line || []).forEach(l => { const o = get(l.line); o.emg = l.reported; o.emgRes = l.resolved; if (l.variant_of && l.variant_of.length) o.variant = l.variant_of; });
    return Array.from(m.values());
  }
  function compareSection(d) {
    const all = mergedLines(d);
    if (all.length < 2) return '';
    const k = S.sortBy;
    all.sort((a, b) => (b[k] - a[k]) || (b.insp - a.insp) || String(a.line).localeCompare(String(b.line)));
    S._cmp = all;
    const mxs = { insp: Math.max.apply(null, all.map(x => x.insp).concat([1])), treat: Math.max.apply(null, all.map(x => x.treat).concat([1])), emg: Math.max.apply(null, all.map(x => x.emg).concat([1])) };
    const shown = all.slice(0, S.shownCmp || 8);
    const bar = (v, mx, c, t) => `<div><div class="t"><span>${t}</span><b>${fmt(v)}</b></div><div class="ps-track"><div class="ps-fill" style="--c:${c};width:${v ? (100 * v / mx).toFixed(1) : 0}%;${v ? '' : 'min-width:0'}"></div></div></div>`;
    const rows = shown.map((l, i) => `<button class="ps-row" data-act="cmp-line" data-i="${i}"><div class="ps-rt"><span class="nm">${esc(l.line || 'غير محدد')}${l.variant ? ' <span class="ps-vb" title="' + esc(l.variant.join(' | ')) + '">⚠ اسم مشابه</span>' : ''}</span></div>
<div class="ps-tri">${bar(l.insp, mxs.insp, COL.insp, 'كشف')}${bar(l.treat, mxs.treat, COL.treat, 'معالجة')}${bar(l.emg, mxs.emg, COL.emg, 'طارئ')}</div></button>`).join('');
    const sb = [['insp', 'الكشف'], ['treat', 'المعالجات'], ['emg', 'الطارئ']].map(x => `<button class="${k === x[0] ? 'on' : ''}" data-act="sort" data-k="${x[0]}">ترتيب: ${x[1]}</button>`).join('');
    return `<div class="ps-sec"><div class="ps-h" style="--c:#2E4057"><i></i><h3>مقارنة الخطوط</h3></div>
<p class="ps-sub">لكل خط: الكشوفات اليومية والمعالجات والمغادرات الطارئة جنباً إلى جنب (كل عمود مقيس على أعلى خط في عموده). اضغط خطاً لتفاصيله.</p>
<div class="ps-sortbar">${sb}</div>${rows}${all.length > shown.length ? `<button class="ps-more" data-act="more-cmp">عرض كل الخطوط (${all.length})</button>` : ''}</div>`;
  }

  // ----- emergency -----
  function emgSection(d) {
    const em = d.emg, mode = S.emgMode, k = mode === 'resolved' ? 'resolved' : 'reported';
    const types = (em.by_type || []).filter(t => t[k] > 0), mx = Math.max.apply(null, types.map(t => t[k]).concat([1]));
    S._emgTypes = types;
    const rows = types.map((t, i) => `<button class="ps-row" data-act="emg-type" data-i="${i}"><div class="ps-rt"><span class="nm">${t.type ? esc(t.type) : '<i style="color:#718096">بلا نوع مسجّل</i>'}</span><span class="vl">${fmt(t[k])} <small>مغادرة</small></span></div>
<div class="ps-track"><div class="ps-fill" style="--c:${COL.emg};width:${(100 * t[k] / mx).toFixed(1)}%"></div></div></button>`).join('');
    const seg = `<div class="ps-seg" style="--c:${COL.emg}"><button class="${k === 'reported' ? 'on' : ''}" data-act="emg-mode" data-k="reported">المُبلَّغ عنها (${fmt(em.reported)})</button><button class="${k === 'resolved' ? 'on' : ''}" data-act="emg-mode" data-k="resolved">التي عولجت (${fmt(em.resolved)})</button></div>`;
    return `<div class="ps-sec"><div class="ps-h" style="--c:${COL.emg}"><i></i><h3>المغادرات الطارئة</h3></div>
<p class="ps-sub">الأنواع كما كُتبت عند التسجيل (دون تصنيف مُخترَع). «المُبلَّغ عنها» بتاريخ التبليغ، و«التي عولجت» بتاريخ المعالجة المسجّل — وقد تكون أُبلغ عنها قبل الفترة.</p>
${seg}${rows || '<div class="ps-note">لا مغادرات في هذا العرض.</div>'}
${(em.reported || em.resolved) ? `<button class="ps-more" data-act="emg-all">كل المغادرات (${fmt(k === 'resolved' ? em.resolved : em.reported)}) ‹</button>` : ''}</div>`;
  }

  // ----- issued work (never completed work) -----
  function issuedSection(iss) {
    const wo = iss.work_orders || [], tg = iss.telegrams || [];
    if (!(iss.work_orders_total || iss.telegrams_total) && iss.work_orders_ok !== false && iss.telegrams_ok !== false) return '';
    S._wo = wo; S._tg = tg;
    const list = (arr, act, lab) => arr.map((x, i) => `<button class="ps-row" data-act="${act}" data-i="${i}"><div class="ps-rt"><span class="nm">${x[lab] ? esc(x[lab]) : '<i style="color:#718096">بلا بيان</i>'}</span><span class="vl">${fmt(x.count)}</span></div></button>`).join('');
    return `<div class="ps-sec issued"><div class="ps-h" style="--c:${COL.issued}"><i></i><h3>أوامر وبرقيات صادرة</h3></div>
<p class="ps-sub"><b>صادرة وليست منفّذة:</b> هذه أوامر عمل وبرقيات صدرت في الفترة ولا تعني أن العمل أُنجز؛ لا تدخل في أي رقم أعلاه من الكشف أو المعالجات.</p>
${iss.work_orders_ok === false ? '<div class="ps-note"><b>تعذّر قراءة أوامر العمل.</b></div>' : `<div class="ps-h2">أوامر العمل (${fmt(iss.work_orders_total)})</div>${list(wo, 'wo-type', 'work_type') || '<div class="ps-note">لا أوامر عمل بتاريخ في الفترة.</div>'}`}
${iss.telegrams_ok === false ? '<div class="ps-note"><b>تعذّر قراءة البرقيات.</b></div>' : `<div class="ps-h2">برقيات العمل (${fmt(iss.telegrams_total)}) — حسب الحالة</div>${list(tg, 'tg-type', 'status') || '<div class="ps-note">لا برقيات بتاريخ في الفترة.</div>'}`}</div>`;
  }

  // ----- data quality + definitions -----
  function qualitySection(d) {
    const q = d.quality || {}, tr = d.treat, items = [];
    if (q.orphan_links) items.push(`<b>${fmt(q.orphan_links)}</b> معالجة نشطة مرتبطة بكشف أُلغي سابقاً — <b>محتسبة</b> كما هي (المعالجة لم تُلغَ). راجعها من «كل سجلات المعالجة» (تحمل تنبيهاً).`);
    if (q.variant_lines && q.variant_lines.length) items.push('أسماء خطوط متشابهة <b>لم تُدمج</b> (تُعرض منفصلة): ' + q.variant_lines.map(v => esc(v.line) + ' ↔ ' + esc((v.others || []).join('، '))).join(' ؛ '));
    if (q.duplicate_daily_rows) items.push(`<b>${fmt(q.duplicate_daily_rows)}</b> سجل كشف مكرّر لنفس الخط والبرج واليوم — عُدّ كشفاً واحداً.`);
    if (q.emptied_by_partial) items.push(`<b>${fmt(q.emptied_by_partial)}</b> معالجة أُلغيت كل بنودها جزئياً فاستُبعدت من الأعداد.`);
    if (tr.no_items) items.push(`<b>${fmt(tr.no_items)}</b> سجل معالجة بلا بنود مسجّلة (مُحتسب كسجل، ونوعه «بلا بنود»).`);
    if (q.bad_items) items.push(`<b>${fmt(q.bad_items)}</b> بند معالجة بلا مفتاح مفهوم (يظهر «بند بلا مفتاح»).`);
    if (q.other_keys && q.other_keys.length) items.push('مفاتيح معالجة غير معروفة للتصنيف: ' + q.other_keys.map(k => esc(k.key) + ' (' + fmt(k.records) + ')').join('، '));
    if (q.resolved_no_date) items.push(`<b>${fmt(q.resolved_no_date)}</b> مغادرة مسجّلة «تمت المعالجة» بلا تاريخ معالجة — لا تدخل في «التي عولجت».`);
    if (q.undated_work_orders) items.push(`<b>${fmt(q.undated_work_orders)}</b> أمر عمل بلا تاريخ (على كامل السجل) غير منسوب لأي فترة.`);
    if (q.undated_telegrams) items.push(`<b>${fmt(q.undated_telegrams)}</b> برقية بلا تاريخ انقطاع (على كامل السجل) غير منسوبة لأي فترة.`);
    return `<details class="ps-det ps-q"${S.qualOpen ? ' open' : ''} data-det="qual"><summary>ملاحظات على جودة البيانات ${items.length ? '(' + items.length + ')' : '— لا ملاحظات'}</summary>${items.length ? '<ul>' + items.map(i => '<li>' + i + '</li>').join('') + '</ul>' : ''}</details>`;
  }
  function definitions() {
    return `<details class="ps-det"${S.defsOpen ? ' open' : ''} data-det="defs"><summary>كيف تُحسب الأرقام؟</summary><ul>
<li><b>الكشف:</b> كل (خط، برج، يوم) يُعدّ كشفاً يومياً واحداً مهما تكررت سجلاته. نعرض عدد الأبراج وأيام الكشف لكل خط، ولا نقول إن الخط «كُشف بالكامل».</li>
<li><b>المعالجة:</b> كل سجل معالجة يُعدّ مرة واحدة بتاريخ تنفيذه. الأنواع (عوازل، سلاسل، غسيل، حديد، ملحقات…) تُعرض منفصلة وقد يشترك سجل واحد في عدة أنواع.</li>
<li><b>الكميات:</b> تُعرض فقط حيث سُجّلت — عدد العوازل للعوازل، وعدد السلاسل لبنود السلاسل. «غير مسجّلة» تختلف عن الصفر، ولا تُجمع وحدات مختلفة معاً.</li>
<li><b>الملغى:</b> السجلات والبنود الملغاة (بما فيها ما أُلغي تبعاً لإلغاء كشف) مستبعدة. معالجة نشطة مرتبطة بكشف أُلغي سابقاً تبقى محسوبة مع تنبيه.</li>
<li><b>المغادرات الطارئة:</b> أنواعها كما سُجّلت؛ التبليغ بتاريخ الإنشاء بتوقيت بغداد، والمعالجة بتاريخ المعالجة.</li>
<li><b>الصادر:</b> أوامر العمل والبرقيات صادرة وليست منفّذة، ولا تُحسب ضمن الأعمال المنجزة.</li>
<li><b>التواريخ:</b> الفترة شاملة طرفيها بتوقيت بغداد. السجلات بلا تاريخ لا تُنسب لأي فترة. أسماء الخطوط لا تُدمج بالتخمين.</li>
<li><b>المصدر:</b> الأرقام من الخادم فقط؛ العمل المعلّق على جهازك لا يظهر قبل رفعه.</li></ul></details>`;
  }

  // ---------- events (page) ----------
  function onClick(e) {
    // الرسم الزمني: الاختيار بموضع اللمس أفقياً (أعمدة الأيام ضيقة، فالعمود الأقرب هو المختار)
    const sv = e.target.closest ? e.target.closest('svg[data-chart]') : null;
    if (sv) {
      const r = sv.getBoundingClientRect(), W = +sv.getAttribute('data-w'), L = +sv.getAttribute('data-l'), slot = +sv.getAttribute('data-slot'), n = +sv.getAttribute('data-chart');
      const x = (e.clientX - r.left) / r.width * W - L, i = Math.floor(x / slot);
      if (r.width > 0 && i >= 0 && i < n) { S.pick = (S.pick === i ? null : i); renderBody(); }
      return;
    }
    const t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t) return;
    const act = t.getAttribute('data-act'), i = +t.getAttribute('data-i'), k = t.getAttribute('data-k');
    const d = S.cur && S.cur.data;
    switch (act) {
      case 'preset': return onPreset(k);
      case 'refresh': return load(true);
      case 'series': S.series = k; S.pick = null; return renderBody();
      case 'pick': S.pick = (S.pick === i ? null : i); return renderBody();
      case 'bucket': return d && openBucket(d, i);
      case 'sort': S.sortBy = k; return renderBody();
      case 'more-insp': S.shownLines = 9999; return renderBody();
      case 'more-cmp': S.shownCmp = 9999; return renderBody();
      case 'emg-mode': S.emgMode = k; return renderBody();
      case 'insp-line': return d && openInspLine(d.insp.by_line[i]);
      case 'insp-all': return openView({ kind: 'insp_days', title: 'كل الكشوفات اليومية', sub: rangeSub(), params: {}, next: null });
      case 'treat-type': return d && openTreatType(d, d.treat.by_type[i]);
      case 'treat-all': return openView({ kind: 'treat_records', title: 'كل سجلات المعالجة', sub: rangeSub(), params: {}, next: null });
      case 'cmp-line': return d && openLineMenu(d, S._cmp[i]);
      case 'emg-type': { const ty = S._emgTypes[i]; return openView({ kind: 'emg_records', title: ty.type || 'بلا نوع مسجّل', sub: (S.emgMode === 'resolved' ? 'المغادرات التي عولجت في الفترة' : 'المغادرات المبلَّغ عنها في الفترة') + ' · ' + rangeSub(), params: { p_type: ty.type || '', p_mode: S.emgMode }, next: null }); }
      case 'emg-all': return openView({ kind: 'emg_records', title: S.emgMode === 'resolved' ? 'المغادرات التي عولجت' : 'المغادرات المبلَّغ عنها', sub: rangeSub(), params: { p_mode: S.emgMode }, next: null });
      case 'wo-type': { const x = S._wo[i]; return openView({ kind: 'wo_records', title: 'أوامر العمل — ' + (x.work_type || 'بلا بيان'), sub: 'صادرة وليست منفّذة · ' + rangeSub(), params: { p_type: x.work_type || '' }, next: null }); }
      case 'tg-type': { const x = S._tg[i]; return openView({ kind: 'tg_records', title: 'البرقيات — ' + (x.status || 'بلا حالة'), sub: 'صادرة وليست منفّذة · ' + rangeSub(), params: { p_type: x.status || '' }, next: null }); }
    }
  }
  document.addEventListener('toggle', function (e) {
    const t = e.target; if (!t || !t.getAttribute || !t.closest || !t.closest('#psRoot')) return;
    const k = t.getAttribute('data-det'); if (k === 'defs') S.defsOpen = t.open; if (k === 'qual') S.qualOpen = t.open;
  }, true);

  function rangeSub() { return S.from + ' ← ' + S.to; }

  // ---------- drill-down sheet ----------
  // view = { kind, title, sub, params, next(row)->view|null, rows, nextCursor, total, loading, error, local }
  function openBucket(d, i) {
    const b = d.series[i], sc = SERIES.find(x => x.k === S.series) || SERIES[0];
    const kind = { insp: 'insp_days', treat: 'treat_records', emg: 'emg_records' }[sc.k];
    const v = { kind, title: sc.n + ' — ' + bucketFull(b, d.bucket), sub: b.from + ' ← ' + b.to, range: { from: b.from, to: b.to }, params: sc.k === 'emg' ? { p_mode: 'reported' } : {}, next: null };
    openView(v);
  }
  function openInspLine(l) {
    openView({ kind: 'insp_towers', title: l.line, sub: 'الأبراج المكشوفة في الفترة (' + fmt(l.towers) + ' برجاً · ' + fmt(l.tower_days) + ' كشفاً يومياً) — ليست بالضرورة كل أبراج الخط', params: { p_line: l.line },
      next: row => ({ kind: 'insp_days', title: 'برج ' + row.tower + ' — ' + l.line, sub: 'أيام الكشف في الفترة', params: { p_line: l.line, p_tower: row.tower }, next: null }) });
  }
  function treatTowersView(line, type) {
    const m = tmeta(type);
    return { kind: 'treat_towers', title: (line ? line + ' — ' : '') + m.n, sub: 'الأبراج التي عولجت (' + rangeSub() + ')', params: Object.assign({ p_line: line }, type ? { p_type: type } : {}),
      next: row => ({ kind: 'treat_records', title: 'برج ' + row.tower + ' — ' + m.n, sub: line, params: Object.assign({ p_line: line, p_tower: row.tower }, type ? { p_type: type } : {}), next: null }) };
  }
  function openTreatType(d, t) {
    const m = tmeta(t.type), rows = [];
    (d.treat.by_line || []).forEach(l => { const x = (l.types || []).find(y => y.type === t.type); if (x) rows.push({ line: l.line, records: x.records, q: qo(x), variant: l.variant_of }); });
    rows.sort((a, b) => b.records - a.records || String(a.line).localeCompare(String(b.line)));
    openView({ kind: 'local', title: m.n, sub: fmt(t.records) + ' سجل — الخطوط التي نُفِّذ فيها (اضغط خطاً لأبراجه)', local: rows.map(r => ({
      head: r.line + (r.variant && r.variant.length ? '  ⚠ اسم مشابه' : ''), val: fmt(r.records) + ' سجل', note: qtyPlain(r.q), go: () => treatTowersView(r.line, t.type) })), next: null });
  }
  function openLineMenu(d, l) {
    const name = l.line, it = (d.insp.by_line || []).find(x => x.line === name), tr = (d.treat.by_line || []).find(x => x.line === name), em = (d.emg.by_line || []).find(x => x.line === name);
    const local = [];
    if (it) local.push({ head: 'الأبراج المكشوفة', val: fmt(it.towers) + ' برجاً', note: fmt(it.tower_days) + ' كشفاً يومياً · ' + fmt(it.days) + ' يوم كشف', go: () => ({ kind: 'insp_towers', title: name, sub: 'الأبراج المكشوفة في الفترة', params: { p_line: name }, next: row => ({ kind: 'insp_days', title: 'برج ' + row.tower + ' — ' + name, sub: 'أيام الكشف', params: { p_line: name, p_tower: row.tower }, next: null }) }) });
    if (tr) {
      (tr.types || []).forEach(ty => {
        const m = tmeta(ty.type);
        local.push({ head: 'معالجات: ' + m.n, val: fmt(ty.records) + ' سجل', note: qtyPlain(qo(ty)), go: () => treatTowersView(name, ty.type) });
      });
      local.push({ head: 'كل سجلات المعالجة في هذا الخط', val: fmt(tr.records) + ' سجل', note: '', go: () => ({ kind: 'treat_records', title: 'معالجات ' + name, sub: rangeSub(), params: { p_line: name }, next: null }) });
    }
    if (em && (em.reported || em.resolved)) local.push({ head: 'المغادرات الطارئة', val: fmt(em.reported) + ' مُبلَّغ', note: fmt(em.resolved) + ' عولجت في الفترة', go: () => ({ kind: 'emg_records', title: 'مغادرات ' + (name || 'بلا خط'), sub: rangeSub(), params: { p_line: name, p_mode: 'reported' }, next: null }) });
    openView({ kind: 'local', title: name || 'غير محدد', sub: 'ملخص الخط في الفترة — اختر ما تريد عرضه', local, next: null });
  }

  function openView(v) {
    SH.tok = { p: navSeq(), s: sessTag() };
    if (!roleOk()) return;
    if (v.kind !== 'local' && v.kind !== 'inspect') { v.rows = []; v.cursor = null; v.total = null; v.loading = false; v.error = null; v.loaded = false; }
    const sheet = $('psSheet');
    if (!sheet.classList.contains('show')) { SH.stack = []; SH.seq++; sheet.classList.add('show'); try { if (typeof dlgSync === 'function') dlgSync(); } catch (e) {} }
    const parent = sheetTop(); if (parent) parent.scroll = $('psShBody').scrollTop;   // موضع تمرير المستوى الأب يُحفظ ويُستعاد عند الرجوع
    v.scroll = 0;
    SH.stack.push(v);
    renderSheet(true);
    if (v.kind === 'inspect') loadInspect(v);
    else if (v.kind !== 'local') loadMore(v);
  }

  async function loadMore(v) {
    if (v.loading) return;
    if (!roleOk()) return;
    if (!online()) { v.error = 'offline'; renderSheet(); return; }
    const tok = SH.tok, seq = ++SH.seq;
    v.loading = true; v.error = null; renderSheet();
    const args = Object.assign({ p_from: (v.range || S).from, p_to: (v.range || S).to, p_kind: v.kind, p_limit: PAGE }, v.params);
    if (v.cursor) args.p_after = v.cursor;
    let r;
    try { r = await csCall('app_period_stats_detail', args); } catch (e) { r = { ok: false, code: 'network' }; }
    if (!tokOk(tok) || SH.stack.indexOf(v) < 0) { v.loading = false; return; }    // الصفحة/الجلسة تغيّرت أو أُغلق هذا المستوى
    v.loading = false;
    if (r && r.stale) { return; }
    if (r && r.ok === true && Array.isArray(r.rows)) {
      v.rows = v.rows.concat(r.rows); v.cursor = r.next || null; v.total = r.total; v.loaded = true; v.error = null; v.asOf = r.as_of;
    } else v.error = (r && r.code) || 'bad_response';
    if (SH.stack[SH.stack.length - 1] === v) renderSheet();
  }

  function sheetTop() { return SH.stack[SH.stack.length - 1]; }

  function renderSheet(reset) {
    const v = sheetTop(); if (!v) return;
    $('psShTitle').textContent = v.title || '';
    $('psShSub').textContent = v.sub || '';
    $('psShBack').style.visibility = SH.stack.length > 1 ? 'visible' : 'hidden';
    const body = $('psShBody'), prev = reset ? (v.scroll || 0) : body.scrollTop;
    let h = '';
    if (v.kind === 'inspect') {
      h = inspectHtml(v);
    } else if (v.kind === 'local') {
      h = (v.local || []).map((r, i) => `<button class="ps-row" data-sh="go" data-i="${i}"><div class="ps-rt"><span class="nm">${esc(r.head)}</span><span class="vl">${esc(r.val)} ‹</span></div>${r.note ? `<div class="ps-note">${esc(r.note)}</div>` : ''}</button>`).join('') || '<div class="ps-empty">لا بيانات</div>';
    } else {
      h = v.rows.map((r, i) => rowHtml(v, r, i)).join('');
      if (v.loading && !v.rows.length) h = '<div class="ps-skel" style="height:64px"></div><div class="ps-skel" style="height:64px"></div><div class="ps-skel" style="height:64px"></div>';
      if (v.loaded && !v.rows.length && !v.error) h = '<div class="ps-empty"><div class="big">📭</div>لا سجلات</div>';
      if (v.error) h += `<div class="ps-err" style="margin-top:10px">${v.error === 'offline' ? 'لا يوجد اتصال بالإنترنت.' : v.error === 'forbidden' ? 'ما عندك صلاحية.' : 'تعذر التحميل (' + esc(v.error) + ').'}<br><button class="btn btn-primary" style="margin-top:8px" data-sh="retry">إعادة المحاولة</button></div>`;
      if (v.total != null && v.rows.length) h += `<div class="ps-cnt">عُرض ${fmt(v.rows.length)} من ${fmt(v.total)}${v.asOf ? ' · بيانات ' + esc(fmtStamp(Date.parse(v.asOf))) : ''}</div>`;
      if (v.cursor) h += `<button class="ps-more" data-sh="more"${v.loading ? ' disabled' : ''}>${v.loading ? 'جارٍ التحميل…' : 'تحميل المزيد (' + fmt(Math.max(v.total - v.rows.length, 0)) + ' متبقٍ)'}</button>`;
    }
    body.innerHTML = h;
    body.scrollTop = prev;
  }

  function dateStr(x) { return x ? String(x).slice(0, 10) : '—'; }
  function itemPills(items) {
    return (items || []).map(it => {
      if (!it || typeof it !== 'object') return '';
      const ty = tmeta(ts(it.key)), lab = it.label || it.key || 'بند بلا مفتاح', cnt = (it.count != null && it.count !== '') ? ' × ' + esc(it.count) : '';
      return `<span class="ps-pill" style="--c:${ty.c}">${esc(lab)}${cnt}</span>`;
    }).join('');
  }
  // client-side mirror of the server type map is used ONLY to colour a chip; counting is always server-side
  function ts(k) {
    if (!k) return 'unclassified';
    if (/^ins2?_/.test(k)) return 'insulator_fix'; if (/^chainreplace_/.test(k)) return 'chain_replace'; if (/^(plastic|ceramic)_/.test(k)) return 'chain_material';
    if (/^wire_/.test(k)) return 'wire'; if (/^ground_/.test(k)) return 'ground';
    return TYPES[k] ? k : 'other';
  }
  function rowHtml(v, r, i) {
    switch (v.kind) {
      case 'insp_towers':
        return `<button class="ps-row" data-sh="row" data-i="${i}"><div class="ps-rt"><span class="nm">برج ${esc(r.tower)}</span><span class="vl">${fmt(r.days)} <small>يوم كشف</small></span></div><div class="ps-note">أول كشف ${esc(dateStr(r.first))} · آخر كشف ${esc(dateStr(r.last))}${r.raw_rows > r.days ? ` · <b>${fmt(r.raw_rows - r.days)}</b> سجل مكرّر عُدّ مرة` : ''}</div></button>`;
      case 'insp_days':
        return `<button class="ps-row" data-sh="row" data-i="${i}"><div class="ps-rt"><span class="nm">برج ${esc(r.tower)} — ${esc(dateStr(r.date))}</span><span class="vl"><small>عرض الكشف ‹</small></span></div><div class="ps-note">${esc(r.line)}${r.raw_rows > 1 ? ` · ${fmt(r.raw_rows)} سجلات لنفس اليوم عُدّت كشفاً واحداً (تُركَّب عند الفتح)` : ''}</div></button>`;
      case 'treat_towers': {
        const qn = r.unit ? qtyPlain({ unit: r.unit, qty: r.qty, pt: r.qty_partial_records, un: r.qty_unknown_records }) : '';
        return `<button class="ps-row" data-sh="row" data-i="${i}"><div class="ps-rt"><span class="nm">برج ${esc(r.tower)}</span><span class="vl">${fmt(r.records)} <small>سجل</small></span></div><div class="ps-note">آخر معالجة ${esc(dateStr(r.last))}${qn ? ' · ' + esc(qn) : ''}</div></button>`;
      }
      case 'treat_records': {
        const types = (r.types || []).map(t => `<span class="ps-pill soft">${esc(tmeta(t).n)}</span>`).join('');
        let qn = '';
        if (r.unit) {
          const u = UNIT_AR[r.unit] || r.unit;
          if (r.qty_state === 'unknown' || r.qty == null) qn = '<div class="ps-note"><b>الكمية غير مسجّلة</b> لهذا النوع في هذا السجل</div>';
          else if (r.qty_state === 'partial') qn = `<div class="ps-note">الكمية المسجّلة: <b style="color:#1a2e4a">${fmt(r.qty)} ${u}</b> — <b>جزئي:</b> بعض البنود بلا عدد (غير محسوب)</div>`;
          else qn = `<div class="ps-note">الكمية المسجّلة: <b style="color:#1a2e4a">${fmt(r.qty)} ${u}</b></div>`;
        }
        return `<div class="ps-card"><div class="top"><span>برج ${esc(r.tower)} · ${esc(dateStr(r.date))}</span><span style="font-weight:600;color:#718096">${esc(r.by || '')}</span></div><div class="mut">${esc(r.line)}</div><div class="ps-pills">${itemPills(r.items)}</div>${types && (r.types || []).length > 1 ? `<div class="ps-pills">${types}</div>` : ''}${qn}${r.orphan ? '<div class="ps-orph">⚠ مرتبطة بكشف أُلغي سابقاً — محتسبة لأن المعالجة نفسها لم تُلغَ</div>' : ''}</div>`;
      }
      case 'emg_records':
        return `<div class="ps-card"><div class="top"><span>${r.type ? esc(r.type) : '<i style="color:#718096">بلا نوع مسجّل</i>'}</span><span class="ps-pill" style="--c:${r.status === 'تمت المعالجة' ? '#2F855A' : '#C05621'}">${esc(r.status || '—')}</span></div><div class="mut">${esc(r.line || 'خط غير محدد')}${r.tower ? ' · برج ' + esc(r.tower) : ''}</div><div class="mut">بُلِّغ: ${esc(dateStr(r.reported))}${r.resolved ? ' · عولج: ' + esc(dateStr(r.resolved)) : ''}${r.by ? ' · ' + esc(r.by) : ''}</div>${r.details ? `<div class="mut" style="color:#4A5568">${esc(r.details)}</div>` : ''}</div>`;
      case 'wo_records':
        return `<div class="ps-card"><div class="top"><span>${esc(r.work_type || 'بلا بيان')}</span><span style="font-weight:600;color:#718096">${esc(dateStr(r.date))}</span></div><div class="mut">${esc(r.line || '—')} · أمر عمل صادر</div></div>`;
      case 'tg_records':
        return `<div class="ps-card"><div class="top"><span>${esc(r.status || 'بلا حالة')}</span><span style="font-weight:600;color:#718096">${esc(dateStr(r.date))}</span></div><div class="mut">${esc(r.line || '—')}${r.work_type ? ' · ' + esc(r.work_type) : ''}${r.work_order_no ? ' · أمر ' + esc(r.work_order_no) : ''} · برقية صادرة</div></div>`;
    }
    return '';
  }

  // ---------- read-only saved inspection (the SAVED row(s) of that date — never today's component state) ----------
  const SEV = { ok: '🟢 سليم', simple: '⚪ مغادرة بسيطة', moderate: '🟡 مغادرة متوسطة', below_critical: '🟠 مغادرة دون الحرجة', critical: '🔴 مغادرة حرجة' };
  const WASH = { clean: '🟢 نظيف', needs_washing: '💧 يحتاج غسل', very_dirty: '🔴 ملوث جداً (منطقة معامل)' };
  const MAT = { glass: 'زجاج', plastic: 'بلاستك', ceramic: 'سيراميك' };
  function inspectView(r) {
    return { kind: 'inspect', title: 'برج ' + r.tower + ' — ' + dateStr(r.date), sub: r.line + ' · الكشف المحفوظ لهذا اليوم', row: r, ids: Array.isArray(r.ids) ? r.ids.slice() : [], rid: 0, loading: false, error: null, comp: null };
  }
  const normLine = x => String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
  async function loadInspect(v) {
    if (v.loading || !roleOk()) return;
    if (!v.ids.length) { v.error = 'no_ids'; renderSheet(false); return; }
    if (!online()) { v.error = 'offline'; renderSheet(false); return; }
    const tok = SH.tok, rid = ++v.rid, r0 = v.row;
    v.loading = true; v.error = null; renderSheet(false);
    let rows = [], err = null, missing = 0, mismatch = 0;
    try {
      const resp = await Promise.all(v.ids.map(id => sbFetch('inspections?select=*&id=eq.' + encodeURIComponent(id))));
      const ok = resp.every(x => x && x.ok);
      const arr = ok ? await Promise.all(resp.map(x => x.json())) : [];
      if (!ok) err = 'http';
      else arr.forEach(a => { const row = Array.isArray(a) ? a[0] : null; if (!row) missing++; else rows.push(row); });
    } catch (e) { err = 'network'; }
    if (!tokOk(tok) || SH.stack.indexOf(v) < 0 || rid !== v.rid) { v.loading = false; return; }    // جلسة/صفحة تغيّرت أو رُجع عن هذا المستوى أو طلب أحدث
    v.loading = false;
    if (err) { v.error = err; renderSheet(false); return; }
    // لا يُعرض صف لا يطابق خط/برج/تاريخ البطاقة (لا تخمين)
    const good = rows.filter(x => { const m = normLine(x.line_name) === normLine(r0.line) && String(x.tower_number).trim() === String(r0.tower).trim() && String(x.inspection_date).slice(0, 10) === String(r0.date).slice(0, 10); if (!m) mismatch++; return m; });
    let skipped = 0;
    const comp = (typeof dayCompose === 'function') ? dayCompose(good, id => { const c = typeof opsIsVoided === 'function' && opsIsVoided(id); if (c) skipped++; return c; })[0] : good[0];
    if (!comp) { v.error = skipped ? 'voided' : 'empty'; renderSheet(false); return; }
    v.comp = comp; v.missing = missing; v.mismatch = mismatch; v.skipped = skipped; v.loadedAt = Date.now();
    renderSheet(false);
  }
  function _has(v) { return !(v === null || v === undefined || (typeof v === 'string' && v.trim() === '')); }
  // Phase line of the SAVED insulator data. "سليم" only from a NON-EMPTY array whose every element is a real boolean (true = damaged).
  // Missing / empty / null / non-boolean data is shown as unrecorded or unresolved — never as healthy, never as a default.
  // Cycle and material data are kept distinct from zero / default glass. Every historical string is escaped.
  const UNK = t => '<span style="color:#718096">' + t + '</span>';
  function phaseLine(state, cycle, chains, ph, expChains) {   // expChains: chains-per-phase established from the SAVED record (none exists in the row today → callers pass null)
    const a = state && typeof state === 'object' ? state[ph] : undefined;
    const lab = '<b>' + esc(ph) + '</b>: ';
    if (!Array.isArray(a)) return lab + UNK(a === undefined ? 'غير مسجّل' : 'بيانات غير صالحة (غير معروف)');
    if (!a.length) return lab + UNK('غير مسجّل (لا مواضع)');
    const n = a.length, dmg = [], unk = [];
    a.forEach((x, i) => { if (x === true) dmg.push(i + 1); else if (x !== false) unk.push(i + 1); });
    let t = lab;
    if (!unk.length) t += dmg.length ? '<b style="color:#C53030">متضرر ' + fmt(dmg.length) + '</b> من ' + fmt(n) + ' (المواضع ' + dmg.join('، ') + ')' : 'سليم (' + fmt(n) + ' مواضع مسجّلة كلها سليمة)';
    else {
      if (dmg.length) t += '<b style="color:#C53030">متضرر ' + fmt(dmg.length) + '</b> (المواضع ' + dmg.join('، ') + ') · ';
      t += UNK('غير محسوم: ' + fmt(unk.length) + ' من ' + fmt(n) + ' مواضع غير مسجّلة/غير صالحة (' + unk.join('، ') + ') — لا يُحكم بالسلامة');
    }
    // cycles: a recorded 0 is shown as 0; null/non-number is "unrecorded"; a length mismatch is exposed
    const cy = cycle && typeof cycle === 'object' ? cycle[ph] : undefined;
    if (Array.isArray(cy)) {
      const ok = [], bad = [];
      cy.forEach((c, i) => { if (typeof c === 'number' && isFinite(c)) ok.push((i + 1) + '=' + fmt(c)); else bad.push(i + 1); });
      if (ok.length) t += ' · دورات: ' + ok.join('، ');
      if (bad.length) t += ' · ' + UNK('دورات غير مسجّلة في ' + fmt(bad.length) + ' موضع');
      if (cy.length !== n) t += ' · ' + UNK('عدد بيانات الدورات (' + fmt(cy.length) + ') لا يطابق عدد المواضع (' + fmt(n) + ')');
    } else if (cy !== undefined && cy !== null) t += ' · ' + UNK('بيانات الدورات غير صالحة');
    // chain materials: unknown/empty stays "unrecorded" — never defaulted to glass
    const ch = chains && typeof chains === 'object' ? chains[ph] : undefined;
    if (Array.isArray(ch) && ch.length) {
      const m = Object.create(null); let unkM = 0;
      ch.forEach(x => { if (typeof x === 'string' && x.trim()) { const xt = x.trim(), k = Object.prototype.hasOwnProperty.call(MAT, xt) ? MAT[xt] : esc(xt); m[k] = (m[k] || 0) + 1; } else unkM++; });
      const parts = Object.keys(m).map(k => k + ' ×' + m[k]);
      if (unkM) parts.push(UNK('مادة غير مسجّلة ×' + unkM));
      t += ' · السلاسل: ' + parts.join('، ');
      // chain arrays are chains-per-phase, a different unit from insulator positions: NEVER compared with n; only with a saved expected count
      if (Number.isInteger(expChains) && expChains > 0 && ch.length !== expChains) t += ' · ' + UNK('عدد السلاسل المسجّل (' + fmt(ch.length) + ') لا يطابق العدد المتوقع المحفوظ (' + fmt(expChains) + ')');
    } else if (ch !== undefined && ch !== null && !Array.isArray(ch)) t += ' · ' + UNK('بيانات السلاسل غير صالحة');
    return t;
  }
  function inspectHtml(v) {
    if (v.loading && !v.comp) return '<div class="ps-skel" style="height:70px"></div><div class="ps-skel" style="height:110px"></div><div class="ps-skel" style="height:70px"></div>';
    if (v.error) {
      const m = { offline: 'لا يوجد اتصال بالإنترنت.', http: 'تعذّر تحميل السجل من الخادم.', network: 'تعذّر الاتصال بالخادم.', empty: 'لم يُعثر على السجل المحفوظ لهذا اليوم.', voided: 'أُلغي هذا الكشف بعد حساب الإحصائيات — حدّث الإحصائيات.', no_ids: 'لا معرّف للسجل.' }[v.error] || 'تعذّر التحميل.';
      return `<div class="ps-err">${esc(m)}${v.error === 'voided' ? '' : '<br><button class="btn btn-primary" style="margin-top:8px" data-sh="iretry">إعادة المحاولة</button>'}</div>`;
    }
    const c = v.comp; if (!c) return '';
    const day = c._day, n = day ? day.ids.length : 1;
    const rowv = (l, val) => `<div class="ps-card" style="margin:6px 0"><div class="mut" style="margin:0 0 3px">${esc(l)}</div><div style="font-weight:700;color:#1a2e4a;overflow-wrap:anywhere">${val}</div></div>`;
    const sevv = (k) => _has(c[k]) ? esc(SEV[c[k]] || c[k]) : '';
    const sec = (title, parts) => { const p = parts.filter(Boolean); return p.length ? `<div class="ps-h2">${title}</div>${p.join('')}` : ''; };
    const txt = (l, k) => _has(c[k]) ? rowv(l, esc(String(c[k]))) : '';
    const sv = (l, k) => _has(c[k]) ? rowv(l, sevv(k)) : '';
    let ins = [];
    [['', 'insulator_state', 'insulator_cycle', 'insulator_chain_types', 'الدائرة الأولى'], ['_2', 'insulator_state_2', 'insulator_cycle_2', 'insulator_chain_types_2', 'الدائرة الثانية']].forEach(cf => {
      const js = _dayJson(c[cf[1]]), st = js.obj, cy = _dayJson(c[cf[2]]).obj, ch = _dayJson(c[cf[3]]).obj;
      if (!st) { if (!js.ok) ins.push(rowv(cf[4], '<span style="color:#718096">بيانات حالة العوازل غير صالحة (غير معروفة)</span>')); else if (cf[0] === '') ins.push(rowv(cf[4], '<span style="color:#718096">حالة العوازل غير مسجّلة</span>')); return; }
      const lines = ['R', 'S', 'T'].map(ph => phaseLine(st, cy, ch, ph, null));
      ins.push(rowv(cf[4], lines.map(x => '<div style="font-weight:600;margin:2px 0">' + x + '</div>').join('')));
    });
    ins.push(sv('درجة خطورة العوازل', 'sev_insulator'));
    if (_has(c.insulator_washing)) ins.push(rowv('نظافة العوازل', esc(WASH[c.insulator_washing] || c.insulator_washing)));
    const wires = [['الطور R', 'wires_r1'], ['الطور S', 'wires_s1'], ['الطور T', 'wires_t1'], ['R (الدائرة 2)', 'wires_r1_c2'], ['S (الدائرة 2)', 'wires_s1_c2'], ['T (الدائرة 2)', 'wires_t1_c2'], ['R', 'wires_r'], ['S', 'wires_s'], ['T', 'wires_t'], ['R2', 'wires_r2'], ['S2', 'wires_s2'], ['T2', 'wires_t2']].map(x => txt(x[0], x[1]));
    const ground = [['الأرضي', 'ground_1'], ['الأرضي 2', 'ground_2'], ['R', 'ground_r'], ['S', 'ground_s'], ['T', 'ground_t']].map(x => txt(x[0], x[1]));
    const out = [];
    out.push(sec('🔌 العوازل', ins));
    out.push(sec('🔩 تقاطعات الحديد', [sv('الدرجة', 'sev_iron'), txt('الوصف', 'iron_intersections')]));
    out.push(sec('🏗️ الأساسات', [sv('الدرجة', 'sev_foundation'), txt('الوصف', 'tower_foundations')]));
    out.push(sec('📎 الملحقات', [txt('الوصف', 'tower_attachments')]));
    out.push(sec('⚡ الأسلاك', [sv('الدرجة', 'sev_wires'), txt('الدائرة', 'wires_circuit')].concat(wires)));
    out.push(sec('🌍 الأرضي', [sv('الدرجة', 'sev_ground')].concat(ground)));
    out.push(sec('🔥 الحرائق', [sv('الدرجة', 'sev_fire'), txt('الأسباب', 'fire_causes'), txt('ملاحظات', 'fire_causes_notes')]));
    out.push(sec('🛣️ الطريق', [txt('الوجود', 'road_access'), txt('ملاحظات', 'road_access_notes')]));
    out.push(sec('📝 ملاحظات', [txt('ملاحظات عامة', 'notes')]));
    const body = out.filter(Boolean).join('');
    const meta = [c.tower_type ? 'النوع ' + esc(c.tower_type) : '', c.voltage ? esc(c.voltage) + ' ك.ف' : '', c.created_by_name ? '👤 ' + esc(c.created_by_name) : '', c.created_at ? 'سُجّل ' + esc(fmtStamp(Date.parse(c.created_at))) : ''].filter(Boolean).join(' · ');
    const comp = n > 1 ? `<div class="ps-warn" style="margin:8px 0">هذا اليوم محفوظ بـ <b>${n} سجلات</b> لنفس البرج؛ عُرض كشفاً يومياً واحداً مركّباً بالقاعدة المعتمدة (الأحدث أساس، والفراغ يُكمَّل من الأقدم).${day.review && day.review.length ? ' حقول بقيم مختلفة بين السجلات (يُعرض الأحدث): ' + day.review.map(esc).join('، ') : ''}</div>` : '';
    const warn = (v.missing ? `<div class="ps-warn" style="margin:8px 0">تعذّر العثور على ${fmt(v.missing)} من سجلات هذا اليوم.</div>` : '') + (v.mismatch ? `<div class="ps-warn" style="margin:8px 0">استُبعد ${fmt(v.mismatch)} سجل لا يطابق الخط/البرج/التاريخ.</div>` : '') + (v.skipped ? `<div class="ps-warn" style="margin:8px 0">استُبعد ${fmt(v.skipped)} سجل ملغى.</div>` : '');
    return `<div class="ps-note" style="margin-top:6px">هذا ما حُفظ في كشف هذا التاريخ (قراءة فقط) — وليس الحالة الحالية للبرج.</div>${meta ? `<div class="ps-note">${meta}</div>` : ''}${comp}${warn}${body || '<div class="ps-empty">لا تفاصيل مسجّلة في هذا الكشف</div>'}<div class="ps-note" style="margin-top:10px;direction:ltr;text-align:left">${(day ? day.ids : [c.id]).map(x => esc(String(x).slice(0, 8))).join(' · ')}</div>`;
  }

  function onSheetClick(e) {
    const t = e.target.closest ? e.target.closest('[data-sh]') : null;
    if (!t) return;
    const a = t.getAttribute('data-sh'), i = +t.getAttribute('data-i'), v = sheetTop();
    if (a === 'close') return hardCloseViaStack();
    if (a === 'back') return sheetBack();
    if (!v) return;
    if (a === 'more') return loadMore(v);
    if (a === 'retry') return loadMore(v);
    if (a === 'go' && v.local && v.local[i]) { const nv = v.local[i].go(); if (nv) openView(nv); return; }
    if (a === 'row' && v.rows && v.rows[i]) {
      if (v.kind === 'insp_days') return openView(inspectView(v.rows[i]));
      if (v.next) { const nv = v.next(v.rows[i]); if (nv) openView(nv); }
    }
    if (a === 'iretry' && v.kind === 'inspect') return loadInspect(v);
  }

  function closeSheetHard() {
    SH.stack = []; SH.seq++;
    const el = $('psSheet'); if (el && el.classList.contains('show')) { el.classList.remove('show'); try { if (typeof dlgSync === 'function') dlgSync(); } catch (e) {} }
  }
  function hardCloseViaStack() { closeSheetHard(); }
  function sheetBack() {
    if (SH.stack.length > 1) { SH.stack.pop(); SH.seq++; renderSheet(true); return; }
    closeSheetHard();
  }

  // ---------- public ----------
  function open(tok) {
    mount();
    S.tok = tok;
    ensureSession();
    if (!roleOk()) { S.cur = null; S.err = { code: 'forbidden' }; renderBar(); renderBody(); return; }
    if (!S.from) { const r = presetRange('m0'); S.from = r.from; S.to = r.to; S.preset = 'm0'; }
    renderBar();
    load(false);
  }
  function purge() {
    S.cache.clear(); S.cur = null; S.err = null; S.loading = false; S.seq++; S.sess = ''; S.from = null; S.to = null; S.preset = 'm0'; S.pick = null; S.msg = '';
    closeSheetHard();
    const b = $('psBody'); if (b) b.innerHTML = ''; const r = $('psBar'); if (r) r.innerHTML = '';
  }

  window.addEventListener('online', () => { if (pageActive() && S.mounted && S.tok && tokOk(S.tok)) { renderBody(); if (!S.cur || Date.now() - S.cur.at > FRESH_MS) load(false); } });
  window.addEventListener('offline', () => { if (pageActive() && S.mounted) renderBody(); });

  window.PeriodStats = { open, purge, sheetBack, _state: S, _sheet: SH, _phaseLine: phaseLine, _inspectHtml: inspectHtml };
})();
