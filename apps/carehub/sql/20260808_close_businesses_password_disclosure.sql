-- ============================================================================
-- C20 — CRITICAL: every business owner's login password is readable by anyone
--
-- STATUS: NOT YET APPLIED. Requires the Supabase MCP connector (or SQL editor)
--         pointed at the LIVE project szdybxmgmhndoytqanfb. Must be applied
--         TOGETHER with the client change described in §4 — either half alone
--         breaks CareHub's login screen.
--
-- FOUND 2026-08-08 while diagnosing the broken registration form. Not hunted
-- for; the registration probe needed an anon read of `businesses` and the
-- response carried the password column.
--
-- PROVEN, as an unauthenticated caller holding only the public anon key that
-- ships inside the client JS bundle:
--
--   GET /rest/v1/businesses?select=email,password&limit=3   -> 200
--   [{"email":"<owner 1>","password":"<plaintext>"},
--    {"email":"<owner 2>","password":"<plaintext>"},
--    {"email":"<owner 3>","password":"<plaintext>"}]
--
--   GET /rest/v1/businesses?select=id  -> Content-Range: 0-0/17
--
-- All 17 active businesses, email + plaintext password. Those are live CareHub
-- login credentials, and `businesses` rows include the platform-admin account.
--
-- WHY IT EXISTS — this is the C18 lesson a second time. `businesses` carries a
-- SELECT policy for anon (CareFind's public provider directory, scoped to
-- status='active'), and **RLS is row-level, not column-level**: a policy that
-- correctly decides *which rows* are public says nothing about *which columns*,
-- so the directory hands out the whole row including C2's legacy plaintext
-- `password`. C19 closed `staff`, `patients`, `sales`, `clients`, `debts` and
-- `prescriptions` to anon (re-verified 2026-08-08: all return 0 rows).
-- `businesses` was never closed because its public read is intentional.
--
-- Related but NOT the same as the tracked High item "plaintext passwords remain
-- in businesses.password / staff.password (C2)". C2 is that the column still
-- holds plaintext; C20 is that anon can read it. This file closes C20 only.
-- Purging the columns (C2) remains the real fix and is still open.
--
-- ----------------------------------------------------------------------------
-- FIX — column-level SELECT privileges for `anon`, plus an RPC for the one
-- caller that legitimately needs the password column.
--
-- Column privileges are chosen over a `public_businesses` view because CareFind
-- already selects explicit column lists everywhere (BusinessProfile, Search,
-- Feed, Profile, ClaimBusiness, ClaimStaffPosition, AdminPanel — verified, none
-- selects `*`, none selects `password`), so this change needs ZERO CareFind
-- edits, whereas a view would need all six rewritten.
--
-- Note C18 rejected column grants for the UPDATE path, because fail-closed on a
-- new column silently breaks writes. That reasoning does not carry over here:
-- on a PUBLIC READ surface, a new column defaulting to not-public is the
-- behaviour you want. The cost is real but is the right way round — adding a
-- column to `businesses` that CareFind must show now requires granting it
-- explicitly. §5 documents that.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Re-grant anon's SELECT as an explicit column list: everything except the
--    sensitive columns.
--
--    Built dynamically from information_schema rather than typed out, so the
--    file cannot drift from the live column set and cannot silently omit a
--    column CareFind depends on. The DENY list is what is maintained by hand,
--    which is the list that actually matters and is short enough to review.
--
--    - password           : the disclosure itself.
--    - is_platform_admin  : tells an attacker exactly which of the 17 rows is
--                           the platform-admin account, i.e. which credential
--                           to go after. No public surface reads it.
-- ----------------------------------------------------------------------------
do $$
declare
  v_cols text;
  v_denied constant text[] := array['password', 'is_platform_admin'];
  v_missing text;
begin
  -- Guard: if a denied column has been renamed away, fail loudly rather than
  -- granting it back under a new name. (Trap: a no-op that looks like success.)
  select string_agg(d, ', ')
    into v_missing
    from unnest(v_denied) as d
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'businesses'
        and column_name = d
   );
  if v_missing is not null then
    raise exception 'Expected column(s) not found on public.businesses: %. '
      'Review the deny list before re-running.', v_missing;
  end if;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'businesses'
     and column_name <> all (v_denied);

  execute 'revoke select on public.businesses from anon';
  execute 'grant select (' || v_cols || ') on public.businesses to anon';

  raise notice 'anon SELECT on public.businesses re-granted over % columns',
    array_length(string_to_array(v_cols, ', '), 1);
end $$;


