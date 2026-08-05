-- ============================================================================
-- C19 follow-up — the 9 tables that had a blanket "Allow all" policy and NO
--                 scoped policy to fall back on
--
-- STATUS: APPLIED TO PRODUCTION 2026-08-05, on explicit user authorization,
-- as a TRACKED migration (policies_for_unprotected_tables).
--
-- VERIFIED AFTER APPLYING
-- -----------------------
-- 1. Catalog: all 9 have exactly one policy, the scoped one; zero with
--    qual='true'.
-- 2. Anon probe (unauthenticated, public key only) — every one of the 9 now
--    returns 0 rows. Previously patient_requests returned 1, requisition_items
--    5 and rep_customers 1.
-- 3. Legitimate access preserved, impersonated in a rolled-back block:
--      owner of the patient_request        sees 1   (expected 1)
--      owner of the rep_customer           sees 1   (expected 1)  <- non-admin
--      owner of the requisition            sees 5 requisition_items
--      an unrelated business               sees 0 / 0
--      platform admin                      admin_team readable, no error
-- 4. The via-parent policy was proven on the NON-ADMIN branch specifically,
--    because the only business owning a real requisition is itself a platform
--    admin — so result 3 above could have come from is_platform_admin() rather
--    than the parent lookup. A separate rolled-back block created a requisition
--    plus 2 items for a confirmed non-admin business (john71688,
--    is_platform_admin = f) and read them back as that user:
--      own requisition items visible   2   (proves the via-parent branch)
--      other business items visible    0   (proves it does not over-reach)
--    Residue checked after: 1 requisition, 5 items, no SELFTEST rows.
-- 5. Advisors: identical to the 27-finding baseline.
--
-- FOUND WHILE VERIFYING, NOT AN RLS ISSUE — see CODE_AUDIT:
-- `Demand.jsx`'s requisition save cannot ever have worked. `addRequisition()`
-- posts `items`, `total` and `notes`; the live table has none of them (its text
-- column is `note`, singular). Confirmed by running the app's exact payload:
--   42703 column "items" of relation "requisitions" does not exist
-- Left alone here — it needs a product decision about where a requisition's
-- lines belong, and `requisition_items` existing suggests an answer.
--
-- C19 dropped the blanket `qual: true` policies from 16 tables that already had
-- a correct policy underneath. These 9 were deliberately left out of that pass:
-- dropping alone would have left them with zero policies, which denies the app
-- rather than scoping it. They need policies written, which is what this does.
--
-- Until now every row in all 9 was readable AND writable by anyone holding the
-- public anon key, without logging in.
--
-- WHAT IS ACTUALLY IN THEM (measured 2026-08-05, before changing anything)
-- -----------------------------------------------------------------------
--   admin_team             0 rows    the ONLY one the app still uses
--   follow_ups             0
--   patient_requests       1
--   requisition_items      5
--   rep_colleagues         0
--   rep_company_entries    0
--   rep_customer_entries   0
--   rep_customers          1
--   rep_peer_entries       0
--
-- EIGHT OF THE NINE HAVE NO APPLICATION CODE AT ALL. Searched both apps' src
-- and api trees: only `admin_team` is referenced (AdminDashboard's team roster,
-- via getAdminTeam/addAdminTeam/removeAdminTeam). Notably:
--   * `patient_requests` is NOT the customer-request feature — Demand.jsx uses
--     a different table, `customer_requests`. This one is a parallel leftover.
--   * `requisition_items` is unused because Demand.jsx stores a requisition's
--     lines as a JSON string in `requisitions.items` instead. The table was
--     created by 20260801_customer_and_requisition_modules.sql and the app went
--     another way.
-- So the blast radius of scoping these is close to zero: policies cannot break
-- code that does not exist. That is also why this is worth doing now rather
-- than deferring — nothing has to be coordinated with it.
--
-- THREE DIFFERENT SHAPES, because these tables are not alike
-- ---------------------------------------------------------
-- 1. SEVEN have their own business_id -> the standard tenant policy, identical
--    in wording to the ones C14/C19 restored elsewhere, so the codebase has one
--    recognisable shape rather than a new dialect.
--
-- 2. `requisition_items` has NO business_id — and no foreign key on
--    requisition_id either, though every row's parent does resolve (checked: 5
--    of 5, 0 orphans). Tenancy is derived through the parent requisition, the
--    same pattern the live schema already uses for `rep_territories` and the
--    `activity_*` tables.
--
-- 3. `admin_team` is NOT tenant data. It is the platform's own staff roster
--    (name, email, role, status) with no business_id and no tenant concept —
--    restricting it to platform admins is the correct boundary, not a
--    business-scoped one. AdminDashboard reaches it while logged in as a
--    platform admin, so is_platform_admin() is true there and the page keeps
--    working.
--
-- Policies are CREATEd before the blanket ones are dropped, so no table passes
-- through a state with zero policies.
--
-- Existing rows were checked not to disappear: the 1 patient_request and the 1
-- rep_customer both reference a live business, and no row in any of the 9 has a
-- NULL business_id. (`follow_ups.business_id` is nullable and such a row would
-- be invisible to everyone — there are none today, and the column should
-- probably be NOT NULL; noted in CODE_AUDIT rather than changed here.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The seven tables that carry their own business_id
-- ---------------------------------------------------------------------------
CREATE POLICY "follow_ups of own business" ON public.follow_ups
  FOR ALL
  USING      ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
  WITH CHECK ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());

