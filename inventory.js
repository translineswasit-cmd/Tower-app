// ==================== INVENTORY (المخزن) ====================

function canManageInventory() {
  return !!(currentUser && (currentUser.role === 'admin' || currentUser.can_manage_inventory));
}

let allTools = [];
let allMaterials = [];
let editingToolId = null;
let editingMaterialId = null;

function showInventoryHome() {
  document.getElementById('invHomeView').style.display = '';
  document.getElementById('invToolsView').style.display = 'none';
  document.getElementById('invMaterialsView').style.display = 'none';
  document.getElementById('invBorrowedView').style.display = 'none';
}

function showInventoryTools() {
  pushLevel(showInventoryHome);
  document.getElementById('invHomeView').style.display = 'none';
  document.getElementById('invToolsView').style.display = '';
  document.getElementById('invMaterialsView').style.display = 'none';
  document.getElementById('invBorrowedView').style.display = 'none';
  document.getElementById('btnAddTool').style.display = canManageInventory() ? '' : 'none';
  loadInventoryTools();
}

function showInventoryMaterials() {
  pushLevel(showInventoryHome);
  document.getElementById('invHomeView').style.display = 'none';
  document.getElementById('invToolsView').style.display = 'none';
  document.getElementById('invMaterialsView').style.display = '';
  document.getElementById('invBorrowedView').style.display = 'none';
  document.getElementById('btnAddMaterial').style.display = canManageInventory() ? '' : 'none';
  loadInventoryMaterials();
}

function showInventoryBorrowed() {
  pushLevel(showInventoryHome);
  document.getElementById('invHomeView').style.display = 'none';
  document.getElementById('invToolsView').style.display = 'none';
  document.getElementById('invMaterialsView').style.display = 'none';
  document.getElementById('invBorrowedView').style.display = '';
  document.getElementById('btnAddBorrow').style.display = canManageInventory() ? '' : 'none';
  loadInventoryTools().then(loadBorrowedItems); // نحتاج allTools محمّلة لقائمة الاختيار ولحساب المتاح
}

