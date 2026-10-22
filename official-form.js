/* official-form.js — v335-C5r6
   محرر استمارة الكشف الحراري الرسمية (إنشاء/تعديل/حفظ بالطابور الموحّد). التصدير والأرشيف وحدتان منفصلتان.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند أول طلب فعلي؛ لا يعمل شيء منه عند بدء التطبيق ولا عند فتح قائمة الكشف الحراري.
   سكربت كلاسيكي: يشارك الربط العام (let/const/function) مع index.html. */
(function mount_thermalOfficialFormView() {
  // الواجهة تُركَّب عند أول تحميل للوحدة فقط (نفس المعرّفات والأحداث والتخطيط تماماً)
  const page = document.getElementById('page-thermal');
  if (!page || document.getElementById('thermalOfficialFormView')) return;
  page.insertAdjacentHTML('beforeend', `
  <div id="thermalOfficialFormView" style="display:none">
    <div class="page-title">📝 استمارة الكشف الحراري</div>

    <div class="form-card">
      <h3>تحميل القياسات تلقائياً</h3>
      <div class="grid-3">
        <div class="field">
          <label>اسم الخط *</label>
          <select id="tf_line_name" onchange="onTfLineChange()"><option value="">-- اختر الخط --</option></select>
        </div>
        <div class="field"><label>تاريخ الفحص *</label><input type="date" id="tf_date"></div>
        <div class="field" style="justify-content:flex-end">
          <label>&nbsp;</label>
          <button class="btn btn-primary" onclick="loadOfficialFormData()">🔄 تحميل القياسات</button>
        </div>
      </div>
    </div>

    <div id="officialFormEditArea" style="display:none">
      <div class="form-card" id="officialFormPrintArea">
        <div id="officialFormHeaderWrapLive" style="position:relative;text-align:center;margin-bottom:10px">
          <img id="officialFormStampImgLive" src="" style="position:absolute;width:120px;height:120px;left:210px;top:-76px">
          <div style="font-weight:700;font-size:0.95rem">الإصدار: 2 &nbsp; | &nbsp; <span id="officialFormTitleSpanLive">استمارة: الكشف الحراري لخطوط نقل الطاقة</span> &nbsp; | &nbsp; الشركة العامة لنقل الطاقة الكهربائية</div>
          <div style="font-size:0.8rem;color:#555;margin-top:4px">تاريخ الإصدار: 27/3/2019 &nbsp; | &nbsp; الرمز: (MOE/T2-FO-177) &nbsp; | &nbsp; المنطقة الوسطى</div>
        </div>
        <div style="overflow-x:auto;margin-bottom:20px">
          <table class="thermal-points-table" id="officialFormHeaderTable" style="min-width:680px;width:100%">
            <thead><tr>
              <th style="width:42%">اسم الخط</th>
              <th>نوع السلك</th>
              <th>تاريخ الفحص</th>
              <th>الوقت</th>
            </tr></thead>
            <tbody><tr>
              <td><input id="tf_h_line" readonly style="width:100%;min-width:220px;border:none;text-align:center;font-size:0.85rem"></td>
              <td><input id="tf_h_wire" style="width:100%;border:none;text-align:center;font-size:0.85rem"></td>
              <td><input id="tf_h_date" readonly style="width:100%;border:none;text-align:center;font-size:0.85rem"></td>
              <td><input id="tf_h_time" placeholder="مثال: 10:30 صباحاً" style="width:100%;border:none;text-align:center;font-size:0.85rem"></td>
            </tr></tbody>
          </table>
        </div>
        <div style="overflow-x:auto">
          <table class="thermal-points-table" id="officialFormTable" style="min-width:760px">
            <thead>
              <tr>
                <th rowspan="2">رقم برج الشد</th>
                <th rowspan="2">مسافة الفحص</th>
                <th colspan="3">درجة حرارة الطور</th>
                <th rowspan="2">حمل الخط MW</th>
                <th rowspan="2">درجة حرارة الجو °C</th>
                <th rowspan="2">الملاحظات</th>
                <th rowspan="2"></th>
              </tr>
              <tr><th>T</th><th>S</th><th>R</th></tr>
            </thead>
            <tbody id="officialFormBody"></tbody>
          </table>
        </div>
        <div style="margin-top:6px">
          <button class="btn-sm btn-secondary" onclick="addOfficialFormRow()">➕ إضافة برج</button>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:0.82rem;color:#333">
          <div>اسم وتوقيع الفاحص: </div>
          <div style="margin-left:2cm">مصادقة رئيس القسم: </div>
        </div>
        <div style="margin-top:56px;font-size:0.82rem;color:#333;text-align:center">لجنة الكشف الحراري: </div>
      </div>
      <div class="form-actions" style="margin-top:14px">
        <button class="btn btn-primary" onclick="saveOfficialForm()">💾 حفظ بالأرشيف</button>
        <button class="btn btn-secondary" onclick="exportOfficialFormPDF()">📄 تصدير PDF</button>
        <button class="btn btn-secondary" onclick="shareOfficialFormWord()">📤 إرسال</button>
      </div>
      <div id="officialFormSaveStatus" style="margin-top:8px;font-size:0.82rem;text-align:center"></div>
    </div>
  </div>
`);
  const tfSel = document.getElementById('tf_line_name');
  Object.keys(LINES_DATA).forEach(name => {
    const o = document.createElement('option'); o.value = name; o.textContent = name; tfSel.appendChild(o);
  });
})();

