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
  'users', 'work_telegrams',
  'work_order_drivers', 'work_orders'
];
// جدول users ما نقدر نسحبه بـ select=* بعد التحصين الأمني (عمود password_hash صار محجوباً عن anon)،
// فنحدد أعمدته صراحة. ملاحظة مهمة: كلمات المرور نفسها لا تُنسخ إطلاقاً (وهذا مقصود أمنياً).
const BACKUP_TABLE_SELECT = {
  users: 'id,username,full_name,role,department,phone,can_manage_inventory,is_active,created_at,last_login'
};
// عمود الترتيب الافتراضي لكل الجداول هو id.asc — هذي الخريطة تستثني بس الجداول اللي ثبت تجريبياً
// (بفشل تنزيل النسخة الاحتياطية بـHTTP 400) إنها ما تملك عمود id، بعمود بديل مؤكَّد وجوده فعلياً
// من نفس نمط استخدامه الناجح بمكان ثاني بالتطبيق (مو تخمين):
//   line_towers_custom: يُستعلَم دائماً بـ line_name=eq./on_conflict=line_name بكل التطبيق.
//   lines_info: يُستعلَم ويُرتَّب فعلياً بـ order=idx.asc بمكان آخر ناجح بالتطبيق.
//   staff_roster_columns: يُستعلَم بـ key=eq. ويُرتَّب فعلياً بـ order=sort_order.asc بمكان آخر ناجح.
//   line_entry_thermal: لا يوجد أي SQL/توثيق متاح يؤكد أعمدته الفعلية (بحثت بكل ملفات المشروع ولم
//     أجد CREATE TABLE له). الأعمدة الوحيدة المؤكَّدة فعلياً (من استخدامها بنجاح بأماكن أخرى بالتطبيق)
//     هي: created_by_name, created_at, line_name, station_side, inspection_date — بدون أي دليل على id.
//     اخترت created_at لأنه عمود توقيت قياسي، مؤكَّد وجوده، ونفس النمط المستخدم لجداول ثانية بالتطبيق.
//     ملاحظة أمانة: هذا تخمين مبني على أفضل دليل متاح، مو تأكيد قاطع كباقي الثلاثة — لو فشل هذا
//     الجدول تحديداً بنفس رسالة الخطأ المحسَّنة أدناه، ارسل الرسالة الكاملة لتأكيد العمود الصحيح فعلياً.
const BACKUP_TABLE_ORDER = {
  line_entry_thermal: 'created_at.asc',
  line_towers_custom: 'line_name.asc',
  lines_info: 'idx.asc',
  staff_roster_columns: 'sort_order.asc'
};
// مفاتيح البيانات المحفوظة محلياً بالمتصفح فقط (مو بقاعدة البيانات) — بدونها النسخة ناقصة
const BACKUP_LOCAL_KEYS = ['active_inspection_lines', 'active_thermal_sessions'];
// طوابير الإرسال المؤجل: بيانات مكتوبة فعلياً لكن لسه ما وصلت قاعدة البيانات
const BACKUP_PENDING_KEYS = ['tower_queue', 'thermal_queue', 'treatment_queue', 'line_entry_queue', 'staff_roster_queue', 'inspection_patch_queue', 'ops_outbox', 'ops_migration_backup', 'inv_txn_outbox', 'staff_roster_idmap', 'doc_outbox'];
// v335-C4: جداول يديرها نظام العمليات (الحالة الموحّدة): لا تُكتب مباشرة من شاشة الاستعادة هذه أبداً عند تفعيل الطبقة
const BACKUP_OPS_MANAGED = ['inspections', 'treatments', 'line_towers_custom'];

// v335-C4: يسحب بيانات طبقة العمليات (الهوية/العمليات/الحالة/الإعدادات) عبر جلسة المدير الموثّقة. بلا رموز جلسة ولا كلمات مرور.
// أي فشل أو اختلاف عدّ أو تغيّر لقطة البيانات أثناء السحب => يُرفض كامل التنزيل (لا نسخة ناقصة).
async function fetchOpsBackup(statusEl) {
  const head = await csCall('app_ops_backup', {});
  if (!head || head.ok !== true || !Array.isArray(head.parts)) {
    if (head && head.code === 'not_installed') return null;
    throw new Error('طبقة العمليات: تعذّر بدء التصدير (' + ((head && head.code) || 'خطأ') + ')');
  }
  const snap = JSON.stringify(head.snapshot);
  const out = { format: head.format || 1, snapshot: head.snapshot, parts: {}, counts: {}, excluded: head.excluded || [] };
  for (const part of head.parts) {
    let off = 0, rows = [], total = null;
    while (true) {
      const r = await csCall('app_ops_backup', { p_part: part, p_offset: off, p_limit: 500 });
      if (!r || r.ok !== true || !Array.isArray(r.rows)) throw new Error('طبقة العمليات «' + part + '»: فشل (' + ((r && r.code) || 'خطأ') + ')');
      if (JSON.stringify(r.snapshot) !== snap) throw new Error('تغيّرت بيانات طبقة العمليات أثناء النسخ (' + part + ') — أعد المحاولة عند هدوء النشاط');
      total = r.total; rows = rows.concat(r.rows);
      if (statusEl) statusEl.textContent = '⏳ ops/' + part + ': ' + rows.length + ' صف...';
      if (r.next_offset === null || r.next_offset === undefined) break;
      off = r.next_offset;
    }
    if (rows.length !== total) throw new Error('طبقة العمليات «' + part + '»: عدد الصفوف ' + rows.length + ' لا يطابق ' + total);
    out.parts[part] = rows; out.counts[part] = rows.length;
  }
  return out;
}

