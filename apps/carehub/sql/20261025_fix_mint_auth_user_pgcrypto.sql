-- Business registration and new-staff provisioning failed with "function gen_salt(unknown) does not exist" (PostgREST: 404 on
-- rpc/register_business). Both call mint_confirmed_auth_user, which hashes the first password with pgcrypto's crypt()/gen_salt().
-- On Supabase pgcrypto lives in the `extensions` schema, and production's function had search_path = public only (the repository's
-- copy said public, extensions, pg_temp; production had been narrowed outside the migrations), so neither function resolved.
--
-- Fix: call them schema-qualified (extensions.crypt / extensions.gen_salt), so the function works whatever its search_path is, and
-- keep the narrow search_path. The body is production's as read on 2026-10-07; only the two calls change. Callers, grants and
-- behaviour are unchanged (still SECURITY DEFINER, still not executable by anon/authenticated directly).

create or replace function public.mint_confirmed_auth_user(p_email text, p_password text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(), now(),   -- changed: schema-qualified pgcrypto
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
end $function$;

revoke all on function public.mint_confirmed_auth_user(text, text) from public, anon, authenticated;
