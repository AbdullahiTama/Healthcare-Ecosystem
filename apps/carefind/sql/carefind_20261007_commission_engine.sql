-- Financial program, Phase 07: the referral commission engine.
--
-- Business rules (existing, NOT changed): the business's FIRST successful plan payment earns its referring
-- agent 40% (type 'referral_bonus'); every later payment earns 5% (type 'residual'). The rates live in
-- financial_config (referral_first_payment_rate / referral_residual_rate, seeded in Phase 02).
--
-- What was wrong, and what this does about it
--   * "First payment" was decided by a non-atomic count in renew_business_plan: two payments for one
--     business at the same instant could BOTH be flagged first (two 40% bonuses).  renew_business_plan now
--     takes the business row lock BEFORE counting, and a unique partial index makes a second first payment
--     (and a second bonus) impossible even if the function were bypassed.
--   * The commission was created by Node AFTER settlement: a crash between the two lost it, and a backstop
--     cron with arbitrary caps (200 payments / 1000 businesses) tried to repair it.  The commission is now
--     created INSIDE renew_business_plan, in the same transaction as the payment row: every plan payment
--     path (the settlement engine and the legacy webhook branch) gets exactly one commission or a review
--     flag, or the whole renewal rolls back and is retried.
--   * `commissions` stored amount and rate but not the base the rate was applied to.  base_amount is added,
--     and the database enforces amount = round(base_amount x rate, 2), rate in [0,1], valid type/status.
--   * One payment -> at most one commission (payment_id unique, already there); one business -> at most one
--     referral_bonus (new partial unique index).
--   * Client-side creation: nothing but the engine can write.  INSERT/UPDATE/DELETE are revoked from every
--     role (service_role included) on commissions and commission_review_flags; the identity/money columns of
--     a commission are immutable by trigger; only `status` may move, along accrued -> payable -> paid (or
--     void), through set_commission_status() for a platform admin / the server.
--   * Reconciliation: reconcile_commissions() reports every inconsistency; backfill_missing_commissions()
--     repairs payments that predate the engine, set-based and without caps.
-- The tier-based agent_earnings program (calculate_agent_earnings) is a SEPARATE scheme and is not touched;
-- reconcile_commissions() reports payments that both programs paid ('double_program').

do $$
begin
  if to_regprocedure('public._fin_cfg(text)') is null then
    raise exception 'apply carefind_20261004_settle_payment_intent first';
  end if;
  if to_regprocedure('public.renew_business_plan(uuid,integer,integer,text)') is null then
    raise exception 'public.renew_business_plan is missing';
  end if;
  if to_regprocedure('public.financial_no_truncate()') is null then
    raise exception 'apply carefind_20261003_payment_intents_foundation first';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Configuration: the one policy knob that used to be a JS constant (ACCRUED_WHILE_INACTIVE = false)
-- ---------------------------------------------------------------------------------------------
insert into public.financial_config (key, value, unit, description) values
  ('referral_accrue_while_inactive', 0, 'flag', '1 = keep accruing referral commission while the referring agent is not active; 0 = flag the payment for review instead (current rule)')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- commissions: base amount, constraints, one bonus per business
-- ---------------------------------------------------------------------------------------------
alter table public.commissions add column if not exists base_amount numeric;
update public.commissions c set base_amount = pp.naira_amount
  from public.plan_payments pp where pp.id = c.payment_id and c.base_amount is null;
alter table public.commissions alter column base_amount set not null;

alter table public.commissions
  add constraint commissions_type_check check (type in ('referral_bonus', 'residual')),
  add constraint commissions_status_check check (status in ('accrued', 'payable', 'paid', 'void')),
  add constraint commissions_rate_range check (rate >= 0 and rate <= 1),
  add constraint commissions_base_positive check (base_amount > 0),
  add constraint commissions_amount_nonnegative check (amount >= 0),
  add constraint commissions_amount_matches check (amount = round(base_amount * rate, 2));

create unique index commissions_one_bonus_per_business on public.commissions (business_id) where type = 'referral_bonus';

