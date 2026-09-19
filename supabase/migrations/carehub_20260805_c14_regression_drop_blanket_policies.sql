-- ============================================================================
-- C14 REGRESSION — blanket "Allow all" policies are still live on 16 CareHub
--                  tables, and Phase 2's RLS has therefore never been in force
--                  on them
--
-- STATUS: APPLIED TO PRODUCTION 2026-08-05, on explicit user authorization,
-- as a TRACKED migration (c14_regression_drop_blanket_policies).
--
-- VERIFIED AFTER APPLYING — three ways, because the whole point of this file is
-- that a statement completing proves nothing:
--
-- 1. The anon probe that proved the hole, re-run. Unauthenticated, public anon
--    key only:
--                    before      after
--        staff          12    ->    0
--        clients         5    ->    0
--        sales          54    ->    0
--        debts           9    ->    0
--        products     3645    ->    0
--        roles           1    ->    0
--
-- 2. Catalog: 0 blanket policies remain on all 16 tables, and every one still
--    has at least one scoped policy (products 3, staff_claims 2, rest 1).
--
-- 3. NOBODY LOCKED OUT — the risk that actually matters here, given this
--    engagement previously locked 7 accounts out with an RLS change. Every
--    non-platform-admin owner that has staff was impersonated in a rolled-back
--    block and saw exactly their own rows and zero foreign rows:
--        owner.hospital@carehub.test   staff 5/5  sales 0/0  foreign 0  OK
--        sirhatama125@gmail.com        staff 2/2  sales 0/0  foreign 0  OK
--        owner.pharmacy@carehub.test   staff 2/2  sales 6/6  foreign 0  OK
--        owner.wholesale@carehub.test  staff 1/1  sales 0/0  foreign 0  OK
--    current_business_ids() returned 1 for each (0 would mean locked out).
--    A business with genuinely 0 staff/clients/roles still shows 0 — checked
--    against the base tables so an empty result was not mistaken for a lockout.
--
-- Advisors after: identical to the 27-finding baseline taken earlier the same
-- day. Nothing new.
--
-- WHAT WAS WRONG
-- --------------
-- Postgres ORs PERMISSIVE policies together, so a single `qual: true` policy
-- defeats every correctly-scoped policy on the same table. That is C14, found
-- and supposedly fixed on 2026-07-18 by `phase2_rls_pilot.sql`.
--
-- It was not fixed. Found 2026-08-05 while checking RLS on `staff` before
-- writing the staff repository: 60 blanket `qual: true` policies across 55
-- tables, 25 of them `cmd = ALL` (read AND write) on CareHub tenant tables.
--
-- PROVEN, NOT ASSUMED — as an UNAUTHENTICATED caller holding nothing but the
-- public anon key (read-only probe, rolled back):
--     staff rows            12   across 5 businesses
--       with plaintext password set: 12   <- C2's legacy columns, still there
--     clients                5
--     sales                 54
--     debts                  9
--     products            3645
--     roles                  1
--
-- WHY THE ORIGINAL FIX SILENTLY DID NOTHING
-- -----------------------------------------
-- This is NOT schema drift and nothing re-added these policies — no migration
-- after phase2_rls_pilot_carehub (20260718022737) touches these tables. The
-- DROP statements simply named policies that do not exist:
--
--     phase2_rls_pilot.sql says          live policy is actually named
--     ---------------------------------  ----------------------------
--     DROP ... "Allow all staff"         "Allow all"
--     DROP ... "Allow all products"      "Allow all"
--     DROP ... "Allow all sales"         "Allow all"
--     DROP ... "Allow all clients"       "Allow all"
--     DROP ... "Allow all debts"         "Allow all"
--     DROP ... "Allow all purchases"     "Allow all"
--
-- `DROP POLICY IF EXISTS` on a name that does not exist is a silent no-op: no
-- error, no notice, nothing to notice. The file's own line 117 gets it right
-- for `businesses` ("Allow all", unsuffixed) — which is why that table is
-- genuinely clean today and looked like evidence the whole file had worked.
--
-- THE LESSON, and it is the same one as the REVOKE trap in
-- 20260805_atomic_stock_transfer.sql: a DDL statement completing is not
-- evidence it did anything. Re-read the catalog afterwards. `IF EXISTS` in
-- particular converts a typo into silence.
--
-- WHY THIS MIGRATION DROPS BY PREDICATE, NOT BY NAME
-- --------------------------------------------------
-- Naming each policy is exactly what failed last time. This iterates
-- pg_policies and drops whatever PERMISSIVE policy has `qual = 'true'` on the
-- explicitly listed tables, whatever it happens to be called. The table list
-- is hardcoded so nothing outside it can be touched; the policy names are not.
--
-- SCOPE — deliberately 16 tables, not all 55
-- ------------------------------------------
-- These 16 each still carry a correctly-scoped policy underneath (verified
-- before running: "staff of own business", "sales of own business", and so
-- on). Dropping the blanket policy therefore RESTORES intended behaviour with
-- nothing new to write — a pure regression fix.
--
-- Deliberately NOT touched here, each needing its own decision:
--   * 9 tables with a blanket ALL policy and NO scoped policy at all
--     (admin_team, follow_ups, patient_requests, requisition_items,
--     rep_colleagues, rep_company_entries, rep_customer_entries,
--     rep_customers, rep_peer_entries). Dropping alone would deny everything;
--     they need policies written first.
--   * ~32 SELECT-only `qual: true` policies, mostly CareFind's public feed
--     (posts, profiles, reviews, live_*, playlists). Public readability is the
--     product there; dropping them would break the social app.
--   * `admin_users` / `admin_teams` / `admin_notifications` UPDATE+SELECT
--     policies — already flagged as needing their own careful pass.
-- ============================================================================

