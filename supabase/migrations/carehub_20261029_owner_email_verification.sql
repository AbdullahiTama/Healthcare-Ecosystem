-- Owner email verification (spec 2026-10-10). ADDITIVE ONLY: nothing here removes a capability, so it is safe to apply
-- while the previous frontend is still deployed. The old register_business() is revoked by the separate cutover
-- migration carehub_20261030_revoke_register_business.sql, applied after the new frontend is live.

-- 1. An owner account that has NOT proven the address. Built on mint_confirmed_auth_user so display-name collision
-- handling and the pgcrypto call stay in one place; the account is un-confirmed in the same transaction, so no
-- confirmed intermediate state is ever visible. The password is a random value that is never disclosed: the owner
-- sets their own through the emailed recovery link.
create or replace function public.mint_unconfirmed_auth_user(p_email text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(trim(p_email));
  v_uid uuid;
begin
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email is required.';
  end if;
  -- mint_confirmed_auth_user would silently CONFIRM an existing unconfirmed user; never let that happen here.
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'An account with this email already exists. Please sign in instead.';
  end if;

  v_uid := public.mint_confirmed_auth_user(v_email, gen_random_uuid()::text || gen_random_uuid()::text);

  update auth.users
     set email_confirmed_at = null,
         recovery_sent_at = null,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('email_verified', false),
         updated_at = now()
   where id = v_uid;
  update auth.identities
     set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email_verified', false)
   where user_id = v_uid;
  return v_uid;
end $function$;

revoke all on function public.mint_unconfirmed_auth_user(text) from public, anon, authenticated;
grant execute on function public.mint_unconfirmed_auth_user(text) to service_role;

-- 2. Registration without a password. Same validation and columns as register_business().
create or replace function public.register_business_unconfirmed(p_business jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(trim(p_business->>'email'));
  v_name text := nullif(trim(p_business->>'name'), '');
  v_owner text := nullif(trim(p_business->>'owner'), '');
  v_id uuid := gen_random_uuid();
  v_visible boolean;
  v_referral text;
begin
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email is required.';
  end if;
  if v_name is null then raise exception 'Business name is required.'; end if;
  if v_owner is null then raise exception 'Owner name is required.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('register_business:' || v_email, 0));

  v_visible := coalesce((p_business->>'visible_on_carefind')::boolean, true);
  v_referral := nullif(p_business->>'referral_code_used', '');

  perform public.mint_unconfirmed_auth_user(v_email);

  insert into public.businesses (
    id, name, owner, email, phone, whatsapp, address, state, city,
    business_type, hours, maps_link, lat, lng, website,
    status, visible_on_carefind, created_at, plan, referral_code_used
  ) values (
    v_id, v_name, v_owner, v_email,
    nullif(p_business->>'phone', ''), nullif(p_business->>'whatsapp', ''),
    nullif(p_business->>'address', ''), nullif(p_business->>'state', ''), nullif(p_business->>'city', ''),
    coalesce(nullif(p_business->>'business_type', ''), 'skincare'),
    nullif(p_business->>'hours', ''), nullif(p_business->>'maps_link', ''),
    nullif(p_business->>'lat', '')::double precision, nullif(p_business->>'lng', '')::double precision,
    nullif(p_business->>'website', ''),
    'pending', v_visible, now(), 'basic', v_referral
  );
  return v_id;
end $function$;

revoke all on function public.register_business_unconfirmed(jsonb) from public, anon, authenticated;
grant execute on function public.register_business_unconfirmed(jsonb) to service_role;

-- 3. A business cannot leave `pending` (other than to `rejected`) while its owner has not confirmed the address.
-- Enforced here because approval is a direct PATCH from the admin client; a UI filter would be bypassable.
-- A business whose owner has no auth user (legacy rows) is not blocked.
create or replace function public.guard_business_owner_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.status = 'pending' and new.status is distinct from old.status and new.status <> 'rejected' then
    if exists (select 1 from auth.users u
                where lower(u.email) = lower(new.email) and u.email_confirmed_at is null) then
      raise exception 'The owner has not verified their email address yet.';
    end if;
  end if;
  return new;
end $function$;

revoke all on function public.guard_business_owner_email_confirmed() from public, anon, authenticated;

drop trigger if exists businesses_require_verified_owner on public.businesses;
create trigger businesses_require_verified_owner
  before update of status on public.businesses
  for each row execute function public.guard_business_owner_email_confirmed();

-- 4. owner_setup needs a catalog row: email_outbox has a foreign key on (app, event_key). Sender, rollout and flags
-- are copied from staff_welcome, which is the same kind of message (a recovery link to set a password).
-- The payload schema keys are the keys sendAuthEmail ACTUALLY enqueues (fullName, businessName, setupLink), not the
-- snake_case keys on the staff_welcome row: spike S2 showed the outbox accepts the camelCase staff_welcome payload at
-- insert, and whether the dispatcher validates against payload_schema at send time is unproven, so the schema is
-- written to match what is really sent.
insert into public.email_event_catalog
  (app, event_key, template_key, subject_template, from_email, reply_to, payload_schema,
   enabled, required_for_business, category, rollout_mode)
select app, 'owner_setup', 'owner_setup', 'CareHub: verify your email and set your password', from_email, reply_to,
       jsonb_build_object(
         'type', 'object',
         'required', jsonb_build_array('fullName', 'businessName', 'setupLink'),
         'properties', jsonb_build_object(
           'fullName',     jsonb_build_object('type', 'string', 'maxLength', 120),
           'businessName', jsonb_build_object('type', 'string', 'maxLength', 160),
           'setupLink',    jsonb_build_object('type', 'string', 'format', 'uri', 'pattern', '^https://carefindhub\.com/', 'maxLength', 2048)),
         'additionalProperties', false),
       enabled, required_for_business, 'auth', rollout_mode
  from public.email_event_catalog
 where app = 'carehub' and event_key = 'staff_welcome'
on conflict (app, event_key) do nothing;

-- 5. Which businesses are waiting on their owner's verification, for the admin console. SECURITY DEFINER because
-- auth.users is not readable by the client; the caller must be a platform admin.
create or replace function public.admin_unverified_owner_business_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.businesses b
                  where lower(b.email) = lower((select u.email from auth.users u where u.id = auth.uid()))
                    and b.is_platform_admin) then
    raise exception 'not authorised';
  end if;
  return query
    select b.id from public.businesses b
     where b.status = 'pending'
       and exists (select 1 from auth.users u where lower(u.email) = lower(b.email) and u.email_confirmed_at is null);
end $function$;

revoke all on function public.admin_unverified_owner_business_ids() from public, anon;
grant execute on function public.admin_unverified_owner_business_ids() to authenticated, service_role;
