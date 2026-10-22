/* emergency-departures.js — v335-C5r9
   تبويب «مغادرات طارئة»: نموذج الإضافة وسجل المغادرات الطارئة (قراءة/تحديث حالة/حذف للمدير).
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
(function mount_depEmergencyView() {
  const host = document.getElementById('depEmergencyView');
  if (!host || document.getElementById('emgLogBody')) return;
  const html = `

    <!-- فورم إضافة مغادرة طارئة -->
    <div class="form-card">
      <h3>⚡ إضافة مغادرة طارئة</h3>
      <div class="grid-2">
        <div class="field">
          <label>اسم الخط *</label>
          <select id="emg_line" onchange="onEmgLineChange()">
            <option value="">-- اختر الخط --</option>
          </select>
        </div>
        <div class="field">
          <label>رقم البرج *</label>
          <select id="emg_tower" disabled>
            <option value="">-- اختر الخط أولاً --</option>
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:12px">
        <label>نوع المغادرة *</label>
        <input id="emg_type" placeholder="مثال: انقطاع سلك، حريق، تلف مفاجئ..." style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
      </div>
      <div class="field" style="margin-top:12px">
        <label>التفاصيل</label>
        <textarea id="emg_details" rows="3" placeholder="اكتب تفاصيل المغادرة الطارئة..." style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%;resize:vertical"></textarea>
      </div>
      <div class="field" style="margin-top:12px">
        <label>الحالة *</label>
        <div style="display:flex;gap:12px;margin-top:6px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;font-weight:600;padding:10px 20px;border:2px solid #48BB78;border-radius:10px;flex:1;justify-content:center" id="emg_status_done_lbl">
            <input type="radio" name="emg_status" id="emg_status_done" value="تمت المعالجة" onchange="toggleEmgStatus()" style="display:none">
            ✅ تمت المعالجة
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;font-weight:600;padding:10px 20px;border:2px solid #F6C23E;border-radius:10px;flex:1;justify-content:center;background:#FFF3CD" id="emg_status_pending_lbl">
            <input type="radio" name="emg_status" id="emg_status_pending" value="قيد المعالجة" onchange="toggleEmgStatus()" style="display:none" checked>
            ⏳ قيد المعالجة
          </label>
        </div>
      </div>
      <div class="form-actions" style="margin-top:16px">
        <button class="btn btn-primary" onclick="saveEmergencyDeparture()">💾 حفظ المغادرة الطارئة</button>
        <button class="btn btn-secondary" onclick="clearEmgForm()">🔄 مسح</button>
      </div>
    </div>

    <!-- سجل المغادرات الطارئة -->
    <div class="form-card" style="margin-top:16px">
      <h3>📋 سجل المغادرات الطارئة</h3>
      <div class="dep-filters" style="margin-bottom:12px">
        <select id="emgFilterStatus" onchange="renderEmergencyLog()">
          <option value="">-- كل الحالات --</option>
          <option value="قيد المعالجة">⏳ قيد المعالجة</option>
          <option value="تمت المعالجة">✅ تمت المعالجة</option>
        </select>
        <select id="emgFilterLine" onchange="renderEmergencyLog()">
          <option value="">-- كل الخطوط --</option>
        </select>
      </div>
      <div id="emgLogBody"><div class="empty-state">⏳ جاري التحميل...</div></div>
    </div>
`;
  host.insertAdjacentHTML('afterbegin', html);
})();

// حراسة الطلب: نفس الصفحة والجلسة، آخر طلب من نوعه، ولم يُبدَّل لسان المغادرات أثناء الجلب (لا رسم لبيانات قديمة ولا لسان مخفي)
function emgReqOk(r) { return featEntryOk(r.tok) && r.depK === (_featSeq.dep || 0); }

function onEmgLineChange() {
  const lineName = document.getElementById('emg_line').value;
  const towerSel = document.getElementById('emg_tower');
  towerSel.innerHTML = '<option value="">-- اختر رقم البرج --</option>';
  if (!lineName) { towerSel.disabled = true; return; }
  const towers = getLineTowers(lineName);
  towers.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.num; opt.textContent = 'برج ' + t.num;
    towerSel.appendChild(opt);
  });
  towerSel.disabled = false;
}

function toggleEmgStatus() {
  const done = document.getElementById('emg_status_done').checked;
  document.getElementById('emg_status_done_lbl').style.background = done ? '#C6F6D5' : '';
  document.getElementById('emg_status_pending_lbl').style.background = done ? '' : '#FFF3CD';
}

function clearEmgForm() {
  document.getElementById('emg_line').value = '';
  document.getElementById('emg_tower').innerHTML = '<option value="">-- اختر الخط أولاً --</option>';
  document.getElementById('emg_tower').disabled = true;
  document.getElementById('emg_type').value = '';
  document.getElementById('emg_details').value = '';
  document.getElementById('emg_status_pending').checked = true;
  toggleEmgStatus();
}

async function saveEmergencyDeparture() {
  const lineName = document.getElementById('emg_line').value;
  const towerNum = document.getElementById('emg_tower').value;
  const depType = document.getElementById('emg_type').value.trim();
  const details = document.getElementById('emg_details').value.trim();
  const statusEl = document.querySelector('input[name="emg_status"]:checked');
  const status = statusEl ? statusEl.value : 'قيد المعالجة';

  if (!lineName || !towerNum || !depType) {
    showToast('⚠️ الخط والبرج ونوع المغادرة مطلوبة', 'error'); return;
  }

  const now = new Date().toISOString().split('T')[0];
  const rec = {
    line_name: lineName,
    tower_number: towerNum,
    departure_type: depType,
    details: details,
    status: status,
    treated_by: status === 'تمت المعالجة' ? currentUser.full_name : null,
    treatment_date: status === 'تمت المعالجة' ? now : null,
    created_by: currentUser.full_name,
    client_uuid: genUUID()
  };

  try {
    const res = await sbFetch('emergency_departures?on_conflict=client_uuid', { method: 'POST', headers:{'Prefer':'resolution=ignore-duplicates'}, body: JSON.stringify(rec) });
    if (!res.ok) throw new Error();
    showToast('✅ تم حفظ المغادرة الطارئة');
    clearEmgForm();
    renderEmergencyLog();
  } catch { showToast('❌ تعذر الحفظ، حاول مرة أخرى', 'error'); }
}

async function updateEmgStatus(id, newStatus) {
  const now = new Date().toISOString().split('T')[0];
  const patch = {
    status: newStatus,
    treated_by: newStatus === 'تمت المعالجة' ? currentUser.full_name : null,
    treatment_date: newStatus === 'تمت المعالجة' ? now : null
  };
  try {
    const res = await sbFetch(`emergency_departures?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    if (!res.ok) throw new Error();
    showToast(newStatus === 'تمت المعالجة' ? '✅ تم تحديث الحالة إلى معالجة' : '⏳ تم تحديث الحالة');
    renderEmergencyLog();
  } catch { showToast('❌ تعذر التحديث', 'error'); }
}

async function deleteEmgRecord(id) {
  if (currentUser.role !== 'admin') { showToast('⛔ الحذف من صلاحيات المدير فقط', 'error'); return; }
  if (!confirm('هل تريد حذف هذه المغادرة الطارئة؟')) return;
  try {
    await sbFetch(`emergency_departures?id=eq.${id}`, { method: 'DELETE' });
    showToast('🗑️ تم الحذف');
    renderEmergencyLog();
  } catch { showToast('❌ خطأ بالحذف', 'error'); }
}

async function renderEmergencyLog() {
  const rq = { tok: featTok('emg', true), depK: (_featSeq.dep || 0) };
  const body = document.getElementById('emgLogBody');
  body.innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  const statusFilter = document.getElementById('emgFilterStatus').value;
  const lineFilter = document.getElementById('emgFilterLine').value;

  try {
    let url = 'emergency_departures?select=*&order=created_at.desc';
    const res = await sbFetch(url);
    let data = await res.json();
    if (!emgReqOk(rq)) return;

    // فلترة
    if (statusFilter) data = data.filter(r => r.status === statusFilter);
    if (lineFilter) data = data.filter(r => r.line_name === lineFilter);

    if (!data.length) { body.innerHTML = '<div class="empty-state">لا توجد مغادرات طارئة</div>'; return; }

    const canDelete = currentUser.role === 'admin';

    body.innerHTML = data.map(r => {
      const isPending = r.status === 'قيد المعالجة';
      const borderColor = isPending ? '#F6C23E' : '#48BB78';
      const statusBadge = isPending
        ? `<span style="background:#FFF3CD;color:#856404;padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:700">⏳ قيد المعالجة</span>`
        : `<span style="background:#C6F6D5;color:#22543D;padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:700">✅ تمت المعالجة</span>`;
      return `<div class="dep-card" style="border-right-color:${borderColor};margin-bottom:12px">
        <div class="dep-card-header">
          <div class="dep-card-title">⚡ ${r.line_name} — برج ${r.tower_number}</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${statusBadge}</div>
        </div>
        <div style="margin:8px 0;font-weight:700;color:#2E4057;font-size:0.9rem">${r.departure_type}</div>
        ${r.details ? `<div style="color:#4A5568;font-size:0.85rem;margin-bottom:8px">${r.details}</div>` : ''}
        <div style="font-size:0.75rem;color:#718096;margin-top:6px">
          📅 ${r.created_at ? r.created_at.split('T')[0] : '—'} | 👤 ${r.created_by||'—'}
          ${!isPending ? ` | ✅ معالجة بتاريخ ${r.treatment_date||'—'} من ${r.treated_by||'—'}` : ''}
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          ${isPending ? `<button class="btn-sm btn-primary" onclick="updateEmgStatus('${r.id}','تمت المعالجة')" style="background:#276749">✅ تمت المعالجة</button>` : ''}
          ${canDelete ? `<button class="btn-sm btn-del" onclick="deleteEmgRecord('${r.id}')">🗑️ حذف</button>` : ''}
        </div>
      </div>`;
    }).join('');

    // تحديث فلتر الخطوط
    const lineFilterSel = document.getElementById('emgFilterLine');
    const currentLine = lineFilterSel.value;
    const uniqueLines = [...new Set(data.map(r => r.line_name).filter(Boolean))].sort();
    lineFilterSel.innerHTML = '<option value="">-- كل الخطوط --</option>' +
      uniqueLines.map(n => `<option value="${n}" ${n===currentLine?'selected':''}>${n}</option>`).join('');

  } catch { if (emgReqOk(rq)) body.innerHTML = '<div class="empty-state">⚠️ تعذر التحميل</div>'; }
}

function populateEmgLines() {
  const sel = document.getElementById('emg_line');
  sel.innerHTML = '<option value="">-- اختر الخط --</option>';
  const g400 = document.createElement('optgroup'); g400.label = '400 ك.ف';
  const g132 = document.createElement('optgroup'); g132.label = '132 ك.ف';
  Object.keys(LINES_DATA).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if (name.includes('400')) g400.appendChild(opt); else g132.appendChild(opt);
  });
  sel.appendChild(g400); sel.appendChild(g132);
}

(window.__featModules = window.__featModules || {}).emg = true;
