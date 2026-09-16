// ========================
// WORK ORDERS (أوراق الواجب)
// ========================
let woDriversCache = [];
let woTeamMembers = [];        // مصفوفة أسماء (فريقنا)
let woSharedMembers = [];      // مصفوفة {name, department} (بالاشتراك مع)
let editingWorkOrderId = null;
let woSearchResults = [];

async function openWorkOrdersHome() {
  showToast('⏳ جاري التحميل...');
  await Promise.all([loadWoDrivers().catch(()=>{}), fetchStaffRosterFromServer().catch(()=>{})]);
  populateWoLineDropdown('wo_line');
  populateWoLineDropdown('wo_search_line', true);
  startNewWorkOrder();
}

async function loadWoDrivers() {
  const res = await sbFetch('work_order_drivers?select=*&order=sort_order.asc');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  woDriversCache = await res.json();
  const sel = document.getElementById('wo_driver_select');
  sel.innerHTML = '<option value="">-- اختر السائق --</option>' +
    woDriversCache.map(d => `<option value="${d.id}">${d.name} — ${d.car_type||''}</option>`).join('') +
    '<option value="__custom__">✏️ اسم آخر (اكتبه يدوياً)</option>';
}
function onWoDriverSelectChange() {
  const v = document.getElementById('wo_driver_select').value;
  document.getElementById('wo_driver_custom').style.display = (v === '__custom__') ? 'block' : 'none';
}
function populateWoLineDropdown(selectId, withAllOption) {
  const sel = document.getElementById(selectId);
  const names = Object.keys(LINES_DATA).sort((a,b) => a.localeCompare(b, 'ar'));
  sel.innerHTML = (withAllOption ? '<option value="">-- كل الخطوط --</option>' : '<option value="">-- اختر الخط --</option>') +
    names.map(n => `<option value="${n.replace(/"/g,'&quot;')}">${n}</option>`).join('');
}

function switchWorkOrderTab(tab) {
  document.getElementById('woTabNewBtn').classList.toggle('active', tab === 'new');
  document.getElementById('woTabArchiveBtn').classList.toggle('active', tab === 'archive');
  document.getElementById('woNewView').style.display = tab === 'new' ? '' : 'none';
  document.getElementById('woArchiveView').style.display = tab === 'archive' ? '' : 'none';
}

function startNewWorkOrder() {
  editingWorkOrderId = null;
  document.getElementById('woCancelEditBtn').style.display = 'none';
  document.getElementById('wo_date').value = new Date().toISOString().split('T')[0];
  document.getElementById('wo_line').value = '';
  document.getElementById('wo_work_type').value = '';
  document.getElementById('wo_driver_select').value = '';
  document.getElementById('wo_driver_custom').value = '';
  document.getElementById('wo_driver_custom').style.display = 'none';
  woTeamMembers = [];
  woSharedMembers = [];
  renderWoTeamMembers();
  renderWoSharedMembers();
  switchWorkOrderTab('new');
}

// قائمة أسماء الاقتراح (datalist) — من كادر قسم الخطوط الموجود أصلاً بالتطبيق
function woStaffNamesDatalistHTML() {
  return (staffRosterMembersCache||[]).map(m => `<option value="${(m.name||'').replace(/"/g,'&quot;')}">`).join('');
}
function ensureWoStaffDatalist() {
  if (document.getElementById('woStaffNamesList')) return;
  const dl = document.createElement('datalist');
  dl.id = 'woStaffNamesList';
  document.body.appendChild(dl);
}
function refreshWoStaffDatalist() {
  ensureWoStaffDatalist();
  document.getElementById('woStaffNamesList').innerHTML = woStaffNamesDatalistHTML();
}

function addWoTeamMemberRow(name) {
  woTeamMembers.push(name || '');
  renderWoTeamMembers();
}
function removeWoTeamMemberRow(idx) {
  woTeamMembers.splice(idx, 1);
  renderWoTeamMembers();
}
function updateWoTeamMemberValue(idx, val) {
  woTeamMembers[idx] = val;
}
function renderWoTeamMembers() {
  refreshWoStaffDatalist();
  const wrap = document.getElementById('woTeamMembersWrap');
  wrap.innerHTML = woTeamMembers.map((name, i) => `
    <div style="display:flex;gap:6px;align-items:center">
      <input type="text" value="${(name||'').replace(/"/g,'&quot;')}" list="woStaffNamesList" placeholder="اسم الموظف"
        style="flex:1;padding:8px 10px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.85rem"
        oninput="updateWoTeamMemberValue(${i}, this.value)">
      <button class="btn-sm" style="background:#e74c3c;color:white;border:none;border-radius:6px;padding:6px 10px" onclick="removeWoTeamMemberRow(${i})">✖</button>
    </div>`).join('') || '<p style="font-size:0.78rem;color:#a0aec0">لا يوجد أفراد بعد — اضغط "➕ إضافة موظف"</p>';
}

