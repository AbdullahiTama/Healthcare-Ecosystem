-- Owner decision (Q1, 2026-10-04): the 20% platform fee applies to CareCoin-paid creator subscriptions and
-- professional consultations too, matching the card paths (Phase 04). Until now the coin paths credited the
-- creator/professional 100%.
--
-- The payer is debited the FULL price. The creator/professional is credited floor(price x (1 - rate)) whole
-- coins; the remainder is the platform's and is recorded as a `platform_fee_*` row in `transactions`
-- (user_id NULL), exactly like the card paths. Rates come from financial_config
-- (subscription_platform_rate / consultation_platform_rate, both 0.20), not from literals. A 1-coin
-- subscription therefore pays the creator nothing and the platform keeps the coin (same as card).
--
--   * _post_coin_split()   new posting primitive: lock both wallets in the fixed order, debit the total from
--                          the payer, credit only the share to the payee, atomically.
--   * pay_creator_subscription, pay_professional_consultation   coin-paid purchases
--   * settle_subscription_payment, settle_consultation_payment  legacy card settlement, still called for
--                          payments that started before the settlement engine shipped
-- Everything else in those functions is unchanged (same signatures, return values, checks, grants).

do $$
begin
  if to_regprocedure('public._post_coin_entry(uuid,integer,text,text,uuid,jsonb)') is null then
    raise exception 'apply carefind_20261005_coin_ledger first';
  end if;
  if to_regprocedure('public._fin_cfg(text)') is null then
    raise exception 'apply carefind_20261004_settle_payment_intent first';
  end if;
end $$;

