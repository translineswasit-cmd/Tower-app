// ========================
// تقرير الفترة (ملخّص التقارير اليومية المحفوظة بين تاريخين)
// ========================
let periodSummaryData = []; // [{ line_name, activities:Set, visualDates:[], thermalEntries:[{date,towers}], outageEntries:[{date,detail}], noOutageEntries:[{date,detail}], fireDates:[] }]

function onDrpActivityAllToggle() {
  const allChecked = document.getElementById('drpActivityAll').checked;
  document.querySelectorAll('.drpActivityChk').forEach(cb => { cb.disabled = allChecked; if (allChecked) cb.checked = false; });
}
function onDrpActivityPick() {
  const anyChecked = Array.from(document.querySelectorAll('.drpActivityChk')).some(cb => cb.checked);
  document.getElementById('drpActivityAll').checked = !anyChecked;
  document.querySelectorAll('.drpActivityChk').forEach(cb => cb.disabled = !anyChecked && document.getElementById('drpActivityAll').checked);
}
// null = بدون تصفية (كل الأنواع)
function getDrpSelectedActivities() {
  if (document.getElementById('drpActivityAll').checked) return null;
  const picked = Array.from(document.querySelectorAll('.drpActivityChk:checked')).map(cb => cb.value);
  return picked.length ? picked : null;
}

async function generatePeriodSummaryReport() {
  const from = document.getElementById('drp_from').value;
  const to = document.getElementById('drp_to').value;
  if (!from || !to) { showToast('⚠️ اختر التاريخين أولاً', 'error'); return; }
  document.getElementById('drPeriodRowsWrap').innerHTML = '<div class="empty-state">⏳ جاري التجميع...</div>';
  document.getElementById('drPeriodActions').style.display = 'none';

  try {
    const days = await fetchAllPages(`daily_reports?select=report_date,rows&report_date=gte.${from}&report_date=lte.${to}&order=report_date.asc`);
    const selected = getDrpSelectedActivities(); // null = الكل

    const byLine = {};
    function ensure(name) {
      if (!byLine[name]) byLine[name] = { line_name: name, activities: new Set(), visualDates: [], thermalEntries: [], outageEntries: [], noOutageEntries: [], fireDates: [] };
      return byLine[name];
    }

    days.forEach(day => {
      const rows = Array.isArray(day.rows) ? day.rows : [];
      rows.forEach(r => {
        if (!r.line_name) return;
        const want = (key) => !selected || selected.includes(key);
        // نتحقق أول إذا هذا الصف فيه أي نشاط من المطلوب أصلاً، قبل لا ننشئ سجل للخط (حتى لا تظهر خطوط ما إلها علاقة بالفلتر)
        const hasAny = (r.visual && want('visual')) || (r.thermal && want('thermal')) ||
                       (r.sched_outage && want('maint_outage')) || (r.sched_no_outage && want('maint_no_outage')) ||
                       (r.fire_removal && want('fire'));
        if (!hasAny) return;
        const e = ensure(r.line_name);
        if (r.visual && want('visual')) { e.activities.add('visual'); e.visualDates.push(day.report_date); }
        if (r.thermal && want('thermal')) { e.activities.add('thermal'); e.thermalEntries.push({ date: day.report_date, towers: r.thermal_towers || '' }); }
        if (r.sched_outage && want('maint_outage')) { e.activities.add('maint_outage'); e.outageEntries.push({ date: day.report_date, detail: r.work_details || '' }); }
        if (r.sched_no_outage && want('maint_no_outage')) { e.activities.add('maint_no_outage'); e.noOutageEntries.push({ date: day.report_date, detail: r.work_details || '' }); }
        if (r.fire_removal && want('fire')) { e.activities.add('fire'); e.fireDates.push(day.report_date); }
      });
    });

    periodSummaryData = Object.values(byLine).sort((a,b) => a.line_name.localeCompare(b.line_name, 'ar'));
    renderPeriodSummary();
    document.getElementById('drpResultCount').textContent = `📅 عدد التقارير اليومية المشمولة: ${days.length} | عدد الخطوط المطابقة: ${periodSummaryData.length}`;
    document.getElementById('drPeriodActions').style.display = periodSummaryData.length ? 'flex' : 'none';
  } catch (e) {
    document.getElementById('drPeriodRowsWrap').innerHTML = '<div class="empty-state">❌ تعذر توليد الملخّص</div>';
  }
}

