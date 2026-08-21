-- ============================================================================
-- Fix: provision_staff_auth now updates the password when an auth user
-- already exists for the given email.
--
-- PROBLEM: When a staff member is created with an email that already has a
-- Supabase Auth user (from a previous attempt or a different account),
-- provision_staff_auth just confirms them and links the staff row — but never
-- updates the password. The staff member then tries to log in with the NEW
-- password, but the auth user still has the OLD password, resulting in
-- "Incorrect email or password."
--
-- FIX: When the caller is the business owner (or platform admin), update the
-- auth user's password to the new value. This is safe because:
--   1. Only the business owner (or platform admin) can call this RPC
--   2. The business owner is explicitly creating this staff account
--   3. The staff member expects to use the password they just set
--
-- SECURITY: The password update is only allowed when the caller owns the
-- business (the same permission check that gates the entire RPC).
-- ============================================================================

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
    -- New auth user: mint a confirmed account with the provided password.
    v_uid := public.mint_confirmed_auth_user(v_email, p_password);
  else
    -- Existing auth user: confirm if needed, AND update the password so the
    -- staff member can log in with the credentials the business owner just set.
    update auth.users
       set email_confirmed_at = coalesce(email_confirmed_at, now()),
           encrypted_password = crypt(p_password, gen_salt('bf')),
           updated_at = now()
     where id = v_uid;
  end if;

  update public.staff set auth_user_id = v_uid where id = v_staff;
  return v_uid;
end $$;
