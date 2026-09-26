-- ============================================================================
-- 2026-09-26 — stop exposing contact PII and view-tracking to the anon role
-- ============================================================================
--
-- WHY THIS EXISTS
-- ---------------
-- Measured against the live project (szdybxmgmhndoytqanfb) on 2026-09-26 by
-- probing all 225 tables with the publishable anon key. Two exposures were
-- confirmed with real data:
--
--   1. profiles.phone — 10 real phone numbers readable by anyone holding the
--      anon key, which ships in the browser bundle. Root cause: profiles carries
--      the policy "Anyone can read profiles" (see carefind_rls_hardening.sql,
--      which deliberately kept it). RLS is row-level, so a public row policy
--      makes EVERY column public — including columns nobody intended to publish.
--      Nothing in the UI needs it: the public screens that show a phone number
--      render business.phone / biz.phone from a different table, and neither
--      PublicProfile.jsx nor Profile.jsx reads profiles.phone.
--
--   2. post_view_events — 43,587 rows readable by anyone, exposing who viewed
--      which post and when. Its policy was "post_view_events publicly readable"
--      USING (true).
--
-- WHAT THIS CHANGES
-- -----------------
-- Part 1 hides four columns from `anon` on profiles: phone (PII), is_admin (a
-- privilege flag, so the admin set is not enumerable), paystack_subaccount_code
-- (a payment settlement identifier) and latitude/longitude (precise personal
-- location). All four are read only by the service role or by an authenticated
-- self-read, so no product behaviour changes:
--
--   * Feed.jsx:158 and Stories.jsx gate "can post" on the signed-in user's own
--     profiles.phone, via useFeedProfile(user?.id) — that is `authenticated`,
--     and table-level SELECT for `authenticated` is untouched.
--   * AdminShop.jsx:700 reads profiles.phone on the admin screen — service role.
--   * feedConfigRepository.js:22 and DistributionExperiments.jsx:36 read
--     is_admin for the signed-in user's own row only — `authenticated`.
--   * create-subaccount.js, charge-subscription.js and charge-consultation.js
--     read paystack_subaccount_code through SUPABASE_SERVICE_ROLE_KEY.
--
-- Part 2 makes post_view_events readable only by the viewer who owns the row.
-- viewer_id is derived server-side by the SECURITY DEFINER record_post_view()
-- and is NULL for anonymous views. View counts are unaffected: they are
-- maintained by trg_post_view_events_maintain_count writing posts.view_count on
-- INSERT, and triggers are not subject to this SELECT policy. No application
-- code reads post_view_events directly.
--
-- WHY A REVOKE/RE-GRANT AND NOT A COLUMN REVOKE
-- ---------------------------------------------
-- Postgres has no column-level RLS. REVOKE SELECT (phone) is a no-op while the
-- role still holds a table-level SELECT grant, because the table grant covers
-- every column. The only way to hide one column from a role is to drop the
-- table grant and re-grant the exact public column set. That list is therefore
-- the security boundary: a column added to profiles later is invisible to anon
-- until it is added here, which is the fail-closed direction we want.
--
-- CAVEAT — re-run this check after any schema grant sweep
-- -------------------------------------------------------
-- Supabase grants broad table privileges to anon by default. If anyone re-runs
-- `grant all on all tables in schema public to anon` (or resets default
-- privileges), phone becomes public again and only the verification below will
-- notice. Verify with query 2.
--
-- ORDER OF OPERATIONS — READ BEFORE APPLYING
-- -----------------------------------------
-- Part 1 makes `anon` unable to select profiles.phone. The public profile query
-- in apps/carefind/src/hooks/queries.js (useProfile) must stop selecting phone
-- BEFORE this migration is applied, or every anonymous profile view fails with a
-- permission error. That app change ships in the same commit; deploy it first,
-- confirm the profile page loads, then apply this file.
--
-- VERIFICATION (run after applying)
-- ---------------------------------
--  1. Public profile still loads:
--     select display_name, full_name, specialty from profiles
--       where id = '<a real profile uuid>';            -- expect rows
--  2. Contact PII is no longer public (expect 0 rows / permission denied):
--     select phone from profiles where phone is not null;         -- as anon
--     select paystack_subaccount_code from profiles
--       where paystack_subaccount_code is not null;              -- as anon
--  3. Signed-in user can still read their own phone (expect 1 row):
--     set local role authenticated;  -- then run the authed session equivalent
--  4. View tracking is private:
--     select count(*) from post_view_events;                      -- as anon, 0 rows
--  5. Post view counts still increment:
--     select view_count from posts order by view_count desc limit 5;
--  6. Confirm the policies that now exist:
--     select policyname, cmd, qual from pg_policies
--       where tablename in ('profiles','post_view_events');
-- ============================================================================

-- ── Part 1: narrow what anon may read on profiles ───────────────────────────

-- Drop the blanket table grant first; without this, every column stays public.
revoke select on public.profiles from anon;

-- The public directory set. Deliberately absent: phone, is_admin,
-- paystack_subaccount_code, latitude, longitude.
grant select (
  id,
  full_name,
  display_name,
  is_verified,
  verification_label,
  location,
  website,
  avatar_url,
  cover_url,
  subscription_price,
  bio,
  show_followers,
  specialty,
  country,
  created_at
)
  on public.profiles
  to anon;

-- `authenticated` keeps its table-level grant: the signed-in user must still be
-- able to read their own phone, is_admin and coordinates. Stated explicitly so
-- a future sweep cannot silently narrow it, since that would break the
-- completeness gate and the admin surfaces.

-- ── Part 2: post_view_events readable only by its viewer ────────────────────

alter table public.post_view_events enable row level security;

drop policy if exists "post_view_events publicly readable" on public.post_view_events;

-- Own rows only. Anonymous views are stored with viewer_id NULL and so are
-- visible to nobody but the service role, which is what keeps the table from
-- becoming a public log of who watched what.
create policy "post_view_events readable by viewer"
  on public.post_view_events
  for select
  to authenticated
  using ((select auth.uid()) = viewer_id);