const ACTIVITY_LABELS = { visual: '🔍 كشف بصري', thermal: '🌡️ كشف حراري', maint_outage: '🔧 صيانة بإطفاء', maint_no_outage: '🔧 صيانة بدون إطفاء', fire: '🔥 إزالة مسببات حرائق' };

function renderPeriodSummary() {
  const wrap = document.getElementById('drPeriodRowsWrap');
  if (!periodSummaryData.length) { wrap.innerHTML = '<div class="empty-state">لا توجد تقارير يومية محفوظة مطابقة لهذي الفترة/النشاط المختار</div>'; return; }
  wrap.innerHTML = periodSummaryData.map(e => {
    const activityLine = [...e.activities].map(a => ACTIVITY_LABELS[a]).join(' + ') || '—';
    let html = `<div class="dep-card"><div class="dep-card-header"><div class="dep-card-title">${e.line_name}</div></div>`;
    html += `<p style="font-size:0.82rem;color:#4A5568;margin-top:6px"><b>النشاط:</b> ${activityLine}</p>`;
    if (e.visualDates.length) html += `<p style="font-size:0.8rem;margin-top:6px">🔍 كشف بصري: ${e.visualDates.length} مرة — بتاريخ ${e.visualDates.join('، ')}</p>`;
    if (e.thermalEntries.length) {
      html += `<p style="font-size:0.8rem;margin-top:6px">🌡️ كشف حراري:</p><ul style="margin:2px 0 0 0;padding-right:18px;font-size:0.78rem">`;
      e.thermalEntries.forEach(t => html += `<li>${t.date} — ${t.towers || '—'} برج</li>`);
      html += `</ul>`;
    }
    if (e.outageEntries.length) {
      html += `<p style="font-size:0.8rem;margin-top:6px">🔧 صيانة بإطفاء:</p><ul style="margin:2px 0 0 0;padding-right:18px;font-size:0.78rem">`;
      e.outageEntries.forEach(m => html += `<li>${m.date} — ${m.detail || '—'}</li>`);
      html += `</ul>`;
    }
    if (e.noOutageEntries.length) {
      html += `<p style="font-size:0.8rem;margin-top:6px">🔧 صيانة بدون إطفاء:</p><ul style="margin:2px 0 0 0;padding-right:18px;font-size:0.78rem">`;
      e.noOutageEntries.forEach(m => html += `<li>${m.date} — ${m.detail || '—'}</li>`);
      html += `</ul>`;
    }
    if (e.fireDates.length) html += `<p style="font-size:0.8rem;margin-top:6px">🔥 إزالة مسببات حرائق: بتاريخ ${e.fireDates.join('، ')}</p>`;
    html += `</div>`;
    return html;
  }).join('');
}

async function exportPeriodSummaryExcel() {
  if (!periodSummaryData.length) { showToast('⚠️ ولّد الملخّص أولاً', 'error'); return; }
  const data = periodSummaryData.map(e => ({
    'اسم الخط': e.line_name,
    'النشاط': [...e.activities].map(a => ACTIVITY_LABELS[a].replace(/^\S+\s/, '')).join(' + '),
    'عدد أيام الكشف البصري': e.visualDates.length,
    'تواريخ الكشف البصري': e.visualDates.join('، '),
    'كشف حراري (تاريخ — عدد الأبراج)': e.thermalEntries.map(t => `${t.date}: ${t.towers||'-'}`).join(' | '),
    'صيانة بإطفاء (تاريخ — التفاصيل)': e.outageEntries.map(m => `${m.date}: ${m.detail||'-'}`).join(' | '),
    'صيانة بدون إطفاء (تاريخ — التفاصيل)': e.noOutageEntries.map(m => `${m.date}: ${m.detail||'-'}`).join(' | '),
    'إزالة مسببات حرائق': e.fireDates.join('، ')
  }));
  await ensureXLSXLoaded(); // Lazy load: يضمن اكتمال تحميل XLSX قبل الاستخدام
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'ملخص الفترة');
  const from = document.getElementById('drp_from').value, to = document.getElementById('drp_to').value;
  XLSX.writeFile(wb, `ملخص_تقارير_${from}_الى_${to}.xlsx`);
  showToast('✅ تم تصدير Excel');
}

