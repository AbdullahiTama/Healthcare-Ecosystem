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
-- Run history:
--   • Run #1 failed with 23505 on `unique_display_name`: the signup trigger
--     handle_new_user() derives profiles.display_name from the email local
--     part, and `profiles` has a UNIQUE constraint on display_name that a
--     previous account already claimed ('hatama125').
--   • Run #2 tried to disable that trigger for the transaction and failed
--     with 42501 "must be owner of table users" — the SQL editor role is not
--     a superuser and `auth.users` is owned by supabase_auth_admin, so no
--     ALTER on the auth schema is permitted.
--   • This version needs no auth-schema privileges at all: the trigger stays
--     enabled and the script frees up the display name it wants BEFORE each
--     insert — if another profile already holds the plain local-part name,
--     that profile is moved to a free `base_N` suffix first, so the trigger's
--     own insert succeeds exactly as it does for ordinary signups. All writes
--     to `public.profiles` are allowed (public tables are owned by this role).
--
-- Alternative permanent fix (product decision, not done here): the root cause
-- is unique_display_name itself — drop it (`alter table public.profiles drop
-- constraint unique_display_name`) and the trigger can never collide again.
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
  base text;
  cand text;
  cand2 text;
  i int;
  j int;
  claim_id uuid;
begin
  -- 1. Businesses (owner accounts)
  for r in select email, password from businesses where email is not null and lower(email) <> '' loop
    if r.password is null or r.password = '' then
      continue;
    end if;

    select id into uid from auth.users where lower(email) = lower(r.email);

    if uid is null then
      base := split_part(r.email, '@', 1);
      if base is null or base = '' then
        -- no usable display name for the trigger — skip; the account keeps
        -- its legacy login rather than risking a hard failure
        raise notice 'Skipping business email % (no usable display name)', r.email;
        continue;
      end if;

      -- Free the plain name for this user's trigger-created profile: if
      -- another profile already holds `base`, move it to a free `base_N`.
      select id into claim_id
        from public.profiles where display_name = base
        order by created_at limit 1;
      if claim_id is not null then
        for j in 2..1000 loop
          cand2 := base || '_' || j;
          perform 1 from public.profiles where display_name = cand2;
          if not found then
            update public.profiles set display_name = cand2 where id = claim_id;
            exit;
          end if;
        end loop;
      end if;

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
      -- NB: the auth.users INSERT trigger handle_new_user() now creates the
      -- profile row itself (display_name = `base`, which we just freed).
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
      base := split_part(r.email, '@', 1);
      if base is null or base = '' then
        raise notice 'Skipping staff email % (no usable display name)', r.email;
        continue;
      end if;

      select id into claim_id
        from public.profiles where display_name = base
        order by created_at limit 1;
      if claim_id is not null then
        for j in 2..1000 loop
          cand2 := base || '_' || j;
          perform 1 from public.profiles where display_name = cand2;
          if not found then
            update public.profiles set display_name = cand2 where id = claim_id;
            exit;
          end if;
        end loop;
      end if;

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

  -- 3. Safety net: profiles for any confirmed legacy user that still has
  --    none (e.g. provisioned users whose trigger ran before this fix), with
  --    collision-free display names — stories.user_id / live_items.sender_id
  --    FK → profiles.id, so these rows are required.
  for r in select u.id, u.email
           from auth.users u
           where u.email_confirmed_at is not null
             and (lower(u.email) in (select lower(email) from businesses where email is not null)
               or lower(u.email) in (select lower(email) from staff where email is not null)) loop
    select count(*) into profile_count from public.profiles where id = r.id;
    if profile_count = 0 then
      base := split_part(r.email, '@', 1);
      if base is null or base = '' then
        base := 'user_' || left(r.id::text, 8);
      end if;
      for i in 1..1000 loop
        cand := case when i = 1 then base else base || '_' || i end;
        begin
          insert into public.profiles (id, display_name, created_at)
          values (r.id, cand, now());
          exit;
        exception when unique_violation then
          null; -- display_name taken — try the next suffix
        end;
      end loop;
    end if;
  end loop;
end $$;
