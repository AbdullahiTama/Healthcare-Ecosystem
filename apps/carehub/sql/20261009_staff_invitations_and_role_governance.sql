-- ============================================================================
-- C21 — Staff onboarding by invitation + server-enforced role governance
--
-- STATUS: NOT YET APPLIED — run via Supabase SQL editor / MCP, THEN deploy the
--         client (Staff.jsx, AcceptInvite.jsx, api/staff-invitations.js) in the
--         same window. The old client calls provision_staff_auth and a direct
--         staff INSERT, both of which this migration removes; between applying
--         and deploying, "Add staff" fails cleanly (the old client rolls its
--         row back) — nothing is corrupted.
--
-- REQUIRED ENV (Vercel, server-side only):
--   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (already used by api/*)
--   RESEND_API_KEY                           (invitation email)
--   CAREHUB_APP_URL  optional, e.g. https://carehub.ng — the invite link base.
--                    Falls back to the request host.
--
-- ----------------------------------------------------------------------------
-- THE INCIDENT (reported 2026-10-09)
-- ----------------------------------------------------------------------------
-- An owner added a staff member; "when the new staff added his password it
-- changed the password of the business owner".
--
-- Root cause: Supabase Auth has exactly ONE account per email address.
-- provision_staff_auth (C2) minted an account for a NEW email, but for an
-- email that ALREADY had an account it silently LINKED the staff row to that
-- existing account. Nothing stopped the staff email from being the owner's
-- own email (or any address that already had a CareHub/CareFind login). The
-- welcome email then mailed a password that was never applied to that
-- account, so the only way in was "Forgot password" — which resets the ONE
-- shared account, i.e. the owner's. Login also resolves business-before-staff,
-- so that "staff member" signed in as the Owner.
--
-- Secondary defects found on the same path:
--   * The owner chose and saw the staff member's password, and it was mailed
--     in plaintext (lib/email.js emailStaffWelcome).
--   * "Owner" was offered as an assignable staff role → a staff member could
--     be given full Owner authority, indistinguishable from the account holder.
--   * staff/roles RLS is `business_id IN current_business_ids()`, and
--     current_business_ids() includes every ACTIVE STAFF member's business.
--     So any staff member (a Cashier) could, straight through PostgREST:
--       - INSERT a staff row / PATCH their own role to anything,
--       - create a custom role named like a preset ("Cashier") with every flag
--         on — custom names override presets in getPerms,
--       - call provision_staff_auth (same check) to link auth accounts.
--     The UI's `isOwner` check was the only thing in the way.
--
-- ----------------------------------------------------------------------------
-- THE MODEL (standard organisation membership practice)
-- ----------------------------------------------------------------------------
--   * The OWNER is the business account itself (businesses.email). It is not a
--     staff role, cannot be assigned, demoted or removed from the Staff page.
--   * Staff are added by INVITATION. A single-use, 256-bit token is generated
--     server-side, stored ONLY as a sha256 hash, expires in 7 days, and is
--     emailed to the invitee. Nobody but the invitee ever knows their password.
--   * Accepting: a NEW email sets its own password (account minted here). An
--     email that ALREADY has a confirmed account must sign in with its own
--     password to accept — an invitation NEVER overwrites an existing password.
--   * One email = one identity: an invitation is refused for any email that is
--     a business owner's login, already a member of this business, or active
--     staff at another business (login resolves one business per identity).
--   * Who may manage staff: the Owner, platform admins, and active staff whose
--     role grants canManageStaff ("staff admins").
--   * Least privilege for staff admins: they cannot grant canManageStaff
--     (assign or author such a role), cannot modify a peer who holds it, and
--     nobody can change their OWN role or status (no self-escalation, no
--     self-lockout). These rules are enforced by triggers below, so they hold
--     for any client, not just the Staff page.
--
-- ORDER:
--   1. staff columns + status constraint + uniqueness
--   2. authorization helpers (email-parameterised, so the service-role RPCs
--      can evaluate them for a verified actor)
--   3. guard triggers on staff and roles (direct PostgREST writes)
--   4. invitation RPCs (create / reissue — service_role only; inspect /
--      accept — anon + authenticated)
--   5. retire provision_staff_auth
--   6. data hygiene: legacy staff rows holding the "Owner" role
--   7. execute grants (LAST — Supabase default privileges re-grant on create)
--   8. verification
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. staff columns
-- ----------------------------------------------------------------------------
alter table public.staff
  add column if not exists invited_at timestamptz,
  add column if not exists invited_by_email text,
  add column if not exists invite_token_hash text,
  add column if not exists invite_expires_at timestamptz,
  add column if not exists accepted_at timestamptz;

create unique index if not exists staff_invite_token_hash_key
  on public.staff (invite_token_hash) where invite_token_hash is not null;

-- status: 'invited' joins the existing 'active' / 'inactive'. Any older check
-- constraint mentioning status is replaced. NOT VALID so a legacy row with an
-- unexpected status cannot block the migration — new writes are still checked.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.staff'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.staff drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.staff
  add constraint staff_status_check check (status in ('active', 'inactive', 'invited')) not valid;

-- One membership per email per business. Created only when the live data has
-- no duplicates; otherwise reported (resolve them by hand, then re-run this
-- block) rather than failing the whole migration.
do $$
begin
  if exists (
    select 1 from public.staff
     group by business_id, lower(email) having count(*) > 1
  ) then
    raise notice 'SKIPPED staff_business_email_key: duplicate (business_id, email) rows exist — see verification query (b).';
  else
    create unique index if not exists staff_business_email_key
      on public.staff (business_id, lower(email));
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 2. Authorization helpers
--
--    All take the actor's email explicitly. The browser-facing wrappers pass
--    auth.email(); the service-role invitation RPCs pass the email that
--    api/staff-invitations.js verified from the caller's JWT. SECURITY DEFINER
--    so they can read businesses/staff/roles regardless of the caller's RLS.
-- ----------------------------------------------------------------------------

-- Platform admin, by email (is_platform_admin() only knows auth.email()).
create or replace function public.is_platform_admin_email(p_email text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select bool_or(is_platform_admin) from public.businesses
      where lower(email) = lower(trim(p_email))),
    false)
$$;

-- Owner of the business: its login email, or the owner of any ancestor
-- (branches normally copy the parent's email, but this does not depend on it).
create or replace function public.is_business_owner_email(p_email text, p_business_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  with recursive chain as (
    select b.id, b.parent_business_id, b.email, 0 as depth
      from public.businesses b where b.id = p_business_id
    union all
    select p.id, p.parent_business_id, p.email, c.depth + 1
      from public.businesses p join chain c on p.id = c.parent_business_id
     where c.depth < 10
  )
  select coalesce(p_email, '') <> ''
     and exists (select 1 from chain where lower(email) = lower(trim(p_email)))
$$;

-- Does a role name, in this business, grant canManageStaff? Mirrors getPerms
-- in src/lib/permissions.js: a custom role (exact name) overrides presets, and
-- no preset other than Owner grants it. 'Owner' itself is never a staff role.
create or replace function public.role_grants_staff_management(p_business_id uuid, p_role text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select (r.permissions ->> 'canManageStaff') = 'true'
       from public.roles r
      where r.business_id = p_business_id and r.name = p_role
      limit 1),
    false)
$$;

-- Owner-level authority: platform admin or business owner.
create or replace function public.is_staff_owner_level(p_email text, p_business_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_platform_admin_email(p_email)
      or public.is_business_owner_email(p_email, p_business_id)
$$;

-- May this actor manage staff of this business at all?
create or replace function public.can_manage_staff_as(p_email text, p_business_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_staff_owner_level(p_email, p_business_id)
      or exists (
        select 1 from public.staff s
         where s.business_id = p_business_id
           and lower(s.email) = lower(trim(p_email))
           and s.status = 'active'
           and public.role_grants_staff_management(s.business_id, s.role)
      )
$$;

-- Browser-facing convenience: the signed-in user.
create or replace function public.can_manage_staff(p_business_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.can_manage_staff_as(auth.email(), p_business_id)
$$;

-- Why an email cannot join this business, or NULL when it can. Shared by the
-- invite and accept paths so the rule is defined once.
create or replace function public.staff_email_conflict(p_business_id uuid, p_email text, p_ignore_staff_id uuid default null)
returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if exists (select 1 from public.businesses where lower(email) = v_email) then
    return 'This email is a business owner''s CareHub login. Each staff member needs their own email address.';
  end if;
  if exists (
    select 1 from public.staff
     where business_id = p_business_id and lower(email) = v_email
       and (p_ignore_staff_id is null or id <> p_ignore_staff_id)
  ) then
    return 'This person is already a member of (or invited to) this business.';
  end if;
  if exists (
    select 1 from public.staff
     where business_id <> p_business_id and lower(email) = v_email and status = 'active'
  ) then
    return 'This email already belongs to an active staff member at another business. Ask them to use a different email address.';
  end if;
  return null;
end $$;


-- ----------------------------------------------------------------------------
-- 3a. Guard trigger on staff
--
--    SECURITY INVOKER on purpose: `current_user` is then the PostgREST role
--    ('authenticated' / 'anon') for a direct client write, and the function
--    owner for writes made inside the SECURITY DEFINER RPCs below (and for
--    service_role / migrations). Only direct client writes are policed here —
--    the RPCs carry their own, stricter checks.
-- ----------------------------------------------------------------------------
create or replace function public.guard_staff_writes()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor text := lower(coalesce(auth.email(), ''));
  v_biz uuid := coalesce(new.business_id, old.business_id);
  v_owner_level boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Staff members are added by invitation. Use "Invite staff" on the Staff page.'
      using errcode = '42501';
  end if;

  if not public.can_manage_staff_as(v_actor, v_biz) then
    raise exception 'You do not have permission to manage staff for this business.'
      using errcode = '42501';
  end if;
  v_owner_level := public.is_staff_owner_level(v_actor, v_biz);

  -- Nobody edits or removes their own membership.
  if lower(old.email) = v_actor then
    raise exception 'You cannot change or remove your own staff membership. Ask the business owner.'
      using errcode = '42501';
  end if;

  -- Staff admins cannot touch a peer who also holds staff management.
  if not v_owner_level and public.role_grants_staff_management(old.business_id, old.role) then
    raise exception 'Only the business owner can change a staff member who manages staff.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- Identity and invitation bookkeeping are never client-writable.
  if new.business_id is distinct from old.business_id
     or lower(new.email) is distinct from lower(old.email)
     or new.auth_user_id is distinct from old.auth_user_id
     or new.invited_at is distinct from old.invited_at
     or new.invited_by_email is distinct from old.invited_by_email
     or new.invite_token_hash is distinct from old.invite_token_hash
     or new.invite_expires_at is distinct from old.invite_expires_at
     or new.accepted_at is distinct from old.accepted_at then
    raise exception 'A staff member''s business, email and login cannot be edited. Remove them and send a new invitation instead.'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'invited' or new.status not in ('active', 'inactive') then
      raise exception 'An invitation becomes active only when the invitee accepts it.'
        using errcode = '42501';
    end if;
  end if;

  if new.role is distinct from old.role then
    if lower(trim(coalesce(new.role, ''))) in ('', 'owner') then
      raise exception '"Owner" is the business account itself and cannot be assigned to staff.'
        using errcode = '42501';
    end if;
    if not v_owner_level and public.role_grants_staff_management(new.business_id, new.role) then
      raise exception 'Only the business owner can assign a role that manages staff.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists guard_staff_writes on public.staff;
create trigger guard_staff_writes
  before insert or update or delete on public.staff
  for each row execute function public.guard_staff_writes();


-- ----------------------------------------------------------------------------
-- 3b. Guard trigger on roles (custom roles define what staff may do)
-- ----------------------------------------------------------------------------
create or replace function public.guard_role_writes()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor text := lower(coalesce(auth.email(), ''));
  v_biz uuid := coalesce(new.business_id, old.business_id);
  v_owner_level boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if not public.can_manage_staff_as(v_actor, v_biz) then
    raise exception 'You do not have permission to manage roles for this business.'
      using errcode = '42501';
  end if;
  v_owner_level := public.is_staff_owner_level(v_actor, v_biz);

  if tg_op in ('UPDATE', 'DELETE') then
    if tg_op = 'UPDATE' and new.business_id is distinct from old.business_id then
      raise exception 'A role cannot be moved to another business.' using errcode = '42501';
    end if;
    if not v_owner_level and (old.permissions ->> 'canManageStaff') = 'true' then
      raise exception 'Only the business owner can change a role that manages staff.'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if lower(trim(coalesce(new.name, ''))) in ('', 'owner') then
    raise exception '"Owner" is reserved for the business account — pick a different role name.'
      using errcode = '42501';
  end if;
  if not v_owner_level and (new.permissions ->> 'canManageStaff') = 'true' then
    raise exception 'Only the business owner can grant "Manage staff".'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists guard_role_writes on public.roles;
create trigger guard_role_writes
  before insert or update or delete on public.roles
  for each row execute function public.guard_role_writes();


-- ----------------------------------------------------------------------------
-- 4a. create_staff_invitation — service_role only.
--
--    Called by api/staff-invitations.js AFTER it has verified the caller's JWT
--    (supabase.auth.getUser) and passes that verified email as p_actor_email.
--    The raw token is generated and emailed by the API; only its sha256 hex
--    digest arrives here. It is never returned to any browser.
-- ----------------------------------------------------------------------------
create or replace function public.create_staff_invitation(
  p_actor_email text,
  p_business_id uuid,
  p_full_name text,
  p_email text,
  p_role text,
  p_phone text,
  p_show_on_carefind boolean,
  p_public_title text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_max_staff integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text := lower(trim(coalesce(p_actor_email, '')));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := nullif(trim(coalesce(p_full_name, '')), '');
  v_role text := nullif(trim(coalesce(p_role, '')), '');
  v_conflict text;
  v_id uuid;
  v_biz_name text;
begin
  if not public.can_manage_staff_as(v_actor, p_business_id) then
    raise exception 'You do not have permission to manage staff for this business.' using errcode = '42501';
  end if;
  if v_name is null then raise exception 'Full name is required.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'A valid email address is required.'; end if;
  if v_role is null then raise exception 'Choose a role.'; end if;
  if lower(v_role) = 'owner' then
    raise exception '"Owner" is the business account itself and cannot be assigned to staff.' using errcode = '42501';
  end if;
  if not public.is_staff_owner_level(v_actor, p_business_id)
     and public.role_grants_staff_management(p_business_id, v_role) then
    raise exception 'Only the business owner can assign a role that manages staff.' using errcode = '42501';
  end if;
  if v_email = v_actor then
    raise exception 'You cannot invite yourself.';
  end if;
  if coalesce(length(p_token_hash), 0) <> 64 or p_expires_at is null or p_expires_at <= now() then
    raise exception 'Invalid invitation token.';
  end if;

  v_conflict := public.staff_email_conflict(p_business_id, v_email);
  if v_conflict is not null then raise exception '%', v_conflict; end if;

  -- Plan seat limit (NULL = unlimited). Pending invitations hold a seat, so a
  -- burst of invites cannot overshoot the plan; deactivated members do not.
  -- The number comes from src/lib/planLimits.js via the API — the single
  -- source of truth for plans — and is checked here, after authorization,
  -- serialised per business so two concurrent invites cannot both pass.
  if p_max_staff is not null then
    perform pg_advisory_xact_lock(hashtext('staff-seats:' || p_business_id::text));
    if (select count(*) from public.staff
         where business_id = p_business_id and status in ('active', 'invited')) >= p_max_staff then
      raise exception 'Your plan allows up to % active or invited staff members. Upgrade your plan in Settings, or deactivate someone first.', p_max_staff;
    end if;
  end if;

  insert into public.staff (
    business_id, full_name, email, role, phone, status,
    show_on_carefind, public_title,
    invited_at, invited_by_email, invite_token_hash, invite_expires_at
  ) values (
    p_business_id, v_name, v_email, v_role, coalesce(p_phone, ''), 'invited',
    coalesce(p_show_on_carefind, false), coalesce(nullif(trim(coalesce(p_public_title, '')), ''), v_role),
    now(), v_actor, p_token_hash, p_expires_at
  )
  returning id into v_id;

  select name into v_biz_name from public.businesses where id = p_business_id;
  return jsonb_build_object(
    'staff_id', v_id, 'email', v_email, 'full_name', v_name,
    'role', v_role, 'business_name', v_biz_name, 'expires_at', p_expires_at
  );
end $$;


-- ----------------------------------------------------------------------------
-- 4b. reissue_staff_invitation — service_role only. Rotates the token (the old
--     link stops working) and extends the expiry for a still-pending invite.
-- ----------------------------------------------------------------------------
create or replace function public.reissue_staff_invitation(
  p_actor_email text,
  p_staff_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text := lower(trim(coalesce(p_actor_email, '')));
  v_row public.staff%rowtype;
  v_biz_name text;
begin
  select * into v_row from public.staff where id = p_staff_id for update;
  if v_row.id is null or not public.can_manage_staff_as(v_actor, v_row.business_id) then
    raise exception 'Invitation not found.' using errcode = '42501';
  end if;
  if v_row.status <> 'invited' then
    raise exception 'This person has already accepted their invitation.';
  end if;
  if not public.is_staff_owner_level(v_actor, v_row.business_id)
     and public.role_grants_staff_management(v_row.business_id, v_row.role) then
    raise exception 'Only the business owner can resend an invitation for a role that manages staff.' using errcode = '42501';
  end if;
  if coalesce(length(p_token_hash), 0) <> 64 or p_expires_at is null or p_expires_at <= now() then
    raise exception 'Invalid invitation token.';
  end if;

  update public.staff
     set invite_token_hash = p_token_hash,
         invite_expires_at = p_expires_at,
         invited_at = now(),
         invited_by_email = v_actor
   where id = v_row.id;

  select name into v_biz_name from public.businesses where id = v_row.business_id;
  return jsonb_build_object(
    'staff_id', v_row.id, 'email', lower(v_row.email), 'full_name', v_row.full_name,
    'role', v_row.role, 'business_name', v_biz_name, 'expires_at', p_expires_at
  );
end $$;


-- ----------------------------------------------------------------------------
-- 4c. get_staff_invitation — anon + authenticated. What the accept page needs
--     to render. Takes the RAW token (hashed here), so a leaked hash column is
--     useless on its own. Never reveals anything for an unknown token.
-- ----------------------------------------------------------------------------
create or replace function public.get_staff_invitation(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.staff%rowtype;
  v_biz_name text;
  v_account boolean;
begin
  if p_token is null or length(p_token) < 32 then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into v_row from public.staff
   where invite_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and status = 'invited';
  if v_row.id is null then
    return jsonb_build_object('state', 'invalid');
  end if;

  select name into v_biz_name from public.businesses where id = v_row.business_id;
  if v_row.invite_expires_at <= now() then
    return jsonb_build_object('state', 'expired', 'business_name', v_biz_name);
  end if;

  select exists (
    select 1 from auth.users where lower(email) = lower(v_row.email) and email_confirmed_at is not null
  ) into v_account;

  return jsonb_build_object(
    'state', 'valid',
    'business_name', v_biz_name,
    'full_name', v_row.full_name,
    'email', lower(v_row.email),
    'role', v_row.role,
    'expires_at', v_row.invite_expires_at,
    'account_exists', v_account
  );
end $$;


-- ----------------------------------------------------------------------------
-- 4d. accept_staff_invitation — anon + authenticated.
--
--    * No account for the email → p_password (8+ chars) creates a CONFIRMED
--      account. Holding the emailed token proves control of the inbox.
--    * An UNCONFIRMED account exists (e.g. an abandoned CareFind sign-up that
--      was never verified, so nobody can sign in with it) → the same inbox
--      proof sets its password and confirms it.
--    * A CONFIRMED account exists → the caller must be signed in AS that
--      account. Its password is NEVER changed by an invitation. This is the
--      rule whose absence caused the incident above.
-- ----------------------------------------------------------------------------
create or replace function public.accept_staff_invitation(p_token text, p_password text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.staff%rowtype;
  v_email text;
  v_conflict text;
  v_uid uuid;
  v_confirmed timestamptz;
  v_created boolean := false;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'This invitation link is invalid.';
  end if;
  select * into v_row from public.staff
   where invite_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and status = 'invited'
   for update;
  if v_row.id is null then
    raise exception 'This invitation link is invalid or has already been used.';
  end if;
  if v_row.invite_expires_at <= now() then
    raise exception 'This invitation has expired. Ask your administrator to send a new one.';
  end if;

  v_email := lower(v_row.email);
  -- Conditions may have changed since the invite was sent.
  v_conflict := public.staff_email_conflict(v_row.business_id, v_email, v_row.id);
  if v_conflict is not null then raise exception '%', v_conflict; end if;

  select id, email_confirmed_at into v_uid, v_confirmed
    from auth.users where lower(email) = v_email;

  if v_uid is not null and v_confirmed is not null then
    if lower(coalesce(auth.email(), '')) <> v_email then
      raise exception 'An account already exists for %. Sign in with your existing password to accept this invitation.', v_email
        using errcode = '42501';
    end if;
  else
    if p_password is null or length(p_password) < 8 then
      raise exception 'Choose a password of at least 8 characters.';
    end if;
    if v_uid is null then
      v_uid := public.mint_confirmed_auth_user(v_email, p_password);
    else
      update auth.users
         set encrypted_password = crypt(p_password, gen_salt('bf')),
             email_confirmed_at = now(),
             updated_at = now()
       where id = v_uid;
    end if;
    v_created := true;
  end if;

  update public.staff
     set status = 'active',
         auth_user_id = v_uid,
         accepted_at = now(),
         invite_token_hash = null,
         invite_expires_at = null
   where id = v_row.id;

  return jsonb_build_object('email', v_email, 'account_created', v_created);
end $$;


-- ----------------------------------------------------------------------------
-- 5. Retire provision_staff_auth. Its "link to any existing account" behaviour
--    is the root cause above, and its ownership check admitted any active
--    staff member. Its only caller (Staff.jsx) is replaced in the same change.
-- ----------------------------------------------------------------------------
drop function if exists public.provision_staff_auth(uuid, text, text);


-- ----------------------------------------------------------------------------
-- 6. Data hygiene: "Owner" was an assignable staff role until now. Such a row
--    held full Owner authority while not being the account holder. Move them
--    to Manager (operational access, no staff management). Logged per row so
--    the owner can re-grant anything specific through a custom role.
-- ----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select id, business_id, email from public.staff where lower(trim(role)) = 'owner' loop
    raise notice 'Staff % (business %) had role Owner -> Manager', r.email, r.business_id;
  end loop;
  -- This runs as the migration owner, so guard_staff_writes lets it through.
  update public.staff set role = 'Manager' where lower(trim(role)) = 'owner';
end $$;


-- ----------------------------------------------------------------------------
-- 7. Execute grants — LAST, and per role (see C2's note: "revoke ... from
--    public" does not remove Supabase's direct anon/authenticated grants).
-- ----------------------------------------------------------------------------
revoke all on function public.create_staff_invitation(text, uuid, text, text, text, text, boolean, text, text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.reissue_staff_invitation(text, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_staff_invitation(text, uuid, text, text, text, text, boolean, text, text, timestamptz, integer) to service_role;
grant execute on function public.reissue_staff_invitation(text, uuid, text, timestamptz) to service_role;

revoke all on function public.get_staff_invitation(text) from public;
revoke all on function public.accept_staff_invitation(text, text) from public;
grant execute on function public.get_staff_invitation(text) to anon, authenticated;
grant execute on function public.accept_staff_invitation(text, text) to anon, authenticated;

-- Email-parameterised helpers answer questions about ANY email, so they are
-- not callable from the browser. The triggers run as the client role, so
-- `authenticated` needs them — but an authenticated caller learns nothing it
-- couldn't already infer, and can_manage_staff() (auth.email()) is the only
-- one the client is expected to call.
revoke all on function public.is_platform_admin_email(text) from public, anon;
revoke all on function public.is_business_owner_email(text, uuid) from public, anon;
revoke all on function public.is_staff_owner_level(text, uuid) from public, anon;
revoke all on function public.can_manage_staff_as(text, uuid) from public, anon;
revoke all on function public.role_grants_staff_management(uuid, text) from public, anon;
revoke all on function public.staff_email_conflict(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.is_platform_admin_email(text) to authenticated;
grant execute on function public.is_business_owner_email(text, uuid) to authenticated;
grant execute on function public.is_staff_owner_level(text, uuid) to authenticated;
grant execute on function public.can_manage_staff_as(text, uuid) to authenticated;
grant execute on function public.role_grants_staff_management(uuid, text) to authenticated;
revoke all on function public.can_manage_staff(uuid) from public, anon;
grant execute on function public.can_manage_staff(uuid) to authenticated;


-- ============================================================================
-- 8. VERIFY AFTER APPLYING — behaviourally (inside a rolled-back DO block or
--    with throwaway rows), not just from the catalog.
--
--   a) Grants are what was asked for:
--        select proname, proacl from pg_proc where proname in
--          ('create_staff_invitation','reissue_staff_invitation',
--           'get_staff_invitation','accept_staff_invitation','can_manage_staff_as',
--           'staff_email_conflict','provision_staff_auth');
--      create/reissue: service_role only. get/accept: anon + authenticated.
--      staff_email_conflict: no anon/authenticated. provision_staff_auth: gone.
--
--   b) Duplicate memberships (needed for staff_business_email_key):
--        select business_id, lower(email), count(*) from staff
--         group by 1, 2 having count(*) > 1;
--      And staff rows that collide with an owner login — the incident's shape:
--        select s.id, s.business_id, s.email, s.status from staff s
--          join businesses b on lower(b.email) = lower(s.email);
--      Review each with the owner; such rows can never sign in as staff
--      (login resolves the business first) and should be removed.
--
--   c) Attacks, as an ACTIVE CASHIER of business X (set request.jwt.claims):
--        INSERT into staff (...)                   -> 42501 "added by invitation"
--        UPDATE staff set role='Manager' where own -> 42501 "your own"
--        UPDATE staff set role='Owner' where other -> 42501 (not a manager)
--        INSERT into roles (name 'Cashier', all flags) -> 42501
--        select can_manage_staff('<X>')            -> false
--
--   d) As a STAFF ADMIN (custom role with canManageStaff) of X:
--        assign a canManageStaff role to someone   -> 42501 owner only
--        deactivate another staff admin            -> 42501 owner only
--        deactivate a Cashier                      -> allowed
--        create a role with canManageStaff=true    -> 42501
--
--   e) As the OWNER of X:
--        create_staff_invitation via service_role with p_actor_email=owner,
--          p_email=<owner's own email>             -> "business owner's login"
--          p_email=<a new address>, role 'Owner'   -> 42501
--          p_email=<a new address>, role 'Cashier' -> jsonb, status 'invited'
--        get_staff_invitation('<raw token>') as anon -> state 'valid',
--          account_exists false
--        accept_staff_invitation('<raw token>','short') -> 8-char error
--        accept_staff_invitation('<raw token>','LongEnough1') -> account_created
--        POST /auth/v1/token?grant_type=password (new staff) -> 200
--        the OWNER's sign-in with their unchanged password -> still 200
--        accept again with the same token          -> "invalid or already used"
--
--   f) Existing confirmed account (e.g. a CareFind user) invited:
--        accept as anon with any password          -> 42501 "sign in"
--        accept as that user's session (no password) -> accepted; their
--        auth.users.encrypted_password is UNCHANGED.
--
--   g) Advisors: the new SECURITY DEFINER functions produce only the expected
--      definer WARNs for get/accept (anon-exposed by design).
-- ============================================================================
