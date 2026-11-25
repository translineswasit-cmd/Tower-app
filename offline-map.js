/* offline-map.js — N25-R42: خريطة واسط دون إنترنت (PMTiles محلي) — عارض ذاتي بلا مكتبات خارجية ولا CDN.
   • الحزمة ملف PMTiles v3 (بلاطات متجهية MVT) تُنزَّل اختيارياً (ليست جزءاً من تثبيت التطبيق) وتُخزَّن على الجهاز في IndexedDB على شرائح 1 ميغابايت؛ القراءة العشوائية (دليل ← بلاطة) من الشرائح المخزنة فقط، بلا HTTP.
   • التنزيل: شرائح جديدة تحت معرّف جديد؛ لا يُستبدل الإصدار السليم إلا بعد اكتمال الحجم والبصمة (SHA-256) والترويسة؛ الفشل/الإلغاء يترك النسخة السابقة كما هي.
   • الاستيراد من «الملفات» (input type=file) يمر بنفس التحقق والتخزين.
   • الرسم: Canvas 2D (مياه/أنهار/طرق/سكك/أسماء المناطق) بخط عربي محلي من fonts/ (لا خطوط CDN). الرموز مرسومة برمجياً (لا sprites خارجية).
   • الإسناد: © OpenStreetMap contributors (ODbL 1.0) — يُقرأ من بيانات الحزمة نفسها ويُعرض مع الخريطة. */
(function () {
'use strict';
const DBN = 'tower_offline_map', CH = 1024 * 1024, MANIFEST_URL = './maps/wasit-manifest.json';
const FONT_URLS = ['fonts/SimplifiedArabic-Regular.ttf', 'fonts/SimplifiedArabic-Bold.ttf'];

// ---------------- streaming SHA-256 (pure JS; crypto.subtle has no streaming) ----------------
const K256 = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
function Sha256() { this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]); this.buf = new Uint8Array(64); this.bl = 0; this.len = 0; this.w = new Uint32Array(64); }
Sha256.prototype._blk = function (b, o) {
  const w = this.w, h = this.h;
  for (let i = 0; i < 16; i++, o += 4) w[i] = (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
  for (let i = 16; i < 64; i++) { const a = w[i - 15], c = w[i - 2]; w[i] = (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + w[i - 7] + (((c >>> 17) | (c << 15)) ^ ((c >>> 19) | (c << 13)) ^ (c >>> 10)) + w[i - 16] | 0; }
  let a = h[0], b2 = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
  for (let i = 0; i < 64; i++) {
    const t1 = hh + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K256[i] + w[i] | 0;
    const t2 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b2) ^ (a & c) ^ (b2 & c)) | 0;
    hh = g; g = f; f = e; e = d + t1 | 0; d = c; c = b2; b2 = a; a = t1 + t2 | 0;
  }
  h[0] = h[0] + a | 0; h[1] = h[1] + b2 | 0; h[2] = h[2] + c | 0; h[3] = h[3] + d | 0; h[4] = h[4] + e | 0; h[5] = h[5] + f | 0; h[6] = h[6] + g | 0; h[7] = h[7] + hh | 0;
};
Sha256.prototype.update = function (u8) {
  this.len += u8.length; let i = 0;
  if (this.bl) { while (i < u8.length && this.bl < 64) this.buf[this.bl++] = u8[i++]; if (this.bl === 64) { this._blk(this.buf, 0); this.bl = 0; } }
  for (; i + 64 <= u8.length; i += 64) this._blk(u8, i);
  while (i < u8.length) this.buf[this.bl++] = u8[i++];
  return this;
};
Sha256.prototype.hex = function () {
  const bits = this.len * 8, pad = new Uint8Array(((this.bl < 56) ? 56 - this.bl : 120 - this.bl) + 8); pad[0] = 0x80;
  const hi = Math.floor(bits / 4294967296), lo = bits >>> 0, n = pad.length;
  pad[n - 8] = hi >>> 24; pad[n - 7] = hi >>> 16; pad[n - 6] = hi >>> 8; pad[n - 5] = hi; pad[n - 4] = lo >>> 24; pad[n - 3] = lo >>> 16; pad[n - 2] = lo >>> 8; pad[n - 1] = lo;
  const len0 = this.len; this.update(pad); this.len = len0;
  return Array.from(this.h).map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
};

