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
        <div id="lm_legacy_insert">
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
          <button id="lm_insert_btn" class="btn btn-secondary btn-sm" onclick="insertLineTowerAndRenumber()">➕ إدراج وإعادة ترقيم</button>
        </div>
        </div>
        <div id="lm_topo_note" role="alert" style="display:none;margin-top:8px;padding:8px 10px;border-radius:8px;border-right:4px solid #DD6B20;background:#FFFAF0;color:#7B341E;font-size:0.8rem;line-height:1.7"></div>
        <div id="lm_topo_row" style="display:none;margin-top:8px"><button class="btn btn-primary btn-sm" onclick="openLineTopoPlanner()">🗄️ أرشيف الأبراج المُخرَجة وسجل تغييرات الترقيم</button></div>
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
  try { refreshInspectionLineSelect(); } catch (e) {}
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
  try { refreshInspectionLineSelect(); } catch (e) {}   // N25-R6n: الخط الجديد يظهر في «إضافة كشف» فور الحفظ
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
  editingLineIdx = null; _lineFormSeq++; _lineFormOpen = { editIdx: null, openSig: null }; _lineRows = null; _lineBaseNums = [];
  { const t = document.getElementById('lm_towers'); if (t) t.readOnly = false; }
  document.getElementById('lineModalTitle').textContent = 'إضافة خط جديد';
  ['lm_name','lm_length','lm_towers','lm_tension','lm_capacity','lm_wire','lm_ground','lm_year','lm_notes','lm_tw_from','lm_tw_to'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  document.getElementById('lm_voltage').value = '132';
  document.getElementById('lm_status').value = 'بالعمل';
  // تخمين مبدئي فقط (يُعاد ضبطه تلقائياً بمجرد كتابة اسم الخط — انظر lm_name's oninput أدناه)
  document.getElementById('lm_circuit_count').value = '1';
  document.getElementById('lm_chain_mode').value = 'double';
  _editingLineTowersList = [];
  renderLineTowersEditor();
  lmTopoSync();
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
  editingLineIdx = idx; _lineFormSeq++; _lineFormOpen = { editIdx: l.idx, openSig: linesRowSig(l), name: l.name || '', voltage: Number(l.voltage) || null };
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
  lmRowsInit();
  renderLineTowersEditor();
  lmTopoSync();
  document.getElementById('lineModal').style.display = '';
  { const sb = document.getElementById('lm_save_btn'); if (sb) sb.disabled = !!_linesOp; }
}

