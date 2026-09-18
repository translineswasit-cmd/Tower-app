// ========================
// DAILY REPORT (الموقف اليومي للخطوط)
// ========================
let dailyReportRows = [];
let editingDailyReportId = null;
let dailyReportTabRequestSeq = 0;

function showDailyReportHome() {
  switchDailyReportTab('new');
  resetDailyReportForm();
}

function startNewDailyReport() {
  resetDailyReportForm();
  switchDailyReportTab('new');
}

function resetDailyReportForm() {
  editingDailyReportId = null;
  document.getElementById('dr_date').value = new Date().toISOString().split('T')[0];
  document.getElementById('dailyReportRowsWrap').innerHTML = '';
  document.getElementById('dailyReportActions').style.display = 'none';
  document.getElementById('dailyReportSaveBar').style.display = 'none';
  dailyReportRows = [];
}

async function switchDailyReportTab(tab) {
  const requestId = ++dailyReportTabRequestSeq;
  document.getElementById('drTabNewBtn').classList.toggle('active', tab === 'new');
  document.getElementById('drTabArchiveBtn').classList.toggle('active', tab === 'archive');
  document.getElementById('drTabPeriodBtn').classList.toggle('active', tab === 'period');
  document.getElementById('drNewView').style.display = tab === 'new' ? '' : 'none';
  document.getElementById('drArchiveView').style.display = tab === 'archive' ? '' : 'none';
  // تُخفى دائماً أولاً؛ لا تُظهَر إلا بعد اكتمال تحميل period-summary.js بنجاح أدناه (لا نجعل
  // واجهة تقرير الفترة قابلة للتفاعل قبل اكتمال تحميل الملف الكسول الخاص بها).
  document.getElementById('drPeriodView').style.display = 'none';
  if (tab === 'archive') renderDailyReportArchive();
  if (tab !== 'period') return;
  try {
    await ensurePeriodSummaryLoaded();
  } catch (e) {
    if (requestId !== dailyReportTabRequestSeq) return;
    showToast('❌ تعذر تحميل ميزة تقرير الفترة، تأكد من الاتصال وحاول مرة ثانية', 'error');
    return;
  }
  if (requestId !== dailyReportTabRequestSeq) return;
  document.getElementById('drPeriodView').style.display = '';
}

