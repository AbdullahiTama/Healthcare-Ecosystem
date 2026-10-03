-- Financial program, Phase 05 (1/3): the CareCoin ledger.
--
-- Until now a wallet balance was changed by thirteen different functions, each doing
-- "update wallets ... + insert into transactions ..." its own way: numeric balances (one wallet holds
-- 10.4 coins), ledger rows with inconsistent signs and no references, nothing that proves the balance
-- equals what was posted. This migration adds the foundation; migration 2/3 moves every writer onto it
-- and migration 3/3 makes the ledger the ONLY way a balance can change.
--
--   * coin_ledger          append-only, integer, signed; every row carries the balance after it, and
--                          unique (user_id, kind, reference) makes every leg idempotent.
--   * _post_coin_entry()   the single posting primitive: lock the wallet row, refuse to go below zero,
--                          update the balance and write the ledger row as ONE unit.
--   * _post_coin_transfer() two legs (gift, subscription, consultation) with the wallets locked in a
--                          fixed order, so A->B and B->A at the same instant cannot deadlock.
--   * cutover              every wallet's current balance becomes an 'opening_balance' entry; fractional
--                          balances (a legacy of 80% gift credits) are floored and the original value is
--                          kept in the entry's meta.
--   * reconcile_coin_wallets() / verify_coin_ledger_chain()   prove balance = sum(ledger) and that the
--                          running balances chain.
-- The legacy `transactions` table stays as the user-facing history (the wallet screen reads it).

-- ---------------------------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------------------------
create table public.coin_ledger (
  id             bigint generated always as identity primary key,
  user_id        uuid not null,
  delta          integer not null,
  balance_after  integer not null,
  kind           text not null,
  reference      text not null,
  counterparty_id uuid,
  meta           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),

  constraint coin_ledger_delta_nonzero check (delta <> 0),
  constraint coin_ledger_balance_nonnegative check (balance_after >= 0),
  constraint coin_ledger_reference_length check (char_length(reference) between 1 and 200),
  constraint coin_ledger_meta_object check (jsonb_typeof(meta) = 'object'),
  constraint coin_ledger_kind_check check (kind in (
    'opening_balance', 'topup',
    'booking_payment', 'booking_refund',
    'consultation_payment', 'consultation_earning',
    'subscription_payment', 'subscription_earning',
    'gift_sent', 'gift_received',
    'withdrawal', 'withdrawal_refund',
    'adjustment'
  )),
  -- One leg of one kind per user per reference: the idempotency guard under every function.
  constraint coin_ledger_leg_key unique (user_id, kind, reference)
);

comment on table public.coin_ledger is
  'Append-only CareCoin ledger (integer coins). delta is signed; balance_after is the wallet balance right after this entry. Written only by _post_coin_entry().';

create index coin_ledger_user_idx on public.coin_ledger (user_id, id);
create index coin_ledger_reference_idx on public.coin_ledger (reference);

create or replace function public.coin_ledger_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'coin_ledger is append-only: % is not allowed', tg_op using errcode = '42501';
end;
$$;

create trigger coin_ledger_no_update_delete
  before update or delete on public.coin_ledger
  for each row execute function public.coin_ledger_guard();
create trigger coin_ledger_no_truncate
  before truncate on public.coin_ledger
  for each statement execute function public.financial_no_truncate();

alter table public.coin_ledger enable row level security;
create policy "coin_ledger own read" on public.coin_ledger
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_platform_admin());

-- Clients read their own entries; nothing writes except the posting function (a definer owned by postgres).
revoke all on public.coin_ledger from public, anon, authenticated, service_role;
grant select on public.coin_ledger to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Posting primitives (private: reachable only from other definer functions)
-- ---------------------------------------------------------------------------------------------