// N25-R6u: حذف خط = أرشفته على الخادم بعملية ذرّية واحدة (الأبراج بهوياتها وتاريخها وأرقامها السابقة تبقى بالأرشيف؛ إعداد الخط وصفّه يغادران القوائم التشغيلية في المعاملة نفسها).
// قبل التأكيد: معاينة الأثر من الخادم. تأكيد واحد + سبب. الانقطاع يُبقي النافذة والسبب؛ إعادة المحاولة تستعمل المعرّف نفسه فلا يتكرر الحذف.
const LINE_DEL_MSG = {
  line_voltage_mismatch: 'صف الخط المطلوب بجهدٍ آخر غير جهد هذا الخط (132/400) — لم يتغيّر شيء، حدّث قائمة الخطوط وأعد المحاولة', line_voltage_ambiguous: 'تعذّر إثبات جهد هذا الخط على الخادم (اسم مشترك بين 132 و400 ك.ف) — لم يتغيّر شيء', builtin_line_not_deletable: 'الخطوط المدمجة في التطبيق غير مدعومة بالحذف — لا يُحذف إلا خط أُضيف من التطبيق وله قائمة أبراج محفوظة',
  topology_gate_closed: 'بوابة تغيير الأبراج مغلقة على الخادم — لا يمكن حذف الخط الآن', line_not_found: 'الخط غير موجود على الخادم', line_info_mismatch: 'صف الخط تغيّر على الخادم — حدّث قائمة الخطوط ثم أعد المحاولة',
  impact_changed: 'تغيّر أثر الحذف منذ المعاينة — لم يُحذف شيء؛ أعد الحذف ليُعاد عرض الأثر', topology_busy: 'تغيير ترقيم جارٍ على الخادم — أعد المحاولة بعد قليل', line_delete_failed_rolled_back: 'تعذّر الحذف وأُلغيت العملية كاملة — لم يتغيّر شيء',
  op_id_reused: 'معرّف العملية استُخدم لطلب مختلف', forbidden: 'الحذف من صلاحيات المدير فقط', invalid_session: 'انتهت الجلسة — سجّل الدخول ثم أعد المحاولة', invalid: 'بيانات غير صالحة'
};
function _topoKeyFor(nm, v) {   // مفتاح الخط عند الخادم: الاسم المجرّد للخط المُهيَّأ، أو «الاسم + الجهد ك.ف» للخط المدمج
  if (!nm) return null;
  const cands = [nm + ' ' + v + ' ك.ف', nm, nm.replace(/\s*(400|132)\s*ك\.ف\s*$/, '').trim() + ' ' + v + ' ك.ف'];
  return cands.find(n => (typeof LINES_DATA !== 'undefined' && LINES_DATA[n]) || (lineTowersCache[n] && lineTowersCache[n].length)) || nm;
}
const _lineDelOps = {};   // معرّف عملية ثابت لكل (خط، أثر): إعادة المحاولة بعد انقطاع لا تكرر الحذف
async function deleteLineImpl(idx) {
  if (currentUser.role !== 'admin') { showToast('⛔ الحذف من صلاحيات المدير فقط', 'error'); return; }
  if (_linesOp || _atomicBusy) { showToast('⏳ عملية حفظ/حذف جارية — انتظر انتهاءها', 'error'); return; }
  const line = getLinesInfoData()[idx];
  if (!line) return;
  const target = { idx: line.idx, name: line.name, voltage: Number(line.voltage) || null };
  const key = _topoKeyFor(target.name, target.voltage);
  if (typeof LINES_DATA !== 'undefined' && (LINES_DATA[target.name] || LINES_DATA[target.name + ' ' + target.voltage + ' ك.ف'])) {
    showToast('⛔ «' + target.name + '» خط مدمج في التطبيق: لا يُحذف من القوائم (يمكن تعديل بياناته فقط). الحذف للخطوط المُضافة من شاشة «إضافة خط».', 'error'); return;
  }
  const fail = (msg) => showToast('⚠️ لم يُحذف الخط «' + target.name + '»: ' + msg, 'error');
  if (!navigator.onLine || !csLiveEnabled()) { fail('حذف الخط يُنفَّذ على الخادم بعملية واحدة ويحتاج اتصالاً — لم يتغيّر شيء'); return; }
  const info = { idx: target.idx };
  let prev;
  { const op = linesOpBegin('delete'); if (!op) return;
    try { prev = await csCall('app_line_delete_preview', { p_line_name: key, p_info: info }); } finally { linesOpEnd(op); } }
  if (!prev || prev.stale) return;
  if (prev.net || prev.code === 'network') { fail('لا يوجد اتصال بالخادم لمعاينة الأثر — لم يتغيّر شيء'); return; }
  if (!prev.facts) { fail(LINE_DEL_MSG[prev.code] || ('رفض الخادم (' + (prev.code || 'خطأ') + ')')); return; }
  const f = prev.facts, esc = _atEsc;
  if (prev.ok !== true) { opsAtomicModal({ title: '⛔ لا يمكن حذف هذا الخط الآن', bodyHtml: '<div style="color:#C53030">' + esc(LINE_DEL_MSG[prev.code] || prev.code) + '</div><p style="font-size:0.8rem;color:#4A5568;margin-top:8px">لم يتغيّر شيء.</p>', noConfirm: true }); return; }
  const body = '<p style="margin:0 0 8px">الخط: <b>' + esc(target.name) + '</b>' + (target.voltage ? ' — ' + target.voltage + ' ك.ف' : '') + '</p>' +
    '<div style="font-weight:700">الأثر على البيانات المرتبطة (يُنفَّذ بعملية واحدة أو لا شيء):</div><div style="font-size:0.85rem">' +
    '• الأبراج: ' + f.tower_count + (f.towers_with_state ? ' (منها ' + f.towers_with_state + ' لها حالة مسجَّلة)' : '') + ' — تُؤرشف بهوياتها الدائمة وأرقامها السابقة تحت «~retired~»؛ لا تُحذف<br>' +
    '• الكشف البصري: ' + f.inspections + ' سجل (' + f.inspection_days + ' يوم كشف)' + (f.unlinked_inspections ? ' + ' + f.unlinked_inspections + ' سجل قديم غير مربوط بهوية' : '') + ' — تبقى محفوظة<br>' +
    '• المعالجات: ' + f.treatments + ' — الكشف الحراري: ' + f.thermal + ' — المغادرات الطارئة: ' + f.departures + (f.telegrams ? ' — برقيات العمل: ' + f.telegrams : '') + ' — تبقى كلها محفوظة<br>' +
    '• إعداد الخط وقائمة أبراجه يُحذفان من القوائم التشغيلية، ويختفي الخط من كل قوائم الاختيار فور تأكيد الخادم</div>' +
    '<div style="font-size:0.8rem;color:#718096;margin-top:6px">سياسة الاعتماد: الحذف من صلاحيات المدير فقط ويُسجَّل باسمه وسببه. السجلات التاريخية لا تُحذف ولا تتغيّر.</div>';
  const mapKey = key + '|' + prev.hash;
  opsAtomicModal({ title: '🗑️ تأكيد حذف الخط', bodyHtml: body, confirmLabel: 'نعم، احذف الخط', reasonDefault: 'حذف خط من القوائم التشغيلية',
    run: async (reason) => {
      const opId = _lineDelOps[mapKey] || (_lineDelOps[mapKey] = genUUID());
      const op = linesOpBegin('delete'); if (!op) return { ok: false, msg: '⏳ عملية حفظ/حذف أخرى جارية' };
      let r;
      try { r = await csCall('app_line_delete', { p_op_id: opId, p_line_name: key, p_reason: reason, p_expected_hash: prev.hash, p_info: info }, { keepalive: false, timeout: 120000 }); }
      catch (e) { r = { ok: false, net: true }; }
      finally { linesOpEnd(op); }
      if (r && r.stale) return { ok: false, close: true };
      if (!r || r.net || r.code === 'network') return { ok: false, msg: '⚠️ انقطع الاتصال قبل وصول ردّ الخادم — لا يُعرف إن نُفّذ الحذف. اضغط التأكيد مرة أخرى: المعرّف ثابت فلا يتكرر الحذف، وسببك محفوظ هنا' };
      if (r.ok !== true) { if (r.code !== 'topology_busy') delete _lineDelOps[mapKey]; return { ok: false, msg: '⚠️ رفض الخادم الحذف ولم يتغيّر شيء: ' + (LINE_DEL_MSG[r.code] || r.code || 'خطأ') }; }
      delete _lineDelOps[mapKey];
      [key, target.name, target.name + ' ' + target.voltage + ' ك.ف'].forEach(n => { delete lineTowersCache[n]; delete lineSettingsCache[n]; });
      const bl = await linesFetchBaseline();
      if (bl.ok) linesPublishBaseline(bl.rows, op.sess); else { linesInfoCache = (linesInfoCache || []).filter(l => !(l && l.idx === target.idx && l.name === target.name)); }
      try { refreshInspectionLineSelect(); } catch (e) {}
      try { renderLinesInfo(); } catch (e) {}
      showToast('🗑️ حُذف الخط «' + target.name + '» (أُرشف ' + (r.archived_towers || 0) + ' برج — السجلات محفوظة)');
      return { ok: true };
    } });
}

