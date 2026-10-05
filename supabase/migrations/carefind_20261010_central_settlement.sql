-- Financial program, Phase 10: ONE settlement engine.
--
-- Until now the shop settled money a second way: verify_shop_payment() marked an order paid after Node had checked
-- Paystack ("here we trust the reference presence"), claim_payment_event() de-duplicated deliveries, and the webhook dispatched
-- by the METADATA of the gateway event (anything the payer put in `metadata` could pick the handler). Every purpose now settles
-- through settle_payment_intent(): verify provider, currency and amount against the intent recorded BEFORE checkout, lock the
-- intent, settle exactly once, dispatch to one private handler.
--
--   * shop_order joins the engine (_settle_shop_order): the order must belong to the intent's customer and vendor, be payable,
--     and its total must still equal the amount recorded; the order, the payment attempt ledger (shop_payments), the status
--     history and the customer notice are written in the one transaction. A payment that cannot be applied (order already paid,
--     cancelled, total changed) becomes needs_refund and is refunded by the refund engine (Phase 09).
--   * Retired: verify_shop_payment, claim_payment_event (closes F-28: it was executable by any signed-in user), settle_card_booking
--     (the pre-engine booking settlement).
--   * The per-purpose money primitives (credit_wallet_topup, settle_subscription_payment, settle_consultation_payment,
--     renew_business_plan, fn_credit_business_booking) are now ENGINE INTERNALS: EXECUTE is revoked from every API role, so no
--     application code can settle money any other way. The engine's handlers are SECURITY DEFINER and keep calling them.
-- Commercial rules are unchanged (the shop commission schedule is stored on the order at creation and is not touched here).

do $$
begin
  if to_regprocedure('public.settle_payment_intent(text,text,text,bigint,text)') is null then raise exception 'apply the settlement engine first'; end if;
  if to_regprocedure('public._settle_plan_renewal(public.payment_intents)') is null then raise exception 'apply carefind_20261006_settle_plan_and_carehub_appointments first'; end if;
  if to_regclass('public.shop_orders') is null or to_regclass('public.shop_payments') is null then raise exception 'shop tables are missing'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The shop handler (private)
-- ---------------------------------------------------------------------------------------------
create or replace function public._settle_shop_order(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.shop_orders%rowtype;
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

  insert into public.shop_order_status_history (order_id, from_status, to_status, changed_by, note)
  values (o.id, o.status, 'paid', null, 'Payment verified ' || i.reference);

  insert into public.notifications (recipient_id, type, message, link)
  values (o.customer_id, 'shop_payment', 'Payment confirmed for order ' || o.order_ref, '/orders/' || o.id::text);

  return jsonb_build_object('ok', true, 'order_id', o.id, 'order_ref', o.order_ref, 'vendor_business_id', o.vendor_business_id, 'total_kobo', o.total_kobo);
end;
$$;

revoke all on function public._settle_shop_order(public.payment_intents) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- The engine, with the shop in its dispatch (same signature; CREATE OR REPLACE keeps the ACL)
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
      -- A CareFind appointment and a CareHub appointment are the same operation: credit the business from
      -- the amount actually paid, 80% held / 20% platform.
      when 'booking'              then public._settle_booking(i)
      when 'appointment'          then public._settle_booking(i)
      when 'plan_renewal'         then public._settle_plan_renewal(i)
      when 'shop_order'           then public._settle_shop_order(i)
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
-- Retire the second definitions; make the money primitives engine-internal
-- ---------------------------------------------------------------------------------------------
drop function if exists public.verify_shop_payment(uuid, text);
drop function if exists public.claim_payment_event(uuid, text, text, integer, jsonb);
drop function if exists public.settle_card_booking(uuid, text);

revoke execute on function public.credit_wallet_topup(uuid, integer, integer, text) from public, anon, authenticated, service_role;
revoke execute on function public.settle_subscription_payment(uuid, uuid, integer, integer, text) from public, anon, authenticated, service_role;
revoke execute on function public.settle_consultation_payment(uuid, uuid, numeric, text) from public, anon, authenticated, service_role;
revoke execute on function public.renew_business_plan(uuid, integer, integer, text) from public, anon, authenticated, service_role;
revoke execute on function public.fn_credit_business_booking(uuid, uuid, integer, integer, text) from public, anon, authenticated, service_role;

do $$
declare bad text;
begin
  -- the engine is still service_role only
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

  -- no second definition of settlement survives
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('verify_shop_payment', 'claim_payment_event', 'settle_card_booking', 'settle_shop_payment')) then
    raise exception 'a legacy settlement function survived';
  end if;

  -- the per-purpose primitives are engine internals: no API role may call them
  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('credit_wallet_topup', 'settle_subscription_payment', 'settle_consultation_payment', 'renew_business_plan', 'fn_credit_business_booking', '_settle_shop_order')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'));
  if bad is not null then raise exception 'settlement primitives still callable by an API role: %', bad; end if;
end $$;