// ---------------- gzip/inflate (native DecompressionStream, with a pure-JS fallback) ----------------
function inflateRaw(src, start) {   // minimal RFC1951 inflate
  let pos = start, bitbuf = 0, bitcnt = 0; const out = [];
  const bits = (n) => { while (bitcnt < n) { bitbuf |= src[pos++] << bitcnt; bitcnt += 8; } const v = bitbuf & ((1 << n) - 1); bitbuf >>>= n; bitcnt -= n; return v; };
  const build = (lens) => { const cnt = new Uint16Array(16), offs = new Uint16Array(16), sym = new Uint16Array(lens.length); lens.forEach(l => cnt[l]++); cnt[0] = 0; for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + cnt[i - 1]; lens.forEach((l, s) => { if (l) sym[offs[l]++] = s; }); return { cnt, sym }; };
  const decode = (t) => { let code = 0, first = 0, index = 0; for (let len = 1; len < 16; len++) { code |= bits(1); const c = t.cnt[len]; if (code - c < first) return t.sym[index + (code - first)]; index += c; first += c; first <<= 1; code <<= 1; } throw new Error('inflate'); };
  const LB = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258], LE = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DB_ = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577], DE = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  let fixedL = null, fixedD = null;
  for (let last = 0; !last;) {
    last = bits(1); const type = bits(2);
    if (type === 0) { bitbuf = 0; bitcnt = 0; const len = src[pos] | (src[pos + 1] << 8); pos += 4; for (let i = 0; i < len; i++) out.push(src[pos++]); continue; }
    let lt, dt;
    if (type === 1) {
      if (!fixedL) { const l = new Array(288); for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8; fixedL = build(l); fixedD = build(new Array(30).fill(5)); }
      lt = fixedL; dt = fixedD;
    } else {
      const nl = bits(5) + 257, nd = bits(5) + 1, nc = bits(4) + 4, ord = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], cl = new Array(19).fill(0);
      for (let i = 0; i < nc; i++) cl[ord[i]] = bits(3);
      const ct = build(cl), lens = [];
      while (lens.length < nl + nd) { const s = decode(ct); if (s < 16) lens.push(s); else { let rep, v = 0; if (s === 16) { v = lens[lens.length - 1]; rep = 3 + bits(2); } else if (s === 17) rep = 3 + bits(3); else rep = 11 + bits(7); while (rep--) lens.push(v); } }
      lt = build(lens.slice(0, nl)); dt = build(lens.slice(nl));
    }
    for (;;) {
      const s = decode(lt); if (s < 256) out.push(s); else if (s === 256) break; else { const li = s - 257, len = LB[li] + bits(LE[li]), ds = decode(dt), dist = DB_[ds] + bits(DE[ds]); for (let i = 0; i < len; i++) out.push(out[out.length - dist]); }
    }
  }
  return Uint8Array.from(out);
}
function gunzipJs(u8) {
  let p = 10; const flg = u8[3];
  if (flg & 4) { p += 2 + (u8[p] | (u8[p + 1] << 8)); } if (flg & 8) { while (u8[p++]); } if (flg & 16) { while (u8[p++]); } if (flg & 2) p += 2;
  return inflateRaw(u8, p);
}
const OM_TEST = { noNative: false, nativeCalls: 0, jsCalls: 0, chunkSize: 0 };
async function gunzip(u8) {
  if (!OM_TEST.noNative && typeof DecompressionStream === 'function') {
    try { OM_TEST.nativeCalls++; return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); } catch (e) { /* fallback below */ }
  }
  OM_TEST.jsCalls++; return gunzipJs(u8);
}

// ---------------- IndexedDB store (meta + 1 MB chunks) ----------------
let _db = null;
function openDb() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    try {
      const rq = indexedDB.open(DBN, 1);
      rq.onupgradeneeded = () => { const d = rq.result; d.createObjectStore('meta', { keyPath: 'k' }); d.createObjectStore('chunks'); };
      rq.onsuccess = () => { const d = rq.result; d.onclose = () => { _db = null; }; d.onversionchange = () => { try { d.close(); } catch (e) {} _db = null; }; resolve(d); };
      rq.onerror = () => { _db = null; reject(rq.error); }; rq.onblocked = () => { _db = null; reject(new Error('blocked')); };
    } catch (e) { _db = null; reject(e); }
  });
  return _db;
}
async function withDb(fn) {   // iOS يُسقط اتصال IndexedDB أحياناً بعد الخلفية: إعادة فتح مرة واحدة
  try { return await fn(await openDb()); } catch (e) { _db = null; return await fn(await openDb()); }
}
const rqp = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txp = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('abort')); });
const metaGet = (k) => withDb(db => rqp(db.transaction('meta', 'readonly').objectStore('meta').get(k)));
const metaPut = (v) => withDb(async db => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(v); await txp(tx); });
const chunkPut = (id, i, buf) => withDb(async db => { const tx = db.transaction('chunks', 'readwrite'); tx.objectStore('chunks').put(buf, id + ':' + i); await txp(tx); });
const chunkGet = (id, i) => withDb(db => rqp(db.transaction('chunks', 'readonly').objectStore('chunks').get(id + ':' + i)));
const chunksDel = (id, n) => withDb(async db => { const tx = db.transaction('chunks', 'readwrite'); const st = tx.objectStore('chunks'); for (let i = 0; i < n; i++) st.delete(id + ':' + i); await txp(tx); });

