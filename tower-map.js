/* tower-map.js — N25-R34: «خريطة الأبراج» + «التقاط موقع البرج».
   يُحمَّل عند الطلب فقط (featRun ['tmap']). صندوق الالتقاط/المزامنة (tloc*) في index.html؛ هذا الملف للواجهة.
   • الخريطة: عارض Canvas ذاتي (بلا مكتبة خارجية): تجميع علامات (cluster) للخطوط الكثيرة، بلاطات OSM كخلفية اختيارية (تعذّرها لا يمنع عرض النقاط).
   • «موقعي»: بطلب صريح وبإذن المتصفح، قراءة واحدة (لا watchPosition)، بالذاكرة فقط: لا تخزين ولا إرسال. علامة مستقلة + دائرة الدقة.
   • أقرب الأبراج: مسافة مستقيمة (haversine) بالمتر/الكيلومتر لا مسافة الطريق.
   • النقاط المحلية: كاش IndexedDB معزول بالحساب (uid|line) + آخر ما أكّده الخادم لهذا الحساب (tloc_confirmed). */
(function () {
'use strict';
const TS = 256, MINZ = 3, MAXZ = 19, CLUSTER_Z = 15, CELL = 46, LABEL_Z = 15;   // N25-R37: أرقام الأبراج تظهر بجانب النقاط من تكبير 15
const COLORS = ['#c0392b', '#1a5276', '#1e8449', '#b9770e', '#7d3c98', '#117a65', '#a04000', '#2e4057', '#c2185b', '#455a64'];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const uidNow = () => (typeof currentUser !== 'undefined' && currentUser && currentUser.id != null) ? String(currentUser.id) : null;
const normLine = s => String(s == null ? '' : s).replace(/\s*(400|132)\s*ك\.ف\s*$/, '').replace(/\s+/g, ' ').trim();
const lineKey = (s) => { const m = /(400|132)\s*ك\.ف\s*$/.exec(String(s || '')); return normLine(s) + (m ? '|' + m[1] : ''); };
function sameLine(a, b) { const x = lineKey(a), y = lineKey(b); if (x === y) return true; const bx = normLine(a), by = normLine(b); return bx === by && (x.indexOf('|') < 0 || y.indexOf('|') < 0); }

// ---------- projection ----------
const lonToX = (lon, z) => (lon + 180) / 360 * TS * Math.pow(2, z);
const latToY = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * TS * Math.pow(2, z); };
const xToLon = (x, z) => x / (TS * Math.pow(2, z)) * 360 - 180;
const yToLat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / (TS * Math.pow(2, z)); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371008.8, p = Math.PI / 180, dLat = (lat2 - lat1) * p, dLon = (lon2 - lon1) * p;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
function fmtDist(m) { return m < 1000 ? Math.round(m) + ' م' : (m / 1000).toFixed(2) + ' كم'; }
function fmtTime(ts) { if (!ts) return '—'; const d = new Date(ts); if (isNaN(d)) return '—'; const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
const SRC_AR = { field_capture: 'التقاط ميداني', kmz_import: 'مستورد (KMZ)' };

// ---------- local cache (IndexedDB, per account) ----------
let _db = null;
function idb() {
  if (_db) return _db;
  _db = new Promise((resolve) => {
    try {
      const rq = indexedDB.open('tower_map_cache', 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore('lines', { keyPath: 'k' }); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null); rq.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return _db;
}
async function cacheAll(uid) {
  const db = await idb(); if (!db || !uid) return new Map();
  return new Promise((resolve) => {
    try {
      const out = new Map(), rq = db.transaction('lines', 'readonly').objectStore('lines').openCursor();
      rq.onsuccess = () => { const c = rq.result; if (!c) return resolve(out); if (c.value && c.value.uid === uid && c.value.key !== '__ref__') out.set(c.value.key, c.value); c.continue(); };
      rq.onerror = () => resolve(out);
    } catch (e) { resolve(new Map()); }
  });
}
async function cachePut(uid, entries) {
  const db = await idb(); if (!db || !uid || !entries.length) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('lines', 'readwrite'), st = tx.objectStore('lines');
      entries.forEach(e => st.put(Object.assign({ k: uid + '|' + e.key, uid }, e)));
      tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); tx.onabort = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}

async function cacheDel(uid, keys) {
  const db = await idb(); if (!db || !uid || !keys.length) return false;
  return new Promise((resolve) => { try { const tx = db.transaction('lines', 'readwrite'), st = tx.objectStore('lines'); keys.forEach(k => st.delete(uid + '|' + k)); tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); tx.onabort = () => resolve(false); } catch (e) { resolve(false); } });
}

async function refCacheGet(uid) {
  const db = await idb(); if (!db || !uid) return null;
  return new Promise((resolve) => { try { const rq = db.transaction('lines', 'readonly').objectStore('lines').get(uid + '|__ref__'); rq.onsuccess = () => resolve(rq.result || null); rq.onerror = () => resolve(null); } catch (e) { resolve(null); } });
}
// ---------- state ----------
const S = { open: false, mode: 'single', sel: [], rows: [], info: { source: null, at: null, missing: [], total: 0, withLoc: 0 }, user: null, locMsg: '', bg: false, frameUser: false, ref: { on: {}, data: null, at: null, src: null, err: '' }, seq: 0, locTok: 0, typeMemo: new Map(), streets: null, streetsAsk: false, towers: [], towerById: new Map(), labelCount: 0, labelTexts: [], view: { lat: 32.5, lon: 45.8, z: 8 }, drawn: [], pop: null, loading: false, uid: null, gen: null, tiles: new Map(), raf: 0, nearest: [], hl: null, pend: [] };
let CARD = null;

// ---------- map view ----------
function el(id) { return document.getElementById(id); }
function resize() {
  const cv = el('tmCanvas'), wrap = el('tmWrap'); if (!cv || !wrap) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(200, wrap.clientWidth), h = Math.max(240, wrap.clientHeight);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
  S.W = w; S.H = h; S.dpr = dpr; draw();
}
function toScreen(lat, lon) { const z = S.view.z; return { x: S.W / 2 + lonToX(lon, z) - lonToX(S.view.lon, z), y: S.H / 2 + latToY(lat, z) - latToY(S.view.lat, z) }; }
function toGeo(x, y) { const z = S.view.z; return { lon: xToLon(lonToX(S.view.lon, z) + (x - S.W / 2), z), lat: yToLat(latToY(S.view.lat, z) + (y - S.H / 2), z) }; }
function requestDraw() { if (S.raf) return; S.raf = requestAnimationFrame(() => { S.raf = 0; draw(); }); }
// N25-R38: تلوين علامات خطوط 132 ك.ف حسب النوع (من تكوين التطبيق الفعلي: getLineTowers = التكوين المخصص أولاً ثم المدمج) — بشرط إثبات أن سجل البرج المطابق هو نفس هوية النقطة؛ غير ذلك علامة محايدة. لا استنتاج من تسمية KMZ.
const TYPE_META = { S: { n: 'تعليق', c: '#2b6cb0' }, T: { n: 'شد', c: '#2f9e44' }, R: { n: 'عبور', c: '#d62828' }, E: { n: 'نهائي', c: '#f2c200' }, K: { n: 'عبور أسفل الخط', c: '#ffffff' } }, NEUTRAL_C = '#a0aec0', DARK_EDGE = ['E', 'K'];
function is132(line) { try { const v = (typeof lineVoltageByName === 'function' ? lineVoltageByName(line) : null) || (typeof _configuredVoltage === 'function' ? _configuredVoltage(line) : 0); return Number(v) === 132; } catch (e) { return false; } }
function rowType(r) {   // {v132, code|null, why}
  if (S.cfgRef !== lineTowersCache) { S.typeMemo = new Map(); S.cfgRef = lineTowersCache; }   // تكوين الخطوط استُبدل (تحديث من الخادم): تُعاد حسابات الأنواع
  const k = String(r.id) + '|' + r.line + '|' + r.number, m = S.typeMemo.get(k); if (m) return m;
  let o;
  if (!is132(r.line)) o = { v132: false };
  else {
    let sn = null; try { sn = csIdentSnap(r.line, String(r.number), { mapOnly: true }); } catch (e) { sn = null; }
    if (!sn || sn.blocked || sn.tower_id == null || String(sn.tower_id) !== String(r.id)) o = { v132: true, code: null, why: 'تعذّر إثبات مطابقة سجل البرج لهوية النقطة' };
    else {
      let ent = null; try { ent = (getLineTowers(r.line) || []).find(t => String(t.num) === String(r.number)) || null; } catch (e) { ent = null; }
      let code = ent ? String(ent.type_code || '').trim().toUpperCase() : '';   // الرمز له الأولوية (K يغلب وصف «عبور أسفل الخط»)
      if (ent && !code) { try { code = (TYPE_TEXT_TO_CODE_132[String(ent.type || '').trim()] || ''); } catch (e) { code = ''; } }   // نص النوع من التكوين نفسه (لا من KMZ)
      o = TYPE_META[code] ? { v132: true, code } : { v132: true, code: null, why: ent ? 'نوع البرج في التكوين غير معروف' : 'لا سجل لهذا الرقم في التكوين' };
    }
  }
  S.typeMemo.set(k, o); return o;
}
function towerType(t) {
  if (t && t.rows.some(x => !is132(x.line))) return { v132: false };   // برج مشترك مع خط 400/غير 132: يبقى بلون الخط (ألوان 400 محفوظة)؛ نوع 132 يظهر في البطاقة
  const rs = (t ? t.rows : []).map(rowType).filter(x => x.v132); if (!rs.length) return { v132: false };
  const cs = new Set(rs.map(x => x.code || '?')); return cs.size === 1 && !cs.has('?') ? { v132: true, code: Array.from(cs)[0] } : { v132: true, code: null, why: (rs.find(x => !x.code) || {}).why || 'أنواع متعارضة بين خطوط البرج المشترك' };
}
function lineColor(line) { const k = lineKey(line); let i = S.colorIdx && S.colorIdx.get(k); if (i == null) { let h = 0; for (let j = 0; j < k.length; j++) h = (h * 31 + k.charCodeAt(j)) >>> 0; i = h; } return COLORS[i % COLORS.length]; }
function bgNote() { const n = el('tmBgNote'); if (!n) return; n.textContent = streetsOn() ? '🗺️ الشوارع ظاهرة بموافقتك: مزود البلاطات (OpenStreetMap) يرى المنطقة المعروضة.' : S.frameUser ? '⛔ الخلفية موقوفة: إطار الخريطة مشتق من موقعك (حتى لو أخفيت العلامة). اضغط «⤢» أو غيّر الاختيار للحصول على إطار مستقل، ثم فعّل الخلفية بنفسك إن رغبت.' : (S.bg ? '' : 'الخلفية مطفأة افتراضياً: لا طلبات خارجية.'); const c = el('tmBg'); if (c) { c.checked = S.bg && !S.frameUser; c.disabled = S.frameUser; } const o = el('tmOsm'); if (o) o.style.display = bgAllowed() ? '' : 'none'; }
function frameFromUser() { S.frameUser = true; S.bg = false; bgNote(); }   // يُستدعى قبل تحريك الإطار: لا طلب بلاطات بعد الآن
function frameIndependent() { if (S.frameUser) { S.frameUser = false; S.bg = false; bgNote(); } }   // إطار من الأبراج/المراجع: الخلفية تبقى مطفأة حتى يختارها المستخدم
function streetsOn() { return !!(S.streets && S.streets.gen === featSessionTag()); }   // N25-R37: موافقة «إظهار الشوارع حول موقعي» (للجلسة الحالية وللخريطة المفتوحة فقط)
function bgAllowed() { return navigator.onLine !== false && ((S.bg && !S.frameUser) || streetsOn()); }   // N25-R36: الخلفية بقرار صريح؛ R37: أو بموافقة الشوارع الصريحة   // N25-R36: الخلفية بقرار صريح وبإطار غير مشتق من الموقع فقط
function tileImg(z, x, y) {
  if (!bgAllowed()) return null;
  const k = z + '/' + x + '/' + y; let t = S.tiles.get(k);
  if (t) return t.ok ? t.img : null;
  const img = new Image(); t = { img, ok: false }; S.tiles.set(k, t);
  img.onload = () => { t.ok = true; requestDraw(); }; img.onerror = () => { t.err = true; };
  img.src = 'https://tile.openstreetmap.org/' + k + '.png';
  if (S.tiles.size > 260) { const first = S.tiles.keys().next().value; S.tiles.delete(first); }
  return null;
}
function draw() {
  const cv = el('tmCanvas'); if (!cv || !S.W) return;
  const ctx = cv.getContext('2d'), dpr = S.dpr || 1, W = S.W, H = S.H, z = S.view.z;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#e9eef3'; ctx.fillRect(0, 0, W, H);
  // background tiles (optional; needs internet — failure never blocks the towers)
  if (bgAllowed()) {
    const tz = Math.max(0, Math.min(19, Math.round(z))), sc = Math.pow(2, z - tz), cx = lonToX(S.view.lon, tz), cy = latToY(S.view.lat, tz), n = Math.pow(2, tz);
    const x0 = Math.floor((cx - W / 2 / sc) / TS), x1 = Math.floor((cx + W / 2 / sc) / TS), y0 = Math.floor((cy - H / 2 / sc) / TS), y1 = Math.floor((cy + H / 2 / sc) / TS);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 36) for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue; const img = tileImg(tz, ((tx % n) + n) % n, ty);
      if (img) ctx.drawImage(img, W / 2 + (tx * TS - cx) * sc, H / 2 + (ty * TS - cy) * sc, TS * sc + 0.5, TS * sc + 0.5);
    }
  } else { ctx.strokeStyle = '#d5dde5'; ctx.lineWidth = 1; for (let gx = 0; gx < W; gx += 80) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); } for (let gy = 0; gy < H; gy += 80) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); } }
  S.drawn = [];
  // towers (visible only), clustered below CLUSTER_Z
  const vis = []; const cxw = lonToX(S.view.lon, z), cyw = latToY(S.view.lat, z);
  for (let i = 0; i < S.towers.length; i++) { const t = S.towers[i], r = t.r, x = W / 2 + lonToX(r.lon, z) - cxw, y = H / 2 + latToY(r.lat, z) - cyw; if (x > -20 && x < W + 20 && y > -20 && y < H + 20) vis.push({ r, x, y }); }
  S.visCount = vis.length; { const o = el('tmOsm'); if (o) o.style.display = bgAllowed() ? '' : 'none'; }
  const cluster = z < CLUSTER_Z && vis.length > 60;
  if (cluster) {
    const cells = new Map();
    vis.forEach(v => { const k = Math.floor(v.x / CELL) + ',' + Math.floor(v.y / CELL); let c = cells.get(k); if (!c) cells.set(k, c = { n: 0, sx: 0, sy: 0, items: [] }); c.n++; c.sx += v.x; c.sy += v.y; c.items.push(v.r); });
    cells.forEach(c => {
      const x = c.sx / c.n, y = c.sy / c.n;
      if (c.n === 1) { const fl = dot(ctx, x, y, c.items[0]); S.drawn.push({ x, y, r: 9, kind: 't', row: c.items[0], fill: fl }); return; }
      const rad = Math.min(24, 11 + Math.log2(c.n) * 2.6);
      ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fillStyle = 'rgba(26,82,118,0.88)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '700 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(c.n), x, y + 0.5);
      S.drawn.push({ x, y, r: rad, kind: 'c', items: c.items });
    });
  } else vis.forEach(v => { const fl = dot(ctx, v.x, v.y, v.r); S.drawn.push({ x: v.x, y: v.y, r: 9, kind: 't', row: v.r, fill: fl }); });
  S.clusters = S.drawn.filter(d => d.kind === 'c').length; S.singles = S.drawn.filter(d => d.kind === 't').length;
  // N25-R37: رقم كل برج بجانب نقطته عند التكبير الميداني (بلا لمس)؛ التصادم يُحلّ بإسقاط الملصق المتأخر (يبقى برجه ظاهراً ويُلمس)
  S.labelCount = 0; S.labelTexts = [];
  if (z >= LABEL_Z && !cluster) {
    const boxes = []; ctx.font = '700 12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    S.drawn.filter(d => d.kind === 't').forEach(d => {
      const t = S.towerById.get(String(d.row.id)), txt = t ? t.rows.map(r => r.number).join(' / ') : String(d.row.number); const w = ctx.measureText(txt).width + 6;
      let lx = 0, by = 0, ok = false;   // أربعة مواضع مرشّحة حول النقطة: أول موضع داخل الإطار وبلا تصادم يُعتمد، وإلا يُسقَط الملصق (البرج نفسه يبقى ظاهراً ويُلمس)
      for (const [ox, oy] of [[9, -16], [9, 3], [-9 - w, -16], [-9 - w, 3]]) { lx = d.x + ox; by = d.y + oy; if (lx < 0 || lx + w > W || by < 0 || by + 14 > H) continue; if (boxes.some(b => lx < b.x + b.w && lx + w > b.x && by < b.y + 14 && by + 14 > b.y)) continue; ok = true; break; }
      if (!ok) return;
      boxes.push({ x: lx, y: by, w }); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.strokeText(txt, lx + 3, by + 7); ctx.fillStyle = '#1a202c'; ctx.fillText(txt, lx + 3, by + 7); S.labelCount++; S.labelTexts.push(txt);
    });
  }
  // GPS reference lines (display only): grey triangles — NOT towers, no record behind them
  refPoints(true).forEach(p => { const q = toScreen(p.lat, p.lon); if (q.x < -12 || q.x > W + 12 || q.y < -12 || q.y > H + 12) return; ctx.beginPath(); ctx.moveTo(q.x, q.y - 7); ctx.lineTo(q.x + 6.5, q.y + 5); ctx.lineTo(q.x - 6.5, q.y + 5); ctx.closePath(); ctx.fillStyle = 'rgba(90,90,90,0.85)'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke(); S.drawn.push({ x: q.x, y: q.y, r: 9, kind: 'r', ref: p }); });
  // pending (unconfirmed) captures of THIS account: hollow amber diamonds
  S.pend.forEach(p => { const q = toScreen(p.lat, p.lon); if (q.x < -20 || q.x > W + 20 || q.y < -20 || q.y > H + 20) return; ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(Math.PI / 4); ctx.fillStyle = 'rgba(246,193,62,0.35)'; ctx.fillRect(-6, -6, 12, 12); ctx.setLineDash([3, 2]); ctx.lineWidth = 2; ctx.strokeStyle = '#B7791F'; ctx.strokeRect(-6, -6, 12, 12); ctx.restore(); S.drawn.push({ x: q.x, y: q.y, r: 10, kind: 'p', row: p }); });
  // user position: independent blue dot + accuracy circle (memory only)
  if (S.user) {
    const q = toScreen(S.user.lat, S.user.lon);
    if (S.user.acc > 0) { const mpp = 156543.03392 * Math.cos(S.user.lat * Math.PI / 180) / Math.pow(2, z), rr = Math.min(3000, S.user.acc / mpp); if (rr > 8) { ctx.beginPath(); ctx.arc(q.x, q.y, rr, 0, 7); ctx.fillStyle = 'rgba(66,133,244,0.15)'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(66,133,244,0.6)'; ctx.stroke(); } }
    // N25-R38: نقطة المستخدم تتميّز عن علامات الأبراج الزرقاء بالشكل: حلقة خارجية داكنة منفصلة + مركز أبيض (الأبراج دوائر صماء صغيرة)
    ctx.beginPath(); ctx.arc(q.x, q.y, 14, 0, 7); ctx.lineWidth = 3; ctx.strokeStyle = '#0b2e66'; ctx.stroke();
    ctx.beginPath(); ctx.arc(q.x, q.y, 10, 0, 7); ctx.fillStyle = '#4285f4'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
    S.drawn.push({ x: q.x, y: q.y, r: 15, kind: 'u' });
  }
  if (S.hl) { const q = toScreen(S.hl.lat, S.hl.lon); ctx.beginPath(); ctx.arc(q.x, q.y, 13, 0, 7); ctx.lineWidth = 3; ctx.strokeStyle = '#111'; ctx.stroke(); }
  placePop();
  const b = el('tmFooter'); if (b) b.textContent = 'تكبير ' + z.toFixed(1) + ' · ظاهر ' + S.visCount + ' برج' + (cluster ? ' (مجمّعة)' : '');
}
function dot(ctx, x, y, r) {
  const tw = S.towerById.get(String(r.id)), tt = towerType(tw); if (!tt.v132 && tw) { const o = tw.rows.find(x => !is132(x.line)); if (o) r = o; }
  let fill, edge = '#fff', lw = 2;
  if (!tt.v132) fill = lineColor(r.line); else if (tt.code) { fill = TYPE_META[tt.code].c; if (DARK_EDGE.indexOf(tt.code) >= 0) { edge = '#1a202c'; lw = 2.5; } } else fill = NEUTRAL_C;
  ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = edge; ctx.stroke(); return fill;
}

function setView(lat, lon, z) { S.view.lat = Math.max(-80, Math.min(80, lat)); S.view.lon = lon; S.view.z = Math.max(MINZ, Math.min(MAXZ, z)); requestDraw(); }
function zoomAt(x, y, dz) {
  const g = toGeo(x, y), nz = Math.max(MINZ, Math.min(MAXZ, S.view.z + dz)); if (nz === S.view.z) return;
  const cx = lonToX(g.lon, nz) - (x - S.W / 2), cy = latToY(g.lat, nz) - (y - S.H / 2);
  S.view.z = nz; S.view.lon = xToLon(cx, nz); S.view.lat = yToLat(cy, nz); requestDraw();
}
function fitBounds(pts, pad) {
  if (!pts.length) return;
  let a = 90, b = -90, c = 180, d = -180; pts.forEach(p => { a = Math.min(a, p.lat); b = Math.max(b, p.lat); c = Math.min(c, p.lon); d = Math.max(d, p.lon); });
  const W = (S.W || 360) - 2 * (pad || 40), H = (S.H || 360) - 2 * (pad || 40); let z = MAXZ;
  for (; z > MINZ; z -= 0.25) { const w = lonToX(d, z) - lonToX(c, z), h = latToY(a, z) - latToY(b, z); if (w <= W && h <= H) break; }
  setView((a + b) / 2, (c + d) / 2, Math.min(z, 17));
}
function bindPointer(cv) {
  const ptrs = new Map(); let start = null, pinch = null;
  cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); if (ptrs.size === 1) start = { x: e.offsetX, y: e.offsetY, t: Date.now(), moved: false, v: Object.assign({}, S.view) }; else { start = null; const [p, q] = Array.from(ptrs.values()); pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), z: S.view.z }; } });
  cv.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return; const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (ptrs.size === 2 && pinch) { const [p, q] = Array.from(ptrs.values()), d = Math.hypot(p.x - q.x, p.y - q.y); if (d > 0 && pinch.d > 0) { const nz = pinch.z + Math.log2(d / pinch.d), mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2; zoomAt(mx, my, nz - S.view.z); } return; }
    if (ptrs.size === 1 && start) {
      const dx = e.offsetX - start.x, dy = e.offsetY - start.y; if (Math.hypot(dx, dy) > 8) start.moved = true;
      if (start.moved) { const z = S.view.z; S.view.lon = xToLon(lonToX(start.v.lon, z) - dx, z); S.view.lat = yToLat(latToY(start.v.lat, z) - dy, z); S.pop = S.pop ? S.pop : null; requestDraw(); }
    }
  });
  const up = e => { const had = ptrs.has(e.pointerId); ptrs.delete(e.pointerId); if (!had) return; if (ptrs.size < 2) pinch = null; if (start && !start.moved && Date.now() - start.t < 600 && e.type === 'pointerup') tap(e.offsetX, e.offsetY); if (!ptrs.size) start = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, -e.deltaY * 0.002); }, { passive: false });
  cv.addEventListener('dblclick', e => zoomAt(e.offsetX, e.offsetY, 1));
}
function tap(x, y) {
  let hit = null, best = 1e9;
  for (let i = S.drawn.length - 1; i >= 0; i--) { const d = S.drawn[i], dist = Math.hypot(d.x - x, d.y - y); if (dist <= d.r + 10 && dist < best) { best = dist; hit = d; } }
  if (!hit) { S.pop = null; S.hl = null; hidePop(); requestDraw(); return; }
  if (hit.kind === 'c') { const it = hit.items; if (S.view.z >= CLUSTER_Z - 0.5 || it.length < 2) { selectRow(it[0]); return; } fitBounds(it, 60); S.view.z = Math.min(MAXZ, Math.max(S.view.z, 0) + 0.0); return; }
  if (hit.kind === 'u') { showPop({ lat: S.user.lat, lon: S.user.lon }, '<b>📍 موقعك</b><br><span style="color:#4a5568">دقة ±' + (S.user.acc != null ? Math.round(S.user.acc) + ' م' : '—') + ' · للعرض فقط (غير محفوظ)</span>'); return; }
  if (hit.kind === 'r') { const p = hit.ref; showPop(p, '<b>📌 مرجع GPS: ' + esc(p.name) + '</b><br>نقطة ' + esc(p.label || p.seq) + '<br><span style="color:#4a5568;font-size:11px">للعرض فقط — ليست برجاً ولا سجلاً تشغيلياً</span>'); return; }
  if (hit.kind === 'p') { const p = hit.row; showPop(p, '<b>' + esc(p.line) + '</b><br>برج رقم ' + esc(p.number) + '<br><span style="color:#B7791F">⏳ موقع معلّق (غير مؤكَّد بالخادم)</span>'); return; }
  selectRow(hit.row);
}
function selectRow(r) {
  const t = S.towerById.get(String(r.id)), rows = t ? t.rows : [r]; S.hl = r;
  let h = '<b>' + rows.map(x => esc(x.line) + ' — برج رقم ' + esc(x.number)).join('<br>') + '</b>';
  if (rows.length > 1) h += '<br><span style="color:#744210;font-size:11px">🔗 برج مشترك: يخدم ' + rows.length + ' خطوط بالأرقام أعلاه (هوية واحدة)</span>';
  h += '<br><span style="color:#718096;font-size:11px">' + esc(SRC_AR[r.src] || '') + (r.acc != null ? ' · دقة ±' + Math.round(r.acc) + ' م' : '') + '</span>';
  if (S.user) h += '<br><span style="font-size:12px">📏 ' + fmtDist(haversine(S.user.lat, S.user.lon, r.lat, r.lon)) + ' <span style="color:#718096">مسافة مباشرة (خط مستقيم) — ليست طريقاً سالكاً</span></span>';
  rows.forEach(x => { const ty = rowType(x); if (ty.v132) h += '<div style="font-size:12px;margin-top:4px">🏷️ ' + esc(x.line) + ' — نوع البرج: ' + (ty.code ? '<b>' + TYPE_META[ty.code].n + '</b> (' + ty.code + ')' : '<b style="color:#744210">غير مؤكد</b> <span style="color:#718096">(' + esc(ty.why || '') + ')</span>') + '</div>'; });
  rows.forEach((x, i) => { h += '<div><button class="btn btn-primary btn-sm tmAct" data-act="td" data-i="' + i + '" style="margin-top:6px;width:100%">🗼 تفاصيل البرج' + (rows.length > 1 ? ' — ' + esc(x.line) + ' ' + esc(x.number) : '') + '</button></div>'; });
  h += '<button class="btn btn-secondary btn-sm tmAct" data-act="dir" style="margin-top:6px;width:100%">🧭 الاتجاهات إلى البرج</button>';
  h += '<div style="color:#718096;font-size:10px;margin-top:4px">يفتح تطبيق الخرائط بوجهة هذا البرج فقط (لا يُرسل موقعك). المدخل والطريق غير موثّقين هنا.</div>';
  showPop(r, h, rows); requestDraw();
}
function dirUrl(r) {   // N25-R37: وجهة فقط (إحداثيات البرج)؛ لا أصل ولا موقع المستخدم
  const q = Number(r.lat).toFixed(6) + ',' + Number(r.lon).toFixed(6), ios = /iP(hone|ad|od)/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios ? 'https://maps.apple.com/?daddr=' + q + '&dirflg=d' : 'https://www.google.com/maps/dir/?api=1&destination=' + q + '&travelmode=driving';
}
async function openRowDetail(r) {   // بالهوية الدائمة: tower_id المتوقع يُحمل حتى عرض الحالة (R37a)
  const tok = S.locTok, gen = S.gen, sess = featSessionTag(), stale = () => !S.open || tok !== S.locTok || gen !== featSessionTag();
  const blockPop = (why, retry) => showPop(r, '<b>' + esc(r.line) + ' — برج ' + esc(r.number) + '</b><br><span style="color:#c0392b;font-size:12px">⚠️ ' + why + ' — لم يُفتح شيء.</span>' + (retry ? '<button class="btn btn-primary btn-sm tmAct" data-act="retry" style="margin-top:6px;width:100%">🔄 إعادة المحاولة</button>' : ''), [r]);
  const online = navigator.onLine !== false; let fresh = false;
  try { if (online && typeof csLineIdentLoad === 'function') fresh = (await csLineIdentLoad(r.line)) === true; } catch (e) { fresh = false; }
  if (stale()) return;
  if (online && !fresh) { blockPop('تعذّر تحديث دليل ترقيم الخط من الخادم، فلا يُعتمد على دليل محفوظ قديم لفتح التفاصيل الحيّة', true); return; }
  let sn = null; try { sn = csIdentSnap(r.line, String(r.number), { mapOnly: true }); } catch (e) {}
  if (!sn || sn.blocked || sn.tower_id !== String(r.id)) { blockPop(online ? 'هذا الرقم لم يعد يعود لنفس البرج (ترقيم الخط تغيّر) — حدّث الخريطة ثم اختر البرج من جديد' : 'تعذّر التأكد أن هذا الرقم ما زال لنفس البرج (لا اتصال ولا دليل ترقيم محلي مطابق)', !online ? true : false); return; }
  try {
    window.tmapLeave(); await featRun(['lpg'], () => 1, 'tmap-td');
    if (featSessionTag() !== sess) { try { showToast('تبدّلت الجلسة أثناء التحميل — أُلغي فتح التفاصيل', 'error'); } catch (e) {} return; }   // لا طلب قديم باسم الجلسة الجديدة
    await openTowerDetail(r.line, String(r.number), String(r.id));
  } catch (e) {}
}
function showPop(pos, html, rows) { S.pop = { lat: pos.lat, lon: pos.lon, html, rows: rows || [] }; placePop(); }
function hidePop() { const p = el('tmPop'); if (p) p.style.display = 'none'; }
function placePop() {
  const p = el('tmPop'); if (!p) return; if (!S.pop) { p.style.display = 'none'; return; }
  const q = toScreen(S.pop.lat, S.pop.lon); p.innerHTML = '<div style="display:flex;gap:8px;align-items:flex-start"><div style="flex:1">' + S.pop.html + '</div><button id="tmPopX" style="border:none;background:none;font-size:16px;cursor:pointer;color:#718096">✕</button></div>';
  p.style.display = 'block'; const pw = Math.min(268, S.W - 16); p.style.width = pw + 'px';
  p.style.left = Math.max(8, Math.min(S.W - pw - 8, q.x - pw / 2)) + 'px'; p.style.top = Math.max(8, q.y - (p.offsetHeight || 70) - 16) + 'px';
  const x = el('tmPopX'); if (x) x.onclick = () => { S.pop = null; S.hl = null; hidePop(); requestDraw(); };
  p.querySelectorAll('.tmAct').forEach(b => b.onclick = ev => { ev.stopPropagation(); const pr = S.pop; if (!pr || !pr.rows.length) return;
    if (b.dataset.act === 'dir') { const r0 = pr.rows[0]; try { window.open(dirUrl(r0), '_blank', 'noopener'); } catch (e) {} }
    else if (b.dataset.act === 'retry') { openRowDetail(pr.rows[0]); }
    else if (b.dataset.act === 'td') { const r1 = pr.rows[Number(b.dataset.i)]; if (r1) openRowDetail(r1); } });
}

