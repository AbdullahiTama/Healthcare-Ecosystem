-- Phase 12: resilience and hot paths (measured on a real Postgres loaded with 30,000-100,000 settled payments).
--
-- 1. Timeouts on the engine entry points. Nothing bounded how long an engine function could WAIT for a row lock or RUN: a connection
--    that hung while holding a wallet row would block every settlement for that vendor, and every caller's HTTP request, until
--    somebody noticed. Each entry point now gives up waiting for a lock after 10 s (55P03) and a single statement after 30 s (57014);
--    both are infrastructure errors the Node side retries (rpcWithRetry), and the engine's transaction has rolled back, so a retry is
--    safe. Reconciliation may run longer (120 s). The settings live in proconfig, and CREATE OR REPLACE FUNCTION REPLACES proconfig:
--    a later migration that redefines one of these functions must call public._apply_engine_timeouts() again (the test suite checks).
-- 2. reconcile_shop_vendor_credits() evaluated _fin_cfg() (a table lookup) for EVERY paid order, twice: 4 s at 12,000 orders, 7 s at
--    40,000. The cutoff is now computed once.
-- 3. One vendor's burst: 20 simultaneous payments for ONE vendor ran at 27/s but with a p95 of 5 s (a different vendor each: 187/s,
--    p95 220 ms). Two causes, both fixed: (a) _settle_shop_order took the vendor's wallet row lock in the MIDDLE of the transaction and
--    held it through the rest of the work: the wallet row is now touched last; (b) the credit was an INSERT ... ON CONFLICT DO UPDATE.
--    Waiters on a conflicting insert all sleep on the holder's transaction and, when it commits, wake TOGETHER and race again, so a
--    few of them lose again and again (a 5-7 second tail while the median was 20 ms): it is not a queue. A plain UPDATE of an existing
--    row waits in the row's lock queue, which IS first-come-first-served. The credit is now UPDATE first, INSERT ... ON CONFLICT only
--    for a vendor's very first order. fn_credit_business_booking (the booking credit) had the same shape and one more defect: it
--    credited the wallet BEFORE its ledger insert and ignored a duplicate ledger row, so calling it twice for one reference would have
--    credited twice (the engine's one-settlement-per-intent rule is what prevented that). It now writes the ledger first and credits
--    the wallet only when the ledger row is new.

do $$
begin
  if to_regprocedure('public._settle_shop_order(public.payment_intents)') is null then raise exception 'apply carefind_20261012_shop_vendor_payouts first'; end if;
  if to_regprocedure('public.run_db_reconciliation(boolean)') is null then raise exception 'apply carefind_20261016_reconciliation_scale first'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. reconcile_shop_vendor_credits: the cutoff once, not per order
-- ---------------------------------------------------------------------------------------------
create or replace function public.reconcile_shop_vendor_credits()
returns table (kind text, order_id uuid, detail text)
language sql
security definer
set search_path = public, pg_temp
as $$
  with cut as (select to_timestamp(public._fin_cfg('shop_vendor_cutover_epoch')) as t)
  -- paid before credits existed: the previous flow did not verify the payment with the provider; a human decides
  select 'legacy_paid_order_without_credit', o.id, 'order ' || o.order_ref || ' paid ' || o.updated_at::date || ', vendor share ' || (o.subtotal_kobo - o.commission_kobo) || ' kobo'
    from public.shop_orders o, cut
   where o.payment_status = 'paid' and o.status not in ('cancelled', 'refunded')
     and not exists (select 1 from public.shop_vendor_credits c where c.order_id = o.id)
     and o.updated_at < cut.t
  union all
  select 'paid_order_without_credit', o.id, 'order ' || o.order_ref || ' paid after vendor credits went live but has no credit'
    from public.shop_orders o, cut
   where o.payment_status = 'paid' and o.status not in ('cancelled', 'refunded')
     and not exists (select 1 from public.shop_vendor_credits c where c.order_id = o.id)
     and o.updated_at >= cut.t
  union all
  select 'credit_amount_mismatch', c.order_id, 'credit ' || c.amount_kobo || ' <> subtotal - commission ' || (o.subtotal_kobo - o.commission_kobo)
    from public.shop_vendor_credits c join public.shop_orders o on o.id = c.order_id
   where c.amount_kobo <> o.subtotal_kobo - o.commission_kobo
  union all
  select 'credit_without_ledger_row', c.order_id, 'no shop_credit ledger row'
    from public.shop_vendor_credits c
   where not exists (select 1 from public.business_wallet_transactions t where t.type = 'shop_credit' and t.reference = 'shopcr_' || c.order_id)
  union all
  select 'released_without_ledger_row', c.order_id, 'released credit has no shop_release ledger row'
    from public.shop_vendor_credits c
   where c.status = 'released' and c.released_kobo > 0
     and not exists (select 1 from public.business_wallet_transactions t where t.type = 'shop_release' and t.reference = 'shoprl_' || c.order_id)
  union all
  select 'release_shortfall', c.order_id, 'released ' || c.released_kobo || ' of ' || (c.amount_kobo - c.reversed_kobo) || ' kobo: the held balance was already lower'
    from public.shop_vendor_credits c where c.release_shortfall_kobo > 0
  union all
  select 'refund_shortfall', f.entity_id, 'refund ' || f.reference || ' recovered ' || (f.business_recovered_held_kobo + f.business_recovered_available_kobo) || ' kobo, vendor owes ' || f.business_shortfall_kobo
    from public.refunds f where f.entity_type = 'shop_order' and f.business_shortfall_kobo > 0 and f.status <> 'failed'
  union all
  select 'approved_return_without_refund', r.order_id, 'return ' || r.id || ' approved but no live refund'
    from public.shop_order_returns r
   where r.status = 'approved'
     and not exists (select 1 from public.refunds f where f.entity_type = 'shop_order' and f.entity_id = r.order_id and f.status <> 'failed')
  union all
  select 'held_below_open_credits', c.business_id, 'wallet held ' || coalesce(w.held_balance, 0) || ' < unreleased shop credits ' || sum(c.amount_kobo - c.reversed_kobo)
    from public.shop_vendor_credits c left join public.business_wallets w on w.business_id = c.business_id
   where c.status = 'held'
   group by c.business_id, w.held_balance
  having coalesce(w.held_balance, 0) < sum(c.amount_kobo - c.reversed_kobo);
$$;
revoke all on function public.reconcile_shop_vendor_credits() from public, anon, authenticated, service_role;
grant execute on function public.reconcile_shop_vendor_credits() to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. _settle_shop_order: the vendor's wallet row is touched LAST
-- ---------------------------------------------------------------------------------------------
create or replace function public._settle_shop_order(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.shop_orders%rowtype;
  v_credit integer;
begin
  if i.entity_type is distinct from 'shop_order' or i.entity_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_shop_intent');
  end if;

  select * into o from public.shop_orders where id = i.entity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_missing');
  end if;
  if o.customer_id is distinct from i.customer_id then
    return jsonb_build_object('ok', false, 'reason', 'customer_mismatch');
  end if;
  if o.vendor_business_id is distinct from i.business_id then
    return jsonb_build_object('ok', false, 'reason', 'business_mismatch');
  end if;
  if o.payment_status = 'paid' or o.status = 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'already_paid');
  end if;
  if o.status not in ('pending_payment', 'delivery_quote_pending') then
    return jsonb_build_object('ok', false, 'reason', 'order_not_payable');
  end if;
  if o.total_kobo is distinct from i.expected_amount then
    return jsonb_build_object('ok', false, 'reason', 'amount_changed');
  end if;
  v_credit := o.subtotal_kobo - o.commission_kobo;
  if v_credit <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_vendor_share');
  end if;

  update public.shop_orders
     set payment_status = 'paid', status = 'paid', paystack_reference = i.reference, updated_at = now()
   where id = o.id;

  -- the payment-attempt ledger: this attempt succeeded, every other open attempt of the order is closed
  insert into public.shop_payments (order_id, payment_reference, amount_kobo, status, gateway, gateway_response)
  values (o.id, i.reference, i.expected_amount, 'success', i.provider, jsonb_build_object('intent_id', i.id, 'provider_transaction_id', i.provider_transaction_id))
  on conflict (payment_reference) do update
    set status = 'success', gateway_response = excluded.gateway_response, updated_at = now();
  update public.shop_payments set status = 'failed', updated_at = now()
   where order_id = o.id and status = 'pending' and payment_reference <> i.reference;

  -- the vendor's share, held until delivery + the return window (one credit per order, so a replay cannot pay twice)
  insert into public.shop_vendor_credits (order_id, business_id, amount_kobo, commission_kobo)
  values (o.id, o.vendor_business_id, v_credit, o.commission_kobo);
  insert into public.business_wallet_transactions (business_id, type, amount, reference, status)
  values (o.vendor_business_id, 'shop_credit', v_credit, 'shopcr_' || o.id, 'confirmed');

  insert into public.shop_order_status_history (order_id, from_status, to_status, changed_by, note)
  values (o.id, o.status, 'paid', null, 'Payment verified ' || i.reference);

  insert into public.notifications (recipient_id, type, message, link)
  values (o.customer_id, 'shop_payment', 'Payment confirmed for order ' || o.order_ref, '/orders/' || o.id::text);

  -- LAST: the one row every order of this vendor shares. Everything above is private to this order, so the wallet row is locked only
  -- for the instant before commit (a burst of orders for one vendor queues behind commits, not behind whole transactions).
  update public.business_wallets set held_balance = held_balance + v_credit, updated_at = now() where business_id = o.vendor_business_id;
  if not found then
    insert into public.business_wallets (business_id, held_balance, available_balance)
    values (o.vendor_business_id, v_credit, 0)
    on conflict (business_id) do update set held_balance = public.business_wallets.held_balance + v_credit, updated_at = now();
  end if;

  return jsonb_build_object('ok', true, 'order_id', o.id, 'order_ref', o.order_ref, 'vendor_business_id', o.vendor_business_id, 'total_kobo', o.total_kobo, 'vendor_credit_kobo', v_credit);
end;
$$;
revoke all on function public._settle_shop_order(public.payment_intents) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 3b. The booking credit: ledger first, wallet last and only for a new ledger row; a plain UPDATE of an existing wallet row
-- ---------------------------------------------------------------------------------------------
create or replace function public.fn_credit_business_booking(p_business_id uuid, p_appointment_id uuid, p_rounded_kobo integer, p_platform_kobo integer, p_reference text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_kobo integer := p_rounded_kobo - p_platform_kobo;
  v_new integer;
begin
  insert into business_wallet_transactions (business_id, appointment_id, type, amount, reference) values (p_business_id, p_appointment_id, 'booking_credit', v_business_kobo, p_reference)
  on conflict (reference) where type = 'booking_credit' do nothing;
  get diagnostics v_new = row_count;
  insert into platform_transactions (appointment_id, business_id, type, amount, reference) values (p_appointment_id, p_business_id, 'commission', p_platform_kobo, p_reference)
  on conflict (reference) where type = 'commission' do nothing;
  if v_new > 0 then
    update business_wallets set held_balance = held_balance + v_business_kobo, updated_at = now() where business_id = p_business_id;
    if not found then
      insert into business_wallets (business_id, held_balance) values (p_business_id, v_business_kobo)
      on conflict (business_id) do update set held_balance = business_wallets.held_balance + excluded.held_balance, updated_at = now();
    end if;
  end if;
end;
$$;
revoke all on function public.fn_credit_business_booking(uuid, uuid, integer, integer, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 1. Timeouts on the engine entry points (idempotent; call again after any migration that redefines one of them)
-- ---------------------------------------------------------------------------------------------
create or replace function public._apply_engine_timeouts()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('settle_payment_intent', 'request_refund', 'settle_refund', 'mark_refund_processing', 'settle_withdrawal', 'settle_business_withdrawal',
                         'create_withdrawal', 'create_business_withdrawal', 'release_shop_vendor_credits', 'sync_reconciliation_findings', 'run_db_reconciliation',
                         '_settle_wallet_topup', '_settle_creator_subscription', '_settle_consultation', '_settle_booking', '_settle_plan_renewal', '_settle_shop_order',
                         '_post_coin_entry', '_post_coin_transfer', '_post_coin_split')
  loop
    if r.proname in ('run_db_reconciliation', 'sync_reconciliation_findings') then
      execute format('alter function %s set lock_timeout = %L set statement_timeout = %L', r.sig, '10s', '120s');
    else
      execute format('alter function %s set lock_timeout = %L set statement_timeout = %L', r.sig, '10s', '30s');
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public._apply_engine_timeouts() from public, anon, authenticated, service_role;

select public._apply_engine_timeouts();

do $$
declare v_n integer; v_missing text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_missing
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('settle_payment_intent', 'request_refund', 'settle_refund', 'release_shop_vendor_credits', 'run_db_reconciliation', '_settle_shop_order')
     and not (coalesce(p.proconfig, '{}') @> array['lock_timeout=10s']);
  if v_missing is not null then raise exception 'engine timeouts missing on %', v_missing; end if;
  select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('_apply_engine_timeouts')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'));
  if v_n > 0 then raise exception '_apply_engine_timeouts must be private'; end if;
end $$;
