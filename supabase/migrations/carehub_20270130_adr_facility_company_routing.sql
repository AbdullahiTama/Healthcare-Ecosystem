-- ─────────────────────────────────────────────────────────────────────────────
-- ADR: facility reports reach the manufacturer / importer the facility selects.
-- 2026-11-19. Docs: docs/architecture/ADR-Facility-Company-Routing.md
-- Status: APPLIED to the live carehub project 2026-11-19 with owner approval (version 20261119085426); owner chose
-- auto-routing for facilities. Live bodies match this file (md5 of prosrc: create_adr_product_route fd8805a9…,
-- adr_auto_route_report 5b78e6a8…, adr_notify_reviewers_on_submit ce3f9903…, list_adr_route_review_queue 4af252a1…);
-- grants unchanged; trg_adr_auto_route still fires before trg_adr_notify_reviewers. Live probe as a real pharmacy
-- owner inside a rolled-back block: 7 companies listed; picking company A then B left one route; submit_adr_report
-- valid; route routed to B with an auto routing_routed event; B alerted; B sees the case with reporter name, facility
-- and phone masked; A sees nothing. Afterwards routes / reports / notifications unchanged (14 / 67 / 922), no probe
-- rows. Tested first on PGlite (apps/carefind/src/test/adr/facilityCompanyRouting.db.test.js).
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY (verified live 2026-11-19)
-- CareHub's facility ADR form already offers a company picker per suspect product, and create_adr_product_route
-- accepts a facility's selection (probe: a facility owner's draft got a pending route). But nothing after that
-- handled facility reports: every step was limited to report_source = 'public':
--   * adr_auto_route_report / trg_adr_auto_route: only public submissions are routed to the selected company;
--   * list_adr_route_review_queue: reviewers only see public routes;
--   * adr_notify_reviewers_on_submit: reviewers are only alerted for public reports.
-- So a facility's selection could never reach the company. Live: 14 public routes (12 routed), 0 facility routes
-- across 50 facility reports. In addition, on a facility draft a changed selection was ADDED next to the old one
-- (the replace-on-change rule was public-only), which, once routing works, would send the case to both companies.
--
-- WHAT
-- * The same routing rules now apply to reports from facilities (report_source 'business_facility' and
--   'health_facility') as to public reports, at the same point (draft -> submitted with the validation gate passed):
--   a registered, still-eligible company the reporter selected is routed at once and alerted; typed names, "I don't
--   know", ineligible or held selections go to the reviewer queue, and reviewers are alerted. 'unknown' (unclassified)
--   reports are still not routed automatically.
-- * create_adr_product_route: on any draft (not only public), choosing a different company for a product REPLACES its
--   pending selection, audited as before (routing_created with replaced_selection_kind). Routes already verified,
--   routed, held or reviewed are never replaced. Submitted reports are unchanged (append, as before).
-- * Everything else in the four functions is byte-identical to the live bodies read on 2026-11-19 (md5 of prosrc:
--   create_adr_product_route d24de144…, adr_auto_route_report e51a2cf3…, adr_notify_reviewers_on_submit 65fc8f78…,
--   list_adr_route_review_queue a09d1811…). Signatures, SECURITY DEFINER, search_path and grants are unchanged.
--
-- SECURITY (read before approving)
-- * Extends the owner's 2026-10-22 auto-routing decision (carehub_20261206) from public reporters to facilities: when
--   a facility picks a REGISTERED company, the case goes to that company's PV Tracker at submission with no human
--   check. The company sees what it sees for public cases (adr_pv_case_view): reporter name, facility name, phone,
--   e-mail and licence stay masked; patient clinical data (age, history, medicines, batch, narrative) is visible.
--   Nothing verifies that the product belongs to the selected company; a wrong selection is a disclosure to that
--   company. Mitigations: only active Manufacturer / Importer or Wholesale businesses can be selected, eligibility is
--   re-checked at routing, a draft's selection can be changed before submission (now a replacement, so no stale
--   second company), and every routing is audited (routing_routed, auto:true).
-- * Facility reporters are signed-in registered businesses (RLS submitter chain), a narrower population than public
--   reporters. No new grants; API roles still cannot write route state (guard trigger 20261113/20261114 untouched).
--
-- ROLLBACK
-- Re-run the four function bodies from the live definitions recorded above (same signatures) and recreate
-- trg_adr_auto_route with `AND NEW.report_source = 'public'`. Routes already routed stay routed (the case stays visible
-- to that company); un-route through a reviewer only if needed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_adr_product_route(p_report_id uuid, p_product_id uuid, p_selection_kind text, p_responsible_business_id uuid DEFAULT NULL::uuid, p_candidate_name text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
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

  SELECT * INTO v_route FROM adr_product_company_routes WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'route_id', v_route.route_id, 'report_id', v_route.report_id, 'product_id', v_route.product_id,
      'selection_kind', v_route.selection_kind, 'status', v_route.status);
  END IF;

  SELECT r.* INTO v_old
    FROM adr_product_company_routes r
    JOIN adr_reports a ON a.report_id = r.report_id
   WHERE r.report_id = p_report_id AND r.product_id = p_product_id
     AND a.status = 'draft'
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

