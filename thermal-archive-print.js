/* thermal-archive-print.js — v335-C5r6
   طباعة/PDF أرشيف الكشف الحراري الخام. تعتمد على isHotRecord/fmtTemp/filteredThermal من thermal-archive.js (يُحمَّل معها دائماً).
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند أول طلب فعلي؛ لا يعمل شيء منه عند بدء التطبيق ولا عند فتح قائمة الكشف الحراري.
   سكربت كلاسيكي: يشارك الربط العام (let/const/function) مع index.html. */
function thPlainTemp(v) { return (v === null || v === undefined || v === '') ? '—' : String(v); }   // N25-R23: خلايا PDF نص عادي (fmtTemp يعيد وسم HTML فكان يظهر حرفياً داخل الجدول)
async function printThermalArchiveImpl() {
  if (_thBusy) { showToast(TH_BUSY_MSG, 'error'); return; }   // N25-R23a
  const prSeq = _thLoadSeq;
  if (_thPending.length) { showToast('⛔ لم يُثبَّت البرج المحدد بعد (' + _thPending.join('، ') + ') — اعتمده صراحةً من اللوحة أعلاه قبل الطباعة؛ لم يُنشأ ملف', 'error'); return; }   // N25-R23
  if (!filteredThermal || !filteredThermal.length) { showToast('⚠️ لا توجد بيانات لطباعتها بالفلتر الحالي', 'error'); return; }
  showToast('⏳ جاري تحضير ملف PDF...');

  try {
    const groups = thermalGroups(filteredThermal);   // N25-R23: نفس صفوف العرض المثبَّتة وترتيب الخطوط (400 ثم 132) والتواريخ

    const columns = [
      { label: 'النقطة', pct: 22 },
      { label: 'R1', pct: 11 }, { label: 'R2', pct: 11 },
      { label: 'S1', pct: 11 }, { label: 'S2', pct: 11 },
      { label: 'T1', pct: 11 }, { label: 'T2', pct: 11 },
      { label: 'الموظف', pct: 12 }
    ];

    let allPages = [];
    groups.forEach(g => {
      const date = g.date;
      g.lines.forEach(({ line, rows }) => {
        const ambient = rows[0].ambient_temp ?? '—';
        const title = `🌡️ ${line} — ${date} (حرارة الجو: ${ambient}°C)`;
        const tableRows = rows.map(r => [
          (isHotRecord(r) ? '🔴 ' : '') + (r.point_label || '') + (csRowNote(r) ? ' (' + csRowNote(r) + ')' : ''),   // N25-R5
          thPlainTemp(r.r1), thPlainTemp(r.r2),
          thPlainTemp(r.s1), thPlainTemp(r.s2),
          thPlainTemp(r.t1), thPlainTemp(r.t2),
          r.created_by_name || '—'
        ]);
        allPages = allPages.concat(buildTableReportPages(title, columns, tableRows));
      });
    });

    if (_thBusy || prSeq !== _thLoadSeq) { showToast(TH_BUSY_MSG, 'error'); return; }   // بدأ تحديث أثناء التحضير: لا PDF من صفوف قد لم تعد معروضة
    await exportCanvasReportPDF(allPages, 'الكشف_الحراري_' + new Date().toISOString().split('T')[0] + '.pdf', 'landscape');
    showToast('✅ تم تجهيز ملف PDF');
  } catch (e) {
    console.error('Thermal PDF export error:', e);
    showToast('❌ تعذر تجهيز الملف: ' + (e && e.message ? e.message : e), 'error');
  }
}
(window.__thermalModules = window.__thermalModules || {}).archivePrint = true;
