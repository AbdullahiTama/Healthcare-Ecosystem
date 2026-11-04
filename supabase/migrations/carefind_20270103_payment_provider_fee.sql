-- carefind_20270103_payment_provider_fee
--
-- Status: NOT APPLIED. Tested on PGlite (scripts/db-tests/paymentProviderFee.pglite.mjs) against the live shape of
-- payment_intents and its guard as read on 2026-11-04. Apply only after review, then update this line with the
-- version and the verification evidence.
--
-- PROBLEM
--   Paystack keeps its processing fee (1.5%, plus N100 at N2,500 and above, capped at N2,000) before it pays money
--   into the bank, so a bank deposit is always smaller than the sum of the payments it covers. We never stored that
--   fee. Only payments confirmed by webhook kept it, buried in payment_provider_events.payload; payments confirmed by
--   the redirect callback or by reconciliation kept nothing. On 2026-11-04 10 of the 12 settled payments had no
--   recorded fee, so bank deposits could not be matched to payments exactly.
--
-- WHAT THIS DOES
--   1. payment_intents.provider_fee_kobo        the fee the provider kept, as the provider reported it (kobo).
--      payment_intents.provider_net_kobo        expected_amount - provider_fee_kobo: what the provider pays out to
--                                               the bank for this payment. Generated, so it can never drift.
--      payment_intents.provider_fee_recorded_at when the fee was stored.
--   2. The fee is write-once: a trigger refuses any change to a stored fee, and refuses a fee on insert.
--   3. record_payment_provider_fee(...) is the one writer. service_role only. It records the fee only for a payment
--      that was actually taken (settled, refunded or needs_refund), only when the provider, provider transaction id
--      and amount match the intent, and never overwrites a stored fee. It answers with an outcome word, never raises
--      for a business refusal, so a caller cannot fail a settlement over it.
--   4. list_intents_missing_provider_fee(provider, limit): settled/refunded provider payments with no stored fee,
--      newest first. service_role only. The reconciliation job's backfill step works through it.
--
-- WHO CALLS IT
--   packages/shared-payments settleByReference (webhook and redirect callback), right after settle_payment_intent;
--   reconcileProviderTransactions, for any payment in its 48-hour window that lacks a fee; and backfillProviderFees
--   (a reconciliation step, every 6 hours, up to 25 payments), which asks the provider about older ones. Together they
--   fill in every settled payment from before this change without a manual step.
--
-- APP IMPACT
--   Nothing changes in what customers are charged or what wallets are credited. Amounts are only recorded.
--   Until this is applied the app's call to record_payment_provider_fee fails; the app logs payment.fee_record_failed
--   and settles the payment exactly as before.
--
-- SECURITY IMPLICATIONS
--   No new access. payment_intents stays service_role only. The function is SECURITY DEFINER with a fixed
--   search_path, revoked from public, anon and authenticated, and granted only to service_role.
--
-- ROLLBACK
--   drop function public.list_intents_missing_provider_fee(text, integer);
--   drop function public.record_payment_provider_fee(text, text, text, bigint, bigint);
--   drop trigger payment_intents_fee_write_once on public.payment_intents;
--   drop function public.payment_intents_fee_write_once();
--   alter table public.payment_intents drop column provider_net_kobo, drop column provider_fee_recorded_at,
--     drop column provider_fee_kobo;

alter table public.payment_intents
  add column if not exists provider_fee_kobo bigint,
  add column if not exists provider_fee_recorded_at timestamptz;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'payment_intents' and column_name = 'provider_net_kobo') then
    alter table public.payment_intents
      add column provider_net_kobo bigint generated always as (expected_amount - provider_fee_kobo) stored;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_intents_provider_fee_range') then
    alter table public.payment_intents add constraint payment_intents_provider_fee_range
      check (provider_fee_kobo is null or (provider_fee_kobo >= 0 and provider_fee_kobo <= expected_amount));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_intents_provider_fee_pair') then
    alter table public.payment_intents add constraint payment_intents_provider_fee_pair
      check ((provider_fee_kobo is null) = (provider_fee_recorded_at is null));
  end if;
end $$;

comment on column public.payment_intents.provider_fee_kobo is
  'Kobo. The processing fee the provider kept from this payment, as the provider reported it. Write-once.';
