-- ============================================================================
-- Businesses INSERT guard: corrective follow-up (plan_expires_at default)
--
-- STATUS: NOT APPLIED. Follow-up to carehub_20261031_businesses_insert_guard
-- (applied live as a tracked migration, version 20261011040639, 2026-10-11).
-- Apply only as a TRACKED migration (apply_migration, never execute_sql),
-- following docs/architecture/Businesses-Insert-Guard.md.
--
-- WHAT WENT WRONG
-- ---------------------------------------------------------------------------
-- The live column businesses.plan_expires_at has DEFAULT (now() + '30 days').
-- Column defaults are filled in BEFORE row triggers run, so in the first
-- version `new.plan_expires_at is not null` was true for EVERY insert, and
-- every non-privileged insert was refused with "Only a platform administrator
-- can set a plan_expires_at on a new business", including the legitimate
-- branch shape. It failed closed, so there was no security gap, and branch
-- creation was already failing in production on businesses_email_key, so
-- nothing regressed. The PGlite replica lacked that default, which is why the
-- tests passed. The replica now mirrors the live defaults of every guarded
-- column.
--
-- THE CHANGE
-- ---------------------------------------------------------------------------
-- The early "plan_expires_at must be null" rejection is removed. Root inserts
-- by a non-privileged caller are rejected regardless, so it only ever mattered
-- for branches. For a BRANCH, the guard now OVERWRITES plan_expires_at with
-- the PARENT's plan_expires_at, read in the same RLS-scoped parent lookup.
-- The caller can neither choose nor extend an expiry, whether by supplying a
-- value or by taking the column default. This also settles the earlier review
-- note that a branch should inherit the parent's expiry rather than carry NULL.
--
-- Every other rule is unchanged. Same signature, still SECURITY INVOKER, same
-- search_path, same trusted-role test. The trigger a_guard_business_insert is
-- NOT re-created: it calls the function by name, so CREATE OR REPLACE is
-- enough.
--
-- ROLLBACK: re-run the function definition from
--           carehub_20261031_businesses_insert_guard.sql (fails closed), or
--           drop trigger if exists a_guard_business_insert on public.businesses;
-- ============================================================================

-- CREATE OR REPLACE FUNCTION does not lock public.businesses, so this is
-- precautionary. `set local` only takes effect inside a transaction
-- (apply_migration is assumed to run the body as one); outside a transaction
-- it is a no-op with a WARNING.
set local lock_timeout = '5s';

create or replace function public.guard_business_insert()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_parent_status text;
  v_parent_plan   text;
  v_parent_expiry timestamptz;
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

  if new.referring_agent_id is not null then
    raise exception 'referring_agent_id cannot be supplied; it is derived from referral_code_used.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.parent_business_id is null then
    -- Root business: never by direct insert. Registration goes through the
    -- SECURITY DEFINER RPCs (exempt above); no client code inserts a root row.
    raise exception 'Businesses are created through registration, not by direct insert.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Branch: the caller must own an active parent (read under the caller's RLS).
  select true, b.status, b.plan, b.plan_expires_at
    into v_parent_found, v_parent_status, v_parent_plan, v_parent_expiry
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

  -- The expiry is never the caller's (nor the column default's): a branch
  -- inherits its parent's.
  new.plan_expires_at := v_parent_expiry;

  return new;
end
$$;

comment on function public.guard_business_insert() is
  'BEFORE INSERT guard on businesses: a non-privileged caller may never create a '
  'root business (registration RPCs only) and may only create an active/pending '
  'branch of their own active business on its plan; never is_platform_admin or '
  'referring_agent_id, and a branch''s plan_expires_at is always overwritten with '
  'its parent''s. Service role, SECURITY DEFINER RPCs and platform admins pass '
  'through. Companion to guard_business_privileged_columns (UPDATE).';

-- Not a callable RPC. CREATE OR REPLACE keeps the existing ACL, and default
-- privileges apply only when a function is first created. The revoke is
-- repeated anyway, LAST, and the runbook re-reads pg_proc.proacl afterwards
-- rather than trusting this.
revoke all on function public.guard_business_insert() from public, anon, authenticated;
