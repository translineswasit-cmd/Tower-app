
// كاش خاص بالتقارير (لا يوجد كاش عام مسبق للاستمارات الرسمية بالتطبيق)
let reportThermalFormsCache = [];
async function loadReportThermalForms() {
  try {
    reportThermalFormsCache = await fetchAllPages('thermal_official_forms?select=id,line_name,inspection_date,created_by,rows&order=inspection_date.desc');
  } catch (e) { reportThermalFormsCache = []; }
}

async function openReportsPage() {
  await Promise.all([
    loadFullRecordsCache(true).catch(()=>{}),
    loadTreatments().catch(()=>{}),
    loadReportThermalForms().catch(()=>{}),
    loadThermalArchive().catch(()=>{})
  ]);

  const lineSet = new Set();
  (fullRecordsCache||[]).forEach(r => { if (r.line_name) lineSet.add(r.line_name); });
  (treatmentsCache||[]).forEach(t => { if (t.line_name) lineSet.add(t.line_name); });
  (reportThermalFormsCache||[]).forEach(f => { if (f.line_name) lineSet.add(f.line_name); });
  (thermalRecords||[]).forEach(r => { if (r.line_name) lineSet.add(r.line_name); }); // القراءات الخام أيضاً
  const uniqueLines = [...lineSet].sort((a,b) => a.localeCompare(b, 'ar'));
  const linesWrap = document.getElementById('repLinesWrap');
  linesWrap.innerHTML = uniqueLines.map(n => `
    <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:2px 0">
      <input type="checkbox" class="repLineChk" value="${n.replace(/"/g,'&quot;')}" onchange="onReportLinesPick()">
      <span>${n}</span>
    </label>`).join('');
  document.getElementById('repLinesAll').checked = true;
  linesWrap.style.display = 'none';

  document.getElementById('repFrom').value = '';
  document.getElementById('repTo').value = '';
  document.querySelector('input[name="repTowersMode"][value="all"]').checked = true;
  document.getElementById('repTowerFrom').value = '';
  document.getElementById('repTowerTo').value = '';
  document.getElementById('repCategoryAll').checked = true;
  document.querySelectorAll('.repCatChk').forEach(cb => { cb.checked = false; cb.disabled = true; });
  // حماية: لو تغيّرت بنية أزرار اختيار الأبراج مستقبلاً، لا نُسقط تهيئة الصفحة كلها
  const allTowersRadio = document.querySelector('input[name="repTowersMode"][value="all"]');
  if (allTowersRadio) allTowersRadio.checked = true;
  onReportTowersModeChange();
}

function onReportCategoryAllToggle() {
  const allChecked = document.getElementById('repCategoryAll').checked;
  document.querySelectorAll('.repCatChk').forEach(cb => { cb.disabled = allChecked; if (allChecked) cb.checked = false; });
  updateReportResultCount();
}
function onReportCategoryPick() {
  const anyChecked = Array.from(document.querySelectorAll('.repCatChk')).some(cb => cb.checked);
  if (anyChecked) document.getElementById('repCategoryAll').checked = false;
  else document.getElementById('repCategoryAll').checked = true;
  document.querySelectorAll('.repCatChk').forEach(cb => cb.disabled = !anyChecked && document.getElementById('repCategoryAll').checked);
  updateReportResultCount();
}
// null = بدون تصفية تصنيف (كل الأبراج)
function getReportSelectedCategories() {
  if (document.getElementById('repCategoryAll').checked) return null;
  const picked = Array.from(document.querySelectorAll('.repCatChk:checked')).map(cb => cb.value);
  return picked.length ? picked : null;
}

function onReportLinesAllToggle() {
  const allChecked = document.getElementById('repLinesAll').checked;
  document.getElementById('repLinesWrap').style.display = allChecked ? 'none' : 'grid';
  if (allChecked) document.querySelectorAll('.repLineChk').forEach(cb => cb.checked = false);
  onReportFilterChange();
}
function onReportLinesPick() {
  const anyChecked = Array.from(document.querySelectorAll('.repLineChk')).some(cb => cb.checked);
  document.getElementById('repLinesAll').checked = !anyChecked;
  onReportFilterChange();
}
// null = بدون تصفية (كل الخطوط)
function getReportSelectedLines() {
  if (document.getElementById('repLinesAll').checked) return null;
  const picked = Array.from(document.querySelectorAll('.repLineChk:checked')).map(cb => cb.value);
  return picked.length ? picked : null;
}

function onReportTowersModeChange() {
  const mode = document.querySelector('input[name="repTowersMode"]:checked').value;
  document.getElementById('repTowersRangeWrap').style.display = mode === 'range' ? 'grid' : 'none';
  document.getElementById('repTowersSpecificWrap').style.display = mode === 'specific' ? '' : 'none';
  if (mode === 'specific') updateReportTowersList();
  updateReportResultCount();
}

function getReportSelectedTypes() {
  return Array.from(document.querySelectorAll('.repTypeChk:checked')).map(cb => cb.value);
}

// يرجّع كل أرقام الأبراج المتاحة ضمن فلتر الخط/التاريخ/النوع الحالي (بدون فلتر الأبراج نفسه) — لبناء قائمة "أبراج معينة"
// يجلب الكشوفات المطلوبة للتقارير مباشرة من السيرفر بفلترة الخط والتاريخ — بدل الاعتماد على كاش
// شامل محمَّل مسبقاً. هذا يعني حجم الطلب محدود بالفترة المختارة فقط، لا يكبر مع تراكم البيانات.
async function fetchInspectionsForReport(lines, from, to) {
  if (!from && !to && !lines) {
    // حالة نادرة: بدون أي تحديد فترة أو خط — نضطر لجلب كل شي (نفس السلوك القديم، استثناء متوقّع)
    return await fetchAllPages('inspections?select=*&order=created_at.desc');
  }
  let query = 'inspections?select=*&order=created_at.desc';
  if (from) query += `&inspection_date=gte.${from}`;
  if (to) query += `&inspection_date=lte.${to}`;
  if (lines && lines.length === 1) query += `&line_name=eq.${encodeURIComponent(lines[0])}`;
  const rows = await fetchAllPages(query);
  return (lines && lines.length > 1) ? rows.filter(r => lines.includes(r.line_name)) : rows;
}

