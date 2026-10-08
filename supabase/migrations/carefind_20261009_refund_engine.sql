-- Financial program, Phase 09: the refund engine.
--
-- Three kinds of refund, one table, one door:
--   card              the payer's money goes back through Paystack. The refund is `completed` ONLY when Paystack confirms
--                     it (refund.processed / the provider's own "processed" answer), never on our say-so.
--   carecoin          the payer's CareCoins go back through the coin ledger; completes in the same transaction.
--   platform_funded   a card refund the PLATFORM pays out of its own pocket (goodwill, dispute): the business keeps its
--                     money and the platform's commission is not reversed.
-- States:  requested -> processing -> completed      requested|processing -> failed (the entity stays paid)
--
-- What a refund of a booking does (owner policy confirmed 2026-10-05: full refund when the business cancels at any time or
-- the patient cancels >= 24h ahead, which cancel-appointment enforces; the platform absorbs Paystack's own fee):
--   * at REQUEST the business's share is taken back from its wallet, held balance first then available, never below
--     zero, with a ledger row; a shortfall (the business already withdrew it) is recorded on the refund, not turned
--     into a negative balance, and is flagged by reconcile_refunds();
--   * if the provider later FAILS the refund, the recovered amount is given back to the business, exactly;
--   * at COMPLETION the intent becomes `refunded`, the appointment becomes `refunded`, and the platform's commission
--     row is reversed.
-- Payments that could not be applied (payment_intents.status = needs_refund: wrong amount, already booked ...) are refunded
-- in full with cause `needs_refund_intent`; nothing was credited to anyone, so nothing is recovered.
--
-- Double refunds are impossible: one live refund per entity (partial unique index), the entity row is locked, a card refund
-- is addressed to Paystack by the payment's reference, and every outcome is replay-safe.
-- Replaces refund_appointment_payment (no callers; it refunded coins for card payments and skipped the wallet debit when
-- the business could not cover it).

do $$
begin
  if to_regprocedure('public._fin_cfg(text)') is null then raise exception 'apply carefind_20261004_settle_payment_intent first'; end if;
  if to_regprocedure('public._post_coin_entry(uuid,integer,text,text,uuid,jsonb)') is null then raise exception 'apply carefind_20261005_coin_ledger first'; end if;
  if to_regprocedure('public.financial_no_truncate()') is null then raise exception 'apply carefind_20261003_payment_intents_foundation first'; end if;
end $$;

-- cancel-appointment stamps cancelled_at, but production never received the migration that adds it (20260828_business_services
-- was applied without this column), so every cancellation failed with a database error. The refund reconciliation also needs it.
alter table public.appointments add column if not exists cancelled_at timestamptz;

insert into public.financial_config (key, value, unit, description) values
  ('refund_engine_cutover_epoch', extract(epoch from now()), 'epoch', 'When the refund engine went live; reconciliation of refunded appointments applies to refunds after it.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------------------------
create table public.refunds (
  id                       uuid primary key default gen_random_uuid(),
  reference                text not null,
  kind                     text not null,
  cause                    text not null,
  status                   text not null default 'requested',
  entity_type              text not null,
  entity_id                uuid not null,
  payment_intent_id        uuid,
  provider                 text not null default 'paystack',
  provider_transaction_reference text,                 -- the payment being refunded (card kinds)
  customer_id              uuid,
  business_id              uuid,
  amount_kobo              bigint,                     -- card kinds
  coins                    integer,                    -- carecoin
  business_recovered_held_kobo      integer not null default 0,
  business_recovered_available_kobo integer not null default 0,
  business_shortfall_kobo  integer not null default 0,
  commission_kobo          integer not null default 0, -- platform commission reversed on completion
  provider_refund_id       text,
  provider_status          text,
  failure_reason           text,
  reason                   text,
  requested_by             uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  completed_at             timestamptz,
  failed_at                timestamptz,

  constraint refunds_reference_key unique (reference),
  constraint refunds_kind_check check (kind in ('card', 'carecoin', 'platform_funded')),
  constraint refunds_cause_check check (cause in ('booking_cancelled', 'admin_refund', 'needs_refund_intent')),
  constraint refunds_status_check check (status in ('requested', 'processing', 'completed', 'failed')),
  constraint refunds_entity_type_check check (entity_type in ('appointment', 'payment_intent')),
  constraint refunds_amount_shape check (
    (kind = 'carecoin' and coins > 0 and amount_kobo is null)
    or (kind <> 'carecoin' and amount_kobo > 0 and coins is null and provider_transaction_reference is not null)),
  constraint refunds_recovery_nonnegative check (business_recovered_held_kobo >= 0 and business_recovered_available_kobo >= 0 and business_shortfall_kobo >= 0 and commission_kobo >= 0)
);
comment on table public.refunds is 'Every refund of customer money. Server-only; written only by request_refund / mark_refund_processing / settle_refund.';

create unique index refunds_one_live_per_entity on public.refunds (entity_type, entity_id) where status <> 'failed';
create unique index refunds_provider_refund_id_key on public.refunds (provider, provider_refund_id) where provider_refund_id is not null;
create index refunds_open_idx on public.refunds (created_at) where status in ('requested', 'processing');
create index refunds_txn_ref_idx on public.refunds (provider_transaction_reference) where provider_transaction_reference is not null;

create unique index business_wallet_tx_refund_ref_uniq on public.business_wallet_transactions (reference) where type in ('refund_debit', 'refund_restore');
create unique index platform_tx_commission_reversal_ref_uniq on public.platform_transactions (reference) where type = 'commission_reversal';

create or replace function public.refunds_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_mutable text[] := array['status', 'provider_refund_id', 'provider_status', 'failure_reason', 'completed_at', 'failed_at', 'updated_at', 'payment_intent_id'];
  v_allowed text[] := array['requested>processing', 'requested>completed', 'requested>failed', 'processing>completed', 'processing>failed'];
begin
  if tg_op = 'DELETE' then raise exception 'refunds are never deleted' using errcode = '42501'; end if;
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'a refund''s identity, amounts and recoveries are immutable' using errcode = '23514';
  end if;
  if old.provider_refund_id is not null and new.provider_refund_id is distinct from old.provider_refund_id then
    raise exception 'the provider refund linkage cannot be changed' using errcode = '23514';
  end if;
  if new.status is distinct from old.status and (old.status || '>' || new.status) <> all (v_allowed) then
    raise exception 'illegal refund status change % -> %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger refunds_guard before update or delete on public.refunds for each row execute function public.refunds_guard();
create trigger refunds_no_truncate before truncate on public.refunds for each statement execute function public.financial_no_truncate();

alter table public.refunds enable row level security;
revoke all on table public.refunds from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- request_refund: validates, locks, takes the business share back, creates the refund (once)
-- ---------------------------------------------------------------------------------------------
create or replace function public.request_refund(
  p_cause text, p_entity_type text, p_entity_id uuid,
  p_requested_by uuid default null, p_reason text default null, p_platform_funded boolean default false)
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
  v_existing public.refunds%rowtype;
begin
  if p_cause not in ('booking_cancelled', 'admin_refund', 'needs_refund_intent') then raise exception 'unknown refund cause %', p_cause; end if;

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

-- ---------------------------------------------------------------------------------------------
-- mark_refund_processing: the provider accepted the refund request (links it by exact id)
-- ---------------------------------------------------------------------------------------------
create or replace function public.mark_refund_processing(p_refund_id uuid, p_provider_refund_id text, p_provider_status text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r public.refunds%rowtype;
begin
  select * into r from public.refunds where id = p_refund_id for update;
  if not found then return 'not_found'; end if;
  if r.provider_refund_id is null and p_provider_refund_id is not null and p_provider_refund_id <> '' then
    update public.refunds set provider_refund_id = p_provider_refund_id, provider_status = coalesce(p_provider_status, provider_status), updated_at = now() where id = r.id;
  end if;
  if r.status = 'requested' then
    update public.refunds set status = 'processing', provider_status = coalesce(p_provider_status, provider_status), updated_at = now() where id = r.id;
    return 'ok';
  end if;
  if r.status = 'processing' then return 'ok'; end if;
  return 'already_' || r.status;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- settle_refund: the ONLY door for provider refund outcomes (webhook, sweep, the handler's own answer)
-- ---------------------------------------------------------------------------------------------
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
  return v_info || '{"result":"failed"}';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reconciliation
-- ---------------------------------------------------------------------------------------------
create or replace function public._refund_cutover()
returns timestamptz language sql stable set search_path = public, pg_temp
as $$ select to_timestamp(public._fin_cfg('refund_engine_cutover_epoch')) $$;

create or replace function public.reconcile_refunds(p_stale_minutes integer default 60)
returns table (kind text, refund_id uuid, entity_id uuid, detail text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select 'stuck'::text, r.id, r.entity_id, r.status || ' since ' || r.created_at::text from public.refunds r
   where r.status in ('requested', 'processing') and r.created_at < now() - make_interval(mins => p_stale_minutes)
  union all
  select 'needs_refund_without_refund', null::uuid, i.id, 'payment ' || i.reference || ' could not be applied and nobody has refunded it'
    from public.payment_intents i
   where i.status = 'needs_refund' and i.updated_at < now() - make_interval(mins => p_stale_minutes)
     and not exists (select 1 from public.refunds r where r.entity_type = 'payment_intent' and r.entity_id = i.id and r.status <> 'failed')
  union all
  select 'completed_but_intent_not_refunded', r.id, r.entity_id, 'intent ' || i.status from public.refunds r join public.payment_intents i on i.id = r.payment_intent_id
   where r.status = 'completed' and i.status <> 'refunded'
  union all
  select 'completed_but_appointment_not_refunded', r.id, r.entity_id, 'appointment ' || coalesce(a.payment_status, 'null') from public.refunds r join public.appointments a on a.id = r.entity_id
   where r.status = 'completed' and r.entity_type = 'appointment' and a.payment_status is distinct from 'refunded'
  union all
  select 'business_debit_missing', r.id, r.entity_id, 'no refund_debit ledger row' from public.refunds r
   where r.business_recovered_held_kobo + r.business_recovered_available_kobo > 0
     and not exists (select 1 from public.business_wallet_transactions t where t.type = 'refund_debit' and t.reference = r.reference)
  union all
  select 'failed_without_restore', r.id, r.entity_id, 'business share was not given back' from public.refunds r
   where r.status = 'failed' and r.business_recovered_held_kobo + r.business_recovered_available_kobo > 0
     and not exists (select 1 from public.business_wallet_transactions t where t.type = 'refund_restore' and t.reference = 'rfr_' || r.id)
  union all
  select 'restore_without_failed', r.id, r.entity_id, 'business share restored but refund is ' || r.status from public.refunds r
   where r.status <> 'failed' and exists (select 1 from public.business_wallet_transactions t where t.type = 'refund_restore' and t.reference = 'rfr_' || r.id)
  union all
  select 'carecoin_refund_without_ledger', r.id, r.entity_id, 'no booking_refund coin ledger entry' from public.refunds r
   where r.kind = 'carecoin' and r.status = 'completed'
     and not exists (select 1 from public.coin_ledger l where l.user_id = r.customer_id and l.kind = 'booking_refund' and l.reference = 'appt_refund_' || r.entity_id)
  union all
  select 'business_shortfall', r.id, r.entity_id, 'the business could not cover ' || r.business_shortfall_kobo || ' kobo; the platform bears it' from public.refunds r
   where r.business_shortfall_kobo > 0 and r.status <> 'failed'
  union all
  select 'cancelled_appointment_not_refunded', null::uuid, a.id, 'cancelled while paid by ' || a.payment_channel || ' and no refund exists' from public.appointments a
   where a.status = 'cancelled' and a.payment_status = 'paid' and a.payment_channel in ('card', 'carecoins')
     and a.cancelled_at < now() - make_interval(mins => p_stale_minutes)
     and not exists (select 1 from public.refunds r where r.entity_type = 'appointment' and r.entity_id = a.id and r.status <> 'failed')
  union all
  select 'refunded_appointment_without_refund', null::uuid, a.id, 'payment_status refunded with no completed refund' from public.appointments a
   where a.payment_status = 'refunded' and a.refunded_at >= public._refund_cutover()
     and not exists (select 1 from public.refunds r where r.entity_type = 'appointment' and r.entity_id = a.id and r.status = 'completed')
$$;

-- ---------------------------------------------------------------------------------------------
-- Retire the old function; access
-- ---------------------------------------------------------------------------------------------
drop function if exists public.refund_appointment_payment(uuid);

revoke all on function public.refunds_guard() from public, anon, authenticated, service_role;
revoke all on function public._refund_cutover() from public, anon, authenticated;
grant execute on function public._refund_cutover() to service_role;
revoke all on function public.request_refund(text, text, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.mark_refund_processing(uuid, text, text) from public, anon, authenticated;
revoke all on function public.settle_refund(text, uuid, text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.reconcile_refunds(integer) from public, anon, authenticated;
grant execute on function public.request_refund(text, text, uuid, uuid, text, boolean) to service_role;
grant execute on function public.mark_refund_processing(uuid, text, text) to service_role;
grant execute on function public.settle_refund(text, uuid, text, text, text, bigint, text) to service_role;
grant execute on function public.reconcile_refunds(integer) to service_role;

do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('refunds_guard', 'request_refund', 'mark_refund_processing', 'settle_refund', 'reconcile_refunds', '_refund_cutover')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if bad is not null then raise exception 'client roles can execute: %', bad; end if;
  if has_function_privilege('service_role', 'public.refunds_guard()', 'execute') then raise exception 'trigger function must be private'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'refund_appointment_payment') then raise exception 'legacy refund function survived'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'refunds' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')) then
    raise exception 'refunds must have no table grants';
  end if;
  if exists (select 1 from public.reconcile_refunds(60) where kind not in ('stuck', 'needs_refund_without_refund', 'cancelled_appointment_not_refunded')) then
    raise exception 'refunds do not reconcile; resolve before applying';
  end if;
end $$;