let pendingRestoreData = null;

function backupLog(msg) {
  const el = document.getElementById('backupRestoreLog');
  if (el) el.textContent += (el.textContent ? '\n' : '') + msg;
}

// يسحب كل صفوف جدول على دفعات — بدون هذا كان ممكن يقتصر على أول دفعة بصمت فتطلع نسخة ناقصة
async function fetchAllRows(table, statusEl) {
  // v335: جدول الحسابات لا يُقرأ مباشرة من الواجهة بعد تحصين الحسابات — قراءة المدير الموثّقة بالخادم، بالحقول الآمنة نفسها (بلا كلمات مرور)
  if (table === 'users') {
    const out = await csCall('app_users_list');
    if (out.ok !== true || !Array.isArray(out.users)) throw new Error(`جدول "users": ${accountRpcMessage(out.code)}`);
    const cols = BACKUP_TABLE_SELECT.users.split(',');
    if (statusEl) statusEl.textContent = `⏳ users: ${out.users.length} صف...`;
    return out.users.map(u => { const o = {}; cols.forEach(c => { o[c] = u[c] === undefined ? null : u[c]; }); return o; });
  }
  // v335-C5: قراءة المدير الموثّقة بالخادم (جدول من قائمة ثابتة، صفحات 500، ترتيب مفتاحي ثابت). لا REST مباشر.
  const PAGE = 500;
  let offset = 0, all = [], total = null;
  while (true) {
    const out = await csCall('app_data_backup', { p_table: table, p_offset: offset, p_limit: PAGE });
    if (out.stale) throw new Error(`جدول "${table}": تغيّرت الجلسة أثناء التنزيل`);
    if (out.net) throw new Error(`جدول "${table}": لا يوجد اتصال بالإنترنت`);
    if (out.ok !== true || !Array.isArray(out.rows)) throw new Error(`جدول "${table}": ${out.code === 'forbidden' ? 'ما عندك صلاحية (مدير فقط)' : 'تعذّر القراءة'} (${out.code || 'خطأ'})`);
    total = out.total;
    all = all.concat(out.rows);
    if (statusEl) statusEl.textContent = `⏳ ${table}: ${all.length} صف...`;
    if (out.rows.length < PAGE) break;
    offset += PAGE;
  }
  if (total !== null && all.length !== Number(total)) throw new Error(`جدول "${table}": تغيّرت البيانات أثناء التنزيل (${all.length} من ${total}) — أعد المحاولة`);
  return all;
}

