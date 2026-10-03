-- Financial program, Phase 04: the settlement engine for CareFind card payments.
--
-- ONE function, settle_payment_intent(), is the only way a verified gateway payment becomes money
-- movement. The redirect handler, the webhook and (later) reconciliation all call it, so there is a
-- single definition of settlement. Node has already asked the provider about the reference; this
-- function is handed only the provider's verified facts and decides, inside one transaction:
--   * identity   - the reference must belong to an intent that exists
--   * provider / currency / amount - must equal what the intent expected, exactly
--   * idempotency - a settled intent returns 'already_settled' and moves nothing
--   * purpose    - dispatches to a private handler that moves the money
-- A payment that cannot be applied (amount mismatch, already booked, already paid ...) is never
-- dropped: the intent becomes 'needs_refund' with the reason, so a refund can be raised (Phase 09).
--
-- Handlers validate BEFORE they write, because a 'needs_refund' outcome commits: nothing may be
-- half-written when a handler declines.
--
-- Commercial rule change (owner decision 2026-10-03): card subscriptions and consultations carry a
-- 20% platform fee, like bookings. Coins are whole numbers, so the creator/professional share is
-- rounded DOWN and the remainder stays with the platform. Bookings are settled in kobo from the
-- ACTUAL amount paid (no rounding to a coin boundary).

insert into public.financial_config (key, value, unit, description) values
  ('subscription_platform_rate', 0.20, 'ratio', 'Platform share of a card creator subscription (owner decision 2026-10-03)'),
  ('consultation_platform_rate', 0.20, 'ratio', 'Platform share of a card professional consultation (owner decision 2026-10-03)')
on conflict (key) do nothing;

create or replace function public._fin_cfg(p_key text)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v numeric;
begin
  select value into v from public.financial_config where key = p_key;
  if v is null then raise exception 'financial_config key % is missing', p_key; end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Purpose handlers. Each returns {"ok": true, ...data} or {"ok": false, "reason": "..."}.
-- ---------------------------------------------------------------------------------------------

create or replace function public._settle_wallet_topup(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_coins integer;
  v_balance numeric;
begin
  begin
    v_coins := (i.metadata ->> 'coins')::integer;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'invalid_topup_intent');
  end;
  if i.customer_id is null or v_coins is null or v_coins <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_topup_intent');
  end if;

  -- Claim the reference first: the ledger row and the credit are one unit.
  insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
  values (i.customer_id, 'topup', v_coins, (i.expected_amount / 100)::integer, i.reference, 'success')
  on conflict (reference) where type = 'topup' do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'reference_already_used');
  end if;

  insert into public.wallets (user_id, balance) values (i.customer_id, v_coins)
  on conflict (user_id) do update set balance = public.wallets.balance + v_coins
  returning balance into v_balance;

  return jsonb_build_object('ok', true, 'coins', v_coins, 'new_balance', v_balance);
end;
$$;

create or replace function public._settle_creator_subscription(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_coins integer;
  v_rate numeric := public._fin_cfg('subscription_platform_rate');
  v_coin_kobo numeric := public._fin_cfg('coin_value_kobo');
  v_creator_coins integer;
  v_platform_coins integer;
begin
  begin
    v_coins := (i.metadata ->> 'coins')::integer;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'invalid_subscription_intent');
  end;
  if i.entity_type is distinct from 'creator' or i.entity_id is null or i.customer_id is null or v_coins is null or v_coins <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_subscription_intent');
  end if;
  if i.entity_id = i.customer_id then
    return jsonb_build_object('ok', false, 'reason', 'self_subscription');
  end if;
  -- The price the customer was asked for must be exactly what the coins are worth.
  if i.expected_amount <> v_coins * v_coin_kobo then
    return jsonb_build_object('ok', false, 'reason', 'price_mismatch');
  end if;
  if not exists (select 1 from public.profiles where id = i.entity_id) then
    return jsonb_build_object('ok', false, 'reason', 'creator_missing');
  end if;

  v_creator_coins := floor(v_coins * (1 - v_rate))::integer;
  v_platform_coins := v_coins - v_creator_coins;

  -- Claim the reference first.
  insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
  values (i.customer_id, 'subscription_payment', v_coins, (i.expected_amount / 100)::integer, i.reference, 'success')
  on conflict (reference) where type = 'subscription_payment' do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'reference_already_used');
  end if;

  -- The card payment IS the settlement: the subscriber's CareCoin wallet is not touched.
  if v_creator_coins > 0 then
    insert into public.wallets (user_id, balance) values (i.entity_id, v_creator_coins)
    on conflict (user_id) do update set balance = public.wallets.balance + v_creator_coins;
    insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
    values (i.entity_id, 'subscription_earning', v_creator_coins, null, i.reference, 'success');
  end if;
  if v_platform_coins > 0 then
    insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
    values (null, 'platform_fee_subscription', v_platform_coins, null, i.reference, 'success');
  end if;

  -- Extend from the row's CURRENT expiry as seen under the row lock (ON CONFLICT re-reads the locked
  -- row). Reading it beforehand lost concurrent renewals: six simultaneous payments granted one month
  -- (found by settlementConcurrency.pg.test.js).
  insert into public.creator_subscriptions (subscriber_id, creator_id, price, expires_at, auto_renew)
  values (i.customer_id, i.entity_id, v_coins, now() + interval '30 days', true)
  on conflict (subscriber_id, creator_id) do update
    set expires_at = greatest(public.creator_subscriptions.expires_at, now()) + interval '30 days',
        price = v_coins,
        auto_renew = true;

  return jsonb_build_object('ok', true, 'coins', v_coins, 'creator_coins', v_creator_coins, 'platform_coins', v_platform_coins);