-- A business has at most one FIRST payment. (renew_business_plan serialises on the business row, so this
-- index is the backstop, not the mechanism.)
create unique index plan_payments_one_first_per_business on public.plan_payments (business_id) where is_first_payment;

-- Flagging a payment for review is idempotent per (payment, reason).
alter table public.commission_review_flags add constraint commission_review_flags_once unique (payment_id, reason);

-- ---------------------------------------------------------------------------------------------
-- Immutability: only `status` may change, only forward; no deletes; no truncate
-- ---------------------------------------------------------------------------------------------
create or replace function public.commissions_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  allowed text[] := array['accrued>payable', 'accrued>paid', 'accrued>void', 'payable>paid', 'payable>void'];
begin
  if tg_op = 'DELETE' then
    raise exception 'commissions are never deleted (void them instead)' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.agent_id is distinct from old.agent_id
     or new.business_id is distinct from old.business_id
     or new.payment_id is distinct from old.payment_id
     or new.type is distinct from old.type
     or new.rate is distinct from old.rate
     or new.base_amount is distinct from old.base_amount
     or new.amount is distinct from old.amount
     or new.created_at is distinct from old.created_at then
    raise exception 'a commission''s identity and amounts are immutable; only its status may change' using errcode = '23514';
  end if;
  if new.status is distinct from old.status
     and (old.status || '>' || new.status) <> all (allowed) then
    raise exception 'illegal commission status change % -> %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger commissions_guard before update or delete on public.commissions
  for each row execute function public.commissions_guard();
create trigger commissions_no_truncate before truncate on public.commissions
  for each statement execute function public.financial_no_truncate();

