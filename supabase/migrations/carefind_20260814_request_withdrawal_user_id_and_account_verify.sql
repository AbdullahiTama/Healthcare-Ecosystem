-- ============================================================================
-- 2026-08-14 — Feature 8: fix request_withdrawal identity + harden EXECUTE
--
-- WHY THIS EXISTS
-- ---------------
-- Feature 8 verification found the withdrawal RPC derives identity from
-- auth.uid(), but the ONLY caller — api/_handlers/initiate-withdrawal.js —
-- invokes it through a **service-role** Supabase client. Service-role JWTs
-- carry no `sub` claim, so auth.uid() is always NULL there and the RPC returns
-- 'not_logged_in' on every request: the wallet is never debited and no
-- withdrawal_requests row is ever created. The handler's own comment
-- ("request_withdrawal() already deducted the coins") shows the deduction was
-- assumed to happen; it never did.
--
-- Additionally, the RPC was EXECUTE-granted to PUBLIC (proacl "=X/postgres"),
-- the same dangerous default C15/C17 removed for the sibling payment RPCs.
--
-- DESIGN
-- ------
-- Mirrors the server-verified family C15/C17 established (credit_wallet_topup,
-- approve_withdrawal_request, reject_withdrawal_request):
--   * Takes p_user_id as an argument — safe because the only caller is a
--     serverless function that has already verified the JWT via verifyUser().
--   * SECURITY DEFINER with SET search_path = public (C17 requirement).
--   * REVOKEd from PUBLIC / anon / authenticated; EXECUTE only for postgres
--     and service_role (the server-verified caller).
--   * Same atomic flow as before: row-lock the wallet, check balance, debit,
--     insert the withdrawal request and the ledger row.
-- ============================================================================

create or replace function public.request_withdrawal(
  p_user_id uuid,
  p_amount integer,
  p_bank_name text,
  p_account_number text,
  p_account_name text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  if p_user_id is null then
    return 'not_logged_in';
  end if;
  if p_amount is null or p_amount < 5 then
    return 'below_minimum';
  end if;
  if p_bank_name is null or btrim(p_bank_name) = ''
     or p_account_number is null or btrim(p_account_number) = ''
     or p_account_name is null or btrim(p_account_name) = '' then
    return 'missing_bank_details';
  end if;

  select balance into v_balance from wallets where user_id = p_user_id for update;
  if v_balance is null or v_balance < p_amount then
    return 'insufficient';
  end if;

  update wallets set balance = balance - p_amount where user_id = p_user_id;

  insert into withdrawal_requests (user_id, amount, bank_name, account_number, account_name, status)
  values (p_user_id, p_amount, p_bank_name, p_account_number, p_account_name, 'pending');

  insert into transactions (user_id, type, amount, status)
  values (p_user_id, 'withdrawal', p_amount, 'success');

  return 'ok';
end;
$$;

revoke execute on function public.request_withdrawal(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.request_withdrawal(uuid, integer, text, text, text) to service_role;

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Function signature is now (uuid, integer, text, text, text) and
--      proacl contains only postgres/service_role (no anon, no public).
--   2. initiate-withdrawal.js passes p_user_id: user.id (server-verified).
--   3. A request with sufficient balance debits the wallet and creates one
--      withdrawal_requests row (status 'pending') + one transactions row
--      (type 'withdrawal'); insufficient balance returns 'insufficient' and
--      mutates nothing.
-- ============================================================================