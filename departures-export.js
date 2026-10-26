/* departures-export.js — v335-C6r10 (N01/N02: تحميل متدرّج + ملف PDF جاهز بنقرة جديدة؛ كان v335-C5r8)
   تصدير المغادرات الحالية المفتوحة (PDF): نافذة اختيار التصنيف/الخطوط/الأبراج.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
(function mount_depExportModalBg() {
  if (document.getElementById('depExportModalBg')) return;
  const html = `
<div class="treat-modal-bg" id="depExportModalBg">
  <div class="treat-modal" style="max-height:90vh;overflow-y:auto">
    <h3>📄 تصدير المغادرات (PDF)</h3>
    <fieldset id="depExportFs" style="border:0;padding:0;margin:0;min-width:0">

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
          <input id="depExportTowerFrom" type="number" min="1" placeholder="مثال: 1" style="width:100%;padding:6px;border:1.5px solid #CBD5E0;border-radius:6px;font-size:0.85rem;text-align:center" oninput="depxRenderTowers(false)">
        </div>
        <div style="flex:1">
          <label style="font-size:0.75rem;color:#718096">إلى برج</label>
          <input id="depExportTowerTo" type="number" min="1" placeholder="مثال: 50" style="width:100%;padding:6px;border:1.5px solid #CBD5E0;border-radius:6px;font-size:0.85rem;text-align:center" oninput="depxRenderTowers(false)">
        </div>
        <button class="btn btn-secondary btn-sm" style="margin-top:14px" onclick="document.getElementById('depExportTowerFrom').value='';document.getElementById('depExportTowerTo').value='';depxRenderTowers(false)">مسح</button>
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
    </fieldset>

    <!-- تقدّم التحضير (يبقى ظاهراً حتى انتهاء العملية أو فشلها) -->
    <div id="depExportStatus" role="status" aria-live="polite" style="display:none;margin-top:10px;padding:10px;border-radius:8px;background:#EBF8FF;border:1px solid #90CDF4;font-size:0.82rem;color:#2A4365">
      <div id="depExportStatusText"></div>
      <div id="depExportBarWrap" style="height:6px;background:#BEE3F8;border-radius:4px;margin-top:6px;overflow:hidden"><div id="depExportBar" style="height:100%;width:0;background:#3182CE;transition:width .2s"></div></div>
    </div>

    <!-- الملف الجاهز: رابط حقيقي يُنقر بنقرة جديدة من المستخدم (لا فتح تلقائي بعد تحضير طويل) -->
    <div id="depExportReady" style="display:none;margin-top:10px;padding:10px;border-radius:8px;background:#F0FFF4;border:1px solid #9AE6B4;font-size:0.82rem;color:#22543D">
      <div id="depExportReadyInfo" style="margin-bottom:8px"></div>
      <a id="depExportOpenLink" class="btn btn-primary" style="display:block;text-align:center;text-decoration:none;box-sizing:border-box;width:100%" target="_blank" rel="noopener" onclick="return depxReadyClick(event)">📄 فتح / تنزيل PDF</a>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-secondary btn-sm" id="depExportShareBtn" style="flex:1;display:none" onclick="depxShareReady()">📤 مشاركة</button>
        <button class="btn btn-secondary btn-sm" style="flex:1" onclick="depxDiscardReady()">🗑️ حذف الملف</button>
      </div>
    </div>

    <div class="form-actions" style="margin-top:14px;flex-direction:column;gap:8px">
      <button class="btn btn-primary" id="depExportGoBtn" style="width:100%;background:#922b21" onclick="exportOpenDeparturesPDF()">📄 تصدير PDF</button>
      <button class="btn btn-secondary" id="depExportCloseBtn" onclick="closeDepExportModal()" style="width:100%">إغلاق</button>
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

// ============================================================================================
// v335-C6r10 (N01/N02): تحميل متدرّج.
//  1) فتح النافذة: قائمة الخطوط من فهرس المغادرات الموجود (app_departure_index) فقط — لا loadFullRecordsCache ولا loadTreatments.
//  2) اختيار خط: قراءة ملخّص هذا الخط وحده (طلب واحد خفيف) لعرض أبراجه.
//  3) التصدير: تفاصيل الأبراج المحددة فقط (أجزاء صغيرة، 3 بالتوازي)، ثم توليد PDF مع تقدّم ظاهر، ثم ملف جاهز بنقرة جديدة.
// الوضع غير الحيّ (بلا مخزن حالة) يبقى بالمسار القديم كما هو.
// ============================================================================================
const _depx = { modalSeq: 0, runSeq: 0, running: false, lines: {}, ready: null, indexErr: null, q: { active: 0, wait: [] } };
const DEPX_CHUNK = 25, DEPX_CONC = 3;
function depxEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function depxScope() { return { sess: featSessionTag(), gen: _csAuthGen, modal: _depx.modalSeq, wgen: _csWriteGen }; }
function depxScopeOk(sc) { return !!sc && sc.sess === featSessionTag() && sc.gen === _csAuthGen && sc.modal === _depx.modalSeq; }
// تشغيل التصدير: يضاف إليه جيل الكتابة؛ أي كتابة/مزامنة محلية أثناء التحضير تُبطل التشغيل (لا تقرير يمزج حالتين)
function depxRunOk(sc) { return depxScopeOk(sc) && sc.wgen === _csWriteGen; }
function depxStopped(run, sc) {
  if (run !== _depx.runSeq || !_depx.running) return;   // أُلغي بالإغلاق/الخروج: لا رسالة
  if (sc.wgen !== _csWriteGen) depxFail('⚠️ تغيّرت بيانات الحالة (عملية كتابة أو مزامنة) أثناء التحضير — أُلغي التصدير ولم يُنشأ ملف حتى لا يختلط تقرير بحالتين. أعد المحاولة');
  else depxFail('⚠️ تغيّرت الجلسة أثناء التحضير — أُلغي التصدير ولم يُنشأ ملف');
}
function depxTick(ms) { return new Promise(r => setTimeout(r, ms || 0)); }
// طابور بتوازٍ محدود (للقراءات الخفيفة والتفصيلية على حدٍّ سواء)
function depxLimit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => { _depx.q.active++; Promise.resolve().then(fn).then(resolve, reject).finally(() => { _depx.q.active--; const n = _depx.q.wait.shift(); if (n) n(); }); };
    if (_depx.q.active < DEPX_CONC) run(); else _depx.q.wait.push(run);
  });
}

function depxProgress(text, frac) {
  const box = document.getElementById('depExportStatus'); if (!box) return;
  if (text == null) { box.style.display = 'none'; return; }
  box.style.display = ''; box.style.background = '#EBF8FF'; box.style.borderColor = '#90CDF4'; box.style.color = '#2A4365';
  document.getElementById('depExportStatusText').textContent = text;
  const bw = document.getElementById('depExportBarWrap'), bar = document.getElementById('depExportBar');
  if (frac == null) bw.style.display = 'none'; else { bw.style.display = ''; bar.style.width = Math.max(0, Math.min(100, Math.round(frac * 100))) + '%'; }
}
function depxFail(text) {   // خطأ دائم الظهور داخل النافذة (لا يعتمد على toast عابر)
  const box = document.getElementById('depExportStatus'); if (!box) return;
  box.style.display = ''; box.style.background = '#FFF5F5'; box.style.borderColor = '#FC8181'; box.style.color = '#822727';
  document.getElementById('depExportStatusText').textContent = text;
  document.getElementById('depExportBarWrap').style.display = 'none';
}
function depxSetBusy(busy) {
  const fs = document.getElementById('depExportFs'), go = document.getElementById('depExportGoBtn'), cl = document.getElementById('depExportCloseBtn');
  if (fs) fs.disabled = !!busy;
  if (go) { go.disabled = !!busy; go.textContent = busy ? '⏳ جارٍ التحضير…' : '📄 تصدير PDF'; }
  if (cl) cl.textContent = busy ? '✖ إلغاء التصدير' : 'إغلاق';
}

// ---- الملف الجاهز ----
function depxDropReady() {
  const rd = _depx.ready; _depx.ready = null;
  if (rd && rd.url) { try { URL.revokeObjectURL(rd.url); } catch (e) {} }
  const box = document.getElementById('depExportReady'); if (box) box.style.display = 'none';
  const a = document.getElementById('depExportOpenLink'); if (a) { a.removeAttribute('href'); a.removeAttribute('download'); }
}
function depxReadyValid() {
  const rd = _depx.ready; if (!rd) return false;
  if (rd.sess !== featSessionTag() || rd.gen !== _csAuthGen) { depxDropReady(); return false; }   // جلسة أخرى/خروج: لا يبقى ملف حساب سابق
  return true;
}
function depxRenderReady() {
  const box = document.getElementById('depExportReady'); if (!box) return;
  if (!depxReadyValid()) { box.style.display = 'none'; return; }
  const rd = _depx.ready, a = document.getElementById('depExportOpenLink');
  a.href = rd.url; a.download = rd.name;
  const mb = rd.blob.size >= 1048576 ? (rd.blob.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(rd.blob.size / 1024)) + ' KB';
  document.getElementById('depExportReadyInfo').textContent = '✅ الملف جاهز — ' + rd.towers + ' برج، ' + rd.pages + ' صفحة، ' + mb + (rd.note ? ' — ' + rd.note : '');
  let canShare = false; try { canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([rd.blob], rd.name, { type: 'application/pdf' })] })); } catch (e) {}
  document.getElementById('depExportShareBtn').style.display = canShare ? '' : 'none';
  box.style.display = '';
}
function depxReadyClick(ev) {   // النقر الحقيقي على الرابط هو «النقرة الجديدة»؛ هنا نتحقق فقط أن الملف ما زال صالحاً لهذه الجلسة
  if (!depxReadyValid()) { if (ev && ev.preventDefault) ev.preventDefault(); showToast('⚠️ انتهت صلاحية الملف (تغيّرت الجلسة) — أعد التصدير', 'error'); return false; }
  return true;
}
async function depxShareReady() {   // مشاركة بنقرة جديدة (navigator.share يحتاج لمسة مباشرة)
  if (!depxReadyValid()) { showToast('⚠️ انتهت صلاحية الملف — أعد التصدير', 'error'); return; }
  const rd = _depx.ready;
  try { await shareOrDownloadFile(rd.blob, rd.name, 'application/pdf'); } catch (e) { console.warn('[tower-app] share failed', e); }
}
function depxDiscardReady() { depxDropReady(); }
// خروج/تبديل حساب: يُلغى أي تصدير جارٍ ويُحذف الملف الجاهز ويُغلق نافذة التصدير
function depxPurge() {
  _depx.runSeq++; _depx.modalSeq++; _depx.running = false; _depx.lines = {};
  depxDropReady();
  try { depxSetBusy(false); depxProgress(null); document.getElementById('depExportModalBg').classList.remove('show'); } catch (e) {}
}
try { window.addEventListener('pagehide', depxDropReady); } catch (e) {}

// ---- فهرس المغادرات (قائمة الخطوط) ----
async function depxIndex(sc) {
  if (typeof depIndexLoad !== 'function') await featLoadModule('dep');   // وحدة قائمة المغادرات: تُحمَّل مرة واحدة وتملك حالة الفهرس
  const fresh = () => _depIdx.data && !_depIdx.error && _depIdx.tried === _csWriteGen && (Date.now() - _depIdx.last) < 60000;
  if (!fresh()) {
    if (_depIdx.loading) { const t0 = Date.now(); while (_depIdx.loading && Date.now() - t0 < 25000) await depxTick(80); }
    else { _depIdx.error = null; await depIndexLoad(); }
  }
  if (!depxScopeOk(sc)) return { ok: false, stale: true };
  if (_depIdx.data && !_depIdx.error) return { ok: true };
  return { ok: false, code: _depIdx.error || 'error' };
}

async function openDepExportModalImpl() {
  const wrap = document.getElementById('depExportLinesWrap');
  if (_depx.running) { document.getElementById('depExportModalBg').classList.add('show'); return; }   // تصدير جارٍ: النافذة تعود لحالتها فقط
  ++_depx.modalSeq;
  _depx.lines = {};
  document.getElementById('depExportSelectAllBtn').textContent = 'تحديد الكل';
  document.getElementById('depExportTowerFrom').value = '';
  document.getElementById('depExportTowerTo').value = '';
  document.getElementById('depExportCategoryAll').checked = true;
  document.querySelectorAll('.depExportCatChk').forEach(cb => { cb.checked = false; cb.disabled = true; });
  depxProgress(null);
  depxSetBusy(false);
  document.getElementById('depExportModalBg').classList.add('show');
  depxRenderReady();
  if (!csLiveEnabled()) return depxOpenLegacy(wrap);
  await depxLoadLines();
}

async function depxLoadLines() {
  const wrap = document.getElementById('depExportLinesWrap');
  const sc = depxScope();
  wrap.innerHTML = '<div class="empty-state">⏳ جارٍ قراءة فهرس المغادرات…</div>';
  updateDepExportTowerList();
  let r; try { r = await depxIndex(sc); } catch (e) { r = { ok: false, code: 'module' }; }
  if (!depxScopeOk(sc)) return;
  if (!r.ok) {
    wrap.innerHTML = '<div style="font-size:0.8rem;color:#822727;background:#FFF5F5;border-radius:8px;padding:8px">' + (r.code === 'offline' ? '📴 دون اتصال — تعذّرت قراءة فهرس المغادرات' : '⚠️ تعذّرت قراءة فهرس المغادرات من الخادم') + '<br><button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="depxLoadLines()">🔄 إعادة المحاولة</button></div>';
    return;
  }
  const d = _depIdx.data, tot = d.totals || {};
  const rows = depIndexRows(d).filter(x => x.towers > 0 && x.known).sort((a, b) => a.line.localeCompare(b.line, 'ar'));
  const unk = Number(tot.uninitialised_towers) || 0, inc = Number(tot.incomplete_towers) || 0;
  const note = (unk || inc) ? '<div style="font-size:0.78rem;color:#822727;background:#FFF5F5;border-radius:8px;padding:8px;margin-bottom:8px">⚠️ ' + (unk ? unk + ' برج غير مهيّأ في مخزن الحالة' : '') + (unk && inc ? '، ' : '') + (inc ? inc + ' برج بياناته غير مكتملة' : '') + ' — لا تُحسب سليمة ولا تُعدّ ضمن القائمة</div>' : '';
  if (!rows.length) { wrap.innerHTML = note + (note ? '<div class="empty-state">لا مغادرات مفتوحة مؤكدة بين الأبراج المعروفة</div>' : '<div class="empty-state">✅ لا توجد مغادرات مفتوحة</div>'); return; }
  wrap.innerHTML = note + rows.map(x => `
      <label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:0.82rem;border-bottom:1px solid #F0F2F5">
        <input type="checkbox" class="depExportLineChk" value="${depxEsc(x.line)}" onchange="updateDepExportTowerList()">
        <span>${depxEsc(x.line)}</span><span style="margin-inline-start:auto;color:#718096;font-size:0.74rem">${x.towers} برج</span>
      </label>`).join('');
}

// المسار القديم (بلا مخزن حالة حيّ): كما كان تماماً
async function depxOpenLegacy(wrap) {
  const sc = depxScope();
  wrap.innerHTML = '<div class="empty-state">⏳ جاري تحميل بيانات المغادرات...</div>';
  try { await Promise.all([loadFullRecordsCache(), loadTreatments()]); } catch (e) { console.warn('[tower-app] فشل تحديث بيانات المغادرات قبل التصدير', e); }
  if (!depxScopeOk(sc)) return;
  const uniqueLines = [...new Set(fullRecordsCache.map(r => r.line_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  const linesWithOpenDeps = uniqueLines.filter(name => getActiveDepartureTowers(name).length > 0);
  if (!linesWithOpenDeps.length) wrap.innerHTML = '<div class="empty-state">✅ لا توجد مغادرات مفتوحة</div>';
  else wrap.innerHTML = linesWithOpenDeps.map(name => `
      <label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:0.82rem;border-bottom:1px solid #F0F2F5">
        <input type="checkbox" class="depExportLineChk" value="${depxEsc(name)}" onchange="updateDepExportTowerList()">
        <span>${depxEsc(name)}</span>
      </label>`).join('');
  updateDepExportTowerList();
}

// قراءة ملخّص خط واحد (خفيفة) عند اختياره؛ ردّ قديم (نافذة أُغلقت/جلسة تغيّرت/إعادة فتح) لا يُطبَّق على الواجهة
function depxEnsureLine(name) {
  const cur = _depx.lines[name];
  if (cur) return;   // loading / ok / error: الخطأ يُعاد فقط بزر «إعادة المحاولة» الصريح (depxRetryLine) — لا حلقة طلبات
  const sc = depxScope(), rec = _depx.lines[name] = { state: 'loading' };
  depxLimit(async () => {
    if (!depxScopeOk(sc) || _depx.lines[name] !== rec) return;
    let res = null; try { res = await loadLineRecordsCache(name, false, 'summary'); } catch (e) { res = null; }
    if (!depxScopeOk(sc) || _depx.lines[name] !== rec) return;
    rec.state = res && res.ok !== false ? 'ok' : 'error';
    depxRenderTowers(true);
  }).catch(e => { if (_depx.lines[name] === rec) { rec.state = 'error'; depxRenderTowers(true); } });
}
function depxRetryLine(name) { delete _depx.lines[name]; updateDepExportTowerList(); }

// keep=true: اختيار/إلغاء خط أو اكتمال قراءة خط (تحافظ على تحديدات المستخدم الحالية)؛ keep=false: تغيير نطاق الأبراج (يعيد التحديد حسب النطاق)
function depxRenderTowers(keep) {
  if (_depx.running) return;
  const live = csLiveEnabled();
  const lines = getDepExportSelectedLines();
  const fromRaw = document.getElementById('depExportTowerFrom').value;
  const toRaw = document.getElementById('depExportTowerTo').value;
  const hasRange = fromRaw !== '' || toRaw !== ''; // لا نعتبر أي نطاق تلقائياً إلا لو المستخدم كتب رقماً فعلياً
  const from = parseInt(fromRaw) || 0;
  const to = parseInt(toRaw) || Infinity;
  const towersWrap = document.getElementById('depExportTowersWrap');
  const prev = new Map();
  if (keep) document.querySelectorAll('.depExportTowerChk').forEach(b => prev.set(b.value, b.checked));

  let allTowers = [], status = '';
  lines.forEach(name => {
    if (live) {
      depxEnsureLine(name);
      const st = _depx.lines[name] || { state: 'loading' };
      if (st.state === 'loading') { status += `<div style="grid-column:1/-1;font-size:0.76rem;color:#718096">⏳ جارٍ قراءة ${depxEsc(name)}…</div>`; return; }
      if (st.state === 'error') { status += `<div style="grid-column:1/-1;font-size:0.76rem;color:#822727">⚠️ تعذّرت قراءة ${depxEsc(name)} <button class="btn btn-secondary btn-sm" data-line="${depxEsc(name)}" onclick="depxRetryLine(this.dataset.line)">🔄</button></div>`; return; }
      const cov = csScopeCoverage([name], 'summary');
      if (cov.incomplete.length) status += `<div style="grid-column:1/-1;font-size:0.76rem;color:#822727">⚠️ ${depxEsc(name)}: ${depxEsc(csCoverageText(cov))}</div>`;
    }
    getActiveDepartureTowers(name).forEach(({ r }) => {
      allTowers.push({ num: parseInt(r.tower_number), towerNum: r.tower_number, lineName: name });
    });
  });
  allTowers.sort((a, b) => a.num - b.num);

  if (!allTowers.length) {
    towersWrap.innerHTML = status || '<div style="font-size:0.8rem;color:#718096;grid-column:span 3">اختر خطاً أولاً</div>';
    updateDepExportResultCount();
    return;
  }
  towersWrap.innerHTML = status + allTowers.map(t => {
    const val = depxEsc(t.lineName + '||' + t.towerNum);
    const key = t.lineName + '||' + t.towerNum;
    const inRange = hasRange && (!fromRaw || t.num >= from) && (!toRaw || t.num <= to);
    const checked = keep && prev.has(key) ? prev.get(key) : inRange;   // بدون نطاق مكتوب: لا شيء محدد تلقائياً
    return `<label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;padding:3px 0">
      <input type="checkbox" class="depExportTowerChk" value="${val}" ${checked ? 'checked' : ''} onchange="updateDepExportResultCount()">
      <span>برج ${depxEsc(t.towerNum)}</span>
    </label>`;
  }).join('');
  updateDepExportResultCount();
}
function updateDepExportTowerList() { depxRenderTowers(true); }   // تغيير الخطوط: تحديدات الأبراج اليدوية الحالية تبقى؛ تغيير النطاق (depxRenderTowers(false)) يعيد التحديد حسب النطاق كما كان

function closeDepExportModal() {
  if (_depx.running) {   // الإغلاق أثناء التحضير = إلغاء صريح (كل خطوة لاحقة تتحقق من رقم التشغيل فتتوقف)
    _depx.runSeq++; _depx.running = false;
    depxSetBusy(false); depxProgress(null);
    try { showToast('تم إلغاء التصدير', 'error'); } catch (e) {}
  }
  _depx.modalSeq++;   // أي ردّ قراءة خفيفة متأخر لهذه النافذة يُهمل
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

// ---- المرحلة 1 (حيّ فقط): تفاصيل الأبراج المحددة وحدها، أجزاء صغيرة بتوازٍ محدود ----
// يستعمل app_line_state(p_towers) الموجود عبر csLine، ثم نفس مطابقة الكاش (_reconcileRefresh) مع إبقاء صفوف بقية أبراج الخط كما هي.
async function depxLoadDetails(byLine, isLive, onProgress) {
  const jobs = [], failed = [], covAgg = { complete: true, requested: 0, initialised: 0, uninitialised: 0, card_pending: 0, no_source: 0, unread: [], incomplete: [] };
  let aborted = null, done = 0, total = 0;
  Object.keys(byLine).forEach(line => {
    const nums = Array.from(byLine[line]);
    for (let i = 0; i < nums.length; i += DEPX_CHUNK) { jobs.push({ line, towers: nums.slice(i, i + DEPX_CHUNK) }); }
    total += nums.length;
  });
  let idx = 0;
  async function worker() {
    while (idx < jobs.length && !aborted) {
      const job = jobs[idx++];
      let cl = null;
      for (let attempt = 0; attempt < 3; attempt++) {   // ردّ stale_write أو برج «محذوف لحداثة غيره»: إعادة قراءة طازجة (محدودة)
        if (!isLive()) { aborted = 'cancelled'; return; }
        const startSeq = _localSeq;
        cl = await csLine(job.line, job.towers, 'detail');
        if (!isLive()) { aborted = 'cancelled'; return; }
        if (cl && !cl.ok && (cl.code === 'stale_write' || cl.code === 'superseded')) continue;
        if (cl && cl.ok && cl.omitted && cl.omitted.length && attempt < 2) continue;
        job.startSeq = startSeq;
        break;
      }
      if (!cl || !cl.ok) {
        if (cl && (cl.code === 'session_changed' || cl.authLost || (typeof CS_AUTH_TERMINAL !== 'undefined' && CS_AUTH_TERMINAL.indexOf(cl.code) >= 0))) { aborted = 'session'; return; }
        failed.push({ line: job.line, towers: job.towers, code: (cl && cl.code) || 'error' });
        continue;
      }
      const rows = csRowsFromLine(cl.towers);
      const returned = new Set(Object.keys(cl.towers || {}).map(String));
      const keep = new Set(fullRecordsCache.filter(r => r && r.line_name === job.line).map(r => String(r.tower_number)).filter(n => !returned.has(n)));
      (cl.omitted || []).forEach(n => keep.add(String(n)));
      const mySeq = ++_readSeq;
      const applied = _reconcileRefresh(rows, job.line, mySeq, job.startSeq == null ? _localSeq : job.startSeq, keep);
      if (!applied) { failed.push({ line: job.line, towers: job.towers, code: 'cache_unresolved' }); continue; }
      const c = cl.coverage;
      if (c) {
        ['requested', 'initialised', 'uninitialised', 'card_pending', 'no_source'].forEach(k => { covAgg[k] += c[k] || 0; });
        if (c.complete === false) { covAgg.complete = false; if (covAgg.incomplete.indexOf(job.line) < 0) covAgg.incomplete.push(job.line); }
      }
      done += job.towers.length;
      onProgress(done, total);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return { aborted, failed, coverage: covAgg };
}

async function exportOpenDeparturesPDF() {
  if (_depx.running) { showToast('التصدير قيد التنفيذ — انتظر اكتماله', 'error'); return; }   // حارس تكرار متزامن قبل أي await
  const selectedTowers = getDepExportSelectedTowers();
  if (!selectedTowers.length) { showToast('اختر أبراجاً للتصدير أولاً', 'error'); return; }
  const categories = getDepExportSelectedCategories(); // null = كل التصنيفات
  _depx.running = true;
  const run = ++_depx.runSeq, sc = depxScope();
  const isLive = () => _depx.running && run === _depx.runSeq && depxRunOk(sc);
  depxDropReady();                       // ملف سابق يُستبدل بهذا التشغيل
  depxSetBusy(true);
  depxProgress(`⏳ جارٍ التحضير لـ${selectedTowers.length} برج…`, 0);
  try {
    await depxRunExport(selectedTowers, categories, run, sc, isLive);
  } catch (e) {
    console.error('PDF export error:', e);
    if (run === _depx.runSeq && _depx.running) depxFail('❌ تعذّر تصدير PDF: ' + (e && e.message ? e.message : e));
  } finally {
    if (run === _depx.runSeq) { _depx.running = false; depxSetBusy(false); }
  }
}


async function depxRunExport(selectedTowers, categories, run, sc, isLive) {
  // تجميع الأبراج حسب الخط
  const byLine = {};
  selectedTowers.forEach(({ lineName, towerNum }) => { (byLine[lineName] = byLine[lineName] || new Set()).add(String(towerNum)); });
  const live = csLiveEnabled();

  // المرحلة 1: التفاصيل المرجعية للأبراج المحددة فقط (لا خط كامل ولا أبراج غير محددة)
  if (live) {
    // سياسة التغطية (كما في C6r9f): خط محدد تغطيته غير مكتملة أو غير مقروءة لا يُصدَّر (لا برج يختفي بصمت). قراءة ملخّص كل خط محدد (خفيفة) تُحدّث تغطيته الآن.
    const lines0 = Object.keys(byLine), covFailed = [];
    depxProgress('⏳ التحقق من تغطية الحالة للخطوط المحددة…', 0);
    await Promise.all(lines0.map(l => depxLimit(async () => {
      if (!isLive()) return;
      try { const res = await loadLineRecordsCache(l, true, 'summary'); if (!res || res.ok === false) covFailed.push(l); } catch (e) { covFailed.push(l); }
    })));
    if (!isLive()) { depxStopped(run, sc); return; }
    const cov0 = csScopeCoverage(lines0, 'summary');
    if (covFailed.length || cov0.unread.length) { depxFail('⚠️ تعذّر تحميل الحالة الحالية للخطوط المحددة — لن يُنشأ تصدير غير مكتمل'); return; }
    if (cov0.incomplete.length) { depxFail('⚠️ تغطية الحالة غير مكتملة: ' + csCoverageText(cov0) + ' (' + cov0.incomplete.slice(0, 3).join('، ') + ') — لن يُصدَّر تقرير مغادرات حالي ناقص'); return; }
    const total = selectedTowers.length;
    depxProgress(`⏳ قراءة تفاصيل الأبراج (0/${total})…`, 0);
    const r = await depxLoadDetails(byLine, isLive, (d, t) => depxProgress(`⏳ قراءة تفاصيل الأبراج (${d}/${t})…`, 0.5 * d / t));
    if (!isLive()) { depxStopped(run, sc); return; }
    if (r.aborted) { depxFail(r.aborted === 'session' ? '⚠️ تغيّرت الجلسة أثناء التحضير — أُلغي التصدير ولم يُنشأ ملف' : 'أُلغي التصدير'); return; }
    if (r.failed.length) {
      const bad = []; r.failed.forEach(f => f.towers.forEach(n => bad.push(f.line + ' / ' + n)));
      depxFail(`⚠️ تعذّرت قراءة تفاصيل ${bad.length} برج (${bad.slice(0, 5).join('، ')}${bad.length > 5 ? '…' : ''}) — لن يُنشأ تصدير ناقص. تحقق من الاتصال وأعد المحاولة`);
      return;
    }
    const cov = r.coverage;
    if (!cov.complete || cov.uninitialised || cov.card_pending) {
      depxFail('⚠️ تغطية الحالة غير مكتملة للأبراج المحددة: ' + csCoverageText(cov) + (cov.incomplete.length ? ' (' + cov.incomplete.slice(0, 3).join('، ') + ')' : '') + ' — لن يُصدَّر تقرير مغادرات حالي ناقص');
      return;
    }
    // كل برج محدد يجب أن يكون له صف تفصيلي الآن؛ غير ذلك = فشل صريح لا حذف صامت
    const missing = [];
    Object.keys(byLine).forEach(line => byLine[line].forEach(n => {
      const row = (latestRecordsIndex[line] || {})[n];
      if (!row || !_rowHasDetail(row)) missing.push(line + ' / ' + n);
    }));
    if (missing.length) { depxFail(`⚠️ لا تفاصيل مؤكدة لـ${missing.length} برج (${missing.slice(0, 5).join('، ')}${missing.length > 5 ? '…' : ''}) — لن يُنشأ تصدير ناقص`); return; }
  }

  // المرحلة 2: توليد PDF
  await ensureJsPDFLoaded(); // Lazy load: يضمن اكتمال تحميل jsPDF قبل الاستخدام
  if (!isLive()) { depxStopped(run, sc); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 30;
  const usableW = pageW - margin * 2;
  let first = true, totalTowersExported = 0, processed = 0;
  const totalSel = selectedTowers.length, insMemo = new Map(), noLongerOpen = [];
  const base = live ? 0.5 : 0;

  for (const lineName of Object.keys(byLine)) {
    const towerNums = byLine[lineName];
    const activeTowers = getActiveDepartureTowers(lineName)
      .filter(({ r }) => towerNums.has(String(r.tower_number)))
      .sort((a, b) => parseInt(a.r.tower_number) - parseInt(b.r.tower_number));
    // أبراج محددة لم تعد لها مغادرات مفتوحة بعد القراءة المرجعية: تُعلَن في النتيجة (لا تُحذف بصمت)
    const activeSet = new Set(activeTowers.map(({ r }) => String(r.tower_number)));
    towerNums.forEach(n => { if (!activeSet.has(n)) noLongerOpen.push(lineName + ' / ' + n); });
    if (!activeTowers.length) continue;

    if (!first) doc.addPage();
    first = false;

    const lineHeaderImg = drawArabicTextPNG([
      { text: `🚨 خط: ${lineName} — ${activeTowers.length} برج`, fontSize: 16, fontWeight: 'bold', color: '#fff', bg: '#1a2e4a', padY: 10 }
    ], pageW - margin * 2);
    let y = margin;
    if (lineHeaderImg) {
      const w = pageW - margin * 2;
      const h = w * (lineHeaderImg.h / lineHeaderImg.w);
      doc.addImage(lineHeaderImg.dataUrl, 'JPEG', margin, y, w, h);
      y += h + 14;
    }

    for (const { r, deps } of activeTowers) {
      if (!isLive()) { depxStopped(run, sc); return; }
      processed++;
      depxProgress(`⏳ توليد PDF (${processed}/${totalSel} برج)…`, base + (1 - base) * processed / totalSel);
      if (processed % 3 === 0) await depxTick(0);        // نتنفّس للواجهة (تحديث التقدّم)
      if (processed % 10 === 0) await depxTick(30);      // استرخاء للذاكرة على iOS

      const openDepsAll = getOpenDepsOnly(r, deps);
      // نصفّي حسب التصنيف المختار — لو "الكل" ما نغيّر شي، ولو محدد نستبعد أي مغادرة لا تطابق
      const openDeps = categories
        ? openDepsAll.filter(d => categories.some(cat => (REPORT_CATEGORY_TREATMENT_PREFIXES[cat] || []).some(p => (d.key || '').startsWith(p))))
        : openDepsAll;
      if (!openDeps.length) continue;
      totalTowersExported++;

      const otherDeps = openDeps.filter(d => d.type !== 'insulator' && d.type !== 'insulator2');
      const items = [
        { text: `🗼 برج ${r.tower_number} — ${TOWER_TYPES[r.tower_type] || r.tower_type || ''} — ${r.voltage || LINE_VOLTAGE[lineName] || ''} ك.ف`, fontSize: 14, fontWeight: 'bold', color: '#1a2e4a', padY: 6 },
        { text: `📅 آخر كشف: ${r.inspection_date || '—'}  |  👤 ${r.created_by_name || '—'}`, fontSize: 11, color: '#718096', padY: 2 }
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
      const towerImg = drawArabicTextPNG(items, pageW - margin * 2, { border: true });

      const hasOpenInsulatorDep = openDeps.some(d => d.type === 'insulator' || d.type === 'insulator2');
      let insImg = null;
      if (hasOpenInsulatorDep && r.insulator_state) {
        // أبراج بمدخلات مخطط عوازل متطابقة تماماً تشارك صورة واحدة (نفس الدقة، بلا إعادة رسم)
        const mk = JSON.stringify([r.insulator_state, r.voltage, r.tower_type, r.line_name, r.insulator_cycle, r.insulator_state_2, r.insulator_cycle_2, r.tower_number, r.insulator_chain_types, r.insulator_chain_types_2]);
        if (insMemo.has(mk)) insImg = insMemo.get(mk);
        else { insImg = buildInsulatorExportPNG(r.insulator_state, r.voltage, r.tower_type, r.line_name, r.insulator_cycle, r.insulator_state_2, r.insulator_cycle_2, r.tower_number, r.insulator_chain_types, r.insulator_chain_types_2); insMemo.set(mk, insImg); }
      }

      // حساب الارتفاع الكلي للكتلة (تفاصيل المغادرات + صورة العوازل معاً)
      const maxContentH = pageH - margin * 2; // أقصى ارتفاع ممكن أصلاً بصفحة فاضية تماماً
      let towerH = 0, insH = 0;
      if (towerImg) towerH = usableW * (towerImg.h / towerImg.w);
      if (insImg) insH = usableW * (insImg.h / insImg.w);
      let blockH = towerH + (towerImg ? 8 : 0) + insH + (insImg ? 6 : 0) + 10;
      let drawW = usableW;

      // لو الكتلة كاملة أطول من صفحة فاضية بالكامل، نصغّرها تناسبياً لضمان ظهورها كاملة بصفحة واحدة
      if (blockH > maxContentH) {
        const shrink = maxContentH / blockH;
        towerH *= shrink; insH *= shrink; drawW *= shrink; blockH = maxContentH;
      }

      // ننتقل لصفحة جديدة فقط لو فيه محتوى مرسوم أصلاً بالصفحة الحالية (y > margin)
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

  if (!isLive()) { depxStopped(run, sc); return; }
  if (!totalTowersExported) {
    depxFail('لا توجد مغادرات مفتوحة للأبراج المحددة' + (noLongerOpen.length ? ' — ' + noLongerOpen.length + ' برج لم تعد له مغادرات مفتوحة بعد قراءة الحالة الحالية' : ''));
    return;
  }
  depxProgress('⏳ جارٍ إنهاء الملف…', 1);
  await depxTick(0);
  const pages = doc.getNumberOfPages();
  const blob = await doc.output('blob');   // jsPDF يعيدها متزامنة؛ await لا يضرّ (ويتيح لمُحاكي الاختبار الإنهاء غير المتزامن)
  if (!isLive()) { depxStopped(run, sc); return; }   // ألغي/تغيّرت الجلسة أثناء الإنهاء: لا يُحتفظ بالملف
  const name = `مغادرات_مفتوحة_${new Date().toISOString().slice(0, 10)}.pdf`;
  let note = '';
  if (noLongerOpen.length) note = noLongerOpen.length + ' برج محدد لم تعد له مغادرات مفتوحة فلم يُدرج (' + noLongerOpen.slice(0, 4).join('، ') + (noLongerOpen.length > 4 ? '…' : '') + ')';
  _depx.ready = { blob, name, url: URL.createObjectURL(blob), towers: totalTowersExported, pages, sess: sc.sess, gen: sc.gen, note };
  depxProgress(null);
  depxRenderReady();
  showToast(`✅ الملف جاهز (${totalTowersExported} برج) — اضغط «فتح / تنزيل PDF»`);
}

(window.__featModules = window.__featModules || {}).dexp = true;