CREATE POLICY "patient_requests of own business" ON public.patient_requests
  FOR ALL
  USING      ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
  WITH CHECK ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());

CREATE POLICY "rep_colleagues of own business" ON public.rep_colleagues
  FOR ALL
  USING      ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
  WITH CHECK ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());

CREATE POLICY "rep_company_entries of own business" ON public.rep_company_entries
  FOR ALL
  USING      ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
  WITH CHECK ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());

CREATE POLICY "rep_customer_entries of own business" ON public.rep_customer_entries
  FOR ALL
  USING      ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
  WITH CHECK ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());

CREATE POLICY "rep_customers of own business" ON public.rep_customers
  FOR ALL
  USING      ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
  WITH CHECK ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());

CREATE POLICY "rep_peer_entries of own business" ON public.rep_peer_entries
  FOR ALL
  USING      ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
  WITH CHECK ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2. Derived through the parent requisition (no business_id of its own)
-- ---------------------------------------------------------------------------
CREATE POLICY "requisition_items via parent requisitions" ON public.requisition_items
  FOR ALL
  USING (
    is_platform_admin() OR requisition_id IN (
      SELECT id FROM public.requisitions
       WHERE business_id IN (SELECT current_business_ids())
    )
  )
  WITH CHECK (
    is_platform_admin() OR requisition_id IN (
      SELECT id FROM public.requisitions
       WHERE business_id IN (SELECT current_business_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Platform tooling, not tenant data
-- ---------------------------------------------------------------------------
CREATE POLICY "admin_team platform admins only" ON public.admin_team
  FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- ---------------------------------------------------------------------------
-- 4. Only now drop the blanket policies — by predicate, not by name (C19's
--    lesson: DROP POLICY IF EXISTS on a wrong name is a silent no-op)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'admin_team', 'follow_ups', 'patient_requests', 'requisition_items',
    'rep_colleagues', 'rep_company_entries', 'rep_customer_entries',
    'rep_customers', 'rep_peer_entries'
  ];
  r record;
  v_dropped int := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = ANY(v_tables)
       AND permissive = 'PERMISSIVE'
       AND qual = 'true'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    v_dropped := v_dropped + 1;
  END LOOP;

  -- Same guard as the C19 migration: never leave a listed table with nothing.
  IF EXISTS (
    SELECT 1 FROM unnest(v_tables) t(name)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename = t.name
     )
  ) THEN
    RAISE EXCEPTION 'A listed table would be left with zero policies - aborting';
  END IF;

  RAISE NOTICE 'dropped % blanket policies across % tables', v_dropped, array_length(v_tables,1);
END $$;

-- ============================================================================
-- VERIFY AFTER APPLYING — re-read the catalog and probe behaviourally:
--   1. SELECT tablename, policyname, qual FROM pg_policies
--       WHERE schemaname='public' AND tablename IN (the 9);
--      Expect exactly one scoped policy each, zero with qual='true'.
--   2. anon probe: every one of the 9 returns 0 rows.
--   3. the owner of the business that owns the patient_request / rep_customer
--      still sees their row; another business does not.
-- ============================================================================
