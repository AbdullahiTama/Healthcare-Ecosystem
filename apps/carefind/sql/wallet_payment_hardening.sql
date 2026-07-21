-- Wallet/payment security hardening — applied directly to production 2026-07-18,
-- on explicit user go-ahead, following a payment-focused review that found a
-- live, exploitable vulnerability. See architecture/Technical-Debt.md (C11/C14)
-- and planning/REMEDIATION-STATUS.md for full context.
--
-- Three independent fixes, each explained inline:

-- =====================================================================
-- 1. CRITICAL: drop two leftover send_gift() overloads that took the
--    sender as a caller-supplied argument instead of deriving it from
--    auth.uid(). Both are SECURITY DEFINER, so any authenticated user
--    could call them directly via PostgREST's RPC endpoint
--    (POST /rest/v1/rpc/send_gift with p_sender = <victim's uuid>) and
--    drain any other user's wallet — the exact vulnerability C14's
--    send_gift fix was supposed to close, left live because Postgres
--    allows same-name function overloading and the old versions were
--    never dropped when the safe one was added.
--    Confirmed via grep that GiftPanel.jsx/LiveSession.jsx only ever
--    call the safe signature: send_gift(p_recipient, p_coins,
--    p_gift_type, p_gift_emoji, p_post_id, p_live_session_id) — no
--    caller in the app uses the p_sender-taking shape.
-- =====================================================================
DROP FUNCTION IF EXISTS public.send_gift(uuid, uuid, integer, uuid, text, text);
DROP FUNCTION IF EXISTS public.send_gift(uuid, uuid, numeric, uuid, text, text);

-- =====================================================================
-- 2. Close the race in CareCoins top-up crediting. verify-payment.js
--    (fires when the user is redirected back from Paystack) and
--    paystack-webhook.js (Paystack's own async notification, the
--    backup path for when the redirect is missed) are both designed to
--    race the same reference. The JS-level "check transactions table,
--    then read wallet balance, then write" in api/_lib/paystackCredit.js
--    was not atomic — no unique constraint existed on
--    transactions.reference, so two concurrent calls could both pass
--    the idempotency check, both read the same stale balance, and one
--    write would clobber the other (lost update), plus a duplicate
--    transactions row. Same class of bug as C11, moved server-side but
--    not made atomic.
--
--    Fix: a partial unique index scoped to type='topup' (gifts
--    legitimately share one reference across two ledger rows — a
--    plain unique index on reference would break gifting), used as an
--    ON CONFLICT target inside a new SECURITY DEFINER RPC that claims
--    the reference and credits the wallet as one atomic unit, mirroring
--    the existing pay_creator_subscription/request_withdrawal pattern.
--    Locked to service_role only — unlike those two, this function
--    trusts its p_user_id argument directly (the caller is always our
--    own server code, already verified via verifyUser() + Paystack's
--    own confirmation, not an end user's session), so unlike the
--    auth.uid()-based functions it must not be callable by
--    anon/authenticated at all.
-- =====================================================================
CREATE UNIQUE INDEX IF NOT EXISTS transactions_topup_reference_uniq
  ON public.transactions (reference)
  WHERE type = 'topup';

CREATE OR REPLACE FUNCTION public.credit_wallet_topup(
  p_user_id uuid, p_coins integer, p_naira_amount integer, p_reference text
) RETURNS TABLE(already_processed boolean, new_balance integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_new_balance int;
begin
  insert into transactions (user_id, type, amount, naira_amount, reference, status)
  values (p_user_id, 'topup', p_coins, p_naira_amount, p_reference, 'success')
  on conflict (reference) where type = 'topup' do nothing;

  if not found then
    select balance into v_new_balance from wallets where user_id = p_user_id;
    return query select true, coalesce(v_new_balance, 0);
    return;
  end if;

  insert into wallets (user_id, balance)
  values (p_user_id, p_coins)
  on conflict (user_id) do update set balance = wallets.balance + p_coins
  returning balance into v_new_balance;

  return query select false, v_new_balance;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.credit_wallet_topup(uuid, integer, integer, text)
  FROM PUBLIC, anon, authenticated;

-- =====================================================================
-- 3. Close the equivalent race in admin-auth.js's withdrawal
--    approve/reject actions. Both did a JS-level "read status, check
--    it's pending, then write" — a concurrent double-submit (retry,
--    stale tab, two admins) could pass the check twice. reject was
--    worse: it also read the wallet balance, computed the refund in
--    JS, then wrote — same lost-update risk as #2. Fixed the same way:
--    one SECURITY DEFINER RPC per action, row-locking the
--    withdrawal_requests row (FOR UPDATE) so the pending-status check
--    and the state transition happen atomically. Also service_role-only
--    — these trust their p_request_id/looked-up user_id, not auth.uid().
-- =====================================================================
CREATE OR REPLACE FUNCTION public.approve_withdrawal_request(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_status text;
begin
  select status into v_status from withdrawal_requests where id = p_request_id for update;
  if v_status is null then
    return 'not_found';
  end if;
  if v_status <> 'pending' then
    return 'already_' || v_status;
  end if;

  update withdrawal_requests set status = 'approved' where id = p_request_id;
  return 'ok';
end;
$$;

CREATE OR REPLACE FUNCTION public.reject_withdrawal_request(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_user_id uuid;
  v_amount int;
  v_status text;
begin
  select user_id, amount, status into v_user_id, v_amount, v_status
  from withdrawal_requests where id = p_request_id for update;

  if v_user_id is null then
    return 'not_found';
  end if;
  if v_status <> 'pending' then
    return 'already_' || v_status;
  end if;

  update withdrawal_requests set status = 'rejected' where id = p_request_id;

  insert into wallets (user_id, balance)
  values (v_user_id, v_amount)
  on conflict (user_id) do update set balance = wallets.balance + v_amount;

  insert into transactions (user_id, type, amount, status)
  values (v_user_id, 'withdrawal_refund', v_amount, 'success');

  return 'ok';
end;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_withdrawal_request(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_withdrawal_request(uuid) FROM PUBLIC, anon, authenticated;