async function getReportAvailableTowers() {
  const lines = getReportSelectedLines(); // null = كل الخطوط
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  const types = getReportSelectedTypes();
  const towers = new Set();
  if (types.includes('inspection')) {
    const rows = await fetchInspectionsForReport(lines, from, to);
    rows.forEach(r => { if (r.tower_number != null) towers.add(String(r.tower_number)); });
  }
  if (types.includes('treatment')) {
    (treatmentsCache||[]).forEach(t => {
      if ((!lines || lines.includes(t.line_name)) && (!from || (t.treatment_date||'') >= from) && (!to || (t.treatment_date||'') <= to) && t.tower_number != null) {
        towers.add(String(t.tower_number));
      }
    });
  }
  if (types.includes('thermal')) {
    (reportThermalFormsCache||[]).forEach(f => {
      if (lines && !lines.includes(f.line_name)) return;
      if (from && (f.inspection_date||'') < from) return;
      if (to && (f.inspection_date||'') > to) return;
      (Array.isArray(f.rows) ? f.rows : []).forEach(row => { if (row.tower_number) towers.add(String(row.tower_number)); });
    });
    // القراءات الخام أيضاً — بدونها ما تظهر بقائمة الاختيار الأبراج اللي إلها قراءة ميدانية بس
    (thermalRecords||[]).forEach(r => {
      if (r.point_type !== 'tower') return;
      if (lines && !lines.includes(r.line_name)) return;
      if (from && (r.inspection_date||'') < from) return;
      if (to && (r.inspection_date||'') > to) return;
      if (r.tower_number != null) towers.add(String(r.tower_number));
    });
  }
  return [...towers].sort((a,b) => (parseInt(a)||0) - (parseInt(b)||0) || a.localeCompare(b));
}

async function updateReportTowersList() {
  const wrap = document.getElementById('repTowersWrap');
  wrap.innerHTML = '<div style="font-size:0.8rem;color:#718096;grid-column:1/-1">⏳ جاري التحميل...</div>';
  const towers = await getReportAvailableTowers();
  if (!towers.length) { wrap.innerHTML = '<div style="font-size:0.8rem;color:#718096;grid-column:1/-1">لا توجد أبراج مطابقة</div>'; return; }
  wrap.innerHTML = towers.map(tn => `
    <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:2px 0">
      <input type="checkbox" class="repTowerChk" value="${tn}" checked onchange="updateReportResultCount()">
      <span>برج ${tn}</span>
    </label>`).join('');
}
function toggleAllReportTowers() {
  const boxes = document.querySelectorAll('.repTowerChk');
  if (!boxes.length) return;
  const allChecked = Array.from(boxes).every(b => b.checked);
  boxes.forEach(b => b.checked = !allChecked);
  updateReportResultCount();
}

// دالة تحقق موحّدة: هل رقم برج معيّن يمر فلتر الأبراج الحالي (كل / نطاق / معيّنة)؟
function reportTowerPasses(towerNumber) {
  const mode = document.querySelector('input[name="repTowersMode"]:checked').value;
  if (mode === 'all') return true;
  if (mode === 'range') {
    const from = parseFloat(document.getElementById('repTowerFrom').value);
    const to = parseFloat(document.getElementById('repTowerTo').value);
    const n = parseFloat(towerNumber);
    if (isNaN(n)) return false;
    if (!isNaN(from) && n < from) return false;
    if (!isNaN(to) && n > to) return false;
    return true;
  }
  // specific
  const selected = new Set(Array.from(document.querySelectorAll('.repTowerChk:checked')).map(b => b.value));
  return selected.has(String(towerNumber));
}

function onReportFilterChange() {
  if (document.querySelector('input[name="repTowersMode"]:checked').value === 'specific') updateReportTowersList();
  updateReportResultCount();
}

const isIssueSev = s => !!(s && s !== 'ok');

function treatmentMatchesCategories(t, categories) {
  if (!categories) return true;
  const items = t.items_treated || [];
  return categories.some(cat => {
    const prefixes = REPORT_CATEGORY_TREATMENT_PREFIXES[cat] || [];
    return items.some(it => prefixes.some(p => (it.key||'').startsWith(p) || (it.key||'') === p));
  });
}

// لو نفس البرج انسجّل أكثر من مرة بنفس التاريخ (تعديل متكرر أثناء نفس جلسة الكشف مثلاً)، نبقي آخر
// تسجيل فقط (الأحدث حسب created_at) — بدون هذا كان يظهر نفس البرج مكرر بالتقرير عدة مرات
function dedupeLatestPerTowerDate(rows, dateField) {
  const map = new Map();
  rows.forEach(r => {
    const key = r.line_name + '||' + r.tower_number + '||' + (r[dateField] || '');
    const existing = map.get(key);
    if (!existing || (r.created_at || '') > (existing.created_at || '')) map.set(key, r);
  });
  return [...map.values()];
}

async function getReportFilteredInspections() {
  const lines = getReportSelectedLines(); // null = كل الخطوط
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  const rows = await fetchInspectionsForReport(lines, from, to);
  const base = rows.filter(r => reportTowerPasses(r.tower_number));
  // ملاحظة مهمة: لا نفلتر بالتصنيف هنا — كل برج مطابق للخط/التاريخ/نطاق الأبراج يظهر بالتقرير دائماً،
  // والتصنيف المختار يتحكم بس بشنو المعلومات تُعرض بكل بطاقة (سليم أو تفاصيل الضرر) — راجع buildReportInspectionCardCanvas
  return sortByLineThenTower(dedupeLatestPerTowerDate(base, 'inspection_date'), 'tower_number');
}
function getReportFilteredTreatments() {
  const lines = getReportSelectedLines();
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  const categories = getReportSelectedCategories();
  const base = (treatmentsCache||[]).filter(t =>
    (!lines || lines.includes(t.line_name)) &&
    (!from || (t.treatment_date||'') >= from) &&
    (!to || (t.treatment_date||'') <= to) &&
    reportTowerPasses(t.tower_number)
  );
  const latest = dedupeLatestPerTowerDate(base, 'treatment_date');
  return sortByLineThenTower(latest.filter(t => treatmentMatchesCategories(t, categories)), 'tower_number');
}
function getReportFilteredThermalForms() {
  const lines = getReportSelectedLines();
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  // التصنيف يُتجاهل هنا (متفق عليه) — الكشف الحراري بيانات حرارة بس، ماله علاقة بقواعد/حديد/عوازل
  // فلتر الأبراج يُطبَّق على مستوى الصفوف داخل كل استمارة (استمارة واحدة تغطي عدة أبراج)
  return (reportThermalFormsCache||[])
    .filter(f => (!lines || lines.includes(f.line_name)) && (!from || (f.inspection_date||'') >= from) && (!to || (f.inspection_date||'') <= to))
    .map(f => ({
      ...f,
      rows: (Array.isArray(f.rows) ? f.rows : [])
        .filter(row => row.tower_number && reportTowerPasses(row.tower_number))
        .sort((a,b) => (parseInt(a.tower_number)||0) - (parseInt(b.tower_number)||0))
    }))
    .filter(f => f.rows.length);
}