// ========================
// استمارة الكشف الحراري (MOE/T2-FO-177)
// ========================
let editingOfficialFormId = null;
let officialFormRows = [];
let tfTensionTowerOptions = []; // أرقام أبراج الشد المتاحة للخط المختار

function showThermalOfficialFormNewImpl() {
  pushLevel(showThermalOfficialFormHome);
  thermalShowView('thermalOfficialFormView');
  document.getElementById('officialFormEditArea').style.display = 'none';
  document.getElementById('tf_date').value = new Date().toISOString().split('T')[0];
  editingOfficialFormId = null;
  officialFormRows = [];
  padOfficialFormRowsToMinimum();
}

function getWireTypeForLine(lineName) {
  const li = linesInfoCache.find(l => lineName.startsWith(l.name));
  return li ? (li.wire_type || '') : '';
}
// نفس منطق "الأبراج التي تستحق فحص حراري" المستخدم بالكشف العادي (أبراج الشد فقط)
function getTensionTowersForLine(lineName) {
  const towers = getLineTowers(lineName);
  const voltage = LINE_VOLTAGE[lineName];
  return towers.filter(t => isThermalRelevantTower(t, voltage)).map(t => t.num);
}
async function onTfLineChange() {
  const line = document.getElementById('tf_line_name').value;
  tfTensionTowerOptions = line ? getTensionTowersForLine(line) : [];
  if (!line) return;
  try {
    const res = await sbFetch(`thermal_inspections?line_name=eq.${encodeURIComponent(line)}&point_type=eq.tower&select=inspection_date&order=inspection_date.desc&limit=1`);
    const data = await res.json();
    if (data.length) document.getElementById('tf_date').value = data[0].inspection_date;
  } catch (e) { /* تجاهل، التاريخ يبقى كما هو ويتعدّل يدويًا */ }
}
async function loadOfficialFormData() {
  const line = document.getElementById('tf_line_name').value;
  const date = document.getElementById('tf_date').value;
  if (!line || !date) { showToast('⚠️ اختر الخط والتاريخ', 'error'); return; }
  tfTensionTowerOptions = getTensionTowersForLine(line);
  try {
    const res = await sbFetch(`thermal_inspections?line_name=eq.${encodeURIComponent(line)}&inspection_date=eq.${date}&point_type=eq.tower`);
    const data = await res.json();
    const byTower = {};
    data.forEach(r => { byTower[r.tower_number] = r; });

    const avg = (a, b) => {
      const vals = [a, b].filter(v => v !== null && v !== undefined && v !== '').map(parseFloat);
      return vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : '';
    };

    // درجة حرارة الجو: تتعبى تلقائيًا (إن وُجدت) فقط بالبرج الأول، وتُكتب يدوياً مرة واحدة من المستخدم
    const firstAmbient = data.find(r => r.ambient_temp !== null && r.ambient_temp !== undefined);
    const ambient = firstAmbient ? parseFloat(firstAmbient.ambient_temp) : null;

    officialFormRows = tfTensionTowerOptions.map((num, i) => {
      const r = byTower[num];
      if (r) {
        return { tower_number: num, distance: '', t: avg(r.t1, r.t2), s: avg(r.s1, r.s2), r: avg(r.r1, r.r2), load_mw: '', ambient: i===0 ? (ambient ?? '') : '', notes: '', inspected: true };
      }
      // برج غير مكشوف: يتعبى تلقائيًا بحرارة الجو + 7 إلى 10 لكل فيز بشكل مستقل (إذا توفرت حرارة الجو)
      const gen = () => ambient !== null ? Math.round(ambient + 7 + Math.random() * 3) : '';
      return { tower_number: num, distance: '', t: gen(), s: gen(), r: gen(), load_mw: '', ambient: i===0 ? (ambient ?? '') : '', notes: '', inspected: false };
    });
    padOfficialFormRowsToMinimum();

    if (!data.length) showToast('ℹ️ هذا الخط لم يُكشف بهذا التاريخ، الأبراج كلها معبّاة تقديريًا — أدخل حرارة الجو يدويًا لو رغبت', 'error');
    editingOfficialFormId = null;
    document.getElementById('tf_h_line').value = line;
    document.getElementById('tf_h_wire').value = getWireTypeForLine(line);
    document.getElementById('tf_h_date').value = date;
    document.getElementById('tf_h_time').value = '';
    renderOfficialFormTable();
    document.getElementById('officialFormEditArea').style.display = 'block';
  } catch (e) {
    // v335-C5r4: بلا اتصال: استمارة بأبراج الخط (من بيانات الجهاز) بلا قياسات تقديرية؛ تُدخل القياسات يدوياً وتُحفظ على الجهاز
    if (!(e && e.name === 'TypeError') && navigator.onLine !== false) { showToast('❌ تعذر تحميل القياسات', 'error'); return; }
    officialFormRows = tfTensionTowerOptions.map(num => ({ tower_number: num, distance: '', t: '', s: '', r: '', load_mw: '', ambient: '', notes: '', inspected: false }));
    padOfficialFormRowsToMinimum();
    editingOfficialFormId = null;
    document.getElementById('tf_h_line').value = line;
    document.getElementById('tf_h_wire').value = getWireTypeForLine(line);
    document.getElementById('tf_h_date').value = date;
    document.getElementById('tf_h_time').value = '';
    renderOfficialFormTable();
    document.getElementById('officialFormEditArea').style.display = 'block';
    setOfficialFormStatus('');
    showToast('ℹ️ غير متصل: استمارة بأبراج الخط بلا قياسات — أدخل القياسات يدوياً وستُحفظ على الجهاز', 'error');
  }
}
// يضمن وجود 23 صف على الأقل بالاستمارة دائماً (لو عدد أبراج الخط أقل، نكمّل بصفوف فاضية)
function padOfficialFormRowsToMinimum(min) {
  min = min || 23;
  while (officialFormRows.length < min) {
    officialFormRows.push({ tower_number: '', distance: '', t: '', s: '', r: '', load_mw: '', ambient: '', notes: '', inspected: false });
  }
}
// تعبّى حرارة الجو مرة واحدة فقط (عادةً بالبرج الأول)، وتُستخدم لتوليد قراءات تقريبية بالأبراج غير المكشوفة فعلياً
function applyAmbientAutoFill(ambient) {
  ambient = parseFloat(ambient); // مهم: القيمة تجي كنص من الحقل — بدون هذا التحويل يصير دمج نصوص بدل جمع رياضي (44+7 تصبح "447" بدل 51)
  if (ambient === '' || ambient == null || isNaN(ambient)) return;
  officialFormRows.forEach(row => {
    // تجاهل صفوف الحشو الفاضية (بلا رقم برج) — هذي فقط لإكمال 23 سطر بالشكل الرسمي وما يجوز تتعبى بقيم وهمية
    if (row.tower_number === '' || row.tower_number === null || row.tower_number === undefined) return;
    if (!row.inspected) {
      if (row.t === '' || row.t === null || row.t === undefined) row.t = Math.round(ambient + 7 + Math.random() * 3);
      if (row.s === '' || row.s === null || row.s === undefined) row.s = Math.round(ambient + 7 + Math.random() * 3);
      if (row.r === '' || row.r === null || row.r === undefined) row.r = Math.round(ambient + 7 + Math.random() * 3);
    }
  });
  renderOfficialFormTable();
}
function towerSelectHTML(idx, selected) {
  const opts = ['<option value="">--</option>']
    .concat(tfTensionTowerOptions.map(n => `<option value="${n}" ${String(n)===String(selected)?'selected':''}>${n}</option>`));
  // لو القيمة الحالية ماهي بنفس قائمة أبراج الشد (مثلاً استمارة قديمة أو خط لم يُحمّل)، نضيفها حتى ما تضيع
  if (selected !== '' && selected != null && !tfTensionTowerOptions.includes(Number(selected))) {
    opts.push(`<option value="${selected}" selected>${selected}</option>`);
  }
  return `<select onchange="updateOfficialFormRow(${idx},'tower_number',this.value)" style="width:90px;text-align:center;border:1px solid #ddd;border-radius:4px;padding:4px">${opts.join('')}</select>`;
}
// يضع الختم فوق آخر حرف من "الطاقة" بعنوان الاستمارة بشاشة التعبئة المباشرة
function placeOfficialFormStampLive() {
  try {
    const wrap = document.getElementById('officialFormHeaderWrapLive');
    const span = document.getElementById('officialFormTitleSpanLive');
    const img = document.getElementById('officialFormStampImgLive');
    if (!wrap || !span || !img) return;
    if (!img.src) img.src = STAMP_IMG_SRC;
    const wrapRect = wrap.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    if (wrapRect.width === 0) { setTimeout(placeOfficialFormStampLive, 150); return; } // العنصر غير ظاهر بعد (display:none)
    const stampSize = wrapRect.height * 2; // مضاعف الحجم الأساسي
    const leftEdge = spanRect.left - wrapRect.left;
    img.style.left = (leftEdge - stampSize/2) + 'px';
    img.style.top = (-(stampSize - wrapRect.height)) + 'px';
    img.style.width = stampSize + 'px';
    img.style.height = stampSize + 'px';
    img.style.visibility = 'visible';
  } catch (e) { console.warn('[tower-app] فشل تموضع ختم الاستمارة (شاشة التعبئة المباشرة)', e); }
}
function renderOfficialFormTable() {
  placeOfficialFormStampLive();
  const tbody = document.getElementById('officialFormBody');
  if (!officialFormRows.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="padding:10px;color:#999">لا توجد أبراج، اضغط "إضافة برج"</td></tr>';
    return;
  }
  const cell = (idx, key, val, w) => `<input type="${key==='distance'||key==='notes'?'text':'number'}" ${key!=='distance'&&key!=='notes'?'step="0.1"':''} value="${val??''}" oninput="updateOfficialFormRow(${idx},'${key}',this.value)" style="width:${w}px;text-align:center;border:1px solid #ddd;border-radius:4px;padding:4px">`;
  const ambientCell = (idx, val, w) => `<input type="number" step="0.1" value="${val??''}" oninput="updateOfficialFormRow(${idx},'ambient',this.value)" onblur="applyAmbientAutoFill(this.value)" style="width:${w}px;text-align:center;border:1px solid #ddd;border-radius:4px;padding:4px">`;
  tbody.innerHTML = officialFormRows.map((row, idx) => `
    <tr class="${row.inspected ? 'of-inspected-row' : ''}">
      <td>${towerSelectHTML(idx, row.tower_number)}</td>
      <td>${cell(idx,'distance',row.distance,70)}</td>
      <td>${cell(idx,'t',row.t,55)}</td>
      <td>${cell(idx,'s',row.s,55)}</td>
      <td>${cell(idx,'r',row.r,55)}</td>
      <td>${cell(idx,'load_mw',row.load_mw,65)}</td>
      <td>${ambientCell(idx,row.ambient,65)}</td>
      <td>${cell(idx,'notes',row.notes,110)}</td>
      <td><button class="btn-sm btn-del" onclick="removeOfficialFormRow(${idx})">🗑️</button></td>
    </tr>`).join('');
}
function updateOfficialFormRow(idx, key, val) {
  if (!officialFormRows[idx]) return;
  if (key === 'distance' || key === 'notes') officialFormRows[idx][key] = val;
  else officialFormRows[idx][key] = val === '' ? '' : (key === 'tower_number' ? parseInt(val) : parseFloat(val));
}
function addOfficialFormRow() {
  if (!document.getElementById('tf_line_name').value) { showToast('⚠️ اختر اسم الخط أولاً', 'error'); return; }
  officialFormRows.push({ tower_number: '', distance: '', t: '', s: '', r: '', load_mw: '', ambient: '', notes: '', inspected: false });
  renderOfficialFormTable();
}
function removeOfficialFormRow(idx) {
  officialFormRows.splice(idx, 1);
  // نعيد التعبئة للعدد الثابت المتفق عليه (23) — بدون هذا، حذف أي صف يدوياً يكسر ثبات شكل
  // الاستمارة نهائياً لهذا الملف (يبقى ناقص حتى لو انحفظ وطُبع لاحقاً)
  padOfficialFormRowsToMinimum();
  renderOfficialFormTable();
}
function setOfficialFormStatus(html) { const el = document.getElementById('officialFormSaveStatus'); if (el) el.innerHTML = html || ''; }
async function saveOfficialForm() {
  if (!officialFormRows.length) { showToast('⚠️ لا توجد أبراج لحفظها', 'error'); return; }
  const payload = {
    line_name: document.getElementById('tf_h_line').value,
    wire_type: document.getElementById('tf_h_wire').value,
    inspection_date: document.getElementById('tf_h_date').value,
    inspection_time: document.getElementById('tf_h_time').value,
    ambient_temp: (officialFormRows[0] && officialFormRows[0].ambient !== '' && officialFormRows[0].ambient != null) ? parseFloat(officialFormRows[0].ambient) : null,
    rows: JSON.parse(JSON.stringify(officialFormRows)),
    created_by: currentUser.full_name
  };
  // v335-C5r4: تُحفظ كل القيم + هوية ثابتة على الجهاز أولاً؛ فشل الحفظ = لا إرسال وتبقى الحقول كما هي
  // الهوية الدائمة للاستمارة تُثبَّت على الشاشة فور نجاح الحفظ المحلي وقبل أي await: حفظ ثانٍ أثناء الإرسال يدمج بنفس السجل (لا نسخة ثانية)
  let myRef = null;
  const r = await docqSubmit('thermal_form', editingOfficialFormId, payload, (ref) => { myRef = ref; editingOfficialFormId = ref; });
  if (!r.ok) {
    setOfficialFormStatus('<span style="color:#c0392b;font-weight:700">⛔ لم يُحفظ: ' + (r.reason === 'other_user' ? 'هذا السجل المعلّق يخص مستخدماً آخر' : 'تعذّر الحفظ على الجهاز (الذاكرة ممتلئة)') + ' — لم يُرسل شيء وبقيت الحقول</span>');
    showToast(r.reason === 'other_user' ? '⛔ هذا السجل المعلّق يخص مستخدماً آخر على هذا الجهاز' : '⛔ تعذّر الحفظ على الجهاز — لم يُرسل شيء وبقيت الحقول', 'error');
    return;
  }
  // إن انتقل المستخدم أثناء الانتظار إلى استمارة أخرى/جديدة لا نلمس حالتها ولا حقولها
  if (String(editingOfficialFormId) === String(myRef)) setOfficialFormStatus(docqStatusHTML(r.state, r.code));
  showToast(r.state === 'confirmed' ? '✅ تم الحفظ بالأرشيف (مؤكَّد بالخادم)' : (r.state === 'rejected' ? '⛔ رفضها الخادم — محفوظة على الجهاز للمراجعة' : '📱 حُفظت على الجهاز فقط — لم تُؤكَّد بالخادم بعد'), r.state === 'rejected' ? 'error' : undefined);
}

