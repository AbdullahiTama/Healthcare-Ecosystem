-- ============================================================================
-- ADR Reporting Module - Phase 1 (Unified PV): routing foundation
--
-- Status: REVIEW ONLY — do NOT apply to production without PV/regulatory
--         and privacy sign-off (see master prompt §14).
--
-- Additive only. Preserves the existing Hub form, validation gate
-- (submit_adr_report) and per-user visibility. Nothing existing is
-- renamed, narrowed or dropped:
--   - adr_reports gains report_source / origin_channel_detail /
--     deadline_rule_version (all nullable-or-defaulted) and business_id
--     becomes nullable (widening for future public reports, which have no
--     submitting business). Existing rows keep their business_id.
--   - business_aliases stores approved search aliases for eligible
--     Importer/Manufacturer businesses (no parallel registry; FK to
--     businesses, names only, no confidential columns).
--   - adr_product_company_routes stores ONE row per product/company
--     selection: verified selection, explicit unknown, or unverified
--     manual candidate. Multiple rows per product are ALLOWED (Hub
--     multi-company cardinality unresolved — no new uniqueness beyond the
--     idempotency key; the public single-company rule is enforced at the
--     application layer in Phase 2, not by DB constraint).
--   - adr_report_events event_type CHECK is widened (existing 4 values
--     kept) for routing/verification audit events.
--   - New RPCs: create_adr_product_route (idempotent, SECURITY DEFINER
--     following the adr_log_event precedent), verify_adr_product_route
--     (platform-admin only), search_eligible_product_companies (public
--     type-ahead, non-confidential columns only).
--   - adr_report_analytics gains report_source (additive).
--
-- Security notes:
--   - Manual candidate text NEVER grants access: the routes SELECT policy
--     only exposes rows with status='routed' AND a responsible_business_id
--     in the caller's tenant. Pending/unverified/candidate rows are visible
--     only via can_access_adr_report(report_id) (submitter/admin chain).
--   - Public reports (business_id NULL) resolve to admin-only under the
--     existing can_access_adr_report_row helper (NULL IN (...) is never
--     true) until Phase 4 extends responsible-company visibility. This is
--     intentional and documented, not a gap.
--   - All new functions pin search_path = public; EXECUTE revoked from
--     PUBLIC+anon, granted to authenticated (verify RPC additionally gates
--     on is_platform_admin() inside the body).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. adr_reports - source classification + nullable submitter + rule version
-- ----------------------------------------------------------------------------
ALTER TABLE adr_reports
  ADD COLUMN IF NOT EXISTS report_source text NOT NULL DEFAULT 'unknown'
    CHECK (report_source IN ('public','health_facility','business_facility','unknown')),
  ADD COLUMN IF NOT EXISTS origin_channel_detail text,
  ADD COLUMN IF NOT EXISTS deadline_rule_version text;

-- Widening only: public reports have no submitting business.
ALTER TABLE adr_reports ALTER COLUMN business_id DROP NOT NULL;

-- Existing Hub rows came through a registered business account.
UPDATE adr_reports
   SET report_source = 'business_facility'
 WHERE report_source = 'unknown' AND business_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_adr_reports_source ON adr_reports(report_source);

