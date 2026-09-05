-- ============================================================================
-- ADR Reporting Module - Phase 1: form + validation + deadlines
--
-- Status: APPLIED 2026-08-18 via MCP (migration `adr_reports_phase1`).
--
-- Adds the columns and the server-side submission gate that Phase 1 needs:
--   - patient_medical_history  (spec 3.2, optional)
--   - action_taken             (spec 3.6, per-reaction Action & Causality)
--   - skincare cosmetic detail (spec 4.4): onset_timing, discontinued_use,
--     resolution_status. Kept as columns on adr_reports to match the existing
--     pattern (industry/skincare fields already live on the report row rather
--     than in a 1:1 child table).
--   - submission_deadline      (spec 6, "stored/cached on the record") -
--     written by submit_adr_report when the gate passes
--   - submit_adr_report()      SECURITY INVOKER RPC enforcing the Section 7
--     IS_VALID_ICSR gate server-side. RLS applies inside the function (invoker
--     rights), so a caller from another business cannot read the report row at
--     all and the gate refuses. Never weakens the client-side gate; it is the
--     authoritative copy the API layer relies on.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. adr_reports - new columns
-- ----------------------------------------------------------------------------
ALTER TABLE adr_reports
  ADD COLUMN IF NOT EXISTS patient_medical_history text,
  ADD COLUMN IF NOT EXISTS onset_timing text CHECK (onset_timing IN ('immediate','delayed')),
  ADD COLUMN IF NOT EXISTS discontinued_use boolean,
  ADD COLUMN IF NOT EXISTS resolution_status text CHECK (resolution_status IN ('resolved','improving','persistent','chronic')),
  ADD COLUMN IF NOT EXISTS submission_deadline timestamptz;

-- ----------------------------------------------------------------------------
-- 2. adr_report_reactions - action_taken (spec 3.6)
-- ----------------------------------------------------------------------------
ALTER TABLE adr_report_reactions
  ADD COLUMN IF NOT EXISTS action_taken text CHECK (action_taken IN ('dose_reduced','withdrawn','not_changed','unknown'));

