-- ============================================================================
-- Businesses INSERT guard: privilege escalation via a direct INSERT
--
-- STATUS: NOT APPLIED. Apply only as a TRACKED migration (apply_migration,
-- never execute_sql), following docs/architecture/Businesses-Insert-Guard.md.
--
-- THE VULNERABILITY (read-only verified on the live project 2026-10-11; NOT
-- exploit-tested)
-- ---------------------------------------------------------------------------
-- "own business row" is FOR ALL TO authenticated with
--   with_check: lower(email) = lower(auth.email()) OR is_platform_admin()
-- and `authenticated` holds table-level INSERT. The C18 guard
-- (guard_business_privileged_columns) is BEFORE UPDATE only, and the only
-- INSERT trigger (resolve_referring_agent) touches the referral columns only.
-- is_platform_admin() reads businesses.is_platform_admin for the caller's
-- email. So any signed-in user with no business row (CareFind customers share
-- the auth project) could insert
--   { email: <own email>, is_platform_admin: true, status: 'active' }
-- and be a CareHub platform admin, with read/write on every tenant.
--
-- THE CONTROL
-- ---------------------------------------------------------------------------
-- A BEFORE INSERT trigger that, for a non-privileged caller, only lets through
-- the two shapes the app legitimately produces:
--   root   (parent_business_id is null): status 'pending', plan 'basic' (or
--          null), no platform-admin flag, no plan expiry, no agent id. This is
--          the registration shape; registration itself goes through the
--          SECURITY DEFINER register_business() RPC, which is exempt.
--   branch (parent_business_id set): the parent exists, is the caller's own
--          (lower(email) = lower(auth.email())) and is 'active'; the branch is
--          'active' or 'pending' on the parent's plan (or null); no admin flag,
--          no expiry, no agent id.
--
-- DESIGN DECISIONS
-- ---------------------------------------------------------------------------
-- 1. SECURITY INVOKER, trusted-role test on current_user (same as the C18
--    UPDATE guard). Inside a SECURITY DEFINER function current_user is the
--    owner (postgres), so a DEFINER guard would exempt EVERY caller and be a
--    no-op. session_user cannot replace it either: under PostgREST it is
--    `authenticator` both for a direct INSERT and for an INSERT made inside
--    register_business(), so it cannot tell them apart. As INVOKER,
--    current_user is the real caller (`authenticated`) for a direct INSERT and
--    the owner (`postgres`) inside a DEFINER RPC, which is exactly the line we
--    want. Trigger functions are not EXECUTE-checked when they fire, so
--    revoking EXECUTE below does not stop the trigger.
--    The parent lookup runs under the caller's RLS: "own business row" lets an
--    owner see their own parent, and someone else's parent is invisible, which
--    the guard treats as "not your parent" (rejected).
-- 2. Trigger name `a_guard_business_insert`: BEFORE triggers fire in name
--    order, so it runs BEFORE resolve_referring_agent. It therefore sees only
--    what the CALLER supplied and rejects any caller-supplied
--    referring_agent_id; the referral trigger then sets the id from
--    referral_code_used server-side, after the guard.
-- 3. No column-level REVOKE INSERT. While `authenticated` holds table-level
--    INSERT, revoking INSERT on individual columns is a no-op in Postgres
--    (proven in businessesInsertGuard.db.test.js). Making it effective would
--    mean replacing the table grant with an allow-list of column grants, which
--    silently breaks any column added later. The trigger is the control.
-- 4. Errors are 42501 (insufficient_privilege) and name the field class only,
--    never a supplied value.
--
-- Idempotent: create or replace + drop trigger if exists.
-- ROLLBACK:   drop trigger if exists a_guard_business_insert on public.businesses;
--             (optionally: drop function if exists public.guard_business_insert();)
-- ============================================================================

create or replace function public.guard_business_insert()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_parent_status text;
  v_parent_plan   text;
  v_parent_found  boolean := false;
begin
  -- Server endpoints, migrations, SECURITY DEFINER RPCs (current_user is the
  -- owner there) and platform admins are trusted.
  if current_user in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin')
     or coalesce(public.is_platform_admin(), false) then
    return new;
  end if;

  if coalesce(new.is_platform_admin, false) then
    raise exception 'Only a platform administrator can create a business with platform-admin access.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.plan_expires_at is not null then
    raise exception 'Only a platform administrator can set a plan_expires_at on a new business.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.referring_agent_id is not null then
    raise exception 'referring_agent_id cannot be supplied; it is derived from referral_code_used.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.parent_business_id is null then
    -- Root business: the registration shape only.
    if new.status is distinct from 'pending' then
      raise exception 'A new business must start with status pending; only a platform administrator can set its status.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.plan is not null and new.plan <> 'basic' then
      raise exception 'A new business must start on the basic plan; only a platform administrator can set its plan.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- Branch: the caller must own an active parent (read under the caller's RLS).
  select true, b.status, b.plan
    into v_parent_found, v_parent_status, v_parent_plan
    from public.businesses b
   where b.id = new.parent_business_id
     and lower(b.email) = lower(auth.email());

  if not coalesce(v_parent_found, false) then
    raise exception 'A branch can only be added to a business you own (parent_business_id).'
      using errcode = 'insufficient_privilege';
  end if;
  if v_parent_status is distinct from 'active' then
    raise exception 'A branch can only be added to an active business (parent_business_id).'
      using errcode = 'insufficient_privilege';
  end if;
  if new.status is null or new.status not in ('active', 'pending') then
    raise exception 'A new branch must have status active or pending; only a platform administrator can set another status.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.plan is not null and new.plan is distinct from v_parent_plan then
    raise exception 'A new branch must be on its parent business''s plan; only a platform administrator can set another plan.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end
$$;

comment on function public.guard_business_insert() is
  'BEFORE INSERT guard on businesses: a non-privileged caller may only create a '
  'pending/basic root business or an active/pending branch of their own active '
  'business on its plan; never is_platform_admin, plan_expires_at or '
  'referring_agent_id. Service role, SECURITY DEFINER RPCs and platform admins '
  'pass through. Companion to guard_business_privileged_columns (UPDATE).';

drop trigger if exists a_guard_business_insert on public.businesses;
create trigger a_guard_business_insert
  before insert on public.businesses
  for each row execute function public.guard_business_insert();

-- Not a callable RPC. These revokes run LAST because Supabase default
-- privileges grant EXECUTE to anon/authenticated at creation time. The runbook
-- re-reads pg_proc.proacl afterwards rather than trusting this.
revoke all on function public.guard_business_insert() from public, anon, authenticated;