// ---------- data ----------
function selectedLines() { return S.mode === 'all' ? null : (S.mode === 'single' ? S.sel.slice(0, 1) : S.sel.slice()); }
function rowOf(a) { return { id: a[0], line: a[1], number: String(a[2]), lat: Number(a[3]), lon: Number(a[4]), acc: a[5] == null ? null : Number(a[5]), at: a[6], src: a[7] }; }
async function loadData() {
  const my = ++S.seq, uid = uidNow(), lines = selectedLines(); S.uid = uid;
  if (lines && !lines.length) { S.rows = []; deriveTowers(); S.pend = []; S.info = { source: null, at: null, missing: [], total: 0, withLoc: 0, empty: true }; paint(); return; }
  S.loading = true; paint();
  const cache = await cacheAll(uid);
  let byLine = new Map(), info = { source: 'cache', at: null, missing: [], total: 0, withLoc: 0 };
  const wanted = lines ? lines.map(l => ({ name: l, key: lineKey(l) })) : null;
  let fresh = null;
  if (navigator.onLine !== false && typeof CS_AUTH !== 'undefined' && CS_AUTH.token && typeof csCall === 'function') {
    try { const r = await csCall('app_tower_locations', { p_line_names: lines }, { timeout: 40000 }); if (r && r.ok === true && r.complete === true && Array.isArray(r.rows)) fresh = r; } catch (e) { fresh = null; }   // N25-R36: ردّ ناجح وكامل فقط يستبدل النطاق
  }
  if (my !== S.seq || uid !== uidNow()) return;     // اختيار أحدث/حساب مختلف: ردّ قديم يُهمَل
  if (fresh) {
    const now = Date.now(), groups = new Map(), sum = new Map();
    (fresh.lines || []).forEach(l => { groups.set(lineKey(l.line_name), []); sum.set(lineKey(l.line_name), l); });
    fresh.rows.forEach(a => { const r = rowOf(a), k = lineKey(r.line); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    // N25-R36: الردّ الكامل يستبدل نطاقه: خط مطلوب غاب عن الردّ يُفرَّغ (لا تبقى نقاطه القديمة)، وفي «كل الخطوط» تُحذف خطوط الكاش الغائبة
    if (wanted) wanted.forEach(w => { if (!groups.has(w.key)) groups.set(w.key, []); });
    const puts = []; groups.forEach((rows, k) => { const l = sum.get(k), w = wanted && wanted.find(x => x.key === k); puts.push({ key: k, line: rows.length ? rows[0].line : (l ? l.line_name : (w ? w.name : k)), at: now, rows, total: l ? l.total : 0, rev: l ? l.topology_rev : null }); });
    const gone = wanted ? [] : Array.from(cache.keys()).filter(k => !groups.has(k));
    cachePut(uid, puts).catch(() => {}); if (gone.length) { cacheDel(uid, gone).catch(() => {}); gone.forEach(k => cache.delete(k)); }
    try { tlocConfClear(c => !lines || lines.some(l => sameLine(l, c.line))); } catch (e) {}   // النسخ المؤكَّدة محلياً لهذا النطاق لا تُبقي برجاً غاب عن الخادم
    puts.forEach(p => cache.set(p.key, Object.assign({ uid }, p)));
    info = { source: 'server', at: now, missing: [], total: 0, withLoc: 0 };
  }
  const useKeys = wanted ? wanted.map(w => w.key) : Array.from(cache.keys());
  let oldest = null;
  useKeys.forEach(k => { const ent = cache.get(k) || (wanted && !fresh ? Array.from(cache.values()).find(v => sameLine(v.line, wanted.find(w => w.key === k).name)) : null); if (!ent) { info.missing.push(wanted ? wanted.find(w => w.key === k).name : k); return; } byLine.set(k, ent); if (ent.at && (oldest == null || ent.at < oldest)) oldest = ent.at; });
  if (!fresh) { info.at = oldest; info.source = 'cache'; }
  const rows = []; let total = 0, withLoc = 0; const seen = new Set();
  byLine.forEach(ent => { (ent.rows || []).forEach(r => { rows.push(Object.assign({}, r)); seen.add(String(r.id)); }); withLoc += (ent.rows || []).length; if (ent.total != null) total += ent.total; });
  // last locations confirmed by the server for THIS account (shown even if the cached/fresh list predates them)
  if (!fresh) try {   // الأوفلاين فقط: آخر ما أكّده الخادم لهذا الحساب؛ بعد ردّ كامل ناجح لا يُضاف شيء من النسخ المحلية
    const conf = tlocConfMine(); Object.keys(conf).forEach(id => { const c = conf[id]; if (!c || !(lines === null || lines.some(l => sameLine(l, c.line)))) return;
      const ex = rows.findIndex(r => String(r.id) === id); const rec = { id, line: c.line, number: String(c.number), lat: Number(c.lat), lon: Number(c.lon), acc: c.acc == null ? null : Number(c.acc), at: c.at, src: c.src || 'field_capture' };
      if (ex < 0) { rows.push(rec); withLoc++; } else if (String(c.at) > String(rows[ex].at)) rows[ex] = rec; });
  } catch (e) {}
  info.total = total; info.withLoc = rows.length;
  S.colorIdx = new Map(); Array.from(new Set(rows.map(r => lineKey(r.line)))).sort().forEach((k, i) => S.colorIdx.set(k, i));
  S.rows = rows; deriveTowers(); S.typeMemo = new Map(); S.info = info; S.loading = false;
  try { const g0 = S.gen, t0 = S.locTok; Array.from(new Set(rows.map(r => r.line))).filter(is132).forEach(l => { if (navigator.onLine !== false && typeof csLineIdentLoad === 'function') Promise.resolve(csLineIdentLoad(l)).then(() => { if (S.open && g0 === S.gen && t0 === S.locTok) { S.typeMemo = new Map(); requestDraw(); paintLegend(); } }).catch(() => {}); }); } catch (e) {}
  pendingOverlay();
  const sig = S.mode + '|' + (lines ? lines.join('\u0001') : '*');
  if (S.fitSig !== sig && rows.length) { S.fitSig = sig; if (S.W) { fitBounds(rows, 40); frameIndependent(); } }
  S.pop = null; S.hl = null; paint(); computeNearest();
}
function deriveTowers() {   // N25-R37: برج مشترك = صفوف بنفس tower_id (خطوط/أرقام مختلفة) → نقطة واحدة وبطاقة واحدة
  const m = new Map(); S.rows.forEach(r => { const k = String(r.id); let t = m.get(k); if (!t) m.set(k, t = { id: k, rows: [], r }); t.rows.push(r); }); S.towers = Array.from(m.values()); S.towerById = m;
}
function pendingOverlay() {
  S.pend = []; try { const lines = selectedLines(); tlocMine().items.forEach(e => { if (!e || e.rejected && false) return; if (lines && !lines.some(l => sameLine(l, e.line))) return; S.pend.push({ line: e.line, number: e.number, lat: Number(e.lat), lon: Number(e.lon), rejected: !!e.rejected }); }); } catch (e) {}
}

// ---------- nearest towers (straight-line distance) ----------
function computeNearest() {
  if (!S.user) { S.nearest = []; renderNearest(); return; }
  const u = S.user, list = S.towers.map(t => ({ r: t.r, t, d: haversine(u.lat, u.lon, t.r.lat, t.r.lon) }));
  list.sort((a, b) => a.d - b.d); S.nearest = list.slice(0, 10); renderNearest();
}
function renderNearest() {
  const box = el('tmNearest'); if (!box) return;
  if (!S.user) { box.innerHTML = '<div style="font-size:12px;color:#718096">فعّل «📍 موقعي» لترى أقرب الأبراج من الخطوط المختارة.</div>'; return; }
  if (!S.rows.length) { box.innerHTML = '<div style="font-size:12px;color:#718096">' + (S.info.empty || (S.mode !== 'all' && !S.sel.length) ? 'اختر خطاً أو أكثر لعرض أقرب الأبراج.' : 'لا توجد إحداثيات للخطوط المختارة بعد — هذه الخطوط تنتظر إحداثياتها (تُسجَّل من «تفاصيل البرج» في الميدان)، فلا أقرب برج لها.') + '</div>'; return; }
  let h = '<div style="font-size:12px;color:#4a5568;margin-bottom:6px">أقرب الأبراج من موقعك — المسافة المباشرة (خط مستقيم) وليست مسافة الطريق:</div>';
  S.nearest.forEach((x, i) => { h += '<div class="tm-near" data-i="' + i + '" style="display:flex;justify-content:space-between;gap:8px;padding:8px;border-bottom:1px solid #edf2f7;cursor:pointer;font-size:13px"><span>' + (i + 1) + '. ' + esc(x.r.line) + ' — برج ' + esc(x.r.number) + (x.t && x.t.rows.length > 1 ? '<br><span style="font-size:11px;color:#744210">🔗 مشترك أيضاً: ' + x.t.rows.filter(q => q !== x.r).map(q => esc(q.line) + ' — ' + esc(q.number)).join('، ') + '</span>' : '') + '</span><b style="white-space:nowrap">' + fmtDist(x.d) + '</b></div>'; });
  box.innerHTML = h;
  box.querySelectorAll('.tm-near').forEach(n => n.onclick = () => { const x = S.nearest[Number(n.dataset.i)]; if (!x) return; setView(x.r.lat, x.r.lon, Math.max(S.view.z, 15)); selectRow(x.r); });
}

// ---------- my location (explicit, one-shot, memory only) ----------
const GEO_ERR = { 0: 'الجهاز/المتصفح لا يدعم تحديد الموقع', 1: 'رُفض إذن الموقع — عرض الأبراج يعمل بدونه. يمكنك السماح من إعدادات الموقع للمتصفح/التطبيق ثم المحاولة', 2: 'تعذّر تحديد موقعك الآن (الإشارة غير متاحة)', 3: 'انتهت مهلة تحديد الموقع — حاول من مكان مكشوف' };
function geo(opts) { return new Promise((res, rej) => { if (!('geolocation' in navigator) || !navigator.geolocation) return rej({ code: 0 }); navigator.geolocation.getCurrentPosition(res, rej, opts); }); }
async function locateMe() {
  const tok = S.locTok, gen = S.gen;   // N25-R36b: صلاحية المحاولة تُلتقط عند الدخول قبل أي await؛ تُصفَّر (locTok++) عند إغلاق الخريطة/إعادة فتحها، وتُفحص gen عند تبدّل الجلسة
  const stale = () => !S.open || tok !== S.locTok || gen !== S.gen || S.gen !== featSessionTag();
  const box = el('tmLocMsg'); if (!box) return;
  if (!('geolocation' in navigator)) { S.locMsg = GEO_ERR[0]; paintLoc(); return; }
  let st = ''; try { if (navigator.permissions && navigator.permissions.query) st = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch (e) {}
  if (stale()) return;   // الرد تأخر حتى أُغلقت الخريطة/تبدّلت الجلسة: لا واجهة ولا GPS
  if (st === 'denied') { S.locMsg = GEO_ERR[1]; paintLoc(); return; }
  S.locMsg = 'locating'; paintLoc();
  try {
    const p = await geo({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    if (stale()) return;
    S.user = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy != null ? p.coords.accuracy : null, ts: p.timestamp }; S.locMsg = 'ok';
    if (!S.rows.length) { frameFromUser(); setView(S.user.lat, S.user.lon, 13); } else if (!inView(S.user)) { frameFromUser(); fitBounds(S.rows.concat([S.user]), 50); }
    paintLoc(); computeNearest(); requestDraw();
  } catch (e) { if (stale()) return; S.user = null; S.locMsg = GEO_ERR[e && e.code != null ? e.code : 2] || GEO_ERR[2]; paintLoc(); computeNearest(); requestDraw(); }
}
function inView(p) { const q = toScreen(p.lat, p.lon); return q.x > 0 && q.x < S.W && q.y > 0 && q.y < S.H; }
function streetsRevoke() { S.streets = null; S.streetsAsk = false; S.tiles = new Map(); }
function paintStreets() {
  const b = el('tmStreets'); if (!b) return;
  if (streetsOn()) { b.innerHTML = '<div style="font-size:12px;color:#2f855a">🗺️ الشوارع ظاهرة بموافقتك (OpenStreetMap يرى المنطقة المعروضة) — <a href="javascript:void(0)" id="tmStreetsOff">إيقاف الشوارع</a></div>'; el('tmStreetsOff').onclick = () => { streetsRevoke(); bgNote(); paintStreets(); requestDraw(); }; return; }
  if (!S.user) { b.innerHTML = ''; return; }
  if (!S.streetsAsk) { b.innerHTML = '<button class="btn btn-secondary btn-sm" id="tmStreetsAsk">🗺️ إظهار الشوارع حول موقعي</button>'; el('tmStreetsAsk').onclick = () => { S.streetsAsk = true; paintStreets(); }; return; }
  b.innerHTML = '<div style="padding:10px;border:1px solid #F6C23E;border-radius:10px;background:#FFFAF0;font-size:13px">لعرض الشوارع تُطلب صور الخريطة من خادم <b>OpenStreetMap</b> (طرف خارجي): سيرى ذلك الخادم <b>المنطقة المعروضة حول موقعك</b> (وعنوان اتصال الجهاز). لا يُرسل إليه موقعك الدقيق ولا بيانات الأبراج، ولا يُرسل شيء لخادم التطبيق. تنتهي الموافقة بإغلاق الخريطة أو بتبدّل الحساب. بدون الموافقة تعمل الخريطة والأقرب كاملة بلا خلفية.<div style="margin-top:8px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" id="tmStreetsYes">أوافق — أظهر الشوارع</button><button class="btn btn-secondary btn-sm" id="tmStreetsNo">لا، بدون شوارع</button></div></div>';
  el('tmStreetsNo').onclick = () => { S.streetsAsk = false; paintStreets(); };
  el('tmStreetsYes').onclick = () => { if (!S.user) { S.streetsAsk = false; paintStreets(); return; } S.streets = { gen: featSessionTag() }; S.streetsAsk = false; frameFromUser(); setView(S.user.lat, S.user.lon, Math.max(S.view.z, 15)); bgNote(); paintStreets(); requestDraw(); };
}
function paintLoc() {
  const box = el('tmLocMsg'), btn = el('tmLocBtn'); if (!box) return;
  const m = S.locMsg;
  if (m === 'locating') box.innerHTML = '<span style="color:#4a5568">⏳ جاري تحديد موقعك… (اسمح للمتصفح عند السؤال)</span>';
  else if (m === 'ok' && S.user) box.innerHTML = '<span style="color:#1e8449">✅ موقعك ظاهر على الخريطة (دقة ±' + (S.user.acc != null ? Math.round(S.user.acc) + ' م' : '—') + ') — للعرض فقط: لا يُحفظ ولا يُرسل</span> <a href="javascript:void(0)" id="tmLocOff" style="margin-right:8px">إخفاء</a>';
  else if (m) box.innerHTML = '<span style="color:#c0392b">⚠️ ' + esc(m) + '</span>'; else box.innerHTML = '';
  if (btn) btn.textContent = S.user ? '📍 تحديث موقعي' : '📍 موقعي';
  const off = el('tmLocOff'); if (off) off.onclick = () => { S.user = null; S.locMsg = ''; S.streetsAsk = false; paintLoc(); computeNearest(); requestDraw(); };
  paintStreets();
}

// ---------- GPS reference lines (display only; token-checked server read; per-account device copy) ----------
const REF_SCOPE = { outside_team: 'خارج تبعية الفريق حالياً', team_not_started: 'تابع للفريق — لم يدخل العمل بعد' };
function refPoints(full) {
  const d = S.ref.data; if (!d) return []; const out = [];
  d.forEach(l => { if (!S.ref.on[l.ref_key]) return; (l.points || []).forEach(a => out.push({ ref_key: l.ref_key, name: l.name, seq: a[0], label: a[1], lat: Number(a[2]), lon: Number(a[3]) })); });
  return out;
}
async function refLoad() {
  const my = ++S.refSeq || (S.refSeq = 1), uid = uidNow(); S.ref.err = '';
  let fresh = null;
  if (navigator.onLine !== false && typeof CS_AUTH !== 'undefined' && CS_AUTH.token && typeof csCall === 'function') {
    try { const r = await csCall('app_gps_reference_points', {}, { timeout: 30000 }); if (r && r.ok === true && r.complete === true && Array.isArray(r.lines)) fresh = r; else if (r && r.ok === false) S.ref.err = r.code || 'error'; } catch (e) { fresh = null; }
  }
  if (S.refSeq !== my || uid !== uidNow()) return;
  if (fresh) { S.ref.data = fresh.lines; S.ref.at = Date.now(); S.ref.src = 'server';
    const db = await idb(); if (db && uid) { try { db.transaction('lines', 'readwrite').objectStore('lines').put({ k: uid + '|__ref__', uid, key: '__ref__', data: fresh.lines, at: S.ref.at }); } catch (e) {} } }
  else { const c = await refCacheGet(uid); if (S.refSeq !== my || uid !== uidNow()) return; if (c && c.data) { S.ref.data = c.data; S.ref.at = c.at; S.ref.src = 'cache'; } else { S.ref.data = S.ref.data || null; S.ref.src = null; } }
  // خط مرجعي غاب عن الردّ الكامل لا يبقى مفعّلاً
  if (S.ref.data) Object.keys(S.ref.on).forEach(k => { if (!S.ref.data.some(l => l.ref_key === k)) delete S.ref.on[k]; });
  refPaint();
}
function refPaint() {
  const box = el('tmRefList'); if (!box) return; const d = S.ref.data;
  if (!d || !d.length) { box.innerHTML = '<span style="color:#718096">' + (S.ref.err ? 'تعذّر تحميل المراجع (' + esc(S.ref.err) + ')' : 'لا مراجع GPS متاحة حالياً' + (navigator.onLine === false ? ' (لا اتصال ولا نسخة محفوظة)' : '')) + '</span>'; requestDraw(); return; }
  box.innerHTML = '<div style="color:#' + (S.ref.src === 'server' ? '276749' : '7B341E') + ';font-size:11px;margin-bottom:4px">' + (S.ref.src === 'server' ? '⚡ من الخادم الآن' : '📴 نسخة محفوظة على الجهاز (غير محدّثة)') + (S.ref.at ? ' — ' + fmtTime(S.ref.at) : '') + '</div>' +
    d.map(l => '<label style="display:flex;align-items:center;gap:8px;padding:4px 0"><input type="checkbox" class="tmRefChk" value="' + esc(l.ref_key) + '"' + (S.ref.on[l.ref_key] ? ' checked' : '') + '> <span style="flex:1">' + esc(l.name) + ' <small style="color:#718096">(' + (l.points || []).length + ' نقطة · ' + esc(REF_SCOPE[l.team_scope] || '') + ')</small></span></label>').join('');
  box.querySelectorAll('.tmRefChk').forEach(c => c.onchange = () => { S.ref.on[c.value] = c.checked; requestDraw(); });
  requestDraw();
}

// ---------- page ----------
function paint() {
  const st = el('tmStatus'); if (!st) return;
  let h = '';
  if (S.loading) h = '⏳ جاري تحميل مواقع الأبراج…';
  else if (S.info.empty) h = 'اختر الخط/الخطوط لعرض أبراجها.';
  else {
    const i = S.info;
    if (i.source === 'server') h = '⚡ من الخادم الآن (' + fmtTime(i.at) + ')';
    else h = '📴 نسخة محفوظة على الجهاز (غير محدّثة من الخادم)' + (i.at ? ' — آخر تحديث ' + fmtTime(i.at) : '') + ' — قد تتضمّن أبراجاً أُرشفت أو نقاطاً تغيّرت';
    h += ' · <b>' + S.rows.length + '</b> برج بموقع' + (i.total ? ' من ' + i.total : '');
    if (i.missing.length) h += '<br><span style="color:#c0392b">⚠️ لا بيانات محلية لـ: ' + esc(i.missing.slice(0, 4).join('، ')) + (i.missing.length > 4 ? '…' : '') + ' — اتصل بالإنترنت لتحميلها</span>';
    else if (!S.rows.length) h += '<br><span style="color:#7B341E">⏳ الخط ينتظر إحداثياته: لا توجد أبراج بموقع محفوظ لهذا الاختيار بعد (تُسجَّل من «تفاصيل البرج» في الميدان). لا تُخمَّن إحداثيات.</span>';
    if (S.pend.length) h += '<br><span style="color:#B7791F">◇ ' + S.pend.length + ' موقع معلّق (غير مؤكَّد) لحسابك يظهر بشكل معيّن</span>';
  }
  st.innerHTML = h;
  paintLegend();
  requestDraw();
}
function paintLegend() {
  const lg = el('tmLegend'); if (!lg) return;
  const all = Array.from(new Set(S.rows.map(r => r.line))), ls = all.filter(l => !is132(l)).slice(0, 8), has132 = all.some(is132);
  let h = all.length > 1 ? ls.map(l => '<span style="display:inline-flex;align-items:center;gap:4px;margin-left:10px"><i style="width:10px;height:10px;border-radius:50%;background:' + lineColor(l) + ';display:inline-block"></i>' + esc(l) + '</span>').join('') : '';
  if (has132) h += '<div id="tmTypeKey" style="margin-top:4px"><b>مفتاح أنواع أبراج 132 ك.ف:</b> ' + Object.keys(TYPE_META).map(c => '<span style="display:inline-flex;align-items:center;gap:3px;margin-left:8px"><i style="width:11px;height:11px;border-radius:50%;background:' + TYPE_META[c].c + ';border:' + (DARK_EDGE.indexOf(c) >= 0 ? '2px solid #1a202c' : '1px solid #fff;box-shadow:0 0 0 1px #cbd5e0') + ';display:inline-block"></i>' + TYPE_META[c].n + '</span>').join('') + '<span style="display:inline-flex;align-items:center;gap:3px;margin-left:8px"><i style="width:11px;height:11px;border-radius:50%;background:' + NEUTRAL_C + ';border:1px solid #fff;box-shadow:0 0 0 1px #cbd5e0;display:inline-block"></i>غير مؤكد</span></div>';
  lg.innerHTML = h;
}
function buildSelectors() {
  const names = (typeof lineCatalogNames === 'function') ? lineCatalogNames() : [];
  const sel = el('tmSingle'); if (sel) { fillLineSelect(sel, { grouped: true, placeholder: '-- اختر الخط --', names }); sel.value = S.sel[0] && names.indexOf(S.sel[0]) >= 0 ? S.sel[0] : ''; }
  const list = el('tmMultiList'); if (list) {
    const q = (el('tmMultiQ') && el('tmMultiQ').value || '').trim();
    list.innerHTML = names.filter(n => !q || n.indexOf(q) >= 0).map(n => { const v = typeof lineVoltageForOrder === 'function' ? lineVoltageForOrder(n) : 0; return '<label style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid #edf2f7;font-size:13px"><input type="checkbox" class="tmChk" value="' + esc(n) + '"' + (S.sel.indexOf(n) >= 0 ? ' checked' : '') + '> <span style="flex:1">' + esc(n) + '</span><small style="color:' + (v === 400 ? '#c0392b' : '#1a5276') + '">' + (v || '') + '</small></label>'; }).join('') || '<div style="padding:8px;color:#718096">لا نتائج</div>';
    list.querySelectorAll('.tmChk').forEach(c => c.onchange = () => { const set = new Set(S.sel); c.checked ? set.add(c.value) : set.delete(c.value); S.sel = names.filter(n => set.has(n)); updModeUi(); schedLoad(); });
  }
}
let _lt = 0; function schedLoad() { clearTimeout(_lt); _lt = setTimeout(loadData, 250); }
function updModeUi() {
  ['single', 'multi', 'all'].forEach(m => { const b = el('tmMode_' + m); if (b) b.className = 'btn btn-sm ' + (S.mode === m ? 'btn-primary' : 'btn-secondary'); });
  const a = el('tmSingleBox'), b = el('tmMultiBox'), c = el('tmAllBox'); if (a) a.style.display = S.mode === 'single' ? '' : 'none'; if (b) b.style.display = S.mode === 'multi' ? '' : 'none'; if (c) c.style.display = S.mode === 'all' ? '' : 'none';
  const cnt = el('tmMultiCount'); if (cnt) cnt.textContent = 'المحدد: ' + S.sel.length;
}
function setMode(m) { if (S.mode === m) return; S.mode = m; if (m === 'single') S.sel = S.sel.slice(0, 1); updModeUi(); buildSelectors(); loadData(); }
function build(root) {
  root.innerHTML = '<div class="page-title" style="margin-bottom:8px">🗺️ خريطة الأبراج</div>' +
    '<div class="form-card" style="margin-bottom:10px;padding:12px">' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"><button id="tmMode_single" class="btn btn-sm">خط واحد</button><button id="tmMode_multi" class="btn btn-sm">عدة خطوط</button><button id="tmMode_all" class="btn btn-sm">كل الخطوط</button></div>' +
    '<div id="tmSingleBox"><select id="tmSingle" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #ccc;font-family:inherit;font-size:14px"></select></div>' +
    '<div id="tmMultiBox" style="display:none"><input id="tmMultiQ" placeholder="بحث عن خط…" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #ccc;font-family:inherit;margin-bottom:6px"><div id="tmMultiList" style="max-height:200px;overflow:auto;border:1px solid #edf2f7;border-radius:8px;padding:4px"></div><div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12px"><span id="tmMultiCount"></span><a href="javascript:void(0)" id="tmMultiClear">مسح الاختيار</a></div></div>' +
    '<div id="tmAllBox" style="display:none;font-size:13px;color:#4a5568">تُعرض أبراج كل الخطوط (تجميع تلقائي للعلامات للحفاظ على سرعة الواجهة).</div>' +
    '<label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:#4a5568"><input type="checkbox" id="tmBg"> خلفية الخريطة (اختيارية: تطلب بلاطات من خادم خارجي ويرى ذلك الخادم إطار الخريطة؛ لا تعمل ما دام الإطار مشتقاً من موقعك)</label><div id="tmBgNote" style="font-size:11px;color:#7B341E;margin-top:4px"></div>' +
    '<div id="tmRefBox" style="margin-top:10px;border-top:1px solid #edf2f7;padding-top:8px"><div style="font-size:12px;font-weight:700;color:#4a5568;margin-bottom:4px">📌 مراجع GPS (للعرض فقط — ليست أبراج تشغيل ولا سجلات)</div><div id="tmRefList" style="font-size:12px"></div></div></div>' +
    '<div id="tmStatus" style="font-size:12px;color:#4a5568;margin-bottom:6px"></div><div id="tmLegend" style="font-size:11px;margin-bottom:6px"></div>' +
    '<div id="tmWrap" style="position:relative;height:58vh;min-height:340px;border-radius:12px;overflow:hidden;border:1px solid #cbd5e0;direction:ltr;background:#e9eef3"><canvas id="tmCanvas" style="display:block;position:absolute;inset:0"></canvas>' +
    '<div style="position:absolute;top:8px;left:8px;display:flex;flex-direction:column;gap:6px"><button id="tmZin" class="btn btn-secondary btn-sm" style="min-width:38px">＋</button><button id="tmZout" class="btn btn-secondary btn-sm" style="min-width:38px">－</button><button id="tmFit" class="btn btn-secondary btn-sm" title="ملاءمة">⤢</button></div>' +
    '<button id="tmLocBtn" class="btn btn-primary btn-sm" style="position:absolute;top:8px;right:8px">📍 موقعي</button>' +
    '<div id="tmPop" style="display:none;position:absolute;background:#fff;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.3);padding:8px 10px;font-size:13px;direction:rtl;z-index:5"></div>' +
    '<div id="tmFooter" style="position:absolute;bottom:2px;left:6px;font-size:10px;color:#555;background:rgba(255,255,255,.75);padding:1px 5px;border-radius:4px"></div><div style="position:absolute;bottom:2px;right:6px;font-size:10px;color:#555;background:rgba(255,255,255,.75);padding:1px 5px;border-radius:4px"><span id="tmOsm" style="display:none">© OpenStreetMap</span></div></div>' +
    '<div id="tmLocConsent" style="display:none;margin-top:8px;padding:10px;border:1px solid #F6C23E;border-radius:10px;background:#FFFAF0;font-size:13px">يُستعمل موقعك لعرض مكانك وأقرب الأبراج على هذا الجهاز فقط — <b>لا يُخزَّن ولا يُرسل</b>، وبلا تتبّع بالخلفية. سيطلب المتصفح إذنك الآن.<div style="margin-top:8px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" id="tmLocGo">متابعة</button><button class="btn btn-secondary btn-sm" id="tmLocNo">إلغاء</button></div></div>' +
    '<div id="tmLocMsg" style="margin-top:8px;font-size:12px"></div><div id="tmStreets" style="margin-top:8px"></div><div class="form-card" style="margin-top:10px;padding:10px"><div id="tmNearest"></div></div>';
  el('tmMode_single').onclick = () => setMode('single'); el('tmMode_multi').onclick = () => setMode('multi'); el('tmMode_all').onclick = () => setMode('all');
  el('tmSingle').onchange = () => { S.sel = el('tmSingle').value ? [el('tmSingle').value] : []; loadData(); };
  el('tmMultiQ').oninput = () => buildSelectors(); el('tmMultiClear').onclick = () => { S.sel = []; buildSelectors(); updModeUi(); loadData(); };
  el('tmBg').checked = S.bg; el('tmBg').onchange = () => { if (el('tmBg').checked && S.frameUser) { el('tmBg').checked = false; S.bg = false; bgNote(); return; } S.bg = el('tmBg').checked; bgNote(); requestDraw(); };
  el('tmZin').onclick = () => zoomAt(S.W / 2, S.H / 2, 1); el('tmZout').onclick = () => zoomAt(S.W / 2, S.H / 2, -1); el('tmFit').onclick = () => { const pts = refPoints().concat(S.rows); if (pts.length) { fitBounds(pts, 40); frameIndependent(); } };
  el('tmLocBtn').onclick = () => { el('tmLocConsent').style.display = 'block'; };
  el('tmLocNo').onclick = () => { el('tmLocConsent').style.display = 'none'; };
  el('tmLocGo').onclick = () => { el('tmLocConsent').style.display = 'none'; locateMe(); };
  bindPointer(el('tmCanvas'));
  try { if (typeof ResizeObserver !== 'undefined') { S.ro = new ResizeObserver(() => resize()); S.ro.observe(el('tmWrap')); } else window.addEventListener('resize', resize); } catch (e) {}
}
window.showTowerMapImpl = function (tok) {
  pushLevel(showLinesHome);
  document.getElementById('linesHomeView').style.display = 'none'; document.getElementById('linesInfoView').style.display = 'none'; document.getElementById('linesStatusView').style.display = 'none';
  const lt = document.getElementById('lineTowerListView'); if (lt) lt.style.display = 'none'; const td = document.getElementById('towerDetailView'); if (td) td.style.display = 'none';
  const root = document.getElementById('towerMapView'); root.style.display = '';
  if (S.gen !== featSessionTag() || S.uid !== uidNow()) { S.sel = []; S.mode = 'single'; S.rows = []; deriveTowers(); S.fitSig = null; S.nearest = []; S.frameUser = false; S.view = { lat: 32.5, lon: 45.8, z: 8 }; S.tiles = new Map(); S.ref = { on: {}, data: null, at: null, src: null, err: '' }; }   // حساب/جلسة مختلفة: لا اختيار ولا بيانات سابقة
  S.locTok++; streetsRevoke(); S.typeMemo = new Map(); S.gen = featSessionTag(); S.bg = false; S.open = true; S.user = null; S.locMsg = ''; S.pop = null; S.hl = null;
  build(root); updModeUi(); buildSelectors(); paintLoc(); renderNearest(); bgNote(); refLoad();
  if (S.ro) { try { S.ro.disconnect(); } catch (e) {} S.ro = null; try { S.ro = new ResizeObserver(() => resize()); S.ro.observe(el('tmWrap')); } catch (e) {} }
  setTimeout(() => { resize(); if (S.sel.length || S.mode === 'all') loadData(); else paint(); }, 0);
};
window.tmapLeave = function () { S.locTok++; streetsRevoke(); S.open = false; S.user = null; S.locMsg = ''; S.pop = null; S.nearest = []; try { if (S.ro) S.ro.disconnect(); } catch (e) {} const root = document.getElementById('towerMapView'); if (root && root.style.display !== 'none') root.style.display = 'none'; };
window.__tmapDrawn = function () { return S.drawn.map(d => ({ x: d.x, y: d.y, kind: d.kind, n: d.items ? d.items.length : 0, fill: d.fill || null, num: d.row ? d.row.number : null, line: d.row ? d.row.line : null })); };
window.__tmapRetype = function () { S.typeMemo = new Map(); requestDraw(); };   // خطاف اختبار: إسقاط ذاكرة الأنواع بعد تغيير التكوين داخل الصفحة
window.__tmapLineColor = function (l) { return lineColor(l); };   // خطاف اختبار للقراءة فقط
window.__tmapInfo = function () { return { typeKey: !!el('tmTypeKey'), streets: streetsOn(), streetsAsk: S.streetsAsk, labels: S.labelCount, labelTexts: S.labelTexts.slice(), towers: S.towers.length, popRows: S.pop ? S.pop.rows.length : 0, frameUser: S.frameUser, bg: S.bg, bgAllowed: bgAllowed(), refShown: refPoints().length, refLines: (S.ref.data || []).map(l => l.ref_key), refSrc: S.ref.src, status: (document.getElementById('tmStatus') || {}).textContent || '', open: S.open, mode: S.mode, sel: S.sel.slice(), rows: S.rows.length, lines: Array.from(new Set(S.rows.map(r => r.line))), source: S.info.source, drawnSingles: S.singles, drawnClusters: S.clusters, visible: S.visCount, user: S.user ? { lat: S.user.lat, lon: S.user.lon, acc: S.user.acc } : null, locMsg: S.locMsg, nearest: S.nearest.map(x => ({ line: x.r.line, number: x.r.number, d: Math.round(x.d * 10) / 10 })), view: Object.assign({}, S.view), pend: S.pend.length, missing: S.info.missing.slice() }; };
window.__tmapProbe = function (line, number) { const r = S.rows.find(x => x.line === line && String(x.number) === String(number)); if (!r) return null; const q = toScreen(r.lat, r.lon); const rect = el('tmCanvas').getBoundingClientRect(); return { x: rect.left + q.x, y: rect.top + q.y, ok: q.x > 0 && q.y > 0 && q.x < S.W && q.y < S.H }; };

// ---------- tower detail card: confirmed vs pending, and the capture flow ----------
const Q_MSG = { good: 'جيدة', ok: 'مقبولة', poor: 'ضعيفة' };
function accClass(a) { return a == null ? 'poor' : a <= 10 ? 'good' : a <= 30 ? 'ok' : 'poor'; }
window.towerLocCardImpl = async function (ctx, tok) {
  const box = document.getElementById('towerLocCard'); if (!box) return;
  CARD = { ctx, box, seq: (CARD ? CARD.seq : 0) + 1, cap: null, conf: null, confSrc: null, uid: ctx.uid };
  const my = CARD.seq; cardPaint();
  const id = ctx.ident && !ctx.ident.blocked ? ctx.ident.tower_id : null; if (!id) return;
  // local confirmed copy first (offline-safe), then the server when reachable
  try { const loc = tlocConfMine()[String(id)]; if (loc) { CARD.conf = { lat: loc.lat, lon: loc.lon, accuracy_m: loc.acc, captured_at: loc.at, source: loc.src, saved_by_name: loc.by }; CARD.confSrc = 'device'; cardPaint(); } } catch (e) {}
  try {
    const cache = await cacheAll(ctx.uid); if (CARD && CARD.seq === my && !CARD.conf) { for (const ent of cache.values()) { const r = (ent.rows || []).find(x => String(x.id) === String(id)); if (r) { CARD.conf = { lat: r.lat, lon: r.lon, accuracy_m: r.acc, captured_at: r.at, source: r.src }; CARD.confSrc = 'cache'; cardPaint(); break; } } }
  } catch (e) {}
  if (navigator.onLine !== false && typeof csCall === 'function' && CS_AUTH.token) {
    const r = await csCall('app_tower_location_get', { p_tower_id: id }, { timeout: 20000 });
    if (!CARD || CARD.seq !== my || uidNow() !== ctx.uid) return;
    if (r && r.ok === true) { CARD.retired = !!r.retired; if (r.location) { CARD.conf = r.location; CARD.confSrc = 'server'; } else if (CARD.confSrc !== 'server') { CARD.conf = null; CARD.confSrc = 'server'; } cardPaint(); }
  }
};
window.towerLocCardRefresh = function () { if (CARD && document.body.contains(CARD.box)) cardPaint(); };
function cardPaint() {
  if (!CARD || !document.body.contains(CARD.box)) return; const c = CARD, ctx = c.ctx, box = c.box;
  const id = ctx.ident && !ctx.ident.blocked ? ctx.ident.tower_id : null;
  let h = '<div class="form-card"><h3 style="margin:0 0 8px">📍 موقع البرج</h3>';
  if (!id) { box.innerHTML = h + '<div style="font-size:12px;color:#7B341E">هوية هذا البرج الدائمة غير معروفة على الجهاز' + (ctx.ident && ctx.ident.blocked ? ' (تعارض/بيانات قديمة)' : '') + ' — افتح الخط وأنت متصل ثم أعد فتح البرج لتسجيل موقعه.</div></div>'; return; }
  // confirmed
  if (c.conf) h += '<div style="padding:8px;border-radius:8px;background:#F0FFF4;border-right:3px solid #48BB78;margin-bottom:8px;font-size:13px"><b style="color:#276749">✅ موقع مؤكَّد' + (c.confSrc === 'server' ? ' (من الخادم الآن)' : ' (محفوظ بالجهاز — لم يُتحقَّق منه الآن)') + '</b><br>' + Number(c.conf.lat).toFixed(6) + ', ' + Number(c.conf.lon).toFixed(6) + (c.conf.accuracy_m != null ? ' · دقة ±' + Math.round(c.conf.accuracy_m) + ' م' : '') + '<br><span style="color:#4a5568;font-size:12px">' + esc(SRC_AR[c.conf.source] || '') + ' · ' + fmtTime(c.conf.captured_at) + (c.conf.saved_by_name ? ' · ' + esc(c.conf.saved_by_name) : '') + '</span></div>';
  else h += '<div style="font-size:12px;color:#718096;margin-bottom:8px">' + (c.confSrc === 'server' ? 'لا موقع مؤكَّد لهذا البرج بعد.' : 'لا موقع مؤكَّد معروف على الجهاز لهذا البرج.') + '</div>';
  // pending / rejected (this account only)
  tlocForTower(id).forEach(e => {
    if (e.rejected) h += '<div style="padding:8px;border-radius:8px;background:#FFF5F5;border-right:3px solid #E53E3E;margin-bottom:8px;font-size:13px"><b style="color:#c0392b">⛔ موقع مرفوض من الخادم</b><br>' + Number(e.lat).toFixed(6) + ', ' + Number(e.lon).toFixed(6) + '<br><span style="font-size:12px">' + esc(TLOC_MSG[e.rejected.code] || e.rejected.code) + '</span><div style="margin-top:6px"><button class="btn btn-sm btn-secondary" onclick="tlocRetry(\'' + esc(e.request_id) + '\')">🔁 إعادة المحاولة</button> <button class="btn btn-sm btn-secondary" onclick="tlocDiscard(\'' + esc(e.request_id) + '\')">🗑️ إلغاء</button></div></div>';
    else h += '<div style="padding:8px;border-radius:8px;background:#FFFAF0;border-right:3px solid #ED8936;margin-bottom:8px;font-size:13px"><b style="color:#B7791F">⏳ موقع معلّق — محفوظ على جهازك ولم يصل الخادم بعد</b><br>' + Number(e.lat).toFixed(6) + ', ' + Number(e.lon).toFixed(6) + (e.accuracy_m != null ? ' · دقة ±' + Math.round(e.accuracy_m) + ' م' : '') + '<br><span style="font-size:12px;color:#4a5568">التُقط ' + fmtTime(e.captured_at) + ' — يُرسل تلقائياً (مرة واحدة) عند توفر الاتصال' + (e._lastError ? ' · آخر محاولة: ' + esc(e._lastError) : '') + '</span></div>';
  });
  // capture panel
  const cap = c.cap;
  if (!cap) {
    h += '<button class="btn btn-secondary" id="tlocStart" style="width:100%"' + (c.retired ? ' disabled' : '') + '>📍 التقاط موقع البرج</button>' + (c.retired ? '<div style="font-size:12px;color:#c0392b;margin-top:6px">البرج مؤرشف — لا يُسجَّل له موقع</div>' : '') + (!ctx.live ? '<div style="font-size:11px;color:#7B341E;margin-top:6px">الهوية من نسخة محفوظة على الجهاز؛ يتحقق الخادم منها عند الرفع.</div>' : '');
  } else if (cap.phase === 'asking') {
    h += '<div style="padding:10px;border:1px solid #F6C23E;border-radius:10px;background:#FFFAF0;font-size:13px">يجب أن تكون <b>عند هذا البرج الآن</b>. سيطلب الجهاز إذن الموقع. لن يُحفظ شيء قبل أن تؤكّد.<div style="margin-top:8px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" id="tlocGo">التقاط الآن</button><button class="btn btn-secondary btn-sm" id="tlocCancel">إلغاء</button></div></div>';
  } else if (cap.phase === 'locating') {
    h += '<div style="font-size:13px;color:#4a5568">⏳ جاري الالتقاط… (قد يستغرق حتى 25 ثانية؛ اسمح للمتصفح عند السؤال)</div>';
  } else if (cap.phase === 'error') {
    h += '<div style="padding:10px;border-radius:10px;background:#FFF5F5;color:#c0392b;font-size:13px">⚠️ ' + esc(cap.err) + '<div style="margin-top:8px;display:flex;gap:8px"><button class="btn btn-secondary btn-sm" id="tlocGo">إعادة المحاولة</button><button class="btn btn-secondary btn-sm" id="tlocCancel">إغلاق</button></div></div>';
  } else if (cap.phase === 'ready' || cap.phase === 'saving') {
    const q = accClass(cap.pos.acc), qc = q === 'good' ? '#276749' : q === 'ok' ? '#B7791F' : '#c0392b';
    h += '<div style="padding:10px;border:2px solid #2E4057;border-radius:10px;font-size:13px"><b>راجع قبل التأكيد</b><br>خط العرض/الطول: <b style="direction:ltr;display:inline-block">' + cap.pos.lat.toFixed(6) + ', ' + cap.pos.lon.toFixed(6) + '</b><br>الدقة: <b style="color:' + qc + '">±' + (cap.pos.acc != null ? Math.round(cap.pos.acc) + ' م' : '—') + ' (' + Q_MSG[q] + ')</b><br>وقت الالتقاط: ' + fmtTime(cap.pos.ts) + '<br><span style="font-size:12px;color:#4a5568">البرج: ' + esc(ctx.line) + ' — رقم ' + esc(ctx.number) + '</span>' + (q === 'poor' ? '<div style="margin-top:6px;color:#c0392b;font-size:12px">⚠️ الدقة ضعيفة — الأفضل إعادة الالتقاط من مكان مكشوف قبل التأكيد.</div>' : '') +
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="tlocConfirm"' + (cap.phase === 'saving' ? ' disabled' : '') + '>✅ تأكيد وحفظ</button><button class="btn btn-secondary btn-sm" id="tlocGo"' + (cap.phase === 'saving' ? ' disabled' : '') + '>🔄 إعادة الالتقاط</button><button class="btn btn-secondary btn-sm" id="tlocCancel"' + (cap.phase === 'saving' ? ' disabled' : '') + '>إلغاء</button></div></div>';
  } else if (cap.phase === 'saved') {
    h += '<div style="padding:10px;border-radius:10px;font-size:13px;background:' + (cap.state === 'confirmed' ? '#F0FFF4' : cap.state === 'rejected' ? '#FFF5F5' : '#FFFAF0') + '">' + (cap.state === 'confirmed' ? (cap.applied === false ? 'ℹ️ وصل الخادم، لكن يوجد موقع أحدث لهذا البرج فبقي هو.' : '✅ تأكّد الخادم من الحفظ' + (cap.renumbered ? ' (رقم البرج تغيّر؛ حُفظ على نفس البرج)' : '')) : cap.state === 'rejected' ? '⛔ رفضه الخادم: ' + esc(TLOC_MSG[cap.code] || cap.code) : '⏳ حُفظ على جهازك — لم يصل الخادم بعد وسيُرسل تلقائياً') + '<div style="margin-top:8px"><button class="btn btn-secondary btn-sm" id="tlocCancel">حسناً</button></div></div>';
  } else if (cap.phase === 'blocked') {
    h += '<div style="padding:10px;border-radius:10px;background:#FFF5F5;color:#c0392b;font-size:13px">⛔ ' + esc(cap.err) + '<div style="margin-top:8px"><button class="btn btn-secondary btn-sm" id="tlocCancel">إغلاق</button></div></div>';
  }
  box.innerHTML = h + '</div>';
  const b = id2 => box.querySelector('#' + id2);
  if (b('tlocStart')) b('tlocStart').onclick = () => { c.cap = { phase: 'asking' }; cardPaint(); };
  if (b('tlocCancel')) b('tlocCancel').onclick = () => { c.cap = null; cardPaint(); };
  if (b('tlocGo')) b('tlocGo').onclick = () => capturePos();
  if (b('tlocConfirm')) b('tlocConfirm').onclick = () => confirmCapture();
}
async function capturePos() {
  const c = CARD; if (!c) return; const ctx = c.ctx; c.cap = { phase: 'locating' }; cardPaint();
  let p;
  try { p = await geo({ enableHighAccuracy: true, timeout: 25000, maximumAge: 0 }); }
  catch (e) { if (CARD !== c) return; c.cap = { phase: 'error', err: GEO_ERR[e && e.code != null ? e.code : 2] || GEO_ERR[2] }; cardPaint(); return; }
  if (CARD !== c || !document.body.contains(c.box)) return;
  // الهوية والحساب يُثبَّتان الآن (لحظة الالتقاط)، لا عند الإرسال
  const uid = uidNow(); let cur = null; try { cur = csIdentSnap(ctx.line, ctx.number); } catch (e) { cur = null; }
  if (!uid || uid !== ctx.uid) { c.cap = { phase: 'blocked', err: 'تغيّر الحساب — لم يُسجَّل شيء. أعد فتح البرج.' }; cardPaint(); return; }
  if (!cur || cur.blocked || !ctx.ident || cur.tower_id !== ctx.ident.tower_id) { c.cap = { phase: 'blocked', err: 'تغيّر ترقيم الخط أو هوية هذا البرج منذ فتحه — لم يُسجَّل شيء. أعد فتح البرج بعد تحديث البيانات.' }; cardPaint(); return; }
  const ts = p.timestamp || Date.now();
  c.cap = { phase: 'ready', uid, rid: (typeof genUUID === 'function' ? genUUID() : String(Date.now())), ident: { tower_id: cur.tower_id, topology_rev: cur.topology_rev }, line: ctx.line, number: ctx.number, pos: { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy != null ? p.coords.accuracy : null, ts } };
  cardPaint();
}
async function confirmCapture() {
  const c = CARD; if (!c || !c.cap || c.cap.phase !== 'ready') return; const cap = c.cap;
  if (uidNow() !== cap.uid) { c.cap = { phase: 'blocked', err: 'تغيّر الحساب بعد الالتقاط — لم يُحفظ شيء.' }; cardPaint(); return; }
  cap.phase = 'saving'; cardPaint();
  const r = await tlocSubmit({ request_id: cap.rid, uid: cap.uid, tower_id: cap.ident.tower_id, line: cap.line, number: cap.number, topology_rev: cap.ident.topology_rev, lat: cap.pos.lat, lon: cap.pos.lon, accuracy_m: cap.pos.acc == null ? null : Math.round(cap.pos.acc * 10) / 10, captured_at: new Date(cap.pos.ts).toISOString() });
  if (CARD !== c) return;
  if (!r.ok) { c.cap = { phase: 'blocked', err: r.reason === 'account_changed' ? 'تغيّر الحساب — لم يُحفظ شيء.' : 'تعذّر الحفظ على الجهاز — لم يُرسل شيء.' }; cardPaint(); return; }
  c.cap = { phase: 'saved', state: r.state, code: r.code, applied: r.applied, renumbered: r.renumbered };
  if (r.state === 'confirmed') { const lc = tlocConfMine()[String(cap.ident.tower_id)]; if (lc) { c.conf = { lat: lc.lat, lon: lc.lon, accuracy_m: lc.acc, captured_at: lc.at, source: lc.src, saved_by_name: lc.by }; c.confSrc = 'server'; } }
  cardPaint();
}

(window.__featModules = window.__featModules || {}).tmap = true;
})();