// القراءات الحرارية الخام (من شاشة "كشف حراري ← جديد") — مصدر منفصل عن الاستمارات الرسمية
function getReportFilteredThermalRaw() {
  const lines = getReportSelectedLines();
  const from = document.getElementById('repFrom').value;
  const to = document.getElementById('repTo').value;
  return (thermalRecords||[]).filter(r =>
    r.point_type === 'tower' &&
    (!lines || lines.includes(r.line_name)) &&
    (!from || (r.inspection_date||'') >= from) &&
    (!to || (r.inspection_date||'') <= to) &&
    reportTowerPasses(r.tower_number)
  );
}

// حد الحرارة المرتفعة الخاص بملاحظات هذا التقرير (منفصل عمداً عن HOT_THRESHOLD العام المستخدم بشاشة أرشيف الكشف الحراري)
const REPORT_HOT_THRESHOLD = 80;
const IRAQI_MONTH_NAMES = ['كانون الثاني','شباط','آذار','نيسان','أيار','حزيران','تموز','آب','أيلول','تشرين الأول','تشرين الثاني','كانون الأول'];
function monthNameFromDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return IRAQI_MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
}

// يبني كل ملاحظات الكشف الحراري الخاصة ببرج معيّن (من القراءات الخام + صفوف الاستمارات الرسمية)
function getThermalNotesForTower(lineName, towerNumber, thermalRaw, thermalForms) {
  const notes = [];
  thermalRaw.forEach(r => {
    if (r.line_name !== lineName || String(r.tower_number) !== String(towerNumber)) return;
    const phases = [['R', [r.r1, r.r2]], ['S', [r.s1, r.s2]], ['T', [r.t1, r.t2]]];
    let hot = [];
    phases.forEach(([p, vals]) => {
      vals.forEach(v => { if (v != null && parseFloat(v) >= REPORT_HOT_THRESHOLD) hot.push(`⚠️ بتاريخ ${r.inspection_date}، وجود ارتفاع حرارة على الفيز ${p} بمقدار ${v}°`); });
    });
    if (hot.length) notes.push(...hot);
    else notes.push(`✅ هذا البرج تم كشفه حرارياً بتاريخ ${r.inspection_date} والنتيجة سليم`);
  });
  thermalForms.forEach(f => {
    if (f.line_name !== lineName) return;
    (f.rows||[]).forEach(row => {
      if (String(row.tower_number) !== String(towerNumber)) return;
      const phases = [['R', row.r], ['S', row.s], ['T', row.t]];
      let hot = [];
      phases.forEach(([p, v]) => { if (v != null && parseFloat(v) >= REPORT_HOT_THRESHOLD) hot.push(`⚠️ بتاريخ ${f.inspection_date}، وجود ارتفاع حرارة على الفيز ${p} بمقدار ${v}°`); });
      if (hot.length) notes.push(...hot);
      else notes.push(`📄 هذا البرج مذكور باستمارة الكشف الحراري الرسمية لشهر ${monthNameFromDate(f.inspection_date)}`);
    });
  });
  return notes;
}

// بطاقة ملاحظات الكشف الحراري لبرج معيّن — نص فقط، بنفس أسلوب باقي بطاقات التقرير
async function buildThermalNotesCardCanvas(lineName, towerNumber, notes) {
  const CARD_W = 760, PAD = 18;
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  mctx.font = '13px Tahoma, Arial, sans-serif';
  const wrapped = [];
  notes.forEach(line => wrapArabicText(mctx, line, CARD_W - PAD*2).forEach(l => wrapped.push(l)));

  const headerH = 40;
  const bodyH = wrapped.length * 18 + 10;
  const totalH = headerH + bodyH + PAD;
  const scale = 1.3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(CARD_W * scale);
  canvas.height = Math.ceil(totalH * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CARD_W, totalH);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';

  let y = PAD + 12;
  ctx.fillStyle = '#1A2A46';
  ctx.font = 'bold 14px Tahoma, Arial, sans-serif';
  ctx.fillText(`الخط: ${lineName||'-'}   |   برج: ${towerNumber||'-'}   |   🌡️ الكشف الحراري`, CARD_W - PAD, y);
  y += 18;
  ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(CARD_W - PAD, y); ctx.stroke();
  y += 20;

  ctx.font = '13px Tahoma, Arial, sans-serif';
  ctx.fillStyle = '#3C3C3C';
  wrapped.forEach(line => { ctx.fillText(line, CARD_W - PAD, y); y += 18; });

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.5), w: CARD_W, h: totalH };
}

async function updateReportResultCount() {
  const types = getReportSelectedTypes();
  const el = document.getElementById('repResultCount');
  el.textContent = '⏳ جاري الحساب...';
  let parts = [];
  if (types.includes('inspection')) parts.push(`📋 كشف: ${(await getReportFilteredInspections()).length}`);
  if (types.includes('treatment')) parts.push(`🔧 معالجة: ${getReportFilteredTreatments().length}`);
  if (types.includes('thermal')) {
    // نحسب عدد الأبراج المشمولة (من المصدرين معاً: القراءات الخام + صفوف الاستمارات الرسمية)
    // بدل عدد الاستمارات — لأن التقرير صار يعرض ملاحظة لكل برج لا جدول لكل استمارة
    const towers = new Set();
    getReportFilteredThermalRaw().forEach(r => towers.add(r.line_name + '||' + r.tower_number));
    getReportFilteredThermalForms().forEach(f => (f.rows||[]).forEach(row => towers.add(f.line_name + '||' + row.tower_number)));
    parts.push(`🌡️ كشف حراري: ${towers.size} برج`);
  }
  el.textContent = parts.length ? parts.join(' | ') : 'اختر نوع بيانات واحد على الأقل';
}

