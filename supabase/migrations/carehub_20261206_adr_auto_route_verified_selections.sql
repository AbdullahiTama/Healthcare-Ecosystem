-- ============================================================================
-- ADR routing: route reporter-selected registered companies automatically.
--
-- Status: DRAFT, NOT APPLIED. Apply only with explicit owner approval.
--
-- Owner decision (2026-10-22), REVERSING the 2026-10-20 decision recorded in
-- 20261114_adr_route_review.sql that every public route needs reviewer approval:
-- when the reporter picked a REGISTERED company, the case goes straight to that
-- company's PV Tracker at submission. Reviewers still handle everything the
-- database cannot route on its own (typed names, "I don't know", a selection
-- that is no longer eligible, anything a reviewer has put on hold).
--
-- What this adds
--   1. adr_auto_route_report(report_id): internal helper (not an RPC). For a
--      submitted, validated PUBLIC report it routes every still-pending route
--      that is selection_kind='verified', not held, and whose company is STILL
--      an eligible active Importer/Manufacturer at this moment. It audits each
--      route as routing_routed / actor 'system' / action 'auto' and sends the
--      same company alert a reviewer approval sends. Notification failure never
--      undoes routing.
--   2. Trigger trg_adr_auto_route on adr_reports (draft -> submitted, public,
--      gate validated). It runs the helper and can NEVER block a submission:
--      any error is swallowed (logged) and the route stays pending, i.e. falls
--      back to the reviewer queue.
--   3. adr_notify_reviewers_on_submit() no longer alerts reviewers when nothing
--      is left pending after auto-routing. It relies on running AFTER
--      trg_adr_auto_route; PostgreSQL fires same-event triggers in name order
--      and 'trg_adr_auto_route' < 'trg_adr_notify_reviewers'. Do not rename.
--
-- Security implications (read before approving)
--   * Removes the human check on a REPORTER-SUPPLIED company. Nothing verifies
--     that the product belongs to that company. A reporter can now push the
--     case, including patient age, history, medicines and batch number, to any
--     eligible company by choosing it. Reporter identity and contact stay
--     masked from companies (adr_pv_case_view); patient clinical data does not.
--   * A wrong or malicious selection is a disclosure to the wrong company, and
--     there is no recall step once routed: review_adr_product_route() only acts
--     on pending routes. Follow-up worth building: reviewer "re-route".
--   * Eligibility is re-checked at routing time (same predicate the reviewer
--     path uses). Routing is idempotent: only status='pending' rows change.
--   * The helper and trigger function are SECURITY DEFINER with a pinned
--     search_path, and EXECUTE is revoked from PUBLIC, anon and authenticated.
--     API roles still cannot write route state (the 20261113/20261114 guard is
--     untouched); this runs as the function owner.
--   * Audit: reporter_selected_business_id provenance is untouched. The event
--     metadata carries auto:true so auto-routing is distinguishable forever.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Internal helper
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adr_auto_route_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rep adr_reports;
  r adr_product_company_routes;
  v_routed integer := 0;
  v_left integer := 0;
BEGIN
  SELECT * INTO rep FROM adr_reports WHERE report_id = p_report_id;
  IF NOT FOUND
     OR rep.report_source IS DISTINCT FROM 'public'
     OR rep.status = 'draft'
     OR rep.gate_validated_at IS NULL THEN
    RETURN jsonb_build_object('routed', 0, 'left_for_review', 0, 'skipped', true);
  END IF;

  FOR r IN
    SELECT * FROM adr_product_company_routes
     WHERE report_id = p_report_id
       AND status = 'pending'
       AND selection_kind = 'verified'
       AND responsible_business_id IS NOT NULL
       AND held_at IS NULL
     ORDER BY created_at, route_id
       FOR UPDATE
  LOOP
    IF NOT public.is_eligible_product_company(r.responsible_business_id) THEN
      v_left := v_left + 1;
      CONTINUE;
    END IF;

    UPDATE adr_product_company_routes
       SET status = 'routed',
           verified_at = now(),
           verification_notes = 'Auto-routed: reporter selected a registered, eligible company'
     WHERE route_id = r.route_id;

    INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
    VALUES (r.report_id, 'routing_routed', 'system', 'Auto-routing',
            jsonb_build_object(
              'route_id', r.route_id, 'action', 'auto', 'auto', true,
              'responsible_business_id', r.responsible_business_id,
              'reporter_selected_business_id', r.reporter_selected_business_id,
              'reporter_selection_kind', 'verified'));
    v_routed := v_routed + 1;

    -- Delivery is best effort and observable; it can never undo routing.
    BEGIN
      PERFORM public.adr_notify_route_routed(r.route_id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO adr_notification_log (report_id, route_id, kind, recipient_business_id, status, error)
      VALUES (r.report_id, r.route_id, 'adr_case_routed', r.responsible_business_id, 'failed', left(SQLERRM, 500));
    END;
  END LOOP;

  RETURN jsonb_build_object('routed', v_routed, 'left_for_review', v_left);
END
$$;

COMMENT ON FUNCTION public.adr_auto_route_report(uuid) IS
  'Internal: routes pending reporter-selected registered (eligible) companies of a submitted public report. Not an RPC; run by trg_adr_auto_route and the backfill.';

-- ----------------------------------------------------------------------------
-- 2. Trigger: auto-route at submission, never block it
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adr_auto_route_on_submit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.adr_auto_route_report(NEW.report_id);
  EXCEPTION WHEN OTHERS THEN
    -- Whatever the helper did is rolled back with this sub-block: the routes
    -- stay pending and the reviewer queue picks them up. Submission goes on.
    BEGIN
      INSERT INTO adr_notification_log (report_id, kind, status, error)
      VALUES (NEW.report_id, 'adr_auto_route', 'failed', left(SQLERRM, 500));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_adr_auto_route ON adr_reports;
CREATE TRIGGER trg_adr_auto_route
  AFTER UPDATE OF status ON adr_reports
  FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status = 'submitted'
        AND NEW.report_source = 'public' AND NEW.gate_validated_at IS NOT NULL)
  EXECUTE FUNCTION public.adr_auto_route_on_submit();

-- ----------------------------------------------------------------------------
-- 3. Reviewer alert only when something is left to review
--    (same body as 20261114 plus the early return; must run after the trigger above)
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
    IF v_routes = 0 THEN
      RETURN NEW;   -- everything was auto-routed: nothing for a reviewer to do
    END IF;
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

-- ----------------------------------------------------------------------------
-- 4. Grants: internal functions are not RPCs. Re-read pg_proc.proacl after applying.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.adr_auto_route_report(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.adr_auto_route_on_submit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.adr_notify_reviewers_on_submit() FROM PUBLIC, anon, authenticated;
