-- ============================================================================
-- 2026-08-15 — admin_users / admin_teams / admin_notifications RLS hardening
-- (closes the last known C19-shape hole: P0 #3 in planning/roadmap.md §6,
-- "admin_users/admin_teams RLS cleanup").
--
-- WHY THIS EXISTS
-- ---------------
-- Both tables have RLS *enabled* but are neutralized by permissive policies:
--   * admin_users "Allow admin login check"     SELECT  qual:true  — anyone
--     (including unauthenticated requests carrying the anon key) can read
--     every admin row: email, password_hash, role, team_id, is_active.
--   * admin_users "Allow admin users to update their own record"
--                                                 UPDATE  qual:true  — despite
--     the name, USING(true) lets ANY authenticated user update ANY admin row
--     (privilege escalation to super_admin / password reset).
--   * admin_teams "Allow reading teams"          SELECT  qual:true  — public
--     read of team metadata.
--   * admin_notifications "Allow reading notifications" SELECT qual:true and
--     "Allow updating notifications" UPDATE qual:true — same blanket shape on
--     the admin inbox (zero rows live, zero code references — searched both
--     apps' src and api — so dropping cannot break anything).
-- This is exactly the C19/C14 policy shape: a dashboard checkmark would
-- report "RLS enabled" while these policies leave the data exposed.
--
-- WHY DROPPING IS SAFE (verified before writing this file)
-- --------------------------------------------------------
-- The entire admin surface talks to these tables through the service-role
-- client (api/_handlers/admin-auth.js and admin-setup.js), which bypasses
-- RLS entirely. AdminLogin.jsx / AdminPanel.jsx were repointed at those
-- endpoints in Phase 0 (C9/H11 work); no src/ code, view, or SECURITY
-- INVOKER RPC references admin_users/admin_teams for a regular session.
-- So dropping the permissive policies cannot break login, list, create,
-- toggle or setup — they all run as service_role.
--
-- RESULT
-- ------
-- RLS stays enabled with ZERO policies on both tables: deny-all for anon
-- and authenticated, service-role-only access — the same posture
-- withdrawal_requests already has ("RLS enabled, no direct policies").
--
-- VERIFY AFTER APPLYING:
--   1. pg_policies returns no rows for admin_users/admin_teams.
--   2. relrowsecurity is still true on both tables.
--   3. Behavioural probes (each must FAIL with 42501 / return empty):
--      - anon SELECT admin_users (PostgREST, no Authorization header)
--      - authenticated UPDATE admin_users SET is_active=false
--      - anon SELECT admin_teams
--      - service-role SELECT admin_users (must still succeed — proves the
--        admin API keeps working)
-- ============================================================================

drop policy if exists "Allow admin login check" on public.admin_users;
drop policy if exists "Allow admin users to update their own record" on public.admin_users;
drop policy if exists "Only super admin can manage admin users" on public.admin_users;

drop policy if exists "Allow reading teams" on public.admin_teams;

drop policy if exists "Allow inserting notifications" on public.admin_notifications;
drop policy if exists "Allow reading notifications" on public.admin_notifications;
drop policy if exists "Allow updating notifications" on public.admin_notifications;