function addWoSharedMemberRow() {
  woSharedMembers.push({ name: '', department: '' });
  renderWoSharedMembers();
}
function removeWoSharedMemberRow(idx) {
  woSharedMembers.splice(idx, 1);
  renderWoSharedMembers();
}
function updateWoSharedMemberField(idx, field, val) {
  woSharedMembers[idx][field] = val;
}
function renderWoSharedMembers() {
  const wrap = document.getElementById('woSharedMembersWrap');
  wrap.innerHTML = woSharedMembers.map((m, i) => `
    <div style="display:flex;gap:6px;align-items:center">
      <input type="text" value="${(m.name||'').replace(/"/g,'&quot;')}" placeholder="الاسم"
        style="flex:1.3;padding:8px 10px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.85rem"
        oninput="updateWoSharedMemberField(${i}, 'name', this.value)">
      <input type="text" value="${(m.department||'').replace(/"/g,'&quot;')}" placeholder="القسم"
        style="flex:1;padding:8px 10px;border:1.5px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:0.85rem"
        oninput="updateWoSharedMemberField(${i}, 'department', this.value)">
      <button class="btn-sm" style="background:#e74c3c;color:white;border:none;border-radius:6px;padding:6px 10px" onclick="removeWoSharedMemberRow(${i})">✖</button>
    </div>`).join('') || '<p style="font-size:0.78rem;color:#a0aec0">لا يوجد أفراد بالاشتراك بعد</p>';
}

function getWoDriverInfo() {
  const sel = document.getElementById('wo_driver_select');
  if (sel.value === '__custom__') {
    return { name: document.getElementById('wo_driver_custom').value.trim(), car: '' };
  }
  const d = woDriversCache.find(x => String(x.id) === sel.value);
  return d ? { name: d.name, car: d.car_type||'' } : { name: '', car: '' };
}

async function saveWorkOrder() {
  const date = document.getElementById('wo_date').value;
  const line = document.getElementById('wo_line').value;
  const workType = document.getElementById('wo_work_type').value;
  const driver = getWoDriverInfo();
  if (!date) { showToast('⚠️ اختر التاريخ', 'error'); return; }
  if (!line) { showToast('⚠️ اختر اسم الخط', 'error'); return; }
  if (!driver.name) { showToast('⚠️ اختر أو اكتب اسم السائق', 'error'); return; }
  const team = woTeamMembers.map(n => (n||'').trim()).filter(Boolean);
  const shared = woSharedMembers.map(m => ({ name: (m.name||'').trim(), department: (m.department||'').trim() })).filter(m => m.name);
  if (!team.length && !shared.length) { showToast('⚠️ أضف فرد واحد على الأقل بالطاقم', 'error'); return; }

  const payload = {
    work_date: date, line_name: line, work_type: workType,
    driver_name: driver.name, driver_car: driver.car,
    team_members: team, shared_members: shared,
    created_by: currentUser.full_name || currentUser.username
  };

  try {
    let res;
    if (editingWorkOrderId) {
      res = await sbFetch(`work_orders?id=eq.${editingWorkOrderId}`, { method: 'PATCH', body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }) });
    } else {
      payload.client_uuid = genUUID();
      res = await sbFetch('work_orders?on_conflict=client_uuid', { method: 'POST', headers: { 'Prefer': 'resolution=ignore-duplicates' }, body: JSON.stringify(payload) });
    }
    if (!res.ok) {
      let detail = '';
      try { const errBody = await res.json(); detail = errBody && (errBody.message || errBody.hint || errBody.code) ? ` — ${errBody.message || errBody.hint || errBody.code}` : ''; } catch(e) {}
      throw new Error(`HTTP ${res.status}${detail}`);
    }
    showToast(editingWorkOrderId ? '✅ تم تحديث ورقة الواجب' : '✅ تم حفظ ورقة الواجب');
    startNewWorkOrder();
  } catch (e) {
    // نعرض السبب الحقيقي (رمز HTTP وتفاصيله) بدل رسالة عامة تخفي المشكلة — يساعد بتشخيص فوري
    console.warn('[tower-app] فشل حفظ ورقة الواجب:', e);
    showToast('❌ تعذر الحفظ: ' + (e && e.message ? e.message : 'خطأ غير معروف'), 'error');
  }
}

