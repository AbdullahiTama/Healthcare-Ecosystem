-- Financial program, vendor payout model for shop sales (owner: "lets build the vendor model", recommendation of 2026-10-05).
--
-- Before this, a paid shop order moved no money to anyone: the vendor had no wallet balance for it and no way to be paid.
-- Now the vendor's share of a PAID order is credited to the same business wallet bookings use, and is paid out through the
-- existing PIN-protected withdrawal engine:
--
--   paid       held_balance      += subtotal - commission              (ledger 'shop_credit', one per order)
--   delivered + return window    held -> available                     (ledger 'shop_release', swept by cron)
--   refund / return              the vendor's share is taken back at REQUEST (released credits from available first, held
--                                credits from held first; never below zero, a shortfall is recorded) and restored exactly
--                                if the provider fails the refund - the same rules as a booking refund
--
-- The fulfilment fee stays with the platform; the delivery fee is not the vendor's; platform promo discounts are absorbed by the
-- platform (the vendor still earns subtotal - commission). Commission was fixed when the order was created (20% flat for new
-- orders), so the credit never recomputes it.
--
-- The refund engine gains a third entity: refunds of shop orders (causes shop_return and order_cancelled), full or partial,
-- with the vendor's recovery pro rata. cancel_shop_order and process_shop_return now start a refund for paid orders (before this
-- a cancelled or "refunded" order kept the customer's money: process_shop_return approve only flipped statuses).
--
-- Existing paid orders are NOT credited automatically: they were marked paid by the previous flow, which did not verify the
-- payment with the provider. reconcile_shop_vendor_credits() lists them for a human decision.

do $$
begin
  if to_regprocedure('public.request_refund(text,text,uuid,uuid,text,boolean)') is null then raise exception 'apply carefind_20261009_refund_engine first'; end if;
  if to_regprocedure('public._settle_shop_order(public.payment_intents)') is null then raise exception 'apply carefind_20261010_central_settlement first'; end if;
  if to_regprocedure('public.financial_no_truncate()') is null then raise exception 'apply carefind_20261003_payment_intents_foundation first'; end if;
  if to_regclass('public.business_wallets') is null or to_regclass('public.shop_order_returns') is null then raise exception 'wallet or shop tables missing'; end if;
end $$;

