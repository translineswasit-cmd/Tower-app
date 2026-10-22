/* official-form-export.js — v335-C5r6
   طباعة/PDF/Word لاستمارة الكشف الحراري الرسمية. تقرأ officialFormRows من official-form.js (يُحمَّل معها دائماً) وتحمّل jsPDF/docx عند الطلب.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند أول طلب فعلي؛ لا يعمل شيء منه عند بدء التطبيق ولا عند فتح قائمة الكشف الحراري.
   سكربت كلاسيكي: يشارك الربط العام (let/const/function) مع index.html. */
// يبني نسخة نصية ثابتة (بدون select/input فعلية) لتحويلها لصورة بثقة أكبر
function buildOfficialFormBodyHTML(stampSrc = STAMP_IMG_SRC) {
  const v = id => document.getElementById(id).value || '';
  const rowsHTML = officialFormRows.map(row => `
    <tr>
      <td style="border:1px solid #000;padding:6px;text-align:center">${row.tower_number??''}</td>
      <td style="border:1px solid #000;padding:6px;text-align:center">${row.distance??''}</td>
      <td style="border:1px solid #000;padding:6px;text-align:center">${row.t??''}</td>
      <td style="border:1px solid #000;padding:6px;text-align:center">${row.s??''}</td>
      <td style="border:1px solid #000;padding:6px;text-align:center">${row.r??''}</td>
      <td style="border:1px solid #000;padding:6px;text-align:center">${row.load_mw??''}</td>
      <td style="border:1px solid #000;padding:6px;text-align:center">${row.ambient??''}</td>
      <td style="border:1px solid #000;padding:6px;text-align:center">${row.notes??''}</td>
    </tr>`).join('');
  return `
    <div id="officialFormHeaderWrap" style="position:relative;text-align:center;margin-bottom:10px">
      <img id="officialFormStampImg" src="${stampSrc}" style="position:absolute;width:140px;height:140px;left:245px;top:-86px">
      <div style="font-weight:700;font-size:15px">الإصدار: 2 &#160;|&#160; <span id="officialFormTitleSpan">استمارة: الكشف الحراري لخطوط نقل الطاقة</span> &#160;|&#160; الشركة العامة لنقل الطاقة الكهربائية</div>
      <div style="font-size:12px;color:#555;margin-top:4px">تاريخ الإصدار: 27/3/2019 &#160;|&#160; الرمز: (MOE/T2-FO-177) &#160;|&#160; المنطقة الوسطى</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px">
      <tr style="background:#f0f0f0">
        <th style="border:1px solid #000;padding:6px;width:42%">اسم الخط</th>
        <th style="border:1px solid #000;padding:6px">نوع السلك</th>
        <th style="border:1px solid #000;padding:6px">تاريخ الفحص</th>
        <th style="border:1px solid #000;padding:6px">الوقت</th>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:6px;text-align:center">${v('tf_h_line')}</td>
        <td style="border:1px solid #000;padding:6px;text-align:center">${v('tf_h_wire')}</td>
        <td style="border:1px solid #000;padding:6px;text-align:center">${v('tf_h_date')}</td>
        <td style="border:1px solid #000;padding:6px;text-align:center">${v('tf_h_time')}</td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="background:#f0f0f0">
          <th style="border:1px solid #000;padding:6px" rowspan="2">رقم برج الشد</th>
          <th style="border:1px solid #000;padding:6px" rowspan="2">مسافة الفحص</th>
          <th style="border:1px solid #000;padding:6px" colspan="3">درجة حرارة الطور</th>
          <th style="border:1px solid #000;padding:6px" rowspan="2">حمل الخط MW</th>
          <th style="border:1px solid #000;padding:6px" rowspan="2">درجة حرارة الجو</th>
          <th style="border:1px solid #000;padding:6px" rowspan="2">الملاحظات</th>
        </tr>
        <tr style="background:#f0f0f0">
          <th style="border:1px solid #000;padding:6px">T</th>
          <th style="border:1px solid #000;padding:6px">S</th>
          <th style="border:1px solid #000;padding:6px">R</th>
        </tr>
      </thead>
      <tbody>${rowsHTML || '<tr><td colspan="8" style="border:1px solid #000;padding:6px">لا توجد أبراج</td></tr>'}</tbody>
    </table>
    <div style="display:flex;justify-content:space-between;margin-top:110px;font-size:13px;color:#333">
      <div>اسم وتوقيع الفاحص: </div>
      <div style="margin-left:2cm">مصادقة رئيس القسم: </div>
    </div>
    <div style="margin-top:56px;font-size:13px;color:#333;text-align:center">لجنة الكشف الحراري: </div>
  `;
}
// طباعة مباشرة من المتصفح (DOM حقيقي بدون أي تحويل لصورة، أوثق 100%)
// يضع الختم فوق آخر حرف من "الطاقة" بعنوان الاستمارة — تُستخدم لأي مستند (doc) فيه نفس عناصر الترويسة
function placeOfficialFormStampInDoc(doc) {
  try {
    const wrap = doc.getElementById('officialFormHeaderWrap');
    const span = doc.getElementById('officialFormTitleSpan');
    const img = doc.getElementById('officialFormStampImg');
    if (!wrap || !span || !img) return;
    const wrapRect = wrap.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    if (wrapRect.width === 0) { setTimeout(() => placeOfficialFormStampInDoc(doc), 100); return; }
    const stampSize = wrapRect.height * 2; // مضاعف الحجم الأساسي
    const leftEdge = spanRect.left - wrapRect.left;
    const overflow = stampSize - wrapRect.height;
    img.style.left = (leftEdge - stampSize/2) + 'px';
    img.style.top = (-overflow) + 'px';
    img.style.width = stampSize + 'px';
    img.style.height = stampSize + 'px';
    img.style.visibility = 'visible';
    wrap.style.marginTop = overflow + 'px';
  } catch (e) { console.warn('[tower-app] فشل تموضع ختم الاستمارة (وثيقة الطباعة)', e); }
}
function printOfficialFormImpl() {
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
    <title></title><style>@page{margin:0}body{font-family:Arial,sans-serif;padding:20px;margin:0}</style>
    </head><body>${buildOfficialFormBodyHTML()}</body></html>`;
  let frame = document.getElementById('officialFormPrintFrame');
  if (frame) frame.remove();
  frame = document.createElement('iframe');
  frame.id = 'officialFormPrintFrame';
  frame.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  placeOfficialFormStampInDoc(doc);
  setTimeout(() => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (e) {
      showToast('❌ تعذرت الطباعة', 'error');
    }
  }, 300);
}
// تصدير PDF مباشر برسم النص بـ Canvas 2D — بدون أي نص زائد يضيفه نظام iOS تلقائياً عند الطباعة المباشرة
function buildOfficialFormPagePNG(widthCss, rowsForPage, pageNum, totalPages) {
  const v = id => (document.getElementById(id).value || '');
  const sidePad = 26, scale = 5;
  const mctx = document.createElement('canvas').getContext('2d');
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
  const hasStamp = pageNum === 1 && stampImgReady;
  const lh = 18;
  // مضاعفة حجم الختم فقط: نحسب الحجم الأساسي (المساحة بين أعلى الصفحة والخط الفاصل) ثم نضاعفه،
  // ونزيح بداية الترويسة كاملة للأسفل بما يكفي حتى يبقى الختم داخل الصفحة وحافته السفلى ملاصقة للخط الفاصل
  const stampTopY = 6;
  const stampBottomGap = 3;
  const baseDividerY = 24 + lh + lh*0.9;
  const baseStampD = baseDividerY - stampBottomGap - stampTopY;
  const stampD = hasStamp ? baseStampD * 2 : 0;
  const extraShift = hasStamp ? Math.max(0, (stampTopY + stampD + stampBottomGap) - baseDividerY) : 0;
  let y = 24 + extraShift;

  // ترويسة بثلاث مناطق: يمين (الإصدار/تاريخه) | وسط (عنوان الاستمارة/الرمز) | يسار (الشركة/المنطقة) —
  // كل سطرين بمنطقتهم يتوسطان فوق بعض بشكل مستقل (مو بداية واحدة)
  const colW = (widthCss - sidePad*2) / 3;
  const rightCx = widthCss - sidePad - colW/2;
  const centerCx = widthCss/2;
  const leftCx = sidePad + colW/2;
  const rightEdgeX = widthCss - sidePad; // نقطة بداية واحدة من اليمين للإصدار وتاريخه

  // الختم: حجمه مضاعف، حافته السفلى ملاصقة للخط الأسود الفاصل فوق الجدول الأول، وأفقياً فوق آخر حرف من "الطاقة"
  if (hasStamp) {
    mctx.font = 'bold 12px Tahoma, Arial';
    const titleText = 'استمارة : الكشف الحراري لخطوط نقل الطاقة';
    const titleWidth = mctx.measureText(titleText).width;
    const titleLeftEdgeX = centerCx - titleWidth/2;
    ops.push({ type:'image', img: stampImgEl, x: titleLeftEdgeX - stampD/2, y: stampTopY, w: stampD, h: stampD });
  }

  mctx.font = 'bold 12px Tahoma, Arial';
  ops.push({ type:'text', text: 'الإصدار: 2', x: rightEdgeX, y, font:'bold 12px Tahoma, Arial', align:'right' });
  ops.push({ type:'text', text: 'استمارة : الكشف الحراري لخطوط نقل الطاقة', x: centerCx, y, font:'bold 12px Tahoma, Arial', align:'center' });
  ops.push({ type:'text', text: 'الشركة العامة لنقل الطاقة الكهربائية', x: leftCx, y, font:'bold 12px Tahoma, Arial', align:'center' });
  y += lh;
  mctx.font = '11px Tahoma, Arial';
  ops.push({ type:'text', text: 'تاريخ الإصدار: 27/3/2019', x: rightEdgeX, y, font:'11px Tahoma, Arial', align:'right' });
  ops.push({ type:'text', text: 'الرمز : (MOE/T2-FO-177)' + (totalPages>1 ? `   —   صفحة ${pageNum} من ${totalPages}` : ''), x: centerCx, y, font:'11px Tahoma, Arial', align:'center' });
  ops.push({ type:'text', text: 'المنطقة الوسطى', x: leftCx, y, font:'11px Tahoma, Arial', align:'center' });
  y += lh*0.9;

  // خط أسود فاصل تحت الترويسة
  ops.push({ type:'rectfill', x: sidePad, y, w: widthCss - sidePad*2, h: 1.5, fill:'#000' });
  y += lh*1.2;

  // جدول معلومات الرأس: صف عناوين + صف بيانات — اسم الخط عريض بما يكفي لأطول اسم خط
  const availW = widthCss - sidePad*2;
  const lineColW = availW * 0.40, otherColW = (availW - lineColW) / 3;
  const headCols = [['اسم الخط', lineColW], ['نوع السلك', otherColW], ['تاريخ الفحص', otherColW], ['الوقت', otherColW]];
  const valCols = [v('tf_h_line'), v('tf_h_wire'), v('tf_h_date'), v('tf_h_time')];
  const cellH = 26;
  let hx = widthCss - sidePad;
  headCols.forEach(([label, w]) => {
    ops.push({ type:'rectfill', x: hx-w, y, w, h: cellH, fill:'#f0f0f0' });
    ops.push({ type:'text', text: label, x: hx-w/2, y: y+cellH/2+4, font:'bold 12px Tahoma, Arial', align:'center' });
    hx -= w;
  });
  y += cellH;
  hx = widthCss - sidePad;
  headCols.forEach(([label, w], i) => {
    ops.push({ type:'rect', x: hx-w, y, w, h: cellH });
    ops.push({ type:'text', text: valCols[i], x: hx-w/2, y: y+cellH/2+4, font:'12px Tahoma, Arial', align:'center' });
    hx -= w;
  });
  y += cellH + 28;

  // جدول قراءات الأبراج — أعمدة بعرض المحتوى، من اليمين لليسار، يشمل عمود درجة حرارة الجو
  const headers = ['رقم برج الشد', 'مسافة الفحص', 'T', 'S', 'R', 'حمل الخط MW', 'درجة حرارة الجو', 'الملاحظات'];
  const rowsData = (rowsForPage && rowsForPage.length)
    ? rowsForPage.map(r => [r.tower_number, r.distance, r.t, r.s, r.r, r.load_mw, r.ambient, r.notes].map(x => x==null?'':String(x)))
    : [['','','','','','','','']];
  mctx.font = 'bold 11px Tahoma, Arial';
  const cellPad = 14, minColW = 46, rowH = 24;
  const colWidths = headers.map((h, ci) => {
    let maxW = mctx.measureText(h).width + cellPad;
    mctx.font = '11px Tahoma, Arial';
    rowsData.forEach(row => { maxW = Math.max(maxW, mctx.measureText(row[ci]||'').width + cellPad); });
    return Math.max(maxW, minColW);
  });
  const totalColsW = colWidths.reduce((s,w)=>s+w,0);
  const scaleFactor = totalColsW < availW ? availW/totalColsW : 1;
  const finalWidths = colWidths.map(w => w*scaleFactor);

  // رأس الجدول (صف واحد — "درجة حرارة الطور" مدمجة ضمنياً عبر T/S/R المتجاورة)
  let cx = widthCss - sidePad;
  headers.forEach((h, ci) => {
    const w = finalWidths[ci]; cx -= w;
    ops.push({ type:'rectfill', x: cx, y, w, h: rowH, fill:'#f0f0f0' });
    mctx.font = 'bold 11px Tahoma, Arial';
    ops.push({ type:'text', text: h, x: cx+w/2, y: y+rowH/2+4, font:'bold 11px Tahoma, Arial', align:'center' });
  });
  y += rowH;
  // صفوف الجدول
  rowsData.forEach(row => {
    let cx2 = widthCss - sidePad;
    row.forEach((cell, ci) => {
      const w = finalWidths[ci]; cx2 -= w;
      ops.push({ type:'rect', x: cx2, y, w, h: rowH });
      ops.push({ type:'text', text: cell || '', x: cx2+w/2, y: y+rowH/2+4, font:'11px Tahoma, Arial', align:'center' });
    });
    y += rowH;
  });

  // التوقيعات — فقط بالصفحة الأخيرة: سطرين تحت الجدول (يمين/يسار)، وسطرين إضافيين لـ"لجنة الكشف الحراري"
  if (pageNum === totalPages) {
    y += lh*5;
    ops.push({ type:'text', text: 'اسم وتوقيع الفاحص: ', x: widthCss-sidePad, y, font:'12px Tahoma, Arial', align:'right' });
    ops.push({ type:'text', text: 'مصادقة رئيس القسم: ', x: sidePad + 78, y, font:'12px Tahoma, Arial', align:'left' }); // إزاحة ~2 سم لليمين عن الحافة
    y += lh*4;
    ops.push({ type:'text', text: 'لجنة الكشف الحراري: ', x: widthCss/2, y, font:'12px Tahoma, Arial', align:'center' });
  }

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
    } else if (op.type === 'rectfill') {
      ctx.fillStyle = op.fill; ctx.fillRect(op.x, op.y, op.w, op.h);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(op.x, op.y, op.w, op.h);
    } else if (op.type === 'image') {
      try { ctx.drawImage(op.img, op.x, op.y, op.w, op.h); } catch (e) { console.warn('[tower-app] فشل رسم عنصر صورة بكانفاس الاستمارة الرسمية', e); }
    } else {
      ctx.font = op.font;
      ctx.textAlign = op.align === 'right' ? 'right' : op.align === 'center' ? 'center' : 'left';
      ctx.fillStyle = '#000';
      ctx.fillText(op.text, op.x, op.y);
    }
  });
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), w: widthCss, h: totalHeight };
}
// يبني صفحة واحدة أو أكثر (23 برج كحد أقصى بكل صفحة) — يرجع مصفوفة صور PNG
function buildOfficialFormCanvasPNG(widthCss) {
  const ROWS_PER_PAGE = 23;
  const rows = (typeof officialFormRows !== 'undefined' && officialFormRows) ? officialFormRows : [];
  const chunks = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) chunks.push(rows.slice(i, i + ROWS_PER_PAGE));
  if (!chunks.length) chunks.push([]);
  return chunks.map((chunk, i) => buildOfficialFormPagePNG(widthCss, chunk, i+1, chunks.length));
}
async function exportOfficialFormPDFImpl() {
  showToast('⏳ جاري تحضير ملف PDF...');
  try {
    if (!stampImgReady) await stampImgLoadPromise;
    const pages = buildOfficialFormCanvasPNG(760);
    await ensureJsPDFLoaded(); // Lazy load: يضمن اكتمال تحميل jsPDF قبل الاستخدام
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    pages.forEach((png, i) => {
      if (i > 0) doc.addPage();
      const ratio = png.w / png.h;
      let w = pageW - 40, h = w / ratio;
      if (h > pageH - 40) { h = pageH - 40; w = h * ratio; }
      doc.addImage(png.dataUrl, 'JPEG', (pageW - w) / 2, 20, w, h);
    });
    const blob = doc.output('blob');
    const filename = 'استمارة_كشف_حراري_' + (document.getElementById('tf_h_date').value || '') + '.pdf';
    await shareOrDownloadFile(blob, filename, 'application/pdf');
    showToast('✅ تم تجهيز ملف PDF (بدون أي نص زائد)');
  } catch (e) {
    showToast('❌ تعذر تجهيز الملف: ' + (e && e.message ? e.message : 'خطأ غير معروف'), 'error');
  }
}
// ملف Word حقيقي (تنسيق .docx أصلي عبر مكتبة docx) — موثوق بأي برنامج وبأي طريقة فتح
async function buildOfficialFormDocxBlob() {
  await ensureDocxLoaded(); // Lazy load: يضمن اكتمال تحميل docx قبل الاستخدام
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, BorderStyle, WidthType, ImageRun, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType, convertInchesToTwip } = docx;
  const v = id => document.getElementById(id).value || '';
  const rtlRun = (text, opts) => new TextRun({ text, rightToLeft: true, ...opts });
  const rtlP = (children, opts) => new Paragraph({ bidirectional: true, children, ...opts });
  const lineBorder = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  const fullBorders = { top: lineBorder, bottom: lineBorder, left: lineBorder, right: lineBorder };
  const cell = (text, opts) => new TableCell({ borders: fullBorders, children: [rtlP([rtlRun(String(text ?? ''))], { alignment: AlignmentType.CENTER })], ...opts });
  const headCell = text => new TableCell({ borders: fullBorders, shading: { fill: 'F0F0F0' }, children: [rtlP([rtlRun(text, { bold: true })], { alignment: AlignmentType.CENTER })] });

  // الختم: وضع تقريبي (فوق منتصف العنوان تقريباً) — Word لا يدعم تموضع دقيق فوق كلمة محددة مثل PDF
  const stampResponse = await fetch(STAMP_IMG_SRC);
  if (!stampResponse.ok) {
    throw new Error('تعذر تحميل صورة الختم');
  }
  const stampBytes = new Uint8Array(await stampResponse.arrayBuffer());
  const stampParagraph = new Paragraph({
    children: [
      new ImageRun({
        data: stampBytes,
        transformation: { width: 140, height: 140 },
        floating: {
          horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 3300000 },
          verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 250000 },
          wrap: { type: TextWrappingType.NONE }
        }
      })
    ]
  });

  const children = [
    stampParagraph,
    rtlP([rtlRun('الإصدار: 2  |  استمارة: الكشف الحراري لخطوط نقل الطاقة  |  الشركة العامة لنقل الطاقة الكهربائية', { bold: true })], { alignment: AlignmentType.CENTER }),
    rtlP([rtlRun('تاريخ الإصدار: 27/3/2019  |  الرمز: (MOE/T2-FO-177)  |  المنطقة الوسطى')], { alignment: AlignmentType.CENTER }),
    new Paragraph({ text: '' })
  ];

  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [headCell('اسم الخط'), headCell('نوع السلك'), headCell('تاريخ الفحص'), headCell('الوقت')] }),
      new TableRow({ children: [
        new TableCell({ borders: fullBorders, width: { size: 40, type: WidthType.PERCENTAGE }, children: [rtlP([rtlRun(v('tf_h_line'))], { alignment: AlignmentType.CENTER })] }),
        cell(v('tf_h_wire')), cell(v('tf_h_date')), cell(v('tf_h_time'))
      ] })
    ]
  });
  children.push(headerTable, new Paragraph({ text: '' }), new Paragraph({ text: '' }));

  const dataHeaders = ['رقم برج الشد', 'مسافة الفحص', 'T', 'S', 'R', 'حمل الخط MW', 'درجة حرارة الجو', 'الملاحظات'];
  const tableRows = [new TableRow({ children: dataHeaders.map(headCell) })];
  if (officialFormRows.length) {
    officialFormRows.forEach(row => {
      tableRows.push(new TableRow({ children: [
        cell(row.tower_number), cell(row.distance), cell(row.t), cell(row.s), cell(row.r), cell(row.load_mw), cell(row.ambient), cell(row.notes)
      ]}));
    });
  } else {
    tableRows.push(new TableRow({ children: [new TableCell({ borders: fullBorders, columnSpan: 8, children: [rtlP([rtlRun('لا توجد أبراج')], { alignment: AlignmentType.CENTER })] })] }));
  }
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }));
  children.push(new Paragraph({ text: '' }), new Paragraph({ text: '' }), new Paragraph({ text: '' }), new Paragraph({ text: '' }));

  const footerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [
      new TableCell({ borders: { top:{style:BorderStyle.NONE,size:0,color:'FFFFFF'}, bottom:{style:BorderStyle.NONE,size:0,color:'FFFFFF'}, left:{style:BorderStyle.NONE,size:0,color:'FFFFFF'}, right:{style:BorderStyle.NONE,size:0,color:'FFFFFF'} }, children: [rtlP([rtlRun('اسم وتوقيع الفاحص: ')], { alignment: AlignmentType.RIGHT })] }),
      new TableCell({ borders: { top:{style:BorderStyle.NONE,size:0,color:'FFFFFF'}, bottom:{style:BorderStyle.NONE,size:0,color:'FFFFFF'}, left:{style:BorderStyle.NONE,size:0,color:'FFFFFF'}, right:{style:BorderStyle.NONE,size:0,color:'FFFFFF'} }, children: [rtlP([rtlRun('مصادقة رئيس القسم: ')], { alignment: AlignmentType.LEFT, indent: { left: 1134 } })] })
    ]})]
  });
  children.push(footerTable, new Paragraph({ text: '' }), new Paragraph({ text: '' }), new Paragraph({ text: '' }), new Paragraph({ text: '' }));
  children.push(rtlP([rtlRun('لجنة الكشف الحراري: ')], { alignment: AlignmentType.CENTER }));

  const doc = new Document({ sections: [{ properties: {}, children }] });
  return await Packer.toBlob(doc);
}
async function shareOfficialFormWordImpl() {
  showToast('⏳ جاري تحضير ملف Word...');
  try {
    try { await ensureDocxLoaded(); } catch (e) { throw new Error('LIB_MISSING'); } // نفس سلوك الفحص القديم بالضبط، بس بمحاولة تحميل فعلية أولاً بدل الاكتفاء بالفحص
    const blob = await buildOfficialFormDocxBlob();
    const filename = 'استمارة_الكشف_الحراري_' + (document.getElementById('tf_h_date').value || '') + '.docx';
    await shareOrDownloadFile(blob, filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    showToast('✅ تم تجهيز ملف Word');
  } catch (e) {
    if (e && e.message === 'LIB_MISSING') {
      try {
        // الملف الناتج هنا مستقل تماماً (يُحمَّل كملف .doc خارج الموقع) — المسار النسبي ./stamp.png
        // لن يُحل بعد فتح الملف خارج المتصفح، فنجلب الصورة الآن ونحوّلها لـData URL مضمَّنة بالملف نفسه
        const stampResponse = await fetch(STAMP_IMG_SRC);
        if (!stampResponse.ok) {
          throw new Error('تعذر تحميل صورة الختم');
        }
        const stampBlob = await stampResponse.blob();
        const stampDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('تعذر قراءة صورة الختم'));
          reader.readAsDataURL(stampBlob);
        });
        const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
          <head><meta charset="utf-8"><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
          <style>body{font-family:Arial,sans-serif;direction:rtl}</style></head>
          <body>${buildOfficialFormBodyHTML(stampDataUrl)}</body></html>`;
        const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
        const filename = 'استمارة_الكشف_الحراري_' + (document.getElementById('tf_h_date').value || '') + '.doc';
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
(window.__thermalModules = window.__thermalModules || {}).officialExport = true;