-- ----------------------------------------------------------------------------
-- 2. The one caller that legitimately needs the password column: CareHub's
--    legacy plaintext login (services/supabase.js loginBusiness), which runs
--    anonymously — there is no session yet — and today does
--
--      GET /businesses?email=eq.X&password=eq.Y&select=*
--
--    PostgREST needs SELECT on a column to *filter* on it too, so §1 breaks
--    that call outright. Replaced with a SECURITY DEFINER RPC that compares the
--    password server-side and never returns it.
--
--    This is strictly narrower than what anon can do today: it requires knowing
--    the exact password, cannot enumerate, and returns no credential material.
--
--    SECURITY DEFINER is required (it must read a column anon cannot) and is
--    safe here because the function takes no privileged decision from its
--    arguments beyond an equality check it performs itself. search_path is
--    pinned, per the standard in phase2_rls_pilot.sql.
--
--    Retires with C2: once the plaintext columns are purged and every account
--    is on a real Supabase Auth session, drop this function and the client's
--    legacy branch with it.
-- ----------------------------------------------------------------------------
create or replace function public.legacy_login_business(p_email text, p_password text)
returns table (
  id uuid,
  name text,
  email text,
  status text,
  plan text,
  business_type text,
  is_platform_admin boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.email, b.status, b.plan, b.business_type,
         coalesce(b.is_platform_admin, false)
    from public.businesses b
   where lower(b.email) = lower(p_email)
     and b.password is not null
     and b.password <> ''
     and b.password = p_password
   limit 1;
$$;

comment on function public.legacy_login_business(text, text) is
  'C20: lets the pre-migration plaintext login path verify credentials without '
  'anon holding SELECT on businesses.password. Returns no credential material '
  'and requires the exact password, so it cannot be used to enumerate. '
  'Delete together with the legacy login branch when C2 purges the column.';


-- ----------------------------------------------------------------------------
-- 3. Execute privileges.
--
--    ⚠ Supabase's default privileges re-grant EXECUTE to anon/authenticated at
--    function-creation time, AFTER any revoke in the same statement batch. This
--    project has been bitten by it twice (C5, and again on the 2026-08-05 stock
--    RPCs). The revoke below is therefore written to run last, and §6 re-reads
--    pg_proc.proacl rather than trusting it.
--
--    anon NEEDS execute here — the login screen is unauthenticated by
--    definition. authenticated keeps it for the staff-login fallback path.
-- ----------------------------------------------------------------------------
revoke all on function public.legacy_login_business(text, text) from public;
grant execute on function public.legacy_login_business(text, text) to anon, authenticated;


-- ============================================================================
-- 4. CLIENT CHANGE THAT MUST SHIP WITH THIS FILE
--    (apps/carehub/src/services/supabase.js — deliberately NOT committed ahead
--    of this migration, since calling a function that does not exist yet would
--    break login for everyone.)
--
--    loginBusiness(email, password)
--      was:  sbFetch('businesses?email=eq.X&password=eq.Y&select=*')
--      now:  POST /rest/v1/rpc/legacy_login_business  {p_email, p_password}
--            -> returns [] or a single safe-column row
--
--    getBusinessById(id) / getBusinessByEmail(email)
--      `select=*` must become an explicit column list. Both are reachable
--      anonymously (Login.jsx:67 calls getBusinessById before any session
--      exists, on the staff-login branch), and `select=*` asks for every
--      column including the two now revoked -> 42501.
--
--    Callers of loginBusiness read: id, name, status, plan, business_type,
--    is_platform_admin — all returned above. Verified against Login.jsx and
--    AuthProvider's login().
--
--    NOTE: loginStaff/getStaffByEmail need no equivalent change — C19 already
--    closed `staff` to anon entirely, so the legacy staff login path is
--    already non-functional (re-verified 2026-08-08: anon sees 0 staff rows).
--    That is the gap last commit's Staff.jsx auth-account provisioning covers.
-- ============================================================================


-- ============================================================================
-- 5. VERIFY AFTER APPLYING — behaviourally, not just from the catalog.
--    A DDL statement completing is not evidence it did anything.
--
--   a) The disclosure is closed (expect 42501, permission denied for column):
--        curl -s 'https://szdybxmgmhndoytqanfb.supabase.co/rest/v1/businesses?select=email,password&limit=1' \
--          -H 'apikey: <anon>' -H 'Authorization: Bearer <anon>'
--      and `select=*` must fail the same way:
--        .../businesses?select=*&limit=1
--
--   b) CareFind's directory still works (expect 200 + 17 rows):
--        .../businesses?select=id,name,business_type,city,state,cover_url,whatsapp
--      and BusinessProfile's fuller list:
--        .../businesses?select=id,name,address,city,state,business_type,whatsapp,phone,website,hours,maps_link,cover_url,logo_url,description,booking_enabled,booking_type,booking_slots,status,visible_on_carefind
--
--   c) The RPC works and leaks nothing (expect one row, no password field):
--        POST .../rest/v1/rpc/legacy_login_business
--          {"p_email":"<a real owner>","p_password":"<their password>"}
--      and a wrong password returns [] , not an error.
--
--   d) EXECUTE acl is what was asked for, NOT what the statement claimed:
--        select proname, proacl from pg_proc
--         where proname = 'legacy_login_business';
--      expect anon and authenticated present; if Supabase's default privileges
--      added more, follow up with an explicit revoke.
--
--   e) Column privileges landed:
--        select column_name, privilege_type
--          from information_schema.column_privileges
--         where table_name = 'businesses' and grantee = 'anon'
--           and column_name in ('password','is_platform_admin');
--      expect ZERO rows.
--
--   f) Advisors: take a get_advisors(security) baseline BEFORE applying and
--      re-run after — the new SECURITY DEFINER function is exactly the shape
--      that produced C17, so confirm it introduces no new finding.
--
--   g) Registration still works end to end (it does not read businesses back,
--      but it is the flow that surfaced all of this):
--        POST .../businesses  with 'Prefer: return=minimal'  -> 201
--
-- 6. AFTER-CARE — adding a column to `businesses` that CareFind must display
--    now requires `grant select (new_col) on public.businesses to anon`.
--    This is deliberate (fail-closed on a public read surface). Re-running this
--    whole file is the simplest way to re-sync, and it is idempotent.
-- ============================================================================
