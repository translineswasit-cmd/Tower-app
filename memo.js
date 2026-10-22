// ========================
// MEMO (مذكرة)
// ========================
let editingMemoId = null;
// v335-C5r5: العدد "المعتمد" = الذي أكّده الخادم لهذه المذكرة (null = لم يُحدَّد بعد). لا يُعتمد في الطباعة/التصدير الرسمي إلا هو.
// حقل العدد قابل للتعديل: الفارغ في مذكرة جديدة = تلقائي (يحدده الخادم عند الحفظ ضمن قفل الترقيم)، وأي رقم مكتوب = طلب يدوي صريح.
// الرقم المقترح المعروض قبل الحفظ ليس حجزاً ولا يتحول إلى رقم يدوي إلا إذا كتبه المستخدم بنفسه.
let memoOfficialNumber = null;
let memoSuggestedNumber = null;
let memoArchiveStale = { stale: false, at: null };
let memoTableData = null; // مصفوفة ثنائية اختيارية، null = لا يوجد جدول

function addMemoTable() {
  memoTableData = [['', ''], ['', '']];
  renderMemoTableEditor();
}
function removeMemoTable() {
  memoTableData = null;
  renderMemoTableEditor();
}
function addMemoTableRow() {
  if (!memoTableData) return;
  memoTableData.push(memoTableData[0].map(() => ''));
  renderMemoTableEditor();
}
function addMemoTableCol() {
  if (!memoTableData) return;
  memoTableData.forEach(row => row.push(''));
  renderMemoTableEditor();
}
function updateMemoTableCell(r, c, val) {
  if (memoTableData && memoTableData[r]) memoTableData[r][c] = val;
}
function renderMemoTableEditor() {
  const wrap = document.getElementById('memoTableWrap');
  const addBtn = document.getElementById('memoAddTableBtn');
  if (!memoTableData) {
    wrap.style.display = 'none';
    addBtn.style.display = '';
    return;
  }
  addBtn.style.display = 'none';
  wrap.style.display = 'block';
  const tableEl = document.getElementById('memoTableEl');
  tableEl.innerHTML = memoTableData.map((row, r) =>
    `<tr>${row.map((cell, c) => `<td style="border:1px solid #ddd;padding:2px">
      <input type="text" value="${(cell||'').replace(/"/g,'&quot;')}" oninput="updateMemoTableCell(${r},${c},this.value)" style="width:100%;min-width:70px;border:none;padding:6px;text-align:center;font-family:inherit">
    </td>`).join('')}</tr>`
  ).join('');
}

// ---- قسم المرفقات (اختياري) — قائمة أسطر تترقم تلقائياً عند العرض/التصدير ----
let memoAttachments = null; // مصفوفة نصوص اختيارية، null = لا يوجد قسم مرفقات

function addMemoAttachments() {
  memoAttachments = [''];
  renderMemoAttachmentsEditor();
}
function removeMemoAttachments() {
  memoAttachments = null;
  renderMemoAttachmentsEditor();
}
function addMemoAttachmentLine() {
  if (!memoAttachments) return;
  memoAttachments.push('');
  renderMemoAttachmentsEditor();
}
function removeMemoAttachmentLine(i) {
  if (!memoAttachments) return;
  memoAttachments.splice(i, 1);
  if (!memoAttachments.length) memoAttachments.push('');
  renderMemoAttachmentsEditor();
}
function updateMemoAttachmentLine(i, val) {
  if (memoAttachments) memoAttachments[i] = val;
}
function renderMemoAttachmentsEditor() {
  const wrap = document.getElementById('memoAttachmentsWrap');
  const addBtn = document.getElementById('memoAddAttachmentsBtn');
  if (!memoAttachments) {
    wrap.style.display = 'none';
    addBtn.style.display = '';
    return;
  }
  addBtn.style.display = 'none';
  wrap.style.display = 'block';
  const listWrap = document.getElementById('memoAttachmentsListWrap');
  listWrap.innerHTML = memoAttachments.map((line, i) => `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
      <span style="font-weight:700;min-width:18px">${i+1}.</span>
      <input type="text" value="${(line||'').replace(/"/g,'&quot;')}" oninput="updateMemoAttachmentLine(${i},this.value)" style="flex:1;padding:8px 10px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.9rem">
      <button class="btn-sm btn-del" onclick="removeMemoAttachmentLine(${i})">✕</button>
    </div>`).join('');
}

function showMemoHome() {
  document.getElementById('memoHomeView').style.display = 'block';
  document.getElementById('memoNewView').style.display = 'none';
  document.getElementById('memoArchiveView').style.display = 'none';
}

