-- Issue #1 follow-up (audit item 3, 2026-08-23): enforce the facility review
-- workflow in the database instead of in the UI alone.
--
-- Before: facilities_cache and rep_added_facilities each carried ONE `FOR ALL`
-- policy scoped to the business. Any staff member could therefore confirm or
-- delete another rep's pending facility, or write straight into
-- facilities_cache and skip review entirely. Confirm/Dismiss were gated only by
-- hiding the buttons in LiveActivity.jsx — the REST API was wide open to every
-- member of the business.
--
-- After: reads, and the two writes a rep legitimately makes (adding a PENDING
-- facility, filling the detected-facility cache), stay open to any member of
-- the business. Every review decision — confirming, editing a confirmed row, or
-- deleting — requires a manager or the owner.
--
-- Residual risk this does NOT close: the detected-facility cache is filled from
-- a client-side Overpass call, so a member can still insert a fabricated row as
-- source='detected'. That is inherent to fetching the map data in the browser;
-- closing it means proxying Overpass through an Edge Function so the server is
-- the only writer. Until then `created_by` below makes such a row attributable.

-- ---------------------------------------------------------------------------
-- 1. is_business_manager(bid) — the DB-side half of the "who is a manager?"
--    rule. Must stay in step with isManagerRole() in
--    apps/carehub/src/lib/permissions.js: a SUBSTRING match, not equality
--    against a preset "Manager". Manufacturer/Importer and Wholesale tenants
--    type their own role names ("Regional Manager", "<Brand> Manager"), so an
--    exact match finds nobody (that was audit item 2).
--
--    Owner-level access walks UP the branch tree: a parent-business owner is a
--    manager of its branches. Rights are capped by current_business_ids() so
--    this can never widen visibility beyond what the user can already see.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_business_manager(bid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH RECURSIVE ancestry AS (
    -- The business itself, then each parent in turn. `depth` is a cycle guard:
    -- parent_business_id is not constrained to be acyclic.
    SELECT b.id, b.parent_business_id, b.email, 0 AS depth
    FROM businesses b
    WHERE b.id = bid
    UNION ALL
    SELECT p.id, p.parent_business_id, p.email, a.depth + 1
    FROM businesses p
    INNER JOIN ancestry a ON p.id = a.parent_business_id
    WHERE a.depth < 10
  )
  SELECT
    (
      bid IN (SELECT current_business_ids())
      AND (
        -- Owner of this business or of any business above it.
        EXISTS (SELECT 1 FROM ancestry a WHERE lower(a.email) = lower(auth.email()))
        -- Or active staff at this business whose role reads as a manager.
        OR EXISTS (
          SELECT 1 FROM staff s
          WHERE s.business_id = bid
            AND lower(s.email) = lower(auth.email())
            AND s.status = 'active'
            AND s.role ~* 'manager'
        )
      )
    )
    OR public.is_platform_admin()
$function$;

COMMENT ON FUNCTION public.is_business_manager(uuid) IS
  'True when the caller owns the business (or one above it) or is active staff there with a manager-ish role. Mirrors isManagerRole() in lib/permissions.js — change both together.';

-- ---------------------------------------------------------------------------
-- 2. facilities_cache — attribution for cache fills.
-- ---------------------------------------------------------------------------
ALTER TABLE public.facilities_cache
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();

COMMENT ON COLUMN public.facilities_cache.created_by IS
  'auth.uid() of whoever cached this facility. Stamped by default; the INSERT policy forbids claiming to be someone else.';

-- ---------------------------------------------------------------------------
-- 3. facilities_cache policies. The old blanket policy is dropped by its EXACT
--    live name (verified against pg_policies before writing this file — a
--    DROP POLICY IF EXISTS on a wrong name is a silent no-op).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "facilities_cache of own business" ON public.facilities_cache;

CREATE POLICY "facilities_cache read own business" ON public.facilities_cache
  FOR SELECT
  USING ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());

-- Any member may cache a DETECTED facility (that is the offline-tolerance
-- feature). Writing a 'rep_added' row here is the promotion a confirmation
-- performs, so it takes a manager.
CREATE POLICY "facilities_cache insert detected" ON public.facilities_cache
  FOR INSERT
  WITH CHECK (
    ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
    AND (source = 'detected' OR is_business_manager(business_id))
    AND (created_by IS NULL OR created_by = auth.uid())
  );

-- The cache fill is an upsert (on_conflict + merge-duplicates), so refreshing an
-- existing DETECTED row must stay open to members; a promoted row must not.
CREATE POLICY "facilities_cache update detected" ON public.facilities_cache
  FOR UPDATE
  USING (
    ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
    AND (source = 'detected' OR is_business_manager(business_id))
  )
  WITH CHECK (
    ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
    AND (source = 'detected' OR is_business_manager(business_id))
  );

CREATE POLICY "facilities_cache delete by manager" ON public.facilities_cache
  FOR DELETE
  USING (is_business_manager(business_id));

-- ---------------------------------------------------------------------------
-- 4. rep_added_facilities policies — the review queue proper.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "rep_added_facilities of own business" ON public.rep_added_facilities;

CREATE POLICY "rep_added_facilities read own business" ON public.rep_added_facilities
  FOR SELECT
  USING ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());

-- A rep may add a place, but only as PENDING: self-confirmation is the exact
-- thing the review step exists to prevent.
CREATE POLICY "rep_added_facilities insert pending" ON public.rep_added_facilities
  FOR INSERT
  WITH CHECK (
    ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
    AND status = 'pending_review'
  );

CREATE POLICY "rep_added_facilities review by manager" ON public.rep_added_facilities
  FOR UPDATE
  USING (is_business_manager(business_id))
  WITH CHECK (is_business_manager(business_id));

CREATE POLICY "rep_added_facilities dismiss by manager" ON public.rep_added_facilities
  FOR DELETE
  USING (is_business_manager(business_id));
