// ========================
// النسخ الاحتياطي (أدمن فقط)
// ========================
// كل جداول قاعدة البيانات الفعلية المستخدمة بالتطبيق
const BACKUP_TABLES = [
  'inspections', 'treatments', 'memos', 'daily_reports', 'emergency_departures',
  'inventory_tools', 'inventory_materials', 'inventory_borrowed',
  'line_entry_thermal', 'line_towers_custom', 'lines_info',
  'staff_roster_columns', 'staff_roster_members',
  'thermal_inspections', 'thermal_official_forms',
  'users', 'work_telegrams'
];
// جدول users ما نقدر نسحبه بـ select=* بعد التحصين الأمني (عمود password_hash صار محجوباً عن anon)،
// فنحدد أعمدته صراحة. ملاحظة مهمة: كلمات المرور نفسها لا تُنسخ إطلاقاً (وهذا مقصود أمنياً).
const BACKUP_TABLE_SELECT = {
  users: 'id,username,full_name,role,department,phone,can_manage_inventory,is_active,created_at,last_login'
};
// مفاتيح البيانات المحفوظة محلياً بالمتصفح فقط (مو بقاعدة البيانات) — بدونها النسخة ناقصة
const BACKUP_LOCAL_KEYS = ['active_inspection_lines', 'active_thermal_sessions'];
// طوابير الإرسال المؤجل: بيانات مكتوبة فعلياً لكن لسه ما وصلت قاعدة البيانات
const BACKUP_PENDING_KEYS = ['tower_queue', 'thermal_queue', 'treatment_queue', 'line_entry_queue', 'staff_roster_queue', 'inspection_patch_queue'];

let pendingRestoreData = null;

function backupLog(msg) {
  const el = document.getElementById('backupRestoreLog');
  if (el) el.textContent += (el.textContent ? '\n' : '') + msg;
}

