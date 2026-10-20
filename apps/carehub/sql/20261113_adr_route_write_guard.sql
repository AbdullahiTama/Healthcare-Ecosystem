-- ============================================================================
-- ADR routing P0-1: close direct client writes to routing/authorisation columns.
--
-- Status: DRAFT, NOT APPLIED. Apply only with explicit owner approval.
--
-- Problem (docs/audits/carefind-carehub-pv-routing-audit.md, P0-1): the routes
-- INSERT/UPDATE policies admit a public-draft owner (and the submitter chain)
-- with no column restriction, and `authenticated` holds column INSERT/UPDATE on
-- status / responsible_business_id / selection_kind / verified_* /
-- company_status*. A reporter could therefore insert or flip a route to
-- status='routed' pointing at any business, bypassing admin verification, the
-- eligibility check and the validity gate.
--
-- Fix: a BEFORE INSERT OR UPDATE trigger (SECURITY INVOKER, so current_user is
-- the real caller). Direct writes by the API roles `authenticated`/`anon` are
-- restricted to a safe shape; every legitimate mutation already goes through a
-- SECURITY DEFINER RPC (create_adr_product_route, verify_adr_product_route,
-- update_adr_route_workflow), which runs as the function owner and is not
-- restricted. service_role / postgres are unaffected.
--   INSERT by an API role: status must be 'pending', company_status 'new', no
--     verification/ack fields, and a 'verified' selection must point at an
--     eligible company.
--   UPDATE by an API role: none of the identity, selection, status or workflow
--     columns may change. (Nothing in either app updates a route directly.)
-- Platform admins use the RPCs too; there is deliberately no admin bypass.
-- ============================================================================

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
       OR NEW.acknowledged_at IS NOT NULL THEN
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
     OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at THEN
    RAISE EXCEPTION 'route columns are changed only through the routing functions';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_adr_guard_route_writes ON adr_product_company_routes;
CREATE TRIGGER trg_adr_guard_route_writes
  BEFORE INSERT OR UPDATE ON adr_product_company_routes
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_guard_route_writes();

COMMENT ON FUNCTION public.adr_guard_route_writes() IS
  'P0-1: API roles cannot set or change routing/authorisation columns on adr_product_company_routes; only the DEFINER routing RPCs can.';

-- Trigger functions must not be callable as RPCs (see gotcha: default privileges
-- re-grant EXECUTE to anon after creation; re-check pg_proc.proacl after apply).
REVOKE EXECUTE ON FUNCTION public.adr_guard_route_writes() FROM PUBLIC, anon, authenticated;
