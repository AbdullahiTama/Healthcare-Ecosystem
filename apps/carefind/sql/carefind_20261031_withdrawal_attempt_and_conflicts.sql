-- ============================================================================
-- 2026-10-31 - Withdrawal state machine: attempt marker, durable provider conflicts (H04 of the payment-security track)
--
-- WHAT CHANGES
--   1. mark_withdrawal_transfer_attempt / mark_business_withdrawal_transfer_attempt: the API calls this immediately
--      BEFORE it asks the provider to send the transfer, and does not call the provider unless it returned 'ok'. It moves
--      reserved -> processing. The states now mean:
--        reserved    funds held; NO provider transfer call was ever made (releasable at once)
--        processing  a transfer call was made or is in flight (released only on provider-confirmed non-payment)
--        completed / failed / reversed / refunded   as before
--      Before this change 'processing' was set only when the provider's answer came back, so a request stuck in
--      'reserved' could mean "never sent" OR "sent, the answer was lost", and a timeout alone could get funds released.
--      (There is no persisted 'requested' state: request and reservation are one atomic step, so it could never be seen.)
--   2. settle_withdrawal / settle_business_withdrawal (same signatures) now STAMP failure_reason with
--      conflict:paid_after_refund | conflict:failed_after_completed | conflict:amount_mismatch when the provider's report
--      contradicts what the books say. Before, that only reached a log line, and a possible double payout left no trace.
--   3. reconcile_withdrawals (same signature) reports those stamps as kind 'provider_conflict' (critical by default,
--      so the existing finance alert e-mail fires), and no longer calls an in-flight transfer without a code a problem
--      until it is overdue (processing_without_transfer: updated_at older than the stale window + 30 minutes).
--   4. Drops the stray pre-engine reject_business_withdrawal(uuid): it was re-created in production by an earlier
--      OTP-era migration after the engine had retired it. Inert (it needs a 'pending' status that cannot exist) but
--      it hand-edits a wallet balance and bypasses settle_business_withdrawal.
--
-- NOT APPLIED to production. Order: apply BEFORE deploying the code that calls the mark functions (the new code
-- stops without them: it refuses to start a transfer it could not mark). The drop is a plain DROP FUNCTION; if the
-- SQL tool stalls on it, run that one statement in the Supabase SQL editor.
-- After applying, re-read the catalog:
--   select proname, pg_get_function_identity_arguments(oid), proacl from pg_proc where proname in
--     ('mark_withdrawal_transfer_attempt','mark_business_withdrawal_transfer_attempt','settle_withdrawal',
--      'settle_business_withdrawal','reconcile_withdrawals','reject_business_withdrawal');
--   -> one row per name, {postgres=X/postgres,service_role=X/postgres}; reject_business_withdrawal absent.
-- Re-runnable.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.settle_withdrawal(text, text, uuid, bigint, text)') is null then raise exception 'apply carefind_20261008_withdrawal_engine first'; end if;
  if to_regprocedure('public.settle_business_withdrawal(text, text, uuid, bigint, text)') is null then raise exception 'apply carefind_20261008_withdrawal_engine first'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 1. The attempt marker
