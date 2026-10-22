/* thermal-archive-print.js — v335-C5r6
   طباعة/PDF أرشيف الكشف الحراري الخام. تعتمد على isHotRecord/fmtTemp/filteredThermal من thermal-archive.js (يُحمَّل معها دائماً).
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند أول طلب فعلي؛ لا يعمل شيء منه عند بدء التطبيق ولا عند فتح قائمة الكشف الحراري.
   سكربت كلاسيكي: يشارك الربط العام (let/const/function) مع index.html. */
async function printThermalArchiveImpl() {
  if (!filteredThermal || !filteredThermal.length) { showToast('⚠️ لا توجد بيانات لطباعتها بالفلتر الحالي', 'error'); return; }
  showToast('⏳ جاري تحضير ملف PDF...');

  try {
    const byDate = {};
    filteredThermal.forEach(r => {
      byDate[r.inspection_date] = byDate[r.inspection_date] || {};
      byDate[r.inspection_date][r.line_name] = byDate[r.inspection_date][r.line_name] || [];
      byDate[r.inspection_date][r.line_name].push(r);
    });
    const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a));

    const columns = [
      { label: 'النقطة', pct: 22 },
      { label: 'R1', pct: 11 }, { label: 'R2', pct: 11 },
      { label: 'S1', pct: 11 }, { label: 'S2', pct: 11 },
      { label: 'T1', pct: 11 }, { label: 'T2', pct: 11 },
      { label: 'الموظف', pct: 12 }
    ];

    let allPages = [];
    dates.forEach(date => {
      const lines = Object.keys(byDate[date]).sort((a,b) => a.localeCompare(b,'ar'));
      lines.forEach(line => {
        const rows = byDate[date][line].slice().sort((a,b) => (a.tower_number||0) - (b.tower_number||0));
        const ambient = rows[0].ambient_temp ?? '—';
        const title = `🌡️ ${line} — ${date} (حرارة الجو: ${ambient}°C)`;
        const tableRows = rows.map(r => [
          (isHotRecord(r) ? '🔴 ' : '') + (r.point_label || ''),
          fmtTemp(r, r.r1), fmtTemp(r, r.r2),
          fmtTemp(r, r.s1), fmtTemp(r, r.s2),
          fmtTemp(r, r.t1), fmtTemp(r, r.t2),
          r.created_by_name || '—'
        ]);
        allPages = allPages.concat(buildTableReportPages(title, columns, tableRows));
      });
    });

    await exportCanvasReportPDF(allPages, 'الكشف_الحراري_' + new Date().toISOString().split('T')[0] + '.pdf', 'landscape');
    showToast('✅ تم تجهيز ملف PDF');
  } catch (e) {
    console.error('Thermal PDF export error:', e);
    showToast('❌ تعذر تجهيز الملف: ' + (e && e.message ? e.message : e), 'error');
  }
}
(window.__thermalModules = window.__thermalModules || {}).archivePrint = true;
