-- Financial program, Phase 05 (2/3): every CareCoin writer posts through the ledger.
--
-- Thirteen functions changed a wallet balance by hand. Each now calls _post_coin_entry /
-- _post_coin_transfer (migration 1/3), so a balance change and its ledger row are one unit, a debit can
-- never take a wallet below zero, and a replay of the same leg is refused by the ledger's unique key.
-- Signatures, return values and checks are unchanged (CREATE OR REPLACE on the same signature keeps
-- the existing grants and leaves no overload). The legacy `transactions` rows (the wallet screen's
-- history) are still written, now with a reference wherever one exists.
--
-- Fixed on the way:
--   * F-13  send_gift accepted any p_coins: a non-positive or null amount is now refused up front.
--   * F-01 (database side)  request_withdrawal answered 'ok' WITHOUT debiting for ANY known reference.
--           A replay now counts only if it is the same user, amount and account; anything else is
--           'reference_conflict' and nothing moves.
--   * The CareCoin pay_* functions now also refuse a self-purchase (coins would just move to yourself).
--   * request_withdrawal's minimum comes from financial_config (min_withdrawal_coins = 5, unchanged).
-- Not changed (open decisions): CareCoin-paid subscriptions/consultations still credit the creator or
-- professional in full - the owner has not yet said whether the 20% platform fee applies there (Q1).

do $$
begin
  if to_regprocedure('public._post_coin_entry(uuid,integer,text,text,uuid,jsonb)') is null then
    raise exception 'apply carefind_20261005_coin_ledger first';
  end if;
  if to_regprocedure('public._fin_cfg(text)') is null then
    raise exception 'apply carefind_20261004_settle_payment_intent first';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Card-payment settlement handlers (Phase 04): credit through the ledger
-- ---------------------------------------------------------------------------------------------
create or replace function public._settle_wallet_topup(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_coins integer;
  v_balance integer;
begin
  begin
    v_coins := (i.metadata ->> 'coins')::integer;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'invalid_topup_intent');
  end;
  if i.customer_id is null or v_coins is null or v_coins <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_topup_intent');
  end if;

  -- Claim the reference first: the history row and the credit are one unit.
  insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
  values (i.customer_id, 'topup', v_coins, (i.expected_amount / 100)::integer, i.reference, 'success')
  on conflict (reference) where type = 'topup' do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'reference_already_used');
  end if;

  v_balance := public._post_coin_entry(i.customer_id, v_coins, 'topup', i.reference, null, jsonb_build_object('intent_id', i.id));
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
  if i.expected_amount <> v_coins * v_coin_kobo then
    return jsonb_build_object('ok', false, 'reason', 'price_mismatch');
  end if;
  if not exists (select 1 from public.profiles where id = i.entity_id) then
    return jsonb_build_object('ok', false, 'reason', 'creator_missing');
  end if;

  v_creator_coins := floor(v_coins * (1 - v_rate))::integer;
  v_platform_coins := v_coins - v_creator_coins;

  insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
  values (i.customer_id, 'subscription_payment', v_coins, (i.expected_amount / 100)::integer, i.reference, 'success')
  on conflict (reference) where type = 'subscription_payment' do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'reference_already_used');
  end if;

  -- The card payment IS the settlement: the subscriber's CareCoin wallet is not touched.
  if v_creator_coins > 0 then
    perform public._post_coin_entry(i.entity_id, v_creator_coins, 'subscription_earning', i.reference, i.customer_id, jsonb_build_object('intent_id', i.id));
    insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
    values (i.entity_id, 'subscription_earning', v_creator_coins, null, i.reference, 'success');
  end if;
  if v_platform_coins > 0 then
    insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
    values (null, 'platform_fee_subscription', v_platform_coins, null, i.reference, 'success');
  end if;

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

  insert into public.professional_consultations (professional_id, patient_id, type, fee, notes, status)
  values (i.entity_id, i.customer_id, coalesce(v_type, 'text'), i.expected_amount / 100.0, v_notes, 'paid')
  on conflict (professional_id, patient_id) where status = 'paid' do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already_booked');
  end if;

  v_professional_coins := floor(i.expected_amount * (1 - v_rate) / v_coin_kobo)::integer;

  insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
  values (i.customer_id, 'consultation_payment', ceil(i.expected_amount / v_coin_kobo)::integer, (i.expected_amount / 100)::integer, i.reference, 'success')
  on conflict (reference) where type = 'consultation_payment' do nothing;

  -- A CARD payment: the patient's CareCoin wallet is never debited.
  if v_professional_coins > 0 then
    perform public._post_coin_entry(i.entity_id, v_professional_coins, 'consultation_earning', i.reference, i.customer_id, jsonb_build_object('intent_id', i.id));
    insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
    values (i.entity_id, 'consultation_earnings', v_professional_coins, (i.expected_amount / 100)::integer, i.reference, 'success');
  end if;

  return jsonb_build_object('ok', true, 'professional_coins', v_professional_coins);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Legacy card-settlement RPCs (still called for payments that started before the engine shipped)
