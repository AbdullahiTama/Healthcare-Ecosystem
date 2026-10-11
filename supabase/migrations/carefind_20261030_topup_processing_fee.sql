-- ============================================================================
-- 2026-10-30 - 10% processing fee on card top-ups (H03 of the payment-security hardening track)
--
-- Owner decision 2026-10-10: every card top-up carries a processing fee of 10%, ADDED ON TOP. The customer is charged the
-- listed price plus the fee and receives the full amount:
--   * CareCoin package (CareFind): N200 coin costs N220 and credits 1 whole coin (no rounding, coins stay whole);
--   * business wallet (CareHub):   a N10,000 top-up costs N11,000 and credits N10,000.
-- The intent's expected_amount is the TOTAL charged (the engine already compares the provider's paid amount to it
-- exactly); the API records the base and the fee beside it in the intent's metadata:
--   metadata.base_amount_kobo, metadata.fee_kobo, metadata.fee_rate
--
-- WHAT THIS MIGRATION DOES
--   1. financial_config.topup_processing_fee_rate = 0.10 (the API reads it on every top-up; 0 turns the fee off).
--   2. _settle_business_wallet_topup credits the BASE, never the total: before this change the wallet was credited
--      i.expected_amount, which would now include the fee. It refuses (needs_refund 'topup_amount_mismatch') an intent
--      whose base + fee does not equal what was charged. Intents without the metadata (created before this change) are
--      credited their full expected amount, exactly as before.
--   3. _settle_wallet_topup (CareCoins) applies the same consistency check; coins still come from the intent's coins.
-- Both functions keep their signature and their (no-grant) ACL: `create or replace` of the same signature leaves no
-- sibling. Nothing else changes: no table, no other function, no commercial rate other than the new row.
--
-- NOT APPLIED to production. ORDER: apply this BEFORE deploying the code that charges the fee; until the new code is live
-- the old initiators create intents without the metadata and are credited as before. Verify afterwards:
--   select proname, proacl from pg_proc where proname in ('_settle_wallet_topup','_settle_business_wallet_topup');
--     -> one row each, {postgres=X/postgres} only (nobody else may execute them)
--   select key, value from financial_config where key = 'topup_processing_fee_rate';   -- 0.10
-- Re-runnable.
-- ============================================================================

do $$
begin
  if to_regclass('public.financial_config') is null then raise exception 'apply the financial foundation first (financial_config)'; end if;
  if to_regprocedure('public._settle_wallet_topup(public.payment_intents)') is null then raise exception 'apply carefind_20261005_coin_writers_use_ledger first'; end if;
  if to_regprocedure('public._settle_business_wallet_topup(public.payment_intents)') is null then raise exception 'apply carefind_20261020_wallet_spend_and_topup first'; end if;
end $$;

insert into public.financial_config (key, value, unit, description) values
  ('topup_processing_fee_rate', 0.10, 'ratio', 'Processing fee added on top of every card top-up (CareCoin packages and CareHub wallet), as a ratio of the amount the customer receives. 0 disables.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- CareHub business wallet: credit the base, not the total
-- ---------------------------------------------------------------------------------------------
create or replace function public._settle_business_wallet_topup(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_credit bigint;
  v_base   bigint;
  v_fee    bigint;
  v_new    integer;
begin
  if i.business_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_topup_intent');
  end if;

  v_credit := i.expected_amount;
  if i.metadata ? 'base_amount_kobo' then
    begin
      v_base := (i.metadata ->> 'base_amount_kobo')::bigint;
      v_fee  := coalesce((i.metadata ->> 'fee_kobo')::bigint, 0);
    exception when others then
      return jsonb_build_object('ok', false, 'reason', 'topup_amount_mismatch');
    end;
    if v_base is null or v_base <= 0 or v_fee < 0 or v_base + v_fee <> i.expected_amount then
      return jsonb_build_object('ok', false, 'reason', 'topup_amount_mismatch');
    end if;
    v_credit := v_base;
  end if;

  insert into public.business_wallet_transactions (business_id, type, amount, reference, status)
  values (i.business_id, 'topup', v_credit, i.reference, 'confirmed')
  on conflict (reference) where type = 'topup' do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'reference_already_used');
  end if;

  update public.business_wallets
     set available_balance = available_balance + v_credit, updated_at = now()
   where business_id = i.business_id
  returning available_balance into v_new;
  if not found then
    -- wallet row must exist for a business that can spend; create it so top-up never fails
    insert into public.business_wallets (business_id, available_balance)
    values (i.business_id, v_credit)
    returning available_balance into v_new;
  end if;

  return jsonb_build_object('ok', true, 'business_id', i.business_id, 'new_available', v_new,
                            'credited_kobo', v_credit, 'fee_kobo', coalesce(v_fee, 0));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- CareFind CareCoins: same consistency check; coins still come from the intent
-- ---------------------------------------------------------------------------------------------
create or replace function public._settle_wallet_topup(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_coins   integer;
  v_base    bigint;
  v_fee     bigint;
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

  if i.metadata ? 'base_amount_kobo' then
    begin
      v_base := (i.metadata ->> 'base_amount_kobo')::bigint;
      v_fee  := coalesce((i.metadata ->> 'fee_kobo')::bigint, 0);
    exception when others then
      return jsonb_build_object('ok', false, 'reason', 'topup_amount_mismatch');
    end;
    if v_base is null or v_base <= 0 or v_fee < 0 or v_base + v_fee <> i.expected_amount then
      return jsonb_build_object('ok', false, 'reason', 'topup_amount_mismatch');
    end if;
  end if;

  -- Claim the reference first: the history row and the credit are one unit. naira_amount is what the card was charged.
  insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
  values (i.customer_id, 'topup', v_coins, (i.expected_amount / 100)::integer, i.reference, 'success')
  on conflict (reference) where type = 'topup' do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'reference_already_used');
  end if;

  v_balance := public._post_coin_entry(i.customer_id, v_coins, 'topup', i.reference, null, jsonb_build_object('intent_id', i.id));
  return jsonb_build_object('ok', true, 'coins', v_coins, 'new_balance', v_balance, 'fee_kobo', coalesce(v_fee, 0));
end;
$$;

-- create or replace keeps the existing ACL; state it again so the file is self-describing (nobody but the owner executes these).
revoke all on function public._settle_business_wallet_topup(public.payment_intents) from public, anon, authenticated, service_role;
revoke all on function public._settle_wallet_topup(public.payment_intents) from public, anon, authenticated, service_role;