function memoDigits(v) {
  return String(v == null ? '' : v).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776)).trim();
}
// نيّة العدد من حقل الشاشة: {mode:'auto'|'manual'|'keep', number?, error?}
function memoNumberIntent() {
  const v = memoDigits(document.getElementById('memo_number').value);
  const existing = !!editingMemoId && memoOfficialNumber !== null;
  if (existing) {
    if (v === String(memoOfficialNumber)) return { mode: 'keep' };
    if (v === '') return { error: 'اكتب رقماً للمذكرة أو أعد رقمها الحالي ' + memoOfficialNumber };
  } else if (v === '') return { mode: 'auto' };
  if (!/^[1-9][0-9]{0,14}$/.test(v)) return { error: 'العدد أرقام فقط (بدون أصفار بادئة أو رموز)' };
  return { mode: 'manual', number: v };
}
function memoUpdateNumberHint() {
  const el = document.getElementById('memoNumberHint'); if (!el) return;
  const it = memoNumberIntent();
  let h = '';
  if (it.error) h = '<span style="color:#c0392b">⚠️ ' + it.error + '</span>';
  else if (it.mode === 'auto') h = '🔢 <b>تلقائي</b> — يُحدِّد الخادم العدد النهائي عند الحفظ' + (memoSuggestedNumber ? ' (المقترح الآن ' + memoSuggestedNumber + '، وليس محجوزاً)' : ' (يُحدَّد عند الاتصال)');
  else if (it.mode === 'manual') h = '✍️ <b>عدد يدوي صريح: ' + it.number + '</b> — يُحفظ كما هو إن كان متاحاً، وإلا يُرفض بدون تغيير أي عدد آخر ' + '<a href="#" onclick="memoSetAuto();return false" style="margin-right:8px">↺ تلقائي</a>';
  else h = '🔒 العدد الحالي <b>' + memoOfficialNumber + '</b> — يبقى كما هو مع تعديل المحتوى، غيّره هنا فقط إن أردت تغييراً صريحاً';
  el.style.color = '#4A5568'; el.innerHTML = h;
}
function memoSetAuto() { const f = document.getElementById('memo_number'); f.value = (editingMemoId && memoOfficialNumber !== null) ? String(memoOfficialNumber) : ''; memoUpdateNumberHint(); }
function memoSetStatus(html) { const el = document.getElementById('memoSaveStatus'); if (el) el.innerHTML = html || ''; }
function ensureMemoNumberUI() {
  const f = document.getElementById('memo_number');
  f.readOnly = false; f.setAttribute('inputmode', 'numeric'); f.setAttribute('autocomplete', 'off');
  f.oninput = memoUpdateNumberHint;
  if (!document.getElementById('memoNumberHint')) {
    const h = document.createElement('div'); h.id = 'memoNumberHint'; h.style.cssText = 'font-size:0.74rem;margin-top:4px;line-height:1.6';
    f.parentNode.appendChild(h);
  }
  if (!document.getElementById('memoSaveStatus')) {
    const st = document.createElement('div'); st.id = 'memoSaveStatus'; st.style.cssText = 'font-size:0.8rem;margin:8px 0';
    const actions = document.querySelector('#memoNewView .form-actions'); if (actions) actions.parentNode.insertBefore(st, actions);
  }
}
// العدد المسموح بظهوره في الطباعة/التصدير الرسمي: المعتمد من الخادم فقط (لا عدد مؤقت ولا مقترح ولا غير محفوظ)
function memoGuardOfficialOutput() {
  const v = memoDigits(document.getElementById('memo_number').value);
  if (memoOfficialNumber === null) { showToast('⚠️ العدد لم يُحدَّد بعد — احفظ المذكرة (والعدد يُحدَّد بالخادم عند توفر الاتصال) ثم اطبع/صدّر', 'error'); return false; }
  if (v !== String(memoOfficialNumber)) { showToast('⚠️ غيّرت العدد ولم يُحفظ التغيير بعد — احفظ أولاً ليُؤكَّد العدد', 'error'); return false; }
  return true;
}

async function showMemoNew() {
  pushLevel(showMemoHome);
  document.getElementById('memoHomeView').style.display = 'none';
  document.getElementById('memoNewView').style.display = 'block';
  document.getElementById('memoArchiveView').style.display = 'none';
  editingMemoId = null; memoOfficialNumber = null;       // «مذكرة جديدة» تبدأ مذكرة جديدة دائماً (سابقاً: يبقى معرّف التعديل السابق)
  document.getElementById('memo_date').value = new Date().toISOString().split('T')[0];
  ensureMemoNumberUI(); memoSetStatus('');
  document.getElementById('memo_number').value = '';
  document.getElementById('memo_to').value = 'الى / السيـد المـديـر الـمحتـرم...';
  document.getElementById('memo_subject').value = '';
  document.getElementById('memo_body').value = '';
  document.getElementById('memo_sender_title').value = '';
  document.getElementById('memo_sender_name').value = '';
  memoTableData = null;
  renderMemoTableEditor();
  memoAttachments = null;
  renderMemoAttachmentsEditor();
  memoSuggestedNumber = null; memoUpdateNumberHint();
  memoSuggestedNumber = await generateNextMemoNumber();     // اقتراح فقط، يُعرض ولا يُحجز ولا يُملأ بالحقل
  if (!editingMemoId) memoUpdateNumberHint();
}

function showMemoArchive() {
  pushLevel(showMemoHome);
  document.getElementById('memoHomeView').style.display = 'none';
  document.getElementById('memoNewView').style.display = 'none';
  document.getElementById('memoArchiveView').style.display = 'block';
  renderMemoArchive();
}

// اقتراح العدد التالي (أعلى عدد صالح محفوظ + 1) — للعرض فقط وليس حجزاً. null عند أي فشل/أوفلاين (لا رقم وهمي).
async function generateNextMemoNumber() {
  try {
    const out = await csCall('app_memo_info');
    if (out && out.ok === true && out.next != null) return String(out.next);
  } catch (e) {}
  return null;
}