-- ---------------------------------------------------------------------------------------------
create or replace function public.credit_wallet_topup(p_user_id uuid, p_coins integer, p_naira_amount integer, p_reference text)
returns table (already_processed boolean, new_balance integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_balance integer;
begin
  if p_user_id is null or p_coins is null or p_coins <= 0 then
    raise exception 'a top-up must credit a positive whole number of coins';
  end if;

  insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
  values (p_user_id, 'topup', p_coins, p_naira_amount, p_reference, 'success')
  on conflict (reference) where type = 'topup' do nothing;

  if not found then
    select balance into v_new_balance from public.wallets where user_id = p_user_id;
    return query select true, coalesce(v_new_balance, 0);
    return;
  end if;

  v_new_balance := public._post_coin_entry(p_user_id, p_coins, 'topup', p_reference);
  return query select false, v_new_balance;
end;
$function$;

create or replace function public.settle_subscription_payment(p_subscriber uuid, p_creator uuid, p_price integer, p_naira_amount integer, p_reference text)
returns table (already_processed boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- Card payment IS the settlement: the subscriber's wallet is deliberately NOT debited.
  perform public._post_coin_entry(p_creator, p_price, 'subscription_earning', p_reference, p_subscriber);

  insert into public.creator_subscriptions (subscriber_id, creator_id, price, expires_at, auto_renew)
  values (p_subscriber, p_creator, p_price, now() + interval '30 days', true)
  on conflict (subscriber_id, creator_id) do update
    set expires_at = greatest(public.creator_subscriptions.expires_at, now()) + interval '30 days',
        price = p_price,
        auto_renew = true;

  insert into public.transactions (user_id, type, amount, reference, status)
  values (p_creator, 'subscription_earning', p_price, p_reference, 'success');

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

  if v_coins > 0 then
    perform public._post_coin_entry(p_professional, v_coins, 'consultation_earning', p_reference, p_patient);
  end if;

  insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
  values (p_professional, 'consultation_earnings', v_coins, p_fee, p_reference, 'success');

  return query select false, false;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- CareCoin-paid purchases
-- ---------------------------------------------------------------------------------------------
create or replace function public.pay_booking_with_credits(p_user_id uuid, p_appointment_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_business_id uuid; v_fee_kobo integer; v_payment_status text; v_reference text; v_source text;
  v_coins integer; v_rounded_kobo integer; v_platform_kobo integer; v_new integer;
begin
  if p_user_id is null then return 'not_signed_in'; end if;

  select business_id, fee_amount, payment_status, payment_reference, source
    into v_business_id, v_fee_kobo, v_payment_status, v_reference, v_source
    from appointments where id = p_appointment_id for update;
  if v_business_id is null then return 'not_found'; end if;
  if coalesce(v_source, '') <> 'carefind' then return 'invalid_source'; end if;
  if v_fee_kobo is null or v_fee_kobo <= 0 then return 'no_fee'; end if;
  if v_payment_status in ('paid', 'refunded') then return 'already_paid'; end if;
  if v_reference is null then return 'no_reference'; end if;
  if not exists (select 1 from wallets where user_id = p_user_id) then return 'no_wallet'; end if;

  -- CareCoins ARE this path's currency, so the fee is converted (rounded up to a whole coin) here.
  v_coins := ceil(v_fee_kobo / 20000.0)::int;
  v_rounded_kobo := v_coins * 20000;
  v_platform_kobo := (v_rounded_kobo * 0.2)::int;

  v_new := public._post_coin_entry(p_user_id, -v_coins, 'booking_payment', v_reference, null, jsonb_build_object('appointment_id', p_appointment_id));
  if v_new is null then return 'insufficient'; end if;

  insert into transactions (user_id, type, amount, naira_amount, reference, status)
  values (p_user_id, 'booking_payment', v_coins, (v_rounded_kobo / 100), v_reference, 'success');
  perform public.fn_credit_business_booking(v_business_id, p_appointment_id, v_rounded_kobo, v_platform_kobo, v_reference);
  update appointments set payment_status = 'paid', payment_channel = 'carecoins', patient_user_id = p_user_id, refunded_at = null where id = p_appointment_id;
  return 'ok';
end;
$function$;

create or replace function public.pay_creator_subscription(p_creator uuid, p_price integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_subscriber uuid := auth.uid();
  v_current timestamptz;
  v_listed integer;
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

  if not public._post_coin_transfer(v_subscriber, p_creator, v_listed, 'subscription_payment', 'subscription_earning', v_ref) then
    return 'insufficient';
  end if;

  select expires_at into v_current
    from public.creator_subscriptions
   where subscriber_id = v_subscriber and creator_id = p_creator;

  insert into public.creator_subscriptions (subscriber_id, creator_id, price, expires_at, auto_renew)
  values (v_subscriber, p_creator, v_listed, now() + interval '30 days', true)
  on conflict (subscriber_id, creator_id) do update
    set expires_at = greatest(public.creator_subscriptions.expires_at, now()) + interval '30 days',
        price = v_listed,
        auto_renew = true;

  insert into public.transactions (user_id, type, amount, reference, status)
  values (v_subscriber, 'subscription', -v_listed, v_ref, 'success'),
         (p_creator, 'subscription_earning', v_listed, v_ref, 'success');

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

  -- The whole body is one exception block: if the paid-booking insert collides (unique index) the
  -- exception aborts this subtransaction, so the wallet movement and ledger rows roll back with it - a
  -- raced double-booking can never move money.
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

    -- 1 CareCoin = N200; round up so the platform never over-credits.
    v_coins := ceil(v_fee / 200)::int;

    if not public._post_coin_transfer(v_patient, p_professional, v_coins, 'consultation_payment', 'consultation_earning', v_ref) then
      return 'insufficient';
    end if;

    insert into transactions (user_id, type, amount, naira_amount, reference, status)
    values (v_patient, 'consultation_payment', v_coins, v_fee, v_ref, 'success');
    insert into transactions (user_id, type, amount, naira_amount, reference, status)
    values (p_professional, 'consultation_earnings', v_coins, v_fee, v_ref, 'success');

    insert into professional_consultations (professional_id, patient_id, type, fee, notes, status)
    values (p_professional, v_patient, v_type, v_fee, v_notes, 'paid');

    return 'ok';
  exception
    when unique_violation then
      return 'already_booked';
  end;
end;
$function$;

create or replace function public.send_gift(p_recipient uuid, p_coins integer, p_gift_type text, p_gift_emoji text, p_post_id uuid default null, p_live_session_id uuid default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sender uuid := auth.uid();      -- the sender is ALWAYS the caller; there is no sender argument
  v_reference text;
begin
  if v_sender is null then
    return 'unauthorized';
  end if;
  if p_recipient is null or v_sender = p_recipient then
    return 'self';
  end if;
  -- F-13: a gift is a positive whole number of coins. (A negative one used to be stopped only by
  -- the wallet CHECK firing by accident.)
  if p_coins is null or p_coins <= 0 then
    return 'invalid_coins';
  end if;
  if not exists (select 1 from auth.users where id = p_recipient) then
    return 'recipient_not_found';
  end if;

  v_reference := 'gift_' || gen_random_uuid()::text;
  if not public._post_coin_transfer(v_sender, p_recipient, p_coins, 'gift_sent', 'gift_received', v_reference,
                                    jsonb_build_object('post_id', p_post_id, 'live_session_id', p_live_session_id)) then
    return 'insufficient';
  end if;

  insert into public.gifts (sender_id, recipient_id, post_id, live_session_id, gift_type, gift_emoji, coins)
  values (v_sender, p_recipient, p_post_id, p_live_session_id, p_gift_type, p_gift_emoji, p_coins);

  insert into public.transactions (user_id, type, amount, reference, status)
  values (v_sender,    'gift_sent',     -p_coins, v_reference, 'success'),
         (p_recipient, 'gift_received',  p_coins, v_reference, 'success');

  return 'ok';
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Withdrawals (CareFind): debit on request, refund exactly once on rejection
-- ---------------------------------------------------------------------------------------------
create or replace function public.request_withdrawal(
  p_user_id uuid, p_amount integer, p_bank_name text, p_account_number text, p_account_name text,
  p_reference text default null, p_daily_cap_coins integer default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance integer;
  v_recent  numeric;
  v_id uuid := gen_random_uuid();
  v_existing public.withdrawal_requests%rowtype;
begin
  if p_user_id is null then return 'not_logged_in'; end if;
  if p_amount is null or p_amount < public._fin_cfg('min_withdrawal_coins') then return 'below_minimum'; end if;
  if p_bank_name is null or btrim(p_bank_name) = ''
     or p_account_number is null or btrim(p_account_number) = ''
     or p_account_name is null or btrim(p_account_name) = '' then
    return 'missing_bank_details';
  end if;

  -- A replay is the SAME request again (same user, amount, account): answer ok, move nothing. A known
  -- reference carrying anything else is a conflict: it used to answer 'ok' without debiting while the
  -- caller paid out the NEW amount (audit F-01).
  if p_reference is not null then
    select * into v_existing from public.withdrawal_requests
     where paystack_reference = p_reference and status in ('pending', 'processing') limit 1;
    if found then
      if v_existing.user_id = p_user_id and v_existing.amount = p_amount and v_existing.account_number = p_account_number then
        return 'ok';
      end if;
      return 'reference_conflict';
    end if;
  end if;

  insert into public.wallets (user_id, balance) values (p_user_id, 0) on conflict (user_id) do nothing;
  select balance into v_balance from public.wallets where user_id = p_user_id for update;
  if v_balance < p_amount then return 'insufficient'; end if;

  if p_daily_cap_coins is not null then
    select coalesce(sum(amount), 0) into v_recent
      from public.withdrawal_requests
     where user_id = p_user_id
       and status not in ('rejected', 'failed', 'cancelled')
       and created_at > now() - interval '24 hours';
    if v_recent + p_amount > p_daily_cap_coins then return 'daily_limit'; end if;
  end if;

  if public._post_coin_entry(p_user_id, -p_amount, 'withdrawal', 'wd_' || v_id, null, jsonb_build_object('request_id', v_id)) is null then
    return 'insufficient';
  end if;

  insert into public.withdrawal_requests (id, user_id, amount, bank_name, account_number, account_name, status, paystack_reference)
  values (v_id, p_user_id, p_amount, p_bank_name, p_account_number, p_account_name, 'pending', p_reference);

  insert into public.transactions (user_id, type, amount, reference, status)
  values (p_user_id, 'withdrawal', p_amount, p_reference, 'success');

  return 'ok';
end;
$function$;

create or replace function public.reject_withdrawal_request(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_amount int;
  v_status text;
begin
  select user_id, amount, status into v_user_id, v_amount, v_status
  from withdrawal_requests where id = p_request_id for update;

  if v_user_id is null then
    return 'not_found';
  end if;
  if v_status <> 'pending' then
    return 'already_' || v_status;
  end if;

  update withdrawal_requests set status = 'rejected' where id = p_request_id;

  -- Refund exactly once: the status guard above and the ledger's unique (user, kind, reference) both enforce it.
  perform public._post_coin_entry(v_user_id, v_amount, 'withdrawal_refund', 'wd_refund_' || p_request_id, null, jsonb_build_object('request_id', p_request_id));

  insert into transactions (user_id, type, amount, reference, status)
  values (v_user_id, 'withdrawal_refund', v_amount, 'wd_refund_' || p_request_id, 'success');

  return 'ok';
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Appointment refund (CareCoin leg). The business-wallet side and the card-refund gap are Phase 09.
-- ---------------------------------------------------------------------------------------------
create or replace function public.refund_appointment_payment(p_appointment_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_business_id uuid; v_payment_status text; v_reference text; v_user_id uuid; v_credit_amount integer; v_coins integer; v_available integer; v_held integer;
begin
  select business_id, payment_status, payment_reference, patient_user_id into v_business_id, v_payment_status, v_reference, v_user_id from appointments where id = p_appointment_id for update;
  if v_business_id is null then return 'not_found'; end if;
  if v_payment_status = 'refunded' then return 'already_refunded'; end if;
  if v_payment_status is distinct from 'paid' then return 'not_paid'; end if;
  select amount into v_credit_amount from business_wallet_transactions where appointment_id = p_appointment_id and type = 'booking_credit' limit 1;
  if v_credit_amount is null then return 'not_settled'; end if;
  select available_balance, held_balance into v_available, v_held from business_wallets where business_id = v_business_id for update;
  if v_held >= v_credit_amount then update business_wallets set held_balance = held_balance - v_credit_amount, updated_at = now() where business_id = v_business_id;
  elsif v_available >= v_credit_amount then update business_wallets set available_balance = available_balance - v_credit_amount, updated_at = now() where business_id = v_business_id;
  else null; end if;
  insert into business_wallet_transactions (business_id, appointment_id, type, amount, reference) values (v_business_id, p_appointment_id, 'refund', -v_credit_amount, null);
  if v_user_id is not null then
    v_coins := ceil((v_credit_amount / 0.8) / 20000.0)::int;
    perform public._post_coin_entry(v_user_id, v_coins, 'booking_refund', 'appt_refund_' || p_appointment_id, null, jsonb_build_object('appointment_id', p_appointment_id));
    insert into transactions (user_id, type, amount, naira_amount, reference, status) values (v_user_id, 'booking_refund', v_coins, (v_credit_amount * 1.25 / 100)::int, coalesce(v_reference, gen_random_uuid()::text), 'success');
  end if;
  update appointments set payment_status = 'refunded', refunded_at = now() where id = p_appointment_id;
  return 'ok';
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Assertions: grants untouched, no overloads, no function still writes a balance by hand
-- ---------------------------------------------------------------------------------------------
do $$
declare bad text; n integer;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ') into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('credit_wallet_topup', 'settle_subscription_payment', 'settle_consultation_payment', 'pay_booking_with_credits',
                       'pay_creator_subscription', 'pay_professional_consultation', 'request_withdrawal', 'reject_withdrawal_request',
                       'refund_appointment_payment', '_settle_wallet_topup', '_settle_creator_subscription', '_settle_consultation')
     and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'anon can execute: %', bad; end if;

  select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'send_gift';
  if n <> 1 then raise exception 'expected exactly one send_gift, found %', n; end if;

  -- After this migration the only functions allowed to UPDATE a wallet balance are the posting primitives
  -- (creating an empty wallet row is fine and is not matched).
  select string_agg(p.proname, ', ') into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('_post_coin_entry', '_post_coin_transfer')
     and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~* 'update\s+(public\.)?wallets\s+set';
  if bad is not null then raise exception 'functions still writing wallets by hand: %', bad; end if;
end $$;