// بطاقة كشف واحدة (كانفاس) — تعرض بس التصنيفات المختارة (أو كل شي لو "الكل")
// يحمّل صورة (Image) من data URL جاهز — بديل بسيط لا يحتاج تحويل SVG (svgStringToImageEl مخصصة لنصوص SVG فقط)
function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function buildReportInspectionCardCanvas(r, categories) {
  const CARD_W = 760, PAD = 18;
  const lines = [];
  // نفس تسميات درجات الخطورة المستخدمة بالاستمارة بالضبط — تُذكر قرب كل عنصر متضرر
  const SEV_LABELS = { critical: 'حرجة', moderate: 'متوسطة', simple: 'بسيطة', below_critical: 'دون الحرجة' };
  // كل تصنيف مختار يظهر دائماً — لو ما فيه ضرر يكتب "سليم"، لو فيه يكتب التفاصيل + درجة الخطورة.
  // بدون هذا، كان البرج السليم يختفي كلياً من التقرير المصنَّف بدل ما يظهر ويوضَّح إنه سليم.
  const addCat = (label, text, sevCode) => {
    if (text && String(text).trim() && String(text).trim() !== 'سليم') {
      const sevText = (sevCode && SEV_LABELS[sevCode]) ? ` — (${SEV_LABELS[sevCode]})` : '';
      lines.push(`${label}: ${text}${sevText}`);
    } else {
      lines.push(`${label}: سليم`);
    }
  };

  const showAll = !categories;
  const showInsulator = showAll || categories.includes('insulator');

  if (showAll || categories.includes('foundation')) addCat('🧱 قواعد البرج', r.tower_foundations, r.sev_foundation);
  if (showAll || categories.includes('iron')) { addCat('🔩 تقاطعات الحديد', r.iron_intersections, r.sev_iron); addCat('🔩 ملحقات البرج', r.tower_attachments, r.sev_iron); }
  if (showAll || categories.includes('wires')) { addCat('〰️ أسلاك R', r.wires_r1, r.sev_wires); addCat('〰️ أسلاك S', r.wires_s1, r.sev_wires); addCat('〰️ أسلاك T', r.wires_t1, r.sev_wires); }
  if (showAll || categories.includes('ground')) { addCat('🌍 الأرضي 1', r.ground_1, r.sev_ground); addCat('🌍 الأرضي 2', r.ground_2, r.sev_ground); }
  // ملاحظة: لا يوجد حقل fire_causes منفصل محفوظ فعلياً بقاعدة البيانات (fire_causes_notes هو الحقل الحقيقي الوحيد) —
  // الإشارة القديمة لـr.fire_causes كانت دائماً فارغة (مرجع لحقل غير موجود)، فما كانت تظهر أي قيمة إطلاقاً
  if (showAll || categories.includes('fire')) addCat('🔥 مسببات الحرائق', r.fire_causes_notes, r.sev_fire);
  if (showAll || categories.includes('road')) {
    lines.push(`🛣️ الطريق: ${r.road_access || 'لم يُسجَّل'}`);
    if (r.road_access_notes && r.road_access_notes.trim()) lines.push(`🛣️ ملاحظات الطريق: ${r.road_access_notes.trim()}`);
  }

  // الملاحظات العامة لآخر كشف — تظهر دائماً إذا كان فيها أي نص، بغض النظر عن التصنيف المختار
  if (r.notes && String(r.notes).trim()) lines.push(`📝 ملاحظات: ${r.notes.trim()}`);

  // صور العوازل — منفصلة كلياً عن بطاقة النص، وموزَّعة كل وحدة لحالها. هذا مهم جداً: لو رسمنا
  // الدائرتين بصورة واحدة مدمجة وكانت الاثنتان متضررتان، الصورة تتجاوز ارتفاع الصفحة بسهولة (تأكدنا
  // رياضياً: ممكن توصل لأكثر من ضعف الارتفاع المتاح)، فتنقطع الدائرة الثانية بصمت تام بلا أي أثر.
  // الحل: كل دائرة متضررة تُرسم كصورة PNG مستقلة، توزَّع على الصفحات بشكل مستقل بنفس آلية باقي البطاقات.
  const insuratorImageCards = [];
  if (showInsulator) {
    const isDouble = isDoubleCircuitLine(r.line_name, r.insulator_state_2);
    const circuitHasDamage = (stateJSON) => {
      const st = safeParseJSON(stateJSON) || {};
      return ['R','S','T'].some(p => (st[p]||[]).some(Boolean));
    };
    if (isDouble) {
      const dmg1 = circuitHasDamage(r.insulator_state);
      const dmg2 = circuitHasDamage(r.insulator_state_2);
      if (!dmg1) lines.push('⚡ عوازل الدائرة الأولى: سليمة (لا يوجد ضرر مسجّل)');
      if (!dmg2) lines.push('⚡ عوازل الدائرة الثانية: سليمة (لا يوجد ضرر مسجّل)');
      // كل دائرة متضررة تُبنى كصورة مستقلة (forceSingleCircuit=true) بعنوانها الخاص — بدل صورة واحدة مدمجة
      if (dmg1) {
        const img1 = buildInsulatorExportPNG(r.insulator_state, r.voltage, r.tower_type, r.line_name, r.insulator_cycle, null, null, r.tower_number, r.insulator_chain_types, null, true);
        if (img1) insuratorImageCards.push(await buildInsulatorImageCard(r, img1, '⚡ عوازل الدائرة الأولى'));
      }
      if (dmg2) {
        const img2 = buildInsulatorExportPNG(r.insulator_state_2, r.voltage, r.tower_type, r.line_name, r.insulator_cycle_2, null, null, r.tower_number, r.insulator_chain_types_2, null, true);
        if (img2) insuratorImageCards.push(await buildInsulatorImageCard(r, img2, '⚡ عوازل الدائرة الثانية'));
      }
    } else {
      const insImg = buildInsulatorExportPNG(r.insulator_state, r.voltage, r.tower_type, r.line_name, r.insulator_cycle, null, null, r.tower_number, r.insulator_chain_types, null, true);
      if (insImg) insuratorImageCards.push(await buildInsulatorImageCard(r, insImg, '⚡ العوازل'));
      else lines.push('⚡ العوازل: سليمة (لا يوجد ضرر مسجّل)');
    }
  }
  if (!lines.length && !insuratorImageCards.length) lines.push('لا توجد بيانات لهذا التصنيف بهذا الكشف');

  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  mctx.font = '13px Tahoma, Arial, sans-serif';
  const wrapped = [];
  lines.forEach(line => wrapArabicText(mctx, line, CARD_W - PAD*2).forEach(l => wrapped.push(l)));

  const headerH = 40;
  const bodyH = wrapped.length ? (wrapped.length * 18 + 10) : 0;
  const totalH = headerH + bodyH + PAD*2;
  const scale = 1.3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(CARD_W * scale);
  canvas.height = Math.ceil(totalH * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CARD_W, totalH);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';

  let y = PAD + 12;
  ctx.fillStyle = '#1A2A46';
  ctx.font = 'bold 14px Tahoma, Arial, sans-serif';
  ctx.fillText(`الخط: ${r.line_name||'-'}   |   برج: ${r.tower_number||'-'}   |   التاريخ: ${r.inspection_date||'-'}   |   الفني: ${r.created_by_name||'-'}`, CARD_W - PAD, y);
  y += 18;
  ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(CARD_W - PAD, y); ctx.stroke();
  y += 20;

  if (wrapped.length) {
    ctx.font = '13px Tahoma, Arial, sans-serif';
    ctx.fillStyle = '#3C3C3C';
    wrapped.forEach(line => { ctx.fillText(line, CARD_W - PAD, y); y += 18; });
  }

  const textCard = { dataUrl: canvas.toDataURL('image/jpeg', 0.5), w: CARD_W, h: totalH };
  return [textCard, ...insuratorImageCards];
}

