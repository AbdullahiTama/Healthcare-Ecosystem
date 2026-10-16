-- ============================================================================
-- ADR notifications: cross-tenant party notify RPC (in-app staff_notifications).
--
-- Status: APPLIED live 2026-10-16 under explicit owner authorisation
--         ("okay lets apply the migrations"). Pre-apply live verification:
--         all referenced functions/tables/columns present (no drift vs. the
--         PGlite fixture). Covered by PGlite adversarial tests in
--         apps/carefind/src/test/adr/routingAdversarial.db.test.js, which
--         replay this file verbatim. Comms/privacy sign-off on notification
--         copy (D6) remains outstanding — see ADR-Release-Record §6b; the RPC
--         ships with conservative fixed templates and deadline kinds blocked.
--
-- Why an RPC and not the client notify() helper: staff_notifications RLS
-- requires the WRITER to belong to the target business
-- (business_id IN current_business_ids()), so a company user notifying the
-- submitting business — or vice versa — is rejected, and notify() swallows
-- the failure. This DEFINER RPC resolves recipients from VERIFIED
-- relationships (routes/report chain) and writes with explicit checks.
--
-- Recipients are derived, never invented:
--   routing_verified / follow_up_version  -> owner + active managers of each
--     business holding a verified/routed route on the report. (Manager test
--     mirrors permissions.js isManagerRole: role ILIKE '%manager%'.)
--   followup_requested                     -> submitting business owner plus the
--     report's creating staff row when present. Public reports (NULL business)
--     have no staff-side recipient: returns notified 0 with an explicit reason
--     (reporter notification needs a CareFind recipient channel + privacy
--     sign-off — recorded as blocked, not built).
--   deadline_*                             -> REJECTED here until NAFDAC
--     timelines are regulator-confirmed. No deadline notification may ship on
--     unverified intervals; the rule table is explicitly marked unverified.
--
-- Content policy: title required (blank raises); body truncated to 2000 chars.
-- Callers must not include patient identifiers — the UI sends fixed templates
-- with report numbers and counts only. Recent-duplicate suppression (same
-- business + kind + report within 1 hour) prevents retry storms.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_adr_party(
  p_report_id uuid,
  p_kind text,
  p_title text,
  p_body text DEFAULT NULL,
  p_link text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report adr_reports;
  v_title text;
  v_body text;
  v_notified integer := 0;
  v_reason text := NULL;
BEGIN
  IF p_kind NOT IN ('routing_verified', 'followup_version_created', 'followup_requested') THEN
    RAISE EXCEPTION 'notification kind % is not approved (deadline notifications are blocked pending regulator-confirmed timelines)', p_kind;
  END IF;

  SELECT * INTO v_report FROM adr_reports WHERE report_id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found';
  END IF;

  -- Caller must already reach the case through one of the verified paths.
  IF NOT public.can_access_adr_report(p_report_id)
     AND NOT public.can_write_adr_route_company(
       (SELECT route_id FROM adr_product_company_routes WHERE report_id = p_report_id LIMIT 1)
     )
     AND NOT is_platform_admin() THEN
    -- can_write needs a route_id; fall back to the report-level routed check
    -- so responsible companies without a single handy route still qualify.
    IF NOT public.can_access_adr_routed_report(p_report_id) THEN
      RAISE EXCEPTION 'not accessible';
    END IF;
  END IF;

  v_title := trim(both from coalesce(p_title, ''));
  IF v_title = '' THEN
    RAISE EXCEPTION 'notification title is required';
  END IF;
  v_body := left(trim(both from coalesce(p_body, '')), 2000);

  IF p_kind IN ('routing_verified', 'followup_version_created') THEN
    -- Every verified/routed responsible business: owner row + active managers.
    WITH targets AS (
      SELECT DISTINCT rt.responsible_business_id AS business_id
        FROM adr_product_company_routes rt
       WHERE rt.report_id = p_report_id
         AND rt.status IN ('verified', 'routed')
         AND rt.responsible_business_id IS NOT NULL
    ),
    recipients AS (
      SELECT t.business_id, NULL::uuid AS staff_id, true AS is_owner FROM targets t
      UNION
      SELECT s.business_id, s.id AS staff_id, false AS is_owner
        FROM staff s
        JOIN targets t ON t.business_id = s.business_id
       WHERE s.status = 'active' AND s.role ILIKE '%manager%'
    ),
    fresh AS (
      INSERT INTO staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
      SELECT r.business_id, r.staff_id, r.is_owner,
             'adr_' || p_kind, v_title, nullif(v_body, ''), p_link
        FROM recipients r
       WHERE NOT EXISTS (
         SELECT 1 FROM staff_notifications n
          WHERE n.business_id = r.business_id
            AND coalesce(n.staff_id, '00000000-0000-0000-0000-000000000000')
                = coalesce(r.staff_id, '00000000-0000-0000-0000-000000000000')
            AND n.kind = 'adr_' || p_kind
            AND n.link IS NOT DISTINCT FROM p_link
            AND n.created_at > now() - interval '1 hour'
       )
      RETURNING 1
    )
    SELECT count(*) INTO v_notified FROM fresh;

  ELSIF p_kind = 'followup_requested' THEN
    -- Submitting business only; public reports have no staff-side recipient.
    IF v_report.business_id IS NULL THEN
      v_reason := 'no-business-recipient';
    ELSE
    WITH recipients AS (
      SELECT v_report.business_id AS business_id, NULL::uuid AS staff_id, true AS is_owner
      UNION
      SELECT v_report.business_id, s.id, false
        FROM staff s
       WHERE s.id = v_report.created_by_user_id AND s.status = 'active'
    ),
    fresh AS (
      INSERT INTO staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
      SELECT r.business_id, r.staff_id, r.is_owner,
             'adr_followup_requested', v_title, nullif(v_body, ''), p_link
        FROM recipients r
       WHERE NOT EXISTS (
         SELECT 1 FROM staff_notifications n
          WHERE n.business_id = r.business_id
            AND coalesce(n.staff_id, '00000000-0000-0000-0000-000000000000')
                = coalesce(r.staff_id, '00000000-0000-0000-0000-000000000000')
            AND n.kind = 'adr_followup_requested'
            AND n.link IS NOT DISTINCT FROM p_link
            AND n.created_at > now() - interval '1 hour'
       )
      RETURNING 1
    )
    SELECT count(*) INTO v_notified FROM fresh;
    END IF;
  END IF;

  -- Delivery outcome is audit-visible on the case timeline (the notify rows
  -- themselves live in staff_notifications, scoped per business).
  INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
  SELECT p_report_id, 'note', a.actor_type, a.actor_name,
         jsonb_build_object('action', 'party_notified', 'kind', p_kind, 'notified', v_notified)
    FROM adr_event_actor(p_report_id) a;

  RETURN jsonb_build_object('notified', v_notified, 'reason', v_reason);
END
$$;

COMMENT ON FUNCTION public.notify_adr_party(uuid, text, text, text, text) IS
  'Completion audit gap 7: cross-tenant ADR party notifications with derived (never invented) recipients. Deadline kinds rejected until regulator-confirmed.';

REVOKE EXECUTE ON FUNCTION public.notify_adr_party(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_adr_party(uuid, text, text, text, text) TO authenticated;
