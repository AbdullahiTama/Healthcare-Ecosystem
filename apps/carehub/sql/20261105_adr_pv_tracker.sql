-- ============================================================================
-- ADR Reporting Module - Phase 4: company PV Tracker backend
--
-- Status: REVIEW ONLY — do NOT apply to production without PV/regulatory
--         and privacy sign-off (see master prompt §14).
--
-- Additive only. Case rows stay write-locked for responsible companies:
--   - New READ axis: verified/routed responsible orgs may read routed cases
--     (report + children + events + private attachments) through
--     can_access_adr_routed_report(). No INSERT/UPDATE/DELETE grant changes
--     on any case table — silent overwrites are impossible by construction.
--   - adr_pv_case_view masks reporter identity/contact for responsible
--     companies (interim; privacy-lead decision pending — see Ruling 1).
--     Submitter chain + platform admin see full rows through the same view.
--   - Company workflow lives on the route row (company_status) via the
--     update_adr_route_workflow RPC (transition table enforced server-side);
--     assessments and follow-up requests are append-only rows with triggers.
--   - Ruling 2: follow-up requests flow company -> submitter only; the
--     submitter answers with versioned follow-up reports (existing
--     follow_up_of_report_id chain), never by editing the original.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Routed-access helpers (DEFINER, hardened like the other helpers)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_adr_routed_report(p_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM adr_product_company_routes r
    WHERE r.report_id = p_report_id
      AND r.status IN ('verified', 'routed')
      AND r.responsible_business_id IS NOT NULL
      AND r.responsible_business_id IN (SELECT public.current_business_ids())
  )
$$;

COMMENT ON FUNCTION public.can_access_adr_routed_report(uuid) IS
  'Responsible-company read access: my business holds a verified/routed route for the report. Read-only axis; grants no writes.';

CREATE OR REPLACE FUNCTION public.can_write_adr_route_company(p_route_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM adr_product_company_routes r
    WHERE r.route_id = p_route_id
      AND r.status IN ('verified', 'routed')
      AND r.responsible_business_id IS NOT NULL
      AND r.responsible_business_id IN (SELECT public.current_business_ids())
  )
$$;

COMMENT ON FUNCTION public.can_write_adr_route_company(uuid) IS
  'Responsible-company workflow access for one route (assessments, follow-up requests). Case rows stay read-only.';

