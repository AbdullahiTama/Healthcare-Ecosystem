-- ============================================================================
-- ADR routing: reviewer approval queue (policy B), auditable route review,
-- reviewer + company notifications.
--
-- Status: APPLIED to production (szdybxmgmhndoytqanfb) on 2026-10-21 with owner approval. Verified: single overloads,
--         no anon EXECUTE, triggers enabled, and approve/hold/redirect + notification checked in a rolled-back transaction.
--
-- Owner decision (2026-10-20): public reports are NOT auto-routed. A platform
-- reviewer approves, redirects or holds every route before the responsible
-- company can see the case. See docs/audits/carefind-carehub-pv-routing-audit.md.
--
-- What this adds
--   1. Provenance + review columns on adr_product_company_routes. What the
--      reporter selected is kept forever (reporter_selected_business_id /
--      reporter_candidate_name); a reviewer redirect never rewrites history.
--      The route guard from 20261113 is extended so API roles cannot touch them.
--   2. list_adr_route_review_queue(): platform-reviewer only; submitted,
--      validated, still-pending routes; registered selections are distinguished
--      from typed/unknown ones; match evidence and suggestions are DISPLAY ONLY
--      and never route anything.
--   3. review_adr_product_route(route, action, reason, business?): approve |
--      redirect | hold. Re-checks report validity and business eligibility at
--      decision time, locks the row, is idempotent, always requires a reason,
--      audits to adr_report_events, then notifies the company. Notification
--      failure never rolls back the routing decision.
--   4. verify_adr_product_route() becomes a thin wrapper over approve so there
--      is exactly one way to route.
--   5. Notifications: adr_notification_log (observable), reviewer alert trigger
--      on public submission, company alert on routing, retry RPC, failure list.
--      Company recipients = the owner + active staff who can open the PV Tracker
--      under the real permission model (custom `roles` row first, then the
--      preset table, then the default that includes pv-tracker). Message copy
--      carries only the case reference and product name: no patient data.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------
ALTER TABLE adr_product_company_routes
  ADD COLUMN IF NOT EXISTS reporter_selected_business_id uuid REFERENCES businesses(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reporter_candidate_name text,
  ADD COLUMN IF NOT EXISTS held_at timestamptz,
  ADD COLUMN IF NOT EXISTS held_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_reason text;

-- Provenance for rows created before this migration (they are all untouched
-- reporter selections).
UPDATE adr_product_company_routes
   SET reporter_selected_business_id = COALESCE(reporter_selected_business_id, responsible_business_id),
       reporter_candidate_name = COALESCE(reporter_candidate_name, candidate_name)
 WHERE reporter_selected_business_id IS NULL AND reporter_candidate_name IS NULL;

CREATE INDEX IF NOT EXISTS idx_adr_routes_review_queue
  ON adr_product_company_routes(created_at) WHERE status = 'pending';

-- Stamp provenance on every insert (runs after the guard, alphabetically).
CREATE OR REPLACE FUNCTION public.adr_route_stamp_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.reporter_selected_business_id := COALESCE(NEW.reporter_selected_business_id, NEW.responsible_business_id);
  NEW.reporter_candidate_name := COALESCE(NEW.reporter_candidate_name, NEW.candidate_name);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_adr_route_stamp_provenance ON adr_product_company_routes;
CREATE TRIGGER trg_adr_route_stamp_provenance
  BEFORE INSERT ON adr_product_company_routes
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_route_stamp_provenance();

-- Extend the 20261113 guard with the new columns.
CREATE OR REPLACE FUNCTION public.adr_guard_route_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending'
       OR NEW.company_status IS DISTINCT FROM 'new'
       OR NEW.verified_at IS NOT NULL
       OR NEW.verified_by IS NOT NULL
       OR NEW.verification_notes IS NOT NULL
       OR NEW.company_status_updated_at IS NOT NULL
       OR NEW.acknowledged_at IS NOT NULL
       OR NEW.reporter_selected_business_id IS NOT NULL
       OR NEW.reporter_candidate_name IS NOT NULL
       OR NEW.held_at IS NOT NULL
       OR NEW.held_reason IS NOT NULL
       OR NEW.reviewed_by IS NOT NULL
       OR NEW.reviewed_at IS NOT NULL
       OR NEW.review_reason IS NOT NULL THEN
      RAISE EXCEPTION 'routes are created pending; routing state is set only by the routing functions';
    END IF;
    IF NEW.selection_kind = 'verified'
       AND NOT public.is_eligible_product_company(NEW.responsible_business_id) THEN
      RAISE EXCEPTION 'business is not an eligible active Importer/Manufacturer';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.report_id IS DISTINCT FROM OLD.report_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.responsible_business_id IS DISTINCT FROM OLD.responsible_business_id
     OR NEW.candidate_name IS DISTINCT FROM OLD.candidate_name
     OR NEW.normalized_candidate IS DISTINCT FROM OLD.normalized_candidate
     OR NEW.selection_kind IS DISTINCT FROM OLD.selection_kind
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
     OR NEW.verification_notes IS DISTINCT FROM OLD.verification_notes
     OR NEW.company_status IS DISTINCT FROM OLD.company_status
     OR NEW.company_status_updated_at IS DISTINCT FROM OLD.company_status_updated_at
     OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
     OR NEW.reporter_selected_business_id IS DISTINCT FROM OLD.reporter_selected_business_id
     OR NEW.reporter_candidate_name IS DISTINCT FROM OLD.reporter_candidate_name
     OR NEW.held_at IS DISTINCT FROM OLD.held_at
     OR NEW.held_reason IS DISTINCT FROM OLD.held_reason
     OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
     OR NEW.review_reason IS DISTINCT FROM OLD.review_reason THEN
    RAISE EXCEPTION 'route columns are changed only through the routing functions';
  END IF;
  RETURN NEW;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. Audit vocabulary: routing_held event, platform_reviewer actor
-- ----------------------------------------------------------------------------
ALTER TABLE adr_report_events DROP CONSTRAINT IF EXISTS adr_report_events_event_type_check;
ALTER TABLE adr_report_events
  ADD CONSTRAINT adr_report_events_event_type_check
  CHECK (event_type IN (
    'created','status_changed','exported','note',
    'routing_created','routing_verified','routing_routed',
    'verification_recorded','history_linked',
    'acknowledged','assessment_recorded','followup_requested',
    'followup_addressed','workflow_updated',
    'source_corrected',
    'routing_held'
  ));

-- The actor_type CHECK was declared inline (system-named), so find it by definition.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.adr_report_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%actor_type%'
  LOOP
    EXECUTE format('ALTER TABLE adr_report_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE adr_report_events
  ADD CONSTRAINT adr_report_events_actor_type_check
  CHECK (actor_type IN ('owner','staff','system','platform_reviewer'));

-- ----------------------------------------------------------------------------
-- 3. Notification log (observable delivery; admin-readable, function-written)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adr_notification_log (
  log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES adr_reports(report_id) ON DELETE CASCADE,
  route_id uuid REFERENCES adr_product_company_routes(route_id) ON DELETE CASCADE,
  kind text NOT NULL,
  recipient_business_id uuid,
  recipient_staff_id uuid,
  status text NOT NULL CHECK (status IN ('sent','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_adr_notification_log_route ON adr_notification_log(route_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_adr_notification_log_report ON adr_notification_log(report_id, kind, status);

ALTER TABLE adr_notification_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON adr_notification_log FROM anon, authenticated;
GRANT SELECT ON adr_notification_log TO authenticated;
DROP POLICY IF EXISTS "adr_notification_log reviewer read" ON adr_notification_log;
CREATE POLICY "adr_notification_log reviewer read" ON adr_notification_log
  FOR SELECT TO authenticated USING (is_platform_admin());

-- ----------------------------------------------------------------------------
-- 4. Recipients: who can open the PV Tracker in a company
--    Mirrors apps/carehub/src/lib/permissions.js getPerms(): Owner always;
--    a custom `roles` row (matched by name) decides by its nav list; otherwise
--    the preset table; otherwise DEFAULT_STAFF_PERMS (which includes
--    pv-tracker). The preset roles WITHOUT pv-tracker are listed below; a
--    CareHub test fails if permissions.js drifts from this list.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adr_tracker_recipients(p_business_id uuid)
RETURNS TABLE(staff_id uuid, is_owner boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULL::uuid, true
    FROM businesses b WHERE b.id = p_business_id
  UNION ALL
  SELECT s.id, false
    FROM staff s
   WHERE s.business_id = p_business_id
     AND s.status = 'active'
     AND CASE
           WHEN EXISTS (SELECT 1 FROM roles ro
                         WHERE ro.business_id = s.business_id AND ro.name = s.role)
             THEN EXISTS (SELECT 1 FROM roles ro
                           WHERE ro.business_id = s.business_id AND ro.name = s.role
                             AND (CASE WHEN jsonb_typeof(ro.permissions -> 'nav') = 'array'
                                       THEN (ro.permissions -> 'nav') ? 'pv-tracker'
                                       ELSE true END))
           WHEN s.role = ANY (ARRAY['Pharmacist','Therapist','Receptionist','Cashier','Nurse','Doctor','Lab Technician'])
             THEN false
           ELSE true
         END
$$;

-- ----------------------------------------------------------------------------
-- 5. Company notification on routing (idempotent, failure-isolated per recipient)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adr_notify_route_routed(p_route_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r adr_product_company_routes;
  v_num text;
  v_brand text;
  v_link text;
  v_title text := 'New safety case routed to your organisation';
  v_body text;
  rec record;
  v_n integer;
  v_sent integer := 0;
  v_failed integer := 0;
BEGIN
  SELECT * INTO r FROM adr_product_company_routes
   WHERE route_id = p_route_id AND status = 'routed' AND responsible_business_id IS NOT NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('notified', 0, 'failed', 0, 'reason', 'route-not-routed');
  END IF;

  SELECT coalesce(a.report_number, a.report_id::text) INTO v_num FROM adr_reports a WHERE a.report_id = r.report_id;
  SELECT p.product_brand_name INTO v_brand FROM adr_report_products p WHERE p.product_id = r.product_id;
  v_link := '/dashboard/reports/pv-tracker/' || r.report_id::text;
  -- Reference + product name only: no patient identifiers, no clinical detail.
  v_body := format('Case %s was routed to you for %s. Open the PV Tracker to acknowledge receipt.',
                   v_num, coalesce(nullif(trim(v_brand), ''), 'a product'));

  FOR rec IN SELECT * FROM adr_tracker_recipients(r.responsible_business_id) LOOP
    BEGIN
      INSERT INTO staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
      SELECT r.responsible_business_id, rec.staff_id, rec.is_owner, 'adr_case_routed', v_title, v_body, v_link
       WHERE NOT EXISTS (
         SELECT 1 FROM staff_notifications n
          WHERE n.business_id = r.responsible_business_id
            AND coalesce(n.staff_id, '00000000-0000-0000-0000-000000000000')
                = coalesce(rec.staff_id, '00000000-0000-0000-0000-000000000000')
            AND n.kind = 'adr_case_routed'
            AND n.link = v_link);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN
        v_sent := v_sent + v_n;
        INSERT INTO adr_notification_log (report_id, route_id, kind, recipient_business_id, recipient_staff_id, status)
        VALUES (r.report_id, r.route_id, 'adr_case_routed', r.responsible_business_id, rec.staff_id, 'sent');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      INSERT INTO adr_notification_log (report_id, route_id, kind, recipient_business_id, recipient_staff_id, status, error)
      VALUES (r.report_id, r.route_id, 'adr_case_routed', r.responsible_business_id, rec.staff_id, 'failed', left(SQLERRM, 500));
    END;
  END LOOP;

  RETURN jsonb_build_object('notified', v_sent, 'failed', v_failed);
END
$$;

-- ----------------------------------------------------------------------------
-- 6. Reviewer alert when a public report is submitted (never blocks submission)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adr_notify_reviewers_on_submit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num text;
  v_routes integer;
  rec record;
BEGIN
  IF NOT (OLD.status = 'draft' AND NEW.status = 'submitted'
          AND NEW.report_source = 'public' AND NEW.gate_validated_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_num := coalesce(NEW.report_number, NEW.report_id::text);
    SELECT count(*) INTO v_routes FROM adr_product_company_routes WHERE report_id = NEW.report_id AND status = 'pending';
    FOR rec IN SELECT b.id FROM businesses b WHERE b.is_platform_admin IS TRUE LOOP
      BEGIN
        INSERT INTO staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
        SELECT rec.id, NULL, true, 'adr_routing_review_needed',
               'Safety report awaiting routing review',
               format('Report %s has %s product route(s) awaiting review.', v_num, v_routes),
               '/admin#adr-' || NEW.report_id::text
         WHERE NOT EXISTS (
           SELECT 1 FROM staff_notifications n
            WHERE n.business_id = rec.id AND n.kind = 'adr_routing_review_needed'
              AND n.link = '/admin#adr-' || NEW.report_id::text);
        INSERT INTO adr_notification_log (report_id, kind, recipient_business_id, status)
        VALUES (NEW.report_id, 'adr_routing_review_needed', rec.id, 'sent');
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO adr_notification_log (report_id, kind, recipient_business_id, status, error)
        VALUES (NEW.report_id, 'adr_routing_review_needed', rec.id, 'failed', left(SQLERRM, 500));
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Alerting must never roll back a valid submission.
    NULL;
  END;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_adr_notify_reviewers ON adr_reports;
CREATE TRIGGER trg_adr_notify_reviewers
  AFTER UPDATE OF status ON adr_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_notify_reviewers_on_submit();

-- ----------------------------------------------------------------------------
-- 7. Review queue (read) - platform reviewers only
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_adr_route_review_queue(p_state text DEFAULT 'open')
RETURNS TABLE(
  route_id uuid, report_id uuid, report_number text, submitted_at timestamptz,
  is_serious boolean,
  product_brand_name text, product_generic_name text, product_manufacturer_text text,
  selection_kind text,
  selected_business_id uuid, selected_business_name text, selected_business_type text,
  selected_business_state text, selected_business_eligible boolean,
  candidate_name text,
  match_evidence jsonb, suggestions jsonb,
  held_at timestamptz, held_reason text, route_created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rt.route_id, rep.report_id, rep.report_number, rep.gate_validated_at,
    COALESCE((SELECT bool_or(x.seriousness_death OR x.seriousness_life_threatening OR x.seriousness_hospitalization
                OR x.seriousness_disability OR x.seriousness_congenital_anomaly OR x.seriousness_other_medically_important)
                FROM adr_report_reactions x WHERE x.report_id = rep.report_id), false),
    pr.product_brand_name, pr.product_generic_name, pr.manufacturer,
    rt.selection_kind,
    rt.reporter_selected_business_id, sb.name, sb.business_type, sb.state,
    CASE WHEN rt.reporter_selected_business_id IS NULL THEN NULL
         ELSE public.is_eligible_product_company(rt.reporter_selected_business_id) END,
    rt.reporter_candidate_name,
    jsonb_build_object(
      'basis', CASE rt.selection_kind
                 WHEN 'verified' THEN 'reporter picked a registered company; not independently verified'
                 WHEN 'unverified_candidate' THEN 'reporter typed a company name; no registry match'
                 ELSE 'reporter did not know the company' END,
      'manufacturer_text', nullif(trim(pr.manufacturer), ''),
      'selected_name_matches_manufacturer_text',
        CASE WHEN sb.name IS NULL OR nullif(trim(pr.manufacturer), '') IS NULL THEN NULL
             ELSE (lower(sb.name) LIKE '%' || lower(trim(pr.manufacturer)) || '%'
                   OR lower(trim(pr.manufacturer)) LIKE '%' || lower(sb.name) || '%') END
    ),
    CASE WHEN rt.selection_kind = 'verified' THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('business_id', c.id, 'name', c.name, 'type', c.business_type,
                                          'state', c.state, 'city', c.city))
        FROM (
          SELECT b.* FROM businesses b
           WHERE public.is_eligible_product_company(b.id)
             AND length(trim(coalesce(rt.reporter_candidate_name, pr.manufacturer, ''))) >= 3
             AND (
               b.name ILIKE '%' || replace(replace(trim(coalesce(rt.reporter_candidate_name, pr.manufacturer)), '%', ''), '_', '') || '%'
               OR EXISTS (SELECT 1 FROM business_aliases a
                           WHERE a.business_id = b.id AND a.is_approved IS TRUE
                             AND a.normalized_alias ILIKE '%' || lower(replace(replace(trim(coalesce(rt.reporter_candidate_name, pr.manufacturer)), '%', ''), '_', '')) || '%')
             )
           ORDER BY b.name LIMIT 5
        ) c
    ), '[]'::jsonb) END,
    rt.held_at, rt.held_reason, rt.created_at
  FROM adr_product_company_routes rt
  JOIN adr_reports rep ON rep.report_id = rt.report_id
  JOIN adr_report_products pr ON pr.product_id = rt.product_id
  LEFT JOIN businesses sb ON sb.id = rt.reporter_selected_business_id
  WHERE public.is_platform_admin()
    AND rt.status = 'pending'
    AND rep.status <> 'draft'
    AND rep.gate_validated_at IS NOT NULL
    AND rep.report_source = 'public'
    AND CASE coalesce(p_state, 'open')
          WHEN 'held' THEN rt.held_at IS NOT NULL
          WHEN 'all' THEN true
          ELSE rt.held_at IS NULL END
  ORDER BY rt.created_at ASC
$$;

-- ----------------------------------------------------------------------------
-- 8. Review decision (write) - approve | redirect | hold
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_adr_product_route(
  p_route_id uuid,
  p_action text,
  p_reason text,
  p_business_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r adr_product_company_routes;
  rep adr_reports;
  v_reason text;
  v_target uuid;
  v_actor text;
  v_notif jsonb;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('approve', 'redirect', 'hold') THEN
    RAISE EXCEPTION 'invalid review action %', p_action;
  END IF;
  v_reason := trim(both from coalesce(p_reason, ''));
  IF length(v_reason) < 3 THEN
    RAISE EXCEPTION 'a reason is required';
  END IF;

  SELECT * INTO r FROM adr_product_company_routes WHERE route_id = p_route_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'route not found';
  END IF;

  SELECT * INTO rep FROM adr_reports WHERE report_id = r.report_id;
  IF rep.status = 'draft' OR rep.gate_validated_at IS NULL THEN
    RAISE EXCEPTION 'report has not passed validation';
  END IF;

  v_actor := coalesce(
    (SELECT b.owner FROM businesses b WHERE lower(b.email) = lower(auth.email()) LIMIT 1),
    'Platform reviewer');

  IF p_action = 'hold' THEN
    IF r.status <> 'pending' THEN
      RAISE EXCEPTION 'route is not pending review';
    END IF;
    IF r.held_at IS NOT NULL AND r.held_reason = v_reason THEN
      RETURN jsonb_build_object('route_id', p_route_id, 'status', r.status, 'action', 'hold', 'noop', true);
    END IF;
    UPDATE adr_product_company_routes
       SET held_at = now(), held_reason = v_reason, reviewed_by = auth.uid(), reviewed_at = now()
     WHERE route_id = p_route_id;
    INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
    VALUES (r.report_id, 'routing_held', 'platform_reviewer', v_actor,
            jsonb_build_object('route_id', p_route_id, 'reason', v_reason));
    RETURN jsonb_build_object('route_id', p_route_id, 'status', 'pending', 'action', 'hold', 'noop', false);
  END IF;

  -- approve / redirect: pick and re-check the target company.
  IF p_action = 'approve' THEN
    IF r.selection_kind = 'unverified_candidate' THEN
      RAISE EXCEPTION 'a typed company name cannot be approved; redirect to a registered company';
    END IF;
    IF r.selection_kind = 'unknown' THEN
      RAISE EXCEPTION 'no company was selected; redirect to a registered company';
    END IF;
    v_target := r.responsible_business_id;
  ELSE
    v_target := p_business_id;
  END IF;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'a company is required';
  END IF;
  IF NOT public.is_eligible_product_company(v_target) THEN
    RAISE EXCEPTION 'business is not an eligible active Importer/Manufacturer';
  END IF;

  -- Idempotent retry: already routed to exactly this company.
  IF r.status = 'routed' AND r.responsible_business_id = v_target THEN
    RETURN jsonb_build_object('route_id', p_route_id, 'status', 'routed', 'action', p_action, 'noop', true);
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'route is not pending review';
  END IF;

  UPDATE adr_product_company_routes
     SET status = 'routed',
         selection_kind = 'verified',
         responsible_business_id = v_target,
         candidate_name = NULL,
         normalized_candidate = NULL,
         held_at = NULL,
         held_reason = NULL,
         verified_at = now(),
         verified_by = auth.uid(),
         verification_notes = v_reason,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_reason = v_reason
   WHERE route_id = p_route_id;

  INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
  VALUES (r.report_id, 'routing_routed', 'platform_reviewer', v_actor,
          jsonb_build_object(
            'route_id', p_route_id, 'action', p_action, 'reason', v_reason,
            'responsible_business_id', v_target,
            'reporter_selected_business_id', r.reporter_selected_business_id,
            'reporter_selection_kind', CASE WHEN r.reporter_selected_business_id IS NOT NULL THEN 'verified'
                                            WHEN r.reporter_candidate_name IS NOT NULL THEN 'unverified_candidate'
                                            ELSE 'unknown' END));

  -- Delivery is best effort and observable; it can never undo the decision.
  BEGIN
    v_notif := public.adr_notify_route_routed(p_route_id);
  EXCEPTION WHEN OTHERS THEN
    v_notif := jsonb_build_object('notified', 0, 'failed', 1);
    INSERT INTO adr_notification_log (report_id, route_id, kind, recipient_business_id, status, error)
    VALUES (r.report_id, p_route_id, 'adr_case_routed', v_target, 'failed', left(SQLERRM, 500));
  END;

  RETURN jsonb_build_object('route_id', p_route_id, 'status', 'routed', 'action', p_action,
                            'noop', false, 'notification', v_notif);
END
$$;

-- Single routing path: the older verify RPC now delegates to approve.
CREATE OR REPLACE FUNCTION public.verify_adr_product_route(
  p_route_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.review_adr_product_route(
    p_route_id, 'approve', coalesce(nullif(trim(both from coalesce(p_notes, '')), ''), 'approved by reviewer'));
END
$$;

-- ----------------------------------------------------------------------------
-- 9. Retry + failure visibility
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retry_adr_route_notification(p_route_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM 1 FROM adr_product_company_routes WHERE route_id = p_route_id FOR UPDATE;
  RETURN public.adr_notify_route_routed(p_route_id);
END
$$;

CREATE OR REPLACE FUNCTION public.list_adr_notification_failures()
RETURNS TABLE(log_id uuid, report_id uuid, route_id uuid, kind text, recipient_business_id uuid, error text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.log_id, f.report_id, f.route_id, f.kind, f.recipient_business_id, f.error, f.created_at
    FROM adr_notification_log f
   WHERE public.is_platform_admin()
     AND f.status = 'failed'
     AND NOT EXISTS (
       SELECT 1 FROM adr_notification_log s
        WHERE s.status = 'sent' AND s.kind = f.kind
          AND s.report_id IS NOT DISTINCT FROM f.report_id
          AND s.route_id IS NOT DISTINCT FROM f.route_id
          AND s.recipient_business_id IS NOT DISTINCT FROM f.recipient_business_id
          AND s.created_at > f.created_at)
   ORDER BY f.created_at DESC
$$;

-- ----------------------------------------------------------------------------
-- 10. Grants: internal helpers and trigger functions are not RPCs
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.adr_route_stamp_provenance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.adr_guard_route_writes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.adr_tracker_recipients(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.adr_notify_route_routed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.adr_notify_reviewers_on_submit() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.list_adr_route_review_queue(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_adr_route_review_queue(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.review_adr_product_route(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_adr_product_route(uuid, text, text, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_adr_product_route(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_adr_product_route(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.retry_adr_route_notification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_adr_route_notification(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.list_adr_notification_failures() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_adr_notification_failures() TO authenticated;

COMMENT ON FUNCTION public.review_adr_product_route(uuid, text, text, uuid) IS
  'Reviewer decision on a pending public-report route: approve | redirect | hold, reason required, eligibility + validity re-checked, idempotent, audited, notifies the company without risking the decision.';
