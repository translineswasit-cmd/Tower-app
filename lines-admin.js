/* lines-admin.js — v335-C5r9
   إدارة الخطوط (مدير): إضافة/تعديل/حذف خط، محرر أبراج الخط (نوع/استثناء السلاسل/مادة)، الحفظ الذري لمعلومات الخطوط وإعدادات الدوائر عبر الخادم.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
(function mount_lineModal() {
  if (document.getElementById('lineModal')) return;
  const html = `
<div id="lineModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;overflow-y:auto">
  <div style="background:white;max-width:600px;margin:20px auto;border-radius:14px;padding:24px">
    <h3 id="lineModalTitle" style="margin-bottom:16px;color:#1a2e4a">➕ إضافة خط جديد</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="field"><label>اسم الخط *</label><input id="lm_name" placeholder="مثال: واسط - الكوت"></div>
      <div class="field"><label>الجهد (ك.ف) *</label><select id="lm_voltage" style="padding:10px;border-radius:8px;border:1px solid #ccc;width:100%;font-family:inherit"><option value="132">132</option><option value="400">400</option></select></div>
      <div class="field"><label>طول الخط (كم)</label><input id="lm_length" type="number" step="0.1"></div>
      <div class="field"><label>عدد الأبراج</label><input id="lm_towers" type="number"></div>
      <div class="field"><label>أبراج الشد</label><input id="lm_tension" type="number"></div>
      <div class="field"><label>السعة (MVA)</label><input id="lm_capacity" type="number"></div>
      <div class="field"><label>نوع السلك</label><input id="lm_wire" placeholder="T.Teal"></div>
      <div class="field"><label>السلك الأرضي</label><input id="lm_ground" placeholder="OPGW"></div>
      <div class="field"><label>حدود المسؤولية</label><select id="lm_resp" style="padding:10px;border-radius:8px;border:1px solid #ccc;width:100%;font-family:inherit"><option>الخط بالكامل</option><option>خط مشترك</option></select></div>
      <div class="field"><label>سنة الدخول</label><input id="lm_year" type="number"></div>
      <div class="field"><label>الحالة</label><select id="lm_status" style="padding:10px;border-radius:8px;border:1px solid #ccc;width:100%;font-family:inherit"><option>بالعمل</option><option>خارج العمل</option></select></div>
    </div>
    <div class="field" style="margin-top:12px"><label>ملاحظات</label><textarea id="lm_notes" rows="2" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ccc;font-family:inherit;resize:vertical"></textarea></div>

    <!-- أبراج الخط: توليد نطاق أرقام + تحديد استثناءات النوع (شد/عبور/نهائي...) -->
    <div style="margin-top:18px;border-top:1.5px solid #E2E8F0;padding-top:14px">
      <label style="font-weight:700;color:#1a2e4a;display:block;margin-bottom:8px">⚙️ إعدادات الخط الفنية</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="field"><label>عدد الدوائر</label>
          <select id="lm_circuit_count" style="padding:10px;border-radius:8px;border:1px solid #ccc;width:100%;font-family:inherit">
            <option value="1">دائرة واحدة</option>
            <option value="2">دائرتان (2+1)</option>
          </select>
        </div>
        <div class="field"><label>نوع سلسلة العوازل (132 ك.ف)</label>
          <select id="lm_chain_mode" style="padding:10px;border-radius:8px;border:1px solid #ccc;width:100%;font-family:inherit">
            <option value="double">مضاعف (الحالة العامة)</option>
            <option value="single">مفرد (استثنائي)</option>
          </select>
        </div>
      </div>
      <p style="color:#a0aec0;font-size:0.76rem;margin-top:4px">نوع سلسلة العوازل يطبَّق على خطوط 132 ك.ف فقط (تعليق: مفرد=سلسلة واحدة/مضاعف=سلسلتين — شد: سلسلتين/4 سلاسل على التوالي).</p>
    </div>

    <div style="margin-top:18px;border-top:1.5px solid #E2E8F0;padding-top:14px">
      <label style="font-weight:700;color:#1a2e4a;display:block;margin-bottom:8px">🗼 أبراج الخط (رقم كل برج ونوعه — تُستخدم بشاشة الفحص والمغادرات)</label>
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:90px"><label>من برج</label><input id="lm_tw_from" type="number" placeholder="1"></div>
        <div class="field" style="flex:1;min-width:90px"><label>إلى برج</label><input id="lm_tw_to" type="number" placeholder="150"></div>
        <button class="btn btn-secondary btn-sm" onclick="generateLineTowersRange()">🔄 توليد (الكل تعليق افتراضياً)</button>
      </div>
      <p style="color:#a0aec0;font-size:0.76rem;margin-top:4px">التوليد يستبدل القائمة الحالية بالكامل. بعده حدد يدوياً فقط الأبراج الاستثنائية (شد/عبور/نهائي/خاص) من القائمة تحت.</p>

      <div style="margin-top:12px;padding:10px;background:#F7FAFC;border-radius:8px;border:1.5px dashed #CBD5E0">
        <label style="font-weight:700;color:#1a2e4a;display:block;margin-bottom:6px;font-size:0.85rem">➕ إدراج برج جديد بمنتصف التسلسل</label>
        <p style="color:#a0aec0;font-size:0.74rem;margin-bottom:6px">يدرج البرج مباشرة بعد الرقم المحدد، ويعيد ترقيم كل الأبراج بعده تلقائياً (+1) — يستخدم لحالة "أضفنا برج فعلياً بين برجين موجودين".</p>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="field" style="flex:1;min-width:100px"><label>يُدرَج بعد برج رقم</label><input id="lm_insert_after" type="number" placeholder="36"></div>
          <div class="field" style="flex:1.3;min-width:130px">
            <label>نوع البرج الجديد</label>
            <select id="lm_insert_type">
              <option>برج تعليق</option>
              <option>برج شد</option>
              <option>برج عبور</option>
              <option>برج عبور اسفل الخط</option>
              <option>برج نهائي</option>
              <option>برج خاص</option>
            </select>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="insertLineTowerAndRenumber()">➕ إدراج وإعادة ترقيم</button>
        </div>
      </div>

      <p id="lmTowersCount" style="font-size:0.8rem;color:#4a5568;margin-top:6px;font-weight:700"></p>
      <div id="lmTowersListWrap" style="max-height:260px;overflow-y:auto;border:1.5px solid #E2E8F0;border-radius:8px;padding:8px;margin-top:6px"></div>
    </div>
    <p style="color:#a0aec0;font-size:0.74rem;margin-top:8px">ملاحظة: هذا التعديل يخص هذا الخط فقط ولحد ما تضغط "حفظ" بأسفل الشاشة ما ينحفظ فعلياً.</p>
    <div style="display:flex;gap:10px;margin-top:16px;justify-content:flex-end">
      <button class="btn btn-secondary" onclick="closeLineModal()">إلغاء</button>
      <button class="btn btn-primary" id="lm_save_btn" onclick="saveLineModal()">💾 حفظ</button>
    </div>
  </div>
</div>
`;
  const anchor = document.getElementById('page-inventory');
  if (anchor) anchor.insertAdjacentHTML('beforebegin', html); else document.body.insertAdjacentHTML('beforeend', html);
})();

// ============================================================================================================
// v335-C5r10: كتابة جدول الخطوط. القائمة المحلية (linesInfoCache: قد تكون الاحتياطية المدمجة) للعرض فقط وليست سلطة كتابة:
//  - قبل أي تعديل (إعدادات أو بيانات) نقرأ خط أساس موثوقاً من الخادم (app_lines_info_read: الصفوف + نسخة)؛ فشل القراءة = لا يُرسل شيء.
//  - التغيير المقصود وحده (إضافة/تعديل/حذف صف) يُدمج بقائمة الخادم، والاستبدال يحمل نسخة الأساس (مقارنة-وتبديل): تغيّر الجدول بين القراءة والكتابة = conflict ولا يُكتب شيء.
//  - لكل طلب هوية (جيل النموذج + جيل الجلسة + لقطة مدخلاته)؛ ردّ متأخر لا يغلق/يعيد ضبط/يُعلن نتيجته على نموذج آخر.
// ============================================================================================================
const LINES_IDX_MAX = 999999;   // عقد الخادم app_lines_info_replace: idx رقم صحيح من 1 إلى 6 خانات
const LINES_INFO_COLS = ['idx','voltage','name','length','towers','tension_towers','phase_swap','capacity','wire_type','ground_wire','responsibility','year','status','notes'];
function _lnNorm(v) { if (v === undefined || v === null) return null; if (typeof v === 'string') { const t = v.trim(); if (t === '') return null; return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t; } return v; }
function linesRowSig(r) { return JSON.stringify(LINES_INFO_COLS.map(c => _lnNorm(r ? r[c] : undefined))); }
function validateLinesRows(data) {
  if (!Array.isArray(data) || !data.length) return 'empty_refused';
  if (data.length > 300) return 'too_many';
  const seen = new Set();
  for (const r of data) {
    const i = r && r.idx;
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 1 || i > LINES_IDX_MAX || seen.has(i)) return 'bad_idx';
    seen.add(i);
    if (!r || typeof r.name !== 'string' || !r.name.trim()) return 'bad_rows';
  }
  return null;
}
// رقم صف جديد: أكبر idx صالح موجود + 1؛ عند بلوغ السقف نأخذ أصغر رقم شاغر؛ null = النطاق مستنفد
function allocateLineIdx(data) {
  const used = new Set(); let max = 0;
  (data || []).forEach(r => { const v = r && r.idx; if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= LINES_IDX_MAX) { used.add(v); if (v > max) max = v; } });
  if (max < LINES_IDX_MAX) return max + 1;
  for (let i = 1; i <= LINES_IDX_MAX; i++) if (!used.has(i)) return i;
  return null;
}
const LINES_SAVE_MSG = {
  network: 'لا يوجد اتصال بالإنترنت',
  session_changed: 'تغيّر الحساب أثناء الحفظ — لم يُحفظ شيء',
  invalid_session: 'انتهت الجلسة — سجّل الدخول ثم أعد المحاولة',
  forbidden: 'ما عندك صلاحية لهذا الإجراء',
  bad_idx: 'ترقيم الصفوف غير صالح (يجب 1 إلى 999999 بلا تكرار)',
  bad_rows: 'رفض الخادم بيانات الخط (راجع الاسم والقيم)',
  empty_refused: 'لا يمكن ترك جدول الخطوط فارغاً',
  too_many: 'عدد الخطوط أكبر من الحد المسموح',
  range_exhausted: 'استُنفد نطاق الترقيم المسموح للخطوط',
  row_missing: 'هذا الخط لم يعد موجوداً على الخادم (حذفه مدير آخر) — حُدّثت القائمة',
  row_changed: 'هذا الخط تغيّر على الخادم منذ فتح النموذج (مدير آخر) — حُدّثت القائمة؛ راجع القيم ثم اضغط "حفظ" مرة أخرى للمتابعة',
  conflict: 'تغيّرت قائمة الخطوط على الخادم أثناء الحفظ (مدير آخر) — لم يُكتب شيء وحُدّثت القائمة؛ راجع ثم اضغط "حفظ" مرة أخرى',
  baseline_failed: 'تعذّر جلب قائمة الخطوط المرجعية من الخادم — لم يُرسل أي تعديل',
  no_baseline: 'لا يوجد خط أساس موثوق للحفظ'
};
function linesSaveMsg(code) { return LINES_SAVE_MSG[code] || ('تعذّر الحفظ (' + (code || 'خطأ') + ')'); }

// خط الأساس الموثوق: صفوف الخادم + نسخة الجدول (جلسة موثّقة، مدير فقط)
async function linesFetchBaseline() {
  let out;
  try { out = await csCall('app_lines_info_read', {}, { keepalive: false, timeout: 60000 }); } catch (e) { return { ok: false, code: 'network' }; }
  if (!out) return { ok: false, code: 'baseline_failed' };
  if (out.stale) return { ok: false, code: 'session_changed' };
  if (out.net) return { ok: false, code: 'network' };
  if (out.ok !== true || !Array.isArray(out.rows) || typeof out.version !== 'string' || !out.version) return { ok: false, code: (out.ok === false && (out.code === 'invalid_session' || out.code === 'forbidden')) ? out.code : 'baseline_failed' };   // أي فشل آخر (HTTP/شكل غير متوقع) = لا خط أساس موثوق
  return { ok: true, rows: out.rows, version: out.version };
}
// قائمة الخادم المؤكَّدة تحلّ محل الكاش المحلي (بعد تعارض/تغيّر صف) إن بقيت الجلسة نفسها
function linesPublishBaseline(rows, sess) {
  if (_csAuthGen !== sess) return;
  linesInfoCache = rows;
  try { const v = document.getElementById('linesInfoView'); if (v && v.style.display !== 'none') renderLinesInfo(); } catch (e) {}
}
// استبدال الجدول كله بشرط نسخة الأساس؛ لا يلمس الكاش إلا بعد تأكيد الخادم
async function saveLinesInfoData(data, expectedVersion) {
  if (typeof expectedVersion !== 'string' || !expectedVersion) return { ok: false, code: 'no_baseline' };
  const bad = validateLinesRows(data);
  if (bad) return { ok: false, code: bad };
  const rows = data.map(r => { const o = {}; LINES_INFO_COLS.forEach(c => { if (r && r[c] !== undefined) o[c] = r[c]; }); return o; });
  let out;
  try {
    // v335-C5: استبدال ذري بمعاملة واحدة على الخادم (كان: DELETE للكل ثم POST). مدير فقط.
    out = await csCall('app_lines_info_replace', { p_rows: rows, p_expected_version: expectedVersion }, { keepalive: false, timeout: 120000 });
  } catch (e) { return { ok: false, code: 'network' }; }
  if (!out) return { ok: false, code: 'failed' };
  if (out.stale) return { ok: false, code: 'session_changed' };
  if (out.net) return { ok: false, code: 'network' };
  if (out.ok !== true) return { ok: false, code: out.code || 'failed' };
  linesInfoCache = data;   // مؤكَّد من الخادم فقط
  return { ok: true, version: out.version };
}
// ---- هوية العمليات: عملية كتابة واحدة بالمرة؛ لكل واحدة جيل نموذج وجيل جلسة
let _linesOp = null, _linesOpSeq = 0;
let _linesWriteBusy = false;   // انعكاس لـ _linesOp !== null (للقراءة فقط)
let _lineFormSeq = 0;          // يزداد عند كل فتح لنموذج الخط
let _lineFormOpen = { editIdx: null, openSig: null };   // هوية النموذج المفتوح: صف الخادم المعدَّل وبصمة قيمه وقت الفتح
function linesOpBegin(kind) {
  if (_linesOp) return null;
  const op = { id: ++_linesOpSeq, kind, gen: _lineFormSeq, sess: _csAuthGen };
  _linesOp = op; _linesWriteBusy = true;
  const b = document.getElementById('lm_save_btn'); if (b && kind === 'save') b.disabled = true;
  return op;
}
function linesOpEnd(op) {
  if (_linesOp !== op) return;
  _linesOp = null; _linesWriteBusy = false;
  const b = document.getElementById('lm_save_btn'); if (b) b.disabled = false;
}
const linesOpLive = (op) => _csAuthGen === op.sess;
function linesOpFormOpen(op) { const m = document.getElementById('lineModal'); return op.gen === _lineFormSeq && !!m && m.style.display !== 'none'; }

let editingLineIdx = null;

function openAddLineModalImpl() {
  editingLineIdx = null; _lineFormSeq++; _lineFormOpen = { editIdx: null, openSig: null };
  document.getElementById('lineModalTitle').textContent = 'إضافة خط جديد';
  ['lm_name','lm_length','lm_towers','lm_tension','lm_capacity','lm_wire','lm_ground','lm_year','lm_notes','lm_tw_from','lm_tw_to'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  document.getElementById('lm_voltage').value = '132';
  document.getElementById('lm_status').value = 'بالعمل';
  // تخمين مبدئي فقط (يُعاد ضبطه تلقائياً بمجرد كتابة اسم الخط — انظر lm_name's oninput أدناه)
  document.getElementById('lm_circuit_count').value = '1';
  document.getElementById('lm_chain_mode').value = 'double';
  _editingLineTowersList = [];
  renderLineTowersEditor();
  document.getElementById('lineModal').style.display = '';
  { const sb = document.getElementById('lm_save_btn'); if (sb) sb.disabled = !!_linesOp; }
}

// تخمين ذكي لعدد الدوائر حسب اسم الخط — بدون هذا، أي خط مزدوج الدائرة (اسمه فيه "1+2" أو موجود
// بقائمة الخطوط المزدوجة) كان يُحفظ افتراضياً بدائرة وحدة لو استُخدمت شاشة "إضافة خط جديد" بالغلط
// بدل "تعديل" — وهذا بالضبط السبب اللي خفى الدائرة الثانية عن كل أبراج خط "دبوني - جصان" سابقاً
function guessCircuitCountFromName(name) {
  if (!name) return null;
  if (DOUBLE_CIRCUIT_LINES.includes(name)) return 2;
  if (/\(\s*1\s*\+\s*2\s*\)/.test(name)) return 2;
  return null;
}

(() => {   // v335-C5r9: الوحدة تُحمَّل بعد DOMContentLoaded؛ يُربط المستمع فوراً بعد تركيب النافذة
  const nameInput = document.getElementById('lm_name');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      if (editingLineIdx !== null) return; // ما نغيّر شي وقت التعديل، بس وقت إضافة خط جديد
      const guess = guessCircuitCountFromName(nameInput.value.trim());
      if (guess) {
        document.getElementById('lm_circuit_count').value = String(guess);
        document.getElementById('lm_chain_mode').value = 'double';
      }
    });
  }
})();

function editLineImpl(idx) {
  const data = getLinesInfoData(); const l = data[idx]; if(!l) return;
  editingLineIdx = idx; _lineFormSeq++; _lineFormOpen = { editIdx: l.idx, openSig: linesRowSig(l) };
  document.getElementById('lineModalTitle').textContent = 'تعديل بيانات الخط';
  document.getElementById('lm_name').value = l.name||'';
  document.getElementById('lm_voltage').value = String(l.voltage||132);
  document.getElementById('lm_length').value = l.length||'';
  document.getElementById('lm_towers').value = l.towers||'';
  document.getElementById('lm_tension').value = l.tension_towers||'';
  document.getElementById('lm_capacity').value = l.capacity||'';
  document.getElementById('lm_wire').value = l.wire_type||'';
  document.getElementById('lm_ground').value = l.ground_wire||'';
  document.getElementById('lm_resp').value = l.responsibility||'الخط بالكامل';
  document.getElementById('lm_year').value = l.year||'';
  document.getElementById('lm_status').value = l.status||'بالعمل';
  document.getElementById('lm_notes').value = l.notes||'';
  // إعدادات الدائرة ونوع سلسلة العوازل — من الجدول المتزامن لو مضبوطة، وإلا نستنتجها من القوائم المدمجة بالكود
  const ov = getLineSettingsOverride(l.name) || {};
  document.getElementById('lm_circuit_count').value = ov.circuit_count != null ? String(ov.circuit_count) : (isDoubleCircuitLine(l.name) ? '2' : '1');
  document.getElementById('lm_chain_mode').value = ov.chain_mode || (isExcluded132Line(l.name) ? 'single' : 'double');
  // تحميل الأبراج الحالية (من الجدول المتزامن لو معدّلة سابقاً، وإلا من القائمة المدمجة بالكود)
  _editingLineTowersList = JSON.parse(JSON.stringify(getLineTowers(l.name)));
  document.getElementById('lm_tw_from').value = '';
  document.getElementById('lm_tw_to').value = '';
  renderLineTowersEditor();
  document.getElementById('lineModal').style.display = '';
  { const sb = document.getElementById('lm_save_btn'); if (sb) sb.disabled = !!_linesOp; }
}

async function deleteLineImpl(idx) {
  if (currentUser.role !== 'admin') { showToast('⛔ الحذف من صلاحيات المدير فقط', 'error'); return; }
  if (_linesOp) { showToast('⏳ عملية حفظ/حذف جارية — انتظر انتهاءها', 'error'); return; }
  const line = getLinesInfoData()[idx];
  if (!line) return;
  if (!confirm(`حذف الخط "${line.name}"؟\nسيُحذف معه قائمة أبراجه وإعداداته الفنية.\nملاحظة: الكشوفات والمغادرات المسجّلة سابقاً لا تُحذف.`)) return;
  const target = { idx: line.idx, name: line.name };
  const op = linesOpBegin('delete'); if (!op) return;
  let configGone = false;
  const fail = (code) => showToast('⚠️ لم يُحذف الخط «' + target.name + '»: ' + linesSaveMsg(code) + (configGone ? ' — حُذفت إعدادات الخط/أبراجه فقط، أعد المحاولة لإكمال الحذف' : ''), 'error');
  try {
    // خط الأساس الموثوق أولاً (قبل أي حذف لإعداد الخط): فشل قراءته = لا شيء يُرسل
    const bl = await linesFetchBaseline();
    if (!linesOpLive(op)) return;
    if (!bl.ok) { fail(bl.code); return; }
    const pos = bl.rows.findIndex(r => r && r.idx === target.idx && r.name === target.name);
    if (pos < 0) { linesPublishBaseline(bl.rows, op.sess); fail('row_missing'); return; }
    const next = bl.rows.filter((_, i) => i !== pos);
    const bad = validateLinesRows(next);
    if (bad) { fail(bad); return; }
    // v335-C4: إعداد الخط الخادمي يُحذف أولاً بـRPC (يُرفض إن كان لأبراجه حالة مسجَّلة)؛ فشله يوقف الحذف كله
    if (lineTowersCache[target.name] !== undefined || lineSettingsCache[target.name] !== undefined) {
      const r = await opsDeleteLineConfig(target.name);
      if (!linesOpLive(op)) return;
      if (!(r && r.ok === true)) { showToast('⚠️ لم يُحذف الخط «' + target.name + '»: ' + (OPS_CODE_MSG[r && r.code] || (r && r.code) || 'خطأ'), 'error'); return; }
      delete lineTowersCache[target.name];
      delete lineSettingsCache[target.name];
      configGone = true;
    }
    const res = await saveLinesInfoData(next, bl.version);
    if (!linesOpLive(op)) return;
    if (!res.ok) {
      if (res.code === 'session_changed') return;
      if (res.code === 'conflict') { const fresh = await linesFetchBaseline(); if (fresh.ok) linesPublishBaseline(fresh.rows, op.sess); }
      fail(res.code); return;
    }
    renderLinesInfo();
    showToast('🗑️ تم حذف الخط «' + target.name + '»');
  } finally { linesOpEnd(op); }
}

let _editingLineTowersList = [];

function generateLineTowersRange() {
  const from = parseInt(document.getElementById('lm_tw_from').value);
  const to = parseInt(document.getElementById('lm_tw_to').value);
  if (!from || !to || to < from) { showToast('⚠️ أدخل نطاقاً صحيحاً (من ≤ إلى)', 'error'); return; }
  if (to - from > 500) { showToast('⚠️ النطاق كبير جداً (حد أقصى 500 برج)', 'error'); return; }
  _editingLineTowersList = [];
  for (let n = from; n <= to; n++) _editingLineTowersList.push({ num: n, type: 'برج تعليق' });
  renderLineTowersEditor();
}

const LINE_TOWER_TYPE_OPTIONS = ['برج تعليق', 'برج شد', 'برج عبور', 'برج عبور اسفل الخط', 'برج نهائي', 'برج خاص'];

// يدرج برجاً جديداً مباشرة بعد رقم برج محدد، ويزيح كل الأبراج بعده رقماً واحداً — بدون هذا كانت
// الطريقة الوحيدة "تصفير القائمة وإعادة توليدها" اللي تمسح كل التخصيصات (نوع/مادة/استثناء) الموجودة
function insertLineTowerAndRenumber() {
  const afterNum = parseInt(document.getElementById('lm_insert_after').value);
  const newType = document.getElementById('lm_insert_type').value;
  if (!afterNum) { showToast('⚠️ أدخل رقم البرج اللي يُدرَج بعده', 'error'); return; }
  const idx = _editingLineTowersList.findIndex(t => t.num === afterNum);
  if (idx === -1) { showToast(`⚠️ ما لقيت برج رقم ${afterNum} بالقائمة الحالية`, 'error'); return; }
  // نزيح كل الأبراج اللي رقمها أكبر من afterNum رقماً واحداً للأمام (نبدأ من الآخر حتى لا يتصادم الترقيم بالمنتصف)
  for (let i = _editingLineTowersList.length - 1; i > idx; i--) {
    _editingLineTowersList[i].num += 1;
  }
  _editingLineTowersList.splice(idx + 1, 0, { num: afterNum + 1, type: newType });
  document.getElementById('lm_insert_after').value = '';
  renderLineTowersEditor();
  showToast(`✅ انضاف برج ${afterNum + 1} — وانزاحت كل الأبراج بعده رقماً واحداً. اضغط "حفظ" حتى يثبت التغيير`);
}

function renderLineTowersEditor() {
  const wrap = document.getElementById('lmTowersListWrap');
  const countEl = document.getElementById('lmTowersCount');
  countEl.textContent = _editingLineTowersList.length ? `إجمالي الأبراج: ${_editingLineTowersList.length}` : 'ما فيه أبراج مولّدة بعد';
  wrap.innerHTML = _editingLineTowersList.map((t, i) => `
    <div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:0.82rem;border-bottom:1px solid #F0F2F5;flex-wrap:wrap">
      <span style="min-width:56px;font-weight:700">برج ${t.num}</span>
      <select onchange="updateLineTowerType(${i}, this.value)" style="flex:1.2;padding:5px 6px;border-radius:6px;border:1px solid #ccc;font-family:inherit;font-size:0.78rem">
        ${LINE_TOWER_TYPE_OPTIONS.map(o => `<option ${o===t.type?'selected':''}>${o}</option>`).join('')}
      </select>
      <select onchange="updateLineTowerChainOverride(${i}, this.value)" title="استثناء نوع العوازل لهذا البرج فقط (اختياري)" style="flex:1;padding:5px 6px;border-radius:6px;border:1px solid #ccc;font-family:inherit;font-size:0.78rem">
        <option value="" ${!t.chain_override?'selected':''}>عوازل: افتراضي الخط</option>
        <option value="single" ${t.chain_override==='single'?'selected':''}>عوازل: مفرد</option>
        <option value="double" ${t.chain_override==='double'?'selected':''}>عوازل: مزدوج</option>
      </select>
      <select onchange="updateLineTowerMaterial(${i}, this.value)" title="نوع العازل الافتراضي — يفتح عليه الكشف الجديد تلقائياً" style="flex:1;padding:5px 6px;border-radius:6px;border:1px solid #ccc;font-family:inherit;font-size:0.78rem">
        <option value="glass" ${!t.material_default||t.material_default==='glass'?'selected':''}>مادة: زجاج (افتراضي)</option>
        <option value="plastic" ${t.material_default==='plastic'?'selected':''}>مادة: بلاستك</option>
        <option value="ceramic" ${t.material_default==='ceramic'?'selected':''}>مادة: خزف</option>
      </select>
    </div>`).join('') || '<div class="empty-state">ولّد نطاقاً أولاً</div>';
}

function updateLineTowerType(i, val) {
  if (_editingLineTowersList[i]) _editingLineTowersList[i].type = val;
}

function updateLineTowerChainOverride(i, val) {
  if (_editingLineTowersList[i]) _editingLineTowersList[i].chain_override = val || undefined;
}

function updateLineTowerMaterial(i, val) {
  if (_editingLineTowersList[i]) _editingLineTowersList[i].material_default = (val && val !== 'glass') ? val : undefined;
}

// لقطة مدخلات النموذج وقت الضغط: ثابتة طوال الطلب (لا تتأثر بما يُكتب أو يُفتح بعده)
function lineFormSnapshot(name) {
  const g = (id) => document.getElementById(id);
  return {
    gen: _lineFormSeq, name, editIdx: _lineFormOpen.editIdx, openSig: _lineFormOpen.openSig,
    circuitCount: parseInt(g('lm_circuit_count').value) || 1, chainMode: g('lm_chain_mode').value || 'double',
    towers: JSON.parse(JSON.stringify(_editingLineTowersList)),
    meta: {
      voltage: parseInt(g('lm_voltage').value), name: name, phase_swap: null,
      length: parseFloat(g('lm_length').value) || null, towers: parseInt(g('lm_towers').value) || null,
      tension_towers: parseInt(g('lm_tension').value) || null, capacity: parseInt(g('lm_capacity').value) || null,
      wire_type: g('lm_wire').value.trim(), ground_wire: g('lm_ground').value.trim(), responsibility: g('lm_resp').value,
      year: parseInt(g('lm_year').value) || null, status: g('lm_status').value, notes: g('lm_notes').value.trim()
    }
  };
}
function lineConfigChangedSnap(snap) {
  const st = lineSettingsCache[snap.name], tw = lineTowersCache[snap.name];
  if (!st || !tw) return true;
  return JSON.stringify(tw) !== JSON.stringify(snap.towers) || Number(st.circuit_count) !== snap.circuitCount || st.chain_mode !== snap.chainMode;
}
// v335-C4: الكتابة الوحيدة لإعدادات الخط/الأبراج هي RPC خادمي بجلسة موثّقة (يتطلب اتصالاً). v335-C5r11: الحمولة والكاش من لقطة الطلب نفسها لا من النموذج الحيّ
async function saveLineTowersToServer(snap, op) {
  const r = await opsSaveLineConfig(snap.name, snap.towers, snap.circuitCount, snap.chainMode, 'تعديل إعدادات الخط من واجهة الخطوط');
  if (!linesOpLive(op)) return { ok: false, silent: true };
  if (r && r.ok === true) {
    lineTowersCache[snap.name] = JSON.parse(JSON.stringify(snap.towers));
    lineSettingsCache[snap.name] = { circuit_count: snap.circuitCount, chain_mode: snap.chainMode };
    return { ok: true };
  }
  return { ok: false, msg: (OPS_CODE_MSG[r && r.code] || (r && r.code) || 'خطأ') };
}

function closeLineModal() { document.getElementById('lineModal').style.display = 'none'; }

async function saveLineModal() {
  if (_linesOp) return;   // نقر مزدوج/حفظ جارٍ: يُتجاهَل
  const name = document.getElementById('lm_name').value.trim();
  if (!name) { alert('يرجى إدخال اسم الخط'); return; }

  // تحذير أمان: اسم يدل على مزدوج الدائرة (1+2) بينما المحدد "دائرة وحدة"
  const circuitCountChosen = parseInt(document.getElementById('lm_circuit_count').value) || 1;
  const guess = guessCircuitCountFromName(name);
  if (guess === 2 && circuitCountChosen !== 2) {
    if (!confirm(`⚠️ اسم الخط "${name}" يدل على إنه مزدوج الدائرة (1+2)، بس محدد حالياً "دائرة وحدة" — هذا يخفي كشف الدائرة الثانية عن كل أبراج الخط.\n\nمتأكد تبي تكمل بـ"دائرة وحدة"؟`)) {
      return;
    }
  }
  const snap = lineFormSnapshot(name);
  const op = linesOpBegin('save'); if (!op) return;
  let configSaved = false;
  const report = (text) => {   // فشل: النافذة نفسها (إن بقيت) تحتفظ بمدخلاتها؛ غيرها يُذكر اسم الخط صراحةً
    const same = linesOpFormOpen(op);
    showToast('⚠️ لم تُحفظ بيانات الخط' + (same ? '' : ' «' + snap.name + '»') + ': ' + text + (configSaved ? ' — إعدادات الدوائر/الأبراج حُفظت على الخادم أصلاً' + (same ? '؛ اضغط "حفظ" لإعادة محاولة بيانات الخط' : '') : '') + (same ? ' — بقيت المدخلات كما هي' : ''), 'error');
  };
  try {
    // 1) خط الأساس الموثوق قبل أي تعديل (إعدادات أو بيانات): فشل القراءة = لا شيء يُرسل والنموذج يبقى
    const bl = await linesFetchBaseline();
    if (!linesOpLive(op)) return;
    if (!bl.ok) { report(linesSaveMsg(bl.code)); return; }
    // 2) موضع الصف/رقمه من قائمة الخادم لا من الكاش المحلي
    let pos = -1, newIdx = null;
    if (snap.editIdx !== null) {
      pos = bl.rows.findIndex(r => r && r.idx === snap.editIdx);
      if (pos < 0) { linesPublishBaseline(bl.rows, op.sess); report(linesSaveMsg('row_missing')); return; }
      const sig = linesRowSig(bl.rows[pos]);
      if (sig !== snap.openSig) {   // الصف تغيّر عند مدير آخر منذ فتح النموذج: نُطلع المستخدم والضغطة التالية متابعة صريحة
        linesPublishBaseline(bl.rows, op.sess);
        if (op.gen === _lineFormSeq) _lineFormOpen.openSig = sig;
        report(linesSaveMsg('row_changed')); return;
      }
    } else {
      newIdx = allocateLineIdx(bl.rows);
      if (newIdx === null) { report(linesSaveMsg('range_exhausted')); return; }
    }
    const entry = Object.assign({ idx: pos >= 0 ? bl.rows[pos].idx : newIdx }, snap.meta);
    const next = bl.rows.slice();
    if (pos >= 0) next[pos] = entry; else next.push(entry);
    const bad = validateLinesRows(next);
    if (bad) { report(linesSaveMsg(bad)); return; }
    // 3) إعدادات الدوائر/الأبراج (RPC منفصل) ثم بيانات الخط بشرط نسخة الأساس
    if (lineConfigChangedSnap(snap)) {
      if (!navigator.onLine) { showToast('⚠️ ' + OPS_CODE_MSG.offline, 'error'); return; }
      const cr = await saveLineTowersToServer(snap, op);
      if (!linesOpLive(op) || cr.silent) return;
      if (!cr.ok) { showToast('⚠️ لم تُحفظ إعدادات الخط/الأبراج: ' + cr.msg, 'error'); return; }
      configSaved = true;
    }
    const res = await saveLinesInfoData(next, bl.version);
    if (!linesOpLive(op)) return;
    if (!res.ok) {
      if (res.code === 'session_changed') return;   // ردّ متأخر لحساب سابق: لا يُعلَن شيء ولا يُكتب شيء
      if (res.code === 'conflict') { const fresh = await linesFetchBaseline(); if (fresh.ok) linesPublishBaseline(fresh.rows, op.sess); }
      report(linesSaveMsg(res.code)); return;
    }
    const same = linesOpFormOpen(op);
    if (same) closeLineModal();
    renderLinesInfo();
    showToast('تم حفظ بيانات الخط' + (same ? '' : ' «' + snap.name + '» (أُغلقت نافذته قبل وصول الرد)') + (snap.towers.length ? ` (${snap.towers.length} برج)` : ''));
  } finally { linesOpEnd(op); }
}

// ========================
// INSPECTION REVIEW SYSTEM (بدون قيد زمني — كل كشف سابق يظهر)
// ========================

// (previousInspectionForLoad / previousTreatmentsForLoad عُرِّفا أعلى الملف منذ v334)

(window.__featModules = window.__featModules || {}).ladm = true;
