/* departures-export.js — v335-C5r8
   تصدير المغادرات الحالية المفتوحة (PDF): نافذة اختيار التصنيف/الخطوط/الأبراج.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
(function mount_depExportModalBg() {
  if (document.getElementById('depExportModalBg')) return;
  const html = `
<div class="treat-modal-bg" id="depExportModalBg">
  <div class="treat-modal" style="max-height:90vh;overflow-y:auto">
    <h3>📄 تصدير المغادرات (PDF)</h3>

    <!-- اختيار الخطوط -->
    <div style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <label style="font-weight:700;font-size:0.88rem">الخطوط</label>
        <button class="btn btn-secondary btn-sm" onclick="toggleDepExportSelectAll()" id="depExportSelectAllBtn">تحديد الكل</button>
      </div>
      <div id="depExportLinesWrap" style="max-height:130px;overflow-y:auto;border:1.5px solid #E2E8F0;border-radius:8px;padding:8px"></div>
    </div>

    <!-- اختيار التصنيفات -->
    <div style="margin-top:12px">
      <label style="font-weight:700;font-size:0.88rem">التصنيفات</label>
      <p style="font-size:0.74rem;color:#a0aec0;margin:2px 0 6px">يصدّر بس الأبراج والتفاصيل المطابقة للتصنيف المختار. الطريق والملاحظات تظهر دائماً بغض النظر عن الاختيار.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <label style="display:flex;align-items:center;gap:5px;font-size:0.85rem;background:#EBF0F5;padding:4px 10px;border-radius:14px"><input type="checkbox" id="depExportCategoryAll" checked onchange="onDepExportCategoryAllToggle()"> الكل</label>
      </div>
      <div id="depExportCatWrap" style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;padding:8px;border:1.5px solid #E2E8F0;border-radius:8px">
        <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:2px 0"><input type="checkbox" class="depExportCatChk" value="foundation" onchange="onDepExportCategoryPick()"> 🧱 قواعد</label>
        <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:2px 0"><input type="checkbox" class="depExportCatChk" value="iron" onchange="onDepExportCategoryPick()"> 🔩 حديد/ملحقات</label>
        <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:2px 0"><input type="checkbox" class="depExportCatChk" value="insulator" onchange="onDepExportCategoryPick()"> ⚡ عوازل</label>
        <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:2px 0"><input type="checkbox" class="depExportCatChk" value="wires" onchange="onDepExportCategoryPick()"> 〰️ أسلاك</label>
        <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:2px 0"><input type="checkbox" class="depExportCatChk" value="ground" onchange="onDepExportCategoryPick()"> 🌍 أرضي</label>
        <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:2px 0"><input type="checkbox" class="depExportCatChk" value="fire" onchange="onDepExportCategoryPick()"> 🔥 حرائق</label>
      </div>
    </div>

    <!-- نطاق الأبراج -->
    <div style="margin-top:12px;padding:10px;background:#F7FAFC;border-radius:8px">
      <div style="font-weight:700;font-size:0.85rem;margin-bottom:8px">نطاق الأبراج (اختياري)</div>
      <div style="display:flex;gap:8px;align-items:center">
        <div style="flex:1">
          <label style="font-size:0.75rem;color:#718096">من برج</label>
          <input id="depExportTowerFrom" type="number" min="1" placeholder="مثال: 1" style="width:100%;padding:6px;border:1.5px solid #CBD5E0;border-radius:6px;font-size:0.85rem;text-align:center" oninput="updateDepExportTowerList()">
        </div>
        <div style="flex:1">
          <label style="font-size:0.75rem;color:#718096">إلى برج</label>
          <input id="depExportTowerTo" type="number" min="1" placeholder="مثال: 50" style="width:100%;padding:6px;border:1.5px solid #CBD5E0;border-radius:6px;font-size:0.85rem;text-align:center" oninput="updateDepExportTowerList()">
        </div>
        <button class="btn btn-secondary btn-sm" style="margin-top:14px" onclick="document.getElementById('depExportTowerFrom').value='';document.getElementById('depExportTowerTo').value='';updateDepExportTowerList()">مسح</button>
      </div>
    </div>

    <!-- اختيار أبراج فردية -->
    <div style="margin-top:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <label style="font-weight:700;font-size:0.85rem">الأبراج المحددة</label>
        <button class="btn btn-secondary btn-sm" onclick="toggleDepExportTowerSelectAll()">تحديد الكل</button>
      </div>
      <div id="depExportTowersWrap" style="max-height:160px;overflow-y:auto;border:1.5px solid #E2E8F0;border-radius:8px;padding:8px;display:grid;grid-template-columns:repeat(3,1fr);gap:4px"></div>
    </div>

    <p id="depExportResultCount" style="margin-top:10px;color:#718096;font-size:0.82rem;text-align:center"></p>

    <div class="form-actions" style="margin-top:14px;flex-direction:column;gap:8px">
      <button class="btn btn-primary" style="width:100%;background:#922b21" onclick="exportOpenDeparturesPDF()">📄 تصدير PDF</button>
      <button class="btn btn-secondary" onclick="closeDepExportModal()" style="width:100%">إغلاق</button>
    </div>
  </div>
</div>
`;
  const anchor = document.getElementById('printLinesModalBg');
  if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else document.body.insertAdjacentHTML('beforeend', html);
})();

// ========================
// تصدير PDF — المغادرات الحالية المفتوحة (بفلترة اسم الخط)
// ========================
function onDepExportCategoryAllToggle() {
  const allChecked = document.getElementById('depExportCategoryAll').checked;
  document.querySelectorAll('.depExportCatChk').forEach(cb => { cb.disabled = allChecked; if (allChecked) cb.checked = false; });
}

function onDepExportCategoryPick() {
  const anyChecked = Array.from(document.querySelectorAll('.depExportCatChk')).some(cb => cb.checked);
  document.getElementById('depExportCategoryAll').checked = !anyChecked;
}

// null = بدون تصفية (كل التصنيفات)
function getDepExportSelectedCategories() {
  if (document.getElementById('depExportCategoryAll').checked) return null;
  const picked = Array.from(document.querySelectorAll('.depExportCatChk:checked')).map(cb => cb.value);
  return picked.length ? picked : null;
}

async function openDepExportModalImpl() {
  const wrap = document.getElementById('depExportLinesWrap');
  document.getElementById('depExportSelectAllBtn').textContent = 'تحديد الكل';
  document.getElementById('depExportTowerFrom').value = '';
  document.getElementById('depExportTowerTo').value = '';
  document.getElementById('depExportCategoryAll').checked = true;
  document.querySelectorAll('.depExportCatChk').forEach(cb => { cb.checked = false; cb.disabled = true; });
  document.getElementById('depExportModalBg').classList.add('show');

  // نتأكد بيانات المغادرات فعلاً اكتملت قبل ما نقرر "ما فيه مغادرات" — بدون هذا الانتظار، فتح
  // نافذة التصدير بسرعة (خصوصاً بنت ضعيف، قبل ما تكتمل المرحلة الثانية من تحميل المغادرات) كان
  // يعرض "لا توجد مغادرات" بشكل خاطئ تماماً، فقط لأن البيانات الحقيقية لسا ما وصلت
  wrap.innerHTML = '<div class="empty-state">⏳ جاري تحميل بيانات المغادرات...</div>';
  try { await Promise.all([loadFullRecordsCache(), loadTreatments()]); } catch(e) { console.warn('[tower-app] فشل تحديث بيانات المغادرات قبل التصدير', e); }

  const uniqueLines = [...new Set(fullRecordsCache.map(r => r.line_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar'));
  const linesWithOpenDeps = uniqueLines.filter(name => getActiveDepartureTowers(name).length > 0);
  if (!linesWithOpenDeps.length) {
    wrap.innerHTML = '<div class="empty-state">✅ لا توجد مغادرات مفتوحة</div>';
  } else {
    wrap.innerHTML = linesWithOpenDeps.map(name => `
      <label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:0.82rem;border-bottom:1px solid #F0F2F5">
        <input type="checkbox" class="depExportLineChk" value="${name.replace(/"/g,'&quot;')}" onchange="updateDepExportTowerList()">
        <span>${name}</span>
      </label>`).join('');
  }
  updateDepExportTowerList();
}

function closeDepExportModal() {
  document.getElementById('depExportModalBg').classList.remove('show');
}

function toggleDepExportSelectAll() {
  const boxes = document.querySelectorAll('.depExportLineChk');
  const btn = document.getElementById('depExportSelectAllBtn');
  const allChecked = Array.from(boxes).every(b => b.checked);
  boxes.forEach(b => b.checked = !allChecked);
  btn.textContent = allChecked ? 'تحديد الكل' : 'إلغاء التحديد';
  updateDepExportTowerList();
}

function toggleDepExportTowerSelectAll() {
  const boxes = document.querySelectorAll('.depExportTowerChk');
  const allChecked = Array.from(boxes).every(b => b.checked);
  boxes.forEach(b => b.checked = !allChecked);
  updateDepExportResultCount();
}

function getDepExportSelectedLines() {
  // لا نرجّع كل الخطوط تلقائياً — لو ما محدد المستخدم أي خط، تبقى القائمة فاضية حتى يختار بنفسه
  return Array.from(document.querySelectorAll('.depExportLineChk:checked')).map(b => b.value);
}

function updateDepExportTowerList() {
  const lines = getDepExportSelectedLines();
  const fromRaw = document.getElementById('depExportTowerFrom').value;
  const toRaw = document.getElementById('depExportTowerTo').value;
  const hasRange = fromRaw !== '' || toRaw !== ''; // لا نعتبر أي نطاق تلقائياً إلا لو المستخدم كتب رقماً فعلياً
  const from = parseInt(fromRaw) || 0;
  const to = parseInt(toRaw) || Infinity;
  const towersWrap = document.getElementById('depExportTowersWrap');

  // جمع كل الأبراج من الخطوط المحددة
  let allTowers = [];
  lines.forEach(name => {
    getActiveDepartureTowers(name).forEach(({r}) => {
      const num = parseInt(r.tower_number);
      allTowers.push({ num, towerNum: r.tower_number, lineName: name });
    });
  });
  allTowers.sort((a,b) => a.num - b.num);

  if (!allTowers.length) {
    towersWrap.innerHTML = '<div style="font-size:0.8rem;color:#718096;grid-column:span 3">اختر خطاً أولاً</div>';
    updateDepExportResultCount();
    return;
  }

  towersWrap.innerHTML = allTowers.map(t => {
    // بدون نطاق مكتوب: لا شيء محدد تلقائياً — المستخدم يحدد يدوياً أو يكتب نطاقاً
    const inRange = hasRange && (!fromRaw || t.num >= from) && (!toRaw || t.num <= to);
    return `<label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:3px 0">
      <input type="checkbox" class="depExportTowerChk" value="${t.lineName}||${t.towerNum}" ${inRange ? 'checked' : ''}>
      <span>برج ${t.towerNum}</span>
    </label>`;
  }).join('');
  updateDepExportResultCount();
}

function updateDepExportResultCount() {
  const count = document.querySelectorAll('.depExportTowerChk:checked').length;
  document.getElementById('depExportResultCount').textContent = `📋 ${count} برج محدد للتصدير`;
}

function getDepExportSelectedTowers() {
  return Array.from(document.querySelectorAll('.depExportTowerChk:checked')).map(b => {
    const [lineName, towerNum] = b.value.split('||');
    return { lineName, towerNum };
  });
}

async function exportOpenDeparturesPDF() {
  const selectedTowers = getDepExportSelectedTowers();
  if (!selectedTowers.length) { showToast('اختر أبراجاً للتصدير أولاً', 'error'); return; }
  const categories = getDepExportSelectedCategories(); // null = كل التصنيفات

  // تجميع الأبراج حسب الخط
  const byLine = {};
  selectedTowers.forEach(({lineName, towerNum}) => {
    if (!byLine[lineName]) byLine[lineName] = new Set();
    byLine[lineName].add(String(towerNum));
  });

  showToast(`⏳ جاري تحضير PDF لـ${selectedTowers.length} برج...`);
  // تأخير بسيط لإظهار التوست قبل بدء العملية الثقيلة
  await new Promise(r => setTimeout(r, 100));

  try {
    await ensureJsPDFLoaded(); // Lazy load: يضمن اكتمال تحميل jsPDF قبل الاستخدام
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 30;
    let first = true;
    let totalTowersExported = 0;
    const BATCH_SIZE = 10; // تصدير 10 أبراج في كل دُفعة لتفادي انهيار الذاكرة على iOS

    for (const lineName of Object.keys(byLine)) {
      const towerNums = byLine[lineName];
      const activeTowers = getActiveDepartureTowers(lineName)
        .filter(({r}) => towerNums.has(String(r.tower_number)))
        .sort((a,b) => parseInt(a.r.tower_number) - parseInt(b.r.tower_number));
      if (!activeTowers.length) continue;

      if (!first) doc.addPage();
      first = false;

      const lineHeaderImg = drawArabicTextPNG([
        { text: `🚨 خط: ${lineName} — ${activeTowers.length} برج`, fontSize: 16, fontWeight: 'bold', color: '#fff', bg: '#1a2e4a', padY: 10 }
      ], pageW - margin*2);
      let y = margin;
      if (lineHeaderImg) {
        const w = pageW - margin*2;
        const h = w * (lineHeaderImg.h / lineHeaderImg.w);
        doc.addImage(lineHeaderImg.dataUrl, 'JPEG', margin, y, w, h);
        y += h + 14;
      }

      // معالجة الأبراج بدُفعات صغيرة مع تأخير بين كل دُفعة
      for (let i = 0; i < activeTowers.length; i += BATCH_SIZE) {
        const batch = activeTowers.slice(i, i + BATCH_SIZE);
        if (i > 0) await new Promise(r => setTimeout(r, 50)); // استرخاء بين الدُفعات

        for (const { r, deps } of batch) {
          const openDepsAll = getOpenDepsOnly(r, deps);
          // نصفّي حسب التصنيف المختار — لو "الكل" ما نغيّر شي، ولو محدد نستبعد أي مغادرة لا تطابق
          const openDeps = categories
            ? openDepsAll.filter(d => categories.some(cat => (REPORT_CATEGORY_TREATMENT_PREFIXES[cat]||[]).some(p => (d.key||'').startsWith(p))))
            : openDepsAll;
          if (!openDeps.length) continue;
          totalTowersExported++;

          const otherDeps = openDeps.filter(d => d.type !== 'insulator' && d.type !== 'insulator2');
          const items = [
            { text: `🗼 برج ${r.tower_number} — ${TOWER_TYPES[r.tower_type]||r.tower_type||''} — ${r.voltage||LINE_VOLTAGE[lineName]||''} ك.ف`, fontSize: 14, fontWeight: 'bold', color: '#1a2e4a', padY: 6 },
            { text: `📅 آخر كشف: ${r.inspection_date||'—'}  |  👤 ${r.created_by_name||'—'}`, fontSize: 11, color: '#718096', padY: 2 }
          ];
          if (otherDeps.length) {
            otherDeps.forEach(d => items.push({ text: `🔴 ${d.label}`, fontSize: 12, color: '#922b21', padY: 3 }));
          } else {
            items.push({ text: '✅ لا توجد مغادرات نصية أخرى', fontSize: 12, color: '#1e8449', padY: 3 });
          }
          // حالة الطريق (منفصلة عن المغادرات بالتصميم، لكن تظهر هنا كمعلومة مهمة دائماً إن وُجدت)
          if (r.road_access) {
            const roadColor = r.road_access === 'متاح' ? '#1e8449' : '#922b21';
            let roadText = `🛣️ الطريق: ${r.road_access}`;
            if (r.road_access_notes && r.road_access_notes.trim()) roadText += ` — ${r.road_access_notes.trim()}`;
            items.push({ text: roadText, fontSize: 11, color: roadColor, padY: 3 });
          }
          // الملاحظات العامة المسجّلة بآخر الكشف
          if (r.notes && r.notes.trim()) {
            items.push({ text: `📝 ملاحظات: ${r.notes.trim()}`, fontSize: 11, color: '#555', padY: 3 });
          }
          const towerImg = drawArabicTextPNG(items, pageW - margin*2, { border: true });

          const hasOpenInsulatorDep = openDeps.some(d => d.type === 'insulator' || d.type === 'insulator2');
          let insImg = null;
          if (hasOpenInsulatorDep && r.insulator_state) {
            insImg = buildInsulatorExportPNG(r.insulator_state, r.voltage, r.tower_type, r.line_name, r.insulator_cycle, r.insulator_state_2, r.insulator_cycle_2, r.tower_number, r.insulator_chain_types, r.insulator_chain_types_2);
          }

          // حساب الارتفاع الكلي للكتلة (تفاصيل المغادرات + صورة العوازل معاً)
          const usableW = pageW - margin*2;
          const maxContentH = pageH - margin*2; // أقصى ارتفاع ممكن أصلاً بصفحة فاضية تماماً
          let towerH = 0, insH = 0;
          if (towerImg) towerH = usableW * (towerImg.h / towerImg.w);
          if (insImg) insH = usableW * (insImg.h / insImg.w);
          let blockH = towerH + (towerImg ? 8 : 0) + insH + (insImg ? 6 : 0) + 10;
          let drawW = usableW;

          // لو الكتلة كاملة أطول من صفحة فاضية بالكامل (يصير مع الأبراج مزدوجة الدائرة الملأى بمغادرات)،
          // نصغّرها تناسبياً بالعرض والارتفاع معاً لضمان ظهورها كاملة بصفحة واحدة بدل ما تُقطع فعلياً بحافة الورقة
          if (blockH > maxContentH) {
            const shrink = maxContentH / blockH;
            towerH *= shrink; insH *= shrink; drawW *= shrink; blockH = maxContentH;
          }

          // ننتقل لصفحة جديدة فقط لو فيه محتوى مرسوم أصلاً بالصفحة الحالية (y > margin)
          // — سابقاً كان يقسم صفحة جديدة حتى لو الصفحة فاضية تماماً (غير الترويسة)، فتطلع صفحة أولى فارغة بالكامل
          if (y > margin && y + blockH > pageH - margin) { doc.addPage(); y = margin; }

          const drawX = margin + (usableW - drawW) / 2; // توسيط أفقي لو انصغرت الكتلة

          if (towerImg) {
            doc.addImage(towerImg.dataUrl, 'JPEG', drawX, y, drawW, towerH);
            y += towerH + 8;
          }
          if (insImg) {
            doc.addImage(insImg.dataUrl, 'PNG', drawX, y, drawW, insH);
            y += insH + 6;
          }
          y += 10;
        }
      }
    }

    if (!totalTowersExported) { showToast('لا توجد مغادرات مفتوحة للأبراج المحددة', 'error'); return; }
    const blob = doc.output('blob');
    await shareOrDownloadFile(blob, `مغادرات_مفتوحة_${new Date().toISOString().slice(0,10)}.pdf`, 'application/pdf');
    showToast(`✅ تم تصدير PDF (${totalTowersExported} برج)`);
    closeDepExportModal();
  } catch (e) {
    console.error('PDF export error:', e);
    showToast('❌ تعذر تصدير PDF: ' + (e && e.message ? e.message : e), 'error');
  }
}

(window.__featModules = window.__featModules || {}).dexp = true;