-- ---------------------------------------------------------------------------------------------
-- The engine step (private): record the commission for ONE plan payment
-- ---------------------------------------------------------------------------------------------
create or replace function public._record_referral_commission(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.plan_payments%rowtype;
  v_agent_id uuid;
  v_agent_status text;
  v_type text;
  v_rate numeric;
  v_amount numeric;
  v_id uuid;
begin
  select * into p from public.plan_payments where id = p_payment_id;
  if not found then
    return jsonb_build_object('commission', null, 'reason', 'payment_missing');
  end if;
  if p.status is distinct from 'success' or p.naira_amount is null or p.naira_amount <= 0 then
    return jsonb_build_object('commission', null, 'reason', 'payment_not_commissionable');
  end if;

  select referring_agent_id into v_agent_id from public.businesses where id = p.business_id;
  if v_agent_id is null then
    return jsonb_build_object('commission', null, 'reason', 'no_referring_agent');
  end if;

  select status into v_agent_status from public.agents where id = v_agent_id;
  if not found then
    insert into public.commission_review_flags (payment_id, reason) values (p.id, 'no_agent_for_attribution')
      on conflict (payment_id, reason) do nothing;
    return jsonb_build_object('commission', null, 'reason', 'no_agent_for_attribution', 'flagged', true);
  end if;

  if v_agent_status <> 'active' and public._fin_cfg('referral_accrue_while_inactive') <> 1 then
    insert into public.commission_review_flags (payment_id, reason) values (p.id, 'agent_' || v_agent_status)
      on conflict (payment_id, reason) do nothing;
    return jsonb_build_object('commission', null, 'reason', 'agent_' || v_agent_status, 'flagged', true);
  end if;

  v_type := case when p.is_first_payment then 'referral_bonus' else 'residual' end;
  v_rate := public._fin_cfg(case when p.is_first_payment then 'referral_first_payment_rate' else 'referral_residual_rate' end);
  v_amount := round(p.naira_amount * v_rate, 2);

  insert into public.commissions (agent_id, business_id, payment_id, type, base_amount, rate, amount, status)
  values (v_agent_id, p.business_id, p.id, v_type, p.naira_amount, v_rate, v_amount, 'accrued')
  on conflict (payment_id) do nothing
  returning id into v_id;

  return jsonb_build_object('commission', v_id, 'type', v_type, 'rate', v_rate, 'base_amount', p.naira_amount, 'amount', v_amount);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- renew_business_plan: atomic first-payment determination + the commission, one transaction
-- (same signature and grants; every plan payment path goes through here)
-- ---------------------------------------------------------------------------------------------
create or replace function public.renew_business_plan(p_business_id uuid, p_months integer, p_naira_amount integer, p_reference text)
returns table (already_processed boolean, payment_id uuid, new_expiry timestamptz, is_first_payment boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count bigint;
  v_base timestamptz;
  v_new_expiry timestamptz;
  v_payment_id uuid;
begin
  -- Serialise every payment of THIS business before deciding anything. Counting first and locking later
  -- let two simultaneous first payments both see zero earlier payments.
  select plan_expires_at into v_base from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'unknown business %', p_business_id using errcode = 'P0002';
  end if;

  select count(*) into v_count from public.plan_payments where business_id = p_business_id;

  insert into public.plan_payments (business_id, months, naira_amount, reference, status, is_first_payment)
  values (p_business_id, p_months, p_naira_amount, p_reference, 'success', v_count = 0)
  on conflict (reference) do nothing
  returning id into v_payment_id;

  if v_payment_id is null then
    return query select true, null::uuid, null::timestamptz, false;
    return;
  end if;

  if v_base is null or v_base < now() then
    v_base := now();
  end if;
  v_new_expiry := v_base + make_interval(months => p_months);
  update public.businesses set plan_expires_at = v_new_expiry where id = p_business_id;

  -- The referral commission (or its review flag) is part of the same unit.
  perform public._record_referral_commission(v_payment_id);

  return query select false, v_payment_id, v_new_expiry, v_count = 0;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Status changes (platform admin / the server), along the guarded path only
-- ---------------------------------------------------------------------------------------------
create or replace function public.set_commission_status(p_commission_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.commissions set status = p_status where id = p_commission_id;
  if not found then return 'not_found'; end if;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reconciliation and repair (service_role)
-- ---------------------------------------------------------------------------------------------
create or replace function public.reconcile_commissions()
returns table (kind text, payment_id uuid, business_id uuid, agent_id uuid, detail text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- a successful plan payment of an attributed business with neither a commission nor a review flag
  select 'missing_commission'::text, pp.id, pp.business_id, b.referring_agent_id, 'no commission and no review flag'::text
    from public.plan_payments pp
    join public.businesses b on b.id = pp.business_id
    join public.agents a on a.id = b.referring_agent_id
   where pp.status = 'success' and pp.naira_amount > 0
     and (a.status = 'active' or public._fin_cfg('referral_accrue_while_inactive') = 1)
     and not exists (select 1 from public.commissions c where c.payment_id = pp.id)
     and not exists (select 1 from public.commission_review_flags f where f.payment_id = pp.id)
  union all
  -- the commission's type does not match whether its payment was the business's first
  select 'wrong_type', c.payment_id, c.business_id, c.agent_id, c.type || ' on a ' || case when pp.is_first_payment then 'first' else 'later' end || ' payment'
    from public.commissions c join public.plan_payments pp on pp.id = c.payment_id
   where c.type <> case when pp.is_first_payment then 'referral_bonus' else 'residual' end
  union all
  -- the rate is not the configured rate for its type
  select 'wrong_rate', c.payment_id, c.business_id, c.agent_id, 'rate ' || c.rate || ' for ' || c.type
    from public.commissions c
   where c.rate <> public._fin_cfg(case when c.type = 'referral_bonus' then 'referral_first_payment_rate' else 'referral_residual_rate' end)
  union all
  -- the base is not what the payment actually was
  select 'wrong_base', c.payment_id, c.business_id, c.agent_id, 'base ' || c.base_amount || ' vs payment ' || pp.naira_amount
    from public.commissions c join public.plan_payments pp on pp.id = c.payment_id
   where c.base_amount <> pp.naira_amount
  union all
  -- the commission belongs to an agent other than the business's referring agent
  select 'wrong_agent', c.payment_id, c.business_id, c.agent_id, 'business is attributed to ' || coalesce(b.referring_agent_id::text, 'nobody')
    from public.commissions c join public.businesses b on b.id = c.business_id
   where b.referring_agent_id is distinct from c.agent_id
  union all
  -- a business with payments but not exactly one first payment. ("Earliest by created_at" is deliberately NOT checked:
  -- created_at is the transaction START time, and the first payment is whichever transaction took the business lock
  -- first, so under concurrency the two legitimately differ.)
  select 'first_payment_integrity', null::uuid, x.business_id, null::uuid, x.detail
    from (
      select pp.business_id,
             case when count(*) filter (where pp.is_first_payment) = 0 then 'payments exist but none is flagged first'
                  when count(*) filter (where pp.is_first_payment) > 1 then 'more than one payment is flagged first'
             end detail
        from public.plan_payments pp where pp.status = 'success' group by pp.business_id
    ) x where x.detail is not null
  union all
  -- the same payment paid by BOTH the referral program and the tier program (agent_earnings)
  select 'double_program', c.payment_id, c.business_id, c.agent_id, 'agent_earnings also carries reference ' || pp.reference
    from public.commissions c
    join public.plan_payments pp on pp.id = c.payment_id
    join public.agent_earnings e on e.payment_reference = pp.reference and e.agent_id = c.agent_id
$$;

-- Create the commission (or flag) for payments that predate the engine. Oldest first, no caps that can
-- starve newer payments: a payment leaves the candidate set the moment it has a commission or a flag.
create or replace function public.backfill_missing_commissions(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_created integer := 0;
  v_res jsonb;
begin
  for r in
    select m.payment_id from public.reconcile_commissions() m
     where m.kind = 'missing_commission'
     order by (select created_at from public.plan_payments where id = m.payment_id), m.payment_id
     limit greatest(coalesce(p_limit, 500), 1)
  loop
    -- serialise with any concurrent settlement of the same business
    perform 1 from public.businesses b join public.plan_payments pp on pp.business_id = b.id where pp.id = r.payment_id for update of b;
    v_res := public._record_referral_commission(r.payment_id);
    if v_res ->> 'commission' is not null then v_created := v_created + 1; end if;
  end loop;
  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Write access: nothing but the engine writes commissions or their review flags
-- ---------------------------------------------------------------------------------------------
do $$
declare t text; pol record;
begin
  foreach t in array array['commissions', 'commission_review_flags'] loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT' loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated, service_role', t);
  end loop;
end $$;
-- Admin keeps READ access to the review flags (the policy above was ALL; restore its read side).
create policy "commission_review_flags admin read" on public.commission_review_flags
  for select using (public.is_platform_admin());

-- ---------------------------------------------------------------------------------------------
-- Access + assertions
-- ---------------------------------------------------------------------------------------------
revoke all on function public.commissions_guard() from public, anon, authenticated, service_role;
revoke all on function public._record_referral_commission(uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_commission_status(uuid, text) from public, anon;
grant execute on function public.set_commission_status(uuid, text) to authenticated, service_role;
revoke all on function public.reconcile_commissions() from public, anon, authenticated;
grant execute on function public.reconcile_commissions() to service_role;
revoke all on function public.backfill_missing_commissions(integer) from public, anon, authenticated;
grant execute on function public.backfill_missing_commissions(integer) to service_role;

do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('commissions_guard', '_record_referral_commission', 'set_commission_status', 'reconcile_commissions', 'backfill_missing_commissions', 'renew_business_plan')
     and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'anon can execute: %', bad; end if;

  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('commissions_guard', '_record_referral_commission')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'));
  if bad is not null then raise exception 'engine internals must be private: %', bad; end if;

  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('reconcile_commissions', 'backfill_missing_commissions', 'renew_business_plan')
     and has_function_privilege('authenticated', p.oid, 'execute');
  if bad is not null then raise exception 'authenticated can execute: %', bad; end if;

  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'renew_business_plan') <> 1 then
    raise exception 'expected exactly one renew_business_plan';
  end if;

  select string_agg(table_name || ':' || grantee || ':' || privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('commissions', 'commission_review_flags')
     and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC') and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  if bad is not null then raise exception 'write grants remain: %', bad; end if;

  if exists (select 1 from public.reconcile_commissions()) then
    raise exception 'commissions do not reconcile; resolve before applying';
  end if;
end $$;