-- Returns the new balance, or NULL when the wallet cannot cover a debit (nothing is written then).
-- A repeated (user, kind, reference) violates coin_ledger_leg_key and aborts the caller's transaction.
create or replace function public._post_coin_entry(
  p_user uuid,
  p_delta integer,
  p_kind text,
  p_reference text,
  p_counterparty uuid default null,
  p_meta jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance integer;
  v_new integer;
begin
  if p_user is null then raise exception 'coin entry needs a user'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'coin entry delta must be a non-zero integer'; end if;

  insert into public.wallets (user_id, balance) values (p_user, 0) on conflict (user_id) do nothing;
  select balance into v_balance from public.wallets where user_id = p_user for update;

  v_new := v_balance + p_delta;
  if v_new < 0 then return null; end if;

  -- Transaction-local marker the wallet guard (migration 3/3) looks for.
  perform set_config('app.coin_write', 'on', true);
  update public.wallets set balance = v_new where user_id = p_user;
  perform set_config('app.coin_write', '', true);

  insert into public.coin_ledger (user_id, delta, balance_after, kind, reference, counterparty_id, meta)
  values (p_user, p_delta, v_new, p_kind, p_reference, p_counterparty, coalesce(p_meta, '{}'::jsonb));

  return v_new;
end;
$$;

-- Debit p_from and credit p_to by p_coins as one unit. false = the sender cannot afford it (nothing written).
create or replace function public._post_coin_transfer(
  p_from uuid,
  p_to uuid,
  p_coins integer,
  p_kind_from text,
  p_kind_to text,
  p_reference text,
  p_meta jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_coins is null or p_coins <= 0 then raise exception 'a coin transfer must move a positive whole number of coins'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'a coin transfer needs two different wallets'; end if;

  -- Lock both wallets in one global order (smaller uuid first): A->B and B->A can never deadlock.
  insert into public.wallets (user_id, balance) values (p_from, 0), (p_to, 0) on conflict (user_id) do nothing;
  perform 1 from public.wallets where user_id = least(p_from, p_to) for update;
  perform 1 from public.wallets where user_id = greatest(p_from, p_to) for update;

  if public._post_coin_entry(p_from, -p_coins, p_kind_from, p_reference, p_to, p_meta) is null then
    return false;
  end if;
  perform public._post_coin_entry(p_to, p_coins, p_kind_to, p_reference, p_from, p_meta);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Cutover: every existing balance becomes an opening entry; balances become whole coins.
-- ---------------------------------------------------------------------------------------------
insert into public.coin_ledger (user_id, delta, balance_after, kind, reference, meta)
select w.user_id, floor(w.balance)::integer, floor(w.balance)::integer, 'opening_balance', 'cutover-20261005',
       jsonb_build_object('legacy_balance', w.balance::text, 'fraction_dropped', (w.balance - floor(w.balance))::text)
  from public.wallets w
 where floor(w.balance) > 0;

update public.wallets set balance = 0 where balance is null;
alter table public.wallets drop constraint if exists wallets_balance_nonnegative;
alter table public.wallets alter column balance type integer using floor(balance)::integer;
alter table public.wallets alter column balance set default 0;
alter table public.wallets alter column balance set not null;
alter table public.wallets alter column user_id set not null;
alter table public.wallets add constraint wallets_balance_nonnegative check (balance >= 0);

-- ---------------------------------------------------------------------------------------------
-- Reconciliation (service_role only)
-- ---------------------------------------------------------------------------------------------

-- Wallets whose balance is not the sum of their ledger entries. Empty = healthy.
create or replace function public.reconcile_coin_wallets()
returns table (user_id uuid, balance integer, ledger_sum bigint, difference bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select w.user_id, w.balance, coalesce(sum(l.delta), 0)::bigint, (w.balance - coalesce(sum(l.delta), 0))::bigint
    from public.wallets w
    left join public.coin_ledger l on l.user_id = w.user_id
   group by w.user_id, w.balance
  having w.balance <> coalesce(sum(l.delta), 0)
$$;

-- Ledger rows whose balance_after is not (previous balance_after + delta). Empty = the chain is intact.
create or replace function public.verify_coin_ledger_chain()
returns table (id bigint, user_id uuid, expected_balance integer, balance_after integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.user_id, c.expected, c.balance_after
    from (
      select l.id, l.user_id, l.balance_after,
             (coalesce(lag(l.balance_after) over (partition by l.user_id order by l.id), 0) + l.delta) as expected
        from public.coin_ledger l
    ) c
   where c.expected <> c.balance_after
$$;

-- ---------------------------------------------------------------------------------------------
-- Access (Supabase default privileges re-grant EXECUTE at creation: revoke explicitly, assert below)
-- ---------------------------------------------------------------------------------------------
revoke all on function public._post_coin_entry(uuid, integer, text, text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public._post_coin_transfer(uuid, uuid, integer, text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.coin_ledger_guard() from public, anon, authenticated, service_role;
revoke all on function public.reconcile_coin_wallets() from public, anon, authenticated;
revoke all on function public.verify_coin_ledger_chain() from public, anon, authenticated;
grant execute on function public.reconcile_coin_wallets() to service_role;
grant execute on function public.verify_coin_ledger_chain() to service_role;

do $$
declare bad text; mismatched integer;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('_post_coin_entry', '_post_coin_transfer', 'coin_ledger_guard', 'reconcile_coin_wallets', 'verify_coin_ledger_chain')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if bad is not null then raise exception 'client roles can execute: %', bad; end if;

  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('_post_coin_entry', '_post_coin_transfer', 'coin_ledger_guard')
     and has_function_privilege('service_role', p.oid, 'execute');
  if bad is not null then raise exception 'posting primitives executable by service_role: %', bad; end if;

  select string_agg(grantee || ':' || privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'coin_ledger'
     and ((grantee in ('anon', 'PUBLIC')) or (grantee in ('authenticated', 'service_role') and privilege_type <> 'SELECT'));
  if bad is not null then raise exception 'coin_ledger has write grants: %', bad; end if;

  -- The cutover must leave every wallet reconciled.
  select count(*) into mismatched from public.reconcile_coin_wallets();
  if mismatched > 0 then raise exception 'cutover left % unreconciled wallets', mismatched; end if;
  if exists (select 1 from public.verify_coin_ledger_chain()) then raise exception 'cutover left a broken ledger chain'; end if;
end $$;
