-- CareHub plans: limits enforced by the database, and restrictions once a plan has expired.
--
-- Written against the LIVE schema read on 2026-10-27:
--   * businesses(plan, plan_expires_at, parent_business_id, deleted_at, status). Branches carry their main business's plan
--     and expiry (businesses_branch_plan_follows_parent). 25 of 31 businesses were past plan_expires_at.
--   * Plan limits (lib/planLimits.js) were checked only in the browser: nothing in the database limited staff, branches or
--     products, and nothing changed when a plan expired.
--
-- POLICY (owner's decision, 2026-10-27)
--   * active      more than 14 days left, or no expiry recorded.
--   * expiring    14 days or fewer left: alerts only.
--   * grace       expired, for 7 days: full access, daily alerts.
--   * restricted  after the grace period: every record stays readable and the POS keeps selling (patients are never turned
--                 away), but no new staff, branches or products (so no imports either) until the plan is renewed.
--   * Businesses already expired when this is applied get a fresh 7-day grace from that moment (no one is restricted
--     without warning): grace ends at max(plan_expires_at, enforcement start) + 7 days.
--   * Plan limits apply in every state: Basic 5 staff, 2 locations (main + branches), 5,000 products; Growth/Hospital 5
--     locations; Premium 10; Enterprise 30; Custom unlimited. Same numbers as lib/planLimits.js (a test checks they agree).
--
-- WHAT THIS ADDS
--   1. plan_enforcement_started_at(): the moment this was first applied (fixed on first run; re-runs keep it).
--   2. plan_limit(plan, what), plan_grace_ends_at(expiry), plan_state(expiry): the rules above, in one place.
--   3. business_plan_status(business_id): the state, dates and limits for the app's banners and checks. Members only.
--      (The trigger functions below read the business row; products_enforce_plan runs as the caller, see there.)
--   4. Enforcement, for signed-in callers (server code, migrations and platform admins are trusted):
--        - products: a statement-level check after insert (so a bulk import is checked as a whole): refused when the
--          business is restricted or the insert takes it over its product limit.
--        - staff: refused when restricted or at the staff limit. This one also applies inside SECURITY DEFINER code (the
--          staff invitation function), because that is how staff are added; only a platform admin bypasses it.
--        - branches: guard_business_insert (re-created from its live definition) also refuses a branch when the business
--          is restricted or already has its plan's number of locations.
--
-- SECURITY: no permission is widened. The functions are SECURITY DEFINER only to read the business row whatever the
-- caller's RLS; business_plan_status returns nothing for a business the caller cannot see. Trigger functions cannot be
-- called directly. Renewal (Settings -> Renew, extend_business_plan) is untouched, so a restricted business can always pay.
--
-- ROLLBACK: drop the three triggers (products_enforce_plan, staff_enforce_plan) and the functions added here; re-apply
-- carehub_20261101_businesses_insert_guard_expiry_default.sql to restore guard_business_insert.

-- ── 1. When enforcement started (fixed once) ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'plan_enforcement_started_at' and pronamespace = 'public'::regnamespace) then
    execute format(
      'create function public.plan_enforcement_started_at() returns timestamptz language sql immutable as %L',
      format('select %L::timestamptz', now()));
  end if;
end $$;

-- ── 2. The rules ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- NULL means unlimited. Unknown plans are treated as Basic (as planLimitsFor does).
create or replace function public.plan_limit(p_plan text, p_what text)
returns integer language sql immutable set search_path = public, pg_temp as $$
  select case coalesce(p_plan, 'basic')
    when 'growth'     then case p_what when 'locations' then 5 end
    when 'hospital'   then case p_what when 'locations' then 5 end
    when 'premium'    then case p_what when 'locations' then 10 end
    when 'enterprise' then case p_what when 'locations' then 30 end
    when 'custom'     then null
    else case p_what when 'staff' then 5 when 'locations' then 2 when 'products' then 5000 end
  end
$$;

create or replace function public.plan_grace_ends_at(p_expires_at timestamptz)
returns timestamptz language sql stable set search_path = public, pg_temp as $$
  select case when p_expires_at is null then null
              else greatest(p_expires_at, public.plan_enforcement_started_at()) + interval '7 days' end
$$;

create or replace function public.plan_state(p_expires_at timestamptz)
returns text language sql stable set search_path = public, pg_temp as $$
  select case
    when p_expires_at is null then 'active'
    when p_expires_at > now() + interval '14 days' then 'active'
    when p_expires_at > now() then 'expiring'
    when now() < public.plan_grace_ends_at(p_expires_at) then 'grace'
    else 'restricted'
  end
$$;

-- ── 3. Status for the app ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.business_plan_status(p_business_id uuid)
returns json language sql stable security definer set search_path = public, pg_temp as $$
  select json_build_object(
    'business_id', b.id,
    'plan', coalesce(b.plan, 'basic'),
    'expires_at', b.plan_expires_at,
    'grace_ends_at', public.plan_grace_ends_at(b.plan_expires_at),
    'state', public.plan_state(b.plan_expires_at),
    'enforcement_started_at', public.plan_enforcement_started_at(),
    'limits', json_build_object(
      'staff', public.plan_limit(b.plan, 'staff'),
      'locations', public.plan_limit(b.plan, 'locations'),
      'products', public.plan_limit(b.plan, 'products')))
  from public.businesses b
  where b.id = p_business_id
    and (b.id in (select public.current_business_ids()) or public.is_platform_admin())