// بطاقة صورة عازل مستقلة (دائرة واحدة فقط) — تُستخدم بدل تضمين الصورة داخل بطاقة النص، حتى تُوزَّع
// على الصفحات بشكل مستقل ولا تنقطع لو تجاوزت المساحة المتبقية بالصفحة الحالية
async function buildInsulatorImageCard(r, insImg, titleLabel) {
  const CARD_W = 760, PAD = 18;
  const insImgEl = await loadImageFromDataUrl(insImg.dataUrl);
  const insDrawW = Math.min(CARD_W - PAD*2, 680);
  const insDrawH = insImgEl ? insDrawW * (insImg.h / insImg.w) : 0;
  const headerH = 34;
  const totalH = headerH + insDrawH + PAD*1.5;
  const scale = 1.3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(CARD_W * scale);
  canvas.height = Math.ceil(totalH * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CARD_W, totalH);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';

  let y = PAD;
  ctx.fillStyle = '#1A2A46';
  ctx.font = 'bold 13px Tahoma, Arial, sans-serif';
  ctx.fillText(`${titleLabel} — الخط: ${r.line_name||'-'} | برج: ${r.tower_number||'-'}`, CARD_W - PAD, y);
  y += 16;

  if (insImgEl) {
    const insX = CARD_W - PAD - insDrawW;
    try { ctx.drawImage(insImgEl, insX, y, insDrawW, insDrawH); } catch(e) { console.warn('[tower-app] فشل رسم صورة العازل المستقلة بالتقرير', e); }
  }

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.5), w: CARD_W, h: totalH };
}
// تحويل تصنيفات التقرير إلى أعمدة Excel مطابقة (من نفس تعريف EXPORT_COLUMNS الموحّد أصلاً)
const REPORT_CATEGORY_EXPORT_COLUMN_LABELS = {
  foundation: ['قواعد البرج'],
  iron: ['تقاطعات الحديد', 'ملحقات البرج'],
  insulator: ['عوازل الدائرة الأولى R', 'عوازل الدائرة الأولى S', 'عوازل الدائرة الأولى T', 'عوازل الدائرة الثانية R', 'عوازل الدائرة الثانية S', 'عوازل الدائرة الثانية T'],
  wires: ['أسلاك R', 'أسلاك S', 'أسلاك T'],
  ground: ['الأرضي 1', 'الأرضي 2'],
  fire: ['مسببات الحرائق'],
  road: ['وجود طريق', 'ملاحظات الطريق']
};
const REPORT_ALWAYS_COLUMNS = ['اسم الخط', 'تاريخ الكشف', 'رقم البرج', 'نوع البرج', 'الجهد', 'الموظف'];
function getReportExcelColumns(categories) {
  if (!categories) return EXPORT_COLUMNS; // "الكل" = كل الأعمدة
  const labels = new Set(REPORT_ALWAYS_COLUMNS);
  labels.add('ملاحظات');
  categories.forEach(cat => (REPORT_CATEGORY_EXPORT_COLUMN_LABELS[cat]||[]).forEach(l => labels.add(l)));
  return EXPORT_COLUMNS.filter(c => labels.has(c.label));
}

async function exportUnifiedReportExcel() {
  const types = getReportSelectedTypes();
  if (!types.length) { showToast('⚠️ اختر نوع بيانات واحد على الأقل', 'error'); return; }
  const categories = getReportSelectedCategories();
  showToast('⏳ جاري تجهيز البيانات...');

  const inspections = types.includes('inspection') ? await getReportFilteredInspections() : [];
  const treatments = types.includes('treatment') ? getReportFilteredTreatments() : [];
  const thermalForms = types.includes('thermal') ? getReportFilteredThermalForms() : [];
  const thermalRaw = types.includes('thermal') ? getReportFilteredThermalRaw() : [];

  if (!inspections.length && !treatments.length && !thermalForms.length && !thermalRaw.length) {
    showToast('⚠️ لا توجد بيانات مطابقة لإصدار تقرير', 'error');
    return;
  }

  await ensureXLSXLoaded(); // Lazy load: يضمن اكتمال تحميل XLSX قبل الاستخدام
  const wb = XLSX.utils.book_new();

  if (inspections.length) {
    const cols = getReportExcelColumns(categories);
    const data = inspections.map(r => { const o = {}; cols.forEach(c => { o[c.label] = c.get(r); }); return o; });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'كشف');
  }
  if (treatments.length) {
    const data = treatments.map(t => ({
      'اسم الخط': t.line_name,
      'رقم البرج': t.tower_number,
      'تاريخ المعالجة': t.treatment_date,
      'المعالج': t.treated_by || '',
      'العناصر المعالَجة': (t.items_treated||[]).map(i => i.label).join('، ')
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'معالجات');
  }
  if (thermalForms.length || thermalRaw.length) {
    const data = [];
    // المصدر الأول: القراءات الخام (شاشة "كشف حراري ← جديد")
    thermalRaw.forEach(r => {
      data.push({
        'اسم الخط': r.line_name,
        'تاريخ الكشف': r.inspection_date,
        'المصدر': 'قراءة ميدانية',
        'الفني': r.created_by_name || '',
        'رقم البرج': r.tower_number,
        'R': r.r1, 'S': r.s1, 'T': r.t1,
        'الحمل (MW)': '',
        'الحرارة المحيطة': r.ambient_temp,
        'ملاحظات': ''
      });
    });
    // المصدر الثاني: صفوف الاستمارات الرسمية
    thermalForms.forEach(f => {
      (f.rows||[]).forEach(row => {
        data.push({
          'اسم الخط': f.line_name,
          'تاريخ الكشف': f.inspection_date,
          'المصدر': 'استمارة رسمية',
          'الفني': f.created_by || '',
          'رقم البرج': row.tower_number,
          'R': row.r, 'S': row.s, 'T': row.t,
          'الحمل (MW)': row.load_mw,
          'الحرارة المحيطة': row.ambient,
          'ملاحظات': row.notes || ''
        });
      });
    });
    data.sort((a,b) => (a['اسم الخط']||'').localeCompare(b['اسم الخط']||'', 'ar') || (parseInt(a['رقم البرج'])||0) - (parseInt(b['رقم البرج'])||0));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'كشف حراري');
  }

  XLSX.writeFile(wb, 'تقرير_' + new Date().toISOString().split('T')[0] + '.xlsx');
  showToast('✅ تم تصدير Excel');
}