async function saveMemo() {
  const date = document.getElementById('memo_date').value;
  const to = document.getElementById('memo_to').value;
  const subject = document.getElementById('memo_subject').value;
  const body = document.getElementById('memo_body').value;
  const senderTitle = document.getElementById('memo_sender_title').value;
  const senderName = document.getElementById('memo_sender_name').value;
  if (!date || !body.trim()) { showToast('⚠️ اكمل التاريخ ومحتوى المذكرة', 'error'); return; }
  const intent = memoNumberIntent();
  if (intent.error) { showToast('⚠️ ' + intent.error, 'error'); memoUpdateNumberHint(); return; }
  const payload = { memo_date: date, memo_to: to, subject: subject, content: body, sender_title: senderTitle, sender_name: senderName, table_data: memoTableData, attachments: memoAttachments, number_mode: intent.mode };
  if (intent.mode === 'manual') payload.memo_number = intent.number;
  // القيم كاملة + الهوية + نيّة العدد تُحفظ على الجهاز أولاً؛ فشل الحفظ = لا إرسال وتبقى الحقول. الهوية الدائمة تُثبَّت فوراً (حفظ ثانٍ يدمج بنفس المذكرة).
  const sentDigits = memoDigits(document.getElementById('memo_number').value);
  let myRef = null;
  const r = await docqSubmit('memo', editingMemoId, payload, (ref) => { myRef = ref; editingMemoId = ref; });
  if (!r.ok) {
    memoSetStatus('<span style="color:#c0392b;font-weight:700">⛔ لم يُحفظ: ' + (r.reason === 'other_user' ? 'هذه المذكرة المعلّقة تخص مستخدماً آخر' : 'تعذّر الحفظ على الجهاز (الذاكرة ممتلئة)') + ' — لم يُرسل شيء وبقيت الحقول</span>');
    showToast(r.reason === 'other_user' ? '⛔ هذه المذكرة المعلّقة تخص مستخدماً آخر على هذا الجهاز' : '⛔ تعذّر الحفظ على الجهاز — لم يُرسل شيء وبقيت الحقول', 'error');
    return;
  }
  if (String(editingMemoId) !== String(myRef)) {          // انتقل المستخدم لمذكرة أخرى أثناء الانتظار: لا نلمس شاشته
    showToast(r.state === 'confirmed' ? '✅ تم حفظ المذكرة السابقة (مؤكَّدة بالخادم)' : (r.state === 'rejected' ? '⛔ رفض الخادم المذكرة السابقة — بصفحة المعلّقة للمراجعة' : '📱 حُفظت المذكرة السابقة على الجهاز فقط'), r.state === 'rejected' ? 'error' : undefined);
    return;
  }
  if (r.state === 'confirmed' && r.row) {
    memoOfficialNumber = r.row.memo_number == null ? '' : String(r.row.memo_number);
    if (memoDigits(document.getElementById('memo_number').value) === sentDigits) document.getElementById('memo_number').value = memoOfficialNumber;     // لم يغيّره المستخدم أثناء الإرسال
    memoSetStatus(docqStatusHTML('confirmed') + ' — العدد: <b>' + memoOfficialNumber + '</b>');
    showToast('✅ ' + (intent.mode === 'auto' ? 'تم حفظ المذكرة بالأرشيف — العدد ' + memoOfficialNumber : 'تم حفظ المذكرة بالأرشيف'));
  } else if (r.state === 'rejected') {
    memoSetStatus(docqStatusHTML('rejected', r.code));
    showToast('⛔ ' + (DOCQ_MSG[r.code] || r.code), 'error');
  } else {
    memoSetStatus(docqStatusHTML('pending') + (intent.mode === 'auto' ? ' — العدد يُحدَّد عند المزامنة' : ''));
    showToast('📱 حُفظت المذكرة على الجهاز فقط — لم تُؤكَّد بالخادم بعد');
  }
  memoUpdateNumberHint();
}

let memoArchiveCache = [];

function renderMemoCards(list) {
  const body = document.getElementById('memoArchiveBody');
  const banner = memoArchiveStale.stale ? docqStaleBanner(memoArchiveStale.at) : '';
  if (!list.length) { body.innerHTML = banner + '<div class="empty-state">لا توجد نتائج</div>'; return; }
  body.innerHTML = banner + list.map(m => {
    const preview = m.subject || (m.content || '').split('\n').map(l => l.trim()).filter(l => l)[0] || 'بدون عنوان';
    const num = (m._pending && m.number_mode === 'manual') ? (m.memo_number + ' (مطلوب)') : (m.memo_number || (m._pending === 'create' ? 'يُحدَّد عند المزامنة' : '—'));
    const badge = docqBadge(m);
    const canDel = !(m._pending === 'create' || docqIsLocal(m.id));
    return `
    <div class="dep-card" style="cursor:pointer" onclick="openMemoFromArchive('${m.id}')">
      <div class="dep-card-header">
        <div class="dep-card-title">📝 ${String(preview).replace(/</g, '&lt;')}</div>
        <div class="dep-card-meta">🔢 العدد: ${String(num).replace(/</g, '&lt;')} | 📅 ${m.memo_date} | 👤 ${String(m.created_by || '—').replace(/</g, '&lt;')}</div>
        ${badge ? '<div style="font-size:12px;margin-top:4px">' + badge + '</div>' : ''}
      </div>
      <div style="margin-top:8px">
        <button class="btn-sm btn-del" onclick="event.stopPropagation();deleteMemoFromArchive('${m.id}')">🗑️ حذف</button>
      </div>
    </div>`;
  }).join('');
}

function filterMemoArchive(q) {
  if (!q || !q.trim()) { renderMemoCards(memoArchiveCache); return; }
  const terms = q.trim().toLowerCase().split(/\s+/);
  const filtered = memoArchiveCache.filter(m => {
    const hay = [m.subject||'', m.content||'', m.memo_number||''].join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
  });
  renderMemoCards(filtered);
}

