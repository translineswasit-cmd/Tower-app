/* inspection-editor.js — v335-C5r8
   محرر الكشف البصري للبرج: نافذة الكشف، بناء واجهة العوازل/السلاسل، قراءة/كتابة النموذج، حفظ الكشف والتعديل، تهيئة الكشف السابق، رصد الأقسام. منطق الحالة الموحدة (ops*) النقي والطابور يبقى بـ index.html.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
function openTowerModalImpl(lineName, towerNum, scrollY0) {
  towerGridScrollY = (typeof scrollY0 === 'number') ? scrollY0 : window.scrollY; // نحفظ موضع التمرير الحالي بشبكة الأبراج حتى نرجع له عند الإغلاق
  pushLevel(closeTowerInspectionModal);
  document.getElementById('f_line_name').value = lineName;
  // لو التاريخ فاضي، أو لو تغيّر اليوم الفعلي عن المكتوب بالحقل (مثلاً التطبيق ضل مفتوح بالخلفية
  // من يوم سابق)، نحدّثه لتاريخ اليوم الحقيقي تلقائياً — بدون ما يأثر على استمرار نفس جلسة العمل
  // بنفس اليوم (ما يلمس الحقل لو التاريخ مطابق أصلاً)
  const dateField = document.getElementById('f_inspection_date');
  const todayStr = new Date().toISOString().split('T')[0];
  if (!dateField.value || dateField.value !== todayStr) {
    dateField.value = todayStr;
  }
  const tSel = document.getElementById('f_tower_number');
  if (tSel.dataset.loadedFor !== lineName) {
    tSel.innerHTML = '<option value="">--</option>';
    getLineTowers(lineName).forEach(t => {
      const o = document.createElement('option');
      o.value = t.num; o.textContent = 'برج '+t.num+' — '+t.type; o.dataset.type = t.type; o.dataset.typeCode = t.type_code||'';
      tSel.appendChild(o);
    });
    tSel.dataset.loadedFor = lineName;
    tSel.disabled = false;
    currentVoltage = LINE_VOLTAGE[lineName];
    updateWiresGroundUI();
  }
  tSel.value = towerNum;
  onTowerChange();
  document.getElementById('modalTowerTitle').textContent = '🗼 برج رقم ' + towerNum;
  document.getElementById('towerInspectionModal').classList.add('show');
  // بدون هذا، فتح البرج التالي كان يبقي نافذة الكشف بنفس موضع التمرير القديم (عادة قرب الأسفل عند
  // زر الحفظ) بدل الرجوع لأعلاها — فتظهر الملاحظات مباشرة بدل قسم العوازل
  const modalBox = document.querySelector('#towerInspectionModal .modal-box');
  if (modalBox) modalBox.scrollTop = 0;
}

function closeTowerInspectionModal() {
  invalidatePrefill(); // v334: أي نتيجة متأخرة بعد الإغلاق تُهمل
  if (document.activeElement && document.activeElement !== document.body && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  document.getElementById('towerInspectionModal').classList.remove('show'); popLevelIfMatches(closeTowerInspectionModal);
  // نستعيد موضع التمرير المحفوظ (بعد لحظة قصيرة حتى تكتمل إعادة رسم الشبكة أولاً)
  if (!(editId && window._editOrigin)) setTimeout(() => window.scrollTo(0, towerGridScrollY), 0);   // v335-C6r12: عند العودة لأصل الأرشيف موضع التمرير يُستعاد من الأصل لا من شبكة الأبراج
  if (editId) { cancelEdit(); return; }
  resetTowerFieldsOnly();
}

function resetTowerFieldsOnly() {
  invalidatePrefill(); // v334
  discardPendingInspectionAttemptForForm(); // إلغاء صريح لمحاولة هذا النموذج المعلّقة (قبل مسح الحقول)
  document.getElementById('f_tower_number').value = '';
  document.getElementById('f_tower_type').value = '';
  document.getElementById('towerInfoBox').style.display = 'none';
  document.getElementById('insulatorSection').style.display = 'none';
  document.getElementById('incompleteBanner').style.display = 'none';
  FIELDS.forEach(f => { const el = document.getElementById('f_'+f); if (el) el.value=''; });
  Object.keys(SEVERITY_SECTION_MAP).forEach(onSeverityChange);
  insulatorState = {R:[],S:[],T:[]};
  _hPend = {}; _hSnap = {}; _hRoadClr = null; try { csHRefresh(); } catch (e) { /* UI only */ }   // v335-C6r15 (N21)
}

function onTowerChangeOriginal() {
  const sel = document.getElementById('f_tower_number');
  const opt = sel.selectedOptions[0];
  if (!opt || !opt.dataset.type) { document.getElementById('towerInfoBox').style.display='none'; document.getElementById('insulatorSection').style.display='none'; updateWiresGroundUI(); return; }
  const type = opt.dataset.type;       // النص العربي للعرض فقط (مثل "برج شد")
  const typeCode = opt.dataset.typeCode || type; // الكود الحقيقي (XC/XD/S/T...) لمنطق التصنيف
  document.getElementById('f_tower_type').value = typeCode;
  document.getElementById('towerTypeValue').textContent = type;
  document.getElementById('towerTypeDesc').textContent = TOWER_TYPES[type]||type;
  document.getElementById('towerInfoBox').style.display = 'block';
  buildInsulatorUI(currentVoltage, type);
  updateWiresGroundUI();
}

