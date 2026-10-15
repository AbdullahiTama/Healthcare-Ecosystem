-- ============================================================================
-- ADR Reporting Module - Phase 2: public-draft access + validity stamp
--
-- Status: REVIEW ONLY — do NOT apply to production without PV/regulatory
--         and privacy sign-off (see master prompt §14).
--
-- Additive only. Hub behavior is preserved byte-for-behavior:
--   - submit_adr_report() keeps SECURITY INVOKER and delegates its gate to
--     the new shared adr_icsr_missing() core (gates 1-15 unchanged).
--   - No existing RLS branch is narrowed; public branches are OR-ed in.
--   - Direct reporter PATCH can never flip draft->submitted (WITH CHECK
--     draft-only); only the RPCs flip status, and only the public RPC is
--     reachable by public reporters.
-- Adds:
--   - adr_reports.reporter_auth_user_id (CareFind auth user owning a public
--     report; NULL for all Hub rows).
--   - adr_report_reactions.seriousness_unknown text[] (which of the six
--     criteria the reporter answered "Not sure"; NULL = ternary UI not used).
--     Hub rows stay NULL and are never checked for it.
--   - adr_reports.gate_validated_at (set only by a passing submit RPC, so a
--     hand-flipped 'submitted' status is distinguishable from a validated one).
--   - Helpers can_access_adr_public_draft_row / can_access_adr_public_draft /
--     can_write_adr_public_draft; shared adr_icsr_missing + adr_compute_deadline;
--     RPC submit_adr_public_report (DEFINER, owner-of-public-draft only).
--   - Private bucket adr-private with owner-folder storage policies.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. New columns (additive, nullable)
-- ----------------------------------------------------------------------------
ALTER TABLE adr_reports
  ADD COLUMN IF NOT EXISTS reporter_auth_user_id uuid,
  ADD COLUMN IF NOT EXISTS gate_validated_at timestamptz;

ALTER TABLE adr_report_reactions
  ADD COLUMN IF NOT EXISTS seriousness_unknown text[] CHECK (
    seriousness_unknown IS NULL OR (
      array_length(seriousness_unknown, 1) IS NULL OR
      seriousness_unknown <@ ARRAY[
        'death','life_threatening','hospitalization',
        'disability','congenital_anomaly','other_medically_important'
      ]
    )
  );

CREATE INDEX IF NOT EXISTS idx_adr_reports_public_owner
  ON adr_reports(reporter_auth_user_id) WHERE report_source = 'public';

