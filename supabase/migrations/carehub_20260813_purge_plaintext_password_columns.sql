-- ============================================================================
-- C2 — Plaintext login passwords removed from the schema entirely
--
-- STATUS: APPLIED 2026-08-13 (Supabase MCP). Verify behaviourally (see §9),
--         then ship the client changes in services/supabase.js /
--         Register.jsx / Staff.jsx / Login.jsx together with this file — the
--         old anon INSERT + legacy login branch break the moment the columns
--         drop, so client and DB must move as one.
--
-- NOTE (applied-state correction): §8 originally revoked via
-- "revoke all on function ... from public", which does NOT remove the direct
-- anon/authenticated EXECUTE grants that Supabase's default privileges make at
-- function-creation time. The live project therefore received a follow-up
-- migration (harden_c2_rpc_execute_grants) with the explicit per-role revokes
-- shown below. proacl was re-read and verified. Keep the explicit form below.
--
-- THE LEGACY: businesses.password / staff.password held login credentials in
-- plaintext (the pre-Supabase-auth design, documented in
-- architecture/Authentication.md). Every account has been on a real Supabase
-- Auth session since the 2026-08-02 backfill — but nothing ever removed the
-- columns. C20 closed the anon READ of them (column-level SELECT grants);
-- C2 closes the columns themselves, plus the code paths that only existed to
-- serve them.
--
-- WHY IT'S STILL OPEN: the backfill wrote bcrypt into auth.users but never
-- purged the columns. A re-run audit (2026-08-13) found 10 rows created AFTER
-- the 08-02 backfill that still have a plaintext password and NO confirmed
-- auth user: 8 businesses (4 real — hatma@gmail.com, ae@gmail.com are live
-- active businesses; 6 diagnostic/probe rows) and 2 staff (john@healthplus.com,
-- tina@gmail.com, both active). All 10 are re-backfilled here BEFORE the
-- columns drop, so no account is locked out by losing its only stored password.
--
-- ----------------------------------------------------------------------------
-- FIX — one migration, in dependency order:
--   1. mint_confirmed_auth_user() — shared helper (SECURITY DEFINER, owner-only
--      execute): creates a CONFIRMED auth user for an email+password, or
--      confirms an existing-but-unconfirmed one. Used by the backfill and by
--      both new RPCs, so the bcrypt/identity/profile logic lives in one place.
--   2. Re-backfill: mint a confirmed user for every businesses/staff row with
--      a password but no confirmed auth user (the 10 above). Runs FIRST because
--      it reads the plaintext — nothing after this point can.
--   3. register_business(p_business jsonb, p_password text) returns uuid —
--      the server-side replacement for Register.jsx's anon INSERT +
--      client-side provisionRealAuthAccount. SECURITY DEFINER, anon-executable.
--      Mints the CONFIRMED auth user and the pending businesses row in ONE
--      transaction, and FORCES status='pending' / is_platform_admin=false /
--      parent_business_id=null / plan='basic' regardless of what the payload
--      claims (the row no longer carries a password column at all). Rejects
--      emails that already have an auth user, so it cannot be used to
--      pre-empt a real owner's login.
--   4. provision_staff_auth(p_business_id, p_email, p_password) returns uuid —
--      the server-side replacement for Staff.jsx's provisionRealAuthAccount.
--      Authenticated-only; verifies the caller owns the business
--      (is_platform_admin() OR business in current_business_ids()), then mints
--      a confirmed user (or links + confirms an existing one, NEVER
--      overwriting an existing user's password) and stamps staff.auth_user_id.
--   5. Drop legacy_login_business() — its only reader was Login.jsx's legacy
--      branch, which this change deletes.
--   6. Revoke anon's INSERT on businesses + drop the two anon INSERT policies.
--      Registration is exclusively through register_business now, so a direct
--      anon INSERT is no longer a legitimate path — closing the hole the probe
--      rows used to get in.
--   7. Drop businesses.password and staff.password.
--
-- NOTE: this also closes the open critical item "newly-registered owners cannot
-- sign in". register_business mints a CONFIRMED auth user, so a brand-new owner
-- can sign in immediately; Login.jsx then resolves their pending row and shows
-- the honest "pending admin approval" message instead of "Incorrect email or
-- password."
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Shared helper: mint a CONFIRMED auth user (or confirm an existing one).
--    SECURITY DEFINER because it must write auth.users (caller roles cannot);
--    pinned search_path includes extensions for crypt()/gen_salt(). The display
--    name is freed first because the signup trigger handle_new_user() sets
--    profiles.display_name = local part and unique_display_name is still live
--    (same workaround the 2026-08-02 backfill used).
-- ----------------------------------------------------------------------------
create or replace function public.mint_confirmed_auth_user(p_email text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_uid uuid;
  v_base text;
  v_claim uuid;
  v_cand text;
  v_j int;
begin
  if v_email = '' then
    raise exception 'A valid email is required.';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;

  -- Existing user (possibly unconfirmed from an earlier signUp) — confirm it,
  -- never touch its password.
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is not null then
    update auth.users
       set email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = v_uid and email_confirmed_at is null;
    return v_uid;
  end if;

  v_base := split_part(v_email, '@', 1);
  if v_base is null or v_base = '' then
    raise exception 'Cannot derive a display name from email %', v_email;
  end if;

  select id into v_claim
    from public.profiles where display_name = v_base
    order by created_at limit 1;
  if v_claim is not null then
    for v_j in 2..1000 loop
      v_cand := v_base || '_' || v_j;
      perform 1 from public.profiles where display_name = v_cand;
      if not found then
        update public.profiles set display_name = v_cand where id = v_claim;
        exit;
      end if;
    end loop;
  end if;

  v_uid := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, recovery_sent_at, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('email', v_email, 'email_verified', true),
    now(), now(), '', '', '', ''
  );
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_uid, v_uid::text,
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );
  return v_uid;