end;
$$;

create or replace function public._settle_consultation(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rate numeric := public._fin_cfg('consultation_platform_rate');
  v_coin_kobo numeric := public._fin_cfg('coin_value_kobo');
  v_type text;
  v_notes text;
  v_professional_coins integer;
begin
  if i.entity_type is distinct from 'professional' or i.entity_id is null or i.customer_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_consultation_intent');
  end if;
  if i.entity_id = i.customer_id then
    return jsonb_build_object('ok', false, 'reason', 'self_consultation');
  end if;
  if not exists (select 1 from public.profiles where id = i.entity_id) then
    return jsonb_build_object('ok', false, 'reason', 'professional_missing');
  end if;

  select type, notes into v_type, v_notes from public.professional_consultations
   where professional_id = i.entity_id and status = 'setup' limit 1;

  -- The paid booking is the claim: one per (professional, patient). A patient who already booked
  -- (by wallet or card) is NOT booked or credited again; the card payment goes to needs_refund.
  insert into public.professional_consultations (professional_id, patient_id, type, fee, notes, status)
  values (i.entity_id, i.customer_id, coalesce(v_type, 'text'), i.expected_amount / 100.0, v_notes, 'paid')
  on conflict (professional_id, patient_id) where status = 'paid' do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already_booked');
  end if;

  v_professional_coins := floor(i.expected_amount * (1 - v_rate) / v_coin_kobo)::integer;

  -- Patient side of the ledger. This is a CARD payment: the patient's CareCoin wallet is never debited.
  insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
  values (i.customer_id, 'consultation_payment', ceil(i.expected_amount / v_coin_kobo)::integer, (i.expected_amount / 100)::integer, i.reference, 'success')
  on conflict (reference) where type = 'consultation_payment' do nothing;

  if v_professional_coins > 0 then
    insert into public.wallets (user_id, balance) values (i.entity_id, v_professional_coins)
    on conflict (user_id) do update set balance = public.wallets.balance + v_professional_coins;
    insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
    values (i.entity_id, 'consultation_earnings', v_professional_coins, (i.expected_amount / 100)::integer, i.reference, 'success');
  end if;

  return jsonb_build_object('ok', true, 'professional_coins', v_professional_coins);
end;
$$;

create or replace function public._settle_booking(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rate numeric := public._fin_cfg('booking_platform_rate');
  a public.appointments%rowtype;
  v_platform_kobo integer;
begin
  if i.entity_type is distinct from 'appointment' or i.entity_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_booking_intent');
  end if;

  select * into a from public.appointments where id = i.entity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'appointment_missing');
  end if;
  if a.business_id is distinct from i.business_id then
    return jsonb_build_object('ok', false, 'reason', 'business_mismatch');
  end if;
  if a.payment_status in ('paid', 'refunded') then
    return jsonb_build_object('ok', false, 'reason', 'already_paid');
  end if;
  if a.fee_amount is null or a.fee_amount <> i.expected_amount then
    return jsonb_build_object('ok', false, 'reason', 'fee_changed');
  end if;

  -- Settled in kobo from the amount ACTUALLY paid. No rounding to a CareCoin boundary (F-06).
  v_platform_kobo := round(a.fee_amount * v_rate)::integer;
  perform public.fn_credit_business_booking(a.business_id, a.id, a.fee_amount, v_platform_kobo, i.reference);

  update public.appointments
     set payment_status = 'paid', payment_channel = 'card', payment_reference = coalesce(payment_reference, i.reference), refunded_at = null
   where id = a.id;

  return jsonb_build_object('ok', true, 'appointment_id', a.id, 'business_kobo', a.fee_amount - v_platform_kobo, 'platform_kobo', v_platform_kobo);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The engine
-- ---------------------------------------------------------------------------------------------

create or replace function public.settle_payment_intent(
  p_reference text,
  p_provider text,
  p_provider_txn_id text,
  p_amount_kobo bigint,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.payment_intents%rowtype;
  v_fail text;
  v_res jsonb;
begin
  select * into i from public.payment_intents where reference = p_reference for update;
  if not found then
    return jsonb_build_object('outcome', 'unknown_reference');
  end if;

  if i.status in ('settled', 'refunded') then
    return jsonb_build_object('outcome', 'already_settled', 'intent_id', i.id, 'purpose', i.purpose, 'status', i.status);
  end if;
  if i.status = 'needs_refund' then
    return jsonb_build_object('outcome', 'needs_refund', 'intent_id', i.id, 'purpose', i.purpose, 'reason', i.metadata ->> 'refund_reason');
  end if;

  if p_provider_txn_id is null or btrim(p_provider_txn_id) = '' then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'missing_transaction_id', 'intent_id', i.id);
  end if;
  if i.provider_transaction_id is not null and i.provider_transaction_id <> p_provider_txn_id then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'transaction_id_conflict', 'intent_id', i.id);
  end if;

  v_fail := case
    when p_provider is distinct from i.provider then 'provider_mismatch'
    when p_currency is distinct from i.currency then 'currency_mismatch'
    when p_amount_kobo is distinct from i.expected_amount then 'amount_mismatch'
    else null
  end;

  -- The money is real (the provider said so) regardless of what we do with it next.
  update public.payment_intents
     set status = 'verified', provider_transaction_id = p_provider_txn_id
   where id = i.id;

  if v_fail is null then
    v_res := case i.purpose
      when 'wallet_topup'         then public._settle_wallet_topup(i)
      when 'creator_subscription' then public._settle_creator_subscription(i)
      when 'consultation'         then public._settle_consultation(i)
      when 'booking'              then public._settle_booking(i)
      else null
    end;
    if v_res is null then
      -- Raising rolls the 'verified' flip back: an unsupported purpose must never look handled.
      raise exception 'purpose % is not settled by the engine yet', i.purpose using errcode = '0A000';
    end if;
    if coalesce((v_res ->> 'ok')::boolean, false) is not true then
      v_fail := coalesce(v_res ->> 'reason', 'handler_declined');
    end if;
  end if;

  if v_fail is not null then
    update public.payment_intents
       set status = 'needs_refund',
           metadata = metadata || jsonb_build_object('refund_reason', v_fail, 'paid_amount_kobo', p_amount_kobo, 'paid_currency', p_currency)
     where id = i.id;
    return jsonb_build_object('outcome', 'needs_refund', 'intent_id', i.id, 'purpose', i.purpose, 'reason', v_fail);
  end if;

  update public.payment_intents set status = 'settled' where id = i.id;
  return jsonb_build_object('outcome', 'settled', 'intent_id', i.id, 'purpose', i.purpose) || (v_res - 'ok');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Access. Supabase's default privileges re-grant EXECUTE to anon/authenticated at creation, so the
