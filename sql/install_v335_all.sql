-- =====================================================================
-- install_v335_all.sql : the ONE eventual installation, FROM the owner's repaired Stage-1B (nothing of v335 is installed yet).
-- All-or-nothing (one transaction): if ANY step refuses (for example an active account without a usable bcrypt hash), NOTHING is changed.
--   A. bridge + live reads (stage-2 step 1: scope-aware resolver, server sessions, account RPCs, app_tower_state/app_line_state/app_line_names)
--   B. operations layer: schema, core, apply, envelope/live_pack, verify, config, backup, grants   (20 - 24)
--   C. users cutover (public.users closed to the API roles; recoverable with 90_rollback_cutover.sql)
--   D. direct-write lockdown of inspections / treatments / line_towers_custom (recoverable with 92_rollback_lockdown.sql)
--   E. v335-C5 session-validated data API for every legacy table (registry, app_data_read / write / backup / restore, atomic lines_info replace)   (40)
--   F. v335-C5 lockdown of ALL direct API access (read + write) to those tables and their dependent views, exact ACL snapshot   (41; recoverable with 94, then 95)
-- Deploy the new application files at the same time: the previous application can no longer write after C and D.
-- =====================================================================
begin;

-- ===== A. bridge + live reads =====
-- =====================================================================
-- 01_install_bridge_and_live.sql  (STEP 1 of 2 - ADDITIVE; production keeps working exactly as before after this step)
--   * makes the Stage-1 resolver scope-aware (same rc_* steps, request-scoped tower set)  [replaces functions only]
--   * adds the server session bridge (tower_cs.app_session + public.app_login/app_session/app_logout + account RPCs)
--   * adds LIVE state reads (public.app_tower_state / public.app_line_state), session-gated
--   * changes NO table data, NO existing grants (public.users stays as it is until step 2), writes NO tower_cs shadow rows
-- Run once in the SQL editor as one run (a multi-statement run is one transaction). Re-runnable (create or replace / if not exists).
-- =====================================================================
-- v335-C2: EXPLICITLY atomic. If any statement fails the whole file rolls back (psql without -1 / ON_ERROR_STOP and the Supabase editor alike): no partial installation.
do $$
begin
  if to_regnamespace('tower_cs') is null then raise exception 'tower_cs schema missing: install Stage 1 / 1B first'; end if;
  if to_regprocedure('tower_cs.rc_meta()') is null
     or position('inferred_from_saved_layout' in pg_get_functiondef('tower_cs.rc_meta()'::regprocedure)) = 0 then
    raise exception 'the geometry/material repair (inferred_from_saved_layout) is not installed: apply it first';
  end if;
  if to_regclass('public.users') is null or to_regclass('public.inspections') is null or to_regclass('public.treatments') is null then
    raise exception 'public legacy tables missing';
  end if;
end $$;

-- ===== A. scope-aware resolver (03_reconcile.sql) =====
-- =====================================================================
-- 03_reconcile.sql : repeatable backfill / reconciliation (READS public.*, WRITES tower_cs.* only)
--
-- Usage (psql, direct connection, one transaction, consistent snapshot):
--     BEGIN ISOLATION LEVEL REPEATABLE READ;
--     SELECT tower_cs.reconcile('first shadow run');
--     COMMIT;
--
-- Source-of-state rule (Stage 1 = "describe, do not infer"):
--   The CURRENT state of a tower is the latest inspection row, chosen exactly like public.latest_inspections
--   (inspection_date DESC, created_at DESC) because every legacy write path (new inspection, saveTreatment PATCH)
--   already folds treatments into that row. Treatments are therefore NEVER replayed (no double count);
--   they are cross-checked against the row and classified in treatment_disposition.
--   Text-field treatment status is overlaid from items_treated of treatments linked to the source inspection
--   (same rule as the app's isTreatedInDB). Missing / malformed / ambiguous evidence stays unknown/invalid.
-- SCOPE: every step reads the tower set from the temp table pg_temp._tc_alias (columns of tower_cs.tower_alias). The batch entry point
--   (reconcile) fills it with ALL aliases (rc_scope_batch); the live read path (tower_cs.live_*) fills it with the requested towers only.
--   One resolver, two scopes: there is no second reducer.
-- Re-run rules: towers with tower_state.rev > 0 (future operation writes) are frozen and skipped;
--   baseline rows are insert-only; identities are insert-only.
-- =====================================================================

-- ---- temp-table hygiene (re-run inside one transaction is safe) ------------------------
create or replace function tower_cs.rc_drop_temp() returns void
language plpgsql set search_path = pg_catalog as $$
declare r record;
begin
  for r in select c.relname from pg_class c
           where c.relnamespace = pg_my_temp_schema() and c.relkind = 'r' and c.relname like E'\\_tc\\_%' loop
    execute format('drop table pg_temp.%I', r.relname);
  end loop;
end $$;

-- ---- scope: batch = every persisted alias ------------------------------------------
create or replace function tower_cs.rc_scope_batch() returns void
language plpgsql set search_path = pg_catalog as $$
begin
  create temp table _tc_alias on commit drop as select * from tower_cs.tower_alias;
  create temp table _tc_alias_all on commit drop as select * from tower_cs.tower_alias;
end $$;

-- ---- step 1: identities -------------------------------------------------
create or replace function tower_cs.rc_identity(p_run bigint) returns void
language plpgsql set search_path = pg_catalog as $$
begin
  create temp table _tc_pairs on commit drop as
  select line_name, tower_number,
         count(*) filter (where src = 'i')::int as ins_n,
         count(*) filter (where src = 't')::int as trt_n,
         min(d) filter (where src = 'i') as first_d,
         max(d) filter (where src = 'i') as last_d
  from (select line_name, tower_number, 'i'::text as src, inspection_date as d from public.inspections
        union all
        select line_name, tower_number, 't'::text, null::date from public.treatments) u
  group by 1, 2;
  create temp table _tc_new on commit drop as
  select p.line_name, p.tower_number, gen_random_uuid() as tower_id
  from pg_temp._tc_pairs p
  where not exists (select 1 from tower_cs.tower_alias a where a.line_name = p.line_name and a.tower_number = p.tower_number);

  insert into tower_cs.tower(tower_id, created_run_id) select tower_id, p_run from pg_temp._tc_new;
  insert into tower_cs.tower_alias(tower_id, line_name, tower_number, norm_line, norm_tower, created_run_id)
    select tower_id, line_name, tower_number, tower_cs.norm_line(line_name), tower_cs.norm_tower(tower_number), p_run
    from pg_temp._tc_new;

  update tower_cs.tower_alias a
     set inspection_count = coalesce(p.ins_n, 0), treatment_count = coalesce(p.trt_n, 0),
         first_inspection_date = p.first_d, last_inspection_date = p.last_d
    from tower_cs.tower_alias a2
    left join pg_temp._tc_pairs p on p.line_name = a2.line_name and p.tower_number = a2.tower_number
   where a.alias_id = a2.alias_id
     and (a.inspection_count, a.treatment_count, a.first_inspection_date, a.last_inspection_date)
         is distinct from (coalesce(p.ins_n, 0), coalesce(p.trt_n, 0), p.first_d, p.last_d);
end $$;

-- ---- step 2: source row per tower, chronology, parsed legacy JSON ----------
create or replace function tower_cs.rc_source() returns void
language plpgsql set search_path = pg_catalog as $$
begin
  create temp table _tc_ins on commit drop as
  select i.id, a.tower_id, i.inspection_date, i.created_at,
         row_number() over (partition by a.tower_id
                            order by i.inspection_date desc, i.created_at desc nulls first, i.id) as rn
  from public.inspections i
  join pg_temp._tc_alias a on a.line_name = i.line_name and a.tower_number = i.tower_number;
  create temp table _tc_chron on commit drop as
  select s.tower_id, s.id as src_id, s.inspection_date as src_date, s.created_at as src_created,
         (select count(*) from pg_temp._tc_ins o where o.tower_id = s.tower_id)::int as n_ins,
         (select count(*) from pg_temp._tc_ins o where o.tower_id = s.tower_id and o.inspection_date = s.inspection_date)::int as n_same_date,
         exists (select 1 from pg_temp._tc_ins o
                  where o.tower_id = s.tower_id and o.id <> s.id and o.inspection_date = s.inspection_date
                    and (o.created_at is null or s.created_at is null or o.created_at = s.created_at)) as tie,
         (s.created_at is not null and exists (select 1 from pg_temp._tc_ins o
                  where o.tower_id = s.tower_id and o.inspection_date < s.inspection_date and o.created_at > s.created_at)) as entered_later_older
  from pg_temp._tc_ins s where s.rn = 1;
  create temp table _tc_p on commit drop as
  select s.tower_id, i.id, i.inspection_date, i.created_at,
         i.insulator_state, i.insulator_cycle, i.insulator_chain_types,
         i.insulator_state_2, i.insulator_cycle_2, i.insulator_chain_types_2,
         i.iron_intersections, i.tower_foundations, i.tower_attachments,
         i.wires_r1, i.wires_s1, i.wires_t1, i.wires_r1_c2, i.wires_s1_c2, i.wires_t1_c2,
         i.ground_1, i.ground_2, i.road_access, i.insulator_washing, i.fire_causes_notes,
         i.sev_insulator, i.sev_iron, i.sev_foundation, i.sev_wires, i.sev_ground, i.sev_fire,
         s1.val as s1, s1.status as s1_st, c1.val as c1, c1.status as c1_st, m1.val as m1, m1.status as m1_st,
         s2.val as s2, s2.status as s2_st, c2.val as c2, c2.status as c2_st, m2.val as m2, m2.status as m2_st,
         (i.insulator_state_2 is not null or i.insulator_cycle_2 is not null or i.insulator_chain_types_2 is not null
          or i.wires_r1_c2 is not null or i.wires_s1_c2 is not null or i.wires_t1_c2 is not null) as c2_evidence
  from pg_temp._tc_ins s
  join public.inspections i on i.id = s.id
  cross join lateral tower_cs.decode(to_jsonb(i.insulator_state), true)         s1
  cross join lateral tower_cs.decode(i.insulator_cycle, false)                  c1
  cross join lateral tower_cs.decode(to_jsonb(i.insulator_chain_types), true)   m1
  cross join lateral tower_cs.decode(i.insulator_state_2, false)                s2
  cross join lateral tower_cs.decode(i.insulator_cycle_2, false)                c2
  cross join lateral tower_cs.decode(to_jsonb(i.insulator_chain_types_2), true) m2
  where s.rn = 1;

  -- previous inspection (rn=2) cycles, to detect a newer row that lost cycles (stale prefill evidence)
  create temp table _tc_prev on commit drop as
  select s.tower_id, s.id as prev_id, c1.val as c1, c2.val as c2
  from pg_temp._tc_ins s
  join public.inspections i on i.id = s.id
  cross join lateral tower_cs.decode(i.insulator_cycle, false)   c1
  cross join lateral tower_cs.decode(i.insulator_cycle_2, false) c2
  where s.rn = 2;
end $$;

-- ---- step 3: treatments classified against the source row ---------------------
create or replace function tower_cs.rc_treatments() returns void
language plpgsql set search_path = pg_catalog as $$
begin
  create temp table _tc_t on commit drop as
  with base as (
    select t.id, a.tower_id, t.inspection_id, t.created_at, t.line_name, t.tower_number,
           ib.val as before_v, ib.status as before_st,
           ia.val as after_v,  ia.status as after_st,
           ic.val as cyc_v,    ic.status as cyc_st,
           it.val as items_v,  it.status as items_dec_st,
           row_number() over w as seq,
           count(*)     over (partition by t.inspection_id) as n_in,
           count(*)     over (partition by t.inspection_id, t.created_at) as n_same_ts,
           lag(ia.val)  over w as prev_after_v
    from public.treatments t
    join pg_temp._tc_alias a on a.line_name = t.line_name and a.tower_number = t.tower_number
    cross join lateral tower_cs.decode(to_jsonb(t.insulator_state_before), true) ib
    cross join lateral tower_cs.decode(to_jsonb(t.insulator_state_after), true)  ia
    cross join lateral tower_cs.decode(t.insulator_cycle_after, false)           ic
    cross join lateral tower_cs.decode(t.items_treated, false)                   it
    window w as (partition by t.inspection_id order by t.created_at, t.id)
  ), enr as (
    select b.*,
           case when b.items_dec_st = 'null' then 'null'
                when tower_cs.items_valid(b.items_v) then 'ok'
                else 'invalid' end as items_status,
           ii.id as ins_found, ii.line_name as ins_line, ii.tower_number as ins_tower,
           s.id as src_id, s.s1 as src_s1, s.c1 as src_c1
    from base b
    left join public.inspections ii on ii.id = b.inspection_id
    left join pg_temp._tc_p s on s.tower_id = b.tower_id
  )
  select e.id, e.tower_id, e.inspection_id, e.created_at, e.seq, e.n_in, e.n_same_ts,
         e.before_st, e.after_st, e.cyc_st, e.items_status,
         case when e.items_status = 'ok' then tower_cs.item_keys(e.items_v) else '{}'::text[] end as keys,
         case when e.inspection_id is null or e.ins_found is null then 'orphan'
              when (e.ins_line, e.ins_tower) is distinct from (e.line_name, e.tower_number) then 'identity_mismatch'
              when e.src_id = e.ins_found then 'on_source'
              else 'on_non_source' end as relation,
         e.src_id,
         tower_cs.cycle_geq(e.src_c1, e.cyc_v) as cycle_covered,
         e.src_s1, e.after_v, e.prev_after_v, e.before_v, e.src_c1, e.cyc_v
  from enr e;

  alter table pg_temp._tc_t add column last_eq boolean, add column chain_ok boolean,
                             add column verdict text, add column checks jsonb;

  update pg_temp._tc_t t set
    last_eq  = case when t.relation = 'on_source' and t.seq = t.n_in then tower_cs.state_equal(t.after_v, t.src_s1) end,
    chain_ok = case when t.seq > 1 then tower_cs.state_equal(t.before_v, t.prev_after_v) end;

  update pg_temp._tc_t t set
    cycle_covered = case when t.relation in ('on_source','on_non_source') then t.cycle_covered end;

  update pg_temp._tc_t t set verdict =
    case when t.relation in ('orphan','identity_mismatch') or t.src_id is null then 'unverifiable'
         when t.cycle_covered is false or t.last_eq is false or t.chain_ok is false then 'inconsistent'
         when t.cycle_covered is null
              or (t.relation = 'on_source' and t.seq = t.n_in and t.last_eq is null)
              or (t.seq > 1 and t.chain_ok is null) then 'unverifiable'
         else 'consistent' end;

  update pg_temp._tc_t t set checks = jsonb_build_object(
      'cycle_covered_by_source', t.cycle_covered,
      'last_after_equals_source_row', t.last_eq,
      'before_equals_previous_after', t.chain_ok,
      'items_status', t.items_status,
      'after_state_status', t.after_st, 'cycle_after_status', t.cyc_st,
      'circuit2_unverifiable', exists (select 1 from unnest(t.keys) k where k like 'ins2\_%'));
end $$;

-- ---- step 3b: line configuration, custom tower lists, circuit-2 applicability --------------------------------------
-- Sources, in the application's own terms:
--   registry  : ref_line (LINE_VOLTAGE / DOUBLE_CIRCUIT_LINES) and ref_tower (LINES_DATA), seeded from the app files
--   override  : public.line_towers_custom (line_name, towers, circuit_count, chain_mode), read as generic JSON so that a
--               column that is absent / differently typed in production cannot abort the run
-- Nothing is inferred from MISSING data: an empty wire string or a missing circuit-2 state never decides single/double.
create or replace function tower_cs.rc_lineconfig() returns void
language plpgsql set search_path = pg_catalog as $$
begin
  create temp table _tc_ov0 (ov_line text, j jsonb) on commit drop;
  if to_regclass('public.line_towers_custom') is not null then
    execute 'insert into pg_temp._tc_ov0 select to_jsonb(l) ->> ''line_name'', to_jsonb(l) from public.line_towers_custom l';
  end if;

  create temp table _tc_ov on commit drop as
  select o.ov_line,
         case when tower_cs.safe_int(o.j -> 'circuit_count') in (1, 2) then tower_cs.safe_int(o.j -> 'circuit_count') end::smallint as circ,
         coalesce(jsonb_typeof(o.j -> 'circuit_count'), 'null') <> 'null' as circ_given,
         case when (o.j ->> 'chain_mode') in ('single', 'double') then o.j ->> 'chain_mode' end as chain,
         (o.j ->> 'chain_mode') is not null as chain_given,
         (select case when jsonb_typeof(d.val) = 'array' then d.val end from tower_cs.decode(o.j -> 'towers', false) d) as towers_arr
  from pg_temp._tc_ov0 o;

  -- override rows that apply to a known line (registry or any line that has inspections/treatments), in app lookup order
  create temp table _tc_lov on commit drop as
  select l.line_name, o.*, array_position(tower_cs.line_candidates(l.line_name), o.ov_line) as rk
  from (select line_name from tower_cs.ref_line union select line_name from pg_temp._tc_alias) l
  join pg_temp._tc_ov o on o.ov_line = any (tower_cs.line_candidates(l.line_name));

  create temp table _tc_line on commit drop as
  with lines as (select line_name from tower_cs.ref_line union select line_name from pg_temp._tc_alias),
  agg as (
    select line_name, count(*)::int as n_ov,
           min(circ) as c_min, max(circ) as c_max, bool_or(circ_given and circ is null) as c_bad,
           min(chain) as m_min, max(chain) as m_max, bool_or(chain_given and chain is null) as m_bad,
           coalesce(bool_or(towers_arr is not null and jsonb_array_length(towers_arr) > 0), false) as has_list
    from pg_temp._tc_lov group by line_name)
  select l.line_name, (r.line_name is not null) as in_registry, r.voltage as v_reg, tower_cs.name_voltage(l.line_name) as v_name,
         case when r.circuits_basis in ('listed_double', 'owner_confirmed_single', 'owner_confirmed_double') then r.circuits_registry end as c_reg,
         r.circuits_basis as c_basis, (l.line_name ~ '\(\s*1\s*\+\s*2\s*\)') as name2,
         coalesce(a.n_ov, 0) as n_ov, a.c_min, a.c_max, coalesce(a.c_bad, false) as c_bad,
         a.m_min, a.m_max, coalesce(a.m_bad, false) as m_bad, coalesce(a.has_list, false) as has_list,
         tower_cs.chain_mode_default(l.line_name) as chain_default
  from lines l
  left join tower_cs.ref_line r on r.line_name = l.line_name
  left join agg a on a.line_name = l.line_name;

  alter table pg_temp._tc_line add column voltage jsonb, add column circuits jsonb, add column chain_mode jsonb;

  update pg_temp._tc_line set
    voltage = tower_cs.reconcile_sources(jsonb_build_object('registry', v_reg, 'name_suffix', v_name), '[132,400]'::jsonb);

  -- circuits. ref_line.circuits_registry counts as a SOURCE only when it is explicit: listed in DOUBLE_CIRCUIT_LINES ('listed_double')
  -- or confirmed by the owner ('owner_confirmed_*'). 'default_single_not_listed' only records that the legacy app has no entry
  -- (its default); it is provenance, never a resolution. An override of 1 is the DB default value, so it is not a confirmation either:
  -- it takes part only where an explicit registry source exists (to agree or conflict). An override of 2, or rows that disagree
  -- with each other, are explicit. The "(1+2)" name is a corroborating hint, never the sole source.
  update pg_temp._tc_line set
    circuits = tower_cs.reconcile_sources(jsonb_build_object(
        'registry',         c_reg,
        'name_hint',        case when name2 and (c_reg is not null or c_min is not null) then 2 end,
        'override_a',       case when c_min = 2 or c_max <> c_min or (c_min = 1 and c_reg is not null) then c_min end,
        'override_b',       case when c_max <> c_min then c_max end,
        'override_invalid', case when c_bad then 'invalid' end), '[1,2]'::jsonb)
      || jsonb_build_object('registry_basis', c_basis)
      || case when c_reg is null and c_min = 1 and c_max = 1
              then jsonb_build_object('note', 'override_single_unconfirmed') else '{}'::jsonb end
      || case when c_basis = 'default_single_not_listed'
              then jsonb_build_object('registry_default_unconfirmed', true) else '{}'::jsonb end;

  -- chain mode (132 kV only). Same rule: the built-in rule counts only for registry lines; an override must agree with it.
  update pg_temp._tc_line set
    chain_mode = case
      when coalesce(v_reg, v_name) = 400 then jsonb_build_object('status', 'not_applicable', 'value', null, 'sources', '{}'::jsonb)
      else tower_cs.reconcile_sources(jsonb_build_object(
            'registry_rule',    case when in_registry then chain_default end,
            'override_a',       case when in_registry or m_max <> m_min then m_min end,
            'override_b',       case when m_max <> m_min then m_max end,
            'override_invalid', case when m_bad then 'invalid' end), '["single","double"]'::jsonb)
      end;

  -- custom tower list actually used by the app for a line (first matching override with a non-empty list), first entry per number
  create temp table _tc_ct on commit drop as
  with pick as (
    select distinct on (line_name) line_name, towers_arr from pg_temp._tc_lov
    where towers_arr is not null and jsonb_array_length(towers_arr) > 0 order by line_name, rk),
  ent as (
    select p.line_name, e.ord, case when jsonb_typeof(e.t) = 'object' then e.t end as o
    from pick p cross join lateral jsonb_array_elements(p.towers_arr) with ordinality as e(t, ord))
  select distinct on (line_name, (o ->> 'num'))
         line_name, (o ->> 'num') as tower_number,
         nullif(o ->> 'type_code', '') as type_code, nullif(o ->> 'type', '') as type_text,
         case when (o ->> 'chain_override') in ('single', 'double') then o ->> 'chain_override' end as chain_override,
         coalesce((o ->> 'chain_override') not in ('single', 'double', ''), false) as chain_override_invalid,
         nullif(o ->> 'material_default', '') as material_default
  from ent where o is not null and (o ->> 'num') is not null
  order by line_name, (o ->> 'num'), ord;

  -- circuit-2 applicability per tower (source row). Evidence = a SAVED circuit-2 structure (the app writes
  -- insulator_state_2/_cycle_2/_chain_types_2 only for double lines) or non-blank circuit-2 wire text.
  create temp table _tc_c2 on commit drop as
  select p.tower_id, i.line_name, i.tower_number,
         array_remove(array[
           case when tower_cs.has_saved_structure(p.s2, p.s2_st) then 'state_2' end,
           case when tower_cs.has_saved_structure(p.c2, p.c2_st) then 'cycle_2' end,
           case when tower_cs.has_saved_structure(p.m2, p.m2_st) then 'chain_types_2' end,
           case when tower_cs.has_text(p.wires_r1_c2) or tower_cs.has_text(p.wires_s1_c2) or tower_cs.has_text(p.wires_t1_c2)
                then 'wires_c2_text' end], null) as kinds,
         l.circuits as line_circuits
  from pg_temp._tc_p p
  join public.inspections i on i.id = p.id
  left join pg_temp._tc_line l on l.line_name = i.line_name;

  alter table pg_temp._tc_c2 add column applicability text, add column basis jsonb;
  update pg_temp._tc_c2 set
    applicability = case
      when cardinality(kinds) > 0 then 'applicable'
      when tower_cs.is_resolved(line_circuits) and (line_circuits ->> 'value') = '2' then 'applicable'
      when tower_cs.is_resolved(line_circuits) and (line_circuits ->> 'value') = '1' then 'not_applicable'
      else 'unknown' end,
    basis = jsonb_build_object('evidence', to_jsonb(kinds),
                               'line_status', coalesce(line_circuits ->> 'status', 'unknown'),
                               'line_value', line_circuits -> 'value');
end $$;


-- ---- step 4: components (insulators from the source row; text fields + treatment overlay) --------
-- Circuit-2 rows (ins2_*, wire_*_c2) exist for EVERY tower with a source row and carry an explicit applicability:
--   applicable      circuit-2 evidence on the source row, or a resolved double-circuit line configuration
--   not_applicable  a resolved single-circuit line configuration and NO circuit-2 evidence
--   unknown         configuration missing / conflicting and no circuit-2 evidence   (never guessed from empty fields)
-- Non-applicable and unknown rows carry condition 'unknown' so a consumer that ignores applicability is still safe.
create or replace function tower_cs.rc_components() returns void
language plpgsql set search_path = pg_catalog as $$
begin
  -- treatment keys effective for the SOURCE inspection (same rule as the app's isTreatedInDB for non-insulator keys)
  create temp table _tc_keys on commit drop as
  select t.tower_id, k.key, array_agg(t.id order by t.created_at, t.id) as tids
  from pg_temp._tc_t t cross join lateral unnest(t.keys) as k(key)
  where t.relation = 'on_source' and t.items_status = 'ok'
  group by 1, 2;
  create temp table _tc_badItems on commit drop as
  select distinct tower_id from pg_temp._tc_t where relation = 'on_source' and items_status = 'invalid';
  create temp table _tc_comp on commit drop as
  with ins as (
    select p.tower_id, 'ins_' || ph.phase as component, 1::smallint as circuit,
           x.condition, x.data_status, x.value, x.flags, p.id as src_id, 'applicable'::text as applicability, '{}'::jsonb as basis
    from pg_temp._tc_p p
    cross join (values ('R'),('S'),('T')) ph(phase)
    cross join lateral tower_cs.ins_phase(ph.phase, p.s1, p.s1_st, p.c1, p.c1_st, p.m1, p.m1_st) x
    union all
    select p.tower_id, 'ins2_' || ph.phase, 2::smallint,
           x.condition, x.data_status, x.value, x.flags, p.id, 'applicable'::text, a.basis
    from pg_temp._tc_p p
    join pg_temp._tc_c2 a on a.tower_id = p.tower_id and a.applicability = 'applicable'
    cross join (values ('R'),('S'),('T')) ph(phase)
    cross join lateral tower_cs.ins_phase(ph.phase, p.s2, p.s2_st, p.c2, p.c2_st, p.m2, p.m2_st) x
    union all
    select p.tower_id, 'ins2_' || ph.phase, 2::smallint, 'unknown'::text, 'unknown'::text,
           jsonb_build_object('reason', case a.applicability when 'not_applicable' then 'circuit_not_applicable' else 'circuit_applicability_unknown' end),
           array[case a.applicability when 'not_applicable' then 'circuit2_not_applicable' else 'circuit2_applicability_unknown' end],
           p.id, a.applicability, a.basis
    from pg_temp._tc_p p
    join pg_temp._tc_c2 a on a.tower_id = p.tower_id and a.applicability <> 'applicable'
    cross join (values ('R'),('S'),('T')) ph(phase)
  ), txt as (
    select p.tower_id, c.component, c.circuit, c.kind, c.raw, c.val, p.id as src_id, 'applicable'::text as app, '{}'::jsonb as basis
    from pg_temp._tc_p p
    cross join lateral (values
      ('iron',        null::smallint, 'free',    p.iron_intersections, jsonb_build_object('text', p.iron_intersections)),
      ('foundation',  null,           'free',    p.tower_foundations,  jsonb_build_object('text', p.tower_foundations)),
      ('attachment',  null,           'free',    p.tower_attachments,  jsonb_build_object('text', p.tower_attachments)),
      ('wire_r1',     1,              'free',    p.wires_r1,           jsonb_build_object('text', p.wires_r1)),
      ('wire_s1',     1,              'free',    p.wires_s1,           jsonb_build_object('text', p.wires_s1)),
      ('wire_t1',     1,              'free',    p.wires_t1,           jsonb_build_object('text', p.wires_t1)),
      ('ground_1',    null,           'free',    p.ground_1,           jsonb_build_object('text', p.ground_1)),
      ('ground_2',    null,           'free',    p.ground_2,           jsonb_build_object('text', p.ground_2)),
      ('road',        null,           'road',    p.road_access,        jsonb_build_object('text', p.road_access)),
      ('washing',     null,           'washing', p.insulator_washing,  jsonb_build_object('text', p.insulator_washing)),
      ('fire',        null,           'fire',    p.sev_fire,           jsonb_build_object('sev', p.sev_fire, 'notes', p.fire_causes_notes))
    ) c(component, circuit, kind, raw, val)
    union all
    select p.tower_id, c.component, 2::smallint, 'free', c.raw, jsonb_build_object('text', c.raw), p.id, a.applicability, a.basis
    from pg_temp._tc_p p
    join pg_temp._tc_c2 a on a.tower_id = p.tower_id
    cross join lateral (values ('wire_r1_c2', p.wires_r1_c2), ('wire_s1_c2', p.wires_s1_c2), ('wire_t1_c2', p.wires_t1_c2)) c(component, raw)
  ), txt2 as (
    select x.tower_id, x.component, x.circuit,
           case when x.app = 'applicable' then cl.condition   else 'unknown' end as cond0,
           case when x.app = 'applicable' then cl.data_status else 'unknown' end as ds0,
           case when x.app = 'applicable' then x.val
                else jsonb_build_object('reason', case x.app when 'not_applicable' then 'circuit_not_applicable' else 'circuit_applicability_unknown' end) end as value,
           case when x.app = 'applicable' then cl.flags
                else array[case x.app when 'not_applicable' then 'circuit2_not_applicable' else 'circuit2_applicability_unknown' end] end as fl0,
           x.src_id, case when x.app = 'applicable' then k.tids end as tids,
           exists (select 1 from pg_temp._tc_badItems b where b.tower_id = x.tower_id) as items_bad,
           x.app, x.basis
    from txt x
    cross join lateral tower_cs.classify_text(x.kind, x.raw) cl
    left join pg_temp._tc_keys k on k.tower_id = x.tower_id and k.key = x.component
  )
  select tower_id, component, circuit, condition, data_status, value, flags, '{}'::uuid[] as tids, src_id, applicability, basis from ins
  union all
  select tower_id, component, circuit,
         case when cond0 = 'defect' and tids is not null then 'treated' else cond0 end,
         case when cond0 = 'defect' and tids is null and items_bad then 'invalid' else ds0 end,
         value,
         fl0 || case when cond0 = 'defect' and tids is null and items_bad then array['treatment_items_unreadable']
                     when cond0 <> 'defect' and tids is not null then array['treated_without_defect']
                     else '{}'::text[] end,
         coalesce(tids, '{}'::uuid[]), src_id, app, basis
  from txt2;
end $$;

-- ---- step 5: issues ---------------------------------------------------------
create or replace function tower_cs.rc_issues() returns void
language plpgsql set search_path = pg_catalog as $$
begin
  create temp table _tc_issue (code text, severity text, tower_id uuid, source_table text, source_id uuid, detail jsonb) on commit drop;

  -- identity
  insert into pg_temp._tc_issue
  select 'identity_variant_candidate', 'blocking', a.tower_id, 'tower_alias', null,
         jsonb_build_object('line_name', a.line_name, 'tower_number', a.tower_number, 'variants', g.n)
  from pg_temp._tc_alias a
  join (select norm_line, norm_tower, count(*) n from pg_temp._tc_alias_all group by 1, 2 having count(*) > 1) g
    using (norm_line, norm_tower);

  insert into pg_temp._tc_issue
  select 'identity_treatment_only', 'warning', a.tower_id, 'tower_alias', null,
         jsonb_build_object('line_name', a.line_name, 'tower_number', a.tower_number, 'treatments', a.treatment_count)
  from pg_temp._tc_alias a where a.inspection_count = 0 and a.treatment_count > 0;

  insert into pg_temp._tc_issue
  select case relation when 'orphan' then 'treatment_orphan_inspection' else 'treatment_identity_mismatch' end,
         'blocking', tower_id, 'treatments', id, jsonb_build_object('inspection_id', inspection_id)
  from pg_temp._tc_t where relation in ('orphan', 'identity_mismatch');

  -- chronology
  insert into pg_temp._tc_issue
  select 'chronology_tie', 'blocking', tower_id, 'inspections', src_id,
         jsonb_build_object('src_date', src_date, 'src_created_at', src_created, 'same_date_rows', n_same_date)
  from pg_temp._tc_chron where tie;
  insert into pg_temp._tc_issue
  select 'same_date_multiple', 'warning', tower_id, 'inspections', src_id,
         jsonb_build_object('src_date', src_date, 'same_date_rows', n_same_date)
  from pg_temp._tc_chron where n_same_date > 1 and not tie;
  insert into pg_temp._tc_issue
  select 'entered_later_with_older_date', 'warning', tower_id, 'inspections', src_id,
         jsonb_build_object('src_date', src_date, 'src_created_at', src_created)
  from pg_temp._tc_chron where entered_later_older;

  -- JSON health of the source row
  insert into pg_temp._tc_issue
  select case when st = 'invalid' then 'json_invalid' else 'json_empty' end,
         case when st = 'invalid' then 'blocking' else 'warning' end,
         p.tower_id, 'inspections', p.id, jsonb_build_object('column', col, 'status', st)
  from pg_temp._tc_p p
  cross join lateral (values ('insulator_state', p.s1_st), ('insulator_cycle', p.c1_st), ('insulator_chain_types', p.m1_st),
                             ('insulator_state_2', p.s2_st), ('insulator_cycle_2', p.c2_st), ('insulator_chain_types_2', p.m2_st)) v(col, st)
  where st in ('invalid', 'empty');

  insert into pg_temp._tc_issue
  select 'component_invalid', 'blocking', tower_id, 'inspections', src_id,
         jsonb_build_object('components', jsonb_agg(component order by component), 'flags', (select jsonb_agg(distinct f) from unnest(array_agg(distinct fl)) f))
  from (select c.tower_id, c.src_id, c.component, f as fl from pg_temp._tc_comp c left join lateral unnest(c.flags) f on true
        where c.data_status = 'invalid') z
  group by tower_id, src_id;

  insert into pg_temp._tc_issue
  select 'sub_field_invalid', 'blocking', tower_id, 'inspections', src_id,
         jsonb_build_object('components', jsonb_agg(distinct component), 'flags', jsonb_agg(distinct f))
  from (select c.tower_id, c.src_id, c.component, f
        from pg_temp._tc_comp c cross join lateral unnest(c.flags) f
        where c.data_status = 'known' and f in ('cycle_unparseable','cycle_invalid_shape','cycle_length_mismatch',
              'chains_unparseable','chains_invalid_shape','chain_geometry_mismatch','chain_material_unrecognized')) z
  group by tower_id, src_id;

  -- treatments
  insert into pg_temp._tc_issue
  select 'treatment_inconsistent', 'blocking', tower_id, 'treatments', id,
         jsonb_build_object('relation', relation, 'checks', checks)
  from pg_temp._tc_t where verdict = 'inconsistent';
  insert into pg_temp._tc_issue
  select case when items_status = 'invalid' then 'items_treated_invalid' else 'items_treated_missing' end,
         case when items_status = 'invalid' then 'blocking' else 'warning' end,
         tower_id, 'treatments', id, '{}'::jsonb
  from pg_temp._tc_t where items_status in ('invalid', 'null');
  insert into pg_temp._tc_issue
  select 'json_invalid', 'blocking', tower_id, 'treatments', id, jsonb_build_object('column', col, 'status', st)
  from pg_temp._tc_t t
  cross join lateral (values ('insulator_state_after', t.after_st), ('insulator_cycle_after', t.cyc_st)) v(col, st)
  where st = 'invalid';
  insert into pg_temp._tc_issue
  select 'treatment_order_ambiguous', 'warning', tower_id, 'treatments', id, jsonb_build_object('same_timestamp_rows', n_same_ts)
  from pg_temp._tc_t where n_same_ts > 1 and inspection_id is not null;
  insert into pg_temp._tc_issue
  select distinct 'unknown_item_key', 'info', t.tower_id, 'treatments', t.id, jsonb_build_object('key', k)
  from pg_temp._tc_t t cross join lateral unnest(t.keys) k
  where k !~ '^(ins_[RST]|ins2_[RST]|chainreplace_[RST]_[0-9]+_[12]|iron|foundation|attachment|wire_[rst]1|wire_[rst]1_c2|ground_[12]|fire|road|washing|(plastic|ceramic)_[RST]_[0-9]+)$';

  -- history: the newest inspection has LOWER cycles than the one before it (cycles only grow)
  insert into pg_temp._tc_issue
  select 'cycle_regressed_vs_previous', 'blocking', p.tower_id, 'inspections', p.id,
         jsonb_build_object('previous_inspection_id', v.prev_id,
                            'circuit1', tower_cs.cycle_geq(p.c1, v.c1) is false,
                            'circuit2', tower_cs.cycle_geq(p.c2, v.c2) is false)
  from pg_temp._tc_p p join pg_temp._tc_prev v on v.tower_id = p.tower_id
  where tower_cs.cycle_geq(p.c1, v.c1) is false or tower_cs.cycle_geq(p.c2, v.c2) is false;

  -- the newest row has no cycle object at all although the previous one recorded cycles (lost data; NOT a position comparison)
  insert into pg_temp._tc_issue
  select 'cycle_lost_vs_previous', 'blocking', p.tower_id, 'inspections', p.id,
         jsonb_build_object('previous_inspection_id', v.prev_id,
                            'circuit1', tower_cs.cycle_lost(p.c1, v.c1),
                            'circuit2', tower_cs.cycle_lost(p.c2, v.c2))
  from pg_temp._tc_p p join pg_temp._tc_prev v on v.tower_id = p.tower_id
  where tower_cs.cycle_lost(p.c1, v.c1) or tower_cs.cycle_lost(p.c2, v.c2);
end $$;

-- ---- step 5b: tower metadata for a complete future prefill, with provenance and conflicts ------------------------
-- Per tower: voltage, tower type, circuit configuration, chain geometry, materials, notes (flags only, no free text copied).
-- Each item is {status, value, sources}. A missing source is NULL and is never turned into a default
-- (the app's silent fallbacks - voltage 132, missing material = glass, unknown type = suspension - are NOT applied).
create or replace function tower_cs.rc_meta() returns void
language plpgsql set search_path = pg_catalog as $$
declare
  r record; ph text;
  v_volt jsonb; v_volt_eff integer;
  s_raw text; s_code text; l_raw text; l_code text; l_from text; l_found boolean; l_text_code text;
  v_type jsonb; v_type_eff text;
  v_circ jsonb;
  chain_eff text; chain_basis text; v_mode text; v_pos jsonb; v_chains jsonb; v_geo jsonb; geo_status text;
  mode_line text; mode_inf text; geo_basis text; line_disagrees boolean; n_len integer;
  pos_all integer[]; pos_min integer; pos_max integer;
  exp_chains integer; d1 jsonb; d2 jsonb; m1 jsonb; m2 jsonb; mat_status text; v_mat jsonb; st1 text; st2 text;
  v_notes jsonb; blockers text[]; has_blocking boolean;
begin
  create temp table _tc_meta (tower_id uuid primary key, line_name text, tower_number text, src_id uuid, src_date date,
                              tower_type jsonb, voltage jsonb, circuits jsonb, geometry jsonb, materials jsonb, notes jsonb,
                              blockers text[], ready boolean) on commit drop;
  for r in
    select p.tower_id, p.id as src_id, p.inspection_date, i.line_name, i.tower_number, to_jsonb(i) as ij,
           p.s1, p.s1_st, p.c1, p.c1_st, p.m1, p.m1_st, p.s2, p.s2_st, p.c2, p.c2_st, p.m2, p.m2_st,
           a.applicability as c2_app, a.kinds as c2_kinds,
           coalesce(l.in_registry, false) as in_registry, l.voltage as l_voltage, l.circuits as l_circuits, l.chain_mode as l_chain,
           coalesce(l.has_list, false) as has_list,
           ct.tower_number is not null as ct_found, ct.type_code as ct_code, ct.type_text as ct_text,
           ct.chain_override as ct_chain, coalesce(ct.chain_override_invalid, false) as ct_chain_bad, ct.material_default as ct_mat,
           rt.tower_number is not null as rt_found, rt.type_code as rt_code, rt.type_text as rt_text
    from pg_temp._tc_p p
    join public.inspections i on i.id = p.id
    join pg_temp._tc_c2 a on a.tower_id = p.tower_id
    left join pg_temp._tc_line l on l.line_name = i.line_name
    left join pg_temp._tc_ct ct on ct.line_name = i.line_name and ct.tower_number = i.tower_number
    left join tower_cs.ref_tower rt on rt.line_name = i.line_name and rt.tower_number = i.tower_number
  loop
    -- 1. voltage: stored on the inspection / registry / "132 ك.ف" suffix of the line name
    v_volt := tower_cs.reconcile_sources(jsonb_build_object(
                'stored', tower_cs.safe_int(r.ij -> 'voltage'),
                'registry', r.l_voltage -> 'sources' -> 'registry',
                'name_suffix', r.l_voltage -> 'sources' -> 'name_suffix'), '[132,400]'::jsonb);
    v_volt_eff := case when tower_cs.is_resolved(v_volt) then (v_volt ->> 'value')::integer end;

    -- 2. tower type: stored on the inspection vs the line's tower list (custom list if the line has one, else registry)
    s_raw := nullif(r.ij ->> 'tower_type', '');
    if r.has_list then
      l_from := 'custom_list'; l_found := r.ct_found; l_raw := coalesce(r.ct_code, r.ct_text);
    else
      l_from := case when r.rt_found then 'registry' else 'none' end; l_found := r.rt_found; l_raw := r.rt_code;
    end if;
    if v_volt_eff is null then
      v_type := jsonb_build_object('status', 'unknown', 'value', null, 'reason', 'voltage_unresolved',
                                   'raw', jsonb_build_object('stored', s_raw, 'listed', l_raw), 'listed_from', l_from);
    else
      s_code := tower_cs.type_code(v_volt_eff, s_raw);
      l_code := tower_cs.type_code(v_volt_eff, l_raw);
      l_text_code := tower_cs.type_code(v_volt_eff, case when r.has_list then r.ct_text else r.rt_text end);
      v_type := tower_cs.reconcile_sources(jsonb_build_object(
                  'stored', s_code, 'listed', l_code,
                  'stored_unrecognized', case when s_raw is not null and s_code is null then s_raw end,
                  'listed_unrecognized', case when l_raw is not null and l_code is null then l_raw end),
                tower_cs.type_codes(v_volt_eff))
                || jsonb_build_object('raw', jsonb_build_object('stored', s_raw, 'listed', l_raw, 'listed_text_code', l_text_code),
                                      'listed_from', l_from);
    end if;
    v_type_eff := case when tower_cs.is_resolved(v_type) then v_type ->> 'value' end;

    -- 3. circuits: line configuration sources + the tower's own saved circuit-2 evidence
    v_circ := tower_cs.reconcile_sources(
                coalesce(r.l_circuits -> 'sources', '{}'::jsonb)
                  || jsonb_build_object('data', case when cardinality(r.c2_kinds) > 0 then 2 end),
                '[1,2]'::jsonb)
              || jsonb_build_object('circuit2_applicability', r.c2_app, 'evidence', to_jsonb(r.c2_kinds));

    -- 4. chain geometry, resolved PER TOWER. The app's rule (getInsulatorMode): tower chain_override, else the line setting.
    --    Evidence, strongest first: (a) a valid explicit tower override; (b) the line setting; (c) when (b) is missing or disagrees
    --    with the saved layout, the saved layout itself IF it is coherent (one length in every phase, state and cycle, every applicable
    --    circuit) and identifies a UNIQUE supported geometry for this voltage/type. (c) is labelled 'inferred_from_saved_layout':
    --    it is what the legacy record shows, not a confirmed physical fact. Arrays are never resized or truncated.
    if v_volt_eff = 400 then chain_eff := null; chain_basis := 'not_applicable_400kv';
    elsif r.ct_chain is not null then chain_eff := r.ct_chain; chain_basis := 'tower_override';
    elsif r.ct_chain_bad then chain_eff := null; chain_basis := 'tower_override_invalid';
    elsif tower_cs.is_resolved(r.l_chain) then chain_eff := r.l_chain ->> 'value'; chain_basis := 'line_' || (r.l_chain ->> 'status');
    else chain_eff := null; chain_basis := 'unresolved_' || coalesce(r.l_chain ->> 'status', 'unknown');
    end if;
    mode_line := tower_cs.insulator_mode(v_volt_eff, v_type_eff, chain_eff);
    pos_all := tower_cs.state_positions(r.s1) || tower_cs.cycle_positions(r.c1);
    if r.c2_app = 'applicable' then pos_all := pos_all || tower_cs.state_positions(r.s2) || tower_cs.cycle_positions(r.c2); end if;
    select count(distinct x), min(x), max(x) into n_len, pos_min, pos_max from unnest(pos_all) x;
    mode_inf := null;
    if n_len = 1 and v_volt_eff = 132 and v_type_eff is not null then
      select m into mode_inf from unnest(array[tower_cs.insulator_mode(132, v_type_eff, 'single'),
                                               tower_cs.insulator_mode(132, v_type_eff, 'double')]) m
       where m is not null and tower_cs.mode_positions(m) = pos_min limit 1;
    end if;
    geo_basis := null; line_disagrees := false;
    if chain_basis = 'tower_override_invalid' then
      v_mode := null; geo_status := 'unknown'; geo_basis := 'tower_override_invalid';
    elsif chain_basis = 'tower_override' then
      v_mode := mode_line; geo_basis := 'tower_override';
      geo_status := case when v_mode is null then 'unknown' when n_len = 0 then 'single_source'
                         when n_len = 1 and pos_min = tower_cs.mode_positions(v_mode) then 'agreed' else 'conflict' end;
    elsif mode_line is not null then
      if n_len = 0 then v_mode := mode_line; geo_status := 'single_source'; geo_basis := 'line_setting';
      elsif n_len = 1 and pos_min = tower_cs.mode_positions(mode_line) then v_mode := mode_line; geo_status := 'agreed'; geo_basis := 'line_setting';
      elsif n_len = 1 and mode_inf is not null then
        v_mode := mode_inf; geo_status := 'inferred'; geo_basis := 'inferred_from_saved_layout'; line_disagrees := true;
      else v_mode := mode_line; geo_status := 'conflict'; geo_basis := 'line_setting'; end if;
    else
      if n_len = 1 and mode_inf is not null then v_mode := mode_inf; geo_status := 'inferred'; geo_basis := 'inferred_from_saved_layout';
      elsif n_len > 1 then v_mode := null; geo_status := 'conflict'; geo_basis := 'saved_layout_incoherent';
      else v_mode := null; geo_status := 'unknown'; geo_basis := chain_basis; end if;
    end if;
    if n_len > 1 then geo_status := 'conflict'; geo_basis := coalesce(geo_basis, 'saved_layout_incoherent'); end if;
    v_pos := jsonb_build_object('derived', tower_cs.mode_positions(v_mode), 'line_derived', tower_cs.mode_positions(mode_line),
                                'observed_lengths', (select coalesce(jsonb_agg(distinct x order by x), '[]') from unnest(pos_all) x));
    exp_chains := tower_cs.mode_chains(v_mode);
    v_chains := jsonb_build_object('status', case when exp_chains is null then 'unknown' else 'single_source' end,
                                   'value', exp_chains, 'sources', jsonb_build_object('derived', exp_chains));
    -- saved insulator data (state AND cycle) per applicable circuit, checked against the resolved geometry
    d1 := tower_cs.insulator_data_status(r.s1, r.s1_st, r.c1, r.c1_st, tower_cs.mode_positions(v_mode));
    d2 := case when r.c2_app = 'applicable'
               then tower_cs.insulator_data_status(r.s2, r.s2_st, r.c2, r.c2_st, tower_cs.mode_positions(v_mode))
               else jsonb_build_object('status', r.c2_app) end;
    v_geo := jsonb_build_object('status', geo_status, 'mode', v_mode, 'basis', geo_basis,
                                'inferred_from_saved_layout', geo_status = 'inferred', 'line_setting_disagrees', line_disagrees,
                                'line_mode', mode_line,
                                'saved_data', jsonb_build_object('circuit1', d1, 'circuit2', d2),
                                'chain_mode', jsonb_build_object('value', chain_eff, 'basis', chain_basis),
                                'positions', v_pos, 'chains_per_phase', v_chains,
                                'observed_positions', to_jsonb(pos_all));

    -- 5. materials per circuit (v334-R2 semantics): raw kept, effective legacy glass labelled, physical observation never claimed
    m1 := tower_cs.material_circuit(r.m1, r.m1_st, exp_chains);
    st1 := m1 ->> 'status';
    if r.c2_app = 'applicable' then
      m2 := tower_cs.material_circuit(r.m2, r.m2_st, exp_chains); st2 := m2 ->> 'status';
    else
      m2 := jsonb_build_object('status', r.c2_app); st2 := null;
    end if;
    mat_status := case when st1 = 'invalid' or st2 = 'invalid' then 'invalid'
                       when st1 = 'missing' and (st2 is null or st2 = 'missing') then 'missing'
                       when st1 = 'missing' or st2 = 'missing' then 'incomplete'
                       when st1 = 'complete' and (st2 is null or st2 = 'complete') then 'complete'
                       else 'legacy_interpretable' end;
    v_mat := jsonb_build_object('status', mat_status, 'circuit1', m1, 'circuit2', m2,
                                'expected_chains_per_phase', exp_chains,
                                'default_glass_applied', false,
                                'effective_glass_is_legacy_convention', mat_status = 'legacy_interpretable',
                                'material_dependent_operations_ready', mat_status = 'complete',
                                'tower_material_default_candidate', r.ct_mat);

    -- 6. notes: presence / size / auto-generated prefix only (free text stays in public.inspections, reachable via source_inspection_id)
    v_notes := jsonb_build_object('source_inspection_id', r.src_id,
      'notes',             jsonb_build_object('present', tower_cs.has_text(r.ij ->> 'notes'), 'chars', char_length(coalesce(r.ij ->> 'notes', '')),
                                              'starts_with_auto_previous_line', coalesce(btrim(r.ij ->> 'notes') ~ '^كشف سابق بتاريخ', false)),
      'road_access_notes', jsonb_build_object('present', tower_cs.has_text(r.ij ->> 'road_access_notes'), 'chars', char_length(coalesce(r.ij ->> 'road_access_notes', ''))),
      'fire_causes_notes', jsonb_build_object('present', tower_cs.has_text(r.ij ->> 'fire_causes_notes'), 'chars', char_length(coalesce(r.ij ->> 'fire_causes_notes', ''))));

    -- 7. readiness: every item resolved, geometry derivable, materials complete, no blocking issue on the tower
    select exists (select 1 from pg_temp._tc_issue z where z.tower_id = r.tower_id and z.severity = 'blocking') into has_blocking;
    blockers := '{}'::text[];
    if not tower_cs.is_resolved(v_volt) then blockers := array_append(blockers, 'voltage_' || (v_volt ->> 'status')); end if;
    if not tower_cs.is_resolved(v_type) then blockers := array_append(blockers, 'tower_type_' || (v_type ->> 'status')); end if;
    if not tower_cs.is_resolved(v_circ) then blockers := array_append(blockers, 'circuits_' || (v_circ ->> 'status')); end if;
    if geo_status in ('unknown', 'conflict') then blockers := array_append(blockers, 'geometry_' || geo_status); end if;
    if mat_status not in ('complete', 'legacy_interpretable') then blockers := array_append(blockers, 'materials_' || mat_status); end if;
    if d1 ->> 'status' <> 'complete' then blockers := array_append(blockers, 'insulator_circuit1_' || (d1 ->> 'status')); end if;
    if r.c2_app = 'applicable' and d2 ->> 'status' <> 'complete' then blockers := array_append(blockers, 'insulator_circuit2_' || (d2 ->> 'status')); end if;
    if has_blocking then blockers := array_append(blockers, 'tower_needs_review'); end if;

    insert into pg_temp._tc_meta values (r.tower_id, r.line_name, r.tower_number, r.src_id, r.inspection_date,
      v_type, v_volt, v_circ, v_geo, v_mat, v_notes, blockers, cardinality(blockers) = 0);

    -- issues (warnings / info: they never change tower_state.status, which remains driven by blocking issues only)
    if v_volt ->> 'status' = 'conflict' then
      insert into pg_temp._tc_issue values ('metadata_voltage_conflict', 'warning', r.tower_id, 'inspections', r.src_id, v_volt);
    end if;
    if v_type ->> 'status' = 'conflict' then
      insert into pg_temp._tc_issue values ('metadata_tower_type_conflict', 'warning', r.tower_id, 'inspections', r.src_id, v_type);
    end if;
    if v_volt_eff is not null and ((s_raw is not null and s_code is null) or (l_raw is not null and l_code is null)) then
      insert into pg_temp._tc_issue values ('metadata_tower_type_unrecognized', 'warning', r.tower_id, 'inspections', r.src_id, v_type);
    end if;
    if r.has_list or r.in_registry then
      if not l_found then
        insert into pg_temp._tc_issue values ('tower_not_in_line_list', 'info', r.tower_id, 'inspections', r.src_id,
                                              jsonb_build_object('line_name', r.line_name, 'tower_number', r.tower_number, 'list', l_from));
      end if;
    end if;
    if cardinality(r.c2_kinds) > 0 and tower_cs.is_resolved(r.l_circuits) and (r.l_circuits ->> 'value') = '1' then
      insert into pg_temp._tc_issue values ('circuit2_data_on_single_line', 'warning', r.tower_id, 'inspections', r.src_id,
                                            jsonb_build_object('evidence', to_jsonb(r.c2_kinds), 'line_circuits', r.l_circuits));
    end if;
    if geo_status = 'conflict' then
      insert into pg_temp._tc_issue values ('geometry_positions_mismatch', 'warning', r.tower_id, 'inspections', r.src_id, v_geo);
    end if;
    if line_disagrees then
      insert into pg_temp._tc_issue values ('geometry_line_setting_disagrees', 'info', r.tower_id, 'inspections', r.src_id,
        jsonb_build_object('line_mode', mode_line, 'line_positions', tower_cs.mode_positions(mode_line), 'inferred_mode', v_mode, 'observed_length', pos_min));
    end if;
  end loop;

  -- towers without any inspection row: explicit "no source" metadata so they are never silently absent
  insert into pg_temp._tc_meta
  select t.tower_id, (select min(a.line_name) from pg_temp._tc_alias a where a.tower_id = t.tower_id),
         (select min(a.tower_number) from pg_temp._tc_alias a where a.tower_id = t.tower_id), null, null,
         jsonb_build_object('status', 'unknown', 'value', null), jsonb_build_object('status', 'unknown', 'value', null),
         jsonb_build_object('status', 'unknown', 'value', null), jsonb_build_object('status', 'unknown', 'mode', null),
         jsonb_build_object('status', 'unknown'), '{}'::jsonb, array['no_source'], false
  from (select distinct tower_id from pg_temp._tc_alias) t where not exists (select 1 from pg_temp._tc_meta m where m.tower_id = t.tower_id);

  -- line-level issues (tower_id NULL: they describe configuration, not one tower)
  insert into pg_temp._tc_issue
  select 'circuit_config_conflict', 'warning', null::uuid, 'line_config', null::uuid,
         jsonb_build_object('line_name', line_name, 'circuits', circuits)
  from pg_temp._tc_line where circuits ->> 'status' = 'conflict';
  insert into pg_temp._tc_issue
  select 'chain_mode_conflict', 'warning', null::uuid, 'line_config', null::uuid,
         jsonb_build_object('line_name', line_name, 'chain_mode', chain_mode)
  from pg_temp._tc_line where chain_mode ->> 'status' = 'conflict';
  insert into pg_temp._tc_issue
  select 'line_voltage_conflict', 'warning', null::uuid, 'line_config', null::uuid,
         jsonb_build_object('line_name', line_name, 'voltage', voltage)
  from pg_temp._tc_line where voltage ->> 'status' = 'conflict';
  insert into pg_temp._tc_issue
  select 'line_override_unmatched', 'info', null::uuid, 'line_towers_custom', null::uuid, jsonb_build_object('line_name', o.ov_line)
  from pg_temp._tc_ov o where not exists (select 1 from pg_temp._tc_lov m where m.ov_line = o.ov_line);
end $$;

-- ---- step 5c: tower status (shared by the batch publisher and the live read path) ---------------------
create or replace function tower_cs.rc_status() returns void
language plpgsql set search_path = pg_catalog as $$
begin
  create temp table _tc_status on commit drop as
  with blk as (
    select tower_id, array_agg(distinct code order by code) as reasons
    from pg_temp._tc_issue where severity = 'blocking' and tower_id is not null group by 1
  )
  select t.tower_id,
         case when p.id is null then 'no_source' when b.reasons is not null then 'needs_review' else 'no_blockers' end as status,
         coalesce(b.reasons, '{}'::text[]) as reasons,
         p.id as src_id, p.inspection_date as src_date, p.created_at as src_created,
         case when p.id is null then '{}'::jsonb else jsonb_build_object(
           'insulator', p.sev_insulator, 'iron', p.sev_iron, 'foundation', p.sev_foundation,
           'wires', p.sev_wires, 'ground', p.sev_ground, 'fire', p.sev_fire) end as sev
  from (select distinct tower_id from pg_temp._tc_alias) t
  left join pg_temp._tc_p p on p.tower_id = t.tower_id
  left join blk b on b.tower_id = t.tower_id;
end $$;

-- ---- step 6: publish (only legacy rows; frozen towers untouched) ----------------------
create or replace function tower_cs.rc_publish(p_run bigint) returns jsonb
language plpgsql set search_path = pg_catalog as $$
declare n_frozen int; n_ts int := 0; n_cs int := 0; n_bl int := 0;
begin
  create temp table _tc_frozen on commit drop as select tower_id from tower_cs.tower_state where rev > 0;
  select count(*) into n_frozen from pg_temp._tc_frozen;

  insert into pg_temp._tc_issue
  select 'frozen_tower_skipped', 'info', tower_id, 'tower_state', null, '{}'::jsonb from pg_temp._tc_frozen;

  -- immutable first capture
  insert into tower_cs.baseline(tower_id, inspection_id, inspection_date, inspection_created_at, captured_run_id, raw)
  select p.tower_id, p.id, p.inspection_date, p.created_at, p_run,
         to_jsonb(i) - 'insulator_svg_r' - 'insulator_svg_s' - 'insulator_svg_t' - 'notes'
  from pg_temp._tc_p p join public.inspections i on i.id = p.id
  on conflict (tower_id) do nothing;
  get diagnostics n_bl = row_count;

  -- tower_state (status/reasons are produced by the shared tower_cs.rc_status)
  insert into tower_cs.tower_state(tower_id, status, review_reasons, source_inspection_id, source_inspection_date,
                                   source_created_at, severities, computed_run_id)
  select w.tower_id, w.status, w.reasons, w.src_id, w.src_date, w.src_created, w.sev, p_run
  from pg_temp._tc_status w
  where not exists (select 1 from pg_temp._tc_frozen f where f.tower_id = w.tower_id)
  on conflict (tower_id) do update
    set status = excluded.status, review_reasons = excluded.review_reasons,
        source_inspection_id = excluded.source_inspection_id, source_inspection_date = excluded.source_inspection_date,
        source_created_at = excluded.source_created_at, severities = excluded.severities,
        computed_run_id = excluded.computed_run_id, computed_at = now()
    where tower_cs.tower_state.rev = 0 and tower_cs.tower_state.origin = 'legacy_backfill'
      and (tower_cs.tower_state.status, tower_cs.tower_state.review_reasons, tower_cs.tower_state.source_inspection_id,
           tower_cs.tower_state.source_inspection_date, tower_cs.tower_state.source_created_at, tower_cs.tower_state.severities)
          is distinct from
          (excluded.status, excluded.review_reasons, excluded.source_inspection_id, excluded.source_inspection_date,
           excluded.source_created_at, excluded.severities);
  get diagnostics n_ts = row_count;

  -- component_state
  insert into tower_cs.component_state(tower_id, component, circuit, condition, data_status, value, flags,
                                       treated_by_treatment_ids, source_inspection_id, applicability, applicability_basis, computed_run_id)
  select c.tower_id, c.component, c.circuit, c.condition, c.data_status, c.value, c.flags, c.tids, c.src_id,
         c.applicability, c.basis, p_run
  from pg_temp._tc_comp c
  where not exists (select 1 from pg_temp._tc_frozen f where f.tower_id = c.tower_id)
  on conflict (tower_id, component) do update
    set circuit = excluded.circuit, condition = excluded.condition, data_status = excluded.data_status,
        value = excluded.value, flags = excluded.flags, treated_by_treatment_ids = excluded.treated_by_treatment_ids,
        source_inspection_id = excluded.source_inspection_id, applicability = excluded.applicability,
        applicability_basis = excluded.applicability_basis, computed_run_id = excluded.computed_run_id, computed_at = now()
    where tower_cs.component_state.origin = 'legacy_backfill' and tower_cs.component_state.rev = 0
      and (tower_cs.component_state.circuit, tower_cs.component_state.condition, tower_cs.component_state.data_status,
           tower_cs.component_state.value, tower_cs.component_state.flags,
           tower_cs.component_state.treated_by_treatment_ids, tower_cs.component_state.source_inspection_id,
           tower_cs.component_state.applicability, tower_cs.component_state.applicability_basis)
          is distinct from
          (excluded.circuit, excluded.condition, excluded.data_status, excluded.value, excluded.flags,
           excluded.treated_by_treatment_ids, excluded.source_inspection_id, excluded.applicability, excluded.applicability_basis);
  get diagnostics n_cs = row_count;

  -- components that no longer have evidence (legacy rows only, non-frozen towers)
  delete from tower_cs.component_state cs
   where cs.origin = 'legacy_backfill' and cs.rev = 0
     and not exists (select 1 from pg_temp._tc_frozen f where f.tower_id = cs.tower_id)
     and not exists (select 1 from pg_temp._tc_comp c where c.tower_id = cs.tower_id and c.component = cs.component);

  -- tower_meta (legacy rows of non-frozen towers only; no churn when nothing changed)
  insert into tower_cs.tower_meta(tower_id, line_name, tower_number, source_inspection_id, source_inspection_date,
                                  tower_type, voltage, circuits, geometry, materials, notes, prefill_blockers, prefill_ready, computed_run_id)
  select m.tower_id, m.line_name, m.tower_number, m.src_id, m.src_date, m.tower_type, m.voltage, m.circuits, m.geometry,
         m.materials, m.notes, m.blockers, m.ready, p_run
  from pg_temp._tc_meta m
  where not exists (select 1 from pg_temp._tc_frozen f where f.tower_id = m.tower_id)
  on conflict (tower_id) do update
    set line_name = excluded.line_name, tower_number = excluded.tower_number, source_inspection_id = excluded.source_inspection_id,
        source_inspection_date = excluded.source_inspection_date, tower_type = excluded.tower_type, voltage = excluded.voltage,
        circuits = excluded.circuits, geometry = excluded.geometry, materials = excluded.materials, notes = excluded.notes,
        prefill_blockers = excluded.prefill_blockers, prefill_ready = excluded.prefill_ready,
        computed_run_id = excluded.computed_run_id, computed_at = now()
    where tower_cs.tower_meta.origin = 'legacy_backfill' and tower_cs.tower_meta.rev = 0
      and (tower_cs.tower_meta.line_name, tower_cs.tower_meta.tower_number, tower_cs.tower_meta.source_inspection_id,
           tower_cs.tower_meta.source_inspection_date, tower_cs.tower_meta.tower_type, tower_cs.tower_meta.voltage,
           tower_cs.tower_meta.circuits, tower_cs.tower_meta.geometry, tower_cs.tower_meta.materials, tower_cs.tower_meta.notes,
           tower_cs.tower_meta.prefill_blockers, tower_cs.tower_meta.prefill_ready)
          is distinct from
          (excluded.line_name, excluded.tower_number, excluded.source_inspection_id, excluded.source_inspection_date,
           excluded.tower_type, excluded.voltage, excluded.circuits, excluded.geometry, excluded.materials, excluded.notes,
           excluded.prefill_blockers, excluded.prefill_ready);
  delete from tower_cs.tower_meta tm
   where tm.origin = 'legacy_backfill' and tm.rev = 0
     and not exists (select 1 from pg_temp._tc_frozen f where f.tower_id = tm.tower_id)
     and not exists (select 1 from pg_temp._tc_meta m where m.tower_id = tm.tower_id);

  -- line_config is fully derived
  delete from tower_cs.line_config where true;
  insert into tower_cs.line_config(line_name, in_registry, voltage, circuits, chain_mode, override_rows, custom_tower_list, computed_run_id)
  select line_name, in_registry, voltage, circuits, chain_mode, n_ov, has_list, p_run from pg_temp._tc_line;

  -- dispositions are fully derived: replace
  delete from tower_cs.treatment_disposition where true;
  insert into tower_cs.treatment_disposition(treatment_id, tower_id, inspection_id, treatment_created_at,
                                             seq_in_inspection, relation, verdict, checks, computed_run_id)
  select id, tower_id, inspection_id, created_at, seq, relation, verdict, checks, p_run from pg_temp._tc_t;

  insert into tower_cs.issue(run_id, tower_id, code, severity, source_table, source_id, detail)
  select p_run, tower_id, code, severity, source_table, source_id, detail from pg_temp._tc_issue;

  return jsonb_build_object('frozen_towers', n_frozen, 'baselines_inserted', n_bl,
                            'tower_state_changed', n_ts, 'component_rows_changed', n_cs);
end $$;

-- ---- entry point ------------------------------------------------------------
create or replace function tower_cs.reconcile(p_note text default null, p_allow_read_committed boolean default false)
returns bigint
language plpgsql set search_path = pg_catalog as $$
declare v_run bigint; v_iso text := current_setting('transaction_isolation'); v_prob text; v_fp jsonb; v_pub jsonb; v_cnt jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('tower_cs.reconcile', 0));
  select string_agg(problem, '; ') into v_prob from tower_cs.preflight();
  if v_prob is not null then raise exception 'schema assumptions not met: %', v_prob; end if;
  if v_iso = 'read committed' and not p_allow_read_committed then
    raise exception 'run inside BEGIN ISOLATION LEVEL REPEATABLE READ (consistent snapshot of inspections+treatments)';
  end if;

  select jsonb_build_object(
    'inspections', (select jsonb_build_object('n', count(*), 'max_created_at', max(created_at), 'max_updated_at', max(updated_at),
                      'md5', md5(coalesce(string_agg(id::text || '|' || coalesce(updated_at::text, ''), ',' order by id), ''))) from public.inspections),
    'treatments',  (select jsonb_build_object('n', count(*), 'max_created_at', max(created_at),
                      'md5', md5(coalesce(string_agg(id::text || '|' || coalesce(items_treated::text, '') || '|' || treatment_date::text, ',' order by id), ''))) from public.treatments))
    into v_fp;

  insert into tower_cs.run(note, isolation_level, source_fingerprint) values (p_note, v_iso, v_fp) returning run_id into v_run;

  perform tower_cs.rc_drop_temp();
  perform tower_cs.rc_identity(v_run);
  perform tower_cs.rc_scope_batch();
  perform tower_cs.rc_source();
  perform tower_cs.rc_treatments();
  perform tower_cs.rc_lineconfig();
  perform tower_cs.rc_components();
  perform tower_cs.rc_issues();
  perform tower_cs.rc_meta();
  perform tower_cs.rc_status();
  v_pub := tower_cs.rc_publish(v_run);

  select jsonb_build_object(
    'towers', (select count(*) from tower_cs.tower),
    'new_towers', (select count(*) from tower_cs.tower where created_run_id = v_run),
    'status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from tower_cs.tower_state group by 1) s),
    'issues', (select coalesce(jsonb_object_agg(code || '/' || severity, n), '{}') from (select code, severity, count(*) n from tower_cs.issue where run_id = v_run group by 1, 2) i),
    'publish', v_pub) into v_cnt;
  update tower_cs.run set status = 'done', finished_at = now(), counts = v_cnt where run_id = v_run;
  return v_run;
end $$;

-- ===== B. session bridge + account RPCs (10_session_bridge.sql) =====
-- =====================================================================
-- 10_session_bridge.sql : server-verified sessions + role-checked account operations (ADDITIVE; does not touch public.users data)
--
--   login      public.app_login(username, password)      -> opaque random token (only its SHA-256 digest is stored, in tower_cs, private)
--   session    public.app_session(token) / app_logout(token)
--   accounts   public.app_users_list / app_users_names / app_profile_update / app_username_change / app_password_change /
--              app_user_create / app_user_reset_password / app_user_set_active / app_user_set_inventory / app_user_delete
--   recovery   tower_cs.admin_* (owner / SQL-editor only; NOT executable by anon / authenticated)
--
-- Rules enforced here (server side, never trusted from the client):
--   * the role / active / locked state is read from public.users on EVERY call - never from the token, the request or localStorage
--   * credentials are checked with the existing bcrypt hashes (public.users.password_hash via pgcrypto crypt()); NULL / empty / non-bcrypt
--     hash or password is rejected explicitly (a NULL comparison can never be read as "equal")
--   * no function here returns a password, a password_hash or any hash material; login failure / lock returns NO profile
--   * SECURITY DEFINER functions pin search_path (pg_catalog, pg_temp) and schema-qualify everything, including pgcrypto (extensions.*)
-- =====================================================================

do $$
declare miss text;
begin
  select string_agg(c, ', ') into miss from unnest(array['id','username','full_name','role','is_active','password_hash','failed_login_attempts','locked_until',
                                                           'department','phone','can_manage_inventory','last_login','created_at','email']) c
   where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = c);
  if miss is not null then raise exception 'public.users lacks expected columns: %', miss; end if;
  if to_regprocedure('extensions.crypt(text,text)') is null or to_regprocedure('extensions.gen_salt(text)') is null
     or to_regprocedure('extensions.digest(text,text)') is null or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'pgcrypto functions are not in schema "extensions" (create extension pgcrypto schema extensions)';
  end if;
end $$;

-- ---- private session store -------------------------------------------------------------------------
create table if not exists tower_cs.app_session (
  session_id    uuid primary key default gen_random_uuid(),
  user_id       text not null,                       -- public.users.id::text (type-agnostic on purpose)
  token_digest  bytea not null unique,               -- sha256(token); the token itself is never stored
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  revoked_reason text
);
create index if not exists app_session_user_idx on tower_cs.app_session(user_id);
alter table tower_cs.app_session enable row level security;
revoke all on tower_cs.app_session from public;

-- state of the (optional, later) users-access cutover + the ACLs it replaced (for an exact rollback)
create table if not exists tower_cs.cutover_state (applied_at timestamptz not null, rolled_back_at timestamptz);
create table if not exists tower_cs.cutover_acl (kind text not null, object text not null, col text, grantee text not null, privilege text not null, grantable boolean not null);
alter table tower_cs.cutover_state enable row level security;
alter table tower_cs.cutover_acl enable row level security;
revoke all on tower_cs.cutover_state, tower_cs.cutover_acl from public;

-- ---- helpers (private) ----------------------------------------------------------------------------
create or replace function tower_cs.hash_usable(h text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select h is not null and h ~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' $$;

-- credential check: NEVER true when anything is NULL / empty / not a bcrypt hash
create or replace function tower_cs.pw_matches(p_plain text, p_hash text) returns boolean
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if p_plain is null or p_plain = '' or char_length(p_plain) > 128 then return false; end if;
  if not tower_cs.hash_usable(p_hash) then return false; end if;
  return coalesce(extensions.crypt(p_plain, p_hash) = p_hash, false);
exception when others then
  return false;
end $$;

create or replace function tower_cs.safe_profile(u public.users) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object('id', u.id, 'username', u.username, 'full_name', u.full_name, 'role', u.role,
                            'department', u.department, 'phone', u.phone,
                            'can_manage_inventory', coalesce(u.can_manage_inventory, false), 'is_active', coalesce(u.is_active, false)) $$;

-- session validation. Returns {ok:true, user:{...}, session_id, expires_at} or {ok:false, code}
create or replace function tower_cs.auth_check(p_token text, p_roles text[] default null) returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare s tower_cs.app_session; u public.users;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'code', 'invalid_session'); end if;
  select * into s from tower_cs.app_session where token_digest = extensions.digest(p_token, 'sha256');
  if not found then return jsonb_build_object('ok', false, 'code', 'invalid_session'); end if;
  if s.revoked_at is not null then return jsonb_build_object('ok', false, 'code', 'revoked'); end if;
  if s.expires_at <= now() or s.last_seen_at < now() - interval '7 days' then return jsonb_build_object('ok', false, 'code', 'expired'); end if;
  select * into u from public.users where id::text = s.user_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'invalid_session'); end if;
  if coalesce(u.is_active, false) is not true then return jsonb_build_object('ok', false, 'code', 'inactive'); end if;
  if u.locked_until is not null and u.locked_until > now() then return jsonb_build_object('ok', false, 'code', 'locked'); end if;
  if p_roles is not null and (u.role is null or u.role <> all (p_roles)) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if s.last_seen_at < now() - interval '5 minutes' then
    update tower_cs.app_session set last_seen_at = now() where session_id = s.session_id;
  end if;
  return jsonb_build_object('ok', true, 'user', tower_cs.safe_profile(u), 'session_id', s.session_id, 'expires_at', s.expires_at);
end $$;

-- count a failed credential check against the account (same columns / semantics the legacy login uses)
create or replace function tower_cs.note_failure(p_user_id text) returns void
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  update public.users
     set failed_login_attempts = coalesce(failed_login_attempts, 0) + 1,
         locked_until = case when coalesce(failed_login_attempts, 0) + 1 >= 5 then now() + interval '15 minutes' else locked_until end
   where id::text = p_user_id;
end $$;

-- verified actor for sensitive account operations: valid session + role + the actor's OWN password re-entered
create or replace function tower_cs.actor_check(p_token text, p_actor_password text, p_roles text[]) returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token, p_roles); u public.users;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  select * into u from public.users where id::text = (a -> 'user' ->> 'id');
  if not tower_cs.pw_matches(p_actor_password, u.password_hash) then
    perform tower_cs.note_failure(u.id::text);
    return jsonb_build_object('ok', false, 'code', 'bad_actor');
  end if;
  return a;
end $$;

-- ---- public API ---------------------------------------------------------------------------------------
create or replace function public.app_login(p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare u public.users; tok text; bad jsonb := jsonb_build_object('ok', false, 'code', 'invalid_credentials');
begin
  if p_username is null or btrim(p_username) = '' or p_password is null or p_password = '' or char_length(p_password) > 128 or char_length(p_username) > 128 then
    perform extensions.crypt('x', extensions.gen_salt('bf'));      -- uniform cost
    return bad;
  end if;
  select * into u from public.users where username = btrim(p_username) limit 1;
  if not found then perform extensions.crypt(p_password, extensions.gen_salt('bf')); return bad; end if;
  if u.locked_until is not null and u.locked_until > now() then
    return jsonb_build_object('ok', false, 'code', 'locked',
                              'minutes_left', greatest(1, ceil(extract(epoch from (u.locked_until - now())) / 60)::int));
  end if;
  if not tower_cs.pw_matches(p_password, u.password_hash) then
    if not tower_cs.hash_usable(u.password_hash) then perform extensions.crypt(p_password, extensions.gen_salt('bf')); end if;
    perform tower_cs.note_failure(u.id::text);
    return bad;
  end if;
  if coalesce(u.is_active, false) is not true then return jsonb_build_object('ok', false, 'code', 'inactive'); end if;

  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into tower_cs.app_session(user_id, token_digest, expires_at) values (u.id::text, extensions.digest(tok, 'sha256'), now() + interval '30 days');
  update public.users set failed_login_attempts = 0, locked_until = null, last_login = now() where id = u.id;
  -- housekeeping: old rows, and at most 20 live sessions per user
  delete from tower_cs.app_session where (expires_at < now() - interval '30 days') or (revoked_at is not null and revoked_at < now() - interval '30 days');
  update tower_cs.app_session set revoked_at = now(), revoked_reason = 'session_cap'
   where user_id = u.id::text and revoked_at is null
     and session_id in (select session_id from tower_cs.app_session where user_id = u.id::text and revoked_at is null
                        order by created_at desc offset 20);
  return jsonb_build_object('ok', true, 'token', tok, 'expires_at', now() + interval '30 days', 'profile', tower_cs.safe_profile(u));
end $$;

create or replace function public.app_session(p_token text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token);
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  return jsonb_build_object('ok', true, 'profile', a -> 'user', 'expires_at', a -> 'expires_at');
end $$;

create or replace function public.app_logout(p_token text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if p_token is not null and p_token ~ '^[0-9a-f]{64}$' then
    update tower_cs.app_session set revoked_at = now(), revoked_reason = 'logout'
     where token_digest = extensions.digest(p_token, 'sha256') and revoked_at is null;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---- account operations (all role-checked on the server) -----------------------------------------------
create or replace function public.app_users_list(p_token text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token, array['admin']);
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  return jsonb_build_object('ok', true, 'users', coalesce((
    select jsonb_agg(tower_cs.safe_profile(u) || jsonb_build_object('created_at', u.created_at, 'last_login', u.last_login) order by u.created_at desc nulls last)
    from public.users u), '[]'::jsonb));
end $$;

create or replace function public.app_users_names(p_token text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token, array['admin', 'supervisor']);
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  return jsonb_build_object('ok', true, 'users', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'full_name', u.full_name, 'role', u.role)) from public.users u), '[]'::jsonb));
end $$;

create or replace function public.app_profile_update(p_token text, p_full_name text, p_phone text, p_department text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token); u public.users;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if p_full_name is null or btrim(p_full_name) = '' then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  update public.users set full_name = btrim(p_full_name), phone = p_phone, department = p_department
   where id::text = (a -> 'user' ->> 'id') returning * into u;
  return jsonb_build_object('ok', true, 'profile', tower_cs.safe_profile(u));
end $$;

create or replace function public.app_username_change(p_token text, p_new_username text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token, array['admin']); u public.users; nu text := btrim(coalesce(p_new_username, ''));
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if nu = '' or char_length(nu) > 64 then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  if exists (select 1 from public.users x where x.username = nu and x.id::text <> (a -> 'user' ->> 'id')) then return jsonb_build_object('ok', false, 'code', 'duplicate'); end if;
  update public.users set username = nu where id::text = (a -> 'user' ->> 'id') returning * into u;
  return jsonb_build_object('ok', true, 'profile', tower_cs.safe_profile(u));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'duplicate');
end $$;

-- own password: requires the CURRENT password (verified server-side) and a new password of at least 8 characters
create or replace function public.app_password_change(p_token text, p_current_password text, p_new_password text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.actor_check(p_token, p_current_password, null);
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if p_new_password is null or char_length(p_new_password) < 8 or char_length(p_new_password) > 128 then return jsonb_build_object('ok', false, 'code', 'weak_password'); end if;
  update public.users set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')), failed_login_attempts = 0, locked_until = null
   where id::text = (a -> 'user' ->> 'id');
  -- other sessions of this account end; the current one continues
  update tower_cs.app_session set revoked_at = now(), revoked_reason = 'password_changed'
   where user_id = (a -> 'user' ->> 'id') and revoked_at is null and session_id <> (a ->> 'session_id')::uuid;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_user_create(p_token text, p_actor_password text, p_full_name text, p_username text, p_role text,
                                                  p_department text, p_can_manage_inventory boolean, p_new_password text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.actor_check(p_token, p_actor_password, array['admin']); nu text := btrim(coalesce(p_username, '')); id_new uuid;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if p_new_password is null or char_length(p_new_password) < 8 or char_length(p_new_password) > 128 then return jsonb_build_object('ok', false, 'code', 'weak_password'); end if;
  if p_full_name is null or btrim(p_full_name) = '' or nu = '' or char_length(nu) > 64
     or p_role is null or p_role not in ('admin', 'supervisor', 'technician', 'readonly') then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  insert into public.users(full_name, username, role, department, email, can_manage_inventory, password_hash)
  values (btrim(p_full_name), nu, p_role, p_department, nu || '@local.app', coalesce(p_can_manage_inventory, false),
          extensions.crypt(p_new_password, extensions.gen_salt('bf')))
  returning id into id_new;
  return jsonb_build_object('ok', true, 'id', id_new);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'duplicate');
end $$;

create or replace function public.app_user_reset_password(p_token text, p_actor_password text, p_user_id text, p_new_password text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.actor_check(p_token, p_actor_password, array['admin']); n int;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if p_new_password is null or char_length(p_new_password) < 8 or char_length(p_new_password) > 128 then return jsonb_build_object('ok', false, 'code', 'weak_password'); end if;
  update public.users set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')), failed_login_attempts = 0, locked_until = null
   where id::text = p_user_id;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'code', 'target_not_found'); end if;
  update tower_cs.app_session set revoked_at = now(), revoked_reason = 'password_reset' where user_id = p_user_id and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_user_set_active(p_token text, p_user_id text, p_active boolean) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token, array['admin']); t public.users;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if p_active is null then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  select * into t from public.users where id::text = p_user_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'target_not_found'); end if;
  if p_active is false and t.role = 'admin' and coalesce(t.is_active, false)
     and not exists (select 1 from public.users x where x.role = 'admin' and coalesce(x.is_active, false) and x.id <> t.id) then
    return jsonb_build_object('ok', false, 'code', 'last_admin');
  end if;
  update public.users set is_active = p_active where id = t.id;
  if p_active is false then
    update tower_cs.app_session set revoked_at = now(), revoked_reason = 'deactivated' where user_id = p_user_id and revoked_at is null;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_user_set_inventory(p_token text, p_user_id text, p_value boolean) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token, array['admin']); n int;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if p_value is null then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  update public.users set can_manage_inventory = p_value where id::text = p_user_id;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'code', 'target_not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_user_delete(p_token text, p_user_id text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token, array['admin']); t public.users;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  select * into t from public.users where id::text = p_user_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'target_not_found'); end if;
  if t.role = 'admin' and coalesce(t.is_active, false)
     and not exists (select 1 from public.users x where x.role = 'admin' and coalesce(x.is_active, false) and x.id <> t.id) then
    return jsonb_build_object('ok', false, 'code', 'last_admin');
  end if;
  delete from public.users where id = t.id;
  delete from tower_cs.app_session where user_id = p_user_id;
  return jsonb_build_object('ok', true);
exception when foreign_key_violation then
  return jsonb_build_object('ok', false, 'code', 'in_use');
end $$;

-- ---- owner / SQL-editor recovery (NOT reachable from the API) ---------------------------------------------
create or replace function tower_cs.admin_accounts_without_usable_hash() returns table(username text, role text, is_active boolean)
language sql stable set search_path = pg_catalog as $$
  select u.username, u.role, coalesce(u.is_active, false) from public.users u where not tower_cs.hash_usable(u.password_hash) order by 3 desc, 1 $$;

create or replace function tower_cs.admin_set_password(p_username text, p_new_password text) returns text
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare n int;
begin
  if p_username is null or btrim(p_username) = '' then raise exception 'username required'; end if;
  if p_new_password is null or char_length(p_new_password) < 8 or char_length(p_new_password) > 128 then raise exception 'password must be 8..128 characters'; end if;
  update public.users set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')), failed_login_attempts = 0, locked_until = null
   where username = btrim(p_username);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'no unique account named %', p_username; end if;
  update tower_cs.app_session set revoked_at = now(), revoked_reason = 'admin_recovery'
   where user_id = (select id::text from public.users where username = btrim(p_username)) and revoked_at is null;
  return 'password set for ' || btrim(p_username) || ' (sessions revoked)';
end $$;

create or replace function tower_cs.admin_unlock(p_username text) returns text
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare n int;
begin
  update public.users set failed_login_attempts = 0, locked_until = null where username = btrim(coalesce(p_username, ''));
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'no unique account named %', p_username; end if;
  return 'unlocked ' || btrim(p_username);
end $$;

create or replace function tower_cs.admin_revoke_sessions(p_username text default null) returns integer
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare n int;
begin
  update tower_cs.app_session set revoked_at = now(), revoked_reason = 'admin'
   where revoked_at is null and (p_username is null or user_id = (select id::text from public.users where username = btrim(p_username)));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---- grants: the API roles may call ONLY the public.app_* entry points -----------------------------------
do $$
declare f text;
begin
  -- private helpers / recovery: nobody but the owner
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'tower_cs'::regnamespace
           and p.proname in ('hash_usable','pw_matches','safe_profile','auth_check','note_failure','actor_check',
                             'admin_accounts_without_usable_hash','admin_set_password','admin_unlock','admin_revoke_sessions') loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon, authenticated', f);
  end loop;
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in
           ('app_login','app_session','app_logout','app_users_list','app_users_names','app_profile_update','app_username_change',
            'app_password_change','app_user_create','app_user_reset_password','app_user_set_active','app_user_set_inventory','app_user_delete') loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

-- ===== C. live state reads (11_live_state.sql) =====
-- =====================================================================
-- 11_live_state.sql : LIVE current-state reads. Requires 03_reconcile.sql (scope-aware rc_* steps) and 10_session_bridge.sql.
--
-- tower_cs is a manually recomputed SHADOW. These reads never serve it as "current": every request resolves the requested towers from the
-- legacy inspections + treatments + line configuration AS THEY ARE NOW, by running the SAME rc_* steps the batch reconcile runs, over a
-- request-scoped tower set (pg_temp._tc_alias). Nothing is written to tower_cs (no run, no baseline, no tower_state churn).
--
-- Consistency under READ COMMITTED: the source rows of the requested towers + the line configuration are fingerprinted before and after the
-- resolution; if anything changed in between the resolution is repeated (3 tries) and otherwise reported as 'unstable_read' (never half-applied).
-- Frozen towers (tower_state.rev > 0, future operation writes) are NOT recomputed from legacy: their stored rows are served as origin 'operations'.
-- =====================================================================

create or replace function tower_cs.live_version() returns text
language sql immutable set search_path = pg_catalog as $$ select 'live1'::text $$;

-- ---- scope: the requested towers of ONE line (p_towers null = every tower the line has in the legacy tables or the alias registry) ----
create or replace function tower_cs.live_scope(p_line text, p_towers text[]) returns void
language plpgsql set search_path = pg_catalog as $$
begin
  perform tower_cs.rc_drop_temp();
  create temp table _tc_req on commit drop as
    select distinct u.n as tower_number from (
      select x as n from unnest(p_towers) x where p_towers is not null
      union all select i.tower_number from public.inspections i where p_towers is null and i.line_name = p_line
      union all select t.tower_number from public.treatments t where p_towers is null and t.line_name = p_line
      union all select a.tower_number from tower_cs.tower_alias a where p_towers is null and a.line_name = p_line) u
    where u.n is not null and u.n <> '';
  create temp table _tc_alias on commit drop as
    select coalesce(a.alias_id, -(row_number() over (order by r.tower_number))::bigint) as alias_id,
           coalesce(a.tower_id, gen_random_uuid()) as tower_id,
           p_line::text as line_name, r.tower_number::text as tower_number,
           tower_cs.norm_line(p_line) as norm_line, tower_cs.norm_tower(r.tower_number) as norm_tower,
           (select count(*)::int from public.inspections i where i.line_name = p_line and i.tower_number = r.tower_number) as inspection_count,
           (select count(*)::int from public.treatments t where t.line_name = p_line and t.tower_number = r.tower_number) as treatment_count,
           (select min(i.inspection_date) from public.inspections i where i.line_name = p_line and i.tower_number = r.tower_number) as first_inspection_date,
           (select max(i.inspection_date) from public.inspections i where i.line_name = p_line and i.tower_number = r.tower_number) as last_inspection_date,
           a.created_run_id
    from pg_temp._tc_req r
    left join tower_cs.tower_alias a on a.line_name = p_line and a.tower_number = r.tower_number;
  -- identity-variant detection must see the persisted registry too (a variant spelling of a requested tower is a blocking issue)
  create temp table _tc_alias_all on commit drop as
    select a.* from tower_cs.tower_alias a where not exists (select 1 from pg_temp._tc_alias s where s.line_name = a.line_name and s.tower_number = a.tower_number)
    union all select * from pg_temp._tc_alias;
end $$;

-- ---- fingerprint of everything the resolution reads for the requested towers ----------------------------------
create or replace function tower_cs.live_fp(p_line text, p_towers text[]) returns jsonb
language plpgsql set search_path = pg_catalog as $$
declare cfg text := ''; per jsonb;
begin
  if to_regclass('public.line_towers_custom') is not null then
    execute 'select coalesce(md5(string_agg(md5(to_jsonb(l)::text), '','' order by (to_jsonb(l) ->> ''line_name''))), '''') from public.line_towers_custom l where (to_jsonb(l) ->> ''line_name'') = any ($1)'
      into cfg using tower_cs.line_candidates(p_line);
  end if;
  select coalesce(jsonb_object_agg(tn, h), '{}'::jsonb) into per from (
    select tn, md5(string_agg(h, ',' order by k)) as h from (
      select i.tower_number as tn, i.id::text as k,
             'i' || md5((to_jsonb(i) - 'insulator_svg_r' - 'insulator_svg_s' - 'insulator_svg_t')::text) as h
        from public.inspections i where i.line_name = p_line and (p_towers is null or i.tower_number = any (p_towers))
      union all
      select t.tower_number, t.id::text,
             't' || md5((to_jsonb(t) - 'insulator_svg_r' - 'insulator_svg_s' - 'insulator_svg_t' - 'insulator_svg_r_2' - 'insulator_svg_s_2' - 'insulator_svg_t_2')::text)
        from public.treatments t where t.line_name = p_line and (p_towers is null or t.tower_number = any (p_towers))) z
    group by tn) y;
  return jsonb_build_object('cfg', cfg, 'per', per,
                            'ref', (select coalesce(md5(string_agg(md5(to_jsonb(r)::text), ',' order by r.line_name)), '') from tower_cs.ref_line r where r.line_name = p_line));
end $$;

-- ---- envelope per tower, from the resolver's temp tables ----------------------------------------------------
-- p_detail: full components (with values) + treatments + full meta.  p_rows: 'full' | 'grid' | 'none' (source inspection row)
create or replace function tower_cs.live_pack(p_line text, p_fp jsonb, p_detail boolean, p_rows text) returns jsonb
language plpgsql set search_path = pg_catalog as $$
declare out jsonb;
begin
  with al as (select distinct on (tower_number) tower_id, tower_number from pg_temp._tc_alias order by tower_number),
  fr as (select s.tower_id from tower_cs.tower_state s where s.rev > 0 and s.tower_id in (select tower_id from al)),
  comp as (
    select tower_id, jsonb_agg(jsonb_build_object('k', component, 'ci', circuit, 'cond', condition, 'ds', data_status, 'fl', to_jsonb(flags), 'ap', applicability)
                               || case when p_detail then jsonb_build_object('v', value, 'tids', to_jsonb(tids)) else '{}'::jsonb end order by component) as j
    from pg_temp._tc_comp where p_detail or condition in ('defect', 'treated') or data_status <> 'known' group by tower_id),
  keys as (select tower_id, jsonb_agg(key order by key) as j from pg_temp._tc_keys group by tower_id),
  trt as (
    select tower_id, jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at, 'seq', seq, 'relation', relation, 'verdict', verdict,
                                                   'items_status', items_status, 'checks', checks) order by created_at, id) as j
    from pg_temp._tc_t group by tower_id),
  iss as (
    select tower_id, jsonb_agg(jsonb_build_object('code', code, 'severity', severity) order by severity, code) as j
    from pg_temp._tc_issue where tower_id is not null and severity in ('blocking', 'warning') group by tower_id),
  env as (
    select al.tower_number,
      case when fr.tower_id is not null then
        jsonb_build_object('basis', 'operations', 'status', fs.status, 'resolution', case fs.status when 'no_source' then 'no_source' when 'needs_review' then 'unresolved' else 'resolved' end,
          'unresolved_reasons', to_jsonb(fs.review_reasons),
          'source', case when fs.source_inspection_id is null then null else jsonb_build_object('inspection_id', fs.source_inspection_id, 'inspection_date', fs.source_inspection_date, 'created_at', fs.source_created_at) end,
          'row', null, 'treated_keys', '[]'::jsonb,
          'components', coalesce((select jsonb_agg(jsonb_build_object('k', c.component, 'ci', c.circuit, 'cond', c.condition, 'ds', c.data_status, 'fl', to_jsonb(c.flags), 'ap', c.applicability)
                                                    || case when p_detail then jsonb_build_object('v', c.value) else '{}'::jsonb end order by c.component)
                                   from tower_cs.component_state c where c.tower_id = al.tower_id), '[]'::jsonb),
          'meta', (select to_jsonb(m) - 'tower_id' - 'computed_run_id' from tower_cs.tower_meta m where m.tower_id = al.tower_id),
          'treatments', '[]'::jsonb, 'issues', '[]'::jsonb)
      else
        jsonb_build_object('basis', 'live_legacy', 'status', st.status,
          'resolution', case st.status when 'no_source' then 'no_source' when 'needs_review' then 'unresolved' else 'resolved' end,
          'unresolved_reasons', to_jsonb(st.reasons),
          'source', case when st.src_id is null then null else jsonb_build_object('inspection_id', st.src_id, 'inspection_date', st.src_date, 'created_at', st.src_created) end,
          'row', case p_rows when 'full' then (select to_jsonb(i) from public.inspections i where i.id = st.src_id)
                             when 'grid' then (select to_jsonb(i) - 'insulator_svg_r' - 'insulator_svg_s' - 'insulator_svg_t' from public.inspections i where i.id = st.src_id)
                             else null end,
          'treated_keys', coalesce(keys.j, '[]'::jsonb),
          'components', coalesce(comp.j, '[]'::jsonb),
          'meta', case when p_detail then
                    jsonb_build_object('tower_type', m.tower_type, 'voltage', m.voltage, 'circuits', m.circuits, 'geometry', m.geometry, 'materials', m.materials,
                                       'prefill_blockers', to_jsonb(m.blockers), 'prefill_ready', m.ready, 'source_inspection_id', m.src_id)
                  else
                    jsonb_build_object('geometry_mode', m.geometry -> 'mode', 'geometry_status', m.geometry -> 'status', 'geometry_basis', m.geometry -> 'basis',
                                       'materials_status', m.materials -> 'status', 'prefill_blockers', to_jsonb(m.blockers), 'prefill_ready', m.ready,
                                       'circuit2', m.circuits -> 'circuit2_applicability') end,
          'treatments', case when p_detail then coalesce(trt.j, '[]'::jsonb) else '[]'::jsonb end,
          'issues', coalesce(iss.j, '[]'::jsonb))
      end
      || jsonb_build_object('line_name', p_line, 'tower_number', al.tower_number,
           'version', md5(coalesce(p_fp -> 'per' ->> al.tower_number, '') || '|' || coalesce(p_fp ->> 'cfg', '') || '|' || coalesce(p_fp ->> 'ref', '') || '|' || tower_cs.live_version())) as j
    from al
    left join fr on fr.tower_id = al.tower_id
    left join tower_cs.tower_state fs on fs.tower_id = al.tower_id and fr.tower_id is not null
    left join pg_temp._tc_status st on st.tower_id = al.tower_id
    left join pg_temp._tc_meta m on m.tower_id = al.tower_id
    left join comp on comp.tower_id = al.tower_id
    left join keys on keys.tower_id = al.tower_id
    left join trt on trt.tower_id = al.tower_id
    left join iss on iss.tower_id = al.tower_id)
  select coalesce(jsonb_object_agg(tower_number, j), '{}'::jsonb) into out from env;
  return out;
end $$;

-- ---- consistent resolution loop -------------------------------------------------------------------------
-- jit = off: the resolver's many small statements are never worth JIT compilation (measured: ~2.4 s with JIT vs ~75 ms without, per request)
create or replace function tower_cs.live_resolve(p_line text, p_towers text[], p_detail boolean, p_rows text) returns jsonb
language plpgsql set search_path = pg_catalog set jit = off as $$
declare n int := 0; fp0 jsonb; fp1 jsonb; towers jsonb;
begin
  loop
    n := n + 1;
    fp0 := tower_cs.live_fp(p_line, p_towers);
    perform tower_cs.live_scope(p_line, p_towers);
    perform tower_cs.rc_source();
    perform tower_cs.rc_treatments();
    perform tower_cs.rc_lineconfig();
    perform tower_cs.rc_components();
    perform tower_cs.rc_issues();
    perform tower_cs.rc_meta();
    perform tower_cs.rc_status();
    towers := tower_cs.live_pack(p_line, fp0, p_detail, p_rows);
    fp1 := tower_cs.live_fp(p_line, p_towers);
    exit when fp0 = fp1;
    if n >= 3 then return jsonb_build_object('ok', false, 'code', 'unstable_read'); end if;
  end loop;
  return jsonb_build_object('ok', true, 'resolver', tower_cs.live_version(), 'as_of', clock_timestamp(), 'line_name', p_line, 'attempts', n, 'towers', towers);
end $$;

-- ---- public entry points (session required) ----------------------------------------------------------------
create or replace function public.app_tower_state(p_token text, p_line_name text, p_tower_number text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token); r jsonb;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if p_line_name is null or btrim(p_line_name) = '' or p_tower_number is null or btrim(p_tower_number) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  r := tower_cs.live_resolve(p_line_name, array[p_tower_number], true, 'full');
  if not (r ->> 'ok')::boolean then return r; end if;
  return (r || jsonb_build_object('tower', r -> 'towers' -> p_tower_number)) - 'towers';
end $$;

-- batched line read (departures): one request per line, never one per tower. p_towers null = the whole line (capped)
create or replace function public.app_line_state(p_token text, p_line_name text, p_towers text[] default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token); r jsonb;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if p_line_name is null or btrim(p_line_name) = '' then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  if p_towers is not null and cardinality(p_towers) > 400 then return jsonb_build_object('ok', false, 'code', 'too_many'); end if;
  if p_towers is null and (select count(distinct tn) from (select tower_number tn from public.inspections where line_name = p_line_name
                                                           union all select tower_number from public.treatments where line_name = p_line_name) z) > 400 then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;
  return tower_cs.live_resolve(p_line_name, p_towers, false, 'grid');
end $$;

-- line registry for the departures overview: one cheap call that names every line having legacy inspections or treatments
create or replace function public.app_line_names(p_token text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token);
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  return jsonb_build_object('ok', true, 'lines', coalesce((select jsonb_agg(n order by n) from (
           select line_name n from public.inspections where line_name is not null and line_name <> ''
           union select line_name from public.treatments where line_name is not null and line_name <> '') z), '[]'::jsonb));
end $$;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'tower_cs'::regnamespace
           and (p.proname like 'live\_%' or p.proname like 'rc\_%' or p.proname = 'reconcile') loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon, authenticated', f);
  end loop;
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_tower_state', 'app_line_state', 'app_line_names') loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

-- ===== D. lockdown of tower_cs (05_lockdown.sql, idempotent) =====
-- =====================================================================
-- 05_lockdown.sql : no PUBLIC / anon / authenticated access to anything in tower_cs. Idempotent; re-run after any change.
-- service_role (server-side secret key, bypasses RLS) is deliberately left untouched; it is not a frontend role.
-- =====================================================================
do $$
declare r text; t record;
begin
  execute 'revoke all on schema tower_cs from public';
  execute 'revoke all on all tables    in schema tower_cs from public';
  execute 'revoke all on all sequences in schema tower_cs from public';
  execute 'revoke all on all functions in schema tower_cs from public';
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema tower_cs from %I', r);
      execute format('revoke all on all tables    in schema tower_cs from %I', r);
      execute format('revoke all on all sequences in schema tower_cs from %I', r);
      execute format('revoke all on all functions in schema tower_cs from %I', r);
    end if;
  end loop;
  -- defence in depth: RLS on, no policies => deny for any role that is not owner / BYPASSRLS
  for t in select quote_ident(schemaname) || '.' || quote_ident(tablename) as q from pg_tables where schemaname = 'tower_cs' loop
    execute 'alter table ' || t.q || ' enable row level security';
  end loop;
end $$;

notify pgrst, 'reload schema';


-- ===== B. 20_ops_schema =====
-- =====================================================================
-- 20_ops_schema.sql : v335-C4 unified tower state WRITES - schema (tables, columns, immutability triggers)
-- Requires the Stage-1/1B schema and the session bridge. Additive: new table tower_cs.op, new columns on tower_state/component_state.
-- The append-only operation log is the ONLY writer of tower_state / component_state / tower_meta for towers with rev > 0.
-- =====================================================================
do $$
begin
  if to_regclass('tower_cs.component_state') is null or to_regclass('tower_cs.tower_meta') is null or to_regclass('tower_cs.app_session') is null then
    raise exception 'Stage 1/1B + session bridge must be installed before the operations layer';
  end if;
end $$;

-- ---- per-component write metadata ----------------------------------------------------------------------------
alter table tower_cs.component_state add column if not exists last_op_id uuid;
alter table tower_cs.component_state add column if not exists effective_date date;   -- business date of the last effective write (orders back-dated observations)
-- ---- per-section severity write metadata ------------------------------------------------------------------------
alter table tower_cs.tower_state add column if not exists sev_meta jsonb not null default '{}'::jsonb;  -- {section: {rev, op, date}}
alter table tower_cs.tower_state add column if not exists last_op_id uuid;

-- ---- append-only operation log ----------------------------------------------------------------------------------
create table if not exists tower_cs.op (
  op_id          uuid primary key,                    -- durable client-generated UUID; idempotency key
  tower_id       uuid not null references tower_cs.tower(tower_id),
  rev            bigint not null,                     -- per-tower server revision (orders accepted operations; NEVER inspection_date)
  kind           text not null check (kind in ('seed','observation','treatment','correction','void','annotate','config')),
  status         text not null check (status in ('applied','partial','historical_only')),
  business_date  date,                                -- observed / treatment business date (not ordering)
  recorded_at    timestamptz not null default clock_timestamp(),
  actor_user_id  text,                                -- derived on the server from the verified session
  actor_name     text,
  actor_role     text,
  source_table   text,                                -- historical source row written by this op (public.inspections / public.treatments)
  source_id      uuid,
  target_op      uuid,                                -- void / correction / annotate target operation
  target_source_id uuid,                              -- void target that has no operation (legacy row)
  request_hash   text not null,
  touched        text[] not null default '{}',        -- components explicitly observed / treated / configured
  applied        text[] not null default '{}',        -- subset actually written to current state
  skipped        jsonb not null default '{}'::jsonb,  -- component -> reason (superseded by a newer observation, ...)
  delta          jsonb not null,                      -- {comps:{key:row}, sev:{section:v}, tower_state:{...}, meta:{...}}  (AFTER values; the fold applies these)
  before         jsonb not null default '{}'::jsonb,  -- server-computed BEFORE values of what the delta replaces
  reason         text,
  result         jsonb,                               -- stored response for idempotent replay
  unique (tower_id, rev)
);
create index if not exists op_tower_idx on tower_cs.op(tower_id, rev);
create index if not exists op_source_idx on tower_cs.op(source_id) where source_id is not null;
create index if not exists op_target_idx on tower_cs.op(target_op) where target_op is not null;
create index if not exists op_target_src_idx on tower_cs.op(target_source_id) where target_source_id is not null;

-- evidence is immutable: no UPDATE, no DELETE (rollback drops the whole table explicitly)
create or replace function tower_cs.op_immutable() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'tower_cs.op is an append-only operation log (% blocked)', tg_op;
end $$;
drop trigger if exists op_immutable on tower_cs.op;
create trigger op_immutable before update or delete on tower_cs.op for each row execute function tower_cs.op_immutable();
drop trigger if exists op_immutable_truncate on tower_cs.op;
create trigger op_immutable_truncate before truncate on tower_cs.op for each statement execute function tower_cs.op_immutable();

alter table tower_cs.op enable row level security;

-- ---- recorded ACL so the lockdown of direct writes can be reversed exactly --------------------------------------------
create table if not exists tower_cs.ops_acl (
  kind text not null, object text not null, col text, grantee text not null, privilege text not null, grantable boolean not null
);
create table if not exists tower_cs.ops_policy (
  tbl text not null, policyname text not null, definition text not null
);
create table if not exists tower_cs.ops_state (applied_at timestamptz not null, lockdown_at timestamptz, rolled_back_at timestamptz);


-- ===== B. 21_ops_core =====
-- =====================================================================
-- 21_ops_core.sql : operations layer core - pure helpers, state fold, meta derivation, seeding from the legacy resolver
-- All functions live in tower_cs (never exposed to API roles; the public.app_* entry points are in 22_ops_apply.sql).
-- =====================================================================

-- ---- component vocabulary ---------------------------------------------------------------------------------------
create or replace function tower_cs.op_keys() returns text[] language sql immutable set search_path = pg_catalog as $$
  select array['ins_R','ins_S','ins_T','ins2_R','ins2_S','ins2_T','iron','foundation','attachment','wire_r1','wire_s1','wire_t1',
               'wire_r1_c2','wire_s1_c2','wire_t1_c2','ground_1','ground_2','road','washing','fire'] $$;
create or replace function tower_cs.op_kind(k text) returns text language sql immutable set search_path = pg_catalog as $$
  select case when k like 'ins%' then 'ins' when k = 'road' then 'road' when k = 'washing' then 'washing' when k = 'fire' then 'fire' else 'free' end $$;
create or replace function tower_cs.op_circuit(k text) returns smallint language sql immutable set search_path = pg_catalog as $$
  select case when k like 'ins2\_%' or k like 'wire\_%\_c2' then 2 when k like 'ins\_%' or k like 'wire\_%' then 1 end::smallint $$;
create or replace function tower_cs.op_section(k text) returns text language sql immutable set search_path = pg_catalog as $$
  select case when k like 'ins%' then 'insulator' when k = 'iron' then 'iron' when k = 'foundation' then 'foundation'
              when k like 'wire%' then 'wires' when k like 'ground%' then 'ground' when k = 'fire' then 'fire' end $$;
create or replace function tower_cs.op_phase(k text) returns text language sql immutable set search_path = pg_catalog as $$
  select case when k ~ '^ins2?_[RST]$' then right(k, 1) end $$;
create or replace function tower_cs.op_is_c2(k text) returns boolean language sql immutable set search_path = pg_catalog as $$
  select k like 'ins2\_%' or k like 'wire\_%\_c2' $$;
create or replace function tower_cs.op_sev_ok(v text) returns boolean language sql immutable set search_path = pg_catalog as $$
  select v in ('ok','simple','moderate','below_critical','critical') $$;
-- inspections column that carries a text component (state / cycle / chain-type JSON columns are handled separately)
create or replace function tower_cs.op_column(k text) returns text language sql immutable set search_path = pg_catalog as $$
  select case k when 'iron' then 'iron_intersections' when 'foundation' then 'tower_foundations' when 'attachment' then 'tower_attachments'
    when 'wire_r1' then 'wires_r1' when 'wire_s1' then 'wires_s1' when 'wire_t1' then 'wires_t1'
    when 'wire_r1_c2' then 'wires_r1_c2' when 'wire_s1_c2' then 'wires_s1_c2' when 'wire_t1_c2' then 'wires_t1_c2'
    when 'ground_1' then 'ground_1' when 'ground_2' then 'ground_2' when 'road' then 'road_access' when 'washing' then 'insulator_washing'
    when 'fire' then 'sev_fire' end $$;

create or replace function tower_cs.op_ts(t timestamptz) returns text language sql stable set search_path = pg_catalog as $$
  select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;

-- a persistent run row for the writes of the operations layer (tower_state/component_state/tower_meta require computed_run_id)
create or replace function tower_cs.op_run() returns bigint language plpgsql set search_path = pg_catalog as $$
declare r bigint;
begin
  select run_id into r from tower_cs.run where note = 'operations-layer' order by run_id limit 1;
  if r is null then
    insert into tower_cs.run(note, isolation_level, status, finished_at, counts) values ('operations-layer', 'operations', 'done', now(), '{}'::jsonb) returning run_id into r;
  end if;
  return r;
end $$;

-- ---- component rows (jsonb): the unit stored in component_state and carried by operation deltas ---------------------
-- keys: circuit, condition, data_status, value, flags, tids, applicability, basis, src, eff
create or replace function tower_cs.op_norm_row(p jsonb) returns jsonb language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object('circuit', p -> 'circuit', 'condition', p -> 'condition', 'data_status', p -> 'data_status',
         'value', coalesce(p -> 'value', '{}'::jsonb), 'flags', coalesce(p -> 'flags', '[]'::jsonb), 'tids', coalesce(p -> 'tids', '[]'::jsonb),
         'applicability', coalesce(p -> 'applicability', '"applicable"'::jsonb), 'basis', coalesce(p -> 'basis', '{}'::jsonb),
         'src', p -> 'src', 'eff', p -> 'eff') $$;

create or replace function tower_cs.op_blank_row(p_key text, p_app text, p_basis jsonb) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare reason text; flag text;
begin
  if p_app = 'applicable' then reason := 'never_observed'; flag := 'never_observed';
  else
    reason := case p_app when 'not_applicable' then 'circuit_not_applicable' else 'circuit_applicability_unknown' end;
    flag := case p_app when 'not_applicable' then 'circuit2_not_applicable' else 'circuit2_applicability_unknown' end;
  end if;
  return tower_cs.op_norm_row(jsonb_build_object('circuit', tower_cs.op_circuit(p_key), 'condition', 'unknown', 'data_status', 'unknown',
           'value', jsonb_build_object('reason', reason), 'flags', jsonb_build_array(flag), 'tids', '[]'::jsonb,
           'applicability', p_app, 'basis', coalesce(p_basis, '{}'::jsonb), 'src', null, 'eff', null));
end $$;

create or replace function tower_cs.op_blank_comps(p_c2_app text, p_c2_basis jsonb) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare k text; out jsonb := '{}'::jsonb;
begin
  foreach k in array tower_cs.op_keys() loop
    out := out || jsonb_build_object(k, tower_cs.op_blank_row(k, case when tower_cs.op_is_c2(k) then p_c2_app else 'applicable' end,
                                                                  case when tower_cs.op_is_c2(k) then p_c2_basis else '{}'::jsonb end));
  end loop;
  return out;
end $$;

-- text component row from an observation value ({"text":..} or, for fire, {"sev":..,"notes":..})
create or replace function tower_cs.op_text_row(p_key text, p_val jsonb, p_src uuid, p_eff date, p_app text, p_basis jsonb) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare kind text := tower_cs.op_kind(p_key); raw text; v jsonb; cl record;
begin
  if kind = 'fire' then raw := p_val ->> 'sev'; v := jsonb_build_object('sev', p_val -> 'sev', 'notes', coalesce(p_val -> 'notes', to_jsonb(''::text)));
  else raw := p_val ->> 'text'; v := jsonb_build_object('text', p_val -> 'text'); end if;
  select * into cl from tower_cs.classify_text(kind, raw);
  return tower_cs.op_norm_row(jsonb_build_object('circuit', tower_cs.op_circuit(p_key), 'condition', cl.condition, 'data_status', cl.data_status,
           'value', v, 'flags', to_jsonb(cl.flags), 'tids', '[]'::jsonb, 'applicability', p_app, 'basis', p_basis, 'src', p_src, 'eff', p_eff));
end $$;

-- insulator phase row. p_damaged: bool array; p_cycle: int array or NULL (unknown); p_chains: saved chain materials for the phase
-- (NULL = never saved, [] = saved empty = legacy glass convention, [...] = recorded). Never defaults anything.
create or replace function tower_cs.op_ins_row(p_key text, p_damaged jsonb, p_cycle jsonb, p_chains jsonb, p_src uuid, p_eff date,
                                               p_tids jsonb, p_extra_flags text[], p_app text, p_basis jsonb) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare ph text := tower_cs.op_phase(p_key); x record; fl jsonb;
begin
  select * into x from tower_cs.ins_phase(ph, jsonb_build_object(ph, p_damaged), 'ok',
        case when p_cycle is null or jsonb_typeof(p_cycle) = 'null' then null else jsonb_build_object(ph, p_cycle) end,
        case when p_cycle is null or jsonb_typeof(p_cycle) = 'null' then 'null' else 'ok' end,
        case when p_chains is null or jsonb_typeof(p_chains) = 'null' then null else jsonb_build_object(ph, p_chains) end,
        case when p_chains is null or jsonb_typeof(p_chains) = 'null' then 'null' else 'ok' end);
  fl := to_jsonb(x.flags || coalesce(p_extra_flags, '{}'::text[]));
  return tower_cs.op_norm_row(jsonb_build_object('circuit', tower_cs.op_circuit(p_key), 'condition', x.condition, 'data_status', x.data_status,
           'value', x.value || jsonb_build_object('chains_saved', case when p_chains is null then 'null'::jsonb else p_chains end),
           'flags', fl, 'tids', coalesce(p_tids, '[]'::jsonb), 'applicability', p_app, 'basis', p_basis, 'src', p_src, 'eff', p_eff));
end $$;

-- ---- tower state as one jsonb (the shape the fold produces and the tables hold) -------------------------------------
create or replace function tower_cs.op_state_load(p_tower uuid) returns jsonb
language sql stable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'comps', coalesce((select jsonb_object_agg(c.component, jsonb_build_object('circuit', c.circuit, 'condition', c.condition, 'data_status', c.data_status,
                 'value', c.value, 'flags', to_jsonb(c.flags), 'tids', to_jsonb(c.treated_by_treatment_ids), 'applicability', c.applicability,
                 'basis', c.applicability_basis, 'src', c.source_inspection_id, 'eff', c.effective_date, 'rev', c.rev, 'last_op', c.last_op_id))
               from tower_cs.component_state c where c.tower_id = p_tower), '{}'::jsonb),
    'ts', (select jsonb_build_object('status', s.status, 'reasons', to_jsonb(s.review_reasons), 'src_id', s.source_inspection_id,
                 'src_date', s.source_inspection_date, 'src_created', tower_cs.op_ts(s.source_created_at), 'sev', s.severities,
                 'sev_meta', s.sev_meta, 'rev', s.rev, 'last_op', s.last_op_id) from tower_cs.tower_state s where s.tower_id = p_tower),
    'meta', (select jsonb_build_object('line_name', m.line_name, 'tower_number', m.tower_number, 'source_inspection_id', m.source_inspection_id,
                 'source_inspection_date', m.source_inspection_date, 'tower_type', m.tower_type, 'voltage', m.voltage, 'circuits', m.circuits,
                 'geometry', m.geometry, 'materials', m.materials, 'notes', m.notes, 'prefill_blockers', to_jsonb(m.prefill_blockers),
                 'prefill_ready', m.prefill_ready, 'rev', m.rev) from tower_cs.tower_meta m where m.tower_id = p_tower)) $$;

-- pure fold step: applies ONE operation delta to a state
create or replace function tower_cs.op_fold_step(p_state jsonb, p_delta jsonb, p_rev bigint, p_op uuid) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare s jsonb := coalesce(p_state, jsonb_build_object('comps', '{}'::jsonb, 'ts', '{}'::jsonb, 'meta', '{}'::jsonb));
        k text; r jsonb; d jsonb; sec text; sv jsonb; sm jsonb; ts jsonb;
begin
  if p_delta ? 'comps' then
    for k, r in select e.key, e.value from jsonb_each(p_delta -> 'comps') e loop
      s := jsonb_set(s, array['comps', k], tower_cs.op_norm_row(r) || jsonb_build_object('rev', p_rev, 'last_op', coalesce(nullif(r ->> 'wop', '')::uuid, p_op)), true);
    end loop;
  end if;
  if p_delta ? 'ts' then
    d := p_delta -> 'ts';
    sv := coalesce(s #> '{ts,sev}', '{}'::jsonb) || coalesce(d -> 'sev', '{}'::jsonb);
    sm := coalesce(s #> '{ts,sev_meta}', '{}'::jsonb);
    if d ? 'sev_meta' then
      for sec, r in select e.key, e.value from jsonb_each(d -> 'sev_meta') e loop
        sm := sm || jsonb_build_object(sec, r || jsonb_build_object('rev', p_rev, 'op', p_op));
      end loop;
    end if;
    ts := coalesce(s -> 'ts', '{}'::jsonb) || (d - 'sev' - 'sev_meta');
    s := jsonb_set(s, '{ts}', ts || jsonb_build_object('sev', sv, 'sev_meta', sm, 'rev', p_rev, 'last_op', p_op), true);
  else
    s := jsonb_set(s, '{ts}', coalesce(s -> 'ts', '{}'::jsonb) || jsonb_build_object('rev', p_rev, 'last_op', p_op), true);
  end if;
  if p_delta ? 'meta' then
    s := jsonb_set(s, '{meta}', coalesce(s -> 'meta', '{}'::jsonb) || (p_delta -> 'meta') || jsonb_build_object('rev', p_rev), true);
  else
    s := jsonb_set(s, '{meta}', coalesce(s -> 'meta', '{}'::jsonb) || jsonb_build_object('rev', p_rev), true);
  end if;
  return s;
end $$;

-- writes a whole state (as produced by the fold) into the tables. The ONLY writer of tower_state/component_state/tower_meta for rev>0 towers.
create or replace function tower_cs.op_state_store(p_tower uuid, p_state jsonb) returns void
language plpgsql set search_path = pg_catalog as $$
declare run bigint := tower_cs.op_run(); k text; r jsonb; ts jsonb := p_state -> 'ts'; m jsonb := p_state -> 'meta';
begin
  insert into tower_cs.tower_state(tower_id, rev, origin, status, review_reasons, source_inspection_id, source_inspection_date, source_created_at,
                                   severities, sev_meta, last_op_id, computed_run_id)
  values (p_tower, (ts ->> 'rev')::bigint, 'operation', ts ->> 'status',
          coalesce(array(select jsonb_array_elements_text(ts -> 'reasons')), '{}'::text[]),
          nullif(ts ->> 'src_id', '')::uuid, nullif(ts ->> 'src_date', '')::date, nullif(ts ->> 'src_created', '')::timestamptz,
          coalesce(ts -> 'sev', '{}'::jsonb), coalesce(ts -> 'sev_meta', '{}'::jsonb), nullif(ts ->> 'last_op', '')::uuid, run)
  on conflict (tower_id) do update set rev = excluded.rev, origin = 'operation', status = excluded.status, review_reasons = excluded.review_reasons,
    source_inspection_id = excluded.source_inspection_id, source_inspection_date = excluded.source_inspection_date,
    source_created_at = excluded.source_created_at, severities = excluded.severities, sev_meta = excluded.sev_meta,
    last_op_id = excluded.last_op_id, computed_run_id = excluded.computed_run_id, computed_at = now();
  delete from tower_cs.component_state where tower_id = p_tower and not (p_state -> 'comps' ? component);
  for k, r in select e.key, e.value from jsonb_each(p_state -> 'comps') e loop
    insert into tower_cs.component_state(tower_id, component, circuit, condition, data_status, value, flags, treated_by_treatment_ids,
                                         source_inspection_id, rev, origin, computed_run_id, applicability, applicability_basis, last_op_id, effective_date)
    values (p_tower, k, nullif(r ->> 'circuit', '')::smallint, r ->> 'condition', r ->> 'data_status', r -> 'value',
            coalesce(array(select jsonb_array_elements_text(r -> 'flags')), '{}'::text[]),
            coalesce(array(select jsonb_array_elements_text(r -> 'tids')::uuid), '{}'::uuid[]),
            nullif(r ->> 'src', '')::uuid, (r ->> 'rev')::bigint, 'operation', run, r ->> 'applicability', r -> 'basis',
            nullif(r ->> 'last_op', '')::uuid, nullif(r ->> 'eff', '')::date)
    on conflict (tower_id, component) do update set circuit = excluded.circuit, condition = excluded.condition, data_status = excluded.data_status,
      value = excluded.value, flags = excluded.flags, treated_by_treatment_ids = excluded.treated_by_treatment_ids,
      source_inspection_id = excluded.source_inspection_id, rev = excluded.rev, origin = 'operation', computed_run_id = run,
      applicability = excluded.applicability, applicability_basis = excluded.applicability_basis, last_op_id = excluded.last_op_id,
      effective_date = excluded.effective_date, computed_at = now();
  end loop;
  insert into tower_cs.tower_meta(tower_id, line_name, tower_number, source_inspection_id, source_inspection_date, tower_type, voltage, circuits,
                                  geometry, materials, notes, prefill_blockers, prefill_ready, rev, origin, computed_run_id)
  values (p_tower, m ->> 'line_name', m ->> 'tower_number', nullif(m ->> 'source_inspection_id', '')::uuid, nullif(m ->> 'source_inspection_date', '')::date,
          m -> 'tower_type', m -> 'voltage', m -> 'circuits', m -> 'geometry', m -> 'materials', m -> 'notes',
          coalesce(array(select jsonb_array_elements_text(m -> 'prefill_blockers')), '{}'::text[]), (m ->> 'prefill_ready')::boolean,
          (m ->> 'rev')::bigint, 'operation', run)
  on conflict (tower_id) do update set line_name = excluded.line_name, tower_number = excluded.tower_number,
    source_inspection_id = excluded.source_inspection_id, source_inspection_date = excluded.source_inspection_date, tower_type = excluded.tower_type,
    voltage = excluded.voltage, circuits = excluded.circuits, geometry = excluded.geometry, materials = excluded.materials, notes = excluded.notes,
    prefill_blockers = excluded.prefill_blockers, prefill_ready = excluded.prefill_ready, rev = excluded.rev, origin = 'operation',
    computed_run_id = run, computed_at = now();
end $$;

-- ---- materials of a circuit from the saved chain arrays of its three phases -----------------------------------------
-- p_saved: {"R":[..],"S":[..],"T":[..]} containing ONLY the phases that were ever saved. A phase that was never saved is 'missing'
-- (never read as glass); an empty saved array is the legacy glass convention (labelled implicit_legacy_glass by material_phase).
create or replace function tower_cs.op_material_circuit(p_saved jsonb, p_expected integer) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare ph text; pr jsonb; res jsonb := '{}'::jsonb; n_miss int := 0; n_inv int := 0; n_exp int := 0; n_leg int := 0;
begin
  if p_saved is null or p_saved = '{}'::jsonb then return jsonb_build_object('status', 'missing', 'reason', 'never_saved', 'raw', null); end if;
  foreach ph in array array['R', 'S', 'T'] loop
    if p_saved ? ph then
      pr := tower_cs.material_phase(p_saved -> ph, p_expected);
      res := res || jsonb_build_object(ph, pr);
      case pr ->> 'status' when 'invalid' then n_inv := n_inv + 1; when 'explicit' then n_exp := n_exp + 1; else n_leg := n_leg + 1; end case;
    else
      res := res || jsonb_build_object(ph, jsonb_build_object('status', 'missing'));
      n_miss := n_miss + 1;
    end if;
  end loop;
  return res || jsonb_build_object('raw', p_saved, 'physical_observation', case when n_leg > 0 then 'unknown_for_implicit_entries' else 'recorded' end,
    'status', case when n_inv > 0 then 'invalid' when n_miss > 0 then 'incomplete' when n_exp = 3 then 'complete' else 'legacy_interpretable' end);
end $$;

-- ---- meta derivation: recompute everything that is a pure function of (stored configuration decisions, component rows) -------
-- Keeps tower_type / voltage / circuits / geometry decisions as stored; recomputes saved_data, materials, blockers, readiness.
create or replace function tower_cs.op_meta_derive(p_meta jsonb, p_comps jsonb, p_status text) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare
  mode text := p_meta #>> '{geometry,mode}'; pos integer := tower_cs.mode_positions(p_meta #>> '{geometry,mode}'); expc integer := tower_cs.mode_chains(p_meta #>> '{geometry,mode}');
  c2app text := coalesce(p_meta #>> '{circuits,circuit2_applicability}', 'unknown');
  ph text; k text; c jsonb; s1 jsonb := '{}'::jsonb; cy1 jsonb := '{}'::jsonb; m1 jsonb := '{}'::jsonb; s2 jsonb := '{}'::jsonb; cy2 jsonb := '{}'::jsonb; m2 jsonb := '{}'::jsonb;
  inv1 boolean := false; inv2 boolean := false; d1 jsonb; d2 jsonb; mc1 jsonb; mc2 jsonb; st1 text; st2 text; mat_status text;
  blockers text[] := '{}'::text[]; geo_status text := p_meta #>> '{geometry,status}';
begin
  foreach ph in array array['R', 'S', 'T'] loop
    foreach k in array array['ins_' || ph, 'ins2_' || ph] loop
      c := p_comps -> k;
      if c is null then continue; end if;
      if k like 'ins2%' and c ->> 'applicability' <> 'applicable' then continue; end if;
      if c ->> 'data_status' = 'invalid' then
        if k like 'ins2%' then inv2 := true; else inv1 := true; end if;
      end if;
      if c ->> 'data_status' = 'known' and tower_cs.is_bool_array(c #> '{value,damaged}') then
        if k like 'ins2%' then s2 := s2 || jsonb_build_object(ph, c #> '{value,damaged}'); else s1 := s1 || jsonb_build_object(ph, c #> '{value,damaged}'); end if;
        if tower_cs.is_nonneg_int_array(c #> '{value,cycle}') then
          if k like 'ins2%' then cy2 := cy2 || jsonb_build_object(ph, c #> '{value,cycle}'); else cy1 := cy1 || jsonb_build_object(ph, c #> '{value,cycle}'); end if;
        end if;
      end if;
      if c -> 'flags' ? 'chains_unparseable' then
        if k like 'ins2%' then m2 := m2 || jsonb_build_object(ph, 'invalid'::text); else m1 := m1 || jsonb_build_object(ph, 'invalid'::text); end if;
      elsif jsonb_typeof(c #> '{value,chains_saved}') = 'array' then
        if k like 'ins2%' then m2 := m2 || jsonb_build_object(ph, c #> '{value,chains_saved}'); else m1 := m1 || jsonb_build_object(ph, c #> '{value,chains_saved}'); end if;
      end if;
    end loop;
  end loop;
  d1 := case when inv1 then jsonb_build_object('status', 'invalid', 'reason', 'component_invalid')
             else tower_cs.insulator_data_status(nullif(s1, '{}'::jsonb), case when s1 = '{}'::jsonb then 'null' else 'ok' end,
                                                 nullif(cy1, '{}'::jsonb), case when cy1 = '{}'::jsonb then 'null' else 'ok' end, pos) end;
  d2 := case when c2app <> 'applicable' then jsonb_build_object('status', c2app)
             when inv2 then jsonb_build_object('status', 'invalid', 'reason', 'component_invalid')
             else tower_cs.insulator_data_status(nullif(s2, '{}'::jsonb), case when s2 = '{}'::jsonb then 'null' else 'ok' end,
                                                 nullif(cy2, '{}'::jsonb), case when cy2 = '{}'::jsonb then 'null' else 'ok' end, pos) end;
  mc1 := tower_cs.op_material_circuit(m1, expc); st1 := mc1 ->> 'status';
  if c2app = 'applicable' then mc2 := tower_cs.op_material_circuit(m2, expc); st2 := mc2 ->> 'status';
  else mc2 := jsonb_build_object('status', c2app); st2 := null; end if;
  mat_status := case when st1 = 'invalid' or st2 = 'invalid' then 'invalid'
                     when st1 = 'missing' and (st2 is null or st2 = 'missing') then 'missing'
                     when st1 in ('missing', 'incomplete') or st2 in ('missing', 'incomplete') then 'incomplete'
                     when st1 = 'complete' and (st2 is null or st2 = 'complete') then 'complete'
                     else 'legacy_interpretable' end;
  if not tower_cs.is_resolved(p_meta -> 'voltage') then blockers := array_append(blockers, 'voltage_' || coalesce(p_meta #>> '{voltage,status}', 'unknown')); end if;
  if not tower_cs.is_resolved(p_meta -> 'tower_type') then blockers := array_append(blockers, 'tower_type_' || coalesce(p_meta #>> '{tower_type,status}', 'unknown')); end if;
  if not tower_cs.is_resolved(p_meta -> 'circuits') then blockers := array_append(blockers, 'circuits_' || coalesce(p_meta #>> '{circuits,status}', 'unknown')); end if;
  if geo_status in ('unknown', 'conflict') then blockers := array_append(blockers, 'geometry_' || geo_status); end if;
  if mat_status not in ('complete', 'legacy_interpretable') then blockers := array_append(blockers, 'materials_' || mat_status); end if;
  if d1 ->> 'status' <> 'complete' then blockers := array_append(blockers, 'insulator_circuit1_' || (d1 ->> 'status')); end if;
  if c2app = 'applicable' and d2 ->> 'status' <> 'complete' then blockers := array_append(blockers, 'insulator_circuit2_' || (d2 ->> 'status')); end if;
  if p_status = 'needs_review' then blockers := array_append(blockers, 'tower_needs_review'); end if;
  if p_status = 'no_source' then blockers := array_append(blockers, 'no_source'); end if;
  return p_meta
    || jsonb_build_object('geometry', coalesce(p_meta -> 'geometry', '{}'::jsonb) || jsonb_build_object('saved_data', jsonb_build_object('circuit1', d1, 'circuit2', d2)),
         'materials', jsonb_build_object('status', mat_status, 'circuit1', mc1, 'circuit2', mc2, 'expected_chains_per_phase', expc,
            'default_glass_applied', false, 'effective_glass_is_legacy_convention', mat_status = 'legacy_interpretable',
            'material_dependent_operations_ready', mat_status = 'complete',
            'tower_material_default_candidate', p_meta #> '{materials,tower_material_default_candidate}'),
         'prefill_blockers', to_jsonb(blockers), 'prefill_ready', cardinality(blockers) = 0);
end $$;

-- status of a tower from its component rows and the persistent (legacy-evidence) review reasons
create or replace function tower_cs.op_status(p_comps jsonb, p_persist text[], p_has_source boolean) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare reasons text[] := coalesce(p_persist, '{}'::text[]); k text; r jsonb;
begin
  reasons := array_remove(reasons, 'component_invalid');
  for k, r in select e.key, e.value from jsonb_each(p_comps) e loop
    if r ->> 'data_status' = 'invalid' and r ->> 'applicability' = 'applicable' then
      reasons := array_append(reasons, 'component_invalid'); exit;
    end if;
  end loop;
  return jsonb_build_object('status', case when not p_has_source then 'no_source' when cardinality(reasons) > 0 then 'needs_review' else 'no_blockers' end,
                            'reasons', to_jsonb(reasons));
end $$;

-- ---- identity: stable tower_id for (line, number). Creates it atomically for a tower never seen before ---------------------
create or replace function tower_cs.op_identity(p_line text, p_number text, p_create boolean, p_require_listed boolean default true) returns uuid
language plpgsql set search_path = pg_catalog as $$
declare t uuid; v record; listed boolean;
begin
  select tower_id into t from tower_cs.tower_alias where line_name = p_line and tower_number = p_number;
  if t is not null then return t; end if;
  if not p_create then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('tower_cs.identity:' || p_line || '|' || p_number, 0));
  select tower_id into t from tower_cs.tower_alias where line_name = p_line and tower_number = p_number;
  if t is not null then return t; end if;
  -- a spelling variant of an established identity must never create a second tower
  select a.line_name, a.tower_number into v from tower_cs.tower_alias a
   where a.norm_line = tower_cs.norm_line(p_line) and a.norm_tower = tower_cs.norm_tower(p_number) limit 1;
  if found then
    raise exception 'identity_variant:%|%', v.line_name, v.tower_number using errcode = 'P0001';
  end if;
  -- the tower must be listed in the application's line configuration (custom list when the line has one, else the registry list)
  select exists (
      select 1 from tower_cs.ref_tower r where r.line_name = any (tower_cs.line_candidates(p_line)) and r.tower_number = p_number
      union all
      select 1 from public.line_towers_custom l, jsonb_array_elements(case when jsonb_typeof(l.towers) = 'array' then l.towers else '[]'::jsonb end) e
       where l.line_name = any (tower_cs.line_candidates(p_line)) and jsonb_typeof(e) = 'object' and e ->> 'num' = p_number) into listed;
  if p_require_listed and not listed then raise exception 'unknown_tower' using errcode = 'P0001'; end if;
  insert into tower_cs.tower(created_run_id) values (null) returning tower_id into t;
  insert into tower_cs.tower_alias(tower_id, line_name, tower_number, norm_line, norm_tower)
    values (t, p_line, p_number, tower_cs.norm_line(p_line), tower_cs.norm_tower(p_number));
  return t;
end $$;

-- ---- configuration decisions for a tower that has no saved inspection (reads the resolver's line temp tables) ----------------
-- Mirrors rc_meta items 1-4 for the "no saved layout" case. Nothing is defaulted: a missing source stays unknown.
create or replace function tower_cs.op_blank_meta(p_line text, p_number text, p_hint jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  l record; ct record; rt record; has_list boolean; v_volt jsonb; v_volt_eff integer; s_raw text; s_code text; l_raw text; l_code text; l_from text;
  v_type jsonb; v_type_eff text; v_circ jsonb; c2app text; chain_eff text; chain_basis text; mode_line text; geo_status text; geo_basis text;
  v_geo jsonb; m jsonb; expc integer;
begin
  select * into l from pg_temp._tc_line where line_name = p_line;
  select * into ct from pg_temp._tc_ct where line_name = p_line and tower_number = p_number;
  select * into rt from tower_cs.ref_tower where line_name = p_line and tower_number = p_number;
  has_list := coalesce(l.has_list, false);
  v_volt := tower_cs.reconcile_sources(jsonb_build_object('stored', tower_cs.safe_int(p_hint -> 'voltage'),
              'registry', l.voltage -> 'sources' -> 'registry', 'name_suffix', l.voltage -> 'sources' -> 'name_suffix'), '[132,400]'::jsonb);
  v_volt_eff := case when tower_cs.is_resolved(v_volt) then (v_volt ->> 'value')::integer end;
  s_raw := nullif(p_hint ->> 'tower_type', '');
  if has_list then l_from := 'custom_list'; l_raw := coalesce(ct.type_code, ct.type_text);
  else l_from := case when rt.tower_number is not null then 'registry' else 'none' end; l_raw := rt.type_code; end if;
  if v_volt_eff is null then
    v_type := jsonb_build_object('status', 'unknown', 'value', null, 'reason', 'voltage_unresolved', 'raw', jsonb_build_object('stored', s_raw, 'listed', l_raw), 'listed_from', l_from);
  else
    s_code := tower_cs.type_code(v_volt_eff, s_raw); l_code := tower_cs.type_code(v_volt_eff, l_raw);
    v_type := tower_cs.reconcile_sources(jsonb_build_object('stored', s_code, 'listed', l_code,
                'stored_unrecognized', case when s_raw is not null and s_code is null then s_raw end,
                'listed_unrecognized', case when l_raw is not null and l_code is null then l_raw end), tower_cs.type_codes(v_volt_eff))
              || jsonb_build_object('raw', jsonb_build_object('stored', s_raw, 'listed', l_raw), 'listed_from', l_from);
  end if;
  v_type_eff := case when tower_cs.is_resolved(v_type) then v_type ->> 'value' end;
  v_circ := tower_cs.reconcile_sources(coalesce(l.circuits -> 'sources', '{}'::jsonb), '[1,2]'::jsonb);
  c2app := case when tower_cs.is_resolved(v_circ) and (v_circ ->> 'value') = '2' then 'applicable'
                when tower_cs.is_resolved(v_circ) and (v_circ ->> 'value') = '1' then 'not_applicable' else 'unknown' end;
  v_circ := v_circ || jsonb_build_object('circuit2_applicability', c2app, 'evidence', '[]'::jsonb);
  if v_volt_eff = 400 then chain_eff := null; chain_basis := 'not_applicable_400kv';
  elsif ct.chain_override is not null then chain_eff := ct.chain_override; chain_basis := 'tower_override';
  elsif coalesce(ct.chain_override_invalid, false) then chain_eff := null; chain_basis := 'tower_override_invalid';
  elsif tower_cs.is_resolved(l.chain_mode) then chain_eff := l.chain_mode ->> 'value'; chain_basis := 'line_' || (l.chain_mode ->> 'status');
  else chain_eff := null; chain_basis := 'unresolved_' || coalesce(l.chain_mode ->> 'status', 'unknown'); end if;
  mode_line := tower_cs.insulator_mode(v_volt_eff, v_type_eff, chain_eff);
  geo_status := case when chain_basis = 'tower_override_invalid' or mode_line is null then 'unknown' else 'single_source' end;
  geo_basis := case when chain_basis = 'tower_override' then 'tower_override' when chain_basis = 'tower_override_invalid' then 'tower_override_invalid'
                    when mode_line is not null then 'line_setting' else chain_basis end;
  expc := tower_cs.mode_chains(mode_line);
  v_geo := jsonb_build_object('status', geo_status, 'mode', case when chain_basis = 'tower_override_invalid' then null else mode_line end, 'basis', geo_basis,
            'inferred_from_saved_layout', false, 'line_setting_disagrees', false, 'line_mode', mode_line,
            'saved_data', jsonb_build_object('circuit1', jsonb_build_object('status', 'missing'), 'circuit2', jsonb_build_object('status', case when c2app = 'applicable' then 'missing' else c2app end)),
            'chain_mode', jsonb_build_object('value', chain_eff, 'basis', chain_basis),
            'positions', jsonb_build_object('derived', tower_cs.mode_positions(mode_line), 'line_derived', tower_cs.mode_positions(mode_line), 'observed_lengths', '[]'::jsonb),
            'chains_per_phase', jsonb_build_object('status', case when expc is null then 'unknown' else 'single_source' end, 'value', expc, 'sources', jsonb_build_object('derived', expc)),
            'observed_positions', '[]'::jsonb);
  m := jsonb_build_object('line_name', p_line, 'tower_number', p_number, 'source_inspection_id', null, 'source_inspection_date', null,
         'tower_type', v_type, 'voltage', v_volt, 'circuits', v_circ, 'geometry', v_geo,
         'materials', jsonb_build_object('status', 'missing', 'tower_material_default_candidate', to_jsonb(ct.material_default)),
         'notes', jsonb_build_object('source_inspection_id', null),
         'prefill_blockers', '[]'::jsonb, 'prefill_ready', false);
  return m;
end $$;

-- ---- seeding: ONE fresh consistent legacy resolution becomes revision 1 of the tower (no replay of treatments, no source-row edits) ----
create or replace function tower_cs.op_seed(p_tower uuid, p_line text, p_number text, p_hint jsonb, p_actor jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp set jit = off as $$
declare
  n int := 0; fp0 jsonb; fp1 jsonb; st record; mrow record; r record; comps jsonb := '{}'::jsonb; meta jsonb; ts jsonb; row jsonb; v jsonb; x jsonb;
  has_src boolean; opid uuid := gen_random_uuid(); delta jsonb; state jsonb; sm jsonb := '{}'::jsonb; sec text; c2app text; c2basis jsonb;
  persist text[]; stv jsonb;
begin
  loop
    n := n + 1;
    fp0 := tower_cs.live_fp(p_line, array[p_number]);
    perform tower_cs.live_scope(p_line, array[p_number]);
    perform tower_cs.rc_source(); perform tower_cs.rc_treatments(); perform tower_cs.rc_lineconfig(); perform tower_cs.rc_components();
    perform tower_cs.rc_issues(); perform tower_cs.rc_meta(); perform tower_cs.rc_status();
    fp1 := tower_cs.live_fp(p_line, array[p_number]);
    exit when fp0 = fp1;
    if n >= 3 then raise exception 'unstable_read' using errcode = 'P0001'; end if;
  end loop;
  select * into st from pg_temp._tc_status where tower_id = p_tower;
  has_src := found and st.src_id is not null;
  if has_src then
    for r in select * from pg_temp._tc_comp c where c.tower_id = p_tower loop
      v := r.value;
      if tower_cs.op_kind(r.component) = 'ins' then
        select case when jsonb_typeof(q.x) = 'array' then q.x else 'null'::jsonb end into x
          from (select (case when r.component like 'ins2%' then p.m2 else p.m1 end) -> tower_cs.op_phase(r.component) as x from pg_temp._tc_p p where p.tower_id = p_tower) q;
        v := v || jsonb_build_object('chains_saved', coalesce(x, 'null'::jsonb));
      end if;
      comps := comps || jsonb_build_object(r.component, tower_cs.op_norm_row(jsonb_build_object('circuit', r.circuit, 'condition', r.condition,
                 'data_status', r.data_status, 'value', v, 'flags', to_jsonb(r.flags), 'tids', to_jsonb(r.tids), 'applicability', r.applicability,
                 'basis', r.basis, 'src', r.src_id, 'eff', st.src_date)));
    end loop;
    select * into mrow from pg_temp._tc_meta where tower_id = p_tower;
    meta := jsonb_build_object('line_name', mrow.line_name, 'tower_number', mrow.tower_number, 'source_inspection_id', mrow.src_id,
              'source_inspection_date', mrow.src_date, 'tower_type', mrow.tower_type, 'voltage', mrow.voltage, 'circuits', mrow.circuits,
              'geometry', mrow.geometry, 'materials', mrow.materials, 'notes', mrow.notes, 'prefill_blockers', to_jsonb(mrow.blockers), 'prefill_ready', mrow.ready);
    ts := jsonb_build_object('status', st.status, 'reasons', to_jsonb(st.reasons), 'src_id', st.src_id, 'src_date', st.src_date,
                             'src_created', tower_cs.op_ts(st.src_created), 'sev', st.sev);
    foreach sec in array array['insulator', 'iron', 'foundation', 'wires', 'ground', 'fire'] loop
      sm := sm || jsonb_build_object(sec, jsonb_build_object('date', st.src_date));
    end loop;
    ts := ts || jsonb_build_object('sev_meta', sm);
    insert into tower_cs.baseline(tower_id, inspection_id, inspection_date, inspection_created_at, captured_run_id, raw)
      select p.tower_id, p.id, p.inspection_date, p.created_at, tower_cs.op_run(), to_jsonb(i) - 'insulator_svg_r' - 'insulator_svg_s' - 'insulator_svg_t' - 'notes'
        from pg_temp._tc_p p join public.inspections i on i.id = p.id where p.tower_id = p_tower
      on conflict (tower_id) do nothing;
  else
    meta := tower_cs.op_blank_meta(p_line, p_number, p_hint);
    c2app := meta #>> '{circuits,circuit2_applicability}';
    c2basis := jsonb_build_object('line_status', coalesce(meta #>> '{circuits,status}', 'unknown'), 'line_value', meta #> '{circuits,value}', 'evidence', '[]'::jsonb);
    comps := tower_cs.op_blank_comps(c2app, c2basis);
    ts := jsonb_build_object('status', 'no_source', 'reasons', '[]'::jsonb, 'src_id', null, 'src_date', null, 'src_created', null, 'sev', '{}'::jsonb, 'sev_meta', '{}'::jsonb);
  end if;
  -- the seed keeps the legacy resolver's own derived readiness exactly (it is the legacy interpretation of that source row)
  if not has_src then meta := tower_cs.op_meta_derive(meta, comps, 'no_source'); end if;
  delta := jsonb_build_object('comps', comps, 'ts', ts, 'meta', meta);
  insert into tower_cs.op(op_id, tower_id, rev, kind, status, business_date, actor_user_id, actor_name, actor_role, source_table, source_id,
                          request_hash, touched, applied, delta, before, reason)
  values (opid, p_tower, 1, 'seed', 'applied', st.src_date, p_actor ->> 'id', p_actor ->> 'full_name', p_actor ->> 'role',
          case when has_src then 'inspections' end, case when has_src then st.src_id end,
          md5('seed|' || p_tower::text), tower_cs.op_keys(), tower_cs.op_keys(), delta, '{}'::jsonb,
          case when has_src then 'seeded from the legacy source inspection' else 'identity seeded without a legacy source inspection' end);
  state := tower_cs.op_fold_step(null, delta, 1, opid);
  perform tower_cs.op_state_store(p_tower, state);
  return state;
end $$;

-- the tower state for writing: serialises writers per tower, creates the identity, seeds once
create or replace function tower_cs.op_open(p_line text, p_number text, p_create boolean, p_require_listed boolean, p_hint jsonb, p_actor jsonb, out o_tower uuid, out o_state jsonb)
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  o_tower := tower_cs.op_identity(p_line, p_number, p_create, p_require_listed);
  if o_tower is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('tower_cs.op:' || o_tower::text, 0));
  if not exists (select 1 from tower_cs.tower_state where tower_id = o_tower and rev > 0) then
    o_state := tower_cs.op_seed(o_tower, p_line, p_number, p_hint, p_actor);
  else
    o_state := tower_cs.op_state_load(o_tower);
  end if;
end $$;


-- ===== B. 22_ops_apply =====
-- =====================================================================
-- 22_ops_apply.sql : operation handlers (observation / treatment / correction / void / annotate) and the public RPC entry point.
-- Every handler runs under the per-tower advisory lock taken by tower_cs.op_open, inside the caller's single transaction:
-- the operation record, the new current state and the historical source INSERT commit or roll back together.
-- =====================================================================

create or replace function tower_cs.op_fail(p_code text, p_detail jsonb default null) returns void
language plpgsql set search_path = pg_catalog as $$
begin
  raise exception '%', p_code using errcode = 'P0001', detail = coalesce(p_detail, '{}'::jsonb)::text;
end $$;

-- inserts the operation record and applies its delta to the stored state. Returns the new state.
create or replace function tower_cs.op_commit(p_tower uuid, p_state jsonb, p_opid uuid, p_kind text, p_status text, p_bdate date, p_actor jsonb,
    p_src_table text, p_src_id uuid, p_target_op uuid, p_target_src uuid, p_hash text, p_touched text[], p_applied text[], p_skipped jsonb,
    p_delta jsonb, p_before jsonb, p_reason text, p_result jsonb, out o_state jsonb, out o_result jsonb)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare rev bigint := coalesce((p_state #>> '{ts,rev}')::bigint, 0) + 1;
begin
  o_result := p_result || jsonb_build_object('ok', true, 'op_id', p_opid, 'rev', rev, 'kind', p_kind, 'status', p_status,
                'applied', to_jsonb(p_applied), 'skipped', p_skipped, 'source_id', p_src_id);
  insert into tower_cs.op(op_id, tower_id, rev, kind, status, business_date, actor_user_id, actor_name, actor_role, source_table, source_id,
                          target_op, target_source_id, request_hash, touched, applied, skipped, delta, before, reason, result)
  values (p_opid, p_tower, rev, p_kind, p_status, p_bdate, p_actor ->> 'id', p_actor ->> 'full_name', p_actor ->> 'role', p_src_table, p_src_id,
          p_target_op, p_target_src, p_hash, p_touched, p_applied, p_skipped, p_delta, p_before, p_reason, o_result);
  o_state := tower_cs.op_fold_step(p_state, p_delta, rev, p_opid);
  perform tower_cs.op_state_store(p_tower, o_state);
end $$;

-- ---- request validation helpers ---------------------------------------------------------------------------------------
create or replace function tower_cs.op_bool_array(p jsonb, p_len integer) returns boolean
language sql immutable set search_path = pg_catalog as $$ select tower_cs.is_bool_array(p) and jsonb_array_length(p) = p_len $$;
create or replace function tower_cs.op_int_array(p jsonb, p_len integer) returns boolean
language sql immutable set search_path = pg_catalog as $$ select tower_cs.is_nonneg_int_array(p) and jsonb_array_length(p) = p_len $$;
create or replace function tower_cs.op_chain_array(p jsonb, p_len integer) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
declare e jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> p_len then return false; end if;
  for e in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'string' or (e #>> '{}') not in ('glass', 'plastic', 'ceramic') then return false; end if;
  end loop;
  return true;
end $$;

-- later operations that wrote any of the given components after a revision (for refusals and acknowledged corrections)
create or replace function tower_cs.op_later(p_tower uuid, p_after bigint, p_comps text[]) returns jsonb
language sql stable set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object('op_id', o.op_id, 'rev', o.rev, 'kind', o.kind, 'status', o.status, 'business_date', o.business_date,
           'actor', o.actor_name, 'recorded_at', tower_cs.op_ts(o.recorded_at),
           'components', (select jsonb_agg(c) from unnest(o.applied) c where c = any (p_comps))) order by o.rev), '[]'::jsonb)
    from tower_cs.op o where o.tower_id = p_tower and o.rev > p_after and o.kind <> 'seed' and o.status in ('applied', 'partial') and o.applied && p_comps $$;

-- ---- OBSERVATION / CORRECTION --------------------------------------------------------------------------------------------
-- p_kind: 'observation' (new inspection evidence, stored as a historical inspection row) or 'correction' (explicit values, supervisor/admin, no row)
create or replace function tower_cs.op_do_obs(p_kind text, p_op jsonb, p_actor jsonb, p_tower uuid, p_state jsonb, p_opid uuid, p_hash text, p_bdate date)
returns jsonb language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  line text := p_op ->> 'line_name'; num text := p_op ->> 'tower_number';
  comps_in jsonb := p_op -> 'comps'; base jsonb := coalesce(p_op -> 'base', '{}'::jsonb); sev_in jsonb := coalesce(p_op -> 'sev', '{}'::jsonb);
  rowx jsonb := coalesce(p_op -> 'row', '{}'::jsonb); zero_ok text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p_op -> 'confirm_cycles_zero', '[]'::jsonb))), '{}'::text[]);
  ack uuid[] := coalesce(array(select (jsonb_array_elements_text(coalesce(p_op -> 'acknowledge', '[]'::jsonb)))::uuid), '{}'::uuid[]);
  clear_codes text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p_op -> 'clear_review', '[]'::jsonb))), '{}'::text[]);
  meta jsonb := p_state -> 'meta'; ts jsonb := p_state -> 'ts'; cs jsonb := p_state -> 'comps';
  mode text := p_state #>> '{meta,geometry,mode}'; pos integer := tower_cs.mode_positions(p_state #>> '{meta,geometry,mode}'); expc integer := tower_cs.mode_chains(p_state #>> '{meta,geometry,mode}');
  k text; v jsonb; cur jsonb; cand jsonb := '{}'::jsonb; rows jsonb := '{}'::jsonb; touched text[] := '{}'::text[]; applied text[] := '{}'::text[]; skipped jsonb := '{}'::jsonb;
  conflicts jsonb := '[]'::jsonb; conf_comps text[] := '{}'::text[]; cyc jsonb; chn jsonb; dmg jsonb; extra text[]; app text; basis jsonb; src uuid := gen_random_uuid();
  fresh boolean; sec text; sevs jsonb := '{}'::jsonb; sevm jsonb := '{}'::jsonb; newts jsonb; newmeta jsonb; newcomps jsonb; st jsonb; reasons text[];
  has_src boolean; status text; c2obs boolean := false; later jsonb; base_rev bigint; cur_rev bigint; hist_row jsonb; ins_state jsonb := '{}'::jsonb;
  ins_cycle jsonb := '{}'::jsonb; ins_chain jsonb := '{}'::jsonb; ins_state2 jsonb := '{}'::jsonb; ins_cycle2 jsonb := '{}'::jsonb; ins_chain2 jsonb := '{}'::jsonb;
  new_type text; type_eff text; volt_eff integer; before_comps jsonb := '{}'::jsonb; before_ts jsonb; ph text; sevsrc text; blanks jsonb := '{}'::jsonb;
  src_set boolean := false; role text := p_actor ->> 'role'; unseen_c2 boolean := false; adopted boolean := false; ex_id uuid;
begin
  if comps_in is null or jsonb_typeof(comps_in) <> 'object' or comps_in = '{}'::jsonb then perform tower_cs.op_fail('empty_observation'); end if;
  if jsonb_typeof(base) <> 'object' or jsonb_typeof(sev_in) <> 'object' or jsonb_typeof(rowx) <> 'object' then perform tower_cs.op_fail('invalid'); end if;
  if p_kind = 'correction' and (nullif(btrim(coalesce(p_op ->> 'reason', '')), '') is null) then perform tower_cs.op_fail('reason_required'); end if;
  if cardinality(clear_codes) > 0 and role not in ('admin', 'supervisor') then perform tower_cs.op_fail('forbidden_clear_review'); end if;
  if (select count(*) from jsonb_object_keys(comps_in)) > 20 then perform tower_cs.op_fail('invalid'); end if;
  for k in select jsonb_object_keys(comps_in) loop
    if not (k = any (tower_cs.op_keys())) then perform tower_cs.op_fail('invalid_component', jsonb_build_object('component', k)); end if;
    touched := array_append(touched, k);
  end loop;
  -- tower type must not be changed by an observation (explicit configuration change only)
  volt_eff := case when tower_cs.is_resolved(meta -> 'voltage') then (meta #>> '{voltage,value}')::integer end;
  new_type := nullif(p_op #>> '{row,tower_type}', '');
  type_eff := case when tower_cs.is_resolved(meta -> 'tower_type') then meta #>> '{tower_type,value}' end;
  if p_kind = 'observation' and new_type is not null and type_eff is not null and volt_eff is not null
     and tower_cs.type_code(volt_eff, new_type) is not null and tower_cs.type_code(volt_eff, new_type) <> type_eff then
    perform tower_cs.op_fail('tower_type_mismatch', jsonb_build_object('stored', type_eff, 'requested', tower_cs.type_code(volt_eff, new_type)));
  end if;
  -- an inspection row already recorded with this very client id (an old POST that succeeded before the app was upgraded) is ADOPTED as the source: never inserted twice
  if p_kind = 'observation' then
    select i.id into ex_id from public.inspections i where i.client_uuid = p_opid and i.line_name = line and i.tower_number = num;
    if ex_id is not null then src := ex_id; adopted := true; end if;
  end if;
  -- no cycles may be invented for a tower that ever had a treatment
  fresh := (ts ->> 'src_id') is null and not exists (select 1 from public.treatments t where t.line_name = line and t.tower_number = num);

  foreach k in array touched loop
    v := comps_in -> k; cur := cs -> k;
    if cur is null then perform tower_cs.op_fail('invalid_component', jsonb_build_object('component', k)); end if;
    app := cur ->> 'applicability'; basis := cur -> 'basis';
    if tower_cs.op_is_c2(k) then
      if app = 'not_applicable' then perform tower_cs.op_fail('circuit2_not_applicable', jsonb_build_object('component', k)); end if;
      if app = 'unknown' then app := 'applicable'; basis := jsonb_build_object('evidence', jsonb_build_array('observation'), 'line_status', coalesce(meta #>> '{circuits,status}', 'unknown')); unseen_c2 := true; end if;
    end if;
    if tower_cs.op_kind(k) = 'ins' then
      if jsonb_typeof(v) <> 'object' then perform tower_cs.op_fail('invalid_shape', jsonb_build_object('component', k)); end if;
      if mode is null or (meta #>> '{geometry,status}') in ('unknown', 'conflict') then
        perform tower_cs.op_fail('geometry_unresolved', jsonb_build_object('component', k, 'status', meta #>> '{geometry,status}'));
      end if;
      if not tower_cs.op_bool_array(v -> 'damaged', pos) then perform tower_cs.op_fail('invalid_shape', jsonb_build_object('component', k, 'expected_positions', pos)); end if;
      dmg := v -> 'damaged';
      -- stored layout must already match the geometry: a different layout needs an explicit reviewed mapping (configuration change)
      if cur ->> 'data_status' = 'known' and jsonb_typeof(cur #> '{value,damaged}') = 'array' and jsonb_array_length(cur #> '{value,damaged}') <> pos then
        perform tower_cs.op_fail('layout_mismatch', jsonb_build_object('component', k, 'stored_positions', jsonb_array_length(cur #> '{value,damaged}'), 'expected_positions', pos));
      end if;
      cyc := case when jsonb_typeof(cur #> '{value,cycle}') = 'array' then cur #> '{value,cycle}' end;
      extra := '{}'::text[];
      if p_kind = 'correction' and v ? 'cycle' then
        if not tower_cs.op_int_array(v -> 'cycle', pos) then perform tower_cs.op_fail('invalid_shape', jsonb_build_object('component', k, 'field', 'cycle')); end if;
        cyc := v -> 'cycle';
      elsif v ? 'cycle' then perform tower_cs.op_fail('cycle_not_client_owned', jsonb_build_object('component', k));
      end if;
      -- a legacy-unknown cycle stays unknown unless the user confirmed zero explicitly (confirm_cycles_zero) or the tower is brand new
      if cyc is null and (fresh and cur ->> 'data_status' = 'unknown' and cur -> 'flags' ? 'never_observed') then
        cyc := (select jsonb_agg(0) from generate_series(1, pos));
      elsif cyc is null and k = any (zero_ok) then
        cyc := (select jsonb_agg(0) from generate_series(1, pos)); extra := array['cycle_assumed_zero'];
      end if;
      if cyc is not null and jsonb_array_length(cyc) <> pos then perform tower_cs.op_fail('layout_mismatch', jsonb_build_object('component', k, 'field', 'cycle')); end if;
      if v ? 'chains' then
        if v -> 'chains' is null or jsonb_typeof(v -> 'chains') = 'null' then chn := null;
        elsif not tower_cs.op_chain_array(v -> 'chains', expc) then perform tower_cs.op_fail('invalid_shape', jsonb_build_object('component', k, 'field', 'chains', 'expected_chains', expc));
        else chn := v -> 'chains'; end if;
      else
        chn := case when jsonb_typeof(cur #> '{value,chains_saved}') = 'array' then cur #> '{value,chains_saved}' end;
      end if;
      cand := cand || jsonb_build_object(k, tower_cs.op_ins_row(k, dmg, cyc, chn, src, p_bdate, cur -> 'tids', extra, app, basis));
    else
      if jsonb_typeof(v) <> 'object' then perform tower_cs.op_fail('invalid_shape', jsonb_build_object('component', k)); end if;
      if tower_cs.op_kind(k) = 'fire' then
        if jsonb_typeof(v -> 'sev') <> 'string' or not tower_cs.op_sev_ok(v ->> 'sev') then perform tower_cs.op_fail('invalid_shape', jsonb_build_object('component', k)); end if;
      elsif jsonb_typeof(v -> 'text') <> 'string' or btrim(v ->> 'text') = '' or char_length(v ->> 'text') > 4000 then
        perform tower_cs.op_fail('invalid_shape', jsonb_build_object('component', k, 'field', 'text'));
      elsif tower_cs.op_kind(k) = 'washing' and (v ->> 'text') not in ('clean', 'needs_washing', 'very_dirty') then
        perform tower_cs.op_fail('invalid_shape', jsonb_build_object('component', k, 'field', 'text'));
      end if;
      newts := tower_cs.op_text_row(k, v, src, p_bdate, app, basis);
      if coalesce((v ->> 'keep_treated')::boolean, false) and cur ->> 'condition' = 'treated'
         and (cur #>> '{value,text}') is not distinct from (v ->> 'text') and tower_cs.op_kind(k) <> 'fire' then
        newts := newts || jsonb_build_object('condition', 'treated', 'tids', cur -> 'tids');
      end if;
      if p_kind = 'correction' and v ? 'treated' then
        if (v ->> 'treated')::boolean and newts ->> 'condition' = 'defect' then newts := newts || jsonb_build_object('condition', 'treated', 'flags', (newts -> 'flags') || '["correction_set_treated"]'::jsonb); end if;
      end if;
      cand := cand || jsonb_build_object(k, tower_cs.op_norm_row(newts));
    end if;
  end loop;

  -- per-component conflict detection + back-dated (superseded) observations
  foreach k in array touched loop
    cur := cs -> k; cur_rev := (cur ->> 'rev')::bigint;
    base_rev := case when base ? k and jsonb_typeof(base -> k) = 'number' then (base ->> k)::bigint end;
    if base_rev is null then perform tower_cs.op_fail('base_missing', jsonb_build_object('component', k)); end if;
    if base_rev <> cur_rev then
      -- a legacy-based read (no per-component revision) is accepted exactly when the source inspection it was read from is still the source
      if not (base_rev = 0 and cur ->> 'last_op' is not null and (select o.kind from tower_cs.op o where o.op_id = (cur ->> 'last_op')::uuid) = 'seed'
              and (p_op ->> 'base_src') is not distinct from (ts ->> 'src_id')) then
        conflicts := conflicts || jsonb_build_array(jsonb_build_object('component', k, 'base_rev', base_rev, 'current_rev', cur_rev, 'current', cur,
                                                                         'last_op', cur ->> 'last_op'));
        conf_comps := array_append(conf_comps, k);
      end if;
    end if;
  end loop;
  if cardinality(conf_comps) > 0 then
    later := tower_cs.op_later(p_tower, coalesce((select min((x ->> 'base_rev')::bigint) from jsonb_array_elements(conflicts) x), 0), conf_comps);
    if p_kind = 'correction' and cardinality(ack) > 0 and
       not exists (select 1 from jsonb_array_elements(later) e where not ((e ->> 'op_id')::uuid = any (ack))) then
      conflicts := '[]'::jsonb;  -- explicit compensating correction: the caller named every later operation it is overriding
    else
      perform tower_cs.op_fail('conflict', jsonb_build_object('conflicts', conflicts, 'later_ops', later));
    end if;
  end if;
  foreach k in array touched loop
    cur := cs -> k;
    if p_kind = 'observation' and (cur ->> 'eff') is not null and p_bdate < (cur ->> 'eff')::date then
      skipped := skipped || jsonb_build_object(k, jsonb_build_object('reason', 'superseded_by_newer_observation', 'effective_date', cur ->> 'eff'));
    else
      applied := array_append(applied, k); rows := rows || jsonb_build_object(k, cand -> k);
    end if;
  end loop;

  -- status of the tower after the write
  newcomps := cs;
  for k, v in select e.key, e.value from jsonb_each(rows) e loop newcomps := jsonb_set(newcomps, array[k], v || jsonb_build_object('rev', 0, 'last_op', null)); end loop;
  -- unknown circuit-2 applicability resolved by observed circuit-2 evidence: every other circuit-2 row becomes applicable (never observed)
  if exists (select 1 from unnest(applied) a where tower_cs.op_is_c2(a)) and (meta #>> '{circuits,circuit2_applicability}') = 'unknown' then
    foreach k in array tower_cs.op_keys() loop
      if tower_cs.op_is_c2(k) and not (k = any (applied)) and (cs -> k ->> 'applicability') = 'unknown' then
        blanks := blanks || jsonb_build_object(k, tower_cs.op_blank_row(k, 'applicable', jsonb_build_object('evidence', jsonb_build_array('observation'))));
        newcomps := jsonb_set(newcomps, array[k], (blanks -> k) || jsonb_build_object('rev', 0, 'last_op', null));
      end if;
    end loop;
    rows := rows || blanks;
  end if;
  reasons := coalesce(array(select jsonb_array_elements_text(ts -> 'reasons')), '{}'::text[]);
  if cardinality(clear_codes) > 0 then reasons := array(select r from unnest(reasons) r where not (r = any (clear_codes))); end if;
  has_src := (ts ->> 'src_id') is not null or cardinality(applied) > 0;
  st := tower_cs.op_status(newcomps, reasons, has_src);

  -- severities of the sections whose components were written
  foreach k in array applied loop
    sec := tower_cs.op_section(k);
    if sec is null then continue; end if;
    if sec = 'fire' then
      sevs := sevs || jsonb_build_object('fire', (rows -> k) #>> '{value,sev}');
      sevm := sevm || jsonb_build_object('fire', jsonb_build_object('date', p_bdate));
    elsif sev_in ? ('sev_' || sec) then
      if jsonb_typeof(sev_in -> ('sev_' || sec)) <> 'string' or not tower_cs.op_sev_ok(sev_in ->> ('sev_' || sec)) then
        perform tower_cs.op_fail('invalid_severity', jsonb_build_object('section', sec)); end if;
      sevs := sevs || jsonb_build_object(sec, sev_in ->> ('sev_' || sec));
      sevm := sevm || jsonb_build_object(sec, jsonb_build_object('date', p_bdate));
    end if;
  end loop;

  -- state as it will be after this operation (for the derived metadata)
  newts := jsonb_build_object('status', st ->> 'status', 'reasons', st -> 'reasons', 'sev', sevs, 'sev_meta', sevm);
  if cardinality(applied) > 0 and p_kind = 'observation' and ((ts ->> 'src_date') is null or p_bdate >= (ts ->> 'src_date')::date) then
    newts := newts || jsonb_build_object('src_id', src, 'src_date', p_bdate, 'src_created', tower_cs.op_ts(clock_timestamp())); src_set := true;
  end if;
  newmeta := meta;
  if cardinality(applied) > 0 and unseen_c2 then
    newmeta := newmeta || jsonb_build_object('circuits', (meta -> 'circuits') || jsonb_build_object('circuit2_applicability', 'applicable',
                 'evidence', coalesce(meta #> '{circuits,evidence}', '[]'::jsonb) || '["observation"]'::jsonb));
  end if;
  if src_set then
    newmeta := newmeta || jsonb_build_object('source_inspection_id', src, 'source_inspection_date', p_bdate,
        'notes', jsonb_build_object('source_inspection_id', src,
           'notes', jsonb_build_object('present', tower_cs.has_text(rowx ->> 'notes'), 'chars', char_length(coalesce(rowx ->> 'notes', '')), 'starts_with_auto_previous_line', coalesce(btrim(rowx ->> 'notes') ~ '^كشف سابق بتاريخ', false)),
           'road_access_notes', jsonb_build_object('present', tower_cs.has_text(rowx ->> 'road_access_notes'), 'chars', char_length(coalesce(rowx ->> 'road_access_notes', ''))),
           'fire_causes_notes', jsonb_build_object('present', tower_cs.has_text(rowx ->> 'fire_causes_notes'), 'chars', char_length(coalesce(rowx ->> 'fire_causes_notes', ''))))); 
  end if;
  newmeta := tower_cs.op_meta_derive(newmeta, newcomps, st ->> 'status');

  -- historical evidence row (observations only): exactly what was observed, never what was merely inherited
  if p_kind = 'observation' then
    foreach k in array touched loop
      v := cand -> k; ph := tower_cs.op_phase(k);
      if tower_cs.op_kind(k) = 'ins' then
        if k like 'ins2%' then
          ins_state2 := ins_state2 || jsonb_build_object(ph, v #> '{value,damaged}'); ins_cycle2 := ins_cycle2 || jsonb_build_object(ph, coalesce(nullif(v #> '{value,cycle}', 'null'::jsonb), '[]'::jsonb));
          if jsonb_typeof(v #> '{value,chains_saved}') = 'array' then ins_chain2 := ins_chain2 || jsonb_build_object(ph, v #> '{value,chains_saved}'); end if;
        else
          ins_state := ins_state || jsonb_build_object(ph, v #> '{value,damaged}'); ins_cycle := ins_cycle || jsonb_build_object(ph, coalesce(nullif(v #> '{value,cycle}', 'null'::jsonb), '[]'::jsonb));
          if jsonb_typeof(v #> '{value,chains_saved}') = 'array' then ins_chain := ins_chain || jsonb_build_object(ph, v #> '{value,chains_saved}'); end if;
        end if;
      end if;
    end loop;
    foreach ph in array array['R', 'S', 'T'] loop
      if not ins_state ? ph and (ins_state <> '{}'::jsonb) then ins_state := ins_state || jsonb_build_object(ph, '[]'::jsonb); ins_cycle := ins_cycle || jsonb_build_object(ph, '[]'::jsonb); end if;
      if not ins_state2 ? ph and (ins_state2 <> '{}'::jsonb) then ins_state2 := ins_state2 || jsonb_build_object(ph, '[]'::jsonb); ins_cycle2 := ins_cycle2 || jsonb_build_object(ph, '[]'::jsonb); end if;
    end loop;
    if not adopted then
    insert into public.inspections(id, client_uuid, line_name, tower_number, inspection_date, tower_type, voltage, created_by, created_by_name,
        insulator_state, insulator_cycle, insulator_chain_types, insulator_state_2, insulator_cycle_2, insulator_chain_types_2,
        iron_intersections, tower_foundations, tower_attachments, wires_r1, wires_s1, wires_t1, wires_r1_c2, wires_s1_c2, wires_t1_c2,
        ground_1, ground_2, road_access, insulator_washing, sev_fire, fire_causes_notes,
        sev_insulator, sev_iron, sev_foundation, sev_wires, sev_ground, road_access_notes, notes,
        wires_r2, wires_s2, wires_t2, wires_circuit, insulator_svg_r, insulator_svg_s, insulator_svg_t)
    values (src, p_opid, line, num, p_bdate, coalesce(nullif(rowx ->> 'tower_type', ''), case when type_eff is not null then type_eff end),
        coalesce(volt_eff, tower_cs.safe_int(rowx -> 'voltage')), nullif(p_actor ->> 'id', '')::uuid, p_actor ->> 'full_name',
        case when ins_state = '{}'::jsonb then null else ins_state::text end, case when ins_state = '{}'::jsonb then null else ins_cycle end,
        case when ins_chain = '{}'::jsonb then null else ins_chain::text end,
        case when ins_state2 = '{}'::jsonb then null else ins_state2 end, case when ins_state2 = '{}'::jsonb then null else ins_cycle2 end,
        case when ins_chain2 = '{}'::jsonb then null else ins_chain2::text end,
        cand #>> '{iron,value,text}', cand #>> '{foundation,value,text}', cand #>> '{attachment,value,text}',
        cand #>> '{wire_r1,value,text}', cand #>> '{wire_s1,value,text}', cand #>> '{wire_t1,value,text}',
        cand #>> '{wire_r1_c2,value,text}', cand #>> '{wire_s1_c2,value,text}', cand #>> '{wire_t1_c2,value,text}',
        cand #>> '{ground_1,value,text}', cand #>> '{ground_2,value,text}', cand #>> '{road,value,text}', cand #>> '{washing,value,text}',
        cand #>> '{fire,value,sev}', coalesce(cand #>> '{fire,value,notes}', rowx ->> 'fire_causes_notes'),
        sev_in ->> 'sev_insulator', sev_in ->> 'sev_iron', sev_in ->> 'sev_foundation', sev_in ->> 'sev_wires', sev_in ->> 'sev_ground',
        rowx ->> 'road_access_notes', rowx ->> 'notes',
        cand #>> '{wire_r1,value,text}', cand #>> '{wire_s1,value,text}', cand #>> '{wire_t1,value,text}', rowx ->> 'wires_circuit',
        rowx ->> 'insulator_svg_r', rowx ->> 'insulator_svg_s', rowx ->> 'insulator_svg_t');
    end if;
  end if;

  status := case when cardinality(applied) = 0 then 'historical_only' when jsonb_typeof(skipped) = 'object' and skipped <> '{}'::jsonb then 'partial' else 'applied' end;
  for k in select jsonb_object_keys(rows) loop before_comps := before_comps || jsonb_build_object(k, cs -> k); end loop;
  before_ts := ts;
  return jsonb_build_object('_handled', true,
    'commit', jsonb_build_object('status', status, 'touched', to_jsonb(touched), 'applied', to_jsonb(applied), 'skipped', skipped,
        'src_table', case when p_kind = 'observation' then 'inspections' end, 'src_id', case when p_kind = 'observation' then src end,
        'target_src', case when p_kind = 'correction' then nullif(p_op ->> 'target_source_id', '')::uuid end,
        'delta', case when status = 'historical_only' then '{}'::jsonb else jsonb_build_object('comps', rows,
            'ts', newts - case when src_set then '' else 'src_id' end, 'meta', newmeta - 'rev') end,
        'before', case when status = 'historical_only' then '{}'::jsonb else jsonb_build_object('comps', before_comps, 'ts', before_ts, 'meta', meta) end,
        'reason', p_op ->> 'reason', 'clear_review', to_jsonb(clear_codes)));
end $$;

-- ---- TREATMENT -------------------------------------------------------------------------------------------------------------
-- Payload: treated {comp:[idx..]}, replace [{comp,chain_idx,to,chains_full?}], text_items [key..], sev {sev_x:v}, items_treated [{key,label,count}],
-- inspection_id?, confirm_cycles_zero [comp..], row {notes, svgs}. State preconditions are evaluated HERE against the current state.
create or replace function tower_cs.op_do_treatment(p_op jsonb, p_actor jsonb, p_tower uuid, p_state jsonb, p_opid uuid, p_hash text, p_bdate date)
returns jsonb language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  line text := p_op ->> 'line_name'; num text := p_op ->> 'tower_number';
  treated jsonb := coalesce(p_op -> 'treated', '{}'::jsonb); repl jsonb := coalesce(p_op -> 'replace', '[]'::jsonb); txt jsonb := coalesce(p_op -> 'text_items', '[]'::jsonb);
  sev_in jsonb := coalesce(p_op -> 'sev', '{}'::jsonb); rowx jsonb := coalesce(p_op -> 'row', '{}'::jsonb);
  zero_ok text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p_op -> 'confirm_cycles_zero', '[]'::jsonb))), '{}'::text[]);
  meta jsonb := p_state -> 'meta'; ts jsonb := p_state -> 'ts'; cs jsonb := p_state -> 'comps';
  mode text := p_state #>> '{meta,geometry,mode}'; pos integer := tower_cs.mode_positions(p_state #>> '{meta,geometry,mode}'); expc integer := tower_cs.mode_chains(p_state #>> '{meta,geometry,mode}');
  k text; i int; e jsonb; idx jsonb; cur jsonb; dmg jsonb; cyc jsonb; chn jsonb; fails jsonb := '[]'::jsonb; rows jsonb := '{}'::jsonb; touched text[] := '{}'::text[];
  work jsonb := '{}'::jsonb;  -- comp -> {dmg, cyc, chn, idxs[], chains[]}
  tid uuid := gen_random_uuid(); items jsonb := '[]'::jsonb; itemkeys jsonb := '{}'::jsonb; ci int; rowsper int; a int; b int; to_mat text; cfull jsonb; ph text;
  sevs jsonb := '{}'::jsonb; sevm jsonb := '{}'::jsonb; sec text; newcomps jsonb; st jsonb; newts jsonb; newmeta jsonb; before_comps jsonb := '{}'::jsonb;
  insp uuid; vtreated text; viewb jsonb; bstate jsonb := '{}'::jsonb; astate jsonb := '{}'::jsonb; acycle jsonb := '{}'::jsonb; reasons text[]; extra text[];
  eff date; label jsonb; v jsonb; newrow jsonb; app text; chains_set boolean; volt_eff integer; type_eff text; tkey text; adopted boolean := false; adopt_id uuid;
begin
  -- a treatments row already recorded with this very client id (old POST succeeded, state PATCH pending) is ADOPTED: items already in effect are skipped, never doubled
  select t.id into adopt_id from public.treatments t where t.client_uuid = p_opid and t.line_name = line and t.tower_number = num;
  if adopt_id is not null then adopted := true; tid := adopt_id; end if;
  if jsonb_typeof(treated) <> 'object' or jsonb_typeof(repl) <> 'array' or jsonb_typeof(txt) <> 'array' or jsonb_typeof(sev_in) <> 'object' then perform tower_cs.op_fail('invalid'); end if;
  if ts ->> 'status' = 'no_source' then perform tower_cs.op_fail('no_source'); end if;
  if ts ->> 'status' = 'needs_review' then perform tower_cs.op_fail('needs_review', jsonb_build_object('reasons', ts -> 'reasons')); end if;
  if not adopted and treated = '{}'::jsonb and repl = '[]'::jsonb and txt = '[]'::jsonb then perform tower_cs.op_fail('nothing_to_treat'); end if;
  -- individually treated positions
  for k in select jsonb_object_keys(treated) loop
    if tower_cs.op_kind(k) <> 'ins' or not (k = any (tower_cs.op_keys())) then perform tower_cs.op_fail('invalid_component', jsonb_build_object('component', k)); end if;
    cur := cs -> k;
    if tower_cs.op_is_c2(k) and cur ->> 'applicability' <> 'applicable' then perform tower_cs.op_fail('circuit2_not_applicable', jsonb_build_object('component', k)); end if;
    if mode is null or pos is null then perform tower_cs.op_fail('geometry_unresolved', jsonb_build_object('component', k)); end if;
    if cur ->> 'data_status' <> 'known' or not tower_cs.op_bool_array(cur #> '{value,damaged}', pos) then
      fails := fails || jsonb_build_array(jsonb_build_object('component', k, 'reason', 'state_unknown')); continue;
    end if;
    if jsonb_typeof(treated -> k) <> 'array' or jsonb_array_length(treated -> k) = 0 then perform tower_cs.op_fail('invalid_shape', jsonb_build_object('component', k)); end if;
    if not work ? k then
      cyc := case when jsonb_typeof(cur #> '{value,cycle}') = 'array' then cur #> '{value,cycle}' end;
      work := work || jsonb_build_object(k, jsonb_build_object('dmg', cur #> '{value,damaged}', 'cyc', cyc,
                          'chn', case when jsonb_typeof(cur #> '{value,chains_saved}') = 'array' then cur #> '{value,chains_saved}' end, 'n', 0, 'zero', false));
    end if;
    for e in select value from jsonb_array_elements(treated -> k) loop
      if jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric <> trunc((e #>> '{}')::numeric) then perform tower_cs.op_fail('invalid_shape', jsonb_build_object('component', k)); end if;
      i := (e #>> '{}')::int;
      if i < 0 or i >= pos then fails := fails || jsonb_build_array(jsonb_build_object('component', k, 'index', i, 'reason', 'out_of_range')); continue; end if;
      if (work -> k #> array['dmg', i::text]) <> 'true'::jsonb then
        if adopted then continue; end if;
        fails := fails || jsonb_build_array(jsonb_build_object('component', k, 'index', i, 'reason', 'not_damaged')); continue;
      end if;
      work := jsonb_set(work, array[k, 'dmg', i::text], 'false'::jsonb);
      work := jsonb_set(work, array[k, 'n'], to_jsonb((work -> k ->> 'n')::int + 1));
      work := jsonb_set(work, array[k, 'idxs'], coalesce(work -> k -> 'idxs', '[]'::jsonb) || to_jsonb(i));
    end loop;
  end loop;
  -- whole-chain replacements (existing domain semantics: every position of the chain: state=false, cycle+1; the chain material changes)
  for e in select value from jsonb_array_elements(repl) loop
    if jsonb_typeof(e) <> 'object' then perform tower_cs.op_fail('invalid_shape'); end if;
    k := e ->> 'comp'; to_mat := e ->> 'to';
    if k is null or tower_cs.op_kind(k) <> 'ins' or not (k = any (tower_cs.op_keys())) or to_mat not in ('glass', 'plastic', 'ceramic')
       or jsonb_typeof(e -> 'chain_idx') <> 'number' then perform tower_cs.op_fail('invalid_shape', jsonb_build_object('field', 'replace')); end if;
    ci := (e ->> 'chain_idx')::int; cur := cs -> k;
    if adopted and jsonb_typeof(cur #> '{value,chains_saved}') = 'array' and (cur #>> array['value','chains_saved', ci::text]) = to_mat then continue; end if;
    if tower_cs.op_is_c2(k) and cur ->> 'applicability' <> 'applicable' then perform tower_cs.op_fail('circuit2_not_applicable', jsonb_build_object('component', k)); end if;
    if mode is null or expc is null or pos % expc <> 0 then perform tower_cs.op_fail('geometry_unresolved', jsonb_build_object('component', k)); end if;
    if ci < 0 or ci >= expc then perform tower_cs.op_fail('invalid_shape', jsonb_build_object('component', k, 'field', 'chain_idx')); end if;
    if cur ->> 'data_status' <> 'known' or not tower_cs.op_bool_array(cur #> '{value,damaged}', pos) then
      fails := fails || jsonb_build_array(jsonb_build_object('component', k, 'reason', 'state_unknown')); continue;
    end if;
    rowsper := pos / expc; a := ci * rowsper; b := a + rowsper - 1;
    if not work ? k then
      cyc := case when jsonb_typeof(cur #> '{value,cycle}') = 'array' then cur #> '{value,cycle}' end;
      work := work || jsonb_build_object(k, jsonb_build_object('dmg', cur #> '{value,damaged}', 'cyc', cyc,
                          'chn', case when jsonb_typeof(cur #> '{value,chains_saved}') = 'array' then cur #> '{value,chains_saved}' end, 'n', 0, 'zero', false));
    end if;
    -- a position already treated individually in this operation cannot also belong to a replaced chain
    if exists (select 1 from jsonb_array_elements(coalesce(work -> k -> 'idxs', '[]'::jsonb)) x where (x #>> '{}')::int between a and b) then
      perform tower_cs.op_fail('overlap', jsonb_build_object('component', k, 'chain_idx', ci));
    end if;
    -- materials: legacy-saved arrays (incl. the empty legacy convention) are expanded explicitly; never-saved materials need the full explicit list
    chn := work -> k -> 'chn';
    if chn is null or jsonb_typeof(chn) <> 'array' then
      cfull := e -> 'chains_full';
      if not tower_cs.op_chain_array(cfull, expc) or (cfull ->> ci) <> to_mat then
        perform tower_cs.op_fail('materials_incomplete', jsonb_build_object('component', k, 'expected_chains', expc));
      end if;
      chn := cfull;
    else
      chn := (select coalesce(jsonb_agg(case when g <= jsonb_array_length(chn) and jsonb_typeof(chn -> (g - 1)) = 'string' and (chn ->> (g - 1)) <> '' then chn -> (g - 1) else '"glass"'::jsonb end order by g), '[]'::jsonb)
                from generate_series(1, expc) g);
      chn := jsonb_set(chn, array[ci::text], to_jsonb(to_mat));
    end if;
    work := jsonb_set(work, array[k, 'chn'], chn);
    for i in a .. b loop
      work := jsonb_set(work, array[k, 'dmg', i::text], 'false'::jsonb);
      work := jsonb_set(work, array[k, 'idxs'], coalesce(work -> k -> 'idxs', '[]'::jsonb) || to_jsonb(i));
    end loop;
    work := jsonb_set(work, array[k, 'repl'], coalesce(work -> k -> 'repl', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('chain_idx', ci, 'to', to_mat)));
    itemkeys := itemkeys || jsonb_build_object(k, coalesce(itemkeys -> k, '[]'::jsonb) || to_jsonb('chainreplace_' || tower_cs.op_phase(k) || '_' || ci || '_' || (case when tower_cs.op_is_c2(k) then 2 else 1 end)));
  end loop;
  -- adopted (already recorded) treatment: components with nothing left to apply are dropped (no cycle bump, no state rewrite)
  if adopted then
    for k in select w.key from jsonb_each(work) w where jsonb_array_length(coalesce(w.value -> 'idxs', '[]'::jsonb)) = 0 loop work := work - k; end loop;
  end if;
  -- cycles: +1 on every treated / replaced position; never from an unknown cycle without an explicit confirmation
  for k in select jsonb_object_keys(work) loop
    cyc := case when jsonb_typeof(work -> k -> 'cyc') = 'array' then work -> k -> 'cyc' end; extra := '{}'::text[];   -- a JSON null (cycles unknown) must read as SQL null here
    if cyc is null then
      if k = any (zero_ok) then cyc := (select jsonb_agg(0) from generate_series(1, pos)); extra := array['cycle_assumed_zero'];
      else fails := fails || jsonb_build_array(jsonb_build_object('component', k, 'reason', 'cycle_unknown')); continue; end if;
    end if;
    for e in select value from jsonb_array_elements(coalesce(work -> k -> 'idxs', '[]'::jsonb)) loop
      i := (e #>> '{}')::int;
      cyc := jsonb_set(cyc, array[i::text], to_jsonb((cyc ->> i)::int + 1));
    end loop;
    work := jsonb_set(work, array[k, 'cyc'], cyc);
    work := jsonb_set(work, array[k, 'extra'], to_jsonb(extra));
  end loop;
  -- text items
  for e in select value from jsonb_array_elements(txt) loop
    k := e #>> '{}';
    if jsonb_typeof(e) <> 'string' or tower_cs.op_kind(k) = 'ins' or not (k = any (tower_cs.op_keys())) then perform tower_cs.op_fail('invalid_component', jsonb_build_object('component', k)); end if;
    cur := cs -> k;
    if tower_cs.op_is_c2(k) and cur ->> 'applicability' <> 'applicable' then perform tower_cs.op_fail('circuit2_not_applicable', jsonb_build_object('component', k)); end if;
    if cur ->> 'condition' = 'treated' then
      if adopted then continue; end if;
      fails := fails || jsonb_build_array(jsonb_build_object('component', k, 'reason', 'already_treated')); continue;
    end if;
    if cur ->> 'condition' <> 'defect' or cur ->> 'data_status' <> 'known' then fails := fails || jsonb_build_array(jsonb_build_object('component', k, 'reason', 'not_defect')); continue; end if;
    rows := rows || jsonb_build_object(k, tower_cs.op_norm_row(cur || jsonb_build_object('condition', 'treated', 'tids', (cur -> 'tids') || to_jsonb(tid))));
    itemkeys := itemkeys || jsonb_build_object(k, jsonb_build_array(k));
  end loop;
  if jsonb_array_length(fails) > 0 then perform tower_cs.op_fail('precondition_failed', jsonb_build_object('failures', fails)); end if;

  if adopted and work = '{}'::jsonb and rows = '{}'::jsonb then
    return jsonb_build_object('_handled', true, 'commit', jsonb_build_object('status', 'applied', 'touched', '[]'::jsonb, 'applied', '[]'::jsonb, 'skipped', '{}'::jsonb,
        'src_table', 'treatments', 'src_id', tid,
        'delta', jsonb_build_object('comps', '{}'::jsonb, 'ts', jsonb_build_object('status', ts ->> 'status', 'reasons', ts -> 'reasons', 'sev', ts -> 'sev', 'sev_meta', ts -> 'sev_meta'), 'meta', meta - 'rev', 'items', '{}'::jsonb),
        'before', jsonb_build_object('comps', '{}'::jsonb, 'ts', ts, 'meta', meta), 'reason', 'adopted_existing_treatment'));
  end if;
  eff := p_bdate;
  for k in select jsonb_object_keys(work) loop
    cur := cs -> k;
    chains_set := work -> k ? 'repl';
    newrow := tower_cs.op_ins_row(k, work -> k -> 'dmg', work -> k -> 'cyc', case when jsonb_typeof(work -> k -> 'chn') = 'array' then work -> k -> 'chn' end,
                 nullif(cur ->> 'src', '')::uuid, greatest((cur ->> 'eff')::date, eff), cur -> 'tids', coalesce(array(select jsonb_array_elements_text(coalesce(work -> k -> 'extra', '[]'::jsonb))), '{}'::text[]),
                 cur ->> 'applicability', cur -> 'basis');
    rows := rows || jsonb_build_object(k, newrow);
    if (work -> k ->> 'n')::int > 0 then itemkeys := itemkeys || jsonb_build_object(k, coalesce(itemkeys -> k, '[]'::jsonb) || to_jsonb(k)); end if;
  end loop;
  for k in select jsonb_object_keys(rows) loop
    if tower_cs.op_kind(k) <> 'ins' then
      rows := jsonb_set(rows, array[k], (rows -> k) || jsonb_build_object('eff', to_jsonb(greatest(((cs -> k) ->> 'eff')::date, eff))));
    end if;
    touched := array_append(touched, k);
  end loop;

  -- severities of the treated sections (explicit per section; unchanged when not given)
  for k in select jsonb_object_keys(rows) loop
    sec := tower_cs.op_section(k);
    if sec is not null and sev_in ? ('sev_' || sec) then
      if jsonb_typeof(sev_in -> ('sev_' || sec)) <> 'string' or not tower_cs.op_sev_ok(sev_in ->> ('sev_' || sec)) then perform tower_cs.op_fail('invalid_severity', jsonb_build_object('section', sec)); end if;
      sevs := sevs || jsonb_build_object(sec, sev_in ->> ('sev_' || sec));
      sevm := sevm || jsonb_build_object(sec, jsonb_build_object('date', p_bdate));
    end if;
  end loop;

  newcomps := cs;
  for k, v in select e2.key, e2.value from jsonb_each(rows) e2 loop newcomps := jsonb_set(newcomps, array[k], v || jsonb_build_object('rev', 0, 'last_op', null)); end loop;
  reasons := coalesce(array(select jsonb_array_elements_text(ts -> 'reasons')), '{}'::text[]);
  st := tower_cs.op_status(newcomps, reasons, true);
  newts := jsonb_build_object('status', st ->> 'status', 'reasons', st -> 'reasons', 'sev', sevs, 'sev_meta', sevm);
  newmeta := tower_cs.op_meta_derive(meta, newcomps, st ->> 'status');

  -- the historical treatment row (evidence). treated_by comes from the verified session, never from the client.
  insp := nullif(p_op ->> 'inspection_id', '')::uuid;
  if insp is not null and not exists (select 1 from public.inspections i where i.id = insp and i.line_name = line and i.tower_number = num) then
    perform tower_cs.op_fail('inspection_not_of_tower');
  end if;
  insp := coalesce(insp, nullif(ts ->> 'src_id', '')::uuid);
  volt_eff := case when tower_cs.is_resolved(meta -> 'voltage') then (meta #>> '{voltage,value}')::integer end;
  type_eff := case when tower_cs.is_resolved(meta -> 'tower_type') then meta #>> '{tower_type,value}' end;
  foreach ph in array array['R', 'S', 'T'] loop
    if cs -> ('ins_' || ph) ->> 'data_status' = 'known' then bstate := bstate || jsonb_build_object(ph, cs -> ('ins_' || ph) #> '{value,damaged}'); end if;
    cur := coalesce(rows -> ('ins_' || ph), cs -> ('ins_' || ph));
    if cur ->> 'data_status' = 'known' then astate := astate || jsonb_build_object(ph, cur #> '{value,damaged}');
      if jsonb_typeof(cur #> '{value,cycle}') = 'array' then acycle := acycle || jsonb_build_object(ph, cur #> '{value,cycle}'); end if; end if;
  end loop;
  -- items_treated: server-built keys; client labels are used where they name the same key
  for k in select jsonb_object_keys(itemkeys) loop
    for e in select value from jsonb_array_elements(itemkeys -> k) loop
      tkey := e #>> '{}';
      label := (select x from jsonb_array_elements(coalesce(p_op -> 'items_treated', '[]'::jsonb)) x where x ->> 'key' = tkey limit 1);
      items := items || jsonb_build_array(jsonb_build_object('key', tkey, 'label', coalesce(label ->> 'label', tkey))
                         || case when tkey = k and work ? k and (work -> k ->> 'n')::int > 0 then jsonb_build_object('count', (work -> k ->> 'n')::int) else '{}'::jsonb end);
    end loop;
  end loop;
  if not adopted then
  insert into public.treatments(id, client_uuid, inspection_id, line_name, tower_number, tower_type, voltage, treated_by, treatment_date,
        items_treated, insulator_cycle_after, insulator_state_before, insulator_state_after, insulator_svg_r, insulator_svg_s, insulator_svg_t,
        insulator_svg_r_2, insulator_svg_s_2, insulator_svg_t_2, notes)
  values (tid, p_opid, insp, line, num, type_eff, volt_eff, p_actor ->> 'full_name', p_bdate, items,
        case when acycle = '{}'::jsonb then null else acycle end, case when bstate = '{}'::jsonb then null else bstate::text end,
        case when astate = '{}'::jsonb then null else astate::text end,
        rowx ->> 'insulator_svg_r', rowx ->> 'insulator_svg_s', rowx ->> 'insulator_svg_t',
        rowx ->> 'insulator_svg_r_2', rowx ->> 'insulator_svg_s_2', rowx ->> 'insulator_svg_t_2', coalesce(rowx ->> 'notes', ''));
  end if;
  for k in select jsonb_object_keys(rows) loop before_comps := before_comps || jsonb_build_object(k, cs -> k); end loop;
  return jsonb_build_object('_handled', true,
    'commit', jsonb_build_object('status', 'applied', 'touched', to_jsonb(touched), 'applied', to_jsonb(touched), 'skipped', '{}'::jsonb,
        'src_table', 'treatments', 'src_id', tid,
        'delta', jsonb_build_object('comps', rows, 'ts', newts, 'meta', newmeta - 'rev', 'items', itemkeys),
        'before', jsonb_build_object('comps', before_comps, 'ts', ts, 'meta', meta), 'reason', p_op ->> 'reason'));
end $$;

-- ---- VOID (also: removal of treated items) -------------------------------------------------------------------------------------
-- Restores the BEFORE rows of the target operation, but only for components for which it is still the last effective writer.
-- Original evidence rows are never mutated or deleted: a void is a new operation (the history views hide the source through app_op_marks).
create or replace function tower_cs.op_do_void(p_op jsonb, p_actor jsonb, p_tower uuid, p_state jsonb, p_opid uuid, p_hash text, p_bdate date)
returns jsonb language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  line text := p_op ->> 'line_name'; num text := p_op ->> 'tower_number';
  t_op uuid := nullif(p_op ->> 'target_op', '')::uuid; t_src uuid := nullif(p_op ->> 'target_source_id', '')::uuid;
  items text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p_op -> 'items', '[]'::jsonb))), '{}'::text[]);
  X tower_cs.op; cs jsonb := p_state -> 'comps'; ts jsonb := p_state -> 'ts'; meta jsonb := p_state -> 'meta';
  comps text[] := '{}'::text[]; c text; keys text[]; blocked text[] := '{}'::text[]; rows jsonb := '{}'::jsonb; before_comps jsonb := '{}'::jsonb;
  sevs jsonb := '{}'::jsonb; sevm jsonb := '{}'::jsonb; sec text; newcomps jsonb := cs; st jsonb; newts jsonb; newmeta jsonb := meta; v jsonb; k text;
  all_keys text[] := '{}'::text[]; restore_src boolean := false; reasons text[]; removed text[] := '{}'::text[]; is_full boolean := true; tbl text;
begin
  if nullif(btrim(coalesce(p_op ->> 'reason', '')), '') is null then perform tower_cs.op_fail('reason_required'); end if;
  if t_op is not null then select * into X from tower_cs.op where op_id = t_op and tower_id = p_tower;
  elsif t_src is not null then select * into X from tower_cs.op where source_id = t_src and tower_id = p_tower and kind in ('observation', 'treatment') order by rev limit 1;
  else perform tower_cs.op_fail('invalid'); end if;
  if not found then
    -- legacy evidence (no operation, no reliable delta): the row is hidden from history; the current state is NOT reversed
    if t_src is null then perform tower_cs.op_fail('unknown_target'); end if;
    tbl := case when exists (select 1 from public.inspections i where i.id = t_src and i.line_name = line and i.tower_number = num) then 'inspections'
                when exists (select 1 from public.treatments t where t.id = t_src and t.line_name = line and t.tower_number = num) then 'treatments' end;
    if tbl is null then perform tower_cs.op_fail('unknown_target'); end if;
    if exists (select 1 from tower_cs.op o where o.kind = 'void' and o.target_source_id = t_src) then perform tower_cs.op_fail('already_voided'); end if;
    return jsonb_build_object('_handled', true, 'commit', jsonb_build_object('status', 'applied', 'touched', '[]'::jsonb, 'applied', '[]'::jsonb, 'skipped', '{}'::jsonb,
      'src_table', null, 'src_id', null, 'target_src', t_src, 'delta', '{}'::jsonb, 'before', '{}'::jsonb, 'reason', p_op ->> 'reason',
      'result', jsonb_build_object('state_reversed', false, 'note', 'legacy_without_delta', 'table', tbl)));
  end if;
  if X.kind not in ('observation', 'treatment', 'correction') then perform tower_cs.op_fail('not_voidable', jsonb_build_object('kind', X.kind)); end if;
  if exists (select 1 from tower_cs.op o where o.kind = 'void' and o.target_op = X.op_id and o.status = 'applied' and coalesce(o.delta ? 'removed_items', false) = false) then
    perform tower_cs.op_fail('already_voided'); end if;
  comps := X.applied;
  if cardinality(items) > 0 then
    if X.kind <> 'treatment' then perform tower_cs.op_fail('items_only_for_treatments'); end if;
    for c, v in select e.key, e.value from jsonb_each(coalesce(X.delta -> 'items', '{}'::jsonb)) e loop
      keys := coalesce(array(select jsonb_array_elements_text(v)), '{}'::text[]);
      all_keys := all_keys || keys;
    end loop;
    if exists (select 1 from unnest(items) i where not (i = any (all_keys))) then perform tower_cs.op_fail('unknown_item'); end if;
    comps := '{}'::text[];
    for c, v in select e.key, e.value from jsonb_each(coalesce(X.delta -> 'items', '{}'::jsonb)) e loop
      keys := coalesce(array(select jsonb_array_elements_text(v)), '{}'::text[]);
      if keys && items then
        if not (keys <@ items) then perform tower_cs.op_fail('partial_item_removal_unsupported', jsonb_build_object('component', c, 'items', to_jsonb(keys))); end if;
        comps := array_append(comps, c);
      end if;
    end loop;
    removed := items; is_full := comps @> X.applied and X.applied @> comps;
    -- items already removed by an earlier correction cannot be removed twice
    if exists (select 1 from tower_cs.op o, jsonb_array_elements_text(o.delta -> 'removed_items') ri
               where o.kind = 'void' and o.target_op = X.op_id and ri = any (items)) then perform tower_cs.op_fail('already_voided'); end if;
  end if;
  -- cardinality(comps) = 0: a historical_only observation wrote nothing; there is nothing to reverse and the source is only hidden
  foreach c in array comps loop
    if (cs -> c ->> 'last_op')::uuid is distinct from X.op_id then blocked := array_append(blocked, c); end if;
  end loop;
  if cardinality(blocked) > 0 then
    perform tower_cs.op_fail('later_ops', jsonb_build_object('components', to_jsonb(blocked), 'later_ops', tower_cs.op_later(p_tower, X.rev, blocked)));
  end if;
  foreach c in array comps loop
    v := X.before -> 'comps' -> c;
    if v is null then perform tower_cs.op_fail('no_before_value', jsonb_build_object('component', c)); end if;
    rows := rows || jsonb_build_object(c, tower_cs.op_norm_row(v) || jsonb_build_object('wop', X.before -> 'comps' -> c -> 'last_op'));  -- restored value keeps its ORIGINAL effective writer
    before_comps := before_comps || jsonb_build_object(c, cs -> c);
    newcomps := jsonb_set(newcomps, array[c], tower_cs.op_norm_row(v) || jsonb_build_object('rev', 0, 'last_op', null));
    sec := tower_cs.op_section(c);
    if sec is not null and (ts #>> array['sev_meta', sec, 'op'])::uuid = X.op_id then
      sevs := sevs || jsonb_build_object(sec, X.before #> array['ts', 'sev', sec]);
      sevm := sevm || jsonb_build_object(sec, jsonb_build_object('date', X.before #> array['ts', 'sev_meta', sec, 'date']));
    end if;
  end loop;
  -- source pointer of the tower: restored only when this operation's inspection is still the source
  if X.kind = 'observation' and X.source_id is not null and (ts ->> 'src_id')::uuid = X.source_id and cardinality(comps) > 0 then restore_src := true; end if;
  reasons := coalesce(array(select jsonb_array_elements_text(ts -> 'reasons')), '{}'::text[]);
  st := tower_cs.op_status(newcomps, reasons, case when restore_src then (X.before #>> '{ts,src_id}') is not null else (ts ->> 'src_id') is not null end);
  newts := jsonb_build_object('status', st ->> 'status', 'reasons', st -> 'reasons', 'sev', sevs, 'sev_meta', sevm);
  if restore_src then
    newts := newts || jsonb_build_object('src_id', X.before #> '{ts,src_id}', 'src_date', X.before #> '{ts,src_date}', 'src_created', X.before #> '{ts,src_created}');
    newmeta := newmeta || jsonb_build_object('source_inspection_id', X.before #> '{meta,source_inspection_id}', 'source_inspection_date', X.before #> '{meta,source_inspection_date}',
                                             'notes', X.before #> '{meta,notes}');
  end if;
  newmeta := tower_cs.op_meta_derive(newmeta, newcomps, st ->> 'status');
  return jsonb_build_object('_handled', true, 'commit', jsonb_build_object('status', 'applied', 'touched', to_jsonb(comps), 'applied', to_jsonb(comps), 'skipped', '{}'::jsonb,
    'src_table', null, 'src_id', null, 'target_op', X.op_id, 'target_src', X.source_id,
    'delta', jsonb_build_object('comps', rows, 'ts', newts, 'meta', newmeta - 'rev') || case when cardinality(removed) > 0 then jsonb_build_object('removed_items', to_jsonb(removed)) else '{}'::jsonb end,
    'before', jsonb_build_object('comps', before_comps, 'ts', ts, 'meta', meta), 'reason', p_op ->> 'reason',
    'result', jsonb_build_object('state_reversed', cardinality(comps) > 0, 'restored', to_jsonb(comps), 'full', is_full)));
end $$;

-- ---- ANNOTATE: audited metadata edit of a historical row; never recomputes state --------------------------------------------------
create or replace function tower_cs.op_do_annotate(p_op jsonb, p_actor jsonb, p_tower uuid, p_state jsonb, p_opid uuid, p_hash text, p_bdate date)
returns jsonb language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  line text := p_op ->> 'line_name'; num text := p_op ->> 'tower_number'; tbl text := p_op ->> 'table'; rid uuid := nullif(p_op ->> 'id', '')::uuid;
  patch jsonb := coalesce(p_op -> 'patch', '{}'::jsonb); allowed text[]; k text; v jsonb; old jsonb; sets text[] := '{}'::text[]; rowj jsonb; n int;
begin
  if tbl not in ('inspections', 'treatments') or rid is null or jsonb_typeof(patch) <> 'object' or patch = '{}'::jsonb then perform tower_cs.op_fail('invalid'); end if;
  if nullif(btrim(coalesce(p_op ->> 'reason', '')), '') is null then perform tower_cs.op_fail('reason_required'); end if;
  allowed := case tbl when 'inspections' then array['notes', 'road_access_notes', 'fire_causes_notes', 'inspection_date', 'created_by_name']
                      else array['notes', 'treated_by', 'treatment_date'] end;
  if tbl = 'inspections' then select to_jsonb(i) into rowj from public.inspections i where i.id = rid and i.line_name = line and i.tower_number = num;
  else select to_jsonb(t) into rowj from public.treatments t where t.id = rid and t.line_name = line and t.tower_number = num; end if;
  if rowj is null then perform tower_cs.op_fail('unknown_target'); end if;
  for k, v in select e.key, e.value from jsonb_each(patch) e loop
    if not (k = any (allowed)) then perform tower_cs.op_fail('field_not_allowed', jsonb_build_object('field', k)); end if;
    if k in ('inspection_date', 'treatment_date') then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then perform tower_cs.op_fail('invalid_date'); end if;
      begin perform (v #>> '{}')::date; exception when others then perform tower_cs.op_fail('invalid_date'); end;
    elsif jsonb_typeof(v) not in ('string', 'null') or char_length(coalesce(v #>> '{}', '')) > 4000 then perform tower_cs.op_fail('invalid_shape', jsonb_build_object('field', k)); end if;
    old := coalesce(old, '{}'::jsonb) || jsonb_build_object(k, rowj -> k);
    sets := array_append(sets, format('%I = %s', k, case when jsonb_typeof(v) = 'null' then 'null'
                                                         when k in ('inspection_date', 'treatment_date') then quote_literal(v #>> '{}') || '::date'
                                                         else quote_literal(v #>> '{}') end));
  end loop;
  execute format('update public.%I set %s where id = $1', tbl, array_to_string(sets, ', ')) using rid;
  get diagnostics n = row_count;
  if n <> 1 then perform tower_cs.op_fail('unknown_target'); end if;
  return jsonb_build_object('_handled', true, 'commit', jsonb_build_object('status', 'applied', 'touched', '[]'::jsonb, 'applied', '[]'::jsonb, 'skipped', '{}'::jsonb,
    'src_table', null, 'src_id', null, 'target_src', rid, 'delta', jsonb_build_object('annotate', jsonb_build_object('table', tbl, 'id', rid, 'patch', patch)),
    'before', jsonb_build_object('annotate', jsonb_build_object('table', tbl, 'id', rid, 'old', old)), 'reason', p_op ->> 'reason'));
end $$;

-- ---- dispatcher -------------------------------------------------------------------------------------------------------------------
create or replace function tower_cs.op_jtext(p jsonb) returns text[] language sql immutable set search_path = pg_catalog as $$
  select coalesce(array(select jsonb_array_elements_text(coalesce(p, '[]'::jsonb))), '{}'::text[]) $$;

create or replace function tower_cs.op_dispatch(p_op jsonb, p_actor jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp set jit = off as $$
declare
  kind text := p_op ->> 'kind'; opid uuid; line text := p_op ->> 'line_name'; num text := p_op ->> 'tower_number'; bdate date; hash text; prev tower_cs.op;
  o record; h jsonb; c jsonb; res record; hint jsonb; creat boolean; reqlisted boolean;
begin
  begin opid := (p_op ->> 'op_id')::uuid; exception when others then perform tower_cs.op_fail('invalid_op_id'); end;
  if opid is null then perform tower_cs.op_fail('invalid_op_id'); end if;
  if line is null or num is null or btrim(line) = '' or btrim(num) = '' or char_length(line) > 200 or char_length(num) > 100 then perform tower_cs.op_fail('invalid'); end if;
  if jsonb_typeof(p_op) <> 'object' then perform tower_cs.op_fail('invalid'); end if;
  if kind in ('observation', 'treatment') or p_op ? 'business_date' then
    begin bdate := (p_op ->> 'business_date')::date; exception when others then perform tower_cs.op_fail('invalid_date'); end;
    if bdate is null then perform tower_cs.op_fail('date_required'); end if;
    if bdate < date '2000-01-01' or bdate > (now() at time zone 'Asia/Baghdad')::date + 1 then perform tower_cs.op_fail('invalid_date'); end if;
  else bdate := (now() at time zone 'Asia/Baghdad')::date; end if;
  hash := md5(((p_op - 'op_id') - '_client')::text);
  select * into prev from tower_cs.op where op_id = opid;
  if found then
    if prev.request_hash = hash then return coalesce(prev.result, jsonb_build_object('ok', true, 'op_id', opid)) || jsonb_build_object('idempotent', true); end if;
    perform tower_cs.op_fail('op_id_reused');
  end if;
  hint := jsonb_build_object('tower_type', p_op #>> '{row,tower_type}', 'voltage', p_op #> '{row,voltage}');
  creat := kind in ('observation', 'treatment', 'correction', 'void', 'annotate'); reqlisted := kind in ('observation', 'treatment', 'correction');
  select * into o from tower_cs.op_open(line, num, creat, reqlisted, hint, p_actor);
  if o.o_tower is null then perform tower_cs.op_fail('unknown_tower'); end if;
  select * into prev from tower_cs.op where op_id = opid;   -- a concurrent identical request may have committed while we waited for the lock
  if found then
    if prev.request_hash = hash then return coalesce(prev.result, jsonb_build_object('ok', true, 'op_id', opid)) || jsonb_build_object('idempotent', true); end if;
    perform tower_cs.op_fail('op_id_reused');
  end if;
  if kind in ('observation', 'correction') then h := tower_cs.op_do_obs(kind, p_op, p_actor, o.o_tower, o.o_state, opid, hash, bdate);
  elsif kind = 'treatment' then h := tower_cs.op_do_treatment(p_op, p_actor, o.o_tower, o.o_state, opid, hash, bdate);
  elsif kind = 'void' then h := tower_cs.op_do_void(p_op, p_actor, o.o_tower, o.o_state, opid, hash, bdate);
  elsif kind = 'annotate' then h := tower_cs.op_do_annotate(p_op, p_actor, o.o_tower, o.o_state, opid, hash, bdate);
  else perform tower_cs.op_fail('invalid_kind'); end if;
  c := h -> 'commit';
  select * into res from tower_cs.op_commit(o.o_tower, o.o_state, opid, kind, c ->> 'status', bdate, p_actor, c ->> 'src_table', nullif(c ->> 'src_id', '')::uuid,
        nullif(c ->> 'target_op', '')::uuid, nullif(c ->> 'target_src', '')::uuid, hash,
        tower_cs.op_jtext(c -> 'touched'), tower_cs.op_jtext(c -> 'applied'), coalesce(c -> 'skipped', '{}'::jsonb),
        coalesce(c -> 'delta', '{}'::jsonb), coalesce(c -> 'before', '{}'::jsonb), c ->> 'reason', coalesce(c -> 'result', '{}'::jsonb));
  return res.o_result;
end $$;

-- ---- public entry point ------------------------------------------------------------------------------------------------------------
-- Actor, role and permission come ONLY from the verified opaque session. Returns {ok:true, ..., tower:<fresh envelope>} or {ok:false, code, ...detail}.
create or replace function public.app_op_apply(p_token text, p_op jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp set jit = off as $$
declare a jsonb; kind text; roles text[]; r jsonb; m text; d text; dj jsonb; live jsonb; line text; num text;
begin
  if p_op is null or jsonb_typeof(p_op) <> 'object' then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  kind := p_op ->> 'kind';
  roles := case kind when 'observation' then array['admin', 'supervisor', 'technician'] when 'treatment' then array['admin', 'supervisor', 'technician']
                     when 'correction' then array['admin', 'supervisor'] when 'annotate' then array['admin', 'supervisor'] when 'void' then array['admin'] end;
  if roles is null then return jsonb_build_object('ok', false, 'code', 'invalid_kind'); end if;
  a := tower_cs.auth_check(p_token, roles);
  if not (a ->> 'ok')::boolean then return a; end if;
  line := p_op ->> 'line_name'; num := p_op ->> 'tower_number';
  begin
    r := tower_cs.op_dispatch(p_op, a -> 'user');
    live := tower_cs.live_resolve(line, array[num], true, 'full');
    if (live ->> 'ok')::boolean then r := r || jsonb_build_object('tower', live -> 'towers' -> num, 'as_of', live -> 'as_of'); end if;
    return r;
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics m = message_text, d = pg_exception_detail;
      begin dj := d::jsonb; exception when others then dj := '{}'::jsonb; end;
      if m like 'identity_variant:%' then return jsonb_build_object('ok', false, 'code', 'identity_variant', 'existing', substr(m, 18)); end if;
      return jsonb_build_object('ok', false, 'code', m) || case when jsonb_typeof(dj) = 'object' then dj else '{}'::jsonb end;
    when others then
      get stacked diagnostics m = message_text;
      return jsonb_build_object('ok', false, 'code', 'server_error') || case when current_setting('tower_cs.debug', true) = 'on' then jsonb_build_object('debug', m) else '{}'::jsonb end;
  end;
end $$;


-- ===== B. 23a_ops_envelope =====
-- =====================================================================
-- 23a_ops_envelope.sql : the operations-basis envelope served by app_tower_state / app_line_state for towers with tower_state.rev > 0.
-- The envelope is built ONLY from tower_state/component_state/tower_meta (the authoritative state). It never reads the mutable
-- latest inspections row: the `row` handed to the client is SYNTHESIZED from the components using the legacy column names, so the
-- existing prefill/departure code keeps working. Unknown stays NULL (never [] / false / 0 / glass).
-- =====================================================================

-- one circuit's three phases -> {R:[..]|null, S:..., T:...} for a facet ('damaged' | 'cycle' | 'chains')
create or replace function tower_cs.op_phase_obj(p_comps jsonb, p_prefix text, p_facet text) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare ph text; c jsonb; o jsonb := '{}'::jsonb; v jsonb; any_v boolean := false;
begin
  foreach ph in array array['R','S','T'] loop
    c := p_comps -> (p_prefix || ph);
    v := null;
    if c is not null and c ->> 'applicability' <> 'not_applicable' then
      if p_facet = 'chains' then
        v := c #> '{value,chains_saved}';
      elsif c ->> 'data_status' = 'known' then
        v := c #> array['value', p_facet];
      end if;
    end if;
    if v is not null and jsonb_typeof(v) = 'null' then v := null; end if;
    if v is not null then any_v := true; end if;
    o := o || jsonb_build_object(ph, v);
  end loop;
  -- chains: only phases ever saved are emitted; all unknown -> NULL (the column was never written)
  if p_facet = 'chains' and not any_v then return null; end if;
  if p_facet = 'damaged' and not any_v then return null; end if;
  return o;
end $$;

-- legacy-shaped inspection row from the authoritative state (grid-safe: no SVG columns)
create or replace function tower_cs.op_legacy_row(p_state jsonb) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare cs jsonb := p_state -> 'comps'; ts jsonb := p_state -> 'ts'; m jsonb := p_state -> 'meta'; k text; col text; o jsonb; c2 jsonb; vv jsonb; cy jsonb; ch jsonb; ch2 jsonb;
begin
  o := jsonb_build_object('id', ts -> 'src_id', 'line_name', m -> 'line_name', 'tower_number', m -> 'tower_number',
        'inspection_date', ts -> 'src_date', 'created_at', ts -> 'src_created',
        'tower_type', case when m #>> '{tower_type,status}' in ('agreed','single_source','inferred') then m #> '{tower_type,value}' end,
        'voltage', case when m #>> '{voltage,status}' in ('agreed','single_source','inferred') then m #> '{voltage,value}' end);
  vv := tower_cs.op_phase_obj(cs, 'ins_', 'damaged');
  cy := tower_cs.op_phase_obj(cs, 'ins_', 'cycle');
  ch := tower_cs.op_phase_obj(cs, 'ins_', 'chains');
  o := o || jsonb_build_object('insulator_state', case when vv is null then null else to_jsonb(vv::text) end, 'insulator_cycle', cy,
                               'insulator_chain_types', case when ch is null then null else to_jsonb(ch::text) end);
  if coalesce(cs #>> '{ins2_R,applicability}', 'unknown') <> 'not_applicable' then
    vv := tower_cs.op_phase_obj(cs, 'ins2_', 'damaged'); cy := tower_cs.op_phase_obj(cs, 'ins2_', 'cycle'); ch2 := tower_cs.op_phase_obj(cs, 'ins2_', 'chains');
    o := o || jsonb_build_object('insulator_state_2', vv, 'insulator_cycle_2', cy, 'insulator_chain_types_2', case when ch2 is null then null else to_jsonb(ch2::text) end);
  else
    o := o || jsonb_build_object('insulator_state_2', null, 'insulator_cycle_2', null, 'insulator_chain_types_2', null);
  end if;
  foreach k in array tower_cs.op_keys() loop
    continue when tower_cs.op_kind(k) = 'ins';
    col := tower_cs.op_column(k);
    if k = 'fire' then
      o := o || jsonb_build_object('sev_fire', cs #> '{fire,value,sev}', 'fire_causes_notes', cs #> '{fire,value,notes}');
    else
      o := o || jsonb_build_object(col, cs #> array[k, 'value', 'text']);
    end if;
  end loop;
  for k in select unnest(array['insulator','iron','foundation','wires','ground']) loop
    o := o || jsonb_build_object('sev_' || k, ts #> array['sev', k]);
  end loop;
  return o;
end $$;

create or replace function tower_cs.op_envelope(p_tower uuid, p_detail boolean, p_rows text) returns jsonb
language plpgsql stable set search_path = pg_catalog as $$
declare st jsonb := tower_cs.op_state_load(p_tower); ts jsonb := st -> 'ts'; m jsonb := st -> 'meta'; comps jsonb := '[]'::jsonb; k text; r jsonb; trt jsonb; treated jsonb; rowj jsonb;
begin
  if ts is null or m is null then return null; end if;
  rowj := case when p_rows = 'none' then null else tower_cs.op_legacy_row(st) end;
  -- 'full' rows keep the legacy full-row shape: descriptive columns + drawings of the SOURCE inspection (never state — state always comes from the components)
  if p_rows = 'full' and rowj is not null then
    rowj := rowj || coalesce((select jsonb_build_object('notes', i.notes, 'road_access_notes', i.road_access_notes, 'wires_circuit', i.wires_circuit, 'created_by_name', i.created_by_name,
                                'insulator_svg_r', i.insulator_svg_r, 'insulator_svg_s', i.insulator_svg_s, 'insulator_svg_t', i.insulator_svg_t)
                              from public.inspections i where ts ->> 'src_id' is not null and i.id = (ts ->> 'src_id')::uuid),
                            jsonb_build_object('notes', null, 'road_access_notes', null, 'wires_circuit', null, 'created_by_name', null, 'insulator_svg_r', null, 'insulator_svg_s', null, 'insulator_svg_t', null));
  end if;
  for k, r in select e.key, e.value from jsonb_each(st -> 'comps') e order by e.key loop
    comps := comps || jsonb_build_array(jsonb_build_object('k', k, 'ci', r -> 'circuit', 'cond', r ->> 'condition', 'ds', r ->> 'data_status', 'fl', r -> 'flags',
               'ap', r ->> 'applicability', 'rv', r -> 'rev', 'eff', r -> 'eff', 'op', r -> 'last_op')
               || case when p_detail then jsonb_build_object('v', r -> 'value', 'tids', r -> 'tids') else '{}'::jsonb end);
  end loop;
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into treated
    from jsonb_each(st -> 'comps') e(key, value) where tower_cs.op_kind(e.key) <> 'ins' and e.value ->> 'condition' = 'treated';
  select coalesce(jsonb_agg(jsonb_build_object('id', o.source_id, 'op_id', o.op_id, 'created_at', o.recorded_at, 'seq', o.rev, 'relation', 'operation',
              'verdict', o.status, 'business_date', o.business_date,
              'voided_by', (select v.op_id from tower_cs.op v where v.tower_id = o.tower_id and v.kind = 'void' and v.target_op = o.op_id order by v.rev limit 1)) order by o.rev), '[]'::jsonb)
    into trt from tower_cs.op o where o.tower_id = p_tower and o.kind = 'treatment' and p_detail;
  return jsonb_build_object('basis', 'operations', 'status', ts ->> 'status',
    'resolution', case ts ->> 'status' when 'no_source' then 'no_source' when 'needs_review' then 'unresolved' else 'resolved' end,
    'unresolved_reasons', ts -> 'reasons',
    'source', case when ts ->> 'src_id' is null then null else jsonb_build_object('inspection_id', ts -> 'src_id', 'inspection_date', ts -> 'src_date', 'created_at', ts -> 'src_created') end,
    'row', rowj,
    'treated_keys', treated, 'components', comps,
    'meta', case when p_detail then
              jsonb_build_object('tower_type', m -> 'tower_type', 'voltage', m -> 'voltage', 'circuits', m -> 'circuits', 'geometry', m -> 'geometry', 'materials', m -> 'materials',
                                 'prefill_blockers', m -> 'prefill_blockers', 'prefill_ready', m -> 'prefill_ready', 'source_inspection_id', m -> 'source_inspection_id', 'rev', ts -> 'rev')
            else
              jsonb_build_object('geometry_mode', m #> '{geometry,mode}', 'geometry_status', m #> '{geometry,status}', 'geometry_basis', m #> '{geometry,basis}',
                                 'materials_status', m #> '{materials,status}', 'prefill_blockers', m -> 'prefill_blockers', 'prefill_ready', m -> 'prefill_ready',
                                 'circuit2', m #> '{circuits,circuit2_applicability}', 'rev', ts -> 'rev') end,
    'treatments', case when p_detail then trt else '[]'::jsonb end, 'issues', '[]'::jsonb,
    'severities', ts -> 'sev', 'sev_meta', ts -> 'sev_meta', 'rev', ts -> 'rev', 'last_op', ts -> 'last_op',
    'version', 'o' || (ts ->> 'rev'));
end $$;


-- ===== B. 23b_ops_live_pack =====
-- 23b: live_pack with the operations branch (replaces the stage-2 definition)
create or replace function tower_cs.live_pack(p_line text, p_fp jsonb, p_detail boolean, p_rows text) returns jsonb
language plpgsql set search_path = pg_catalog as $$
declare out jsonb;
begin
  with al as (select distinct on (tower_number) tower_id, tower_number from pg_temp._tc_alias order by tower_number),
  fr as (select s.tower_id from tower_cs.tower_state s where s.rev > 0 and s.tower_id in (select tower_id from al)),
  comp as (
    select tower_id, jsonb_agg(jsonb_build_object('k', component, 'ci', circuit, 'cond', condition, 'ds', data_status, 'fl', to_jsonb(flags), 'ap', applicability)
                               || case when p_detail then jsonb_build_object('v', value, 'tids', to_jsonb(tids)) else '{}'::jsonb end order by component) as j
    from pg_temp._tc_comp where p_detail or condition in ('defect', 'treated') or data_status <> 'known' group by tower_id),
  keys as (select tower_id, jsonb_agg(key order by key) as j from pg_temp._tc_keys group by tower_id),
  trt as (
    select tower_id, jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at, 'seq', seq, 'relation', relation, 'verdict', verdict,
                                                   'items_status', items_status, 'checks', checks) order by created_at, id) as j
    from pg_temp._tc_t group by tower_id),
  iss as (
    select tower_id, jsonb_agg(jsonb_build_object('code', code, 'severity', severity) order by severity, code) as j
    from pg_temp._tc_issue where tower_id is not null and severity in ('blocking', 'warning') group by tower_id),
  env as (
    select al.tower_number,
      case when fr.tower_id is not null then tower_cs.op_envelope(al.tower_id, p_detail, p_rows)
      else
        jsonb_build_object('basis', 'live_legacy', 'status', st.status,
          'resolution', case st.status when 'no_source' then 'no_source' when 'needs_review' then 'unresolved' else 'resolved' end,
          'unresolved_reasons', to_jsonb(st.reasons),
          'source', case when st.src_id is null then null else jsonb_build_object('inspection_id', st.src_id, 'inspection_date', st.src_date, 'created_at', st.src_created) end,
          'row', case p_rows when 'full' then (select to_jsonb(i) from public.inspections i where i.id = st.src_id)
                             when 'grid' then (select to_jsonb(i) - 'insulator_svg_r' - 'insulator_svg_s' - 'insulator_svg_t' from public.inspections i where i.id = st.src_id)
                             else null end,
          'treated_keys', coalesce(keys.j, '[]'::jsonb),
          'components', coalesce(comp.j, '[]'::jsonb),
          'meta', case when p_detail then
                    jsonb_build_object('tower_type', m.tower_type, 'voltage', m.voltage, 'circuits', m.circuits, 'geometry', m.geometry, 'materials', m.materials,
                                       'prefill_blockers', to_jsonb(m.blockers), 'prefill_ready', m.ready, 'source_inspection_id', m.src_id)
                  else
                    jsonb_build_object('geometry_mode', m.geometry -> 'mode', 'geometry_status', m.geometry -> 'status', 'geometry_basis', m.geometry -> 'basis',
                                       'materials_status', m.materials -> 'status', 'prefill_blockers', to_jsonb(m.blockers), 'prefill_ready', m.ready,
                                       'circuit2', m.circuits -> 'circuit2_applicability') end,
          'treatments', case when p_detail then coalesce(trt.j, '[]'::jsonb) else '[]'::jsonb end,
          'issues', coalesce(iss.j, '[]'::jsonb))
      end
      || jsonb_build_object('line_name', p_line, 'tower_number', al.tower_number)
      || case when fr.tower_id is not null then '{}'::jsonb else jsonb_build_object(
           'version', md5(coalesce(p_fp -> 'per' ->> al.tower_number, '') || '|' || coalesce(p_fp ->> 'cfg', '') || '|' || coalesce(p_fp ->> 'ref', '') || '|' || tower_cs.live_version())) end as j
    from al
    left join fr on fr.tower_id = al.tower_id
    left join pg_temp._tc_status st on st.tower_id = al.tower_id
    left join pg_temp._tc_meta m on m.tower_id = al.tower_id
    left join comp on comp.tower_id = al.tower_id
    left join keys on keys.tower_id = al.tower_id
    left join trt on trt.tower_id = al.tower_id
    left join iss on iss.tower_id = al.tower_id)
  select coalesce(jsonb_object_agg(tower_number, j), '{}'::jsonb) into out from env;
  return out;
end $$;



-- ===== B. 23c_ops_verify =====
-- =====================================================================
-- 23c_ops_verify.sql : rebuild-and-compare (drift detection), explicit admin repair, history marks and the operation list
-- =====================================================================

-- state rebuilt by folding the whole append-only log from nothing
create or replace function tower_cs.op_rebuild(p_tower uuid) returns jsonb
language plpgsql stable set search_path = pg_catalog as $$
declare s jsonb := null; o record;
begin
  for o in select op_id, rev, delta from tower_cs.op where tower_id = p_tower order by rev loop
    s := tower_cs.op_fold_step(s, o.delta, o.rev, o.op_id);
  end loop;
  return s;
end $$;

-- normalized, comparable form of a state (only fields the fold owns)
create or replace function tower_cs.op_state_norm(p jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'comps', coalesce((select jsonb_object_agg(e.key, e.value - 'tids' || jsonb_build_object('tids', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(e.value -> 'tids', '[]'::jsonb)) x)))
                         from jsonb_each(p -> 'comps') e), '{}'::jsonb),
    'ts', coalesce(p -> 'ts', '{}'::jsonb) - 'reasons' || jsonb_build_object('reasons', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(p #> '{ts,reasons}', '[]'::jsonb)) x)),
    'meta', coalesce(p -> 'meta', '{}'::jsonb)) $$;

-- differences between the stored state and the fold: list of {where, key, stored, folded}
create or replace function tower_cs.op_drift(p_tower uuid) returns jsonb
language plpgsql stable set search_path = pg_catalog as $$
declare a jsonb := tower_cs.op_state_norm(tower_cs.op_state_load(p_tower)); b jsonb := tower_cs.op_state_norm(tower_cs.op_rebuild(p_tower)); out jsonb := '[]'::jsonb; k text; sec text;
begin
  foreach sec in array array['comps', 'ts', 'meta'] loop
    for k in select key from (select jsonb_object_keys(coalesce(a -> sec, '{}'::jsonb)) as key union select jsonb_object_keys(coalesce(b -> sec, '{}'::jsonb))) z order by 1 loop
      if (a -> sec -> k) is distinct from (b -> sec -> k) then
        out := out || jsonb_build_array(jsonb_build_object('section', sec, 'key', k, 'stored', a -> sec -> k, 'folded', b -> sec -> k));
      end if;
    end loop;
  end loop;
  return out;
end $$;

-- repair audit (the only record of an explicit state rewrite)
create table if not exists tower_cs.op_repair_log (
  id bigserial primary key, tower_id uuid not null, at timestamptz not null default clock_timestamp(), actor_user_id text, actor_name text,
  reason text not null, drift jsonb not null, stored_before jsonb not null);
alter table tower_cs.op_repair_log enable row level security;

-- administrator: read-only drift check over one tower or a whole line (never writes)
create or replace function public.app_ops_verify(p_token text, p_line_name text default null, p_tower_number text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token, array['admin']); rows jsonb := '[]'::jsonb; t record; d jsonb; n int := 0;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  for t in select s.tower_id, m.line_name, m.tower_number from tower_cs.tower_state s join tower_cs.tower_meta m using (tower_id)
           where s.rev > 0 and (p_line_name is null or m.line_name = p_line_name) and (p_tower_number is null or m.tower_number = p_tower_number)
           order by m.line_name, m.tower_number loop
    n := n + 1;
    d := tower_cs.op_drift(t.tower_id);
    if jsonb_array_length(d) > 0 then rows := rows || jsonb_build_array(jsonb_build_object('line_name', t.line_name, 'tower_number', t.tower_number, 'drift', d)); end if;
  end loop;
  return jsonb_build_object('ok', true, 'checked', n, 'drifted', jsonb_array_length(rows), 'towers', rows);
end $$;

-- administrator: explicit repair of ONE tower from the log. Needs a reason, the tower must actually drift, and the previous stored state is kept in the audit table.
create or replace function public.app_ops_repair(p_token text, p_line_name text, p_tower_number text, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token, array['admin']); tid uuid; d jsonb; f jsonb;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then return jsonb_build_object('ok', false, 'code', 'reason_required'); end if;
  select a2.tower_id into tid from tower_cs.tower_alias a2 join tower_cs.tower_state s on s.tower_id = a2.tower_id and s.rev > 0
   where a2.line_name = p_line_name and a2.tower_number = p_tower_number;
  if tid is null then return jsonb_build_object('ok', false, 'code', 'unknown_tower'); end if;
  perform pg_advisory_xact_lock(hashtextextended('tower_cs.op:' || tid::text, 0));
  d := tower_cs.op_drift(tid);
  if jsonb_array_length(d) = 0 then return jsonb_build_object('ok', true, 'repaired', false, 'note', 'no_drift'); end if;
  f := tower_cs.op_rebuild(tid);
  insert into tower_cs.op_repair_log(tower_id, actor_user_id, actor_name, reason, drift, stored_before)
    values (tid, a #>> '{user,id}', a #>> '{user,full_name}', p_reason, d, tower_cs.op_state_load(tid));
  perform tower_cs.op_state_store(tid, f);
  return jsonb_build_object('ok', true, 'repaired', true, 'drift', d);
end $$;

-- history marks of a line: what the history views must hide / annotate. Voids never delete anything; they only mark.
create or replace function public.app_op_marks(p_token text, p_line_name text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token); out jsonb;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  select jsonb_build_object('ok', true,
    'voided', coalesce(jsonb_agg(jsonb_build_object('source_id', coalesce(v.target_source_id, t.source_id), 'op_id', v.op_id, 'target_op', v.target_op, 'tower_number', m.tower_number, 'line_name', m.line_name,
              'at', v.recorded_at, 'by', v.actor_name, 'reason', v.reason, 'removed_items', v.delta -> 'removed_items', 'reversed', coalesce((v.result ->> 'state_reversed')::boolean, false))
              order by v.recorded_at) filter (where v.kind = 'void'), '[]'::jsonb),
    'corrections', coalesce(jsonb_agg(jsonb_build_object('op_id', v.op_id, 'tower_number', m.tower_number, 'line_name', m.line_name, 'target', v.target_source_id, 'at', v.recorded_at, 'by', v.actor_name, 'reason', v.reason, 'touched', to_jsonb(v.touched))
              order by v.recorded_at) filter (where v.kind = 'correction'), '[]'::jsonb),
    'annotations', coalesce(jsonb_agg(jsonb_build_object('op_id', v.op_id, 'tower_number', m.tower_number, 'line_name', m.line_name, 'at', v.recorded_at, 'by', v.actor_name, 'reason', v.reason,
              'target', v.target_source_id, 'patch', v.delta #> '{annotate,patch}') order by v.recorded_at) filter (where v.kind = 'annotate'), '[]'::jsonb))
  into out
  from tower_cs.op v join tower_cs.tower_meta m on m.tower_id = v.tower_id and (p_line_name is null or btrim(p_line_name) = '' or m.line_name = p_line_name)
  left join tower_cs.op t on t.op_id = v.target_op
  where v.kind in ('void', 'correction', 'annotate');
  return out;
end $$;

-- operation list of one tower (audit / conflict re-observation), newest first
create or replace function public.app_ops_list(p_token text, p_line_name text, p_tower_number text, p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token); tid uuid;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  select a2.tower_id into tid from tower_cs.tower_alias a2 where a2.line_name = p_line_name and a2.tower_number = p_tower_number;
  if tid is null then return jsonb_build_object('ok', true, 'ops', '[]'::jsonb); end if;
  return jsonb_build_object('ok', true, 'ops', coalesce((select jsonb_agg(jsonb_build_object('op_id', o.op_id, 'rev', o.rev, 'kind', o.kind, 'status', o.status,
      'business_date', o.business_date, 'recorded_at', o.recorded_at, 'actor', o.actor_name, 'role', o.actor_role, 'source_id', o.source_id, 'target_op', o.target_op,
      'touched', to_jsonb(o.touched), 'applied', to_jsonb(o.applied), 'skipped', o.skipped, 'reason', o.reason) order by o.rev desc)
    from (select * from tower_cs.op x where x.tower_id = tid order by x.rev desc limit greatest(1, least(coalesce(p_limit, 50), 200))) o), '[]'::jsonb));
end $$;

-- ---- diagnostics adapted to the operations layer ---------------------------------------------------------------------
-- towers served from operations are DELIBERATELY different from the latest legacy row (treatments no longer patch it): compare shadow-vs-latest only for legacy towers
create or replace view tower_cs.v_shadow_vs_latest as
  select a.line_name, a.tower_number, ts.tower_id, ts.status, ts.review_reasons,
         li.id as view_inspection_id, ts.source_inspection_id,
         (li.id is not distinct from ts.source_inspection_id) as same_source_row,
         (select bool_and((cs.value -> 'damaged') is not distinct from (d.val -> right(cs.component, 1)))
            from tower_cs.component_state cs
            cross join lateral tower_cs.decode(to_jsonb(li.insulator_state), true) d
           where cs.tower_id = ts.tower_id and cs.component in ('ins_R','ins_S','ins_T') and cs.data_status = 'known') as circuit1_damage_matches_view
  from tower_cs.tower_state ts
  join tower_cs.tower_alias a on a.tower_id = ts.tower_id
  left join public.latest_inspections li on li.line_name = a.line_name and li.tower_number = a.tower_number
  where ts.rev = 0;

create or replace view tower_cs.v_ops_overview as
  select a.line_name, a.tower_number, ts.tower_id, ts.rev, ts.status, ts.review_reasons, ts.last_op_id, ts.source_inspection_id, ts.source_inspection_date,
         (select count(*) from tower_cs.op o where o.tower_id = ts.tower_id) as ops,
         (select count(*) from tower_cs.op o where o.tower_id = ts.tower_id and o.kind in ('observation', 'treatment', 'correction', 'void')) as work_ops
  from tower_cs.tower_state ts join tower_cs.tower_alias a on a.tower_id = ts.tower_id where ts.rev > 0;


-- ===== B. 23d_ops_config =====
-- =====================================================================
-- 23d_ops_config.sql : explicit tower / line CONFIGURATION changes (public.line_towers_custom stays the configuration source).
--   * the ONLY write path to line_towers_custom after the lockdown is public.app_line_config_save / app_line_config_delete.
--   * towers that already have operation state get a 'config' operation when their effective type / chain geometry changes.
--   * a geometry change NEVER truncates or remaps saved damaged positions / cycles / chain materials: it needs an explicit reviewed
--     decision ({"action":"discard_to_unknown"}) per tower, otherwise the whole request is refused with the list. Nothing is half-applied.
--   * circuit-count of an owner-confirmed line can never change; a circuit-count change that contradicts an explicit registry source or
--     would touch migrated towers is refused.
-- =====================================================================

create table if not exists tower_cs.config_request (
  op_id uuid primary key, line_name text not null, request_hash text not null, result jsonb not null,
  actor_user_id text, actor_name text, at timestamptz not null default clock_timestamp());
alter table tower_cs.config_request enable row level security;

-- does the circuit's insulator row carry saved data that a layout change would have to truncate / remap?
create or replace function tower_cs.op_has_saved_ins(p_comps jsonb) returns text[]
language plpgsql immutable set search_path = pg_catalog as $$
declare k text; c jsonb; out text[] := '{}'::text[];
begin
  foreach k in array array['ins_R','ins_S','ins_T','ins2_R','ins2_S','ins2_T'] loop
    c := p_comps -> k;
    if c is null or c ->> 'applicability' = 'not_applicable' then continue; end if;
    if (c ->> 'data_status') in ('known', 'invalid') or jsonb_typeof(c #> '{value,damaged}') = 'array' or jsonb_typeof(c #> '{value,cycle}') = 'array'
       or jsonb_typeof(c #> '{value,chains_saved}') = 'array' then out := array_append(out, k); end if;
  end loop;
  return out;
end $$;

-- ONE tower: returns {change:'none'|'meta_only'|'geometry', ...} and, for a change, the commit pieces
create or replace function tower_cs.op_cfg_plan(p_state jsonb, p_tower jsonb, p_line_chain text, p_mapping jsonb) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare
  m jsonb := p_state -> 'meta'; cs jsonb := p_state -> 'comps'; volt integer; raw text := p_tower ->> 'type'; code_new text; code_old text;
  ov text := case when (p_tower ->> 'chain_override') in ('single', 'double') then p_tower ->> 'chain_override' end;
  bad_ov boolean := coalesce((p_tower ->> 'chain_override') not in ('single', 'double', ''), false);
  chain_eff text; basis text; mode_new text; mode_old text := m #>> '{geometry,mode}'; saved text[]; geo jsonb; mt jsonb := m -> 'tower_type'; newcs jsonb := cs; k text;
  pos_new integer; cat jsonb;
begin
  volt := case when tower_cs.is_resolved(m -> 'voltage') then (m #>> '{voltage,value}')::integer end;
  code_old := case when tower_cs.is_resolved(mt) then mt #>> '{value}' end;
  code_new := case when volt is not null and raw is not null then tower_cs.type_code(volt, raw) end;
  if bad_ov then return jsonb_build_object('change', 'refused', 'code', 'chain_override_invalid'); end if;
  if raw is not null and volt is not null and code_new is null then return jsonb_build_object('change', 'refused', 'code', 'type_invalid', 'type', raw); end if;
  -- the stored type is only replaced when the configuration names a valid type; absent type = nothing said
  code_new := coalesce(code_new, code_old);
  if volt = 400 then chain_eff := null; basis := 'not_applicable_400kv';
  elsif ov is not null then chain_eff := ov; basis := 'tower_override';
  elsif p_line_chain in ('single', 'double') then chain_eff := p_line_chain; basis := 'line_single_source';
  else chain_eff := null; basis := 'unresolved_unknown'; end if;
  mode_new := case when volt is null or code_new is null then null else tower_cs.insulator_mode(volt, code_new, chain_eff) end;
  saved := tower_cs.op_has_saved_ins(cs);
  if mode_new is not distinct from mode_old and code_new is not distinct from code_old then
    -- same effective layout. An 'inferred_from_saved_layout' geometry now confirmed by the configuration becomes explicit
    if (m #>> '{geometry,status}') = 'inferred' and mode_new is not null then
      geo := (m -> 'geometry') || jsonb_build_object('status', 'agreed', 'basis', case when ov is not null then 'tower_override' else 'line_setting' end,
               'inferred_from_saved_layout', false, 'line_setting_disagrees', false, 'line_mode', mode_new,
               'chain_mode', jsonb_build_object('value', chain_eff, 'basis', basis));
      return jsonb_build_object('change', 'meta_only', 'meta', jsonb_build_object('geometry', geo), 'comps', '{}'::jsonb, 'saved', to_jsonb(saved));
    end if;
    return jsonb_build_object('change', 'none');
  end if;
  pos_new := tower_cs.mode_positions(mode_new);
  if cardinality(saved) > 0 and mode_new is distinct from mode_old then
    if coalesce(p_mapping ->> 'action', '') <> 'discard_to_unknown' then
      return jsonb_build_object('change', 'refused', 'code', 'mapping_required', 'from_mode', mode_old, 'to_mode', mode_new, 'components', to_jsonb(saved));
    end if;
    foreach k in array saved loop
      newcs := jsonb_set(newcs, array[k], tower_cs.op_norm_row(jsonb_build_object(
        'circuit', cs -> k -> 'circuit', 'condition', 'unknown', 'data_status', 'unknown',
        'value', jsonb_build_object('reason', 'layout_changed_discarded', 'previous_positions', tower_cs.mode_positions(mode_old)),
        'flags', jsonb_build_array('layout_changed_discarded'), 'tids', '[]'::jsonb, 'applicability', cs -> k ->> 'applicability',
        'basis', cs -> k -> 'basis', 'src', null, 'eff', null)) || jsonb_build_object('rev', 0, 'last_op', null));
    end loop;
  end if;
  geo := coalesce(m -> 'geometry', '{}'::jsonb) || jsonb_build_object(
      'mode', mode_new, 'status', case when mode_new is null then 'unknown' else 'single_source' end,
      'basis', case when mode_new is null then basis when ov is not null then 'tower_override' else 'line_setting' end,
      'inferred_from_saved_layout', false, 'line_setting_disagrees', false, 'line_mode', mode_new,
      'chain_mode', jsonb_build_object('value', chain_eff, 'basis', basis),
      'positions', jsonb_build_object('derived', pos_new, 'line_derived', pos_new, 'observed_lengths', '[]'::jsonb),
      'chains_per_phase', jsonb_build_object('status', case when mode_new is null then 'unknown' else 'single_source' end, 'value', tower_cs.mode_chains(mode_new),
                                            'sources', jsonb_build_object('derived', tower_cs.mode_chains(mode_new))),
      'observed_positions', '[]'::jsonb);
  cat := jsonb_build_object('geometry', geo);
  if code_new is distinct from code_old and code_new is not null then
    cat := cat || jsonb_build_object('tower_type', jsonb_build_object('value', code_new, 'status', 'single_source', 'raw', jsonb_build_object('listed', raw),
                 'sources', jsonb_build_object('config', code_new), 'listed_from', 'config_operation'));
  end if;
  return jsonb_build_object('change', case when mode_new is distinct from mode_old then 'geometry' else 'meta_only' end,
                            'meta', cat, 'comps_after', newcs, 'saved', to_jsonb(saved), 'from_mode', mode_old, 'to_mode', mode_new);
end $$;

-- the tower list the request would write: the client sends {num,type,chain_override,material_default}
create or replace function tower_cs.op_cfg_towers_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
declare e jsonb; seen text[] := '{}'::text[]; n text;
begin
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 1500 then return false; end if;
  for e in select jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'num') not in ('number', 'string') then return false; end if;
    n := e ->> 'num';
    if n is null or btrim(n) = '' or n = any (seen) then return false; end if;
    seen := array_append(seen, n);
  end loop;
  return true;
end $$;

create or replace function public.app_line_config_save(p_token text, p_op_id uuid, p_line_name text, p_config jsonb, p_mappings jsonb default '{}'::jsonb, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp set jit = off as $$
declare
  a jsonb := tower_cs.auth_check(p_token, array['admin', 'supervisor']); actor jsonb; hash text; prev tower_cs.config_request;
  circ integer; chain text; towers jsonb; old record; reg record; t record; e jsonb; plan jsonb; plans jsonb := '{}'::jsonb; refusals jsonb := '[]'::jsonb;
  st jsonb; newcs jsonb; newmeta jsonb; stt jsonb; commit_ jsonb; ops jsonb := '[]'::jsonb; res jsonb; opid uuid; cands text[]; n_changed int := 0;
  tn text; mapping jsonb; cur_ops int;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  actor := a -> 'user';
  if p_op_id is null or p_line_name is null or btrim(p_line_name) = '' or p_config is null or jsonb_typeof(p_config) <> 'object' then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  circ := tower_cs.safe_int(p_config -> 'circuit_count'); chain := p_config ->> 'chain_mode'; towers := coalesce(p_config -> 'towers', '[]'::jsonb);
  if circ is null or circ not in (1, 2) or chain not in ('single', 'double') or not tower_cs.op_cfg_towers_ok(towers) then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  if jsonb_typeof(coalesce(p_mappings, '{}'::jsonb)) <> 'object' then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  hash := md5(jsonb_build_object('l', p_line_name, 'c', p_config, 'm', coalesce(p_mappings, '{}'::jsonb))::text);
  select * into prev from tower_cs.config_request where op_id = p_op_id;
  if found then
    if prev.request_hash = hash then return prev.result || jsonb_build_object('idempotent', true); end if;
    return jsonb_build_object('ok', false, 'code', 'op_id_reused');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tower_cs.cfg:' || tower_cs.norm_line(p_line_name), 0));
  select * into prev from tower_cs.config_request where op_id = p_op_id;
  if found then
    if prev.request_hash = hash then return prev.result || jsonb_build_object('idempotent', true); end if;
    return jsonb_build_object('ok', false, 'code', 'op_id_reused');
  end if;
  cands := tower_cs.line_candidates(p_line_name);
  select * into old from public.line_towers_custom where line_name = p_line_name;
  select * into reg from tower_cs.ref_line r where r.line_name = any (cands) order by array_position(cands, r.line_name) limit 1;
  -- owner-confirmed circuits are never changed by a line edit; an explicit registry source is never contradicted
  if reg.line_name is not null and circ <> reg.circuits_registry and reg.circuits_basis in ('owner_confirmed_single', 'owner_confirmed_double', 'listed_double') then
    return jsonb_build_object('ok', false, 'code', case when reg.circuits_basis like 'owner_confirmed%' then 'owner_confirmed_circuits' else 'circuits_conflict_registry' end,
                              'registry', reg.circuits_registry, 'basis', reg.circuits_basis);
  end if;
  select count(*) into cur_ops from tower_cs.tower_alias al join tower_cs.tower_state s on s.tower_id = al.tower_id and s.rev > 0 where al.line_name = any (cands);
  if old.line_name is not null and old.circuit_count is distinct from circ and cur_ops > 0 then
    return jsonb_build_object('ok', false, 'code', 'circuit_count_change_blocked', 'migrated_towers', cur_ops);
  end if;
  -- plan every migrated tower of the line
  for t in select al.tower_id, al.tower_number from tower_cs.tower_alias al join tower_cs.tower_state s on s.tower_id = al.tower_id and s.rev > 0
            where al.line_name = any (cands) order by al.tower_number loop
    e := (select x from jsonb_array_elements(towers) x where x ->> 'num' = t.tower_number limit 1);
    if e is null then continue; end if;
    st := tower_cs.op_state_load(t.tower_id);
    mapping := coalesce(p_mappings -> t.tower_number, '{}'::jsonb);
    plan := tower_cs.op_cfg_plan(st, e, chain, mapping);
    if plan ->> 'change' = 'refused' then refusals := refusals || jsonb_build_array(plan - 'change' || jsonb_build_object('tower_number', t.tower_number));
    elsif plan ->> 'change' <> 'none' then plans := plans || jsonb_build_object(t.tower_number, plan || jsonb_build_object('tower_id', t.tower_id)); end if;
  end loop;
  if jsonb_array_length(refusals) > 0 then
    return jsonb_build_object('ok', false, 'code', case when exists (select 1 from jsonb_array_elements(refusals) r where r ->> 'code' = 'mapping_required') then 'mapping_required' else 'config_refused' end,
                              'towers', refusals);
  end if;
  -- apply: configuration row + one config operation per changed migrated tower, in this transaction
  insert into public.line_towers_custom(line_name, towers, circuit_count, chain_mode, updated_at) values (p_line_name, towers, circ, chain, now())
    on conflict (line_name) do update set towers = excluded.towers, circuit_count = excluded.circuit_count, chain_mode = excluded.chain_mode, updated_at = now();
  for tn in select jsonb_object_keys(plans) order by 1 loop
    plan := plans -> tn;
    perform pg_advisory_xact_lock(hashtextextended('tower_cs.op:' || (plan ->> 'tower_id'), 0));
    st := tower_cs.op_state_load((plan ->> 'tower_id')::uuid);
    newcs := coalesce(plan -> 'comps_after', st -> 'comps');
    newmeta := (st -> 'meta') || coalesce(plan -> 'meta', '{}'::jsonb);
    stt := tower_cs.op_status(newcs, coalesce(array(select jsonb_array_elements_text(st #> '{ts,reasons}')), '{}'::text[]) , (st #>> '{ts,src_id}') is not null);
    newmeta := tower_cs.op_meta_derive(newmeta, newcs, stt ->> 'status');
    opid := md5(p_op_id::text || ':' || tn)::uuid;
    res := (select o_result from tower_cs.op_commit((plan ->> 'tower_id')::uuid, st, opid, 'config', 'applied', (now() at time zone 'Asia/Baghdad')::date, actor, null, null, null, null,
        md5(hash || tn),
        coalesce(array(select k from jsonb_each(coalesce(plan -> 'comps_after', '{}'::jsonb)) j(k, v) where v is distinct from (st -> 'comps' -> k)), '{}'::text[]),
        coalesce(array(select k from jsonb_each(coalesce(plan -> 'comps_after', '{}'::jsonb)) j(k, v) where v is distinct from (st -> 'comps' -> k)), '{}'::text[]),
        '{}'::jsonb,
        jsonb_build_object('comps', coalesce((select jsonb_object_agg(k, tower_cs.op_norm_row(v)) from jsonb_each(coalesce(plan -> 'comps_after', '{}'::jsonb)) j(k, v)
                                               where v is distinct from (st -> 'comps' -> k)), '{}'::jsonb),
                           'ts', jsonb_build_object('status', stt ->> 'status', 'reasons', stt -> 'reasons'),
                           'meta', newmeta - 'rev'),
        jsonb_build_object('comps', coalesce((select jsonb_object_agg(k, st -> 'comps' -> k) from jsonb_each(coalesce(plan -> 'comps_after', '{}'::jsonb)) j(k, v)
                                               where v is distinct from (st -> 'comps' -> k)), '{}'::jsonb),
                           'meta', jsonb_build_object('geometry', st #> '{meta,geometry}', 'tower_type', st #> '{meta,tower_type}', 'prefill_blockers', st #> '{meta,prefill_blockers}',
                                                      'prefill_ready', st #> '{meta,prefill_ready}', 'materials', st #> '{meta,materials}'),
                           'ts', jsonb_build_object('status', st #> '{ts,status}', 'reasons', st #> '{ts,reasons}')),
        coalesce(p_reason, 'config'), jsonb_build_object('from_mode', plan -> 'from_mode', 'to_mode', plan -> 'to_mode', 'change', plan -> 'change')));
    ops := ops || jsonb_build_array(jsonb_build_object('tower_number', tn, 'op_id', opid, 'rev', res -> 'rev', 'change', plan -> 'change', 'from_mode', plan -> 'from_mode', 'to_mode', plan -> 'to_mode'));
    n_changed := n_changed + 1;
  end loop;
  res := jsonb_build_object('ok', true, 'line_name', p_line_name, 'changed_towers', n_changed, 'ops', ops);
  insert into tower_cs.config_request(op_id, line_name, request_hash, result, actor_user_id, actor_name) values (p_op_id, p_line_name, hash, res, actor ->> 'id', actor ->> 'full_name');
  return res;
exception when others then
  declare m text; begin
    get stacked diagnostics m = message_text;
    return jsonb_build_object('ok', false, 'code', 'server_error') || case when current_setting('tower_cs.debug', true) = 'on' then jsonb_build_object('debug', m) else '{}'::jsonb end;
  end;
end $$;

-- deleting a line's configuration row: refused while the line has migrated towers (their stored geometry would silently diverge from configuration)
create or replace function public.app_line_config_delete(p_token text, p_line_name text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token, array['admin']); n int; cands text[];
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if p_line_name is null or btrim(p_line_name) = '' then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  cands := tower_cs.line_candidates(p_line_name);
  select count(*) into n from tower_cs.tower_alias al join tower_cs.tower_state s on s.tower_id = al.tower_id and s.rev > 0 where al.line_name = any (cands);
  if n > 0 then return jsonb_build_object('ok', false, 'code', 'line_has_operation_state', 'migrated_towers', n); end if;
  delete from public.line_towers_custom where line_name = p_line_name;
  return jsonb_build_object('ok', true, 'deleted', found);
end $$;


-- ===== B. 23e_ops_backup =====
-- =====================================================================
-- 23e_ops_backup.sql : administrator backup of the authoritative operations / state / identity data (read-only, paged, no secrets).
--   * session tokens (tower_cs.app_session) and credential material are NEVER exported (not in the whitelist);
--   * every page carries a snapshot marker; the client compares markers across pages and refuses a backup taken while data changed;
--   * app_ops_status tells the client whether direct restore of the ops-managed public tables is allowed.
-- =====================================================================
create or replace function tower_cs.op_backup_parts() returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'run', 'run_id', 'tower', 'tower_id', 'tower_alias', 'alias_id', 'baseline', 'tower_id, inspection_id', 'tower_state', 'tower_id',
    'component_state', 'tower_id, component', 'tower_meta', 'tower_id', 'op', 'tower_id, rev', 'config_request', 'op_id', 'op_repair_log', 'id',
    'ref_source', 'source_id', 'ref_line', 'line_name', 'ref_tower', 'line_name, tower_number') $$;

create or replace function tower_cs.op_snapshot_marker() returns jsonb
language sql stable set search_path = pg_catalog as $$
  select jsonb_build_object('ops', (select count(*) from tower_cs.op), 'towers', (select count(*) from tower_cs.tower_state),
         'rev_sum', (select coalesce(sum(rev), 0) from tower_cs.tower_state), 'components', (select count(*) from tower_cs.component_state),
         'repairs', (select count(*) from tower_cs.op_repair_log), 'configs', (select count(*) from tower_cs.config_request)) $$;

create or replace function public.app_ops_backup(p_token text, p_part text default null, p_offset integer default 0, p_limit integer default 500) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token, array['admin']); parts jsonb := tower_cs.op_backup_parts(); ord text; rows jsonb; total bigint; lim int;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if p_part is null then
    return jsonb_build_object('ok', true, 'parts', (select jsonb_agg(k order by k) from jsonb_object_keys(parts) k), 'snapshot', tower_cs.op_snapshot_marker(),
                              'format', 1, 'excluded', jsonb_build_array('tower_cs.app_session', 'tower_cs.cutover_acl', 'credentials'));
  end if;
  ord := parts ->> p_part;
  if ord is null then return jsonb_build_object('ok', false, 'code', 'unknown_part'); end if;
  lim := greatest(1, least(coalesce(p_limit, 500), 1000));
  if p_offset is null or p_offset < 0 then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  execute format('select count(*) from tower_cs.%I', p_part) into total;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from tower_cs.%I order by %s offset %s limit %s) t', p_part, ord, p_offset, lim) into rows;
  return jsonb_build_object('ok', true, 'part', p_part, 'offset', p_offset, 'rows', rows, 'total', total,
    'next_offset', case when p_offset + lim < total then p_offset + lim end, 'snapshot', tower_cs.op_snapshot_marker());
end $$;

-- lockdown status for the client (restore guard); any signed-in user may ask
create or replace function public.app_ops_status(p_token text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token);
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  return jsonb_build_object('ok', true, 'ops_layer', true, 'lockdown', exists (select 1 from tower_cs.ops_state where lockdown_at is not null and rolled_back_at is null),
                            'towers', (select count(*) from tower_cs.tower_state where rev > 0));
end $$;


-- ===== B. 24_ops_grants =====
-- =====================================================================
-- 24_ops_grants.sql : API roles may call ONLY the public.app_* entry points; everything in tower_cs stays private. Idempotent.
-- =====================================================================
do $$
declare f text; r text; t record;
begin
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'tower_cs'::regnamespace and (p.proname like 'op\_%' or p.proname like 'live\_%' or p.proname like 'rc\_%') loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon, authenticated', f);
  end loop;
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in
           ('app_op_apply', 'app_op_marks', 'app_ops_list', 'app_ops_verify', 'app_ops_repair', 'app_line_config_save', 'app_line_config_delete', 'app_ops_backup', 'app_ops_status') loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema tower_cs from %I', r);
      execute format('revoke all on all functions in schema tower_cs from %I', r);
    end if;
  end loop;
  execute 'revoke all on all tables in schema tower_cs from public';
  execute 'revoke all on all functions in schema tower_cs from public';
  for t in select quote_ident(schemaname) || '.' || quote_ident(tablename) as q from pg_tables where schemaname = 'tower_cs' loop
    execute 'alter table ' || t.q || ' enable row level security';
  end loop;
end $$;


-- ===== C. users cutover =====
-- =====================================================================
-- 02_users_cutover.sql  (STEP 2 of 2 - run ONLY after the new app is deployed and every user has logged in once through it)
--
-- Closes direct API access to credentials and roles:
--   * public.users : ALL privileges revoked from PUBLIC / anon / authenticated, TABLE-level AND COLUMN-level (no read of password / password_hash / role, no INSERT/UPDATE/DELETE); effective access is verified before commit
--   * public.verify_login / public.set_user_password (every overload) : EXECUTE revoked from PUBLIC / anon / authenticated
--     (the NULL-actor bypass in set_user_password therefore cannot be reached; the replacements are public.app_* with explicit NULL rejection)
-- Nothing is deleted or rewritten: the old password column / hashes stay as they are; the previous ACLs are saved (tower_cs.cutover_acl) so that
-- 90_rollback_cutover.sql restores them exactly.
--
-- Refuses (raises, changes nothing) when:
--   * step 1 is not installed;
--   * any ACTIVE account lacks a usable bcrypt hash (fix each one with the owner-only recovery function, see README - there is no bypass);
--   * there is no active admin with a usable hash;
--   * another object in public (policy / security-invoker view / invoker function) depends on public.users and would break.
-- =====================================================================
do $cut$
declare n_bad int; names text; n_admin int; deps text; f record; r record;
begin
  if to_regprocedure('public.app_login(text,text)') is null or to_regclass('tower_cs.app_session') is null then
    raise exception 'cutover refused: step 1 (01_install_bridge_and_live.sql) is not installed';
  end if;
  if exists (select 1 from tower_cs.cutover_state where rolled_back_at is null) then
    raise notice 'cutover already applied: nothing to do'; return;
  end if;

  select count(*), string_agg(username, ', ' order by username) into n_bad, names
    from public.users where coalesce(is_active, false) and not tower_cs.hash_usable(password_hash);
  if n_bad > 0 then
    raise exception 'cutover refused: % active account(s) have no usable bcrypt password hash: %. Set each with: select tower_cs.admin_set_password(''<username>'', ''<new password, 8+ chars>'');  (owner-only recovery function; no data is changed by this refusal)', n_bad, names;
  end if;
  select count(*) into n_admin from public.users where role = 'admin' and coalesce(is_active, false) and tower_cs.hash_usable(password_hash);
  if n_admin < 1 then raise exception 'cutover refused: no active admin account with a usable password hash'; end if;

  select string_agg(x, '; ') into deps from (
    select 'policy ' || tablename || '.' || policyname as x from pg_policies
     where schemaname = 'public' and tablename <> 'users' and (coalesce(qual, '') ~* '\yusers\y' or coalesce(with_check, '') ~* '\yusers\y')
    union all
    select 'view ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v' and c.relname <> 'users'
       and coalesce(c.reloptions, '{}'::text[]) @> array['security_invoker=true'] and pg_get_viewdef(c.oid) ~* '\yusers\y'
    union all
    select 'function ' || p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace and not p.prosecdef and p.proname not like 'app\_%' and p.prokind = 'f'
       and p.prosrc ~* '\yusers\y' and p.proname not in ('verify_login', 'set_user_password')) d;
  if deps is not null then
    raise exception 'cutover refused: objects that read public.users as the calling API role would break: %. Review them first (00_readiness_readonly.sql)', deps;
  end if;

  -- save the previous ACLs exactly (table, columns, functions)
  delete from tower_cs.cutover_acl;
  insert into tower_cs.cutover_acl(kind, object, col, grantee, privilege, grantable)
    select 'table', 'public.users', null, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type, a.is_grantable
      from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where c.oid = 'public.users'::regclass and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'));
  insert into tower_cs.cutover_acl(kind, object, col, grantee, privilege, grantable)
    select 'column', 'public.users', t.attname, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type, a.is_grantable
      from pg_attribute t cross join lateral aclexplode(t.attacl) a
     where t.attrelid = 'public.users'::regclass and t.attacl is not null and not t.attisdropped and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'));
  insert into tower_cs.cutover_acl(kind, object, col, grantee, privilege, grantable)
    select 'function', p.oid::regprocedure::text, null, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type, a.is_grantable
      from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.pronamespace = 'public'::regnamespace and p.proname in ('verify_login', 'set_user_password') and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'));

  execute 'revoke all on table public.users from public';
  for r in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
    execute format('revoke all on table public.users from %I', r.rolname);
  end loop;
  -- v335-C2: a table-level REVOKE does NOT remove column-level grants. Revoke every column privilege explicitly (saved above, restored exactly by 90).
  for f in select a.attname as col from pg_attribute a where a.attrelid = 'public.users'::regclass and a.attnum > 0 and not a.attisdropped loop
    execute format('revoke all (%I) on table public.users from public', f.col);
    for r in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
      execute format('revoke all (%I) on table public.users from %I', f.col, r.rolname);
    end loop;
  end loop;
  -- prove it with EFFECTIVE privileges (includes inherited/role-membership grants); any survivor aborts the whole cutover (nothing is changed)
  select string_agg(x, ', ') into deps from (
    select ro.rolname || '.' || a.attname || ':' || p.priv as x
      from pg_roles ro cross join pg_attribute a cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(priv)
     where ro.rolname in ('anon', 'authenticated') and a.attrelid = 'public.users'::regclass and a.attnum > 0 and not a.attisdropped
       and (has_column_privilege(ro.rolname, 'public.users'::regclass, a.attnum, p.priv) or has_table_privilege(ro.rolname, 'public.users'::regclass, p.priv))
    union all
    select 'PUBLIC.' || a.attname || ':' || x.privilege_type
      from pg_attribute a cross join lateral aclexplode(a.attacl) x
     where a.attrelid = 'public.users'::regclass and a.attacl is not null and a.attnum > 0 and not a.attisdropped and x.grantee = 0
    union all
    select 'PUBLIC.<table>:' || x.privilege_type from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
     where c.oid = 'public.users'::regclass and x.grantee = 0) s;
  if deps is not null then
    raise exception 'cutover aborted (nothing changed): API roles still have effective access to public.users after the revoke: % (probably inherited from a role they are a member of - review it by hand)', deps;
  end if;
  for f in select p.oid::regprocedure::text as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('verify_login', 'set_user_password') loop
    execute format('revoke all on function %s from public', f.sig);
    for r in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
      execute format('revoke all on function %s from %I', f.sig, r.rolname);
    end loop;
  end loop;
  -- every session issued before the cutover keeps working (they are server sessions); nothing else changes
  delete from tower_cs.cutover_state;
  insert into tower_cs.cutover_state(applied_at) values (now());
end $cut$;

notify pgrst, 'reload schema';


-- ===== D. direct-write lockdown =====
-- =====================================================================
-- 30_ops_lockdown.sql : after the application writes ONLY through public.app_op_apply / app_line_config_save / app_line_config_delete,
-- direct API writes to the three source tables are closed. Idempotent. Reads (SELECT) stay open: history views / grids / reports read them.
--   public.inspections, public.treatments, public.line_towers_custom : INSERT / UPDATE / DELETE / TRUNCATE revoked from PUBLIC, anon, authenticated,
--   permissive "open_all" policies replaced by a SELECT-only policy. The previous ACL and policies are saved (tower_cs.ops_acl / ops_policy)
--   so 92_rollback_lockdown.sql restores them exactly. The server (SECURITY DEFINER owner) and the owner SQL editor are unaffected: administrator
--   recovery = run 92 (or the owner-only tower_cs.admin_ops_lockdown_rollback()).
-- Remaining, UNRELATED legacy-table security work is NOT done here (see README: memos, daily_reports, emergency_departures, inventory_*, thermal_*,
-- line_entry_thermal, lines_info, staff_roster_*, work_telegrams still have open_all policies).
-- =====================================================================
do $lock$
declare tbl text; r record; role_name text; priv text;
begin
  if to_regprocedure('public.app_op_apply(text,jsonb)') is null or to_regprocedure('public.app_line_config_save(text,uuid,text,jsonb,jsonb,text)') is null then
    raise exception 'lockdown refused: operations layer (20-24) is not installed';
  end if;
  if exists (select 1 from tower_cs.ops_state where lockdown_at is not null and rolled_back_at is null) then raise notice 'lockdown already applied'; return; end if;
  delete from tower_cs.ops_acl; delete from tower_cs.ops_policy;
  foreach tbl in array array['inspections', 'treatments', 'line_towers_custom'] loop
    if to_regclass('public.' || tbl) is null then raise exception 'lockdown refused: public.% does not exist', tbl; end if;
    insert into tower_cs.ops_acl(kind, object, col, grantee, privilege, grantable)
      select 'table', 'public.' || tbl, null, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type, a.is_grantable
        from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.oid = ('public.' || tbl)::regclass and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'));
    insert into tower_cs.ops_policy(tbl, policyname, definition)
      select p.tablename, p.policyname, format('create policy %I on public.%I as %s for %s to %s using (%s)%s', p.policyname, p.tablename, p.permissive, p.cmd,
             array_to_string(p.roles, ', '), coalesce(p.qual, 'true'), case when p.with_check is not null then ' with check (' || p.with_check || ')' else '' end)
        from pg_policies p where p.schemaname = 'public' and p.tablename = tbl;
    for r in select policyname from pg_policies where schemaname = 'public' and tablename = tbl loop
      execute format('drop policy %I on public.%I', r.policyname, tbl);
    end loop;
    execute format('alter table public.%I enable row level security', tbl);
    execute format('create policy ops_read_only on public.%I for select to public using (true)', tbl);
    foreach priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      execute format('revoke %s on public.%I from public', priv, tbl);
      foreach role_name in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = role_name) then execute format('revoke %s on public.%I from %I', priv, tbl, role_name); end if;
      end loop;
    end loop;
  end loop;
  delete from tower_cs.ops_state;
  insert into tower_cs.ops_state(applied_at, lockdown_at) values (now(), now());
end $lock$;
notify pgrst, 'reload schema';


-- ===== E. data access API (C5) =====
-- =====================================================================
-- 40_data_access.sql : v335-C5 server-side access to the legacy data tables (candidate, local only).
--   Session-validated, registry-driven API. The client never names SQL, a function, a role or an actor:
--     public.app_data_read    (p_token, p_table, p_select, p_filters, p_order, p_limit, p_offset)
--     public.app_data_write   (p_token, p_table, p_action, p_rows, p_filters, p_patch, p_returning)   action = insert | insert_ignore | update | delete
--     public.app_lines_info_replace (p_token, p_rows, p_expected_version)   one validated transaction (admin); compare-and-swap on the version returned by
--     public.app_lines_info_read (p_token)                 the authoritative rows + version (admin)
--     public.app_data_backup  (p_token, p_table, p_offset, p_limit)   admin only
--     public.app_data_restore (p_token, p_table, p_rows)              admin only, merge by primary key
--   Every call: tower_cs.auth_check (token exists / not revoked / not expired / account active / not locked, role re-read from public.users) -> fixed
--   registry row (table, action, role list, inventory gate) -> identifiers validated against the registry AND the catalog -> values are quoted literals
--   cast to the catalog type (no string concatenation of client text, no arbitrary table/column/function).
--   Update / delete must carry an equality filter on a registered key column (no mass update / delete). Page size is bounded (max_page).
--   This file only ADDS objects. Nothing is revoked here: 41_data_lockdown.sql closes the direct paths AFTER the client uses this API.
-- =====================================================================
do $pre$
begin
  if to_regprocedure('tower_cs.auth_check(text,text[])') is null then raise exception 'data access refused: the session bridge (tower_cs.auth_check) is not installed'; end if;
end $pre$;

create table if not exists tower_cs.data_reg (
  tbl          text primary key,
  kind         text not null check (kind in ('table', 'view')),
  read_roles   text[] not null default '{}',
  ins_roles    text[] not null default '{}',
  upd_roles    text[] not null default '{}',
  del_roles    text[] not null default '{}',
  inv_gate     boolean not null default false,        -- insert/update additionally need role admin, or (not readonly AND users.can_manage_inventory)
  write_cols   text[] not null default '{}',          -- the ONLY columns a client may send (id / created_at / server fields are never writable)
  key_cols     text[] not null default '{}',          -- update / delete must carry eq on one of these
  filter_cols  text[] not null default '{}',
  order_cols   text[] not null default '{}',
  tie_col      text,                                  -- appended to every ORDER BY (stable pages) and used for backup order
  actor_cols   text[] not null default '{}',          -- on UPDATE these are overwritten with the verified session user's name
  conflict_col text,                                  -- insert_ignore target (needs a unique index)
  backup       boolean not null default true,
  restore      boolean not null default false,
  max_page     int not null default 1000 check (max_page between 1 and 1000)
);
alter table tower_cs.data_reg enable row level security;

-- ---- the fixed registry (re-runnable: replaced as a whole) ------------------------------------------------------
do $reg$
declare
  ALL_ text[] := array['admin','supervisor','technician','readonly'];
  FLD  text[] := array['admin','supervisor','technician'];
  ASU  text[] := array['admin','supervisor'];
  ASR  text[] := array['admin','supervisor','readonly'];
  ADM  text[] := array['admin'];
  NONE text[] := '{}';
begin
  delete from tower_cs.data_reg;
  insert into tower_cs.data_reg (tbl, kind, read_roles, ins_roles, upd_roles, del_roles, inv_gate, write_cols, key_cols, filter_cols, order_cols, tie_col, actor_cols, conflict_col, backup, restore) values
  -- unified-state sources: READ only here (their writes are the server-owned operations layer)
  ('latest_inspections','view',  ALL_, NONE, NONE, NONE, false, '{}', '{}', '{line_name}', '{id,created_at,inspection_date,line_name,tower_number}', 'id', '{}', null, false, false),
  ('inspections',        'table', ALL_, NONE, NONE, NONE, false, '{}', '{}', '{id,line_name,tower_number,inspection_date,created_at}', '{created_at,inspection_date,id,line_name,tower_number}', 'id', '{}', null, true, false),
  ('treatments',         'table', ALL_, NONE, NONE, NONE, false, '{}', '{}', '{id,inspection_id,line_name,tower_number,treatment_date,created_at}', '{created_at,treatment_date,id}', 'id', '{}', null, true, false),
  ('line_towers_custom', 'table', ALL_, NONE, NONE, NONE, false, '{}', '{}', '{line_name}', '{line_name}', 'line_name', '{}', null, true, false),
  -- thermal (field workflow: create by field roles; delete admin only)
  ('thermal_inspections','table', ALL_, FLD, NONE, ADM, false,
     '{line_name,inspection_date,ambient_temp,point_type,point_label,tower_number,r1,r2,s1,s2,t1,t2,max_temp,created_by_name,client_uuid}', '{id}',
     '{id,line_name,point_type,inspection_date,created_at,tower_number}', '{inspection_date,line_name,created_at,id}', 'id', '{}', 'client_uuid', true, true),
  ('line_entry_thermal', 'table', ALL_, FLD, NONE, NONE, false,
     '{line_name,inspection_date,ambient_temp,station_side,r_landing,r_wt_in,r_wt_out,r_busbar,s_landing,s_wt_in,s_wt_out,s_busbar,t_landing,t_wt_in,t_wt_out,t_busbar,max_temp,created_by_name,client_uuid}', '{}',
     '{line_name,inspection_date,created_at}', '{created_at,inspection_date}', 'created_at', '{}', 'client_uuid', true, true),
  ('thermal_official_forms','table', ALL_, FLD, FLD, ADM, false,
     '{line_name,wire_type,inspection_date,inspection_time,ambient_temp,rows,created_by,client_uuid}', '{id}',
     '{id,client_uuid}', '{inspection_date,id}', 'id', '{created_by}', 'client_uuid', true, true),
  ('emergency_departures','table', ALL_, FLD, FLD, ADM, false,
     '{line_name,tower_number,departure_type,details,status,treated_by,treatment_date,created_by,client_uuid}', '{id}',
     '{id,created_at,treatment_date}', '{created_at,id}', 'id', '{created_by,treated_by}', 'client_uuid', true, true),
  ('work_telegrams',     'table', ALL_, FLD, FLD, ADM, false,
     '{line_name,outage_from,outage_to,work_type,notes,status,created_by,client_uuid,work_order_no,work_order_date}', '{id}',
     '{id,line_name,status,created_at}', '{created_at,id}', 'id', '{created_by}', 'client_uuid', true, true),
  -- forms: admin / supervisor write (technician cannot reach them in the UI), readonly may read; delete admin only
  ('memos',              'table', ASR, ASU, ASU, ADM, false,
     '{memo_number,memo_date,memo_to,subject,content,sender_title,sender_name,table_data,attachments,created_by,client_uuid}', '{id}',
     '{id}', '{memo_date,created_at,id}', 'id', '{created_by}', 'client_uuid', true, true),
  ('daily_reports',      'table', ASU, ASU, ASU, ADM, false,
     '{report_date,rows,created_by,client_uuid}', '{id}',
     '{id,report_date}', '{report_date,created_at,id}', 'id', '{created_by}', 'client_uuid', true, true),
  ('work_orders',        'table', ASR, ASU, ASU, ADM, false,
     '{work_date,line_name,work_type,driver_name,driver_car,team_members,shared_members,created_by,client_uuid,updated_at}', '{id}',
     '{id,work_date,line_name,driver_name,client_uuid}', '{work_date,id}', 'id', '{created_by}', 'client_uuid', true, true),
  ('work_order_drivers', 'table', ASR, NONE, NONE, NONE, false, '{}', '{}', '{}', '{sort_order,id}', 'id', '{}', null, true, true),
  -- v335-C5r3: borrowed_qty is NOT client-writable and inventory_borrowed has no direct ins/upd: both change only through app_inventory_borrow / app_inventory_return (42_data_txn.sql)
  -- inventory: read all; write = admin OR (not readonly AND can_manage_inventory); delete admin only (borrowed rows are never deleted by the app)
  ('inventory_tools',    'table', ALL_, FLD, FLD, ADM, true,
     '{name,size,qty_working,qty_broken,storage_location,notes,client_uuid}', '{id}',
     '{id}', '{name,created_at,id}', 'id', '{}', 'client_uuid', true, true),
  ('inventory_materials','table', ALL_, FLD, FLD, ADM, true,
     '{name,voltage,type_size,qty,unit,storage_location,notes,client_uuid}', '{id}',
     '{id}', '{name,created_at,id}', 'id', '{}', 'client_uuid', true, true),
  ('inventory_borrowed', 'table', ALL_, NONE, NONE, NONE, true,
     '{tool_id,tool_name,qty,borrow_date,borrower_name,returned,return_date,client_uuid}', '{id}',
     '{id}', '{created_at,id}', 'id', '{}', 'client_uuid', true, true),
  -- staff roster / lines info: read all, manage admin only; member CREATION only through app_roster_member_create (idempotent op id, 42_data_txn.sql)
  ('staff_roster_members','table', ALL_, NONE, ADM, ADM, false, '{name,values}', '{id}', '{id}', '{id}', 'id', '{}', null, true, true),
  ('staff_roster_columns','table', ALL_, ADM, NONE, ADM, false, '{key,label,sort_order}', '{key}', '{key}', '{sort_order}', 'key', '{}', null, true, true),
  ('lines_info',         'table', ALL_, NONE, NONE, NONE, false, '{}', '{}', '{idx}', '{idx}', 'idx', '{}', null, true, true);
end $reg$;

-- ---- catalog consistency (install preflight; also callable by the verifier) -----------------------------------------
create or replace function tower_cs.data_schema_check() returns text
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
declare r tower_cs.data_reg; c text; bad text := ''; rel regclass; kind "char";
begin
  for r in select * from tower_cs.data_reg order by tbl loop
    rel := to_regclass('public.' || quote_ident(r.tbl));
    if rel is null then bad := bad || format('%s: relation missing; ', r.tbl); continue; end if;
    select relkind into kind from pg_class where oid = rel;
    if (r.kind = 'view' and kind not in ('v', 'm')) or (r.kind = 'table' and kind not in ('r', 'p')) then bad := bad || format('%s: kind mismatch (%s); ', r.tbl, kind); end if;
    for c in select distinct x from unnest(r.write_cols || r.key_cols || r.filter_cols || r.order_cols || r.actor_cols || array[r.tie_col] || array[r.conflict_col]) x where x is not null loop
      if not exists (select 1 from pg_attribute a where a.attrelid = rel and a.attname = c and a.attnum > 0 and not a.attisdropped) then bad := bad || format('%s.%s: column missing; ', r.tbl, c); end if;
    end loop;
    if r.conflict_col is not null and r.kind = 'table' and not exists (
         select 1 from pg_index i where i.indrelid = rel and i.indisunique and i.indpred is null and i.indnatts = 1
            and (select attname from pg_attribute where attrelid = rel and attnum = i.indkey[0]) = r.conflict_col) then
      bad := bad || format('%s.%s: no plain unique index (insert_ignore would fail); ', r.tbl, r.conflict_col);
    end if;
  end loop;
  return nullif(bad, '');
end $$;

-- ---- authorisation: ONE function, used by every entry point ------------------------------------------------------
-- p_op: read | ins | upd | del | backup | restore.  Returns {ok:true,user:{..}} or {ok:false,code}.
create or replace function tower_cs.data_auth(p_token text, p_table text, p_op text) returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare a jsonb; r tower_cs.data_reg; role_ text; roles_ text[]; inv boolean;
begin
  a := tower_cs.auth_check(p_token, null);
  if not (a ->> 'ok')::boolean then return a; end if;
  select * into r from tower_cs.data_reg where tbl = p_table;
  if not found then return jsonb_build_object('ok', false, 'code', 'bad_table'); end if;
  role_ := a -> 'user' ->> 'role';
  roles_ := case p_op when 'read' then r.read_roles when 'ins' then r.ins_roles when 'upd' then r.upd_roles when 'del' then r.del_roles
                      when 'backup' then case when r.backup then array['admin'] else '{}'::text[] end
                      when 'restore' then case when r.restore then array['admin'] else '{}'::text[] end
                      else '{}'::text[] end;
  if role_ is null or role_ <> all (roles_) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if r.inv_gate and p_op in ('ins', 'upd') and role_ <> 'admin' then
    inv := coalesce((a -> 'user' ->> 'can_manage_inventory')::boolean, false);
    if not inv or role_ = 'readonly' then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  end if;
  return a;
end $$;

-- ---- helpers ---------------------------------------------------------------------------------------------------
create or replace function tower_cs.data_coltype(p_tbl text, p_col text) returns text
language sql stable set search_path = pg_catalog, pg_temp as $$
  select format_type(a.atttypid, a.atttypmod) from pg_attribute a
   where a.attrelid = to_regclass('public.' || quote_ident(p_tbl)) and a.attname = p_col and a.attnum > 0 and not a.attisdropped $$;

-- builds the WHERE text from [{c,o,v}]; every column must be registered; the value is a quoted literal cast to the catalog type
create or replace function tower_cs.data_where(r tower_cs.data_reg, p_filters jsonb, p_need_key boolean) returns text
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
declare f jsonb; col text; op text; val text; typ text; sql_ text := ''; has_key boolean := false; n int := 0;
begin
  if p_filters is null or jsonb_typeof(p_filters) <> 'array' then raise exception 'bad_filter' using errcode = 'P0001'; end if;
  for f in select * from jsonb_array_elements(p_filters) loop
    n := n + 1; if n > 8 then raise exception 'bad_filter' using errcode = 'P0001'; end if;
    if jsonb_typeof(f) <> 'object' or jsonb_typeof(f -> 'v') not in ('string', 'number', 'boolean') then raise exception 'bad_filter' using errcode = 'P0001'; end if;
    col := f ->> 'c'; op := f ->> 'o'; val := f ->> 'v';
    if col is null or col <> all (r.filter_cols) or op is null or op <> all (array['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike']) or length(val) > 200 then raise exception 'bad_filter' using errcode = 'P0001'; end if;
    typ := tower_cs.data_coltype(r.tbl, col);
    if typ is null then raise exception 'bad_filter' using errcode = 'P0001'; end if;
    if op = 'ilike' then
      sql_ := sql_ || case when sql_ = '' then '' else ' and ' end || format('%I::text ilike %L', col, replace(val, '*', '%'));
    else
      sql_ := sql_ || case when sql_ = '' then '' else ' and ' end ||
              format('%I %s %L::%s', col, case op when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>' when 'gte' then '>=' when 'lt' then '<' else '<=' end, val, typ);
    end if;
    if op = 'eq' and col = any (r.key_cols) then has_key := true; end if;
  end loop;
  if p_need_key and not has_key then raise exception 'need_key' using errcode = 'P0001'; end if;
  return case when sql_ = '' then 'true' else sql_ end;
end $$;

create or replace function tower_cs.data_err(p_state text, p_msg text) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object('ok', false, 'code',
    case when p_msg in ('bad_filter', 'need_key', 'bad_column', 'bad_rows', 'bad_limit', 'bad_select', 'bad_order', 'bad_action', 'no_pk', 'too_many') then p_msg
         when p_state in ('22P02', '22007', '22008', '22003', '22023', '22001', '22P05', '42804', '22000') then 'invalid'
         when p_state = '23505' then 'conflict'
         when p_state in ('23502', '23514', '23503', '23000') then 'constraint'
         else 'failed' end, 'state', p_state) $$;

-- ---- READ ----------------------------------------------------------------------------------------------------------
create or replace function public.app_data_read(p_token text, p_table text, p_select jsonb default null, p_filters jsonb default '[]'::jsonb,
                                                p_order jsonb default '[]'::jsonb, p_limit int default null, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.data_auth(p_token, p_table, 'read'); r tower_cs.data_reg; rel regclass; cols text := ''; c text; ord text := ''; o jsonb; n int := 0;
        w text; lim int; rows_ jsonb; allcols text[]; sel_ jsonb;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  select * into r from tower_cs.data_reg where tbl = p_table;
  rel := to_regclass('public.' || quote_ident(p_table));
  select array_agg(attname::text order by attnum) into allcols from pg_attribute where attrelid = rel and attnum > 0 and not attisdropped;
  lim := coalesce(p_limit, r.max_page);
  if lim < 1 or lim > r.max_page or p_offset is null or p_offset < 0 or p_offset > 10000000 then return tower_cs.data_err('', 'bad_limit'); end if;
  if p_select is null or p_select = '["*"]'::jsonb then cols := '*';
  else
    if jsonb_typeof(p_select) <> 'array' or jsonb_array_length(p_select) < 1 or jsonb_array_length(p_select) > 80 then return tower_cs.data_err('', 'bad_select'); end if;
    for sel_ in select * from jsonb_array_elements(p_select) loop
      if jsonb_typeof(sel_) <> 'string' or (sel_ #>> '{}') <> all (allcols) then return tower_cs.data_err('', 'bad_select'); end if;
      cols := cols || case when cols = '' then '' else ', ' end || format('%I', sel_ #>> '{}');
    end loop;
  end if;
  if p_order is null or jsonb_typeof(p_order) <> 'array' or jsonb_array_length(p_order) > 4 then return tower_cs.data_err('', 'bad_order'); end if;
  for o in select * from jsonb_array_elements(p_order) loop
    if jsonb_typeof(o) <> 'object' or (o ->> 'c') is null or (o ->> 'c') <> all (r.order_cols) or coalesce(o ->> 'd', 'asc') not in ('asc', 'desc') then return tower_cs.data_err('', 'bad_order'); end if;
    ord := ord || case when ord = '' then '' else ', ' end || format('%I %s', o ->> 'c', coalesce(o ->> 'd', 'asc'));
  end loop;
  if r.tie_col is not null and not exists (select 1 from jsonb_array_elements(p_order) x where x ->> 'c' = r.tie_col) then
    ord := ord || case when ord = '' then '' else ', ' end || format('%I', r.tie_col);
  end if;
  begin
    w := tower_cs.data_where(r, p_filters, false);
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select %s from public.%I where %s %s limit %s offset %s) x',
                   cols, p_table, w, case when ord = '' then '' else 'order by ' || ord end, lim, p_offset) into rows_;
  exception when others then return tower_cs.data_err(sqlstate, sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'rows', rows_);
end $$;

-- ---- WRITE ---------------------------------------------------------------------------------------------------------
create or replace function public.app_data_write(p_token text, p_table text, p_action text, p_rows jsonb default null, p_filters jsonb default '[]'::jsonb,
                                                 p_patch jsonb default null, p_returning boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare op text; a jsonb; r tower_cs.data_reg; keys text[]; k text; cols text := ''; vals text := ''; w text; res jsonb; cnt int; row_ jsonb; setl text := ''; patch jsonb; uname text;
begin
  op := case p_action when 'insert' then 'ins' when 'insert_ignore' then 'ins' when 'update' then 'upd' when 'delete' then 'del' else null end;
  if op is null then return tower_cs.data_err('', 'bad_action'); end if;
  a := tower_cs.data_auth(p_token, p_table, op);
  if not (a ->> 'ok')::boolean then return a; end if;
  select * into r from tower_cs.data_reg where tbl = p_table;
  uname := a -> 'user' ->> 'full_name';
  begin
    if p_action in ('insert', 'insert_ignore') then
      if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 then return tower_cs.data_err('', 'bad_rows'); end if;
      if jsonb_array_length(p_rows) > 200 then return tower_cs.data_err('', 'too_many'); end if;
      if p_action = 'insert_ignore' and r.conflict_col is null then return tower_cs.data_err('', 'bad_action'); end if;
      select array_agg(distinct kk) into keys from jsonb_array_elements(p_rows) e cross join lateral jsonb_object_keys(case when jsonb_typeof(e) = 'object' then e else '{}'::jsonb end) kk;
      if exists (select 1 from jsonb_array_elements(p_rows) e where jsonb_typeof(e) <> 'object') then return tower_cs.data_err('', 'bad_rows'); end if;
      if keys is null then return tower_cs.data_err('', 'bad_rows'); end if;
      foreach k in array keys loop if k <> all (r.write_cols) then return tower_cs.data_err('', 'bad_column'); end if; end loop;
      select string_agg(format('%I', c), ', ' order by ord) into cols from unnest(r.write_cols) with ordinality t(c, ord) where c = any (keys);
      execute format('with ins as (insert into public.%I as t (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) %s returning to_jsonb(t) as j) select coalesce(jsonb_agg(j), ''[]''::jsonb) from ins',
                     p_table, cols, cols, p_table, case when p_action = 'insert_ignore' then format('on conflict (%I) do nothing', r.conflict_col) else '' end) using p_rows into res;
      return jsonb_build_object('ok', true, 'n', jsonb_array_length(res), 'rows', case when p_returning then res else '[]'::jsonb end);
    elsif p_action = 'update' then
      if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then return tower_cs.data_err('', 'bad_rows'); end if;
      patch := p_patch;
      for k in select jsonb_object_keys(patch) loop
        if k <> all (r.write_cols) or k = r.conflict_col then return tower_cs.data_err('', 'bad_column'); end if;
        if k = any (r.actor_cols) and jsonb_typeof(patch -> k) <> 'null' then patch := jsonb_set(patch, array[k], to_jsonb(uname)); end if;   -- actor from the session, never the client
      end loop;
      w := tower_cs.data_where(r, p_filters, true);
      select string_agg(format('%I = (jsonb_populate_record(null::public.%I, $1)).%I', k2, p_table, k2), ', ') into setl from jsonb_object_keys(patch) k2;
      execute format('with u as (update public.%I as t set %s where %s returning to_jsonb(t) as j) select coalesce(jsonb_agg(j), ''[]''::jsonb) from u', p_table, setl, w) using patch into res;
      return jsonb_build_object('ok', true, 'n', jsonb_array_length(res), 'rows', case when p_returning then res else '[]'::jsonb end);
    else
      w := tower_cs.data_where(r, p_filters, true);
      execute format('with d as (delete from public.%I where %s returning 1) select count(*) from d', p_table, w) into cnt;
      return jsonb_build_object('ok', true, 'n', cnt, 'rows', '[]'::jsonb);
    end if;
  exception when others then return tower_cs.data_err(sqlstate, sqlerrm);
  end;
end $$;

-- ---- lines_info: ONE validated transaction (the old client did DELETE-all then POST, so a failed second request emptied the table) -----------------
-- v335-C5r10: authoritative baseline + compare-and-swap. app_lines_info_read returns the rows AND a version (md5 of the canonical row list); app_lines_info_replace
-- takes the version the caller's baseline had: if the table changed meanwhile it answers {ok:false,code:'conflict'} and writes nothing. A NULL version keeps the
-- previous (unconditional) behaviour for older clients; the current client always sends it. The table is locked (readers allowed) from the check to the commit.
drop function if exists public.app_lines_info_replace(text, jsonb);
create or replace function public.app_lines_info_read(p_token text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token, array['admin']); rows_ jsonb;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.idx), '[]'::jsonb) into rows_ from public.lines_info t;
  return jsonb_build_object('ok', true, 'rows', rows_, 'version', md5(rows_::text));
end $$;
create or replace function public.app_lines_info_replace(p_token text, p_rows jsonb, p_expected_version text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.auth_check(p_token, array['admin']); e jsonb; k text; n int; cur_ jsonb; allowed text[] := array['idx','voltage','name','length','towers','tension_towers','phase_swap','capacity','wire_type','ground_wire','responsibility','year','status','notes'];
        cols text; before_n int;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return tower_cs.data_err('', 'bad_rows'); end if;
  n := jsonb_array_length(p_rows);
  if n < 1 then return jsonb_build_object('ok', false, 'code', 'empty_refused'); end if;      -- never empties the table
  if n > 300 then return tower_cs.data_err('', 'too_many'); end if;
  for e in select * from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(e) <> 'object' then return tower_cs.data_err('', 'bad_rows'); end if;
    for k in select jsonb_object_keys(e) loop if k <> all (allowed) then return tower_cs.data_err('', 'bad_column'); end if; end loop;
    if jsonb_typeof(e -> 'idx') <> 'number' or (e ->> 'idx') !~ '^[0-9]{1,6}$' then return tower_cs.data_err('', 'bad_rows'); end if;
    if jsonb_typeof(e -> 'name') <> 'string' or btrim(e ->> 'name') = '' then return tower_cs.data_err('', 'bad_rows'); end if;
  end loop;
  if (select count(distinct (x ->> 'idx')) from jsonb_array_elements(p_rows) x) <> n then return tower_cs.data_err('', 'bad_rows'); end if;
  select string_agg(format('%I', c), ', ') into cols from unnest(allowed) c;
  begin
    lock table public.lines_info in share row exclusive mode;
    if p_expected_version is not null then
      select coalesce(jsonb_agg(to_jsonb(t) order by t.idx), '[]'::jsonb) into cur_ from public.lines_info t;
      if md5(cur_::text) <> p_expected_version then return jsonb_build_object('ok', false, 'code', 'conflict'); end if;
    end if;
    select count(*) into before_n from public.lines_info;
    delete from public.lines_info where true;
    execute format('insert into public.lines_info (%s) select %s from jsonb_populate_recordset(null::public.lines_info, $1)', cols, cols) using p_rows;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.idx), '[]'::jsonb) into cur_ from public.lines_info t;
    return jsonb_build_object('ok', true, 'n', n, 'replaced', before_n, 'version', md5(cur_::text));
  exception when others then
    return tower_cs.data_err(sqlstate, sqlerrm);        -- the inner block is rolled back: the original rows are untouched
  end;
end $$;

-- ---- BACKUP (admin only; fixed tables, bounded pages, stable order) ---------------------------------------------------------
create or replace function public.app_data_backup(p_token text, p_table text, p_offset int default 0, p_limit int default 500) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.data_auth(p_token, p_table, 'backup'); r tower_cs.data_reg; rows_ jsonb; total bigint;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  select * into r from tower_cs.data_reg where tbl = p_table;
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit < 1 or p_limit > 500 then return tower_cs.data_err('', 'bad_limit'); end if;
  execute format('select count(*) from public.%I', p_table) into total;
  execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select * from public.%I order by %I limit %s offset %s) x', p_table, r.tie_col, p_limit, p_offset) into rows_;
  return jsonb_build_object('ok', true, 'rows', rows_, 'total', total);
end $$;

-- ---- RESTORE (admin only; merge by primary key; the operations-layer tables are not restorable here) ------------------------------
create or replace function public.app_data_restore(p_token text, p_table text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb := tower_cs.data_auth(p_token, p_table, 'restore'); rel regclass; allcols text[]; pk text[]; keys text[]; k text; cols text; sets text; res int;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 then return tower_cs.data_err('', 'bad_rows'); end if;
  if jsonb_array_length(p_rows) > 500 then return tower_cs.data_err('', 'too_many'); end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e where jsonb_typeof(e) <> 'object') then return tower_cs.data_err('', 'bad_rows'); end if;
  rel := to_regclass('public.' || quote_ident(p_table));
  select array_agg(attname::text order by attnum) into allcols from pg_attribute where attrelid = rel and attnum > 0 and not attisdropped and attgenerated = '';
  select array_agg(att.attname::text order by u.ord) into pk from pg_index i cross join lateral unnest(i.indkey) with ordinality u(attnum, ord)
    join pg_attribute att on att.attrelid = i.indrelid and att.attnum = u.attnum where i.indrelid = rel and i.indisprimary;
  if pk is null then return tower_cs.data_err('', 'no_pk'); end if;
  select array_agg(distinct kk) into keys from jsonb_array_elements(p_rows) e cross join lateral jsonb_object_keys(e) kk;
  foreach k in array keys loop if k <> all (allcols) then return tower_cs.data_err('', 'bad_column'); end if; end loop;
  select string_agg(format('%I', c), ', ' order by o) into cols from unnest(allcols) with ordinality t(c, o) where c = any (keys);
  select string_agg(format('%I = excluded.%I', c, c), ', ') into sets from unnest(keys) c where c <> all (pk);
  begin
    execute format('with i as (insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict (%s) %s returning 1) select count(*) from i',
                   p_table, cols, cols, p_table, (select string_agg(format('%I', c), ', ') from unnest(pk) c),
                   case when sets is null then 'do nothing' else 'do update set ' || sets end) using p_rows into res;
    return jsonb_build_object('ok', true, 'n', res);
  exception when others then return tower_cs.data_err(sqlstate, sqlerrm);
  end;
end $$;

-- ---- grants: API roles may call only the public.app_data_* entry points; tower_cs stays private -----------------------------------
do $g$
declare f text; r text; t record;
begin
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'tower_cs'::regnamespace and p.proname like 'data\_%' loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon, authenticated', f);
  end loop;
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('app_data_read', 'app_data_write', 'app_lines_info_replace', 'app_lines_info_read', 'app_data_backup', 'app_data_restore') loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on tower_cs.data_reg from %I', r);
    end if;
  end loop;
  revoke all on tower_cs.data_reg from public;
end $g$;

notify pgrst, 'reload schema';


-- ===== E2. atomic inventory + idempotent roster ops (C5 r3) =====
-- =====================================================================
-- 42_data_txn.sql (C5 round 3): atomic, exactly-once inventory borrow/return and idempotent staff-member creation.
--   * every request carries a client-generated durable operation id (uuid); the result of a successful op is stored in tower_cs.data_op
--   * same op id + same request  -> the ORIGINAL result is returned (replayed:true), nothing changes again
--   * same op id + different request/user/kind -> {ok:false,code:'op_conflict'}
--   * failures roll back everything (stock, evidence, ledger row); historic rows are validated, never silently repaired
-- =====================================================================
do $pre$
begin
  if to_regclass('tower_cs.data_reg') is null then raise exception 'txn layer refused: 40_data_access.sql must be installed first'; end if;
end $pre$;

create table if not exists tower_cs.data_op (
  op_id      uuid primary key,
  kind       text not null,
  user_id    text not null,
  req_hash   text not null,
  result     jsonb not null,
  created_at timestamptz not null default now()
);
revoke all on tower_cs.data_op from public;
do $g0$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on tower_cs.data_op from %I', r); end if;
  end loop;
end $g0$;

-- ledger lookup under a per-op advisory lock. returns null when the op is new, else the stored result / a conflict
create or replace function tower_cs.data_op_begin(p_op uuid, p_kind text, p_user text, p_hash text) returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare o tower_cs.data_op;
begin
  perform pg_advisory_xact_lock(hashtextextended('tower_cs.data_op:' || p_op::text, 0));
  select * into o from tower_cs.data_op where op_id = p_op;
  if not found then return null; end if;
  if o.kind <> p_kind or o.user_id <> p_user or o.req_hash <> p_hash then return jsonb_build_object('ok', false, 'code', 'op_conflict'); end if;
  return o.result || jsonb_build_object('replayed', true);
end $$;

-- ---- borrow ---------------------------------------------------------------------------------------------------------
create or replace function public.app_inventory_borrow(p_token text, p_op_id uuid, p_tool_id text, p_qty integer, p_borrow_date date, p_borrower_name text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb; uid text; h text; prev jsonb; t record; bid jsonb; res jsonb; nm text := btrim(coalesce(p_borrower_name, ''));
        nw int; nb int; brow jsonb;
begin
  a := tower_cs.data_auth(p_token, 'inventory_tools', 'upd');
  if not (a ->> 'ok')::boolean then return a; end if;
  if not (tower_cs.data_auth(p_token, 'inventory_borrowed', 'read') ->> 'ok')::boolean then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  uid := a -> 'user' ->> 'id';
  if p_op_id is null or p_tool_id is null or btrim(p_tool_id) = '' then return jsonb_build_object('ok', false, 'code', 'bad_request'); end if;
  h := md5(jsonb_build_array(p_tool_id, p_qty, p_borrow_date, nm)::text);
  prev := tower_cs.data_op_begin(p_op_id, 'borrow', uid, h);
  if prev is not null then return prev; end if;
  if p_qty is null or p_qty < 1 then return jsonb_build_object('ok', false, 'code', 'invalid_qty'); end if;
  if p_borrow_date is null or nm = '' then return jsonb_build_object('ok', false, 'code', 'bad_request'); end if;
  begin
    select * into t from public.inventory_tools where id::text = p_tool_id for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'tool_not_found'); end if;
    if t.qty_working is null or t.qty_working < 0 or t.borrowed_qty is null or t.borrowed_qty < 0 then
      return jsonb_build_object('ok', false, 'code', 'inventory_conflict');          -- historic row malformed: refuse, do not repair
    end if;
    if p_qty > t.qty_working then return jsonb_build_object('ok', false, 'code', 'insufficient_stock', 'available', t.qty_working); end if;
    nw := t.qty_working - p_qty; nb := t.borrowed_qty + p_qty;
    brow := jsonb_build_object('tool_id', t.id::text, 'tool_name', t.name, 'qty', p_qty, 'borrow_date', p_borrow_date, 'borrower_name', nm, 'returned', false, 'client_uuid', p_op_id::text);
    insert into public.inventory_borrowed (tool_id, tool_name, qty, borrow_date, borrower_name, returned, client_uuid)
      select r.tool_id, r.tool_name, r.qty, r.borrow_date, r.borrower_name, r.returned, r.client_uuid from jsonb_populate_record(null::public.inventory_borrowed, brow) r
      returning to_jsonb(id) into bid;
    update public.inventory_tools set qty_working = nw, borrowed_qty = nb where id = t.id;
    res := jsonb_build_object('ok', true, 'op_id', p_op_id, 'borrow_id', bid, 'tool_id', to_jsonb(t.id), 'qty_working', nw, 'borrowed_qty', nb);
    insert into tower_cs.data_op (op_id, kind, user_id, req_hash, result) values (p_op_id, 'borrow', uid, h, res);
    return res || jsonb_build_object('replayed', false);
  exception when others then
    return tower_cs.data_err(sqlstate, sqlerrm);                    -- sub-transaction rolled back: stock, evidence and ledger unchanged
  end;
end $$;

-- ---- return ---------------------------------------------------------------------------------------------------------
create or replace function public.app_inventory_return(p_token text, p_op_id uuid, p_borrow_id text, p_return_date date)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb; uid text; h text; prev jsonb; b record; t record; res jsonb; nw int; nb int; rd date := coalesce(p_return_date, current_date);
begin
  a := tower_cs.data_auth(p_token, 'inventory_tools', 'upd');
  if not (a ->> 'ok')::boolean then return a; end if;
  uid := a -> 'user' ->> 'id';
  if p_op_id is null or p_borrow_id is null or btrim(p_borrow_id) = '' then return jsonb_build_object('ok', false, 'code', 'bad_request'); end if;
  h := md5(jsonb_build_array(p_borrow_id, rd)::text);
  prev := tower_cs.data_op_begin(p_op_id, 'return', uid, h);
  if prev is not null then return prev; end if;
  begin
    select * into b from public.inventory_borrowed where id::text = p_borrow_id for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'borrow_not_found'); end if;
    if b.returned is true then return jsonb_build_object('ok', false, 'code', 'already_returned'); end if;
    if b.returned is null or b.qty is null or b.qty < 1 or b.tool_id is null then return jsonb_build_object('ok', false, 'code', 'inventory_conflict'); end if;
    select * into t from public.inventory_tools where id::text = b.tool_id::text for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'tool_not_found'); end if;
    if t.qty_working is null or t.qty_working < 0 or t.borrowed_qty is null or t.borrowed_qty < b.qty then
      return jsonb_build_object('ok', false, 'code', 'inventory_conflict');          -- would need a silent clamp: refuse instead
    end if;
    nw := t.qty_working + b.qty; nb := t.borrowed_qty - b.qty;
    update public.inventory_borrowed set returned = true, return_date = rd where id = b.id;
    update public.inventory_tools set qty_working = nw, borrowed_qty = nb where id = t.id;
    res := jsonb_build_object('ok', true, 'op_id', p_op_id, 'borrow_id', to_jsonb(b.id), 'tool_id', to_jsonb(t.id), 'qty_working', nw, 'borrowed_qty', nb, 'return_date', rd);
    insert into tower_cs.data_op (op_id, kind, user_id, req_hash, result) values (p_op_id, 'return', uid, h, res);
    return res || jsonb_build_object('replayed', false);
  exception when others then
    return tower_cs.data_err(sqlstate, sqlerrm);
  end;
end $$;

-- ---- staff roster member creation (admin only; NO de-duplication by name) -----------------------------------------------------
create or replace function public.app_roster_member_create(p_token text, p_op_id uuid, p_name text, p_values jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb; uid text; h text; prev jsonb; nm text := btrim(coalesce(p_name, '')); v jsonb := coalesce(p_values, '{}'::jsonb); rid jsonb; res jsonb; rw jsonb;
begin
  a := tower_cs.auth_check(p_token, array['admin']);                  -- member creation exists ONLY here (direct insert is closed in the registry); admin only
  if not (a ->> 'ok')::boolean then return a; end if;
  uid := a -> 'user' ->> 'id';
  if p_op_id is null or nm = '' or jsonb_typeof(v) <> 'object' then return jsonb_build_object('ok', false, 'code', 'bad_request'); end if;
  h := md5(jsonb_build_array(nm, v)::text);
  prev := tower_cs.data_op_begin(p_op_id, 'roster_add', uid, h);
  if prev is not null then return prev; end if;
  begin
    insert into public.staff_roster_members (name, "values") values (nm, v) returning to_jsonb(staff_roster_members) into rw;
    rid := rw -> 'id';
    res := jsonb_build_object('ok', true, 'op_id', p_op_id, 'member_id', rid, 'row', rw);
    insert into tower_cs.data_op (op_id, kind, user_id, req_hash, result) values (p_op_id, 'roster_add', uid, h, res);
    return res || jsonb_build_object('replayed', false);
  exception when others then
    return tower_cs.data_err(sqlstate, sqlerrm);
  end;
end $$;

do $g$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'tower_cs'::regnamespace and p.proname = 'data_op_begin' loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon, authenticated', f);
  end loop;
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('app_inventory_borrow', 'app_inventory_return', 'app_roster_member_create') loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $g$;

notify pgrst, 'reload schema';


-- ===== E3. atomic memo numbering (C5r5) =====
-- =====================================================================
-- 43_memo_numbering.sql (v335-C5r5): ATOMIC server-side memo numbering. Candidate, local only. Requires 40_data_access.sql (+42) first.
--   Policy (owner-confirmed): automatic number = highest saved VALID number + 1 (NOT the latest-created memo's number); the number can always be set
--   manually (new memo or an explicit change on an existing one) if free; a suggestion shown before saving is never a reservation; no annual reset;
--   the format is unchanged (plain decimal text). "Valid" = digits only (leading zeros tolerated in legacy rows, value >= 1); blank / non-numeric legacy
--   values are ignored by the sequence and are NEVER renumbered.
--   public.app_memo_save   (token, client_uuid, id, allow_create, mode, number, fields)   admin / supervisor; ONE transaction under ONE numbering lock
--        mode auto   : create -> max+1 ; existing row (replay / lost response) -> number kept
--        mode manual : requested number must be canonical (^[1-9][0-9]{0,14}$) and free (or already this memo's own) else {ok:false,code:'number_taken'} and nothing changes
--        mode keep   : content edit, number untouched
--        identity    : client_uuid (create / replay) or id (edit); a replay of the same identity never allocates a second number nor a second row
--   public.app_memo_info   (token)   suggested next number (NOT a reservation), highest valid number, and a read-only report of pre-existing duplicates
--   The generic data API can no longer insert/update memos (registry) and a trigger on public.memos enforces uniqueness of every NEW/CHANGED valid number
--   under the same lock for any other path (backup restore included). Historic duplicates stay as they are (content edits remain possible).
-- =====================================================================
do $pre$
begin
  if to_regclass('tower_cs.data_reg') is null or to_regprocedure('tower_cs.auth_check(text,text[])') is null then raise exception 'memo numbering refused: 40_data_access.sql must be installed first'; end if;
  if to_regclass('public.memos') is null then raise exception 'memo numbering refused: public.memos is missing'; end if;
  if exists (select 1 from unnest(array['id','memo_number','memo_date','memo_to','subject','content','sender_title','sender_name','table_data','attachments','created_by','client_uuid']) c
             where not exists (select 1 from pg_attribute where attrelid = 'public.memos'::regclass and attname = c and attnum > 0 and not attisdropped)) then
    raise exception 'memo numbering refused: a column the memo API uses is missing from public.memos';
  end if;
end $pre$;

create or replace function tower_cs.memo_num(p text) returns bigint language sql immutable set search_path = pg_catalog as $$
  select case when p ~ '^[0-9]{1,15}$' and p::bigint >= 1 then p::bigint end $$;
create index if not exists memos_valid_number_idx on public.memos ((tower_cs.memo_num(memo_number)));

-- the invariant for EVERY write path (generic API is closed below; restore / SQL still pass through here)
create or replace function tower_cs.memo_number_guard() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare n bigint;
begin
  if tg_op = 'UPDATE' and new.memo_number is not distinct from old.memo_number then return new; end if;
  n := tower_cs.memo_num(new.memo_number);
  if n is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('tower_cs.memo_number', 0));
  if exists (select 1 from public.memos m where m.id is distinct from new.id and tower_cs.memo_num(m.memo_number) = n) then
    raise exception 'memo_number_taken' using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists memos_number_guard on public.memos;
create trigger memos_number_guard before insert or update of memo_number on public.memos for each row execute function tower_cs.memo_number_guard();

-- generic data API: memos are no longer insertable/updatable there (creation + every number change go through app_memo_save). Read / delete / backup / restore unchanged.
update tower_cs.data_reg set ins_roles = '{}', upd_roles = '{}', write_cols = '{}' where tbl = 'memos';

create or replace function public.app_memo_save(p_token text, p_client_uuid uuid, p_id bigint, p_allow_create boolean, p_mode text, p_number text, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb; uname text; f jsonb := coalesce(p_fields, '{}'::jsonb); k text; allowed text[] := array['memo_date','memo_to','subject','content','sender_title','sender_name','table_data','attachments'];
        mode text := coalesce(p_mode, 'keep'); r public.memos; found_ boolean := false; n bigint; h record; newnum text; mx bigint; existed boolean := false;
begin
  a := tower_cs.auth_check(p_token, array['admin','supervisor']);
  if not (a ->> 'ok')::boolean then return a; end if;
  uname := a -> 'user' ->> 'full_name';
  if mode not in ('auto','manual','keep') or jsonb_typeof(f) <> 'object' or (p_id is null and p_client_uuid is null) then return jsonb_build_object('ok', false, 'code', 'bad_request'); end if;
  for k in select jsonb_object_keys(f) loop if k <> all (allowed) then return jsonb_build_object('ok', false, 'code', 'bad_column'); end if; end loop;
  if mode = 'manual' then
    if p_number is null or p_number !~ '^[1-9][0-9]{0,14}$' then return jsonb_build_object('ok', false, 'code', 'invalid_number'); end if;
    n := p_number::bigint;
  elsif p_number is not null then return jsonb_build_object('ok', false, 'code', 'bad_request');
  end if;
  begin
    perform pg_advisory_xact_lock(hashtextextended('tower_cs.memo_number', 0));          -- ONE lock for allocation, manual numbers and replay detection
    if p_id is not null then
      select * into r from public.memos where id = p_id for update; found_ := found;
      if found_ and p_client_uuid is not null and r.client_uuid is not null and r.client_uuid <> p_client_uuid then return jsonb_build_object('ok', false, 'code', 'bad_request'); end if;
    end if;
    if not found_ and p_client_uuid is not null then select * into r from public.memos where client_uuid = p_client_uuid for update; found_ := found; end if;
    existed := found_;
    if not found_ then
      if p_id is not null or not coalesce(p_allow_create, false) then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
      if (f ->> 'memo_date') is null or btrim(coalesce(f ->> 'content', '')) = '' then return jsonb_build_object('ok', false, 'code', 'bad_request'); end if;
      if mode = 'manual' then
        select m.id, m.memo_date, m.subject into h from public.memos m where tower_cs.memo_num(m.memo_number) = n order by m.id limit 1;
        if found then return jsonb_build_object('ok', false, 'code', 'number_taken', 'number', p_number, 'holder', jsonb_build_object('id', h.id, 'memo_date', h.memo_date, 'subject', h.subject)); end if;
        newnum := p_number;
      else
        select max(tower_cs.memo_num(memo_number)) into mx from public.memos;
        newnum := (coalesce(mx, 0) + 1)::text;
      end if;
      insert into public.memos (memo_number, memo_date, memo_to, subject, content, sender_title, sender_name, table_data, attachments, created_by, client_uuid)
        values (newnum, (f ->> 'memo_date')::date, f ->> 'memo_to', f ->> 'subject', f ->> 'content', f ->> 'sender_title', f ->> 'sender_name',
                case when f ? 'table_data' and jsonb_typeof(f -> 'table_data') <> 'null' then f -> 'table_data' end,
                case when f ? 'attachments' and jsonb_typeof(f -> 'attachments') <> 'null' then f -> 'attachments' end, uname, p_client_uuid)
        returning * into r;
    else
      if mode = 'manual' and r.memo_number is distinct from p_number then
        select m.id, m.memo_date, m.subject into h from public.memos m where m.id <> r.id and tower_cs.memo_num(m.memo_number) = n order by m.id limit 1;
        if found then return jsonb_build_object('ok', false, 'code', 'number_taken', 'number', p_number, 'holder', jsonb_build_object('id', h.id, 'memo_date', h.memo_date, 'subject', h.subject)); end if;
        update public.memos set memo_number = p_number where id = r.id;
      end if;
      update public.memos set
        memo_date = case when f ? 'memo_date' then (f ->> 'memo_date')::date else memo_date end,
        memo_to = case when f ? 'memo_to' then f ->> 'memo_to' else memo_to end,
        subject = case when f ? 'subject' then f ->> 'subject' else subject end,
        content = case when f ? 'content' then f ->> 'content' else content end,
        sender_title = case when f ? 'sender_title' then f ->> 'sender_title' else sender_title end,
        sender_name = case when f ? 'sender_name' then f ->> 'sender_name' else sender_name end,
        table_data = case when f ? 'table_data' then (case when jsonb_typeof(f -> 'table_data') = 'null' then null else f -> 'table_data' end) else table_data end,
        attachments = case when f ? 'attachments' then (case when jsonb_typeof(f -> 'attachments') = 'null' then null else f -> 'attachments' end) else attachments end,
        created_by = uname
       where id = r.id returning * into r;
    end if;
    return jsonb_build_object('ok', true, 'row', to_jsonb(r), 'replayed', existed);
  exception when others then
    if sqlerrm = 'memo_number_taken' then return jsonb_build_object('ok', false, 'code', 'number_taken', 'number', p_number); end if;
    return tower_cs.data_err(sqlstate, sqlerrm);
  end;
end $$;

-- suggested next number (NOT a reservation) + read-only report of pre-existing duplicates (nothing is changed)
create or replace function public.app_memo_info(p_token text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare a jsonb; mx bigint; d jsonb;
begin
  a := tower_cs.auth_check(p_token, array['admin','supervisor','readonly']);
  if not (a ->> 'ok')::boolean then return a; end if;
  select max(tower_cs.memo_num(memo_number)) into mx from public.memos;
  select coalesce(jsonb_agg(jsonb_build_object('number', num, 'ids', ids) order by num), '[]'::jsonb) into d
    from (select tower_cs.memo_num(memo_number) num, jsonb_agg(id order by id) ids from public.memos where tower_cs.memo_num(memo_number) is not null group by 1 having count(*) > 1) x;
  return jsonb_build_object('ok', true, 'max', mx, 'next', coalesce(mx, 0) + 1, 'duplicates', d);
end $$;

do $g$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_memo_save', 'app_memo_info') loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $g$;

notify pgrst, 'reload schema';


-- ===== F. direct-access lockdown of the legacy tables (C5) =====
-- =====================================================================
-- 41_data_lockdown.sql : closes the DIRECT API paths (anon / authenticated / PUBLIC) to every legacy data table in tower_cs.data_reg
-- (INCLUDING SELECT on inspections / treatments / line_towers_custom / latest_inspections and every other table) and to every public view that
-- depends on them. After this the only way in is the session-validated public.app_data_* / app_op_* / app_lines_info_replace API (40 + 22/23).
-- RUN ONLY TOGETHER WITH the application files that use that API (the previous application can no longer read or write these tables).
--   * previous ACL (table AND column level, for PUBLIC / anon / authenticated), previous policies and the previous RLS flags are saved once in
--     tower_cs.data_acl / data_policy / data_rls; 94_rollback_data_lockdown.sql restores them exactly.
--   * RLS is enabled with NO policy for API roles (default deny) as a second barrier behind the revoked grants.
--   * EFFECTIVE privileges (inherited / PUBLIC / column level) are then verified for anon and authenticated; any survivor aborts the whole script (nothing changes).
--   * any OTHER public relation that anon can still read is listed in tower_cs.data_state.unprotected (not silently ignored).
--   service_role / the table owner / SECURITY DEFINER functions are not API-role grants and are unaffected.
-- Idempotent: a second run while applied does nothing.
-- =====================================================================
create table if not exists tower_cs.data_acl (kind text not null, object text not null, col text, grantee text not null, privilege text not null, grantable boolean not null default false);
create table if not exists tower_cs.data_policy (tbl text not null, policyname text not null, definition text not null);
create table if not exists tower_cs.data_rls (tbl text primary key, rls boolean not null, forced boolean not null);
create table if not exists tower_cs.data_state (applied_at timestamptz, lockdown_at timestamptz, rolled_back_at timestamptz, unprotected jsonb);
alter table tower_cs.data_acl enable row level security; alter table tower_cs.data_policy enable row level security;
alter table tower_cs.data_rls enable row level security;  alter table tower_cs.data_state enable row level security;

do $lock$
declare r record; rel regclass; role_name text; bad text; miss text; unprot jsonb; cc record; priv text;
begin
  foreach priv in array array['app_data_read(text,text,jsonb,jsonb,jsonb,integer,integer)', 'app_data_write(text,text,text,jsonb,jsonb,jsonb,boolean)', 'app_lines_info_replace(text,jsonb,text)', 'app_lines_info_read(text)', 'app_data_backup(text,text,integer,integer)', 'app_data_restore(text,text,jsonb)'] loop
    if to_regprocedure('public.' || priv) is null then raise exception 'data lockdown refused: public.% is not installed (run 40_data_access.sql first)', priv; end if;
  end loop;
  miss := tower_cs.data_schema_check();
  if miss is not null then raise exception 'data lockdown refused: registry does not match the database: %', miss; end if;
  if exists (select 1 from tower_cs.data_state where lockdown_at is not null and rolled_back_at is null) then raise notice 'data lockdown already applied'; return; end if;

  delete from tower_cs.data_acl; delete from tower_cs.data_policy; delete from tower_cs.data_rls; delete from tower_cs.data_state;
  create temporary table _tgt on commit drop as
    with recursive d(oid) as (
      select c.oid from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in (select tbl from tower_cs.data_reg)
      union
      select v.oid from d join pg_depend dep on dep.refobjid = d.oid and dep.classid = 'pg_rewrite'::regclass
        join pg_rewrite rw on rw.oid = dep.objid join pg_class v on v.oid = rw.ev_class
       where v.oid <> d.oid and v.relkind in ('v', 'm') and v.relnamespace = 'public'::regnamespace)
    select d.oid, c.relname::text as relname, c.relkind from d join pg_class c on c.oid = d.oid;

  -- save: table ACL, column ACL, policies, RLS flags
  insert into tower_cs.data_acl(kind, object, col, grantee, privilege, grantable)
    select 'table', 'public.' || t.relname, null, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type, a.is_grantable
      from _tgt t join pg_class c on c.oid = t.oid cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated');
  insert into tower_cs.data_acl(kind, object, col, grantee, privilege, grantable)
    select 'column', 'public.' || t.relname, at.attname, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type, a.is_grantable
      from _tgt t join pg_attribute at on at.attrelid = t.oid and at.attacl is not null and at.attnum > 0 and not at.attisdropped
      cross join lateral aclexplode(at.attacl) a where a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated');
  insert into tower_cs.data_policy(tbl, policyname, definition)
    select p.tablename, p.policyname, format('create policy %I on public.%I as %s for %s to %s using (%s)%s', p.policyname, p.tablename, p.permissive, p.cmd,
           array_to_string(p.roles, ', '), coalesce(p.qual, 'true'), case when p.with_check is not null then ' with check (' || p.with_check || ')' else '' end)
      from pg_policies p where p.schemaname = 'public' and p.tablename in (select relname from _tgt);
  insert into tower_cs.data_rls(tbl, rls, forced) select t.relname, c.relrowsecurity, c.relforcerowsecurity from _tgt t join pg_class c on c.oid = t.oid where t.relkind in ('r', 'p');

  -- close
  for r in select * from _tgt loop
    rel := r.oid::regclass;
    if r.relkind in ('r', 'p') then
      for cc in select policyname from pg_policies where schemaname = 'public' and tablename = r.relname loop execute format('drop policy %I on public.%I', cc.policyname, r.relname); end loop;
      execute format('alter table public.%I enable row level security', r.relname);
    end if;
    foreach role_name in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format('revoke all on public.%I from %I', r.relname, role_name);
        for cc in select attname from pg_attribute where attrelid = r.oid and attnum > 0 and not attisdropped and attacl is not null loop
          execute format('revoke all (%I) on public.%I from %I', cc.attname, r.relname, role_name);
        end loop;
      end if;
    end loop;
    execute format('revoke all on public.%I from public', r.relname);
    for cc in select attname from pg_attribute where attrelid = r.oid and attnum > 0 and not attisdropped and attacl is not null loop
      execute format('revoke all (%I) on public.%I from public', cc.attname, r.relname);
    end loop;
  end loop;

  -- prove it with EFFECTIVE privileges (inherited roles, PUBLIC, column level)
  select string_agg(x, ', ') into bad from (
    select ro.rolname || ' ' || p.priv || ' on ' || t.relname as x
      from pg_roles ro cross join _tgt t cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
     where ro.rolname in ('anon', 'authenticated') and has_table_privilege(ro.rolname, t.oid, p.priv)
    union all
    select ro.rolname || ' column ' || p.priv || ' on ' || t.relname || '.' || a.attname
      from pg_roles ro cross join _tgt t join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(priv)
     where ro.rolname in ('anon', 'authenticated') and has_column_privilege(ro.rolname, t.oid, a.attnum, p.priv)
    union all
    select 'PUBLIC on ' || t.relname || ' ' || x.privilege_type from _tgt t join pg_class c on c.oid = t.oid cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x where x.grantee = 0) s;
  if bad is not null then raise exception 'data lockdown aborted (nothing changed): API roles still have effective access: % (probably inherited from a role they are a member of - review by hand)', left(bad, 600); end if;

  -- anything else in public that the anonymous role can still read is REPORTED (not silently ignored)
  select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) into unprot
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'f', 'p') and c.oid not in (select oid from _tgt)
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
          or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'));
  insert into tower_cs.data_state(applied_at, lockdown_at, unprotected) values (now(), now(), unprot);
  if jsonb_array_length(unprot) > 0 then raise notice 'NOT PROTECTED by this script (still reachable by the API roles): %', unprot; end if;
end $lock$;
notify pgrst, 'reload schema';


notify pgrst, 'reload schema';
commit;