async function editWorkOrder(id) {
  const wo = woSearchResults.find(w => w.id === id);
  if (!wo) return;
  editingWorkOrderId = id;
  switchWorkOrderTab('new');
  document.getElementById('woCancelEditBtn').style.display = '';
  document.getElementById('wo_date').value = wo.work_date || '';
  document.getElementById('wo_line').value = wo.line_name || '';
  document.getElementById('wo_work_type').value = wo.work_type || '';
  // نحاول نلقى السائق بالقائمة، وإلا نحطه بخانة "اسم آخر"
  const matchDriver = woDriversCache.find(d => d.name === wo.driver_name);
  if (matchDriver) {
    document.getElementById('wo_driver_select').value = String(matchDriver.id);
    document.getElementById('wo_driver_custom').style.display = 'none';
  } else {
    document.getElementById('wo_driver_select').value = '__custom__';
    document.getElementById('wo_driver_custom').style.display = 'block';
    document.getElementById('wo_driver_custom').value = wo.driver_name || '';
  }
  woTeamMembers = Array.isArray(wo.team_members) ? [...wo.team_members] : [];
  woSharedMembers = Array.isArray(wo.shared_members) ? wo.shared_members.map(m => ({...m})) : [];
  renderWoTeamMembers();
  renderWoSharedMembers();
  showToast('✏️ عدّل الورقة واضغط "حفظ ورقة الواجب"');
}

