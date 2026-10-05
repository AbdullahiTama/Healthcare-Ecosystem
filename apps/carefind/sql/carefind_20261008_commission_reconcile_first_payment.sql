-- Phase 07 follow-up: reconcile_commissions() must not flag a business whose flagged first payment is not the one
-- with the earliest created_at. created_at is the transaction START time while "first" is decided by whichever
-- transaction takes the business row lock first, so under concurrent payments they legitimately differ (found by the
-- real-Postgres suite; a false alarm, no money was affected). Same signature and grants (CREATE OR REPLACE keeps the ACL).

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

do $$
begin
  if has_function_privilege('anon', 'public.reconcile_commissions()', 'execute')
     or has_function_privilege('authenticated', 'public.reconcile_commissions()', 'execute') then
    raise exception 'reconcile_commissions must stay service_role only';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'reconcile_commissions') <> 1 then
    raise exception 'expected exactly one reconcile_commissions';
  end if;
end $$;
