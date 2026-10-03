-- 20261003_withdrawal_daily_cap.sql
-- Financial audit M-3: no server-side maximum withdrawal existed at any trust tier, so a stolen session plus
-- the withdrawal PIN could move a wallet's whole balance in one request. request_withdrawal now takes an
-- optional rolling-24h ceiling (in CareCoins) and refuses with 'daily_limit' when this request would exceed it.
--
-- The check runs AFTER the wallet row is locked (select ... for update), so two concurrent requests from the
-- same user serialize and cannot both pass it. Withdrawals that did not go out (rejected/failed/cancelled) do
-- not count toward the cap. The cap is chosen by the server (api/_lib/trustLevels.js), never by the client.
--
-- The new parameter has a default, so every existing 6-argument call still resolves to this function. The old
-- 6-argument overload is DROPPED: CREATE OR REPLACE with a different signature would leave it callable beside
-- the new one (the trap behind two earlier criticals in this project).

begin;

drop function if exists public.request_withdrawal(uuid, integer, text, text, text, text);

create or replace function public.request_withdrawal(
  p_user_id uuid,
  p_amount integer,
  p_bank_name text,
  p_account_number text,
  p_account_name text,
  p_reference text default null,
  p_daily_cap_coins integer default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
  v_recent  numeric;
begin
  if p_user_id is null then return 'not_logged_in'; end if;
  if p_amount is null or p_amount < 5 then return 'below_minimum'; end if;
  if p_bank_name is null or btrim(p_bank_name) = ''
     or p_account_number is null or btrim(p_account_number) = ''
     or p_account_name is null or btrim(p_account_name) = '' then
    return 'missing_bank_details';
  end if;

  -- Replay-safe: the first attempt already debited the wallet for this reference; a retried transfer
  -- reuses the same reference (Paystack idempotency), so never reserve funds twice.
  if p_reference is not null then
    if exists (select 1 from public.withdrawal_requests
                where paystack_reference = p_reference
                  and status in ('pending','processing')) then
      return 'ok';
    end if;
  end if;

  select balance into v_balance from public.wallets where user_id = p_user_id for update;
  if v_balance is null or v_balance < p_amount then return 'insufficient'; end if;

  -- Rolling 24h ceiling, evaluated under the wallet lock taken above.
  if p_daily_cap_coins is not null then
    select coalesce(sum(amount), 0) into v_recent
      from public.withdrawal_requests
     where user_id = p_user_id
       and status not in ('rejected', 'failed', 'cancelled')
       and created_at > now() - interval '24 hours';
    if v_recent + p_amount > p_daily_cap_coins then return 'daily_limit'; end if;
  end if;

  update public.wallets set balance = balance - p_amount where user_id = p_user_id;

  insert into public.withdrawal_requests (user_id, amount, bank_name, account_number, account_name, status, paystack_reference)
  values (p_user_id, p_amount, p_bank_name, p_account_number, p_account_name, 'pending', p_reference);

  insert into public.transactions (user_id, type, amount, status)
  values (p_user_id, 'withdrawal', p_amount, 'success');

  return 'ok';
end;
$$;

-- Service role only: the caller supplies the user id and the cap, so it must never be publicly executable.
-- Supabase's default privileges re-grant EXECUTE at creation, so revoke explicitly and RE-READ proacl.
revoke all on function public.request_withdrawal(uuid, integer, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.request_withdrawal(uuid, integer, text, text, text, text, integer) to service_role;

commit;

-- Post-apply verification:
--   select proname, pg_get_function_identity_arguments(oid), proacl::text from pg_proc where proname = 'request_withdrawal';
--   expect exactly ONE row (7 arguments), proacl = postgres + service_role only.