-- ----------------------------------------------------------------------------
-- 2. Public-draft access helpers
--    Row-helper (columns only — safe for adr_reports' own policies, avoiding
--    the INSERT...RETURNING self-read trap); report-helpers for child tables,
--    events, routes and RPCs (parent row always exists there first).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_adr_public_draft_row(
  p_report_source text,
  p_reporter_auth_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_report_source = 'public'
    AND p_reporter_auth_user_id IS NOT NULL
    AND p_reporter_auth_user_id = auth.uid()
$$;

COMMENT ON FUNCTION public.can_access_adr_public_draft_row(text, uuid) IS
  'Public-report ownership from the row columns (any status). For adr_reports policies only.';

CREATE OR REPLACE FUNCTION public.can_access_adr_public_draft(p_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM adr_reports r
    WHERE r.report_id = p_report_id
      AND r.report_source = 'public'
      AND r.reporter_auth_user_id = auth.uid()
  )
$$;

COMMENT ON FUNCTION public.can_access_adr_public_draft(uuid) IS
  'Public-report read access (any status) for child tables, events, routes.';

CREATE OR REPLACE FUNCTION public.can_write_adr_public_draft(p_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM adr_reports r
    WHERE r.report_id = p_report_id
      AND r.report_source = 'public'
      AND r.status = 'draft'
      AND r.reporter_auth_user_id = auth.uid()
  )
$$;

COMMENT ON FUNCTION public.can_write_adr_public_draft(uuid) IS
  'Public-draft mutation access (draft status only). Submitted originals are immutable to reporters.';

REVOKE EXECUTE ON FUNCTION public.can_access_adr_public_draft_row(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_adr_public_draft_row(text, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.can_access_adr_public_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_adr_public_draft(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.can_write_adr_public_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write_adr_public_draft(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Shared ICSR gate core + deadline calculator
--    SECURITY DEFINER: callers must authorize p_report_id first (both submit
--    RPCs do). Reads are scoped to the single authorized report.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adr_icsr_missing(p_report_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report adr_reports;
  v_missing text[] := '{}';
  v_has_products boolean;
  v_has_brand boolean;
  v_has_reactions boolean;
  v_has_desc boolean;
  v_has_severity boolean;
  v_has_outcome boolean;
  v_seriousness_ok boolean;
BEGIN
  SELECT * INTO v_report FROM adr_reports WHERE report_id = p_report_id;
  IF NOT FOUND THEN
    RETURN ARRAY['Report not found or not accessible'];
  END IF;

  IF coalesce(v_report.reporter_qualification, '') = '' THEN
    v_missing := v_missing || 'Reporter qualification';
  END IF;

  IF coalesce(v_report.reporter_name, '') = ''
     AND v_report.reporter_anonymous_confirmed_by_facility IS NOT TRUE THEN
    v_missing := v_missing || 'Reporter name';
  END IF;

  IF v_report.reporter_consent_followup IS NULL THEN
    v_missing := v_missing || 'Reporter consent for follow-up';
  END IF;

  IF coalesce(v_report.patient_identifier, '') = '' THEN
    v_missing := v_missing || 'Patient identifier';
  END IF;

  IF v_report.patient_age IS NULL AND v_report.patient_dob IS NULL
     AND coalesce(v_report.patient_age_group, '') = '' THEN
    v_missing := v_missing || 'Patient age or DOB or age group';
  END IF;

  IF coalesce(v_report.patient_gender, '') = '' THEN
    v_missing := v_missing || 'Patient gender';
  END IF;

  SELECT EXISTS(SELECT 1 FROM adr_report_products WHERE report_id = p_report_id)
    INTO v_has_products;
  IF NOT v_has_products THEN
    v_missing := v_missing || 'At least one suspect product';
  ELSE
    SELECT EXISTS(SELECT 1 FROM adr_report_products
                   WHERE report_id = p_report_id
                     AND coalesce(product_brand_name, '') <> '')
      INTO v_has_brand;
    IF NOT v_has_brand THEN
      v_missing := v_missing || 'Product brand name';
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM adr_report_reactions WHERE report_id = p_report_id)
    INTO v_has_reactions;
  IF NOT v_has_reactions THEN
    v_missing := v_missing || 'At least one adverse reaction';
  ELSE
    SELECT EXISTS(SELECT 1 FROM adr_report_reactions
                   WHERE report_id = p_report_id
                     AND coalesce(reaction_description, '') <> '')
      INTO v_has_desc;
    IF NOT v_has_desc THEN
      v_missing := v_missing || 'Reaction description';
    END IF;

    SELECT EXISTS(SELECT 1 FROM adr_report_reactions
                   WHERE report_id = p_report_id AND severity IS NOT NULL)
      INTO v_has_severity;
    IF NOT v_has_severity THEN
      v_missing := v_missing || 'Severity';
    END IF;

    SELECT EXISTS(SELECT 1 FROM adr_report_reactions
                   WHERE report_id = p_report_id AND outcome IS NOT NULL)
      INTO v_has_outcome;
    IF NOT v_has_outcome THEN
      v_missing := v_missing || 'Outcome';
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
      v_missing := v_missing || 'All six seriousness fields';
    END IF;
  END IF;

  IF v_report.module_type = 'industry' THEN
    IF coalesce(v_report.batch_lot_number, '') = '' THEN
      v_missing := v_missing || 'Batch/lot number';
    END IF;
    IF coalesce(v_report.causality_assessment, '') = '' THEN
      v_missing := v_missing || 'Causality assessment';
    END IF;
    IF coalesce(v_report.case_narrative_summary, '') = '' THEN
      v_missing := v_missing || 'Case narrative summary';
    END IF;
  END IF;

  IF v_report.module_type = 'hospital' THEN
    IF coalesce(v_report.ward_department, '') = '' THEN
      v_missing := v_missing || 'Ward/department';
    END IF;
    IF coalesce(v_report.attending_physician, '') = '' THEN
      v_missing := v_missing || 'Attending physician';
    END IF;
  END IF;

  RETURN v_missing;
END
$$;

COMMENT ON FUNCTION public.adr_icsr_missing(uuid) IS
  'Shared ICSR gate core (gates 1-15, identical to the live submit_adr_report). Call only for an authorized report_id.';

CREATE OR REPLACE FUNCTION public.adr_compute_deadline(
  p_created_at timestamptz,
  p_is_serious boolean,
  p_reaction_expected boolean,
  p_new_safety_signal boolean
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_new_safety_signal IS TRUE THEN p_created_at + interval '3 days'
    WHEN p_is_serious AND p_reaction_expected IS NOT TRUE THEN p_created_at + interval '72 hours'
    WHEN p_is_serious THEN p_created_at + interval '15 days'
    WHEN p_reaction_expected IS NOT TRUE THEN p_created_at + interval '15 days'
    ELSE p_created_at + interval '90 days'
  END
$$;

COMMENT ON FUNCTION public.adr_compute_deadline(timestamptz, boolean, boolean, boolean) IS
  'Shared deadline rule. Values are the supplied brief table (unverified vs current NAFDAC rules); store rule version in deadline_rule_version.';

REVOKE EXECUTE ON FUNCTION public.adr_icsr_missing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_icsr_missing(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.adr_compute_deadline(timestamptz, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_compute_deadline(timestamptz, boolean, boolean, boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. submit_adr_report - same gate via shared core (still SECURITY INVOKER)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_adr_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_report adr_reports;
  v_missing text[];
  v_is_serious boolean;
  v_deadline timestamptz;
BEGIN
  -- RLS applies here (SECURITY INVOKER): another tenant's report_id resolves
  -- to nothing, so `not found` is both the correctness and security path.
  SELECT * INTO v_report FROM adr_reports WHERE report_id = p_report_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'missing', jsonb_build_array('Report not found or not accessible'));
  END IF;

  IF v_report.status <> 'draft' THEN
    RETURN jsonb_build_object('valid', false, 'missing', jsonb_build_array('Only draft reports can be submitted'));
  END IF;

  v_missing := public.adr_icsr_missing(p_report_id);
  IF cardinality(v_missing) > 0 THEN
    RETURN jsonb_build_object('valid', false, 'missing', to_jsonb(v_missing));
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

COMMENT ON FUNCTION public.submit_adr_report(uuid) IS
  'Server-side IS_VALID_ICSR gate (delegates to adr_icsr_missing). Draft-only; SECURITY INVOKER so RLS scopes the report read. Sets gate_validated_at.';

-- ----------------------------------------------------------------------------
-- 5. submit_adr_public_report - public-channel submit (SECURITY DEFINER)
--    Owner-of-public-draft only. Shared gate PLUS public extras: usable
--    contact route, and ternary seriousness proof (seriousness_unknown
--    present on every reaction — Not-sure stays distinct from No).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_adr_public_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report adr_reports;
  v_missing text[];
  v_public_missing text[] := '{}';
  v_has_contact boolean;
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

  -- Public extra 1: usable contact route (reporter or facility contact).
  -- COALESCE the LIKE: a NULL email must fail, not short-circuit to NULL.
  v_has_contact :=
    coalesce(trim(both from v_report.reporter_phone), '') <> ''
    OR coalesce(v_report.reporter_email LIKE '%@%.%', false);
  IF NOT v_has_contact THEN
    v_public_missing := v_public_missing || 'Reporter phone or email';
  END IF;

  -- Public extra 2: anonymous reports need a facility identity behind them.
  IF coalesce(trim(both from v_report.reporter_name), '') = ''
     AND NOT (v_report.reporter_anonymous_confirmed_by_facility IS TRUE
              AND coalesce(trim(both from v_report.reporter_facility_name), '') <> '') THEN
    v_public_missing := v_public_missing || 'Reporter name';
  END IF;

  -- Public extra 3: ternary seriousness proof on EVERY reaction row.
  SELECT NOT EXISTS(
    SELECT 1 FROM adr_report_reactions
    WHERE report_id = p_report_id AND seriousness_unknown IS NULL
  ) INTO v_ternary_ok;
  IF NOT v_ternary_ok THEN
    v_public_missing := v_public_missing || 'Seriousness answers';
  END IF;

  v_missing := public.adr_icsr_missing(p_report_id);
  IF cardinality(v_missing) > 0 OR cardinality(v_public_missing) > 0 THEN
    RETURN jsonb_build_object(
      'valid', false,
      'missing', to_jsonb(v_public_missing || v_missing));
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

COMMENT ON FUNCTION public.submit_adr_public_report(uuid) IS
  'Public-channel submit: owner-of-public-draft only. Shared ICSR gate plus contact-route and ternary-seriousness extras. Sets gate_validated_at.';

REVOKE EXECUTE ON FUNCTION public.submit_adr_public_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_adr_public_report(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. create_adr_product_route - also accept public-draft writers (draft-only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_adr_product_route(
  p_report_id uuid,
  p_product_id uuid,
  p_selection_kind text,
  p_responsible_business_id uuid DEFAULT NULL,
  p_candidate_name text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_candidate text;
  v_norm text;
  v_route adr_product_company_routes;
BEGIN
  IF p_selection_kind NOT IN ('verified','unknown','unverified_candidate') THEN
    RAISE EXCEPTION 'invalid selection_kind %', p_selection_kind;
  END IF;

  -- Submitter chain, platform admin, or the public-draft owner (draft only —
  -- routes must precede submit; submitted originals are immutable).
  IF NOT public.can_access_adr_report(p_report_id)
     AND NOT public.can_write_adr_public_draft(p_report_id) THEN
    RAISE EXCEPTION 'not accessible';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM adr_report_products p
    WHERE p.product_id = p_product_id AND p.report_id = p_report_id
  ) THEN
    RAISE EXCEPTION 'product does not belong to report';
  END IF;

  IF p_selection_kind = 'verified' THEN
    IF p_responsible_business_id IS NULL OR p_candidate_name IS NOT NULL THEN
      RAISE EXCEPTION 'verified selection requires a business and no candidate text';
    END IF;
    IF NOT public.is_eligible_product_company(p_responsible_business_id) THEN
      RAISE EXCEPTION 'business is not an eligible active Importer/Manufacturer';
    END IF;
  ELSIF p_selection_kind = 'unknown' THEN
    IF p_responsible_business_id IS NOT NULL OR p_candidate_name IS NOT NULL THEN
      RAISE EXCEPTION 'unknown selection carries no company reference';
    END IF;
  ELSE
    IF p_responsible_business_id IS NOT NULL
       OR p_candidate_name IS NULL
       OR length(trim(both from p_candidate_name)) = 0 THEN
      RAISE EXCEPTION 'unverified candidate requires non-empty manual text only';
    END IF;
    v_candidate := trim(both from p_candidate_name);
    v_norm := lower(regexp_replace(v_candidate, '\s+', ' ', 'g'));
  END IF;

  v_key := nullif(trim(both from coalesce(p_idempotency_key, '')), '');
  IF v_key IS NULL THEN
    v_key := p_report_id::text || ':' || p_product_id::text || ':' || p_selection_kind
      || ':' || coalesce(p_responsible_business_id::text, '')
      || ':' || coalesce(v_norm, '');
  END IF;

  INSERT INTO adr_product_company_routes
    (report_id, product_id, responsible_business_id, candidate_name,
     normalized_candidate, selection_kind, status, idempotency_key)
  VALUES
    (p_report_id, p_product_id, p_responsible_business_id,
     CASE WHEN p_selection_kind = 'unverified_candidate' THEN v_candidate END,
     CASE WHEN p_selection_kind = 'unverified_candidate' THEN v_norm END,
     p_selection_kind, 'pending', v_key)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_route;

  IF NOT FOUND THEN
    SELECT * INTO v_route FROM adr_product_company_routes WHERE idempotency_key = v_key;
  ELSE
    INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
    SELECT p_report_id, 'routing_created', a.actor_type, a.actor_name,
           jsonb_build_object('route_id', v_route.route_id, 'selection_kind', p_selection_kind)
      FROM adr_event_actor(p_report_id) a;
  END IF;

  RETURN jsonb_build_object(
    'route_id', v_route.route_id,
    'report_id', v_route.report_id,
    'product_id', v_route.product_id,
    'selection_kind', v_route.selection_kind,
    'status', v_route.status
  );
END
$$;

-- ----------------------------------------------------------------------------
-- 7. adr_reports policies - OR in the public-owner branches (row-based)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "adr_reports select" ON adr_reports;
DROP POLICY IF EXISTS "adr_reports insert" ON adr_reports;
DROP POLICY IF EXISTS "adr_reports update" ON adr_reports;
DROP POLICY IF EXISTS "adr_reports delete" ON adr_reports;

CREATE POLICY "adr_reports select" ON adr_reports
  FOR SELECT
  USING (
    public.can_access_adr_report_row(business_id, created_by_user_id)
    OR public.can_access_adr_public_draft_row(report_source, reporter_auth_user_id)
  );

-- Tenant inserts unchanged; public reporters may insert only their own
-- NULL-business public drafts.
CREATE POLICY "adr_reports insert" ON adr_reports
  FOR INSERT
  WITH CHECK (
    business_id IN (SELECT public.current_business_ids())
    OR is_platform_admin()
    OR (
      business_id IS NULL
      AND report_source = 'public'
      AND status = 'draft'
      AND reporter_auth_user_id = auth.uid()
    )
  );

-- Direct PATCH stays draft-bound for public reporters: draft->submitted flips
-- go through submit_adr_public_report only.
CREATE POLICY "adr_reports update" ON adr_reports
  FOR UPDATE
  USING (
    public.can_access_adr_report_row(business_id, created_by_user_id)
    OR public.can_access_adr_public_draft_row(report_source, reporter_auth_user_id)
  )
  WITH CHECK (
    public.can_access_adr_report_row(business_id, created_by_user_id)
    OR (
      public.can_access_adr_public_draft_row(report_source, reporter_auth_user_id)
      AND business_id IS NULL
      AND report_source = 'public'
      AND status = 'draft'
    )
  );

-- Owner may delete only their own still-draft public report. Submitted cases
-- are never hard-deleted as an editing mechanism.
CREATE POLICY "adr_reports delete" ON adr_reports
  FOR DELETE
  USING (
    public.can_access_adr_report_row(business_id, created_by_user_id)
    OR (
      public.can_access_adr_public_draft_row(report_source, reporter_auth_user_id)
      AND status = 'draft'
    )
  );

-- ----------------------------------------------------------------------------
-- 8. Child tables - SELECT gains read-helper; writes gain write-helper
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "adr_report_products via report" ON adr_report_products;
DROP POLICY IF EXISTS "adr_report_concomitant_meds via report" ON adr_report_concomitant_meds;
DROP POLICY IF EXISTS "adr_report_reactions via report" ON adr_report_reactions;
DROP POLICY IF EXISTS "adr_report_evidence_photos via report" ON adr_report_evidence_photos;

CREATE POLICY "adr_report_products read" ON adr_report_products
  FOR SELECT USING (
    public.can_access_adr_report(report_id) OR public.can_access_adr_public_draft(report_id));
CREATE POLICY "adr_report_products write" ON adr_report_products
  FOR ALL USING (
    public.can_access_adr_report(report_id) OR public.can_write_adr_public_draft(report_id))
  WITH CHECK (
    public.can_access_adr_report(report_id) OR public.can_write_adr_public_draft(report_id));

CREATE POLICY "adr_report_concomitant_meds read" ON adr_report_concomitant_meds
  FOR SELECT USING (
    public.can_access_adr_report(report_id) OR public.can_access_adr_public_draft(report_id));
CREATE POLICY "adr_report_concomitant_meds write" ON adr_report_concomitant_meds
  FOR ALL USING (
    public.can_access_adr_report(report_id) OR public.can_write_adr_public_draft(report_id))
  WITH CHECK (
    public.can_access_adr_report(report_id) OR public.can_write_adr_public_draft(report_id));

CREATE POLICY "adr_report_reactions read" ON adr_report_reactions
  FOR SELECT USING (
    public.can_access_adr_report(report_id) OR public.can_access_adr_public_draft(report_id));
CREATE POLICY "adr_report_reactions write" ON adr_report_reactions
  FOR ALL USING (
    public.can_access_adr_report(report_id) OR public.can_write_adr_public_draft(report_id))
  WITH CHECK (
    public.can_access_adr_report(report_id) OR public.can_write_adr_public_draft(report_id));

CREATE POLICY "adr_report_evidence_photos read" ON adr_report_evidence_photos
  FOR SELECT USING (
    public.can_access_adr_report(report_id) OR public.can_access_adr_public_draft(report_id));
CREATE POLICY "adr_report_evidence_photos write" ON adr_report_evidence_photos
  FOR ALL USING (
    public.can_access_adr_report(report_id) OR public.can_write_adr_public_draft(report_id))
  WITH CHECK (
    public.can_access_adr_report(report_id) OR public.can_write_adr_public_draft(report_id));

-- ----------------------------------------------------------------------------
-- 9. Routes table - same read/write split for public drafts
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "adr_routes select" ON adr_product_company_routes;
DROP POLICY IF EXISTS "adr_routes insert" ON adr_product_company_routes;
DROP POLICY IF EXISTS "adr_routes update" ON adr_product_company_routes;
DROP POLICY IF EXISTS "adr_routes delete" ON adr_product_company_routes;

CREATE POLICY "adr_routes select" ON adr_product_company_routes
  FOR SELECT
  USING (
    public.can_access_adr_report(report_id)
    OR public.can_access_adr_public_draft(report_id)
    OR (
      status IN ('verified','routed')
      AND responsible_business_id IS NOT NULL
      AND responsible_business_id IN (SELECT public.current_business_ids())
    )
  );

CREATE POLICY "adr_routes insert" ON adr_product_company_routes
  FOR INSERT
  WITH CHECK (
    public.can_access_adr_report(report_id)
    OR public.can_write_adr_public_draft(report_id)
    OR is_platform_admin()
  );

CREATE POLICY "adr_routes update" ON adr_product_company_routes
  FOR UPDATE
  USING (
    public.can_access_adr_report(report_id)
    OR public.can_write_adr_public_draft(report_id)
    OR is_platform_admin()
  )
  WITH CHECK (
    public.can_access_adr_report(report_id)
    OR public.can_write_adr_public_draft(report_id)
    OR is_platform_admin()
  );

CREATE POLICY "adr_routes delete" ON adr_product_company_routes
  FOR DELETE
  USING (
    public.can_access_adr_report(report_id)
    OR public.can_write_adr_public_draft(report_id)
    OR is_platform_admin()
  );

-- ----------------------------------------------------------------------------
-- 10. Events read - owners see their own report timeline
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "adr_report_events read via report" ON adr_report_events;
CREATE POLICY "adr_report_events read via report" ON adr_report_events
  FOR SELECT
  USING (
    public.can_access_adr_report(report_id)
    OR public.can_access_adr_public_draft(report_id)
  );

-- ----------------------------------------------------------------------------
-- 11. adr-private bucket - confidential attachments, owner-folder scoped
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('adr-private', 'adr-private', false, 10485760,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "adr-private owner insert" ON storage.objects;
CREATE POLICY "adr-private owner insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'adr-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "adr-private owner read" ON storage.objects;
CREATE POLICY "adr-private owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'adr-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "adr-private owner delete" ON storage.objects;
CREATE POLICY "adr-private owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'adr-private'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ----------------------------------------------------------------------------
-- 12. Analytics - expose the validity stamp (appended at END: CREATE OR
-- REPLACE VIEW matches columns positionally, so mid-list inserts fail with
-- 42P16; stays invoker)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.adr_report_analytics
WITH (security_invoker = true) AS
SELECT
  r.report_id,
  r.report_number,
  r.business_id,
  r.module_type,
  r.status,
  r.created_at,
  r.submission_deadline,
  r.reaction_expected,
  r.new_safety_signal,
  COALESCE(bool_or(
    x.seriousness_death OR x.seriousness_life_threatening OR x.seriousness_hospitalization
    OR x.seriousness_disability OR x.seriousness_congenital_anomaly OR x.seriousness_other_medically_important
  ), false) AS is_serious,
  r.report_source,
  r.gate_validated_at
FROM adr_reports r
LEFT JOIN adr_report_reactions x ON x.report_id = r.report_id
GROUP BY r.report_id;

COMMENT ON VIEW public.adr_report_analytics IS
  'ADR analytics projection. SECURITY INVOKER. Phase 2: + gate_validated_at (hand-flipped submitted rows lack the stamp).';
