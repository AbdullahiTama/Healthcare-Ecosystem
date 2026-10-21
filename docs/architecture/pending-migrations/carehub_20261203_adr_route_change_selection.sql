-- ============================================================================
-- ADR routing: let a reporter change the company on their own DRAFT.
--
-- Status: DRAFT, NOT APPLIED. Needs owner approval before it goes to production.
--
-- Bug (reported 2026-10-21 from CareFind, "Could not save. Check your connection
-- and retry."): create_adr_product_route() only ever INSERTs a route. The
-- trigger trg_adr_public_single_company (20261111) refuses a second route for the
-- same product on a public report. So once a product has a route (the page saves
-- one every time the reporter presses Next, including "I don't know"), any later
-- change of company raises 'public reports allow at most one company selection
-- per suspect product', which the page shows as a connection problem. Reproduced
-- on the live database as a draft owner: first route ok, same key ok, DIFFERENT
-- company -> error, switch to "unknown" -> error.
--
-- Fix: in create_adr_product_route(), when the reporter's report is still a
-- public DRAFT and the product's existing route has not been touched by anyone
-- (status pending, not held, not reviewed), REPLACE that selection in place
-- instead of inserting a second one. Everything else is unchanged:
--   * same idempotency key -> same row, no new event (retries stay safe)
--   * a submitted report, or a route a reviewer has held/reviewed/routed, is never
--     rewritten; the one-company-per-product trigger still refuses a second route
--   * eligibility, ownership and shape checks run first, exactly as before
--   * the reporter's choice is recorded in reporter_selected_business_id /
--     reporter_candidate_name (what the reviewer sees) and a routing_created
--     event notes that it replaced an earlier selection
-- Runs as the function owner, so the 20261113 write guard (API roles only) is not
-- involved; direct client writes to routes stay blocked.
--
-- Same signature as before, so CREATE OR REPLACE leaves no sibling overload
-- (memory: reference-supabase-carehub-gotchas #1); ACL is re-checked below (#2).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_adr_product_route(
  p_report_id uuid,
  p_product_id uuid,
  p_selection_kind text,
  p_responsible_business_id uuid DEFAULT NULL::uuid,
  p_candidate_name text DEFAULT NULL::text,
  p_idempotency_key text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
  v_candidate text;
  v_norm text;
  v_route adr_product_company_routes;
  v_old adr_product_company_routes;
  v_replaced boolean := false;
BEGIN
  IF p_selection_kind NOT IN ('verified','unknown','unverified_candidate') THEN
    RAISE EXCEPTION 'invalid selection_kind %', p_selection_kind;
  END IF;

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

  -- Retry of a selection already stored: return it untouched.
  SELECT * INTO v_route FROM adr_product_company_routes WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'route_id', v_route.route_id, 'report_id', v_route.report_id, 'product_id', v_route.product_id,
      'selection_kind', v_route.selection_kind, 'status', v_route.status);
  END IF;

  -- The reporter changed their mind on a draft nobody has acted on: replace in place.
  SELECT r.* INTO v_old
    FROM adr_product_company_routes r
    JOIN adr_reports a ON a.report_id = r.report_id
   WHERE r.report_id = p_report_id AND r.product_id = p_product_id
     AND a.report_source = 'public' AND a.status = 'draft'
     AND r.status = 'pending' AND r.held_at IS NULL AND r.reviewed_at IS NULL
   ORDER BY r.created_at DESC
   LIMIT 1
   FOR UPDATE OF r;

  IF FOUND THEN
    UPDATE adr_product_company_routes
       SET responsible_business_id = p_responsible_business_id,
           candidate_name = CASE WHEN p_selection_kind = 'unverified_candidate' THEN v_candidate END,
           normalized_candidate = CASE WHEN p_selection_kind = 'unverified_candidate' THEN v_norm END,
           selection_kind = p_selection_kind,
           idempotency_key = v_key,
           reporter_selected_business_id = p_responsible_business_id,
           reporter_candidate_name = CASE WHEN p_selection_kind = 'unverified_candidate' THEN v_candidate END
     WHERE route_id = v_old.route_id
    RETURNING * INTO v_route;
    v_replaced := true;
  ELSE
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
      RETURN jsonb_build_object(
        'route_id', v_route.route_id, 'report_id', v_route.report_id, 'product_id', v_route.product_id,
        'selection_kind', v_route.selection_kind, 'status', v_route.status);
    END IF;
  END IF;

  INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
  SELECT p_report_id, 'routing_created', a.actor_type, a.actor_name,
         jsonb_build_object('route_id', v_route.route_id, 'selection_kind', p_selection_kind)
           || CASE WHEN v_replaced
                   THEN jsonb_build_object('replaced_selection_kind', v_old.selection_kind)
                   ELSE '{}'::jsonb END
    FROM adr_event_actor(p_report_id) a;

  RETURN jsonb_build_object(
    'route_id', v_route.route_id,
    'report_id', v_route.report_id,
    'product_id', v_route.product_id,
    'selection_kind', v_route.selection_kind,
    'status', v_route.status
  );
END
$function$;

REVOKE EXECUTE ON FUNCTION public.create_adr_product_route(uuid, uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_adr_product_route(uuid, uuid, text, uuid, text, text) TO authenticated;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'create_adr_product_route') <> 1 THEN
    RAISE EXCEPTION 'create_adr_product_route must exist exactly once';
  END IF;
  IF has_function_privilege('anon', 'public.create_adr_product_route(uuid, uuid, text, uuid, text, text)', 'execute') THEN
    RAISE EXCEPTION 'anon must not be able to execute create_adr_product_route';
  END IF;
END $$;