// ---------------- state ----------------
const ST = { cur: null, job: null, pack: null, listeners: [], tiles: new Map(), pend: new Map(), dirs: new Map(), chunkCache: new Map(), fontsOk: false, stats: { tileReads: 0, chunkReads: 0, httpReads: 0 } };
function emit() { ST.listeners.forEach(f => { try { f(); } catch (e) {} }); }
function onChange(f) { ST.listeners.push(f); }

// ---------------- PMTiles v3 reader over stored chunks ----------------
function rv(b, i) { let r = 0, m = 1; for (;;) { const c = b[i.p++]; r += (c & 0x7F) * m; if (!(c & 0x80)) return r; m *= 128; } }
function parseDir(b) {
  const i = { p: 0 }, n = rv(b, i), ids = [], runs = [], lens = [], offs = []; let last = 0;
  for (let k = 0; k < n; k++) { last += rv(b, i); ids.push(last); }
  for (let k = 0; k < n; k++) runs.push(rv(b, i));
  for (let k = 0; k < n; k++) lens.push(rv(b, i));
  for (let k = 0; k < n; k++) { const v = rv(b, i); offs.push(v === 0 && k > 0 ? offs[k - 1] + lens[k - 1] : v - 1); }
  return ids.map((id, k) => ({ id, off: offs[k], len: lens[k], run: runs[k] }));
}
function tileId(z, x, y) {
  let acc = 0; for (let i = 0; i < z; i++) acc += Math.pow(4, i);
  const n = Math.pow(2, z); let d = 0;
  for (let s = n / 2; s >= 1; s = Math.floor(s / 2)) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0; d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = n - 1 - x; y = n - 1 - y; } const t = x; x = y; y = t; }
  }
  return acc + d;
}
async function readRange(meta, off, len) {   // قراءة عشوائية من الشرائح المخزنة (لا HTTP)
  const out = new Uint8Array(len); let w = 0;
  while (w < len) {
    const abs = off + w, ci = Math.floor(abs / meta.chunkSize), co = abs % meta.chunkSize;
    const ck = meta.id + ':' + ci; let buf = ST.chunkCache.get(ck);
    if (!buf) { ST.stats.chunkReads++; const raw = await chunkGet(meta.id, ci); if (!raw) throw new Error('chunk_missing'); buf = new Uint8Array(raw); ST.chunkCache.set(ck, buf); if (ST.chunkCache.size > 24) ST.chunkCache.delete(ST.chunkCache.keys().next().value); }
    const take = Math.min(len - w, buf.length - co); out.set(buf.subarray(co, co + take), w); w += take;
  }
  return out;
}
function hdrOf(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 127 || String.fromCharCode.apply(null, u8.subarray(0, 7)) !== 'PMTiles' || u8[7] !== 3) throw new Error('not_pmtiles_v3');
  const u64 = (o) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296;
  return { rootOff: u64(8), rootLen: u64(16), metaOff: u64(24), metaLen: u64(32), leafOff: u64(40), leafLen: u64(48), dataOff: u64(56), dataLen: u64(64), nTiles: u64(72), internal: u8[97], tileComp: u8[98], tileType: u8[99], minZoom: u8[100], maxZoom: u8[101], bbox: [dv.getInt32(102, true) / 1e7, dv.getInt32(106, true) / 1e7, dv.getInt32(110, true) / 1e7, dv.getInt32(114, true) / 1e7] };
}
async function dirAt(meta, h, kind, off, len) {
  const key = meta.id + ':' + kind + ':' + off; let d = ST.dirs.get(key); if (d) return d;
  const raw = await readRange(meta, off, len); const u = h.internal === 2 ? await gunzip(raw) : raw; d = parseDir(u); ST.dirs.set(key, d); return d;
}
async function readTileBytes(meta, z, x, y) {
  ST.stats.tileReads++; const h = meta.hdr, tid = tileId(z, x, y);
  let d = await dirAt(meta, h, 'r', h.rootOff, h.rootLen);
  for (let depth = 0; depth < 4; depth++) {
    let lo = 0, hi = d.length - 1, f = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (d[m].id <= tid) { f = d[m]; lo = m + 1; } else hi = m - 1; }
    if (!f) return null;
    if (f.run > 0) { if (tid >= f.id + f.run) return null; const raw = await readRange(meta, h.dataOff + f.off, f.len); return h.tileComp === 2 ? await gunzip(raw) : raw; }
    d = await dirAt(meta, h, 'l', h.leafOff + f.off, f.len);
  }
  return null;
}