async function renderDailyReportArchive() {
  const body = document.getElementById('drArchiveBody');
  body.innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  try {
    const res = await sbFetch('daily_reports?select=id,report_date,rows,created_by,created_at&order=report_date.desc');
    const list = await res.json();
    if (!list.length) { body.innerHTML = '<div class="empty-state">لا توجد تقارير محفوظة بعد</div>'; return; }
    body.innerHTML = list.map(rep => {
      const rowCount = Array.isArray(rep.rows) ? rep.rows.length : 0;
      return `<div class="dep-card" style="cursor:pointer" onclick="openDailyReportFromArchive('${rep.id}')">
        <div class="dep-card-header">
          <div class="dep-card-title">📅 ${rep.report_date}</div>
          <div class="dep-card-meta">📋 ${rowCount} خط | 👤 ${rep.created_by||'—'}</div>
        </div>
        <div style="margin-top:8px">
          <button class="btn-sm btn-del" onclick="event.stopPropagation();deleteDailyReportFromArchive('${rep.id}')">🗑️ حذف</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    body.innerHTML = '<div class="empty-state">❌ تعذر تحميل الأرشيف</div>';
  }
}

async function deleteDailyReportFromArchive(id) {
  if (!confirm('🗑️ تأكيد حذف هذا التقرير اليومي من الأرشيف؟ هذا الإجراء لا يمكن التراجع عنه نهائيًا.')) return;
  try {
    const res = await sbFetch(`daily_reports?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('فشل الحذف');
    showToast('✅ تم حذف التقرير');
    renderDailyReportArchive();
  } catch (e) {
    showToast('❌ تعذر حذف التقرير، تحقق من الاتصال', 'error');
  }
}

async function openDailyReportFromArchive(id) {
  try {
    const res = await sbFetch(`daily_reports?id=eq.${id}&select=id,report_date,rows`);
    const list = await res.json();
    if (!list.length) { showToast('❌ التقرير غير موجود', 'error'); return; }
    const rep = list[0];
    editingDailyReportId = rep.id;
    document.getElementById('dr_date').value = rep.report_date;
    dailyReportRows = Array.isArray(rep.rows) ? rep.rows : [];
    renderDailyReportRows();
    populateAddLineSelect();
    document.getElementById('dailyReportActions').style.display = 'flex';
    document.getElementById('dailyReportSaveBar').style.display = 'flex';
    const shareBtn = document.getElementById('dr_share_btn');
    if (shareBtn) shareBtn.style.display = (navigator.canShare && navigator.share) ? '' : 'none';
    switchDailyReportTab('new');
    showToast('📂 تم تحميل التقرير، تكدر تعدّله وتحفظه');
  } catch (e) {
    showToast('❌ تعذر فتح التقرير', 'error');
  }
}

function findLineInfo(lineName) {
  if (!lineName) return null;
  const clean = lineName.trim().replace(/\s+/g, ' ');
  // مطابقة تامة أولاً
  let found = linesInfoCache.find(l => l.name === clean);
  if (found) return found;
  // مطابقة مرنة: تجاهل الفروق البسيطة بالمسافات
  found = linesInfoCache.find(l => l.name.trim().replace(/\s+/g, ' ') === clean);
  if (found) return found;
  // مطابقة جزئية: يحتوي على نفس الكلمات
  found = linesInfoCache.find(l => l.name.replace(/\s+/g,' ').includes(clean) || clean.includes(l.name.replace(/\s+/g,' ')));
  return found || null;
}

async function generateDailyReport() {
  const date = document.getElementById('dr_date').value;
  if (!date) { showToast('⚠️ اختر التاريخ أولاً', 'error'); return; }
  // تحذير مهم: التقرير يقرأ من السيرفر مباشرة — لو فيه بيانات لسا بجهازك ما وصلت (أوف لاين أو نت
  // ضعيف)، التقرير يطلع ناقص بصمت (مثلاً كشفت 30 برج ووصل السيرفر منهم 1-2 بس وقت التوليد)
  const pending = getTotalPendingCount();
  if (pending > 0) {
    const proceed = confirm(`⚠️ عندك ${pending} عنصر بجهازك لسا ما وصل السيرفر (بانتظار الرفع).\n\nلو تولّد التقرير الحين، ممكن يطلع ناقص (ما يشمل هذي البيانات لحد ما توصل).\n\nتأكد من اتصال النت وانتظر لين يوصل صفر بالشارة، وبعدها ولّد التقرير.\n\nتبي تكمل التوليد الحين على أي حال؟`);
    if (!proceed) return;
  }
  editingDailyReportId = null;

  document.getElementById('dailyReportRowsWrap').innerHTML = '<div class="empty-state">⏳ جاري التوليد...</div>';
  try {
    const [inspRes, thermRes, lineThermRes, treatRes] = await Promise.all([
      sbFetch(`inspections?select=line_name,tower_number&inspection_date=eq.${date}`),
      sbFetch(`thermal_inspections?select=line_name,tower_number&inspection_date=eq.${date}`),
      sbFetch(`line_entry_thermal?select=line_name&inspection_date=eq.${date}`),
      sbFetch(`treatments?select=line_name,tower_number,items_treated&treatment_date=eq.${date}`)
    ]);
    const [insp, therm, lineTherm, treat] = await Promise.all([
      inspRes.json(), thermRes.json(), lineThermRes.json(), treatRes.json()
    ]);

    const byLine = {};
    function ensure(line) {
      if (!byLine[line]) byLine[line] = {
        visualTowers: new Set(),
        thermalTowers: new Set(),
        hasThermal: false,
        lineEntryThermal: false,
        // معالجات: مصفوفة كائنات { tower, types: Set }
        ironTowers: new Set(),      // حديد → بدون إطفاء
        insulatorTowers: new Set(), // عوازل → بإطفاء
        wireTowers: new Set(),      // أسلاك → بإطفاء
        groundTowers: new Set(),    // أرضي → بإطفاء
        foundationTowers: new Set(),// قواعد → بدون إطفاء
        fireTowers: new Set(),      // حرائق
        hasOutage: false,           // يُحدَّث لاحقاً
        hasNoOutage: false
      };
      return byLine[line];
    }

    insp.forEach(r => {
      if (!r.line_name) return;
      const e = ensure(r.line_name);
      if (r.tower_number != null) e.visualTowers.add(String(r.tower_number));
    });
    therm.forEach(r => {
      if (!r.line_name) return;
      const e = ensure(r.line_name);
      e.hasThermal = true;
      if (r.tower_number != null) e.thermalTowers.add(String(r.tower_number));
    });
    lineTherm.forEach(r => {
      if (!r.line_name) return;
      const e = ensure(r.line_name);
      e.hasThermal = true;
      e.lineEntryThermal = true;
    });

    treat.forEach(r => {
      if (!r.line_name) return;
      const e = ensure(r.line_name);
      let items = r.items_treated;
      if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = []; } }
      if (!Array.isArray(items)) return;
      const tNum = r.tower_number != null ? String(r.tower_number) : null;
      items.forEach(it => {
        const k = (it.key || '').toLowerCase();
        if (k.startsWith('ins'))  { if (tNum) e.insulatorTowers.add(tNum); }
        else if (k === 'iron')    { if (tNum) e.ironTowers.add(tNum); }
        else if (k.startsWith('wire')) { if (tNum) e.wireTowers.add(tNum); }
        else if (k.startsWith('ground')) { if (tNum) e.groundTowers.add(tNum); }
        else if (k === 'foundation') { if (tNum) e.foundationTowers.add(tNum); }
        else if (k === 'fire')    { if (tNum) e.fireTowers.add(tNum); }
      });
    });

    // تحديد نوع الصيانة وبناء الملاحظات
    dailyReportRows = Object.keys(byLine).map(lineName => {
      const info = byLine[lineName];
      // أنواع تحتاج إطفاء: عوازل + أسلاك + أرضي
      const outageTypes = info.insulatorTowers.size > 0 || info.wireTowers.size > 0 || info.groundTowers.size > 0;
      // أنواع بدون إطفاء: حديد + قواعد
      const noOutageTypes = info.ironTowers.size > 0 || info.foundationTowers.size > 0;
      const hasFire = info.fireTowers.size > 0;

      // ترتيب الأبراج تصاعدياً للعرض
      const sortT = s => [...s].sort((a,b) => Number(a)-Number(b));

      // بناء الملاحظات
      const notesParts = [];

      // كشف بصري
      if (info.visualTowers.size > 0) {
        const nums = sortT(info.visualTowers).join('، ');
        notesParts.push(`تم الكشف البصري على الأبراج التالية: ${nums}`);
      }
      // كشف حراري بأبراج
      if (info.thermalTowers.size > 0) {
        const nums = sortT(info.thermalTowers).join('، ');
        notesParts.push(`تم الكشف الحراري على الأبراج: ${nums}`);
      }
      // معالجة حديد
      if (info.ironTowers.size > 0) {
        sortT(info.ironTowers).forEach(t => notesParts.push(`تم تعويض تقاطعات حديد على البرج ${t}`));
      }
      // معالجة عوازل
      if (info.insulatorTowers.size > 0) {
        sortT(info.insulatorTowers).forEach(t => notesParts.push(`العمل على تبديل عوازل البرج رقم ${t}`));
      }
      // معالجة أسلاك
      if (info.wireTowers.size > 0) {
        sortT(info.wireTowers).forEach(t => notesParts.push(`تم معالجة قطوعات جزئية بين الأبراج ${t}-${Number(t)+1}`));
      }
      // معالجة أرضي
      if (info.groundTowers.size > 0) {
        sortT(info.groundTowers).forEach(t => notesParts.push(`تم معالجة قطوعات جزئية بين الأبراج ${t}-${Number(t)+1}`));
      }
      // معالجة قواعد
      if (info.foundationTowers.size > 0) {
        sortT(info.foundationTowers).forEach(t => notesParts.push(`تم معالجة قواعد البرج ${t}`));
      }
      // معالجة حرائق
      if (hasFire) {
        sortT(info.fireTowers).forEach(t => notesParts.push(`تم إزالة مسببات الحرائق وقطع الأشجار بين الأبراج ${t}-${Number(t)+1}`));
      }

      const row = buildDailyReportRow(lineName, {
        visualTowers: info.visualTowers,
        thermalTowers: info.thermalTowers,
        hasThermal: info.hasThermal,
        // إذا بإطفاء، يلغي بدون إطفاء
        sched_outage: outageTypes,
        sched_no_outage: noOutageTypes && !outageTypes,
        fire: hasFire
      });

      // التفاصيل التشغيلية تذهب لحقل "تفاصيل العمل" بدل "الملاحظات"
      row.work_details = notesParts.join('، ');
      // حقل الملاحظات يبقى فقط للملاحظات الثابتة (مشترك مع...) التي تملأها buildDailyReportRow

      return row;
    });

    renderDailyReportRows();
    populateAddLineSelect();
    document.getElementById('dailyReportActions').style.display = 'flex';
    document.getElementById('dailyReportSaveBar').style.display = 'flex';
    const shareBtn = document.getElementById('dr_share_btn');
    if (shareBtn) shareBtn.style.display = (navigator.canShare && navigator.share) ? '' : 'none';
    if (!dailyReportRows.length) showToast('ℹ️ ما لقينا أي نشاط مسجل بهذا التاريخ، تكدر تضيف خط يدوياً');
  } catch (e) {
    document.getElementById('dailyReportRowsWrap').innerHTML = '<div class="empty-state">❌ تعذر توليد التقرير</div>';
  }
}