-- ----------------------------------------------------------------------------
-- 2. business_aliases - approved search aliases for eligible businesses
--    (names only; no confidential columns; NOT a parallel registry)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_aliases (
  alias_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text GENERATED ALWAYS AS
    (lower(regexp_replace(trim(both from alias), '\s+', ' ', 'g'))) STORED,
  is_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_business_aliases_normalized ON business_aliases(normalized_alias);
CREATE INDEX IF NOT EXISTS idx_business_aliases_business ON business_aliases(business_id);

ALTER TABLE business_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "business_aliases authenticated read" ON business_aliases;
CREATE POLICY "business_aliases authenticated read" ON business_aliases
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "business_aliases admin write" ON business_aliases;
CREATE POLICY "business_aliases admin write" ON business_aliases
  FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

COMMENT ON TABLE business_aliases IS
  'Approved search aliases for business type-ahead (ADR product-owner selection). Names only; FK to businesses, never a parallel registry.';

-- ----------------------------------------------------------------------------
-- 3. adr_product_company_routes - per-product responsible-company selection
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adr_product_company_routes (
  route_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES adr_reports(report_id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES adr_report_products(product_id) ON DELETE CASCADE,
  responsible_business_id uuid REFERENCES businesses(id) ON DELETE RESTRICT,
  candidate_name text,
  normalized_candidate text,
  selection_kind text NOT NULL
    CHECK (selection_kind IN ('verified','unknown','unverified_candidate')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','verified','routed')),
  idempotency_key text NOT NULL UNIQUE,
  verified_at timestamptz,
  verified_by uuid,
  verification_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (selection_kind = 'verified' AND responsible_business_id IS NOT NULL AND candidate_name IS NULL)
    OR (selection_kind = 'unknown' AND responsible_business_id IS NULL AND candidate_name IS NULL)
    OR (selection_kind = 'unverified_candidate' AND responsible_business_id IS NULL AND candidate_name IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_adr_routes_report ON adr_product_company_routes(report_id);
CREATE INDEX IF NOT EXISTS idx_adr_routes_product ON adr_product_company_routes(product_id);
CREATE INDEX IF NOT EXISTS idx_adr_routes_responsible ON adr_product_company_routes(responsible_business_id, status);

ALTER TABLE adr_product_company_routes ENABLE ROW LEVEL SECURITY;

-- Read: submitter chain (via parent report) OR the verified responsible org
-- once the route is verified/routed. Candidates never satisfy the second
-- branch (responsible_business_id IS NULL), so a typed name grants nothing.
DROP POLICY IF EXISTS "adr_routes select" ON adr_product_company_routes;
CREATE POLICY "adr_routes select" ON adr_product_company_routes
  FOR SELECT
  USING (
    public.can_access_adr_report(report_id)
    OR (
      status IN ('verified','routed')
      AND responsible_business_id IS NOT NULL
      AND responsible_business_id IN (SELECT public.current_business_ids())
    )
  );

-- Write: submitters/admins only. Responsible companies cannot self-assign.
DROP POLICY IF EXISTS "adr_routes insert" ON adr_product_company_routes;
CREATE POLICY "adr_routes insert" ON adr_product_company_routes
  FOR INSERT
  WITH CHECK (public.can_access_adr_report(report_id) OR is_platform_admin());

DROP POLICY IF EXISTS "adr_routes update" ON adr_product_company_routes;
CREATE POLICY "adr_routes update" ON adr_product_company_routes
  FOR UPDATE
  USING (public.can_access_adr_report(report_id) OR is_platform_admin())
  WITH CHECK (public.can_access_adr_report(report_id) OR is_platform_admin());

DROP POLICY IF EXISTS "adr_routes delete" ON adr_product_company_routes;
CREATE POLICY "adr_routes delete" ON adr_product_company_routes
  FOR DELETE
  USING (public.can_access_adr_report(report_id) OR is_platform_admin());

COMMENT ON TABLE adr_product_company_routes IS
  'Per-product responsible-company selection. verified = registered Importer/Manufacturer; unknown = explicit I-don''t-know; unverified_candidate = manual text, never grants access. No per-product uniqueness: Hub multi-company cardinality unresolved.';

-- ----------------------------------------------------------------------------
-- 4. adr_report_events - widen event_type (existing values preserved)
-- ----------------------------------------------------------------------------
ALTER TABLE adr_report_events DROP CONSTRAINT IF EXISTS adr_report_events_event_type_check;
ALTER TABLE adr_report_events
  ADD CONSTRAINT adr_report_events_event_type_check
  CHECK (event_type IN (
    'created','status_changed','exported','note',
    'routing_created','routing_verified','routing_routed',
    'verification_recorded','history_linked'
  ));

-- ----------------------------------------------------------------------------
-- 5. Helpers + RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_eligible_product_company(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = p_business_id
      AND b.status = 'active'
      AND b.business_type IN ('manufacturer_importer', 'wholesale')
  )
$$;

COMMENT ON FUNCTION public.is_eligible_product_company(uuid) IS
  'True when the business is an active registered Importer/Manufacturer (manufacturer_importer) or wholesaler. Single gate for ADR product-owner eligibility.';

REVOKE EXECUTE ON FUNCTION public.is_eligible_product_company(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_eligible_product_company(uuid) TO authenticated;

-- Idempotent per-product route creation. SECURITY DEFINER (adr_log_event
-- precedent): explicit access/product/eligibility checks inside, then the
-- write bypasses the append-only events RLS for the audit row.
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

  -- Caller must reach the parent report through the submitter/admin chain.
  -- (Responsible companies gain read access only after verification; they
  -- cannot create routes for themselves.)
  IF NOT public.can_access_adr_report(p_report_id) AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not accessible';
  END IF;

  -- Product must belong to the report (prevents cross-case linkage).
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

  -- Idempotent retry: return the existing row for this key.
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

COMMENT ON FUNCTION public.create_adr_product_route(uuid, uuid, text, uuid, text, text) IS
  'Idempotent per-product company selection. Manual candidate text never verifies or grants access. Logs routing_created (first write only).';

REVOKE EXECUTE ON FUNCTION public.create_adr_product_route(uuid, uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_adr_product_route(uuid, uuid, text, uuid, text, text) TO authenticated;

-- Verification by platform admin only. Links the route (verified/routed)
-- without touching the original report row or its submitting business.
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

COMMENT ON FUNCTION public.verify_adr_product_route(uuid, text) IS
  'Platform-admin verification of a product-company route. Never verifies manual candidates; never rewrites the original report.';

REVOKE EXECUTE ON FUNCTION public.verify_adr_product_route(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_adr_product_route(uuid, text) TO authenticated;

-- Type-ahead for the public label
-- "Company responsible for this medicine/product in your country (if known)".
-- Returns eligible businesses + approved aliases only; no confidential data.
--
-- SECURITY DEFINER (deliberate, narrow): businesses RLS is "own row only",
-- so an INVOKER function could never list other companies. This function
-- bypasses that for exactly five non-confidential columns (id, name, type,
-- state, city) of active Importer/Manufacturer businesses — the same fields
-- already public on the CareFind directory (visible_on_carefind). No contact
-- details, no financials, no report data pass through it.
CREATE OR REPLACE FUNCTION public.search_eligible_product_companies(
  p_query text,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(business_id uuid, business_name text, business_type text, state text, city text, matched_alias text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.name, b.business_type, b.state, b.city, NULL::text
  FROM businesses b
  WHERE b.status = 'active'
    AND b.business_type IN ('manufacturer_importer', 'wholesale')
    AND (
      p_query IS NULL OR length(trim(both from p_query)) = 0
      OR b.name ILIKE '%' || trim(both from p_query) || '%'
    )
  UNION
  SELECT b.id, b.name, b.business_type, b.state, b.city, a.alias
  FROM business_aliases a
  JOIN businesses b ON b.id = a.business_id
  WHERE a.is_approved IS TRUE
    AND b.status = 'active'
    AND b.business_type IN ('manufacturer_importer', 'wholesale')
    AND p_query IS NOT NULL AND length(trim(both from p_query)) > 0
    AND (a.normalized_alias ILIKE '%' || lower(trim(both from p_query)) || '%'
         OR b.name ILIKE '%' || trim(both from p_query) || '%')
  ORDER BY 2
  LIMIT LEAST(GREATEST(coalesce(p_limit, 20), 1), 50)
$$;

COMMENT ON FUNCTION public.search_eligible_product_companies(text, integer) IS
  'Type-ahead for product-owner selection: active Importer/Manufacturer businesses plus approved aliases. Non-confidential columns only.';

REVOKE EXECUTE ON FUNCTION public.search_eligible_product_companies(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_eligible_product_companies(text, integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. adr_report_analytics - add report_source (additive; stays invoker)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.adr_report_analytics
WITH (security_invoker = true) AS
SELECT
  r.report_id,
  r.report_number,
  r.business_id,
  r.module_type,
  r.status,
  r.report_source,
  r.created_at,
  r.submission_deadline,
  r.reaction_expected,
  r.new_safety_signal,
  COALESCE(bool_or(
    x.seriousness_death OR x.seriousness_life_threatening OR x.seriousness_hospitalization
    OR x.seriousness_disability OR x.seriousness_congenital_anomaly OR x.seriousness_other_medically_important
  ), false) AS is_serious
FROM adr_reports r
LEFT JOIN adr_report_reactions x ON x.report_id = r.report_id
GROUP BY r.report_id;

COMMENT ON VIEW public.adr_report_analytics IS
  'ADR analytics projection. SECURITY INVOKER so RLS scopes rows to the caller. Phase 1: + report_source.';
