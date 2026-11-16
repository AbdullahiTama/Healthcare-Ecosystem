-- ============================================================================
-- Clients: visits and total spent changed only by the Owner, staff given
-- access, or the database itself (CODE_AUDIT A30)
--
-- STATUS: APPLIED 2026-11-16 as version 20261116104753, with owner approval.
--   Probed before committing (the whole migration in a rolled-back
--   transaction) and after, both rolled back: staff without the permission
--   refused on visits / total spent and still able to edit client details; a
--   sale by staff still refreshes the totals; the Owner can change them;
--   TRUNCATE refused; anon refused. Grants after: authenticated SELECT, INSERT,
--   UPDATE, DELETE; anon none. Security advisor: one expected warning,
--   can_adjust_client_totals is SECURITY DEFINER and executable by
--   authenticated: intended, as caller_owns_business; it answers only for the
--   caller (accepted).
--
-- PROBLEM (read live 2026-11-16)
-- -------
-- clients.visit_count and clients.total_spend are kept from sales by
-- refresh_client_totals (SECURITY DEFINER, run by the sales trigger), but the
-- table had no guard: the only policy is "clients of own business" (ALL), so
-- any member of a business could overwrite both through the API. anon held
-- every table privilege (RLS denied it every row), and authenticated also held
-- TRUNCATE, REFERENCES and TRIGGER; TRUNCATE is not subject to RLS (PostgREST
-- does not expose it, so it was not reachable through the API).
--
-- FIX (decided by the owner 2026-11-16: "only by owner or staff given access")
-- ---
-- * can_adjust_client_totals(business): true for the Owner of the business (or
--   of a business above it, as is_business_owner) and for active staff whose
--   role has canAdjustClientTotals = true; modelled on can_edit_purchases.
--   SECURITY DEFINER, EXECUTE for authenticated: it only answers for the
--   caller. (The other can_* helpers are not executable by authenticated, and
--   the guard below runs as the caller; see CODE_AUDIT A27.)
-- * clients_guard_totals, BEFORE INSERT OR UPDATE, running as the caller:
--     - trusted roles (postgres: refresh_client_totals, restore and other
--       SECURITY DEFINER functions; service_role; supabase_admin) and platform
--       admins pass;
--     - otherwise, without can_adjust_client_totals: a NEW client starts at 0
--       visits and ₦0 spent (the app always sends 0; the sales trigger fills
--       them), and an UPDATE that changes either is refused.
--   Every other column, and every other client write, is unchanged.
-- * Grants: anon loses every privilege on clients; authenticated keeps
--   SELECT, INSERT, UPDATE, DELETE (RLS still scopes them) and loses TRUNCATE,
--   REFERENCES and TRIGGER.
--
-- NOTE: the next sale, refund or correction for a client recomputes both
-- figures from the sales (refresh_client_totals), replacing a manual value.
--
-- SECURITY IMPLICATIONS
-- ---------------------
-- Narrows access only. Members keep reading and editing client details;
-- changing the two sales-derived figures needs the Owner or the new
-- permission. No policy changes.
--
-- ROLLBACK
-- --------
-- DROP TRIGGER clients_guard_totals ON public.clients;
-- DROP FUNCTION public.clients_guard_totals(); DROP FUNCTION public.can_adjust_client_totals(uuid);
-- GRANT ALL ON public.clients TO anon, authenticated;
--
-- TESTS
-- -----
-- apps/carefind/src/test/clients/clientTotalsGuard.db.test.js (PGlite, live
-- helpers, refresh_client_totals and grants).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_adjust_client_totals(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND p_business_id IN (SELECT public.current_business_ids())
     AND (
       public.is_business_owner(p_business_id)
       OR EXISTS (
         SELECT 1 FROM public.staff s
           JOIN public.roles r ON r.business_id = s.business_id AND r.name = s.role
          WHERE s.business_id = p_business_id AND s.status = 'active'
            AND lower(s.email) = lower(btrim(auth.email()))
            AND (r.permissions ->> 'canAdjustClientTotals') = 'true')
     )
$$;

REVOKE ALL ON FUNCTION public.can_adjust_client_totals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_adjust_client_totals(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.clients_guard_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin')
     OR public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF (coalesce(NEW.visit_count, 0) <> 0 OR coalesce(NEW.total_spend, 0) <> 0)
       AND NOT coalesce(public.can_adjust_client_totals(NEW.business_id), false) THEN
      NEW.visit_count := 0;
      NEW.total_spend := 0;
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.visit_count IS DISTINCT FROM OLD.visit_count OR NEW.total_spend IS DISTINCT FROM OLD.total_spend)
     AND NOT coalesce(public.can_adjust_client_totals(OLD.business_id), false) THEN
    RAISE EXCEPTION 'Only the Owner, or staff allowed to adjust client totals, can change a client''s visits and total spent. They are kept from sales.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.clients_guard_totals() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clients_guard_totals ON public.clients;
CREATE TRIGGER clients_guard_totals
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_guard_totals();

REVOKE ALL ON public.clients FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.clients FROM authenticated;
