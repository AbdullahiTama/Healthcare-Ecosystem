-- ============================================================================
-- 2026-08-14 — Recreate the safe send_gift RPC (missing from live DB)
--
-- WHY THIS EXISTS
-- ---------------
-- Feature 7 verification found `send_gift` is NOT present in the live
-- database, even though the July engagement notes ("carefind_rls_hardening",
-- C14/C15 in Technical-Debt.md) record that a safe, auth.uid()-based version
-- was applied. Only `pay_creator_subscription` survives. The result: gifting
-- from GiftPanel.jsx and LiveSession.jsx fails with "function not found" —
-- a core monetization feature silently broken. All historical `gifts` rows
-- are from July, confirming it worked then and was lost since.
--
-- DESIGN
-- ------
-- Mirrors the surviving `pay_creator_subscription` pattern exactly:
--   * SECURITY DEFINER, sender is ALWAYS auth.uid() — never caller-supplied
--     (this is the property the C15 fix depended on; a send_gift that trusts
--     a p_sender argument is the exact vulnerability C15 removed).
--   * Row-locks the sender's wallet, checks balance, then debits the sender
--     and credits the recipient atomically.
--   * Inserts the gift row into `gifts` (which carries both post_id and
--     live_session_id columns) and a shared-reference ledger pair into
--     `transactions` (`gift_sent` negative, `gift_received` positive) — the
--     two-sided ledger convention C16 depended on.
--   * Returns 'ok' | 'insufficient' | 'unauthorized'.
--   * GRANTed to `authenticated` only (same as pay_creator_subscription);
--     `anon` and `public` get nothing.
--
-- The single signature accepts either p_post_id (GiftPanel) or
-- p_live_session_id (LiveSession) as an optional tail argument, so one
-- function serves both callers. PostgREST resolves both call shapes to it.
-- ============================================================================

create or replace function public.send_gift(
  p_recipient uuid,
  p_coins integer,
  p_gift_type text,
  p_gift_emoji text,
  p_post_id uuid default null,
  p_live_session_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
  v_balance numeric;
  v_reference text;
begin
  if v_sender is null then
    return 'unauthorized';
  end if;

  -- Block the no-op self-gift early (net-zero but produces junk ledger rows).
  if v_sender = p_recipient then
    return 'self';
  end if;

  select balance into v_balance
    from public.wallets
   where user_id = v_sender
     for update;

  if v_balance is null or v_balance < p_coins then
    return 'insufficient';
  end if;

  update public.wallets
     set balance = balance - p_coins
   where user_id = v_sender;

  insert into public.wallets (user_id, balance)
  values (p_recipient, p_coins)
  on conflict (user_id) do update
    set balance = public.wallets.balance + p_coins;

  v_reference := 'gift_' || gen_random_uuid()::text;

  insert into public.gifts
    (sender_id, recipient_id, post_id, live_session_id, gift_type, gift_emoji, coins)
  values
    (v_sender, p_recipient, p_post_id, p_live_session_id, p_gift_type, p_gift_emoji, p_coins);

  insert into public.transactions (user_id, type, amount, reference, status)
  values
    (v_sender,    'gift_sent',     -p_coins, v_reference, 'success'),
    (p_recipient, 'gift_received',  p_coins, v_reference, 'success');

  return 'ok';
end;
$$;

revoke execute on function public.send_gift(uuid, integer, text, text, uuid, uuid) from public, anon;
grant execute on function public.send_gift(uuid, integer, text, text, uuid, uuid) to authenticated;

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Function exists: select proname, proacl from pg_proc
--      where proname = 'send_gift';  proacl must NOT include anon/public.
--   2. Callable only by authenticated: anon gets 42501, authenticated 'ok'
--      (with a funded wallet and a distinct recipient).
--   3. A successful send debits sender wallet, credits recipient wallet,
--      inserts one gifts row, and two transactions rows sharing reference
--      'gift_…' with types gift_sent (-coins) / gift_received (+coins).
--   4. Insufficient balance returns 'insufficient' and mutates nothing.
-- ============================================================================