-- ----------------------------------------------------------------------------
-- 3. submit_adr_report() - server-side IS_VALID_ICSR gate + deadline store
--    SECURITY INVOKER: the calling user's RLS applies to every read inside,
--    so cross-business report_ids resolve to "not found" and are refused.
--    Returns { valid: bool, missing: [...], ... } as JSON.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_adr_report(p_report_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_report adr_reports;
  v_missing text[] := '{}';
  v_has_products boolean;
  v_has_brand boolean;
  v_has_reactions boolean;
  v_has_desc boolean;
  v_has_severity boolean;
  v_has_outcome boolean;
  v_seriousness_ok boolean;
  v_is_serious boolean;
  v_deadline timestamptz;
begin
  -- RLS applies here (SECURITY INVOKER): another business's report_id resolves
  -- to nothing, so `not found` is both the correctness and the security path.
  select * into v_report from adr_reports where report_id = p_report_id;
  if not found then
    return jsonb_build_object('valid', false, 'missing', jsonb_build_array('Report not found or not accessible'));
  end if;

  if v_report.status <> 'draft' then
    return jsonb_build_object('valid', false, 'missing', jsonb_build_array('Only draft reports can be submitted'));
  end if;

  -- 1. Reporter qualification
  if coalesce(v_report.reporter_qualification, '') = '' then
    v_missing := v_missing || 'Reporter qualification';
  end if;

  -- 2. Reporter name OR anonymous confirmed by facility
  if coalesce(v_report.reporter_name, '') = '' and v_report.reporter_anonymous_confirmed_by_facility is not true then
    v_missing := v_missing || 'Reporter name';
  end if;

  -- 3. Reporter consent must be explicitly true or false
  if v_report.reporter_consent_followup is null then
    v_missing := v_missing || 'Reporter consent for follow-up';
  end if;

  -- 4. Patient identifier
  if coalesce(v_report.patient_identifier, '') = '' then
    v_missing := v_missing || 'Patient identifier';
  end if;

  -- 5. At least one of age / dob / age group
  if v_report.patient_age is null and v_report.patient_dob is null and coalesce(v_report.patient_age_group, '') = '' then
    v_missing := v_missing || 'Patient age or DOB or age group';
  end if;

  -- 6. Patient gender
  if coalesce(v_report.patient_gender, '') = '' then
    v_missing := v_missing || 'Patient gender';
  end if;

  -- 7. At least one suspect product
  select exists(select 1 from adr_report_products where report_id = p_report_id) into v_has_products;
  if not v_has_products then
    v_missing := v_missing || 'At least one suspect product';
  else
    -- 8. At least one product with a brand name
    select exists(select 1 from adr_report_products where report_id = p_report_id and coalesce(product_brand_name, '') <> '')
      into v_has_brand;
    if not v_has_brand then
      v_missing := v_missing || 'Product brand name';
    end if;
  end if;

  -- 9. At least one adverse reaction
  select exists(select 1 from adr_report_reactions where report_id = p_report_id) into v_has_reactions;
  if not v_has_reactions then
    v_missing := v_missing || 'At least one adverse reaction';
  else
    -- 10. Reaction description (at least one)
    select exists(select 1 from adr_report_reactions where report_id = p_report_id and coalesce(reaction_description, '') <> '')
      into v_has_desc;
    if not v_has_desc then
      v_missing := v_missing || 'Reaction description';
    end if;

    -- 11. Severity (at least one)
    select exists(select 1 from adr_report_reactions where report_id = p_report_id and severity is not null)
      into v_has_severity;
    if not v_has_severity then
      v_missing := v_missing || 'Severity';
    end if;

    -- 12. Outcome (at least one)
    select exists(select 1 from adr_report_reactions where report_id = p_report_id and outcome is not null)
      into v_has_outcome;
    if not v_has_outcome then
      v_missing := v_missing || 'Outcome';
    end if;

    -- 13. All six seriousness booleans non-null (columns default false, so a
    --     present reaction row satisfies this; kept for parity with the client).
    select not exists(
      select 1 from adr_report_reactions
      where report_id = p_report_id
        and (seriousness_death is null or seriousness_life_threatening is null
             or seriousness_hospitalization is null or seriousness_disability is null
             or seriousness_congenital_anomaly is null or seriousness_other_medically_important is null)
    ) into v_seriousness_ok;
    if not v_seriousness_ok then
      v_missing := v_missing || 'All six seriousness fields';
    end if;
  end if;

  -- 14. Industry module: batch/lot + causality + case narrative mandatory
  if v_report.module_type = 'industry' then
    if coalesce(v_report.batch_lot_number, '') = '' then
      v_missing := v_missing || 'Batch/lot number';
    end if;
    if coalesce(v_report.causality_assessment, '') = '' then
      v_missing := v_missing || 'Causality assessment';
    end if;
    if coalesce(v_report.case_narrative_summary, '') = '' then
      v_missing := v_missing || 'Case narrative summary';
    end if;
  end if;

  if cardinality(v_missing) > 0 then
    return jsonb_build_object('valid', false, 'missing', to_jsonb(v_missing));
  end if;

  -- Gate passed. Compute deadline per the Section 6 rule table and store it.
  select bool_or(
    b.seriousness_death or b.seriousness_life_threatening or b.seriousness_hospitalization
    or b.seriousness_disability or b.seriousness_congenital_anomaly or b.seriousness_other_medically_important
  )
  from adr_report_reactions b
  where b.report_id = p_report_id
  into v_is_serious;

  -- new_safety_signal (industry) always wins: +3 days
  if v_report.new_safety_signal is true then
    v_deadline := v_report.created_at + interval '3 days';
  elsif v_is_serious and v_report.reaction_expected is not true then
    v_deadline := v_report.created_at + interval '72 hours';
  elsif v_is_serious then
    v_deadline := v_report.created_at + interval '15 days';
  elsif v_report.reaction_expected is not true then
    v_deadline := v_report.created_at + interval '15 days';
  else
    v_deadline := v_report.created_at + interval '90 days';
  end if;

  update adr_reports
     set status = 'submitted', submission_deadline = v_deadline
   where report_id = p_report_id;

  return jsonb_build_object('valid', true, 'report_id', p_report_id, 'status', 'submitted', 'submission_deadline', v_deadline);
end $$;

COMMENT ON FUNCTION public.submit_adr_report(uuid) IS
  'Server-side IS_VALID_ICSR gate for ADR submission. Draft-only; SECURITY INVOKER so RLS scopes the report read.';