$$;

-- ── 4a. Products ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER on purpose: current_user must be the caller's role (inside a definer function it would be the owner
-- and every insert would look trusted). Members see all of their business's products and its row under RLS.
create or replace function public.products_enforce_plan()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare r record;
begin
  if current_user not in ('authenticated', 'anon') or public.is_platform_admin() then return null; end if;
  for r in
    select n.business_id, count(*) as added, b.plan, b.plan_expires_at
      from new_rows n join public.businesses b on b.id = n.business_id
     group by n.business_id, b.plan, b.plan_expires_at
  loop
    if public.plan_state(r.plan_expires_at) = 'restricted' then
      raise exception 'Your CareHub plan has expired. Renew it in Settings to add products. Selling and restocking existing products still work.'
        using errcode = '23514';
    end if;
    if public.plan_limit(r.plan, 'products') is not null
       and (select count(*) from public.products p where p.business_id = r.business_id) > public.plan_limit(r.plan, 'products') then
      raise exception 'Your plan allows up to % products. Upgrade your plan in Settings to add more.',
        to_char(public.plan_limit(r.plan, 'products'), 'FM999,999,999') using errcode = '23514';
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists products_enforce_plan on public.products;
create trigger products_enforce_plan after insert on public.products
  referencing new table as new_rows for each statement execute function public.products_enforce_plan();

-- ── 4b. Staff ────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.staff_enforce_plan()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_plan text; v_expires timestamptz; v_limit integer;
begin
  if public.is_platform_admin() then return new; end if;
  select b.plan, b.plan_expires_at into v_plan, v_expires from public.businesses b where b.id = new.business_id;
  if not found then return new; end if;
  if public.plan_state(v_expires) = 'restricted' then
    raise exception 'Your CareHub plan has expired. Renew it in Settings to add staff.' using errcode = '23514';
  end if;
  v_limit := public.plan_limit(v_plan, 'staff');
  if v_limit is not null and (select count(*) from public.staff s where s.business_id = new.business_id) >= v_limit then
    raise exception 'Your plan allows up to % staff. Upgrade your plan in Settings to add more.', v_limit using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists staff_enforce_plan on public.staff;
create trigger staff_enforce_plan before insert on public.staff
  for each row execute function public.staff_enforce_plan();

-- ── 4c. Branches: guard_business_insert, as live, plus the plan checks ───────────────────────────────────────────────
create or replace function public.guard_business_insert()
returns trigger language plpgsql set search_path to 'public' as $function$
declare
  v_parent_status text;
  v_parent_plan   text;
  v_parent_expiry timestamptz;
  v_parent_found  boolean := false;
  v_root          uuid;
  v_locations     integer;
  v_limit         integer;
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

  -- Plan (carehub_20261214): no new branch once the plan is restricted, and no more locations (the main business plus
  -- every branch below it) than the plan allows.
  if public.plan_state(v_parent_expiry) = 'restricted' then
    raise exception 'Your CareHub plan has expired. Renew it in Settings to add branches.' using errcode = '23514';
  end if;
  v_limit := public.plan_limit(v_parent_plan, 'locations');
  if v_limit is not null then
    with recursive up(id, parent_business_id, depth) as (
      select b.id, b.parent_business_id, 0 from public.businesses b where b.id = new.parent_business_id
      union all
      select p.id, p.parent_business_id, up.depth + 1 from public.businesses p join up on p.id = up.parent_business_id where up.depth < 10
    )
    select id into v_root from up where parent_business_id is null limit 1;
    with recursive tree(id, depth) as (
      select v_root, 0
      union all
      select c.id, t.depth + 1 from public.businesses c join tree t on c.parent_business_id = t.id where t.depth < 10 and c.deleted_at is null
    )
    select count(*) into v_locations from tree;
    if v_locations >= v_limit then
      raise exception 'Your plan allows up to % locations. Upgrade your plan in Settings to add more.', v_limit using errcode = '23514';
    end if;
  end if;

  -- The expiry is never the caller's (nor the column default's): a branch
  -- inherits its parent's.
  new.plan_expires_at := v_parent_expiry;

  return new;
end
$function$;

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.business_plan_status(uuid) from public, anon;
grant execute on function public.business_plan_status(uuid) to authenticated, service_role;
revoke all on function public.products_enforce_plan() from public, anon, authenticated;
revoke all on function public.staff_enforce_plan() from public, anon, authenticated;
-- The rule functions hold no data; they are callable so the reminder job (service role) can use the same rules.
revoke all on function public.plan_limit(text, text) from public, anon;
revoke all on function public.plan_grace_ends_at(timestamptz) from public, anon;
revoke all on function public.plan_state(timestamptz) from public, anon;
revoke all on function public.plan_enforcement_started_at() from public, anon;
grant execute on function public.plan_limit(text, text), public.plan_grace_ends_at(timestamptz), public.plan_state(timestamptz),
  public.plan_enforcement_started_at() to authenticated, service_role;