DO $$
DECLARE
  -- Only these tables. Each was verified to have a scoped policy remaining.
  v_tables text[] := ARRAY[
    'staff', 'roles', 'clients', 'sales', 'debts', 'purchases', 'products',
    'out_of_stock', 'field_activities', 'requisitions', 'staff_claims',
    'activity_fields', 'activity_viewers', 'activity_reactions',
    'activity_comments', 'activity_default_viewers'
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
    RAISE NOTICE 'dropped blanket policy % on %', r.policyname, r.tablename;
    v_dropped := v_dropped + 1;
  END LOOP;

  -- Refuse to leave a table with no policy at all: that would deny the app
  -- rather than scope it, which is a worse outcome than the hole being fixed.
  IF EXISTS (
    SELECT 1 FROM unnest(v_tables) t(name)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t.name
     )
  ) THEN
    RAISE EXCEPTION 'A listed table would be left with zero policies - aborting';
  END IF;

  RAISE NOTICE 'C14 regression: dropped % blanket policies', v_dropped;
END $$;

-- ============================================================================
-- VERIFY AFTER APPLYING — re-read the catalog, do not trust the statements:
--
--   1. Zero blanket policies left on the 16:
--        SELECT tablename, policyname FROM pg_policies
--         WHERE schemaname='public' AND qual='true'
--           AND tablename IN ('staff','roles','clients','sales','debts',
--                'purchases','products','out_of_stock','field_activities',
--                'requisitions','staff_claims','activity_fields',
--                'activity_viewers','activity_reactions','activity_comments',
--                'activity_default_viewers');
--      Expect 0 rows.
--
--   2. Each still has its scoped policy (none left policy-less):
--        SELECT tablename, count(*) FROM pg_policies
--         WHERE schemaname='public' AND tablename IN (...) GROUP BY 1;
--      Expect >= 1 each.
--
--   3. The anon probe that proved the hole now returns zero rows for every
--      table above. That is the actual proof; 1 and 2 are only the mechanism.
-- ============================================================================