// يسحب كل صفوف جدول على دفعات — بدون هذا كان ممكن يقتصر على أول دفعة بصمت فتطلع نسخة ناقصة
async function fetchAllRows(table, statusEl) {
  const select = BACKUP_TABLE_SELECT[table] || '*';
  const PAGE = 1000;
  let offset = 0, all = [];
  while (true) {
    const res = await sbFetch(`${table}?select=${select}&order=id.asc&limit=${PAGE}&offset=${offset}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const chunk = await res.json();
    if (!Array.isArray(chunk)) throw new Error('bad response');
    all = all.concat(chunk);
    if (statusEl) statusEl.textContent = `⏳ ${table}: ${all.length} صف...`;
    if (chunk.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function downloadFullBackup() {
  if (currentUser.role !== 'admin') { showToast('⛔ هذي الميزة للأدمن فقط', 'error'); return; }
  const btn = document.getElementById('backupDownloadBtn');
  const statusEl = document.getElementById('backupDownloadStatus');
  btn.disabled = true;

  const backup = {
    meta: { exported_at: new Date().toISOString(), app: 'tower-app', version: 2, tables: BACKUP_TABLES, taken_by: currentUser.full_name || '' },
    tables: {}, local: {}, pending: {}, counts: {}
  };

  try {
    for (const table of BACKUP_TABLES) {
      const rows = await fetchAllRows(table, statusEl);
      backup.tables[table] = rows;
      backup.counts[table] = rows.length;
    }
  } catch (e) {
    statusEl.textContent = `❌ فشل التنزيل: ${e.message} — لم يُحفظ أي ملف (نسخة ناقصة أسوأ من لا شيء)`;
    btn.disabled = false;
    return;
  }

  // البيانات المحلية (تبويبات الخطوط المفتوحة وجلسة الكشف الحراري الجارية — خاصة بكل جهاز، مالها وجود بقاعدة البيانات)
  BACKUP_LOCAL_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v) backup.local[k] = v; });
  let pendingCount = 0;
  BACKUP_PENDING_KEYS.forEach(k => {
    const v = localStorage.getItem(k);
    if (!v) return;
    backup.pending[k] = v;
    try { const arr = JSON.parse(v); if (Array.isArray(arr)) pendingCount += arr.length; } catch(e) { console.warn('[tower-app] فشل حساب عدد السجلات المعلّقة بقائمة', k, e); }
  });

  const totalRows = Object.values(backup.counts).reduce((s, n) => s + n, 0);
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tower-app-backup-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);

  let msg = `✅ تم تنزيل النسخة (${totalRows} صف / ${BACKUP_TABLES.length} جدول)`;
  msg += `\n🔑 تنبيه: كلمات المرور غير مشمولة بالنسخة (محجوبة أمنياً) — بعد أي استعادة لازم تُعاد للأعضاء.`;
  if (pendingCount) msg += `\n📦 يوجد ${pendingCount} سجل بانتظار الإرسال لم يصل قاعدة البيانات بعد — حُفظ بالملف لكنه لا يُستعاد تلقائياً.`;
  statusEl.style.whiteSpace = 'pre-wrap';
  statusEl.textContent = msg;
  btn.disabled = false;
}

function handleBackupFileSelected(input) {
  const file = input.files[0];
  const preview = document.getElementById('backupRestorePreview');
  const summaryEl = document.getElementById('backupRestoreSummary');
  const confirmInput = document.getElementById('backupRestoreConfirmInput');
  pendingRestoreData = null;
  preview.style.display = 'none';
  confirmInput.value = '';
  document.getElementById('backupRestoreLog').textContent = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (e) {
      showToast('❌ الملف تالف أو ليس بصيغة JSON صحيحة', 'error');
      return;
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.tables || typeof parsed.tables !== 'object') {
      showToast('❌ هذا الملف ليس نسخة احتياطية صحيحة من هذا التطبيق', 'error');
      return;
    }
    const lines = Object.keys(parsed.tables).map(t => `• ${t}: ${(parsed.tables[t]||[]).length} صف`);
    const exportedAt = parsed.meta && parsed.meta.exported_at ? new Date(parsed.meta.exported_at).toLocaleString('ar-IQ') : 'غير معروف';
    let extra = '';
    const localKeys = parsed.local ? Object.keys(parsed.local) : [];
    if (localKeys.length) extra += `\n📁 بيانات محلية مشمولة (معلومات الخطوط وغيرها): ${localKeys.length} عنصر — ستُستعاد لهذا الجهاز.`;
    const pendingKeys = parsed.pending ? Object.keys(parsed.pending) : [];
    if (pendingKeys.length) extra += `\n📦 يحتوي سجلات كانت بانتظار الإرسال وقت أخذ النسخة — لا تُستعاد تلقائياً.`;
    extra += `\n🔑 كلمات المرور غير مشمولة (محجوبة أمنياً) — أي حساب جديد يُستعاد يحتاج تعيين كلمة مرور له.`;
    summaryEl.textContent = `📅 تاريخ أخذ النسخة: ${exportedAt}\n${lines.join('\n')}\n\nسيتم دمج (تحديث/إضافة) هذي البيانات مع الموجود حالياً — بدون حذف أي شيء.${extra}`;
    pendingRestoreData = parsed;
    preview.style.display = '';
  };
  reader.readAsText(file);
}

async function startBackupRestore() {
  if (currentUser.role !== 'admin') { showToast('⛔ هذي الميزة للأدمن فقط', 'error'); return; }
  if (!pendingRestoreData) { showToast('⚠️ اختر ملف نسخة احتياطية أولاً', 'error'); return; }
  const confirmInput = document.getElementById('backupRestoreConfirmInput');
  if (confirmInput.value.trim() !== 'تأكيد') {
    showToast('⚠️ لازم تكتب كلمة "تأكيد" بالضبط قبل البدء', 'error');
    return;
  }
  const btn = document.getElementById('backupRestoreBtn');
  btn.disabled = true;
  document.getElementById('backupRestoreLog').textContent = '';
  const CHUNK_SIZE = 200;
  let totalOk = 0, totalFail = 0;

  // مهم: نستعيد بترتيب BACKUP_TABLES الثابت لا بترتيب مفاتيح الملف — لأن جداول مثل treatments
  // مرتبطة بـ inspections، فلو انستعادت قبلها تُرفض صفوفها كلها بسبب المفتاح الأجنبي.
  // أي جدول موجود بالملف وغير مذكور بالقائمة نضيفه بالآخر حتى لا نفقده.
  const fileTables = Object.keys(pendingRestoreData.tables);
  const orderedTables = BACKUP_TABLES.filter(t => fileTables.includes(t))
    .concat(fileTables.filter(t => !BACKUP_TABLES.includes(t)));

  for (const table of orderedTables) {
    const rows = pendingRestoreData.tables[table] || [];
    if (!rows.length) { backupLog(`⏭️ ${table}: فاضي، تم تخطيه`); continue; }
    let tableOk = 0, tableFail = 0;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      try {
        const res = await sbFetch(table, {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(chunk)
        });
        if (res.ok) { tableOk += chunk.length; } else {
          tableFail += chunk.length;
          let detail = '';
          try { const err = await res.json(); detail = err && (err.message || err.details) ? ` — ${err.message || err.details}` : ''; } catch(e) { console.warn('[tower-app] فشل قراءة تفاصيل خطأ دفعة استعادة النسخة الاحتياطية', e); }
          backupLog(`⚠️ ${table}: فشل جزء من الدفعة (HTTP ${res.status})${detail}`);
        }
      } catch (e) {
        tableFail += chunk.length;
        backupLog(`⚠️ ${table}: خطأ اتصال (${e.message})`);
      }
    }
    totalOk += tableOk; totalFail += tableFail;
    backupLog(`✅ ${table}: ${tableOk} صف تم دمجها${tableFail ? `، ⚠️ ${tableFail} صف فشلت` : ''}`);
  }

  // استعادة البيانات المحلية (تبويبات الخطوط المفتوحة وجلسة الكشف الحراري الجارية — خاصة بكل جهاز)
  if (pendingRestoreData.local) {
    let localCount = 0;
    Object.entries(pendingRestoreData.local).forEach(([k, v]) => {
      try { localStorage.setItem(k, v); localCount++; } catch(e) { console.warn('[tower-app] فشل استعادة المفتاح المحلي', k, e); }
    });
    if (localCount) backupLog(`📁 تمت استعادة ${localCount} عنصر من البيانات المحلية (تحتاج إعادة فتح التطبيق لتظهر)`);
  }

  backupLog(`\n${totalFail ? '⚠️' : '✅'} انتهت الاستعادة: ${totalOk} صف نجحت${totalFail ? `، ${totalFail} صف فشلت` : ''}.`);
  backupLog(`🔑 تذكير: كلمات المرور لا تُستعاد — أي حساب مُستعاد يحتاج المدير يعيّن له كلمة مرور جديدة.`);
  showToast(totalFail ? '⚠️ انتهت الاستعادة مع بعض الأخطاء — راجع السجل بالأسفل' : '✅ تمت الاستعادة بنجاح', totalFail ? 'error' : undefined);
  btn.disabled = false;
  pendingRestoreData = null;
  document.getElementById('backupRestoreConfirmInput').value = '';
}