let _editingLineTowersList = [];
let _lineRows = null, _lineBaseNums = [];   // N25-R6r: صفوف المحرر لخط قائم (أصلي/جديد/مُخرَج) — الحفظ مرة واحدة

// N25-R6: خطّ قائم له قائمة أبراج لا يُعاد ترقيمه من هنا: الحفظ بالرقم يفصل التاريخ عن هوية البرج (الخادم يرفضه بـ topology_managed). التغيير الوحيد المسموح هنا لقائمة قائمة: النوع/السلاسل/المادة (الأرقام ثابتة).
function _lineNumberingLocked() { return !!(_lineFormOpen && _lineFormOpen.editIdx !== null && _editingLineTowersList.length > 0); }
function lmNote(msg) {   // N25-R6p: رسالة ظاهرة داخل النافذة نفسها (الإشعار العائم كان يظهر خلفها فيبدو الزر «لا يفعل شيئاً»)
  const el = document.getElementById('lm_topo_note'); if (el) { el.textContent = msg; el.style.display = msg ? '' : 'none'; }
  try { if (msg) showToast(msg, 'error'); } catch (e) {}
}
function _lineNumberingBlockedMsg() { lmNote('⚠️ ترقيم أبراج خط قائم لا يتغير من هذه الشاشة: الحفظ بالرقم يفصل السجل التاريخي عن هوية البرج الدائمة. استخدم «🧭 إدارة ترقيم هذا الخط» أدناه: تعاين الإدراج/الإخراج على الخادم (قراءة فقط) ولا يُعتمد إلا عند جاهزية بوابة التغيير.'); }
// مفتاح الخط عند الخادم/المعاين: الاسم المجرّد للخط المُهيَّأ، أو «الاسم + الجهد ك.ف» للخط المدمج
function _lmTopoKey() {
  const nm = (_lineFormOpen && _lineFormOpen.name) || '', v = (_lineFormOpen && _lineFormOpen.voltage) || parseInt((document.getElementById('lm_voltage') || {}).value) || null;
  return _topoKeyFor(nm, v);
}
function lmTopoSync() {   // خط قائم: التحرير بالصفوف (➕ بعد البرج / 🗑 إخراج) والحفظ مرة واحدة؛ لا حقول إدراج قديمة
  const row = document.getElementById('lm_topo_row'), legacy = document.getElementById('lm_legacy_insert'), note = document.getElementById('lm_topo_note');
  const locked = _lineNumberingLocked();
  if (row) row.style.display = locked ? '' : 'none';
  if (legacy) legacy.style.display = locked ? 'none' : '';
  if (note) { note.style.display = locked ? '' : 'none'; note.style.borderRightColor = '#3182CE'; note.style.background = '#EBF8FF'; note.style.color = '#2A4365'; note.textContent = locked ? 'ℹ️ لإضافة برج اضغط ➕ بجانب البرج الذي يسبقه، ولإخراج برج اضغط 🗑. التغييرات تظهر هنا بالأرقام الجديدة، ولا تُعتمد إلا عند الضغط على «حفظ» (مرة واحدة): يُحدَّث الترقيم وعدد الأبراج معاً وتبقى هوية كل برج وسجلاته.' : ''; }
}
function openLineTopoPlanner(intent) {
  const key = _lmTopoKey(); if (!key) { lmNote('⚠️ تعذّر تحديد الخط — احفظ الخط أولاً أو أعد فتح النافذة.'); return; }
  if (!(currentUser && currentUser.role === 'admin')) { lmNote('⚠️ هذه الأداة للمدير فقط.'); return; }
  const opts = Object.assign({ volt: (_lineFormOpen && _lineFormOpen.voltage) || parseInt(document.getElementById('lm_voltage').value) || null }, intent || {});
  try { if (typeof FEAT_MODULE_SRC === 'object' && !FEAT_MODULE_SRC.topo) FEAT_MODULE_SRC.topo = './topology-admin.js'; } catch (e) {}
  return featRun(['topo'], () => topoOpenImpl(key, opts), 'topo');   // نافذة الخط تبقى مفتوحة بمدخلاتها تحت المعاين
}
function generateLineTowersRange() {
  if (_lineNumberingLocked()) { _lineNumberingBlockedMsg(); return; }
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
  if (_lineNumberingLocked()) {   // خط قائم: لا تعديل محلي بالأرقام — المدخلات تُنقل كما هي إلى معاين الترقيم المُدار (معاينة قراءة فقط)
    if (!afterNum) { lmNote('⚠️ أدخل رقم البرج الذي يُدرَج بعده.'); return; }
    if (!_editingLineTowersList.some(t => Number(t.num) === afterNum)) { lmNote('⚠️ لا يوجد برج رقم ' + afterNum + ' في قائمة هذا الخط (الأبراج ' + _editingLineTowersList[0].num + '–' + _editingLineTowersList[_editingLineTowersList.length - 1].num + ').'); return; }
    lmNote(''); return openLineTopoPlanner({ afterNum: afterNum, type: newType });
  }
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

// ---- N25-R6r: محرر الصفوف لخط قائم
function lmRowsInit() {
  if (!_lineNumberingLocked()) { _lineRows = null; _lineBaseNums = []; const t = document.getElementById('lm_towers'); if (t) t.readOnly = false; return; }
  _lineRows = _editingLineTowersList.map(t => ({ orig: String(t.num), type: t.type, chain_override: t.chain_override, material_default: t.material_default, removed: false }));
  _lineBaseNums = _lineRows.map(r => r.orig);
}
function lmSeq() {   // الترقيم الحالي تسلسلي؟ (شرط الترقيم التلقائي، كما يشترطه الخادم)
  const n = _lineBaseNums.map(x => /^[0-9]{1,9}$/.test(x) ? parseInt(x, 10) : null);
  if (!n.length || n.some(x => x === null)) return { ok: false };
  for (let i = 1; i < n.length; i++) if (n[i] !== n[i - 1] + 1) return { ok: false };
  return { ok: true, start: n[0] };
}
function lmProject() {   // الأرقام الجديدة للأبراج الباقية بالترتيب
  const sq = lmSeq(); let k = 0; const live = [];
  (_lineRows || []).forEach(r => { if (r.removed) r.proj = null; else { r.proj = sq.ok ? String(sq.start + k) : r.orig; k++; live.push(r); } });
  return { sq, count: live.length, live };
}
function lmDesiredTowers() {   // القائمة النهائية المتوقعة (أرقام جديدة + مواصفات الصفوف)
  const pr = lmProject(), base = new Map(_editingLineTowersList.map(t => [String(t.num), t]));
  return pr.live.map(r => { const o = r.orig != null ? JSON.parse(JSON.stringify(base.get(r.orig) || {})) : {}; o.num = isNaN(Number(r.proj)) ? r.proj : Number(r.proj); o.type = r.type;
    if (r.chain_override) o.chain_override = r.chain_override; else delete o.chain_override; if (r.material_default && r.material_default !== 'glass') o.material_default = r.material_default; else delete o.material_default; return o; });
}
function lmRowInsertAfter(i) {   // i = -1: في بداية الخط
  if (!_lineRows || !lmSeq().ok) return;
  _lineRows.splice(i + 1, 0, { orig: null, type: 'برج تعليق', removed: false }); renderLineTowersEditor();
}
function lmRowRemove(i) { const r = _lineRows && _lineRows[i]; if (!r || r.orig == null || !lmSeq().ok) return; r.removed = true; renderLineTowersEditor(); }
function lmRowUndo(i) { const r = _lineRows && _lineRows[i]; if (r) { r.removed = false; renderLineTowersEditor(); } }
function lmRowCancelNew(i) { const r = _lineRows && _lineRows[i]; if (r && r.orig == null) { _lineRows.splice(i, 1); renderLineTowersEditor(); } }
function lmTopoDirty() { return !!(_lineRows && _lineRows.some(r => r.orig == null || r.removed)); }

function renderLineTowersEditor() {
  const wrap = document.getElementById('lmTowersListWrap');
  const countEl = document.getElementById('lmTowersCount');
  if (_lineRows) return renderLineRowsEditor(wrap, countEl);
  countEl.textContent = _editingLineTowersList.length ? `إجمالي الأبراج: ${_editingLineTowersList.length}` : 'ما فيه أبراج مولّدة بعد';
  wrap.innerHTML = _editingLineTowersList.map((t, i) => lmSpecRowHtml(t, i, `<span style="min-width:56px;font-weight:700">برج ${t.num}</span>`, false, '')).join('') || '<div class="empty-state">ولّد نطاقاً أولاً</div>';
}
function lmSpecRowHtml(t, i, head, dis, tail) {
  const d = dis ? ' disabled' : '';
  return `
    <div class="lm-row" style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:0.82rem;border-bottom:1px solid #F0F2F5;flex-wrap:wrap${dis ? ';opacity:0.5' : ''}">
      ${head}
      <select${d} onchange="updateLineTowerType(${i}, this.value)" style="flex:1.2;padding:5px 6px;border-radius:6px;border:1px solid #ccc;font-family:inherit;font-size:0.78rem">
        ${LINE_TOWER_TYPE_OPTIONS.map(o => `<option ${o===t.type?'selected':''}>${o}</option>`).join('')}
      </select>
      <select${d} onchange="updateLineTowerChainOverride(${i}, this.value)" title="استثناء نوع العوازل لهذا البرج فقط (اختياري)" style="flex:1;padding:5px 6px;border-radius:6px;border:1px solid #ccc;font-family:inherit;font-size:0.78rem">
        <option value="" ${!t.chain_override?'selected':''}>عوازل: افتراضي الخط</option>
        <option value="single" ${t.chain_override==='single'?'selected':''}>عوازل: مفرد</option>
        <option value="double" ${t.chain_override==='double'?'selected':''}>عوازل: مزدوج</option>
      </select>
      <select${d} onchange="updateLineTowerMaterial(${i}, this.value)" title="نوع العازل الافتراضي — يفتح عليه الكشف الجديد تلقائياً" style="flex:1;padding:5px 6px;border-radius:6px;border:1px solid #ccc;font-family:inherit;font-size:0.78rem">
        <option value="glass" ${!t.material_default||t.material_default==='glass'?'selected':''}>مادة: زجاج (افتراضي)</option>
        <option value="plastic" ${t.material_default==='plastic'?'selected':''}>مادة: بلاستك</option>
        <option value="ceramic" ${t.material_default==='ceramic'?'selected':''}>مادة: خزف</option>
      </select>${tail}
    </div>`;
}
function renderLineRowsEditor(wrap, countEl) {
  const pr = lmProject(), nNew = _lineRows.filter(r => r.orig == null).length, nRem = _lineRows.filter(r => r.orig != null && r.removed).length, ok = pr.sq.ok;
  countEl.textContent = `إجمالي الأبراج بعد الحفظ: ${pr.count}` + (nNew || nRem ? ` (إضافة ${nNew} • إخراج ${nRem} — لم يُحفظ بعد)` : '');
  const tw = document.getElementById('lm_towers'); if (tw) { tw.value = String(pr.count); tw.readOnly = true; }
  const b = 'border:1px solid #CBD5E0;background:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;font-family:inherit;font-size:0.8rem';
  let h = ok ? `<div style="padding:2px 0 6px"><button type="button" style="${b}" onclick="lmRowInsertAfter(-1)">➕ إضافة برج في بداية الخط</button></div>` : '<div style="color:#C05621;font-size:0.78rem;padding:4px 0">⚠️ أرقام هذا الخط غير متسلسلة: الإدراج/الإخراج التلقائي غير مدعوم (يلزم قرار المالك).</div>';
  h += _lineRows.map((r, i) => {
    const isNew = r.orig == null;
    const label = r.removed ? `<span style="min-width:56px;font-weight:700;text-decoration:line-through">كان برج ${r.orig}</span><span style="font-size:0.72rem;color:#C53030">سيُخرَج للأرشيف</span>`
      : `<span style="min-width:56px;font-weight:700">برج ${r.proj}</span>` + (isNew ? '<span style="background:#C6F6D5;color:#22543D;border-radius:10px;padding:1px 8px;font-size:0.72rem">جديد</span>' : (r.proj !== r.orig ? `<span style="font-size:0.72rem;color:#718096">كان ${r.orig}</span>` : ''));
    let tail = '';
    if (r.removed) tail = `<button type="button" style="${b}" onclick="lmRowUndo(${i})">↩ تراجع</button>`;
    else { if (isNew) tail += `<button type="button" style="${b}" title="إلغاء هذا البرج الجديد" onclick="lmRowCancelNew(${i})">✖</button>`; else if (ok) tail += `<button type="button" style="${b}" title="إخراج هذا البرج من الخدمة (يُؤرشف بسجلاته)" onclick="lmRowRemove(${i})">🗑</button>`; if (ok) tail += `<button type="button" style="${b}" title="إضافة برج جديد بعد هذا البرج" onclick="lmRowInsertAfter(${i})">➕</button>`; }
    return lmSpecRowHtml(r, i, label, r.removed, tail);
  }).join('');
  wrap.innerHTML = h;
}

function updateLineTowerType(i, val) {
  const t = _lineRows ? _lineRows[i] : _editingLineTowersList[i]; if (t) t.type = val;
}

function updateLineTowerChainOverride(i, val) {
  const t = _lineRows ? _lineRows[i] : _editingLineTowersList[i]; if (t) t.chain_override = val || undefined;
}

function updateLineTowerMaterial(i, val) {
  const t = _lineRows ? _lineRows[i] : _editingLineTowersList[i]; if (t) t.material_default = (val && val !== 'glass') ? val : undefined;
}


function _lmSameList(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const n = (t) => [String(t.num), t.type || '', t.chain_override || '', t.material_default || 'glass'].join('|');
  return a.every((t, i) => n(t) === n(b[i]));
}
function _lmPendRead() { try { const o = JSON.parse(localStorage.getItem('topo_pending_v1') || 'null'); return o && o.opId ? o : null; } catch (e) { return null; } }
function _lmDirtySnap(snap) { return !!(snap.rows && snap.rows.some(r => r.orig == null || r.removed)); }
function lmTopoSave(snap, resume) {   // الإدراج/الإخراج + عدد الأبراج: نداء ذرّي واحد (app_line_edit_apply) عبر وحدة الترقيم
  try { if (typeof FEAT_MODULE_SRC === 'object' && !FEAT_MODULE_SRC.topo) FEAT_MODULE_SRC.topo = './topology-admin.js'; } catch (e) {}
  const ctx = { line: snap.topoKey, baseNums: snap.baseNums, rows: snap.rows, info: { idx: snap.editIdx, tension_towers: snap.meta.tension_towers == null ? null : snap.meta.tension_towers }, circuit_count: snap.circuitCount, chain_mode: snap.chainMode, resume: !!resume };
  return Promise.resolve(featRun(['topo'], () => topoSaveFromEditor(ctx), 'topo')).then(r => r || { ok: false, msg: 'تعذّر تحميل أداة الترقيم — لم يُحفظ شيء.' });
}
function lmResyncAfterTopo(snap, freshRow) {   // بعد نجاح الحفظ الذرّي: المحرر يعكس حالة الخادم الجديدة (بلا تعديلات مرحلية)
  if (snap.gen !== _lineFormSeq) return;
  _editingLineTowersList = JSON.parse(JSON.stringify(snap.towers));
  if (freshRow) { _lineFormOpen.openSig = linesRowSig(freshRow); }
  lmRowsInit(); renderLineTowersEditor(); lmTopoSync();
}

// لقطة مدخلات النموذج وقت الضغط: ثابتة طوال الطلب (لا تتأثر بما يُكتب أو يُفتح بعده)
function lineFormSnapshot(name) {
  const g = (id) => document.getElementById(id);
  return {
    gen: _lineFormSeq, name, editIdx: _lineFormOpen.editIdx, openSig: _lineFormOpen.openSig,
    circuitCount: parseInt(g('lm_circuit_count').value) || 1, chainMode: g('lm_chain_mode').value || 'double',
    towers: _lineRows ? lmDesiredTowers() : JSON.parse(JSON.stringify(_editingLineTowersList)),
    rows: _lineRows ? JSON.parse(JSON.stringify(_lineRows)) : null, baseNums: _lineRows ? _lineBaseNums.slice() : null, topoKey: _lineRows ? _lmTopoKey() : null,
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
  const same = snap.rows ? _lmSameList(tw, snap.towers) : JSON.stringify(tw) === JSON.stringify(snap.towers);   // N25-R6r: خط قائم — مقارنة دلالية (رقم/نوع/استثناء/مادة) لا بالترتيب النصي
  return !same || Number(st.circuit_count) !== snap.circuitCount || st.chain_mode !== snap.chainMode;
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
    // N25-R6r: محرر الصفوف لخط قائم — أي إدراج/إخراج (أو عملية معلّقة سابقة) يُحفظ بنداء ذرّي واحد قبل بقية الحقول
    let baseline = bl, nextRows = next;
    if (snap.rows) {
      const pend = _lmPendRead(), dirty = _lmDirtySnap(snap);
      if (dirty || (pend && pend.kind === 'line_edit')) {
        const res0 = await lmTopoSave(snap, !!pend);
        if (!linesOpLive(op)) return;
        if (!res0.ok) { if (res0.cancelled) { showToast(res0.msg); return; } lmNote('⚠️ ' + res0.msg); return; }
        configSaved = true;     // الترقيم وعدد الأبراج محفوظان على الخادم
        const fresh = await linesFetchBaseline();
        if (!linesOpLive(op)) return;
        const fpos = fresh.ok ? fresh.rows.findIndex(r => r && r.idx === snap.editIdx) : -1;
        if (!fresh.ok || fpos < 0) { showToast('✅ حُفظ الترقيم وعدد الأبراج على الخادم، لكن تعذّر تحديث بقية البيانات — أعد فتح النافذة.', 'error'); closeLineModal(); return; }
        linesPublishBaseline(fresh.rows, op.sess);
        const srv = fresh.rows[fpos];
        if (pend && !dirty) { /* إكمال عملية معلّقة فقط: لا تعديلات مرحلية حالية */ }
        else if (pend && dirty) { lmResyncAfterTopo(snap, srv); lmNote('✅ اكتملت عملية الحفظ السابقة المعلّقة. ما أضفته/أخرجته الآن لم يُطبَّق (الأرقام تغيّرت) — أعد تنفيذه ثم احفظ.'); return; }
        const entry2 = Object.assign({ idx: srv.idx }, snap.meta, { towers: srv.towers });
        if (snap.meta.tension_towers == null) entry2.tension_towers = srv.tension_towers;
        nextRows = fresh.rows.slice(); nextRows[fpos] = entry2; baseline = fresh;
        lmResyncAfterTopo(snap, srv);
      }
    }
    // 3) إعدادات الدوائر/الأبراج (RPC منفصل) ثم بيانات الخط بشرط نسخة الأساس
    if (lineConfigChangedSnap(snap)) {
      if (!navigator.onLine) { showToast('⚠️ ' + OPS_CODE_MSG.offline, 'error'); return; }
      const cr = await saveLineTowersToServer(snap, op);
      if (!linesOpLive(op) || cr.silent) return;
      if (!cr.ok) { showToast('⚠️ لم تُحفظ إعدادات الخط/الأبراج: ' + cr.msg, 'error'); return; }
      configSaved = true;
    }
    const res = await saveLinesInfoData(nextRows, baseline.version);
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
