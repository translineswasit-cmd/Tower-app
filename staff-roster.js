/* staff-roster.js — v335-C5r7
   كادر القسم: الجدول والفلتر وإضافة/تعديل/حذف الأعضاء والأعمدة. طابور العمليات ومعرّفاتها ومزامنتها تبقى بـ index.html ولا تحتاج هذه الوحدة.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
(function mount_staffRosterView() {
  const page = document.getElementById('page-staffStats');
  if (!page || document.getElementById('staffRosterView')) return;
  page.insertAdjacentHTML('beforeend', `
  <div id="staffRosterView" style="display:none">
    <div class="records-toolbar" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn btn-primary btn-sm" id="btnAddStaffMember" style="display:none" onclick="openStaffMemberModal()">➕ إضافة عضو</button>
      <button class="btn btn-secondary btn-sm" id="btnAddStaffColumn" style="display:none" onclick="openAddStaffColumnModal()">➕ إضافة عمود</button>
      <button class="btn btn-secondary btn-sm" onclick="openPrintStaffRosterModal()">🖨️ طباعة</button>
    </div>
    <div style="margin-bottom:10px">
      <select id="staffRosterLocationFilter" onchange="renderStaffRoster()" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;font-family:inherit;font-size:14px">
        <option value="all">جميع المواقع</option>
      </select>
    </div>
    <div style="overflow-x:auto">
      <table class="records-table" id="staffRosterTable" style="width:100%;background:white;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05)">
        <thead id="staffRosterThead"></thead>
        <tbody id="staffRosterBody"><tr><td class="empty-state">⏳ جاري التحميل...</td></tr></tbody>
      </table>
    </div>
  </div>
`);
})();
(function mount_staffMemberModal() {
  const page = document.getElementById('page-staffStats');
  if (!page || document.getElementById('staffMemberModal')) return;
  page.insertAdjacentHTML('afterend', `
<div class="modal-bg" id="staffMemberModal">
  <div class="modal-box" style="max-width:420px;text-align:right">
    <h3 id="staffMemberModalTitle" style="text-align:center">➕ إضافة عضو</h3>
    <div id="staffMemberFormFields" style="margin-top:10px"></div>
    <div class="modal-actions" style="margin-top:16px;display:flex;gap:8px">
      <button class="btn btn-primary" style="flex:1" onclick="saveStaffMemberForm()">💾 حفظ</button>
      <button class="btn btn-secondary" style="flex:1" onclick="closeStaffMemberModal()">إلغاء</button>
    </div>
  </div>
</div>
`);
})();
(function mount_addStaffColumnModal() {
  const page = document.getElementById('page-staffStats');
  if (!page || document.getElementById('addStaffColumnModal')) return;
  page.insertAdjacentHTML('afterend', `
<div class="modal-bg" id="addStaffColumnModal">
  <div class="modal-box" style="max-width:380px;text-align:right">
    <h3 style="text-align:center">➕ إضافة عمود جديد</h3>
    <div class="field" style="margin-top:10px">
      <label>اسم العمود</label>
      <input type="text" id="newStaffColumnLabel" placeholder="مثال: رقم الهاتف" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.9rem;width:100%">
    </div>
    <div class="modal-actions" style="margin-top:16px;display:flex;gap:8px">
      <button class="btn btn-primary" style="flex:1" onclick="confirmAddStaffColumn()">➕ إضافة</button>
      <button class="btn btn-secondary" style="flex:1" onclick="document.getElementById('addStaffColumnModal').classList.remove('show')">إلغاء</button>
    </div>
  </div>
</div>
`);
})();

let staffRosterLoaded = false;

function switchStaffStatsTabRosterImpl() {
  staffTabsShow(true);
  const isAdmin = currentUser && currentUser.role === 'admin';
  document.getElementById('btnAddStaffMember').style.display = isAdmin ? '' : 'none';
  document.getElementById('btnAddStaffColumn').style.display = isAdmin ? '' : 'none';
  openStaffRosterView();
}

async function openStaffRosterView() {
  const _tag = staffSessionTag();
  loadStaffRosterCacheFromLocal();
  renderStaffRoster(); // نعرض الكاش المحلي فوراً (سريع، ويشتغل بدون إنترنت)
  const ok = await fetchStaffRosterFromServer();
  if (_tag !== staffSessionTag()) return;      // تغيّرت الجلسة أثناء الجلب: لا نرسم ولا نتابع لحساب آخر
  if (ok) renderStaffRoster(); // نحدّث بأحدث نسخة من السيرفر لو نجح الاتصال
  if (!staffRosterLoaded && getStaffRosterQueue().length) syncStaffRosterQueue();
  staffRosterLoaded = true;
}
function renderStaffRoster() {
  const cols = staffRosterColumnsCache;
  const data = staffRosterMembersCache;
  const isAdmin = currentUser && currentUser.role === 'admin';

  // فلتر الموقع يظهر فقط طالما عمود "الموقع" (location) موجود بالأعمدة الحالية
  const filterSel = document.getElementById('staffRosterLocationFilter');
  const hasLocationCol = cols.some(c => c.key === 'location');
  if (hasLocationCol) {
    const currentVal = filterSel.dataset.wasBuilt ? filterSel.value : 'all';
    const locations = [...new Set(data.map(r => (r.values && r.values.location) || '').filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar'));
    filterSel.innerHTML = '<option value="all">جميع المواقع</option>' + locations.map(l => `<option value="${l.replace(/"/g,'&quot;')}">${l}</option>`).join('');
    filterSel.value = locations.includes(currentVal) ? currentVal : 'all';
    filterSel.dataset.wasBuilt = '1';
    filterSel.style.display = '';
  } else {
    filterSel.style.display = 'none';
  }
  const filterVal = hasLocationCol ? filterSel.value : 'all';
  const filtered = (!hasLocationCol || filterVal === 'all') ? data : data.filter(r => (r.values && r.values.location) === filterVal);

  // رأس الجدول (ديناميكي حسب الأعمدة الحالية)
  const thead = document.getElementById('staffRosterThead');
  let headHTML = '<tr style="text-align:right"><th style="padding:10px">ت</th><th style="padding:10px">الاسم الثلاثي</th>';
  cols.forEach(c => {
    headHTML += `<th style="padding:10px">${c.label}${isAdmin ? ` <span onclick="deleteStaffColumn('${c.key}')" style="cursor:pointer;color:#c0392b;font-weight:700;margin-right:6px" title="حذف العمود">✕</span>` : ''}</th>`;
  });
  if (isAdmin) headHTML += '<th style="padding:10px">إجراء</th>';
  headHTML += '</tr>';
  thead.innerHTML = headHTML;

  // جسم الجدول
  const body = document.getElementById('staffRosterBody');
  const colCount = 2 + cols.length + (isAdmin ? 1 : 0);
  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="${colCount}" class="empty-state">لا توجد بيانات</td></tr>`;
    return;
  }
  body.innerHTML = filtered.map((row, i) => {
    let tds = `<td style="padding:10px">${i+1}</td><td style="padding:10px;font-weight:700">${row.name || '-'}</td>`;
    cols.forEach(c => { tds += `<td style="padding:10px">${(row.values && row.values[c.key]) || '-'}</td>`; });
    if (isAdmin) {
      tds += `<td style="padding:10px"><div style="display:flex;gap:6px"><button class="btn btn-secondary btn-sm" onclick="openStaffMemberModal(${row.id})">✏️</button><button class="btn btn-secondary btn-sm" onclick="deleteStaffMember(${row.id})">🗑️</button></div></td>`;
    }
    return `<tr>${tds}</tr>`;
  }).join('');
}
// ---- إضافة/تعديل عضو ----
let _editingStaffMemberId = null;
function openStaffMemberModal(id) {
  if (currentUser.role !== 'admin') { showToast('⛔ الإضافة والتعديل من صلاحيات المدير فقط', 'error'); return; }
  _editingStaffMemberId = id || null;
  const cols = staffRosterColumnsCache;
  const row = id ? staffRosterMembersCache.find(r => r.id === id) : null;
  document.getElementById('staffMemberModalTitle').textContent = id ? '✏️ تعديل عضو' : '➕ إضافة عضو';
  let fieldsHTML = `<div class="field"><label>الاسم الثلاثي</label><input type="text" id="staffMember_name" value="${row ? String(row.name||'').replace(/"/g,'&quot;') : ''}" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.9rem;width:100%"></div>`;
  cols.forEach(c => {
    const val = row && row.values ? (row.values[c.key] || '') : '';
    fieldsHTML += `<div class="field" style="margin-top:8px"><label>${c.label}</label><input type="text" class="staffMemberColField" data-key="${c.key}" value="${String(val).replace(/"/g,'&quot;')}" style="padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.9rem;width:100%"></div>`;
  });
  document.getElementById('staffMemberFormFields').innerHTML = fieldsHTML;
  document.getElementById('staffMemberModal').classList.add('show');
}
function closeStaffMemberModal() {
  document.getElementById('staffMemberModal').classList.remove('show');
}
async function saveStaffMemberForm() {
  const name = document.getElementById('staffMember_name').value.trim();
  if (!name) { showToast('⚠️ اكتب الاسم الثلاثي', 'error'); return; }
  const values = {};
  document.querySelectorAll('.staffMemberColField').forEach(inp => { values[inp.dataset.key] = inp.value.trim(); });

  if (_editingStaffMemberId) {
    // تعديل عضو موجود — نحاول أونلاين أولاً
    const id = _editingStaffMemberId;
    const idx = staffRosterMembersCache.findIndex(r => r.id === id);
    if (idx > -1) { staffRosterMembersCache[idx] = { ...staffRosterMembersCache[idx], name, values }; saveStaffRosterMembersCache(staffRosterMembersCache); }
    closeStaffMemberModal();
    renderStaffRoster();
    try {
      const rid = rosterResolveId(id);
      if (rosterIsLocalId(rid)) throw new Error('pending_add');   // العضو لم يُنشأ بالخادم بعد: التعديل ينتظر بالطابور ويُوجَّه للمعرّف الحقيقي بعد الإنشاء
      const res = await sbFetch(`staff_roster_members?id=eq.${rid}`, { method: 'PATCH', body: JSON.stringify({ name, values }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('✅ تم الحفظ');
    } catch(e) {
      addToStaffRosterQueue('edit_member', { id, name, values });
      showToast('📦 تعذّر الاتصال، حُفظ محلياً وسيُرسل عند رجوع الإنترنت');
    }
  } else {
    // عضو جديد — v335-C5r3: معرّف العملية يُحفظ بالطابور (ويُتحقَّق من القراءة) قبل أي إرسال؛ الإرسال عبر app_roster_member_create (مرة واحدة لكل معرّف)
    const tempId = 'local_' + Date.now();
    const opId = genUUID();
    const optimisticRow = { id: tempId, name, values, _pending: true };
    if (!addToStaffRosterQueue('add_member', { tempId, name, values, op_id: opId })) {
      showToast('⛔ تعذّر حفظ الإضافة على الجهاز (الذاكرة ممتلئة) — لم تُرسل ولم تُحفظ', 'error');
      return;      // لا نُرسل شيئاً لم يُحفظ
    }
    staffRosterMembersCache.push(optimisticRow);
    saveStaffRosterMembersCache(staffRosterMembersCache);
    closeStaffMemberModal();
    renderStaffRoster();
    await syncStaffRosterQueue();
    const stillQueued = getStaffRosterQueue().some(it => it && it.op === 'add_member' && it.payload && it.payload.op_id === opId);
    showToast(stillQueued ? '📦 حُفظ محلياً وسيُرسل عند رجوع الإنترنت (يُنشأ مرة واحدة فقط)' : '✅ تم الحفظ');
  }
}
async function deleteStaffMember(id) {
  if (currentUser.role !== 'admin') { showToast('⛔ الحذف من صلاحيات المدير فقط', 'error'); return; }
  if (!confirm('هل تريد حذف هذا العضو؟')) return;

  const rid = rosterResolveId(id);
  const isLocalOnly = rosterIsLocalId(rid);
  staffRosterMembersCache = staffRosterMembersCache.filter(r => r.id !== id && r.id !== rid);
  saveStaffRosterMembersCache(staffRosterMembersCache);
  renderStaffRoster();

  if (isLocalOnly) {
    // العضو أصلاً ما انرفع للسيرفر — نلغي عملية الإضافة المعلّقة نفسها من الطابور بدل ما نرسل حذف
    // v335-C5r3: إن كانت الإضافة بدأت دورة إرسال (قد تكون وصلت الخادم وضاع الردّ) لا نُلغيها: تُنشأ ثم تُحذف بعد الربط؛ وإلا تُلغى كلياً
    let q = getStaffRosterQueue();
    const add = q.find(item => item && item.op === 'add_member' && item.payload && item.payload.tempId === id);
    q = q.filter(item => !(item && (item.op === 'edit_member') && item.payload && item.payload.id === id));
    if (add && add.payload.sent_at) { q = q.map(item => item === add || (item.op === 'add_member' && item.payload && item.payload.tempId === id) ? { ...item, payload: { ...item.payload, deleteAfter: true } } : item); }
    else { q = q.filter(item => !(item && item.op === 'add_member' && item.payload && item.payload.tempId === id)); }
    saveStaffRosterQueueRaw(q);
    showToast('🗑️ تم الحذف');
    return;
  }
  try {
    const res = await sbFetch(`staff_roster_members?id=eq.${rid}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast('🗑️ تم الحذف');
  } catch(e) {
    addToStaffRosterQueue('delete_member', { id: rid });
    showToast('📦 تعذّر الاتصال، سيُحذف من السيرفر عند رجوع الإنترنت');
  }
}
// ---- إضافة/حذف عمود ----
function openAddStaffColumnModal() {
  if (currentUser.role !== 'admin') { showToast('⛔ إدارة الأعمدة من صلاحيات المدير فقط', 'error'); return; }
  document.getElementById('newStaffColumnLabel').value = '';
  document.getElementById('addStaffColumnModal').classList.add('show');
}
async function confirmAddStaffColumn() {
  const label = document.getElementById('newStaffColumnLabel').value.trim();
  if (!label) { showToast('⚠️ اكتب اسم العمود', 'error'); return; }
  const key = 'col_' + Date.now();
  const sortOrder = staffRosterColumnsCache.length;

  staffRosterColumnsCache.push({ key, label });
  saveStaffRosterColumnsCache(staffRosterColumnsCache);
  document.getElementById('addStaffColumnModal').classList.remove('show');
  renderStaffRoster();

  try {
    const res = await sbFetch('staff_roster_columns', { method: 'POST', body: JSON.stringify({ key, label, sort_order: sortOrder }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast('✅ تمت إضافة العمود');
  } catch(e) {
    addToStaffRosterQueue('add_column', { key, label, sort_order: sortOrder });
    showToast('📦 تعذّر الاتصال، حُفظ محلياً وسيُرسل عند رجوع الإنترنت');
  }
}
async function deleteStaffColumn(key) {
  if (currentUser.role !== 'admin') { showToast('⛔ إدارة الأعمدة من صلاحيات المدير فقط', 'error'); return; }
  const col = staffRosterColumnsCache.find(c => c.key === key);
  if (!col) return;
  if (!confirm(`هل تريد حذف عمود "${col.label}"؟ سيُحذف محتواه من كل الأعضاء ولا يمكن التراجع.`)) return;

  staffRosterColumnsCache = staffRosterColumnsCache.filter(c => c.key !== key);
  saveStaffRosterColumnsCache(staffRosterColumnsCache);
  staffRosterMembersCache.forEach(r => { if (r.values) delete r.values[key]; });
  saveStaffRosterMembersCache(staffRosterMembersCache);
  renderStaffRoster();

  try {
    const res = await sbFetch(`staff_roster_columns?key=eq.${key}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast('🗑️ تم حذف العمود');
  } catch(e) {
    addToStaffRosterQueue('delete_column', { key });
    showToast('📦 تعذّر الاتصال، سيُحذف من السيرفر عند رجوع الإنترنت');
  }
}

// تحديث اختياري للواجهة من المزامنة الخلفية (index.html لا يُحمّل هذه الوحدة لأجل ذلك)
staffRosterUI = { refresh: renderStaffRoster };
(window.__staffModules = window.__staffModules || {}).roster = true;
