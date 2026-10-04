-- Financial program, Phase 06: CareHub payments go through the settlement engine.
--
-- The engine (Phase 04) settled CareFind payments only. Two more purposes join it:
--   * appointment   a CareHub appointment paid by card. Identical to a CareFind booking, so it uses the same
--                   handler: the business wallet is credited from the amount ACTUALLY paid (80% held, 20%
--                   platform), never from a coin-rounded fee (audit F-06).
--   * plan_renewal  a CareHub plan payment. The handler calls the existing renew_business_plan(): one
--                   definition of "renew a plan" (payment row claimed by its unique reference, expiry extended
--                   under the business row lock). Duplicate renewal is impossible: the engine settles an
--                   intent once, and plan_payments.reference is unique underneath. The first-payment
--                   determination inside renew_business_plan is still the old, racy one - the commission
--                   engine (Phase 07) replaces it in that one place.
-- Card money stays in kobo and is never converted to CareCoins here.
-- settle_payment_intent is replaced in place (same signature, grants kept); only the dispatch changed.

do $$
begin
  if to_regprocedure('public.settle_payment_intent(text,text,text,bigint,text)') is null then
    raise exception 'apply carefind_20261004_settle_payment_intent first';
  end if;
  if to_regprocedure('public.renew_business_plan(uuid,integer,integer,text)') is null then
    raise exception 'public.renew_business_plan is missing';
  end if;
end $$;

create or replace function public._settle_plan_renewal(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_months integer;
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
  -- Only a month or the annual option exist; plan prices are whole naira.
  if v_months is null or v_months not in (1, 12) or i.expected_amount % 100 <> 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_plan_intent');
  end if;
  if not exists (select 1 from public.businesses where id = i.business_id) then
    return jsonb_build_object('ok', false, 'reason', 'business_missing');
  end if;

  select * into r from public.renew_business_plan(i.business_id, v_months, (i.expected_amount / 100)::integer, i.reference);
  if r.already_processed then
    return jsonb_build_object('ok', false, 'reason', 'reference_already_used');
  end if;

  return jsonb_build_object('ok', true, 'payment_id', r.payment_id, 'new_expiry', r.new_expiry,
                            'is_first_payment', r.is_first_payment, 'months', v_months);
end;
$$;

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
      -- A CareFind appointment and a CareHub appointment are the same operation: credit the business from
      -- the amount actually paid, 80% held / 20% platform.
      when 'booking'              then public._settle_booking(i)
      when 'appointment'          then public._settle_booking(i)
      when 'plan_renewal'         then public._settle_plan_renewal(i)
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

revoke all on function public._settle_plan_renewal(public.payment_intents) from public, anon, authenticated, service_role;

do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('_settle_plan_renewal', 'settle_payment_intent')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if bad is not null then raise exception 'client roles can execute: %', bad; end if;

  if has_function_privilege('service_role', '_settle_plan_renewal(public.payment_intents)'::regprocedure, 'execute') then
    raise exception '_settle_plan_renewal must be private';
  end if;
  if not has_function_privilege('service_role', 'settle_payment_intent(text,text,text,bigint,text)'::regprocedure, 'execute') then
    raise exception 'service_role lost EXECUTE on settle_payment_intent';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'settle_payment_intent') <> 1 then
    raise exception 'expected exactly one settle_payment_intent';
  end if;
end $$;