async function generateUnifiedReportPDF() {
  const types = getReportSelectedTypes();
  if (!types.length) { showToast('⚠️ اختر نوع بيانات واحد على الأقل', 'error'); return; }
  const categories = getReportSelectedCategories();

  const inspections = types.includes('inspection') ? await getReportFilteredInspections() : [];
  const treatments = types.includes('treatment') ? getReportFilteredTreatments() : [];
  const thermalRaw = types.includes('thermal') ? getReportFilteredThermalRaw() : [];
  const thermalForms = types.includes('thermal') ? getReportFilteredThermalForms() : [];

  if (!inspections.length && !treatments.length && !thermalRaw.length && !thermalForms.length) {
    showToast('⚠️ لا توجد بيانات مطابقة لإصدار تقرير', 'error');
    return;
  }

  showToast('⏳ جاري تحضير التقرير...');

  // قائمة موحّدة لكل (خط، برج) مذكور بأي من الأنواع المختارة — بدل أقسام منفصلة، كل برج يطلع
  // مرة وحدة وتحته كل بياناته بالترتيب: كشف ← معالجة ← ملاحظات الكشف الحراري (لو وُجدت)
  const towerMap = new Map();
  function addTower(line_name, tower_number) {
    if (!line_name || tower_number == null || tower_number === '') return;
    const key = line_name + '||' + tower_number;
    if (!towerMap.has(key)) towerMap.set(key, { line_name, tower_number });
  }
  inspections.forEach(r => addTower(r.line_name, r.tower_number));
  treatments.forEach(t => addTower(t.line_name, t.tower_number));
  thermalRaw.forEach(r => addTower(r.line_name, r.tower_number));
  thermalForms.forEach(f => (f.rows||[]).forEach(row => addTower(f.line_name, row.tower_number)));
  const towerList = sortByLineThenTower([...towerMap.values()], 'tower_number');

  try {
    await ensureJsPDFLoaded(); // Lazy load: يضمن اكتمال تحميل jsPDF قبل الاستخدام
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 30, marginTop = 50, marginBottom = 26;
    let y = marginTop;

    function ensureSpace(h) {
      // لا نقفز لصفحة جديدة إلا لو فيه محتوى مرسوم أصلاً بالصفحة الحالية — بدون هذا الشرط،
      // أول بطاقة كبيرة كانت تدفع فوراً لصفحة ثانية وتترك الصفحة الأولى شبه فارغة (بس العنوان)
      if (y > marginTop && y + h > pageH - marginBottom) { doc.addPage(); y = marginTop; }
    }
    async function drawCard(card) {
      const drawW = pageW - marginX*2;
      const drawH = card.h * (drawW / card.w);
      ensureSpace(drawH + 8);
      doc.addImage(card.dataUrl, 'JPEG', marginX, y, drawW, drawH);
      y += drawH + 8;
    }

    doc.setFontSize(13); doc.setTextColor(0,0,0);
    doc.text('Unified Report', pageW/2, 26, { align: 'center' });
    doc.setFontSize(9);
    doc.text(new Date().toLocaleDateString('en-GB'), pageW/2, 38, { align: 'center' });
    y = 50;

    for (const { line_name, tower_number } of towerList) {
      const insForTower = inspections.filter(r => r.line_name === line_name && String(r.tower_number) === String(tower_number));
      const treatForTower = treatments.filter(t => t.line_name === line_name && String(t.tower_number) === String(tower_number));
      const thermalNotes = types.includes('thermal') ? getThermalNotesForTower(line_name, tower_number, thermalRaw, thermalForms) : [];

      for (const r of insForTower) { for (const card of await buildReportInspectionCardCanvas(r, categories)) await drawCard(card); }
      for (const t of treatForTower) await drawCard(await buildTreatLogRecordCanvas(t));
      if (thermalNotes.length) await drawCard(await buildThermalNotesCardCanvas(line_name, tower_number, thermalNotes));
    }

    const blob = doc.output('blob');
    const filename = 'تقرير_' + new Date().toISOString().split('T')[0] + '.pdf';
    await shareOrDownloadFile(blob, filename, 'application/pdf');
    showToast('✅ تم تجهيز التقرير');
  } catch (err) {
    console.error(err);
    showToast('❌ تعذر تجهيز التقرير', 'error');
  }
}

// ========================
// المركز الموحّد: تصفح خط ← تاريخ ← تفاصيل (كشف بصري / كشف حراري / سجل معالجات)
// ========================
let hubBrowseType = null; // 'visual' | 'thermal' | 'treat'
let hubSelectedLine = null;
let hubSelectedDate = null;

function showHubView(id) {
  ['hubHomeView','hubLinesView','hubDatesView','hubDetailView'].forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = (v === id) ? '' : 'none';
  });
}

async function openRecordsHub() {
  showHubView('hubHomeView');
  hubBrowseType = null; hubSelectedLine = null; hubSelectedDate = null;
  await openReportsPage(); // يهيّئ فلاتر ونتائج قسم التصدير (كما هو تماماً)
}

// يرجّع كل المجموعات (خط+تاريخ) لنوع معيّن، بكل عناصرها
function getHubGroups(type) {
  const map = new Map();
  function ensure(line, date) {
    const key = line + '||' + date;
    if (!map.has(key)) map.set(key, { line_name: line, date, items: [], raw: [], forms: [] });
    return map.get(key);
  }
  if (type === 'visual') {
    // نستخدم "records" (كاش آخر 6 أشهر، محدود الحجم أصلاً) بدل fullRecordsCache — لأن الأخير صار
    // يحتوي "آخر حالة لكل برج" بس (رؤية latest_inspections)، وما يصلح لتصفّح تواريخ متعددة بالتاريخ
    (records||[]).forEach(r => { if (r.line_name && r.inspection_date) ensure(r.line_name, r.inspection_date).items.push(r); });
  } else if (type === 'treat') {
    (treatmentsCache||[]).forEach(t => { if (t.line_name && t.treatment_date) ensure(t.line_name, t.treatment_date).items.push(t); });
  } else if (type === 'thermal') {
    (thermalRecords||[]).forEach(r => { if (r.line_name && r.inspection_date) ensure(r.line_name, r.inspection_date).raw.push(r); });
    (reportThermalFormsCache||[]).forEach(f => { if (f.line_name && f.inspection_date) ensure(f.line_name, f.inspection_date).forms.push(f); });
  }
  return map;
}

const HUB_TYPE_LABELS = { visual: '👁️ الكشف البصري', thermal: '🌡️ الكشف الحراري', treat: '🔧 سجل المعالجات' };

async function openHubBrowse(type) {
  hubBrowseType = type;
  pushLevel(() => { showHubView('hubHomeView'); });
  showToast('⏳ جاري التحميل...');
  if (type === 'visual') await loadRecords().catch(()=>{});
  if (type === 'treat') await loadTreatments().catch(()=>{});
  if (type === 'thermal') await Promise.all([loadThermalArchive().catch(()=>{}), loadReportThermalForms().catch(()=>{})]);
  renderHubLines();
  showHubView('hubLinesView');
}

