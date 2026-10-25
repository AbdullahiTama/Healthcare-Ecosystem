-- carehub_20261210_branch_plan_follows_parent  (DRAFT, not applied)
--
-- A branch is its own businesses row and carries its own plan and plan_expires_at. guard_business_insert makes a new
-- branch copy its parent's plan and expiry ONCE, at creation. Nothing kept them in step afterwards: a renewal
-- (extend_business_plan updates only the business that paid) or an admin plan change on the main business never
-- reached its branches, so branches locked out on the old date while the owner had paid (review 2026-10-25,
-- finding 5). No business had branches in production when this was written.
--
-- What this does
--   * AFTER UPDATE OF plan, plan_expires_at on a MAIN business (parent_business_id is null): copy the new plan and
--     expiry to every descendant (branches, and branches of branches, depth <= 10).
--   * A branch's own update never cascades (a platform admin may still set a branch's plan by hand; the next change
--     on the main business brings it back in step).
--   * Backfills existing branches from their main business once.
--
-- Security implications: the trigger function is SECURITY DEFINER so its updates run as the table owner, which
-- guard_business_privileged_columns already treats as trusted (plan and plan_expires_at are otherwise
-- platform-admin-only). It only ever copies the main business's own values downwards, so it gives no caller a plan
-- they could not already set on the main business. Nobody can call it directly.
--
-- Rollback: DROP TRIGGER businesses_branch_plan_follows_parent ON public.businesses;
--           DROP FUNCTION public.businesses_branch_plan_follows_parent();

CREATE OR REPLACE FUNCTION public.businesses_branch_plan_follows_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.parent_business_id IS NOT NULL THEN RETURN NULL; END IF;
  IF NEW.plan IS NOT DISTINCT FROM OLD.plan AND NEW.plan_expires_at IS NOT DISTINCT FROM OLD.plan_expires_at THEN RETURN NULL; END IF;
  WITH RECURSIVE descendants(id, depth) AS (
    SELECT b.id, 1 FROM public.businesses b WHERE b.parent_business_id = NEW.id
    UNION
    SELECT b.id, d.depth + 1 FROM public.businesses b JOIN descendants d ON b.parent_business_id = d.id WHERE d.depth < 10
  )
  UPDATE public.businesses b
     SET plan = NEW.plan, plan_expires_at = NEW.plan_expires_at
   WHERE b.id IN (SELECT id FROM descendants)
     AND (b.plan IS DISTINCT FROM NEW.plan OR b.plan_expires_at IS DISTINCT FROM NEW.plan_expires_at);
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.businesses_branch_plan_follows_parent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS businesses_branch_plan_follows_parent ON public.businesses;
CREATE TRIGGER businesses_branch_plan_follows_parent
  AFTER UPDATE OF plan, plan_expires_at ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.businesses_branch_plan_follows_parent();

-- Backfill: every branch takes its main business's current plan and expiry.
WITH RECURSIVE tree(id, root_id, depth) AS (
  SELECT b.id, b.id, 0 FROM public.businesses b WHERE b.parent_business_id IS NULL
  UNION
  SELECT b.id, t.root_id, t.depth + 1 FROM public.businesses b JOIN tree t ON b.parent_business_id = t.id WHERE t.depth < 10
)
UPDATE public.businesses b
   SET plan = r.plan, plan_expires_at = r.plan_expires_at
  FROM tree t JOIN public.businesses r ON r.id = t.root_id
 WHERE b.id = t.id AND t.depth > 0
   AND (b.plan IS DISTINCT FROM r.plan OR b.plan_expires_at IS DISTINCT FROM r.plan_expires_at);

-- Verify, do not assume.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'businesses_branch_plan_follows_parent' AND tgrelid = 'public.businesses'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'businesses_branch_plan_follows_parent trigger is missing';
  END IF;
  IF has_function_privilege('anon', 'public.businesses_branch_plan_follows_parent()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.businesses_branch_plan_follows_parent()', 'EXECUTE') THEN
    RAISE EXCEPTION 'businesses_branch_plan_follows_parent must not be callable directly';
  END IF;
  IF EXISTS (
    WITH RECURSIVE tree(id, root_id, depth) AS (
      SELECT b.id, b.id, 0 FROM public.businesses b WHERE b.parent_business_id IS NULL
      UNION
      SELECT b.id, t.root_id, t.depth + 1 FROM public.businesses b JOIN tree t ON b.parent_business_id = t.id WHERE t.depth < 10
    )
    SELECT 1 FROM tree t JOIN public.businesses b ON b.id = t.id JOIN public.businesses r ON r.id = t.root_id
     WHERE t.depth > 0 AND (b.plan IS DISTINCT FROM r.plan OR b.plan_expires_at IS DISTINCT FROM r.plan_expires_at)
  ) THEN
    RAISE EXCEPTION 'a branch is still out of step with its main business after the backfill';
  END IF;
END $$;