async function deleteWorkOrder(id) {
  if (!confirm('🗑️ تأكيد حذف ورقة الواجب هذي؟ هذا الإجراء لا يمكن التراجع عنه.')) return;
  try {
    const res = await sbFetch(`work_orders?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    woSearchResults = woSearchResults.filter(w => w.id !== id);
    renderWoSearchResults();
    showToast('🗑️ تم الحذف');
  } catch (e) { showToast('❌ تعذر الحذف', 'error'); }
}

async function searchWorkOrders() {
  const from = document.getElementById('wo_search_from').value;
  const to = document.getElementById('wo_search_to').value;
  const line = document.getElementById('wo_search_line').value;
  const driverText = document.getElementById('wo_search_driver').value.trim();
  const memberText = document.getElementById('wo_search_member').value.trim();
  document.getElementById('woSearchResultsWrap').innerHTML = '<div class="empty-state">⏳ جاري البحث...</div>';
  document.getElementById('woArchiveActions').style.display = 'none';
  try {
    let query = 'work_orders?select=*&order=work_date.desc';
    if (from) query += `&work_date=gte.${from}`;
    if (to) query += `&work_date=lte.${to}`;
    if (line) query += `&line_name=eq.${encodeURIComponent(line)}`;
    if (driverText) query += `&driver_name=ilike.*${encodeURIComponent(driverText)}*`;
    let rows = await fetchAllPages(query);
    // فلترة اسم الموظف تصير محلياً (يبحث بقائمتي الطاقم والمشتركين مع بعض، ما تدعمها PostgREST مباشرة بسهولة على jsonb)
    if (memberText) {
      const needle = memberText.trim();
      rows = rows.filter(w =>
        (Array.isArray(w.team_members) && w.team_members.some(n => (n||'').includes(needle))) ||
        (Array.isArray(w.shared_members) && w.shared_members.some(m => (m.name||'').includes(needle)))
      );
    }
    woSearchResults = rows;
    document.getElementById('woSearchResultCount').textContent = `📋 عدد أوراق الواجب المطابقة: ${rows.length}`;
    renderWoSearchResults();
    document.getElementById('woArchiveActions').style.display = rows.length ? 'block' : 'none';
  } catch (e) {
    document.getElementById('woSearchResultsWrap').innerHTML = '<div class="empty-state">❌ تعذر البحث، تحقق من الاتصال</div>';
  }
}

function renderWoSearchResults() {
  const wrap = document.getElementById('woSearchResultsWrap');
  if (!woSearchResults.length) { wrap.innerHTML = '<div class="empty-state">لا توجد نتائج مطابقة</div>'; return; }
  wrap.innerHTML = woSearchResults.map(wo => {
    const allMembers = [
      ...(Array.isArray(wo.team_members) ? wo.team_members : []),
      ...(Array.isArray(wo.shared_members) ? wo.shared_members.map(m => `${m.name} (${m.department})`) : [])
    ];
    return `<div class="dep-card">
      <div class="dep-card-header">
        <div class="dep-card-title">📅 ${wo.work_date} — ${wo.line_name||'-'}</div>
        <div class="dep-card-meta">${wo.work_type ? '🔧 '+wo.work_type : ''}</div>
      </div>
      <p style="font-size:0.82rem;margin-top:6px">🚗 السائق: ${wo.driver_name||'-'} ${wo.driver_car ? '('+wo.driver_car+')' : ''}</p>
      <p style="font-size:0.8rem;margin-top:4px;color:#4A5568">👷 الأفراد (${allMembers.length}): ${allMembers.join('، ')}</p>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-secondary btn-sm" onclick="editWorkOrder('${wo.id}')">✏️ تعديل</button>
        <button class="btn btn-sm" style="background:#e74c3c;color:white;border:none" onclick="deleteWorkOrder('${wo.id}')">🗑️ حذف</button>
      </div>
    </div>`;
  }).join('');
}

// يبني صفحة PDF كاملة لورقة واجب واحدة — السائق أعلى يمين، الخط+نوع العمل تحته، التاريخ يسار،
// وجدول بكل الأفراد (فريقنا + المشتركين معهم بقسمهم) أسفل الصفحة
// يبني صفحة/صفحات PDF لورقة واجب واحدة — يرجّع مصفوفة (عادة صفحة وحدة، أكثر لو عدد الأفراد كبير
// ولا يسع بصفحة وحدة). بدون هذا التقسيم، ورقة فيها عدد أفراد كبير كانت تخاطر بانضغاط أو انقطاع
// صفوف الجدول بصمت لو تجاوزت ارتفاع الصفحة — نفس فئة الخلل اللي صلّحناه سابقاً بصور العوازل.
// يبني بطاقة/بطاقات لورقة واجب واحدة بارتفاعها الطبيعي فقط (بدون حشو لصفحة كاملة) — هذا يسمح
// لعدة أوراق قصيرة تتجمّع بنفس صفحة الطباعة لو المساحة تسع (بدل ما توزَّع كل ورقة بصفحة مستقلة
// حتى لو فيها ٤ أفراد بس). لو ورقة واحدة فيها عدد أفراد كبير جداً بحيث ما تسع حتى بصفحة كاملة
// لحالها (حالة نادرة)، تنقسم تلقائياً لعدة بطاقات متتالية بأمان بدون فقدان أي اسم.
async function buildWorkOrderCardsCanvases(wo, cardW, maxCardH) {
  const rows = [
    ...(Array.isArray(wo.team_members) ? wo.team_members.map(n => ({ name: n, dept: '' })) : []),
    ...(Array.isArray(wo.shared_members) ? wo.shared_members.map(m => ({ name: m.name, dept: m.department })) : [])
  ];
  const marginX = 16, rowH = 24;
  const tableW = cardW - marginX*2;
  // ترتيب الأعمدة بمحاذاة القراءة العربية: القسم أقصى اليسار، الاسم بالوسط، ت أقصى اليمين (أول عمود يمين)
  const colDept = 130, colNum = 34, colName = tableW - colNum - colDept;
  const deptX = marginX, nameX = marginX + colDept, numX = marginX + colDept + colName;
  const FULL_HEADER_H = 140, CONT_HEADER_H = 34;

  const cards = [];
  let rowIdx = 0;
  let firstChunk = true;
  while (rowIdx < rows.length || firstChunk) {
    const hdrH = firstChunk ? FULL_HEADER_H : CONT_HEADER_H;
    const availableForRows = Math.max(rowH, maxCardH - hdrH - 14);
    const maxRowsThisChunk = Math.max(1, Math.floor(availableForRows / rowH));
    const rowsThisChunk = rows.slice(rowIdx, rowIdx + maxRowsThisChunk);
    const chunkH = hdrH + Math.max(rowsThisChunk.length, 0)*rowH + (rows.length ? 14 : 40);

    const scale = 1.5;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(cardW * scale);
    canvas.height = Math.ceil(chunkH * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cardW, chunkH);
    ctx.strokeStyle = '#CBD5E0'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, cardW-1, chunkH-1);
    ctx.direction = 'rtl';

    let y = 22;
    if (firstChunk) {
      ctx.textAlign = 'center'; ctx.fillStyle = '#1A2A46'; ctx.font = 'bold 16px Tahoma, Arial, sans-serif';
      ctx.fillText('ورقة واجب', cardW/2, y); y += 22;
      ctx.strokeStyle = '#2D3748'; ctx.beginPath(); ctx.moveTo(marginX, y); ctx.lineTo(cardW - marginX, y); ctx.stroke(); y += 20;
      ctx.textAlign = 'right'; ctx.font = 'bold 13px Tahoma, Arial, sans-serif'; ctx.fillStyle = '#1A2A46';
      ctx.fillText(`🚗 السائق: ${wo.driver_name||'-'}${wo.driver_car ? ' ('+wo.driver_car+')' : ''}`, cardW - marginX, y);
      ctx.textAlign = 'left';
      ctx.fillText(`📅 ${wo.work_date||'-'}`, marginX, y);
      y += 20;
      ctx.textAlign = 'right'; ctx.font = '12px Tahoma, Arial, sans-serif'; ctx.fillStyle = '#2D3748';
      ctx.fillText(`⚡ الخط: ${wo.line_name||'-'}${wo.work_type ? '   |   🔧 نوع العمل: '+wo.work_type : ''}`, cardW - marginX, y);
      y += 26;
    } else {
      ctx.textAlign = 'center'; ctx.fillStyle = '#1A2A46'; ctx.font = 'bold 11.5px Tahoma, Arial, sans-serif';
      ctx.fillText(`تكملة — ${wo.work_date||'-'} — ${wo.line_name||'-'}`, cardW/2, y);
      y += 20;
    }

    ctx.fillStyle = '#EDF2F7'; ctx.fillRect(marginX, y, tableW, rowH);
    ctx.strokeStyle = '#CBD5E0'; ctx.strokeRect(marginX, y, tableW, rowH);
    ctx.fillStyle = '#2D3748'; ctx.font = 'bold 11px Tahoma, Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('ت', numX + colNum/2, y + 16);
    ctx.fillText('الاسم', nameX + colName/2, y + 16);
    ctx.fillText('القسم (إن وُجد)', deptX + colDept/2, y + 16);
    y += rowH;

    ctx.font = '11.5px Tahoma, Arial, sans-serif';
    rowsThisChunk.forEach((r, i) => {
      const idx = rowIdx + i;
      ctx.strokeStyle = '#E2E8F0';
      ctx.strokeRect(numX, y, colNum, rowH);
      ctx.strokeRect(nameX, y, colName, rowH);
      ctx.strokeRect(deptX, y, colDept, rowH);
      ctx.fillStyle = '#2D3748'; ctx.textAlign = 'center';
      ctx.fillText(String(idx+1), numX + colNum/2, y + 16);
      ctx.fillText(r.name || '-', nameX + colName/2, y + 16);
      ctx.fillText(r.dept || '—', deptX + colDept/2, y + 16);
      y += rowH;
    });

    cards.push({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), w: cardW, h: chunkH });
    rowIdx += rowsThisChunk.length;
    firstChunk = false;
    if (!rows.length) break; // ورقة بلا أفراد (حالة نادرة) — بطاقة وحدة فاضية تكفي
  }
  return cards;
}

async function exportWorkOrdersPDF() {
  if (!woSearchResults.length) { showToast('⚠️ سوّي بحث أولاً', 'error'); return; }
  showToast('⏳ جاري تحضير التقرير...');
  try {
    await ensureJsPDFLoaded(); // Lazy load: يضمن اكتمال تحميل jsPDF قبل الاستخدام
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 40, marginTop = 40, marginBottom = 40;
    const cardW = pageW - marginX*2;
    const maxCardH = pageH - marginTop - marginBottom;
    let y = marginTop;
    // نفس منطق "لا نقفز لصفحة جديدة إلا لو فيه محتوى مرسوم أصلاً بالصفحة الحالية" المُثبَت بالتقرير
    // الموحّد — يمنع صفحة أولى فارغة، ويسمح لعدة أوراق قصيرة تتجمّع بنفس الصفحة
    function ensureSpace(h) {
      if (y > marginTop && y + h > pageH - marginBottom) { doc.addPage(); y = marginTop; }
    }
    for (const wo of woSearchResults) {
      const cards = await buildWorkOrderCardsCanvases(wo, cardW, maxCardH);
      for (const card of cards) {
        ensureSpace(card.h);
        doc.addImage(card.dataUrl, 'JPEG', marginX, y, cardW, card.h);
        y += card.h + 14; // فاصل بسيط بين كل ورقة والتالية
      }
    }
    const blob = doc.output('blob');
    const from = document.getElementById('wo_search_from').value || 'الكل';
    const to = document.getElementById('wo_search_to').value || 'الكل';
    await shareOrDownloadFile(blob, `اوراق_واجب_${from}_الى_${to}.pdf`, 'application/pdf');
    showToast('✅ تم تجهيز التقرير');
  } catch (e) {
    console.error(e);
    showToast('❌ تعذر تجهيز التقرير', 'error');
  }
}