function renderHubLines() {
  const map = getHubGroups(hubBrowseType);
  const perLine = new Map();
  [...map.values()].forEach(g => { perLine.set(g.line_name, (perLine.get(g.line_name)||0) + 1); });
  const lines = [...perLine.keys()].sort((a,b) => a.localeCompare(b, 'ar'));
  const list = document.getElementById('hubLinesList');
  if (!lines.length) { list.innerHTML = `<div class="empty-state">لا توجد بيانات ${HUB_TYPE_LABELS[hubBrowseType]} بعد</div>`; return; }
  list.innerHTML = `<div class="page-title" style="grid-column:1/-1;font-size:1.05rem">${HUB_TYPE_LABELS[hubBrowseType]} — اختر الخط</div>` +
    lines.map(line => `<div class="card" onclick="openHubDates('${line.replace(/'/g,"\\'")}')"><span class="icon">⚡</span><span class="label">${line}</span><span class="sublabel">${perLine.get(line)} تاريخ كشف</span></div>`).join('');
}

function openHubDates(line) {
  hubSelectedLine = line;
  pushLevel(() => { showHubView('hubLinesView'); });
  renderHubDates();
  showHubView('hubDatesView');
}

function renderHubDates() {
  const map = getHubGroups(hubBrowseType);
  const groups = [...map.values()].filter(g => g.line_name === hubSelectedLine).sort((a,b) => (b.date||'').localeCompare(a.date||''));
  const list = document.getElementById('hubDatesList');
  if (!groups.length) { list.innerHTML = '<div class="empty-state">لا توجد تواريخ</div>'; return; }
  list.innerHTML = `<div class="page-title" style="grid-column:1/-1;font-size:1.05rem">${hubSelectedLine} — اختر التاريخ</div>` +
    groups.map(g => {
      let count, unit;
      if (hubBrowseType === 'thermal') { count = g.raw.length + g.forms.length; unit = 'قراءة/استمارة'; }
      else { count = g.items.length; unit = hubBrowseType === 'treat' ? 'معالجة' : 'برج'; }
      return `<div class="card" onclick="openHubDetail('${(g.date||'').replace(/'/g,"\\'")}')"><span class="icon">📅</span><span class="label">${g.date}</span><span class="sublabel">${count} ${unit}</span></div>`;
    }).join('');
}

function openHubDetail(date) {
  hubSelectedDate = date;
  pushLevel(() => { showHubView('hubDatesView'); });
  renderHubDetail();
  showHubView('hubDetailView');
}

function getCurrentHubGroup() {
  const map = getHubGroups(hubBrowseType);
  return map.get(hubSelectedLine + '||' + hubSelectedDate);
}

function renderHubDetail() {
  const g = getCurrentHubGroup();
  const summary = document.getElementById('hubDetailSummary');
  const list = document.getElementById('hubDetailList');
  if (!g) { summary.innerHTML = '<p>لا توجد بيانات</p>'; list.innerHTML = ''; return; }

  if (hubBrowseType === 'visual') {
    const withIssues = g.items.filter(r => ['sev_foundation','sev_iron','sev_insulator','sev_wires','sev_ground','sev_fire'].some(f => isIssueSev(r[f])));
    summary.innerHTML = `
      <h3 style="margin-top:0">${g.line_name} — ${g.date}</h3>
      <p style="font-size:0.85rem;color:#4A5568">🗼 عدد الأبراج المكشوفة: <b>${g.items.length}</b> | ⚠️ فيها ضرر: <b>${withIssues.length}</b></p>
      <button class="btn btn-del" style="margin-top:10px" onclick="deleteWholeHubDate()">🗑️ حذف هذا الكشف بالكامل (كل أبراج هذا التاريخ)</button>
      <button class="btn btn-primary" style="margin-top:6px" onclick="exportHubGroupNow()">📄 تصدير هذا الكشف (PDF)</button>
    `;
    list.innerHTML = g.items.sort((a,b)=>(a.tower_number||0)-(b.tower_number||0)).map(r => `
      <div class="dep-card">
        <div class="dep-card-header">
          <div class="dep-card-title">🗼 برج ${r.tower_number}</div>
          <div class="dep-card-meta">${r.tower_type||''} | 👤 ${r.created_by_name||'—'}</div>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button class="btn-sm" style="background:#EBF0F5;color:#2E4057;border:1px solid #CBD5E0;border-radius:6px;padding:4px 10px;font-size:0.78rem;cursor:pointer" onclick="editRecord('${r.id}')">✏️ تعديل</button>
          ${(currentUser.role==='admin')?`<button class="btn-sm btn-del" onclick="hubDeleteSingleInspection('${r.id}')">🗑️ حذف</button>`:''}
        </div>
      </div>`).join('');

  } else if (hubBrowseType === 'treat') {
    summary.innerHTML = `
      <h3 style="margin-top:0">${g.line_name} — ${g.date}</h3>
      <p style="font-size:0.85rem;color:#4A5568">🔧 عدد المعالجات: <b>${g.items.length}</b></p>
      <button class="btn btn-del" style="margin-top:10px" onclick="deleteWholeHubDate()">🗑️ حذف كل معالجات هذا التاريخ</button>
      <button class="btn btn-primary" style="margin-top:6px" onclick="exportHubGroupNow()">📄 تصدير هذا الكشف (PDF)</button>
    `;
    list.innerHTML = g.items.sort((a,b)=>(a.tower_number||0)-(b.tower_number||0)).map(t => `
      <div class="dep-card">
        <div class="dep-card-header">
          <div class="dep-card-title">🗼 برج ${t.tower_number}</div>
          <div class="dep-card-meta">👤 ${t.treated_by||'—'}</div>
        </div>
        <div class="dep-items" style="margin-top:8px">${(t.items_treated||[]).map(i=>`<span class="dep-item fixed">✅ ${i.label}</span>`).join('')}</div>
        <div style="margin-top:8px;display:flex;gap:8px">
          ${(currentUser.role==='admin')?`<button class="btn-sm" style="background:#EBF0F5;color:#2E4057;border:1px solid #CBD5E0;border-radius:6px;padding:4px 10px;font-size:0.78rem;cursor:pointer" onclick="openTreatmentEditModal('${t.id}')">✏️ تعديل</button><button class="btn-sm btn-del" onclick="hubDeleteSingleTreatment('${t.id}')">🗑️ حذف</button>`:''}
        </div>
      </div>`).join('');

  } else if (hubBrowseType === 'thermal') {
    summary.innerHTML = `
      <h3 style="margin-top:0">${g.line_name} — ${g.date}</h3>
      <p style="font-size:0.85rem;color:#4A5568">🌡️ قراءات خام: <b>${g.raw.length}</b> | 📄 استمارات رسمية: <b>${g.forms.length}</b></p>
      <button class="btn btn-primary" style="margin-top:6px" onclick="exportHubGroupNow()">📄 تصدير هذا الكشف (PDF)</button>
    `;
    let html = '';
    if (g.forms.length) {
      html += '<h4 style="margin:10px 0 6px">📄 الاستمارات الرسمية</h4>' + g.forms.map(f => `
        <div class="dep-card">
          <div class="dep-card-header">
            <div class="dep-card-title">📄 استمارة (${(f.rows||[]).length} برج)</div>
            <div class="dep-card-meta">👤 ${f.created_by||'—'}</div>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px">
            <button class="btn-sm" style="background:#EBF0F5;color:#2E4057;border:1px solid #CBD5E0;border-radius:6px;padding:4px 10px;font-size:0.78rem;cursor:pointer" onclick="openOfficialFormFromArchive('${f.id}')">✏️ فتح/تعديل</button>
            ${(currentUser.role==='admin')?`<button class="btn-sm btn-del" onclick="hubDeleteOfficialForm('${f.id}')">🗑️ حذف</button>`:''}
          </div>
        </div>`).join('');
    }
    if (g.raw.length) {
      html += '<h4 style="margin:10px 0 6px">🌡️ القراءات الخام</h4>' + g.raw.map(r => `
        <div class="dep-card">
          <div class="dep-card-header">
            <div class="dep-card-title">🗼 ${r.point_label||('برج '+(r.tower_number||''))}</div>
            <div class="dep-card-meta">R:${r.r1??'-'} S:${r.s1??'-'} T:${r.t1??'-'} | 👤 ${r.created_by_name||'—'}</div>
          </div>
          <div style="margin-top:8px">
            ${(currentUser.role==='admin')?`<button class="btn-sm btn-del" onclick="hubDeleteRawThermal('${r.id}')">🗑️ حذف</button>`:''}
          </div>
        </div>`).join('');
    }
    list.innerHTML = html || '<div class="empty-state">لا توجد قراءات</div>';
  }
}

