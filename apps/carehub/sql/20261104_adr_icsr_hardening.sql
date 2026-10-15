-- ============================================================================
-- ADR Reporting Module - Phase 3: ICSR validation hardening
--
-- Status: REVIEW ONLY — do NOT apply to production without PV/regulatory
--         and privacy sign-off (see master prompt §14).
--
-- Additive-strict: two previously-passing cases newly fail, both required by
-- master prompt §6 and documented as rulings below. Everything else keeps
-- byte-identical behavior and strings:
--   Ruling 1 (contact): the shared core now requires a usable contact route.
--   Hub rows may satisfy it through the submitting facility's registered
--   phone/email (staff report from a known business account); public rows
--   (NULL business) can only satisfy it reporter-side, preserving the Phase 2
--   strict rule with the identical label. A Hub report with neither fails.
--   Ruling 2 (skincare parity): module_type='skincare' gains server-side
--   mandatory application_site / cosmetic_reaction_type / onset_timing /
--   discontinued_use / resolution_status, mirroring industry/hospital parity
--   (previously client-only). Skincare drafts in flight must fill them.
-- Also:
--   - adr_icsr_missing now returns (missing text[], fields jsonb[{id,label}])
--     via OUT params (old text[] signature dropped first — same migration,
--     atomic). Both submit RPCs attach machine-readable `missingFields`;
--     existing `missing` strings are byte-identical.
--   - verify_adr_product_route refuses routes whose parent report lacks
--     gate_validated_at (no verified access without a passing gate).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. module_type - admit the public channel (additive widening).
--    Public reports carry report_source='public' + module_type='public' and
--    are bound only by the general ICSR core (no module-specific clause
--    references 'public'). formEngine falls back to the community_pharmacy
--    presentation for unknown module types (getModuleConfig default branch).
-- ----------------------------------------------------------------------------
ALTER TABLE adr_reports DROP CONSTRAINT IF EXISTS adr_reports_module_type_check;
ALTER TABLE adr_reports
  ADD CONSTRAINT adr_reports_module_type_check
  CHECK (module_type IN ('community_pharmacy','hospital','industry','skincare','public'));

DROP FUNCTION IF EXISTS public.adr_icsr_missing(uuid);