// ---------------- MVT decoder ----------------
function pbf(b) {   // yields [field, wiretype, value|subarray]
  const out = []; let p = 0;
  const vi = () => { let r = 0, m = 1; for (;;) { const c = b[p++]; r += (c & 0x7F) * m; if (!(c & 0x80)) return r; m *= 128; } };
  while (p < b.length) { const k = vi(), f = k >> 3, wt = k & 7; if (wt === 0) out.push([f, 0, vi()]); else if (wt === 2) { const l = vi(); out.push([f, 2, b.subarray(p, p + l)]); p += l; } else if (wt === 5) { out.push([f, 5, b.subarray(p, p + 4)]); p += 4; } else if (wt === 1) { out.push([f, 1, b.subarray(p, p + 8)]); p += 8; } else throw new Error('pb'); }
  return out;
}
function packedVarints(b) { const o = []; let p = 0; while (p < b.length) { let r = 0, m = 1; for (;;) { const c = b[p++]; r += (c & 0x7F) * m; if (!(c & 0x80)) break; m *= 128; } o.push(r); } return o; }
const td = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
function decodeMvt(u8) {
  const layers = {};
  pbf(u8).forEach(([f, wt, v]) => {
    if (f !== 3) return; const keys = [], vals = [], feats = []; let name = '', extent = 4096;
    pbf(v).forEach(([lf, lw, lv]) => {
      if (lf === 1) name = td.decode(lv); else if (lf === 2) feats.push(lv); else if (lf === 3) keys.push(td.decode(lv)); else if (lf === 5) extent = lv;
      else if (lf === 4) { const sv = pbf(lv).find(x => x[0] === 1); vals.push(sv ? td.decode(sv[2]) : ''); }
    });
    const fs = feats.map(fb => {
      let type = 0, tags = [], geom = [];
      pbf(fb).forEach(([ff, fw, fv]) => { if (ff === 3) type = fv; else if (ff === 2) tags = packedVarints(fv); else if (ff === 4) geom = packedVarints(fv); });
      const props = {}; for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
      const parts = []; let cur = null, x = 0, y = 0;
      for (let i = 0; i < geom.length;) {
        const ci = geom[i++], cmd = ci & 7, cnt = ci >> 3;
        if (cmd === 7) { if (cur) cur.closed = true; continue; }
        for (let k = 0; k < cnt; k++) { const dx = geom[i++], dy = geom[i++]; x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1); if (cmd === 1) { cur = [x, y]; cur.closed = false; parts.push(cur); } else { cur.push(x, y); } }
      }
      return { type, props, parts };
    });
    (layers[name] = layers[name] || { extent, features: [] }).features.push(...fs);
  });
  return layers;
}
const TILE_CAP = 160;
function tileGet(z, x, y, onReady) {   // -> decoded layers | null (empty) | undefined (loading)
  const m = ST.cur; if (!m || !ST.pack) return undefined;
  const k = m.id + '/' + z + '/' + x + '/' + y; if (ST.tiles.has(k)) return ST.tiles.get(k);
  if (!ST.pend.has(k)) {
    ST.pend.set(k, readTileBytes(ST.pack, z, x, y).then(b => b ? decodeMvt(b) : null).catch(() => null).then(t => {
      ST.pend.delete(k); if (ST.cur === m) { ST.tiles.set(k, t); if (ST.tiles.size > TILE_CAP) ST.tiles.delete(ST.tiles.keys().next().value); } if (onReady) onReady();
    }));
  }
  return undefined;
}

