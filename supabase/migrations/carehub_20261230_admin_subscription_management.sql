-- carehub_20261230_admin_subscription_management
--
-- Status: NOT YET APPLIED. Written against the live schema read on 2026-11-02:
--   * A business's plan lives on the businesses row (plan, plan_expires_at). plan_state(), plan_grace_ends_at() and
--     plan_limit() (carehub_20261214_plan_enforcement) turn it into what the app enforces. 31 businesses, 30 main.
--   * Payments are automated: Paystack and the wallet settle through renew_business_plan, the only writer of
--     plan_payments (carehub_20261218_subscription_billing). 1 payment recorded.
--   * business_subscriptions exists but is empty and nothing enforces it (an unused mirror from 20260908_admin_money).
--     It is not used here and is left as it is.
--   * Platform staff had no audited way to change a plan: the only route was a raw PATCH of the businesses row, which
--     records neither who did it nor why.
--
-- What this adds
--   1. subscription_events: an append-only history of every administrative change to a subscription (plan change,
--      free or complimentary access, extension, new expiry date, suspension, activation), with the reason, the actor
--      and the before/after plan and expiry. Platform admins can read it; nobody can write it except the function below.
--   2. admin_manage_subscription(...): the one write path for those changes. It works on the main business (a branch id
--      resolves to it; branches follow through businesses_branch_plan_follows_parent), locks the row, validates the
--      request, updates plan / plan_expires_at, records the event and writes admin_audit_log, all in one transaction.
--   3. admin_subscription_overview(): every main business with its plan, expiry, state, last payment, latest
--      administrative change and how the current access was obtained (paid, trial, complimentary, ...).
--   4. admin_subscription_history(business_id): payments (renewals) and administrative changes in one timeline.
--
-- How it works with the automated payments (unchanged)
--   * renew_business_plan, the Paystack webhook, verify-plan-payment and the wallet settlement are not touched.
--   * Free and complimentary access is NOT a payment: nothing is written to plan_payments, so receipts, revenue,
--     reconciliation and referral commissions only ever reflect money that was actually paid.
--   * Grants and extensions add time after the current expiry when it is still in the future, so paid time is never lost.
--   * A payment always renews as normal. Paying while suspended moves the expiry date, and the suspension is then
--     treated as lifted by that payment (it is only "open" while the expiry it set is still in place).
--
-- Suspension
--   Suspending sets the expiry to just over 7 days in the past, which puts the business straight into the existing
--   "restricted" mode (records readable, POS keeps selling; new staff, branches, products, imports and exports paused).
--   The time that was left is recorded on the event and given back on activation. It is a plan-level pause: to block
--   all access, suspend the business itself (Businesses > Suspend). Until plan_enforcement_started_at() + 7 days
--   (2026-11-03 20:44 UTC in production) the go-live grace floor keeps everyone in "grace", so a suspension made before
--   then shows as grace and becomes restricted at that moment. The overview reports the real state either way.
--
-- Security implications
--   * Every function refuses (42501) anyone who is not a platform admin (is_platform_admin()), before reading anything.
--   * The functions are SECURITY DEFINER so the table needs no client write grant and so they can write plan columns
--     that guard_business_privileged_columns keeps platform-admin-only. They add no capability a platform admin did not
--     already have (platform admins could already PATCH these columns); they add validation and an audit trail.
--   * The actor is always auth.uid() / auth.email(); a caller cannot name someone else.
--   * subscription_events is append-only (update, delete and truncate are refused by trigger) and has no business_id
--     foreign key, so the history outlives a hard-deleted business and does not block that delete.
--   * Inputs are bounded: an allow-list of actions, plans and grant kinds; durations of 1-120 months or 1-3650 days;
--     expiry dates within 10 years; a reason of 3-500 characters.
--
-- Rollback
--   drop function public.admin_manage_subscription(uuid, text, text, text, integer, integer, timestamptz, text);
--   drop function public.admin_subscription_history(uuid);
--   drop function public.admin_subscription_overview();
--   drop function public._subscription_open_suspension(uuid);
--   drop table public.subscription_events;   -- loses the history; export it first
--   drop function public.subscription_events_append_only();
--   Plans and expiry dates already changed stay as they are (they are ordinary values on businesses).