CREATE OR REPLACE FUNCTION public.adr_icsr_missing(
  p_report_id uuid,
  OUT missing text[],
  OUT fields jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report adr_reports;
  v_m text[] := '{}';
  v_f jsonb := '[]'::jsonb;
  v_has_products boolean;
  v_has_brand boolean;
  v_has_reactions boolean;
  v_has_desc boolean;
  v_has_severity boolean;
  v_has_outcome boolean;
  v_seriousness_ok boolean;
  v_biz_contact boolean;
BEGIN
  SELECT * INTO v_report FROM adr_reports WHERE report_id = p_report_id;
  IF NOT FOUND THEN
    missing := ARRAY['Report not found or not accessible'];
    fields := '[]'::jsonb;
    RETURN;
  END IF;

  -- Local flag() keeps the label list and the coded list in lockstep.
  -- (Inlined per gate via the block below; labels match the live RPC strings.)

  IF coalesce(v_report.reporter_qualification, '') = '' THEN
    v_m := array_append(v_m, 'Reporter qualification');
    v_f := v_f || jsonb_build_object('id', 'reporter_qualification', 'label', 'Reporter qualification');
  END IF;

  IF coalesce(v_report.reporter_name, '') = ''
     AND v_report.reporter_anonymous_confirmed_by_facility IS NOT TRUE THEN
    v_m := array_append(v_m, 'Reporter name');
    v_f := v_f || jsonb_build_object('id', 'reporter_name', 'label', 'Reporter name');
  END IF;

  IF v_report.reporter_consent_followup IS NULL THEN
    v_m := array_append(v_m, 'Reporter consent for follow-up');
    v_f := v_f || jsonb_build_object('id', 'reporter_consent_followup', 'label', 'Reporter consent for follow-up');
  END IF;

  -- Contact route (Ruling 1): reporter-level, else submitting-facility
  -- fallback. Public rows carry NULL business_id, so the fallback can never
  -- fire for them — the Phase 2 strict rule stands with the same label.
  IF coalesce(trim(both from v_report.reporter_phone), '') = ''
     AND NOT coalesce(v_report.reporter_email LIKE '%@%.%', false) THEN
    IF v_report.business_id IS NOT NULL THEN
      SELECT EXISTS(
        SELECT 1 FROM businesses b
        WHERE b.id = v_report.business_id
          AND (coalesce(trim(both from b.phone), '') <> ''
               OR coalesce(b.email LIKE '%@%.%', false))
      ) INTO v_biz_contact;
    ELSE
      v_biz_contact := false;
    END IF;
    IF NOT v_biz_contact THEN
      v_m := array_append(v_m, 'Reporter phone or email');
      v_f := v_f || jsonb_build_object('id', 'reporter_contact', 'label', 'Reporter phone or email');
    END IF;
  END IF;

  IF coalesce(v_report.patient_identifier, '') = '' THEN
    v_m := array_append(v_m, 'Patient identifier');
    v_f := v_f || jsonb_build_object('id', 'patient_identifier', 'label', 'Patient identifier');
  END IF;

  IF v_report.patient_age IS NULL AND v_report.patient_dob IS NULL
     AND coalesce(v_report.patient_age_group, '') = '' THEN
    v_m := array_append(v_m, 'Patient age or DOB or age group');
    v_f := v_f || jsonb_build_object('id', 'patient_age', 'label', 'Patient age or DOB or age group');
  END IF;

  IF coalesce(v_report.patient_gender, '') = '' THEN
    v_m := array_append(v_m, 'Patient gender');
    v_f := v_f || jsonb_build_object('id', 'patient_gender', 'label', 'Patient gender');
  END IF;

  SELECT EXISTS(SELECT 1 FROM adr_report_products WHERE report_id = p_report_id)
    INTO v_has_products;
  IF NOT v_has_products THEN
    v_m := array_append(v_m, 'At least one suspect product');
    v_f := v_f || jsonb_build_object('id', 'products_section', 'label', 'At least one suspect product');
  ELSE
    SELECT EXISTS(SELECT 1 FROM adr_report_products
                   WHERE report_id = p_report_id
                     AND coalesce(product_brand_name, '') <> '')
      INTO v_has_brand;
    IF NOT v_has_brand THEN
      v_m := array_append(v_m, 'Product brand name');
      v_f := v_f || jsonb_build_object('id', 'products_section', 'label', 'Product brand name');
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM adr_report_reactions WHERE report_id = p_report_id)
    INTO v_has_reactions;
  IF NOT v_has_reactions THEN
    v_m := array_append(v_m, 'At least one adverse reaction');
    v_f := v_f || jsonb_build_object('id', 'reactions_section', 'label', 'At least one adverse reaction');
  ELSE
    SELECT EXISTS(SELECT 1 FROM adr_report_reactions
                   WHERE report_id = p_report_id
                     AND coalesce(reaction_description, '') <> '')
      INTO v_has_desc;
    IF NOT v_has_desc THEN
      v_m := array_append(v_m, 'Reaction description');
      v_f := v_f || jsonb_build_object('id', 'reaction_description', 'label', 'Reaction description');
    END IF;

    SELECT EXISTS(SELECT 1 FROM adr_report_reactions
                   WHERE report_id = p_report_id AND severity IS NOT NULL)
      INTO v_has_severity;
    IF NOT v_has_severity THEN
      v_m := array_append(v_m, 'Severity');
      v_f := v_f || jsonb_build_object('id', 'severity', 'label', 'Severity');
    END IF;

    SELECT EXISTS(SELECT 1 FROM adr_report_reactions
                   WHERE report_id = p_report_id AND outcome IS NOT NULL)
      INTO v_has_outcome;
    IF NOT v_has_outcome THEN
      v_m := array_append(v_m, 'Outcome');
      v_f := v_f || jsonb_build_object('id', 'outcome', 'label', 'Outcome');
    END IF;

    SELECT NOT EXISTS(
      SELECT 1 FROM adr_report_reactions
      WHERE report_id = p_report_id
        AND (seriousness_death IS NULL OR seriousness_life_threatening IS NULL
             OR seriousness_hospitalization IS NULL OR seriousness_disability IS NULL
             OR seriousness_congenital_anomaly IS NULL
             OR seriousness_other_medically_important IS NULL)
    ) INTO v_seriousness_ok;
    IF NOT v_seriousness_ok THEN
      v_m := array_append(v_m, 'All six seriousness fields');
      v_f := v_f || jsonb_build_object('id', 'seriousness_fields', 'label', 'All six seriousness fields');
    END IF;
  END IF;

  IF v_report.module_type = 'industry' THEN
    IF coalesce(v_report.batch_lot_number, '') = '' THEN
      v_m := array_append(v_m, 'Batch/lot number');
      v_f := v_f || jsonb_build_object('id', 'regulatory_batch_lot_number', 'label', 'Batch/lot number');
    END IF;
    IF coalesce(v_report.causality_assessment, '') = '' THEN
      v_m := array_append(v_m, 'Causality assessment');
      v_f := v_f || jsonb_build_object('id', 'regulatory_causality_assessment', 'label', 'Causality assessment');
    END IF;
    IF coalesce(v_report.case_narrative_summary, '') = '' THEN
      v_m := array_append(v_m, 'Case narrative summary');
      v_f := v_f || jsonb_build_object('id', 'case_narrative_summary', 'label', 'Case narrative summary');
    END IF;
  END IF;

  IF v_report.module_type = 'hospital' THEN
    IF coalesce(v_report.ward_department, '') = '' THEN
      v_m := array_append(v_m, 'Ward/department');
      v_f := v_f || jsonb_build_object('id', 'ward_department', 'label', 'Ward/department');
    END IF;
    IF coalesce(v_report.attending_physician, '') = '' THEN
      v_m := array_append(v_m, 'Attending physician');
      v_f := v_f || jsonb_build_object('id', 'attending_physician', 'label', 'Attending physician');
    END IF;
  END IF;

  -- Skincare parity (Ruling 2): server enforces what the form engine already
  -- marks mandatory. No other module is checked for these columns.
  IF v_report.module_type = 'skincare' THEN
    IF coalesce(v_report.application_site, '') = '' THEN
      v_m := array_append(v_m, 'Application site');
      v_f := v_f || jsonb_build_object('id', 'skincare_application_site', 'label', 'Application site');
    END IF;
    IF coalesce(v_report.cosmetic_reaction_type, '') = '' THEN
      v_m := array_append(v_m, 'Cosmetic reaction type');
      v_f := v_f || jsonb_build_object('id', 'skincare_cosmetic_reaction_type', 'label', 'Cosmetic reaction type');
    END IF;
    IF v_report.onset_timing IS NULL THEN
      v_m := array_append(v_m, 'Onset timing');
      v_f := v_f || jsonb_build_object('id', 'skincare_onset_timing', 'label', 'Onset timing');
    END IF;
    IF v_report.discontinued_use IS NULL THEN
      v_m := array_append(v_m, 'Discontinued use');
      v_f := v_f || jsonb_build_object('id', 'skincare_discontinued_use', 'label', 'Discontinued use');
    END IF;
    IF coalesce(v_report.resolution_status, '') = '' THEN
      v_m := array_append(v_m, 'Resolution status');
      v_f := v_f || jsonb_build_object('id', 'skincare_resolution_status', 'label', 'Resolution status');
    END IF;
  END IF;

  missing := v_m;
  fields := v_f;
