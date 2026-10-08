-- Financial program, Phase 05 (3/3): the ledger becomes the ONLY way a CareCoin balance changes.
--
-- Migration 2/3 moved every writer onto _post_coin_entry(). This makes that mandatory:
--   * wallets    a balance can only change while _post_coin_entry() holds its transaction-local marker.
--                A hand-written UPDATE (a future function, a console session, a compromised service
--                role) is refused. Creating an EMPTY wallet is still allowed (the client's
--                ensureWallet), and so is deleting an empty one; deleting a wallet that still holds
--                coins is refused, so an account deletion cannot silently destroy money.
--   * transactions, gifts   append-only. The foreign keys to auth.users (cascade / set null) still work:
--                referential actions run as nested triggers (pg_trigger_depth() > 1) and are let through,
--                a direct UPDATE/DELETE is refused.
-- coin_ledger itself has been append-only since migration 1/3.

do $$
begin
  if to_regprocedure('public._post_coin_entry(uuid,integer,text,text,uuid,jsonb)') is null then
    raise exception 'apply carefind_20261005_coin_ledger first';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- wallets: balance changes only through the ledger
-- ---------------------------------------------------------------------------------------------
create or replace function public.wallets_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- _post_coin_entry() sets this for the duration of its own UPDATE only.
  if coalesce(current_setting('app.coin_write', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' and new.balance = 0 then return new; end if;                       -- an empty wallet
  if tg_op = 'DELETE' and old.balance = 0 then return old; end if;                       -- removing an empty one
  if tg_op = 'UPDATE' and new.balance = old.balance and new.user_id = old.user_id then return new; end if;

  raise exception 'wallet balances change only through the coin ledger (% refused)', tg_op using errcode = '42501';
end;
$$;

create trigger wallets_guard
  before insert or update or delete on public.wallets
  for each row execute function public.wallets_guard();
create trigger wallets_no_truncate
  before truncate on public.wallets
  for each statement execute function public.financial_no_truncate();

-- ---------------------------------------------------------------------------------------------
-- transactions and gifts: append-only (referential actions pass)
-- ---------------------------------------------------------------------------------------------
create or replace function public.append_only_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- ON DELETE CASCADE / SET NULL from auth.users run this trigger one level deeper than a direct statement.
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op using errcode = '42501';
end;
$$;

create trigger transactions_append_only
  before update or delete on public.transactions
  for each row execute function public.append_only_guard();
create trigger transactions_no_truncate
  before truncate on public.transactions
  for each statement execute function public.financial_no_truncate();

create trigger gifts_append_only
  before update or delete on public.gifts
  for each row execute function public.append_only_guard();
create trigger gifts_no_truncate
  before truncate on public.gifts
  for each statement execute function public.financial_no_truncate();

-- ---------------------------------------------------------------------------------------------
-- Access + assertions
-- ---------------------------------------------------------------------------------------------
revoke all on function public.wallets_guard() from public, anon, authenticated, service_role;
revoke all on function public.append_only_guard() from public, anon, authenticated, service_role;

do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('wallets_guard', 'append_only_guard')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'));
  if bad is not null then raise exception 'guard functions are executable by clients: %', bad; end if;

  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relnamespace = 'public'::regnamespace and c.relname in ('wallets', 'transactions', 'gifts')
         and t.tgname in ('wallets_guard', 'wallets_no_truncate', 'transactions_append_only', 'transactions_no_truncate', 'gifts_append_only', 'gifts_no_truncate')) <> 6 then
    raise exception 'expected the 6 ledger-lock triggers';
  end if;

  -- The books must still balance the moment the lock goes on.
  if exists (select 1 from public.reconcile_coin_wallets()) then raise exception 'wallets do not reconcile with the ledger'; end if;
end $$;