function buildWorkDetailsText(row) {
  // التفاصيل التشغيلية باتت تُبنى مباشرة بدالة generateDailyReport وتُوضع بـwork_details
  // هذه الدالة تبقى للخطوط المضافة يدوياً أو المجموعات الجماعية فقط
  return '';
}

function buildDailyReportRow(lineName, info) {
  const li = findLineInfo(lineName);
  const row = {
    line_name: lineName,
    network: 'واسط',
    company: 'الوسطى',
    voltage: li ? li.voltage : '',
    length: li ? li.length : '',
    capacity: li ? li.capacity : '',
    tension_towers: li ? li.tension_towers : '',
    visual: info ? info.visualTowers.size > 0 : false,
    thermal: info ? info.hasThermal : false,
    sched_no_outage: info ? (info.sched_no_outage || false) : false,
    sched_outage: info ? (info.sched_outage || false) : false,
    emergency_outage: false,
    fire_removal: info ? (info.fire || false) : false,
    visual_length: '',
    thermal_towers: info ? info.thermalTowers.size || '' : '',
    thermal_load: '',
    work_details: '',
    notes: ''
  };
  row.work_details = buildWorkDetailsText(row);
  // الخطوط المشتركة: تُستخرج عبارة "مشترك مع..." من بيانات الخط تلقائياً لخانة الملاحظات
  if (li && li.notes) {
    const idx = li.notes.indexOf('مشترك مع');
    if (idx !== -1) row.notes = 'الخط ' + li.notes.substring(idx);
  }
  return row;
}