-- ---------------------------------------------------------------------------------------------
create or replace function public.mark_withdrawal_transfer_attempt(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare w public.withdrawal_requests%rowtype;
begin
  select * into w from public.withdrawal_requests where id = p_request_id for update;
  if not found then return 'not_found'; end if;
  if w.status = 'reserved' then
    update public.withdrawal_requests set status = 'processing', updated_at = now() where id = w.id;
    return 'ok';
  end if;
  if w.status = 'processing' then return 'ok'; end if;   -- a retry: the ORIGINAL mark time stays (it starts the provider window)
  return 'already_' || w.status;
end;
$$;

create or replace function public.mark_business_withdrawal_transfer_attempt(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare w public.business_withdrawal_requests%rowtype;
begin
  select * into w from public.business_withdrawal_requests where id = p_request_id for update;
  if not found then return 'not_found'; end if;
  if w.status = 'reserved' then
    update public.business_withdrawal_requests set status = 'processing', updated_at = now() where id = w.id;
    return 'ok';
  end if;
  if w.status = 'processing' then return 'ok'; end if;
  return 'already_' || w.status;
end;
$$;

revoke execute on function public.mark_withdrawal_transfer_attempt(uuid) from public, anon, authenticated;
revoke execute on function public.mark_business_withdrawal_transfer_attempt(uuid) from public, anon, authenticated;
grant  execute on function public.mark_withdrawal_transfer_attempt(uuid) to service_role;
grant  execute on function public.mark_business_withdrawal_transfer_attempt(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Settlement: same behaviour, plus a durable conflict stamp
-- ---------------------------------------------------------------------------------------------
create or replace function public.settle_withdrawal(
  p_outcome text, p_reference text default null, p_request_id uuid default null,
  p_amount_kobo bigint default null, p_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.withdrawal_requests%rowtype;
  v_from text;
  v_info jsonb;
begin
  if p_outcome not in ('success', 'failed', 'reversed') then raise exception 'unknown withdrawal outcome %', p_outcome; end if;
  if p_reference is null and p_request_id is null then raise exception 'a reference or a request id is required'; end if;

  if p_request_id is not null then
    select * into w from public.withdrawal_requests where id = p_request_id for update;
  else
    select * into w from public.withdrawal_requests where paystack_reference = p_reference for update;
  end if;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  v_from := w.status;
  v_info := jsonb_build_object('id', w.id, 'user_id', w.user_id, 'amount', w.amount, 'payout_kobo', w.payout_kobo, 'reference', w.paystack_reference, 'from_status', v_from);

  if p_outcome = 'success' then
    if v_from = 'completed' then return v_info || '{"result":"already_completed"}'; end if;
    if v_from in ('failed', 'refunded', 'reversed') then
      -- the provider says it paid something we already gave back: money is out AND refunded. Needs a human.
      update public.withdrawal_requests
         set failure_reason = case when coalesce(failure_reason, '') like '%conflict:paid_after_refund%' then failure_reason
                                   else concat_ws(' | ', failure_reason, 'conflict:paid_after_refund') end,
             updated_at = now()
       where id = w.id;
      return v_info || '{"result":"conflict_paid_after_refund"}';
    end if;
    if p_amount_kobo is not null and w.payout_kobo is not null and p_amount_kobo <> w.payout_kobo then
      update public.withdrawal_requests
         set failure_reason = case when coalesce(failure_reason, '') like '%conflict:amount_mismatch%' then failure_reason
                                   else concat_ws(' | ', failure_reason, 'conflict:amount_mismatch') end,
             updated_at = now()
       where id = w.id;
      return v_info || jsonb_build_object('result', 'amount_mismatch', 'provider_amount_kobo', p_amount_kobo);
    end if;
    update public.withdrawal_requests set status = 'completed', completed_at = now(), updated_at = now() where id = w.id;
    return v_info || '{"result":"completed"}';
  end if;

  -- failed / reversed: the money did not (or no longer does) reach the user -> give the coins back, exactly once
  if v_from = 'refunded' then return v_info || '{"result":"already_refunded"}'; end if;
  if v_from = 'completed' and p_outcome = 'failed' then
    update public.withdrawal_requests
       set failure_reason = case when coalesce(failure_reason, '') like '%conflict:failed_after_completed%' then failure_reason
                                 else concat_ws(' | ', failure_reason, 'conflict:failed_after_completed') end,
           updated_at = now()
     where id = w.id;
    return v_info || '{"result":"conflict_failed_after_completed"}';
  end if;

  if v_from in ('reserved', 'processing') then
    update public.withdrawal_requests set status = 'failed', failure_reason = coalesce(p_detail, p_outcome), updated_at = now() where id = w.id;
  elsif v_from = 'completed' then
    update public.withdrawal_requests set status = 'reversed', failure_reason = coalesce(p_detail, p_outcome), updated_at = now() where id = w.id;
  end if;

  perform public._post_coin_entry(w.user_id, w.amount, 'withdrawal_refund', 'wd_refund_' || w.id, null, jsonb_build_object('request_id', w.id, 'outcome', p_outcome));
  insert into public.transactions (user_id, type, amount, reference, status)
  select w.user_id, 'withdrawal_refund', w.amount, 'wd_refund_' || w.id, 'success'
   where not exists (select 1 from public.transactions where reference = 'wd_refund_' || w.id and type = 'withdrawal_refund');
  update public.withdrawal_requests set status = 'refunded', refunded_at = now(), updated_at = now() where id = w.id;
  return v_info || '{"result":"refunded"}';
end;
$$;

create or replace function public.settle_business_withdrawal(
  p_outcome text, p_reference text default null, p_request_id uuid default null,
  p_amount_kobo bigint default null, p_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.business_withdrawal_requests%rowtype;
  v_from text;
  v_info jsonb;
begin
  if p_outcome not in ('success', 'failed', 'reversed') then raise exception 'unknown withdrawal outcome %', p_outcome; end if;
  if p_reference is null and p_request_id is null then raise exception 'a reference or a request id is required'; end if;

  if p_request_id is not null then
    select * into w from public.business_withdrawal_requests where id = p_request_id for update;
  else
    select * into w from public.business_withdrawal_requests where paystack_reference = p_reference for update;
  end if;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  v_from := w.status;
  v_info := jsonb_build_object('id', w.id, 'business_id', w.business_id, 'amount', w.amount, 'payout_kobo', w.amount, 'reference', w.paystack_reference, 'from_status', v_from);

  if p_outcome = 'success' then
    if v_from = 'completed' then return v_info || '{"result":"already_completed"}'; end if;
    if v_from in ('failed', 'refunded', 'reversed') then
      update public.business_withdrawal_requests
         set failure_reason = case when coalesce(failure_reason, '') like '%conflict:paid_after_refund%' then failure_reason
                                   else concat_ws(' | ', failure_reason, 'conflict:paid_after_refund') end,
             updated_at = now()
       where id = w.id;
      return v_info || '{"result":"conflict_paid_after_refund"}';
    end if;
    if p_amount_kobo is not null and p_amount_kobo <> w.amount then
      update public.business_withdrawal_requests
         set failure_reason = case when coalesce(failure_reason, '') like '%conflict:amount_mismatch%' then failure_reason
                                   else concat_ws(' | ', failure_reason, 'conflict:amount_mismatch') end,
             updated_at = now()
       where id = w.id;
      return v_info || jsonb_build_object('result', 'amount_mismatch', 'provider_amount_kobo', p_amount_kobo);
    end if;
    update public.business_withdrawal_requests set status = 'completed', completed_at = now(), updated_at = now() where id = w.id;
    return v_info || '{"result":"completed"}';
  end if;

  if v_from = 'refunded' then return v_info || '{"result":"already_refunded"}'; end if;
  if v_from = 'completed' and p_outcome = 'failed' then
    update public.business_withdrawal_requests
       set failure_reason = case when coalesce(failure_reason, '') like '%conflict:failed_after_completed%' then failure_reason
                                 else concat_ws(' | ', failure_reason, 'conflict:failed_after_completed') end,
           updated_at = now()
     where id = w.id;
    return v_info || '{"result":"conflict_failed_after_completed"}';
  end if;

  if v_from in ('reserved', 'processing') then
    update public.business_withdrawal_requests set status = 'failed', failure_reason = coalesce(p_detail, p_outcome), updated_at = now() where id = w.id;
  elsif v_from = 'completed' then
    update public.business_withdrawal_requests set status = 'reversed', failure_reason = coalesce(p_detail, p_outcome), updated_at = now() where id = w.id;
  end if;

  update public.business_wallets set available_balance = available_balance + w.amount, updated_at = now() where business_id = w.business_id;
  insert into public.business_wallet_transactions (business_id, type, amount, reference, status)
  values (w.business_id, 'withdrawal_refund', w.amount, 'bwd_refund_' || w.id, 'confirmed');
  update public.business_withdrawal_requests set status = 'refunded', refunded_at = now(), updated_at = now() where id = w.id;
  return v_info || '{"result":"refunded"}';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Reconciliation: provider conflicts are findings, an in-flight transfer is not a problem until it is overdue
-- ---------------------------------------------------------------------------------------------
create or replace function public.reconcile_withdrawals(p_stale_minutes integer default 60)
returns table (kind text, app text, request_id uuid, detail text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- stuck: reserved/processing for longer than the stale window (the sweep should have settled it)
  select 'stuck'::text, 'carefind'::text, id, status || ' since ' || created_at::text from public.withdrawal_requests
   where status in ('reserved', 'processing') and created_at < now() - make_interval(mins => p_stale_minutes)
  union all
  select 'stuck', 'carehub', id, status || ' since ' || created_at::text from public.business_withdrawal_requests
   where status in ('reserved', 'processing') and created_at < now() - make_interval(mins => p_stale_minutes)
  union all
  -- refunded but no refund entry in the ledger
  select 'refunded_without_ledger', 'carefind', w.id, 'no coin_ledger withdrawal_refund' from public.withdrawal_requests w
   where w.status = 'refunded' and w.created_at >= public._withdrawal_cutover() and not exists (select 1 from public.coin_ledger l where l.user_id = w.user_id and l.kind = 'withdrawal_refund' and l.reference = 'wd_refund_' || w.id)
  union all
  select 'refunded_without_ledger', 'carehub', w.id, 'no withdrawal_refund transaction' from public.business_withdrawal_requests w
   where w.status = 'refunded' and w.created_at >= public._withdrawal_cutover() and not exists (select 1 from public.business_wallet_transactions t where t.type = 'withdrawal_refund' and t.reference = 'bwd_refund_' || w.id)
  union all
  -- a refund entry on a request that is not refunded (coins returned while the request still looks live or paid)
  select 'refund_without_refunded_status', 'carefind', w.id, 'ledger refund but status ' || w.status from public.withdrawal_requests w
   where w.status <> 'refunded' and exists (select 1 from public.coin_ledger l where l.user_id = w.user_id and l.kind = 'withdrawal_refund' and l.reference = 'wd_refund_' || w.id)
  union all
  select 'refund_without_refunded_status', 'carehub', w.id, 'ledger refund but status ' || w.status from public.business_withdrawal_requests w
   where w.status <> 'refunded' and exists (select 1 from public.business_wallet_transactions t where t.type = 'withdrawal_refund' and t.reference = 'bwd_refund_' || w.id)
  union all
  -- refunded amount differs from the amount reserved
  select 'refund_amount_mismatch', 'carefind', w.id, 'ledger ' || l.delta || ' vs request ' || w.amount from public.withdrawal_requests w
    join public.coin_ledger l on l.user_id = w.user_id and l.kind = 'withdrawal_refund' and l.reference = 'wd_refund_' || w.id where l.delta <> w.amount
  union all
  select 'refund_amount_mismatch', 'carehub', w.id, 'ledger ' || t.amount || ' vs request ' || w.amount from public.business_withdrawal_requests w
    join public.business_wallet_transactions t on t.type = 'withdrawal_refund' and t.reference = 'bwd_refund_' || w.id where t.amount <> w.amount
  union all
  -- a transfer call was marked but no transfer code arrived and it is long overdue: the sweep should have resolved it
  select 'processing_without_transfer', 'carefind', id, 'no transfer code since ' || updated_at::text from public.withdrawal_requests
   where status = 'processing' and paystack_transfer_code is null and updated_at < now() - make_interval(mins => p_stale_minutes + 30)
  union all
  select 'processing_without_transfer', 'carehub', id, 'no transfer code since ' || updated_at::text from public.business_withdrawal_requests
   where status = 'processing' and paystack_transfer_code is null and updated_at < now() - make_interval(mins => p_stale_minutes + 30)
  union all
  -- the provider's report contradicted the books (paid after a refund, failed after completed, wrong amount): a human decides
  select 'provider_conflict', 'carefind', id, failure_reason from public.withdrawal_requests where failure_reason like '%conflict:%'
  union all
  select 'provider_conflict', 'carehub', id, failure_reason from public.business_withdrawal_requests where failure_reason like '%conflict:%'
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Retire the stray pre-engine function
-- ---------------------------------------------------------------------------------------------
drop function if exists public.reject_business_withdrawal(uuid);