end $$;


-- ----------------------------------------------------------------------------
-- 2. Re-backfill the 10 rows that still hold a password with no confirmed auth
--    user. Idempotent — rows already on a confirmed user are skipped by the
--    guard, and mint_confirmed_auth_user no-ops on existing users.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  v_uid uuid;
begin
  for r in
    select id, email, password
      from businesses
     where email is not null and lower(email) <> ''
       and password is not null and password <> ''
       and not exists (
         select 1 from auth.users u
          where lower(u.email) = lower(businesses.email)
            and u.email_confirmed_at is not null
       )
  loop
    begin
      v_uid := public.mint_confirmed_auth_user(r.email, r.password);
      raise notice 'Backfilled confirmed auth user for business %', r.email;
    exception when others then
      raise notice 'SKIP business %: %', r.email, SQLERRM;
    end;
  end loop;

  for r in
    select id, email, password
      from staff
     where email is not null and lower(email) <> ''
       and password is not null and password <> ''
       and not exists (
         select 1 from auth.users u
          where lower(u.email) = lower(staff.email)
            and u.email_confirmed_at is not null
       )
  loop
    begin
      v_uid := public.mint_confirmed_auth_user(r.email, r.password);
      update staff set auth_user_id = v_uid where id = r.id;
      raise notice 'Backfilled confirmed auth user for staff %', r.email;
    exception when others then
      raise notice 'SKIP staff %: %', r.email, SQLERRM;
    end;
  end loop;
end $$;