async function renderMemoArchive() {
  const body = document.getElementById('memoArchiveBody');
  body.innerHTML = '<div class="empty-state">⏳ جاري التحميل...</div>';
  const searchInput = document.getElementById('memoSearchInput');
  if (searchInput) searchInput.value = '';
  let list, stale = false, at = null;
  try {
    const res = await sbFetch('memos?select=id,memo_number,memo_date,subject,content,created_by,client_uuid&order=memo_date.desc');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    list = await res.json();
    if (!Array.isArray(list)) throw new Error('bad');
    at = Date.now(); docqCachePut('memo', list, false);
  } catch (e) { const c = docqCacheGet('memo'); list = c.rows; stale = true; at = c.at; }     // بلا اتصال: آخر نسخة محفوظة على الجهاز (قديمة دائماً) + المعلّقة
  memoArchiveStale = { stale, at };
  memoArchiveCache = docqMerge('memo', list);
  if (!memoArchiveCache.length) { body.innerHTML = (stale ? docqStaleBanner(at) : '') + '<div class="empty-state">لا توجد مذكرات محفوظة بعد</div>'; return; }
  renderMemoCards(memoArchiveCache);
}

async function deleteMemoFromArchive(id) {
  const _m = memoArchiveCache.find(m => String(m.id) === String(id));
  if (docqIsLocal(id) || (_m && _m._pending === 'create')) { showToast('⚠️ هذه المذكرة لم تُؤكَّد بالخادم بعد: أكمل مزامنتها أو ألغِها من صفحة «المعلّقة»', 'error'); return; }
  if (!confirm('🗑️ تأكيد حذف هذه المذكرة من الأرشيف؟ هذا الإجراء لا يمكن التراجع عنه نهائيًا.')) return;
  try {
    const res = await sbFetch(`memos?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('فشل الحذف');
    showToast('✅ تم حذف المذكرة');
    memoArchiveCache = memoArchiveCache.filter(m => String(m.id) !== String(id));
    const q = document.getElementById('memoSearchInput');
    filterMemoArchive(q ? q.value : '');
  } catch (e) {
    showToast('❌ تعذر حذف المذكرة، تحقق من الاتصال', 'error');
  }
}

async function openMemoFromArchive(id) {
  try {
    const pend = docqEntries('memo').find(e => docqMatch(e, 'memo', id) && (!currentUser || String(e.uid) === String(currentUser.id)));
    let m = null, official = null, wantNumber = null;
    if (docqIsLocal(id)) {
      if (!pend) { showToast('❌ غير موجود', 'error'); return; }
      m = Object.assign({}, pend.payload, { id });
    } else {
      let base = null;
      try {
        const res = await sbFetch(`memos?id=eq.${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const list = await res.json();
        if (!Array.isArray(list)) throw new Error('bad');
        if (!list.length) { showToast('❌ غير موجود', 'error'); return; }
        base = list[0];
      } catch (e) {
        if (!pend) throw e;                       // بلا اتصال: تُفتح فقط المذكرة التي لها تعديل معلّق محفوظ كاملاً على الجهاز
        base = Object.assign({}, docqCacheGet('memo').rows.find(x => String(x.id) === String(id)) || { id });
      }
      m = Object.assign({}, base, pend ? pend.payload : {});
      official = base.memo_number == null ? (base.memo_number === undefined ? null : '') : String(base.memo_number);
      if (pend && pend.payload.number_mode === 'manual') wantNumber = pend.payload.memo_number;
    }
    editingMemoId = docqIsLocal(id) ? id : (m.id != null ? m.id : id);
    memoOfficialNumber = official;
    document.getElementById('memoHomeView').style.display = 'none';
    document.getElementById('memoNewView').style.display = 'block';
    document.getElementById('memoArchiveView').style.display = 'none';
    ensureMemoNumberUI();
    const numberField = document.getElementById('memo_number');
    numberField.value = wantNumber != null ? String(wantNumber) : (pend && pend.payload.number_mode === 'manual' ? String(pend.payload.memo_number) : (official !== null ? official : ''));
    document.getElementById('memo_date').value = m.memo_date || '';
    document.getElementById('memo_to').value = m.memo_to || 'الى / السيـد المـديـر الـمحتـرم...';
    document.getElementById('memo_subject').value = m.subject || '';
    document.getElementById('memo_body').value = m.content || '';
    document.getElementById('memo_sender_title').value = m.sender_title || '';
    document.getElementById('memo_sender_name').value = m.sender_name || '';
    memoTableData = m.table_data || null;
    renderMemoTableEditor();
    memoAttachments = m.attachments || null;
    renderMemoAttachmentsEditor();
    memoSetStatus(pend ? docqStatusHTML(pend.rejected ? 'rejected' : 'pending', pend.rejected && pend.rejected.code) : '');
    memoUpdateNumberHint();
    showToast('📂 تم تحميل المذكرة، تكدر تعدّلها');
  } catch (e) { showToast('❌ تعذر الفتح', 'error'); }
}

// نسخة Word: جداول HTML تقليدية فقط بدون أي Flexbox أو خصائص حديثة (برامج Word/WPS لا تدعمها وتكسر التنسيق)
function buildMemoFormattedParagraphsHTML(lines) {
  return lines.map((line, i) => {
    const t = line.trim();
    const indentStyle = i === 0 ? 'text-indent:5ch;' : '';
    return `<p style="${indentStyle}margin:0 0 4px 0">${t || '&#160;'}</p>`;
  }).join('');
}

function buildMemoWordHTML() {
  const number = document.getElementById('memo_number').value || '';
  const date = document.getElementById('memo_date').value || '';
  const to = document.getElementById('memo_to').value || '';
  const subject = document.getElementById('memo_subject').value || '';
  const content = document.getElementById('memo_body').value || '';
  const senderTitle = document.getElementById('memo_sender_title').value || '';
  const senderName = document.getElementById('memo_sender_name').value || '';
  return `
    <div style="font-family:Arial,sans-serif;direction:rtl;font-size:16px;line-height:1.9">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-weight:700" align="right">${to}</td>
          <td align="left" style="white-space:nowrap">العدد&#160;:&#160;${number}</td>
        </tr>
        <tr>
          <td>&#160;</td>
          <td align="left" style="white-space:nowrap">التاريخ&#160;:&#160;${date}</td>
        </tr>
      </table>
      <p align="center" style="font-weight:700;margin-top:14px">م / ${subject}</p>
      <div style="margin-top:18px;text-align:justify">${buildMemoFormattedParagraphsHTML(content.split('\n'))}</div>
      ${buildMemoTableHTML()}
      <p align="center" style="margin-top:18px">مع التقدير …</p>
      ${buildMemoAttachmentsHTML()}
      <div style="margin-top:60px;margin-right:40%;text-align:center">
        ${senderTitle ? `<p>${senderTitle}</p>` : ''}
        ${senderName ? `<p>${senderName}</p>` : ''}
      </div>
    </div>
  `;
}