async function hubDeleteSingleInspection(id) {
  if (!(currentUser.role === 'admin')) { showToast('⚠️ الحذف من صلاحيات المدير فقط', 'error'); return; }
  if (!confirm('🗑️ تأكيد حذف كشف هذا البرج؟ هذا الإجراء لا يمكن التراجع عنه.')) return;
  try {
    const res = await sbFetch(`inspections?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    fullRecordsCache = fullRecordsCache.filter(r => r.id !== id);
    rebuildLatestRecordsIndex();
    records = records.filter(r => r.id !== id); // مزامنة كاش شاشة السجلات أيضاً
    showToast('🗑️ تم الحذف');
    renderHubDetail();
  } catch (e) { showToast('❌ تعذر الحذف', 'error'); }
}
async function hubDeleteSingleTreatment(id) {
  await deleteTreatmentRecord(id); // نفس الدالة المستخدمة بشاشة المغادرات — يضمن التزامن بكل مكان
  renderHubDetail();
}
async function hubDeleteOfficialForm(id) {
  await deleteOfficialFormFromArchive(id);
  await loadReportThermalForms();
  renderHubDetail();
}
async function hubDeleteRawThermal(id) {
  if (!(currentUser.role === 'admin')) { showToast('⚠️ الحذف من صلاحيات المدير فقط', 'error'); return; }
  if (!confirm('🗑️ تأكيد حذف هذي القراءة؟')) return;
  try {
    const res = await sbFetch(`thermal_inspections?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    thermalRecords = thermalRecords.filter(r => r.id !== id);
    showToast('🗑️ تم الحذف');
    renderHubDetail();
  } catch (e) { showToast('❌ تعذر الحذف', 'error'); }
}

async function deleteWholeHubDate() {
  if (!(currentUser.role === 'admin')) { showToast('⚠️ الحذف من صلاحيات المدير فقط', 'error'); return; }
  const g = getCurrentHubGroup();
  if (!g) return;
  const n = g.items.length;
  if (!confirm(`🗑️ تأكيد حذف كل بيانات ${hubSelectedLine} بتاريخ ${hubSelectedDate} (${n} سجل)؟ هذا الإجراء لا يمكن التراجع عنه نهائياً.`)) return;
  showToast('⏳ جاري الحذف...');
  const table = hubBrowseType === 'visual' ? 'inspections' : 'treatments';
  const ids = g.items.map(x => x.id);
  const succeededIds = [];
  for (const id of ids) {
    try {
      const res = await sbFetch(`${table}?id=eq.${id}`, { method: 'DELETE' });
      if (res.ok) succeededIds.push(id);
      else console.warn('[tower-app] فشل حذف', table, id, 'HTTP', res.status);
    } catch (e) { console.warn('[tower-app] فشل حذف', table, id, e); }
  }
  // نمسح من الكاش بس اللي فعلاً انحذف — قبل كذا كان يُمسح الكل من الكاش حتى لو فشل الحذف الحقيقي بالسيرفر
  if (hubBrowseType === 'visual') {
    fullRecordsCache = fullRecordsCache.filter(r => !succeededIds.includes(r.id));
    rebuildLatestRecordsIndex();
    records = records.filter(r => !succeededIds.includes(r.id));
  }
  else treatmentsCache = treatmentsCache.filter(t => !succeededIds.includes(t.id));
  const success = succeededIds.length;
  showToast(success === n ? `🗑️ تم حذف ${success} من ${n}` : `⚠️ تم حذف ${success} من ${n} فقط — راجع سجل المتصفح لمعرفة السبب`, success === n ? undefined : 'error');
  goBackFromOperation(); // نرجع لقائمة التواريخ لأن هذا التاريخ ما عاد موجود
}

// تصدير سريع لنفس الخط والتاريخ المعروضين حالياً — يهيّئ فلاتر قسم التصدير تلقائياً ثم يصدّر PDF
async function exportHubGroupNow() {
  showHubView('hubHomeView');
  // نحدد بس هذا الخط بخانات الاختيار المتعددة (نلغي "الكل" ونعلّم خانة هذا الخط تحديداً)
  document.getElementById('repLinesAll').checked = false;
  document.getElementById('repLinesWrap').style.display = 'grid';
  document.querySelectorAll('.repLineChk').forEach(cb => { cb.checked = (cb.value === hubSelectedLine); });
  document.getElementById('repFrom').value = hubSelectedDate;
  document.getElementById('repTo').value = hubSelectedDate;
  // ترجمة صريحة بين تسميات المركز الموحّد وتسميات قسم التصدير — بدونها كان التصدير من قسم
  // المعالجات يفشل بصمت لأن 'treat' لا تطابق قيمة الـcheckbox 'treatment'
  const HUB_TYPE_TO_REPORT_TYPE = { visual: 'inspection', treat: 'treatment', thermal: 'thermal' };
  const wantedType = HUB_TYPE_TO_REPORT_TYPE[hubBrowseType];
  document.querySelectorAll('.repTypeChk').forEach(cb => { cb.checked = (cb.value === wantedType); });
  document.querySelector('input[name="repTowersMode"][value="all"]').checked = true;
  onReportTowersModeChange();
  await generateUnifiedReportPDF();
}

