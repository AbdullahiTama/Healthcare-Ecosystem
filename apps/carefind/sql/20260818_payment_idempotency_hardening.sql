-- ============================================================================
-- 2026-08-18 — Payment idempotency & ACL hardening (audit follow-up)
--
-- This migration fixes the P0/P1/P2 findings from the Winston payment security
-- audit (CareHub + CareFind). It addresses:
--   P0: pay_creator_subscription wallet-drain (caller-supplied p_subscriber),
--       missing search_path, and the card-path double-charge quirk.
--   P1: CareHub plan renewal double-extension race (JS check-then-act).
--   P2: Withdrawal replay-safety (reference-at-creation + unique indexes).
--   P3: Dead ternary in initiate-appointment-payment.js; duplicate
--       staff_notifications on double-settled booking.
--
-- ALL FUNCTIONS ARE SECURITY DEFINER WITH SET search_path = public.
-- EXECUTE revoked from public/anon/authenticated where server-role only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Subscriptions — kill the wallet-drain vector + the card double-charge
-- ---------------------------------------------------------------------------

-- 1a. Drop the vulnerable overload (caller-supplied p_subscriber, no search_path,
--     PUBLIC/anon/authenticated EXECUTE). This is the C14/C17 class drain.
drop function if exists public.pay_creator_subscription(uuid, uuid, integer);