const BULK_LINE_GROUPS = {
  'BULK_THERMAL_400': {
    label: 'الكشف الحراري على مداخل خطوط 400 محطة واسط 400',
    workDetails: 'الكشف الحراري على مدخل الخط في محطة واسط 400',
    lines: ['واسط - واسط الحرارية رقم 1', 'واسط - واسط الحرارية رقم 2', 'واسط - شطرة', 'واسط - ميسان']
  },
  'BULK_THERMAL_132': {
    label: 'الكشف على مداخل خطوط 132 في محطة واسط 400',
    workDetails: 'الكشف الحراري على مدخل الخط 132 في محطة واسط 400',
    lines: ['واسط - شمال الكوت (1+2)', 'واسط - شمال الكوت رقم 3', 'واسط - شيخ سعد', 'واسط - الكوت القديمة',
      'واسط - مركز الكوت', 'واسط - شمال غرب الكوت (1+2)', 'واسط - دبوني', 'واسط - نعمانية رقم 3']
  }
};

function populateAddLineSelect() {
  const sel = document.getElementById('dr_add_line_select');
  const bulkOptions = Object.entries(BULK_LINE_GROUPS)
    .map(([key, g]) => `<option value="${key}">📦 ${g.label} (${g.lines.length} خطوط)</option>`).join('');
  sel.innerHTML = '<option value="">-- اختر خط أو مجموعة لإضافتها --</option>' +
    `<optgroup label="إضافة جماعية">${bulkOptions}</optgroup>` +
    `<optgroup label="خط منفرد">${linesInfoCache.map(l => `<option value="${l.name}">${l.name} (${l.voltage} ك.ف)</option>`).join('')}</optgroup>`;
}

