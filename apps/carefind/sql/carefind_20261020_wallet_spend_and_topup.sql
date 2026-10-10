-- Phase 16 candidate: wallet spend through the settlement engine + business wallet top-up.
--
-- Every new purpose settles through the ONE engine (settle_payment_intent). Card-money
-- purposes are unchanged; the new `*_wallet` purposes debit a wallet balance atomically
-- and then run the same downstream effect the card path runs (renewal, booking credit,
-- shop vendor credit). CareCoin-paid paths reuse the same coin math as the direct RPCs
-- (1 CareCoin = N200 = 20000 kobo, ceil), so the wallet balance never depends on a
-- client-supplied amount.

-- --------------------------------------------------------------------------------------------
-- 1. Widen the purpose CHECK so the new wallet purposes are accepted at insert time.
-- --------------------------------------------------------------------------------------------
alter table public.payment_intents drop constraint payment_intents_purpose_check;
alter table public.payment_intents add constraint payment_intents_purpose_check
  check (purpose in (
    'wallet_topup', 'creator_subscription', 'consultation', 'booking',
    'appointment', 'plan_renewal', 'shop_order',
    'business_wallet_topup', 'booking_wallet', 'subscription_wallet',
    'consultation_wallet', 'shop_order_wallet', 'plan_renewal_wallet',
    'appointment_fee_wallet'
  ));

-- --------------------------------------------------------------------------------------------
-- 1b. The ledger kind CHECK must accept the new shop-wallet kinds.
-- --------------------------------------------------------------------------------------------
alter table public.coin_ledger drop constraint coin_ledger_kind_check;
alter table public.coin_ledger add constraint coin_ledger_kind_check check (kind in (
    'opening_balance', 'topup',
    'booking_payment', 'booking_refund',
    'consultation_payment', 'consultation_earning',
    'subscription_payment', 'subscription_earning',
    'gift_sent', 'gift_received',
    'withdrawal', 'withdrawal_refund',
    'adjustment',
    'shop_payment', 'shop_payment_refund'
  ));

-- --------------------------------------------------------------------------------------------
-- 2. Business wallet card top-up: Paystack confirms the charge, the engine credits the
--    business wallet. Idempotent on i.reference.
-- --------------------------------------------------------------------------------------------
create or replace function public._settle_business_wallet_topup(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid;
  v_new integer;
begin
  if i.business_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_topup_intent');
  end if;

  insert into public.business_wallet_transactions (business_id, type, amount, reference, status)
  values (i.business_id, 'topup', i.expected_amount, i.reference, 'confirmed')
  on conflict (reference) where type = 'topup' do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'reference_already_used');
  end if;

  update public.business_wallets
     set available_balance = available_balance + i.expected_amount, updated_at = now()
   where business_id = i.business_id
  returning available_balance into v_new;
  if not found then
    -- wallet row must exist for a business that can spend; create it so top-up never fails
    insert into public.business_wallets (business_id, available_balance)
    values (i.business_id, i.expected_amount)
    returning available_balance into v_new;
  end if;

  return jsonb_build_object('ok', true, 'business_id', i.business_id, 'new_available', v_new);
end;
$$;

create unique index if not exists business_wallet_tx_topup_ref_uniq
  on public.business_wallet_transactions (reference) where type = 'topup';