// ---------------- renderer ----------------
const ROAD = { motorway: ['#e0902a', 4.4, 2], trunk: ['#eaa74a', 4, 2], primary: ['#f5c96e', 3.4, 2], secondary: ['#fbe5a0', 2.8, 1.6], tertiary: ['#ffffff', 2.4, 1.4], minor: ['#ffffff', 1.7, 1.2], service: ['#fdfdfd', 1.1, 1], track: ['#c9b48a', 1.1, 0], path: ['#b08a5a', 0.8, 0] };
const ROAD_ORDER = ['path', 'track', 'service', 'minor', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];
function zscale(z) { return Math.max(0.55, Math.min(2.6, 0.55 + (z - 8) * 0.16)); }
function pathOf(ctx, part, ox, oy, k, close) { ctx.moveTo(ox + part[0] * k, oy + part[1] * k); for (let i = 2; i < part.length; i += 2) ctx.lineTo(ox + part[i] * k, oy + part[i + 1] * k); if (close) ctx.closePath(); }
function scr(parts, ox, oy, k) { return parts.map(p => { const a = new Array(p.length); for (let i = 0; i < p.length; i += 2) { a[i] = ox + p[i] * k; a[i + 1] = oy + p[i + 1] * k; } return a; }); }
// نقطة وضع الاسم على خط: أقرب نقطة (على القطع المقصوصة بإطار العرض) إلى مركز الشاشة؛ تبقى الأسماء مقروءة عند التكبير الزائد
function anchorOn(parts, W, H) {
  let best = null, bd = 1e18; const X0 = 24, X1 = W - 24, Y0 = 12, Y1 = H - 12, cx = W / 2, cy = H / 2;
  for (const p of parts) for (let i = 0; i + 3 < p.length; i += 2) {
    let x0 = p[i], y0 = p[i + 1], dx = p[i + 2] - x0, dy = p[i + 3] - y0, t0 = 0, t1 = 1, ok = true;
    [[-dx, x0 - X0], [dx, X1 - x0], [-dy, y0 - Y0], [dy, Y1 - y0]].forEach(([pp, qq]) => { if (!ok) return; if (pp === 0) { if (qq < 0) ok = false; return; } const r = qq / pp; if (pp < 0) { if (r > t1) ok = false; else if (r > t0) t0 = r; } else { if (r < t0) ok = false; else if (r < t1) t1 = r; } });
    if (!ok || t1 < t0) continue; const len = Math.hypot(dx, dy) * (t1 - t0), n = Math.max(1, Math.min(40, Math.ceil(len / 30)));
    for (let k = 0; k <= n; k++) { const t = t0 + (t1 - t0) * k / n, x = x0 + dx * t, y = y0 + dy * t, d = (x - cx) * (x - cx) + (y - cy) * (y - cy); if (d < bd) { bd = d; best = [x, y]; } }
  }
  return best;
}
// يرسم بلاطة واحدة (أو جزءاً منها عند التكبير الزائد) في المربع [ox,oy,size]؛ يرجع الأسماء لتوضع لاحقاً بعد حل التصادم.
function drawTile(ctx, layers, ox, oy, size, zMap, labels) {
  const zs = zscale(zMap);
  Object.keys(layers).forEach(() => {});
  const L = layers, ex = (n) => (L[n] ? L[n].extent : 4096);
  const kf = (n) => size / ex(n);
  if (L.landuse) { ctx.save(); L.landuse.features.forEach(f => { if (f.type !== 3) return; const c = f.props.class; ctx.fillStyle = c === 'residential' ? '#ebe5dc' : c === 'farmland' ? '#e4ecd6' : c === 'forest' ? '#d3e5c3' : '#e6e2db'; ctx.beginPath(); f.parts.forEach(p => pathOf(ctx, p, ox, oy, kf('landuse'), true)); ctx.fill(); }); ctx.restore(); }
  if (L.water) { ctx.save(); ctx.fillStyle = '#a9cde8'; L.water.features.forEach(f => { if (f.type !== 3) return; ctx.beginPath(); f.parts.forEach(p => pathOf(ctx, p, ox, oy, kf('water'), true)); ctx.fill(); if (f.props.name && f.parts[0]) labels.push({ t: f.props.name, kind: 'water', x: ox + f.parts[0][0] * kf('water'), y: oy + f.parts[0][1] * kf('water') }); }); ctx.restore(); }
  if (L.waterway) { ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; L.waterway.features.forEach(f => { const c = f.props.class; ctx.strokeStyle = '#8fbbdc'; ctx.lineWidth = (c === 'river' ? 3.4 : c === 'canal' ? 2.4 : 1.2) * zs; ctx.beginPath(); f.parts.forEach(p => pathOf(ctx, p, ox, oy, kf('waterway'), false)); ctx.stroke(); if (f.props.name && c !== 'stream' && f.parts[0] && f.parts[0].length >= 4) labels.push({ t: f.props.name, kind: 'water', parts: scr(f.parts, ox, oy, kf('waterway')) }); }); ctx.restore(); }
  if (L.rail) { ctx.save(); ctx.strokeStyle = '#8a8f98'; ctx.lineWidth = 1.2 * zs; ctx.setLineDash([5, 4]); L.rail.features.forEach(f => { ctx.beginPath(); f.parts.forEach(p => pathOf(ctx, p, ox, oy, kf('rail'), false)); ctx.stroke(); }); ctx.restore(); }
  if (L.road) {
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const by = {}; L.road.features.forEach(f => { (by[f.props.class || 'minor'] = by[f.props.class || 'minor'] || []).push(f); });
    ['casing', 'fill'].forEach(pass => ROAD_ORDER.forEach(cls => {
      const fs = by[cls]; if (!fs) return; const st = ROAD[cls] || ROAD.minor; if (cls === 'path' && zMap < 14) return; if (cls === 'service' && zMap < 13) return;
      ctx.strokeStyle = pass === 'casing' ? '#b9b3a6' : st[0]; ctx.lineWidth = (pass === 'casing' ? st[1] + st[2] : st[1]) * zs; if (pass === 'casing' && !st[2]) return;
      ctx.setLineDash(cls === 'track' ? [4, 3] : cls === 'path' ? [2, 3] : []);
      ctx.beginPath(); fs.forEach(f => f.parts.forEach(p => pathOf(ctx, p, ox, oy, kf('road'), false))); ctx.stroke();
    }));
    ctx.restore();
    L.road.features.forEach(f => { const n = f.props.name || f.props.ref; if (!n) return; const c = f.props.class; if (zMap < (c === 'motorway' || c === 'trunk' || c === 'primary' ? 8 : c === 'secondary' ? 10 : c === 'tertiary' ? 12 : 14)) return; if (!f.parts[0] || f.parts[0].length < 4) return; labels.push({ t: n, kind: 'road', parts: scr(f.parts, ox, oy, kf('road')) }); });
  }
  if (L.place) L.place.features.forEach(f => { const p = f.parts[0]; if (!p || !f.props.name) return; labels.push({ t: f.props.name, kind: 'place', cls: f.props.class, x: ox + p[0] * kf('place'), y: oy + p[1] * kf('place') }); });
}
const PLACE_FONT = { city: [17, 700], town: [15, 700], village: [13, 400], suburb: [12, 400], hamlet: [11.5, 400], locality: [11, 400], neighbourhood: [11, 400] };
const PLACE_MINZ = { city: 5, town: 7, village: 9, suburb: 11, hamlet: 11, locality: 12, neighbourhood: 13 };
function drawLabels(ctx, labels, W, H, zMap, ox0) {   // Arabic canvas shaping by the browser; local FontFace first
  const boxes = [], fam = (ST.fontsOk ? '"TMapAr",' : '') + ' "Geeza Pro","Segoe UI",sans-serif'; let shown = 0; const texts = [];
  const order = { place: 0, water: 1, road: 2 }; labels.sort((a, b) => (order[a.kind] - order[b.kind]) || ((PLACE_MINZ[a.cls] || 99) - (PLACE_MINZ[b.cls] || 99)));
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
  labels.forEach(l => {
    if (l.kind === 'place' && zMap < (PLACE_MINZ[l.cls] || 9)) return;
    if (l.parts) { const a = anchorOn(l.parts, W, H); if (!a) return; l.x = a[0]; l.y = a[1]; }
    if (l.x < 0 || l.x > W || l.y < 0 || l.y > H) return;
    const fs = l.kind === 'place' ? PLACE_FONT[l.cls] || [12, 400] : l.kind === 'water' ? [11.5, 400] : [10.5, 400];
    ctx.font = (fs[1] === 700 ? '700 ' : '400 ') + fs[0] + 'px ' + fam; const w = ctx.measureText(l.t).width + 6, h = fs[0] + 4;
    const bx = l.x - w / 2, by = l.y - h / 2; if (bx < 2 || bx + w > W - 2 || by < 2 || by + h > H - 2) return; if (boxes.some(b => bx < b.x + b.w && bx + w > b.x && by < b.y + b.h && by + h > b.y)) return;
    boxes.push({ x: bx, y: by, w, h });
    if (l.kind === 'place') { ctx.beginPath(); ctx.arc(l.x, l.y + h * 0.9, 2.6, 0, 7); ctx.fillStyle = '#4a5568'; ctx.fill(); }
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.strokeText(l.t, l.x, l.y); ctx.fillStyle = l.kind === 'water' ? '#2b6c9a' : l.kind === 'road' ? '#555' : '#1a202c'; ctx.fillText(l.t, l.x, l.y); shown++; texts.push(l.t);
  });
  ctx.restore(); return { shown, texts };
}

