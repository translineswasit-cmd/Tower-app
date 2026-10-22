/* official-form-archive.js — v335-C5r6
   أرشيف الاستمارات الرسمية: القائمة والبحث والحذف وفتح سجل (يحمّل المحرر عند الفتح فقط). الجلب من الخادم عند فتح الأرشيف.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند أول طلب فعلي؛ لا يعمل شيء منه عند بدء التطبيق ولا عند فتح قائمة الكشف الحراري.
   سكربت كلاسيكي: يشارك الربط العام (let/const/function) مع index.html. */
(function mount_thermalOfficialFormArchiveView() {
  // الواجهة تُركَّب عند أول تحميل للوحدة فقط (نفس المعرّفات والأحداث والتخطيط تماماً)
  const page = document.getElementById('page-thermal');
  if (!page || document.getElementById('thermalOfficialFormArchiveView')) return;
  page.insertAdjacentHTML('beforeend', `
  <div id="thermalOfficialFormArchiveView" style="display:none">
    <div class="records-toolbar">
      <div class="page-title" style="margin:0">📂 أرشيف الاستمارات الرسمية</div>
    </div>
    <input type="search" id="officialFormArchiveSearch" placeholder="🔍 بحث محلي (الخط / التاريخ / المُنشئ)" oninput="renderOfficialFormArchiveList()" style="width:100%;box-sizing:border-box;padding:10px;margin:8px 0;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit">
    <div id="officialFormArchiveBody"><div class="empty-state">⏳ جاري التحميل...</div></div>
  </div>
`);
})();

let _ofArchive = { rows: [], stale: false, at: null };

function showThermalOfficialFormArchiveImpl() {
  pushLevel(showThermalOfficialFormHome);
  thermalShowView('thermalOfficialFormArchiveView');
  renderOfficialFormArchive();
}
async function renderOfficialFormArchive() {
  const body = document.getElementById('officialFormArchiveBody');
  body.innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  let rows, stale = false, at = null;
  try {
    rows = await fetchAllPages('thermal_official_forms?select=*&order=inspection_date.desc');
    at = Date.now(); docqCachePut('thermal_form', rows, false);
  } catch (e) { const c = docqCacheGet('thermal_form'); rows = c.rows; stale = true; at = c.at; }
  _ofArchive = { rows, stale, at };
  renderOfficialFormArchiveList();
}
function renderOfficialFormArchiveList() {
  const body = document.getElementById('officialFormArchiveBody');
  const term = ((document.getElementById('officialFormArchiveSearch') || {}).value || '').trim();
  let list = docqMerge('thermal_form', _ofArchive.rows || []);
  if (term) list = list.filter(f => [f.line_name, f.inspection_date, f.created_by].some(v => String(v || '').includes(term)));
  list.sort((a, b) => String(b.inspection_date || '').localeCompare(String(a.inspection_date || '')));
  const esc = (v) => String(v == null ? '' : v).replace(/</g, '&lt;');
  const banner = _ofArchive.stale ? docqStaleBanner(_ofArchive.at) : '';
  if (!list.length) { body.innerHTML = banner + '<div class="empty-state">' + (term ? 'لا نتائج مطابقة' : 'لا توجد استمارات محفوظة بعد') + '</div>'; return; }
  body.innerHTML = banner + list.map(f => {
    const n = Array.isArray(f.rows) ? f.rows.length : 0;
    const badge = docqBadge(f);
    return `<div class="dep-card" style="cursor:pointer" onclick="openOfficialFormFromArchive('${f.id}')">
      <div class="dep-card-header">
        <div class="dep-card-title">📄 ${esc(f.line_name)}</div>
        <div class="dep-card-meta">📅 ${esc(f.inspection_date)} | 🗼 ${n} برج | 👤 ${esc(f.created_by || '—')}</div>
      </div>
      ${badge ? `<div style="margin-top:6px;font-size:0.78rem">${badge}</div>` : ''}
      <div style="margin-top:8px">
        <button class="btn-sm btn-del" onclick="event.stopPropagation();deleteOfficialFormFromArchive('${f.id}')">🗑️ حذف</button>
      </div>
    </div>`;
  }).join('');
}

async function deleteOfficialFormFromArchiveImpl(id) {
  if (docqIsLocal(id) || docqEntries('thermal_form').some(e => docqMatch(e, 'thermal_form', id) && e.action === 'create')) { showToast('⚠️ هذه الاستمارة لم تُؤكَّد بالخادم بعد: أكمل مزامنتها أو ألغِها من صفحة «المعلّقة»', 'error'); return; }
  if (!confirm('🗑️ تأكيد حذف هذه الاستمارة من الأرشيف؟ هذا الإجراء لا يمكن التراجع عنه نهائيًا.')) return;
  try {
    const res = await sbFetch(`thermal_official_forms?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('فشل الحذف');
    showToast('✅ تم حذف الاستمارة');
    renderOfficialFormArchive();
  } catch (e) {
    showToast('❌ تعذر حذف الاستمارة، تحقق من الاتصال', 'error');
  }
}

async function openOfficialFormFromArchiveImpl(id, tok) {
  try {
    let f = null, source = 'server';
    const pend = docqEntries('thermal_form').find(e => docqMatch(e, 'thermal_form', id));
    if (!docqIsLocal(id) && navigator.onLine !== false) {
      try { const res = await sbFetch(`thermal_official_forms?id=eq.${id}`); if (res.ok) { const l = await res.json(); if (l.length) { f = l[0]; docqCacheTouchRow('thermal_form', f); } } } catch (e) {}
    }
    if (!f) {
      const cu = docqUuidOf(id);
      const c = docqCacheGet('thermal_form').rows.find(r => cu ? r.client_uuid === cu : String(r.id) === String(id));
      if (c) { f = c; source = 'cache'; }
    }
    if (pend) { f = Object.assign({}, f || {}, pend.payload, { id: (f && f.id != null) ? f.id : (pend.ref_id != null ? pend.ref_id : docqLocalId(pend.client_uuid)) }); source = pend.rejected ? 'rejected' : 'pending'; }
    if (!f) { showToast('❌ غير موجود (ولا نسخة محلية له)', 'error'); return; }
    await thermalEnsure(['officialForm']);          // المحرر يُحمَّل هنا فقط (فتح سجل)، لا عند فتح الأرشيف
    if (!thNavOk(tok)) return;                      // غادر المستخدم الشاشة أثناء الجلب/التحميل: لا نفتح المحرر
    openOfficialFormRecordInEditor(f, pend, source);
  } catch (e) { showToast('❌ تعذر الفتح', 'error'); }
}
(window.__thermalModules = window.__thermalModules || {}).officialArchive = true;
