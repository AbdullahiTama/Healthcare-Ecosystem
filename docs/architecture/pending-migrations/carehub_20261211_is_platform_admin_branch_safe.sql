-- carehub_20261211_is_platform_admin_branch_safe  (DRAFT, not applied)
--
-- is_platform_admin() read the flag with a scalar subquery:
--   SELECT COALESCE((SELECT is_platform_admin FROM businesses WHERE lower(email) = lower(auth.email())), false)
-- Branches are businesses rows created with their owner's email (Locations.jsx, guard_business_insert), so once an
-- owner adds a branch the subquery returns two rows and every call raises 21000 "more than one row returned by a
-- subquery used as an expression". 174 RLS policies call it (2026-10-25), so that owner's whole app fails, at the
-- main business and every branch. No business had a branch when this was found (branch review 2026-10-25).
--
-- The flag is read from the caller's MAIN business row(s) only (parent_business_id is null), aggregated so any
-- number of rows is safe. Same signature, return type, volatility, SECURITY DEFINER and grants: no policy changes.
--
-- Security implications: the answer is unchanged for every account today (no two main businesses share an email;
-- both platform-admin rows are main businesses, checked 2026-10-25). Branch rows are ignored, so a branch can never
-- make its owner a platform admin; guard_business_insert and guard_business_privileged_columns already stop anyone
-- but a platform admin from setting the flag on any row.
--
-- Rollback: re-create the previous body (quoted above) with CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(bool_or(b.is_platform_admin), false)
    FROM businesses b
   WHERE lower(b.email) = lower(auth.email())
     AND b.parent_business_id IS NULL
$function$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

-- Verify, do not assume.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_platform_admin') <> 1 THEN
    RAISE EXCEPTION 'is_platform_admin must have exactly one overload';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.is_platform_admin()'::regprocedure) THEN
    RAISE EXCEPTION 'is_platform_admin must stay SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.is_platform_admin()', 'EXECUTE') OR NOT has_function_privilege('authenticated', 'public.is_platform_admin()', 'EXECUTE') THEN
    RAISE EXCEPTION 'is_platform_admin grants are wrong';
  END IF;
END $$;
