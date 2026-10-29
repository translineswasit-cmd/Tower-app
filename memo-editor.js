/* memo-editor.js — v335-C6r18 (N23)
   محرّر نص غني مدمج للمذكرة (RTL). النموذج هو المرجع: DOM → نموذج (قائمة بيضاء) → إعادة رسم DOM عند تطبيق التنسيق/اللصق/الإدخال المُدار.
   لا يدخل نص المستخدم إلى innerHTML أبداً (textContent فقط)، واللصق نص خام فقط، ولا يُوسَّع التحديد إلى كلمات.
   يعتمد على window.MemoDoc (memo-doc.js). */
(function () {
  'use strict';
  const D = window.MemoDoc, PX = 96 / 72;
  const clone = o => JSON.parse(JSON.stringify(o));
  const plen = p => D.paraText(p).length;
  const flatLen = ps => ps.reduce((a, p) => a + plen(p), 0) + Math.max(0, ps.length - 1);
  const AREA_LABEL = { subject: 'الموضوع', body: 'المتن', table: 'الجدول', after: 'ما بعد الجدول', closing: 'الخاتمة', att: 'المرفقات', stitle: 'عنوان مقدم الطلب', sname: 'اسم مقدم الطلب' };

  // ---------------- نموذج: عمليات على الفقرات (إزاحات مسطّحة؛ فاصل الفقرة = حرف واحد) ----------------
  function locate(ps, o) {
    for (let i = 0; i < ps.length; i++) { const l = plen(ps[i]); if (o <= l) return { pi: i, off: o }; o -= l + 1; }
    return { pi: ps.length - 1, off: plen(ps[ps.length - 1]) };
  }
  function styleAt(runs, off) { let acc = 0; for (const r of runs) { if (off > acc && off <= acc + r.t.length) return r; acc += r.t.length; } return runs[0] || null; }
  const stylePart = r => { const o = {}; ['f', 's', 'b', 'i'].forEach(k => { if (r && r[k] != null) o[k] = r[k]; }); return o; };
  function splitRuns(runs, off) {
    let acc = 0;
    for (let i = 0; i < runs.length; i++) {
      const l = runs[i].t.length; if (off === acc) return i;
      if (off < acc + l) { runs.splice(i, 1, Object.assign({}, runs[i], { t: runs[i].t.slice(0, off - acc) }), Object.assign({}, runs[i], { t: runs[i].t.slice(off - acc) })); return i + 1; }
      acc += l;
    }
    return runs.length;
  }
  // يستبدل [s,e) بنص. soft=true: كل '\n' فاصل سطر داخل الفقرة (لا فقرات جديدة).
  function replaceRange(paras, s, e, text, soft) {
    const ps = clone(paras), a = locate(ps, s), b = locate(ps, e);
    const st = stylePart(styleAt(ps[a.pi].r, a.off)), pa = ps[a.pi].a;
    const L = ps[a.pi].r.map(x => Object.assign({}, x)), li = splitRuns(L, a.off), left = L.slice(0, li);
    const R = ps[b.pi].r.map(x => Object.assign({}, x)), ri = splitRuns(R, b.off), right = R.slice(ri);
    const mk = t => (t === '' ? [] : [Object.assign({ t }, st)]);
    const lines = soft ? [String(text)] : String(text).split('\n'), out = [];
    const P = runs => { const o = { r: D.cleanRuns(runs) }; if (pa) o.a = pa; return o; };      // الفقرات الناتجة ترث محاذاة الفقرة المقسومة (كما في Word)
    if (lines.length === 1) out.push(P(left.concat(mk(lines[0]), right)));
    else {
      out.push(P(left.concat(mk(lines[0]))));
      for (let k = 1; k < lines.length - 1; k++) out.push(P(mk(lines[k])));
      out.push(P(mk(lines[lines.length - 1]).concat(right)));
    }
    ps.splice(a.pi, b.pi - a.pi + 1, ...out);
    return { paras: ps, caret: s + String(text).length };
  }
  function mapRange(paras, s, e, fn) {
    const ps = clone(paras); let pos = 0;
    ps.forEach(p => {
      const l = plen(p), a = Math.max(s, pos) - pos, b = Math.min(e, pos + l) - pos;
      if (b > a) { const runs = p.r, i0 = splitRuns(runs, a), i1 = splitRuns(runs, b); for (let k = i0; k < i1; k++) fn(runs[k]); p.r = D.cleanRuns(runs); }
      pos += l + 1;
    });
    return ps;
  }
  // فهارس الفقرات التي يمسّها التحديد [s,e] (أو الفقرة التي فيها المؤشر)؛ المحاذاة تخص الفقرة لا الحرف
  function parasIn(ps, s, e) {
    const out = []; let pos = 0;
    ps.forEach((p, i) => { const end = pos + plen(p); if (s === e ? (s >= pos && s <= end) : (e > pos && s <= end)) out.push(i); pos = end + 1; });
    return out.length ? out : [Math.max(0, ps.length - 1)];
  }
  function setAlign(paras, idx, a) { const ps = clone(paras); idx.forEach(i => { if (ps[i]) ps[i].a = a; }); return ps; }
  const applyPatch = (paras, s, e, patch) => mapRange(paras, s, e, r => Object.assign(r, patch));
  function clearAttrs(paras, keys) { const ps = clone(paras); ps.forEach(p => { p.r.forEach(r => keys.forEach(k => { delete r[k]; })); p.r = D.cleanRuns(p.r); }); return ps; }
  // الأنماط المحلولة ضمن [s,e) (أو كل النص): {f,s,b,i} بقيمة null إن اختلفت
  function query(paras, base, s, e) {
    const seen = []; let pos = 0;
    paras.forEach(p => {
      let q = pos;
      p.r.forEach(r => { const a = q, b = q + r.t.length; q = b; if (b > s && a < e) seen.push(D.resolve(r, base)); });
      pos += plen(p) + 1;
    });
    if (!seen.length) seen.push(D.resolve({}, base));
    const out = {};
    ['f', 's', 'b', 'i'].forEach(k => { out[k] = seen.every(x => x[k] === seen[0][k]) ? seen[0][k] : null; });
    out.first = seen[0];
    return out;
  }

  // ---------------- DOM: رسم النموذج ----------------
  function spanFor(run, base) {
    const st = D.resolve(run, base), sp = document.createElement('span');
    ['f', 's', 'b', 'i'].forEach(k => { if (run[k] != null) sp.dataset[k] = k === 'b' || k === 'i' ? (run[k] ? '1' : '0') : String(run[k]); });
    const fam = st.fam;
    sp.style.fontFamily = fam.legacy ? 'Tahoma, Arial, sans-serif' : "'" + fam.css + "', sans-serif";
    sp.style.fontSize = (st.s * PX).toFixed(2) + 'px';
    sp.style.fontWeight = st.b && !fam.alwaysBold ? '700' : '400';
    sp.style.fontStyle = st.i ? 'italic' : 'normal';
    return sp;
  }
  const ALCSS = { r: 'right', c: 'center', l: 'left', j: 'justify' };
  function render(root, paras, base) {
    root.textContent = '';
    paras.forEach(p => {
      const d = document.createElement('div'); d.className = 'mp'; if (p.a) { d.dataset.a = p.a; d.style.textAlign = ALCSS[p.a]; }
      if (!p.r.length) { const sp = spanFor({}, base); sp.appendChild(document.createElement('br')); d.appendChild(sp); }
      else {
        p.r.forEach(r => {
          const sp = spanFor(r, base);
          r.t.split('\n').forEach((part, i) => { if (i) sp.appendChild(document.createElement('br')); if (part !== '') sp.appendChild(document.createTextNode(part)); });
          d.appendChild(sp);
        });
        if (/\n$/.test(D.paraText(p))) d.lastChild.appendChild(document.createElement('br'));
      }
      root.appendChild(d);
    });
  }
  // ---------------- DOM → نموذج (تسامح مع ما يُنتجه المتصفح؛ لا يُقرأ إلا النص ووسوم data-*) ----------------
  function styleOf(el, st) {
    const d = el.dataset; if (!d || (d.f === undefined && d.s === undefined && d.b === undefined && d.i === undefined)) return st;
    const o = Object.assign({}, st);
    if (d.f !== undefined) o.f = d.f; if (d.s !== undefined && isFinite(Number(d.s))) o.s = Number(d.s);
    if (d.b !== undefined) o.b = d.b === '1'; if (d.i !== undefined) o.i = d.i === '1';
    return o;
  }
  function readParas(root, partial) {
    const paras = []; let cur = null;
    const start = (a) => { cur = { r: [], endsBr: false }; if (a) cur.a = a; paras.push(cur); };
    const add = (t, st, isBr) => { if (t === '') return; if (!cur) start(); cur.r.push(Object.assign({ t }, st)); cur.endsBr = !!isBr; };
    const walk = (node, st) => {
      node.childNodes.forEach(ch => {
        if (ch.nodeType === 3) add(ch.nodeValue.replace(/[​﻿]/g, '').replace(/ /g, ' '), st, false);
        else if (ch.nodeType === 1) {
          const tag = ch.tagName;
          if (tag === 'BR') add('\n', st, true);
          else if (tag === 'DIV' || tag === 'P' || tag === 'LI') {
            if (!(cur && !cur.r.length && paras[paras.length - 1] === cur)) start(ch.dataset && ch.dataset.a); else if (ch.dataset && ch.dataset.a && !cur.a) cur.a = ch.dataset.a;
            walk(ch, styleOf(ch, st)); cur = null;
          } else if (tag !== 'SCRIPT' && tag !== 'STYLE') walk(ch, styleOf(ch, st));
        }
      });
    };
    walk(root, {});
    if (!paras.length) paras.push({ r: [], endsBr: false });
    paras.forEach((p, i) => {
      if (p.endsBr && !(partial && i === paras.length - 1)) {      // فاصل السطر الأخير في الفقرة = مُحجِز المتصفح
        const last = p.r[p.r.length - 1]; last.t = last.t.slice(0, -1); if (!last.t) p.r.pop();
      }
    });
    return paras.map(p => { const o = { r: D.cleanRuns(p.r) }, a = D.cleanA(p.a); if (a) o.a = a; return o; });
  }
  function offsetOf(root, node, off) {
    const r = document.createRange(); r.setStart(root, 0);
    try { r.setEnd(node, off); } catch (e) { return null; }
    const tmp = document.createElement('div'); tmp.appendChild(r.cloneContents());
    return flatLen(readParas(tmp, true));
  }
  // إزاحة → موضع DOM بعد render() مباشرة
  function posOf(root, o) {
    const divs = Array.from(root.children);
    for (let i = 0; i < divs.length; i++) {
      const units = []; const walk = n => n.childNodes.forEach(ch => { if (ch.nodeType === 3) units.push({ n: ch, l: ch.nodeValue.length }); else if (ch.tagName === 'BR') units.push({ n: ch, l: 1, br: true }); else walk(ch); }); walk(divs[i]);
      if (units.length && units[units.length - 1].br) units[units.length - 1].l = 0;     // مُحجِز
      const total = units.reduce((a, u) => a + u.l, 0);
      if (o <= total || i === divs.length - 1) {
        let acc = 0;
        for (const u of units) {
          if (u.br) { if (u.l && o === acc) return { node: u.n.parentNode, off: Array.prototype.indexOf.call(u.n.parentNode.childNodes, u.n) }; acc += u.l; continue; }
          if (o <= acc + u.l) return { node: u.n, off: o - acc };
          acc += u.l;
        }
        const last = units[units.length - 1];
        if (last && last.br) return { node: last.n.parentNode, off: Array.prototype.indexOf.call(last.n.parentNode.childNodes, last.n) + (last.l ? 1 : 0) };
        return { node: divs[i], off: divs[i].childNodes.length ? 1 : 0 };
      }
      o -= total + 1;
    }
    return { node: root, off: 0 };
  }
  function setSel(root, s, e) {
    const a = posOf(root, s), b = e === s ? a : posOf(root, e), sel = window.getSelection(), r = document.createRange();
    try { r.setStart(a.node, a.off); r.setEnd(b.node, b.off); sel.removeAllRanges(); sel.addRange(r); } catch (x) {}
  }

  // ---------------- المحرّر ----------------
  const editors = new Set();
  let active = null, lastSel = { ed: null, s: 0, e: 0 }, bar = null;
  function selOf(ed) {
    const sel = window.getSelection(); if (!sel || !sel.anchorNode || !ed.el.contains(sel.anchorNode) || !ed.el.contains(sel.focusNode)) return null;
    const a = offsetOf(ed.el, sel.anchorNode, sel.anchorOffset), b = offsetOf(ed.el, sel.focusNode, sel.focusOffset);
    if (a == null || b == null) return null;
    return { s: Math.min(a, b), e: Math.max(a, b) };
  }
  class Ed {
    // cfg: {area, single, getBase(), getParas(), setParas(ps), onChange(), onActive(), row, col}
    constructor(el, cfg) {
      this.el = el; this.cfg = cfg; this.undo = []; this.redo = []; this.burst = false; this.composing = false;
      el.setAttribute('contenteditable', 'true'); el.setAttribute('dir', 'rtl'); el.setAttribute('role', 'textbox'); el.setAttribute('aria-multiline', cfg.single ? 'false' : 'true');
      el.setAttribute('autocapitalize', 'off'); el.setAttribute('autocorrect', 'off'); el.spellcheck = false;
      el.addEventListener('beforeinput', e => this.before(e));
      el.addEventListener('input', () => this.input());
      el.addEventListener('compositionstart', () => { this.composing = true; });
      el.addEventListener('compositionend', () => { this.composing = false; this.input(); });
      el.addEventListener('paste', e => this.paste(e));
      el.addEventListener('drop', e => e.preventDefault());
      el.addEventListener('dragover', e => e.preventDefault());
      el.addEventListener('focus', () => this.activate());
      el.addEventListener('blur', () => { if (!this.composing) this.draw(); });
      editors.add(this); this.draw();
    }
    paras() { return this.cfg.getParas(); }
    base() { return this.cfg.getBase(); }
    activate() { active = this; if (this.cfg.onActive) this.cfg.onActive(this); if (bar) bar.show(); }
    draw(s, e) {
      const ps = this.paras(); render(this.el, ps, this.base());
      this.el.classList.toggle('is-empty', ps.length === 1 && !ps[0].r.length);
      if (s != null && document.activeElement === this.el) setSel(this.el, s, e == null ? s : e);
    }
    snap() { this.undo.push(clone(this.paras())); if (this.undo.length > 60) this.undo.shift(); this.redo.length = 0; }
    commit(ps, caret, noSnap) {
      if (!noSnap) this.snap();
      this.cfg.setParas(ps); this.draw(caret); this.cfg.onChange && this.cfg.onChange(this); if (bar) bar.refresh();
    }
    sel() { return selOf(this) || (lastSel.ed === this ? { s: lastSel.s, e: lastSel.e } : { s: 0, e: 0 }); }
    input() {
      if (this.composing) return;
      if (!this.burst) { this.snap(); this.burst = true; clearTimeout(this._bt); this._bt = setTimeout(() => { this.burst = false; }, 1200); }
      let ps = readParas(this.el);
      if (this.cfg.single) { ps = [D.mkLine([].concat(...ps.map((p, i) => (i ? [{ t: '\n' }] : []).concat(p.r))), ps[0] && ps[0].a)]; }
      this.cfg.setParas(ps);
      this.el.classList.toggle('is-empty', ps.length === 1 && !ps[0].r.length);
      this.cfg.onChange && this.cfg.onChange(this); if (bar) bar.refresh();
    }
    insert(text, soft) {
      if (this.cfg.noBreak) { text = String(text).replace(/\s*[\r\n]+\s*/g, ' '); if (!text) return; }       // اسم/عنوان مقدم الطلب: سطر واحد كما كانا حقلَي إدخال (Enter لا يضيف شيئاً)
      const { s, e } = this.sel(), ps = this.paras(), tot = flatLen(ps);
      const r = replaceRange(ps, Math.min(s, tot), Math.min(e, tot), D.cleanText(text, 20000), soft || this.cfg.single);
      this.commit(r.paras, r.caret);
    }
    before(e) {
      const t = e.inputType;
      if (this.cfg.noBreak && (t === 'insertParagraph' || t === 'insertLineBreak')) { e.preventDefault(); return; }
      if (t === 'insertParagraph') { e.preventDefault(); this.insert('\n', this.cfg.single); }
      else if (t === 'insertLineBreak') { e.preventDefault(); this.insert('\n', true); }
      else if (t === 'formatBold') { e.preventDefault(); bar && bar.toggle('b'); }
      else if (t === 'formatItalic') { e.preventDefault(); bar && bar.toggle('i'); }
      else if (/^format/.test(t)) e.preventDefault();                        // لا شطب/تسطير/ألوان…
      else if (t === 'historyUndo') { e.preventDefault(); this.doUndo(); }
      else if (t === 'historyRedo') { e.preventDefault(); this.doRedo(); }
      else if (t === 'insertFromPaste' || t === 'insertFromDrop' || t === 'insertFromYank') { e.preventDefault(); const dt = e.dataTransfer; if (dt) this.insert(dt.getData('text/plain') || ''); }
    }
    paste(e) {
      e.preventDefault();
      const cd = e.clipboardData || window.clipboardData; let txt = cd ? cd.getData('text/plain') : '';
      if (txt) this.insert(String(txt).replace(/ /g, ' '));
    }
    doUndo() { if (!this.undo.length) return; this.redo.push(clone(this.paras())); const ps = this.undo.pop(); this.cfg.setParas(ps); this.draw(flatLen(ps)); this.cfg.onChange && this.cfg.onChange(this); bar && bar.refresh(); }
    doRedo() { if (!this.redo.length) return; this.undo.push(clone(this.paras())); const ps = this.redo.pop(); this.cfg.setParas(ps); this.draw(flatLen(ps)); this.cfg.onChange && this.cfg.onChange(this); bar && bar.refresh(); }
    destroy() { editors.delete(this); if (active === this) active = null; }
  }
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection(); if (!sel || !sel.anchorNode) return;
    for (const ed of editors) if (ed.el.isConnected && ed.el.contains(sel.anchorNode)) {
      const s = selOf(ed); if (s) { lastSel = { ed, s: s.s, e: s.e }; if (active !== ed) { active = ed; if (ed.cfg.onActive) ed.cfg.onActive(ed); } if (bar) { if (document.activeElement === ed.el) bar.show(); else bar.refresh(); } }
      return;
    }
  });

  // ---------------- شريط التنسيق ----------------
  // ctx: {getState(), touch(), editorsOf(area) → [Ed], tableCells() → [Ed]}
  class Bar {
    constructor(host, ctx) {
      this.host = host; this.ctx = ctx; this.tableAll = false; this.fontOpen = false; this.visible = false;
      host.innerHTML = '';
      const mk = (tag, cls, txt, attrs) => { const el = document.createElement(tag); if (cls) el.className = cls; if (txt != null) el.textContent = txt; if (attrs) Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k])); return el; };
      const btn = (cls, txt, title, fn) => {
        const b = mk('button', 'mfb ' + cls, txt, { type: 'button', title, 'aria-label': title, tabindex: '-1' });
        b.addEventListener('click', e => { e.preventDefault(); fn(); });
        return b;
      };
      this.lbl = mk('div', 'mfl'); this.scope = mk('span', 'mfs'); this.areaEl = mk('b'); this.lbl.append(this.areaEl, document.createTextNode(' · '), this.scope);
      const row = mk('div', 'mfr');
      this.fontBtn = btn('mf-font', 'الخط', 'نوع الخط', () => { this.fontOpen = !this.fontOpen; this.refresh(); });
      this.dec = btn('mf-sz', 'A−', 'تصغير الخط', () => this.step(-1));
      this.sz = mk('span', 'mf-szv', '—');
      this.inc = btn('mf-sz', 'A+', 'تكبير الخط', () => this.step(1));
      this.bBtn = btn('mf-b', 'B', 'غامق', () => this.toggle('b'));
      this.iBtn = btn('mf-i', 'I', 'مائل', () => this.toggle('i'));
      this.tBtn = btn('mf-t', 'الجدول كله', 'تنسيق الجدول كله بدل الخلية', () => { this.tableAll = !this.tableAll; this.refresh(); });
      // أزرار المحاذاة: يمين / وسط / يسار / ضبط (كشيدة). أيقونات SVG ثابتة (لا نص مستخدم).
      const NS = 'http://www.w3.org/2000/svg', ICON = { r: [14, 9, 14, 6], c: [14, 8, 14, 8], l: [14, 9, 14, 6], j: [14, 14, 14, 14] }, ALT = { r: 'محاذاة لليمين', c: 'توسيط', l: 'محاذاة لليسار', j: 'ضبط الأطراف (كشيدة)' };
      this.alBtns = {};
      D.AL.forEach(a => {
        const b = btn('mf-al mf-al-' + a, '', ALT[a], () => this.setAlign(a));
        const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 16 12'); svg.setAttribute('width', '16'); svg.setAttribute('height', '12'); svg.setAttribute('aria-hidden', 'true');
        ICON[a].forEach((w, k) => { const x = a === 'r' || a === 'j' ? 15 - w : (a === 'c' ? (16 - w) / 2 : 1); const ln = document.createElementNS(NS, 'line'); ln.setAttribute('x1', String(x + 0.5)); ln.setAttribute('x2', String(x + w - 0.5)); ln.setAttribute('y1', String(1.5 + k * 3)); ln.setAttribute('y2', String(1.5 + k * 3)); ln.setAttribute('stroke', 'currentColor'); ln.setAttribute('stroke-width', '1.4'); ln.setAttribute('stroke-linecap', 'round'); svg.appendChild(ln); });
        b.appendChild(svg); this.alBtns[a] = b;
      });
      this.alGrp = mk('span', 'mf-algrp'); D.AL.forEach(a => this.alGrp.appendChild(this.alBtns[a]));
      row.append(this.fontBtn, this.dec, this.sz, this.inc, this.bBtn, this.iBtn, this.alGrp, this.tBtn);
      this.pop = mk('div', 'mf-pop'); this.pop.hidden = true;
      D.PICK.forEach(k => { const f = D.FONTS[k]; const b = btn('mf-pi', f.label + (f.alwaysBold ? ' (غامق أصلاً)' : ''), f.label, () => { this.apply({ f: k }); this.fontOpen = false; this.refresh(); }); b.dataset.f = k; b.style.fontFamily = "'" + f.css + "', sans-serif"; this.pop.appendChild(b); });
      host.append(this.lbl, row, this.pop);
      // أي لمسة داخل الشريط (أزرار/قائمة الخط/الفراغات) لا تنقل التركيز ولا تمسح التحديد
      ['mousedown', 'pointerdown'].forEach(ev => host.addEventListener(ev, e => { e.preventDefault(); }));
      this._wire();
      this.refresh();
    }
    inEditors(n) { if (!n || !n.nodeType) return false; if (this.host.contains(n)) return true; for (const ed of editors) if (ed.el.contains(n)) return true; return false; }
    // إخفاء عند خروج التركيز: بعد رفع الإصبع/الفأرة (لا أثناء الضغط) كي لا ينزاح الهدف تحت الإصبع وتضيع النقرة
    _wire() {
      this._down = false; this._pend = false; let t = null;
      const check = () => { clearTimeout(t); t = null; const a = document.activeElement; if (!this.inEditors(a) || a === document.body) this.hide(); };
      const later = () => { clearTimeout(t); t = setTimeout(check, 0); };
      document.addEventListener('pointerdown', e => { this._down = true; this._pend = !this.inEditors(e.target); }, true);
      const up = () => { const was = this._down; this._down = false; if (was && this._pend) { this._pend = false; clearTimeout(t); t = setTimeout(check, 140); } };
      document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
      document.addEventListener('focusin', e => { if (!this.visible || this.inEditors(e.target)) return; if (this._down) this._pend = true; else later(); }, true);
    }
    // أبقِ العنصر المرجعي ثابتاً على الشاشة عند تغيّر ارتفاع ما فوقه (لا قفزة تمرير)
    _keep(anchorEl, fn) {
      const r0 = anchorEl && anchorEl.isConnected ? anchorEl.getBoundingClientRect().top : null; fn();
      if (r0 != null) { const d = anchorEl.getBoundingClientRect().top - r0; if (Math.abs(d) > 0.5) window.scrollBy(0, d); }
    }
    show() { this.visible = true; this.refresh(); }
    hide(force) {
      if (!this.visible && this.host.hidden) return; this.visible = false; this.fontOpen = false;
      const a = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      if (force) this.host.hidden = true; else this._keep(a, () => { this.host.hidden = true; });
    }
    place(ed) {
      const anchor = this.ctx.anchorOf ? this.ctx.anchorOf(ed) : ed.el;
      if (!anchor || !anchor.parentNode) return;
      if (this.host.hidden || this.host.nextSibling !== anchor || this.host.parentNode !== anchor.parentNode) {
        this._keep(ed.el, () => { anchor.parentNode.insertBefore(this.host, anchor); this.host.hidden = false; });
      }
    }
    cur() { return active && active.el.isConnected ? active : null; }
    info() {
      const ed = this.cur(); if (!ed) return null;
      const area = ed.cfg.area, st = this.ctx.getState(), base = st.base[area], ps = ed.paras(), sel = ed.sel(), tot = flatLen(ps);
      const picked = sel.e > sel.s;
      let scope;
      if (picked) scope = 'sel'; else if (area === 'table') scope = this.tableAll ? 'table' : 'cell'; else scope = 'area';
      let s0 = 0, e0 = tot;
      if (scope === 'sel') { s0 = sel.s; e0 = sel.e; }
      if (scope === 'table') {                        // قيم الجدول كله: نجمع الخلايا
        const cells = this.ctx.tableCells(); const all = cells.map(c => query(c.paras(), base, 0, flatLen(c.paras())));
        const q = {}; ['f', 's', 'b', 'i'].forEach(k => { q[k] = all.every(x => x[k] === all[0][k]) ? all[0][k] : null; }); q.first = all[0].first; return { ed, area, base, scope, q, n: 0 };
      }
      return { ed, area, base, scope, q: query(ps, base, s0, e0), n: e0 - s0, s0, e0 };
    }
    // المحاذاة الفعلية للفقرات المستهدفة (صريحة أو افتراض الحقل) أو null إن اختلفت
    alignState(I) {
      const def = D.AL_DEFAULT[I.area]; let list;
      if (I.scope === 'table') list = this.ctx.tableCells().map(c => c.paras()[0]);
      else { const sel = I.ed.sel(), ps = I.ed.paras(); list = parasIn(ps, sel.s, sel.e).map(i => ps[i]); }
      const v = list.map(p => (p && p.a) || def); return v.every(x => x === v[0]) ? v[0] : null;
    }
    setAlign(a) {
      const I = this.info(); if (!I || D.AL.indexOf(a) < 0) return;
      this.ctx.touch();
      if (I.scope === 'table') { this.ctx.tableCells().forEach(c => { c.snap(); c.cfg.setParas(setAlign(c.paras(), [0], a)); c.draw(); }); this.ctx.changed(); }
      else {
        const ed = I.ed, sel = ed.sel(), ps = setAlign(ed.paras(), parasIn(ed.paras(), sel.s, sel.e), a);
        ed.commit(ps, sel.s, false); ed.draw(sel.s, sel.e);          // التحديد كما هو بالضبط؛ الأنماط على مستوى الحرف لا تُمسّ
      }
      this.refresh();
    }
    refresh() {
      if (!this.visible) return;
      const I = this.info();
      if (!I) { this.hide(); return; }
      const { ed, area, scope, q } = I;
      this.place(ed);
      this.areaEl.textContent = AREA_LABEL[area];
      this.scope.textContent = scope === 'sel' ? (area === 'table' ? 'المحدد داخل الخلية (' + I.n + ' حرف)' : 'المحدد (' + I.n + ' حرف)') : scope === 'table' ? 'الجدول كله' : scope === 'cell' ? 'الخلية (صف ' + (ed.cfg.row + 1) + '، عمود ' + (ed.cfg.col + 1) + ')' : AREA_LABEL[area] + ' كاملاً';
      this.tBtn.hidden = area !== 'table'; this.tBtn.classList.toggle('on', this.tableAll);
      const fam = q.f ? D.FONTS[q.f] : null;
      this.fontBtn.textContent = (fam ? fam.label : 'خطوط مختلفة') + ' ▾';
      this.sz.textContent = q.s == null ? '—' : String(Math.round(q.s * 10) / 10);
      this.bBtn.classList.toggle('on', q.b === true); this.iBtn.classList.toggle('on', q.i === true);
      const as = this.alignState(I); D.AL.forEach(a => { const on = as === a; this.alBtns[a].classList.toggle('on', on); this.alBtns[a].setAttribute('aria-pressed', String(on)); });
      this.bBtn.setAttribute('aria-pressed', String(q.b === true)); this.iBtn.setAttribute('aria-pressed', String(q.i === true));
      const pt = (q.f && D.FONTS[q.f].alwaysBold); this.bBtn.disabled = !!pt; this.bBtn.title = pt ? 'PT Bold Heading غامق أصلاً' : 'غامق';
      if (this.pop.hidden !== !this.fontOpen) this._keep(ed.el, () => { this.pop.hidden = !this.fontOpen; });
      Array.from(this.pop.children).forEach(b => b.classList.toggle('on', b.dataset.f === q.f));
    }
    // يطبّق patch على النطاق الحالي
    apply(patch) {
      const I = this.info(); if (!I) { return; }
      const { ed, area, scope } = I, st = this.ctx.getState(); this.ctx.touch();
      const keys = Object.keys(patch);
      if (scope === 'sel') { const ps = applyPatch(ed.paras(), I.s0, I.e0, patch); ed.commit(ps, I.s0, false); ed.draw(I.s0, I.e0); }
      else if (scope === 'cell') { const ps = applyPatch(ed.paras(), 0, flatLen(ed.paras()), patch); ed.commit(ps, 0, false); }
      else if (scope === 'table') { Object.assign(st.base.table, patch); this.ctx.tableCells().forEach(c => { c.snap(); c.cfg.setParas(clearAttrs(c.paras(), keys)); c.draw(); }); this.ctx.changed(); }
      else {                                          // الحقل كاملاً: يتغير أساس الحقل وتُزال تجاوزات هذه الخاصية من نصه
        Object.assign(st.base[area], patch);
        this.ctx.editorsOf(area).forEach(x => { x.snap(); x.cfg.setParas(clearAttrs(x.paras(), keys)); x.draw(); });
        this.ctx.changed();
      }
      this.refresh();
    }
    toggle(k) {
      const I = this.info(); if (!I) return;
      if (k === 'b' && I.q.f && D.FONTS[I.q.f].alwaysBold) return;
      this.apply({ [k]: I.q[k] !== true });
    }
    step(dir) {
      const I = this.info(); if (!I) return;
      const cur = I.q.s != null ? I.q.s : I.q.first.s;
      const n = dir > 0 ? Math.floor(cur + 1e-6) + 1 : Math.ceil(cur - 1e-6) - 1;
      this.apply({ s: Math.min(D.SIZE_MAX, Math.max(D.SIZE_MIN, n)) });
    }
  }

  window.MemoEditor = {
    Ed, Bar, AREA_LABEL, editors,
    setBar(b) { bar = b; }, getActive: () => active,
    _t: { parasIn, setAlign, replaceRange, applyPatch, mapRange, clearAttrs, query, readParas, render, offsetOf, posOf, flatLen, locate }
  };
})();