comment on column public.payment_intents.provider_net_kobo is
  'Kobo. expected_amount - provider_fee_kobo: what the provider settles to the bank for this payment.';

-- A stored fee never changes; a new row never carries one.
create or replace function public.payment_intents_fee_write_once()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.provider_fee_kobo is not null or new.provider_fee_recorded_at is not null then
      raise exception 'a payment intent cannot be inserted with a provider fee' using errcode = '23514';
    end if;
    return new;
  end if;
  if old.provider_fee_kobo is not null
     and (new.provider_fee_kobo is distinct from old.provider_fee_kobo
          or new.provider_fee_recorded_at is distinct from old.provider_fee_recorded_at) then
    raise exception 'payment_intents.provider_fee_kobo cannot be changed once set' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_intents_fee_write_once on public.payment_intents;
create trigger payment_intents_fee_write_once
  before insert or update on public.payment_intents
  for each row execute function public.payment_intents_fee_write_once();

-- Outcomes: recorded, already_recorded, fee_conflict, unknown_reference, not_taken, provider_mismatch,
-- transaction_mismatch, amount_mismatch, invalid_fee.
create or replace function public.record_payment_provider_fee(
  p_reference text, p_provider text, p_provider_txn_id text, p_amount_kobo bigint, p_fee_kobo bigint
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.payment_intents%rowtype;
begin
  if p_fee_kobo is null or p_fee_kobo < 0 or p_amount_kobo is null or p_fee_kobo > p_amount_kobo then
    return 'invalid_fee';
  end if;

  select * into v from public.payment_intents where reference = p_reference for update;
  if not found then return 'unknown_reference'; end if;

  if v.status not in ('settled', 'refunded', 'needs_refund') then return 'not_taken'; end if;
  if v.provider is distinct from p_provider then return 'provider_mismatch'; end if;
  if v.provider_transaction_id is null or v.provider_transaction_id is distinct from p_provider_txn_id then
    return 'transaction_mismatch';
  end if;
  if v.expected_amount is distinct from p_amount_kobo then return 'amount_mismatch'; end if;

  if v.provider_fee_kobo is not null then
    return case when v.provider_fee_kobo = p_fee_kobo then 'already_recorded' else 'fee_conflict' end;
  end if;

  update public.payment_intents
     set provider_fee_kobo = p_fee_kobo, provider_fee_recorded_at = now()
   where id = v.id;
  return 'recorded';
end;
$$;

revoke all on function public.record_payment_provider_fee(text, text, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.record_payment_provider_fee(text, text, text, bigint, bigint) to service_role;

-- The backfill's work list: payments taken through this provider whose fee is not stored yet, newest first.
-- Only settled and refunded: their amount already matched at settlement, so the provider's answer can be recorded.
-- Wallet-funded purposes (*_wallet) have no provider charge and are never listed.
create or replace function public.list_intents_missing_provider_fee(p_provider text, p_limit integer default 25)
returns table (reference text, provider_transaction_id text, expected_amount bigint, status text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.reference, i.provider_transaction_id, i.expected_amount, i.status
    from public.payment_intents i
   where i.provider = p_provider
     and i.status in ('settled', 'refunded')
     and i.provider_fee_kobo is null
     and i.provider_transaction_id is not null
     and i.purpose not like '%\_wallet'
   order by i.settled_at desc nulls last, i.created_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 200);
$$;

revoke all on function public.list_intents_missing_provider_fee(text, integer) from public, anon, authenticated;
grant execute on function public.list_intents_missing_provider_fee(text, integer) to service_role;
revoke all on function public.payment_intents_fee_write_once() from public, anon, authenticated;

-- Verify
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_intents' and column_name = 'provider_net_kobo' and is_generated = 'ALWAYS') then
    raise exception 'verify: provider_net_kobo is missing or not generated';
  end if;
  if has_function_privilege('authenticated', 'public.record_payment_provider_fee(text, text, text, bigint, bigint)', 'execute')
     or has_function_privilege('anon', 'public.record_payment_provider_fee(text, text, text, bigint, bigint)', 'execute') then
    raise exception 'verify: record_payment_provider_fee is callable by a client role';
  end if;
end $$;