END
$$;

COMMENT ON FUNCTION public.adr_icsr_missing(uuid) IS
  'Shared ICSR gate core (Phase 3: + contact route with facility fallback, + skincare parity). Returns missing labels + coded fields. Call only for an authorized report_id.';

REVOKE EXECUTE ON FUNCTION public.adr_icsr_missing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_icsr_missing(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- submit_adr_report - same behavior via new core shape (still INVOKER)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_adr_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_report adr_reports;
  v_gate record;
  v_is_serious boolean;
  v_deadline timestamptz;
BEGIN
  SELECT * INTO v_report FROM adr_reports WHERE report_id = p_report_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'missing', jsonb_build_array('Report not found or not accessible'));
  END IF;

  IF v_report.status <> 'draft' THEN
    RETURN jsonb_build_object('valid', false, 'missing', jsonb_build_array('Only draft reports can be submitted'));
  END IF;

  SELECT * INTO v_gate FROM public.adr_icsr_missing(p_report_id);
  IF cardinality(v_gate.missing) > 0 THEN
    RETURN jsonb_build_object('valid', false, 'missing', to_jsonb(v_gate.missing), 'missingFields', v_gate.fields);
  END IF;

  SELECT bool_or(
    b.seriousness_death OR b.seriousness_life_threatening OR b.seriousness_hospitalization
    OR b.seriousness_disability OR b.seriousness_congenital_anomaly OR b.seriousness_other_medically_important
  )
  FROM adr_report_reactions b
  WHERE b.report_id = p_report_id
  INTO v_is_serious;

  v_deadline := public.adr_compute_deadline(
    v_report.created_at, v_is_serious,
    v_report.reaction_expected, v_report.new_safety_signal);

  UPDATE adr_reports
     SET status = 'submitted',
         submission_deadline = v_deadline,
         gate_validated_at = now()
   WHERE report_id = p_report_id;

  RETURN jsonb_build_object('valid', true, 'report_id', p_report_id,
                            'status', 'submitted', 'submission_deadline', v_deadline);
END
$$;

-- ----------------------------------------------------------------------------
-- submit_adr_public_report - shared core (contact now covered there with the
-- same label) + facility-anon and ternary extras, coded fields attached
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_adr_public_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report adr_reports;
  v_gate record;
  v_public_missing text[] := '{}';
  v_public_fields jsonb := '[]'::jsonb;
  v_ternary_ok boolean;
  v_is_serious boolean;
  v_deadline timestamptz;