// ---------------- lifecycle ----------------
async function loadFonts() {
  if (ST.fontsOk || typeof FontFace === 'undefined') return;
  try { const f = new FontFace('TMapAr', 'url(' + FONT_URLS[0] + ')'); await f.load(); document.fonts.add(f); ST.fontsOk = true; } catch (e) { ST.fontsOk = false; }
}
function packFrom(meta) { return { id: meta.id, chunkSize: meta.chunkSize, hdr: meta.hdr }; }
async function init() {
  if (ST.inited) return ST.cur; ST.inited = true;
  try {
    const cur = await metaGet('current');
    if (cur) {
      // الفحص السريع: الشريحة الأولى موجودة والترويسة سليمة (وإلا تُعدّ الحزمة غير سليمة ولا يُحاول الرسم منها)
      const c0 = await chunkGet(cur.id, 0); const cl = await chunkGet(cur.id, cur.chunks - 1);
      if (c0 && cl && hdrOf(new Uint8Array(c0)).minZoom != null) { ST.cur = cur; ST.pack = packFrom(cur); loadFonts(); } else ST.bad = 'نسخة الخريطة المخزنة غير سليمة — أعد التنزيل';
    }
  } catch (e) { ST.bad = 'تعذّر فتح مخزن الخريطة على الجهاز'; }
  emit(); return ST.cur;
}
function ready() { return !!ST.cur && !!ST.pack; }
function coversPoint(lat, lon) { const b = ST.cur && ST.cur.bbox; return !!b && lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]; }
function tileInside(z, x, y) { const b = ST.cur && ST.cur.bbox; if (!b) return false; const n = Math.pow(2, z), lon0 = x / n * 360 - 180, lon1 = (x + 1) / n * 360 - 180, f = (yy) => 180 / Math.PI * Math.atan(Math.sinh(Math.PI * (1 - 2 * yy / n))), lat0 = f(y + 1), lat1 = f(y); return lon1 >= b[0] && lon0 <= b[2] && lat1 >= b[1] && lat0 <= b[3]; }