REVOKE EXECUTE ON FUNCTION public.can_access_adr_routed_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_adr_routed_report(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.can_write_adr_route_company(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write_adr_route_company(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Extend SELECT branches (writes untouched everywhere)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "adr_reports select" ON adr_reports;
CREATE POLICY "adr_reports select" ON adr_reports
  FOR SELECT
  USING (
    public.can_access_adr_report_row(business_id, created_by_user_id)
    OR public.can_access_adr_public_draft_row(report_source, reporter_auth_user_id)
  );
-- NOTE: deliberately NO routed-report branch here. Responsible companies read
-- case headers exclusively through adr_pv_case_view (masked, DEFINER with an
-- explicit access predicate below), so reporter identity/contact can never be
-- reached by a direct table read. Child/event/route/photo tables carry no
-- reporter PII and do get the routed-read branch.

DROP POLICY IF EXISTS "adr_report_products read" ON adr_report_products;
CREATE POLICY "adr_report_products read" ON adr_report_products
  FOR SELECT USING (
    public.can_access_adr_report(report_id)
    OR public.can_access_adr_public_draft(report_id)
    OR public.can_access_adr_routed_report(report_id));

DROP POLICY IF EXISTS "adr_report_concomitant_meds read" ON adr_report_concomitant_meds;
CREATE POLICY "adr_report_concomitant_meds read" ON adr_report_concomitant_meds
  FOR SELECT USING (
    public.can_access_adr_report(report_id)
    OR public.can_access_adr_public_draft(report_id)
    OR public.can_access_adr_routed_report(report_id));

DROP POLICY IF EXISTS "adr_report_reactions read" ON adr_report_reactions;
CREATE POLICY "adr_report_reactions read" ON adr_report_reactions
  FOR SELECT USING (
    public.can_access_adr_report(report_id)
    OR public.can_access_adr_public_draft(report_id)
    OR public.can_access_adr_routed_report(report_id));

DROP POLICY IF EXISTS "adr_report_evidence_photos read" ON adr_report_evidence_photos;
CREATE POLICY "adr_report_evidence_photos read" ON adr_report_evidence_photos
  FOR SELECT USING (
    public.can_access_adr_report(report_id)
    OR public.can_access_adr_public_draft(report_id)
    OR public.can_access_adr_routed_report(report_id));

DROP POLICY IF EXISTS "adr_report_events read via report" ON adr_report_events;
CREATE POLICY "adr_report_events read via report" ON adr_report_events
  FOR SELECT
  USING (
    public.can_access_adr_report(report_id)
    OR public.can_access_adr_public_draft(report_id)
    OR public.can_access_adr_routed_report(report_id)
  );

-- ----------------------------------------------------------------------------
-- 3. Masked PV case view (Ruling 1: interim reporter-identity masking)
--    Same view for everyone: submitters/admins see full rows, responsible
--    companies see clinical data with identity/contact masked.
--    SECURITY DEFINER (deliberate): base adr_reports RLS intentionally has NO
--    routed-report branch (see above), so an INVOKER view could never serve
--    responsible companies. Access is enforced by the explicit WHERE predicate
--    (submitter chain, public owner, platform admin, or verified/routed
--    responsible org); masking by the CASE columns. No caller reaches reporter
--    identity/contact through this view unless privileged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.adr_pv_case_view AS
SELECT
  r.report_id,
  r.report_number,
  r.business_id,
  r.module_type,
  r.status,
  r.report_source,
  r.origin_channel_detail,
  r.created_at,
  r.updated_at,
  r.follow_up_of_report_id,
  r.follow_up_version_number,
  r.submission_deadline,
  r.deadline_rule_version,
  r.gate_validated_at,
  r.reaction_expected,
  r.new_safety_signal,
  CASE WHEN (is_platform_admin() OR public.can_access_adr_report(r.report_id))
    THEN r.reporter_name END AS reporter_name,
  r.reporter_qualification,
  CASE WHEN (is_platform_admin() OR public.can_access_adr_report(r.report_id))
    THEN r.reporter_facility_name END AS reporter_facility_name,
  CASE WHEN (is_platform_admin() OR public.can_access_adr_report(r.report_id))
    THEN r.reporter_phone END AS reporter_phone,
  CASE WHEN (is_platform_admin() OR public.can_access_adr_report(r.report_id))
    THEN r.reporter_email END AS reporter_email,
  CASE WHEN (is_platform_admin() OR public.can_access_adr_report(r.report_id))
    THEN r.reporter_license_number END AS reporter_license_number,
  r.reporter_consent_followup,
  r.reporter_anonymous_confirmed_by_facility,
  r.patient_identifier,
  r.patient_age,
  r.patient_dob,
  r.patient_age_group,
  r.patient_gender,
  r.patient_weight_kg,
  r.patient_medical_history,
  r.batch_lot_number,
  r.causality_assessment,
  r.case_narrative_summary,
  r.naranjo_score,
  r.distribution_batch_trace_notes,
  r.application_site,
  r.cosmetic_reaction_type,
  r.onset_timing,
  r.discontinued_use,
  r.resolution_status,
  r.ward_department,
  r.attending_physician,
  r.lab_investigation_notes,
  r.lab_attachment_url,
  r.comorbidities,
  r.icu_admission,
  r.treatment_given_for_reaction,
  r.discharge_summary_attachment_url
FROM adr_reports r
WHERE (
  is_platform_admin()
  OR public.can_access_adr_report(r.report_id)
  OR public.can_access_adr_public_draft(r.report_id)
  OR public.can_access_adr_routed_report(r.report_id)
);

-- Plain views execute as the owner (security_invoker defaults to false), so
-- the WHERE predicate above is the access gate and base RLS is bypassed
-- inside it by design. Lock the view to signed-in callers only.
REVOKE ALL ON public.adr_pv_case_view FROM PUBLIC, anon;
GRANT SELECT ON public.adr_pv_case_view TO authenticated;

COMMENT ON VIEW public.adr_pv_case_view IS
  'PV Tracker case projection. Caller-dependent masking: reporter identity/contact visible only to the submitter chain and platform admin (interim; privacy-lead sign-off pending). SECURITY INVOKER so base RLS scopes rows.';

-- ----------------------------------------------------------------------------
-- 4. Company workflow state on the route row
-- ----------------------------------------------------------------------------
ALTER TABLE adr_product_company_routes
  ADD COLUMN IF NOT EXISTS company_status text NOT NULL DEFAULT 'new'
    CHECK (company_status IN ('new','acknowledged','under_assessment','follow_up_requested','closed')),
  ADD COLUMN IF NOT EXISTS company_status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_adr_routes_company_status
  ON adr_product_company_routes(responsible_business_id, company_status)
  WHERE status IN ('verified', 'routed');

-- ----------------------------------------------------------------------------
-- 5. Assessments (append-only, attributable) + follow-up requests
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adr_route_assessments (
  assessment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES adr_product_company_routes(route_id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES adr_reports(report_id) ON DELETE CASCADE,
  author_auth_user uuid,
  author_name text,
  assessment text NOT NULL,
  action_taken text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adr_assessments_route ON adr_route_assessments(route_id, created_at DESC);

CREATE TABLE IF NOT EXISTS adr_followup_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES adr_product_company_routes(route_id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES adr_reports(report_id) ON DELETE CASCADE,
  message text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','addressed')),
  created_by_auth_user uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adr_followups_route ON adr_followup_requests(route_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_adr_followups_report ON adr_followup_requests(report_id, status);

ALTER TABLE adr_route_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE adr_followup_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "adr_assessments read" ON adr_route_assessments;
CREATE POLICY "adr_assessments read" ON adr_route_assessments
  FOR SELECT USING (
    public.can_access_adr_report(report_id)
    OR public.can_access_adr_public_draft(report_id)
    OR public.can_access_adr_routed_report(report_id));

DROP POLICY IF EXISTS "adr_assessments write" ON adr_route_assessments;
CREATE POLICY "adr_assessments write" ON adr_route_assessments
  FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM adr_product_company_routes r
            WHERE r.route_id = route_id AND r.report_id = report_id)
    AND (
      public.can_access_adr_report(report_id)
      OR public.can_write_adr_route_company(route_id)
      OR is_platform_admin()
    )
  );

DROP POLICY IF EXISTS "adr_followups read" ON adr_followup_requests;
CREATE POLICY "adr_followups read" ON adr_followup_requests
  FOR SELECT USING (
    public.can_access_adr_report(report_id)
    OR public.can_access_adr_public_draft(report_id)
    OR public.can_access_adr_routed_report(report_id));

DROP POLICY IF EXISTS "adr_followups insert" ON adr_followup_requests;
CREATE POLICY "adr_followups insert" ON adr_followup_requests
  FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM adr_product_company_routes r
            WHERE r.route_id = route_id AND r.report_id = report_id)
    AND (
      public.can_write_adr_route_company(route_id)
      OR is_platform_admin()
    )
  );

DROP POLICY IF EXISTS "adr_followups update" ON adr_followup_requests;
CREATE POLICY "adr_followups update" ON adr_followup_requests
  FOR UPDATE
  USING (
    public.can_access_adr_report(report_id)
    OR public.can_write_adr_route_company(route_id)
    OR is_platform_admin()
  )
  WITH CHECK (
    public.can_access_adr_report(report_id)
    OR public.can_write_adr_route_company(route_id)
    OR is_platform_admin()
  );

COMMENT ON TABLE adr_route_assessments IS
  'Versioned company/submitter assessments. Append-only: corrections are new rows, never edits.';
COMMENT ON TABLE adr_followup_requests IS
  'Company -> submitter follow-up requests. Answers arrive as versioned follow-up reports (follow_up_of_report_id chain).';

-- ----------------------------------------------------------------------------
-- 6. Lifecycle triggers -> audit events (same DEFINER pattern as reports)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adr_route_child_events_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor record;
BEGIN
  SELECT * INTO v_actor FROM adr_event_actor(NEW.report_id);
  IF TG_TABLE_NAME = 'adr_route_assessments' AND TG_OP = 'INSERT' THEN
    INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
    VALUES (NEW.report_id, 'assessment_recorded', v_actor.actor_type, v_actor.actor_name,
            jsonb_build_object('route_id', NEW.route_id, 'assessment_id', NEW.assessment_id));
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'adr_followup_requests' AND TG_OP = 'INSERT' THEN
    INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
    VALUES (NEW.report_id, 'followup_requested', v_actor.actor_type, v_actor.actor_name,
            jsonb_build_object('route_id', NEW.route_id, 'request_id', NEW.request_id));
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'adr_followup_requests' AND TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'addressed' THEN
    INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
    VALUES (NEW.report_id, 'followup_addressed', v_actor.actor_type, v_actor.actor_name,
            jsonb_build_object('route_id', NEW.route_id, 'request_id', NEW.request_id));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_adr_assessment_events ON adr_route_assessments;
CREATE TRIGGER trg_adr_assessment_events
  AFTER INSERT ON adr_route_assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_route_child_events_trigger();

DROP TRIGGER IF EXISTS trg_adr_followup_events ON adr_followup_requests;
CREATE TRIGGER trg_adr_followup_events
  AFTER INSERT OR UPDATE ON adr_followup_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_route_child_events_trigger();

-- Author stamp: the client sends content only; identity comes from auth.
CREATE OR REPLACE FUNCTION public.adr_route_assessment_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor record;
BEGIN
  SELECT * INTO v_actor FROM adr_event_actor(NEW.report_id);
  NEW.author_auth_user := auth.uid();
  NEW.author_name := v_actor.actor_name;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_adr_assessment_author ON adr_route_assessments;
CREATE TRIGGER trg_adr_assessment_author
  BEFORE INSERT ON adr_route_assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_route_assessment_author();

-- ----------------------------------------------------------------------------
-- 7. New audit event types (existing values preserved)
-- ----------------------------------------------------------------------------
ALTER TABLE adr_report_events DROP CONSTRAINT IF EXISTS adr_report_events_event_type_check;
ALTER TABLE adr_report_events
  ADD CONSTRAINT adr_report_events_event_type_check
  CHECK (event_type IN (
    'created','status_changed','exported','note',
    'routing_created','routing_verified','routing_routed',
    'verification_recorded','history_linked',
    'acknowledged','assessment_recorded','followup_requested',
    'followup_addressed','workflow_updated'
  ));

-- ----------------------------------------------------------------------------
-- 8. update_adr_route_workflow - server-enforced transition table
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_adr_route_workflow(
  p_route_id uuid,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_route adr_product_company_routes;
  v_actor record;
  v_allowed boolean;
BEGIN
  IF p_status NOT IN ('new','acknowledged','under_assessment','follow_up_requested','closed') THEN
    RAISE EXCEPTION 'invalid company status %', p_status;
  END IF;

  SELECT * INTO v_route FROM adr_product_company_routes WHERE route_id = p_route_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'route not found';
  END IF;

  -- Submitter chain, platform admin, or the responsible company itself.
  IF NOT public.can_access_adr_report(v_route.report_id)
     AND NOT public.can_write_adr_route_company(p_route_id)
     AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not accessible';
  END IF;

  -- Idempotent retry: same status is a no-op success, never a duplicate event.
  IF v_route.company_status = p_status THEN
    RETURN jsonb_build_object('route_id', p_route_id, 'company_status', p_status, 'noop', true);
  END IF;

  v_allowed := CASE v_route.company_status
    WHEN 'new' THEN p_status IN ('acknowledged', 'closed')
    WHEN 'acknowledged' THEN p_status IN ('under_assessment', 'follow_up_requested', 'closed')
    WHEN 'under_assessment' THEN p_status IN ('follow_up_requested', 'closed')
    WHEN 'follow_up_requested' THEN p_status IN ('under_assessment', 'closed')
    WHEN 'closed' THEN p_status IN ('under_assessment')
  END;
  IF NOT coalesce(v_allowed, false) THEN
    RAISE EXCEPTION 'transition % -> % not permitted', v_route.company_status, p_status;
  END IF;

  SELECT * INTO v_actor FROM adr_event_actor(v_route.report_id);

  UPDATE adr_product_company_routes
     SET company_status = p_status,
         company_status_updated_at = now(),
         acknowledged_at = CASE
           WHEN acknowledged_at IS NULL AND p_status <> 'new' THEN now()
           ELSE acknowledged_at END
   WHERE route_id = p_route_id;

  INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
  VALUES (v_route.report_id,
          CASE WHEN p_status = 'acknowledged' AND v_route.acknowledged_at IS NULL
               THEN 'acknowledged' ELSE 'workflow_updated' END,
          v_actor.actor_type, v_actor.actor_name,
          jsonb_build_object('route_id', p_route_id, 'from', v_route.company_status,
                             'to', p_status, 'note', p_note));

  RETURN jsonb_build_object('route_id', p_route_id, 'company_status', p_status);
END
$$;

COMMENT ON FUNCTION public.update_adr_route_workflow(uuid, text, text) IS
  'Company workflow transitions with a server-enforced transition table. Acknowledgement is internal receipt only, never a regulatory submission.';

REVOKE EXECUTE ON FUNCTION public.update_adr_route_workflow(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_adr_route_workflow(uuid, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. request_adr_followup - idempotent company -> submitter requests
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_adr_followup(
  p_route_id uuid,
  p_message text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_route adr_product_company_routes;
  v_key text;
  v_req adr_followup_requests;
BEGIN
  IF p_message IS NULL OR length(trim(both from p_message)) = 0 THEN
    RAISE EXCEPTION 'follow-up message is required';
  END IF;

  SELECT * INTO v_route FROM adr_product_company_routes WHERE route_id = p_route_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'route not found';
  END IF;

  IF NOT public.can_write_adr_route_company(p_route_id) AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not accessible';
  END IF;

  v_key := nullif(trim(both from coalesce(p_idempotency_key, '')), '');
  IF v_key IS NULL THEN
    v_key := p_route_id::text || ':' || md5(trim(both from p_message));
  END IF;

  INSERT INTO adr_followup_requests
    (route_id, report_id, message, idempotency_key, status, created_by_auth_user)
  VALUES
    (p_route_id, v_route.report_id, trim(both from p_message), v_key, 'open', auth.uid())
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_req;

  IF NOT FOUND THEN
    SELECT * INTO v_req FROM adr_followup_requests WHERE idempotency_key = v_key;
  END IF;

  RETURN jsonb_build_object('request_id', v_req.request_id, 'status', v_req.status);
END
$$;

COMMENT ON FUNCTION public.request_adr_followup(uuid, text, text) IS
  'Idempotent follow-up request from the responsible company to the submitter. Answers arrive as versioned follow-up reports.';

REVOKE EXECUTE ON FUNCTION public.request_adr_followup(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_adr_followup(uuid, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. adr-private routed read (attachments for verified responsible orgs)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "adr-private routed read" ON storage.objects;
CREATE POLICY "adr-private routed read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'adr-private'
    AND EXISTS (
      SELECT 1 FROM adr_report_evidence_photos ph
      JOIN adr_product_company_routes rt ON rt.report_id = ph.report_id
      WHERE ph.evidence_photo_file = storage.objects.name
        AND rt.status IN ('verified', 'routed')
        AND rt.responsible_business_id IS NOT NULL
        AND rt.responsible_business_id IN (SELECT public.current_business_ids())
    )
  );