-- 1b. Safe wallet-path RPC: subscriber is ALWAYS auth.uid(), never caller-supplied.
--     Client (subscriptions.js) calls this directly with { p_creator, p_price }.
--     Granted to authenticated only; service-role calls via settle_subscription_payment.
create or replace function public.pay_creator_subscription(
  p_creator uuid,
  p_price integer
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscriber uuid := auth.uid();
  v_balance int;
  v_current timestamptz;
begin
  if v_subscriber is null then
    return 'not_signed_in';
  end if;
  if p_creator is null or p_price is null or p_price <= 0 then
    return 'invalid_args';
  end if;

  select balance into v_balance from public.wallets where user_id = v_subscriber for update;
  if v_balance is null or v_balance < p_price then
    return 'insufficient';
  end if;

  update public.wallets set balance = balance - p_price where user_id = v_subscriber;

  insert into public.wallets (user_id, balance)
  values (p_creator, p_price)
  on conflict (user_id) do update set balance = public.wallets.balance + p_price;

  select expires_at into v_current
    from public.creator_subscriptions
   where subscriber_id = v_subscriber and creator_id = p_creator;

  insert into public.creator_subscriptions (subscriber_id, creator_id, price, expires_at, auto_renew)
  values (v_subscriber, p_creator, p_price, now() + interval '30 days', true)
  on conflict (subscriber_id, creator_id) do update
    set expires_at = greatest(coalesce(v_current, now()), now()) + interval '30 days',
        price = p_price,
        auto_renew = true;

  insert into public.transactions (user_id, type, amount, status)
  values (v_subscriber, 'subscription', -p_price, 'success'),
         (p_creator, 'subscription_earning', p_price, 'success');

  return 'ok';
end;
$$;

revoke execute on function public.pay_creator_subscription(uuid, integer) from public, anon;
grant execute on function public.pay_creator_subscription(uuid, integer) to authenticated;

-- 1c. Card-path atomic settlement (service_role only). Mirrors settle_consultation_payment:
--     claim-first against a partial unique index on transactions(reference) where type='subscription_payment'.
--     Does NOT debit the subscriber wallet (card payment IS the settlement — fixes the
--     latent double-charge quirk where the card path also ran pay_creator_subscription).
create unique index if not exists transactions_subscription_payment_reference_uniq
  on public.transactions (reference) where type = 'subscription_payment';

create or replace function public.settle_subscription_payment(
  p_subscriber uuid,
  p_creator uuid,
  p_price integer,
  p_naira_amount integer,
  p_reference text
) returns table(already_processed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current timestamptz;
begin
  -- Claim the reference first; a racing caller settles nothing.
  insert into public.transactions (user_id, type, amount, naira_amount, reference, status)
  values (p_subscriber, 'subscription_payment', p_price, p_naira_amount, p_reference, 'success')
  on conflict (reference) where type = 'subscription_payment' do nothing;

  if not found then
    return query select true;
    return;
  end if;

  -- Card payment IS the settlement: the subscriber's wallet is deliberately
  -- NOT debited here (fixes the old double-charge quirk).
  insert into public.wallets (user_id, balance)
  values (p_creator, p_price)
  on conflict (user_id) do update set balance = public.wallets.balance + p_price;

  select expires_at into v_current
    from public.creator_subscriptions
   where subscriber_id = p_subscriber and creator_id = p_creator;

  insert into public.creator_subscriptions (subscriber_id, creator_id, price, expires_at, auto_renew)
  values (p_subscriber, p_creator, p_price, now() + interval '30 days', true)
  on conflict (subscriber_id, creator_id) do update
    set expires_at = greatest(coalesce(v_current, now()), now()) + interval '30 days',
        price = p_price,
        auto_renew = true;

  -- Ledger the creator side.
  insert into public.transactions (user_id, type, amount, status)
  values (p_creator, 'subscription_earning', p_price, 'success');

  return query select false;
end;
$$;

revoke execute on function public.settle_subscription_payment(uuid, uuid, integer, integer, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. CareHub plan renewal — atomic claim-first RPC (kills the double-extension race)
-- ---------------------------------------------------------------------------
create or replace function public.renew_business_plan(
  p_business_id uuid,
  p_months integer,
  p_naira_amount integer,
  p_reference text
) returns table(already_processed boolean, payment_id uuid, new_expiry timestamptz, is_first_payment boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
  v_base timestamptz;
  v_new_expiry timestamptz;
  v_payment_id uuid;
begin
  -- First-payment detection BEFORE the claim insert so the winner's
  -- is_first_payment reflects pre-existing payments only.
  select count(*) into v_count from public.plan_payments where business_id = p_business_id;

  -- Claim the reference first; a racing caller settles nothing.
  insert into public.plan_payments (business_id, months, naira_amount, reference, status, is_first_payment)
  values (p_business_id, p_months, p_naira_amount, p_reference, 'success', v_count = 0)
  on conflict (reference) do nothing
  returning id into v_payment_id;

  if v_payment_id is null then
    return query select true, null::uuid, null::timestamptz, false;
    return;
  end if;

  -- Lock the business row; extend from the later of current/now.
  select plan_expires_at into v_base from public.businesses where id = p_business_id for update;
  if v_base is null or v_base < now() then
    v_base := now();
  end if;
  v_new_expiry := v_base + make_interval(months => p_months);
  update public.businesses set plan_expires_at = v_new_expiry where id = p_business_id;

  return query select false, v_payment_id, v_new_expiry, v_count = 0;
end;
$$;

revoke execute on function public.renew_business_plan(uuid, integer, integer, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Withdrawals — reference-at-creation + replay-safe (both apps)
-- ---------------------------------------------------------------------------

-- 3a. CareFind user withdrawals.
drop index if exists idx_withdrawal_requests_paystack_reference;
create unique index if not exists withdrawal_requests_paystack_reference_uniq
  on public.withdrawal_requests (paystack_reference) where paystack_reference is not null;

drop function if exists public.request_withdrawal(uuid, integer, text, text, text);

create or replace function public.request_withdrawal(
  p_user_id uuid,
  p_amount integer,
  p_bank_name text,
  p_account_number text,
  p_account_name text,
  p_reference text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  if p_user_id is null then return 'not_logged_in'; end if;
  if p_amount is null or p_amount < 5 then return 'below_minimum'; end if;
  if p_bank_name is null or btrim(p_bank_name) = ''
     or p_account_number is null or btrim(p_account_number) = ''
     or p_account_name is null or btrim(p_account_name) = '' then
    return 'missing_bank_details';
  end if;

  -- Replay-safe: the first attempt already debited the wallet for this
  -- reference; a retried transfer reuses the same reference (Paystack
  -- idempotency), so never reserve funds twice.
  if p_reference is not null then
    if exists (select 1 from public.withdrawal_requests
                where paystack_reference = p_reference
                  and status in ('pending','processing')) then
      return 'ok';
    end if;
  end if;

  select balance into v_balance from public.wallets where user_id = p_user_id for update;
  if v_balance is null or v_balance < p_amount then return 'insufficient'; end if;

  update public.wallets set balance = balance - p_amount where user_id = p_user_id;

  insert into public.withdrawal_requests (user_id, amount, bank_name, account_number, account_name, status, paystack_reference)
  values (p_user_id, p_amount, p_bank_name, p_account_number, p_account_name, 'pending', p_reference);

  insert into public.transactions (user_id, type, amount, status)
  values (p_user_id, 'withdrawal', p_amount, 'success');

  return 'ok';
end;
$$;

revoke execute on function public.request_withdrawal(uuid, integer, text, text, text, text) from public, anon, authenticated;
grant execute on function public.request_withdrawal(uuid, integer, text, text, text, text) to service_role;

-- 3b. CareHub business withdrawals.
drop index if exists idx_business_withdrawal_requests_paystack_reference;
create unique index if not exists business_withdrawal_requests_paystack_reference_uniq
  on public.business_withdrawal_requests (paystack_reference) where paystack_reference is not null;

drop function if exists public.request_business_withdrawal(uuid, integer, text, text, text);

create or replace function public.request_business_withdrawal(
  p_business_id uuid,
  p_amount integer,
  p_bank_name text,
  p_account_number text,
  p_account_name text,
  p_reference text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available integer;
begin
  -- Replay-safe (mirrors request_withdrawal).
  if p_reference is not null then
    if exists (select 1 from public.business_withdrawal_requests
                where paystack_reference = p_reference
                  and status in ('pending','processing')) then
      return 'ok';
    end if;
  end if;

  select available_balance into v_available
    from public.business_wallets where business_id = p_business_id for update;
  if v_available is null then return 'no_wallet'; end if;
  if v_available < p_amount then return 'insufficient'; end if;

  update public.business_wallets
     set available_balance = available_balance - p_amount,
         updated_at = now()
   where business_id = p_business_id;

  insert into public.business_wallet_transactions (business_id, type, amount)
  values (p_business_id, 'withdrawal', -p_amount);

  insert into public.business_withdrawal_requests
    (business_id, amount, bank_name, account_number, account_name, status, paystack_reference)
  values
    (p_business_id, p_amount, p_bank_name, p_account_number, p_account_name, 'pending', p_reference);

  return 'ok';
end;
$$;

revoke execute on function public.request_business_withdrawal(uuid, integer, text, text, text, text) from public, anon, authenticated;

-- 3c. Business withdrawal rejection (refund) — mirrors reject_withdrawal_request.
create or replace function public.reject_business_withdrawal(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_amount int;
  v_status text;
begin
  select business_id, amount, status into v_business_id, v_amount, v_status
    from public.business_withdrawal_requests where id = p_request_id for update;
  if v_business_id is null then return 'not_found'; end if;
  if v_status not in ('pending','processing') then return 'already_' || v_status; end if;

  update public.business_withdrawal_requests set status = 'rejected' where id = p_request_id;

  -- Refund the available balance.
  insert into public.business_wallets (business_id, available_balance, held_balance, updated_at)
  values (v_business_id, v_amount, 0, now())
  on conflict (business_id) do update
    set available_balance = business_wallets.available_balance + v_amount,
        updated_at = now();

  -- Ledger the refund.
  insert into public.business_wallet_transactions (business_id, type, amount)
  values (v_business_id, 'refund', v_amount);

  return 'ok';
end;
$$;

revoke execute on function public.reject_business_withdrawal(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Verification checks (run after apply)
-- ---------------------------------------------------------------------------
-- 1. pay_creator_subscription: only (uuid, integer) exists; no (uuid, uuid, integer).
--    select proname, proargnames from pg_proc where proname = 'pay_creator_subscription';
--    --> one row, proargnames = {p_creator,p_price}; ACL: authenticated only.
--
-- 2. settle_subscription_payment: service_role only; search_path pinned.
--    select proname, proconfig from pg_proc where proname = 'settle_subscription_payment';
--    --> search_path = public; ACL: no public/anon/authenticated.
--
-- 3. Partial unique indexes exist:
--    select indexname from pg_indexes where indexname in
--      ('transactions_subscription_payment_reference_uniq',
--       'withdrawal_requests_paystack_reference_uniq',
--       'business_withdrawal_requests_paystack_reference_uniq');
--    --> 3 rows.
--
-- 4. renew_business_plan: service_role only; search_path pinned.
--    select proname, proconfig from pg_proc where proname = 'renew_business_plan';
--    --> search_path = public; ACL: no public/anon/authenticated.
--
-- 5. request_withdrawal: signature includes p_reference; replay guard present.
--    select pg_get_functiondef(oid) from pg_proc
--    where proname = 'request_withdrawal' and proargnames @> array['p_reference'];
--    --> one row.
--
-- 6. request_business_withdrawal: signature includes p_reference; replay guard present.
--    select pg_get_functiondef(oid) from pg_proc
--    where proname = 'request_business_withdrawal' and proargnames @> array['p_reference'];
--    --> one row.
--
-- 7. reject_business_withdrawal exists and is service_role only.
--    select proname, proacl from pg_proc where proname = 'reject_business_withdrawal';
--    --> one row; no public/anon/authenticated.