// يبني سلسلة بلاستيك (لولب SVG) قابلة للضغط
// يبني سلسلة بلاستيك (عازل مركّب واقعي: قضيب + مظلات متعاقبة كبيرة/صغيرة + كبّات معدنية طرفية)
// الطول = بالضبط نفس طول سلسلة الزجاج المقابلة (rows قرص × 14px + مسافات 2px)، بدل نصف الطول سابقاً
function buildPlasticChain(phase, chainIdx, stateObj, damaged, onToggle, rows) {
  rows = rows || 12;
  const w = 28;
  const h = rows * 14 + (rows - 1) * 2; // نفس معادلة طول سلسلة الزجاج بالضبط
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.style.cursor = 'pointer'; svg.style.display = 'block';

  const ns = 'http://www.w3.org/2000/svg';
  function el(tag, attrs) {
    const e = document.createElementNS(ns, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function paint(isDamaged) {
    svg.innerHTML = '';
    const metal = '#5A5F63';
    const rodColor = isDamaged ? '#C53030' : '#8A949C';
    const shedColor = isDamaged ? '#E57373' : '#9AA4AC';
    const cx = w / 2;
    const capH = Math.max(6, h * 0.08);

    // كبّة معدنية علوية (كروية + طوق)
    svg.appendChild(el('circle', { cx, cy: capH * 0.4, r: 3.2, fill: metal }));
    svg.appendChild(el('rect', { x: cx - 3, y: 0, width: 6, height: capH, fill: metal }));

    const bodyTop = capH, bodyBottom = h - capH, bodyH = bodyBottom - bodyTop;

    // القضيب المركزي
    svg.appendChild(el('rect', { x: cx - 2, y: bodyTop, width: 4, height: bodyH, fill: rodColor }));

    // المظلات: كبيرة/صغيرة بالتناوب (نفس شكل عازل RUILY)
    const nPairs = Math.max(2, Math.round(rows / 2));
    const step = bodyH / (nPairs * 2);
    const bigW = 15, smallW = 10;
    for (let i = 0; i < nPairs * 2; i++) {
      const y = bodyTop + step * (i + 0.5);
      const sw = (i % 2 === 0) ? bigW : smallW;
      const path = `M ${cx-1.5} ${y-2.5}
        C ${cx-sw/2} ${y-1.5}, ${cx-sw/2} ${y+1.5}, ${cx-1.8} ${y+3.2}
        L ${cx+1.8} ${y+3.2}
        C ${cx+sw/2} ${y+1.5}, ${cx+sw/2} ${y-1.5}, ${cx+1.5} ${y-2.5} Z`;
      svg.appendChild(el('path', { d: path, fill: shedColor }));
    }

    // كبّة معدنية سفلية
    svg.appendChild(el('circle', { cx, cy: h - capH * 0.4, r: 3.2, fill: metal }));
    svg.appendChild(el('rect', { x: cx - 3, y: bodyBottom, width: 6, height: capH, fill: metal }));

    // خلفية شفافة للضغط (تغطي كامل المساحة)
    svg.appendChild(el('rect', { x: 0, y: 0, width: w, height: h, fill: 'transparent' }));
  }

  let isDmg = !!damaged;
  paint(isDmg);

  if (currentUser.role !== 'readonly') {
    svg.addEventListener('click', () => {
      isDmg = !isDmg;
      paint(isDmg);
      onToggle(isDmg);
    });
  }

  // تأشيرة "بلاستيك"
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px';
  const lbl = document.createElement('div');
  lbl.textContent = 'polymer';
  lbl.style.cssText = 'font-size:0.5rem;color:#2B6CB0;font-weight:700;background:#EBF8FF;padding:1px 4px;border-radius:4px';
  wrapper.appendChild(lbl);
  wrapper.appendChild(svg);
  return wrapper;
}

// يبني سلسلة خزف (عازل قديم صلب: قضيب + مظلات كبيرة متساوية الحجم، بني غامق) — لا تُستخدم إلا كحالة موجودة أصلاً بأبراج قديمة
function buildCeramicChain(phase, chainIdx, stateObj, damaged, onToggle, rows) {
  rows = rows || 12;
  const w = 28;
  const h = rows * 14 + (rows - 1) * 2; // نفس معادلة طول سلسلة الزجاج بالضبط
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.style.cursor = 'pointer'; svg.style.display = 'block';

  const ns = 'http://www.w3.org/2000/svg';
  function el(tag, attrs) {
    const e = document.createElementNS(ns, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function paint(isDamaged) {
    svg.innerHTML = '';
    const metal = '#7A7A7A';
    const rodColor = isDamaged ? '#C53030' : '#5C2A21';
    const shedColor = isDamaged ? '#E57373' : '#6B3025';
    const cx = w / 2;
    const capH = Math.max(6, h * 0.09);

    svg.appendChild(el('rect', { x: cx - 4, y: 0, width: 8, height: capH, fill: metal }));
    svg.appendChild(el('circle', { cx, cy: capH * 0.4, r: 2.8, fill: metal }));

    const bodyTop = capH, bodyBottom = h - capH, bodyH = bodyBottom - bodyTop;
    svg.appendChild(el('rect', { x: cx - 2.5, y: bodyTop, width: 5, height: bodyH, fill: rodColor }));

    // مظلات كبيرة متساوية الحجم (خيار أ) — أعرض وأقرب لبعضها من البلاستك، بلا تناوب كبير/صغير
    const nSheds = Math.max(3, Math.round(rows / 2));
    const step = bodyH / nSheds;
    const shedW = 20;
    for (let i = 0; i < nSheds; i++) {
      const y = bodyTop + step * (i + 0.5);
      const path = `M ${cx-2} ${y-3}
        C ${cx-shedW/2} ${y-2}, ${cx-shedW/2} ${y+2}, ${cx-2.3} ${y+4.2}
        L ${cx+2.3} ${y+4.2}
        C ${cx+shedW/2} ${y+2}, ${cx+shedW/2} ${y-2}, ${cx+2} ${y-3} Z`;
      svg.appendChild(el('path', { d: path, fill: shedColor }));
    }

    svg.appendChild(el('rect', { x: cx - 4, y: bodyBottom, width: 8, height: capH, fill: metal }));
    svg.appendChild(el('circle', { cx, cy: h - capH * 0.4, r: 2.8, fill: metal }));

    svg.appendChild(el('rect', { x: 0, y: 0, width: w, height: h, fill: 'transparent' }));
  }

  let isDmg = !!damaged;
  paint(isDmg);

  if (currentUser.role !== 'readonly') {
    svg.addEventListener('click', () => {
      isDmg = !isDmg;
      paint(isDmg);
      onToggle(isDmg);
    });
  }

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px';
  const lbl = document.createElement('div');
  lbl.textContent = 'خزف';
  lbl.style.cssText = 'font-size:0.5rem;color:#5C2A21;font-weight:700;background:#F5E9E6;padding:1px 4px;border-radius:4px';
  wrapper.appendChild(lbl);
  wrapper.appendChild(svg);
  return wrapper;
}

// يبني زر التبديل بين زجاج/بلاستيك/خزف: أيقونة دوران صغيرة (v335-C6r9d).
// الزجاج هو الافتراضي المعتمد من المالك ما لم تُحفظ مادة أخرى عبر كشف أو حالة الخط؛ لا كتابة جماعية لهذا الافتراض ببيانات الإنتاج (لا تُرسَل مادة لدائرة لم يُغيّر الفني فيها شيئاً).
// تغيير المادة لا يمسّ مواضع الضرر ولا دورات المعالجة (المادة وصف للسلسلة وليست استبدالاً لعوازلها).
const CS_MAT_AR = { glass: 'زجاج', plastic: 'بلاستك', ceramic: 'خزف' };
function buildChainToggleBtn(phase, chainIdx, stateObj, cycleObj, rows, onRebuild, typesObj) {
  typesObj = typesObj || chainTypes; // الافتراضي: الدائرة الأولى (للتوافق مع أي نداء قديم)
  const circuit = (typesObj === chainTypes2) ? 2 : 1;
  const CYCLE_NEXT = { glass: 'plastic', plastic: 'ceramic', ceramic: 'glass' };
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mat-rotate-btn';
  const cur0 = (typesObj[phase] || [])[chainIdx] || 'glass';
  btn.textContent = '🔄';
  btn.title = 'نوع السلسلة: ' + (CS_MAT_AR[cur0] || CS_MAT_AR.glass) + ' — اضغط للتبديل (زجاج → بلاستك → خزف)';
  btn.setAttribute('aria-label', btn.title);
  btn.style.cssText = 'font-size:0.65rem;padding:1px 5px;border:1px solid #CBD5E0;border-radius:8px;background:#F7FAFC;cursor:pointer;margin-bottom:2px';
  btn.addEventListener('click', () => {
    if (!typesObj[phase]) typesObj[phase] = [];
    const cur = typesObj[phase][chainIdx] || 'glass';
    typesObj[phase][chainIdx] = CYCLE_NEXT[cur] || 'glass';
    try { csChainMarkProvisional(circuit, phase, chainIdx); } catch (e) {}
    onRebuild();
  });
  return btn;
}

function csInsCircuitUnknown(c) {
  const sid = c === 1 ? 'ins1' : 'ins2';
  const b = _opsBaseline;
  if (!b || b.line !== _v('f_line_name') || b.tower !== _v('f_tower_number') || b.mode === 'blank') return true;
  return !b.inherited[sid];
}
// =====================================================================================================================================
// v335-C6r15 (N21): خانة «سليم» لكل قسم قابل للتطبيق + خانة رئيسية أعلى النموذج.
//  - التحديد صريح: قسم بلا ضرر يصير «سليماً» فوراً؛ قسم فيه ضرر/مغادرة (موروثة أو مُدخَلة الآن) يُظهر تحذيراً بجانبه ولا يُستبدل ضرره إلا بتأكيد صريح لذلك القسم وحده.
//  - قبل التأكيد: تبقى النتائج كما هي ولا يُحفظ القسم سليماً. الرفض يُبقيها. حالة الخانة مشتقّة دائماً من قيم النموذج (لا تُعرض علامة سليم بوجود ضرر أحمر).
//  - الدائرتان مستقلتان (عوازل/أسلاك): تحديد إحداهما لا يمسّ الأخرى. الأقسام غير المنطبقة (الدائرة الثانية بخط مفرد، نظافة العوازل، وجود الطريق) مستثناة.
//  - لا يمسّ المواد ولا الدورات التاريخية (تُعدَّل أعلام الضرر فقط) ولا يُنشئ عمليات جديدة: الحفظ عبر opsBuildObservation كما هو (الأقسام المتغيّرة صراحةً فقط).
// =====================================================================================================================================
const CS_H = {
  ins1: { kind: 'ins', c: 1, sev: 'f_sev_insulator', texts: [], label1: 'عوازل الدائرة الأولى سليمة', labelS: 'العوازل سليمة', name: 'عوازل الدائرة الأولى', nameS: 'العوازل' },
  ins2: { kind: 'ins', c: 2, double: true, sev: 'f_sev_insulator', texts: [], label1: 'عوازل الدائرة الثانية سليمة', name: 'عوازل الدائرة الثانية' },
  iron: { kind: 'sev', sec: 'iron', sev: 'f_sev_iron', texts: ['f_iron_intersections'], label1: 'تقاطعات الحديد سليمة', name: 'تقاطعات الحديد' },
  foundation: { kind: 'sev', sec: 'foundation', sev: 'f_sev_foundation', texts: ['f_tower_foundations'], label1: 'قواعد البرج سليمة', name: 'قواعد البرج' },
  wires1: { kind: 'wires', c: 1, sec: 'wires', sev: 'f_sev_wires', texts: ['f_wires_r1', 'f_wires_s1', 'f_wires_t1'], label1: 'أسلاك الدائرة الأولى سليمة', labelS: 'الأسلاك سليمة', name: 'أسلاك الدائرة الأولى', nameS: 'الأسلاك' },
  wires2: { kind: 'wires', c: 2, double: true, sec: 'wires', sev: 'f_sev_wires', texts: ['f_wires_r1_c2', 'f_wires_s1_c2', 'f_wires_t1_c2'], label1: 'أسلاك الدائرة الثانية سليمة', name: 'أسلاك الدائرة الثانية' },
  ground: { kind: 'sev', sec: 'ground', sev: 'f_sev_ground', texts: ['f_ground_1', 'f_ground_2'], label1: 'الأرضي سليم', name: 'الأرضي' },
  fire: { kind: 'sev', sec: 'fire', sev: 'f_sev_fire', texts: ['f_fire_causes_notes'], label1: 'مسببات الحرائق سليمة', name: 'مسببات الحرائق' },
  // v335-C6r15 (N21 تصحيح): نظافة العوازل ووجود الطريق ضمن الخانات والرئيسية؛ «السليم» = القيمة القائمة (نظيف / متاح)
  washing: { kind: 'wash', sev: 'f_insulator_washing', texts: [], okVal: 'clean', label1: 'نظافة العوازل: نظيفة', name: 'نظافة العوازل' },
  road: { kind: 'road', sev: 'f_road_access', texts: ['f_road_access_notes'], okVal: 'متاح', label1: 'وجود الطريق: متاح', name: 'وجود الطريق' }
};
const CS_H_ORDER = ['ins1', 'ins2', 'iron', 'foundation', 'wires1', 'wires2', 'ground', 'fire', 'washing', 'road'];
const CS_H_VAL = { needs_washing: 'يحتاج غسل', very_dirty: 'ملوث جداً' };
const CS_H_SEV = { simple: 'مغادرة بسيطة', moderate: 'مغادرة متوسطة', below_critical: 'مغادرة دون الحرجة', critical: 'مغادرة حرجة' };
let _hPend = {};          // id -> { base, fp, findings }  تأكيد معلّق (مربوط بسياق البرج ولقطة قيم القسم؛ أي تغيير يُسقطه)
let _hSnap = {};          // id -> لقطة ما قبل التطبيق للتراجع (صالحة فقط بنفس السياق وبلا تعديل لاحق)
let _hPrev = {};          // selectId -> آخر قيمة درجة معروفة (لإرجاع القائمة عند طلب «سليم» يستلزم تأكيداً)
let _hRoadClr = null;     // مسح مؤكَّد لملاحظات الطريق (يُرسل clear_road_notes مع الرصد فقط)
let _hBuildArgs = null;   // آخر وسائط buildInsulatorUI لإعادة رسم العوازل بعد تغيير الأعلام

function csHDouble() { try { return isDoubleCircuitLine(_v('f_line_name')); } catch (e) { return false; } }
function csHEl(id) { return document.getElementById(id); }
function csHApplicable(id) {
  const m = CS_H[id]; if (!m) return false;
  if (m.double && !csHDouble()) return false;
  if (m.kind === 'ins' || m.kind === 'wash') { const s = csHEl('insulatorSection'); return !!s && s.style.display !== 'none' && !!_v('f_tower_number'); }
  return !!(_v('f_line_name') && _v('f_tower_number'));
}
function csHTextAdv(v) { v = String(v || '').trim(); return v !== '' && v !== 'سليم'; }
function csHRed(c) {
  const st = c === 1 ? insulatorState : insulatorState2; let total = 0; const parts = [];
  OPS_PH.forEach(ph => { const n = (st && Array.isArray(st[ph])) ? st[ph].filter(x => x === true).length : 0; if (n) { total += n; parts.push(ph + '×' + n); } });
  return { total, txt: parts.join('، ') };
}
function csHShort(t) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > 40 ? t.slice(0, 40) + '…' : t; }
// ما يحتويه القسم من ضرر/مغادرة (نصوص أو علامات حمراء) — يُفقد عند الاستبدال بـ«سليم»
function csHTextLoss(id) {
  const m = CS_H[id];
  if (m.kind === 'ins') return csHRed(m.c).total > 0;
  if (m.kind === 'wash') return false;
  return m.texts.some(i => csHTextAdv(_v(i)));
}
// كل النتائج السلبية (تشمل درجة الخطورة غير السليمة) للتحذير
function csHFindings(id) {
  const m = CS_H[id], out = []; const sv = _v(m.sev); const sevAdv = !!sv && sv !== 'ok'; const sevTxt = CS_H_SEV[sv] || sv;
  if (m.kind === 'ins') {
    const red = csHRed(m.c); if (red.total) out.push('علامات ضرر حمراء: ' + red.txt);
    if (m.c === 1 && sevAdv && (red.total || !(csHDouble() && csHRed(2).total))) out.push('درجة الخطورة: ' + sevTxt);
    return out;
  }
  if (m.kind === 'wash') { if (sv && sv !== m.okVal) out.push('نظافة العوازل: ' + (CS_H_VAL[sv] || sv)); return out; }
  if (m.kind === 'road') {
    if (sv && sv !== m.okVal) { out.push('وجود الطريق: ' + sv); if (_v('f_road_access_notes')) out.push('ملاحظات: ' + csHShort(_v('f_road_access_notes'))); }
    else if (_v('f_road_access_notes')) out.push('ملاحظات الطريق: ' + csHShort(_v('f_road_access_notes')));   // ملاحظات قائمة لا تُخفى لتبدو الخانة سليمة
    return out;
  }
  if (m.kind === 'sev') {
    if (sevAdv) out.push('درجة الخطورة: ' + sevTxt);
    m.texts.forEach(i => { if (csHTextAdv(_v(i))) out.push(csHShort(_v(i))); });
    return out;
  }
  const own = m.texts.filter(i => csHTextAdv(_v(i)));
  const anyAdv = own.length || (csHDouble() && CS_H[m.c === 1 ? 'wires2' : 'wires1'].texts.some(i => csHTextAdv(_v(i))));
  if (own.length) { if (sevAdv) out.push('درجة الخطورة: ' + sevTxt); own.forEach(i => out.push(csHShort(_v(i)))); }
  else if (m.c === 1 && sevAdv && !anyAdv) out.push('درجة الخطورة: ' + sevTxt);
  return out;
}
function csHIsHealthy(id) {
  const m = CS_H[id]; if (csHFindings(id).length) return false;
  if (m.kind === 'ins') return !!_insHealthy[m.c] || !csInsCircuitUnknown(m.c) || !!(typeof editId !== 'undefined' && editId);   // في تعديل سجل محفوظ: حالة السجل صريحة
  if (m.kind === 'sev') return _v(m.sev) === 'ok';
  if (m.kind === 'wash') return _v(m.sev) === m.okVal;
  if (m.kind === 'road') return _v(m.sev) === m.okVal && !_v('f_road_access_notes');
  let known = false; try { known = opsSectionHasData(id, _v('f_line_name'), _v('f_tower_number')); } catch (e) { known = false; }
  return csHCircuitEvidence(id) || (_v(m.sev) === 'ok' && known);
}
// دليل سلامة دائرة أسلاك: نصوصها كلها «سليم»، أو حالتها المحفوظة معروفة وسليمة (النصوص تُفرَّغ من النموذج حين تُختار الدائرة الأخرى للمغادرة)
function csHCircuitEvidence(id) {
  const m = CS_H[id]; if (m.texts.every(i => _v(i) === 'سليم')) return true;
  if (m.texts.some(i => _v(i) !== '')) return false;
  try {
    if (!_opsBaseline || _opsBaseline.mode === 'blank' || _opsBaseline.line !== _v('f_line_name') || _opsBaseline.tower !== _v('f_tower_number')) return false;
    const env = opsEnvKnown(_v('f_line_name'), _v('f_tower_number')); const sfx = m.c === 2 ? '_c2' : '';
    return ['wire_r1', 'wire_s1', 'wire_t1'].every(k => { const c = opsCompOf(env, k + sfx); return !!c && c.ds === 'known' && c.cond === 'ok'; });
  } catch (e) { return false; }
}
function csHFp(id) {
  const m = CS_H[id]; let v = null; try { v = opsSectionVals()[id]; } catch (e) { v = null; }
  return JSON.stringify([_v('f_line_name'), _v('f_tower_number'), v, _v(m.sev), id === 'wires1' || id === 'wires2' ? _v('f_wires_circuit') : null]);
}
function csHEls(id) {
  const m = CS_H[id]; const l = [m.sev].concat(m.texts); if (m.kind === 'wires') l.push('f_wires_circuit'); return l;
}
function csHRebuildIns() {
  if (!_hBuildArgs) return;
  try { buildInsulatorUI(_hBuildArgs.voltage, _hBuildArgs.towerType, insulatorState, insulatorCycleState, insulatorState2, insulatorCycleState2, chainTypes, chainTypes2); } catch (e) { console.warn('[tower-app] N21 insulator rebuild failed', e); }
}
function csHSyncBlocks(id) {
  const m = CS_H[id]; if (m.kind === 'ins' || m.kind === 'wash' || m.kind === 'road') return;
  const sev = _v(m.sev), adv = !!sev && sev !== 'ok';
  if (m.kind === 'wires' && csHDouble()) {
    const circ = _v('f_wires_circuit'); const cb = csHEl('block_wires_circuit'), b1 = csHEl('block_wires'), b2 = csHEl('block_wires_c2');
    if (cb) cb.style.display = adv ? '' : 'none';
    if (b1) b1.style.display = adv && (circ === '1' || circ === 'both') ? '' : 'none';
    if (b2) b2.style.display = adv && (circ === '2' || circ === 'both') ? '' : 'none';
    return;
  }
  const blk = csHEl(m.kind === 'wires' ? 'block_wires' : SEVERITY_SECTION_MAP[m.sec].blockId); if (blk) blk.style.display = adv ? '' : 'none';
}
function csHSnapTake(id) {
  const m = CS_H[id]; const snap = { base: _opsBaseline, vals: {}, ins: null, fp: null };
  csHEls(id).forEach(i => { const el = csHEl(i); if (el) snap.vals[i] = el.value; });
  if (m.kind === 'ins') { const st = m.c === 1 ? insulatorState : insulatorState2; snap.ins = { state: JSON.parse(JSON.stringify(st || {})), healthy: !!_insHealthy[m.c] }; }
  _hSnap[id] = snap;
}
function csHSnapValid(id) { const s = _hSnap[id]; return !!s && s.base === _opsBaseline && s.fp === csHFp(id); }
// تطبيق «سليم» على قسم واحد (بعد التحقق من عدم وجود ضرر أو بعد التأكيد الصريح)
function csHApply(id) {
  const m = CS_H[id]; csHSnapTake(id); _prefillUserEdited = true;
  if (m.kind === 'ins') {
    const st = m.c === 1 ? insulatorState : insulatorState2;
    OPS_PH.forEach(ph => { if (st && Array.isArray(st[ph])) st[ph] = st[ph].map(() => false); });
    _insHealthy[m.c] = true;
    const other = m.c === 1 ? 2 : 1; const redOther = csHDouble() && csHRed(other).total > 0;
    const sel = csHEl('f_sev_insulator'); if (sel && !redOther && sel.value && sel.value !== 'ok') sel.value = 'ok';   // الشدة لا تُرفع إلى «سليم» وفي الدائرة الأخرى ضرر قائم
    csHRebuildIns();
  } else if (m.kind === 'wash' || m.kind === 'road') {
    if (m.kind === 'road' && _v('f_road_access_notes')) _hRoadClr = { base: _opsBaseline, line: _v('f_line_name'), tower: _v('f_tower_number') };   // مسح صريح مؤكَّد لملاحظات الطريق => يُرسَل للخادم
    csHEl(m.sev).value = m.okVal; m.texts.forEach(i => { csHEl(i).value = ''; });   // الطريق: تُفرَّغ الملاحظات المرتبطة بالضرر بعد التأكيد
  } else if (m.kind === 'sev') {
    csHEl(m.sev).value = 'ok'; onSeverityChange(m.sec);
    if (id === 'ground') { const g2 = csHEl('groundBlock2'); if (g2 && g2.style.display === 'none' && csHEl('f_ground_2')) csHEl('f_ground_2').value = ''; }   // لا يُختلق أرضي ثانٍ لبرج بأرضي واحد
  } else if (!csHDouble()) {
    csHEl(m.sev).value = 'ok'; onSeverityChange('wires');
  } else {
    m.texts.forEach(i => { csHEl(i).value = 'سليم'; });
    const o = CS_H[m.c === 1 ? 'wires2' : 'wires1'];
    if (!o.texts.some(i => csHTextAdv(_v(i)))) {
      csHEl('f_sev_wires').value = 'ok';
      const oid = m.c === 1 ? 'wires2' : 'wires1';
      if (csHCircuitEvidence(oid)) { o.texts.forEach(i => { if (_v(i) === '') csHEl(i).value = 'سليم'; }); csHEl('f_wires_circuit').value = ''; }   // الدائرتان سليمتان صراحةً: لا دائرة مغادرة (سلامة الأخرى المحفوظة تُعرض صراحةً)
    }
    csHSyncBlocks(id);
  }
  _hSnap[id].fp = csHFp(id);
}
function csHRestore(id) {
  const m = CS_H[id]; const s = _hSnap[id]; if (!s) return false;
  Object.keys(s.vals).forEach(i => { const el = csHEl(i); if (el) el.value = s.vals[i]; });
  if (m.kind === 'ins' && s.ins) {
    const st = m.c === 1 ? insulatorState : insulatorState2;
    OPS_PH.forEach(ph => { if (st && s.ins.state && Array.isArray(s.ins.state[ph])) st[ph] = s.ins.state[ph].slice(); });
    _insHealthy[m.c] = s.ins.healthy; csHRebuildIns();
  } else csHSyncBlocks(id);
  if (id === 'road') _hRoadClr = null;
  delete _hSnap[id]; _prefillUserEdited = true; return true;
}
// طلب «سليم» لقسم: بلا نتائج => يُطبَّق فوراً؛ مع نتائج => تأكيد معلّق بجانب القسم (النتائج محفوظة وغير مُعدَّلة)
function csHRequest(id) {
  if (!csHApplicable(id)) return;
  delete _hPend[id];
  if (csHIsHealthy(id)) return;
  const f = csHFindings(id);
  if (f.length) { _hPend[id] = { base: _opsBaseline, fp: csHFp(id), findings: f }; _prefillUserEdited = true; return; }
  csHApply(id);
}
function csHConfirm(id) {
  const p = _hPend[id]; delete _hPend[id];
  if (p && p.base === _opsBaseline && p.fp === csHFp(id) && csHApplicable(id)) csHApply(id);
  csHRefresh();
}
function csHDecline(id) { delete _hPend[id]; csHRefresh(); }
function csHUncheck(id) {
  delete _hPend[id];
  if (csHSnapValid(id)) csHRestore(id);
  else if (CS_H[id].kind === 'ins' && _insHealthy[CS_H[id].c]) { _insHealthy[CS_H[id].c] = false; _prefillUserEdited = true; }
  else if (csHIsHealthy(id)) { try { showToast('ℹ️ هذا القسم سليم بحسب القيم الحالية؛ للتغيير عدّل القيمة نفسها (الدرجة/النص/العوازل)'); } catch (e) { /* UI only */ } }
}
function csHOnToggle(id, on) { if (on) csHRequest(id); else csHUncheck(id); csHRefresh(); }
function csHMaster(on) {
  const ids = CS_H_ORDER.filter(csHApplicable);
  if (on) ids.forEach(id => { if (!csHIsHealthy(id)) csHRequest(id); });
  else ids.slice().reverse().forEach(id => { delete _hPend[id]; if (csHSnapValid(id) && csHIsHealthy(id)) csHRestore(id); else if (CS_H[id].kind === 'ins' && _insHealthy[CS_H[id].c] && csHIsHealthy(id)) _insHealthy[CS_H[id].c] = false; });
  csHRefresh();
  if (on) { const w = document.querySelector('[data-h-warn]:not([style*="display: none"])'); if (w && typeof w.scrollIntoView === 'function') { try { w.scrollIntoView({ block: 'center' }); } catch (e) { /* UI only */ } } }
}
// طلب «سليم» من قائمة الدرجة: يُرجَع المحدَّد إلى قيمته السابقة إن كان في الأقسام المعنيّة ضرر مُدخَل (حتى يُؤكَّد)
function csHSevOk(selId, ids) {
  const sel = csHEl(selId); if (!sel) return;
  ids = ids.filter(csHApplicable);
  const loss = ids.filter(csHTextLoss);
  if (loss.length) sel.value = (_hPrev[selId] === undefined) ? '' : _hPrev[selId];
  ids.forEach(id => { delete _hPend[id]; if (loss.indexOf(id) >= 0) csHRequest(id); else csHApply(id); });
  if (!loss.length) sel.value = 'ok';
  _prefillUserEdited = true; csHRefresh();
}
// تغيير المستخدم لقائمة الدرجة (يستبدل onchange القديم): «سليم» يمرّ عبر بوابة التأكيد؛ غيره كما كان
function onSeverityUserChange(section) {
  const sel = csHEl('f_sev_' + section); if (!sel) return;
  if (sel.value !== 'ok') { _hPrev[sel.id] = sel.value; onSeverityChange(section); csHRefresh(); return; }
  const ids = section === 'wires' ? (csHDouble() ? ['wires1', 'wires2'] : ['wires1']) : [section];
  csHSevOk(sel.id, ids);
}
function csHBuild(id) {
  const m = CS_H[id]; const box = document.createElement('div'); box.setAttribute('data-h-box', id);
  box.style.cssText = 'margin:2px 0 8px;text-align:right';
  if (m.kind === 'ins') { box.setAttribute('data-ins-healthy-box', String(m.c)); box.style.textAlign = 'center'; }
  const lab = document.createElement('label'); lab.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:0.82rem;padding:5px 10px;border-radius:8px;border:1.5px solid #A0AEC0;background:#fff;cursor:pointer';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.setAttribute('data-h-cb', id); if (m.kind === 'ins') cb.setAttribute('data-ins-healthy', String(m.c));
  cb.addEventListener('change', () => csHOnToggle(id, cb.checked));
  const sp = document.createElement('span'); sp.setAttribute('data-h-label', id);
  lab.appendChild(cb); lab.appendChild(sp); box.appendChild(lab);
  const w = document.createElement('div'); w.setAttribute('data-h-warn', id); w.style.cssText = 'display:none;margin:6px 0;padding:8px 10px;border:1.5px solid #C05621;background:#FFFAF0;border-radius:8px;font-size:0.8rem;color:#7B341E;text-align:right;line-height:1.7';
  const wt = document.createElement('div'); wt.setAttribute('data-h-warn-text', id); w.appendChild(wt);
  const bc = document.createElement('button'); bc.type = 'button'; bc.setAttribute('data-h-confirm', id); bc.textContent = '✔ تأكيد الاستبدال بـ«سليم»';
  bc.style.cssText = 'margin:4px 0 0 6px;font-family:inherit;font-size:0.78rem;padding:4px 10px;border-radius:8px;border:1.5px solid #276749;background:#C6F6D5;color:#22543D;cursor:pointer';
  bc.addEventListener('click', () => csHConfirm(id));
  const bd = document.createElement('button'); bd.type = 'button'; bd.setAttribute('data-h-decline', id); bd.textContent = '✖ إبقاء الضرر';
  bd.style.cssText = 'margin:4px 0 0 6px;font-family:inherit;font-size:0.78rem;padding:4px 10px;border-radius:8px;border:1.5px solid #A0AEC0;background:#fff;color:#4A5568;cursor:pointer';
  bd.addEventListener('click', () => csHDecline(id));
  w.appendChild(bc); w.appendChild(bd); box.appendChild(w);
  return box;
}
function csInsHealthyBox(c) { return csHBuild(c === 2 ? 'ins2' : 'ins1'); }
// يُنشئ (مرة واحدة) الخانات الثابتة: الأقسام النصية + الخانة الرئيسية. العوازل تُنشأ مع كل إعادة رسم لها.
function csHEnsure() {
  const put = (id, anchorEl, before) => {
    if (document.querySelector('[data-h-box="' + id + '"]') || !anchorEl) return;
    const box = csHBuild(id);
    if (before) anchorEl.parentNode.insertBefore(box, anchorEl); else anchorEl.parentNode.insertBefore(box, anchorEl.nextSibling);
  };
  ['iron', 'foundation', 'ground', 'fire', 'washing', 'road'].forEach(id => { const s = csHEl(CS_H[id].sev); put(id, s && s.closest('.field'), true); });
  put('wires1', csHEl('wiresSpanHint'), false);
  put('wires2', document.querySelector('[data-h-box="wires1"]'), false);
  if (!document.querySelector('[data-h-master]')) {
    const anchor = csHEl('insulatorSection'); if (!anchor) return;
    const mb = document.createElement('div'); mb.setAttribute('data-h-master', ''); mb.style.cssText = 'margin:8px 0 10px;padding:8px 10px;border:1.5px solid #276749;border-radius:10px;background:#F0FFF4;text-align:right';
    const lab = document.createElement('label'); lab.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:0.86rem;font-weight:700;color:#22543D;cursor:pointer';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.setAttribute('data-h-master-cb', '');
    cb.addEventListener('change', () => csHMaster(cb.checked));
    const sp = document.createElement('span'); sp.textContent = 'تسجيل كل أقسام هذا البرج سليمة';
    lab.appendChild(cb); lab.appendChild(sp); mb.appendChild(lab);
    const note = document.createElement('div'); note.style.cssText = 'font-size:0.72rem;color:#4A5568;margin-top:3px'; note.setAttribute('data-h-master-note', '');
    note.textContent = 'يشمل كل أقسام الكشف: العوازل (كل دائرة)، نظافة العوازل (نظيفة)، تقاطعات الحديد، القواعد، الأسلاك (كل دائرة)، الأرضي، مسببات الحرائق، وجود الطريق (متاح). القسم الذي فيه ضرر مسجّل يحتاج تأكيده بنفسه.';
    mb.appendChild(note);
    const cnt = document.createElement('div'); cnt.setAttribute('data-h-master-pending', ''); cnt.style.cssText = 'font-size:0.78rem;color:#7B341E;margin-top:3px;display:none'; mb.appendChild(cnt);
    anchor.parentNode.insertBefore(mb, anchor);
  }
}
function csHRefresh() {
  try { csHEnsure(); } catch (e) { console.warn('[tower-app] N21 ensure failed', e); }
  const dbl = csHDouble(); let nApp = 0, nOk = 0, nPend = 0;
  CS_H_ORDER.forEach(id => {
    const m = CS_H[id];
    document.querySelectorAll('[data-h-box="' + id + '"]').forEach(box => {
      const app = csHApplicable(id); box.style.display = app ? '' : 'none';
      const cb = box.querySelector('[data-h-cb]'), sp = box.querySelector('[data-h-label]'), w = box.querySelector('[data-h-warn]'), wt = box.querySelector('[data-h-warn-text]');
      if (!app) { delete _hPend[id]; if (w) w.style.display = 'none'; return; }
      const f = csHFindings(id);
      if (m.kind === 'ins' && f.length && _insHealthy[m.c] && csHRed(m.c).total) _insHealthy[m.c] = false;   // ظهر ضرر بعد التسجيل: لا علم «سليم» قائم
      let p = _hPend[id];
      if (p && (p.base !== _opsBaseline || p.fp !== csHFp(id) || !f.length)) { delete _hPend[id]; p = null; }
      const healthy = csHIsHealthy(id);
      cb.checked = healthy;
      sp.textContent = '🟢 ' + (dbl ? m.label1 : (m.labelS || m.label1)) + (dbl && (m.kind === 'ins' || m.kind === 'wires') ? ' — لا يمسّ الدائرة الأخرى' : '');
      cb.parentNode.style.borderColor = healthy ? '#276749' : (p ? '#C05621' : '#A0AEC0'); cb.parentNode.style.background = healthy ? '#C6F6D5' : '#fff';
      if (p) {
        w.style.display = '';
        wt.textContent = '⚠️ ' + (dbl ? m.name : (m.nameS || m.name)) + ' فيه ضرر/مغادرة مسجّلة: ' + p.findings.join('؛ ') + ' — الاستبدال بـ«سليم» يحذف هذه النتائج من هذا الكشف عند الحفظ' + (m.kind === 'ins' ? ' (مواد السلاسل ودورات المعالجة السابقة لا تتأثر)' : '') + '. لن يُحفظ القسم سليماً قبل تأكيدك.';
      } else { w.style.display = 'none'; wt.textContent = ''; }
    });
    if (csHApplicable(id)) { nApp++; if (csHIsHealthy(id)) nOk++; if (_hPend[id]) nPend++; }
  });
  // اتساق: لا بقايا لأقسام غير موجودة
  Object.keys(_hPend).forEach(id => { if (!csHApplicable(id)) delete _hPend[id]; });
  const mcb = document.querySelector('[data-h-master-cb]'), mbox = document.querySelector('[data-h-master]');
  if (mcb && mbox) {
    mbox.style.display = nApp ? '' : 'none';
    mcb.checked = nApp > 0 && nOk === nApp; mcb.indeterminate = nOk > 0 && nOk < nApp;
    const pc = mbox.querySelector('[data-h-master-pending]');
    if (pc) { pc.style.display = nPend ? '' : 'none'; pc.textContent = nPend ? ('⚠️ ' + nPend + ' من الأقسام فيها ضرر مسجّل وتنتظر تأكيدك بجانب كل قسم — لم تُسجَّل سليمة بعد.') : ''; }
  }
  const anyPend = Object.keys(_hPend).length > 0;
  [['f_sev_insulator', 'ok'], ['f_sev_iron', 'ok'], ['f_sev_foundation', 'ok'], ['f_sev_wires', 'ok'], ['f_sev_ground', 'ok'], ['f_sev_fire', 'ok'], ['f_insulator_washing', 'clean'], ['f_road_access', 'متاح']].forEach(([i, okv]) => { const el = csHEl(i); if (el && (el.value !== okv || !anyPend)) _hPrev[i] = el.value; });
}
function csInsHealthyRefresh() { csHRefresh(); }

function buildInsulatorUI(voltage, towerType, savedState, savedCycle, savedState2, savedCycle2, savedChainTypes, savedChainTypes2) {
  _hBuildArgs = { voltage, towerType };   // v335-C6r15 (N21): لإعادة رسم العوازل بعد تطبيق «سليم»
  const sec = document.getElementById('insulatorSection');
  const wrap = document.getElementById('phasesWrap');
  sec.style.display = 'block';
  wrap.innerHTML = '';

  const lineName = document.getElementById('f_line_name') ? document.getElementById('f_line_name').value : '';
  const towerNum = document.getElementById('f_tower_number').value;
  // v335: سطر مصدر الحالة (حيّة/مخزّنة، أساس الهندسة، حالة المواد) فوق العوازل
  {
    let pv = document.getElementById('csProvenance');
    if (!pv) { pv = document.createElement('div'); pv.id = 'csProvenance'; pv.style.cssText = 'font-size:0.72rem;color:#4A5568;background:#EDF2F7;border-radius:8px;padding:6px 10px;margin:4px 0 8px;line-height:1.7'; sec.insertBefore(pv, wrap); }
    const pt = csProvenanceText(lineName, towerNum);
    pv.textContent = pt; pv.style.display = pt ? '' : 'none';
  }
  const mode = getInsulatorMode(voltage, towerType, lineName, towerNum);
  const count = getInsulatorCount(mode);
  const isDouble = isDoubleCircuitLine(lineName);
  const chainsPerPhase = getChainsPerPhase(mode);
  const rowsPerChain = Math.floor(count / chainsPerPhase);

  // تهيئة chainTypes: لو كشف جديد بلا بيانات سابقة، نأخذ الإعداد الافتراضي المحفوظ لهذا البرج تحديداً
  // (مثلاً برج معلَّم "خزف" بأبراج الخط يفتح مباشرة على خزف بدون ما يحتاج الفني يبدّله يدوياً)
  if (savedChainTypes) {
    chainTypes = JSON.parse(JSON.stringify(savedChainTypes));
  } else {
    const towerDefault = getTowerMaterialDefault(lineName, towerNum);
    chainTypes = { R: [], S: [], T: [] };
    if (towerDefault && towerDefault !== 'glass') {
      ['R','S','T'].forEach(p => { chainTypes[p] = Array(chainsPerPhase).fill(towerDefault); });
    }
  }
  ['R','S','T'].forEach(p => { if (!chainTypes[p]) chainTypes[p] = []; });

  // نفس المنطق تماماً للدائرة الثانية، لكن بمصفوفة مستقلة
  if (savedChainTypes2) {
    chainTypes2 = JSON.parse(JSON.stringify(savedChainTypes2));
  } else {
    const towerDefault2 = getTowerMaterialDefault(lineName, towerNum);
    chainTypes2 = { R: [], S: [], T: [] };
    if (towerDefault2 && towerDefault2 !== 'glass') {
      ['R','S','T'].forEach(p => { chainTypes2[p] = Array(chainsPerPhase).fill(towerDefault2); });
    }
  }
  ['R','S','T'].forEach(p => { if (!chainTypes2[p]) chainTypes2[p] = []; });
  // v335: مادة غير معروفة (لم تُحفظ) تبقى مجهولة: لا تُسلسَل زجاجاً إلا إذا اختار الفني مادة صراحةً (إعادة البناء بعد اختياره تُبقي الخيار)
  csMatBegin(lineName, towerNum, savedChainTypes, savedChainTypes2, chainsPerPhase, isDouble);

  if (savedState) {
    insulatorState = JSON.parse(JSON.stringify(savedState));
    // v335-C6r9c: طور غائب/بطول غير صالح يبقى مجهولاً (يُملأ فارغاً للعرض فقط) ولا يُسقط بقية الأطوار
    ['R','S','T'].forEach(p => { if (!Array.isArray(insulatorState[p])) insulatorState[p] = Array(count).fill(false); });
  } else {
    insulatorState = { R: Array(count).fill(false), S: Array(count).fill(false), T: Array(count).fill(false) };
  }
  if (savedCycle) {
    insulatorCycleState = JSON.parse(JSON.stringify(savedCycle));
  } else {
    insulatorCycleState = { R: Array(count).fill(0), S: Array(count).fill(0), T: Array(count).fill(0) };
  }
  ['R','S','T'].forEach(p => { if (!insulatorCycleState[p] || insulatorCycleState[p].length < count) insulatorCycleState[p] = Array(count).fill(0).map((v,i) => (insulatorCycleState[p]&&insulatorCycleState[p][i])||0); });

  if (isDouble) {
    if (savedState2) {
      insulatorState2 = JSON.parse(JSON.stringify(savedState2));
      ['R','S','T'].forEach(p => { if (!Array.isArray(insulatorState2[p])) insulatorState2[p] = Array(count).fill(false); });
    } else {
      insulatorState2 = { R: Array(count).fill(false), S: Array(count).fill(false), T: Array(count).fill(false) };
    }
    if (savedCycle2) {
      insulatorCycleState2 = JSON.parse(JSON.stringify(savedCycle2));
    } else {
      insulatorCycleState2 = { R: Array(count).fill(0), S: Array(count).fill(0), T: Array(count).fill(0) };
    }
    ['R','S','T'].forEach(p => { if (!insulatorCycleState2[p] || insulatorCycleState2[p].length < count) insulatorCycleState2[p] = Array(count).fill(0).map((v,i) => (insulatorCycleState2[p]&&insulatorCycleState2[p][i])||0); });
  }

  const [stA, stB] = lineName ? lineEndpoints(lineName) : ['', ''];

  function rebuildUI() { buildInsulatorUI(voltage, towerType, insulatorState, insulatorCycleState, insulatorState2, insulatorCycleState2, chainTypes, chainTypes2); }

  function buildOneCircuit(targetWrap, stateObj, cycleObj, typesObj) {
    typesObj = typesObj || chainTypes;
    ['R','S','T'].forEach(phase => {
      const block = document.createElement('div');
      block.className = 'phase-block';
      const lbl = document.createElement('div'); lbl.className = 'phase-label'; lbl.textContent = 'الفيز '+phase;
      block.appendChild(lbl);

      // للأنماط ذات السلاسل المتعددة: نبني كل سلسلة بشكل مستقل مع زر التبديل
      if (mode === 'chain2_10' || mode === 'chain2_12') {
        const chainsWrap = document.createElement('div');
        chainsWrap.style.cssText = 'display:flex;gap:8px;justify-content:center';
        for (let ci=0; ci<2; ci++) {
          const chainWrap = document.createElement('div');
          chainWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center';
          const material = (typesObj[phase]||[])[ci] || 'glass';
          const toggleBtn = buildChainToggleBtn(phase, ci, stateObj, cycleObj, rowsPerChain, rebuildUI, typesObj);
          chainWrap.appendChild(toggleBtn);
          if (material === 'plastic' || material === 'ceramic') {
            // حالة البلاستك/الخزف: نخزّنها في أول عازل بالسلسلة (true=متضرر)
            const dmg = !!(stateObj[phase] && stateObj[phase][ci*rowsPerChain]);
            const buildFn = material === 'ceramic' ? buildCeramicChain : buildPlasticChain;
            const pEl = buildFn(phase, ci, stateObj, dmg, (isDmg) => {
              for (let r=0; r<rowsPerChain; r++) stateObj[phase][ci*rowsPerChain+r] = isDmg;
            }, rowsPerChain);
            chainWrap.appendChild(pEl);
          } else {
            const singleColDiv = document.createElement('div'); singleColDiv.className = 'chain-col';
            for (let row=0; row<rowsPerChain; row++) {
              const idx = ci*rowsPerChain+row;
              const rect = document.createElement('div'); rect.className = 'ins-rect';
              (function(i){ function paint() { const cyc=(cycleObj[phase]&&cycleObj[phase][i])||0; if(stateObj[phase][i]){rect.style.background=insShade(INS_RED_SHADES,cyc);rect.style.borderColor='#9B0000';}else if(cyc>0){rect.style.background=insShade(INS_GREEN_SHADES,cyc-1);rect.style.borderColor='#276749';}else{rect.style.background='white';rect.style.borderColor='#555';} } paint(); if(currentUser.role!=='readonly'){rect.addEventListener('click',()=>{stateObj[phase][i]=!stateObj[phase][i];paint();});} })(idx);
              singleColDiv.appendChild(rect);
            }
            chainWrap.appendChild(singleColDiv);
          }
          chainsWrap.appendChild(chainWrap);
        }
        block.appendChild(chainsWrap);
      } else if (mode === 'chain1_10') {
        const chainWrap = document.createElement('div');
        chainWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center';
        const material = (typesObj[phase]||[])[0] || 'glass';
        const toggleBtn = buildChainToggleBtn(phase, 0, stateObj, cycleObj, rowsPerChain, rebuildUI, typesObj);
        chainWrap.appendChild(toggleBtn);
        if (material === 'plastic' || material === 'ceramic') {
          const dmg = !!(stateObj[phase] && stateObj[phase][0]);
          const buildFn = material === 'ceramic' ? buildCeramicChain : buildPlasticChain;
          const pEl = buildFn(phase, 0, stateObj, dmg, (isDmg) => {
            for (let r=0; r<rowsPerChain; r++) stateObj[phase][r] = isDmg;
          }, rowsPerChain);
          chainWrap.appendChild(pEl);
        } else {
          const el = buildSingleChain(phase, rowsPerChain, stateObj, cycleObj);
          chainWrap.appendChild(el);
        }
        block.appendChild(chainWrap);
      } else {
        // v, straight4, chain4_12 — نبقيهن كما هم بدون تبديل (بلاستيك نادر عليهم)
        let el;
        if (mode === 'v') el = buildVShape(phase, stateObj, cycleObj);
        else if (mode === 'straight4') el = buildStraight4Chain(phase, stA, stB, 4, 32, stateObj, cycleObj, rebuildUI, typesObj);
        else if (mode === 'chain4_12') el = buildStraight4Chain(phase, stA, stB, 4, 12, stateObj, cycleObj, rebuildUI, typesObj);
        else el = buildChain(phase, rowsPerChain, stateObj, cycleObj);
        block.appendChild(el);
      }
      targetWrap.appendChild(block);
    });
  }

  if (isDouble) {
    const title1 = document.createElement('div');
    title1.style.cssText = 'font-weight:700;color:#2C5282;margin:6px 0;text-align:center';
    title1.textContent = '⚡ عوازل الدائرة الأولى';
    wrap.appendChild(title1);
    wrap.appendChild(csInsHealthyBox(1));
    const wrap1 = document.createElement('div'); wrap1.className = 'phases-wrap-inner';
    wrap.appendChild(wrap1);
    buildOneCircuit(wrap1, insulatorState, insulatorCycleState, chainTypes);

    const title2 = document.createElement('div');
    title2.style.cssText = 'font-weight:700;color:#2C5282;margin:14px 0 6px;text-align:center';
    title2.textContent = '⚡ عوازل الدائرة الثانية';
    wrap.appendChild(title2);
    wrap.appendChild(csInsHealthyBox(2));
    const wrap2 = document.createElement('div'); wrap2.className = 'phases-wrap-inner';
    wrap.appendChild(wrap2);
    buildOneCircuit(wrap2, insulatorState2, insulatorCycleState2, chainTypes2);
  } else {
    wrap.appendChild(csInsHealthyBox(1));
    buildOneCircuit(wrap, insulatorState, insulatorCycleState, chainTypes);
  }
  csInsHealthyRefresh();
}

function buildVShape(phase, stateObj, cycleObj) {
  stateObj = stateObj || insulatorState;
  cycleObj = cycleObj || insulatorCycleState;
  const N = 28, svgW = 140, svgH = 110, gap = 18;
  const tipY = svgH-8, tipLX = svgW/2 - gap/2, tipRX = svgW/2 + gap/2, tlX=8, tlY=8, trX=svgW-8, trY=8, rw=12, rh=7;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width', svgW); svg.setAttribute('height', svgH);
  svg.setAttribute('viewBox', '0 0 '+svgW+' '+svgH);

  function addRect(cx, cy, angle, idx) {
    const ca=Math.cos(angle), sa=Math.sin(angle);
    const corners=[[-rw/2,-rh/2],[rw/2,-rh/2],[rw/2,rh/2],[-rw/2,rh/2]];
    const pts=corners.map(([x,y])=>[(cx+x*ca-y*sa).toFixed(2),(cy+x*sa+y*ca).toFixed(2)]);
    const rect=document.createElementNS('http://www.w3.org/2000/svg','polygon');
    rect.setAttribute('points', pts.map(p=>p.join(',')).join(' '));
    function paint() {
      const cyc = (cycleObj[phase]&&cycleObj[phase][idx]) || 0;
      if (stateObj[phase][idx]) {
        rect.setAttribute('fill', insShade(INS_RED_SHADES, cyc));
        rect.setAttribute('stroke', '#9B0000');
      } else if (cyc > 0) {
        rect.setAttribute('fill', insShade(INS_GREEN_SHADES, cyc-1));
        rect.setAttribute('stroke', '#276749');
      } else {
        rect.setAttribute('fill', 'white');
        rect.setAttribute('stroke', '#555');
      }
    }
    paint();
    rect.setAttribute('stroke-width','0.8'); rect.style.cursor='pointer';
    if (currentUser.role !== 'readonly') {
      rect.addEventListener('click', () => {
        stateObj[phase][idx] = !stateObj[phase][idx];
        paint();
      });
    }
    svg.appendChild(rect);
  }

  const angL=Math.atan2(tlY-tipY,tlX-tipLX), angR=Math.atan2(trY-tipY,trX-tipRX);
  for(let i=0;i<N;i++){
    const t=i/(N-1);
    addRect(tipLX+(tlX-tipLX)*t, tipY+(tlY-tipY)*t, angL, i);
    addRect(tipRX+(trX-tipRX)*t, tipY+(trY-tipY)*t, angR, N+i);
  }
  return svg;
}

function buildChain(phase, rows, stateObj, cycleObj) {
  stateObj = stateObj || insulatorState;
  cycleObj = cycleObj || insulatorCycleState;
  rows = rows || 12;
  const wrap = document.createElement('div'); wrap.className = 'chain-wrap';
  for (let col=0;col<2;col++) {
    const colDiv = document.createElement('div'); colDiv.className = 'chain-col';
    for (let row=0;row<rows;row++) {
      const idx = col*rows+row;
      const rect = document.createElement('div');
      rect.className = 'ins-rect';
      function paint() {
        const cyc = (cycleObj[phase]&&cycleObj[phase][idx]) || 0;
        if (stateObj[phase][idx]) { rect.style.background = insShade(INS_RED_SHADES, cyc); rect.style.borderColor = '#9B0000'; }
        else if (cyc > 0) { rect.style.background = insShade(INS_GREEN_SHADES, cyc-1); rect.style.borderColor = '#276749'; }
        else { rect.style.background = 'white'; rect.style.borderColor = '#555'; }
      }
      paint();
      if (currentUser.role !== 'readonly') {
        rect.addEventListener('click', () => {
          stateObj[phase][idx] = !stateObj[phase][idx];
          paint();
        });
      }
      colDiv.appendChild(rect);
    }
    wrap.appendChild(colDiv);
  }
  return wrap;
}

function buildSingleChain(phase, rows, stateObj, cycleObj) {
  stateObj = stateObj || insulatorState;
  cycleObj = cycleObj || insulatorCycleState;
  rows = rows || 10;
  const wrap = document.createElement('div'); wrap.className = 'chain-wrap';
  const colDiv = document.createElement('div'); colDiv.className = 'chain-col';
  for (let row=0;row<rows;row++) {
    const idx = row;
    const rect = document.createElement('div');
    rect.className = 'ins-rect';
    function paint() {
      const cyc = (cycleObj[phase]&&cycleObj[phase][idx]) || 0;
      if (stateObj[phase][idx]) { rect.style.background = insShade(INS_RED_SHADES, cyc); rect.style.borderColor = '#9B0000'; }
      else if (cyc > 0) { rect.style.background = insShade(INS_GREEN_SHADES, cyc-1); rect.style.borderColor = '#276749'; }
      else { rect.style.background = 'white'; rect.style.borderColor = '#555'; }
    }
    paint();
    if (currentUser.role !== 'readonly') {
      rect.addEventListener('click', () => {
        stateObj[phase][idx] = !stateObj[phase][idx];
        paint();
      });
    }
    colDiv.appendChild(rect);
  }
  wrap.appendChild(colDiv);
  return wrap;
}

function buildStraight4Chain(phase, stationA, stationB, totalCols, rows, stateObj, cycleObj, rebuildFn, typesObj) {
  stateObj = stateObj || insulatorState;
  cycleObj = cycleObj || insulatorCycleState;
  typesObj = typesObj || chainTypes;
  totalCols = totalCols || 4; rows = rows || 32;
  const colsPerGroup = totalCols / 2; // كل مجموعة نصف الأعمدة
  const outer = document.createElement('div');
  outer.style.display = 'flex'; outer.style.flexDirection = 'column'; outer.style.alignItems = 'center'; outer.style.gap = '4px';

  const groupsWrap = document.createElement('div');
  groupsWrap.style.display = 'flex'; groupsWrap.style.gap = '16px'; // فراغ بسيط بين المجموعتين

  function buildGroup(label, colOffset) {
    const groupWrap = document.createElement('div');
    groupWrap.style.display = 'flex'; groupWrap.style.flexDirection = 'column'; groupWrap.style.alignItems = 'center'; groupWrap.style.gap = '4px';
    const lbl = document.createElement('div');
    lbl.textContent = label;
    lbl.style.fontSize = '0.68rem'; lbl.style.fontWeight = '700'; lbl.style.color = '#4A5568';
    lbl.style.background = '#EBF0F5'; lbl.style.padding = '2px 8px'; lbl.style.borderRadius = '10px'; lbl.style.whiteSpace = 'nowrap';
    groupWrap.appendChild(lbl);
    const colsWrap = document.createElement('div'); colsWrap.style.display = 'flex'; colsWrap.style.gap = '6px';
    for (let c = 0; c < colsPerGroup; c++) {
      const col = c + colOffset;
      const material = (typesObj[phase]||[])[col] || 'glass';
      const chainWrap = document.createElement('div');
      chainWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center';
      if (rebuildFn) chainWrap.appendChild(buildChainToggleBtn(phase, col, stateObj, cycleObj, rows, rebuildFn, typesObj));
      if (material === 'plastic' || material === 'ceramic') {
        // حالة البلاستك/الخزف: نخزّنها بأول عازل بالسلسلة (true=متضرر)
        const dmg = !!(stateObj[phase] && stateObj[phase][col*rows]);
        const buildFn = material === 'ceramic' ? buildCeramicChain : buildPlasticChain;
        const pEl = buildFn(phase, col, stateObj, dmg, (isDmg) => {
          for (let r=0; r<rows; r++) stateObj[phase][col*rows+r] = isDmg;
        }, rows);
        chainWrap.appendChild(pEl);
      } else {
        const colDiv = document.createElement('div'); colDiv.className = 'chain-col';
        for (let row = 0; row < rows; row++) {
          const idx = col*rows+row;
          const rect = document.createElement('div');
          rect.className = 'ins-rect';
          function paint() {
            const cyc = (cycleObj[phase]&&cycleObj[phase][idx]) || 0;
            if (stateObj[phase][idx]) { rect.style.background = insShade(INS_RED_SHADES, cyc); rect.style.borderColor = '#9B0000'; }
            else if (cyc > 0) { rect.style.background = insShade(INS_GREEN_SHADES, cyc-1); rect.style.borderColor = '#276749'; }
            else { rect.style.background = 'white'; rect.style.borderColor = '#555'; }
          }
          paint();
          if (currentUser.role !== 'readonly') {
            rect.addEventListener('click', () => {
              stateObj[phase][idx] = !stateObj[phase][idx];
              paint();
            });
          }
          colDiv.appendChild(rect);
        }
        chainWrap.appendChild(colDiv);
      }
      colsWrap.appendChild(chainWrap);
    }
    groupWrap.appendChild(colsWrap);
    return groupWrap;
  }

  groupsWrap.appendChild(buildGroup('🏭 جهة ' + (stationA || 'محطة A'), 0));
  groupsWrap.appendChild(buildGroup('🏭 جهة ' + (stationB || 'محطة B'), colsPerGroup));
  outer.appendChild(groupsWrap);
  return outer;
}

// ========================
// FORM
// ========================
const SEVERITY_SECTION_MAP = {
  iron: { blockId: 'block_iron', fields: ['f_iron_intersections'] },
  foundation: { blockId: 'block_foundation', fields: ['f_tower_foundations'] },
  wires: { blockId: 'block_wires', fields: ['f_wires_r1','f_wires_s1','f_wires_t1'] },
  ground: { blockId: 'block_ground', fields: ['f_ground_1','f_ground_2'] },
  fire: { blockId: 'block_fire', fields: ['f_fire_causes_notes'] },
};

// لما تتغيّر درجة خطورة قسم: لو "سليم" يختفي صندوق النص ويُسجَّل "سليم" تلقائياً، وإلا يظهر الصندوق فاضي لكتابة وصف المغادرة
function onSeverityChange(section) {
  const cfg = SEVERITY_SECTION_MAP[section];
  if (!cfg) return;
  const sevVal = document.getElementById('f_sev_'+section).value;
  const block = document.getElementById(cfg.blockId);
  const lineName = document.getElementById('f_line_name') ? document.getElementById('f_line_name').value : '';

  // الأسلاك بخط مزدوج: نحتاج خطوة وسيطة (اختيار الدائرة) قبل إظهار صناديق النص
  if (section === 'wires' && isDoubleCircuitLine(lineName)) {
    const circuitBlock = document.getElementById('block_wires_circuit');
    const c2Block = document.getElementById('block_wires_c2');
    if (sevVal === 'ok' || sevVal === '') {
      if (circuitBlock) circuitBlock.style.display = 'none';
      if (block) block.style.display = 'none';
      if (c2Block) c2Block.style.display = 'none';
      document.getElementById('f_wires_circuit').value = '';
      cfg.fields.forEach(fid => { const el = document.getElementById(fid); if (el) el.value = sevVal === 'ok' ? 'سليم' : ''; });
      ['f_wires_r1_c2','f_wires_s1_c2','f_wires_t1_c2'].forEach(fid => { const el = document.getElementById(fid); if (el) el.value = ''; });
    } else {
      if (circuitBlock) circuitBlock.style.display = '';
      onWiresCircuitChange(); // يحدّث إظهار الصناديق حسب الدائرة المختارة سابقاً (لو موجودة)
    }
    return;
  }

  if (sevVal === 'ok') {
    if (block) block.style.display = 'none';
    cfg.fields.forEach(fid => { const el = document.getElementById(fid); if (el) el.value = 'سليم'; });
  } else if (sevVal === '') {
    if (block) block.style.display = 'none';
    cfg.fields.forEach(fid => { const el = document.getElementById(fid); if (el) el.value = ''; });
  } else {
    if (block) block.style.display = '';
    cfg.fields.forEach(fid => { const el = document.getElementById(fid); if (el && el.value === 'سليم') el.value = ''; });
  }
}

// تحدّد أي صناديق نص تظهر حسب الدائرة المختارة لمغادرة الأسلاك (خط مزدوج فقط)
function onWiresCircuitChange() {
  const choice = document.getElementById('f_wires_circuit').value;
  const block1 = document.getElementById('block_wires');
  const block2 = document.getElementById('block_wires_c2');
  if (choice === '1') { block1.style.display = ''; block2.style.display = 'none'; ['f_wires_r1_c2','f_wires_s1_c2','f_wires_t1_c2'].forEach(fid => document.getElementById(fid).value = ''); }
  else if (choice === '2') { block1.style.display = 'none'; block2.style.display = ''; ['f_wires_r1','f_wires_s1','f_wires_t1'].forEach(fid => document.getElementById(fid).value = ''); }
  else if (choice === 'both') { block1.style.display = ''; block2.style.display = ''; }
  else { block1.style.display = 'none'; block2.style.display = 'none'; }
}

function getFormData() {
  const towerType = document.getElementById('f_tower_type').value;
  const lineName = document.getElementById('f_line_name').value;
  const _fTowerNum = document.getElementById('f_tower_number').value;
  const insMode = getInsulatorMode(currentVoltage, towerType, lineName, _fTowerNum);
  function svgFor(state) {
    if (insMode === 'v') return generateVShapeSVG(state);
    if (insMode === 'straight4') return generateQuadChainSVG(state, 4, 32);
    if (insMode === 'chain4_12') return generateQuadChainSVG(state, 4, 12);
    if (insMode === 'chain2_12') return generateQuadChainSVG(state, 2, 12);
    if (insMode === 'chain2_10') return generateChainSVG(state, 2, 10);
    if (insMode === 'chain1_10') return generateSingleChainSVG(state, 10);
    return generateChainSVG(state, 2, 12);
  }
  // مزامنة r2/s2/t2 مع r1/s1/t1 (فقرة واحدة فقط تُعرض الآن)
  ['r','s','t'].forEach(p => {
    const v1 = document.getElementById('f_wires_'+p+'1').value;
    document.getElementById('f_wires_'+p+'2').value = v1;
  });
  const isDouble = isDoubleCircuitLine(lineName);
  const d = {
    line_name: document.getElementById('f_line_name').value,
    inspection_date: document.getElementById('f_inspection_date').value,
    tower_number: document.getElementById('f_tower_number').value,
    tower_type: towerType,
    voltage: currentVoltage,
    insulator_state: JSON.stringify(insulatorState),
    insulator_cycle: JSON.stringify(insulatorCycleState),
    insulator_chain_types: csChainTypesForSave(chainTypes, 1),
    insulator_svg_r: svgFor(insulatorState.R),
    insulator_svg_s: svgFor(insulatorState.S),
    insulator_svg_t: svgFor(insulatorState.T),
    created_by: currentUser.id,
    created_by_name: currentUser.full_name,
  };
  if (isDouble) {
    d.insulator_state_2 = JSON.stringify(insulatorState2);
    d.insulator_cycle_2 = JSON.stringify(insulatorCycleState2);
    d.insulator_chain_types_2 = csChainTypesForSave(chainTypes2, 2);
  }
  FIELDS.forEach(f => d[f] = document.getElementById('f_'+f).value.trim());
  return d;
}

// تعبئة النموذج ببيانات سجل. متزامنة بالكامل (v334: أُزيل الاعتماد على مهلة 60ms)، ولا تجلب/ترسم شبكة الأبراج.
// opts.keepDate=true: كشف جديد يرث بيانات سابقة — يبقى تاريخ الكشف الجديد المكتوب بالنموذج ولا يُستبدل بتاريخ السجل السابق.
// بدونها (تعديل سجل محفوظ/معلّق): يؤخذ تاريخ السجل نفسه.
function setFormData(d, opts) {
  const keepDate = !!(opts && opts.keepDate);
  document.querySelectorAll('.treated-prev-badge').forEach(b => b.remove());
  const lineEl = document.getElementById('f_line_name');
  const tSel = document.getElementById('f_tower_number');
  const towerKey = String(d.tower_number == null ? '' : d.tower_number);
  // نفس الخط وقائمة أبراجه جاهزة ويحوي البرج المطلوب (حالة تهيئة كشف جديد من فتح البرج): لا حاجة لإعادة بناء الخيارات
  const sameSelection = !!d.line_name && lineEl.value === d.line_name && Array.prototype.some.call(tSel.options || [], o => o.value === towerKey);
  if (!sameSelection) {
    lineEl.value = d.line_name||'';
    onLineChange(true, true);
  }
  currentVoltage = d.voltage || (LINE_VOLTAGE[d.line_name]||132);
  tSel.value = d.tower_number||'';
  document.getElementById('f_tower_type').value = d.tower_type||'';
  const dateEl = document.getElementById('f_inspection_date');
  if (!keepDate) dateEl.value = d.inspection_date||'';
  else if (!dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
  FIELDS.forEach(f => { const el=document.getElementById('f_'+f); if(el) el.value=d[f]||''; });
  Object.keys(SEVERITY_SECTION_MAP).forEach(onSeverityChange);
  (d._treatedBadgeFields||[]).forEach(fieldId => {
    const el = document.getElementById('f_'+fieldId);
    if (!el) return;
    const badge = document.createElement('div');
    badge.className = 'treated-prev-badge';
    badge.textContent = '✅ معالج سابقاً — راجع وعدّل إذا لقيت المشكلة موجودة';
    badge.style.cssText = 'color:#1e8449;font-size:0.75rem;font-weight:700;margin-top:2px;margin-bottom:4px';
    el.insertAdjacentElement('afterend', badge);
  });
  const saved = d.insulator_state ? safeParseJSON(d.insulator_state) : null;
  let savedCycle = d._mergedCycle;
  if (!savedCycle && d.insulator_cycle) { savedCycle = safeParseJSON(d.insulator_cycle); }
  const saved2 = d.insulator_state_2 ? safeParseJSON(d.insulator_state_2) : null;
  const savedCycle2 = d.insulator_cycle_2 ? safeParseJSON(d.insulator_cycle_2) : null;
  const savedChainTypes = d.insulator_chain_types ? safeParseJSON(d.insulator_chain_types) : null;
  const savedChainTypes2 = d.insulator_chain_types_2 ? safeParseJSON(d.insulator_chain_types_2) : null;
  buildInsulatorUI(currentVoltage, d.tower_type, saved, savedCycle || null, saved2, savedCycle2, savedChainTypes, savedChainTypes2);
  updateWiresGroundUI();
  _hPend = {}; _hSnap = {}; _hRoadClr = null; try { csHRefresh(); } catch (e) { /* UI only */ }   // v335-C6r15 (N21): بيانات جديدة تُلغي أي تأكيد/تراجع معلّق
}

function cancelEdit() {
  const _o = window._editOrigin; window._editOrigin = null;   // v335-C6r12 (N19): أصل التعديل (الأرشيف) إن وُجد
  editId=null; clearForm();
  document.getElementById('towerInspectionModal').classList.remove('show'); popLevelIfMatches(closeTowerInspectionModal);
  document.getElementById('formTitle').textContent='➕ إضافة كشف جديد';
  document.getElementById('saveBtn').textContent='💾 حفظ الكشف';
  document.getElementById('cancelEditBtn').style.display='none';
  if (_o && typeof _o.back === 'function') { try { _o.back(); } catch (e) { console.warn('[tower-app] edit-origin return failed', e); } }
}

// مهلة قصوى "ناعمة": توقف انتظار الواجهة لهذا الطلب بعد المدة المحددة، بدون ما تلغي الطلب نفسه
// (يستمر بالخلفية وقد ينجح لاحقاً — آمن لأن كل حفظ جديد له client_uuid يمنع التكرار بقاعدة البيانات).
// بدون هذا، النت الضعيف (مو المنقطع) كان يخلي زر الحفظ يعلّق لدقائق بدون أي حد أقصى.
function withSoftTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SOFT_TIMEOUT')), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

async function saveRecord() {
  const d = getFormData();
  if (!d.line_name || !d.tower_number) { showToast('⚠️ اسم الخط ورقم البرج مطلوبان','error'); return; }
  // v334: كشف جديد لم تكتمل تهيئته من الكشف السابق (تحميل جارٍ/فشل/جزئي/مؤجَّل) لا يُحفظ إلا بعد قرار صريح
  if (!editId) { const _why = prefillSaveBlockReason(d.line_name, d.tower_number); if (_why) { showToast(_why, 'error'); return; } }
  // v335-C2: حراسة الكتابة الفعلية (مستقلة عن حالة الواجهة): برج غير محسوم/بياناته غير سليمة/طابور غير مقروء، مادة جزئية لدائرة مجهولة، حالة/دورات غير صالحة
  if (!editId) { const _ib = csIntegrityBlockReason(d.line_name, d.tower_number); if (_ib) { showToast(_ib, 'error'); return; } }
  { const _fb = csFormIntegrityReason(d); if (_fb) { showToast(_fb, 'error'); return; } }

  // التحقق: القسم اللي ما لمسته (تركت قائمته فاضية) يُقبل بدون إلزام — يبقى ناقص لين كشف جديد لاحقاً.
  // القسم اللي حددت له درجة (سليم أو غيرها) ولو كانت "مغادرة" لازم صندوق الوصف معبّى
  const sevChecks = [
    { sev: d.sev_iron, fields: [d.iron_intersections], label: 'تقاطعات الحديد' },
    { sev: d.sev_foundation, fields: [d.tower_foundations], label: 'قواعد البرج' },
    // الأسلاك والأرضي: قيمهم من قوائم منسدلة (تلف بسيط، تلف شديد، إلخ) — الدرجة نفسها كافية دليلاً، لا يُطلب نص إضافي
    { sev: d.sev_fire, fields: [d.fire_causes_notes], label: 'مسببات الحرائق' },
  ];
  for (const c of sevChecks) {
    if (!c.sev) continue;
    if (c.sev !== 'ok' && c.fields.every(v => !v || !v.trim())) {
      showToast(`⚠️ اكتب وصف مغادرة "${c.label}" قبل الحفظ`, 'error'); return;
    }
  }

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  try {
    // v335-C4: لا POST/PATCH مباشر على inspections. التسجيل الدائم بالصندوق أولاً ثم الإرسال بعملية واحدة تُطبَّق على الحالة والسجل التاريخي معاً
    if (editId) await opsSaveEdit(d); else await opsSaveObservation(d);
  } finally { btn.disabled = false; }
}

// بعد حفظ ناجح (أو تخزين أوف لاين) لكشف برج من شبكة الأبراج:
// نحدّث الكاش المحلي فوراً لتلوين البرج بالشبكة بدون انتظار إعادة تحميل، نغلق النافذة المنبثقة، ونمسح حقول البرج فقط (لا نمسح الخط/التاريخ المختار)
// مهم: لو الحفظ أونلاين ونجح، d هنا هو الصف الحقيقي المرجَع من السيرفر (فيه id صحيح) — وليس النسخة المحلية الناقصة،
// لتجنّب خلل "سجل بلا id" يفسد اختيار آخر كشف لاحقاً (بالمعالجة أو الكشف الجديد)
function afterGridSaveSuccess(d) {
  const savedRec = { ...d, created_at: d.created_at || new Date().toISOString() };
  markLocalTouch(savedRec); // v334-R
  fullRecordsCache.unshift(savedRec);
  indexOneRecordInPlace(savedRec);
  document.getElementById('towerInspectionModal').classList.remove('show'); popLevelIfMatches(closeTowerInspectionModal);
  resetTowerFieldsOnly();
  // فوري من الذاكرة المحلية — بدون هذا كان يعيد تحميل كل الكشوفات من السيرفر بعد كل حفظ، وهذا
  // بالضبط اللي يسبب "تحميل" بطيء بعد كل برج على نت ضعيف رغم إن البيانات محدَّثة أصلاً محلياً
  if (currentGridLine) renderTowersGridFromCache(currentGridLine);
}

function opsSectionVals() {
  const json = o => JSON.stringify(o || null);
  return {
    ins1: json({ s: insulatorState, c: chainTypes, sv: _v('f_sev_insulator'), h: !!_insHealthy[1] }),
    ins2: json({ s: insulatorState2, c: chainTypes2, h: !!_insHealthy[2] }),
    washing: _v('f_insulator_washing'),
    iron: _v('f_sev_iron') + '|' + _v('f_iron_intersections'),
    foundation: _v('f_sev_foundation') + '|' + _v('f_tower_foundations'),
    wires1: [_v('f_sev_wires'), _v('f_wires_circuit'), _v('f_wires_r1'), _v('f_wires_s1'), _v('f_wires_t1')].join('|'),
    wires2: [_v('f_wires_circuit'), _v('f_wires_r1_c2'), _v('f_wires_s1_c2'), _v('f_wires_t1_c2')].join('|'),
    ground: [_v('f_sev_ground'), _v('f_ground_1'), _v('f_ground_2')].join('|'),
    fire: _v('f_sev_fire') + '|' + _v('f_fire_causes_notes'),
    road: _v('f_road_access') + '|' + _v('f_road_access_notes')
  };
}

function opsSectionHasData(id, line, tower) {   // هل لهذا القسم بيانات موروثة معروفة؟
  const env = opsEnvKnown(line, tower);
  const keys = { ins1: ['ins_R', 'ins_S', 'ins_T'], ins2: ['ins2_R', 'ins2_S', 'ins2_T'], washing: ['washing'], iron: ['iron'], foundation: ['foundation'],
    wires1: ['wire_r1', 'wire_s1', 'wire_t1'], wires2: ['wire_r1_c2', 'wire_s1_c2', 'wire_t1_c2'], ground: ['ground_1', 'ground_2'], fire: ['fire'], road: ['road'] }[id] || [];
  if (env) return keys.some(k => { const c = opsCompOf(env, k); return c && c.ds === 'known'; });
  return false;
}

// بلا بيانات موروثة (برج بلا كشف سابق أو متابعة بلا تهيئة): ما يدخله الموظف فعلياً يُعدّ رصداً؛ الفارغ لا يُعدّ سليماً إلا بتأكيد
function opsHasContent(id) {
  const any = (...ids) => ids.some(i => _v(i) !== '');
  const dm = st => !!st && OPS_PH.some(ph => Array.isArray(st[ph]) && st[ph].some(x => x === true));
  switch (id) {
    case 'ins1': return dm(insulatorState) || any('f_sev_insulator') || !!_insHealthy[1] || csInsMatChosen(1);
    case 'ins2': return dm(insulatorState2) || !!_insHealthy[2] || csInsMatChosen(2);
    case 'washing': return any('f_insulator_washing');
    case 'iron': return any('f_sev_iron', 'f_iron_intersections');
    case 'foundation': return any('f_sev_foundation', 'f_tower_foundations');
    case 'wires1': return any('f_sev_wires', 'f_wires_r1', 'f_wires_s1', 'f_wires_t1');
    case 'wires2': return any('f_wires_r1_c2', 'f_wires_s1_c2', 'f_wires_t1_c2');
    case 'ground': return any('f_sev_ground', 'f_ground_1', 'f_ground_2');
    case 'fire': return any('f_sev_fire', 'f_fire_causes_notes');
    case 'road': return any('f_road_access', 'f_road_access_notes');
  }
  return false;
}

function opsCaptureBaseline(mode) {
  const line = _v('f_line_name'), tower = _v('f_tower_number');
  if (!line || !tower) { _opsBaseline = null; return; }
  const inh = {}; OPS_SECTIONS.forEach(s => { inh[s.id] = mode === 'blank' ? false : opsSectionHasData(s.id, line, tower); });
  _insHealthy = { 1: false, 2: false };
  _opsBaseline = { line, tower, mode: mode === 'blank' ? 'blank' : 'inherit', vals: opsSectionVals(), inherited: inh };
  try { csInsHealthyRefresh(); } catch (e) { /* UI only */ }
}

function opsSectionAvailable(s) {
  if (!s.double) return true;
  try { return isDoubleCircuitLine(_v('f_line_name')); } catch (e) { return false; }
}

// حالة القسم (v335-C6r9d: تتبّع تغيير فقط — لا خانات تأكيد): 'changed' | 'inherited' | 'missing'
//  - changed  : قيمة القسم الآن تختلف عن لقطة البداية المأخوذة بعد التعبئة (أو، بلا بيانات سابقة، أدخل الموظف فيه شيئاً فعلياً) => يُرسَل
//  - inherited: موروث من الحالة الحالية ولم يُمسّ => لا يُرسَل ولا يُعدّ رصداً
//  - missing  : لا بيانات سابقة ولم يُدخل شيء => يبقى مجهولاً (لا يُعدّ سليماً)
// إلغاء ضرر مسجَّل سابقاً يتم بتغييره صراحةً (إزالة العلامة / اختيار درجة «سليم»)، وهو تغيير يُرسَل.
function opsSectionState(s) {
  if (!_opsBaseline || _opsBaseline.line !== _v('f_line_name') || _opsBaseline.tower !== _v('f_tower_number')) return opsHasContent(s.id) ? 'changed' : 'missing';
  if (_opsBaseline.mode === 'blank') return opsHasContent(s.id) ? 'changed' : 'missing';
  const cur = opsSectionVals();
  if (cur[s.id] !== _opsBaseline.vals[s.id]) return 'changed';
  return _opsBaseline.inherited[s.id] ? 'inherited' : 'missing';
}

// يبني حمولة رصد من النموذج: فقط الأقسام المرصودة (معدَّلة أو مؤكَّدة صراحةً)
function opsBuildObservation(d) {
  const line = d.line_name, tower = String(d.tower_number);
  const comps = {}, sev = {}, observed = [];
  const isDouble = (() => { try { return isDoubleCircuitLine(line); } catch (e) { return false; } })();
  const need = (sevId, textIds, label) => {   // درجة غير سليمة تتطلب وصفاً
    const sv = _v(sevId); if (sv && sv !== 'ok' && textIds.every(i => !_v(i))) return '⚠️ اكتب وصف مغادرة "' + label + '" قبل الحفظ';
    return null;
  };
  const states = {}; OPS_SECTIONS.forEach(s => { states[s.id] = opsSectionAvailable(s) ? opsSectionState(s) : 'skip'; });
  // v335-C6r15 (N21): أسلاك دائرة غير معروفة بلا أي نص وبدرجة «سليم» عامة لم تُسجَّل صراحةً (لا خانتها ولا نصّها) = لا تُختلق لها حالة سليمة؛ تُرسَل الدائرة المسجّلة صراحةً فقط
  const blankUnk = id => { if (id !== 'wires1' && id !== 'wires2') return false; if (_v('f_sev_wires') !== 'ok') return false; const t = CS_H[id].texts; if (t.some(i => _v(i) !== '')) return false; let kn = false; try { kn = opsSectionHasData(id, line, tower); } catch (e) { kn = false; } return !kn; };
  const isObs = id => states[id] === 'changed' && !blankUnk(id);
  const err = []; const skippedUnknown = []; const materialOnly = [];
  // العوازل
  // v335-C6r9e: ثلاث حالات لكل دائرة معدَّلة:
  //  (أ) حالتها معروفة: تُرسَل كاملة (الضرر + المواد)  (ب) غير معروفة وفيها ضرر مُدخَل، أو سُجّلت «سليمة» صراحةً (زر الدائرة)، أو (دائرة أولى) اختير تقدير العوازل: تُرسَل حالة صريحة
  //  (ج) غير معروفة ولم يُسجَّل لها ضرر ولا «سليمة» وغُيّرت مادتها فقط: تُرسَل المادة وحدها {chains} — لا تُختلق حالة سليمة ولا تُكتب أطوال الضرر
  let dmgWritten = false;
  [1, 2].forEach(c => {
    const sid = c === 1 ? 'ins1' : 'ins2';
    if (!isObs(sid)) return;
    const st = c === 1 ? insulatorState : insulatorState2, ct = c === 1 ? chainTypes : chainTypes2;
    const known = opsSectionHasData(sid, line, tower), hasDmg = OPS_PH.some(ph => st && Array.isArray(st[ph]) && st[ph].some(x => x === true));
    let ctJson = null; try { ctJson = JSON.parse(csChainTypesForSave(ct, c) || 'null'); } catch (e) { ctJson = null; }
    const okChains = ph => ctJson && Array.isArray(ctJson[ph]) && ctJson[ph].length && ctJson[ph].every(x => typeof x === 'string' && x);
    const stateExplicit = known || hasDmg || !!_insHealthy[c] || (c === 1 && !!_v('f_sev_insulator'));
    if (!stateExplicit) {
      const k0 = (c === 1 ? 'ins_' : 'ins2_'); let n = 0;
      OPS_PH.forEach(ph => { if (okChains(ph)) { comps[k0 + ph] = { chains: ctJson[ph].slice() }; n++; } });
      if (n) { observed.push(sid + ':material'); materialOnly.push(c === 1 ? 'الدائرة الأولى' : 'الدائرة الثانية'); }
      else skippedUnknown.push(c === 1 ? 'الدائرة الأولى' : 'الدائرة الثانية');
      return;
    }
    OPS_PH.forEach(ph => {
      const arr = st && st[ph];
      if (!Array.isArray(arr) || !arr.length) { err.push('⚠️ حالة عوازل ' + (c === 1 ? 'الدائرة الأولى' : 'الدائرة الثانية') + ' الفيز ' + ph + ' غير مهيّأة'); return; }
      const v = { damaged: arr.map(x => !!x) };
      if (okChains(ph)) v.chains = ctJson[ph].slice();
      comps[(c === 1 ? 'ins_' : 'ins2_') + ph] = v;
    });
    observed.push(sid); dmgWritten = true;
  });
  // الشدة تُرسَل مع كتابة حالة دائرة أولى، أو إن غيّرها الموظف فعلاً؛ تسجيل الدائرة الثانية وحدها لا يعيد كتابة شدة لم تتغيّر
  if (dmgWritten && _v('f_sev_insulator')) {
    let sevChanged = true;
    try { if (_opsBaseline && _opsBaseline.mode !== 'blank' && _opsBaseline.line === line && _opsBaseline.tower === tower) sevChanged = (JSON.parse(_opsBaseline.vals.ins1) || {}).sv !== _v('f_sev_insulator'); } catch (e) { sevChanged = true; }
    if (observed.includes('ins1') || sevChanged) sev.sev_insulator = _v('f_sev_insulator');
  }
  if (isObs('washing')) { if (!_v('f_insulator_washing')) err.push('⚠️ اختر حالة نظافة العوازل'); else { comps.washing = { text: _v('f_insulator_washing') }; observed.push('washing'); } }
  const textSec = (id, sevId, fieldIds, keys, label) => {
    if (!isObs(id)) return;
    const e0 = need(sevId, fieldIds, label); if (e0) { err.push(e0); return; }
    if (!_v(sevId)) { err.push('⚠️ حدّد درجة خطورة "' + label + '"'); return; }
    keys.forEach((k, i) => { comps[k] = { text: _v(fieldIds[i]) || 'سليم' }; });
    sev[{ f_sev_iron: 'sev_iron', f_sev_foundation: 'sev_foundation', f_sev_wires: 'sev_wires', f_sev_ground: 'sev_ground' }[sevId]] = _v(sevId);
    observed.push(id);
  };
  textSec('iron', 'f_sev_iron', ['f_iron_intersections'], ['iron'], 'تقاطعات الحديد');
  textSec('foundation', 'f_sev_foundation', ['f_tower_foundations'], ['foundation'], 'قواعد البرج');
  textSec('wires1', 'f_sev_wires', ['f_wires_r1', 'f_wires_s1', 'f_wires_t1'], ['wire_r1', 'wire_s1', 'wire_t1'], 'الأسلاك');
  if (isObs('wires2')) {
    if (!_v('f_sev_wires')) err.push('⚠️ حدّد درجة خطورة الأسلاك');
    else { ['r1', 's1', 't1'].forEach(p => { comps['wire_' + p + '_c2'] = { text: _v('f_wires_' + p + '_c2') || 'سليم' }; }); sev.sev_wires = _v('f_sev_wires'); observed.push('wires2'); }
  }
  if (isObs('ground')) {
    const e0 = need('f_sev_ground', ['f_ground_1', 'f_ground_2'], 'الأرضي'); if (e0) err.push(e0);
    else if (!_v('f_sev_ground')) err.push('⚠️ حدّد درجة خطورة الأرضي');
    else {
      comps.ground_1 = { text: _v('f_ground_1') || 'سليم' };
      const g2 = document.getElementById('groundBlock2'); if (g2 && g2.style.display !== 'none' || _v('f_ground_2')) comps.ground_2 = { text: _v('f_ground_2') || 'سليم' };
      sev.sev_ground = _v('f_sev_ground'); observed.push('ground');
    }
  }
  if (isObs('fire')) {
    if (!_v('f_sev_fire')) err.push('⚠️ حدّد درجة خطورة مسببات الحرائق');
    else { const e0 = need('f_sev_fire', ['f_fire_causes_notes'], 'مسببات الحرائق'); if (e0) err.push(e0); else { comps.fire = { sev: _v('f_sev_fire'), notes: _v('f_fire_causes_notes') }; observed.push('fire'); } }
  }
  if (isObs('road')) { if (!_v('f_road_access')) err.push('⚠️ اختر وجود الطريق'); else { comps.road = { text: _v('f_road_access') }; observed.push('road'); } }
  if (err.length) return { ok: false, msg: err[0] };
  if (!Object.keys(comps).length) return { ok: false, msg: 'ℹ️ لم تُعدّل أي قسم — لا يوجد رصد جديد ليُحفظ. عدّل قسماً ثم احفظ' };
  const env = opsEnvKnown(line, tower);
  const payload = { kind: 'observation', op_id: genUUID(), line_name: line, tower_number: tower, business_date: d.inspection_date || opsToday(), comps, sev,
    row: { tower_type: d.tower_type || undefined, voltage: d.voltage || undefined, notes: _v('f_notes'), road_access_notes: _v('f_road_access_notes'), wires_circuit: _v('f_wires_circuit'),
           insulator_svg_r: d.insulator_svg_r, insulator_svg_s: d.insulator_svg_s, insulator_svg_t: d.insulator_svg_t } };
  Object.keys(payload.row).forEach(k => { if (payload.row[k] === undefined || payload.row[k] === '') delete payload.row[k]; });
  if (isObs('road') && comps.road && comps.road.text === 'متاح' && !_v('f_road_access_notes') && _hRoadClr && _hRoadClr.base === _opsBaseline && _hRoadClr.line === line && _hRoadClr.tower === tower) payload.clear_road_notes = true;   // N21: مسح صريح مؤكَّد فقط
  const extra = { sections: observed, skipped_unknown: skippedUnknown, material_only: materialOnly };
  if (env) { payload.base = opsBaseFor(env, Object.keys(comps)); payload.base_src = env.source ? env.source.inspection_id : null; extra.base_mode = null; }
  else { payload.base = {}; extra.base_mode = 'unknown'; }
  return { ok: true, payload, extra };
}

// ---- حفظ كشف جديد ----
async function opsSaveObservation(d) {
  const why = opsBlockReason(d.line_name, d.tower_number, 'observation');
  if (why) { showToast(why, 'error'); return false; }
  const b = opsBuildObservation(d);
  if (!b.ok) { showToast(b.msg, 'error'); return false; }
  const r = opsEnqueue(opsNewEntry('observation', b.payload, b.extra));
  if (!r.ok) { showToast(r.reason === 'storage' ? '❌ لم يُحفظ الكشف (ذاكرة الجهاز ممتلئة) وحقولك باقية — حرّر مساحة واضغط حفظ ثانيةً' : '❌ لم يُحفظ الكشف: ' + (r.reason === 'migration_refused' ? (_opsMig.msg || 'قائمة معلّقات قديمة غير قابلة للترحيل') : MSG_QUEUE_UNREADABLE) + ' حقولك باقية.', 'error'); return false; }
  opsApplyEntryToCache(r.entry);
  { const sk = (b.extra && b.extra.skipped_unknown) || [];
    showToast('✅ حُفظ الكشف على الجهاز — لم يُؤكَّد على السيرفر بعد وسيُرسل تلقائياً' + (sk.length ? ' — لم تُسجَّل ' + sk.join(' و') + ' (حالتها غير مسجّلة: علّم ضرراً أو اضغط «تسجيل عوازل هذه الدائرة سليمة»)' : '') + (((b.extra && b.extra.material_only) || []).length ? ' — حُفظت المادة فقط لـ ' + b.extra.material_only.join(' و') + ' وحالة عوازلها بقيت غير مسجّلة' : '')); }
  document.getElementById('towerInspectionModal').classList.remove('show'); popLevelIfMatches(closeTowerInspectionModal);
  resetTowerFieldsOnly();
  if (currentGridLine) renderTowersGridFromCache(currentGridLine);
  opsSyncSoon();
  return true;
}

async function opsSaveEdit(d) {
  const orig = records.find(x => x.id === editId) || (fullRecordsCache || []).find(x => x.id === editId);
  if (!orig) { showToast('⚠️ تعذّر إيجاد السجل الأصلي للمقارنة', 'error'); return false; }
  const norm = v => (v === null || v === undefined) ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v).trim());
  const metaPatch = {};
  OPS_META_COLS.forEach(c => { if (norm(d[c]) !== norm(orig[c])) metaPatch[c] = d[c] === '' ? null : d[c]; });
  const stateDiff = OPS_STATE_COLS.filter(c => {
    if (c.indexOf('insulator_') === 0 && (c.indexOf('state') > 0 || c.indexOf('chain') > 0)) {
      const a = safeParseJSON(orig[c]), b = safeParseJSON(d[c]);
      return JSON.stringify(a || null) !== JSON.stringify(b || null) && !(d[c] === undefined);
    }
    return d[c] !== undefined && norm(d[c]) !== norm(orig[c]);
  });
  if (!Object.keys(metaPatch).length && !stateDiff.length) { showToast('ℹ️ لا توجد تغييرات للحفظ'); return false; }
  const why = opsBlockReason(d.line_name, d.tower_number, 'annotate');
  if (why) { showToast(why, 'error'); return false; }
  const entries = [];
  if (stateDiff.length) {
    if (!(currentUser.role === 'admin' || currentUser.role === 'supervisor')) { showToast('⛔ تعديل حالة الكشف (عوازل/درجات/أوصاف) من صلاحيات المدير أو المشرف فقط — يُسجَّل كتصحيح صريح. للبيانات الوصفية فقط (ملاحظات/تاريخ/اسم) لا قيد.', 'error'); return false; }
    const env = opsEnvKnown(d.line_name, d.tower_number);
    if (!env || !env.source || String(env.source.inspection_id) !== String(editId)) {
      showToast('⛔ هذا السجل ليس مصدر الحالة الحالية لهذا البرج؛ تعديل حالة كشف تاريخي غير مدعوم (الأصل يبقى كما سُجّل). أضف كشفاً جديداً أو عدّل الكشف الحالي للبرج.', 'error'); return false;
    }
    const cc = opsCompsFromRow(Object.assign({}, d), { explicit: true });
    if (opsInvalidNotes(cc.notes).length) { showToast('⛔ مصفوفة حالة العوازل غير صالحة (قيم غير منطقية) — لم يُحوَّل التعديل إلى تصحيح', 'error'); return false; }
    const cols = new Set(stateDiff);
    const comps = {};
    Object.keys(cc.comps).forEach(k => {
      const touched = (/^ins2_/.test(k) && (cols.has('insulator_state_2') || cols.has('insulator_chain_types_2'))) || (/^ins_/.test(k) && (cols.has('insulator_state') || cols.has('insulator_chain_types'))) ||
        (OPS_TEXT_COL[k] && cols.has(OPS_TEXT_COL[k])) || (k === 'fire' && (cols.has('sev_fire') || cols.has('fire_causes_notes')));
      if (touched) { const v = Object.assign({}, cc.comps[k]); delete v.cycle; comps[k] = v; }
    });
    // مقارنة أدق على مستوى المكوّن للعوازل: فقط الأطوار التي تغيّرت فعلاً
    [1, 2].forEach(c => {
      const sc = c === 2 ? 'insulator_state_2' : 'insulator_state', pre = c === 2 ? 'ins2_' : 'ins_';
      if (!cols.has(sc)) return;
      const a = safeParseJSON(orig[sc]) || {}, b = safeParseJSON(d[sc]) || {};
      OPS_PH.forEach(ph => { if (JSON.stringify(a[ph] || []) === JSON.stringify(b[ph] || []) && !cols.has(c === 2 ? 'insulator_chain_types_2' : 'insulator_chain_types')) delete comps[pre + ph]; });
    });
    if (!Object.keys(comps).length) { showToast('⚠️ لا يمكن تحويل هذا التعديل إلى تصحيح صريح (قيمة غير مفهومة)', 'error'); return false; }
    const reason = (prompt('سبب التصحيح (إلزامي — يُسجَّل بالتدقيق):', '') || '').trim();
    if (!reason) { showToast('⚠️ لم يُحفظ التصحيح: السبب إلزامي', 'error'); return false; }
    const sev = {}; ['sev_insulator', 'sev_iron', 'sev_foundation', 'sev_wires', 'sev_ground'].forEach(k => { if (cols.has(k) && d[k]) sev[k] = d[k]; });
    entries.push(opsNewEntry('correction', { kind: 'correction', op_id: genUUID(), line_name: d.line_name, tower_number: String(d.tower_number), business_date: opsToday(), comps, sev,
      base: opsBaseFor(env, Object.keys(comps)), base_src: env.source.inspection_id, reason, target_source_id: editId }, {}));
  }
  if (Object.keys(metaPatch).length) {
    const reason = 'تعديل بيانات وصفية من واجهة السجلات';
    entries.push(opsNewEntry('annotate', { kind: 'annotate', op_id: genUUID(), line_name: d.line_name, tower_number: String(d.tower_number), table: 'inspections', id: editId, patch: metaPatch, reason }, {}));
  }
  for (const e of entries) { const r = opsEnqueue(e); if (!r.ok) { showToast('❌ لم يُحفظ التعديل (' + (r.reason === 'storage' ? 'ذاكرة الجهاز ممتلئة' : 'قائمة المعلّقات غير قابلة للقراءة') + ') وحقولك باقية', 'error'); return false; } }
  // عرض محلي فوري لكل ما يُعرض من السجل نفسه (الأصل لا يتغيّر بالخادم إلا بالبيانات الوصفية)
  const idx = fullRecordsCache.findIndex(r => r.id === editId); markLocalTouch({ id: editId });
  const idx2 = records.findIndex(r => r.id === editId);
  if (idx2 !== -1) Object.assign(records[idx2], metaPatch);
  if (idx !== -1) Object.assign(fullRecordsCache[idx], metaPatch);
  rebuildLatestRecordsIndex();
  showToast('✅ حُفظ التعديل على الجهاز — لم يُؤكَّد على السيرفر بعد وسيُرسل تلقائياً');
  document.getElementById('towerInspectionModal').classList.remove('show'); popLevelIfMatches(closeTowerInspectionModal);
  cancelEdit();
  if (currentGridLine) renderTowersGridFromCache(currentGridLine);
  opsSyncSoon();
  return true;
}

function editRecordImpl(id) {
  const r = records.find(x => x.id === id) || (fullRecordsCache||[]).find(x => x.id === id);
  if (!r) return;
  invalidatePrefill(); // v334: التعديل مسار مستقل عن تهيئة الكشف الجديد
  const _origin = (typeof hubTakeEditOrigin === 'function') ? hubTakeEditOrigin(id) : null;   // v335-C6r12 (N19)
  window._editOrigin = null;
  editId = id; setFormData(r);
  document.getElementById('formTitle').textContent = '✏️ تعديل السجل';
  document.getElementById('saveBtn').textContent = '💾 حفظ التعديل';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';
  showPage('form');
  const _navSeq = pageNavigationRequestSeq;
  if (_origin) { _origin.nav = _navSeq; window._editOrigin = _origin; }
  setTimeout(() => {
    if (_navSeq !== pageNavigationRequestSeq || editId !== id) return; // v334: تنقّل/إلغاء خلال المهلة — لا تفتح النافذة
    document.getElementById('modalTowerTitle').textContent = '🗼 برج رقم ' + (r.tower_number||'—');
    document.getElementById('towerInspectionModal').classList.add('show');
  }, 80);
  window.scrollTo(0,0);
}

function editPendingInspectionImpl(i) {
  const q = getQueue();
  const rec = q[i];
  if (!rec) return;
  editingPendingInspectionIndex = i;
  editId = null; // هذا مش سجل بقاعدة البيانات، فما نستخدم نظام التعديل العادي
  invalidatePrefill(); // v334
  showPage('form');
  const _navSeq = pageNavigationRequestSeq;
  setTimeout(() => {
    if (_navSeq !== pageNavigationRequestSeq || editingPendingInspectionIndex !== i) { if (_navSeq !== pageNavigationRequestSeq && editingPendingInspectionIndex === i) editingPendingInspectionIndex = null; return; } // v334: تنقّل خلال المهلة
    setFormData(rec);
    document.getElementById('formTitle').textContent = '✏️ تعديل كشف معلق (غير مرفوع)';
    const btn = document.getElementById('saveBtn');
    btn.setAttribute('onclick', 'saveEditedPendingInspection()');
    btn.textContent = '💾 حفظ التعديل (سيبقى معلقاً)';
    document.getElementById('modalTowerTitle').textContent = '🗼 برج رقم ' + (rec.tower_number||'—');
    document.getElementById('towerInspectionModal').classList.add('show');
  }, 80);
}

function saveEditedPendingInspection() {
  if (editingPendingInspectionIndex === null) return;
  const d = getFormData();
  if (!d.line_name || !d.tower_number) { showToast('⚠️ اسم الخط ورقم البرج مطلوبان','error'); return; }
  const q = getQueue();
  q[editingPendingInspectionIndex] = d;
  if (!safeSetItem(QUEUE_KEY, JSON.stringify(q))) return;
  editingPendingInspectionIndex = null;
  showToast('✅ تم تحديث الكشف المعلق');
  document.getElementById('towerInspectionModal').classList.remove('show'); popLevelIfMatches(closeTowerInspectionModal);
  clearForm();
  // إعادة الزر لوضعه الطبيعي
  const btn = document.getElementById('saveBtn');
  btn.setAttribute('onclick', 'saveRecord()');
  btn.textContent = '💾 حفظ الكشف';
  document.getElementById('formTitle').textContent = '➕ إضافة كشف جديد';
  showPage('pendingSync');
  renderPendingSyncPage();
}

// ===== v334: تهيئة كشف جديد من آخر كشف سابق =====
// المبادئ: (1) كل نتيجة غير متزامنة تُقارَن برمز الإبطال _prefillSeq وبالخط/البرج الحاليين قبل أن تلمس النموذج.
// (2) ما أدخله الموظف لا يُستبدل: لو بدأ الإدخال قبل وصول البيانات تُؤجَّل التهيئة ويُعرض زر تحميل صريح.
// (3) غياب البيانات ≠ برج سليم: التحميل الجاري/الفاشل/الجزئي/المؤجَّل يمنع حفظ كشف جديد حتى قرار صريح.
function _prefillIsCurrent(token, lineName, towerNumber) {
  return token === _prefillSeq &&
    document.getElementById('f_line_name').value === lineName &&
    document.getElementById('f_tower_number').value === String(towerNumber);
}

function _setPrefillState(state, lineName, towerNumber, note) {
  _prefillState = { state, line: lineName || '', tower: towerNumber == null ? '' : String(towerNumber), note: note || '' };
  _renderPrefillBanner();
  try { if (state === 'ready' || state === 'partial') opsCaptureBaseline('inherit'); else if (state === 'none' || state === 'acknowledged') opsCaptureBaseline('blank'); } catch (e) { console.warn('[tower-app] baseline', e); }   // v335-C4
}

// سبب منع حفظ كشف جديد (نص) أو null
function prefillSaveBlockReason(lineName, towerNumber) {
  const s = _prefillState;
  if (s.line !== lineName || s.tower !== String(towerNumber)) return null;
  if (s.state === 'loading') return '⏳ لا يزال تحميل الكشف السابق لهذا البرج جارياً — انتظر اكتماله ثم احفظ';
  if (s.state === 'unresolved') return '⛔ حالة هذا البرج غير محسومة — لا يمكن حفظ كشف جديد حتى تُحسم.';
  if (s.state === 'unavailable' || s.state === 'partial' || s.state === 'deferred' || s.state === 'orderUnknown')
    return '⚠️ لم تكتمل تهيئة هذا الكشف من الكشف السابق. أعد المحاولة أو اختر المتابعة دون بيانات سابقة من التنبيه أعلى النموذج';
  return null;
}

function retryPrefill() {
  const lineName = document.getElementById('f_line_name').value, towerNum = document.getElementById('f_tower_number').value;
  if (lineName && towerNum) checkPreviousInspection(lineName, towerNum);
}

// قرار صريح من الموظف: المتابعة بدون الكشف السابق (أو بالبيانات الجزئية المعروضة)
function acknowledgePrefill() {
  const s = _prefillState;
  if (s.state === 'unresolved') { showToast('⛔ حالة هذا البرج غير محسومة — لا يمكن المتابعة من هنا. أعد المحاولة أو بلّغ المسؤول.', 'error'); return; }
  if (s.state !== 'unavailable' && s.state !== 'partial' && s.state !== 'deferred' && s.state !== 'orderUnknown') return;
  const keepLoaded = s.state === 'partial';
  _prefillSeq++; // يلغي أي طلب جارٍ
  if (!keepLoaded) { previousInspectionForLoad = null; previousTreatmentsForLoad = []; _prefillNoteState = null; }
  _setPrefillState('acknowledged', s.line, s.tower, '');
}

function _sameTowerRecord(r, lineName, towerNumber) {
  return !!r && typeof r === 'object' && r.line_name === lineName && String(r.tower_number) === String(towerNumber);
}

// مرشّحو الكشف السابق من الذاكرة: الكاش الموحّد + records (بلا تكرار بالمعرّف، ونسخة الكاش الموحّد تتقدّم)،
// وإلا التخزين المحلي كحل أخير. الاختيار النهائي بـpickLatestInspection دون افتراض ترتيب أي مصدر.
function _cachedTowerCandidates(lineName, towerNumber) {
  const out = (fullRecordsCache || []).filter(r => _sameTowerRecord(r, lineName, towerNumber));
  const byId = new Map();
  out.forEach((r, i) => { if (hasValidInspectionId(r.id) && !byId.has(String(r.id))) byId.set(String(r.id), i); });
  (records || []).forEach(r => {
    if (!_sameTowerRecord(r, lineName, towerNumber)) return;
    if (!hasValidInspectionId(r.id)) { out.push(r); return; }
    const i = byId.get(String(r.id));
    if (i === undefined) { byId.set(String(r.id), out.length); out.push(r); return; }
    // نفس المعرّف بمصدرين: صف الكاش هو المرجع. يُثرى بتفاصيل نسخة records الكاملة فقط لو الإصداران متطابقان تماماً على الحقول المشتركة؛
    // وإلا يبقى صف الكاش وحده (جزئي) ولا يُدمج مع تفاصيل قد تكون قديمة.
    const c = out[i];
    if (!isFullInspectionRecord(c) && isFullInspectionRecord(r) && _versionsCompatible(c, r)) out[i] = { ...r, ...c };
  });
  if (out.length) return out;
  let recs = [];
  try { recs = JSON.parse(localStorage.getItem(DB_KEY) || '[]'); } catch (e) { recs = []; }
  return Array.isArray(recs) ? recs.filter(r => _sameTowerRecord(r, lineName, towerNumber)) : [];
}

async function checkPreviousInspection(lineName, towerNumber) {
  const token = ++_prefillSeq;
  previousInspectionForLoad = null;
  previousTreatmentsForLoad = [];
  _prefillNoteState = null;
  if (!lineName || !towerNumber) { _setPrefillState('idle'); return; }
  _setPrefillState('loading', lineName, towerNumber);
  try {
    // v334-R: طابور غير قابل للقراءة = لا يمكن إعادة بناء الحالة الحالية بأمان: حالة صريحة بدل عرض بيانات قد تكون قديمة كأنها مرجع
    if (!_readPendingInspectionState().ok) { _setPrefillState(csFlagOn() ? 'unresolved' : 'unavailable', lineName, towerNumber, 'قائمة المعلّقات على الجهاز غير قابلة للقراءة'); return; }
    let serverOk = false, serverNone = false, csCacheUsed = false, towerEnv = null;
    let softGaps = [];
    // v334: لا نجلب/نحدّث شبكة الخط هنا إطلاقاً — طلب واحد بسجل واحد هو المرجع الأحدث لهذا البرج
    // v335: القراءة تمر بالمحوّل الموحّد (حالة حيّة محلولة بالخادم)، وعند انقطاع الاتصال لقطة مخزّنة بالجهاز موسومة بذلك
    if (navigator.onLine || csLiveEnabled()) {
      const fetched = await _fetchFullTowerRecord(lineName, towerNumber);
      if (!_prefillIsCurrent(token, lineName, towerNumber)) return;
      const csEnv = fetched.cs && fetched.cs.ok ? fetched.cs.env : null;
      towerEnv = csEnv;
      // v335-C6: السجل المقروء حيّاً يدخل الكاش المشترك قبل أي رفض/تحذير تهيئة (كان يدخله تحميل الخط): بطاقة البرج تعرض ما قُرئ فعلاً
      try { if (fetched.ok && fetched.record && !(fetched.cs && fetched.cs.source === 'cache')) _mergeFullTowerRecord(fetched.record, fetched.startSeq); } catch (e) {}
      // v335-C6: القراءة تصل بعد بناء واجهة العوازل (لم يعد هناك تحميل للخط مسبقاً): سطر مصدر الحالة يُحدَّث عند وصولها
      try { const pv = document.getElementById('csProvenance'); if (pv && csEnv) { const pt = csProvenanceText(lineName, towerNumber); pv.textContent = pt; pv.style.display = pt ? '' : 'none'; } } catch (e) {}
      if (csEnv) {
        const geo = csEnv.meta && csEnv.meta.geometry;
        const fromCache = fetched.cs.source === 'cache';
        const tag = fromCache ? ' (لقطة مخزّنة بالجهاز)' : '';
        if (csEnv.basis === 'operations' && !csEnv.row && csEnv.resolution !== 'no_source') { _setPrefillState('unavailable', lineName, towerNumber, 'حالة هذا البرج مسجّلة بنظام العمليات الجديد وليست مدعومة بالتهيئة بعد' + tag); return; }
        if (csEnv.resolution === 'unresolved') { _setPrefillState('unresolved', lineName, towerNumber, csReasonsText(csEnv.unresolved_reasons) + tag); return; }
        if (csEnv.row && geo && geo.status === 'conflict') { _setPrefillState('unresolved', lineName, towerNumber, 'هندسة السلاسل المحفوظة غير متسقة مع بعضها' + tag); return; }
        // v335-C2: تحقق فعلي من حالة/دورات/هندسة كل دائرة قبل أي تهيئة تلقائية (لا صفر ولا سليم يُصنع). الاستثناء الوحيد: materials_missing
        { const _ti = csEnv.row ? csTowerInfo(lineName, towerNumber) : null; if (_ti && csIntegrityHard(_ti.integrity).length) { _setPrefillState('unresolved', lineName, towerNumber, csIntegrityText(csIntegrityHard(_ti.integrity)) + tag); return; }
          // v335-C6r9c: النقص «الغائب» (_missing) لدائرة/قسم لا يوقف تعبئة الأقسام السليمة المعروفة: يبقى المجهول فارغاً ومسمّى، ويُكمل ملء الباقي
          if (_ti && _ti.integrity && _ti.integrity.length) softGaps = _ti.integrity.slice(); }
        if (fromCache) {
          csCacheUsed = true;
          if (fetched.record && !_cachedTowerCandidates(lineName, towerNumber).length) _mergeFullTowerRecord(fetched.record, fetched.startSeq);
        }
      }
      if (fetched.ok && !csCacheUsed) {
        serverOk = true;
        if (fetched.record) _mergeFullTowerRecord(fetched.record, fetched.startSeq); else if (!fetched.noRow) serverNone = true;
      }
    }
    // الاختيار من كل المرشحين (يشمل كشفاً محلياً معلّقاً أحدث) دون افتراض ترتيب
    const cands = _cachedTowerCandidates(lineName, towerNumber);
    // v334-R2: كشف معلّق بلا created_at معروف بنفس تاريخ كشف آخر: لا نعتبر أي منهما الأحدث ولا نهيّئ تلقائياً
    if (_towerOrderUnresolved(cands)) { _setPrefillState('orderUnknown', lineName, towerNumber); return; }
    const last = pickLatestInspection(cands);
    if (!last) {
      // لا شيء: "لا كشف سابق" مؤكَّد فقط لو السيرفر أكّده، أو شبكة هذا الخط حُمّلت بهذه الجلسة (برج غير مكشوف بها)
      if (serverNone || (!serverOk && loadedLineCacheAt[lineName])) _setPrefillState('none', lineName, towerNumber);
      else _setPrefillState('unavailable', lineName, towerNumber);
      return;
    }
    if (hasValidInspectionId(last.id) && hasValidInspectionId(editId) && String(last.id) === String(editId)) { _setPrefillState('idle'); return; } // نفس السجل المعدَّل حالياً
    previousInspectionForLoad = last;
    // معالجات الكشف السابق من الكاش (متزامن): تأثيرات المعالجة والعلامات تعتمد عليه كما كانت، ولا تنتظر أي جلب
    previousTreatmentsForLoad = hasValidInspectionId(last.id) ? (treatmentsCache || []).filter(t => String(t.inspection_id) === String(last.id)) : [];
    // v335-C6r3: معالجات الكشف السابق تأتي ضمن ردّ قراءة البرج نفسه (source_treatments) — بلا طلب تاريخ منفصل؛ تُستعمل فقط إن كان الكشف السابق هو مصدر الحالة المقروءة
    try {
      const cenv = towerEnv && towerEnv.source && String(towerEnv.source.inspection_id) === String(last.id) ? towerEnv : null;
      if (cenv && Array.isArray(cenv.source_treatments)) previousTreatmentsForLoad = cenv.source_treatments.filter(t => t && typeof t === 'object');
    } catch (e) {}
    if (_prefillUserEdited) { _setPrefillState('deferred', lineName, towerNumber); return; }
    const pendingTower = (function () { try { return pendingInspectionForTower(lineName, towerNumber); } catch (e) { return { found: false }; } })();
    const notes = [];
    if (csCacheUsed) notes.push('📴 حالة مخزّنة بالجهاز من آخر قراءة حيّة — ليست حيّة الآن');
    else if (!serverOk) notes.push('📴 حُمّل آخر كشف محفوظ بالجهاز (قد لا يشمل تحديثات أجهزة أخرى)');
    if (pendingTower.found && hasValidInspectionId(last.id)) notes.push('لهذا البرج كشف معلّق غير مرفوع قد لا تتضمنه البيانات المحمّلة');
    const complete = isFullInspectionRecord(last);
    loadPreviousInspection(true); // تحميل صامت (بدون رسالة "تم تحميل الكشف السابق") — يُبقي تاريخ الكشف الجديد
    if (softGaps.length) notes.push(csUnknownSectionsText(softGaps));
    _setPrefillState(complete ? 'ready' : 'partial', lineName, towerNumber, complete ? notes.join(' — ') : '');
    // معالجات الكشف السابق من السيرفر: لا تحجب التهيئة، وتُحدّث سطر الملاحظات التلقائي فقط
    _fetchPrevTreatments(last, token, lineName, towerNumber);
  } catch (e) {
    console.warn('[tower-app] فشل تهيئة الكشف من الكشف السابق', e);
    if (_prefillIsCurrent(token, lineName, towerNumber)) _setPrefillState('unavailable', lineName, towerNumber);
  }
}

async function _fetchPrevTreatments(last, token, lineName, towerNumber) {
  if (!navigator.onLine || !hasValidInspectionId(last.id)) return;
  if (csLiveEnabled()) return; // v335-C6: فتح البرج = قراءة حالته الحالية فقط؛ لا طلب معالجات تاريخي إضافي (الحالة المعالَجة داخل حالة البرج)
  let rows;
  try {
    const res = await sbFetch(`treatments?inspection_id=eq.${encodeURIComponent(last.id)}&order=created_at.desc`);
    if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('استجابة معالجات غير متوقعة');
    rows = data.filter(t => t && typeof t === 'object' && !Array.isArray(t) && String(t.inspection_id) === String(last.id));
  } catch (e) {
    if (!_prefillIsCurrent(token, lineName, towerNumber)) return;
    console.error('فشل جلب المعالجات السابقة:', e);
    showToast('⚠️ تعذر جلب سجل المعالجات السابقة لهذا البرج', 'error');
    return;
  }
  if (!_prefillIsCurrent(token, lineName, towerNumber) || previousInspectionForLoad !== last) return;
  previousTreatmentsForLoad = rows;
  _refreshPrefillNote();
}

// خريطة: مفتاح المغادرة النصية → الحقل (أو الحقول) بالفورم + القيمة "السليمة" الافتراضية
const TREAT_FIELD_MAP = {
  iron: [{field:'iron_intersections', healthy:''}],
  foundation: [{field:'tower_foundations', healthy:''}],
  attachment: [{field:'tower_attachments', healthy:''}],
  wire_r1: [{field:'wires_r1', healthy:'سليم'}],
  wire_s1: [{field:'wires_s1', healthy:'سليم'}],
  wire_t1: [{field:'wires_t1', healthy:'سليم'}],
  ground_1: [{field:'ground_1', healthy:''}],
  ground_2: [{field:'ground_2', healthy:''}],
  fire: [{field:'fire_causes_notes', healthy:''}],
  road: [{field:'road_access', healthy:'متاح'},{field:'road_access_notes', healthy:''}]
};

// v335-C6r4: items_treated قد يصل مغلَّفاً (نص JSON داخل نص، شكل قديم صالح): يُفكّ حتى 3 مستويات؛ غير الصالح (ليس مصفوفة كائنات بمفتاح نصي) = لا عناصر
function _decodeTreatItems(v) {
  for (let i = 0; i < 4 && typeof v === 'string'; i++) { try { v = JSON.parse(v); } catch (e) { return []; } }
  return Array.isArray(v) && v.every(x => x && typeof x === 'object' && !Array.isArray(x) && typeof x.key === 'string') ? v : [];
}

function _prevNoteLine(r, treatments) {
  let line = `كشف سابق بتاريخ ${r.inspection_date} من ${r.created_by_name||'—'}`;
  const items = (treatments || []).flatMap(t => _decodeTreatItems(t && t.items_treated).map(i => i.label)).filter(l => l != null && l !== '').join('، ');
  if (items) line += ` — تمت معالجة: ${items}`;
  return line;
}

// يحدّث سطر "كشف سابق…" التلقائي بعد وصول المعالجات المتأخرة — فقط لو محتوى الملاحظات ما زال كما كتبناه حرفياً
function _refreshPrefillNote() {
  const r = previousInspectionForLoad, st = _prefillNoteState;
  if (!r || !st) return;
  const notesEl = document.getElementById('f_notes');
  if (!notesEl || notesEl.value !== st.written) return; // الموظف عدّل الملاحظات: لا نمسّها
  const line = _prevNoteLine(r, previousTreatmentsForLoad);
  const written = st.base ? st.base + '\n' + line : line;
  if (written === st.written) return;
  notesEl.value = written;
  _prefillNoteState = { base: st.base, written };
}

function loadPreviousInspection(silent) {
  if (!previousInspectionForLoad) return;
  const r = previousInspectionForLoad;
  // تحميل صريح (زر) فوق مدخلات الموظف: نطلب تأكيداً لأنه يستبدلها
  if (!silent && _prefillUserEdited && !confirm('سيستبدل الكشف السابق ما أدخلته الآن بالنموذج. متابعة؟')) return;

  // r.insulator_state و r.insulator_cycle يعكسان الحقيقة الحالية الفعلية مباشرة (يتحدّثان وقت كل معالجة) —
  // فقط ننقلهما كما هما بدون أي حساب أو دمج
  const rForLoad = { ...r, _mergedCycle: r.insulator_cycle ? safeParseJSON(r.insulator_cycle) : null };
  const treatedBadgeFields = [];
  Object.keys(TREAT_FIELD_MAP).forEach(key => {
    if (isTreatedInDB(r.id, key)) {
      TREAT_FIELD_MAP[key].forEach(({field, healthy}) => {
        rForLoad[field] = healthy;
        treatedBadgeFields.push(field);
      });
    }
  });
  rForLoad._treatedBadgeFields = treatedBadgeFields;

  // نحمل بياناته بالفورم للإكمال — بدون تغيير editId (يُحفظ كسجل جديد بالأرشيف). keepDate: تاريخ الكشف الجديد يبقى
  setFormData(rForLoad, { keepDate: true });
  _prefillUserEdited = false;

  // نضيف بالملاحظات ملخص الكشف السابق والمعالجات
  const notesEl = document.getElementById('f_notes');
  const existingNotes = notesEl.value.trim();
  const addNote = _prevNoteLine(r, previousTreatmentsForLoad);
  const written = existingNotes ? existingNotes + '\n' + addNote : addNote;
  notesEl.value = written;
  _prefillNoteState = { base: existingNotes, written };
  if (!silent) {
    // تحميل صريح من زر "تحميل الكشف السابق": يُنهي حالة التأجيل، ويجلب المعالجات المتأخرة بدون حجب
    const lineName = document.getElementById('f_line_name').value, towerNum = document.getElementById('f_tower_number').value;
    _setPrefillState(isFullInspectionRecord(r) ? 'ready' : 'partial', lineName, towerNum, '');
    _fetchPrevTreatments(r, _prefillSeq, lineName, towerNum);
    showToast('✅ تم تحميل الكشف السابق (بعد المعالجات) — راجع وأكمل ثم احفظ');
  }
}

// تعديل onTowerChange لتفعيل فحص الكشف السابق (بدون قيد زمني)
function onTowerChange() {
  invalidatePrefill(); // v334: برج جديد = أي تهيئة سابقة معلّقة تُهمل ويُصفَّر تتبّع إدخال الموظف
  _hPend = {}; _hSnap = {}; _hRoadClr = null; _hPrev = {};   // v335-C6r15 (N21): لا تأكيد/تراجع يعبر إلى برج آخر
  onTowerChangeOriginal();
  try { csHRefresh(); } catch (e) { /* UI only */ }
  const lineName = document.getElementById('f_line_name').value;
  const towerNum = document.getElementById('f_tower_number').value;
  if (lineName && towerNum) checkPreviousInspection(lineName, towerNum);
}

// تتبّع إدخال الموظف بعد فتح البرج: يمنع أي بيانات متأخرة من الكتابة فوقه (الخط/البرج/التاريخ لا تُحسب إدخالاً)
(function installPrefillInputTracking() {
  if (typeof document === 'undefined' || !document.addEventListener) return;
  const EXCLUDED = { f_line_name: 1, f_tower_number: 1, f_tower_type: 1, f_inspection_date: 1 };
  const mark = e => {
    const t = e && e.target;
    if (!t) return;
    const id = t.id || '';
    if (id.indexOf('f_') === 0 && !EXCLUDED[id]) _prefillUserEdited = true;
    else if (typeof t.closest === 'function' && t.closest('#phasesWrap')) _prefillUserEdited = true;
  };
  document.addEventListener('input', mark, true);
  document.addEventListener('change', mark, true);
  // v335-C6r15 (N21): قائمة درجة العوازل: «سليم» تمرّ عبر بوابة التأكيد (لا تمسح علامات حمراء بصمت)؛ ما سواها يُسجَّل كقيمة سابقة. بقية القوائم عبر onSeverityUserChange.
  document.addEventListener('change', e => {
    const t = e && e.target; if (!t || t.id !== 'f_sev_insulator') return;
    if (t.value !== 'ok') { _hPrev[t.id] = t.value; csHRefresh(); return; }
    csHSevOk('f_sev_insulator', ['ins1', 'ins2']);
  });
  // نظافة العوازل / وجود الطريق: اختيار القيمة السليمة (نظيف / متاح) من القائمة فوق قيمة سلبية أو ملاحظات قائمة يمرّ بالتحذير والتأكيد نفسهما
  document.addEventListener('change', e => {
    const t = e && e.target; const id = t && ({ f_insulator_washing: 'washing', f_road_access: 'road' })[t.id]; if (!id) return;
    if (t.value !== CS_H[id].okVal) { _hPrev[t.id] = t.value; csHRefresh(); return; }
    t.value = (_hPrev[t.id] === undefined || _hPrev[t.id] === CS_H[id].okVal) ? '' : _hPrev[t.id];
    delete _hPend[id]; csHRequest(id); _prefillUserEdited = true; csHRefresh();
  });
  // أي تعديل لاحق (حقول النموذج أو نقر العوازل) يعيد اشتقاق حالة الخانات والتأكيدات المعلّقة من القيم الحالية
  const inForm = e => { const t = e && e.target; return !!(t && (t.id === 'f_line_name' || (typeof t.closest === 'function' && t.closest('#towerInspectionModal')))); };
  const refreshSoon = e => { if (e && !inForm(e)) return; setTimeout(() => { try { csHRefresh(); } catch (x) { /* UI only */ } }, 0); };
  document.addEventListener('input', refreshSoon, true);
  document.addEventListener('change', refreshSoon, true);
  document.addEventListener('click', e => { const t = e && e.target; if (t && typeof t.closest === 'function' && t.closest('#phasesWrap')) { _prefillUserEdited = true; refreshSoon(e); } }, true);
})();

// ========================
// DEPARTURES MODULE v2 (Supabase + Interactive Insulators)
// ========================


(window.__featModules = window.__featModules || {}).insp = true;