async function buildPeriodSummaryCardCanvas(e) {
  const CARD_W = 760, PAD = 18;
  const lines = [];
  const activityLine = [...e.activities].map(a => ACTIVITY_LABELS[a]).join(' + ') || '—';
  lines.push(`النشاط: ${activityLine}`);
  if (e.visualDates.length) lines.push(`🔍 كشف بصري: ${e.visualDates.length} مرة — بتاريخ ${e.visualDates.join('، ')}`);
  e.thermalEntries.forEach(t => lines.push(`🌡️ كشف حراري: ${t.date} — ${t.towers || '—'} برج`));
  e.outageEntries.forEach(m => lines.push(`🔧 صيانة بإطفاء: ${m.date} — ${m.detail || '—'}`));
  e.noOutageEntries.forEach(m => lines.push(`🔧 صيانة بدون إطفاء: ${m.date} — ${m.detail || '—'}`));
  if (e.fireDates.length) lines.push(`🔥 إزالة مسببات حرائق: بتاريخ ${e.fireDates.join('، ')}`);

  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  mctx.font = '13px Tahoma, Arial, sans-serif';
  const wrapped = [];
  lines.forEach(line => wrapArabicText(mctx, line, CARD_W - PAD*2).forEach(l => wrapped.push(l)));

  const headerH = 36;
  const bodyH = wrapped.length * 18 + 10;
  const totalH = headerH + bodyH + PAD;
  const scale = 1.3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(CARD_W * scale);
  canvas.height = Math.ceil(totalH * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CARD_W, totalH);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';

  let y = PAD + 10;
  ctx.fillStyle = '#1A2A46';
  ctx.font = 'bold 14px Tahoma, Arial, sans-serif';
  ctx.fillText(`الخط: ${e.line_name}`, CARD_W - PAD, y);
  y += 16;
  ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(CARD_W - PAD, y); ctx.stroke();
  y += 18;

  ctx.font = '13px Tahoma, Arial, sans-serif';
  ctx.fillStyle = '#3C3C3C';
  wrapped.forEach(line => { ctx.fillText(line, CARD_W - PAD, y); y += 18; });

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.5), w: CARD_W, h: totalH };
}

async function exportPeriodSummaryPDF() {
  if (!periodSummaryData.length) { showToast('⚠️ ولّد الملخّص أولاً', 'error'); return; }
  showToast('⏳ جاري تحضير التقرير...');
  try {
    await ensureJsPDFLoaded(); // Lazy load: يضمن اكتمال تحميل jsPDF قبل الاستخدام
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 30, marginTop = 50, marginBottom = 26;
    let y = marginTop;
    const from = document.getElementById('drp_from').value, to = document.getElementById('drp_to').value;

    doc.setFontSize(13); doc.setTextColor(0,0,0);
    doc.text('Period Summary Report', pageW/2, 26, { align: 'center' });
    doc.setFontSize(9);
    doc.text(`${from} - ${to}`, pageW/2, 38, { align: 'center' });

    for (const e of periodSummaryData) {
      const card = await buildPeriodSummaryCardCanvas(e);
      const drawW = pageW - marginX*2;
      const drawH = card.h * (drawW / card.w);
      // لا نقفز لصفحة جديدة إلا لو فيه محتوى مرسوم أصلاً بالصفحة الحالية (يمنع صفحة أولى فارغة)
      if (y > marginTop && y + drawH > pageH - marginBottom) { doc.addPage(); y = marginTop; }
      doc.addImage(card.dataUrl, 'JPEG', marginX, y, drawW, drawH);
      y += drawH + 8;
    }

    const blob = doc.output('blob');
    await shareOrDownloadFile(blob, `ملخص_تقارير_${from}_الى_${to}.pdf`, 'application/pdf');
    showToast('✅ تم تجهيز التقرير');
  } catch (err) {
    console.error(err);
    showToast('❌ تعذر تجهيز التقرير', 'error');
  }
}