function buildMemoTableHTML() {
  if (!memoTableData || !memoTableData.length) return '';
  const rowsHTML = memoTableData.map(row =>
    `<tr>${row.map(cell => `<td style="border:1px solid #000;padding:6px 14px;text-align:center;max-width:200px;white-space:normal;word-wrap:break-word">${cell || ''}</td>`).join('')}</tr>`
  ).join('');
  return `<table style="border-collapse:collapse;margin:18px auto 0;font-size:15px;width:auto">${rowsHTML}</table>`;
}

// قسم المرفقات (اختياري) — عنوان "المرفقات :" مخطوط + قائمة مرقّمة، محاذاة يمين، بدون إطار
function buildMemoAttachmentsHTML() {
  if (!memoAttachments) return '';
  const validAttachments = memoAttachments.filter(a => a && a.trim());
  if (!validAttachments.length) return '';
  const itemsHTML = validAttachments.map((att, i) => `<div>${i+1}. ${att.trim()}</div>`).join('');
  return `<div style="margin-top:18px;text-align:right">
    <div style="display:inline-block;font-weight:700;text-decoration:underline">المرفقات :</div>
    <div style="margin-top:4px">${itemsHTML}</div>
  </div>`;
}

function buildMemoBodyHTML() {
  const number = document.getElementById('memo_number').value || '';
  const date = document.getElementById('memo_date').value || '';
  const to = document.getElementById('memo_to').value || '';
  const subject = document.getElementById('memo_subject').value || '';
  const content = document.getElementById('memo_body').value || '';
  const senderTitle = document.getElementById('memo_sender_title').value || '';
  const senderName = document.getElementById('memo_sender_name').value || '';
  return `
    <div style="font-family:Arial,sans-serif;direction:rtl;font-size:16px;line-height:1.9">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="font-weight:700">${to}</div>
        <div>
          <div style="white-space:nowrap">العدد&#160;:&#160;${number}</div>
          <div style="white-space:nowrap;margin-top:2px">التاريخ&#160;:&#160;${date}</div>
        </div>
      </div>
      <p align="center" style="font-weight:700;margin-top:14px">م / ${subject}</p>
      <div style="margin-top:18px;text-align:justify">${buildMemoFormattedParagraphsHTML(content.split('\n'))}</div>
      ${buildMemoTableHTML()}
      <p align="center" style="margin-top:18px">مع التقدير …</p>
      ${buildMemoAttachmentsHTML()}
      <div style="margin-top:60px;margin-right:40%;text-align:center">
        ${senderTitle ? `<p>${senderTitle}</p>` : ''}
        ${senderName ? `<p>${senderName}</p>` : ''}
      </div>
    </div>
  `;
}