CREATE OR REPLACE FUNCTION public.adr_auto_route_report(p_report_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rep adr_reports;
  r adr_product_company_routes;
  v_routed integer := 0;
  v_left integer := 0;
BEGIN
  SELECT * INTO rep FROM adr_reports WHERE report_id = p_report_id;
  IF NOT FOUND
     OR rep.report_source IS NULL OR rep.report_source NOT IN ('public', 'health_facility', 'business_facility')
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

    BEGIN
      PERFORM public.adr_notify_route_routed(r.route_id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO adr_notification_log (report_id, route_id, kind, recipient_business_id, status, error)
      VALUES (r.report_id, r.route_id, 'adr_case_routed', r.responsible_business_id, 'failed', left(SQLERRM, 500));
    END;
  END LOOP;

  RETURN jsonb_build_object('routed', v_routed, 'left_for_review', v_left);
END
$function$;

CREATE OR REPLACE FUNCTION public.adr_notify_reviewers_on_submit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_num text;
  v_routes integer;
  rec record;
BEGIN
  IF NOT (OLD.status = 'draft' AND NEW.status = 'submitted'
          AND NEW.report_source IN ('public', 'health_facility', 'business_facility') AND NEW.gate_validated_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_num := coalesce(NEW.report_number, NEW.report_id::text);
    SELECT count(*) INTO v_routes FROM adr_product_company_routes WHERE report_id = NEW.report_id AND status = 'pending';
    IF v_routes = 0 THEN
      RETURN NEW;
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
    NULL;
  END;
  RETURN NEW;
END
$function$;

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
    AND rep.report_source IN ('public', 'health_facility', 'business_facility')
    AND CASE coalesce(p_state, 'open')
          WHEN 'held' THEN rt.held_at IS NOT NULL
          WHEN 'all' THEN true
          ELSE rt.held_at IS NULL END
  ORDER BY rt.created_at ASC
$$;

-- Same trigger, same name (it must keep sorting before trg_adr_notify_reviewers), wider source condition.
DROP TRIGGER IF EXISTS trg_adr_auto_route ON public.adr_reports;
CREATE TRIGGER trg_adr_auto_route
  AFTER UPDATE OF status ON public.adr_reports
  FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status = 'submitted'
        AND NEW.report_source IN ('public', 'health_facility', 'business_facility') AND NEW.gate_validated_at IS NOT NULL)
  EXECUTE FUNCTION public.adr_auto_route_on_submit();

-- Grants unchanged; restated so a re-run cannot widen them.
REVOKE ALL ON FUNCTION public.adr_auto_route_report(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adr_notify_reviewers_on_submit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_adr_product_route(uuid, uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_adr_product_route(uuid, uuid, text, uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_adr_route_review_queue(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_adr_route_review_queue(text) TO authenticated, service_role;