-- revokes are explicit and asserted below. Only the engine entry point is callable (service_role);
-- helpers and handlers are reachable only through it.
-- ---------------------------------------------------------------------------------------------
revoke all on function public._fin_cfg(text) from public, anon, authenticated, service_role;
revoke all on function public._settle_wallet_topup(public.payment_intents) from public, anon, authenticated, service_role;
revoke all on function public._settle_creator_subscription(public.payment_intents) from public, anon, authenticated, service_role;
revoke all on function public._settle_consultation(public.payment_intents) from public, anon, authenticated, service_role;
revoke all on function public._settle_booking(public.payment_intents) from public, anon, authenticated, service_role;
revoke all on function public.settle_payment_intent(text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.settle_payment_intent(text, text, text, bigint, text) to service_role;

do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('_fin_cfg', '_settle_wallet_topup', '_settle_creator_subscription', '_settle_consultation', '_settle_booking', 'settle_payment_intent')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if bad is not null then raise exception 'client roles can execute: %', bad; end if;

  select string_agg(p.proname, ', ') into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('_fin_cfg', '_settle_wallet_topup', '_settle_creator_subscription', '_settle_consultation', '_settle_booking')
     and has_function_privilege('service_role', p.oid, 'execute');
  if bad is not null then raise exception 'private helpers executable by service_role: %', bad; end if;

  if not exists (select 1 from pg_proc p where p.proname = 'settle_payment_intent' and has_function_privilege('service_role', p.oid, 'execute')) then
    raise exception 'service_role cannot execute settle_payment_intent';
  end if;
end $$;