-- --------------------------------------------------------------------------------------------
-- 3. CareCoin-paid booking: same math as pay_booking_with_credits(), invoked by the engine.
-- --------------------------------------------------------------------------------------------
create or replace function public._settle_booking_wallet(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result text;
begin
  if i.customer_id is null or i.entity_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_booking_intent');
  end if;
  v_result := public.pay_booking_with_credits(i.customer_id, i.entity_id);
  if v_result = 'ok' then
    return jsonb_build_object('ok', true, 'appointment_id', i.entity_id);
  end if;
  return jsonb_build_object('ok', false, 'reason', v_result);
end;
$$;

-- --------------------------------------------------------------------------------------------
-- 4. CareCoin-paid subscription / consultation: the public RPCs take the caller from
--    auth.uid(), which is null in an engine (service-role) context, so the coin math is
--    extracted into explicit-user private functions and the RPCs become thin wrappers.
-- --------------------------------------------------------------------------------------------
create or replace function public._pay_creator_subscription_for(p_subscriber uuid, p_creator uuid, p_price integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current timestamptz;
  v_listed integer;
  v_ref text := 'sub_' || gen_random_uuid()::text;
begin
  if p_subscriber is null then return 'not_signed_in'; end if;
  if p_creator is null or p_price is null or p_price <= 0 then return 'invalid_args'; end if;
  if p_creator = p_subscriber then return 'self_subscription'; end if;

  select subscription_price into v_listed from public.profiles where id = p_creator;
  if v_listed is null or v_listed <= 0 then return 'not_for_sale'; end if;
  if p_price <> v_listed then return 'price_mismatch'; end if;

  if not public._post_coin_transfer(p_subscriber, p_creator, v_listed, 'subscription_payment', 'subscription_earning', v_ref) then
    return 'insufficient';
  end if;

  select expires_at into v_current
    from public.creator_subscriptions
   where subscriber_id = p_subscriber and creator_id = p_creator;

  insert into public.creator_subscriptions (subscriber_id, creator_id, price, expires_at, auto_renew)
  values (p_subscriber, p_creator, v_listed, now() + interval '30 days', true)
  on conflict (subscriber_id, creator_id) do update
    set expires_at = greatest(public.creator_subscriptions.expires_at, now()) + interval '30 days',
        price = v_listed,
        auto_renew = true;

  insert into public.transactions (user_id, type, amount, reference, status)
  values (p_subscriber, 'subscription', -v_listed, v_ref, 'success'),
         (p_creator, 'subscription_earning', v_listed, v_ref, 'success');

  return 'ok';
end;
$function$;

create or replace function public.pay_creator_subscription(p_creator uuid, p_price integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return public._pay_creator_subscription_for(auth.uid(), p_creator, p_price);
end;
$function$;

create or replace function public._pay_professional_consultation_for(p_patient uuid, p_professional uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fee numeric;
  v_type text;
  v_notes text;
  v_coins int;
  v_ref text := 'consult_' || gen_random_uuid()::text;
begin
  if p_patient is null then return 'not_signed_in'; end if;
  if p_professional is null then return 'no_professional'; end if;
  if p_professional = p_patient then return 'self_consultation'; end if;

  begin
    if exists (
      select 1 from professional_consultations
       where professional_id = p_professional and patient_id = p_patient and status = 'paid'
    ) then
      return 'already_booked';
    end if;

    select fee, type, notes into v_fee, v_type, v_notes
      from professional_consultations
     where professional_id = p_professional and status = 'setup'
     limit 1;
    if v_fee is null or v_fee <= 0 then return 'no_setup'; end if;

    v_coins := ceil(v_fee / 200)::int;

    if not public._post_coin_transfer(p_patient, p_professional, v_coins, 'consultation_payment', 'consultation_earning', v_ref) then
      return 'insufficient';
    end if;

    insert into transactions (user_id, type, amount, naira_amount, reference, status)
    values (p_patient, 'consultation_payment', v_coins, v_fee, v_ref, 'success');
    insert into transactions (user_id, type, amount, naira_amount, reference, status)
    values (p_professional, 'consultation_earnings', v_coins, v_fee, v_ref, 'success');

    insert into professional_consultations (professional_id, patient_id, type, fee, notes, status)
    values (p_professional, p_patient, v_type, v_fee, v_notes, 'paid');

    return 'ok';
  exception
    when unique_violation then
      return 'already_booked';
  end;
end;
$function$;

create or replace function public.pay_professional_consultation(p_professional uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return public._pay_professional_consultation_for(auth.uid(), p_professional);
end;
$function$;

create or replace function public._settle_subscription_wallet(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result text;
  v_creator uuid;
  v_price integer;
begin
  if i.customer_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_subscription_intent');
  end if;
  v_creator := nullif(i.metadata ->> 'creator_id', '')::uuid;
  v_price := nullif(i.metadata ->> 'price', '')::integer;
  if v_creator is null or v_price is null or v_price <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_subscription_intent');
  end if;
  v_result := public._pay_creator_subscription_for(i.customer_id, v_creator, v_price);
  if v_result = 'ok' then
    return jsonb_build_object('ok', true, 'creator_id', v_creator);
  end if;
  return jsonb_build_object('ok', false, 'reason', v_result);
end;
$$;

create or replace function public._settle_consultation_wallet(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result text;
  v_professional uuid;
begin
  if i.customer_id is null or i.entity_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_consultation_intent');
  end if;
  v_professional := nullif(i.metadata ->> 'professional_id', '')::uuid;
  if v_professional is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_consultation_intent');
  end if;
  v_result := public._pay_professional_consultation_for(i.customer_id, v_professional);
  if v_result = 'ok' then
    return jsonb_build_object('ok', true, 'professional_id', v_professional);
  end if;
  return jsonb_build_object('ok', false, 'reason', v_result);
end;
$$;

-- --------------------------------------------------------------------------------------------
-- 5. Shop order paid from the buyer's CareCoin wallet. Buyer is debited at the same
--    N200/coin rule the withdrawal path uses; the vendor is credited through the exact
--    same _settle_shop_order handler used for cards.
-- --------------------------------------------------------------------------------------------
create or replace function public._settle_shop_order_wallet(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_coins integer;
  v_new integer;
  v_res jsonb;
begin
  if i.customer_id is null or i.entity_type is distinct from 'shop_order' or i.entity_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_shop_intent');
  end if;

  -- 1 CareCoin = N200 = 20000 kobo; round up so the buyer never under-pays.
  v_coins := ceil(i.expected_amount / 20000.0)::int;
  v_new := public._post_coin_entry(i.customer_id, -v_coins, 'shop_payment', i.reference, i.business_id,
                                   jsonb_build_object('order_id', i.entity_id));
  if v_new is null then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_coins');
  end if;

  v_res := public._settle_shop_order(i);
  if coalesce((v_res ->> 'ok')::boolean, false) is not true then
    -- roll back the buyer debit so a declined order never strands the buyer's coins
    perform public._post_coin_entry(i.customer_id, v_coins, 'shop_payment_refund', 'sref_' || i.reference, i.business_id, '{}'::jsonb);
    return v_res;
  end if;
  return v_res || jsonb_build_object('coins_debited', v_coins);
end;
$$;

-- --------------------------------------------------------------------------------------------
-- 6. Business wallet pays the platform: plan renewal / per-appointment fee. Both debit
--    `available_balance`; held money is never touched.
-- --------------------------------------------------------------------------------------------
create or replace function public._settle_plan_renewal_wallet(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_months integer;
  v_new integer;
  r record;
begin
  if i.business_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_plan_intent');
  end if;
  begin
    v_months := (i.metadata ->> 'months')::integer;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'invalid_plan_intent');
  end;
  if v_months is null or v_months not in (1, 12) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_months');
  end if;

  update public.business_wallets
     set available_balance = available_balance - i.expected_amount, updated_at = now()
   where business_id = i.business_id and available_balance >= i.expected_amount
  returning available_balance into v_new;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_available');
  end if;

  insert into public.business_wallet_transactions (business_id, type, amount, reference, status)
  values (i.business_id, 'plan_payment', -i.expected_amount, i.reference, 'confirmed');

  select * into r from public.renew_business_plan(i.business_id, v_months, (i.expected_amount / 100)::integer, i.reference);
  if r.already_processed then
    -- nothing to refund here: the renewal claims this reference; a race resolves to one row.
    return jsonb_build_object('ok', false, 'reason', 'reference_already_used');
  end if;

  return jsonb_build_object('ok', true, 'payment_id', r.payment_id, 'new_expiry', r.new_expiry, 'is_first_payment', r.is_first_payment, 'months', v_months);
end;
$$;

create or replace function public._settle_appointment_fee_wallet(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new integer;
begin
  if i.business_id is null or i.entity_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_appointment_fee_intent');
  end if;
  if not exists (select 1 from public.appointments where id = i.entity_id and business_id = i.business_id) then
    return jsonb_build_object('ok', false, 'reason', 'appointment_mismatch');
  end if;

  update public.business_wallets
     set available_balance = available_balance - i.expected_amount, updated_at = now()
   where business_id = i.business_id and available_balance >= i.expected_amount
  returning available_balance into v_new;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_available');
  end if;

  insert into public.business_wallet_transactions (business_id, appointment_id, type, amount, reference, status)
  values (i.business_id, i.entity_id, 'appointment_fee', -i.expected_amount, i.reference, 'confirmed');

  return jsonb_build_object('ok', true, 'appointment_id', i.entity_id, 'new_available', v_new);
end;
$$;

-- --------------------------------------------------------------------------------------------
-- 7. Re-run the dispatch with the new branches (same signature, ACLs kept).
-- --------------------------------------------------------------------------------------------
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

  update public.payment_intents
     set status = 'verified', provider_transaction_id = p_provider_txn_id
   where id = i.id;

  if v_fail is null then
    v_res := case i.purpose
      when 'wallet_topup'           then public._settle_wallet_topup(i)
      when 'creator_subscription'   then public._settle_creator_subscription(i)
      when 'consultation'           then public._settle_consultation(i)
      when 'booking'                then public._settle_booking(i)
      when 'appointment'            then public._settle_booking(i)
      when 'plan_renewal'           then public._settle_plan_renewal(i)
      when 'shop_order'             then public._settle_shop_order(i)
      when 'business_wallet_topup'  then public._settle_business_wallet_topup(i)
      when 'booking_wallet'         then public._settle_booking_wallet(i)
      when 'subscription_wallet'    then public._settle_subscription_wallet(i)
      when 'consultation_wallet'    then public._settle_consultation_wallet(i)
      when 'shop_order_wallet'      then public._settle_shop_order_wallet(i)
      when 'plan_renewal_wallet'    then public._settle_plan_renewal_wallet(i)
      when 'appointment_fee_wallet' then public._settle_appointment_fee_wallet(i)
      else null
    end;
    if v_res is null then
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

-- --------------------------------------------------------------------------------------------
-- 8. Wallet-spend money is never client-callable: the wallet purposes settle only through
--    the engine, and the two extracted coin functions stay private.
-- --------------------------------------------------------------------------------------------
revoke all on function public._settle_business_wallet_topup(public.payment_intents) from public, anon, authenticated, service_role;
revoke all on function public._settle_booking_wallet(public.payment_intents) from public, anon, authenticated, service_role;
revoke all on function public._settle_subscription_wallet(public.payment_intents) from public, anon, authenticated, service_role;
revoke all on function public._settle_consultation_wallet(public.payment_intents) from public, anon, authenticated, service_role;
revoke all on function public._settle_shop_order_wallet(public.payment_intents) from public, anon, authenticated, service_role;
revoke all on function public._settle_plan_renewal_wallet(public.payment_intents) from public, anon, authenticated, service_role;
revoke all on function public._settle_appointment_fee_wallet(public.payment_intents) from public, anon, authenticated, service_role;
revoke all on function public._pay_creator_subscription_for(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public._pay_professional_consultation_for(uuid, uuid) from public, anon, authenticated, service_role;

-- keep the public RPC wrappers callable the same way as before (auth.uid() inside).
grant execute on function public.pay_creator_subscription(uuid, integer) to authenticated, service_role;
grant execute on function public.pay_professional_consultation(uuid) to authenticated, service_role;

-- --------------------------------------------------------------------------------------------
-- 9. Provenance: every withdrawable CareCoin traces to provider-confirmed money or an allowed
--    internal source. A positive coin_ledger entry is traceable when, and only when:
--      (a) its kind is an engine-only internal source (opening_balance, topup, gift_received,
--          withdrawal_refund, booking_refund, shop_payment_refund) - only definer functions
--          post these kinds; or
--      (b) a settled payment_intent exists with the same reference (provider-confirmed); or
--      (c) its reference carries a prefix that only service-role code mints (wd_refund_,
--          appt_refund_, sref_, gift_, sub_, consult_, bk_, adj_); or
--      (d) it is an earning whose reference is vouched for by the legacy `transactions`
--          settlement record written in the same transaction by the card settlement path.
--    Everything else - including a forged `adjustment` credit with an arbitrary reference - is
--    untraceable: reported by this function, surfaced by run_db_reconciliation(), and
--    quarantined from the withdrawal reservation (section 10).
-- --------------------------------------------------------------------------------------------
create or replace function public.reconcile_coin_provenance()
returns table (user_id uuid, kind text, reference text, delta integer, reason text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.user_id, l.kind, l.reference, l.delta,
         case
           when l.kind = 'adjustment' then 'adjustment_without_allowed_reference'
           when l.kind in ('subscription_earning', 'consultation_earning') then 'earning_without_settlement_record'
           else 'no_settled_intent'
         end as reason
    from public.coin_ledger l
   where l.delta > 0
     -- (a) engine-only internal kinds
     and l.kind not in ('opening_balance', 'topup', 'gift_received', 'withdrawal_refund',
                        'booking_refund', 'shop_payment_refund')
     -- (b) provider-confirmed via a settled intent
     and not exists (select 1 from public.payment_intents p
                      where p.reference = l.reference and p.status = 'settled')
     -- (c) prefixes minted only by service-role code
     and l.reference not like 'wd_refund_%'
     and l.reference not like 'appt_refund_%'
     and l.reference not like 'sref_%'
     and l.reference not like 'gift_%'
     and l.reference not like 'sub_%'
     and l.reference not like 'consult_%'
     and l.reference not like 'bk_%'
     and l.reference not like 'adj_%'
     -- (d) legacy card settlement record vouches for the earning
     and not (l.kind in ('subscription_earning', 'consultation_earning')
              and exists (select 1 from public.transactions t
                           where t.reference = l.reference and t.status = 'success'))
$$;

revoke all on function public.reconcile_coin_provenance() from public, anon, authenticated;
grant execute on function public.reconcile_coin_provenance() to service_role;

-- --------------------------------------------------------------------------------------------
-- 10. The reservation refuses the untraceable portion: a user can withdraw only coins whose
--    credits all trace. Same signature as carefind_20261008_withdrawal_engine (ACLs re-stated).
-- --------------------------------------------------------------------------------------------
create or replace function public.create_withdrawal(
  p_user_id uuid, p_coins integer, p_bank_name text, p_bank_code text, p_account_number text, p_account_name text,
  p_daily_cap_coins integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_ref text;
  v_balance integer;
  v_untraceable integer;
  v_recent numeric;
  v_payout bigint;
begin
  if p_user_id is null then return jsonb_build_object('outcome', 'not_logged_in'); end if;
  if p_coins is null or p_coins < public._fin_cfg('min_withdrawal_coins') then return jsonb_build_object('outcome', 'below_minimum'); end if;
  if p_bank_name is null or btrim(p_bank_name) = '' or p_account_number is null or btrim(p_account_number) = ''
     or p_account_name is null or btrim(p_account_name) = '' then
    return jsonb_build_object('outcome', 'missing_bank_details');
  end if;

  -- 1 coin = coin_value_kobo; the fee comes off the top; paid in whole naira.
  v_payout := floor(p_coins * public._fin_cfg('coin_value_kobo') * (1 - public._fin_cfg('withdrawal_fee_rate')) / 100) * 100;
  if v_payout <= 0 then return jsonb_build_object('outcome', 'below_minimum'); end if;

  insert into public.wallets (user_id, balance) values (p_user_id, 0) on conflict (user_id) do nothing;
  select balance into v_balance from public.wallets where user_id = p_user_id for update;   -- serialises this user's requests
  if v_balance < p_coins then return jsonb_build_object('outcome', 'insufficient'); end if;

  -- Provenance quarantine: coins whose credits do not trace (section 9) are excluded from the
  -- withdrawable balance. Refusing here is the LAST line of defence - the report already exists
  -- for reconciliation and admin visibility.
  select coalesce(sum(p.delta), 0) into v_untraceable
    from public.reconcile_coin_provenance() p
   where p.user_id = p_user_id;
  if p_coins > v_balance - v_untraceable then
    return jsonb_build_object('outcome', 'untraceable_credits', 'withdrawable_coins', greatest(v_balance - v_untraceable, 0),
                              'untraceable_coins', v_untraceable);
  end if;

  if p_daily_cap_coins is not null then
    select coalesce(sum(amount), 0) into v_recent from public.withdrawal_requests
     where user_id = p_user_id and status not in ('failed', 'refunded') and created_at > now() - interval '24 hours';
    if v_recent + p_coins > p_daily_cap_coins then return jsonb_build_object('outcome', 'daily_limit'); end if;
  end if;

  v_ref := 'cf_wd_' || replace(v_id::text, '-', '');
  if public._post_coin_entry(p_user_id, -p_coins, 'withdrawal', 'wd_' || v_id, null, jsonb_build_object('request_id', v_id)) is null then
    return jsonb_build_object('outcome', 'insufficient');
  end if;
  insert into public.withdrawal_requests (id, user_id, amount, payout_kobo, bank_name, bank_code, account_number, account_name, status, paystack_reference)
  values (v_id, p_user_id, p_coins, v_payout, p_bank_name, p_bank_code, p_account_number, p_account_name, 'reserved', v_ref);
  insert into public.transactions (user_id, type, amount, reference, status)
  values (p_user_id, 'withdrawal', p_coins, v_ref, 'success');

  return jsonb_build_object('outcome', 'ok', 'id', v_id, 'reference', v_ref, 'coins', p_coins, 'payout_kobo', v_payout);
end;
$$;

revoke all on function public.create_withdrawal(uuid, integer, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_withdrawal(uuid, integer, text, text, text, text, integer) to service_role;

-- --------------------------------------------------------------------------------------------
-- 11. The database reconciliation reports untraceable credits as critical findings (heavy run).
--     Only recreated when the reconciliation exists (chains that predate carefind_20261014 skip).
-- --------------------------------------------------------------------------------------------
do $do$
begin
  if to_regprocedure('public.run_db_reconciliation(boolean)') is null then return; end if;
  execute $fn$
  create or replace function public.run_db_reconciliation(p_heavy boolean default true)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $body$
  declare
    v_run uuid := gen_random_uuid();
    v_results jsonb := '[]'::jsonb;
    v_totals jsonb;
  begin
    insert into public.reconciliation_runs (id) values (v_run);

    if p_heavy then
      create temporary table _rs on commit drop as
        select 'wallet_differs_from_ledger'::text kind, 'user'::text subject_type, user_id::text subject_id, 'critical'::text severity,
               'balance ' || balance || ' but ledger sums to ' || ledger_sum || ' (difference ' || difference || ')' detail
          from public.reconcile_coin_wallets()
        union all
        select 'ledger_chain_broken', 'coin_ledger_entry', id::text, 'critical', 'entry ' || id || ' for user ' || user_id || ': balance_after ' || balance_after || ', expected ' || expected_balance
          from public.verify_coin_ledger_chain()
        union all
        select 'untraceable_credit', 'user', p.user_id::text, 'critical',
               count(*) || ' credit(s) totalling ' || coalesce(sum(p.delta), 0) || ' coins do not trace to a settled payment or an allowed internal source and are quarantined from withdrawal'
          from public.reconcile_coin_provenance() p
         group by p.user_id;
      v_results := v_results || public._recon_publish('coins');
    end if;

    create temporary table _rs on commit drop as
      select kind, case when payment_id is not null then 'plan_payment' when business_id is not null then 'business' else 'agent' end subject_type,
             coalesce(payment_id, business_id, agent_id)::text subject_id, public._recon_severity(kind) severity, detail
        from public.reconcile_commissions();
    v_results := v_results || public._recon_publish('commissions');

    create temporary table _rs on commit drop as
      select kind, app || '_withdrawal' subject_type, request_id::text subject_id, public._recon_severity(kind) severity, detail
        from public.reconcile_withdrawals();
    v_results := v_results || public._recon_publish('withdrawals');

    create temporary table _rs on commit drop as
      select kind, case when refund_id is not null then 'refund' else 'entity' end subject_type, coalesce(refund_id, entity_id)::text subject_id,
             public._recon_severity(kind) severity, detail
        from public.reconcile_refunds();
    v_results := v_results || public._recon_publish('refunds');

    create temporary table _rs on commit drop as
      select kind, 'shop_order' subject_type, order_id::text subject_id, public._recon_severity(kind) severity, detail
        from public.reconcile_shop_vendor_credits();
    v_results := v_results || public._recon_publish('shop_vendor');

    if p_heavy then
      create temporary table _rs on commit drop as
        select 'settled_without_transaction_id'::text kind, 'payment_intent'::text subject_type, i.id::text subject_id, 'critical'::text severity,
               'intent ' || i.reference || ' is settled but no provider transaction id was recorded' detail
          from public.payment_intents i where i.status = 'settled' and i.provider_transaction_id is null
        union all
        select 'shop_order_settled_but_unpaid', 'payment_intent', i.id::text, 'critical',
               'intent ' || i.reference || ' settled but order ' || i.entity_id || ' is ' || coalesce(o.payment_status, 'missing')
          from public.payment_intents i left join public.shop_orders o on o.id = i.entity_id
         where i.status = 'settled' and i.purpose = 'shop_order' and (o.id is null or o.payment_status not in ('paid', 'refunded'))
        union all
        select 'appointment_settled_but_unpaid', 'payment_intent', i.id::text, 'critical',
               'intent ' || i.reference || ' settled but appointment ' || i.entity_id || ' is ' || coalesce(a.payment_status, 'missing')
          from public.payment_intents i left join public.appointments a on a.id = i.entity_id
         where i.status = 'settled' and i.purpose in ('appointment', 'booking') and i.entity_type = 'appointment' and (a.id is null or a.payment_status not in ('paid', 'refunded'));
      v_results := v_results || public._recon_publish('intents');
    end if;

    create temporary table _rs on commit drop as
      select 'event_failed'::text kind, 'provider_event'::text subject_type, e.id::text subject_id,
             (case when e.received_at < now() - interval '1 day' then 'critical' else 'warning' end)::text severity,
             e.event_type || ' ' || coalesce(e.reference, e.event_id) || ' failed ' || e.attempts || ' time(s): ' || coalesce(e.last_error, '?') detail
        from public.payment_provider_events e where e.outcome = 'failed' and e.processed_at is null and e.received_at < now() - interval '30 minutes'
      union all
      select 'event_unprocessed', 'provider_event', e.id::text, 'warning', e.event_type || ' ' || coalesce(e.reference, e.event_id) || ' was stored at ' || e.received_at || ' and never processed'
        from public.payment_provider_events e where e.outcome is null and e.processed_at is null and e.received_at < now() - interval '15 minutes'
      union all
      select 'unmatched_charge', 'payment_reference', coalesce(e.reference, e.event_id), 'critical',
             'Paystack reported a successful charge of ' || coalesce(round((e.payload -> 'data' ->> 'amount')::numeric / 100, 2)::text, '?') || ' NGN that no payment intent recognises (received ' || e.received_at || ')'
        from public.payment_provider_events e
       where e.event_type = 'charge.success' and e.outcome = 'ignored'
         and not exists (select 1 from public.payment_intents i where i.reference = e.reference);
    v_results := v_results || public._recon_publish('events');

    select jsonb_build_object(
             'open_critical', count(*) filter (where severity = 'critical' and status in ('open', 'acknowledged')),
             'open_warning',  count(*) filter (where severity = 'warning'  and status in ('open', 'acknowledged')),
             'open_info',     count(*) filter (where severity = 'info'     and status in ('open', 'acknowledged')))
      into v_totals from public.reconciliation_findings;

    update public.reconciliation_runs set finished_at = now(), summary = jsonb_build_object('heavy', p_heavy, 'sources', v_results, 'totals', v_totals) where id = v_run;
    return jsonb_build_object('run_id', v_run, 'heavy', p_heavy, 'sources', v_results, 'totals', v_totals);
  end;
  $body$;
  $fn$;
end
$do$;

do $$
begin
  if has_function_privilege('anon', 'public.settle_payment_intent(text,text,text,bigint,text)', 'execute')
     or has_function_privilege('authenticated', 'public.settle_payment_intent(text,text,text,bigint,text)', 'execute') then
    raise exception 'settle_payment_intent must stay service_role only';
  end if;
  if not has_function_privilege('service_role', 'public.settle_payment_intent(text,text,text,bigint,text)', 'execute') then
    raise exception 'settle_payment_intent lost its service_role grant';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'settle_payment_intent') <> 1 then
    raise exception 'expected exactly one settle_payment_intent';
  end if;
end $$;
