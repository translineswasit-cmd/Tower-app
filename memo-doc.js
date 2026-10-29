/* memo-doc.js — v335-C6r18 (N23)
   نموذج مستند المذكرة الموحّد + محرّك التخطيط الواحد (معاينة / PDF متعدد الصفحات / Word / .doc الاحتياطي) + تحميل الخطوط.
   سكربت كلاسيكي يُحمَّل مع ميزة المذكرة فقط (index.html → ensureMemoLoaded). لا يلمس DOM إلا عبر دوال الخطوط (document.fonts) والرسم على canvas.
   القواعد: نص المستخدم لا يدخل innerHTML أبداً؛ كل تنسيق يمرّ عبر sanitize (قائمة بيضاء)؛ لا خط بديل صامت (فشل التحميل = منع الإخراج برسالة). */
(function () {
  'use strict';
  const U = 555 / 700;                    // نقطة طباعة لكل وحدة تخطيط (عرض الصفحة 700 وحدة = 555pt كما كان PDF القديم)
  const W = 700, H = 1011, SIDE = 30, TOP = 30, BOTTOM = H - 40, SIG_LIMIT = 970;
  const FONT_DIR = './fonts/';
  const FONTS = {
    SA:  { label: 'Simplified Arabic', css: 'N23SA', word: 'Simplified Arabic', files: { 400: 'SimplifiedArabic-Regular.ttf', 700: 'SimplifiedArabic-Bold.ttf' }, lh: 1.8 },
    TNR: { label: 'Times New Roman', css: 'N23TNR', word: 'Times New Roman', files: { 400: 'TimesNewRoman-Regular.ttf', 700: 'TimesNewRoman-Bold.ttf' }, lh: 1.8 },
    TA:  { label: 'Traditional Arabic', css: 'N23TA', word: 'Traditional Arabic', files: { 400: 'TraditionalArabic-Regular.ttf' }, synthBold: true, lh: 1.8 },
    PT:  { label: 'PT Bold Heading', css: 'N23PT', word: 'PT Bold Heading', files: { 400: 'PTBoldHeading.ttf' }, alwaysBold: true, lh: 1.8 },
    LEG: { label: 'الخط القديم', css: 'Tahoma, Arial', legacy: true, lh: 1.9 }
  };
  const PICK = ['SA', 'TNR', 'TA', 'PT'];   // ما يعرضه الشريط (LEG مخفي: خط المذكرات القديمة)
  const SIZE_MIN = 8, SIZE_MAX = 40;
  const SKEW = 0.25;                       // إمالة مصطنعة موحّدة للمائل (لا يوجد خط عربي مائل مُرفق)
  const KEYS = ['subject', 'body', 'table', 'after', 'closing', 'att', 'stitle', 'sname'];
  const NEW_KEYS = ['att', 'stitle', 'sname'];              // N24b: مرفقات / عنوان مقدم الطلب / اسمه (كانت نصاً خاماً بخط قديم)
  const AL = ['r', 'c', 'l', 'j'];                          // محاذاة الفقرة: يمين / وسط / يسار / ضبط (كشيدة = ضبط بتوزيع المسافات؛ لا تطويل ولا محارف تطويل)
  const AL_DEFAULT = { subject: 'c', body: 'j', table: 'c', after: 'j', closing: 'c', att: 'r', stitle: 'c', sname: 'c' };
  const cleanA = v => (AL.indexOf(v) >= 0 ? v : undefined);
  const LEG_PT = 16 * U, LEG_TBL_PT = 15 * U;
  const baseDefaults = () => ({
    subject: { f: 'SA', s: 14, b: true, i: false }, body: { f: 'SA', s: 14, b: false, i: false },
    table: { f: 'SA', s: 12, b: false, i: false }, after: { f: 'SA', s: 14, b: false, i: false }, closing: { f: 'SA', s: 14, b: true, i: false },
    att: { f: 'SA', s: 14, b: false, i: false }, stitle: { f: 'SA', s: 14, b: false, i: false }, sname: { f: 'SA', s: 14, b: false, i: false }
  });
  const baseLegacy = () => ({
    subject: { f: 'LEG', s: LEG_PT, b: true, i: false }, body: { f: 'LEG', s: LEG_PT, b: false, i: false },
    table: { f: 'LEG', s: LEG_TBL_PT, b: false, i: false }, after: { f: 'LEG', s: LEG_PT, b: false, i: false }, closing: { f: 'LEG', s: LEG_PT, b: false, i: false },
    att: { f: 'LEG', s: LEG_PT, b: false, i: false }, stitle: { f: 'LEG', s: LEG_PT, b: false, i: false }, sname: { f: 'LEG', s: LEG_PT, b: false, i: false }
  });
  const CLOSING_TEXT = 'مع التقدير …';

  // ---------------- helpers ----------------
  const clampS = n => { n = Number(n); if (!isFinite(n)) return null; return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n * 2) / 2)); };
  const cleanText = (t, max) => String(t == null ? '' : t).replace(/[\u0000-\u0009\u000B-\u001F\u007F‎‏‪-‮⁦-⁩]/g, '').replace(/\r\n?/g, '\n').slice(0, max || 20000);
  const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function cleanStyle(o, withDefaultsOnly) {
    const r = {};
    if (o && typeof o === 'object') {
      if (typeof o.f === 'string' && FONTS[o.f]) r.f = o.f;
      if (o.s != null && clampS(o.s) != null) r.s = (FONTS[o.f] && FONTS[o.f].legacy) || o.f === 'LEG' ? Number(o.s) : clampS(o.s);
      if (o.b === true || o.b === false) r.b = o.b;
      if (o.i === true || o.i === false) r.i = o.i;
    }
    return r;
  }
  function cleanBase(o, def) { const c = cleanStyle(o); return Object.assign({}, def, c, { f: c.f || def.f, s: c.s != null ? c.s : def.s }); }
  const sameStyle = (a, b) => a.f === b.f && a.s === b.s && a.b === b.b && a.i === b.i;
  function cleanRuns(arr) {
    const out = [];
    (Array.isArray(arr) ? arr : []).slice(0, 400).forEach(r => {
      if (!r || typeof r !== 'object') return;
      const t = cleanText(r.t); if (t === '') return;
      const st = cleanStyle(r), run = Object.assign({ t }, st), last = out[out.length - 1];
      if (last && ['f', 's', 'b', 'i'].every(k => last[k] === run[k])) last.t += t; else out.push(run);
    });
    return out;
  }
  const runsText = runs => (runs || []).map(r => r.t).join('');
  const mkLine = (runs, a) => { const o = { r: cleanRuns(runs) }; a = cleanA(a); if (a) o.a = a; return o; };      // سطر واحد {r, a?}
  const attPlainList = att => (att ? att.map(p => paraText(p).replace(/\n/g, ' ')) : null);
  const normList = l => (Array.isArray(l) ? l : []).map(x => String(x == null ? '' : x).trim()).filter(Boolean).join('\n');
  const paraText = p => runsText(p.r);
  const parasPlain = paras => (paras || []).map(paraText).join('\n');
  const normPlain = s => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\s+$/g, '');
  function cleanParas(arr, max) {
    const out = [];
    (Array.isArray(arr) ? arr : []).slice(0, max || 2000).forEach(p => { const o = { r: cleanRuns(p && p.r) }, a = cleanA(p && p.a); if (a) o.a = a; out.push(o); });
    return out.length ? out : [{ r: [] }];
  }
  function cleanTable(t) {
    if (!t || typeof t !== 'object' || !Array.isArray(t.c)) return null;
    const rows = t.c.slice(0, 60).map(row => (Array.isArray(row) ? row : []).slice(0, 12).map(cell => { const o = { r: cleanRuns(cell && cell.r) }, a = cleanA(cell && cell.a); if (a) o.a = a; return o; }));
    const cols = Math.max(0, ...rows.map(r => r.length)); if (!rows.length || !cols) return null;
    rows.forEach(r => { while (r.length < cols) r.push({ r: [] }); });
    return { c: rows };
  }
  const tablePlain = t => (t && t.c) ? t.c.map(row => row.map(cell => runsText(cell.r).replace(/\n/g, ' '))) : null;
  function plainToParas(text) { return cleanParas(String(text == null ? '' : text).split('\n').map(l => ({ r: l === '' ? [] : [{ t: l }] }))); }
  function plainToTable(td, keepStyleFrom) {
    if (!Array.isArray(td) || !td.length) return null;
    return cleanTable({ c: td.map(row => (Array.isArray(row) ? row : []).map(c => ({ r: c == null || c === '' ? [] : [{ t: String(c) }] }))) });
  }

  // ---------------- state ----------------
  // state = { mode:'legacy'|'v1', from, subject:{r}, body:[para], table:{c}|null, after:[para], closing:{r}, base:{subject,body,table,after,closing}, touched:bool, notes:[] }
  const strLines = a => (Array.isArray(a) ? a.map(x => ({ r: x == null || x === '' ? [] : [{ t: cleanText(x, 2000) }] })) : null);
  function legacyState(row) {
    row = row || {};
    return {
      mode: 'legacy', from: '', touched: false, notes: [], base: baseLegacy(),
      subject: { r: row.subject ? [{ t: cleanText(row.subject, 2000) }] : [] },
      body: plainToParas(row.content || ''), table: plainToTable(row.table_data), after: [{ r: [] }], closing: { r: [{ t: CLOSING_TEXT }] },
      att: strLines(row.attachments), stitle: mkLine(row.sender_title ? [{ t: cleanText(row.sender_title, 2000) }] : []), sname: mkLine(row.sender_name ? [{ t: cleanText(row.sender_name, 2000) }] : [])
    };
  }
  function newState() {
    return { mode: 'v1', from: '', touched: true, notes: [], base: baseDefaults(), subject: { r: [] }, body: [{ r: [] }], table: null, after: [{ r: [] }], closing: { r: [{ t: CLOSING_TEXT }] }, att: null, stitle: { r: [] }, sname: { r: [] } };
  }
  // layout JSON (as stored) → state. Returns {state, notes}. Never throws: invalid → null (caller falls back to legacy).
  function stateFromLayout(layout, row) {
    if (!layout || typeof layout !== 'object' || layout.v !== 1) return null;
    row = row || {};
    const st = { mode: 'v1', touched: false, notes: [] };
    const bs = layout.base || {}, bd = baseDefaults(), lg = baseLegacy();
    // مفاتيح N24b الجديدة غير الموجودة في layout قديم = مظهرها القديم (خط قديم) فلا يتغيّر شيء في مذكرة محفوظة سابقاً
    st.base = {}; KEYS.forEach(k => { const d = (bs[k] && bs[k].f === 'LEG') || (!bs[k] && NEW_KEYS.indexOf(k) >= 0) ? lg[k] : bd[k]; st.base[k] = cleanBase(bs[k], d); });
    st.from = cleanText(layout.from, 2000);
    const ln = x => mkLine(x && (x.r || (Array.isArray(x) ? x : [])), x && x.a);
    st.subject = ln(layout.subject);
    st.body = cleanParas(layout.body); st.table = cleanTable(layout.table); st.after = cleanParas(layout.after);
    st.closing = ln(layout.closing);
    // N24b: المرفقات/العنوان/الاسم — من layout إن وُجدت مفاتيحها وإلا من أعمدة الصف كنص خام (مذكرة محفوظة قبل N24b)
    st.att = Array.isArray(layout.att) ? cleanParas(layout.att) : strLines(row.attachments);
    st.stitle = ('stitle' in layout) ? ln(layout.stitle) : mkLine(row.sender_title ? [{ t: cleanText(row.sender_title, 2000) }] : []);
    st.sname = ('sname' in layout) ? ln(layout.sname) : mkLine(row.sender_name ? [{ t: cleanText(row.sender_name, 2000) }] : []);
    // older client edited content/table_data/subject after this layout was saved → the plain columns win, styles of that area return to its base (never lose the rest)
    if (row.content != null && normPlain(parasPlain(st.body)) !== normPlain(row.content)) { st.body = plainToParas(row.content); st.notes.push('body'); }
    if (row.subject != null && normPlain(runsText(st.subject.r)) !== normPlain(row.subject)) { st.subject = { r: row.subject ? [{ t: cleanText(row.subject, 2000) }] : [] }; st.notes.push('subject'); }
    if (Array.isArray(layout.att) && row.attachments !== undefined && normList(attPlainList(st.att)) !== normList(row.attachments)) { st.att = strLines(row.attachments); st.notes.push('att'); }
    if (('stitle' in layout) && row.sender_title != null && normPlain(runsText(st.stitle.r)) !== normPlain(row.sender_title)) { st.stitle = mkLine(row.sender_title ? [{ t: cleanText(row.sender_title, 2000) }] : []); st.notes.push('stitle'); }
    if (('sname' in layout) && row.sender_name != null && normPlain(runsText(st.sname.r)) !== normPlain(row.sender_name)) { st.sname = mkLine(row.sender_name ? [{ t: cleanText(row.sender_name, 2000) }] : []); st.notes.push('sname'); }
    if (row.table_data !== undefined) {
      const lp = JSON.stringify(tablePlain(st.table)), rp = JSON.stringify(Array.isArray(row.table_data) && row.table_data.length ? row.table_data.map(r => (r || []).map(c => String(c == null ? '' : c))) : null);
      if (lp !== rp) { st.table = plainToTable(row.table_data); st.notes.push('table'); }
    }
    return st;
  }
  function layoutFromState(st) {
    const L = { v: 1, base: {}, subject: mkLine(st.subject.r, st.subject.a), body: cleanParas(st.body), after: cleanParas(st.after), closing: mkLine(st.closing.r, st.closing.a), table: st.table ? cleanTable(st.table) : null };
    KEYS.forEach(k => { L.base[k] = st.base[k]; });
    if (st.from) L.from = cleanText(st.from, 2000);
    if (st.att) L.att = cleanParas(st.att);
    if (st.stitle) L.stitle = mkLine(st.stitle.r, st.stitle.a);
    if (st.sname) L.sname = mkLine(st.sname.r, st.sname.a);
    L.plain = parasPlain(L.body);
    return L;
  }
  // الجهة المصدِرة («من»): من hdr إن مُرّرت، وإلا من الحالة؛ فارغة = لا تُطبع
  const fromOf = (state, hdr) => String(hdr && hdr.from !== undefined ? hdr.from : (state.from || '')).trim();
  // السطر المطبوع للجهة المصدِرة: «من / » + النص (كما «إلى /»)؛ فارغ = لا سطر. لا يُكرَّر إن كتب المستخدم «من /» بنفسه.
  const fromLine = (state, hdr) => { const t = fromOf(state, hdr); return t ? (/^من\s*\//.test(t) ? t : 'من / ' + t) : ''; };
  // المرفقات/العنوان/الاسم: من الحالة (N24b) أو من hdr القديمة (نص خام) لو لم تكن في الحالة
  const attOf = (state, hdr) => (state.att !== undefined ? (state.att || []) : strLines(hdr && hdr.attachments) || []).filter(p => paraText(p).trim() !== '');
  const lineOf = (state, hdr, key, hk) => (state[key] !== undefined ? state[key] : mkLine(hdr && hdr[hk] ? [{ t: String(hdr[hk]) }] : []));
  const lineHas = l => !!l && paraText(l).trim() !== '';
  const afterHasText = st => st.after.some(p => paraText(p).trim() !== '');
  const closingRuns = st => st.closing.r;
  // table → plain array for the legacy column / older clients (null when no table)
  const plainTableData = st => st.table ? tablePlain(st.table) : null;

  // ---------------- style resolution ----------------
  function resolve(run, base) {
    const f = run.f || base.f, fam = FONTS[f] || FONTS.SA;
    let b = run.b != null ? run.b : base.b; if (fam.alwaysBold) b = true;
    const i = run.i != null ? run.i : base.i, s = run.s != null ? run.s : base.s;
    const px = Math.round(s / U * 100) / 100;
    return { f, s, b: !!b, i: !!i, px, fam };
  }
  function fontString(st) {
    const fam = st.fam;
    if (fam.legacy) return (st.b ? 'bold ' : '') + st.px + 'px ' + fam.css;
    const realBold = st.b && fam.files[700];
    return (realBold ? '700 ' : '400 ') + st.px + 'px "' + fam.css + '"';
  }
  const synthBold = st => !!(st.b && !st.fam.legacy && !st.fam.files[700] && !st.fam.alwaysBold);
  const lineHFor = st => st.px * st.fam.lh;

  // ---------------- fonts ----------------
  const _loaded = new Map();               // css+weight → Promise<true|Error>
  function faceKey(f, w) { return f + ':' + w; }
  function ensureFace(f, w) {
    const fam = FONTS[f]; if (!fam || fam.legacy) return Promise.resolve(true);
    const key = faceKey(f, w); if (_loaded.has(key)) return _loaded.get(key);
    const file = fam.files[w]; if (!file) return Promise.resolve(true);
    const p = (async () => {
      if (typeof FontFace === 'undefined' || !document.fonts) throw new Error('FontFace unsupported');
      const ff = new FontFace(fam.css, 'url(' + FONT_DIR + file + ')', { weight: String(w), style: 'normal' });
      await ff.load(); document.fonts.add(ff);
      return true;
    })().catch(e => { _loaded.delete(key); throw e; });
    _loaded.set(key, p); return p;
  }
  // يحمّل الخطوط المطلوبة؛ يُرجع {ok, failed:[labels]}. لا بديل صامتاً: الفشل يُبلَّغ ويُمنع الإخراج.
  async function ensureFonts(needs) {
    const failed = [];
    await Promise.all(needs.map(async ([f, w]) => { try { await ensureFace(f, w); } catch (e) { const l = (FONTS[f] || {}).label || f; if (failed.indexOf(l) < 0) failed.push(l); } }));
    return { ok: failed.length === 0, failed };
  }
  function neededFaces(st) {
    const set = new Map(), add = (run, base) => { const r = resolve(run, base); if (r.fam.legacy) return; set.set(faceKey(r.f, r.fam.files[700] && r.b ? 700 : 400), [r.f, r.fam.files[700] && r.b ? 700 : 400]); };
    const walkRuns = (runs, base) => { if (!runs.length) add({}, base); runs.forEach(r => add(r, base)); };
    walkRuns(st.subject.r, st.base.subject); st.body.forEach(p => walkRuns(p.r, st.base.body)); st.after.forEach(p => walkRuns(p.r, st.base.after)); walkRuns(st.closing.r, st.base.closing);
    (st.att || []).forEach(p => { if (paraText(p).trim()) walkRuns(p.r, st.base.att); }); if (st.stitle && lineHas(st.stitle)) walkRuns(st.stitle.r, st.base.stitle); if (st.sname && lineHas(st.sname)) walkRuns(st.sname.r, st.base.sname);
    if (st.table) st.table.c.forEach(row => row.forEach(c => walkRuns(c.r, st.base.table)));
    return [...set.values()];
  }

  // ---------------- Arabic joining across style boundaries (ZWJ) ----------------
  const NO_JOIN_NEXT = new Set([0x621, 0x622, 0x623, 0x624, 0x625, 0x627, 0x629, 0x62F, 0x630, 0x631, 0x632, 0x648, 0x671, 0x672, 0x673, 0x675, 0x676, 0x677, 0x6C0, 0x6D2, 0x6D3]);
  const isMark = c => (c >= 0x64B && c <= 0x65F) || c === 0x670 || (c >= 0x6D6 && c <= 0x6ED);
  const isArLetter = c => (c >= 0x620 && c <= 0x64A) || (c >= 0x66E && c <= 0x6D3 && c !== 0x6D4) || c === 0x640;
  function joinsNext(text) { for (let k = text.length - 1; k >= 0; k--) { const c = text.charCodeAt(k); if (isMark(c)) continue; return isArLetter(c) && !NO_JOIN_NEXT.has(c) && !(c >= 0x688 && c <= 0x699) && !(c >= 0x6C3 && c <= 0x6CB) && c !== 0x6CD && c !== 0x6CF; } return false; }
  function joinsPrev(text) { for (let k = 0; k < text.length; k++) { const c = text.charCodeAt(k); if (isMark(c)) continue; return isArLetter(c) && c !== 0x621; } return false; }
  const AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/, LAT = /[A-Za-z0-9]/;

  // ---------------- tokenization + measuring ----------------
  let _mctx = null;
  function mctx() { if (!_mctx) _mctx = document.createElement('canvas').getContext('2d'); _mctx.direction = 'rtl'; return _mctx; }
  function meas(text, st) { const c = mctx(); c.font = fontString(st); return c.measureText(text).width; }
  // para → tokens [{k:'w',segs:[{t,st}]}|{k:'sp',st}|{k:'br'}]
  function tokens(para, base) {
    const out = []; let cur = null, pendSp = null;
    const flush = () => { if (cur) { out.push(cur); cur = null; } };
    (para.r.length ? para.r : []).forEach(run => {
      const st = resolve(run, base); let seg = null;
      for (const ch of run.t) {
        if (ch === '\n') { flush(); pendSp = null; out.push({ k: 'br' }); seg = null; }
        else if (ch === ' ') { flush(); seg = null; if (!pendSp) pendSp = { k: 'sp', st }; }
        else {
          if (pendSp) { out.push(pendSp); pendSp = null; }
          if (!cur) cur = { k: 'w', segs: [] };
          if (!seg) { seg = { t: '', st }; cur.segs.push(seg); }
          seg.t += ch;
        }
      }
    });
    flush(); return out;
  }
  function prepWord(w) {
    const segs = w.segs;
    segs.forEach((s, i) => {
      s.ds = s.t;
      const nx = segs[i + 1];
      if (nx && joinsNext(s.t) && joinsPrev(nx.t)) { s.trail = true; nx.lead = true; }
    });
    segs.forEach(s => { s.ds = (s.lead ? '‍' : '') + s.t + (s.trail ? '‍' : ''); s.w = meas(s.ds, s.st); });
    w.w = segs.reduce((a, s) => a + s.w, 0);
    const txt = segs.map(s => s.t).join('');
    w.dir = AR.test(txt) ? 'r' : (LAT.test(txt) ? 'l' : 'n');
    return w;
  }
  // وحدات «حرف مرئي»: الحرف الأساسي + علاماته (تشكيل / ZWJ / محدِّدات) + الأزواج البديلة
  function glyphUnits(segs) {
    const units = [];
    segs.forEach((sg, si) => { for (const ch of sg.t) { const c = ch.codePointAt(0); const comb = isMark(c) || c === 0x200D || c === 0x200C || (c >= 0xFE00 && c <= 0xFE0F) || (c >= 0x300 && c <= 0x36F); if (comb && units.length && units[units.length - 1].si === si) units[units.length - 1].ch += ch; else units.push({ ch, si }); } });
    return units;
  }
  const segsOf = (units, segs) => { const out = []; units.forEach(u => { const l = out[out.length - 1]; if (l && l.si === u.si) l.t += u.ch; else out.push({ si: u.si, t: u.ch, st: segs[u.si].st }); }); return out.map(x => ({ t: x.t, st: x.st })); };
  // يقسم كلمة طويلة إلى قطع كلٌّ منها ≤ العرض المتاح (قطعة واحدة على الأقل بحرف)؛ limFn(i) = عرض القطعة i
  function splitWord(w, limFn) {
    const units = glyphUnits(w.segs), pieces = []; let i = 0, n = 0;
    while (i < units.length) {
      const lim = Math.max(1, limFn(n)); let j = i + 1, best = null;
      // تقدير سريع بجمع عروض الأحرف ثم تحقّق فعلي (الوصل/الكرنينغ) مع تراجع
      let est = 0, k = i; while (k < units.length) { const uw = meas(units[k].ch, w.segs[units[k].si].st); if (est + uw > lim && k > i) break; est += uw; k++; }
      j = Math.max(i + 1, k);
      for (; j > i; j--) {
        const sg = segsOf(units.slice(i, j), w.segs);
        // وصل الحروف عند نقطة القطع: ZWJ في آخر القطعة السابقة وأول القطعة التالية (نفس قاعدة حدود الأنماط)
        if (i > 0 && joinsNext(units[i - 1].ch) && joinsPrev(units[i].ch)) sg[0].lead = true;
        if (j < units.length && joinsNext(units[j - 1].ch) && joinsPrev(units[j].ch)) sg[sg.length - 1].trail = true;
        const pc = prepWord({ k: 'w', segs: sg }); if (pc.w <= lim + 0.01 || j === i + 1) { best = pc; break; }
      }
      pieces.push(best); i = j; n++;
    }
    return pieces;
  }
  // يقسّم فقرة إلى صفوف. avail(first) → العرض المتاح للصف
  function layoutPara(para, base, availFn) {
    const toks = tokens(para, base), rows = [];
    let cur = { words: [], w: 0, soft: false, uni: undefined, txt: '' }, pend = null;
    const newRow = () => ({ words: [], w: 0, soft: false, uni: undefined, txt: '' });
    const push = soft => { cur.soft = !!soft; rows.push(cur); cur = newRow(); };
    const uniOf = w => { const f = w.segs[0].st; return w.segs.every(s => sameStyle(s.st, f)) ? f : null; };
    const place = t => {
      const sp = pend && cur.words.length ? meas(' ', pend) : 0; t.sp = sp; pend = null;
      const avail = availFn(rows.length === 0), u = uniOf(t), word = t.segs.map(s => s.t).join('');
      let width = cur.w + sp + t.w;
      // سطر بنمط واحد: قياس النص المتّصل كاملاً (كما كان التفاف المذكرة القديمة بالضبط)
      if (cur.words.length && cur.uni && u && sameStyle(cur.uni, u)) width = meas(cur.txt + ' ' + word, u);
      if (cur.words.length && width > avail) { push(false); t.sp = 0; }
      cur.uni = cur.words.length ? (cur.uni && u && sameStyle(cur.uni, u) ? cur.uni : null) : u;
      cur.txt = cur.words.length ? cur.txt + ' ' + word : word;
      cur.words.push(t); cur.w += t.sp + t.w;
    };
    toks.forEach(t => {
      if (t.k === 'br') { push(true); pend = null; return; }
      if (t.k === 'sp') { pend = t.st; return; }
      prepWord(t);
      // كلمة واحدة أعرض من السطر الفارغ: تُقسَم على حدود الأحرف (لا حذف ولا تصغير ولا تجاوز للهوامش)
      if (t.w > availFn(rows.length === 0 && !cur.words.length) + 0.01) {
        if (cur.words.length) { push(false); }
        const pieces = splitWord(t, i => availFn(rows.length === 0 && i === 0));
        pieces.forEach((pc, i) => { if (i) push(false); pend = null; place(pc); });
        pend = null; return;
      }
      place(t);
    });
    if (cur.words.length || !rows.length || toks.length === 0) rows.push(cur);
    rows.forEach(r => { r.h = r.words.length ? Math.max(...r.words.map(w => Math.max(...w.segs.map(s => lineHFor(s.st))))) : lineHFor(resolve({}, base)); });
    return rows;
  }
  // الترتيب البصري للكلمات في سطر RTL: مجموعات LTR المتتالية تُعكس
  function visualOrder(words) {
    const cls = words.map(w => w.dir);
    for (let i = 0; i < cls.length; i++) if (cls[i] === 'n' && cls[i - 1] === 'l' && cls[i + 1] === 'l') cls[i] = 'l';
    const out = []; let i = 0;
    while (i < words.length) {
      if (cls[i] === 'l') { let j = i; while (j < words.length && cls[j] === 'l') j++; for (let k = j - 1; k >= i; k--) out.push(k); i = j; }
      else { out.push(i); i++; }
    }
    return out;
  }
  // يُصدر عمليات رسم لصف: mode 'justify' | 'right' | 'center'
  function emitRow(ops, row, xRight, maxW, y, mode, extraIndent) {
    const words = row.words; if (!words.length) return;
    const order = visualOrder(words), n = words.length;
    const wsum = words.reduce((a, w) => a + w.w, 0);
    const firstSp = Math.max(...words.map(w => w.sp || 0), 0) || (words[0].segs[0] ? meas(' ', words[0].segs[0].st) : 4);
    let gap = null;
    if (mode === 'justify' && n > 1) gap = Math.max(firstSp, (maxW - wsum) / (n - 1));
    const gapAt = (a, b) => gap != null ? gap : (words[Math.max(a, b)].sp || firstSp);
    let total = 0; order.forEach((wi, k) => { total += words[wi].w; if (k) total += gapAt(order[k - 1], wi); });
    let x = mode === 'center' ? xRight + total / 2 : (mode === 'left' ? xRight - maxW + total : xRight);
    const baseline = y + row.h * 0.7;
    // سطر بنمط واحد بلا كلمات LTR وغير مسطَّب: يُرسم نصاً متصلاً (كالمذكرة القديمة، ويحفظ التشكيل)
    const u = words[0].segs[0] && words.every(w => w.segs.length === 1 && sameStyle(w.segs[0].st, words[0].segs[0].st));
    if (u && (mode === 'right' || mode === 'center') && new Set(words.map(w => w.dir).filter(d => d !== 'n')).size <= 1 && words[0].segs[0].st.fam.legacy) {
      const st0 = words[0].segs[0].st, txt = words.map(w => w.segs[0].t).join(' ');
      ops.push({ t: 'text', text: txt, x: xRight, y: baseline, st: st0, al: mode === 'center' ? 'center' : 'right' }); return 0;
    }
    order.forEach((wi, k) => {
      if (k) x -= gapAt(order[k - 1], wi);
      const w = words[wi];
      if (w.dir === 'l') { let sx = x - w.w; w.segs.forEach(s => { ops.push({ t: 'text', text: s.ds, x: sx, y: baseline, st: s.st, al: 'left' }); sx += s.w; }); }
      else { let sx = x; w.segs.forEach(s => { ops.push({ t: 'text', text: s.ds, x: sx, y: baseline, st: s.st, al: 'right' }); sx -= s.w; }); }
      x -= w.w;
    });
    return total;
  }

  // ---------------- document layout (pages of ops) ----------------
  const LEGF = { n: 'normal', b: 'bold' };
  const legSt = (b, px) => { const fam = FONTS.LEG; return { f: 'LEG', s: px * U, b: !!b, i: false, px, fam }; };
  function plainWrap(text, maxW, st) {
    const words = String(text).split(' ').filter(w => w !== ''), out = []; let line = '';
    const chop = word => { const parts = []; let cur = ''; for (const ch of word) { if (cur && meas(cur + ch, st) > maxW) { parts.push(cur); cur = ch; } else cur += ch; } if (cur) parts.push(cur); return parts; };
    for (let word of words) {
      if (meas(word, st) > maxW) {                 // كلمة أعرض من السطر: تُقسم على الأحرف (بلا حذف)
        if (line) { out.push(line); line = ''; }
        const parts = chop(word); parts.slice(0, -1).forEach(x => out.push(x)); line = parts[parts.length - 1]; continue;
      }
      const test = line ? line + ' ' + word : word; if (meas(test, st) > maxW && line) { out.push(line); line = word; } else line = test;
    }
    if (line) out.push(line); return out.length ? out : [''];
  }
  // hdr = {number,date,to,senderTitle,senderName,attachments}
  function layoutDocument(state, hdr) {
    let tableCols = null, tableCapped = false;
    const pages = [{ ops: [] }]; let pg = pages[0], y = TOP;
    const addPage = () => { pg = { ops: [] }; pages.push(pg); y = TOP; };
    const need = h => { if (y + h > BOTTOM && y > TOP + 1) addPage(); };
    const op = o => pg.ops.push(o);
    const contentW = W - SIDE * 2, right = W - SIDE;
    const f16 = legSt(false, 16), f16b = legSt(true, 16), lh = 16 * 1.9;
    // محاذاة صف داخل صندوق [boxRight-boxW … boxRight]: r يمين / c وسط / l يسار / j ضبط (آخر سطر/سطر مفصول/كلمة واحدة يبقى يميناً)
    const emitA = (row, isLast, boxRight, boxW, yy, a) => {
      if (a === 'c') emitRow(pg.ops, row, boxRight - boxW / 2, boxW, yy, 'center');
      else if (a === 'l') emitRow(pg.ops, row, boxRight, boxW, yy, 'left');
      else if (a === 'j') emitRow(pg.ops, row, boxRight, boxW, yy, (isLast || row.soft || row.words.length <= 1) ? 'right' : 'justify');
      else emitRow(pg.ops, row, boxRight, boxW, yy, 'right');
    };
    const isIndA = a => a === 'j' || a === 'r';
    // ---- header (page 1 only): إلى / من | العدد التاريخ ----
    const toLines = plainWrap(hdr.to || '', W - SIDE * 2 - 160 - 10, f16b);
    const fromTxt = fromLine(state, hdr), fromLines = fromTxt ? plainWrap(fromTxt, W - SIDE * 2 - 160 - 10, f16b) : [];
    toLines.concat(fromLines).forEach((ln, i) => op({ t: 'text', text: ln, x: right, y: y + i * lh * 0.85 + lh * 0.7, st: f16b, al: 'right' }));
    const headerX = SIDE + contentW * 0.20;
    op({ t: 'text', text: 'العدد : ' + (hdr.number || ''), x: headerX, y: y + lh * 0.7, st: f16, al: 'right' });
    op({ t: 'text', text: 'التاريخ : ' + (hdr.date || ''), x: headerX, y: y + lh * 1.6, st: f16, al: 'right' });
    y += Math.max((toLines.length + fromLines.length) * lh * 0.85, lh * 1.7) + lh * 1.5;
    // ---- subject (centered, same position) ----
    const subjPara = { r: [{ t: 'م / ', f: state.base.subject.f, s: state.base.subject.s, b: state.base.subject.b, i: state.base.subject.i }].concat(state.subject.r) };
    { const sr = layoutPara(subjPara, state.base.subject, () => contentW), sa = state.subject.a || AL_DEFAULT.subject; sr.forEach((row, ri) => { need(row.h); emitA(row, ri === sr.length - 1, right, contentW, y, sa); y += row.h; }); }
    y += lh * 0.3;                                      // (1.3 − 1 سطر) كما في المذكرة القديمة
    // ---- body ----
    const bodySt = resolve({}, state.base.body), indentW = meas('ممممم', bodySt);
    let firstContent = true;
    const flow = (paras, base, indentFirst, defA) => {
      let first = indentFirst;
      paras.forEach(p => {
        const pa = p.a || defA, ia = isIndA(pa);
        const empty = paraText(p).trim() === '' && !p.r.some(r => /\n/.test(r.t));
        if (empty) { need(lineHFor(resolve({}, base))); y += lineHFor(resolve({}, base)); return; }
        const rows = layoutPara(trimPara(p), base, isFirst => contentW - (first && ia && (isFirst || state.mode === 'legacy') ? indentW : 0));
        rows.forEach((row, ri) => {
          need(row.h);
          const ind = (first && ia && ri === 0) ? indentW : 0, last = ri === rows.length - 1;
          emitA(row, last, right - ind, contentW - ind, y, pa);
          y += row.h;
        });
        first = false;
      });
    };
    flow(state.body, state.base.body, true, AL_DEFAULT.body);
    y += lh * 0.6;
    // ---- table ----
    if (state.table) layoutTable();
    // ---- below-table text (only when non-empty: no extra space) ----
    if (afterHasText(state)) { if (state.table) y += lh * 0.6; flow(state.after, state.base.after, false, AL_DEFAULT.after); }
    // ---- closing ----
    y += lh;
    const closeRows = layoutPara({ r: state.closing.r.length ? state.closing.r : [] }, state.base.closing, () => contentW);
    const closeH = closeRows.reduce((a, r) => a + r.h, 0);
    need(closeH + lh * 2.6);
    const afterClosingStart = y;
    { const ca = state.closing.a || AL_DEFAULT.closing; closeRows.forEach((row, ri) => { emitA(row, ri === closeRows.length - 1, right, contentW, y, ca); y += row.h; }); }
    y += lh * 0.6;
    // ---- attachments ----
    const attP = attOf(state, hdr);
    if (attP.length) {
      need(lh * 3);
      const tw = meas('المرفقات :', f16b);
      op({ t: 'text', text: 'المرفقات :', x: right, y: y + lh * 0.7, st: f16b, al: 'right' });
      op({ t: 'line', x1: right - tw, y1: y + lh * 0.7 + 3, x2: right, y2: y + lh * 0.7 + 3 });
      y += lh;
      attP.forEach((p, i) => {
        const base = state.base.att || baseLegacy().att, tp = trimPara(p), plainRuns = tp.r.every(r => r.f == null && r.s == null && r.b == null && r.i == null);
        if (base.f === 'LEG' && plainRuns && (!p.a || p.a === 'r') && !tp.r.some(r => /\n/.test(r.t))) {
          // مذكرة قديمة/نص خام بالخط القديم: نفس رسم المنفِّذ القديم بالضبط (نص متّصل لكل سطر)
          plainWrap((i + 1) + '. ' + runsText(tp.r), contentW, f16).forEach(ln => { need(lh); op({ t: 'text', text: ln, x: right, y: y + lh * 0.7, st: f16, al: 'right' }); y += lh; });
        } else {
          const rows = layoutPara({ r: [{ t: '.' + (i + 1) }].concat(tp.r) }, base, () => contentW);   // «.n» كي يظهر الترقيم كما في الرسم القديم (نقطة يسار الرقم)
          rows.forEach((row, ri) => { need(row.h); emitA(row, ri === rows.length - 1, right, contentW, y, p.a || AL_DEFAULT.att); y += row.h; });
        }
      });
      y += lh * 0.5;
    }
    // ---- signature ----
    const sT = lineOf(state, hdr, 'stitle', 'senderTitle'), sN = lineOf(state, hdr, 'sname', 'senderName'), hasT = lineHas(sT), hasN = lineHas(sN);
    if (hasT || hasN) {
      const tenW = meas('مممممممممم', f16), sx = W * 0.40 - tenW;
      const half = Math.max(sx - SIDE, 60), boxW = half * 2, boxRight = sx + half;           // صندوق التوقيع: مركزه نفس نقطة التوسيط القديمة وحدّه الأيسر على الهامش
      const sigRows = (ln, key) => { const tp = trimPara(ln), base = state.base[key] || baseLegacy()[key]; const plain = base.f === 'LEG' && tp.r.every(r => r.f == null && r.s == null && r.b == null && r.i == null) && (!ln.a || ln.a === 'c') && !tp.r.some(r => /\n/.test(r.t)) && meas(runsText(tp.r), f16) <= boxW; return plain ? { legacy: true, text: runsText(tp.r), h: lh } : { rows: layoutPara(tp, base, () => boxW), a: ln.a || AL_DEFAULT[key] }; };
      const rT = hasT ? sigRows(sT, 'stitle') : null, rN = hasN ? sigRows(sN, 'sname') : null;
      const hOf = r => (r ? (r.legacy ? r.h : r.rows.reduce((a, x) => a + x.h, 0)) : 0);
      const sigBlock = Math.max(lh * 2.5, hOf(rT) + hOf(rN) + lh * 0.5);
      const sigShortY = afterClosingStart + lh * 7, sigLongY = afterClosingStart + lh;
      const single = pages.length === 1;
      const isShort = single && (sigShortY + sigBlock) <= SIG_LIMIT;
      let sy = Math.max(y, isShort ? sigShortY : sigLongY);
      if (sy + sigBlock > BOTTOM) { addPage(); sy = y; }
      const drawSig = r => { if (!r) return; if (r.legacy) { op({ t: 'text', text: r.text, x: sx, y: sy + lh * 0.7, st: f16, al: 'center' }); sy += lh; } else r.rows.forEach((row, ri) => { emitA(row, ri === r.rows.length - 1, boxRight, boxW, sy, r.a); sy += row.h; }); };
      drawSig(rT); drawSig(rN);
      y = sy + (rN ? 0 : 0) + lh * 0;
    }
    pages.forEach((p, i) => { p.n = i + 1; });
    return { pages, W, H, tableCols: tableCapped ? tableCols : null };

    function trimPara(p) { // يحذف الفراغات الطرفية (كما trim() القديمة) دون المساس بالتنسيق
      const r = p.r.map(x => Object.assign({}, x)); while (r.length && /^\s*$/.test(r[0].t)) r.shift(); if (r.length) r[0].t = r[0].t.replace(/^\s+/, '');
      while (r.length && /^\s*$/.test(r[r.length - 1].t)) r.pop(); if (r.length) r[r.length - 1].t = r[r.length - 1].t.replace(/\s+$/, ''); return { r };
    }
    function layoutTable() {
      const rowsData = state.table.c, cols = rowsData[0].length, pad = 16, minW = 50, maxW = 200;
      const baseT = state.base.table, tblSt = resolve({}, baseT);
      // عرض العمود = أعرض خلية بلا لفّ (كالقديم) بحدّ 200
      const natural = new Array(cols).fill(minW);
      rowsData.forEach(row => row.forEach((cell, ci) => {
        const rows1 = layoutPara({ r: cell.r }, baseT, () => 1e6); let w = 0; rows1.forEach(r => { w = Math.max(w, r.w); });
        natural[ci] = Math.max(natural[ci], w + pad);
      }));
      let colW = natural.map(w => Math.min(w, maxW)); const CW = W - SIDE * 2;
      if (colW.reduce((a, b) => a + b, 0) > CW) {      tableCapped = true; // الجدول لا يتجاوز الهوامش: «مستوى مائي» t يقصّ الأعمدة الأعرض فقط حتى يبلغ المجموع 640
        let lo = minW, hi = maxW; const sumAt = t => colW.reduce((a, w) => a + Math.min(w, t), 0);
        for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (sumAt(mid) > CW) hi = mid; else lo = mid; }
        colW = colW.map(w => Math.min(w, lo));
      }
      tableCols = colW.slice(); const total = colW.reduce((a, b) => a + b, 0), rightEdge = W / 2 + total / 2;
      const prepared = rowsData.map(row => row.map((cell, ci) => layoutPara({ r: cell.r }, baseT, () => colW[ci] - pad).map((r, ri, arr) => { r._last = ri === arr.length - 1; r._a = cell.a || AL_DEFAULT.table; r.h = Math.max(18, r.words.length ? Math.max(...r.words.map(w => Math.max(...w.segs.map(s => s.st.px * 1.2)))) : tblSt.px * 1.2); return r; })));
      prepared.forEach(cells => {
        let idx = cells.map(() => 0), guard = 0;
        while (cells.some((c, i) => idx[i] < c.length) && guard++ < 1000) {
          const full = Math.max(...cells.map((c, i) => c.slice(idx[i]).reduce((a, r) => a + r.h, 0)), 18) + 12, left = BOTTOM - y;
          let take;
          if (full <= left) take = cells.map((c, i) => c.length - idx[i]);                       // الصف كله يتّسع
          else if (full <= BOTTOM - TOP) { addPage(); continue; }                                  // يتّسع بصفحة فارغة: يُنقل كاملاً
          else if (y > TOP + 1 && left < 18 + 12 + 18) { addPage(); continue; }                    // صف أكبر من صفحة وما بقي لا يكفي سطراً
          else take = cells.map((c, i) => { let n = 0, h = 0; while (idx[i] + n < c.length && (n === 0 || h + c[idx[i] + n].h <= left - 12)) { h += c[idx[i] + n].h; n++; } return n; });   // قطعة بقدر المتاح (سطر على الأقل)
          const frag = cells.map((c, i) => c.slice(idx[i], idx[i] + take[i]));
          const fh = Math.max(...frag.map(f => f.reduce((a, r) => a + r.h, 0)), 18) + 12;
          let cx = rightEdge;
          frag.forEach((lines, ci) => {
            const w = colW[ci]; cx -= w;
            op({ t: 'rect', x: cx, y, w, h: fh });
            const th = lines.reduce((a, r) => a + r.h, 0); let ty = y + (fh - th) / 2;
            lines.forEach(r => { emitA(r, r._last, cx + w - pad / 2, w - pad, ty, r._a); ty += r.h; });
          });
          y += fh; idx = idx.map((v, i) => v + take[i]);
          if (cells.some((c, i) => idx[i] < c.length)) addPage();
        }
      });
    }
  }

  // ---------------- drawing ----------------
  function drawPage(page, scale) {
    const cv = document.createElement('canvas'); cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
    const ctx = cv.getContext('2d'); ctx.scale(scale, scale); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.direction = 'rtl'; ctx.textBaseline = 'alphabetic'; ctx.strokeStyle = '#000'; ctx.fillStyle = '#000';
    page.ops.forEach(o => {
      if (o.t === 'rect') { ctx.lineWidth = 1; ctx.strokeRect(o.x, o.y, o.w, o.h); }
      else if (o.t === 'line') { ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke(); }
      else {
        const st = o.st; ctx.font = fontString(st); ctx.textAlign = o.al === 'left' ? 'left' : (o.al === 'center' ? 'center' : 'right'); ctx.fillStyle = '#000';
        if (st.i) { ctx.save(); ctx.translate(o.x, o.y); ctx.transform(1, 0, -SKEW, 1, 0, 0); ctx.fillText(o.text, 0, 0); if (synthBold(st)) { ctx.lineWidth = Math.max(0.5, st.px * 0.04); ctx.lineJoin = 'round'; ctx.strokeText(o.text, 0, 0); } ctx.restore(); }
        else { ctx.fillText(o.text, o.x, o.y); if (synthBold(st)) { ctx.lineWidth = Math.max(0.5, st.px * 0.04); ctx.lineJoin = 'round'; ctx.strokeText(o.text, o.x, o.y); } }
      }
    });
    return cv;
  }
  // يحمّل الخطوط ثم يخطّط؛ يرمي Error({code:'FONT_FAIL', failed}) عند أي فشل (لا إخراج بخط بديل)
  async function renderPages(state, hdr, scale) {
    const f = await ensureFonts(neededFaces(state));
    if (!f.ok) { const e = new Error('FONT_FAIL: ' + f.failed.join('، ')); e.code = 'FONT_FAIL'; e.failed = f.failed; throw e; }
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const lay = layoutDocument(state, hdr);
    return { lay, canvases: lay.pages.map(p => drawPage(p, scale || 3)) };
  }

  // ---------------- Word (.docx) — uses the docx global (loaded lazily by index.html) ----------------
  function docxRuns(D, runs, base, extra) {
    const out = [];
    const mk = (text, st, brk) => {
      const o = Object.assign({ rightToLeft: true }, extra || {});
      if (text !== undefined) o.text = text;
      if (brk) o.break = 1;
      if (!st.fam.legacy) {
        const name = st.fam.word, bold = st.fam.alwaysBold ? false : st.b;
        o.font = { ascii: name, hAnsi: name, cs: name, eastAsia: name };
        o.size = Math.round(st.s * 2); o.sizeComplexScript = Math.round(st.s * 2);
        o.bold = !!bold; o.boldComplexScript = !!bold; o.italics = st.i; o.italicsComplexScript = st.i;
      } else if (st.b) { o.bold = true; o.boldComplexScript = true; }
      return new D.TextRun(o);
    };
    const src = runs.length ? runs : [];
    src.forEach(run => {
      const st = resolve(run, base); const parts = String(run.t).split('\n');
      parts.forEach((pt, i) => { if (i > 0) out.push(mk(undefined, st, true)); if (pt !== '') out.push(mk(pt, st, false)); });
    });
    return out;
  }
  async function buildDocxBlob(state, hdr, D) {
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, BorderStyle, WidthType } = D;
    const noB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, noBorders = { top: noB, bottom: noB, left: noB, right: noB };
    const legRun = (text, o) => new TextRun(Object.assign({ text, rightToLeft: true }, o || {}));
    const P = (children, opts) => new Paragraph(Object.assign({ bidirectional: true, children }, opts || {}));
    const toRuns = [legRun(hdr.to || '', { bold: true })];
    // فقرات Word هنا RTL (bidi): في Word/LibreOffice تُفسَّر jc=left/right كـ بداية/نهاية السطر، أي تنعكس فيزيائياً؛ لذلك: يمين فعلي = jc left ويسار فعلي = jc right (تحقق بعرض LibreOffice؛ Word الحقيقي لم يُجرَّب)
    const AT = { r: AlignmentType.LEFT, c: AlignmentType.CENTER, l: AlignmentType.RIGHT, j: AlignmentType.JUSTIFIED }, alOf = (a, def) => AT[a || def];
    const leftCell = (text) => new TableCell({ borders: noBorders, children: [P([legRun(text)], { alignment: AT.l })] });
    const toParas = [P(toRuns, { alignment: AT.r })];
    if (fromLine(state, hdr)) toParas.push(P([legRun(fromLine(state, hdr), { bold: true })], { alignment: AT.r }));
    // الجدول LTR: الخلية الأولى أقصى اليسار. المعاينة/PDF: العدد والتاريخ يساراً، إلى/من يميناً (والمحاذاة الفيزيائية معكوسة داخل فقرات RTL: AT.r/AT.l)
    const headerTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ children: [leftCell('العدد : ' + (hdr.number || '')), new TableCell({ borders: noBorders, children: toParas })] }),
      new TableRow({ children: [leftCell('التاريخ : ' + (hdr.date || '')), new TableCell({ borders: noBorders, children: [new Paragraph({ text: '' })] })] })
    ] });
    const ch = [headerTable, new Paragraph({ text: '' })];
    const sb = state.base.subject;
    ch.push(P(docxRuns(D, [{ t: 'م / ' }].concat(state.subject.r), sb), { alignment: alOf(state.subject.a, 'c') }));
    ch.push(new Paragraph({ text: '' }));
    const bodyParas = (paras, base, indentFirst) => paras.forEach((p, i) => ch.push(P(docxRuns(D, p.r, base), { alignment: alOf(p.a, 'j'), indent: indentFirst && i === 0 && (!p.a || p.a === 'j' || p.a === 'r') ? { firstLine: 280 } : undefined })));
    bodyParas(state.body, state.base.body, true);
    if (state.table) {
      ch.push(new Paragraph({ text: '' }));
      const line = { style: BorderStyle.SINGLE, size: 4, color: '000000' }, full = { top: line, bottom: line, left: line, right: line };
      // جدول عريض (مجموع الأعمدة الطبيعية > عرض المحتوى): أعمدة ثابتة بنفس نسب المعاينة/PDF وبمجموع = عرض نص الصفحة؛ غير ذلك يبقى كما كان (تلقائي)
      let cw = null;
      try { const f = await ensureFonts(neededFaces(state)); if (f.ok) { cw = layoutDocument(state, hdr).tableCols; } } catch (e) { cw = null; if (window.console) console.warn("memo word table", e); }
      const wideOpts = cw && cw.length === state.table.c[0].length ? (() => { const sum = cw.reduce((a, b) => a + b, 0), tw = D.WidthType.DXA, CONTENT_TW = 9026; const cols = cw.map(w => Math.max(300, Math.floor(w / sum * CONTENT_TW))); return { cols, total: cols.reduce((a, b) => a + b, 0) }; })() : null;
      const tblOpts = wideOpts ? { width: { size: wideOpts.total, type: WidthType.DXA }, columnWidths: wideOpts.cols, layout: D.TableLayoutType.FIXED } : { width: { size: 0, type: WidthType.AUTO } };
      ch.push(new Table(Object.assign({}, tblOpts, { alignment: AlignmentType.CENTER, rows: state.table.c.map(row => new TableRow({ children: row.map((cell, ci) => new TableCell({ borders: full, width: wideOpts ? { size: wideOpts.cols[ci], type: WidthType.DXA } : { size: 0, type: WidthType.AUTO }, children: [P(docxRuns(D, cell.r, state.base.table), { alignment: alOf(cell.a, 'c') })] })) })) })));
    }
    if (afterHasText(state)) { ch.push(new Paragraph({ text: '' })); bodyParas(state.after, state.base.after, false); }
    ch.push(new Paragraph({ text: '' }));
    ch.push(P(docxRuns(D, state.closing.r, state.base.closing), { alignment: alOf(state.closing.a, 'c') }));
    const attP = attOf(state, hdr);
    if (attP.length) {
      ch.push(new Paragraph({ text: '' }));
      ch.push(P([legRun('المرفقات :', { bold: true, underline: {} })], { alignment: AT.r }));
      attP.forEach((p, i) => ch.push(P(docxRuns(D, [{ t: (i + 1) + '. ' }].concat(p.r), state.base.att || baseLegacy().att), { alignment: alOf(p.a, 'r') })));
    }
    const sT = lineOf(state, hdr, 'stitle', 'senderTitle'), sN = lineOf(state, hdr, 'sname', 'senderName');
    if (lineHas(sT) || lineHas(sN)) {
      for (let i = 0; i < 7; i++) ch.push(new Paragraph({ text: '' }));
      if (lineHas(sT)) ch.push(P(docxRuns(D, sT.r, state.base.stitle || baseLegacy().stitle), { alignment: alOf(sT.a, 'c'), indent: { left: 4500 } }));
      if (lineHas(sN)) ch.push(P(docxRuns(D, sN.r, state.base.sname || baseLegacy().sname), { alignment: alOf(sN.a, 'c'), indent: { left: 4500 } }));
    }
    return await Packer.toBlob(new Document({ sections: [{ properties: {}, children: ch }] }));
  }

  // ---------------- .doc fallback (every user string escaped) ----------------
  function runsHtml(runs, base) {
    return (runs || []).map(run => {
      const st = resolve(run, base), css = [];
      if (!st.fam.legacy) { css.push("font-family:'" + st.fam.word + "'", 'font-size:' + st.s + 'pt'); }
      if (st.b && !st.fam.alwaysBold) css.push('font-weight:bold'); if (st.i) css.push('font-style:italic');
      return '<span style="' + css.join(';') + '">' + escHtml(run.t).replace(/\n/g, '<br>') + '</span>';
    }).join('');
  }
  function buildDocHtml(state, hdr) {
    const sT = lineOf(state, hdr, 'stitle', 'senderTitle'), sN = lineOf(state, hdr, 'sname', 'senderName');
    const e = escHtml, att = attOf(state, hdr), TA = { r: 'right', c: 'center', l: 'left', j: 'justify' }, ta = (a, def) => 'text-align:' + TA[a || def] + ';';
    const para = (p, base, ind, def) => '<p style="' + ta(p.a, def) + (ind && (!p.a || p.a === 'j' || p.a === 'r') ? 'text-indent:5ch;' : '') + 'margin:0 0 4px 0">' + (runsHtml(p.r, base) || '&#160;') + '</p>';
    return '<div style="font-family:Arial,sans-serif;direction:rtl;font-size:16px;line-height:1.9">' +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-weight:700" align="right">' + e(hdr.to) + (fromLine(state, hdr) ? '<br>' + e(fromLine(state, hdr)) : '') + '</td><td align="left" style="white-space:nowrap">العدد&#160;:&#160;' + e(hdr.number) + '</td></tr><tr><td>&#160;</td><td align="left" style="white-space:nowrap">التاريخ&#160;:&#160;' + e(hdr.date) + '</td></tr></table>' +
      '<p style="margin-top:14px;' + ta(state.subject.a, 'c') + '">' + runsHtml([{ t: 'م / ' }].concat(state.subject.r), state.base.subject) + '</p>' +
      '<div style="margin-top:18px;text-align:justify">' + state.body.map((p, i) => para(p, state.base.body, i === 0, 'j')).join('') + '</div>' +
      (state.table ? '<table style="border-collapse:collapse;margin:18px auto 0;width:auto">' + state.table.c.map(row => '<tr>' + row.map(c => '<td style="border:1px solid #000;padding:6px 14px;' + ta(c.a, 'c') + 'white-space:normal;word-wrap:break-word">' + runsHtml(c.r, state.base.table) + '</td>').join('') + '</tr>').join('') + '</table>' : '') +
      (afterHasText(state) ? '<div style="margin-top:12px;text-align:justify">' + state.after.map(p => para(p, state.base.after, false, 'j')).join('') + '</div>' : '') +
      '<p style="margin-top:18px;' + ta(state.closing.a, 'c') + '">' + runsHtml(state.closing.r, state.base.closing) + '</p>' +
      (att.length ? '<div style="margin-top:18px;text-align:right"><div style="display:inline-block;font-weight:700;text-decoration:underline">المرفقات :</div><div style="margin-top:4px">' + att.map((p, i) => '<div style="' + ta(p.a, 'r') + '">' + e((i + 1) + '. ') + runsHtml(p.r, state.base.att || baseLegacy().att) + '</div>').join('') + '</div></div>' : '') +
      '<div style="margin-top:60px;margin-right:40%">' + (lineHas(sT) ? '<p style="' + ta(sT.a, 'c') + '">' + runsHtml(sT.r, state.base.stitle || baseLegacy().stitle) + '</p>' : '') + (lineHas(sN) ? '<p style="' + ta(sN.a, 'c') + '">' + runsHtml(sN.r, state.base.sname || baseLegacy().sname) + '</p>' : '') + '</div></div>';
  }

  window.MemoDoc = {
    U, W, H, FONTS, PICK, KEYS, SIZE_MIN, SIZE_MAX, CLOSING_TEXT, SKEW,
    baseDefaults, baseLegacy, legacyState, newState, stateFromLayout, layoutFromState, plainTableData,
    KEYS_ALL: KEYS, AL, AL_DEFAULT, cleanA, mkLine, attPlainList, normList, fromLine, attOf, lineHas, cleanRuns, cleanParas, cleanTable, cleanText, cleanStyle, cleanBase, clampS, runsText, paraText, parasPlain, tablePlain, plainToParas, plainToTable, afterHasText, normPlain,
    resolve, fontString, ensureFonts, neededFaces, layoutDocument, drawPage, renderPages, buildDocxBlob, buildDocHtml, escHtml, runsHtml,
    _meas: meas, _joinsNext: joinsNext, _joinsPrev: joinsPrev, _prepWord: prepWord, _tokens: tokens
  };
})();