-- Debit p_total from p_from and credit p_to_share to p_to as one unit. p_total - p_to_share stays with the
-- platform (recorded in the debit entry's meta). false = the payer cannot afford p_total (nothing written).
create or replace function public._post_coin_split(
  p_from uuid,
  p_to uuid,
  p_total integer,
  p_to_share integer,
  p_kind_from text,
  p_kind_to text,
  p_reference text,
  p_meta jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_total is null or p_total <= 0 then raise exception 'a coin split must move a positive whole number of coins'; end if;
  if p_to_share is null or p_to_share < 0 or p_to_share > p_total then raise exception 'the payee share must be between 0 and the total'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'a coin split needs two different wallets'; end if;

  -- Same global lock order as _post_coin_transfer: smaller uuid first.
  insert into public.wallets (user_id, balance) values (p_from, 0), (p_to, 0) on conflict (user_id) do nothing;
  perform 1 from public.wallets where user_id = least(p_from, p_to) for update;
  perform 1 from public.wallets where user_id = greatest(p_from, p_to) for update;

  if public._post_coin_entry(p_from, -p_total, p_kind_from, p_reference, p_to,
                             coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('platform_coins', p_total - p_to_share)) is null then
    return false;
  end if;
  if p_to_share > 0 then
    perform public._post_coin_entry(p_to, p_to_share, p_kind_to, p_reference, p_from, p_meta);
  end if;
  return true;
end;
$$;

revoke all on function public._post_coin_split(uuid, uuid, integer, integer, text, text, text, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- CareCoin-paid purchases
-- ---------------------------------------------------------------------------------------------
create or replace function public.pay_creator_subscription(p_creator uuid, p_price integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_subscriber uuid := auth.uid();
  v_listed integer;
  v_rate numeric := public._fin_cfg('subscription_platform_rate');
  v_creator_coins integer;
  v_platform_coins integer;
  v_ref text := 'sub_' || gen_random_uuid()::text;
begin
  if v_subscriber is null then
    return 'not_signed_in';
  end if;
  if p_creator is null or p_price is null or p_price <= 0 then
    return 'invalid_args';
  end if;
  if p_creator = v_subscriber then
    return 'self_subscription';
  end if;

  -- The creator's own listed price is the only price there is.
  select subscription_price into v_listed from public.profiles where id = p_creator;
  if v_listed is null or v_listed <= 0 then
    return 'not_for_sale';
  end if;
  if p_price <> v_listed then
    return 'price_mismatch';
  end if;

  -- The subscriber pays the full price; the creator receives it less the platform fee, rounded down.
  v_creator_coins := floor(v_listed * (1 - v_rate))::integer;
  v_platform_coins := v_listed - v_creator_coins;

  if not public._post_coin_split(v_subscriber, p_creator, v_listed, v_creator_coins, 'subscription_payment', 'subscription_earning', v_ref) then
    return 'insufficient';
  end if;

  insert into public.creator_subscriptions (subscriber_id, creator_id, price, expires_at, auto_renew)
  values (v_subscriber, p_creator, v_listed, now() + interval '30 days', true)
  on conflict (subscriber_id, creator_id) do update
    set expires_at = greatest(public.creator_subscriptions.expires_at, now()) + interval '30 days',
        price = v_listed,
        auto_renew = true;

  insert into public.transactions (user_id, type, amount, reference, status)
  values (v_subscriber, 'subscription', -v_listed, v_ref, 'success');
  if v_creator_coins > 0 then
    insert into public.transactions (user_id, type, amount, reference, status)
    values (p_creator, 'subscription_earning', v_creator_coins, v_ref, 'success');
  end if;
  if v_platform_coins > 0 then
    insert into public.transactions (user_id, type, amount, reference, status)
    values (null, 'platform_fee_subscription', v_platform_coins, v_ref, 'success');
  end if;

  return 'ok';
end;
$function$;

create or replace function public.pay_professional_consultation(p_professional uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_patient uuid := auth.uid();
  v_fee numeric;
  v_type text;
  v_notes text;
  v_coins int;
  v_rate numeric := public._fin_cfg('consultation_platform_rate');
  v_pro_coins int;
  v_platform_coins int;
  v_ref text := 'consult_' || gen_random_uuid()::text;
begin
  if v_patient is null then
    return 'not_signed_in';
  end if;
  if p_professional is null then
    return 'no_professional';
  end if;
  if p_professional = v_patient then
    return 'self_consultation';
  end if;

  -- One subtransaction: if the paid-booking insert collides (unique index) the wallet movement and ledger
  -- rows roll back with it, so a raced double-booking can never move money.
  begin
    if exists (
      select 1 from professional_consultations
       where professional_id = p_professional and patient_id = v_patient and status = 'paid'
    ) then
      return 'already_booked';
    end if;

    select fee, type, notes into v_fee, v_type, v_notes
      from professional_consultations
     where professional_id = p_professional and status = 'setup'
     limit 1;
    if v_fee is null or v_fee <= 0 then
      return 'no_setup';
    end if;

    -- 1 CareCoin = N200; round up so the platform never over-credits. The patient pays all of it; the
    -- professional receives it less the platform fee, rounded down.
    v_coins := ceil(v_fee / 200)::int;
    v_pro_coins := floor(v_coins * (1 - v_rate))::int;
    v_platform_coins := v_coins - v_pro_coins;

    if not public._post_coin_split(v_patient, p_professional, v_coins, v_pro_coins, 'consultation_payment', 'consultation_earning', v_ref) then
      return 'insufficient';
    end if;

    insert into transactions (user_id, type, amount, naira_amount, reference, status)
    values (v_patient, 'consultation_payment', v_coins, v_fee, v_ref, 'success');
    if v_pro_coins > 0 then
      insert into transactions (user_id, type, amount, naira_amount, reference, status)
      values (p_professional, 'consultation_earnings', v_pro_coins, v_fee, v_ref, 'success');
    end if;
    if v_platform_coins > 0 then
      insert into transactions (user_id, type, amount, naira_amount, reference, status)
      values (null, 'platform_fee_consultation', v_platform_coins, null, v_ref, 'success');
    end if;

    insert into professional_consultations (professional_id, patient_id, type, fee, notes, status)
    values (p_professional, v_patient, v_type, v_fee, v_notes, 'paid');

    return 'ok';
  exception
    when unique_violation then
      return 'already_booked';
  end;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Legacy card settlement (payments that started before the settlement engine shipped)
-- ---------------------------------------------------------------------------------------------
create or replace function public.settle_subscription_payment(p_subscriber uuid, p_creator uuid, p_price integer, p_naira_amount integer, p_reference text)
returns table (already_processed boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rate numeric := public._fin_cfg('subscription_platform_rate');
  v_creator_coins integer;
  v_platform_coins integer;
begin
  if p_price is null or p_price <= 0 then
    raise exception 'a subscription must be a positive whole number of coins';
  end if;

  insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
  values (p_subscriber, 'subscription_payment', p_price, p_naira_amount, p_reference, 'success')
  on conflict (reference) where type = 'subscription_payment' do nothing;

  if not found then
    return query select true;
    return;
  end if;

  v_creator_coins := floor(p_price * (1 - v_rate))::integer;
  v_platform_coins := p_price - v_creator_coins;

  -- Card payment IS the settlement: the subscriber's wallet is deliberately NOT debited.
  if v_creator_coins > 0 then
    perform public._post_coin_entry(p_creator, v_creator_coins, 'subscription_earning', p_reference, p_subscriber);
    insert into public.transactions (user_id, type, amount, reference, status)
    values (p_creator, 'subscription_earning', v_creator_coins, p_reference, 'success');
  end if;
  if v_platform_coins > 0 then
    insert into public.transactions (user_id, type, amount, reference, status)
    values (null, 'platform_fee_subscription', v_platform_coins, p_reference, 'success');
  end if;

  insert into public.creator_subscriptions (subscriber_id, creator_id, price, expires_at, auto_renew)
  values (p_subscriber, p_creator, p_price, now() + interval '30 days', true)
  on conflict (subscriber_id, creator_id) do update
    set expires_at = greatest(public.creator_subscriptions.expires_at, now()) + interval '30 days',
        price = p_price,
        auto_renew = true;

  return query select false;
end;
$function$;

create or replace function public.settle_consultation_payment(p_patient uuid, p_professional uuid, p_fee numeric, p_reference text)
returns table (already_processed boolean, already_booked boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_coins integer := ceil(coalesce(p_fee, 0) / 200)::integer;
  v_rate numeric := public._fin_cfg('consultation_platform_rate');
  v_pro_coins integer;
  v_platform_coins integer;
  v_type text;
  v_notes text;
begin
  insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
  values (p_patient, 'consultation_payment', v_coins, p_fee, p_reference, 'success')
  on conflict (reference) where type = 'consultation_payment' do nothing;

  if not found then
    return query select true, false;
    return;
  end if;

  select type, notes into v_type, v_notes
    from public.professional_consultations
   where professional_id = p_professional and status = 'setup'
   limit 1;
  if v_type is null then v_type := 'text'; end if;

  insert into public.professional_consultations (professional_id, patient_id, type, fee, notes, status)
  values (p_professional, p_patient, v_type, p_fee, v_notes, 'paid')
  on conflict (professional_id, patient_id) where status = 'paid' do nothing;

  if not found then
    return query select false, true;
    return;
  end if;

  v_pro_coins := floor(v_coins * (1 - v_rate))::integer;
  v_platform_coins := v_coins - v_pro_coins;

  if v_pro_coins > 0 then
    perform public._post_coin_entry(p_professional, v_pro_coins, 'consultation_earning', p_reference, p_patient);
    insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
    values (p_professional, 'consultation_earnings', v_pro_coins, p_fee, p_reference, 'success');
  end if;
  if v_platform_coins > 0 then
    insert into public.transactions (user_id, type, amount, reference, status)
    values (null, 'platform_fee_consultation', v_platform_coins, p_reference, 'success');
  end if;

  return query select false, false;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Assertions: grants untouched, no overloads, nothing writes a balance by hand
-- ---------------------------------------------------------------------------------------------
do $$
declare bad text; n integer;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('pay_creator_subscription', 'pay_professional_consultation', 'settle_subscription_payment', 'settle_consultation_payment', '_post_coin_split')
     and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'anon can execute: %', bad; end if;

  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = '_post_coin_split'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'));
  if bad is not null then raise exception '_post_coin_split must be private: %', bad; end if;

  select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace
   and proname in ('pay_creator_subscription', 'pay_professional_consultation', 'settle_subscription_payment', 'settle_consultation_payment');
  if n <> 4 then raise exception 'expected exactly one of each replaced function, found % in total', n; end if;

  select string_agg(p.proname, ', ') into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('_post_coin_entry', '_post_coin_transfer')
     and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~* 'update\s+(public\.)?wallets\s+set';
  if bad is not null then raise exception 'functions still writing wallets by hand: %', bad; end if;
end $$;
