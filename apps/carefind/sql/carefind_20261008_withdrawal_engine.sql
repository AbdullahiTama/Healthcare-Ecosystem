-- Financial program, Phase 08: the withdrawal engine (CareFind CareCoin withdrawals + CareHub business withdrawals).
--
-- ONE architecture for both apps:
--   states         reserved -> processing -> completed -> reversed
--                  reserved|processing -> failed -> refunded        (completed -> reversed -> refunded)
--                  ("requested" is the client's request before anything is stored: the row is created, and the
--                   money reserved, in ONE statement, so a request is never stored un-reserved.)
--   identity       the database creates the request row and its id; the Paystack reference is DERIVED from that id
--                  ('cf_wd_<id>' / 'ch_wd_<id>'). Nothing is ever looked up as "the latest pending row" and a
--                  caller can no longer supply (or reuse) a reference, which is what made F-01 possible.
--   reservation    atomic: balance check, daily cap, debit/reserve, ledger entry and request row in one transaction.
--                  The Paystack call happens AFTER it commits, with no lock held.
--   linkage        attach_*_transfer() records the provider's transfer/recipient codes by exact request id.
--   settlement     settle_*() is the ONLY door for provider outcomes (webhook, reconcile sweep, admin): success,
--                  failed, reversed. Every outcome is replay-safe; a refund can happen at most once (row lock +
--                  status machine + unique ledger key); a transfer reported successful for the wrong amount is not
--                  completed.
--   no direct writes   INSERT/UPDATE/DELETE/TRUNCATE are revoked from every role on both request tables; a trigger
--                  enforces the state machine and immutability of the money/identity columns.
-- Replaces: request_withdrawal, request_business_withdrawal (both overloads: F-16), reject_withdrawal_request,
-- reject_business_withdrawal, refund_business_withdrawal, approve_withdrawal_request, complete_withdrawal_transfer.
-- Commercial rules are unchanged (20% withdrawal fee, 1 coin = N200, minimum 5 coins, trust-tier daily caps, no fee on
-- business withdrawals). NEW rules, flagged for the owner: CareHub minimum withdrawal (provider floor N100) and a
-- N1,000,000 rolling 24h cap per business; both live in financial_config.
--
-- DEPLOY ORDER: apply this migration and deploy the matching CareFind + CareHub code TOGETHER. The old code calls
-- functions and statuses that no longer exist.

do $$
begin
  if to_regprocedure('public._fin_cfg(text)') is null then raise exception 'apply carefind_20261004_settle_payment_intent first'; end if;
  if to_regprocedure('public._post_coin_entry(uuid,integer,text,text,uuid,jsonb)') is null then raise exception 'apply carefind_20261005_coin_ledger first'; end if;
  if to_regprocedure('public.financial_no_truncate()') is null then raise exception 'apply carefind_20261003_payment_intents_foundation first'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------------------------
