-- ============================================================================
-- PUBLIC FORM SUBMISSIONS BROKEN — anon INSERT policies missing on two tables
--
-- STATUS: SUPERSEDED 2026-08-08 — the diagnosis below is WRONG, and both forms
--         were still broken after it was written. Kept for the record; do not
--         rely on its ROOT CAUSE section. Re-running it is harmless.
--
-- ⚠ CORRECTION (2026-08-08, re-measured against the live project with the
--   public anon key). Both INSERT policies now exist and both PASS. The forms
--   were failing for a different reason entirely, one this file's own
--   verification steps could not have caught because step 2 below tells you to
--   probe WITHOUT `Prefer: return=representation`, which is precisely the
--   header that triggers the bug:
--
--     POST /rest/v1/businesses         'Prefer: return=minimal'         -> 201
--     POST /rest/v1/businesses         'Prefer: return=representation'  -> 42501
--     POST /rest/v1/agent_applications 'Prefer: return=minimal'         -> 201
--     POST /rest/v1/agent_applications 'Prefer: return=representation'  -> 42501
--
--   `return=representation` makes PostgREST emit INSERT ... RETURNING, and
--   PostgreSQL applies the **SELECT** policy to the new row whenever an INSERT
--   has a RETURNING clause. Neither table lets an anonymous caller read the row
--   it just wrote: `businesses`' only anon SELECT policy is CareFind's public
--   directory (status='active', while a new signup is status='pending'), and
--   `agent_applications` is a write-only intake queue with no anon SELECT
--   policy at all — as this file itself says at line 46. The INSERT succeeds,
--   the RETURNING check fails, the transaction rolls back, and the client sees
--   a 42501 that names the INSERT policy and sends you looking here.
--
--   Fixed in the client, not the database: registerBusiness() and
--   submitAgentApplication() now send `Prefer: return=minimal`. Both discard
--   the response anyway, and an anonymous caller must not be able to read back
--   a row holding a password. No policy change was needed. See C20 in
--   planning/CODE_AUDIT.md and the regression test at
--   apps/carehub/src/services/__tests__/anonymousInserts.test.js.
--
--   Lesson worth keeping: reproduce with the request the APP actually sends,
--   headers included. A hand-rolled curl that differs by one header proved the
--   opposite of the truth here and cost this bug three days.
--
-- SYMPTOM (reported 2026-08-05): the Referral Agent application form and the
-- business Registration form both fail with "Could not submit" / "Registration
-- failed".
--
-- ROOT CAUSE (proven against the live project, not assumed — the exact REST
-- calls the forms make, replayed with the public anon key):
--
--   POST /rest/v1/agent_applications  -> 42501
--     new row violates row-level security policy for table "agent_applications"
--   POST /rest/v1/businesses          -> 42501
--     new row violates row-level security policy for table "businesses"
--
-- Both tables are writable (service-role insert verified: 201), so the failure
-- is purely the missing INSERT policies. Two separate gaps:
--
-- 1. agent_applications — the referral program migration
--    (20260802_referral_agent_program.sql §6) defines "agent_applications anon
--    submit" FOR INSERT WITH CHECK (true), but the live table has no anon
--    INSERT policy at all. The table + columns exist (created with the rest of
--    that feature) but the RLS section never landed, so the public application
--    form — the front door of the referral program — cannot submit.
--
-- 2. businesses — phase2_rls_pilot.sql (applied 2026-07-18) scoped the whole
--    table to "lower(email) = lower(auth.email()) OR is_platform_admin()" and
--    explicitly warned at lines 125-130 that the public signup INSERT (before
--    any session exists, i.e. anon) needs its own INSERT policy, otherwise
--    "registration will break otherwise". That policy was never created, so
--    every new-business signup has been failing since RLS went live — the C18
--    fix note referenced a guard it assumed existed; it did not.
--
-- FIX — restore exactly the two INSERT policies the feature design calls for:
--
--   * businesses:    allow INSERT only of a *pending, non-platform-admin,
--                    non-branch* row (the same shape C18's note describes).
--                    No anon caller can self-approve (status must be
--                    'pending'), grant themselves platform admin, or attach
--                    themselves to another business's branch tree. The C18
--                    BEFORE UPDATE trigger stays the update-path guard.
--
--   * agent_applications: allow anon INSERT (public form) — WITH CHECK (true)
--                    because the table is a write-only intake queue: there is
--                    no anon SELECT policy, so applicants can submit but never
--                    read anyone's applications (including their own). Only
--                    platform admins manage rows (existing policies).
--
-- Roles: both policies are scoped TO anon, authenticated — the two roles the
-- app's sbFetch() actually issues (anon key when sessionless, JWT otherwise),
-- and deliberately NOT `public` so any future role does not inherit it.
--
-- Idempotent: DROP POLICY IF EXISTS first, matching the repo's migration
-- style, so re-running is safe.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. businesses — public registration INSERT (Register.jsx)
-- ---------------------------------------------------------------------------
drop policy if exists "businesses public signup" on public.businesses;
create policy "businesses public signup"
  on public.businesses
  for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and is_platform_admin = false
    and parent_business_id is null
  );

-- ---------------------------------------------------------------------------
-- 2. agent_applications — public referral-agent application INSERT
--    (ApplyAgent.jsx / submitAgentApplication) — mirrors
--    20260802_referral_agent_program.sql §6's design
-- ---------------------------------------------------------------------------
drop policy if exists "agent_applications anon submit" on public.agent_applications;
create policy "agent_applications anon submit"
  on public.agent_applications
  for insert
  to anon, authenticated
  with check (true);

-- ============================================================================
-- VERIFY AFTER APPLYING — re-read the catalog AND probe behaviourally:
--
--   1. Catalog — expect two rows, cmd = INSERT:
--        select tablename, policyname, cmd, roles, qual, with_check
--          from pg_policies
--         where schemaname = 'public'
--           and policyname in ('businesses public signup',
--                              'agent_applications anon submit');
--
--   2. The anon probes that proved the bug, re-run (expect 201, not 42501):
--        curl -X POST https://szdybxmgmhndoytqanfb.supabase.co/rest/v1/businesses \
--          -H 'apikey: <anon key>' -H 'Authorization: Bearer <anon key>' \
--          -H 'Content-Type: application/json' -H 'Prefer: return=representation' \
--          -d '{"name":"probe","owner":"probe","email":"probe-insert-test@example.com",
--               "password":"x","status":"pending","plan":"basic"}'
--      (then delete the probe row via the dashboard / service role)
--
--   3. The old C18 attack still fails on INSERT too: status='approved' in the
--      payload above must still 42501 — the WITH CHECK pins status='pending'.
-- ============================================================================