function addBulkDailyReportLines(key) {
  const group = BULK_LINE_GROUPS[key];
  if (!group) return;
  syncDailyReportRowsFromDOM();
  let addedCount = 0, skipped = [];
  group.lines.forEach(lineName => {
    let row = dailyReportRows.find(r => r.line_name === lineName);
    if (row) {
      skipped.push(lineName);
      row.thermal = true;
      if (!row.work_details) row.work_details = group.workDetails;
    } else {
      row = buildDailyReportRow(lineName, null);
      row.thermal = true;
      row.work_details = group.workDetails;
      dailyReportRows.push(row);
      addedCount++;
    }
  });
  renderDailyReportRows();
  showToast(`✅ تمت إضافة ${addedCount} خط${skipped.length ? ` (و${skipped.length} كانت موجودة، تم تفعيل الكشف الحراري لها)` : ''}`);
}

function addDailyReportLine() {
  const sel = document.getElementById('dr_add_line_select');
  const value = sel.value;
  if (!value) return;
  if (BULK_LINE_GROUPS[value]) {
    addBulkDailyReportLines(value);
    sel.value = '';
    return;
  }
  const lineName = value;
  syncDailyReportRowsFromDOM();
  if (dailyReportRows.some(r => r.line_name === lineName)) { showToast('⚠️ الخط موجود بالتقرير بالفعل', 'error'); sel.value = ''; return; }
  dailyReportRows.push(buildDailyReportRow(lineName, null));
  sel.value = '';
  renderDailyReportRows();
  showToast('✅ تمت إضافة الخط');
}

function removeDailyReportLine(idx) {
  syncDailyReportRowsFromDOM();
  dailyReportRows.splice(idx, 1);
  renderDailyReportRows();
}

function syncDailyReportRowsFromDOM() {
  dailyReportRows.forEach((row, idx) => {
    const get = (id) => document.getElementById(id);
    ['visual','thermal','sched_no_outage','sched_outage','emergency_outage','fire_removal'].forEach(k => {
      const el = get(`dr_${k}_${idx}`); if (el) row[k] = el.checked;
    });
    ['visual_length','thermal_towers','thermal_load'].forEach(k => {
      const el = get(`dr_${k}_${idx}`); if (el) row[k] = el.value;
    });
    ['work_details','notes'].forEach(k => {
      const el = get(`dr_${k}_${idx}`); if (el) row[k] = el.value;
    });
  });
}

