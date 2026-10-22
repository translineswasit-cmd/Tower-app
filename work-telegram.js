/* work-telegram.js — v335-C5r9
   تبويب «برقية العمل»: إضافة برقية، سجل البرقيات، تحديث الحالة ونافذة أمر العمل.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
(function mount_depTelegramView() {
  const host = document.getElementById('depTelegramView');
  if (!host || document.getElementById('telegramLogBody')) return;
  const html = `
    <div class="dep-tabs" style="margin-bottom:14px">
      <button class="dep-tab active" id="telegramAddTabBtn" onclick="switchTelegramSubTab('add',this)">➕ إضافة برقية</button>
      <button class="dep-tab" id="telegramListTabBtn" onclick="switchTelegramSubTab('list',this)">📋 البرقيات السابقة</button>
    </div>

    <!-- إضافة برقية -->
    <div id="telegramAddView">
      <div class="form-card">
        <h3>📨 إضافة برقية عمل</h3>
        <div class="field">
          <label>اسم الخط *</label>
          <select id="tg_line">
            <option value="">-- اختر الخط --</option>
          </select>
        </div>
        <div class="grid-2" style="margin-top:12px">
          <div class="field">
            <label>تاريخ ووقت الإطفاء (من) *</label>
            <input type="datetime-local" id="tg_from" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
          </div>
          <div class="field">
            <label>تاريخ ووقت الإطفاء (إلى) *</label>
            <input type="datetime-local" id="tg_to" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
          </div>
        </div>
        <div class="field" style="margin-top:12px">
          <label>نوع العمل *</label>
          <input id="tg_work_type" placeholder="مثال: تصليح عازل، استبدال سلك، صيانة دورية..." style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
        </div>
        <div class="field" style="margin-top:12px">
          <label>الملاحظات</label>
          <textarea id="tg_notes" rows="3" placeholder="اكتب أي ملاحظات إضافية..." style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%;resize:vertical"></textarea>
        </div>
        <div class="form-actions" style="margin-top:18px;flex-direction:column;gap:10px">
          <button class="btn btn-primary" style="background:#276749;width:100%" onclick="saveTelegram('تنفذت')">✅ تنفذت البرقية</button>
          <button class="btn btn-primary" style="background:#C0392B;width:100%" onclick="saveTelegram('لم تنفذ')">❌ لم تنفذ البرقية</button>
          <button class="btn btn-secondary" style="width:100%" onclick="clearTelegramForm()">🔄 مسح</button>
        </div>
      </div>
    </div>

    <!-- البرقيات السابقة -->
    <div id="telegramListView" style="display:none">
      <div class="dep-filters" style="margin-bottom:12px">
        <select id="tgFilterStatus" onchange="renderTelegramLog()">
          <option value="">-- كل الحالات --</option>
          <option value="تنفذت">✅ تنفذت</option>
          <option value="لم تنفذ">❌ لم تنفذ</option>
        </select>
        <select id="tgFilterLine" onchange="renderTelegramLog()">
          <option value="">-- كل الخطوط --</option>
        </select>
      </div>
      <div id="telegramLogBody"><div class="empty-state">⏳ جاري التحميل...</div></div>
    </div>
`;
  host.insertAdjacentHTML('afterbegin', html);
})();

(function mount_workOrderModal() {
  if (document.getElementById('workOrderModal')) return;
  const html = `
<div class="modal-bg" id="workOrderModal">
  <div class="modal-box" style="max-width:380px">
    <h3>📋 بيانات أمر العمل</h3>
    <p style="margin:6px 0 14px 0;color:#666;font-size:0.85rem">رقم وتاريخ أمر العمل مطلوبين لتأكيد تنفيذ البرقية</p>
    <div class="field" style="margin-bottom:10px">
      <label>رقم أمر العمل *</label>
      <input id="wo_number" placeholder="مثال: 123" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
    </div>
    <div class="field" style="margin-bottom:6px">
      <label>تاريخ أمر العمل *</label>
      <input type="date" id="wo_date" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.88rem;width:100%">
    </div>
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn btn-secondary" onclick="closeWorkOrderModal()">إلغاء</button>
      <button class="btn btn-primary" style="background:#276749" onclick="confirmWorkOrder()">✅ تم</button>
    </div>
  </div>
</div>
`;
  const anchor = document.getElementById('page-home');
  if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else document.body.insertAdjacentHTML('beforeend', html);
})();

// حراسة الطلب: نفس الصفحة والجلسة، آخر طلب من نوعه، ولم يُبدَّل لسان المغادرات أثناء الجلب (لا رسم لبيانات قديمة ولا لسان مخفي)
function tgReqOk(r) { return featEntryOk(r.tok) && r.depK === (_featSeq.dep || 0); }

// ========================
// WORK TELEGRAM (برقية العمل)
// ========================
function populateTelegramLines() {
  const sel = document.getElementById('tg_line');
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

function switchTelegramSubTab(tab, btn) {
  document.querySelectorAll('#depTelegramView .dep-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('telegramAddView').style.display = tab==='add' ? '' : 'none';
  document.getElementById('telegramListView').style.display = tab==='list' ? '' : 'none';
  if (tab==='list') renderTelegramLog();
}

function clearTelegramForm() {
  document.getElementById('tg_line').value = '';
  document.getElementById('tg_from').value = '';
  document.getElementById('tg_to').value = '';
  document.getElementById('tg_work_type').value = '';
  document.getElementById('tg_notes').value = '';
  editingTelegramId = null;
}

let editingTelegramId = null;

let pendingWorkOrderContext = null; // { mode: 'new'|'update', rec?, id? }

async function saveTelegram(status) {
  const lineName = document.getElementById('tg_line').value;
  const from = document.getElementById('tg_from').value;
  const to = document.getElementById('tg_to').value;
  const workType = document.getElementById('tg_work_type').value.trim();
  const notes = document.getElementById('tg_notes').value.trim();

  if (!lineName || !from || !to || !workType) {
    showToast('⚠️ اسم الخط وتاريخ الإطفاء ونوع العمل مطلوبة', 'error'); return;
  }

  const rec = {
    line_name: lineName,
    outage_from: from,
    outage_to: to,
    work_type: workType,
    notes: notes,
    status: status,
    created_by: currentUser.full_name
  };

  if (status === 'تنفذت') {
    pendingWorkOrderContext = { mode: 'new', rec };
    openWorkOrderModal();
    return;
  }

  await persistTelegram(rec);
}

async function persistTelegram(rec) {
  try {
    let res;
    if (editingTelegramId) {
      res = await sbFetch(`work_telegrams?id=eq.${editingTelegramId}`, { method: 'PATCH', body: JSON.stringify(rec) });
    } else {
      rec.client_uuid = genUUID();
      res = await sbFetch('work_telegrams?on_conflict=client_uuid', { method: 'POST', headers:{'Prefer':'resolution=ignore-duplicates'}, body: JSON.stringify(rec) });
    }
    if (!res.ok) throw new Error();
    showToast(rec.status === 'تنفذت' ? '✅ تم حفظ البرقية بحالة تنفذت' : '❌ تم حفظ البرقية بحالة لم تنفذ');
    clearTelegramForm();
    switchTelegramSubTab('list', document.getElementById('telegramListTabBtn'));
  } catch { showToast('❌ تعذر الحفظ، حاول مرة أخرى', 'error'); }
}

async function updateTelegramStatus(id, newStatus) {
  if (newStatus === 'تنفذت') {
    pendingWorkOrderContext = { mode: 'update', id };
    openWorkOrderModal();
    return;
  }
  try {
    const res = await sbFetch(`work_telegrams?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus, work_order_no: null, work_order_date: null }) });
    if (!res.ok) throw new Error();
    showToast('⏳ تم تحديث الحالة');
    renderTelegramLog();
  } catch { showToast('❌ تعذر التحديث', 'error'); }
}

function openWorkOrderModal() {
  document.getElementById('wo_number').value = '';
  document.getElementById('wo_date').value = '';
  document.getElementById('workOrderModal').classList.add('show');
}

function closeWorkOrderModal() {
  document.getElementById('workOrderModal').classList.remove('show');
  pendingWorkOrderContext = null;
}

async function confirmWorkOrder() {
  const woNumber = document.getElementById('wo_number').value.trim();
  const woDate = document.getElementById('wo_date').value;

  if (!woNumber || !woDate) {
    showToast('⚠️ رقم وتاريخ أمر العمل مطلوبين', 'error'); return;
  }
  if (!pendingWorkOrderContext) { closeWorkOrderModal(); return; }

  if (pendingWorkOrderContext.mode === 'new') {
    const rec = { ...pendingWorkOrderContext.rec, work_order_no: woNumber, work_order_date: woDate };
    document.getElementById('workOrderModal').classList.remove('show');
    pendingWorkOrderContext = null;
    await persistTelegram(rec);
  } else if (pendingWorkOrderContext.mode === 'update') {
    const id = pendingWorkOrderContext.id;
    try {
      const res = await sbFetch(`work_telegrams?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'تنفذت', work_order_no: woNumber, work_order_date: woDate }) });
      if (!res.ok) throw new Error();
      showToast('✅ تم تحديث الحالة إلى تنفذت');
      document.getElementById('workOrderModal').classList.remove('show');
      pendingWorkOrderContext = null;
      renderTelegramLog();
    } catch { showToast('❌ تعذر التحديث', 'error'); }
  }
}

async function deleteTelegram(id) {
  if (currentUser.role !== 'admin') { showToast('⛔ الحذف من صلاحيات المدير فقط', 'error'); return; }
  if (!confirm('هل تريد حذف هذي البرقية؟')) return;
  try {
    await sbFetch(`work_telegrams?id=eq.${id}`, { method: 'DELETE' });
    showToast('🗑️ تم الحذف');
    renderTelegramLog();
  } catch { showToast('❌ خطأ بالحذف', 'error'); }
}

function fmtDateTime(dt) {
  if (!dt) return '—';
  try {
    const d = new Date(dt);
    return d.toLocaleString('ar-IQ', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch(e) { return dt; }
}

async function renderTelegramLog() {
  const rq = { tok: featTok('tg', true), depK: (_featSeq.dep || 0) };
  const body = document.getElementById('telegramLogBody');
  body.innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  const statusFilter = document.getElementById('tgFilterStatus').value;
  const lineFilter = document.getElementById('tgFilterLine').value;

  try {
    let data = await fetchAllPages('work_telegrams?select=*&order=created_at.desc');
    if (!tgReqOk(rq)) return;

    if (statusFilter) data = data.filter(r => r.status === statusFilter);
    if (lineFilter) data = data.filter(r => r.line_name === lineFilter);

    if (!data.length) { body.innerHTML = '<div class="empty-state">لا توجد برقيات</div>'; return; }

    const canDelete = currentUser.role === 'admin';

    body.innerHTML = data.map(r => {
      const isDone = r.status === 'تنفذت';
      const borderColor = isDone ? '#48BB78' : '#C0392B';
      const statusBadge = isDone
        ? `<span style="background:#C6F6D5;color:#22543D;padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:700">✅ تنفذت</span>`
        : `<span style="background:#FED7D7;color:#822727;padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:700">❌ لم تنفذ</span>`;
      return `<div class="dep-card" style="border-right-color:${borderColor};margin-bottom:12px">
        <div class="dep-card-header">
          <div class="dep-card-title">📨 ${r.line_name}</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${statusBadge}</div>
        </div>
        <div style="margin:8px 0;font-weight:700;color:#2E4057;font-size:0.9rem">${r.work_type||'—'}</div>
        <div style="font-size:0.8rem;color:#4A5568;margin-bottom:6px">⏱️ الإطفاء: ${fmtDateTime(r.outage_from)} ← ${fmtDateTime(r.outage_to)}</div>
        ${isDone ? `<div style="font-size:0.8rem;color:#22543D;margin-bottom:6px">📋 أمر العمل رقم ${r.work_order_no||'—'} | تاريخ ${r.work_order_date||'—'}</div>` : ''}
        ${r.notes ? `<div style="color:#4A5568;font-size:0.85rem;margin-bottom:8px">${r.notes}</div>` : ''}
        <div style="font-size:0.75rem;color:#718096;margin-top:6px">👤 ${r.created_by||'—'} | 📅 ${r.created_at ? r.created_at.split('T')[0] : '—'}</div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          ${!isDone ? `<button class="btn-sm btn-primary" onclick="updateTelegramStatus('${r.id}','تنفذت')" style="background:#276749">✅ تنفذت</button>` : ''}
          ${isDone ? `<button class="btn-sm btn-primary" onclick="updateTelegramStatus('${r.id}','لم تنفذ')" style="background:#C0392B">↩️ لم تنفذ</button>` : ''}
          ${canDelete ? `<button class="btn-sm btn-del" onclick="deleteTelegram('${r.id}')">🗑️ حذف</button>` : ''}
        </div>
      </div>`;
    }).join('');

    const lineFilterSel = document.getElementById('tgFilterLine');
    const currentLine = lineFilterSel.value;
    const uniqueLines = [...new Set(data.map(r => r.line_name).filter(Boolean))].sort();
    lineFilterSel.innerHTML = '<option value="">-- كل الخطوط --</option>' +
      uniqueLines.map(n => `<option value="${n}" ${n===currentLine?'selected':''}>${n}</option>`).join('');

  } catch { if (tgReqOk(rq)) body.innerHTML = '<div class="empty-state">⚠️ تعذر التحميل</div>'; }
}

(window.__featModules = window.__featModules || {}).tg = true;