async function fetchManifest() {
  const r = await fetch(MANIFEST_URL + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('manifest_http_' + r.status);
  const m = await r.json(); if (!m || !m.file || !m.bytes) throw new Error('manifest_invalid'); return m;
}
async function storageOk(bytes) {
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); if (e && e.quota && e.usage != null && (e.quota - e.usage) < bytes * 1.15) return false; } } catch (e) {}
  return true;
}
function setJob(j) { ST.job = j; emit(); }
// ينسخ بايتات (من fetch أو ملف) إلى شرائح جديدة بمعرّف جديد، يتحقق، ثم يبدّل المؤشّر «current» دفعة واحدة.
async function ingest(readNext, total, expect, label, signal) {
  const CHs = OM_TEST.chunkSize || CH;   // (اختبار فقط: شرائح أصغر لإجبار القراءة عبر حدود الشرائح)
  const id = 'p' + Date.now().toString(36), sha = new Sha256(); let chunks = 0, done = 0, acc = new Uint8Array(CHs), fill = 0, first = null;
  const flush = async () => { if (!fill) return; const part = acc.slice(0, fill); await chunkPut(id, chunks++, part.buffer); fill = 0; };
  try {
    for (;;) {
      if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true });
      const r = await readNext(); if (r.done) break; let u = r.value; done += u.length; sha.update(u);
      if (!first) first = u.slice(0, 127 > u.length ? u.length : 127);
      while (u.length) { const take = Math.min(CHs - fill, u.length); acc.set(u.subarray(0, take), fill); fill += take; u = u.subarray(take); if (fill === CHs) await flush(); }
      setJob({ phase: 'downloading', label, done, total, id });
    }
    await flush();
    if (total && done !== total) throw new Error('size_mismatch');
    const hex = sha.hex(); if (expect && expect.sha256 && expect.sha256 !== hex) throw new Error('sha_mismatch');
    const c0 = new Uint8Array(await chunkGet(id, 0)); const hdr = hdrOf(c0);
    if (hdr.tileType !== 1) throw new Error('not_mvt'); if (hdr.dataOff + hdr.dataLen !== done) throw new Error('header_size_mismatch');
    const meta = { k: 'current', id, chunks, chunkSize: CHs, bytes: done, sha256: hex, hdr, bbox: hdr.bbox, minzoom: hdr.minZoom, maxzoom: hdr.maxZoom, installedAt: Date.now(), version: (expect && expect.version) || '', title: (expect && expect.title_ar) || 'خريطة واسط', attribution: (expect && expect.attribution) || '', license: (expect && expect.license) || '', synthetic: !!(expect && expect.synthetic), source: label };
    try { const mb = await readRange({ id, chunkSize: CHs }, hdr.metaOff, hdr.metaLen); const mj = JSON.parse(new TextDecoder().decode(hdr.internal === 2 ? await gunzip(mb) : mb)); if (!meta.attribution && mj.attribution) meta.attribution = mj.attribution; if (!meta.license && mj.license) meta.license = mj.license; if (mj.synthetic) meta.synthetic = true; if (!meta.version && mj.version) meta.version = mj.version; } catch (e) {}
    // اختبار قراءة فعلي من الشرائح المخزنة قبل اعتماد النسخة: دليل الجذر ثم أول بلاطة
    const probe = { id, chunkSize: CHs, hdr }; await dirAt(probe, hdr, 'r', hdr.rootOff, hdr.rootLen);
    const old = await metaGet('current'); await metaPut(meta);   // الاعتماد: كتابة واحدة
    if (old && old.id !== id) { try { await chunksDel(old.id, old.chunks); } catch (e) {} }
    ST.tiles.clear(); ST.pend.clear(); ST.dirs.clear(); ST.chunkCache.clear(); ST.cur = meta; ST.pack = packFrom(meta); ST.bad = null; loadFonts();
    setJob({ phase: 'done', label, done, total: done, id }); return meta;
  } catch (e) {
    try { await chunksDel(id, chunks + 1); } catch (e2) {}   // النسخة الجزئية تُحذف؛ السليمة السابقة لم تُمسّ
    const cancelled = !!((e && e.cancelled) || (signal && signal.aborted)); setJob({ phase: cancelled ? 'cancelled' : 'failed', label, done, total, err: cancelled ? 'cancelled' : String(e && e.message || e), id }); throw e;
  }
}
async function download(opts) {
  opts = opts || {}; if (ST.job && ST.job.phase === 'downloading') throw new Error('busy');
  const ac = new AbortController(); ST.abort = ac; setJob({ phase: 'downloading', label: 'manifest', done: 0, total: 0 });
  try {
    const man = opts.manifest || await fetchManifest();
    if (!(await storageOk(man.bytes))) throw new Error('no_space');
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    try { await Promise.all(FONT_URLS.map(u => fetch(u).then(r => r.arrayBuffer()))); } catch (e) {}   // يُخزَّن الخط محلياً عبر Service Worker لأوفلاين
    const url = /^https?:/.test(man.url || '') ? man.url : new URL('./maps/' + man.file, location.href).href;
    const resp = await fetch(url, { cache: 'no-store', signal: ac.signal }); if (!resp.ok || !resp.body) throw new Error('http_' + resp.status);
    const cl = Number(resp.headers.get('content-length') || 0); if (cl && man.bytes && cl !== man.bytes) throw new Error('size_mismatch_header');
    const rd = resp.body.getReader();
    return await ingest(() => rd.read(), man.bytes, man, man.file, ac.signal);
  } finally { ST.abort = null; }
}
async function importFile(file, manifest) {
  if (ST.job && ST.job.phase === 'downloading') throw new Error('busy');
  if (!(await storageOk(file.size))) { setJob({ phase: 'failed', label: file.name, done: 0, total: file.size, err: 'no_space' }); throw new Error('no_space'); }
  const ac = new AbortController(); ST.abort = ac; let off = 0;
  const readNext = async () => { if (off >= file.size) return { done: true }; const end = Math.min(file.size, off + CH); const buf = await file.slice(off, end).arrayBuffer(); off = end; return { done: false, value: new Uint8Array(buf) }; };
  try { return await ingest(readNext, file.size, manifest || null, file.name, ac.signal); } finally { ST.abort = null; }
}
function cancel() { if (ST.abort) ST.abort.abort(); }
async function remove() { const cur = await metaGet('current'); if (cur) { await withDb(async db => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').delete('current'); await txp(tx); }); try { await chunksDel(cur.id, cur.chunks); } catch (e) {} } ST.cur = null; ST.pack = null; ST.tiles.clear(); ST.pend.clear(); ST.dirs.clear(); ST.chunkCache.clear(); setJob(null); emit(); }
// نفس مسار القراءة العشوائية للاختبار: بلاطة z/x/y → بايتات خام (بلا رسم)
async function probeTile(z, x, y) { if (!ST.pack) return null; const b = await readTileBytes(ST.pack, z, x, y); return b ? { bytes: b.length, sha: new Sha256().update(b).hex(), layers: Object.keys(decodeMvt(b)) } : null; }

window.OfflineMap = { init, ready, onChange, download, importFile, cancel, remove, fetchManifest, coversPoint, tileInside, tileGet, drawTile, drawLabels, probeTile, loadFonts,
  state: () => ({ cur: ST.cur, job: ST.job, bad: ST.bad || null, fonts: ST.fontsOk, stats: Object.assign({}, ST.stats) }), _test: OM_TEST, _clearCaches: () => { ST.tiles.clear(); ST.pend.clear(); ST.dirs.clear(); ST.chunkCache.clear(); }, _sha256: (u8) => new Sha256().update(u8).hex(), _gunzipJs: gunzipJs, _tileId: tileId };
(window.__featModules = window.__featModules || {}).omap = true;
})();