// يفتح استمارة موجودة (من الأرشيف أو من مركز التقارير) داخل المحرر؛ الجلب وحل السجل المعلّق يتمّان بوحدة الأرشيف قبل الاستدعاء
function openOfficialFormRecordInEditor(f, pend, source) {
  tfTensionTowerOptions = f.line_name ? getTensionTowersForLine(f.line_name) : [];
  showThermalOfficialFormNewImpl();
  pushLevel(showThermalOfficialFormArchive); // نتأكد إن الرجوع من هذي الاستمارة يودّي للأرشيف (مو للرئيسية اللي دزّها showThermalOfficialFormNew)
  officialFormRows = Array.isArray(f.rows) ? JSON.parse(JSON.stringify(f.rows)) : [];
  padOfficialFormRowsToMinimum();
  document.getElementById('tf_line_name').value = f.line_name;
  document.getElementById('tf_date').value = f.inspection_date;
  document.getElementById('tf_h_line').value = f.line_name;
  document.getElementById('tf_h_wire').value = f.wire_type || '';
  document.getElementById('tf_h_date').value = f.inspection_date;
  document.getElementById('tf_h_time').value = f.inspection_time || '';
  editingOfficialFormId = (pend && pend.action === 'create') ? docqLocalId(pend.client_uuid) : f.id; // showThermalOfficialFormNew يصفّرها، نعيد ضبطها بعده
  renderOfficialFormTable();
  document.getElementById('officialFormEditArea').style.display = 'block';
  setOfficialFormStatus(source === 'cache' ? '<span style="color:#7B5B00;font-weight:700">⚠️ نسخة محلية قديمة من ذاكرة الجهاز (لم تُقرأ من الخادم الآن)</span>' : (source === 'server' ? '<span style="color:#1e8449;font-weight:700">✅ مؤكَّدة بالخادم</span>' : docqStatusHTML(source === 'rejected' ? 'rejected' : 'pending', pend && pend.rejected && pend.rejected.code)));
  showToast('📂 تم تحميل الاستمارة، تكدر تعدّلها');
}
(window.__thermalModules = window.__thermalModules || {}).officialForm = true;