// طباعة نظيفة بدون أي نص زائد (رابط/تاريخ) يضيفه نظام iOS تلقائيًا عند الطباعة المباشرة:
// نولّد ملف PDF حقيقي برسم النص مباشرة بـ Canvas 2D (أوثق من تقنية HTML→صورة، نفس أسلوب تصدير المغادرات)
function buildMemoCanvasPNG(widthCss) {
  const number = document.getElementById('memo_number').value || '';
  const date = document.getElementById('memo_date').value || '';
  const to = document.getElementById('memo_to').value || '';
  const subject = document.getElementById('memo_subject').value || '';
  const contentRaw = document.getElementById('memo_body').value || '';
  const senderTitle = document.getElementById('memo_sender_title').value || '';
  const senderName = document.getElementById('memo_sender_name').value || '';

  const sidePad = 30, scale = 5;
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  const fontNormal = '16px Tahoma, Arial';
  const fontBold = 'bold 16px Tahoma, Arial';
  const lh = 16 * 1.9; // ارتفاع السطر

  function wrapText(ctx, text, maxWidth) {
    const words = String(text).split(' ').filter(w => w !== '');
    const out = []; let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) { out.push(line); line = word; }
      else { line = test; }
    }
    if (line) out.push(line);
    return out.length ? out : [''];
  }

  const ops = [];
  let y = 30;

  // السطر 1-2: العدد والتاريخ أعلى يسار (نفرض LTR لهذا السطرين فقط لضمان تطابق بداية الكلمتين) | "إلى" أعلى يمين
  mctx.font = fontBold;
  const leftColWidth = 160;
  const rightColWidth = widthCss - sidePad*2 - leftColWidth - 10;
  const toLines = wrapText(mctx, to, rightColWidth);
  toLines.forEach((ln, i) => ops.push({ type:'text', text: ln, x: widthCss - sidePad, y: y + i*lh*0.85 + lh*0.7, font: fontBold, align:'right' }));
  mctx.font = fontNormal;
  const lineContentWidth = widthCss - sidePad*2;
  // النقطة اليمنى الثابتة لبداية السطرين (٨٠٪ من عرض السطر) — نرسم بـ RTL طبيعي حتى تُقرأ "العدد : 240" بالترتيب الصحيح
  const headerStartX = sidePad + lineContentWidth * 0.20; // يبعد 80% عن يمين الورقة (أي 20% من بداية اليسار)
  ops.push({ type:'text', text: `العدد : ${number}`, x: headerStartX, y: y + lh*0.7, font: fontNormal, align:'right', dir:'rtl' });
  ops.push({ type:'text', text: `التاريخ : ${date}`, x: headerStartX, y: y + lh*1.6, font: fontNormal, align:'right', dir:'rtl' });
  y += Math.max(toLines.length*lh*0.85, lh*1.7) + lh*1.5; // مسافة حتى السطر 5 تقريباً

  // السطر 5: الموضوع "م/ ..." بالنص
  mctx.font = fontBold;
  ops.push({ type:'text', text: `م / ${subject}`, x: widthCss/2, y: y + lh*0.7, font: fontBold, align:'center' });
  y += lh * 1.3;

  // السطر 6+: المحتوى — تسطيب كامل (يمين ويسار متناسقين)، أول سطر فقط بمسافة 5 حروف
  mctx.font = fontNormal;
  const contentMaxWidth = widthCss - sidePad*2;
  const indentWidth = mctx.measureText('ممممم').width; // مسافة 5 حروف (تقريب بعرض حرف عربي متوسط)
  const contentLines = contentRaw.split('\n');
  const justifiedRows = []; // {words, isLastOfParagraph, indent}
  contentLines.forEach((rawLine, li) => {
    const t = rawLine.trim();
    if (!t) { justifiedRows.push({ words: [], blank: true }); return; }
    const isFirstLineOfContent = justifiedRows.filter(r=>!r.blank).length === 0;
    const avail = contentMaxWidth - (isFirstLineOfContent ? indentWidth : 0);
    const wrapped = wrapText(mctx, t, avail);
    wrapped.forEach((wline, wi) => {
      const isLastWrapOfThisRawLine = wi === wrapped.length - 1;
      justifiedRows.push({
        words: wline.split(' ').filter(w=>w),
        blank: false,
        indent: (isFirstLineOfContent && wi === 0) ? indentWidth : 0,
        isLastOfParagraph: isLastWrapOfThisRawLine // آخر سطر بفقرة (الأسطر بسبب فاصلة سطر بالأصل) لا يُسطَّب (محاذاة عادية)
      });
    });
  });
  justifiedRows.forEach(row => {
    if (row.blank) { y += lh; return; }
    const x0 = widthCss - sidePad - row.indent;
    const maxW = contentMaxWidth - row.indent;
    if (row.isLastOfParagraph || row.words.length <= 1) {
      // محاذاة عادية يمين (بدون تسطيب) — السطر الأخير بالفقرة
      ops.push({ type:'text', text: row.words.join(' '), x: x0, y: y + lh*0.7, font: fontNormal, align:'right' });
    } else {
      // تسطيب: نوزّع المسافات الفائضة بالتساوي بين الكلمات حتى يتساوى بداية ونهاية كل الأسطر
      const totalWordsWidth = row.words.reduce((s,w) => s + mctx.measureText(w).width, 0);
      const gap = Math.max(mctx.measureText(' ').width, (maxW - totalWordsWidth) / (row.words.length - 1));
      let curX = x0;
      row.words.forEach(w => {
        ops.push({ type:'text', text: w, x: curX, y: y + lh*0.7, font: fontNormal, align:'right' });
        curX -= (mctx.measureText(w).width + gap);
      });
    }
    y += lh;
  });
  y += lh * 0.6;

  // الجدول (لو موجود) — كل عمود ياخذ عرض محتواه طبيعياً (بدون تمديد قسري لملء عرض الورقة)،
  // وسقف أقصى 200px لأي عمود؛ أي محتوى أطول من السقف ينكسر لأكثر من سطر داخل نفس الخلية
  let hasTable = false;
  if (typeof memoTableData !== 'undefined' && memoTableData && memoTableData.length) {
    hasTable = true;
    const cols = memoTableData[0].length;
    const cellPad = 16, minColW = 50, maxColW = 200, cellLineH = 18;
    mctx.font = '15px Tahoma, Arial';
    const colWidths = [];
    for (let c = 0; c < cols; c++) {
      let maxW = minColW;
      memoTableData.forEach(row => { maxW = Math.max(maxW, mctx.measureText(row[c] || '').width + cellPad); });
      colWidths.push(Math.min(maxW, maxColW));
    }
    const wrappedRows = memoTableData.map(row => row.map((cell, ci) => wrapText(mctx, cell || '', colWidths[ci] - cellPad)));
    const totalTableWidth = colWidths.reduce((s,w) => s+w, 0);
    const tableRightEdge = widthCss/2 + totalTableWidth/2; // الجدول يتوسط الورقة أفقياً
    wrappedRows.forEach(wrappedRow => {
      const rowLines = Math.max(1, ...wrappedRow.map(lines => lines.length));
      const rowH = rowLines * cellLineH + 12;
      let cx = tableRightEdge; // نبدأ من حافة الجدول اليمنى (بعد التوسيط) — العمود الأول أقصى يمين الجدول
      wrappedRow.forEach((lines, ci) => {
        const w = colWidths[ci];
        cx -= w;
        ops.push({ type:'rect', x: cx, y: y, w: w, h: rowH });
        const startTextY = y + (rowH - lines.length*cellLineH)/2 + cellLineH*0.7;
        lines.forEach((ln, li) => {
          ops.push({ type:'text', text: ln, x: cx + w/2, y: startTextY + li*cellLineH, font:'15px Tahoma, Arial', align:'center' });
        });
      });
      y += rowH;
    });
  }

  // "مع التقدير …" — سطر واحد تحت الجدول لو موجود، وإلا تحت المحتوى مباشرة
  y += lh;
  mctx.font = fontNormal;
  ops.push({ type:'text', text: 'مع التقدير …', x: widthCss/2, y: y + lh*0.7, font: fontNormal, align:'center' });
  const afterTeqdeerY = y;
  y += lh * 1.6;

  // قسم المرفقات (اختياري) — تحت "مع التقدير" وفوق التوقيع، محاذاة يمين، عنوان مخطوط + قائمة مرقّمة
  if (typeof memoAttachments !== 'undefined' && memoAttachments && memoAttachments.some(a => a && a.trim())) {
    const validAttachments = memoAttachments.filter(a => a && a.trim());
    mctx.font = fontBold;
    const titleText = 'المرفقات :';
    const titleWidth = mctx.measureText(titleText).width;
    const titleRightX = widthCss - sidePad;
    ops.push({ type:'text', text: titleText, x: titleRightX, y: y + lh*0.7, font: fontBold, align:'right' });
    ops.push({ type:'line', x1: titleRightX - titleWidth, y1: y + lh*0.7 + 3, x2: titleRightX, y2: y + lh*0.7 + 3 });
    y += lh;
    mctx.font = fontNormal;
    validAttachments.forEach((att, i) => {
      const lines = wrapText(mctx, `${i+1}. ${att.trim()}`, contentMaxWidth);
      lines.forEach(ln => { ops.push({ type:'text', text: ln, x: widthCss - sidePad, y: y + lh*0.7, font: fontNormal, align:'right' }); y += lh; });
    });
    y += lh * 0.5;
  }

  // عنوان واسم مقدم الطلب — بالنص (محاذاة وسط)، مسحوبين نحو الوسط أفقياً (لا أقصى اليسار)
  // مذكرة طويلة (تقترب من ملء صفحة A4) → سطر واحد بعد مع التقدير | مذكرة قصيرة → 7 أسطر بعد (تنسحب للأسفل)
  const a4HeightAtThisWidth = widthCss * 1.414; // نسبة A4 الحقيقية
  const sigBlockHeight = lh * 2.5;
  const sigShortY = afterTeqdeerY + lh*7;
  const sigLongY = afterTeqdeerY + lh*1;
  const isShortMemo = (sigShortY + sigBlockHeight) <= (a4HeightAtThisWidth - 20);
  let sigY = Math.max(y, isShortMemo ? sigShortY : sigLongY);
  const tenCharsWidth = mctx.measureText('مممممممممم').width; // عرض تقريبي لـ10 حروف (10 أحرف م)
  const sigX = widthCss * 0.40 - tenCharsWidth; // مسحوب نحو الوسط + إزاحة 10 حروف يسار
  if (senderTitle) { ops.push({ type:'text', text: senderTitle, x: sigX, y: sigY + lh*0.7, font: fontNormal, align:'center' }); sigY += lh; }
  if (senderName) { ops.push({ type:'text', text: senderName, x: sigX, y: sigY + lh*0.7, font: fontNormal, align:'center' }); }
  y = sigY + lh;

  const totalHeight = y + 20;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthCss * scale);
  canvas.height = Math.round(totalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, widthCss, totalHeight);
  ctx.direction = 'rtl';
  ctx.textBaseline = 'alphabetic';
  ops.forEach(op => {
    if (op.type === 'rect') {
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(op.x, op.y, op.w, op.h);
    } else if (op.type === 'line') {
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(op.x1, op.y1); ctx.lineTo(op.x2, op.y2); ctx.stroke();
    } else {
      ctx.direction = op.dir === 'ltr' ? 'ltr' : 'rtl';
      ctx.font = op.font;
      ctx.textAlign = op.align === 'right' ? 'right' : op.align === 'center' ? 'center' : 'left';
      ctx.fillStyle = '#000';
      ctx.fillText(op.text, op.x, op.y);
      ctx.direction = 'rtl';
    }
  });
  return { dataUrl: canvas.toDataURL('image/png'), w: widthCss, h: totalHeight };
}