insert into public.financial_config (key, value, unit, description) values
  ('shop_vendor_return_window_days', 7, 'days', 'How long after delivery the vendor''s share of a shop order stays held. Equals the customer return window (request_shop_return).'),
  ('shop_vendor_cutover_epoch', extract(epoch from now()), 'epoch', 'When vendor credits went live; paid orders older than this have no credit and are listed for a decision.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- One credit per paid order
-- ---------------------------------------------------------------------------------------------
create table public.shop_vendor_credits (
  order_id          uuid primary key references public.shop_orders(id),
  business_id       uuid not null,
  amount_kobo       integer not null,
  commission_kobo   integer not null,
  status            text not null default 'held',
  reversed_kobo     integer not null default 0,     -- taken back by refunds (including any shortfall)
  released_kobo     integer not null default 0,     -- moved held -> available by the release sweep
  release_shortfall_kobo integer not null default 0,
  credited_at       timestamptz not null default now(),
  released_at       timestamptz,
  reversed_at       timestamptz,
  constraint shop_vendor_credits_amount_positive check (amount_kobo > 0 and commission_kobo >= 0),
  constraint shop_vendor_credits_status_check check (status in ('held', 'released', 'reversed')),
  constraint shop_vendor_credits_reversed_bounds check (reversed_kobo >= 0 and reversed_kobo <= amount_kobo and released_kobo >= 0 and release_shortfall_kobo >= 0)
);
comment on table public.shop_vendor_credits is 'The vendor''s share of each paid shop order. Server-only; written by _settle_shop_order, release_shop_vendor_credits, request_refund and settle_refund.';
create index shop_vendor_credits_business_idx on public.shop_vendor_credits (business_id);
create index shop_vendor_credits_held_idx on public.shop_vendor_credits (credited_at) where status = 'held';

create or replace function public.shop_vendor_credits_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_mutable text[] := array['status', 'reversed_kobo', 'released_kobo', 'release_shortfall_kobo', 'released_at', 'reversed_at'];
begin
  if tg_op = 'DELETE' then raise exception 'vendor credits are never deleted' using errcode = '42501'; end if;
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'a vendor credit''s order, vendor and amounts are immutable' using errcode = '23514';
  end if;
  if new.reversed_kobo < old.reversed_kobo and new.status = 'reversed' then
    raise exception 'a reversal cannot shrink while reversed' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger shop_vendor_credits_guard before update or delete on public.shop_vendor_credits for each row execute function public.shop_vendor_credits_guard();
create trigger shop_vendor_credits_no_truncate before truncate on public.shop_vendor_credits for each statement execute function public.financial_no_truncate();

alter table public.shop_vendor_credits enable row level security;
revoke all on table public.shop_vendor_credits from public, anon, authenticated, service_role;

create unique index business_wallet_tx_shop_ref_uniq on public.business_wallet_transactions (reference) where type in ('shop_credit', 'shop_release');

-- ---------------------------------------------------------------------------------------------
-- The shop handler now also credits the vendor, in the same transaction as the payment
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
  insert into public.business_wallets (business_id, held_balance, available_balance)
  values (o.vendor_business_id, v_credit, 0)
  on conflict (business_id) do update set held_balance = public.business_wallets.held_balance + v_credit, updated_at = now();
  insert into public.business_wallet_transactions (business_id, type, amount, reference, status)
  values (o.vendor_business_id, 'shop_credit', v_credit, 'shopcr_' || o.id, 'confirmed');

  insert into public.shop_order_status_history (order_id, from_status, to_status, changed_by, note)
  values (o.id, o.status, 'paid', null, 'Payment verified ' || i.reference);

  insert into public.notifications (recipient_id, type, message, link)
  values (o.customer_id, 'shop_payment', 'Payment confirmed for order ' || o.order_ref, '/orders/' || o.id::text);

  return jsonb_build_object('ok', true, 'order_id', o.id, 'order_ref', o.order_ref, 'vendor_business_id', o.vendor_business_id, 'total_kobo', o.total_kobo, 'vendor_credit_kobo', v_credit);
end;
$$;
revoke all on function public._settle_shop_order(public.payment_intents) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Release: held -> available once delivered + the return window, no open return or refund
-- ---------------------------------------------------------------------------------------------
create or replace function public.release_shop_vendor_credits(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window interval := make_interval(days => public._fin_cfg('shop_vendor_return_window_days')::integer);
  r record;
  o public.shop_orders%rowtype;
  c public.shop_vendor_credits%rowtype;
  v_amount integer;
  v_held integer;
  v_move integer;
  v_released integer := 0;
  v_kobo bigint := 0;
  v_partial integer := 0;
begin
  for r in
    select c2.order_id
      from public.shop_vendor_credits c2
      join public.shop_orders o2 on o2.id = c2.order_id
     where c2.status = 'held' and c2.amount_kobo > c2.reversed_kobo and o2.status = 'delivered'
       and (select min(h.created_at) from public.shop_order_status_history h where h.order_id = c2.order_id and h.to_status = 'delivered') <= now() - v_window
     order by c2.credited_at
     limit greatest(1, least(p_limit, 1000))
  loop
    -- order first, then credit, then wallet: the same order a refund takes
    select * into o from public.shop_orders where id = r.order_id for update;
    select * into c from public.shop_vendor_credits where order_id = r.order_id for update;
    if o.status is distinct from 'delivered' or c.status <> 'held' then continue; end if;
    if exists (select 1 from public.refunds f where f.entity_type = 'shop_order' and f.entity_id = o.id and f.status in ('requested', 'processing')) then continue; end if;
    if exists (select 1 from public.shop_order_returns sr where sr.order_id = o.id and sr.status = 'requested') then continue; end if;

    v_amount := c.amount_kobo - c.reversed_kobo;
    select held_balance into v_held from public.business_wallets where business_id = c.business_id for update;
    v_move := least(v_amount, coalesce(v_held, 0));
    if v_move < v_amount then v_partial := v_partial + 1; end if;
    if v_move > 0 then
      update public.business_wallets set held_balance = held_balance - v_move, available_balance = available_balance + v_move, updated_at = now() where business_id = c.business_id;
      insert into public.business_wallet_transactions (business_id, type, amount, reference, status)
      values (c.business_id, 'shop_release', v_move, 'shoprl_' || c.order_id, 'confirmed');
    end if;
    update public.shop_vendor_credits
       set status = 'released', released_kobo = v_move, release_shortfall_kobo = v_amount - v_move, released_at = now()
     where order_id = c.order_id;
    v_released := v_released + 1;
    v_kobo := v_kobo + v_move;
  end loop;
  return jsonb_build_object('released', v_released, 'released_kobo', v_kobo, 'partial', v_partial);
end;
$$;
revoke all on function public.release_shop_vendor_credits(integer) from public, anon, authenticated, service_role;
grant execute on function public.release_shop_vendor_credits(integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Refunds of shop orders
-- ---------------------------------------------------------------------------------------------
alter table public.refunds drop constraint refunds_cause_check;
alter table public.refunds add constraint refunds_cause_check check (cause in ('booking_cancelled', 'admin_refund', 'needs_refund_intent', 'shop_return', 'order_cancelled'));
alter table public.refunds drop constraint refunds_entity_type_check;
alter table public.refunds add constraint refunds_entity_type_check check (entity_type in ('appointment', 'payment_intent', 'shop_order'));

-- new optional amount: a partial return. (A new signature, so the old one goes: no overload may keep the old behaviour.)
drop function public.request_refund(text, text, uuid, uuid, text, boolean);
create function public.request_refund(
  p_cause text, p_entity_type text, p_entity_id uuid,
  p_requested_by uuid default null, p_reason text default null, p_platform_funded boolean default false,
  p_amount_kobo bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_ref text := 'rf_' || replace(v_id::text, '-', '');
  a public.appointments%rowtype;
  i public.payment_intents%rowtype;
  o public.shop_orders%rowtype;
  sc public.shop_vendor_credits%rowtype;
  v_kind text;
  v_amount bigint;
  v_coins integer;
  v_credit integer;
  v_commission integer;
  v_held integer;
  v_avail integer;
  v_take_held integer := 0;
  v_take_avail integer := 0;
  v_shortfall integer := 0;
  v_due integer;
  v_existing public.refunds%rowtype;
begin
  if p_cause not in ('booking_cancelled', 'admin_refund', 'needs_refund_intent', 'shop_return', 'order_cancelled') then raise exception 'unknown refund cause %', p_cause; end if;
  if p_amount_kobo is not null and p_cause not in ('shop_return', 'order_cancelled') then raise exception 'a partial amount is only for shop refunds'; end if;

  -- ---- a payment that could not be applied: refund it in full, recover nothing (nothing was credited) ----
  if p_cause = 'needs_refund_intent' then
    if p_entity_type is distinct from 'payment_intent' then raise exception 'needs_refund_intent refunds a payment_intent'; end if;
    select * into i from public.payment_intents where id = p_entity_id for update;
    if not found then return jsonb_build_object('outcome', 'not_found'); end if;
    if i.status = 'refunded' then return jsonb_build_object('outcome', 'already_refunded'); end if;
    if i.status <> 'needs_refund' then return jsonb_build_object('outcome', 'not_refundable', 'status', i.status); end if;
    v_amount := coalesce((i.metadata ->> 'paid_amount_kobo')::bigint, i.expected_amount);
    v_kind := case when p_platform_funded then 'platform_funded' else 'card' end;

    select * into v_existing from public.refunds where entity_type = 'payment_intent' and entity_id = i.id and status <> 'failed';
    if found then return jsonb_build_object('outcome', 'already_requested', 'id', v_existing.id, 'reference', v_existing.reference, 'status', v_existing.status); end if;

    insert into public.refunds (id, reference, kind, cause, entity_type, entity_id, payment_intent_id, provider, provider_transaction_reference,
                                customer_id, business_id, amount_kobo, reason, requested_by)
    values (v_id, v_ref, v_kind, p_cause, 'payment_intent', i.id, i.id, i.provider, i.reference, i.customer_id, i.business_id, v_amount, p_reason, p_requested_by);
    return jsonb_build_object('outcome', 'requested', 'id', v_id, 'reference', v_ref, 'kind', v_kind, 'amount_kobo', v_amount, 'provider_transaction_reference', i.reference);
  end if;

  -- ---- a paid shop order (return or cancellation): the card payment goes back, the vendor's share is taken back ----
  if p_cause in ('shop_return', 'order_cancelled') then
    if p_entity_type is distinct from 'shop_order' then raise exception '% refunds a shop_order', p_cause; end if;
    select * into o from public.shop_orders where id = p_entity_id for update;
    if not found then return jsonb_build_object('outcome', 'not_found'); end if;
    if o.payment_status = 'refunded' then return jsonb_build_object('outcome', 'already_refunded'); end if;
    if o.payment_status is distinct from 'paid' then return jsonb_build_object('outcome', 'not_paid'); end if;

    select * into v_existing from public.refunds where entity_type = 'shop_order' and entity_id = o.id and status <> 'failed';
    if found then return jsonb_build_object('outcome', 'already_requested', 'id', v_existing.id, 'reference', v_existing.reference, 'status', v_existing.status); end if;

    select * into i from public.payment_intents where entity_type = 'shop_order' and entity_id = o.id and status = 'settled' order by settled_at desc limit 1 for update;
    if not found then return jsonb_build_object('outcome', 'no_payment_to_refund'); end if;
    v_amount := coalesce(p_amount_kobo, i.expected_amount);
    if v_amount <= 0 or v_amount > i.expected_amount then raise exception 'refund amount % is outside 1..%', v_amount, i.expected_amount; end if;
    v_kind := case when p_platform_funded then 'platform_funded' else 'card' end;

    if v_kind <> 'platform_funded' then
      select * into sc from public.shop_vendor_credits where order_id = o.id for update;
      if found and sc.amount_kobo > sc.reversed_kobo then
        -- the vendor's share of what is refunded (the whole remaining share for a full refund)
        v_due := case when v_amount = i.expected_amount then sc.amount_kobo - sc.reversed_kobo
                      else least(sc.amount_kobo - sc.reversed_kobo, round(sc.amount_kobo::numeric * v_amount / i.expected_amount)::integer) end;
        select held_balance, available_balance into v_held, v_avail from public.business_wallets where business_id = o.vendor_business_id for update;
        if v_held is null then v_held := 0; v_avail := 0; end if;
        if sc.status = 'released' then
          v_take_avail := least(v_due, v_avail);
          v_take_held := least(v_due - v_take_avail, v_held);
        else
          v_take_held := least(v_due, v_held);
          v_take_avail := least(v_due - v_take_held, v_avail);
        end if;
        v_shortfall := v_due - v_take_held - v_take_avail;
        if v_take_held + v_take_avail > 0 then
          update public.business_wallets
             set held_balance = held_balance - v_take_held, available_balance = available_balance - v_take_avail, updated_at = now()
           where business_id = o.vendor_business_id;
          insert into public.business_wallet_transactions (business_id, type, amount, reference, status)
          values (o.vendor_business_id, 'refund_debit', -(v_take_held + v_take_avail), v_ref, 'confirmed');
        end if;
        update public.shop_vendor_credits
           set reversed_kobo = reversed_kobo + v_due,
               status = case when reversed_kobo + v_due >= amount_kobo then 'reversed' else status end,
               reversed_at = case when reversed_kobo + v_due >= amount_kobo then now() else reversed_at end
         where order_id = o.id;
      end if;
    end if;

    insert into public.refunds (id, reference, kind, cause, entity_type, entity_id, payment_intent_id, provider_transaction_reference, customer_id, business_id,
                                amount_kobo, business_recovered_held_kobo, business_recovered_available_kobo, business_shortfall_kobo, commission_kobo, reason, requested_by)
    values (v_id, v_ref, v_kind, p_cause, 'shop_order', o.id, i.id, i.reference, o.customer_id, o.vendor_business_id,
            v_amount, v_take_held, v_take_avail, v_shortfall, 0, p_reason, p_requested_by);
    return jsonb_build_object('outcome', 'requested', 'id', v_id, 'reference', v_ref, 'kind', v_kind, 'amount_kobo', v_amount,
                              'provider_transaction_reference', i.reference, 'business_shortfall_kobo', v_shortfall);
  end if;

  -- ---- a paid appointment ----
  if p_entity_type is distinct from 'appointment' then raise exception '% refunds an appointment', p_cause; end if;
  select * into a from public.appointments where id = p_entity_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if a.payment_status = 'refunded' then return jsonb_build_object('outcome', 'already_refunded'); end if;
  if a.payment_status is distinct from 'paid' then return jsonb_build_object('outcome', 'not_paid'); end if;

  select * into v_existing from public.refunds where entity_type = 'appointment' and entity_id = a.id and status <> 'failed';
  if found then return jsonb_build_object('outcome', 'already_requested', 'id', v_existing.id, 'reference', v_existing.reference, 'status', v_existing.status); end if;

  if a.payment_channel = 'card' then
    select * into i from public.payment_intents where entity_type = 'appointment' and entity_id = a.id and status = 'settled' order by settled_at desc limit 1 for update;
    if not found then return jsonb_build_object('outcome', 'no_payment_to_refund'); end if;
    v_amount := i.expected_amount;
    v_kind := case when p_platform_funded then 'platform_funded' else 'card' end;
  elsif a.payment_channel = 'carecoins' then
    if a.patient_user_id is null then return jsonb_build_object('outcome', 'no_payment_to_refund'); end if;
    select -delta into v_coins from public.coin_ledger where user_id = a.patient_user_id and kind = 'booking_payment' and reference = a.payment_reference;
    if v_coins is null or v_coins <= 0 then return jsonb_build_object('outcome', 'no_payment_to_refund'); end if;
    v_kind := 'carecoin';
  else
    -- POS / bank transfer / cash: the money never passed through the platform, so the platform cannot refund it
    return jsonb_build_object('outcome', 'not_refundable_by_platform', 'channel', a.payment_channel);
  end if;

  select amount into v_credit from public.business_wallet_transactions where appointment_id = a.id and type = 'booking_credit' limit 1;
  select amount into v_commission from public.platform_transactions where appointment_id = a.id and type = 'commission' limit 1;
  if v_credit is null then return jsonb_build_object('outcome', 'not_settled'); end if;

  -- take the business's share back: held first, then available, never below zero; the rest is a recorded shortfall
  if v_kind <> 'platform_funded' then
    select held_balance, available_balance into v_held, v_avail from public.business_wallets where business_id = a.business_id for update;
    if v_held is null then v_held := 0; v_avail := 0; end if;
    v_take_held := least(v_credit, v_held);
    v_take_avail := least(v_credit - v_take_held, v_avail);
    v_shortfall := v_credit - v_take_held - v_take_avail;
    if v_take_held + v_take_avail > 0 then
      update public.business_wallets
         set held_balance = held_balance - v_take_held, available_balance = available_balance - v_take_avail, updated_at = now()
       where business_id = a.business_id;
      insert into public.business_wallet_transactions (business_id, appointment_id, type, amount, reference, status)
      values (a.business_id, a.id, 'refund_debit', -(v_take_held + v_take_avail), v_ref, 'confirmed');
    end if;
  end if;

  insert into public.refunds (id, reference, kind, cause, entity_type, entity_id, payment_intent_id, provider_transaction_reference, customer_id, business_id,
                              amount_kobo, coins, business_recovered_held_kobo, business_recovered_available_kobo, business_shortfall_kobo, commission_kobo, reason, requested_by)
  values (v_id, v_ref, v_kind, p_cause, 'appointment', a.id, case when v_kind = 'carecoin' then null else i.id end,
          case when v_kind = 'carecoin' then null else i.reference end,
          coalesce(a.patient_user_id, i.customer_id), a.business_id,
          case when v_kind = 'carecoin' then null else v_amount end, case when v_kind = 'carecoin' then v_coins else null end,
          v_take_held, v_take_avail, v_shortfall, case when v_kind = 'card' then coalesce(v_commission, 0) else 0 end, p_reason, p_requested_by);

  if v_kind = 'carecoin' then
    -- the coins go back through the ledger in this same transaction
    perform public._post_coin_entry(a.patient_user_id, v_coins, 'booking_refund', 'appt_refund_' || a.id, null, jsonb_build_object('appointment_id', a.id, 'refund_id', v_id));
    insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
    values (a.patient_user_id, 'booking_refund', v_coins, (v_coins * 20000 / 100)::int, v_ref, 'success');
    update public.appointments set payment_status = 'refunded', refunded_at = now() where id = a.id;
    update public.refunds set status = 'completed', completed_at = now(), updated_at = now() where id = v_id;
    return jsonb_build_object('outcome', 'completed', 'id', v_id, 'reference', v_ref, 'kind', v_kind, 'coins', v_coins, 'business_shortfall_kobo', v_shortfall);
  end if;

  return jsonb_build_object('outcome', 'requested', 'id', v_id, 'reference', v_ref, 'kind', v_kind, 'amount_kobo', v_amount,
                            'provider_transaction_reference', i.reference, 'business_shortfall_kobo', v_shortfall);
end;
$$;
revoke all on function public.request_refund(text, text, uuid, uuid, text, boolean, bigint) from public, anon, authenticated, service_role;
grant execute on function public.request_refund(text, text, uuid, uuid, text, boolean, bigint) to service_role;

-- settle_refund: unchanged except for what completion / failure mean for a shop order
create or replace function public.settle_refund(
  p_outcome text, p_refund_id uuid default null, p_reference text default null,
  p_provider_refund_id text default null, p_transaction_reference text default null,
  p_amount_kobo bigint default null, p_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.refunds%rowtype;
  o public.shop_orders%rowtype;
  v_info jsonb;
begin
  if p_outcome not in ('processed', 'failed', 'processing') then raise exception 'unknown refund outcome %', p_outcome; end if;
  if p_refund_id is null and p_reference is null and p_provider_refund_id is null and p_transaction_reference is null then
    raise exception 'a refund id, reference, provider refund id or transaction reference is required';
  end if;

  if p_refund_id is not null then
    select * into r from public.refunds where id = p_refund_id for update;
  elsif p_reference is not null then
    select * into r from public.refunds where reference = p_reference for update;
  else
    -- the provider names its own refund id first; otherwise the payment it belongs to (one live refund per payment)
    select * into r from public.refunds
     where (p_provider_refund_id is not null and provider_refund_id = p_provider_refund_id)
        or (p_provider_refund_id is null and p_transaction_reference is not null and provider_transaction_reference = p_transaction_reference and status in ('requested', 'processing'))
     order by (status in ('requested', 'processing')) desc, created_at desc limit 1 for update;
    if not found and p_provider_refund_id is not null and p_transaction_reference is not null then
      select * into r from public.refunds where provider_transaction_reference = p_transaction_reference and status in ('requested', 'processing') order by created_at desc limit 1 for update;
    end if;
  end if;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  v_info := jsonb_build_object('id', r.id, 'reference', r.reference, 'kind', r.kind, 'entity_type', r.entity_type, 'entity_id', r.entity_id,
                               'amount_kobo', r.amount_kobo, 'customer_id', r.customer_id, 'from_status', r.status);

  if p_outcome = 'processing' then
    if r.status = 'requested' then
      update public.refunds set status = 'processing', provider_refund_id = coalesce(provider_refund_id, p_provider_refund_id), provider_status = 'processing', updated_at = now() where id = r.id;
      return v_info || '{"result":"processing"}';
    end if;
    return v_info || jsonb_build_object('result', 'already_' || r.status);
  end if;

  if p_outcome = 'processed' then
    if r.status = 'completed' then return v_info || '{"result":"already_completed"}'; end if;
    if r.status = 'failed' then return v_info || '{"result":"conflict_processed_after_failed"}'; end if;   -- money went back AND the business was restored
    if p_amount_kobo is not null and r.amount_kobo is not null and p_amount_kobo <> r.amount_kobo then
      return v_info || jsonb_build_object('result', 'amount_mismatch', 'provider_amount_kobo', p_amount_kobo);
    end if;
    update public.refunds
       set status = 'completed', completed_at = now(), updated_at = now(), provider_status = 'processed',
           provider_refund_id = coalesce(provider_refund_id, p_provider_refund_id)
     where id = r.id;
    if r.payment_intent_id is not null then
      update public.payment_intents set status = 'refunded' where id = r.payment_intent_id and status in ('settled', 'needs_refund');
    end if;
    if r.entity_type = 'appointment' then
      update public.appointments set payment_status = 'refunded', refunded_at = now() where id = r.entity_id and payment_status is distinct from 'refunded';
    end if;
    if r.entity_type = 'shop_order' then
      select * into o from public.shop_orders where id = r.entity_id for update;
      if found then
        if r.amount_kobo >= o.total_kobo then
          -- the whole payment went back: a cancelled order stays cancelled, anything else becomes refunded
          update public.shop_orders set payment_status = 'refunded', status = case when status = 'cancelled' then 'cancelled' else 'refunded' end, updated_at = now() where id = o.id;
          update public.shop_payments set status = 'refunded', updated_at = now() where order_id = o.id and status = 'success';
        elsif o.status = 'refund_requested' then
          update public.shop_orders set status = 'delivered', updated_at = now() where id = o.id;     -- a partial refund: the rest of the sale stands
        end if;
        insert into public.shop_order_status_history (order_id, from_status, to_status, changed_by, note)
        values (o.id, o.status, case when r.amount_kobo >= o.total_kobo and o.status <> 'cancelled' then 'refunded' when r.amount_kobo < o.total_kobo and o.status = 'refund_requested' then 'delivered' else o.status end,
                null, 'Refund completed ' || r.reference);
        insert into public.notifications (recipient_id, type, message, link)
        values (o.customer_id, 'shop_refund', 'Your refund for order ' || o.order_ref || ' has been processed.', '/orders/' || o.id::text);
      end if;
    end if;
    if r.commission_kobo > 0 then
      insert into public.platform_transactions (appointment_id, business_id, type, amount, reference)
      values (case when r.entity_type = 'appointment' then r.entity_id end, r.business_id, 'commission_reversal', -r.commission_kobo, 'rfc_' || r.id)
      on conflict (reference) where type = 'commission_reversal' do nothing;
    end if;
    return v_info || '{"result":"completed"}';
  end if;

  -- failed: the customer was NOT refunded; the entity stays paid and the business gets its share back, exactly
  if r.status = 'failed' then return v_info || '{"result":"already_failed"}'; end if;
  if r.status = 'completed' then return v_info || '{"result":"conflict_failed_after_completed"}'; end if;
  update public.refunds set status = 'failed', failed_at = now(), updated_at = now(), failure_reason = coalesce(p_detail, 'provider_failed'), provider_status = 'failed' where id = r.id;
  if r.business_recovered_held_kobo + r.business_recovered_available_kobo > 0 then
    update public.business_wallets
       set held_balance = held_balance + r.business_recovered_held_kobo, available_balance = available_balance + r.business_recovered_available_kobo, updated_at = now()
     where business_id = r.business_id;
    insert into public.business_wallet_transactions (business_id, appointment_id, type, amount, reference, status)
    values (r.business_id, case when r.entity_type = 'appointment' then r.entity_id end, 'refund_restore',
            r.business_recovered_held_kobo + r.business_recovered_available_kobo, 'rfr_' || r.id, 'confirmed');
  end if;
  if r.entity_type = 'shop_order' then
    -- the vendor's share is whole again (what this refund took back, shortfall included); an order waiting on a return is delivered again
    update public.shop_vendor_credits
       set reversed_kobo = greatest(0, reversed_kobo - (r.business_recovered_held_kobo + r.business_recovered_available_kobo + r.business_shortfall_kobo)),
           status = case when released_at is not null then 'released' else 'held' end,
           reversed_at = null
     where order_id = r.entity_id;
    update public.shop_orders set status = 'delivered', updated_at = now() where id = r.entity_id and status = 'refund_requested';
  end if;
  return v_info || '{"result":"failed"}';
end;
$$;
revoke all on function public.settle_refund(text, uuid, text, text, text, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.settle_refund(text, uuid, text, text, text, bigint, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- A cancelled paid order is refunded; an approved return starts the refund
-- ---------------------------------------------------------------------------------------------
create or replace function public.cancel_shop_order(p_order_id uuid, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_vendor uuid; v_customer uuid; v_ref text; v_pay text; v_is_buyer boolean; v_refund jsonb;
begin
  select status, vendor_business_id, customer_id, order_ref, payment_status into v_status, v_vendor, v_customer, v_ref, v_pay
    from shop_orders where id = p_order_id for update;
  if v_status is null then return 'not_found'; end if;
  if not (auth.role() = 'service_role' or public.is_platform_admin() or v_customer = auth.uid()
          or v_vendor in (select public.current_business_ids())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_status in ('delivered','cancelled','refunded') then return 'already_' || v_status; end if;

  v_is_buyer := v_customer = auth.uid() and not (auth.role() = 'service_role' or public.is_platform_admin() or v_vendor in (select public.current_business_ids()));
  if v_pay = 'paid' then
    -- a paid order is refunded, so the customer cannot cancel what is already on its way, nor an order with a return in progress
    if v_status in ('refund_requested', 'disputed') then raise exception 'A return or dispute is already in progress for this order'; end if;
    if v_is_buyer and v_status not in ('paid', 'accepted', 'processing') then
      raise exception 'This order has already been dispatched. Request a return once it is delivered.';
    end if;
  end if;

  perform shop_restore_inventory_on_cancel(p_order_id);
  update shop_orders set status = 'cancelled', updated_at = now() where id = p_order_id;
  update shop_payments set status = 'failed' where order_id = p_order_id and status = 'pending';
  insert into shop_order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_status, 'cancelled', auth.uid(), coalesce(p_reason, 'Cancelled'));

  if v_pay = 'paid' then
    v_refund := public.request_refund('order_cancelled', 'shop_order', p_order_id, auth.uid(), coalesce(p_reason, 'Order cancelled'), false, null);
    if (v_refund ->> 'outcome') not in ('requested', 'already_requested', 'completed') then
      raise exception 'The refund for this order could not be started (%)', v_refund ->> 'outcome';   -- rolls the cancellation back
    end if;
  end if;

  insert into notifications (recipient_id, type, message, link)
  values (v_customer, 'shop_cancelled', 'Order ' || v_ref || ' cancelled' || case when v_pay = 'paid' then '. Your refund is on its way.' else '' end, '/orders/' || p_order_id::text);
  insert into staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  values (v_vendor, null, true, 'shop_cancelled', 'Order ' || v_ref || ' cancelled',
          coalesce(p_reason, 'Customer cancelled'), '/dashboard/ecommerce/orders/' || p_order_id::text);
  return 'ok';
end;
$$;

create or replace function public.process_shop_return(p_return_id uuid, p_action text, p_notes text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_return record;
  v_order record;
  v_refund jsonb;
begin
  select * into v_return from shop_order_returns where id = p_return_id for update;
  if v_return is null then raise exception 'Return not found'; end if;

  if not exists (select 1 from businesses where id = v_return.vendor_business_id and lower(email) = lower(auth.email())) then
    raise exception 'Not authorized';
  end if;
  if v_return.status != 'requested' then raise exception 'Return is not pending'; end if;

  select * into v_order from shop_orders where id = v_return.order_id for update;

  if p_action = 'approve' then
    -- the refund is a real card refund through the refund engine (never more than the customer paid); the order stays
    -- "refund requested" until the provider confirms, when settle_refund marks it refunded
    v_refund := public.request_refund('shop_return', 'shop_order', v_return.order_id, auth.uid(), coalesce(p_notes, v_return.reason), false,
                                      least(v_return.refund_amount_kobo, v_order.total_kobo)::bigint);
    if (v_refund ->> 'outcome') not in ('requested', 'already_requested', 'completed') then
      raise exception 'The refund could not be started (%)', v_refund ->> 'outcome';
    end if;

    update shop_order_returns
       set status = 'approved', resolved_at = now(), resolved_by = auth.uid(), resolution_notes = p_notes, refund_method = 'original_payment'
     where id = p_return_id;
    perform shop_restore_inventory_on_cancel(v_return.order_id);

    insert into notifications (recipient_id, type, message, link)
    values (v_return.customer_id, 'return_approved',
      'Your return for order ' || v_order.order_ref || ' has been approved. Refund of ' || chr(8358) || (least(v_return.refund_amount_kobo, v_order.total_kobo) / 100)::text || ' will be processed.',
      '/orders/' || v_return.order_id::text);
    return 'approved';

  elsif p_action = 'reject' then
    update shop_order_returns
       set status = 'rejected', resolved_at = now(), resolved_by = auth.uid(), resolution_notes = p_notes
     where id = p_return_id;
    update shop_orders set status = 'delivered', updated_at = now() where id = v_return.order_id;
    insert into notifications (recipient_id, type, message, link)
    values (v_return.customer_id, 'return_rejected',
      'Your return for order ' || v_order.order_ref || ' has been rejected.' || coalesce(' Reason: ' || p_notes, ''),
      '/orders/' || v_return.order_id::text);
    return 'rejected';
  else
    raise exception 'Invalid action. Must be approve or reject';
  end if;
end;
$$;
-- both are called by signed-in users (the customer / the vendor); neither is for anon (the checks inside would refuse it anyway)
revoke all on function public.process_shop_return(uuid, text, text) from public, anon;
grant execute on function public.process_shop_return(uuid, text, text) to authenticated, service_role;
revoke all on function public.cancel_shop_order(uuid, text) from public, anon;
grant execute on function public.cancel_shop_order(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Reconciliation
-- ---------------------------------------------------------------------------------------------
create or replace function public.reconcile_shop_vendor_credits()
returns table (kind text, order_id uuid, detail text)
language sql
security definer
set search_path = public, pg_temp
as $$
  -- paid before credits existed: the previous flow did not verify the payment with the provider; a human decides
  select 'legacy_paid_order_without_credit', o.id, 'order ' || o.order_ref || ' paid ' || o.updated_at::date || ', vendor share ' || (o.subtotal_kobo - o.commission_kobo) || ' kobo'
    from public.shop_orders o
   where o.payment_status = 'paid' and o.status not in ('cancelled', 'refunded')
     and not exists (select 1 from public.shop_vendor_credits c where c.order_id = o.id)
     and o.updated_at < to_timestamp(public._fin_cfg('shop_vendor_cutover_epoch'))
  union all
  select 'paid_order_without_credit', o.id, 'order ' || o.order_ref || ' paid after vendor credits went live but has no credit'
    from public.shop_orders o
   where o.payment_status = 'paid' and o.status not in ('cancelled', 'refunded')
     and not exists (select 1 from public.shop_vendor_credits c where c.order_id = o.id)
     and o.updated_at >= to_timestamp(public._fin_cfg('shop_vendor_cutover_epoch'))
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
-- The migration verifies itself
-- ---------------------------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'request_refund';
  if v_n <> 1 then raise exception 'request_refund must exist exactly once, found %', v_n; end if;
  select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('request_refund', 'settle_refund', 'release_shop_vendor_credits', 'reconcile_shop_vendor_credits')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_n > 0 then raise exception 'a money function is executable by an API role'; end if;
  if has_function_privilege('anon', 'public.process_shop_return(uuid,text,text)', 'execute') or has_function_privilege('anon', 'public.cancel_shop_order(uuid,text)', 'execute') then
    raise exception 'anon can still execute a shop return or cancellation function';
  end if;
  if has_function_privilege('authenticated', 'public._settle_shop_order(public.payment_intents)', 'execute') then raise exception '_settle_shop_order must be private'; end if;
end $$;