function renderDailyReportRows() {
  const wrap = document.getElementById('dailyReportRowsWrap');
  if (!dailyReportRows.length) { wrap.innerHTML = '<div class="empty-state">لا توجد خطوط بالتقرير حالياً</div>'; return; }
  wrap.innerHTML = dailyReportRows.map((row, idx) => `
    <div class="dr-row-card">
      <div class="dr-row-head">
        <div class="dr-row-title">📡 ${row.line_name}</div>
        <button class="btn-sm btn-secondary" onclick="removeDailyReportLine(${idx})">✖ حذف</button>
      </div>
      <div class="dr-meta-grid">
        <span>الجهد: ${row.voltage||'—'} ك.ف</span>
        <span>طول الخط: ${row.length||'—'} كم</span>
        <span>السعة: ${row.capacity||'—'} MVA</span>
        <span>أبراج الشد: ${row.tension_towers||'—'}</span>
      </div>
      <div class="dr-checks">
        <label class="dr-check-pill"><input type="checkbox" id="dr_visual_${idx}" ${row.visual?'checked':''}> كشف بصري</label>
        <label class="dr-check-pill"><input type="checkbox" id="dr_thermal_${idx}" ${row.thermal?'checked':''}> كشف حراري</label>
        <label class="dr-check-pill"><input type="checkbox" id="dr_sched_no_outage_${idx}" ${row.sched_no_outage?'checked':''}> صيانة مبرمجة بدون إطفاء</label>
        <label class="dr-check-pill"><input type="checkbox" id="dr_sched_outage_${idx}" ${row.sched_outage?'checked':''}> صيانة مبرمجة بإطفاء</label>
        <label class="dr-check-pill"><input type="checkbox" id="dr_emergency_outage_${idx}" ${row.emergency_outage?'checked':''}> صيانة طارئة بإطفاء</label>
        <label class="dr-check-pill"><input type="checkbox" id="dr_fire_removal_${idx}" ${row.fire_removal?'checked':''}> إزالة مسببات حرائق</label>
      </div>
      <div class="dr-num-grid">
        <input id="dr_visual_length_${idx}" type="number" placeholder="طول المسار بصرياً (كم)" value="${row.visual_length}">
        <input id="dr_thermal_towers_${idx}" type="number" placeholder="عدد أبراج شد كُشفت حرارياً" value="${row.thermal_towers}">
        <input id="dr_thermal_load_${idx}" type="number" placeholder="حمل الخط (MW)" value="${row.thermal_load}">
      </div>
      <textarea class="dr-text-area" id="dr_work_details_${idx}" rows="2" placeholder="تفاصيل العمل">${row.work_details}</textarea>
      <button class="btn-sm btn-secondary" style="margin-bottom:8px" onclick="refreshWorkDetails(${idx})">🔄 تحديث تفاصيل العمل تلقائياً حسب التعليمات أعلاه</button>
      <textarea class="dr-text-area" id="dr_notes_${idx}" rows="2" placeholder="الملاحظات">${row.notes}</textarea>
    </div>
  `).join('');
}

function refreshWorkDetails(idx) {
  syncDailyReportRowsFromDOM();
  const row = dailyReportRows[idx];
  const generated = buildWorkDetailsText(row);
  document.getElementById(`dr_work_details_${idx}`).value = generated;
  row.work_details = generated;
}

