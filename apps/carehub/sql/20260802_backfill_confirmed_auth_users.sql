-- ============================================================================
-- Backfill confirmed Supabase Auth users for legacy CareHub accounts
--
-- Why: CareHub businesses/staff were created as plaintext-password rows in
-- `businesses`/`staff` (legacy auth). phase2_rls_pilot.sql makes every write
-- go through RLS, which only passes when the request carries a real Supabase
-- Auth session (auth.uid()/auth.email()). The app's provisionRealAuthAccount()
-- only calls signUp() — and this project requires email confirmation, so
-- signUp() never returns a session and signInWithPassword() refuses
-- unconfirmed accounts. Net effect: legacy accounts are locked out of every
-- write (patients, sales, products, staff...) → "Could not save patient".
--
-- Fix: one-time, idempotent backfill that (1) creates a CONFIRMED auth.users
-- row for every businesses/staff account that has a password, using that same
-- password (bcrypt), so their next login via signInWithPassword succeeds and
-- yields a real session; and (2) confirms any existing-but-unconfirmed auth
-- user whose email matches a legacy row (left behind by earlier signUp()
-- provisioning calls).
--
-- Run once via the Supabase SQL editor or psql, AFTER deploying the code in
-- Login.jsx/authClient.js (the new provisionRealAuthAccount retry). Safe to
-- re-run at any time (no-ops on existing/confirmed users).
-- ============================================================================

do $$
declare
  r record;
  uid uuid;
  profile_count int;
begin
  -- 1. Businesses (owner accounts)
  for r in select email, password from businesses where email is not null and lower(email) <> '' loop
    if r.password is null or r.password = '' then
      continue;
    end if;

    select id into uid from auth.users where lower(email) = lower(r.email);

    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, recovery_sent_at, raw_app_meta_data,
        raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
      ) values (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', r.email,
        crypt(r.password, gen_salt('bf')), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('email', r.email, 'email_verified', true),
        now(), now(), '', '', '', ''
      );
      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), uid, uid::text,
        jsonb_build_object('sub', uid::text, 'email', r.email, 'email_verified', true),
        'email', now(), now(), now()
      );
    else
      update auth.users
        set email_confirmed_at = coalesce(email_confirmed_at, now()),
            updated_at = now()
        where id = uid and email_confirmed_at is null;
    end if;
  end loop;

  -- 2. Staff accounts (same rules; auth.users.email is unique, so an email
  --    already handled above is simply skipped by the "uid is null" check)
  for r in select email, password from staff where email is not null and lower(email) <> '' loop
    if r.password is null or r.password = '' then
      continue;
    end if;

    select id into uid from auth.users where lower(email) = lower(r.email);

    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, recovery_sent_at, raw_app_meta_data,
        raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
      ) values (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', r.email,
        crypt(r.password, gen_salt('bf')), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('email', r.email, 'email_verified', true),
        now(), now(), '', '', '', ''
      );
      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), uid, uid::text,
        jsonb_build_object('sub', uid::text, 'email', r.email, 'email_verified', true),
        'email', now(), now(), now()
      );
    else
      update auth.users
        set email_confirmed_at = coalesce(email_confirmed_at, now()),
            updated_at = now()
        where id = uid and email_confirmed_at is null;
    end if;
  end loop;

  -- 3. Profiles for the newly-created users, so the story/live FK inserts
  --    (stories.user_id, live_items.sender_id → profiles.id) can't fail.
  --    Only for users that have no profile row yet.
  for r in select u.id, u.email
           from auth.users u
           where u.email_confirmed_at is not null
             and (lower(u.email) in (select lower(email) from businesses where email is not null)
               or lower(u.email) in (select lower(email) from staff where email is not null)) loop
    select count(*) into profile_count from public.profiles where id = r.id;
    if profile_count = 0 then
      insert into public.profiles (id, display_name, created_at)
      values (r.id, split_part(r.email, '@', 1), now());
    end if;
  end loop;
end $$;
