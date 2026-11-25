/* topology-admin.js — N25-R6
   إدارة ترقيم أبراج الخط (إدراج / إخراج من الخدمة «أرشفة» / إعادة ترقيم) + أرشيف الأبراج + تعديل مواصفات البرج (تصحيح).
   يُحمَّل عند الطلب فقط (featLoadModule 'topo'). سكربت كلاسيكي يشارك الربط العام مع index.html.

   القواعد التي يفرضها هذا الملف (والخادم يعيد فرضها: app_topology_preview / app_topology_apply / app_topology_recover — SQL58):
    • لا كتابة مباشرة لأي جدول. كل تعديل ترقيم = خطة واحدة تُعاين على الخادم (قراءة فقط) ثم تُعتمد بعملية واحدة ذرّية.
    • الهوية الدائمة tower_id: الخطة تشير إلى الأبراج القائمة بالهوية فقط (from_num فقط حين لا هوية)، والأبراج الجديدة new:true بلا هوية ولا حالة موروثة.
    • الاعتماد يرسل: p_op_id (يُحفظ قبل الإرسال ويُعاد نفسه عند إعادة المحاولة بعد ضياع الردّ)، p_expected_rev، p_plan_hash، p_plan، p_reason.
    • «حذف» = أرشفة: السجل التاريخي كله يبقى ويُفتح من الأرشيف بالهوية.
    • تُحجب الأزرار (لا مجرد تحذير) عند: بوابة الخادم مغلقة، خطة مرفوضة، قراءة الخادم تخالف الحساب المحلي، طابور محلي بلا هوية، بلا اتصال.
   الجزء النقي TopoPlan / TopoSpec يعمل في Node أيضاً (اختبارات). */