insert into public.financial_config (key, value, unit, description) values
  ('business_withdrawal_daily_cap_kobo', 100000000, 'kobo', 'Most a CareHub business may withdraw in any rolling 24 hours (N1,000,000). NEW rule (audit F-08).'),
  ('min_business_withdrawal_kobo',       10000,     'kobo', 'Smallest CareHub business withdrawal (N100, the provider transfer floor). NEW rule.'),
  ('withdrawal_engine_cutover_epoch',    extract(epoch from now()), 'epoch', 'When the withdrawal engine went live; ledger-consistency reconciliation applies to requests created after it (earlier ones predate the ledgers).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------------------------
alter table public.withdrawal_requests
  add column if not exists payout_kobo   bigint,
  add column if not exists failure_reason text,
  add column if not exists completed_at  timestamptz,
  add column if not exists refunded_at   timestamptz,
  add column if not exists updated_at    timestamptz not null default now();

alter table public.business_withdrawal_requests
  add column if not exists bank_code     text,
  add column if not exists initiated_by  uuid,
  add column if not exists failure_reason text,
  add column if not exists completed_at  timestamptz,
  add column if not exists refunded_at   timestamptz;

-- Existing rows move to the new state names. 'rejected'/'failed' rows were already refunded by the old functions.
update public.withdrawal_requests set status = case
    when status = 'rejected' then 'refunded'
    when status = 'approved' then 'processing'
    when status = 'pending' and paystack_transfer_code is not null then 'processing'
    when status = 'pending' or status is null then 'reserved'
    else status end;
update public.business_withdrawal_requests set status = case
    when status in ('rejected', 'failed') then 'refunded'
    when status = 'pending' and paystack_transfer_code is not null then 'processing'
    when status = 'pending' then 'reserved'
    else status end;

alter table public.withdrawal_requests alter column status set default 'reserved';
alter table public.withdrawal_requests alter column status set not null;
alter table public.business_withdrawal_requests alter column status set default 'reserved';

alter table public.withdrawal_requests
  add constraint withdrawal_requests_status_check check (status in ('reserved', 'processing', 'completed', 'failed', 'reversed', 'refunded')),
  add constraint withdrawal_requests_amount_positive check (amount > 0) not valid,
  -- legacy manual rows have no reference (and no payout_kobo); every engine-created row has both. A NOT VALID "reference is not null"
  -- check would still fire when such a legacy row is UPDATED, making it impossible to refund.
  add constraint withdrawal_requests_reference_present check (paystack_reference is not null or payout_kobo is null);
alter table public.business_withdrawal_requests
  add constraint business_withdrawal_requests_status_check check (status in ('reserved', 'processing', 'completed', 'failed', 'reversed', 'refunded')),
  add constraint business_withdrawal_requests_amount_positive check (amount > 0) not valid,
  add constraint business_withdrawal_requests_reference_present check (paystack_reference is not null or initiated_by is null);

-- One withdrawal ledger entry and one refund entry per request (the references are derived from the request id).
create unique index if not exists business_wallet_tx_withdrawal_ref_uniq
  on public.business_wallet_transactions (reference) where type in ('withdrawal', 'withdrawal_refund');

-- ---------------------------------------------------------------------------------------------
-- State machine + immutability (both tables)
-- ---------------------------------------------------------------------------------------------
create or replace function public.withdrawal_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_mutable text[] := array['status', 'paystack_transfer_code', 'paystack_recipient_code', 'failure_reason', 'completed_at', 'refunded_at', 'updated_at'];
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_allowed text[] := array['reserved>processing', 'reserved>completed', 'reserved>failed', 'processing>completed', 'processing>failed',
                            'failed>refunded', 'completed>reversed', 'reversed>refunded'];
begin
  if tg_op = 'DELETE' then
    raise exception 'withdrawal requests are never deleted' using errcode = '42501';
  end if;
  -- the reference may be set once (legacy rows without one), never changed
  if old.paystack_reference is null then v_mutable := array_append(v_mutable, 'paystack_reference'); end if;
  if (v_new - v_mutable) is distinct from (v_old - v_mutable) then
    raise exception 'a withdrawal''s owner, amount and bank details are immutable' using errcode = '23514';
  end if;
  if old.paystack_transfer_code is not null and new.paystack_transfer_code is distinct from old.paystack_transfer_code then
    raise exception 'the provider transfer linkage cannot be changed' using errcode = '23514';
  end if;
  if new.status is distinct from old.status and (old.status || '>' || new.status) <> all (v_allowed) then
    raise exception 'illegal withdrawal status change % -> %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger withdrawal_requests_guard before update or delete on public.withdrawal_requests
  for each row execute function public.withdrawal_guard();
create trigger business_withdrawal_requests_guard before update or delete on public.business_withdrawal_requests
  for each row execute function public.withdrawal_guard();
create trigger withdrawal_requests_no_truncate before truncate on public.withdrawal_requests
  for each statement execute function public.financial_no_truncate();
create trigger business_withdrawal_requests_no_truncate before truncate on public.business_withdrawal_requests
  for each statement execute function public.financial_no_truncate();

-- ---------------------------------------------------------------------------------------------
-- CareFind: reserve
-- ---------------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------------
-- CareFind: provider linkage (exact request id) and settlement
-- ---------------------------------------------------------------------------------------------
create or replace function public.attach_withdrawal_transfer(p_request_id uuid, p_transfer_code text, p_recipient_code text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare w public.withdrawal_requests%rowtype;
begin
  select * into w from public.withdrawal_requests where id = p_request_id for update;
  if not found then return 'not_found'; end if;
  if w.paystack_transfer_code is null then
    update public.withdrawal_requests
       set paystack_transfer_code = p_transfer_code, paystack_recipient_code = p_recipient_code,
           status = case when status = 'reserved' then 'processing' else status end, updated_at = now()
     where id = w.id;
  end if;
  if w.status in ('reserved', 'processing') then return 'ok'; end if;
  return 'already_' || w.status;     -- a webhook that outran us: the linkage is still recorded
end;
$$;

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
      return v_info || '{"result":"conflict_paid_after_refund"}';
    end if;
    if p_amount_kobo is not null and w.payout_kobo is not null and p_amount_kobo <> w.payout_kobo then
      return v_info || jsonb_build_object('result', 'amount_mismatch', 'provider_amount_kobo', p_amount_kobo);
    end if;
    update public.withdrawal_requests set status = 'completed', completed_at = now(), updated_at = now() where id = w.id;
    return v_info || '{"result":"completed"}';
  end if;

  -- failed / reversed: the money did not (or no longer does) reach the user -> give the coins back, exactly once
  if v_from = 'refunded' then return v_info || '{"result":"already_refunded"}'; end if;
  if v_from = 'completed' and p_outcome = 'failed' then return v_info || '{"result":"conflict_failed_after_completed"}'; end if;

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

-- ---------------------------------------------------------------------------------------------
-- CareHub: reserve, link, settle (same shape; money is integer kobo in business_wallets)
-- ---------------------------------------------------------------------------------------------
create or replace function public.create_business_withdrawal(
  p_business_id uuid, p_amount_kobo integer, p_bank_name text, p_bank_code text, p_account_number text, p_account_name text,
  p_initiated_by uuid default null, p_daily_cap_kobo bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_ref text;
  v_available integer;
  v_recent numeric;
  v_cap bigint := coalesce(p_daily_cap_kobo, public._fin_cfg('business_withdrawal_daily_cap_kobo')::bigint);
begin
  if p_business_id is null then return jsonb_build_object('outcome', 'no_business'); end if;
  if p_amount_kobo is null or p_amount_kobo < public._fin_cfg('min_business_withdrawal_kobo') then return jsonb_build_object('outcome', 'below_minimum'); end if;
  if p_bank_name is null or btrim(p_bank_name) = '' or p_account_number is null or btrim(p_account_number) = ''
     or p_account_name is null or btrim(p_account_name) = '' then
    return jsonb_build_object('outcome', 'missing_bank_details');
  end if;

  select available_balance into v_available from public.business_wallets where business_id = p_business_id for update;
  if v_available is null then return jsonb_build_object('outcome', 'no_wallet'); end if;
  if v_available < p_amount_kobo then return jsonb_build_object('outcome', 'insufficient'); end if;

  if v_cap > 0 then
    select coalesce(sum(amount), 0) into v_recent from public.business_withdrawal_requests
     where business_id = p_business_id and status not in ('failed', 'refunded') and created_at > now() - interval '24 hours';
    if v_recent + p_amount_kobo > v_cap then return jsonb_build_object('outcome', 'daily_limit'); end if;
  end if;

  v_ref := 'ch_wd_' || replace(v_id::text, '-', '');
  update public.business_wallets set available_balance = available_balance - p_amount_kobo, updated_at = now() where business_id = p_business_id;
  insert into public.business_wallet_transactions (business_id, type, amount, reference, status)
  values (p_business_id, 'withdrawal', -p_amount_kobo, v_ref, 'confirmed');
  insert into public.business_withdrawal_requests (id, business_id, amount, bank_name, bank_code, account_number, account_name, status, paystack_reference, initiated_by)
  values (v_id, p_business_id, p_amount_kobo, p_bank_name, p_bank_code, p_account_number, p_account_name, 'reserved', v_ref, p_initiated_by);

  return jsonb_build_object('outcome', 'ok', 'id', v_id, 'reference', v_ref, 'amount_kobo', p_amount_kobo);
end;
$$;

create or replace function public.attach_business_withdrawal_transfer(p_request_id uuid, p_transfer_code text, p_recipient_code text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare w public.business_withdrawal_requests%rowtype;
begin
  select * into w from public.business_withdrawal_requests where id = p_request_id for update;
  if not found then return 'not_found'; end if;
  if w.paystack_transfer_code is null then
    update public.business_withdrawal_requests
       set paystack_transfer_code = p_transfer_code, paystack_recipient_code = p_recipient_code,
           status = case when status = 'reserved' then 'processing' else status end, updated_at = now()
     where id = w.id;
  end if;
  if w.status in ('reserved', 'processing') then return 'ok'; end if;
  return 'already_' || w.status;
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
    if v_from in ('failed', 'refunded', 'reversed') then return v_info || '{"result":"conflict_paid_after_refund"}'; end if;
    if p_amount_kobo is not null and p_amount_kobo <> w.amount then
      return v_info || jsonb_build_object('result', 'amount_mismatch', 'provider_amount_kobo', p_amount_kobo);
    end if;
    update public.business_withdrawal_requests set status = 'completed', completed_at = now(), updated_at = now() where id = w.id;
    return v_info || '{"result":"completed"}';
  end if;

  if v_from = 'refunded' then return v_info || '{"result":"already_refunded"}'; end if;
  if v_from = 'completed' and p_outcome = 'failed' then return v_info || '{"result":"conflict_failed_after_completed"}'; end if;

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
-- Reconciliation (service_role)
-- ---------------------------------------------------------------------------------------------
create or replace function public._withdrawal_cutover()
returns timestamptz language sql stable set search_path = public, pg_temp
as $$ select to_timestamp(public._fin_cfg('withdrawal_engine_cutover_epoch')) $$;

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
  -- in flight with no provider linkage for longer than the stale window: the transfer was probably never created
  select 'processing_without_transfer', 'carefind', id, 'no transfer code' from public.withdrawal_requests
   where status = 'processing' and paystack_transfer_code is null
  union all
  select 'processing_without_transfer', 'carehub', id, 'no transfer code' from public.business_withdrawal_requests
   where status = 'processing' and paystack_transfer_code is null
$$;

-- ---------------------------------------------------------------------------------------------
-- Retire the old surface; lock the tables to the engine
-- ---------------------------------------------------------------------------------------------
drop function if exists public.request_withdrawal(uuid, integer, text, text, text, text, integer);
drop function if exists public.reject_withdrawal_request(uuid);
drop function if exists public.approve_withdrawal_request(uuid);
drop function if exists public.complete_withdrawal_transfer(text);
drop function if exists public.request_business_withdrawal(uuid, integer, text, text, text);
drop function if exists public.request_business_withdrawal(uuid, integer, text, text, text, text);
drop function if exists public.reject_business_withdrawal(uuid);
drop function if exists public.refund_business_withdrawal(uuid);

do $$
declare t text;
begin
  foreach t in array array['withdrawal_requests', 'business_withdrawal_requests'] loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated, service_role', t);
  end loop;
end $$;

revoke all on function public.withdrawal_guard() from public, anon, authenticated, service_role;
revoke all on function public._withdrawal_cutover() from public, anon, authenticated;
grant execute on function public._withdrawal_cutover() to service_role;
revoke all on function public.create_withdrawal(uuid, integer, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.attach_withdrawal_transfer(uuid, text, text) from public, anon, authenticated;
revoke all on function public.settle_withdrawal(text, text, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.create_business_withdrawal(uuid, integer, text, text, text, text, uuid, bigint) from public, anon, authenticated;
revoke all on function public.attach_business_withdrawal_transfer(uuid, text, text) from public, anon, authenticated;
revoke all on function public.settle_business_withdrawal(text, text, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.reconcile_withdrawals(integer) from public, anon, authenticated;
grant execute on function public.create_withdrawal(uuid, integer, text, text, text, text, integer) to service_role;
grant execute on function public.attach_withdrawal_transfer(uuid, text, text) to service_role;
grant execute on function public.settle_withdrawal(text, text, uuid, bigint, text) to service_role;
grant execute on function public.create_business_withdrawal(uuid, integer, text, text, text, text, uuid, bigint) to service_role;
grant execute on function public.attach_business_withdrawal_transfer(uuid, text, text) to service_role;
grant execute on function public.settle_business_withdrawal(text, text, uuid, bigint, text) to service_role;
grant execute on function public.reconcile_withdrawals(integer) to service_role;

do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('withdrawal_guard', 'create_withdrawal', 'attach_withdrawal_transfer', 'settle_withdrawal', 'create_business_withdrawal',
                       'attach_business_withdrawal_transfer', 'settle_business_withdrawal', 'reconcile_withdrawals')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if bad is not null then raise exception 'client roles can execute: %', bad; end if;

  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('withdrawal_guard') and has_function_privilege('service_role', p.oid, 'execute');
  if bad is not null then raise exception 'trigger function must be private: %', bad; end if;

  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('request_withdrawal', 'reject_withdrawal_request', 'approve_withdrawal_request', 'complete_withdrawal_transfer',
                              'request_business_withdrawal', 'reject_business_withdrawal', 'refund_business_withdrawal')) then
    raise exception 'a legacy withdrawal function survived';
  end if;

  select string_agg(table_name || ':' || grantee || ':' || privilege_type, ', ') into bad from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('withdrawal_requests', 'business_withdrawal_requests')
     and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC') and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  if bad is not null then raise exception 'write grants remain: %', bad; end if;

  if exists (select 1 from public.reconcile_withdrawals(60) where kind <> 'stuck') then
    raise exception 'withdrawals do not reconcile; resolve before applying';
  end if;
end $$;