-- ── 1. History ─────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  action text not null check (action in ('change_plan', 'grant', 'extend', 'set_expiry', 'suspend', 'activate')),
  grant_type text check (grant_type is null or grant_type in ('trial', 'complimentary', 'partnership', 'contribution', 'promotion', 'other')),
  plan_before text,
  plan_after text,
  expires_before timestamptz,
  expires_after timestamptz,
  -- When the access this event gave starts (grant, extend, activate); null for the other actions.
  period_start timestamptz,
  months integer,
  days integer,
  -- Suspension only: the seconds of access that were left, given back on activation (null = the plan had no expiry).
  remaining_seconds bigint,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  actor_user_id uuid,
  actor_email text,
  -- clock_timestamp so several changes in one transaction still order correctly.
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists subscription_events_business_created_idx
  on public.subscription_events (business_id, created_at desc);

alter table public.subscription_events enable row level security;
revoke all on public.subscription_events from public, anon, authenticated;
grant select on public.subscription_events to authenticated;
grant all on public.subscription_events to service_role;

drop policy if exists "platform admins read subscription events" on public.subscription_events;
create policy "platform admins read subscription events" on public.subscription_events
  for select to authenticated using (public.is_platform_admin());

create or replace function public.subscription_events_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'subscription_events is append-only' using errcode = '42501';
end $$;
revoke all on function public.subscription_events_append_only() from public, anon, authenticated;

drop trigger if exists subscription_events_append_only on public.subscription_events;
create trigger subscription_events_append_only before update or delete on public.subscription_events
  for each row execute function public.subscription_events_append_only();
drop trigger if exists subscription_events_no_truncate on public.subscription_events;
create trigger subscription_events_no_truncate before truncate on public.subscription_events
  for each statement execute function public.subscription_events_append_only();

-- ── 2. Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- The open suspension of a main business, or a row of nulls. A suspension is open while it is the latest change to
-- the expiry date and the expiry it set is still in place (a payment or another change since then lifts it).
create or replace function public._subscription_open_suspension(p_business_id uuid)
returns public.subscription_events
language sql stable security definer set search_path = public, pg_temp as $$
  select e.*
    from (select * from public.subscription_events
           where business_id = p_business_id and action <> 'change_plan'
           order by created_at desc, id desc limit 1) e
    join public.businesses b on b.id = e.business_id
   where e.action = 'suspend' and b.plan_expires_at is not distinct from e.expires_after
$$;
revoke all on function public._subscription_open_suspension(uuid) from public, anon, authenticated;