BEGIN
  SELECT * INTO v_report FROM adr_reports WHERE report_id = p_report_id;
  IF NOT FOUND
     OR v_report.report_source IS DISTINCT FROM 'public'
     OR v_report.reporter_auth_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('valid', false, 'missing', jsonb_build_array('Report not found or not accessible'));
  END IF;

  IF v_report.status <> 'draft' THEN
    RETURN jsonb_build_object('valid', false, 'missing', jsonb_build_array('Only draft reports can be submitted'));
  END IF;

  -- Anonymous reports need a facility identity behind them.
  IF coalesce(trim(both from v_report.reporter_name), '') = ''
     AND NOT (v_report.reporter_anonymous_confirmed_by_facility IS TRUE
              AND coalesce(trim(both from v_report.reporter_facility_name), '') <> '') THEN
    v_public_missing := array_append(v_public_missing, 'Reporter name');
    v_public_fields := v_public_fields || jsonb_build_object('id', 'reporter_name', 'label', 'Reporter name');
  END IF;

  -- Ternary seriousness proof on EVERY reaction row (Not-sure stays distinct).
  SELECT NOT EXISTS(
    SELECT 1 FROM adr_report_reactions
    WHERE report_id = p_report_id AND seriousness_unknown IS NULL
  ) INTO v_ternary_ok;
  IF NOT v_ternary_ok THEN
    v_public_missing := array_append(v_public_missing, 'Seriousness answers');
    v_public_fields := v_public_fields || jsonb_build_object('id', 'seriousness_fields', 'label', 'Seriousness answers');
  END IF;

  SELECT * INTO v_gate FROM public.adr_icsr_missing(p_report_id);
  IF cardinality(v_gate.missing) > 0 OR cardinality(v_public_missing) > 0 THEN
    RETURN jsonb_build_object(
      'valid', false,
      'missing', to_jsonb(v_public_missing || v_gate.missing),
      'missingFields', v_public_fields || v_gate.fields);
  END IF;

  SELECT bool_or(
    b.seriousness_death OR b.seriousness_life_threatening OR b.seriousness_hospitalization
    OR b.seriousness_disability OR b.seriousness_congenital_anomaly OR b.seriousness_other_medically_important
  )
  FROM adr_report_reactions b
  WHERE b.report_id = p_report_id
  INTO v_is_serious;

  v_deadline := public.adr_compute_deadline(
    v_report.created_at, v_is_serious,
    v_report.reaction_expected, v_report.new_safety_signal);

  UPDATE adr_reports
     SET status = 'submitted',
         submission_deadline = v_deadline,
         gate_validated_at = now()
   WHERE report_id = p_report_id;

  RETURN jsonb_build_object('valid', true, 'report_id', p_report_id,
                            'status', 'submitted', 'submission_deadline', v_deadline);
END
$$;

-- ----------------------------------------------------------------------------
-- verify_adr_product_route - refuse unverified-case verification
-- (manual candidates still rejected; now unvalidated reports are too)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_adr_product_route(
  p_route_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_route adr_product_company_routes;
  v_actor record;
  v_validated timestamptz;
  v_status text;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT * INTO v_route FROM adr_product_company_routes WHERE route_id = p_route_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'route not found';
  END IF;

  IF v_route.selection_kind = 'unverified_candidate' THEN
    RAISE EXCEPTION 'manual candidates cannot be verified into access; register the business first';
  END IF;

  SELECT r.gate_validated_at INTO v_validated
    FROM adr_reports r WHERE r.report_id = v_route.report_id;
  IF v_validated IS NULL THEN
    RAISE EXCEPTION 'report has not passed validation';
  END IF;

  IF v_route.selection_kind = 'verified'
     AND NOT public.is_eligible_product_company(v_route.responsible_business_id) THEN
    RAISE EXCEPTION 'business is no longer an eligible active Importer/Manufacturer';
  END IF;

  v_status := CASE WHEN v_route.selection_kind = 'verified' THEN 'routed' ELSE 'verified' END;

  SELECT * INTO v_actor FROM adr_event_actor(v_route.report_id);

  UPDATE adr_product_company_routes
     SET status = v_status,
         verified_at = now(),
         verified_by = auth.uid(),
         verification_notes = p_notes
   WHERE route_id = p_route_id;

  INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
  VALUES (v_route.report_id, 'routing_verified', v_actor.actor_type, v_actor.actor_name,
          jsonb_build_object('route_id', p_route_id, 'status', v_status));

  RETURN jsonb_build_object('route_id', p_route_id, 'status', v_status);
END
$$;