async function downloadFullBackup() {
  if (currentUser.role !== 'admin') { showToast('⛔ هذي الميزة للأدمن فقط', 'error'); return; }
  const btn = document.getElementById('backupDownloadBtn');
  const statusEl = document.getElementById('backupDownloadStatus');
  btn.disabled = true;

  const backup = {
    meta: { exported_at: new Date().toISOString(), app: 'tower-app', version: 3, tables: BACKUP_TABLES, taken_by: currentUser.full_name || '' },
    tables: {}, local: {}, pending: {}, counts: {}, ops: null
  };

  try {
    for (const table of BACKUP_TABLES) {
      const rows = await fetchAllRows(table, statusEl);
      backup.tables[table] = rows;
      backup.counts[table] = rows.length;
    }
    backup.ops = await fetchOpsBackup(statusEl);   // v335-C4: null فقط إذا لم تُثبَّت طبقة العمليات على الخادم
  } catch (e) {
    statusEl.textContent = `❌ فشل التنزيل: ${e.message} — لم يُحفظ أي ملف (نسخة ناقصة أسوأ من لا شيء)`;
    showToast('❌ فشل تنزيل النسخة الاحتياطية — راجع التفاصيل بأسفل الزر', 'error');
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

  const totalRows = Object.values(backup.counts).reduce((s, n) => s + n, 0) + (backup.ops ? Object.values(backup.ops.counts).reduce((s, n) => s + n, 0) : 0);
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tower-app-backup-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);

  let msg = `✅ تم تنزيل النسخة (${totalRows} صف / ${BACKUP_TABLES.length} جدول)`;
  msg += `\n🔑 تنبيه: كلمات المرور غير مشمولة بالنسخة (محجوبة أمنياً) — بعد أي استعادة لازم تُعاد للأعضاء.`;
  if (backup.ops) msg += `\n🧱 طبقة العمليات مشمولة: ${Object.keys(backup.ops.parts).length} جزء (العمليات/الحالة/الهوية/الإعدادات) — لا رموز جلسات ولا كلمات مرور.`;
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
    let extra = '', extra2 = '';
    const localKeys = parsed.local ? Object.keys(parsed.local) : [];
    if (localKeys.length) extra += `\n📁 بيانات محلية مشمولة (معلومات الخطوط وغيرها): ${localKeys.length} عنصر — ستُستعاد لهذا الجهاز.`;
    const pendingKeys = parsed.pending ? Object.keys(parsed.pending) : [];
    if (pendingKeys.length) extra += `\n📦 يحتوي سجلات كانت بانتظار الإرسال وقت أخذ النسخة — لا تُستعاد تلقائياً.`;
    extra += `\n🔑 كلمات المرور غير مشمولة (محجوبة أمنياً) — أي حساب جديد يُستعاد يحتاج تعيين كلمة مرور له.`;
    summaryEl.textContent = `📅 تاريخ أخذ النسخة: ${exportedAt}\n${lines.join('\n')}\n\nسيتم دمج (تحديث/إضافة) هذي البيانات مع الموجود حالياً — بدون حذف أي شيء.${extra}`;
    if (parsed.ops) extra2 = '\n🧱 الملف يحوي بيانات طبقة العمليات — هذه الشاشة لا تستعيدها (الاستعادة الكاملة تتم من المسؤول على الخادم فقط).';
    if (extra2) summaryEl.textContent += '\n' + extra2;
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
  // v335-C4: حارس الاستعادة — لا كتابة مباشرة فوق الجداول التي يديرها نظام العمليات، ولا استعادة ملف يحوي طبقة العمليات من هذه الشاشة
  {
    let st = null; try { st = await csCall('app_ops_status', {}); } catch (e) { st = null; }
    const opsActive = !!(st && st.ok === true && st.ops_layer);
    if (!st || (st.ok !== true && st.code !== 'not_installed')) { backupLog('⛔ تعذّر التحقق من حالة طبقة العمليات — لم تُنفَّذ أي استعادة'); showToast('⛔ تعذّر التحقق من حالة الخادم — لم تُنفَّذ استعادة', 'error'); return; }
    if (opsActive) {
      const m = pendingRestoreData.meta || {};
      if (pendingRestoreData.ops || Number(m.version) < 3) {
        backupLog('⛔ طبقة العمليات مفعّلة على الخادم: ' + (pendingRestoreData.ops ? 'الملف يحوي بيانات العمليات' : 'الملف قديم (قبل طبقة العمليات)') + ' — لا يُسمح باستعادته من هذه الشاشة كي لا يُكتب فوق الحالة الحالية. تُنفَّذ استعادة كاملة من المسؤول على الخادم فقط.');
        showToast('⛔ لا تُسمح هذه الاستعادة مع طبقة العمليات المفعّلة', 'error'); return;
      }
    }
    if (opsActive) pendingRestoreData.tables = Object.fromEntries(Object.entries(pendingRestoreData.tables).filter(([t]) => { if (BACKUP_OPS_MANAGED.includes(t)) { backupLog('⏭️ ' + t + ': يديره نظام العمليات — لن يُكتب مباشرة'); return false; } return true; }));
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
    // v335: الحسابات لا تُكتب مباشرة بالجدول من الواجهة (كتابة الدور/كلمة المرور محجوبة): تُنشأ من إدارة الأعضاء
    if (table === 'users') { backupLog(`⏭️ users: ${rows.length} صف لم تُستعاد — الحسابات تُنشأ/تُعدَّل من "إدارة الأعضاء" فقط`); continue; }
    let tableOk = 0, tableFail = 0;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      try {
        // v335-C5: دمج بالمفتاح الأساسي عبر الخادم (مدير فقط، جداول ثابتة، جداول نظام العمليات مرفوضة)
        const out = await csCall('app_data_restore', { p_table: table, p_rows: chunk }, { timeout: 120000 });
        if (out.stale) throw new Error('تغيّرت الجلسة');
        if (out.net) throw new Error('لا يوجد اتصال');
        if (out.ok === true) { tableOk += chunk.length; } else {
          tableFail += chunk.length;
          backupLog(`⚠️ ${table}: فشل جزء من الدفعة (${out.code || 'خطأ'}${out.state ? ' / ' + out.state : ''})`);
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