-- ── 3. The one write path ──────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_manage_subscription(
  p_business_id uuid,
  p_action text,
  p_reason text,
  p_plan text default null,
  p_months integer default null,
  p_days integer default null,
  p_expires_at timestamptz default null,
  p_grant_type text default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_root uuid;
  v_name text;
  v_plan_before text;
  v_exp_before timestamptz;
  v_deleted timestamptz;
  v_plan_after text;
  v_exp_after timestamptz;
  v_base timestamptz;
  v_duration interval;
  v_period_start timestamptz;
  v_remaining bigint;
  v_grant_type text;
  v_susp public.subscription_events;
  v_event_id uuid;
begin
  if auth.uid() is null or not coalesce(public.is_platform_admin(), false) then
    raise exception 'Only a platform administrator can manage subscriptions' using errcode = '42501';
  end if;
  if p_business_id is null then
    raise exception 'Choose a business' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('change_plan', 'grant', 'extend', 'set_expiry', 'suspend', 'activate') then
    raise exception 'Unknown subscription action' using errcode = '22023';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Give a reason for this change (at least 3 characters)' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Keep the reason under 500 characters' using errcode = '22023';
  end if;
  if p_plan is not null and p_plan not in ('basic', 'growth', 'premium', 'enterprise', 'custom') then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;

  -- Billing belongs to the main business; a branch id resolves to it.
  with recursive up(id, parent_business_id, depth) as (
    select b.id, b.parent_business_id, 0 from public.businesses b where b.id = p_business_id
    union
    select p.id, p.parent_business_id, up.depth + 1 from public.businesses p join up on p.id = up.parent_business_id
     where up.depth < 10
  )
  select id into v_root from up where parent_business_id is null limit 1;
  if v_root is null then
    raise exception 'Business not found' using errcode = 'P0002';
  end if;

  select name, coalesce(plan, 'basic'), plan_expires_at, deleted_at
    into v_name, v_plan_before, v_exp_before, v_deleted
    from public.businesses where id = v_root for update;
  if v_deleted is not null then
    raise exception 'This business has been deleted' using errcode = '22023';
  end if;

  if p_action in ('grant', 'extend') then
    if (p_months is null) = (p_days is null) then
      raise exception 'Give the length in months or in days' using errcode = '22023';
    end if;
    if p_months is not null and (p_months < 1 or p_months > 120) then
      raise exception 'Months must be between 1 and 120' using errcode = '22023';
    end if;
    if p_days is not null and (p_days < 1 or p_days > 3650) then
      raise exception 'Days must be between 1 and 3650' using errcode = '22023';
    end if;
    v_duration := make_interval(months => coalesce(p_months, 0), days => coalesce(p_days, 0));
  end if;

  if p_action = 'grant' then
    if p_grant_type is null or p_grant_type not in ('trial', 'complimentary', 'partnership', 'contribution', 'promotion', 'other') then
      raise exception 'Choose the kind of access being granted' using errcode = '22023';
    end if;
    v_grant_type := p_grant_type;
  end if;

  v_plan_after := v_plan_before;
  v_exp_after := v_exp_before;
  v_susp := public._subscription_open_suspension(v_root);

  if p_action = 'change_plan' then
    if p_plan is null then
      raise exception 'Choose a plan' using errcode = '22023';
    end if;
    if p_plan = v_plan_before then
      raise exception 'The business is already on this plan' using errcode = '22023';
    end if;
    v_plan_after := p_plan;

  elsif p_action in ('grant', 'extend') then
    if v_susp.id is not null then
      raise exception 'This subscription is suspended. Activate it first' using errcode = '22023';
    end if;
    if v_exp_before is null then
      raise exception 'This business has no expiry date, so its access does not run out' using errcode = '22023';
    end if;
    -- Time is added after the current expiry when it is still ahead, so paid time is never lost.
    v_base := greatest(v_exp_before, now());
    v_period_start := v_base;
    v_exp_after := v_base + v_duration;
    if p_action = 'grant' and p_plan is not null then
      v_plan_after := p_plan;
    end if;

  elsif p_action = 'set_expiry' then
    if p_expires_at is null then
      raise exception 'Choose the new expiry date' using errcode = '22023';
    end if;
    if p_expires_at > now() + interval '10 years' then
      raise exception 'The expiry date must be within 10 years' using errcode = '22023';
    end if;
    if v_susp.id is not null then
      raise exception 'This subscription is suspended. Activate it first' using errcode = '22023';
    end if;
    v_exp_after := p_expires_at;

  elsif p_action = 'suspend' then
    if v_susp.id is not null then
      raise exception 'This subscription is already suspended' using errcode = '22023';
    end if;
    v_remaining := case when v_exp_before is null then null
                        else greatest(0, floor(extract(epoch from (v_exp_before - now()))))::bigint end;
    -- Just past the 7-day grace period: the existing restricted mode applies at once.
    v_exp_after := now() - interval '7 days' - interval '1 second';

  elsif p_action = 'activate' then
    if v_susp.id is null then
      raise exception 'This subscription is not suspended' using errcode = '22023';
    end if;
    v_period_start := now();
    v_exp_after := case when v_susp.expires_before is null then null
                        else now() + make_interval(secs => v_susp.remaining_seconds) end;
  end if;

  update public.businesses
     set plan = v_plan_after, plan_expires_at = v_exp_after
   where id = v_root
     and (plan is distinct from v_plan_after or plan_expires_at is distinct from v_exp_after);

  insert into public.subscription_events (business_id, action, grant_type, plan_before, plan_after, expires_before,
                                          expires_after, period_start, months, days, remaining_seconds, reason,
                                          actor_user_id, actor_email)
  values (v_root, p_action, v_grant_type, v_plan_before, v_plan_after, v_exp_before,
          v_exp_after, v_period_start,
          case when p_action in ('grant', 'extend') then p_months end,
          case when p_action in ('grant', 'extend') then p_days end,
          v_remaining, v_reason, auth.uid(), lower(auth.email()))
  returning id into v_event_id;

  insert into public.admin_audit_log (actor_admin_id, action, target_table, target_id, before, after)
  values (auth.uid(), 'subscription.' || p_action, 'businesses', v_root::text,
          jsonb_build_object('plan', v_plan_before, 'plan_expires_at', v_exp_before),
          jsonb_build_object('plan', v_plan_after, 'plan_expires_at', v_exp_after, 'grant_type', v_grant_type,
                             'reason', v_reason, 'subscription_event_id', v_event_id));

  return json_build_object(
    'event_id', v_event_id,
    'business_id', v_root,
    'business_name', v_name,
    'plan', v_plan_after,
    'expires_at', v_exp_after,
    'grace_ends_at', public.plan_grace_ends_at(v_exp_after),
    'state', public.plan_state(v_exp_after),
    'suspended', p_action = 'suspend');
end $$;

revoke all on function public.admin_manage_subscription(uuid, text, text, text, integer, integer, timestamptz, text) from public, anon;
grant execute on function public.admin_manage_subscription(uuid, text, text, text, integer, integer, timestamptz, text) to authenticated;

-- ── 4. Overview ────────────────────────────────────────────────────────────────────────────────────────────────────
-- access_type says how the current access was obtained: the latest change to the expiry date wins.
--   suspended | trial | complimentary | partnership | contribution | promotion | other  (admin grants)
--   admin (extended or re-dated by an administrator) | paid (a plan payment) | none (never paid; signup period)
create or replace function public.admin_subscription_overview()
returns table (
  business_id uuid, name text, owner_name text, email text, phone text, state text, city text, business_type text,
  status text, created_at timestamptz, plan text, expires_at timestamptz, grace_ends_at timestamptz,
  plan_state text, suspended boolean, access_type text, period_start timestamptz, branch_count integer,
  payment_count integer, total_paid bigint, last_payment_at timestamptz, last_payment_amount integer,
  last_payment_method text, last_payment_months integer, last_event_action text, last_event_at timestamptz,
  last_event_reason text
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not coalesce(public.is_platform_admin(), false) then
    raise exception 'Only a platform administrator can view subscriptions' using errcode = '42501';
  end if;

  return query
  select b.id, b.name, coalesce(b.owner_name, b.owner), b.email, b.phone, b.state, b.city, b.business_type,
         b.status, b.created_at::timestamptz, coalesce(b.plan, 'basic'), b.plan_expires_at,
         public.plan_grace_ends_at(b.plan_expires_at), public.plan_state(b.plan_expires_at),
         (susp.id is not null),
         case
           when susp.id is not null then 'suspended'
           when lt.id is not null and (lp.paid_at is null or lt.created_at > lp.paid_at)
             then case when lt.action = 'grant' then lt.grant_type else 'admin' end
           when lp.paid_at is not null then 'paid'
           else 'none'
         end,
         greatest(case when lp.period_start <= now() then lp.period_start end,
                  case when lt.period_start <= now() then lt.period_start end),
         (select count(*)::int from public.businesses c where c.parent_business_id = b.id and c.deleted_at is null),
         coalesce(pay.n, 0), coalesce(pay.total, 0),
         lp.paid_at, lp.naira_amount, lp.payment_method, lp.months,
         le.action, le.created_at, le.reason
    from public.businesses b
    left join lateral (
      select count(*)::int n, coalesce(sum(p.naira_amount), 0)::bigint total
        from public.plan_payments p where p.business_id = b.id and p.status = 'success') pay on true
    left join lateral (
      select p.paid_at, p.naira_amount, p.payment_method, p.months, p.period_start
        from public.plan_payments p where p.business_id = b.id and p.status = 'success'
       order by p.paid_at desc limit 1) lp on true
    -- latest administrative change to the expiry date
    left join lateral (
      select e.id, e.action, e.grant_type, e.created_at, e.period_start
        from public.subscription_events e where e.business_id = b.id and e.action <> 'change_plan'
       order by e.created_at desc, e.id desc limit 1) lt on true
    -- latest administrative change of any kind
    left join lateral (
      select e.action, e.created_at, e.reason
        from public.subscription_events e where e.business_id = b.id
       order by e.created_at desc, e.id desc limit 1) le on true
    left join lateral (select (public._subscription_open_suspension(b.id)).id) susp on true
   where b.parent_business_id is null and b.deleted_at is null
   order by b.plan_expires_at asc nulls last, b.name;
end $$;

revoke all on function public.admin_subscription_overview() from public, anon;
grant execute on function public.admin_subscription_overview() to authenticated;

-- ── 5. History: payments and administrative changes ────────────────────────────────────────────────────────────────
create or replace function public.admin_subscription_history(p_business_id uuid)
returns table (
  kind text, occurred_at timestamptz, action text, grant_type text, plan_before text, plan_after text,
  expires_before timestamptz, expires_after timestamptz, months integer, days integer, amount integer, currency text,
  payment_method text, reference text, receipt_number text, reason text, actor_email text
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_root uuid;
begin
  if auth.uid() is null or not coalesce(public.is_platform_admin(), false) then
    raise exception 'Only a platform administrator can view subscriptions' using errcode = '42501';
  end if;

  with recursive up(id, parent_business_id, depth) as (
    select b.id, b.parent_business_id, 0 from public.businesses b where b.id = p_business_id
    union
    select p.id, p.parent_business_id, up.depth + 1 from public.businesses p join up on p.id = up.parent_business_id
     where up.depth < 10
  )
  select id into v_root from up where parent_business_id is null limit 1;
  v_root := coalesce(v_root, p_business_id);

  return query
  select * from (
    select 'admin'::text, e.created_at, e.action, e.grant_type, e.plan_before, e.plan_after, e.expires_before,
           e.expires_after, e.months, e.days, null::int, null::text, null::text, null::text, null::text, e.reason,
           e.actor_email
      from public.subscription_events e where e.business_id = v_root
    union all
    select 'payment'::text, p.paid_at, 'payment'::text, null::text, p.plan, p.plan, p.period_start, p.period_end,
           p.months, null::int, p.naira_amount, p.currency, p.payment_method, p.reference, p.receipt_number,
           null::text, null::text
      from public.plan_payments p where p.business_id = v_root and p.status = 'success'
  ) h
  order by 2 desc
  limit 500;
end $$;

revoke all on function public.admin_subscription_history(uuid) from public, anon;
grant execute on function public.admin_subscription_history(uuid) to authenticated;

-- ── Verify, do not assume ──────────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.admin_manage_subscription(uuid, text, text, text, integer, integer, timestamptz, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_subscription_overview()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_subscription_history(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._subscription_open_suspension(uuid)', 'EXECUTE') then
    raise exception 'subscription management functions are callable by the wrong roles';
  end if;
  if has_table_privilege('authenticated', 'public.subscription_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.subscription_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.subscription_events', 'DELETE') then
    raise exception 'subscription_events must not be writable by clients';
  end if;
end $$;