// ---- TOOLS ----
async function loadInventoryTools() {
  const tbody = document.getElementById('toolsBody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-state">⏳ جاري التحميل...</td></tr>';
  try {
    allTools = await fetchAllPages('inventory_tools?select=*&order=name.asc');
    renderTools();
  } catch {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">⚠️ تعذر تحميل البيانات (تحقق من الاتصال)</td></tr>';
  }
}

function renderTools() {
  const tbody = document.getElementById('toolsBody');
  if (!allTools.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty-state">لا توجد مواد مضافة</td></tr>'; return; }
  const canEdit = canManageInventory();
  tbody.innerHTML = allTools.map(t => {
    const working = t.qty_working || 0, broken = t.qty_broken || 0;
    const borrowed = t.borrowed_qty || 0;
    const editBtn = canEdit ? `<button class="btn-sm btn-edit" onclick="openEditToolModal('${t.id}')">✏️</button>` : '—';
    const borrowBadge = borrowed > 0 ? `<div style="margin-top:3px;color:#B7791F;font-size:11px;font-weight:700">🔶 مستعار: ${borrowed}</div>` : '';
    return `<tr>
      <td style="padding:8px">${t.name}${borrowBadge}</td>
      <td style="padding:8px">${t.size||'—'}</td>
      <td style="padding:8px;color:#1e8449;font-weight:700">${working}</td>
      <td style="padding:8px;color:${broken>0?'#c0392b':'#999'};font-weight:700">${broken}</td>
      <td style="padding:8px;font-weight:700">${working+broken}</td>
      <td style="padding:8px;font-size:12px;color:#555">${t.storage_location||'—'}</td>
      <td style="padding:8px;font-size:12px;color:#777">${t.notes||'—'}</td>
      <td style="padding:8px">${editBtn}</td>
    </tr>`;
  }).join('');
}

// ---- BORROWED ITEMS ----
let allBorrowed = [];
async function loadBorrowedItems() {
  const tbody = document.getElementById('borrowedBody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">⏳ جاري التحميل...</td></tr>';
  try {
    allBorrowed = await fetchAllPages('inventory_borrowed?select=*&order=created_at.desc');
    renderBorrowedItems();
  } catch {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">⚠️ تعذر تحميل البيانات (تحقق من الاتصال)</td></tr>';
  }
}

function renderBorrowedItems() {
  const tbody = document.getElementById('borrowedBody');
  if (!allBorrowed.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">لا توجد مواد مستعارة حالياً</td></tr>'; return; }
  const canEdit = canManageInventory();
  tbody.innerHTML = allBorrowed.map(b => {
    const statusHTML = b.returned
      ? `<span style="color:#1e8449;font-weight:700">✅ تم الإرجاع (${b.return_date||''})</span>`
      : `<span style="color:#B7791F;font-weight:700">🔶 مستعارة</span>`;
    const actionBtn = (!b.returned && canEdit)
      ? `<button class="btn-sm btn-edit" onclick="markBorrowReturned('${b.id}')">✅ تأكيد الإرجاع</button>` : '—';
    return `<tr>
      <td style="padding:8px">${b.tool_name}</td>
      <td style="padding:8px;font-weight:700">${b.qty}</td>
      <td style="padding:8px;font-size:12px">${b.borrow_date||'—'}</td>
      <td style="padding:8px">${b.borrower_name||'—'}</td>
      <td style="padding:8px">${statusHTML}</td>
      <td style="padding:8px">${actionBtn}</td>
    </tr>`;
  }).join('');
}

function openAddBorrowModal() {
  if (!canManageInventory()) { showToast('⛔ لا تملك صلاحية إدارة المخزن', 'error'); return; }
  const sel = document.getElementById('bw_tool_id');
  sel.innerHTML = '<option value="">-- اختر المادة --</option>' +
    allTools.map(t => `<option value="${t.id}">${t.name}${t.size?(' - '+t.size):''}</option>`).join('');
  document.getElementById('bw_qty').value = '';
  document.getElementById('bw_date').value = new Date().toISOString().split('T')[0];
  document.getElementById('bw_borrower').value = '';
  document.getElementById('bw_available_hint').textContent = '';
  document.getElementById('addBorrowModal').style.display = '';
}
function closeAddBorrowModal() { document.getElementById('addBorrowModal').style.display = 'none'; }

function updateBorrowAvailable() {
  const toolId = document.getElementById('bw_tool_id').value;
  const hint = document.getElementById('bw_available_hint');
  const t = allTools.find(x => x.id === toolId);
  if (!t) { hint.textContent = ''; return; }
  hint.textContent = `📦 المتاح حالياً: ${t.qty_working||0}`;
}

async function saveBorrowedItem() {
  const toolId = document.getElementById('bw_tool_id').value;
  const qty = parseInt(document.getElementById('bw_qty').value);
  const date = document.getElementById('bw_date').value;
  const borrower = document.getElementById('bw_borrower').value.trim();
  if (!toolId) { showToast('⚠️ اختر المادة', 'error'); return; }
  if (!qty || qty < 1) { showToast('⚠️ أدخل عدد مستعار صحيح', 'error'); return; }
  if (!date || !borrower) { showToast('⚠️ أكمل التاريخ واسم المستعير', 'error'); return; }
  const t = allTools.find(x => x.id === toolId);
  if (!t) { showToast('❌ المادة غير موجودة', 'error'); return; }
  if (qty > (t.qty_working||0)) { showToast(`⚠️ العدد المتاح فقط ${t.qty_working||0}`, 'error'); return; }

  const payload = { tool_id: toolId, tool_name: t.name, qty, borrow_date: date, borrower_name: borrower, returned: false, client_uuid: genUUID() };
  try {
    const res = await sbFetch('inventory_borrowed?on_conflict=client_uuid', { method: 'POST', headers:{'Prefer':'resolution=ignore-duplicates'}, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error();
    // خصم العدد المستعار من "تعمل" + إضافته لـ"borrowed_qty" بنفس المادة
    const newWorking = (t.qty_working||0) - qty;
    const newBorrowed = (t.borrowed_qty||0) + qty;
    const patchRes = await sbFetch(`inventory_tools?id=eq.${toolId}`, { method: 'PATCH', body: JSON.stringify({ qty_working: newWorking, borrowed_qty: newBorrowed }) });
    if (!patchRes.ok) throw new Error();
    t.qty_working = newWorking; t.borrowed_qty = newBorrowed;
    showToast('✅ تم تسجيل الاستعارة');
    closeAddBorrowModal();
    await loadBorrowedItems();
    renderTools();
  } catch (e) {
    showToast('❌ تعذر حفظ الاستعارة', 'error');
  }
}

async function markBorrowReturned(id) {
  if (!canManageInventory()) { showToast('⛔ لا تملك صلاحية', 'error'); return; }
  const b = allBorrowed.find(x => x.id === id);
  if (!b) return;
  if (!confirm(`تأكيد إرجاع ${b.qty} من "${b.tool_name}"؟`)) return;
  const today = new Date().toISOString().split('T')[0];
  try {
    const res = await sbFetch(`inventory_borrowed?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ returned: true, return_date: today }) });
    if (!res.ok) throw new Error();
    // إرجاع الكمية تلقائياً لـ"تعمل" + إنقاص "borrowed_qty" بنفس المادة
    const t = allTools.find(x => x.id === b.tool_id);
    if (t) {
      const newWorking = (t.qty_working||0) + b.qty;
      const newBorrowed = Math.max(0, (t.borrowed_qty||0) - b.qty);
      const patchRes = await sbFetch(`inventory_tools?id=eq.${b.tool_id}`, { method: 'PATCH', body: JSON.stringify({ qty_working: newWorking, borrowed_qty: newBorrowed }) });
      if (patchRes.ok) { t.qty_working = newWorking; t.borrowed_qty = newBorrowed; }
    }
    showToast('✅ تم تأكيد الإرجاع');
    await loadBorrowedItems();
    renderTools();
  } catch (e) {
    showToast('❌ تعذر تأكيد الإرجاع', 'error');
  }
}

let toolRowCount = 0;
function openAddToolModal() {
  if (!canManageInventory()) { showToast('⛔ لا تملك صلاحية إدارة المخزن', 'error'); return; }
  document.getElementById('toolRowsWrap').innerHTML = '';
  toolRowCount = 0;
  addToolRow();
  document.getElementById('addToolModal').style.display = '';
}
function closeAddToolModal() { document.getElementById('addToolModal').style.display = 'none'; }

function addToolRow() {
  toolRowCount++;
  const id = 'toolRow' + toolRowCount;
  const div = document.createElement('div');
  div.className = 'form-card';
  div.id = id;
  div.style.marginBottom = '10px';
  div.innerHTML = `
    <div class="grid-2">
      <div class="field"><label>اسم المادة *</label><input class="tr_name" placeholder="مثال: مفك"></div>
      <div class="field"><label>الحجم</label><input class="tr_size" placeholder="مثال: 10 ملم"></div>
      <div class="field"><label>تعمل</label><input class="tr_working" type="number" min="0" value="0"></div>
      <div class="field"><label>عاطلة</label><input class="tr_broken" type="number" min="0" value="0"></div>
    </div>
    <div class="field" style="margin-top:10px"><label>مكان الخزن</label><input class="tr_location" placeholder="مثال: مخزن واسط - رف 2"></div>
    <div class="field" style="margin-top:10px"><label>ملاحظات</label><input class="tr_notes" placeholder="اختياري"></div>
    <button class="btn btn-del btn-sm" style="margin-top:8px" onclick="document.getElementById('${id}').remove()">🗑️ إزالة هذا الصف</button>`;
  document.getElementById('toolRowsWrap').appendChild(div);
}

async function saveToolRows() {
  const rows = Array.from(document.querySelectorAll('#toolRowsWrap .form-card'));
  const payload = [];
  for (const row of rows) {
    const name = row.querySelector('.tr_name').value.trim();
    if (!name) continue;
    payload.push({
      name,
      size: row.querySelector('.tr_size').value.trim() || null,
      qty_working: parseInt(row.querySelector('.tr_working').value) || 0,
      qty_broken: parseInt(row.querySelector('.tr_broken').value) || 0,
      storage_location: row.querySelector('.tr_location').value.trim() || null,
      notes: row.querySelector('.tr_notes').value.trim() || null,
      client_uuid: genUUID()
    });
  }
  if (!payload.length) { showToast('⚠️ أدخل اسم مادة واحدة على الأقل', 'error'); return; }
  try {
    const res = await sbFetch('inventory_tools?on_conflict=client_uuid', { method: 'POST', headers:{'Prefer':'resolution=ignore-duplicates'}, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error();
    showToast('✅ تم حفظ المواد بنجاح');
    closeAddToolModal();
    loadInventoryTools();
  } catch { showToast('❌ خطأ بالحفظ، تحقق من الاتصال', 'error'); }
}

function openEditToolModal(id) {
  const t = allTools.find(x => x.id === id);
  if (!t) return;
  editingToolId = id;
  document.getElementById('et_name').value = t.name || '';
  document.getElementById('et_size').value = t.size || '';
  document.getElementById('et_working').value = t.qty_working || 0;
  document.getElementById('et_broken').value = t.qty_broken || 0;
  document.getElementById('et_location').value = t.storage_location || '';
  document.getElementById('et_notes').value = t.notes || '';
  document.getElementById('editToolModal').style.display = '';
}
function closeEditToolModal() { document.getElementById('editToolModal').style.display = 'none'; editingToolId = null; }

async function saveEditTool() {
  if (!editingToolId) return;
  const body = {
    name: document.getElementById('et_name').value.trim(),
    size: document.getElementById('et_size').value.trim() || null,
    qty_working: parseInt(document.getElementById('et_working').value) || 0,
    qty_broken: parseInt(document.getElementById('et_broken').value) || 0,
    storage_location: document.getElementById('et_location').value.trim() || null,
    notes: document.getElementById('et_notes').value.trim() || null
  };
  try {
    const res = await sbFetch(`inventory_tools?id=eq.${editingToolId}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!res.ok) throw new Error();
    showToast('✅ تم التعديل بنجاح');
    closeEditToolModal();
    loadInventoryTools();
  } catch { showToast('❌ خطأ بالتعديل', 'error'); }
}

async function deleteToolRow() {
  if (!editingToolId) return;
  if (currentUser.role !== 'admin') { showToast('⛔ الحذف من صلاحيات المدير فقط', 'error'); return; }
  if (!confirm('هل تريد حذف هذه المادة نهائياً؟')) return;
  try {
    await sbFetch(`inventory_tools?id=eq.${editingToolId}`, { method: 'DELETE' });
    showToast('🗑️ تم الحذف');
    closeEditToolModal();
    loadInventoryTools();
  } catch { showToast('❌ خطأ بالحذف', 'error'); }
}

// ---- MATERIALS ----
async function loadInventoryMaterials() {
  const tbody = document.getElementById('materialsBody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-state">⏳ جاري التحميل...</td></tr>';
  try {
    allMaterials = await fetchAllPages('inventory_materials?select=*&order=name.asc');
    renderMaterials();
  } catch {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">⚠️ تعذر تحميل البيانات (تحقق من الاتصال)</td></tr>';
  }
}

function voltageLabel(v) { return v === 'both' ? 'كلا الجهدين' : (v + ' ك.ف'); }

function renderMaterials() {
  const filter = document.getElementById('materialVoltageFilter').value;
  const tbody = document.getElementById('materialsBody');
  const filtered = allMaterials.filter(m => filter === 'all' || String(m.voltage) === filter);
  if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty-state">لا توجد مواد مضافة</td></tr>'; return; }
  const canEdit = canManageInventory();
  tbody.innerHTML = filtered.map(m => {
    const vc = m.voltage === '400' ? '#c0392b' : (m.voltage === '132' ? '#1a5276' : '#6c3483');
    const editBtn = canEdit ? `<button class="btn-sm btn-edit" onclick="openEditMaterialModal('${m.id}')">✏️</button>` : '—';
    return `<tr>
      <td style="padding:8px">${m.name}</td>
      <td style="padding:8px"><span style="background:${vc};color:#fff;padding:2px 9px;border-radius:14px;font-size:11px;font-weight:700">${voltageLabel(m.voltage)}</span></td>
      <td style="padding:8px">${m.type_size||'—'}</td>
      <td style="padding:8px;font-weight:700">${m.qty}</td>
      <td style="padding:8px">${m.unit||'—'}</td>
      <td style="padding:8px;font-size:12px;color:#555">${m.storage_location||'—'}</td>
      <td style="padding:8px;font-size:12px;color:#777">${m.notes||'—'}</td>
      <td style="padding:8px">${editBtn}</td>
    </tr>`;
  }).join('');
}

let materialRowCount = 0;
function openAddMaterialModal() {
  if (!canManageInventory()) { showToast('⛔ لا تملك صلاحية إدارة المخزن', 'error'); return; }
  document.getElementById('materialRowsWrap').innerHTML = '';
  materialRowCount = 0;
  addMaterialRow();
  document.getElementById('addMaterialModal').style.display = '';
}
function closeAddMaterialModal() { document.getElementById('addMaterialModal').style.display = 'none'; }

function addMaterialRow() {
  materialRowCount++;
  const id = 'matRow' + materialRowCount;
  const div = document.createElement('div');
  div.className = 'form-card';
  div.id = id;
  div.style.marginBottom = '10px';
  div.innerHTML = `
    <div class="grid-3">
      <div class="field"><label>اسم المادة *</label><input class="mr_name" placeholder="مثال: عازل"></div>
      <div class="field"><label>الجهد *</label>
        <select class="mr_voltage"><option value="132">132 ك.ف</option><option value="400">400 ك.ف</option><option value="both">كلا الجهدين</option></select>
      </div>
      <div class="field"><label>النوع/الحجم</label><input class="mr_size" placeholder="مثال: V-string"></div>
    </div>
    <div class="grid-2" style="margin-top:10px">
      <div class="field"><label>الكمية</label><input class="mr_qty" type="number" step="0.01" min="0" value="0"></div>
      <div class="field"><label>الوحدة</label>
        <select class="mr_unit"><option value="قطعة">قطعة</option><option value="متر">متر</option><option value="كم">كم</option><option value="طن">طن</option></select>
      </div>
    </div>
    <div class="field" style="margin-top:10px"><label>مكان الخزن</label><input class="mr_location" placeholder="مثال: مخزن واسط - رف 2"></div>
    <div class="field" style="margin-top:10px"><label>ملاحظات</label><input class="mr_notes" placeholder="اختياري"></div>
    <button class="btn btn-del btn-sm" style="margin-top:8px" onclick="document.getElementById('${id}').remove()">🗑️ إزالة هذا الصف</button>`;
  document.getElementById('materialRowsWrap').appendChild(div);
}

async function saveMaterialRows() {
  const rows = Array.from(document.querySelectorAll('#materialRowsWrap .form-card'));
  const payload = [];
  for (const row of rows) {
    const name = row.querySelector('.mr_name').value.trim();
    if (!name) continue;
    payload.push({
      name,
      voltage: row.querySelector('.mr_voltage').value,
      type_size: row.querySelector('.mr_size').value.trim() || null,
      qty: parseFloat(row.querySelector('.mr_qty').value) || 0,
      unit: row.querySelector('.mr_unit').value,
      storage_location: row.querySelector('.mr_location').value.trim() || null,
      notes: row.querySelector('.mr_notes').value.trim() || null,
      client_uuid: genUUID()
    });
  }
  if (!payload.length) { showToast('⚠️ أدخل اسم مادة واحدة على الأقل', 'error'); return; }
  try {
    const res = await sbFetch('inventory_materials?on_conflict=client_uuid', { method: 'POST', headers:{'Prefer':'resolution=ignore-duplicates'}, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error();
    showToast('✅ تم حفظ المواد بنجاح');
    closeAddMaterialModal();
    loadInventoryMaterials();
  } catch { showToast('❌ خطأ بالحفظ، تحقق من الاتصال', 'error'); }
}

function openEditMaterialModal(id) {
  const m = allMaterials.find(x => x.id === id);
  if (!m) return;
  editingMaterialId = id;
  document.getElementById('em_name').value = m.name || '';
  document.getElementById('em_voltage').value = m.voltage || '132';
  document.getElementById('em_size').value = m.type_size || '';
  document.getElementById('em_qty').value = m.qty || 0;
  document.getElementById('em_unit').value = m.unit || 'قطعة';
  document.getElementById('em_location').value = m.storage_location || '';
  document.getElementById('em_notes').value = m.notes || '';
  document.getElementById('editMaterialModal').style.display = '';
}
function closeEditMaterialModal() { document.getElementById('editMaterialModal').style.display = 'none'; editingMaterialId = null; }

async function saveEditMaterial() {
  if (!editingMaterialId) return;
  const body = {
    name: document.getElementById('em_name').value.trim(),
    voltage: document.getElementById('em_voltage').value,
    type_size: document.getElementById('em_size').value.trim() || null,
    qty: parseFloat(document.getElementById('em_qty').value) || 0,
    unit: document.getElementById('em_unit').value,
    storage_location: document.getElementById('em_location').value.trim() || null,
    notes: document.getElementById('em_notes').value.trim() || null
  };
  try {
    const res = await sbFetch(`inventory_materials?id=eq.${editingMaterialId}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!res.ok) throw new Error();
    showToast('✅ تم التعديل بنجاح');
    closeEditMaterialModal();
    loadInventoryMaterials();
  } catch { showToast('❌ خطأ بالتعديل', 'error'); }
}

async function deleteMaterialRow() {
  if (!editingMaterialId) return;
  if (currentUser.role !== 'admin') { showToast('⛔ الحذف من صلاحيات المدير فقط', 'error'); return; }
  if (!confirm('هل تريد حذف هذه المادة نهائياً؟')) return;
  try {
    await sbFetch(`inventory_materials?id=eq.${editingMaterialId}`, { method: 'DELETE' });
    showToast('🗑️ تم الحذف');
    closeEditMaterialModal();
    loadInventoryMaterials();
  } catch { showToast('❌ خطأ بالحذف', 'error'); }
}
