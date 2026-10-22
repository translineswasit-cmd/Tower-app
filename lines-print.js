/* lines-print.js — v335-C5r9
   طباعة بيانات الخطوط (PDF): اختيار الخطوط وبناء صفحات التقرير. أدوات Canvas/PDF المشتركة تبقى في index.html.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
// ========================
// طباعة بيانات الخطوط — اختيار خطوط محددة بالاسم قبل الطباعة
// ========================
let _printLinesDataSnapshot = [];

function openPrintLinesModalImpl() {
  const data = getLinesInfoData();
  _printLinesDataSnapshot = data; // لقطة ثابتة تضمن تطابق data-idx حتى لو تغيّرت البيانات أثناء فتح النافذة
  const wrap = document.getElementById('printLinesWrap');
  if (!data.length) {
    wrap.innerHTML = '<div class="empty-state">لا توجد بيانات</div>';
  } else {
    wrap.innerHTML = data.map((l, i) => `
      <label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:0.82rem;border-bottom:1px solid #F0F2F5">
        <input type="checkbox" class="printLineChk" data-idx="${i}" data-voltage="${l.voltage}" checked onchange="updatePrintLinesCount()">
        <span style="flex:1">${l.name}</span>
        <span style="background:${l.voltage===400?'#c0392b':'#1a5276'};color:#fff;padding:2px 8px;border-radius:12px;font-size:11px">${l.voltage} ك.ف</span>
      </label>`).join('');
  }
  document.getElementById('printLinesSelectAllBtn').textContent = 'إلغاء التحديد';
  updatePrintLinesCount();
  document.getElementById('printLinesModalBg').classList.add('show');
}

function closePrintLinesModal() {
  document.getElementById('printLinesModalBg').classList.remove('show');
}

function updatePrintLinesCount() {
  const total = document.querySelectorAll('.printLineChk').length;
  const checked = document.querySelectorAll('.printLineChk:checked').length;
  document.getElementById('printLinesResultCount').textContent = `تم تحديد ${checked} من أصل ${total} خط`;
}

function togglePrintLinesSelectAll() {
  const boxes = document.querySelectorAll('.printLineChk');
  const btn = document.getElementById('printLinesSelectAllBtn');
  const allChecked = Array.from(boxes).every(b => b.checked);
  boxes.forEach(b => b.checked = !allChecked);
  btn.textContent = allChecked ? 'تحديد الكل' : 'إلغاء التحديد';
  updatePrintLinesCount();
}

function quickSelectPrintLines(voltage) {
  document.querySelectorAll('.printLineChk').forEach(cb => {
    cb.checked = Number(cb.dataset.voltage) === voltage;
  });
  document.getElementById('printLinesSelectAllBtn').textContent = 'تحديد الكل';
  updatePrintLinesCount();
}

// يبني صفحات تقرير "بيانات الخطوط" بنفس تصميم الكروت الحالي بالشاشة، لكن مرسومة بالكانفاس (PDF حقيقي)
function buildLinesReportPages(lines) {
  const widthCss = 760, scale = 2, sidePad = 30;
  const mctx = document.createElement('canvas').getContext('2d');
  const titleFont = 'bold 15px Tahoma, Arial';
  const labelFont = '12px Tahoma, Arial';
  const valueFont = 'bold 13px Tahoma, Arial';
  const notesFont = '12px Tahoma, Arial';
  const rowH = 20, cardPad = 14, cardGap = 12, headerH = 30;
  const pageH = widthCss * 1.414; // A4 portrait
  const topMargin = 20, bottomMargin = 20;
  const cardW = widthCss - sidePad * 2;

  function cardHeight(l) {
    const notes = l.notes && l.notes !== 'None' ? l.notes : '';
    let h = cardPad * 2 + headerH + rowH * 5; // 4 صفوف مزدوجة + صف الحالة
    if (notes) {
      mctx.font = notesFont;
      const noteLines = _reportWrapText(mctx, notes, cardW - cardPad * 2 - 16);
      h += 10 + noteLines.length * 16 + 10;
    }
    return h;
  }

  const pageGroups = [];
  let cur = [], curH = topMargin + 40;
  lines.forEach(l => {
    const h = cardHeight(l);
    if (curH + h + cardGap > pageH - bottomMargin && cur.length) { pageGroups.push(cur); cur = []; curH = topMargin; }
    cur.push(l); curH += h + cardGap;
  });
  if (cur.length) pageGroups.push(cur);

  return pageGroups.map((pageLines, pageIdx) => {
    const ops = [];
    let y = topMargin;
    if (pageIdx === 0) {
      ops.push({ type: 'text', text: '⚡ بيانات الخطوط', x: widthCss / 2, y: y + 20, font: 'bold 20px Tahoma, Arial', align: 'center' });
      y += 40;
    }
    pageLines.forEach(l => {
      const cardX = sidePad;
      const h = cardHeight(l);
      ops.push({ type: 'rect', x: cardX, y, w: cardW, h, color: '#ccc' });
      let cy = y + cardPad;

      // عنوان الخط + شارة الفولتية
      ops.push({ type: 'text', text: l.name, x: widthCss - sidePad - cardPad, y: cy + 14, font: titleFont, align: 'right' });
      const vc = l.voltage === 400 ? '#c0392b' : '#1a5276';
      const badgeText = l.voltage + ' ك.ف';
      mctx.font = 'bold 12px Tahoma, Arial';
      const badgeW = mctx.measureText(badgeText).width + 16;
      ops.push({ type: 'rectFill', x: cardX + cardPad, y: cy, w: badgeW, h: 20, color: vc });
      ops.push({ type: 'text', text: badgeText, x: cardX + cardPad + badgeW / 2, y: cy + 14, font: 'bold 12px Tahoma, Arial', align: 'center', color: '#fff' });
      cy += headerH;

      const pairs = [
        ['الطول:', (l.length || '-') + ' كم', 'عدد الأبراج:', String(l.towers || '-')],
        ['أبراج الشد:', String(l.tension_towers || '-'), 'السعة:', (l.capacity || '-') + ' MVA'],
        ['نوع السلك:', l.wire_type || '-', 'السلك الأرضي:', l.ground_wire || '-'],
        ['حدود المسؤولية:', l.responsibility || '-', 'سنة الدخول:', String(l.year || '-')]
      ];
      const midX = cardX + cardW / 2;
      pairs.forEach(([l1, v1, l2, v2]) => {
        mctx.font = labelFont;
        const l1w = mctx.measureText(l1).width, l2w = mctx.measureText(l2).width;
        ops.push({ type: 'text', text: l1, x: widthCss - sidePad - cardPad, y: cy + 13, font: labelFont, align: 'right', color: '#777' });
        ops.push({ type: 'text', text: v1, x: widthCss - sidePad - cardPad - l1w - 6, y: cy + 13, font: valueFont, align: 'right' });
        ops.push({ type: 'text', text: l2, x: midX, y: cy + 13, font: labelFont, align: 'right', color: '#777' });
        ops.push({ type: 'text', text: v2, x: midX - l2w - 6, y: cy + 13, font: valueFont, align: 'right' });
        cy += rowH;
      });

      mctx.font = labelFont;
      const statusLabelW = mctx.measureText('الحالة:').width;
      ops.push({ type: 'text', text: 'الحالة:', x: widthCss - sidePad - cardPad, y: cy + 13, font: labelFont, align: 'right', color: '#777' });
      ops.push({ type: 'text', text: l.status || '-', x: widthCss - sidePad - cardPad - statusLabelW - 6, y: cy + 13, font: valueFont, align: 'right', color: l.status === 'بالعمل' ? '#1e8449' : '#c0392b' });
      cy += rowH;

      const notes = l.notes && l.notes !== 'None' ? l.notes : '';
      if (notes) {
        mctx.font = notesFont;
        const noteLines = _reportWrapText(mctx, notes, cardW - cardPad * 2 - 16);
        const noteBoxH = 10 + noteLines.length * 16 + 10;
        ops.push({ type: 'rectFill', x: cardX + cardPad, y: cy, w: cardW - cardPad * 2, h: noteBoxH, color: '#fef9e7' });
        let ny = cy + 10 + 12;
        noteLines.forEach(nl => { ops.push({ type: 'text', text: nl, x: widthCss - sidePad - cardPad - 8, y: ny, font: notesFont, align: 'right', color: '#7d6608' }); ny += 16; });
      }

      y += h + cardGap;
    });

    const dataUrl = _renderReportCanvasPage(ops, widthCss, pageH, scale);
    return { dataUrl, w: widthCss, h: pageH };
  });
}

async function confirmPrintLinesSelection() {
  const selected = Array.from(document.querySelectorAll('.printLineChk:checked'))
    .map(cb => _printLinesDataSnapshot[Number(cb.dataset.idx)])
    .filter(Boolean);
  if (!selected.length) { showToast('⚠️ اختر خطاً واحداً على الأقل', 'error'); return; }
  closePrintLinesModal();
  showToast('⏳ جاري تحضير ملف PDF...');
  try {
    const pages = buildLinesReportPages(selected);
    await exportCanvasReportPDF(pages, 'بيانات_الخطوط_' + new Date().toISOString().split('T')[0] + '.pdf', 'portrait');
    showToast('✅ تم تجهيز ملف PDF');
  } catch (e) {
    showToast('❌ تعذر تجهيز الملف: ' + (e && e.message ? e.message : 'خطأ غير معروف'), 'error');
  }
}

// طباعة أرشيف الكشف الحراري الخام: تُحمَّل عند الطلب فقط من thermal-archive-print.js (المدخل: printThermalArchive بقسم الكشف الحراري)

(window.__featModules = window.__featModules || {}).lprt = true;
