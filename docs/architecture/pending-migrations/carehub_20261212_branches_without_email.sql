-- carehub_20261212_branches_without_email  (DRAFT, not applied)
--
-- Branches (businesses rows with a parent_business_id) have no sign-in email of their own (owner's decision
-- 2026-10-25, option A). Until now businesses.email was NOT NULL and UNIQUE while the Locations page created branches
-- with the owner's email, so adding a branch was refused (23505 businesses_email_key) and no business had branches.
--
-- businesses.email is an IDENTITY column: current_business_ids(), is_business_manager() and others treat "the
-- caller's auth email equals a business's email" as owning that business. So a branch must not carry anyone's email
-- (an owner typing a manager's address there would make that manager an owner of the branch). The owner of a branch
-- is the owner of its main business, found by walking parent_business_id, as current_business_ids(),
-- is_business_manager() and record_export_audit() already do.
--
-- What this does
--   1. businesses.email becomes optional for branches only: a main business must still have one (CHECK), and it
--      stays UNIQUE (several NULLs are allowed by a unique constraint).
--   2. A signed-in caller who is not a platform admin cannot give a branch an email (insert or update).
--   3. caller_owns_business(bid): the caller's email is the email of bid or of one of its ancestors (depth <= 10).
--   4. The two checks that compared only the row's OWN email now use it: orders_caller_is_owner(bid) (owner approval
--      and corrections of orders at a branch) and can_access_adr_report_row (the owner reading a branch's ADR
--      reports). Everything else in those functions is unchanged.
--
-- Security implications: no one gains access they did not have before except an owner over their own branches,
-- which current_business_ids() already granted for ordinary reads. Branches can never carry an identity email, so a
-- branch cannot be used to hand owner rights to someone else. Main businesses are unchanged (email required, unique).
--
-- Rollback: ALTER TABLE public.businesses DROP CONSTRAINT businesses_main_has_email; (then, only if no branch has a
--           NULL email) ALTER TABLE public.businesses ALTER COLUMN email SET NOT NULL; DROP TRIGGER
--           businesses_branch_no_email ON public.businesses; DROP FUNCTION public.businesses_branch_no_email();
--           restore orders_caller_is_owner and can_access_adr_report_row from their previous definitions (quoted in
--           docs/architecture/pending-migrations/README.md); DROP FUNCTION public.caller_owns_business(uuid).

-- 1. Optional email for branches, required for main businesses.
ALTER TABLE public.businesses ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_main_has_email;
ALTER TABLE public.businesses ADD CONSTRAINT businesses_main_has_email CHECK (parent_business_id IS NOT NULL OR email IS NOT NULL);

-- 2. A branch carries no identity email (platform admins and server-side work excepted).
CREATE OR REPLACE FUNCTION public.businesses_branch_no_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin') OR coalesce(public.is_platform_admin(), false) THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_business_id IS NOT NULL AND NEW.email IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.email IS DISTINCT FROM OLD.email) THEN
    RAISE EXCEPTION 'A branch has no sign-in email of its own; it belongs to the main business''s owner.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.businesses_branch_no_email() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS businesses_branch_no_email ON public.businesses;
CREATE TRIGGER businesses_branch_no_email
  BEFORE INSERT OR UPDATE OF email, parent_business_id ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.businesses_branch_no_email();

-- 3. Ownership follows the parent chain.
CREATE OR REPLACE FUNCTION public.caller_owns_business(bid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH RECURSIVE up(id, parent_business_id, email, depth) AS (
    SELECT b.id, b.parent_business_id, b.email, 0 FROM public.businesses b WHERE b.id = bid
    UNION
    SELECT p.id, p.parent_business_id, p.email, up.depth + 1
      FROM public.businesses p JOIN up ON p.id = up.parent_business_id
     WHERE up.depth < 10
  )
  SELECT auth.email() IS NOT NULL AND EXISTS (SELECT 1 FROM up WHERE lower(up.email) = lower(auth.email()))
$$;
REVOKE ALL ON FUNCTION public.caller_owns_business(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_owns_business(uuid) TO authenticated, service_role;

-- 4a. Orders: the owner of the main business is the owner at its branches too.
CREATE OR REPLACE FUNCTION public.orders_caller_is_owner(bid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.caller_owns_business(bid)
$function$;

-- 4b. ADR: same body as before except the owner clause (was: p_business_id IN (SELECT id FROM businesses WHERE
-- lower(email) = lower(auth.email()))).
CREATE OR REPLACE FUNCTION public.can_access_adr_report_row(p_business_id uuid, p_created_by_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT is_platform_admin()
    OR public.caller_owns_business(p_business_id)
    OR p_business_id IN (
         SELECT s.business_id FROM staff s
         WHERE s.status = 'active'
           AND lower(s.email) = lower(auth.email())
           AND s.role IN ('Manager', 'Owner')
       )
    OR (
         p_created_by_user_id IS NOT NULL
         AND p_created_by_user_id IN (
           SELECT s.id FROM staff s
           WHERE s.status = 'active'
             AND (s.auth_user_id = auth.uid() OR lower(s.email) = lower(auth.email()))
         )
       )
$function$;

-- Verify, do not assume.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.businesses WHERE parent_business_id IS NULL AND email IS NULL) THEN
    RAISE EXCEPTION 'a main business has no email';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'businesses_email_key') THEN
    RAISE EXCEPTION 'businesses.email must stay unique';
  END IF;
  IF has_function_privilege('anon', 'public.caller_owns_business(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.businesses_branch_no_email()', 'EXECUTE') THEN
    RAISE EXCEPTION 'function grants are wrong';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname IN ('orders_caller_is_owner', 'can_access_adr_report_row', 'caller_owns_business')) <> 3 THEN
    RAISE EXCEPTION 'expected exactly one overload each of the ownership functions';
  END IF;
END $$;