-- ----------------------------------------------------------------------------
-- 3. register_business(p_business, p_password) — the ONLY way to create a
--    business from now on. Anon-executable (registration is pre-session).
--    Whitelist-extracts safe fields; privileged columns are forced, never
--    taken from the payload. Rejects emails that already hold an auth user
--    (anti-pre-emption). The new owner gets a CONFIRMED user, so they can sign
--    in immediately and see the honest pending state.
-- ----------------------------------------------------------------------------
create or replace function public.register_business(p_business jsonb, p_password text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_email text := lower(trim(p_business->>'email'));
  v_name text := nullif(p_business->>'name', '');
  v_owner text := nullif(p_business->>'owner', '');
  v_uid uuid;
  v_id uuid := gen_random_uuid();
  v_visible boolean;
  v_referral text;
begin
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email is required.';
  end if;
  if v_name is null then raise exception 'Business name is required.'; end if;
  if v_owner is null then raise exception 'Owner name is required.'; end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'An account with this email already exists. Please sign in instead.';
  end if;

  v_visible := coalesce((p_business->>'visible_on_carefind')::boolean, true);
  v_referral := nullif(p_business->>'referral_code_used', '');

  v_uid := public.mint_confirmed_auth_user(v_email, p_password);

  insert into public.businesses (
    id, name, owner, email, phone, whatsapp, address, state, city,
    business_type, hours, maps_link, lat, lng, website,
    status, visible_on_carefind, created_at, plan, referral_code_used
  ) values (
    v_id,
    v_name,
    v_owner,
    v_email,
    nullif(p_business->>'phone', ''),
    nullif(p_business->>'whatsapp', ''),
    nullif(p_business->>'address', ''),
    nullif(p_business->>'state', ''),
    nullif(p_business->>'city', ''),
    coalesce(nullif(p_business->>'business_type', ''), 'skincare'),
    nullif(p_business->>'hours', ''),
    nullif(p_business->>'maps_link', ''),
    nullif(p_business->>'lat', '')::double precision,
    nullif(p_business->>'lng', '')::double precision,
    nullif(p_business->>'website', ''),
    'pending',
    v_visible,
    now(),
    'basic',
    v_referral
  );

  return v_id;
end $$;


-- ----------------------------------------------------------------------------
-- 4. provision_staff_auth(p_business_id, p_email, p_password) — Staff.jsx's
--    auth half. Authenticated-only; caller must own the business. Mints a
--    confirmed user for a NEW email, or links + confirms an EXISTING account
--    (never overwriting its password — that could be the person's own account
--    or a CareFind user). Stamps staff.auth_user_id.
-- ----------------------------------------------------------------------------
create or replace function public.provision_staff_auth(p_business_id uuid, p_email text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_staff uuid;
  v_uid uuid;
begin
  if not (public.is_platform_admin() or p_business_id in (select public.current_business_ids())) then
    raise exception 'You do not have permission to manage staff for this business.';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;

  select id into v_staff
    from public.staff
   where business_id = p_business_id
     and lower(email) = v_email
     and status = 'active'
   limit 1;
  if v_staff is null then
    raise exception 'No active staff member with that email was found in this business.';
  end if;

  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then
    v_uid := public.mint_confirmed_auth_user(v_email, p_password);
  else
    update auth.users
       set email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = v_uid and email_confirmed_at is null;
  end if;

  update public.staff set auth_user_id = v_uid where id = v_staff;
  return v_uid;
end $$;


-- ----------------------------------------------------------------------------
-- 5. Drop the legacy plaintext-login RPC. Its only caller (Login.jsx's legacy
--    branch) is deleted in the same pass; without the password columns it
--    could not work even if it were left behind.
-- ----------------------------------------------------------------------------
drop function if exists public.legacy_login_business(text, text);


-- ----------------------------------------------------------------------------
-- 6. Registration is exclusively through register_business now, so anon no
--    longer needs to INSERT into businesses at all. Drop the two anon INSERT
--    policies (the "own business row" ALL policy stays — authenticated owners
--    still create branches via Locations.jsx, and that path is fine) and revoke
--    the INSERT privilege.
-- ----------------------------------------------------------------------------
drop policy if exists "businesses public signup" on public.businesses;
drop policy if exists "public can self-register a new pending business" on public.businesses;
revoke insert on public.businesses from anon;


-- ----------------------------------------------------------------------------
-- 7. Purge the plaintext columns.
-- ----------------------------------------------------------------------------
alter table public.businesses drop column password;
alter table public.staff drop column password;


-- ----------------------------------------------------------------------------
-- 8. Execute privileges.
--
--    ⚠ Supabase's default privileges re-grant EXECUTE to anon/authenticated at
--    function-creation time, AFTER any revoke in the same statement batch (the
--    C5 / C20 lesson). These revokes therefore run last, and §7 re-reads
--    pg_proc.proacl rather than trusting it.
--
--    - mint_confirmed_auth_user : owner-only. Anon must never mint users for
--      arbitrary emails (that would be account pre-emption). The two SECURITY
--      DEFINER RPCs above run as the function owner and can call it regardless.
--      (live project also received harden_c2_rpc_execute_grants with the
--      explicit revokes below — "revoke ... from public" alone is insufficient)
--    - register_business         : anon + authenticated (registration is
--      anonymous by definition).
--    - provision_staff_auth      : authenticated only — it grants an auth
--      account, so it must never be callable without a logged-in owner.
-- ----------------------------------------------------------------------------
revoke all on function public.mint_confirmed_auth_user(text, text) from anon, authenticated;
revoke all on function public.register_business(jsonb, text) from public;
grant execute on function public.register_business(jsonb, text) to anon, authenticated;
revoke execute on function public.provision_staff_auth(uuid, text, text) from anon;
grant execute on function public.provision_staff_auth(uuid, text, text) to authenticated;


-- ============================================================================
-- 9. VERIFY AFTER APPLYING — behaviourally, not just from the catalog.
--
--   a) The columns are gone:
--        select column_name from information_schema.columns
--         where table_schema='public' and table_name in ('businesses','staff')
--           and column_name='password';   -- expect ZERO rows
--
--   b) The stragglers are now real auth users. On 2026-08-13 the backfill
--      created confirmed users for 8 of the 10 (both live businesses — hatma,
--      ae — and both live staff — john, tina — included). The other 2
--      (zz-diagnostic-probe@example.invalid, zz-diagnostic-probe2@example.invalid)
--      are pending-status diagnostic rows created during C20 verification that
--      held only an empty password, so the `password <> ''` guard correctly
--      skipped them — no credentials existed to lose, and no account was
--      locked out.
--
--   c) Registration goes through the RPC and mints a working session:
--        POST /rest/v1/rpc/register_business
--          {"p_business":{"name":"Verify Probe","owner":"Probe","email":"<new>@probe.test",
--                         "business_type":"pharmacy","visible_on_carefind":false},
--           "p_password":"Verify12345"}
--        -> returns the new id; then
--        POST /auth/v1/token?grant_type=password  with that email+password
--        -> 200 (confirmed user can sign in immediately). Clean up the probe
--           businesses row afterwards.
--      Wrong input is rejected, not silently coerced: missing name -> exception;
--      password length 5 -> exception; email of an existing account -> exception.
--
--   d) Anon can no longer INSERT into businesses:
--        POST /rest/v1/businesses {"name":"x"}  with the anon key -> 4xx (RLS).
--
--   e) provision_staff_auth enforces ownership: calling it as anon ->
--      PGRST301/401 (no EXECUTE); calling it as a logged-in NON-owner for
--      another business -> the "You do not have permission" exception; as the
--      owner of the staff's business -> the auth user id, and staff.auth_user_id
--      is stamped.
--
--   f) EXECUTE acl is what was asked for, NOT what the statements claimed:
--        select proname, proacl from pg_proc
--         where proname in ('mint_confirmed_auth_user','register_business','provision_staff_auth');
--      mint_confirmed_auth_user must have NO public/anon/authenticated entry;
--      register_business must have anon + authenticated; provision_staff_auth
--      must have authenticated only.
--
--   g) legacy_login_business is gone:
--        select count(*) from pg_proc where proname = 'legacy_login_business';
--
--   h) Advisors: take a get_advisors(security) baseline BEFORE applying and
--      re-run after. register_business/provision_staff_auth are SECURITY
--      DEFINER by necessity (auth.users writes) — confirm the change
--      introduces no NEW finding shape beyond the known-definer WARN.
--
--   i) CareFind's directory still works (it never read the password column):
--        GET /rest/v1/businesses?select=id,name,business_type,city,state&limit=5
--        -> 200. And CareFind's authenticated writes (ClaimBusiness,
--           BusinessDashboard visibility toggle) still pass — none of them
--           touch the dropped column.
--
-- 10. AFTER-CARE — the anon public SELECT on businesses (CareFind's directory)
--     remains column-level (C20). Adding a column to businesses that CareFind
--     must display still requires `grant select (new_col) on public.businesses
--     to anon`. Registration is now RPC-only; if you ever need an anon INSERT
--     again, it must go through a new SECURITY DEFINER RPC like register_business
--     rather than a raw policy.
-- ============================================================================