async function exportMemoPDF() {
  if (!memoGuardOfficialOutput()) return;
  showToast('⏳ جاري تحضير ملف PDF...');
  try {
    const png = buildMemoCanvasPNG(700);
    await ensureJsPDFLoaded(); // Lazy load: يضمن اكتمال تحميل jsPDF قبل الاستخدام
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const ratio = png.w / png.h;
    let w = pageW - 40, h = w / ratio;
    if (h > pageH - 40) { h = pageH - 40; w = h * ratio; }
    doc.addImage(png.dataUrl, 'PNG', (pageW - w) / 2, 20, w, h);
    const blob = doc.output('blob');
    const filename = 'مذكرة_' + (document.getElementById('memo_date').value || '') + '.pdf';
    await shareOrDownloadFile(blob, filename, 'application/pdf');
    showToast('✅ تم تجهيز ملف PDF (بدون أي نص زائد)');
  } catch (e) {
    showToast('❌ تعذر تجهيز الملف: ' + (e && e.message ? e.message : 'خطأ غير معروف'), 'error');
  }
}

function printMemo() {
  if (!memoGuardOfficialOutput()) return;
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
    <title></title><style>@page{margin:0}body{padding:30px;margin:0}</style>
    </head><body>${buildMemoBodyHTML()}</body></html>`;
  let frame = document.getElementById('memoPrintFrame');
  if (frame) frame.remove();
  frame = document.createElement('iframe');
  frame.id = 'memoPrintFrame';
  frame.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); }
    catch (e) { showToast('❌ تعذرت الطباعة', 'error'); }
  }, 300);
}

// يبني ملف Word حقيقي (تنسيق .docx أصلي عبر مكتبة docx) — موثوق بأي برنامج وبأي طريقة فتح
async function buildMemoDocxBlob() {
  await ensureDocxLoaded(); // Lazy load: يضمن اكتمال تحميل docx قبل الاستخدام
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, BorderStyle, WidthType } = docx;
  const number = document.getElementById('memo_number').value || '';
  const date = document.getElementById('memo_date').value || '';
  const to = document.getElementById('memo_to').value || '';
  const subject = document.getElementById('memo_subject').value || '';
  const lines = (document.getElementById('memo_body').value || '').split('\n');
  const senderTitle = document.getElementById('memo_sender_title').value || '';
  const senderName = document.getElementById('memo_sender_name').value || '';

  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
  const rtlRun = (text, opts) => new TextRun({ text, rightToLeft: true, ...opts });
  const rtlP = (children, opts) => new Paragraph({ bidirectional: true, children, ...opts });

  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [
        new TableCell({ borders: noBorders, children: [rtlP([rtlRun(to, { bold: true })], { alignment: AlignmentType.RIGHT })] }),
        new TableCell({ borders: noBorders, children: [rtlP([rtlRun(`العدد : ${number}`)], { alignment: AlignmentType.LEFT })] })
      ]}),
      new TableRow({ children: [
        new TableCell({ borders: noBorders, children: [new Paragraph({ text: '' })] }),
        new TableCell({ borders: noBorders, children: [rtlP([rtlRun(`التاريخ : ${date}`)], { alignment: AlignmentType.LEFT })] })
      ]})
    ]
  });

  const children = [headerTable, new Paragraph({ text: '' })];
  children.push(rtlP([rtlRun(`م / ${subject}`, { bold: true })], { alignment: AlignmentType.CENTER }));
  children.push(new Paragraph({ text: '' }));

  lines.forEach((line, i) => {
    children.push(rtlP([rtlRun(line)], { alignment: AlignmentType.JUSTIFIED, indent: i === 0 ? { firstLine: 280 } : undefined }));
  });

  if (memoTableData && memoTableData.length) {
    children.push(new Paragraph({ text: '' }));
    const lineBorder = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
    const fullBorders = { top: lineBorder, bottom: lineBorder, left: lineBorder, right: lineBorder };
    const tblRows = memoTableData.map(row => new TableRow({
      children: row.map(cell => new TableCell({
        borders: fullBorders,
        width: { size: 0, type: WidthType.AUTO },
        children: [rtlP([rtlRun(cell || '')], { alignment: AlignmentType.CENTER })]
      }))
    }));
    children.push(new Table({ width: { size: 0, type: WidthType.AUTO }, alignment: AlignmentType.CENTER, rows: tblRows }));
  }

  children.push(new Paragraph({ text: '' }));
  children.push(rtlP([rtlRun('مع التقدير …')], { alignment: AlignmentType.CENTER }));

  // قسم المرفقات (اختياري) — عنوان مخطوط + قائمة مرقّمة، محاذاة يمين، بدون إطار
  if (memoAttachments) {
    const validAttachments = memoAttachments.filter(a => a && a.trim());
    if (validAttachments.length) {
      children.push(new Paragraph({ text: '' }));
      children.push(rtlP([rtlRun('المرفقات :', { bold: true, underline: {} })], { alignment: AlignmentType.RIGHT }));
      validAttachments.forEach((att, i) => {
        children.push(rtlP([rtlRun(`${i+1}. ${att.trim()}`)], { alignment: AlignmentType.RIGHT }));
      });
    }
  }

  // عنوان واسم مقدم الطلب — بالنص، مسحوبين نحو الوسط (مذكرة طويلة: سطر بعد، قصيرة: 7 أسطر بعد)
  if (senderTitle || senderName) {
    for (let i = 0; i < 7; i++) children.push(new Paragraph({ text: '' }));
    if (senderTitle) children.push(rtlP([rtlRun(senderTitle)], { alignment: AlignmentType.CENTER, indent: { right: 4500 } }));
    if (senderName) children.push(rtlP([rtlRun(senderName)], { alignment: AlignmentType.CENTER, indent: { right: 4500 } }));
  }

  const doc = new Document({ sections: [{ properties: {}, children }] });
  return await Packer.toBlob(doc);
}

async function shareMemoWord() {
  if (!memoGuardOfficialOutput()) return;
  showToast('⏳ جاري تحضير ملف Word...');
  try {
    try { await ensureDocxLoaded(); } catch (e) { throw new Error('LIB_MISSING'); } // نفس سلوك الفحص القديم بالضبط، بس بمحاولة تحميل فعلية أولاً بدل الاكتفاء بالفحص
    const blob = await buildMemoDocxBlob();
    const filename = 'مذكرة_' + (document.getElementById('memo_date').value || '') + '.docx';
    await shareOrDownloadFile(blob, filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    showToast('✅ تم تجهيز ملف Word');
  } catch (e) {
    if (e && e.message === 'LIB_MISSING') {
      // فشل تحميل مكتبة Word (مشكلة اتصال بالإنترنت) — نستخدم نسخة احتياطية أبسط
      try {
        const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
          <head><meta charset="utf-8"><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
          </head><body>${buildMemoWordHTML()}</body></html>`;
        const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
        const filename = 'مذكرة_' + (document.getElementById('memo_date').value || '') + '.doc';
        await shareOrDownloadFile(blob, filename, 'application/msword');
        showToast('⚠️ تم تجهيز نسخة احتياطية (تأكد من الإنترنت لجودة أفضل بالمرة القادمة)');
      } catch (e2) {
        showToast('❌ تعذر تجهيز الملف، تأكد من اتصال الإنترنت وحاول مرة ثانية', 'error');
      }
    } else {
      showToast('❌ تعذر تجهيز الملف: ' + (e && e.message ? e.message : 'خطأ غير معروف'), 'error');
    }
  }
}