async function saveDailyReport() {
  syncDailyReportRowsFromDOM();
  const date = document.getElementById('dr_date').value;
  if (!date) { showToast('⚠️ اختر التاريخ أولاً', 'error'); return; }
  if (!dailyReportRows.length) { showToast('⚠️ لا توجد خطوط لحفظها', 'error'); return; }
  try {
    // إذا كنا نعدّل تقريرًا مفتوحًا من الأرشيف، نحدّثه مباشرة بنفس السجل
    if (editingDailyReportId) {
      const res = await sbFetch(`daily_reports?id=eq.${editingDailyReportId}`, {
        method: 'PATCH',
        body: JSON.stringify({ report_date: date, rows: dailyReportRows, created_by: currentUser.full_name })
      });
      if (!res.ok) throw new Error();
      showToast('✅ تم تحديث التقرير المحفوظ');
      return;
    }

    // تقرير جديد: نتحقق أولاً هل يوجد تقرير محفوظ بنفس التاريخ لتجنب التكرار
    const checkRes = await sbFetch(`daily_reports?report_date=eq.${date}&select=id`);
    const existing = await checkRes.json();
    if (existing.length) {
      const proceed = confirm('⚠️ يوجد تقرير محفوظ مسبقاً لهذا التاريخ. هل تريد استبداله بالبيانات الحالية؟');
      if (!proceed) { showToast('ℹ️ تم إلغاء الحفظ', 'error'); return; }
      const res = await sbFetch(`daily_reports?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        body: JSON.stringify({ report_date: date, rows: dailyReportRows, created_by: currentUser.full_name })
      });
      if (!res.ok) throw new Error();
      editingDailyReportId = existing[0].id;
      showToast('✅ تم استبدال التقرير المحفوظ بنفس التاريخ');
      return;
    }

    const res = await sbFetch('daily_reports?on_conflict=client_uuid', {
      method: 'POST',
      headers:{'Prefer':'resolution=ignore-duplicates'},
      body: JSON.stringify({ report_date: date, rows: dailyReportRows, created_by: currentUser.full_name, client_uuid: genUUID() })
    });
    if (!res.ok) throw new Error();
    showToast('✅ تم حفظ وأرشفة التقرير اليومي');
  } catch { showToast('❌ تعذر حفظ التقرير', 'error'); }
}

async function buildDailyReportExcelFile() {
  const date = document.getElementById('dr_date').value;
  await ensureExcelJSLoaded(); // Lazy load: يضمن اكتمال تحميل ExcelJS قبل الاستخدام
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الموقف اليومي', { views: [{ rightToLeft: true }] });

  const COLS = 19; // A..S
  ws.columns = [
    { width: 6 },{ width: 16 },{ width: 12 },{ width: 32 },{ width: 9 },{ width: 11 },{ width: 11 },
    { width: 11 },{ width: 11 },{ width: 11 },{ width: 13 },{ width: 13 },{ width: 13 },{ width: 13 },
    { width: 14 },{ width: 14 },{ width: 14 },{ width: 40 },{ width: 32 }
  ];

  const thin = { style: 'thin' };
  const fullBorder = { top: thin, bottom: thin, left: thin, right: thin };
  function styleCell(cell, { fill, bold, size, wrap } = {}) {
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: !!wrap };
    cell.font = { bold: !!bold, size: size || 12 };
    cell.border = fullBorder;
    if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  }

  // صف العنوان الرئيسي
  ws.mergeCells(1, 1, 1, 3);
  ws.mergeCells(1, 5, 1, 17);
  ws.getRow(1).height = 26;
  const dateCell = ws.getCell(1, 1);
  dateCell.value = date;
  styleCell(dateCell, { fill: 'FFFABD8C', bold: true, size: 14, wrap: true });
  const titleCell = ws.getCell(1, 5);
  titleCell.value = 'الموقف اليومي لاعمال صيانة خطوط نقل الطاقة الكهربائية';
  styleCell(titleCell, { fill: 'FFFABD8C', bold: true, size: 18, wrap: true });
  for (const col of [4, 18, 19]) styleCell(ws.getCell(1, col), {});

  // صفوف العناوين (مدمجة عمودياً للأعمدة الثابتة، وأفقياً لعمود النشاط)
  const headRow1 = 2, headRow2 = 3;
  ws.getRow(headRow1).height = 46;
  ws.getRow(headRow2).height = 24;
  const fixedHeaders = ['ت','الشركة العامة لنقل الطاقة','الشبكة','الخط','الجهد kv','طول الخط km','السعة MVA','عدد ابراج الشد في الخط'];
  fixedHeaders.forEach((label, i) => {
    const col = i + 1;
    ws.mergeCells(headRow1, col, headRow2, col);
    const cell = ws.getCell(headRow1, col);
    cell.value = label;
    styleCell(cell, { fill: 'FFFFFF00', bold: true, wrap: true });
    styleCell(ws.getCell(headRow2, col), { fill: 'FFFFFF00', bold: true, wrap: true });
  });
  ws.mergeCells(headRow1, 9, headRow1, 14);
  const activityHead = ws.getCell(headRow1, 9);
  activityHead.value = 'النشاط';
  styleCell(activityHead, { fill: 'FFFFFF00', bold: true, wrap: true });
  for (let c = 10; c <= 14; c++) styleCell(ws.getCell(headRow1, c), { fill: 'FFFFFF00', bold: true, wrap: true });
  const subHeaders = ['كشف بصري','كشف حراري','صيانة مبرمجة بدون اطفاء','صيانة مبرمجة باطفاء الخط','صيانة طارئة باطفاء الخط','ازالة مسببات حرائق'];
  subHeaders.forEach((label, i) => {
    const cell = ws.getCell(headRow2, 9 + i);
    cell.value = label;
    styleCell(cell, { fill: 'FFFFFF00', bold: true, wrap: true });
  });
  const tailHeaders = ['طول المسار المكشوف بصرياً km','عدد ابراج الشد المكشوفة حرارياً','حمل الخط المكشوف حرارياً MW','تفاصيل العمل','الملاحظات'];
  tailHeaders.forEach((label, i) => {
    const col = 15 + i;
    ws.mergeCells(headRow1, col, headRow2, col);
    const cell = ws.getCell(headRow1, col);
    cell.value = label;
    styleCell(cell, { fill: 'FFFFFF00', bold: true, wrap: true });
    styleCell(ws.getCell(headRow2, col), { fill: 'FFFFFF00', bold: true, wrap: true });
  });

  // صفوف البيانات
  dailyReportRows.forEach((r, i) => {
    const rowNum = headRow2 + 1 + i;
    const row = ws.getRow(rowNum);
    row.height = 32;
    const values = [
      i + 1, r.company, r.network, r.line_name, r.voltage, r.length, r.capacity, r.tension_towers,
      r.visual ? '●' : '', r.thermal ? '●' : '', r.sched_no_outage ? '●' : '', r.sched_outage ? '●' : '',
      r.emergency_outage ? '●' : '', r.fire_removal ? '●' : '',
      r.visual_length || '', r.thermal_towers || '', r.thermal_load || '', r.work_details || '', r.notes || ''
    ];
    values.forEach((val, ci) => {
      const cell = ws.getCell(rowNum, ci + 1);
      cell.value = val;
      const isLineCol = ci === 3;
      styleCell(cell, { fill: ci === 0 ? 'FFFFFF00' : null, bold: true, size: isLineCol ? 13 : 14, wrap: isLineCol || ci >= 17 });
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const filename = `الموقف_اليومي_${date}.xlsx`;
  return { blob, filename };
}

async function downloadDailyReportExcel() {
  syncDailyReportRowsFromDOM();
  if (!dailyReportRows.length) { showToast('⚠️ لا توجد خطوط للتنزيل', 'error'); return; }
  const { blob, filename } = await buildDailyReportExcelFile();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('📥 تم تنزيل الملف، تكدر ترفعه بالواتساب من ملفات الجهاز');
}

async function shareDailyReportExcel() {
  syncDailyReportRowsFromDOM();
  if (!dailyReportRows.length) { showToast('⚠️ لا توجد خطوط للمشاركة', 'error'); return; }
  try {
    const { blob, filename } = await buildDailyReportExcelFile();
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
    } else {
      showToast('⚠️ المشاركة المباشرة غير مدعومة بهذا المتصفح، استخدم "تنزيل Excel"', 'error');
    }
  } catch (err) {
    if (err && err.name !== 'AbortError') showToast('❌ تعذرت المشاركة', 'error');
  }
}

