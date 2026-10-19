-- Staff privilege guard (baseline finding S8). PREPARED, NOT APPLIED.
-- Tested on PGlite (scripts/db-tests/staff.pglite.mjs) against the permissive
-- policy from sql/phase2_rls_pilot.sql. THE LIVE POLICY ON staff MAY DIFFER:
-- check pg_policies before applying.
--
-- PROBLEM
--   staff has one FOR ALL policy scoped to the business. Any staff member of a
--   company can therefore UPDATE their own row (or a colleague's) and set role to
--   something containing "manager", INSERT new staff with such a role, change
--   status/email, or DELETE colleagues. is_business_manager() treats any role
--   containing "manager" as a manager, and everything built on it (team
--   check-ins, field-activity visibility, facility review) follows. So a plain rep
--   could promote themselves into reading the whole team's locations and reports.
--
-- FIX (layered on, nothing dropped)
--   * RESTRICTIVE insert/delete policies: only a manager/owner of the business, or
--     a platform admin, can create or remove staff rows.
--   * A BEFORE UPDATE trigger: a caller who is not a manager/owner/platform admin
--     cannot change role, status, email or business_id on any row (their own
--     included). Everyone can still edit other columns of their own row.
--   * business_id can only be changed by a platform admin (no moving staff
--     between companies).
--   * Calls with no end-user context (auth.uid() IS NULL: service role,
--     SECURITY DEFINER provisioning such as provision_staff_auth) are not blocked.
--
-- NOT SOLVED HERE: a manager can still make others managers. The UI limits staff
-- management to roles with canManageStaff, but the database cannot see custom role
-- permissions. Whether the database should be stricter (owner only) is a product
-- decision.
--
-- Rollback: DROP POLICY staff_insert_restrict, staff_delete_restrict ON public.staff;
--           DROP TRIGGER staff_privilege_guard ON public.staff; DROP FUNCTION public.staff_privilege_guard();

DROP POLICY IF EXISTS staff_insert_restrict ON public.staff;
CREATE POLICY staff_insert_restrict ON public.staff
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin() OR public.is_business_manager(business_id));

DROP POLICY IF EXISTS staff_delete_restrict ON public.staff;
CREATE POLICY staff_delete_restrict ON public.staff
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_platform_admin() OR public.is_business_manager(business_id));

CREATE OR REPLACE FUNCTION public.staff_privilege_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- server-side provisioning, not an end user
  END IF;
  IF NEW.business_id IS DISTINCT FROM OLD.business_id AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Staff cannot be moved between businesses' USING ERRCODE = '42501';
  END IF;
  IF public.is_platform_admin() OR public.is_business_manager(OLD.business_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Only a manager or the owner can change a staff role, status or email' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS staff_privilege_guard ON public.staff;
CREATE TRIGGER staff_privilege_guard BEFORE UPDATE ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.staff_privilege_guard();