(function (root) {
  'use strict';

  // ======================================================================================= TopoPlan (نقي)
  const MAX_TOWERS = 1500, MAX_INSERT = 200;
  const pnum = (s) => (/^[0-9]{1,9}$/.test(String(s == null ? '' : s).trim()) ? parseInt(String(s).trim(), 10) : null);
  const keyOf = (t) => (t.tower_id ? String(t.tower_id) : 'n:' + String(t.num));

  function checkSequential(cur) {
    if (!Array.isArray(cur) || !cur.length) return { ok: false, code: 'empty_line' };
    const n = cur.map(t => pnum(t.num));
    if (n.some(x => x === null)) return { ok: false, code: 'non_numeric_numbers' };
    for (let i = 1; i < n.length; i++) if (n[i] !== n[i - 1] + 1) return { ok: false, code: 'non_sequential_numbers', at: String(cur[i].num) };
    const seen = new Set(cur.map(keyOf)); if (seen.size !== cur.length) return { ok: false, code: 'duplicate_identity' };
    return { ok: true, start: n[0] };
  }

  // cur: [{num,type,tower_id|null}] بترتيب الخط. ops: [{op:'insert', after:key|null, count, type, chain_override?, material_default?} | {op:'retire', key}]
  function build(cur, ops, settings) {
    const errors = [];
    const sq = checkSequential(cur);
    if (!sq.ok) return { ok: false, errors: [sq], plan: null, expected: [], summary: null };
    let work = cur.map(t => ({ key: keyOf(t), tower_id: t.tower_id || null, oldNum: String(t.num), type: t.type, retired: false, isNew: false }));
    (ops || []).forEach((o, i) => {
      if (!o || typeof o !== 'object') { errors.push({ code: 'bad_op', at: i }); return; }
      if (o.op === 'insert') {
        const cnt = Number(o.count);
        if (!Number.isInteger(cnt) || cnt < 1 || cnt > MAX_INSERT) { errors.push({ code: 'bad_count', at: i }); return; }
        if (!o.type || typeof o.type !== 'string') { errors.push({ code: 'type_required', at: i }); return; }
        let idx = 0;
        if (o.after != null) { idx = work.findIndex(w => w.key === o.after); if (idx < 0) { errors.push({ code: 'anchor_not_found', at: i }); return; } idx += 1; }
        const add = [];
        for (let k = 0; k < cnt; k++) add.push({ key: null, tower_id: null, oldNum: null, type: o.type, chain_override: o.chain_override || undefined, material_default: o.material_default || undefined, retired: false, isNew: true });
        work = work.slice(0, idx).concat(add, work.slice(idx));
      } else if (o.op === 'retire') {
        const w = work.find(x => x.key === o.key);
        if (!w) { errors.push({ code: 'retire_not_found', at: i }); return; }
        if (w.retired) { errors.push({ code: 'already_retired', at: i }); return; }
        w.retired = true;
      } else errors.push({ code: 'bad_op', at: i });
    });
    const live = work.filter(w => !w.retired);
    if (!live.length) errors.push({ code: 'empty_line_not_allowed' });
    if (live.length > MAX_TOWERS) errors.push({ code: 'too_many_towers' });
    if (errors.length) return { ok: false, errors, plan: null, expected: [], summary: null };

    const expected = [], towers = [], retire = [];
    let keep = 0, ren = 0, ins = 0;
    live.forEach((w, i) => {
      const num = String(sq.start + i);
      if (w.isNew) {
        const e = { new: true, num, type: w.type };
        if (w.chain_override) e.chain_override = w.chain_override;
        if (w.material_default) e.material_default = w.material_default;
        towers.push(e); expected.push({ action: 'insert', key: null, tower_id: null, old: null, new: num, type: w.type }); ins++;
      } else {
        towers.push(w.tower_id ? { tower_id: w.tower_id, num } : { from_num: w.oldNum, num });
        const act = w.oldNum === num ? 'keep' : 'renumber';
        if (act === 'keep') keep++; else ren++;
        expected.push({ action: act, key: w.key, tower_id: w.tower_id, old: w.oldNum, new: num, type: w.type });
      }
    });
    work.filter(w => w.retired).forEach(w => {
      retire.push(w.tower_id ? { tower_id: w.tower_id } : { from_num: w.oldNum });
      expected.push({ action: 'retire', key: w.key, tower_id: w.tower_id, old: w.oldNum, new: null, type: w.type });
    });
    const plan = { towers, retire };
    if (settings && settings.circuit_count && settings.chain_mode) plan.line_settings = { circuit_count: Number(settings.circuit_count), chain_mode: String(settings.chain_mode) };
    return { ok: true, errors: [], plan, expected, summary: { keep, renumber: ren, insert: ins, retire: retire.length, final_count: live.length, start: sq.start } };
  }

  // يقارن ما توقعته الواجهة بما أعاده الخادم (mapping). أي اختلاف = لا اعتماد.
  function crossCheck(expected, serverMapping) {
    const diffs = [];
    if (!Array.isArray(serverMapping)) return { ok: false, diffs: [{ code: 'no_server_mapping' }] };
    const idx = (m) => (m.tower_id ? String(m.tower_id) : 'n:' + String(m.old_num));
    const srv = new Map(); const srvIns = [];
    serverMapping.forEach(m => { if (m.action === 'insert') srvIns.push(String(m.new_num)); else srv.set(idx(m), m); });
    const expIns = [];
    expected.forEach(e => {
      if (e.action === 'insert') { expIns.push(String(e.new)); return; }
      const m = srv.get(e.key);
      if (!m) { diffs.push({ code: 'missing_in_server', key: e.key, old: e.old }); return; }
      if (m.action !== e.action) diffs.push({ code: 'action_differs', old: e.old, client: e.action, server: m.action });
      if (String(m.new_num == null ? '' : m.new_num) !== String(e.new == null ? '' : e.new)) diffs.push({ code: 'number_differs', old: e.old, client: e.new, server: m.new_num });
      srv.delete(e.key);
    });
    if (srv.size) diffs.push({ code: 'extra_in_server', n: srv.size });
    if (expIns.slice().sort().join() !== srvIns.slice().sort().join()) diffs.push({ code: 'inserts_differ', client: expIns, server: srvIns });
    return { ok: diffs.length === 0, diffs };
  }

  // ======================================================================================= TopoSpec (نقي)
  const SPEC_FIELDS = ['type', 'chain_override', 'material_default'];
  const MATERIALS = ['glass', 'plastic', 'ceramic'];
  const CHAINS = ['', 'single', 'double'];
  // list: towers من الخادم (كما هي). يغيّر برجاً واحداً فقط ويُبقي الباقي حرفياً. لا يمسّ الأرقام ولا الترتيب.
  function specApply(list, num, changes, typeOptions) {
    if (!Array.isArray(list)) return { ok: false, code: 'no_list' };
    const i = list.findIndex(t => String(t.num) === String(num));
    if (i < 0) return { ok: false, code: 'tower_not_in_configuration' };
    const c = changes || {}, bad = Object.keys(c).filter(k => SPEC_FIELDS.indexOf(k) < 0);
    if (bad.length) return { ok: false, code: 'field_not_allowed', fields: bad };
    if ('type' in c && (!c.type || (Array.isArray(typeOptions) && typeOptions.indexOf(c.type) < 0))) return { ok: false, code: 'type_invalid' };
    if ('chain_override' in c && CHAINS.indexOf(c.chain_override || '') < 0) return { ok: false, code: 'chain_override_invalid' };
    if ('material_default' in c && c.material_default && MATERIALS.indexOf(c.material_default) < 0) return { ok: false, code: 'material_invalid' };
    const before = list[i], after = Object.assign({}, before);
    SPEC_FIELDS.forEach(k => {
      if (!(k in c)) return;
      const v = c[k];
      if (k === 'chain_override') { if (v) after[k] = v; else delete after[k]; }
      else if (k === 'material_default') { if (v && v !== 'glass') after[k] = v; else delete after[k]; }   // glass = الافتراضي: لا يُخزَّن (كما في محرر الخط)
      else after[k] = v;
    });
    const changed = SPEC_FIELDS.filter(k => (before[k] || '') !== (after[k] || ''));
    const out = list.map((t, j) => (j === i ? after : t));
    return { ok: true, list: out, before, after, changed };
  }
  // أثر مبدئي (تقديري) لعرضه قبل الحفظ؛ القرار النهائي للخادم (geometry_change_not_correctable).
  function specImpact(before, after, circuits) {
    const imp = [];
    if ((before.type || '') !== (after.type || '')) imp.push({ field: 'type', geometry: true });
    if ((before.chain_override || '') !== (after.chain_override || '')) imp.push({ field: 'chain_override', geometry: true });
    if ((before.material_default || '') !== (after.material_default || '')) imp.push({ field: 'material_default', geometry: false });
    return { items: imp, geometry: imp.some(x => x.geometry), circuits: Number(circuits) === 2 ? 2 : 1 };
  }

  const api = { build, crossCheck, checkSequential, specApply, specImpact, keyOf, SPEC_FIELDS, MATERIALS, MAX_TOWERS };
  root.TopoPlan = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;      // Node: الجزء النقي فقط

  // ======================================================================================= الواجهة
  const _te = (v) => (typeof escapeHtml === 'function' ? escapeHtml(v == null ? '' : String(v)) : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const PEND_KEY = 'topo_pending_v1';
  // الأنواع المقبولة = تلك التي يعرفها الخادم لجهد الخط (tower_cs.type_code في مرحلة 1B): لا أنواع جديدة. الجهد من اسم الخط كما يفعل الخادم (name_voltage).
  const T132 = ['برج تعليق', 'برج شد', 'برج عبور', 'برج عبور اسفل الخط', 'برج نهائي', 'برج خاص'], T400 = ['برج تعليق', 'برج عبور', 'برج شد', 'برج نهائي', 'برج تبادل أطوار'];
  const lineVolt = (line) => { const m = /(400|132)\s*ك\.ف\s*$/.exec(String(line || '')); return m ? Number(m[1]) : null; };
  const TYPES = () => (S && (S.volt || lineVolt(S.line)) === 400 ? T400 : T132);   // N25-R6p: خط مُهيَّأ باسمه المجرّد بلا لاحقة جهد: الجهد يأتي ممّن فتح الأداة (نافذة الخط / بيانات الخطوط)

  const MSG = {
    topology_gate_closed: 'بوابة تغيير الترقيم على الخادم مغلقة — لا يمكن الاعتماد الآن. المعاينة متاحة للقراءة فقط.',
    stale_topology_revision: 'تغيّر ترقيم هذا الخط منذ المعاينة. حدّث المعاينة ثم أعد المحاولة (لم يُغيَّر شيء).',
    topology_unresolved: 'الخط فيه سجلات/هويات غير محسومة تمنع تغيير الترقيم (انظر قائمة المانعات). لم يُغيَّر شيء.',
    plan_invalid: 'الخطة مرفوضة من الخادم (انظر الأخطاء). لم يُغيَّر شيء.',
    plan_hash_mismatch: 'الخطة تغيّرت عمّا عاينه الخادم. أعد المعاينة ثم اعتمد. لم يُغيَّر شيء.',
    stale_config: 'تغيّرت تهيئة الخط على الخادم منذ فتح النافذة (تعديل آخر). أعد فتح النافذة ثم أعد التصحيح — لم يُحفظ شيء.',
    no_change: 'لا تغيير في المواصفات.', type_invalid: 'نوع البرج غير صالح لجهد هذا الخط.', metadata_change_not_allowed: 'هذا الحقل لا يُغيَّر بالتصحيح.',
    tower_retired: 'هذا البرج مُخرَج من الخدمة (مؤرشف).', stale_topology_identity: 'هوية البرج لم تعد مرتبطة بهذا الخط. أعد فتح النافذة.', tower_not_in_config: 'البرج غير موجود في تهيئة الخط الحالية.', ambiguous_config: 'تهيئة الخط فيها رقم مكرر — لا تصحيح.', no_stored_configuration: 'الخط بلا تهيئة مخزَّنة.', config_refused: 'رفض الخادم التصحيح لهذا البرج.', geometry_change_not_correctable: 'هذا التغيير يغيّر هندسة العوازل ولهذا البرج حالة عوازل محفوظة: لا يُسمح به كتصحيح لأنه لا يحفظ الأضرار وروابط المعالجة بأمان. يلزم حدث «استبدال معدّات» مؤرَّخ (معلّق). لم يُحفظ شيء.', spec_correction_protected: 'مواصفات هذا البرج صُحِّحت سابقاً ولا تُستبدل بحفظ قديم. أعد فتح النافذة.',
    topology_busy: 'الخادم مشغول بعملية أخرى على هذا الخط. أعد المحاولة بعد قليل (لم يُغيَّر شيء).',
    topology_failed_rolled_back: 'فشلت العملية في الخادم وأُلغيت كلها (لم يُغيَّر شيء).',
    line_edit_failed_rolled_back: 'تعذّر تحديث الأبراج وعددها معاً فأُلغي الحفظ كله على الخادم (لم يُغيَّر شيء).',
    op_id_reused: 'معرّف العملية استُخدم لطلب مختلف. ابدأ من معاينة جديدة.',
    invalid: 'بيانات غير صالحة (السبب مطلوب 3 أحرف على الأقل).', forbidden: 'ليست لديك صلاحية لهذا الإجراء (للمدير فقط).',
    invalid_session: 'انتهت الجلسة — سجّل الدخول من جديد.', session_changed: 'تغيّرت الجلسة أثناء الطلب — لم يُعتمد شيء.',
    unknown_line: 'خط غير معروف للخادم.', later_data_exists: 'لا يمكن التراجع: كُتبت بيانات بعد هذا التغيير. لم يُغيَّر شيء.',
    offline: 'لا يوجد اتصال — هذه العملية تتطلب اتصالاً بالخادم.', network: 'تعذّر الاتصال بالخادم أو لم يصل الردّ. إن كنت اعتمدت للتو فأعد المحاولة بنفس العملية (آمنة).',
    bad_response: 'ردّ غير مفهوم من الخادم.', mapping_required: 'تغيير المواصفات يحتاج قرار مراجعة لمواضع محفوظة.', topology_managed: 'تغيير الأرقام لا يتم إلا عبر إدارة الترقيم.',
    geometry_change_not_correctable: 'لا يُقبل كتصحيح: التعديل يغيّر هندسة عوازل لها حالة محفوظة، ولا يمكن حفظ حالتها وروابط معالجتها بأمان. لم يُحفظ أي شيء. يلزم حدث «استبدال معدّات» مؤرَّخ (مرحلة لاحقة منفصلة).',
    stale_state_revision: 'تغيّرت حالة هذا البرج على الخادم منذ قراءتها (كشف/معالجة/عملية أخرى). حُدِّثت القراءة — راجع الأثر ثم احفظ من جديد. لم يُحفظ شيء.',
    event_date_in_future: 'تاريخ الاستبدال في المستقبل.', invalid_date: 'تاريخ الاستبدال غير صالح.', nothing_selected: 'لم يُحدَّد شيء للاستبدال.',
    component_not_applicable: 'موضع غير مطبّق/غير محسوم لهذا البرج لا يُستبدل.', no_tower_state: 'لا توجد حالة مخزّنة لهذا البرج بعد (لا كشف ولا تهيئة) — لا يُسجَّل عليه استبدال.',
    event_before_later_evidence: 'يوجد كشف أو معالجة أحدث من تاريخ الاستبدال على المواضع نفسها؛ لا يُسجَّل الاستبدال قبلها. صحّح التاريخ أو راجع تلك السجلات.',
    state_required: 'اختر حالة كل معدّة مستبدلة: سليم / تالف / «ما فحصتها» (غير معروف فقط عند اختيارها صراحةً).', state_for_unselected: 'حالة لمعدّة غير مختارة للاستبدال.', invalid_state: 'حالة المعدّة غير صالحة (راجع الحقول المطلوبة).', invalid_positions: 'مواضع العوازل التالفة غير صالحة (أرقام صحيحة ضمن عدد مواضع الطور).', severity_required: 'حدّد درجة خطورة العوازل التالفة.', geometry_unresolved_for_state: 'تخطيط العوازل غير محسوم؛ لا تُسجَّل حالة عوازل جديدة (اختر «ما فحصتها»).',
    event_before_later_replacement: 'سُجّل استبدال أحدث لنفس المعدّة بتاريخ لاحق؛ لا يُسجَّل استبدال مؤرَّخ قبله. صحّح التاريخ (المواضع المستقلة غير متأثرة).',
    geometry_not_allowed_in_insulator_scope: 'تغيير النوع/السلاسل يتم بمسار «استبدال البرج» لا باستبدال العوازل.', component_missing: 'القسم المطلوب غير موجود في حالة البرج.',
    geometry_map_unresolved: 'خريطة المواضع بعد تغيير الهندسة غير محسومة — لم يُحفظ شيء.',
    spec_correction_protected: 'مواصفات برج قائم لا تُعدَّل بحفظ قائمة كاملة؛ تُعدَّل بمسار التصحيح فقط. لم يُحفظ شيء.', no_stored_configuration: 'هذا الخط بلا تهيئة أبراج مخزَّنة — لا تُعدَّل مواصفات برج منه قبل حفظ تهيئة الخط.', server_error: 'خطأ في الخادم — أُلغيت العملية كلها ولم يُغيَّر شيء.'
  };
  const PLAN_ERR = {
    plan_malformed: 'صيغة الخطة غير صالحة', line_settings_required: 'يلزم تحديد عدد دوائر الخط ونمط السلاسل صراحةً (لا تُخمَّن)', line_settings_change_not_allowed: 'لا يجوز تغيير إعدادات الخط من هنا',
    circuits_conflict_registry: 'عدد الدوائر المختار يخالف السجل المرجعي المؤكَّد', bad_number: 'رقم برج غير صالح', duplicate_new_number: 'رقم مكرر في الخطة',
    new_tower_must_not_reference_identity: 'برج جديد لا يشير إلى هوية', voltage_unresolved: 'جهد الخط غير محسوم', type_invalid: 'نوع البرج غير مقبول', chain_override_invalid: 'استثناء السلاسل غير صالح',
    bad_tower_id: 'هوية غير صالحة', unknown_tower_id: 'هوية برج غير معروفة في هذا الخط', from_num_has_identity_use_tower_id: 'للبرج هوية: يجب الإشارة بالهوية', from_num_not_configured: 'رقم غير موجود في تهيئة الخط',
    from_num_has_history_without_identity: 'لهذا الرقم سجلات تاريخية بلا هوية مربوطة — لا يُعاد ترقيمه ولا يُؤرشف قبل ربطها', metadata_change_not_allowed: 'تغيير نوع/مواصفات برج قائم لا يتم ضمن تغيير الترقيم',
    duplicate_tower_reference: 'برج مذكور مرتين', entry_unidentified: 'عنصر بلا هوية ولا رقم', tower_not_in_configuration: 'برج ليس في التهيئة', incomplete_mapping: 'خطة ناقصة: أبراج قائمة لم تُذكر',
    empty_line_not_allowed: 'لا يجوز تفريغ الخط من كل أبراجه'
  };
  const LOCAL_ERR = {
    empty_line: 'لا توجد أبراج في الخط', non_numeric_numbers: 'أرقام الأبراج ليست كلها أرقاماً صحيحة — الترقيم التسلسلي التلقائي غير مدعوم لهذا الخط (يلزم قرار المالك)',
    non_sequential_numbers: 'أرقام الأبراج غير متسلسلة (فجوة/تكرار عند البرج {at}) — الترقيم التسلسلي التلقائي غير مدعوم لهذا الخط', duplicate_identity: 'هوية مكررة في القائمة',
    bad_count: 'العدد يجب أن يكون بين 1 و 200', type_required: 'اختر نوع البرج الجديد صراحةً', anchor_not_found: 'موضع الإدراج غير موجود', retire_not_found: 'برج الإخراج غير موجود',
    already_retired: 'البرج مُخرَج أصلاً في الخطة', empty_line_not_allowed: 'لا يجوز إخراج كل الأبراج', too_many_towers: 'عدد الأبراج يتجاوز الحد', bad_op: 'عملية غير صالحة'
  };
  const BLK = {
    no_configuration: 'لا توجد تهيئة أبراج للخط', config_duplicate_or_blank_numbers: 'أرقام مكررة/فارغة في التهيئة', config_line_spelling_variants: 'أكثر من صيغة لاسم الخط في التهيئة',
    alias_line_spelling_variants: 'أكثر من صيغة لاسم الخط في هويات الأبراج', alias_not_in_configuration: 'هويات أبراج برقم غير موجود في التهيئة', uninitialised_tower_with_history: 'أبراج بلا حالة مهيّأة لها سجلات',
    unlinked_inspections: 'كشوف غير مربوطة بهوية', unlinked_treatments: 'معالجات غير مربوطة بهوية', unresolved_thermal_tower_points: 'نقاط حرارية لأبراج بلا هوية', departure_history_not_identity_linked: 'مغادرات طارئة بلا هوية',
    r4_stable_id_writes_not_deployed: 'كتابات الهوية الثابتة (R4) غير معلنة كجاهزة', stale_queue_protection_not_deployed: 'حماية الطوابير القديمة غير معلنة كجاهزة', topology_mutations_not_enabled: 'المدير لم يفتح تغيير الترقيم بعد',
    plan_invalid: 'الخطة غير صالحة'
  };
  // N25-R6b: server-side verification gates. They stay FALSE until the matching server path has been tested against the real SQL on a matching baseline
  // (see evidence R6b). While false the UI performs NO request for that action (preview stays available).
  const SERVER_VERIFIED = { apply: true, recover: false, spec: true, replace: true };   // N25-R6w: spec correction verified against the real SQL70 (single tower + line editor, one guard); recover and dated replacement stay DISABLED
  const UNVERIFIED = {
    apply: 'اعتماد التغيير معطّل: مسار الاعتماد على الخادم (app_topology_apply) لم يُتحقَّق منه بعد على قاعدة مطابقة. المعاينة فقط متاحة.',
    recover: 'التراجع معطّل: مسار التراجع على الخادم (app_topology_recover) لم يُتحقَّق منه بعد على قاعدة مطابقة.',
    spec: 'حفظ التصحيح معطّل: دالة الخادم app_tower_spec_correct وحارس الكاتب القديم (ملفات R6c_*.sql) لم تُثبَّت ولم تُختبر بعد على طبقة العمليات الحقيقية (op_cfg_plan / op_commit / auth_check). الحفظ القديم app_line_config_save لا يُستعمل لهذا الغرض.'
  };
  const msgOf = (code) => MSG[code] || ('تعذّر التنفيذ (' + (code || 'خطأ') + ')');
  const blkText = (c) => { const s = String(c || ''); return s.indexOf('blocker:') === 0 ? (BLK[s.slice(8)] || s.slice(8)) : (BLK[s] || s); };
  const errText = (e) => { const c = e && e.code; let t = PLAN_ERR[c] || LOCAL_ERR[c] || c || 'خطأ'; t = t.replace('{at}', e && e.at != null ? e.at : ''); const extra = e && (e.num || e.from_num || e.old_num || e.type); return t + (extra ? ' (' + extra + ')' : ''); };
  const short = (id) => (id ? String(id).slice(0, 8) : '—');
  const uuid = () => (typeof genUUID === 'function' ? genUUID() : (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); })));

  let S = null;            // حالة النافذة
  let _seq = 0;            // أحدث طلب فقط يُرسم
  const ok = () => !!S && !!document.getElementById('topoModal') && document.getElementById('topoModal').classList.contains('show');
  const sessGen = () => (typeof _csAuthGen !== 'undefined' ? _csAuthGen : 0);
  const sessOk = (g) => g === sessGen();

  function pendRead() { try { const o = JSON.parse(localStorage.getItem(PEND_KEY) || 'null'); return o && o.opId ? o : null; } catch (e) { return null; } }
  function pendWrite(o) { try { localStorage.setItem(PEND_KEY, JSON.stringify(o)); return true; } catch (e) { return false; } }
  function pendClear() { try { localStorage.removeItem(PEND_KEY); } catch (e) {} }
  const DEFINITIVE_BAD = ['network', 'session_changed', 'bad_response', 'topology_busy'];   // الردّ غير مؤكد/لم يُحسم: العملية المخزّنة تبقى قابلة لإعادة المحاولة بالمعرّف نفسه

  function mount() {
    if (document.getElementById('topoModal')) return;
    document.body.insertAdjacentHTML('beforeend', '<div id="topoModal" class="modal-bg" style="z-index:10000" role="dialog" aria-modal="true"><div id="topoBox" style="background:#fff;border-radius:14px;max-width:760px;width:100%;max-height:92vh;overflow-y:auto;padding:18px"></div></div>');
  }
  function open() { mount(); document.getElementById('topoModal').classList.add('show'); try { dlgScan(); } catch (e) {} }
  function close() { const m = document.getElementById('topoModal'); if (m) m.classList.remove('show'); S = null; _seq++; }
  const box = () => document.getElementById('topoBox');
  const linesList = () => { try { return lineCatalogNames(S && S.line ? [S.line] : []); } catch (e) { return []; } };   // N25-R6s3: الفهرس الموحّد
  const chip = (t, bg, fg) => '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.74rem;background:' + bg + ';color:' + fg + ';margin:2px">' + _te(t) + '</span>';
  const btn = (label, on, extra, dis) => '<button class="btn ' + (extra || 'btn-secondary') + ' btn-sm" ' + (dis ? 'disabled ' : '') + 'onclick="' + on + '" style="margin:3px">' + label + '</button>';

  // ----------------------------------------------------------------------- فتح إدارة الترقيم
  // opts (N25-R6p، من نافذة تعديل الخط): { volt, afterNum, type } — يُبقي اختيار الخط ومدخلاته ويُجهّز إدراجاً مرحلياً ومعاينته (قراءة فقط) دون أي كتابة
  function openTopo(line, opts) {
    open();
    S = { mode: 'topo', line: line || '', prev: null, ops: [], res: null, settings: null, busy: false, reason: '', typed: '', tab: 'edit', archive: null, last: null, err: null, gen: sessGen(), note: '', volt: (opts && Number(opts.volt)) || null, intent: (opts && opts.afterNum != null && opts.afterNum !== '') ? { afterNum: String(opts.afterNum), type: opts.type || '' } : null, prefill: null };
    if (S.line) loadLine(S.line); else render();
  }

  async function loadLine(line) {
    const my = ++_seq, gen = sessGen();
    S.line = line; S.prev = null; S.ops = []; S.res = null; S.err = null; S.settings = null; S.typed = ''; S.reason = ''; S.note = ''; S.archive = null; S.imp = null; S.completeMode = false; render();
    if (!line) return;
    if (!navigator.onLine) { S.err = msgOf('offline'); render(); return; }
    const r = await csCall('app_topology_preview', { p_line_name: line });
    if (my !== _seq || !ok() || !sessOk(gen)) return;
    if (!r || r.ok !== true) { S.err = msgOf(r && r.code); render(); return; }
    S.prev = r; render();
    if (S.intent) await consumeIntent();
  }
  // يحوّل مدخلات النافذة القديمة (بعد رقم + نوع) إلى عملية إدراج مرحلية بالهوية الدائمة، ثم يعاين الخطة على الخادم. أي رفض يظهر برسالة صريحة داخل نافذة المعاين.
  async function consumeIntent() {
    const it = S.intent; S.intent = null; if (!it || !S.prev) return;
    const cur = curList(), anchor = cur.find(t => String(t.num) === String(it.afterNum));
    if (!anchor) { S.err = 'البرج ' + it.afterNum + ' غير موجود في ترقيم الخادم الحالي لهذا الخط (الأبراج ' + (cur.length ? cur[0].num + '–' + cur[cur.length - 1].num : '—') + ') — اختر موضع الإدراج من النموذج أدناه.'; render(); return; }
    const key = TopoPlan.keyOf(anchor);
    if (!it.type || TYPES().indexOf(it.type) < 0) { S.prefill = { after: key, type: '' }; S.err = 'نوع البرج «' + (it.type || '—') + '» غير مقبول لجهد هذا الخط — اختر النوع من نموذج الإدراج ثم «أضف للخطة».'; render(); return; }
    S.prefill = { after: key, type: it.type };
    stage({ op: 'insert', after: key, count: 1, type: it.type });
    S.note = 'جُهّز إدراج برج جديد بعد البرج ' + it.afterNum + ' (' + it.type + ') من نافذة الخط — جارٍ معاينة الأثر على الخادم (قراءة فقط).'; render();
    await previewPlan();
  }

  function curList() {
    const rows = (S && S.prev && S.prev.towers) || [];
    return rows.map(t => ({ num: String(t.num), type: t.type, tower_id: t.tower_id || null, inspections: t.inspections, treatments: t.treatments, thermal: t.thermal }));
  }

  function localQueueBlock(line) {
    try {
      const rd = opsRead(); if (!rd.ok) return 'تعذّر قراءة طابور العمليات المحلي — لا يُعتمد تغيير ترقيم قبل التأكد منه';
      const ln = line || (S && S.line), mine = rd.items.filter(e => e && e.line === ln);
      const noId = mine.filter(e => !(e.ident && e.ident.tower_id) && !(e.payload && e.payload.tower_id));
      if (noId.length) return noId.length + ' عملية معلّقة على هذا الجهاز لهذا الخط بلا هوية برج — زامنها أو عالجها أولاً';
    } catch (e) {}
    return '';
  }

  function stage(op) { S.ops.push(op); S.res = null; S.typed = ''; S.err = null; render(); }
  function unstage(i) { S.ops.splice(i, 1); S.res = null; S.typed = ''; render(); }

  function addInsert() {
    const g = id => document.getElementById(id);
    const after = g('topoAfter').value, count = parseInt(g('topoCount').value, 10), type = g('topoType').value, chain = g('topoChain').value, mat = g('topoMat').value;
    if (!type) { S.err = LOCAL_ERR.type_required; render(); return; }
    stage({ op: 'insert', after: after === '__start' ? null : after, count, type, chain_override: chain || undefined, material_default: mat && mat !== 'glass' ? mat : undefined });
  }
  function toggleRetire(key) {
    const i = S.ops.findIndex(o => o.op === 'retire' && o.key === key);
    if (i >= 0) { unstage(i); return; }
    stage({ op: 'retire', key });
  }

  // ----------------------------------------------------------------------- معاينة الخطة على الخادم
  async function previewPlan() {
    if (S.busy) return;
    const b = TopoPlan.build(curList(), S.ops, S.settings);
    S.local = b; S.res = null; S.err = null;
    if (!b.ok) { render(); return; }
    if (!navigator.onLine) { S.err = msgOf('offline'); render(); return; }
    S.busy = true; render();
    const my = ++_seq, gen = sessGen(), line = S.line;
    const r = await csCall('app_topology_preview', { p_line_name: line, p_plan: b.plan });
    if (my !== _seq || !ok() || !sessOk(gen) || S.line !== line) return;
    S.busy = false;
    if (!r || r.ok !== true) { S.err = msgOf(r && r.code); render(); return; }
    S.res = r; S.prev = Object.assign({}, S.prev, { topology_rev: r.topology_rev, gate: r.gate, blockers: r.blockers, mutable: r.mutable });
    S.cross = TopoPlan.crossCheck(b.expected, r.mapping);
    render();
  }
  function setSettings() {
    const c = document.getElementById('topoCirc'), m = document.getElementById('topoChainMode');
    if (!c || !m || !c.value || !m.value) { S.err = 'اختر عدد الدوائر ونمط السلاسل'; render(); return; }
    S.settings = { circuit_count: Number(c.value), chain_mode: m.value }; previewPlan();
  }

  function canApply() {
    const reasons = [];
    if (!S.res) return { ok: false, reasons: ['لم تُعاين الخطة على الخادم بعد'] };
    if (!SERVER_VERIFIED.apply) reasons.push(UNVERIFIED.apply);
    if (S.res.can_apply !== true) (S.res.apply_blocked_by || []).forEach(c => reasons.push(blkText(c)));
    if (S.res.plan_ok !== true) reasons.push('الخطة غير مقبولة من الخادم');
    if (!S.cross || !S.cross.ok) reasons.push('ما حسبته الواجهة يخالف ما أعاده الخادم — لا اعتماد');
    if (!navigator.onLine) reasons.push(msgOf('offline'));
    const q = localQueueBlock(); if (q) reasons.push(q);
    if (S.busy) reasons.push('عملية جارية');
    return { ok: reasons.length === 0, reasons };
  }

  async function apply(retryRec) {
    if (S.busy) return;
    if (retryRec && !SERVER_VERIFIED[retryRec.kind === 'recover' ? 'recover' : 'apply']) { S.err = UNVERIFIED[retryRec.kind === 'recover' ? 'recover' : 'apply']; render(); return; }
    let rec = retryRec;
    if (!rec) {
      const ca = canApply(); if (!ca.ok) { S.err = ca.reasons.join(' — '); render(); return; }
      const reason = (S.reason || '').trim();
      if (reason.length < 3) { S.err = msgOf('invalid'); render(); return; }
      if (S.typed.trim() !== 'اعتماد') { S.err = 'اكتب كلمة «اعتماد» للتأكيد'; render(); return; }
      rec = { kind: 'apply', opId: uuid(), line: S.line, rev: Number(S.res.topology_rev), hash: S.res.plan_hash, plan: S.local.plan, reason, uid: (typeof currentUser !== 'undefined' && currentUser) ? String(currentUser.id) : null, at: Date.now() };
      if (!pendWrite(rec)) { S.err = 'تعذّر حفظ معرّف العملية محلياً (تخزين الجهاز غير متاح) — لا اعتماد دون حماية إعادة المحاولة'; render(); return; }
    }
    S.busy = true; S.err = null; render();
    const gen = sessGen();
    const r = rec.kind === 'recover'
      ? await csCall('app_topology_recover', { p_op_id: rec.opId, p_change_id: rec.changeId, p_reason: rec.reason })
      : await csCall(rec.info ? 'app_line_edit_apply' : 'app_topology_apply', Object.assign({ p_op_id: rec.opId, p_line_name: rec.line, p_expected_rev: rec.rev, p_plan_hash: rec.hash, p_plan: rec.plan, p_reason: rec.reason }, rec.info ? { p_info: rec.info } : {}));
    S.busy = false;
    if (!sessOk(gen)) { S.err = msgOf('session_changed') + ' (العملية المحفوظة محلياً تبقى لإعادة المحاولة)'; if (ok()) render(); return; }
    if (r && r.ok === true) {
      pendClear(); S.last = { change_id: r.change_id, kind: rec.kind, to_rev: r.to_rev, from_rev: r.from_rev, idempotent: !!r.idempotent, line: rec.line };
      S.ops = []; S.res = null; S.typed = ''; S.reason = ''; S.note = (rec.kind === 'recover' ? '✅ تم التراجع' : '✅ اعتُمد التغيير') + (r.idempotent ? ' (وصل ردّ العملية السابقة نفسها — لم يُكرَّر)' : '') + ' — الترقيم الجديد نسخة ' + r.to_rev;
      await refreshAfter(rec.line);
      if (ok()) await loadLineKeepNote(rec.line); return;
    }
    const code = r && r.code;
    if (DEFINITIVE_BAD.indexOf(code) < 0) pendClear();       // ردّ نهائي (رفض موثّق): لا إعادة بنفس المعرّف
    S.err = msgOf(code) + (r && r.errors ? ' — ' + r.errors.map(errText).join('؛ ') : '') + (r && r.blockers ? ' — ' + r.blockers.map(b => blkText(b.code)).join('؛ ') : '');
    if (code === 'stale_topology_revision' || code === 'plan_hash_mismatch') { S.res = null; }
    if (ok()) render();
  }
  function retryPending() { const rec = pendRead(); if (!rec) return; if (S && S.line !== rec.line) S.line = rec.line; apply(rec); }
  function dropPending() { if (!confirm('إلغاء العملية المحفوظة محلياً؟ إن كان الخادم قد اعتمدها فعلاً فلن تعرف الواجهة ذلك إلا بعد تحديث المعاينة.')) return; pendClear(); render(); }

  async function loadLineKeepNote(line) { const note = S.note, last = S.last; await loadLine(line); if (S) { S.note = note; S.last = last; render(); } }

  async function refreshAfter(line) {
    try { csPurgeUserData(); } catch (e) {}                 // حالة/أغلفة الأبراج المخزّنة مفاتيحها (خط+رقم): بعد إعادة الترقيم لا يُبقى أيٌّ منها
    try { await loadLineTowersCache(); } catch (e) {}
    try { await csDirLoad(line, 0); } catch (e) {}
    try { if (typeof linesFetchBaseline === 'function') { const b = await linesFetchBaseline(); if (b && b.ok) linesPublishBaseline(b.rows, sessGen()); } } catch (e) {}   // N25-R6r: عدد الأبراج في جدول الخطوط يُحدَّث من الخادم بعد الحفظ
  }
  function startRecover() {
    if (!SERVER_VERIFIED.recover) { S.err = UNVERIFIED.recover; render(); return; }
    if (!S.last || !S.last.change_id || S.last.kind !== 'apply') return;
    const reason = (document.getElementById('topoRecReason') || {}).value || '';
    if (reason.trim().length < 3) { S.err = msgOf('invalid'); render(); return; }
    if (!confirm('التراجع يعيد الترقيم السابق ويُرفض إن كُتبت بيانات بعد التغيير. المتابعة؟')) return;
    const rec = { kind: 'recover', opId: uuid(), line: S.line, changeId: S.last.change_id, reason: reason.trim(), at: Date.now() };
    if (!pendWrite(rec)) { S.err = 'تعذّر حفظ معرّف العملية محلياً'; render(); return; }
    apply(rec);
  }

  // ----------------------------------------------------------------------- الأرشيف
  async function loadArchive() {
    const my = ++_seq, gen = sessGen(), line = S.line; S.tab = 'archive'; S.archive = { loading: true }; render();
    if (!navigator.onLine) { S.archive = { err: msgOf('offline') }; render(); return; }
    const r = await csCall('app_tower_directory', { p_line_name: line });
    if (my !== _seq || !ok() || !sessOk(gen) || S.line !== line) return;
    if (!r || r.ok !== true) { S.archive = { err: msgOf(r && r.code) }; render(); return; }
    S.archive = { rows: (r.towers || []).filter(t => t.retired).sort((a, b) => String(b.retired_at || '').localeCompare(String(a.retired_at || ''))), unlinked: r.unlinked || null, rev: r.topology_rev }; render();
  }
  function openArchived(tid, num) {
    const line = S.line; close();
    return featRun(['thist'], () => towerHistOpenArchived(line, tid, num), 'thist');
  }

  // ----------------------------------------------------------------------- العرض
  function render() {
    const b = box(); if (!b || !S) return;
    if (S.mode === 'spec') return renderSpec();
    const lines = linesList();
    let h = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0;color:#1a2e4a">🧭 إدارة ترقيم الأبراج</h3>' + btn('✕ إغلاق', 'topoClose()') + '</div>';
    h += '<div class="field" style="margin-top:10px"><label>الخط</label><select id="topoLine" onchange="topoPickLine(this.value)" style="padding:10px;border-radius:8px;border:1px solid #ccc;width:100%;font-family:inherit"><option value="">— اختر الخط —</option>' +
      lines.map(l => '<option value="' + _te(l) + '"' + (l === S.line ? ' selected' : '') + '>' + _te(l) + '</option>').join('') + '</select></div>';
    const pend = pendRead();
    if (pend) h += '<div class="form-card" style="border-right:4px solid #ED8936;margin:10px 0;font-size:0.82rem;color:#7B341E">⏳ عملية ' + (pend.kind === 'recover' ? 'تراجع' : 'اعتماد') + ' على «' + _te(pend.line) + '» لم يصل ردّها (أو لم تُحسم). إعادة المحاولة تستخدم المعرّف نفسه فلا تُنفَّذ مرتين. ' +
      btn('↻ إعادة المحاولة بنفس المعرّف', 'topoRetryPending()', 'btn-primary', S.busy || !SERVER_VERIFIED.apply) + btn('إلغاء المحفوظة', 'topoDropPending()') + '</div>';
    if (S.note) h += '<div class="form-card" style="border-right:4px solid #38A169;margin:10px 0;font-size:0.85rem;color:#22543D">' + _te(S.note) + '</div>';
    if (S.err) h += '<div class="form-card" style="border-right:4px solid #E53E3E;margin:10px 0;font-size:0.82rem;color:#822727" role="alert">⚠️ ' + _te(S.err) + '</div>';
    if (!S.line) { b.innerHTML = h; return; }
    if (!S.prev) { b.innerHTML = h + (S.err ? '' : '<div class="empty-state">⏳ جاري قراءة ترقيم الخط من الخادم...</div>'); return; }
    const p = S.prev, gate = p.gate || {}, open_ = gate.open === true;
    h += '<div class="form-card" style="margin:10px 0;font-size:0.82rem"><div>نسخة الترقيم: <strong id="topoRev">' + _te(p.topology_rev) + '</strong> • الأبراج النشطة: <strong>' + curList().length + '</strong> • مصدر التهيئة: ' + _te(p.config_source) + '</div>' +
      '<div style="margin-top:6px">بوابة التغيير: ' + (open_ ? chip('مفتوحة', '#C6F6D5', '#22543D') : chip('مغلقة — الاعتماد غير متاح', '#FED7D7', '#822727')) +
      (open_ ? '' : ' <span style="color:#718096">' + (gate.reasons || []).map(c => _te(blkText(c))).join(' • ') + '</span>') + '</div>';
    if ((p.blockers || []).length) h += '<div style="margin-top:6px;color:#822727">مانعات الخط: ' + p.blockers.map(x => chip(blkText(x.code) + ' (' + x.count + ')', '#FEEBC8', '#7B341E')).join('') + '</div>';
    h += '</div>';
    h += '<div style="display:flex;gap:6px;margin:6px 0">' + btn('✏️ التعديل', "topoTab('edit')", S.tab === 'edit' ? 'btn-primary' : 'btn-secondary') + btn('🗄️ الأرشيف (أبراج محذوفة)', 'topoLoadArchive()', S.tab === 'archive' ? 'btn-primary' : 'btn-secondary') + (isAdminNow() ? btn('📍 مواقع الخط (استيراد)', "topoTab('loc')", S.tab === 'loc' ? 'btn-primary' : 'btn-secondary') : '') + '</div>';
    if (S.tab === 'archive') { b.innerHTML = h + archiveHtml(); return; }
    if (S.tab === 'loc') { b.innerHTML = h + locHtml(); return; }
    h += editHtml();
    b.innerHTML = h;
  }

  function editHtml() {
    const cur = curList(), retSet = new Set(S.ops.filter(o => o.op === 'retire').map(o => o.key));
    const seqOk = TopoPlan.checkSequential(cur);
    let h = '';
    if (!seqOk.ok) h += '<div class="form-card" style="border-right:4px solid #ED8936;color:#7B341E;font-size:0.82rem">⛔ ' + _te(errText(seqOk)) + '</div>';
    h += completeHtml(cur);
    h += '<div style="max-height:240px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:8px;margin:8px 0"><table style="width:100%;font-size:0.78rem;border-collapse:collapse"><tr style="background:#F7FAFC"><th>إخراج</th><th>الرقم</th><th>النوع</th><th>الهوية</th><th>كشف/معالجة/حراري</th></tr>' +
      cur.map(t => { const k = TopoPlan.keyOf(t), r = retSet.has(k); return '<tr style="border-top:1px solid #EDF2F7;' + (r ? 'background:#FFF5F5;text-decoration:line-through' : '') + '"><td style="text-align:center"><input type="checkbox" ' + (r ? 'checked ' : '') + 'aria-label="إخراج البرج ' + _te(t.num) + '" onchange="topoRetire(' + _te(JSON.stringify(k)) + ')"' + (seqOk.ok ? '' : ' disabled') + '></td><td><strong>' + _te(t.num) + '</strong></td><td>' + _te(t.type) + '</td><td dir="ltr">' + _te(short(t.tower_id)) + '</td><td>' + _te((t.inspections || 0) + ' / ' + (t.treatments || 0) + ' / ' + (t.thermal || 0)) + '</td></tr>'; }).join('') + '</table></div>';
    h += '<div class="form-card" style="margin:8px 0"><div style="font-weight:700;margin-bottom:6px">➕ إدراج أبراج جديدة</div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">' +
      '<div class="field" style="flex:1;min-width:120px"><label>بعد البرج</label><select id="topoAfter" style="padding:8px;border-radius:8px;border:1px solid #ccc;width:100%;font-family:inherit"><option value="__start">في بداية الخط</option>' + cur.map(t => '<option value="' + _te(TopoPlan.keyOf(t)) + '"' + (S.prefill && S.prefill.after === TopoPlan.keyOf(t) ? ' selected' : '') + '>' + _te(t.num) + '</option>').join('') + '</select></div>' +
      '<div class="field" style="width:80px"><label>العدد</label><input id="topoCount" type="number" min="1" max="200" value="1"></div>' +
      '<div class="field" style="flex:1;min-width:130px"><label>نوع البرج *</label><select id="topoType" style="padding:8px;border-radius:8px;border:1px solid #ccc;width:100%;font-family:inherit"><option value="">— اختر —</option>' + TYPES().map(o => '<option' + (S.prefill && S.prefill.type === o ? ' selected' : '') + '>' + _te(o) + '</option>').join('') + '</select></div>' +
      '<div class="field" style="flex:1;min-width:110px"><label>سلاسل (اختياري)</label><select id="topoChain" style="padding:8px;border-radius:8px;border:1px solid #ccc;width:100%;font-family:inherit"><option value="">افتراضي الخط</option><option value="single">مفرد</option><option value="double">مزدوج</option></select></div>' +
      '<div class="field" style="flex:1;min-width:110px"><label>مادة العازل</label><select id="topoMat" style="padding:8px;border-radius:8px;border:1px solid #ccc;width:100%;font-family:inherit"><option value="glass">زجاج (افتراضي)</option><option value="plastic">بلاستك</option><option value="ceramic">خزف</option></select></div>' +
      btn('أضف للخطة', 'topoAddInsert()', 'btn-secondary', !seqOk.ok) + '</div><div style="font-size:0.74rem;color:#718096;margin-top:4px">الأبراج الجديدة بهوية جديدة وبلا أي حالة أو تاريخ موروث (تظهر «غير مفحوص»، لا «سليم»).</div></div>';
    if (S.ops.length) {
      h += '<div class="form-card" style="margin:8px 0"><div style="font-weight:700">الخطة المرحلية</div>' + S.ops.map((o, i) => '<div style="display:flex;justify-content:space-between;font-size:0.82rem;padding:3px 0">' +
        '<span>' + (o.op === 'insert' ? '➕ إدراج ' + o.count + ' (' + _te(o.type) + ') ' + (o.after == null ? 'في البداية' : 'بعد البرج ' + _te((cur.find(t => TopoPlan.keyOf(t) === o.after) || {}).num)) : '🗄️ إخراج من الخدمة: البرج ' + _te((cur.find(t => TopoPlan.keyOf(t) === o.key) || {}).num)) + '</span>' + btn('✕', 'topoUnstage(' + i + ')') + '</div>').join('') +
        btn('🔍 معاينة الأثر على الخادم', 'topoPreview()', 'btn-primary', S.busy || !seqOk.ok) + '</div>';
    }
    if (S.local && !S.local.ok) h += '<div class="form-card" style="border-right:4px solid #E53E3E;font-size:0.82rem;color:#822727">' + S.local.errors.map(e => '• ' + _te(errText(e))).join('<br>') + '</div>';
    if (S.res) h += resultHtml();
    if (S.last && S.last.kind === 'apply' && S.last.change_id) {
      h += '<div class="form-card" style="margin:8px 0;font-size:0.82rem"><div style="font-weight:700">↩️ التراجع عن آخر تغيير (' + _te(short(S.last.change_id)) + ')</div><div style="color:#718096">يُرفض تلقائياً إن كُتبت بيانات بعد التغيير.</div>' +
        '<input id="topoRecReason" placeholder="سبب التراجع (3 أحرف على الأقل)" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ccc;margin:6px 0">' + btn('↩️ تراجع', 'topoRecover()', 'btn-secondary', S.busy || !SERVER_VERIFIED.recover || !(S.prev && S.prev.gate && S.prev.gate.open)) + '</div>';
    }
    return h;
  }

  function resultHtml() {
    const r = S.res, l = S.local, sm = r.summary || {}, cur = curList(), byKey = new Map(cur.map(t => [TopoPlan.keyOf(t), t]));
    let h = '<div class="form-card" style="margin:8px 0;border-right:4px solid ' + (r.plan_ok ? '#38A169' : '#E53E3E') + '"><div style="font-weight:700">نتيجة المعاينة (قراءة فقط — لم يُغيَّر شيء)</div>';
    h += '<div style="margin:6px 0">' + chip('يبقى ' + (sm.keep || 0), '#EDF2F7', '#2D3748') + chip('يُعاد ترقيمه ' + (sm.renumber || 0), '#BEE3F8', '#2A4365') + chip('جديد ' + (sm.insert || 0), '#C6F6D5', '#22543D') + chip('يُؤرشف ' + (sm.retire || 0), '#FED7D7', '#822727') +
      (l && l.summary ? chip('العدد بعد التغيير ' + l.summary.final_count, '#FEFCBF', '#744210') : '') + (sm.identities_to_materialise ? chip('هويات تُنشأ من التهيئة ' + sm.identities_to_materialise, '#C6F6D5', '#22543D') : '') + '</div>';
    if (S.completeMode && r.plan_ok === true) h += '<div style="font-size:0.8rem;color:#22543D;margin:4px 0">إكمال الهويات: الأبراج التي لها هوية تبقى بهويتها وسجلاتها كما هي (' + ((r.mapping || []).filter(m => m.tower_id).length) + ')، والتي بلا هوية (' + (sm.identities_to_materialise || 0) + ') تُنشأ لها هوية جديدة <b>بلا أي سجل قديم</b> — لا يُربط شيء بالتخمين، ولا يتغير أي رقم.' + (S.settings ? ' إعدادات الخط التي ستُحفظ مع الاعتماد: دوائر ' + _te(S.settings.circuit_count) + '، سلاسل ' + _te(S.settings.chain_mode) + ' (مأخوذة من الإعداد الفعلي الحالي في التطبيق).' : '') + '</div>';
    if ((r.errors || []).length) {
      h += '<div style="color:#822727;font-size:0.82rem">' + r.errors.map(e => '• ' + _te(errText(e))).join('<br>') + '</div>';
      if (r.errors.some(e => e.code === 'voltage_unresolved')) h += '<div role="alert" id="topoVoltNote" style="margin-top:6px;padding:8px 10px;border-radius:8px;background:#FFFAF0;border-right:4px solid #DD6B20;font-size:0.8rem;color:#7B341E">ℹ️ الخادم يستنتج جهد الخط من السجل المرجعي أو من لاحقة اسمه («… 132 ك.ف»). هذا الخط مُهيَّأ باسم مجرّد بلا لاحقة، فلا يقبل الخادم إدراج برج جديد عليه الآن — وهذا مستقل عن بوابة التغيير. الإخراج/المعاينة لا يتأثران. لم يُغيَّر شيء.</div>';
      if (r.errors.some(e => e.code === 'line_settings_required')) {
        h += '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><div class="field"><label>عدد الدوائر</label><select id="topoCirc" style="padding:8px;border-radius:8px;border:1px solid #ccc"><option value="">—</option><option value="1">دائرة واحدة</option><option value="2">دائرتان</option></select></div>' +
          '<div class="field"><label>نمط السلاسل</label><select id="topoChainMode" style="padding:8px;border-radius:8px;border:1px solid #ccc"><option value="">—</option><option value="single">مفرد</option><option value="double">مزدوج</option></select></div>' + btn('تأكيد وإعادة المعاينة', 'topoSetSettings()', 'btn-primary') + '</div>';
      }
    }
    const rows = (r.mapping || []).filter(m => m.action !== 'keep');
    if (rows.length) {
      const tot = (m) => (m.inspections || 0) + ' كشف / ' + (m.treatments || 0) + ' معالجة / ' + (m.thermal || 0) + ' حراري';
      h += '<div style="max-height:260px;overflow-y:auto;margin-top:6px"><table style="width:100%;font-size:0.78rem;border-collapse:collapse"><tr style="background:#F7FAFC"><th>الإجراء</th><th>القديم</th><th>الجديد</th><th>الهوية</th><th>ما يبقى محفوظاً</th></tr>' +
        rows.slice(0, 400).map(m => '<tr style="border-top:1px solid #EDF2F7"><td>' + (m.action === 'insert' ? '➕ جديد' : m.action === 'retire' ? '🗄️ أرشفة' : '🔁 ترقيم') + '</td><td>' + _te(m.old_num == null ? '—' : m.old_num) + '</td><td>' + _te(m.new_num == null ? '—' : m.new_num) + '</td><td dir="ltr">' + _te(short(m.tower_id)) + '</td><td>' +
          _te(m.action === 'insert' ? 'غير مفحوص — بلا تاريخ موروث' : m.action === 'retire' ? 'كل السجل يبقى بالأرشيف: ' + tot(m) : 'السجل والحالة تتبع البرج: ' + tot(m)) + '</td></tr>').join('') + '</table></div>' + (rows.length > 400 ? '<div style="font-size:0.74rem;color:#718096">أول 400 صف من ' + rows.length + '</div>' : '');
    }
    if (S.cross && !S.cross.ok) h += '<div style="color:#822727;font-size:0.82rem;margin-top:6px">⛔ اختلاف بين حساب الواجهة وردّ الخادم: ' + _te(JSON.stringify(S.cross.diffs).slice(0, 300)) + '</div>';
    const ca = canApply();
    if (!((S.prev && S.prev.gate) || {}).open) h += '<div class="form-card" role="alert" id="topoGateNote" style="margin:8px 0;border-right:4px solid #DD6B20;background:#FFFAF0;font-size:0.84rem;color:#7B341E">🔒 هذه معاينة فقط: بوابة تغيير الترقيم على الخادم مغلقة، فلا يمكن اعتماد الإدراج/الإخراج الآن. لم يُغيَّر أي برج ولا رقم ولا سجل. يتطلب الاعتماد جاهزية البوابة (يفتحها المالك صراحةً بعد فحص الجاهزية).</div>';
    h += '<div style="margin-top:10px;border-top:1px dashed #CBD5E0;padding-top:8px"><div style="font-size:0.8rem;color:#718096">«الحذف» أرشفة: لا يُمسح أي كشف أو معالجة أو حراري. الأبراج المتبقية تحتفظ بهويتها وحالتها وتاريخها وتتغير أرقامها فقط.</div>';
    if (!ca.ok) h += '<div style="margin-top:6px;color:#822727;font-size:0.82rem" id="topoBlocked">⛔ الاعتماد غير متاح: ' + ca.reasons.map(_te).join(' • ') + '</div>';
    h += '<input id="topoReason" placeholder="سبب التغيير (إلزامي، 3 أحرف على الأقل)" value="' + _te(S.reason) + '" oninput="topoSetReason(this.value)" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ccc;margin:8px 0 4px">' +
      '<input id="topoTyped" placeholder="اكتب: اعتماد" value="' + _te(S.typed) + '" oninput="topoSetTyped(this.value)" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ccc;margin:4px 0">' +
      '<button id="topoApplyBtn" class="btn btn-primary" onclick="topoApply()" ' + (ca.ok ? '' : 'disabled ') + 'style="width:100%;margin-top:6px">✅ اعتماد التغيير</button></div></div>';
    return h;
  }

  function archiveHtml() {
    const a = S.archive;
    if (!a || a.loading) return '<div class="empty-state">⏳ جاري قراءة الأرشيف...</div>';
    if (a.err) return '<div class="form-card" style="color:#822727">⚠️ ' + _te(a.err) + '</div>';
    if (!a.rows.length) return '<div class="empty-state">لا أبراج مؤرشفة في هذا الخط</div>';
    return '<div style="font-size:0.78rem;color:#718096;margin:6px 0">أبراج أُخرجت من الخدمة — سجلاتها محفوظة وتُفتح بالهوية الدائمة، ولا تظهر في القوائم النشطة.</div><table style="width:100%;font-size:0.8rem;border-collapse:collapse"><tr style="background:#F7FAFC"><th>كان برقم</th><th>الهوية</th><th>تاريخ الأرشفة</th><th></th></tr>' +
      a.rows.map(t => '<tr style="border-top:1px solid #EDF2F7"><td><strong>' + _te(t.retired_number == null ? '—' : t.retired_number) + '</strong></td><td dir="ltr">' + _te(short(t.tower_id)) + '</td><td>' + _te(String(t.retired_at || '').slice(0, 10)) + '</td><td>' + btn('📜 فتح السجل', 'topoOpenArchived(' + _te(JSON.stringify(t.tower_id)) + ',' + _te(JSON.stringify(t.retired_number == null ? '' : String(t.retired_number))) + ')') + '</td></tr>').join('') + '</table>' +
      (a.unlinked && a.unlinked.count ? '<div style="margin-top:8px;font-size:0.78rem;color:#7B341E">يوجد ' + _te(a.unlinked.count) + ' سجل تاريخي غير مربوط بهوية — لا يُنسب لأي برج.</div>' : '');
  }

  // ======================================================================= تعديل مواصفات البرج (تصحيح) — قراءة/كتابة عبر app_tower_spec_read / app_tower_spec_correct (R6b؛ معطّلة حتى التحقق)
  async function openSpec(line, num) {
    open();
    const gen = sessGen(), my = ++_seq;
    S = { mode: 'spec', line, num: String(num), busy: true, err: null, note: '', gen, kind: 'correction', rp: null, reason: '', form: null, base: null, cfg: null, rev: null, etag: null, tid: null, map: null, opId: null, opKey: null };
    render();
    if (!navigator.onLine) { S.busy = false; S.err = msgOf('offline'); render(); return; }
    try {
      // الهوية أولاً (الدليل يعرف tower_id لكل رقم نشط) ثم قراءة الخادم الذرّية: المدخل + رقم الإصدار + بصمة الإعداد
      const dir = await csCall('app_tower_directory', { p_line_name: line });
      if (my !== _seq || !ok() || !sessOk(gen)) return;
      if (!dir || dir.ok !== true) { S.busy = false; S.err = msgOf(dir && dir.code); render(); return; }
      const tw = (dir.towers || []).find(x => !x.retired && String(x.number) === S.num);
      if (!tw || !tw.tower_id) { S.busy = false; S.err = 'البرج ' + S.num + ' غير موجود بين الأبراج النشطة للخط على الخادم.'; render(); return; }
      const rd = await csCall('app_tower_spec_read', { p_line_name: line, p_tower_id: tw.tower_id });
      if (my !== _seq || !ok() || !sessOk(gen)) return;
      S.busy = false;
      if (!rd || rd.ok !== true) { S.err = rd && rd.code === 'no_stored_configuration' ? 'هذا الخط بلا تهيئة أبراج مخزَّنة (يستخدم السجل الثابت) — لا يمكن تعديل مواصفات برج منه قبل حفظ تهيئة الخط من «بيانات الخطوط».' : msgOf(rd && rd.code); render(); return; }
      if (rd.circuit_count == null || !rd.chain_mode) { S.err = 'إعدادات الدوائر/السلاسل غير مخزّنة لهذا الخط — لا يُعدَّل شيء بالتخمين.'; render(); return; }
      const t = rd.entry;
      S.tid = rd.tower_id; S.etag = rd.etag; S.rev = rd.topology_rev; S.cfg = { towers: [t], circuit_count: rd.circuit_count, chain_mode: rd.chain_mode }; S.base = JSON.parse(JSON.stringify(t));
      S.form = { type: t.type || '', chain_override: t.chain_override || '', material_default: t.material_default || 'glass' };
      render();
    } catch (e) { if (my === _seq && ok()) { S.busy = false; S.err = msgOf('network'); render(); } }
  }
  function specChanges() { const f = S.form, b = S.base, c = {}; if (f.type !== (b.type || '')) c.type = f.type; if ((f.chain_override || '') !== (b.chain_override || '')) c.chain_override = f.chain_override; if ((f.material_default || 'glass') !== (b.material_default || 'glass')) c.material_default = f.material_default; return c; }
  function renderSpec() {
    const b = box(); let h = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0;color:#1a2e4a">⚙️ مواصفات البرج ' + _te(S.num) + '</h3>' + btn('✕ إغلاق', 'topoClose()') + '</div><div style="font-size:0.8rem;color:#718096;margin:4px 0">' + _te(S.line) + '</div>';
    if (S.err) h += '<div class="form-card" style="border-right:4px solid #E53E3E;color:#822727;font-size:0.82rem" role="alert">⚠️ ' + _te(S.err) + '</div>';
    if (S.note) h += '<div class="form-card" style="border-right:4px solid #38A169;color:#22543D;font-size:0.85rem">' + _te(S.note) + '</div>';
    if (S.busy && !S.base) { b.innerHTML = h + '<div class="empty-state">⏳ جاري القراءة من الخادم...</div>'; return; }
    if (!S.base) { b.innerHTML = h; return; }
    const ch = specChanges(), ap = TopoPlan.specApply(S.cfg.towers, S.num, ch, TYPES()), imp = ap.ok ? TopoPlan.specImpact(S.base, ap.after, S.cfg.circuit_count) : null;
    h += '<div class="form-card" style="margin:8px 0"><div style="font-weight:700;margin-bottom:6px">نوع العملية (إلزامي)</div>' +
      '<label style="display:block;font-size:0.84rem"><input type="radio" name="topoKind" value="correction"' + (S.kind !== 'replacement' ? ' checked' : '') + ' onchange="topoSpecKind(this.value)"> تصحيح بيانات خاطئة (المعدّات الفعلية لم تتغيّر)</label>' +
      '<label style="display:block;font-size:0.84rem"><input type="radio" name="topoKind" id="topoKindRepl" value="replacement"' + (S.kind === 'replacement' ? ' checked' : '') + (SERVER_VERIFIED.replace ? '' : ' disabled') + ' onchange="topoSpecKind(this.value)"> استبدال معدّات فعلي (حدث ميداني مؤرّخ): عوازل في مواضع محددة أو البرج نفسه — المعدّات المستبدلة تبدأ «غير معروفة» حتى تُكشف</label></div>';
    if (S.kind === 'replacement') { b.innerHTML = h + renderReplace(); return; }
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap"><div class="field" style="flex:1;min-width:150px"><label>نوع البرج</label><select id="topoSpType" onchange="topoSpecField(\'type\',this.value)" style="padding:8px;border-radius:8px;border:1px solid #ccc;width:100%;font-family:inherit">' + TYPES().map(o => '<option' + (o === S.form.type ? ' selected' : '') + '>' + _te(o) + '</option>').join('') + (TYPES().indexOf(S.form.type) < 0 ? '<option selected>' + _te(S.form.type) + '</option>' : '') + '</select></div>' +
      '<div class="field" style="flex:1;min-width:130px"><label>سلاسل العوازل</label><select id="topoSpChain" onchange="topoSpecField(\'chain_override\',this.value)" style="padding:8px;border-radius:8px;border:1px solid #ccc;width:100%;font-family:inherit">' + [['', 'افتراضي الخط'], ['single', 'مفرد'], ['double', 'مزدوج']].map(o => '<option value="' + o[0] + '"' + (o[0] === (S.form.chain_override || '') ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>' +
      '<div class="field" style="flex:1;min-width:130px"><label>مادة العازل الافتراضية</label><select id="topoSpMat" onchange="topoSpecField(\'material_default\',this.value)" style="padding:8px;border-radius:8px;border:1px solid #ccc;width:100%;font-family:inherit">' + [['glass', 'زجاج'], ['plastic', 'بلاستك'], ['ceramic', 'خزف']].map(o => '<option value="' + o[0] + '"' + (o[0] === S.form.material_default ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div></div>';
    h += '<div class="form-card" style="margin:8px 0;font-size:0.8rem" id="topoImpact"><div style="font-weight:700">أثر التعديل قبل الحفظ</div>' +
      (!ap.ok ? '<div style="color:#822727">' + _te(ap.code) + '</div>' : ap.changed.length === 0 ? '<div style="color:#718096">لا تغيير.</div>' :
        '<div>البرج ' + _te(S.num) + ' • الدوائر في الخط: ' + imp.circuits + '</div>' + ap.changed.map(k => '<div>• ' + ({ type: 'النوع', chain_override: 'السلاسل', material_default: 'المادة الافتراضية' }[k]) + ': <strong>' + _te((S.base[k] || (k === 'material_default' ? 'glass' : '—'))) + '</strong> ← <strong>' + _te(ap.after[k] || (k === 'material_default' ? 'glass' : 'افتراضي الخط')) + '</strong></div>').join('') +
        '<div style="margin-top:6px;color:#4A5568">يبقى: الهوية الدائمة، كل الكشوف والمعالجات والحراري والأضرار والدورات المسجّلة، وبيانات الدائرتين. ' + (imp.geometry ? '<strong>تغيير الهندسة:</strong> إن كان لهذا البرج حالة عوازل محفوظة ويغيّر التعديل هندسة العوازل يرفضه الخادم كتصحيح (لا يُمحى ولا يُحوَّل شيء) ويلزم حدث «استبدال معدّات» مؤرَّخ (معلّق). تعديل المادة الافتراضية وحدها لا يمس حالة العوازل.' : 'المادة الافتراضية تُطبَّق على كشف جديد فقط ولا تغيّر حالة محفوظة.') + '</div>') + '</div>';
    h += '<input id="topoSpReason" placeholder="سبب التصحيح (إلزامي، 3 أحرف على الأقل)" value="' + _te(S.reason) + '" oninput="topoSpecReason(this.value)" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ccc;margin:6px 0">' +
      '<button id="topoSpSave" class="btn btn-primary" style="width:100%" onclick="topoSpecSave()" ' + (SERVER_VERIFIED.spec && ap.ok && ap.changed.length && !S.busy && (S.reason || '').trim().length >= 3 ? '' : 'disabled ') + '>💾 حفظ التصحيح</button>' + (SERVER_VERIFIED.spec ? '' : '<div id="topoSpUnverified" style="margin-top:6px;font-size:0.8rem;color:#822727">⛔ ' + _te(UNVERIFIED.spec) + '</div>');
    b.innerHTML = h;
  }
  async function specSave(tag) {
    if (S.busy) return;
    if (!SERVER_VERIFIED.spec) { S.err = UNVERIFIED.spec; render(); return; }
    const ch = specChanges(), reason = (S.reason || '').trim();
    if (reason.length < 3) { S.err = msgOf('invalid'); render(); return; }
    if (!navigator.onLine) { S.err = msgOf('offline'); render(); return; }
    if (!S.tid || !S.etag || S.rev == null) { S.err = 'أعد فتح النافذة (لا قراءة صالحة من الخادم).'; render(); return; }
    const ap = TopoPlan.specApply(S.cfg.towers, S.num, ch, TYPES());
    if (!ap.ok || !ap.changed.length) { S.err = 'لا تغيير صالح للحفظ (' + (ap.code || 'لا تغيير') + ')'; render(); return; }
    const gen = sessGen(), line = S.line, num = S.num;
    // الخادم هو الحارس (قفل الخط + رقم الإصدار + بصمة الإعداد + إعادة حساب الهندسة تحت قفل البرج). معرّف العملية يثبت لنفس الطلب فقط
    const req = { p_line_name: line, p_tower_id: S.tid, p_expected_rev: Number(S.rev), p_expected_etag: S.etag, p_changes: ch, p_reason: '[تصحيح بيانات] ' + reason + (tag || '') };
    const key = JSON.stringify(req); if (S.opKey !== key) { S.opKey = key; S.opId = uuid(); }
    S.busy = true; S.err = null; render();
    const r = await csCall('app_tower_spec_correct', Object.assign({ p_op_id: S.opId }, req));
    S.busy = false;
    if (!sessOk(gen) || !ok()) return;
    if (r && r.ok === true) {
      S.opId = null; S.opKey = null; S.note = '✅ حُفظ التصحيح للبرج ' + num + ' — الهوية والسجل التاريخي لم يتغيّرا' + (r.idempotent ? ' (كان قد نُفِّذ سابقاً ولم يُكرَّر)' : '');
      await specAfter(line, num);
      S.base = null; await openSpecKeep(line, num, S.note); return;
    }
    const code = r && r.code;
    if (code === 'geometry_change_not_correctable') { S.err = msgOf(code) + (r.from_mode || r.to_mode ? ' (' + _te(String(r.from_mode || '؟')) + ' ← ' + _te(String(r.to_mode || '؟')) + ')' : ''); S.opId = null; S.opKey = null; render(); return; }
    if (['stale_config', 'stale_topology_revision', 'stale_topology_identity', 'tower_retired', 'tower_not_in_config', 'ambiguous_config'].indexOf(code) >= 0) { S.base = null; S.opId = null; S.opKey = null; }
    S.err = msgOf(code) + (r && r.message ? ' — ' + r.message : ''); if (DEFINITIVE_BAD.indexOf(code) < 0) { S.opId = null; S.opKey = null; } render();
  }
  // ======================================================================= N25-R7: «استبدال معدات» — حدث ميداني مؤرَّخ بهوية البرج (app_tower_replace_* في SQL71)، منفصل عن التصحيح
  const RP_LBL = { ins_R: 'الدائرة 1 — طور R', ins_S: 'الدائرة 1 — طور S', ins_T: 'الدائرة 1 — طور T', ins2_R: 'الدائرة 2 — طور R', ins2_S: 'الدائرة 2 — طور S', ins2_T: 'الدائرة 2 — طور T', iron: 'الهيكل الحديدي', foundation: 'الأساس' };
  const RP_COND = (c, ds) => (ds !== 'known' ? 'غير معروف' : ({ ok: 'سليم', defect: 'تالف', treated: 'معالَج', unknown: 'غير معروف' }[c] || c));
  const RP_MODE = { chain1_10: 'سلسلة واحدة (10 عوازل/طور)', chain2_10: 'سلسلتان (20 عازلاً/طور)', chain2_12: 'سلسلتان شد (24/طور)', chain4_12: '4 سلاسل شد (48/طور)', v: 'V (400 ك.ف)', straight4: '4 سلاسل مستقيمة (400 ك.ف)' };
  const RP_REASON = { new_layout_undetermined: 'تعذّر تحديد التخطيط الجديد للعوازل (نوع البرج أو نمط سلاسل الخط غير محسوم).', unreplaced_positions_cannot_map: 'مواضع عوازل محفوظة لم تُحدَّد ضمن الاستبدال، ولا يمكن نقل حالتها إلى التخطيط الجديد بلا لبس. حدّد كل العوازل ضمن الاستبدال أو أبقِ النوع/السلاسل كما هي.' };
  const rpToday = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const rpModeTxt = (m) => (m ? (RP_MODE[m] || m) : 'غير محدّد');
  function rpInit() {
    const e = (S.base || {});
    S.rp = { rd: null, scope: 'insulators', date: rpToday(), comps: {}, secs: { iron: true, insulators: true, foundation: false }, form: { type: e.type || '', chain_override: e.chain_override || '', material_default: e.material_default || 'glass' },
             reason: '', pv: null, pvKey: null, pvBusy: false, err: null, note: '', busy: false, opId: null, opKey: null, seq: 0, st: {}, isev: '' };
    rpLoad(); render();
  }
  async function rpLoad() {
    const R = S && S.rp; if (!R) return; const gen = sessGen(), my = ++R.seq;
    if (!navigator.onLine) { R.err = msgOf('offline'); render(); return; }
    const rd = await csCall('app_tower_replace_read', { p_line_name: S.line, p_tower_id: S.tid });
    if (!S || S.rp !== R || my !== R.seq || !sessOk(gen)) return;
    if (!rd || rd.ok !== true) { R.err = msgOf(rd && rd.code); R.rd = null; render(); return; }
    R.rd = rd; R.err = null; render(); rpPreviewSoon();
  }
  function rpChanges() {
    const R = S.rp, e = (R.rd && R.rd.entry) || {}, c = {};
    if (R.scope === 'tower') {
      if ((R.form.type || '') !== (e.type || '')) c.type = R.form.type;
      if ((R.form.chain_override || '') !== (e.chain_override || '')) c.chain_override = R.form.chain_override || '';
    }
    if ((R.form.material_default || 'glass') !== (e.material_default || 'glass')) c.material_default = R.form.material_default || 'glass';
    return c;
  }
  const RP_SEV = { simple: 'مغادرة بسيطة', moderate: 'مغادرة متوسطة', below_critical: 'مغادرة دون الحرجة', critical: 'مغادرة حرجة' };
  const rpInsKeys = () => ((S.rp.rd && S.rp.rd.components) || []).filter(c => c.section === 'insulator' && c.applicability === 'applicable').map(c => c.component);
  // N25-R7b: المفاتيح المستبدلة فعلياً (نفس ما سيحسبه الخادم) وحالة كل منها كما اختارها المستخدم
  function rpKeys() {
    const R = S.rp;
    if (R.scope === 'insulators') return Object.keys(R.comps).filter(k => R.comps[k]).sort();
    return [].concat(R.secs.iron ? ['iron'] : [], R.secs.foundation ? ['foundation'] : [], R.secs.insulators ? rpInsKeys() : []).sort();
  }
  function rpPosList(txt) { const t = String(txt || '').split(/[,\s،;]+/).filter(Boolean); return t.map(x => (/^\d+$/.test(x) ? Number(x) : x)); }
  function rpStateOf(k) {
    const R = S.rp, c = R.st[k] || {}, ins = /^ins/.test(k); if (!c.state) return null;
    if (c.state === 'unchecked' || c.state === 'healthy') return ins && c.state === 'healthy' ? { state: 'healthy', material: c.material || R.form.material_default || 'glass' } : { state: c.state };
    if (ins) return { state: 'damaged', positions: rpPosList(c.pos), material: c.material || R.form.material_default || 'glass' };
    return { state: 'defect', sev: c.sev || '', text: (c.text || '').trim() };
  }
  function rpStatesIssue(keys) {
    const R = S.rp; for (const k of keys) { const c = R.st[k] || {}; if (!c.state) return 'state'; if (c.state === 'damaged' && !rpPosList(c.pos).length) return 'pos'; if (c.state === 'defect' && (!c.sev || !(c.text || '').trim())) return 'defect'; }
    if (keys.some(k => /^ins/.test(k) && (R.st[k] || {}).state === 'damaged') && !R.isev) return 'isev';
    return null;
  }
  function rpReq() {
    const R = S.rp, q = { scope: R.scope, event_date: R.date }, ch = rpChanges();
    if (R.scope === 'insulators') q.components = Object.keys(R.comps).filter(k => R.comps[k]).sort(); else q.sections = ['iron', 'insulators', 'foundation'].filter(k => R.secs[k]);
    if (Object.keys(ch).length) q.changes = ch;
    const keys = rpKeys(), st = {}; keys.forEach(k => { const x = rpStateOf(k); if (x) st[k] = x; }); q.states = st;
    if (keys.some(k => /^ins/.test(k) && st[k] && st[k].state === 'damaged') && R.isev) q.sev = { insulators: R.isev };
    return q;
  }
  function rpStateCtl(k) {
    const R = S.rp, c = R.st[k] || {}, ins = /^ins/.test(k), sel = 'padding:6px;border-radius:6px;border:1px solid #ccc;font-family:inherit', K = _te(k);
    const opts = (ins ? [['healthy', 'سليم'], ['damaged', 'تالف (حدّد المواضع)'], ['unchecked', 'ما فحصتها']] : [['healthy', 'سليم'], ['defect', 'فيه تلف/ملاحظة'], ['unchecked', 'ما فحصتها']]);
    let h = '<div style="margin:2px 18px 6px 0;padding:4px 8px;border-right:3px solid #CBD5E0"><select id="rpSt_' + K + '" onchange="topoRp(\'st\',\'' + K + '\',\'state\',this.value)" style="' + sel + '"><option value="">— اختر حالة المعدّة الجديدة —</option>' + opts.map(o => '<option value="' + o[0] + '"' + (c.state === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
    if (ins && (c.state === 'healthy' || c.state === 'damaged')) h += ' <select id="rpMt_' + K + '" onchange="topoRp(\'st\',\'' + K + '\',\'material\',this.value)" style="' + sel + '">' + [['glass', 'زجاج'], ['plastic', 'بلاستك'], ['ceramic', 'خزف']].map(o => '<option value="' + o[0] + '"' + ((c.material || R.form.material_default || 'glass') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
    if (ins && c.state === 'damaged') h += ' <input id="rpPos_' + K + '" placeholder="أرقام المواضع التالفة مثل: 1، 4، 7" value="' + _te(c.pos || '') + '" oninput="topoRp(\'st\',\'' + K + '\',\'pos\',this.value,1)" style="' + sel + ';min-width:170px">';
    if (!ins && c.state === 'defect') h += ' <select id="rpSv_' + K + '" onchange="topoRp(\'st\',\'' + K + '\',\'sev\',this.value)" style="' + sel + '"><option value="">— الدرجة —</option>' + Object.keys(RP_SEV).map(o => '<option value="' + o + '"' + (c.sev === o ? ' selected' : '') + '>' + RP_SEV[o] + '</option>').join('') + '</select> <input id="rpTx_' + K + '" placeholder="وصف التلف" value="' + _te(c.text || '') + '" oninput="topoRp(\'st\',\'' + K + '\',\'text\',this.value,1)" style="' + sel + ';min-width:170px">';
    return h + '</div>';
  }
  function rpStateTxt(a) {
    if (a.state === 'unchecked') return '<strong>غير معروف</strong> (ما فحصتها)';
    if (a.state === 'healthy') return '<strong>سليم</strong>' + (a.new_material ? ' • المادة: ' + _te(_vLabel('material_default', a.new_material)) : '');
    if (a.state === 'damaged') return '<strong>تالف</strong> — المواضع: ' + _te((a.new_damaged || []).join('، ')) + ' من ' + _te(a.new_positions) + ' • المادة: ' + _te(_vLabel('material_default', a.new_material));
    return '<strong>' + _te(RP_SEV[a.new_sev] || a.new_sev) + '</strong> — ' + _te(a.new_text || '');
  }
  const rpSelEmpty = (q) => !(q.components || q.sections || []).length;
  let _rpTimer = null;
  function rpPreviewSoon() { clearTimeout(_rpTimer); _rpTimer = setTimeout(rpPreview, 200); }
  async function rpPreview() {
    const R = S && S.rp; if (!R || !R.rd) return; const q = rpReq(), key = JSON.stringify(q), gen = sessGen(), my = ++R.seq;
    R.pvKey = null; R.pv = null;
    if (rpSelEmpty(q) || !R.date || rpStatesIssue(rpKeys())) { R.pvBusy = false; rpPaint(); return; }
    if (!navigator.onLine) { R.pv = { ok: false, code: 'offline' }; rpPaint(); return; }
    R.pvBusy = true; rpPaint();
    const r = await csCall('app_tower_replace_preview', { p_line_name: S.line, p_tower_id: S.tid, p_request: q });
    if (!S || S.rp !== R || my !== R.seq || !sessOk(gen)) return;
    R.pvBusy = false; R.pv = r || { ok: false, code: 'bad_response' }; R.pvKey = key; rpPaint();
  }
  function rpImpactHtml() {
    const R = S.rp, pv = R.pv, e = R.rd.entry || {}, q = rpReq();
    if (rpSelEmpty(q)) return '<div style="color:#718096">اختر ما سيُستبدل.</div>';
    { const iss = rpStatesIssue(rpKeys()); if (iss) return '<div style="color:#975A16" role="alert">' + ({ state: 'اختر حالة كل معدّة مستبدلة: سليم / تالف / «ما فحصتها» — «غير معروف» لا يُسجَّل إلا باختيارك الصريح.', pos: 'اكتب أرقام المواضع التالفة.', defect: 'اختر درجة الخطورة واكتب وصف التلف.', isev: 'حدّد درجة خطورة العوازل التالفة.' }[iss]) + '</div>'; }
    if (R.pvBusy || !pv) return '<div style="color:#718096">⏳ يحسب الخادم الأثر...</div>';
    if (pv.ok !== true) return '<div style="color:#822727" role="alert">⛔ ' + _te(msgOf(pv.code)) + (pv.reason ? ' — ' + _te(RP_REASON[pv.reason] || pv.reason) : '') + (pv.components ? ' (' + pv.components.map(k => _te(RP_LBL[k] || k)).join('، ') + ')' : '') + (pv.later_date ? ' (' + _te(pv.later_date) + ')' : '') + '<div style="margin-top:4px;color:#4A5568">لا يمكن الحفظ.</div></div>';
    let h = '<div><strong>الوضع السابق:</strong> ' + _te(e.type || '—') + ' • سلاسل: ' + _te(e.chain_override ? (e.chain_override === 'single' ? 'مفردة' : 'مزدوجة') : 'افتراضي الخط') + ' • مادة: ' + _te(_vLabel('material_default', e.material_default)) + ' • تخطيط العوازل: ' + _te(rpModeTxt(pv.from_mode)) + '</div>';
    h += '<div><strong>التغيير المطلوب:</strong> ' + (pv.config_changed ? _te(pv.entry_after.type || '—') + ' • سلاسل: ' + _te(pv.entry_after.chain_override ? (pv.entry_after.chain_override === 'single' ? 'مفردة' : 'مزدوجة') : 'افتراضي الخط') + ' • مادة: ' + _te(_vLabel('material_default', pv.entry_after.material_default)) + ' • تخطيط العوازل: ' + _te(rpModeTxt(pv.to_mode)) + (pv.geometry_change ? ' <strong>(تغيّرت الهندسة)</strong>' : '') : 'نفس المواصفات (استبدال معدّات فقط)') + ' • تاريخ الاستبدال: ' + _te(pv.event_date) + '</div>';
    h += '<div style="margin-top:4px"><strong>المواضع المتأثرة والحالة بعد الحفظ (لا يُنقل ضرر أو معالجة المعدّة القديمة):</strong></div>' + (pv.affected || []).map(a => '<div>• ' + _te(RP_LBL[a.component] || a.component) + ': كان <strong>' + _te(RP_COND(a.prev_condition, a.prev_data_status)) + '</strong>' + (a.prev_damaged ? ' (' + _te(a.prev_damaged) + ' تالف)' : '') + ' ← ' + rpStateTxt(a) + '</div>').join('') + (pv.spec_after ? '<div style="margin-top:4px"><strong>المواصفات بعد الحفظ:</strong> ' + _te(pv.spec_after.type || '—') + ' • سلاسل: ' + _te(pv.spec_after.chain_override ? (pv.spec_after.chain_override === 'single' ? 'مفردة' : 'مزدوجة') : 'افتراضي الخط') + ' • مادة: ' + _te(_vLabel('material_default', pv.spec_after.material_default)) + ' • تخطيط العوازل: ' + _te(rpModeTxt(pv.spec_after.mode)) + '</div>' : '');
    h += '<div style="margin-top:4px;color:#4A5568">تبقى بحالتها: ' + _te(pv.unaffected_count) + ' موضعاً/قسماً غير مستبدل. يبقى كاملاً: الهوية الدائمة، كل الكشوف والمعالجات والحراري والأضرار والدورات القديمة وروابطها. لا تُنقل أي معالجة قديمة إلى المعدّات الجديدة، ولا تُعدّ المعدّات سليمة بمجرد استبدالها.' + ((pv.section_reset || []).length ? ' يُمسح تقدير شدّة القسم المستبدل كلياً (' + pv.section_reset.map(x => _te({ iron: 'الهيكل', foundation: 'الأساس', insulator: 'العوازل' }[x] || x)).join('، ') + ') إلى «بلا كشف».' : '') + '</div>';
    return h;
  }
  const rpSaveOk = () => { const R = S.rp; return !!(SERVER_VERIFIED.replace && R && R.rd && R.pv && R.pv.ok === true && R.pvKey === JSON.stringify(rpReq()) && !R.busy && !R.pvBusy && (R.reason || '').trim().length >= 3); };
  function rpPaint() { const el = document.getElementById('rpImpact'); if (el && S && S.rp && S.rp.rd) el.innerHTML = rpImpactHtml(); const b = document.getElementById('rpSave'); if (b && S && S.rp) b.disabled = !rpSaveOk(); }
  function renderReplace() {
    const R = S.rp; if (!R) { rpInit(); return '<div class="empty-state">⏳ جاري القراءة من الخادم...</div>'; }
    let h = '';
    if (R.err) h += '<div class="form-card" style="border-right:4px solid #E53E3E;color:#822727;font-size:0.82rem" role="alert">⚠️ ' + _te(R.err) + '</div>';
    if (R.note) h += '<div class="form-card" style="border-right:4px solid #38A169;color:#22543D;font-size:0.85rem">' + _te(R.note) + '</div>';
    if (!R.rd) return h + (R.err ? '' : '<div class="empty-state">⏳ جاري القراءة من الخادم...</div>');
    const sel = 'padding:8px;border-radius:8px;border:1px solid #ccc;width:100%;font-family:inherit', rd = R.rd, ins = rd.components.filter(c => c.section === 'insulator');
    h += '<div class="form-card" style="margin:8px 0"><div style="display:flex;gap:8px;flex-wrap:wrap"><div class="field" style="flex:1;min-width:170px"><label>ما الذي استُبدل؟</label><select id="rpScope" onchange="topoRp(\'scope\',this.value)" style="' + sel + '">' +
      '<option value="insulators"' + (R.scope === 'insulators' ? ' selected' : '') + '>عوازل في مواضع محددة</option><option value="tower"' + (R.scope === 'tower' ? ' selected' : '') + '>البرج نفسه (قد يتغيّر نوعه/هندسته)</option></select></div>' +
      '<div class="field" style="flex:1;min-width:150px"><label>تاريخ الاستبدال (ميدانياً)</label><input id="rpDate" type="date" max="' + _te(rpToday()) + '" value="' + _te(R.date) + '" onchange="topoRp(\'date\',this.value)" style="' + sel + '"></div></div>';
    if (R.scope === 'insulators') {
      h += '<div style="font-weight:700;margin:6px 0 2px">المواضع (كل طور من كل دائرة وحدة الحالة المخزّنة)</div>' + ins.map(c => {
        const okc = c.applicability === 'applicable';
        return '<label style="display:block;font-size:0.84rem;' + (okc ? '' : 'color:#A0AEC0') + '"><input type="checkbox" id="rpC_' + _te(c.component) + '" ' + (okc ? '' : 'disabled ') + (R.comps[c.component] ? 'checked ' : '') + 'onchange="topoRp(\'comp\',\'' + _te(c.component) + '\',this.checked)"> ' + _te(RP_LBL[c.component] || c.component) +
          ' — الحالة الحالية: <strong>' + _te(okc ? RP_COND(c.condition, c.data_status) : (c.applicability === 'not_applicable' ? 'غير مطبّق' : 'غير محسوم')) + '</strong>' + (c.damaged ? ' (' + _te(c.damaged) + ' تالف)' : '') + (c.replaced ? (c.condition === 'unknown' ? ' • استُبدل سابقاً ولم يُكشف بعد' : ' • معدّة مستبدلة (حالتها سُجّلت عند الاستبدال)') : '') + '</label>' + (R.comps[c.component] ? rpStateCtl(c.component) : '');
      }).join('');
    } else {
      h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><div class="field" style="flex:1;min-width:150px"><label>نوع البرج الجديد</label><select id="rpType" onchange="topoRp(\'form\',\'type\',this.value)" style="' + sel + '">' + TYPES().map(o => '<option' + (o === R.form.type ? ' selected' : '') + '>' + _te(o) + '</option>').join('') + (TYPES().indexOf(R.form.type) < 0 ? '<option selected>' + _te(R.form.type) + '</option>' : '') + '</select></div>' +
        '<div class="field" style="flex:1;min-width:130px"><label>سلاسل العوازل</label><select id="rpChain" onchange="topoRp(\'form\',\'chain_override\',this.value)" style="' + sel + '">' + [['', 'افتراضي الخط'], ['single', 'مفرد'], ['double', 'مزدوج']].map(o => '<option value="' + o[0] + '"' + (o[0] === (R.form.chain_override || '') ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div></div>' +
        '<div style="font-weight:700;margin:6px 0 2px">الأقسام المستبدلة (غير المحدَّدة تبقى بحالتها)</div>' +
        [['iron', 'الهيكل الحديدي'], ['insulators', 'كل العوازل (كل الأطوار والدوائر المطبّقة)'], ['foundation', 'الأساس']].map(o => '<label style="display:block;font-size:0.84rem"><input type="checkbox" id="rpS_' + o[0] + '" ' + (R.secs[o[0]] ? 'checked ' : '') + 'onchange="topoRp(\'sec\',\'' + o[0] + '\',this.checked)"> ' + o[1] + '</label>' + (R.secs[o[0]] ? (o[0] === 'insulators' ? ins.filter(c => c.applicability === 'applicable').map(c => '<div style="font-size:0.8rem;margin-right:18px">' + _te(RP_LBL[c.component] || c.component) + rpStateCtl(c.component) + '</div>').join('') : rpStateCtl(o[0])) : '')).join('');
    }
    if (rpKeys().some(k => /^ins/.test(k) && (R.st[k] || {}).state === 'damaged')) h += '<div class="field" style="margin-top:6px"><label>درجة خطورة العوازل التالفة</label><select id="rpIsev" onchange="topoRp(\'isev\',this.value)" style="' + sel + '"><option value="">— اختر —</option>' + Object.keys(RP_SEV).map(o => '<option value="' + o + '"' + (R.isev === o ? ' selected' : '') + '>' + RP_SEV[o] + '</option>').join('') + '</select></div>';
    h += '<div class="field" style="margin-top:6px"><label>المادة الافتراضية للعازل (للكشف القادم)</label><select id="rpMat" onchange="topoRp(\'form\',\'material_default\',this.value)" style="' + sel + '">' + [['glass', 'زجاج (افتراضي)'], ['plastic', 'بلاستك'], ['ceramic', 'خزف']].map(o => '<option value="' + o[0] + '"' + (o[0] === (R.form.material_default || 'glass') ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div></div>';
    h += '<div class="form-card" style="margin:8px 0;font-size:0.8rem" id="rpImpact">' + rpImpactHtml() + '</div>';
    h += '<input id="rpReason" placeholder="سبب الاستبدال (إلزامي، 3 أحرف على الأقل)" value="' + _te(R.reason) + '" oninput="topoRpReason(this.value)" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ccc;margin:6px 0">' +
      '<button id="rpSave" class="btn btn-primary" style="width:100%" onclick="topoRpSave()" ' + (rpSaveOk() ? '' : 'disabled ') + '>💾 تسجيل الاستبدال</button>';
    const evs = rd.events || [];
    h += '<div class="form-card" style="margin:8px 0;font-size:0.78rem"><div style="font-weight:700">استبدالات سابقة لهذا البرج</div>' + (evs.length ? evs.map(x => '<div>• ' + _te(x.event_date) + ' — ' + (x.scope === 'tower' ? 'البرج' : 'عوازل') + ': ' + _te((x.components || []).map(k => RP_LBL[k] || k).join('، ')) + ' — ' + _te(x.reason) + ' (' + _te(x.actor || '') + ')</div>').join('') : '<div style="color:#718096">لا يوجد.</div>') + '</div>';
    return h;
  }
  async function rpSave() {
    const R = S && S.rp; if (!R || R.busy || !rpSaveOk()) return;
    if (!navigator.onLine) { R.err = msgOf('offline'); render(); return; }
    const q = rpReq(), pv = R.pv, reason = R.reason.trim(), line = S.line, num = S.num, gen = sessGen();
    const msg = ['سيُسجَّل استبدال معدّات فعلي مؤرَّخ ' + pv.event_date + ' للبرج ' + num + ' (الخط: ' + line + '):'].concat((pv.affected || []).map(a => '• ' + (RP_LBL[a.component] || a.component) + ': ' + RP_COND(a.prev_condition, a.prev_data_status) + ' ← ' + ({ unchecked: 'غير معروف (ما فحصتها)', healthy: 'سليم', damaged: 'تالف المواضع ' + (a.new_damaged || []).join('،'), defect: (RP_SEV[a.new_sev] || '') + ' ' + (a.new_text || '') }[a.state] || '')),
      [pv.config_changed ? ('• المواصفات: ' + (pv.entry_before.type || '—') + ' ← ' + (pv.entry_after.type || '—') + ' • تخطيط العوازل: ' + rpModeTxt(pv.from_mode) + ' ← ' + rpModeTxt(pv.to_mode)) : '• المواصفات لا تتغيّر', 'يبقى السجل التاريخي كاملاً ولا تُنقل أي معالجة قديمة. السبب: ' + reason, 'متابعة؟']).join('\n');
    if (!confirm(msg)) return;
    const req = { p_line_name: line, p_tower_id: S.tid, p_expected_rev: Number(R.rd.topology_rev), p_expected_etag: R.rd.etag, p_expected_state_rev: Number(R.rd.state_rev), p_request: q, p_reason: reason };
    const key = JSON.stringify(req); if (R.opKey !== key) { R.opKey = key; R.opId = uuid(); }
    R.busy = true; R.err = null; render();
    const r = await csCall('app_tower_replace', Object.assign({ p_op_id: R.opId }, req));
    R.busy = false;
    if (!sessOk(gen) || !ok() || S.rp !== R) return;
    if (r && r.ok === true) {
      const note = '✅ سُجّل الاستبدال للبرج ' + num + ' بتاريخ ' + r.event_date + (r.idempotent ? ' (كان قد نُفِّذ سابقاً ولم يُكرَّر)' : '') + ' — حُفظت المواصفات وحالة المعدّات الجديدة كما حدّدتها، والسجل التاريخي لم يتغيّر';
      R.opId = null; R.opKey = null;
      await specAfter(line, num);
      S.base = null; await openSpec(line, num); if (S) { S.kind = 'replacement'; rpInit(); S.rp.note = note; render(); }
      return;
    }
    const code = r && r.code;
    if (DEFINITIVE_BAD.indexOf(code) < 0) { R.opId = null; R.opKey = null; }
    R.err = msgOf(code) + (r && r.reason ? ' — ' + (RP_REASON[r.reason] || r.reason) : '') + (r && r.message ? ' — ' + r.message : '');
    if (['stale_config', 'stale_topology_revision', 'stale_topology_identity', 'stale_state_revision', 'tower_retired', 'tower_not_in_config', 'ambiguous_config'].indexOf(code) >= 0) { R.pv = null; R.pvKey = null; render(); rpLoad(); return; }
    render();
  }
  root.topoSpecKind = (v) => { if (!S || S.mode !== 'spec') return; S.kind = v === 'replacement' ? 'replacement' : 'correction'; if (S.kind === 'replacement' && !S.rp) rpInit(); else render(); };
  root.topoRp = (k, a, b2, b3, b4) => {
    const R = S && S.rp; if (!R) return;
    if (k === 'scope') { R.scope = a === 'tower' ? 'tower' : 'insulators'; R.pv = null; R.pvKey = null; render(); rpPreviewSoon(); return; }
    if (k === 'date') { R.date = a; R.pv = null; R.pvKey = null; rpPaint(); rpPreviewSoon(); return; }
    if (k === 'st') { const f = b2, v = b3, soft = b4; R.st[a] = R.st[a] || {}; R.st[a][f] = v; R.pv = null; R.pvKey = null; if (soft) { rpPaint(); rpPreviewSoon(); } else { render(); rpPreviewSoon(); } return; }
    if (k === 'isev') { R.isev = a; R.pv = null; R.pvKey = null; render(); rpPreviewSoon(); return; }
    if (k === 'comp') R.comps[a] = !!b2; else if (k === 'sec') R.secs[a] = !!b2; else if (k === 'form') R.form[a] = b2;
    R.pv = null; R.pvKey = null; if (k === 'comp' || k === 'sec') render(); else rpPaint(); rpPreviewSoon();
  };
  root.topoRpReason = (v) => { if (S && S.rp) { S.rp.reason = v; const b = document.getElementById('rpSave'); if (b) b.disabled = !rpSaveOk(); } };
  root.topoRpSave = () => rpSave();

  // N25-R6w: بعد تأكيد الخادم: المواصفات الجديدة تظهر فوراً في تفاصيل البرج المفتوحة وفي الكشف القادم (كاش الأبراج + حالة البرج + الشبكة/النموذج)
  async function specAfter(line, num) {
    try { csPurgeUserData(); } catch (e) {}
    try { await loadLineTowersCache(); } catch (e) {}
    try { await csDirLoad(line, 0); } catch (e) {}
    try {
      const open = (typeof _towerDetailCtx !== 'undefined' && _towerDetailCtx && _towerDetailCtx.line === line && (num == null || _towerDetailCtx.tower === String(num)));
      if (open && typeof _fetchFullTowerRecord === 'function') { const f = await _fetchFullTowerRecord(line, _towerDetailCtx.tower); if (f && f.ok && f.cs && f.cs.ok && f.cs.source !== 'cache') _applyConfirmedTowerEnv(line, _towerDetailCtx.tower, f.cs.env); renderTowerDetail(line, _towerDetailCtx.tower); }
    } catch (e) {}
    try { const g = document.getElementById('towersGrid'); const sel = document.getElementById('f_line_name'); if (g && sel && sel.value === line && typeof renderTowersGrid === 'function') renderTowersGrid(); } catch (e) {}
  }
  async function openSpecKeep(line, num, note) { await openSpec(line, num); if (S) { S.note = note; render(); } }


  // ======================================================================= N25-R6w: تعديل مواصفات أبراج قائمة من محرر الخط — نفس الحارس (app_line_spec_correct → app_tower_spec_correct لكل برج، ذرّي كله)
  let _leSpec = { key: null, opId: null };
  const LE_SPEC_REASON = 'تصحيح مواصفات أبراج من نافذة تعديل الخط';
  const _kLabel = { type: 'النوع', chain_override: 'السلاسل', material_default: 'المادة' };
  const _vLabel = (k, v) => k === 'chain_override' ? ({ single: 'مفرد', double: 'مزدوج' }[v] || 'افتراضي الخط') : k === 'material_default' ? ({ plastic: 'بلاستك', ceramic: 'خزف' }[v] || 'زجاج (افتراضي)') : (v || '—');
  // ctx: { line (مفتاح الخط عند الخادم), volt, edits:[{orig:'7', after:{type, chain_override, material_default}}] }
  const LE_REOPEN = 'تغيّر الخط (ترقيم أو هوية برج أو إعداد) منذ فتح النافذة، فرُفض الحفظ ولم تتغيّر مواصفات أي برج. أغلق النافذة وأعد فتح الخط ثم راجع التعديلات (حُفظت مدخلاتك للمراجعة على هذا الجهاز).';
  const LE_STALE = ['stale_config', 'stale_topology_revision', 'stale_topology_identity', 'tower_retired', 'tower_not_in_config', 'ambiguous_config'];
  function leReviewKeep(ctx, code) { try { localStorage.setItem('topo_spec_review_v1', JSON.stringify({ line: ctx.line, at: new Date().toISOString(), code, edits: (ctx.edits || []).map(e => ({ num: e.orig, from: e.open, to: e.after })) })); } catch (e) {} }
  // يُستدعى لحظة فتح محرر الخط: هوية كل برج (tower_id) + رقم الترقيم + بصمة الإعداد ورقم الإصدار — المسودة تُربط بها ولا تُقرأ من جديد عند الحفظ
  async function leSpecCapture(ctx) {
    const gen = sessGen();
    if (!SERVER_VERIFIED.spec) return leFail('disabled', UNVERIFIED.spec);
    if (!navigator.onLine) return leFail('offline');
    const rd = await csCall('app_line_spec_read', { p_line_name: ctx.line });
    if (!sessOk(gen)) return leFail('session_changed');
    if (!rd || rd.ok !== true) return leFail((rd && rd.code) || 'bad_response');
    if (rd.circuit_count == null || !rd.chain_mode) return leFail('invalid', 'إعدادات الدوائر/السلاسل غير مخزّنة لهذا الخط — لا يُعدَّل شيء بالتخمين.');
    const towers = {}; (rd.towers || []).forEach(t => { towers[String(t.num)] = { tower_id: t.tower_id, entry: t.entry }; });
    return { ok: true, base: { line: ctx.line, rev: Number(rd.topology_rev), etag: rd.etag, circuit_count: rd.circuit_count, chain_mode: rd.chain_mode, towers, order: (rd.towers || []).map(t => String(t.num)) } };
  }
  // ctx: { line, volt, base (من leSpecCapture لحظة الفتح), edits:[{orig:'7', open:{type,chain_override,material_default}, after:{...}}] }
  async function saveSpecFromEditor(ctx) {
    const gen = sessGen(), line = ctx.line, base = ctx.base;
    if (!SERVER_VERIFIED.spec) return leFail('disabled', UNVERIFIED.spec);
    if (!navigator.onLine) return leFail('offline');
    if (!base || base.line !== line || !base.etag || base.rev == null) { leReviewKeep(ctx, 'no_open_binding'); return leFail('stale_config', LE_REOPEN); }
    const opts = Number(ctx.volt) === 400 ? T400 : T132, items = [], txt = [], nm = (e) => [e.type || '', e.chain_override || '', e.material_default || 'glass'].join('|');
    for (const e of ctx.edits || []) {
      const t = base.towers[String(e.orig)];
      // الهوية من لحظة الفتح؛ وما فتحه المستخدم يجب أن يطابق ما قرأه الخادم وقتها (وإلا المسودة مبنيّة على نسخة قديمة)
      if (!t || !t.tower_id || nm(t.entry || {}) !== nm(e.open || {})) { leReviewKeep(ctx, 'draft_mismatch'); return leFail('stale_config', LE_REOPEN); }
      const b = e.open || {}, f = e.after || {}, ch = {};   // الحقول التي عدّلها المستخدم فعلاً مقارنةً بالنسخة التي فتحها
      if ((f.type || '') !== (b.type || '')) ch.type = f.type;
      if ((f.chain_override || '') !== (b.chain_override || '')) ch.chain_override = f.chain_override || '';
      if ((f.material_default || 'glass') !== (b.material_default || 'glass')) ch.material_default = f.material_default || 'glass';
      if (!Object.keys(ch).length) continue;
      const ap = TopoPlan.specApply([t.entry], t.entry.num, ch, opts);
      if (!ap.ok) return leFail(ap.code, 'البرج ' + e.orig + ': ' + (MSG[ap.code] || ap.code) + ' — لم يُحفظ شيء.');
      items.push({ tower_id: t.tower_id, changes: ch });
      txt.push('• برج ' + e.orig + ': ' + ap.changed.map(k => _kLabel[k] + ' ' + _vLabel(k, b[k] || (k === 'material_default' ? 'glass' : '')) + ' ← ' + _vLabel(k, ap.after[k] || (k === 'material_default' ? 'glass' : ''))).join('، '));
    }
    if (!items.length) return { ok: true, none: true };
    const geo = (ctx.edits || []).some(e => { const b = e.open || {}, f = e.after || {}; return (f.type || '') !== (b.type || '') || (f.chain_override || '') !== (b.chain_override || ''); });
    const msg = ['سيُصحَّح على الخادم دفعة واحدة (ذرّياً) — تصحيح بيانات خاطئة، لا استبدال معدّات:'].concat(txt, ['• الدوائر في الخط: ' + (Number(base.circuit_count) === 2 ? 2 : 1),
      'يبقى كما هو: الهوية الدائمة، الأرقام، كل الكشوف والمعالجات والحراري والأضرار والدورات وروابط المعالجة.',
      geo ? 'إن غيّر التعديل هندسة عوازل لها حالة محفوظة في أي برج منها يُرفض الحفظ كله بلا أي تطبيق جزئي.' : 'تعديل المادة الافتراضية وحدها لا يمس حالة العوازل المحفوظة.', 'متابعة؟']).join('\n');
    if (!confirm(msg)) return { ok: false, cancelled: true, msg: 'أُلغي — لم يُحفظ شيء.' };
    // الخادم يتحقق وقت التنفيذ (قفل الخط + رقم الإصدار + بصمة الإعداد + هوية كل برج) بنفس حارس SQL70؛ لا قراءة جديدة تُستبدل بها هوية صاحب الرقم الحالي
    const req = { p_line_name: line, p_expected_rev: Number(base.rev), p_expected_etag: base.etag, p_items: items, p_reason: LE_SPEC_REASON };
    const key = JSON.stringify(req); if (_leSpec.key !== key) { _leSpec.key = key; _leSpec.opId = uuid(); }
    const r = await csCall('app_line_spec_correct', Object.assign({ p_op_id: _leSpec.opId }, req));
    if (!sessOk(gen)) return leFail('session_changed', msgOf('session_changed'));
    if (r && r.ok === true) { _leSpec = { key: null, opId: null }; try { localStorage.removeItem('topo_spec_review_v1'); } catch (e) {} await specAfter(line, null); return { ok: true, r, n: items.length }; }
    const code = r && r.code;
    if (DEFINITIVE_BAD.indexOf(code) < 0) _leSpec = { key: null, opId: null };
    if (LE_STALE.indexOf(code) >= 0) { _leSpec = { key: null, opId: null }; leReviewKeep(ctx, code); return leFail(code, LE_REOPEN, { reply: r }); }
    const failT = r && r.tower_id ? Object.keys(base.towers).find(n => base.towers[n].tower_id === r.tower_id) : null;
    return leFail(code, (failT ? 'البرج ' + failT + ': ' : '') + msgOf(code) + (r && r.message ? ' — ' + r.message : '') + ' (لم يُغيَّر أي برج)', { reply: r });
  }
  root.topoSpecCaptureForEditor = leSpecCapture;
  root.topoSpecSaveFromEditor = saveSpecFromEditor;

  // ======================================================================= N25-R6r: «حفظ مرة واحدة» من محرر الخط
  // ctx: { line (مفتاح الخط عند الخادم), baseNums:[أرقام القائمة وقت فتح النافذة], rows:[{orig:'7'|null, type, chain_override?, material_default?, removed}], info:{idx, tension_towers|null}, circuit_count, chain_mode }
  // لا حالة نافذة (S) هنا: كل شيء من ctx. القراءة (معاينتان) بلا كتابة؛ الكتابة الوحيدة نداء واحد app_line_edit_apply بمعرّف عملية محفوظ محلياً قبل الإرسال.
  const LE_REASON = 'تعديل أبراج الخط من نافذة تعديل الخط (حفظ واحد)';
  const leFail = (code, msg, extra) => Object.assign({ ok: false, code, msg: msg || msgOf(code) }, extra || {});
  function leMsg(r) {
    const code = r && r.code;
    return msgOf(code) + (r && r.errors ? ' — ' + r.errors.map(errText).join('؛ ') : '') + (r && r.blockers ? ' — ' + r.blockers.map(b => blkText(b.code)).join('؛ ') : '') + (r && r.message && code === 'line_edit_failed_rolled_back' ? ' (' + r.message + ')' : '');
  }
  async function leSubmit(rec, gen) {
    const r = await csCall('app_line_edit_apply', { p_op_id: rec.opId, p_line_name: rec.line, p_expected_rev: rec.rev, p_plan_hash: rec.hash, p_plan: rec.plan, p_reason: rec.reason, p_info: rec.info });
    if (!sessOk(gen)) return leFail('session_changed', msgOf('session_changed') + ' (العملية المحفوظة محلياً تبقى لإعادة المحاولة)', { pending: true });
    if (r && r.ok === true) { pendClear(); await refreshAfter(rec.line); return { ok: true, r, idempotent: !!r.idempotent }; }
    const code = r && r.code;
    if (DEFINITIVE_BAD.indexOf(code) < 0) pendClear();
    else return leFail(code, leMsg(r), { pending: true });
    return leFail(code, leMsg(r), { reply: r });
  }
  function leCounts(r0, retiredKeys) {
    const by = new Map((r0.towers || []).map(t => [TopoPlan.keyOf({ tower_id: t.tower_id || null, num: String(t.num) }), t]));
    return retiredKeys.map(k => { const t = by.get(k) || {}; return 'برج ' + (t.num != null ? t.num : '؟') + ' (' + (t.inspections || 0) + ' كشف، ' + (t.treatments || 0) + ' معالجة، ' + (t.thermal || 0) + ' حراري)'; });
  }
  async function saveFromEditor(ctx) {
    const gen = sessGen(), line = ctx.line;
    if (!SERVER_VERIFIED.apply) return leFail('disabled', UNVERIFIED.apply);
    if (!navigator.onLine) return leFail('offline');
    const pend = pendRead();
    if (pend) {
      if (pend.kind === 'line_edit' && pend.line === line && ctx.resume) return leSubmit(pend, gen);
      return leFail('pending_other', 'توجد عملية ترقيم محفوظة محلياً لم يصل ردّها' + (pend.line ? ' (الخط ' + pend.line + ')' : '') + ' — اضغط «حفظ» لإكمالها بأمان (لا تتكرر) قبل أي تعديل جديد.', { pending: true, pendingRec: pend });
    }
    const r0 = await csCall('app_topology_preview', { p_line_name: line });
    if (!sessOk(gen)) return leFail('session_changed');
    if (!r0 || r0.ok !== true) return leFail((r0 && r0.code) || 'bad_response');
    const srvNums = (r0.towers || []).map(t => String(t.num));
    if (srvNums.join('|') !== (ctx.baseNums || []).map(String).join('|')) return leFail('base_changed', 'تغيّرت أبراج هذا الخط على الخادم منذ فتح النافذة (تعديل آخر). أغلق النافذة وأعد فتحها ثم أعد التعديل — لم يُحفظ شيء.');
    const cur = (r0.towers || []).map(t => ({ num: String(t.num), type: t.type, tower_id: t.tower_id || null }));
    const keyByNum = new Map(cur.map(t => [t.num, TopoPlan.keyOf(t)]));
    const ops = [];
    for (let i = ctx.rows.length - 1; i >= 0; i--) {    // الإدراج من الآخر للأول: صفّ جديدان متتاليان يبقيان بترتيبهما (كلٌّ بعد آخر برج قائم يسبقه)
      const w = ctx.rows[i]; if (w.orig != null) continue;
      if (w.removed) continue;                           // برج جديد أُلغي قبل الحفظ: لا أثر
      let anchor = null;
      for (let j = i - 1; j >= 0; j--) if (ctx.rows[j].orig != null) { anchor = keyByNum.get(String(ctx.rows[j].orig)); break; }
      ops.push({ op: 'insert', after: anchor == null ? null : anchor, count: 1, type: w.type, chain_override: w.chain_override || undefined, material_default: (w.material_default && w.material_default !== 'glass') ? w.material_default : undefined });
    }
    const retiredKeys = [];
    ctx.rows.forEach(w => { if (w.orig != null && w.removed) { const k = keyByNum.get(String(w.orig)); if (!k) return; ops.push({ op: 'retire', key: k }); retiredKeys.push(k); } });
    if (!ops.length) return leFail('no_topology_change', 'لا تغيير في الإدراج/الإخراج.');
    let b = TopoPlan.build(cur, ops, null);
    if (!b.ok) return leFail('plan_local', 'الخطة غير صالحة: ' + b.errors.map(errText).join('؛ '));
    let r1 = await csCall('app_topology_preview', { p_line_name: line, p_plan: b.plan });
    if (!sessOk(gen)) return leFail('session_changed');
    if (r1 && r1.ok === true && r1.plan_ok !== true && (r1.errors || []).some(e => e.code === 'line_settings_required') && ctx.circuit_count && ctx.chain_mode) {
      b = TopoPlan.build(cur, ops, { circuit_count: ctx.circuit_count, chain_mode: ctx.chain_mode });
      if (!b.ok) return leFail('plan_local', 'الخطة غير صالحة: ' + b.errors.map(errText).join('؛ '));
      r1 = await csCall('app_topology_preview', { p_line_name: line, p_plan: b.plan });
      if (!sessOk(gen)) return leFail('session_changed');
    }
    if (!r1 || r1.ok !== true) return leFail((r1 && r1.code) || 'bad_response');
    if (r1.plan_ok !== true) return leFail('plan_invalid', 'الخطة مرفوضة من الخادم: ' + (r1.errors || []).map(errText).join('؛ ') + ' — لم يُحفظ شيء.');
    const cc = TopoPlan.crossCheck(b.expected, r1.mapping);
    if (!cc.ok) return leFail('cross_check', 'ما حسبته الواجهة يخالف ما أعاده الخادم — لم يُحفظ شيء.');
    if (r1.can_apply !== true) {
      const gateOpen = !r1.gate || r1.gate.open !== false;
      if (!gateOpen) return leFail('topology_gate_closed', msgOf('topology_gate_closed') + ' لم يُحفظ شيء.');
      return leFail('not_ready', 'لا يمكن حفظ تغيير الترقيم الآن: ' + (r1.apply_blocked_by || []).map(blkText).join('؛ ') + ' — لم يُحفظ شيء.');
    }
    const q = localQueueBlock(line); if (q) return leFail('local_queue', q + ' — لم يُحفظ شيء.');
    const sm = b.summary, lines = ['سيُحفظ التغيير على الخادم دفعة واحدة (ذرّياً):'];
    if (sm.insert) lines.push('• إدراج ' + sm.insert + ' برج جديد (مواصفات قياسية وسجل فارغ)');
    if (sm.retire) lines.push('• إخراج ' + sm.retire + ' برج إلى الأرشيف بأرقامها وسجلاتها السابقة: ' + leCounts(r0, retiredKeys).join('، '));
    if (sm.renumber) lines.push('• إعادة ترقيم ' + sm.renumber + ' برج (تحتفظ بهويتها وكل سجلاتها)');
    lines.push('• العدد النهائي للأبراج: ' + sm.final_count, 'متابعة؟');
    if (!confirm(lines.join('\n'))) return leFail('cancelled', 'أُلغي الحفظ — لم يُغيَّر شيء.', { cancelled: true });
    const rec = { kind: 'line_edit', opId: uuid(), line, rev: Number(r1.topology_rev), hash: r1.plan_hash, plan: b.plan, reason: LE_REASON, info: ctx.info, uid: (typeof currentUser !== 'undefined' && currentUser) ? String(currentUser.id) : null, at: Date.now() };
    if (!pendWrite(rec)) return leFail('no_storage', 'تعذّر حفظ معرّف العملية محلياً (تخزين الجهاز غير متاح) — لا حفظ دون حماية إعادة المحاولة.');
    return leSubmit(rec, gen);
  }
  root.topoSaveFromEditor = saveFromEditor;
  root.topoPendingLineEdit = () => { const p = pendRead(); return p || null; };
  // ======================================================================= N25-R39: إكمال الهويات + استيراد مواقع الخط (مدير فقط)
  const isAdminNow = () => !!(typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin');
  function effectiveSettings(line) {
    try { return { circuit_count: isDoubleCircuitLine(line) ? 2 : 1, chain_mode: isExcluded132Line(line) ? 'single' : 'double' }; } catch (e) { return null; }
  }
  function completeHtml(cur) {
    const miss = cur.filter(t => !t.tower_id).length;
    if (!cur.length || !miss) return cur.length ? '<div class="form-card" style="margin:8px 0;font-size:0.8rem;color:#22543D">🪪 كل أبراج الخط (' + cur.length + ') لها هوية دائمة.</div>' : '';
    return '<div class="form-card" id="topoCompleteCard" style="margin:8px 0;border-right:4px solid #3182CE"><div style="font-weight:700">🪪 إكمال هويات الخط</div><div style="font-size:0.8rem;margin:4px 0">' + (cur.length - miss) + ' برج بهوية دائمة قائمة (تبقى كما هي)، و<b>' + miss + '</b> بلا هوية بعد. تُنشأ الهويات الناقصة من تهيئة الخط فقط (بلا تغيير أي رقم، وبلا ربط أي كشف قديم بالتخمين) عبر مسار الترقيم المعتمد نفسه: معاينة ثم اعتماد ذرّي تحت الأقفال.</div>' +
      btn('🔍 معاينة إكمال الهويات', 'topoCompletePlan()', 'btn-primary', S.busy) + '</div>';
  }
  async function completePlan() {
    if (!S || S.busy) return;
    S.ops = []; S.settings = null; S.completeMode = true; S.reason = S.reason || 'إكمال هويات أبراج الخط من التهيئة';
    await previewPlan();
    if (S && S.res && (S.res.errors || []).some(e => e.code === 'line_settings_required')) {
      const st = effectiveSettings(S.line);
      if (st) { S.settings = st; await previewPlan(); }
    }
  }

  const LOC_NOTE = 'يُقرأ الملف على جهازك فقط ولا يُخزَّن في التطبيق. لا يُطابَق أي موقع بالموقع الجغرافي ولا بالنص: كل نقطة تُربط برقم البرج في الملف بهويته الدائمة الحالية. المواقع الميدانية المحفوظة تبقى ولا تُستبدل.';
  function impReset() { S.imp = { name: '', pts: null, err: '', dry: null, hash: '', busy: false, done: null, verify: null, typed: '' }; }
  const normName = (x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
  function impBuild() {
    // يبني الدفعة من الملف + ترقيم الخادم الحالي. لا شيء يُرسل هنا.
    const imp = S.imp, cur = curList(), byNum = new Map(cur.map(t => [String(t.num), t]));
    const seen = new Set(), batch = [], problems = [], noId = [], unknown = [];
    (imp.pts || []).forEach(pt => {
      const n = String(pt.tower_number == null ? '' : pt.tower_number).trim(), la = Number(pt.lat), lo = Number(pt.lon);
      if (!n || !isFinite(la) || !isFinite(lo)) { problems.push('نقطة غير صالحة' + (n ? ' (برج ' + n + ')' : '')); return; }
      if (seen.has(n)) { problems.push('رقم مكرر في الملف: ' + n); return; }
      seen.add(n);
      const t = byNum.get(n);
      if (!t) { unknown.push(n); return; }
      if (!t.tower_id) { noId.push(n); return; }
      batch.push({ tower_id: t.tower_id, lat: la, lon: lo, ref: 'برج ' + n });
    });
    const notInFile = cur.filter(t => !seen.has(String(t.num))).map(t => String(t.num));
    return { batch, problems, noId, unknown, notInFile, total: cur.length, hash: batch.length ? JSON.stringify(batch.map(b => [b.tower_id, b.lat, b.lon])) : '' };
  }
  function locHtml() {
    if (!isAdminNow()) return '<div class="form-card" style="color:#822727">⛔ الاستيراد من صلاحيات المدير فقط.</div>';
    if (!S.imp) impReset();
    const imp = S.imp, cur = curList();
    let h = '<div class="form-card" style="margin:8px 0"><div style="font-weight:700">📍 استيراد مواقع أبراج الخط «' + _te(S.line) + '»</div><div style="font-size:0.78rem;color:#4A5568;margin:4px 0">' + _te(LOC_NOTE) + '</div>';
    h += '<input type="file" id="topoImpFile" accept=".json,application/json" onchange="topoImpFile(this)" style="margin:6px 0">';
    if (imp.err) h += '<div role="alert" style="color:#822727;font-size:0.82rem">⚠️ ' + _te(imp.err) + '</div>';
    if (imp.pts) {
      const b = impBuild(), miss = cur.filter(t => !t.tower_id).length;
      h += '<div style="font-size:0.82rem;margin:6px 0">الملف: <b>' + _te(imp.pts.length) + '</b> نقطة • أبراج الخط على الخادم: <b>' + cur.length + '</b> • جاهزة للإرسال: <b>' + b.batch.length + '</b></div>';
      const bad = [];
      if (normName(imp.line) !== normName(S.line)) bad.push('اسم الخط في الملف («' + normName(imp.line) + '») يخالف الخط المختار');
      if (miss) bad.push(miss + ' برج بلا هوية دائمة بعد — أكمل الهويات من تبويب «التعديل» أولاً (لا تُنشأ هوية بالاستيراد)');
      if (b.noId.length) bad.push('نقاط لأبراج بلا هوية: ' + b.noId.join('، '));
      if (b.unknown.length) bad.push('أرقام في الملف غير موجودة بين أبراج الخط: ' + b.unknown.join('، '));
      if (b.problems.length) bad.push(b.problems.join('؛ '));
      if (b.notInFile.length) bad.push('أبراج الخط بلا نقطة في الملف: ' + b.notInFile.join('، '));
      if (bad.length) h += '<div style="color:#822727;font-size:0.8rem" id="topoImpBad">' + bad.map(x => '• ' + _te(x)).join('<br>') + '</div>';
      const okLocal = !bad.length && b.batch.length > 0;
      h += btn('🔍 معاينة على الخادم (لا كتابة)', 'topoImpPreview()', 'btn-primary', !okLocal || imp.busy || !navigator.onLine);
      if (imp.dry) {
        const d = imp.dry, same = imp.hash === b.hash, canGo = okLocal && same && d.ok === true && d.skipped === 0 && d.accepted === b.batch.length;
        h += '<div class="form-card" id="topoImpDry" style="margin:8px 0;border-right:4px solid ' + (canGo ? '#38A169' : '#ED8936') + '"><div style="font-weight:700">نتيجة المعاينة (لم يُكتب شيء)</div><div>' +
          chip('مقبولة ' + (d.accepted || 0), '#C6F6D5', '#22543D') + chip('جديدة ' + (d.new || 0), '#BEE3F8', '#2A4365') + chip('تحلّ محل استيراد سابق ' + (d.replaced_import || 0), '#EDF2F7', '#2D3748') + chip('متروكة ' + (d.skipped || 0), (d.skipped ? '#FEEBC8' : '#EDF2F7'), '#7B341E') + '</div>';
        if ((d.skips || []).length) h += '<div style="font-size:0.78rem;color:#7B341E;margin-top:4px">' + d.skips.map(x => '• ' + _te(x.ref) + ': ' + _te(x.why === 'field_capture_exists' ? 'لها موقع ميداني محفوظ — يبقى ولا يُستبدل' : x.why)).join('<br>') + '</div>';
        if (!same) h += '<div style="color:#822727;font-size:0.8rem">تغيّر الملف/الترقيم بعد المعاينة — أعد المعاينة.</div>';
        if (d.skipped && d.skipped > 0 && (d.skips || []).every(x => x.why === 'field_capture_exists')) h += '<div style="font-size:0.78rem;color:#4A5568">المواقع الميدانية تُصان: يُسمح بالاعتماد مع بقائها كما هي (تُحسب ضمن 48 من 48 لأنها مواقع محفوظة).</div>';
        const fieldOnly = d.ok === true && okLocal && same && d.accepted + d.skipped === b.batch.length && (d.skips || []).every(x => x.why === 'field_capture_exists');
        imp.canGo = !!fieldOnly;
        h += '<input id="topoImpTyped" placeholder="اكتب: اعتماد" value="' + _te(imp.typed) + '" oninput="topoImpTyped(this.value)" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ccc;margin:8px 0 4px">' +
          '<button id="topoImpApply" class="btn btn-primary" onclick="topoImpApply()" ' + (fieldOnly && !imp.busy && imp.typed.trim() === 'اعتماد' ? '' : 'disabled ') + 'style="width:100%">✅ اعتماد الاستيراد</button>';
        h += '</div>';
      }
      if (imp.done) h += '<div class="form-card" id="topoImpDone" style="margin:8px 0;border-right:4px solid #38A169;font-size:0.84rem">✅ اكتمل الاستيراد: كُتبت ' + _te(imp.done.accepted) + ' (جديدة ' + _te(imp.done.new) + '، بدل استيراد سابق ' + _te(imp.done.replaced_import) + ') وتُركت ' + _te(imp.done.skipped) + ' (ميدانية).' +
        (imp.verify ? '<div style="margin-top:6px"><b id="topoImpVerify">' + _te(imp.verify.with_location) + ' من ' + _te(imp.verify.total) + '</b> نقطة مرقّمة لها موقع على الخادم ' + (imp.verify.with_location === imp.verify.total && imp.verify.total > 0 ? chip('مكتمل', '#C6F6D5', '#22543D') : chip('غير مكتمل', '#FED7D7', '#822727')) + '</div>' : '') + '</div>';
    }
    if (imp.busy) h += '<div style="font-size:0.8rem">⏳ جارٍ التنفيذ…</div>';
    return h + '</div>';
  }
  function impFile(inp) {
    const f = inp && inp.files && inp.files[0]; if (!S) return; impReset();
    if (!f) { render(); return; }
    if (f.size > 2000000) { S.imp.err = 'الملف كبير بشكل غير متوقع'; render(); return; }
    const rd = new FileReader();
    const gen = sessGen(), line = S.line;
    rd.onload = () => {
      if (!S || S.line !== line || !sessOk(gen)) return;
      try {
        const o = JSON.parse(String(rd.result));
        if (!o || !Array.isArray(o.points) || !o.points.length || o.points.length > 1500) throw new Error('bad');
        S.imp.pts = o.points.map(x => ({ tower_number: x.tower_number, lat: x.lat, lon: x.lon })); S.imp.line = o.line_name; S.imp.name = f.name;   // ref النصي من الملف لا يُحمَّل ولا يُرسل
      } catch (e) { S.imp.err = 'ملف غير صالح: المتوقع {line_name, points:[{tower_number, lat, lon}]}'; }
      render();
    };
    rd.onerror = () => { if (S) { S.imp.err = 'تعذّرت قراءة الملف'; render(); } };
    rd.readAsText(f);
  }
  async function impPreview() {
    if (!S || !S.imp || S.imp.busy) return;
    const b = impBuild(); if (!b.batch.length || b.problems.length || b.noId.length || b.unknown.length) return;
    S.imp.busy = true; S.imp.dry = null; S.imp.done = null; S.imp.verify = null; S.imp.typed = ''; render();
    const gen = sessGen(), line = S.line;
    const r = await csCall('app_tower_location_import', { p_batch: b.batch, p_dry_run: true });
    if (!S || S.line !== line || !sessOk(gen)) return;
    S.imp.busy = false;
    if (!r || r.ok !== true) { S.imp.err = msgOf(r && r.code); render(); return; }
    S.imp.err = ''; S.imp.dry = r; S.imp.hash = b.hash; render();
  }
  async function impApply() {
    if (!S || !S.imp || S.imp.busy || !S.imp.dry) return;
    if (S.imp.typed.trim() !== 'اعتماد') { S.imp.err = 'اكتب كلمة «اعتماد» للتأكيد'; render(); return; }
    const gen = sessGen(), line = S.line;
    S.imp.busy = true; S.imp.err = ''; render();
    // الترقيم/الهويات تُقرأ من جديد قبل الكتابة: أي اختلاف عمّا عُوين = لا كتابة
    const r0 = await csCall('app_topology_preview', { p_line_name: line });
    if (!S || S.line !== line || !sessOk(gen)) return;
    if (!r0 || r0.ok !== true) { S.imp.busy = false; S.imp.err = msgOf(r0 && r0.code); render(); return; }
    S.prev = Object.assign({}, S.prev, { towers: r0.towers, topology_rev: r0.topology_rev });
    const b = impBuild();
    if (!b.batch.length || b.hash !== S.imp.hash || b.noId.length || b.unknown.length || b.problems.length) { S.imp.busy = false; S.imp.dry = null; S.imp.err = 'تغيّر ترقيم/هويات الخط منذ المعاينة — أعد المعاينة. لم يُكتب شيء.'; render(); return; }
    const r = await csCall('app_tower_location_import', { p_batch: b.batch, p_dry_run: false });
    if (!S || S.line !== line || !sessOk(gen)) return;
    if (!r || r.ok !== true) { S.imp.busy = false; S.imp.err = msgOf(r && r.code) + ' — يمكنك إعادة المحاولة بأمان (الاستيراد لا يكرّر ولا يستبدل المواقع الميدانية).'; render(); return; }
    S.imp.done = r;
    let ver = null;
    try { const v = await csCall('app_tower_locations', { p_line_names: [line] }, { timeout: 40000 }); if (v && v.ok === true && Array.isArray(v.lines)) { const l = v.lines.find(x => normName(x.line_name) === normName(line)); if (l) ver = { total: Number(l.total), with_location: Number(l.with_location) }; } } catch (e) {}
    if (!S || S.line !== line || !sessOk(gen)) return;
    S.imp.busy = false; S.imp.verify = ver; S.imp.dry = null; render();
  }
  root.topoCompletePlan = completePlan;
  root.topoImpFile = impFile; root.topoImpPreview = impPreview; root.topoImpApply = impApply;
  root.topoImpTyped = (v) => { if (S && S.imp) { S.imp.typed = v; const bt = document.getElementById('topoImpApply'); if (bt) bt.disabled = S.imp.busy || !S.imp.canGo || String(v).trim() !== 'اعتماد'; } };
  // ======================================================================= ربط الواجهة العامة
  root.topoOpenImpl = openTopo;
  root.topoSpecOpenImpl = openSpec;
  root.topoClose = close;
  root.topoPickLine = (v) => { if (S && S.mode === 'topo') loadLine(v); };
  root.topoTab = (t) => { if (S) { S.tab = t; render(); } };
  root.topoLoadArchive = loadArchive;
  root.topoRetire = (k) => { if (S) toggleRetire(k); };
  root.topoAddInsert = () => { if (S) addInsert(); };
  root.topoUnstage = (i) => { if (S) unstage(i); };
  root.topoPreview = previewPlan;
  root.topoSetSettings = setSettings;
  root.topoSetReason = (v) => { if (S) { S.reason = v; refreshApplyBtn(); } };
  root.topoSetTyped = (v) => { if (S) { S.typed = v; } };
  root.topoApply = () => apply();
  root.topoRetryPending = retryPending;
  root.topoDropPending = dropPending;
  root.topoRecover = startRecover;
  root.topoOpenArchived = openArchived;
  root.topoSpecField = (k, v) => { if (S && S.form) { S.form[k] = v; render(); } };
  root.topoSpecReason = (v) => { if (S) { S.reason = v; const b = document.getElementById('topoSpSave'); if (b) { const ap = TopoPlan.specApply(S.cfg.towers, S.num, specChanges(), TYPES()); b.disabled = !(SERVER_VERIFIED.spec && ap.ok && ap.changed.length && !S.busy); } } };
  root.topoSpecSave = () => specSave('');
  function refreshApplyBtn() { /* السبب لا يغيّر أهلية الزر؛ التحقق عند الضغط */ }
  root.__topoState = () => S;      // للاختبارات فقط
  (root.__featModules = root.__featModules || {}).topo = true;
})(typeof window !== 'undefined' ? window : globalThis);
