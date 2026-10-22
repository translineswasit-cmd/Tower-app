/* accounts.js — v335-C5r9
   صفحة الحساب (الاسم/الهاتف/اسم المستخدم/كلمة المرور) وإدارة الأعضاء (مدير): قائمة، إضافة، تعطيل/تفعيل، إعادة تعيين كلمة المرور، حذف. تسجيل الدخول والجلسة والصلاحيات تبقى في index.html.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
(function mount_deleteUserModal() {
  if (document.getElementById('deleteUserModal')) return;
  const html = `
<div class="modal-bg" id="deleteUserModal">
  <div class="modal-box">
    <h3>⚠️ تأكيد حذف العضو</h3><p>هل تريد حذف هذا العضو نهائياً؟ سيفقد القدرة على الدخول للنظام.</p>
    <div class="modal-actions">
      <button class="btn btn-del btn-sm" style="padding:10px 24px" onclick="confirmDeleteUser()">نعم، احذف</button>
      <button class="btn btn-secondary" onclick="closeDeleteUserModal()">إلغاء</button>
    </div>
  </div>
</div>
`;
  const anchor = document.getElementById('page-home');
  if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else document.body.insertAdjacentHTML('beforeend', html);
})();

(function mount_accountActionsModal() {
  if (document.getElementById('accountActionsModal')) return;
  const html = `
<div class="modal-bg" id="accountActionsModal">
  <div class="modal-box" style="max-width:340px">
    <h3>⚙️ إدارة الحساب</h3>
    <p style="margin:6px 0 0 0;color:#666;font-size:0.85rem" id="aa_name"></p>
    <div class="acc-actions-grid" id="accountActionsGrid"></div>
    <div class="modal-actions" style="margin-top:20px">
      <button class="btn btn-secondary" onclick="closeAccountActionsModal()">إغلاق</button>
    </div>
  </div>
</div>
`;
  const anchor = document.getElementById('page-home');
  if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else document.body.insertAdjacentHTML('beforeend', html);
})();

(function mount_viewPasswordModal() {
  if (document.getElementById('viewPasswordModal')) return;
  const html = `
<div class="modal-bg" id="viewPasswordModal">
  <div class="modal-box" style="max-width:380px">
    <h3>🔑 كلمة مرور جديدة</h3>
    <p style="margin:6px 0 4px 0;color:#666;font-size:0.85rem"><span id="vp_name"></span></p>
    <p style="margin:0 0 14px 0;color:#C53030;font-size:0.78rem">⚠️ كلمة المرور القديمة توقفت — بلّغ هذي الجديدة للموظف</p>
    <div class="field" style="margin-bottom:10px">
      <label>اسم المستخدم</label>
      <div style="display:flex;gap:8px;align-items:center">
        <code id="vp_username" style="flex:1;background:#f3f4f6;padding:8px 10px;border-radius:8px;font-size:0.95rem"></code>
        <button class="btn-sm btn-edit" onclick="copyToClipboard('vp_username')">📋 نسخ</button>
      </div>
    </div>
    <div class="field" style="margin-bottom:6px">
      <label>كلمة السر</label>
      <div style="display:flex;gap:8px;align-items:center">
        <code id="vp_password" style="flex:1;background:#f3f4f6;padding:8px 10px;border-radius:8px;font-size:0.95rem"></code>
        <button class="btn-sm btn-edit" onclick="copyToClipboard('vp_password')">📋 نسخ</button>
      </div>
    </div>
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn btn-secondary" onclick="closeViewPasswordModal()">إغلاق</button>
    </div>
  </div>
</div>
`;
  const anchor = document.getElementById('page-home');
  if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else document.body.insertAdjacentHTML('beforeend', html);
})();

(function mount_addMemberModal() {
  if (document.getElementById('addMemberModal')) return;
  const html = `
<div class="modal-bg" id="addMemberModal">
  <div class="modal-box" style="max-width:420px">
    <h3 style="color:#2E4057">➕ إضافة عضو جديد</h3>
    <form id="newMemberForm" style="text-align:right;display:flex;flex-direction:column;gap:12px;margin-top:16px" onsubmit="event.preventDefault();createMember();">
      <div class="field">
        <label>الاسم الكامل *</label>
        <input id="newMemberName" placeholder="مثال: أحمد علي">
      </div>
      <div class="field">
        <label>الصلاحية *</label>
        <select id="newMemberRole">
          <option value="technician">فني — يضيف ويعدل كشوفاته</option>
          <option value="supervisor">مشرف — يضيف ويعدل ويحذف</option>
          <option value="readonly">قراءة فقط — يشوف بدون تعديل</option>
          <option value="admin">مدير — كل الصلاحيات</option>
        </select>
      </div>
      <div class="field">
        <label>القسم / الموقع</label>
        <input id="newMemberDept" placeholder="مثال: فرق الميدان">
      </div>
      <div class="field" style="flex-direction:row;align-items:center;gap:8px">
        <input type="checkbox" id="newMemberInvPerm" style="width:18px;height:18px">
        <label style="margin:0">📦 صلاحية إدارة المخزن (إضافة/تعديل المواد)</label>
      </div>
      <button type="submit" class="btn btn-primary" style="margin-top:4px">➕ إنشاء الحساب</button>
    </form>

    <div class="new-user-result" id="newUserResult" style="display:none">
      <p style="color:#276749;font-weight:700;margin-bottom:10px">✅ تم إنشاء الحساب! أعطِ هذه البيانات للعضو:</p>
      <div class="cred-row"><span class="cred-label">الاسم</span><span class="cred-value" id="resultName"></span></div>
      <div class="cred-row"><span class="cred-label">اسم المستخدم</span><span class="cred-value" id="resultUsername"></span></div>
      <div class="cred-row"><span class="cred-label">الباسورد</span><span class="cred-value" id="resultPassword"></span></div>
    </div>

    <div class="modal-actions" style="margin-top:18px">
      <button class="btn btn-secondary" onclick="closeAddMemberModal()">إغلاق</button>
    </div>
  </div>
</div>
`;
  const anchor = document.getElementById('page-home');
  if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else document.body.insertAdjacentHTML('beforeend', html);
})();

// ========================
// ACCOUNT PAGE
// ========================
function loadAccountPageImpl() {
  document.getElementById('acc_fullname_input').value = currentUser.full_name || '';
  document.getElementById('acc_username').value = currentUser.username || '';
  document.getElementById('acc_phone').value = currentUser.phone || '';
  document.getElementById('acc_jobtitle').value = currentUser.department || '';
  document.getElementById('acc_newpass').value = '';

  // فقط المدير يقدر يعدّل اسم المستخدم؛ باقي الصلاحيات يضل ثابت
  const usernameInput = document.getElementById('acc_username');
  const usernameBtn = document.getElementById('btnUpdateUsername');
  if (currentUser.role === 'admin') {
    usernameInput.readOnly = false;
    usernameInput.style.background = '';
    usernameInput.style.color = '';
    usernameBtn.style.display = 'inline-block';
  } else {
    usernameInput.readOnly = true;
    usernameInput.style.background = '#F7FAFC';
    usernameInput.style.color = '#4A5568';
    usernameBtn.style.display = 'none';
  }
}

async function saveAccountInfoImpl() {
  const fullName = document.getElementById('acc_fullname_input').value.trim();
  const phone = document.getElementById('acc_phone').value.trim();
  const jobtitle = document.getElementById('acc_jobtitle').value.trim();
  if (!fullName) { showToast('⚠️ الاسم الكامل لا يمكن أن يكون فاضي', 'error'); return; }
  try {
    const out = await csCall('app_profile_update', { p_full_name: fullName, p_phone: phone, p_department: jobtitle });
    if (out && out.stale) return;
    if (out.ok !== true) throw new Error();
    currentUser.full_name = fullName;
    currentUser.phone = phone;
    currentUser.department = jobtitle;
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    // تحديث العرض بالحال بكل مكان يظهر فيه الاسم
    const initials = fullName.charAt(0) || '?';
    document.getElementById('userAvatar').textContent = initials;
    document.getElementById('acc_fullName').textContent = fullName;
    document.getElementById('headerUserName').textContent = fullName;
    showToast('✅ تم حفظ البيانات');
  } catch { showToast('❌ تعذر الحفظ، حاول مرة أخرى', 'error'); }
}

async function updateUsernameImpl() {
  if (currentUser.role !== 'admin') { showToast('⛔ هذا الإجراء للمدير فقط', 'error'); return; }
  const newUsername = document.getElementById('acc_username').value.trim();
  if (!newUsername) { showToast('⚠️ اسم المستخدم لا يمكن أن يكون فاضي', 'error'); return; }
  if (newUsername === currentUser.username) { showToast('ℹ️ هذا هو اسم المستخدم الحالي'); return; }
  try {
    const out = await csCall('app_username_change', { p_new_username: newUsername });
    if (out && out.stale) return;
    if (out.ok !== true) { showToast('❌ ' + accountRpcMessage(out.code), 'error'); return; }
    currentUser.username = newUsername;
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    showToast('✅ تم تحديث اسم المستخدم — استخدمه بالدخول القادم');
  } catch { showToast('❌ تعذر التحديث، حاول مرة أخرى', 'error'); }
}

async function changeAccountPasswordImpl() {
  const curpass = document.getElementById('acc_curpass').value;
  const newpass = document.getElementById('acc_newpass').value.trim();
  if (!curpass) { showToast('⚠️ أدخل كلمة المرور الحالية للتأكيد', 'error'); return; }
  if (!newpass) { showToast('⚠️ أدخل كلمة مرور جديدة أولاً', 'error'); return; }
  if (newpass.length < 8) { showToast('⚠️ كلمة المرور لازم 8 أحرف على الأقل', 'error'); return; }
  try {
    const out = await csCall('app_password_change', { p_current_password: curpass, p_new_password: newpass });
    if (out && out.stale) return;
    if (out.ok !== true) { showToast('❌ ' + accountRpcMessage(out.code), 'error'); return; }
    document.getElementById('acc_curpass').value = '';
    document.getElementById('acc_newpass').value = '';
    showToast('✅ تم تحديث كلمة المرور');
  } catch { showToast('❌ تعذر التحديث، حاول مرة أخرى', 'error'); }
}

// يطلب من المدير تأكيد كلمة مروره قبل أي إجراء حساس على حسابات الآخرين
function promptAdminPassword() {
  const p = prompt('🔐 لتأكيد هويتك، أدخل كلمة مرورك:');
  return p ? p : null;
}

async function loadMembersImpl(tok) {
  const tbody = document.getElementById('membersBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">⏳ جاري التحميل...</td></tr>';
  try {
    const out = await csCall('app_users_list');
    if (out && out.stale) return;
    if (!featEntryOk(tok)) return;   // غادر المستخدم الصفحة/تغيّرت الجلسة/صدر طلب أحدث أثناء الجلب
    if (out.ok !== true || !Array.isArray(out.users)) throw new Error(out.code || 'users');
    allUsers = out.users;
    renderMembers();
    document.getElementById('totalMembers').textContent = allUsers.length;
  } catch {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">⚠️ تعذر تحميل الأعضاء</td></tr>';
  }
}

function renderMembers() {
  const tbody = document.getElementById('membersBody');
  if (!allUsers.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-state">لا يوجد أعضاء</td></tr>'; return; }
  tbody.innerHTML = allUsers.map(u => `
    <tr>
      <td>${u.full_name}</td>
      <td><code>${u.username||'—'}</code></td>
      <td><span class="role-badge role-${u.role}">${ROLE_LABELS[u.role]||u.role}</span></td>
      <td>${u.department||'—'}</td>
      <td>${u.is_active ? '🟢 فعّال' : '🔴 معطّل'}</td>
      <td><button class="btn-sm ${u.can_manage_inventory ? 'btn-edit' : 'btn-secondary'}" onclick="toggleInventoryPerm('${u.id}', ${!!u.can_manage_inventory})">${u.can_manage_inventory ? '📦 مفعّلة' : '📦 معطّلة'}</button></td>
      <td><button class="manage-acc-btn" onclick="openAccountActionsModal('${u.id}')" title="إدارة الحساب">${ICON_SETTINGS}</button></td>
    </tr>`).join('');
}

// ==== أيقونات SVG حديثة (خط نظيف) ====
const ICON_SETTINGS = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;

const ICON_EYE = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

const ICON_PAUSE = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>`;

const ICON_PLAY = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 21 12 6 21 6 3"></polygon></svg>`;

const ICON_TRASH = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;

let accountActionsUserId = null;

function openAccountActionsModal(id) {
  const u = allUsers.find(x => x.id === id);
  if (!u) return;
  accountActionsUserId = id;
  const isAdmin = currentUser && currentUser.role === 'admin';
  document.getElementById('aa_name').textContent = u.full_name || '—';
  const wrap = document.getElementById('accountActionsGrid');
  let html = '';
  if (isAdmin) {
    html += `<button class="acc-action-btn" onclick="closeAccountActionsModal();resetUserPassword('${u.id}')">${ICON_EYE}<span>إعادة تعيين كلمة المرور</span></button>`;
  }
  html += `<button class="acc-action-btn" onclick="closeAccountActionsModal();toggleUserActive('${u.id}', ${u.is_active})">${u.is_active ? ICON_PAUSE : ICON_PLAY}<span>${u.is_active ? 'إيقاف الحساب' : 'تفعيل الحساب'}</span></button>`;
  html += `<button class="acc-action-btn" onclick="closeAccountActionsModal();openDeleteUserModal('${u.id}')">${ICON_TRASH}<span>حذف الحساب</span></button>`;
  wrap.innerHTML = html;
  document.getElementById('accountActionsModal').classList.add('show');
}

function closeAccountActionsModal() { document.getElementById('accountActionsModal').classList.remove('show'); accountActionsUserId = null; }

async function resetUserPassword(id) {
  const u = allUsers.find(x => x.id === id);
  if (!u) return;
  if (currentUser.role !== 'admin') { showToast('⛔ هذا الإجراء للمدير فقط', 'error'); return; }
  if (!confirm(`إعادة تعيين كلمة مرور جديدة لـ${u.full_name || 'هذا الحساب'}؟ كلمة المرور القديمة تتوقف عن العمل فوراً.`)) return;
  const actorPass = promptAdminPassword();
  if (!actorPass) return;
  const newPassword = genPassword();
  try {
    const out = await csCall('app_user_reset_password', { p_actor_password: actorPass, p_user_id: String(id), p_new_password: newPassword });
    if (out && out.stale) return;
    if (out.ok !== true) { showToast('❌ ' + accountRpcMessage(out.code), 'error'); return; }
    document.getElementById('vp_name').textContent = u.full_name || '—';
    document.getElementById('vp_username').textContent = u.username || '—';
    document.getElementById('vp_password').textContent = newPassword;
    document.getElementById('viewPasswordModal').classList.add('show');
    showToast('✅ تم تعيين كلمة مرور جديدة');
  } catch { showToast('❌ تعذر إعادة التعيين، حاول مرة أخرى', 'error'); }
}

function closeViewPasswordModal() { document.getElementById('viewPasswordModal').classList.remove('show'); }

function copyToClipboard(elId) {
  const text = document.getElementById(elId).textContent;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast('✅ تم النسخ')).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); showToast('✅ تم النسخ'); } catch { showToast('⚠️ تعذر النسخ، انسخه يدوياً', 'error'); }
  document.body.removeChild(ta);
}

async function toggleInventoryPerm(id, current) {
  try {
    const out = await csCall('app_user_set_inventory', { p_user_id: String(id), p_value: !current });
    if (out && out.stale) return;
    if (out.ok !== true) { showToast('❌ ' + accountRpcMessage(out.code), 'error'); return; }
    showToast(!current ? '📦 تم منح صلاحية المخزن' : '📦 تم سحب صلاحية المخزن');
    loadMembers();
  } catch { showToast('❌ خطأ', 'error'); }
}

function genUsername(fullName) {
  const base = fullName.trim().split(' ')[0].toLowerCase()
    .replace(/[^a-zA-Z0-9ء-ي]/g, '');
  const translit = transliterateArabic(base);
  return translit + Math.floor(100 + Math.random()*900);
}

function transliterateArabic(str) {
  const map = {'ا':'a','ب':'b','ت':'t','ث':'th','ج':'j','ح':'h','خ':'kh','د':'d','ذ':'dh','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z','ع':'a','غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','و':'w','ي':'y','ى':'a','ة':'a','ؤ':'o','ئ':'e','إ':'i','أ':'a','آ':'a'};
  return str.split('').map(c => map[c] || c).join('');
}

function genPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let pass = '';
  for (let i=0;i<10;i++) pass += chars[Math.floor(Math.random()*chars.length)];
  return pass;
}

function openAddMemberModalImpl() {
  document.getElementById('newMemberForm').reset();
  document.getElementById('newUserResult').style.display = 'none';
  document.getElementById('addMemberModal').classList.add('show');
}

function closeAddMemberModal() { document.getElementById('addMemberModal').classList.remove('show'); }

async function createMember() {
  const fullName = document.getElementById('newMemberName').value.trim();
  const role = document.getElementById('newMemberRole').value;
  const department = document.getElementById('newMemberDept').value.trim();
  const canManageInventory = document.getElementById('newMemberInvPerm').checked;

  if (!fullName) { showToast('⚠️ أدخل اسم العضو', 'error'); return; }
  if (currentUser.role !== 'admin') { showToast('⛔ هذا الإجراء للمدير فقط', 'error'); return; }

  const actorPass = promptAdminPassword();
  if (!actorPass) return;

  const username = genUsername(fullName);
  const password = genPassword();

  try {
    // v335: عملية واحدة على الخادم تنشئ الحساب وكلمة مروره معاً بعد التحقق من المدير (لا حساب بلا كلمة مرور ولا كتابة مباشرة بالجدول)
    const out = await csCall('app_user_create', { p_actor_password: actorPass, p_full_name: fullName, p_username: username, p_role: role,
                                                  p_department: department, p_can_manage_inventory: canManageInventory, p_new_password: password });
    if (out && out.stale) return;
    if (out.ok !== true) { showToast('❌ ' + accountRpcMessage(out.code), 'error'); return; }
    document.getElementById('resultUsername').textContent = username;
    document.getElementById('resultPassword').textContent = password;
    document.getElementById('resultName').textContent = fullName;
    document.getElementById('newUserResult').style.display = 'block';
    showToast('✅ تم إنشاء العضو بنجاح');
    loadMembers();
  } catch {
    showToast('❌ خطأ، حاول مرة أخرى (تأكد الاسم غير مكرر)', 'error');
  }
}

async function toggleUserActive(id, currentActive) {
  try {
    const out = await csCall('app_user_set_active', { p_user_id: String(id), p_active: !currentActive });
    if (out && out.stale) return;
    if (out.ok !== true) { showToast('❌ ' + accountRpcMessage(out.code), 'error'); return; }
    showToast(currentActive ? '⏸️ تم تعطيل الحساب' : '▶️ تم تفعيل الحساب');
    loadMembers();
  } catch { showToast('❌ خطأ', 'error'); }
}

function openDeleteUserModal(id) { deleteUserId = id; document.getElementById('deleteUserModal').classList.add('show'); }

function closeDeleteUserModal() { document.getElementById('deleteUserModal').classList.remove('show'); deleteUserId = null; }

async function confirmDeleteUser() {
  if (!deleteUserId) return;
  if (currentUser.role !== 'admin') { showToast('⛔ الحذف من صلاحيات المدير فقط', 'error'); return; }
  try {
    const out = await csCall('app_user_delete', { p_user_id: String(deleteUserId) });
    if (out && out.stale) return;
    if (out.ok !== true) {
      showToast('❌ تعذر الحذف: ' + accountRpcMessage(out.code), 'error');
      closeDeleteUserModal();
      return;
    }
    showToast('🗑️ تم حذف العضو'); loadMembers();
  } catch { showToast('❌ خطأ بالاتصال، تحقق من الإنترنت', 'error'); }
  closeDeleteUserModal();
}

(window.__featModules = window.__featModules || {}).acct = true;
