-- 20261002_financial_phase0_lockdown.sql
-- Financial audit Phase 0 (docs/architecture/Financial-Architecture-Audit.md): close the
-- authorization holes on money-moving objects, verified against the LIVE catalog 2026-10-02.
--
-- Live state that drove this file (not what the older migrations say):
--   * agent_earnings / payout_requests / admin_* "Allow all" policies were ALREADY replaced
--     with scoped policies (C-1 is closed live; no change here).
--   * EXECUTE for `authenticated` was still live on mark_payout_paid, calculate_agent_earnings
--     (both overloads), verify_shop_payment, apply_promo_code_to_order, cancel_shop_order,
--     update_withdrawal_trust_after_withdrawal; cleanup_pending_shop_orders also had `anon`.
--   * shop_orders had NO column guard: policies let a customer INSERT/UPDATE their own order
--     with any values (payment_status, total_kobo, ...), and shop_payments let the customer
--     UPDATE their own payment row.
--
-- Callers checked before choosing revoke-vs-guard:
--   verify_shop_payment ........ only the service-role webhook (paystack-webhook.js); client
--                                orderRepository.verifyPayment has zero callers  -> REVOKE
--   update_withdrawal_trust_* .. only initiate-withdrawal.js (service role)       -> REVOKE
--   cleanup_pending_shop_orders  cron/service                                     -> REVOKE
--   mark_payout_paid ........... CareHub admin UI as an authenticated admin       -> ADMIN GUARD
--   calculate_agent_earnings ... admin UIs (CareHub supabase.js, CareFind agentRepository)
--                                                                                 -> ADMIN GUARD
--   cancel_shop_order .......... customers + vendors from the browser             -> OWNERSHIP GUARD
--   apply_promo_code_to_order .. Checkout.jsx                                     -> REWRITE (server-derived discount)
--
-- Every statement is idempotent. After applying, RE-READ pg_proc.proacl / pg_policies
-- (Supabase default privileges re-grant EXECUTE at function creation) -- see the verification
-- block at the bottom.

begin;

-- ---------------------------------------------------------------------------------------
-- 1. mark_payout_paid  (C-2)
--    * admin / service_role only
--    * agent branch pays the oldest earnings up to the payout amount (previously: every
--      accrued row, regardless of amount) and refuses a payout larger than what is owed
--    * business branch no longer swallows an error on a column that does not exist
--      (business_wallets has held_balance/available_balance, never `balance`). Business
--      payouts are debited at request time by request_business_withdrawal, so this RPC
--      refuses them instead of recording a "paid" state with no debit behind it.
-- ---------------------------------------------------------------------------------------
create or replace function public.mark_payout_paid(p_payout_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req       payout_requests%rowtype;
  v_row       record;
  v_remaining numeric;
  v_take      numeric;
  v_paid      numeric;
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_req from public.payout_requests where id = p_payout_id for update;
  if not found then raise exception 'payout % not found', p_payout_id using errcode = 'P0002'; end if;
  if v_req.status = 'paid' then return; end if;

  if v_req.requester_type = 'agent' then
    v_remaining := v_req.amount;
    for v_row in
      select id, amount_owed, coalesce(amount_paid, 0) as already_paid
      from public.agent_earnings
      where agent_id = v_req.requester_id and status in ('accrued', 'payable')
      order by created_at, id
      for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_row.amount_owed - v_row.already_paid, v_remaining);
      v_paid := v_row.already_paid + v_take;
      update public.agent_earnings
         set amount_paid = v_paid,
             status      = case when v_paid >= amount_owed then 'paid' else status end,
             paid_at     = case when v_paid >= amount_owed then now() else paid_at end
       where id = v_row.id;
      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0.005 then
      raise exception 'payout % exceeds the agent''s accrued earnings by %', p_payout_id, v_remaining
        using errcode = 'P0001';
    end if;
  elsif v_req.requester_type = 'business' then
    raise exception 'business payouts are settled through request_business_withdrawal, not mark_payout_paid'
      using errcode = 'P0001';
  end if;
  -- requester_type 'admin_team' carries no wallet/earnings ledger: marking it paid is the whole job.

  update public.payout_requests
     set status = 'paid', processed_at = now(), updated_at = now()
   where id = p_payout_id;
end;
$$;

revoke all on function public.mark_payout_paid(uuid) from public, anon;
grant execute on function public.mark_payout_paid(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- 2. calculate_agent_earnings  (C-3)
--    The existing 3-arg body is kept verbatim as an internal implementation function; the
--    public signatures become thin wrappers that enforce admin / service_role.
--    Guarded by the rename's existence so re-running the file is a no-op.
-- ---------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'calculate_agent_earnings'
               and pg_get_function_identity_arguments(p.oid) = 'p_business_id uuid, p_plan_value numeric, p_payment_reference text')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = '_calculate_agent_earnings_impl') then
    alter function public.calculate_agent_earnings(uuid, numeric, text) rename to _calculate_agent_earnings_impl;
  end if;
end $$;

revoke all on function public._calculate_agent_earnings_impl(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public._calculate_agent_earnings_impl(uuid, numeric, text) to service_role;

create or replace function public.calculate_agent_earnings(p_business_id uuid, p_plan_value numeric, p_payment_reference text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform public._calculate_agent_earnings_impl(p_business_id, p_plan_value, p_payment_reference);
end;
$$;

create or replace function public.calculate_agent_earnings(p_business_id uuid, p_plan_value numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform public._calculate_agent_earnings_impl(p_business_id, p_plan_value, null::text);
end;
$$;

revoke all on function public.calculate_agent_earnings(uuid, numeric, text) from public, anon;
revoke all on function public.calculate_agent_earnings(uuid, numeric)       from public, anon;
grant execute on function public.calculate_agent_earnings(uuid, numeric, text) to authenticated, service_role;
grant execute on function public.calculate_agent_earnings(uuid, numeric)       to authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- 3. verify_shop_payment (C-4), update_withdrawal_trust_after_withdrawal (H-10),
--    cleanup_pending_shop_orders (M-6): server-only
-- ---------------------------------------------------------------------------------------
revoke all on function public.verify_shop_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_shop_payment(uuid, text) to service_role;

revoke all on function public.update_withdrawal_trust_after_withdrawal(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.update_withdrawal_trust_after_withdrawal(uuid, integer, text) to service_role;

revoke all on function public.cleanup_pending_shop_orders() from public, anon, authenticated;
grant execute on function public.cleanup_pending_shop_orders() to service_role;

-- ---------------------------------------------------------------------------------------
-- 4. cancel_shop_order (H-9): customer of the order, the vendor's business, or admin
-- ---------------------------------------------------------------------------------------
create or replace function public.cancel_shop_order(p_order_id uuid, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_vendor uuid; v_customer uuid; v_ref text;
begin
  select status, vendor_business_id, customer_id, order_ref
    into v_status, v_vendor, v_customer, v_ref
    from shop_orders where id = p_order_id for update;
  if v_status is null then return 'not_found'; end if;

  if not (auth.role() = 'service_role'
          or public.is_platform_admin()
          or v_customer = auth.uid()
          or v_vendor in (select public.current_business_ids())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if v_status in ('delivered','cancelled','refunded') then return 'already_' || v_status; end if;
  perform shop_restore_inventory_on_cancel(p_order_id);
  update shop_orders set status = 'cancelled', updated_at = now() where id = p_order_id;
  update shop_payments set status = 'failed' where order_id = p_order_id and status = 'pending';
  insert into shop_order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_status, 'cancelled', auth.uid(), coalesce(p_reason, 'Cancelled'));
  insert into notifications (recipient_id, type, message, link)
  values (v_customer, 'shop_cancelled', 'Order ' || v_ref || ' cancelled', '/orders/' || p_order_id::text);
  insert into staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  values (v_vendor, null, true, 'shop_cancelled', 'Order ' || v_ref || ' cancelled',
          coalesce(p_reason, 'Customer cancelled'), '/dashboard/ecommerce/orders/' || p_order_id::text);
  return 'ok';
end;
$$;

revoke all on function public.cancel_shop_order(uuid, text) from public, anon;
grant execute on function public.cancel_shop_order(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- 5. apply_promo_code_to_order (C-5): the discount is derived on the server.
--    p_discount_kobo is accepted for client compatibility and IGNORED. The caller must own
--    the order, the order must still be unpaid and promo-free, the promo is re-validated
--    under a row lock (so usage limits cannot be raced), and the discount is computed from
--    the order's stored subtotal.
-- ---------------------------------------------------------------------------------------
create or replace function public.apply_promo_code_to_order(p_order_id uuid, p_promo_code_id uuid, p_discount_kobo integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    shop_orders%rowtype;
  v_promo    shop_promo_codes%rowtype;
  v_discount integer;
begin
  select * into v_order from shop_orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;

  if not (auth.role() = 'service_role' or public.is_platform_admin() or v_order.customer_id = auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_order.payment_status is distinct from 'pending'
     or v_order.status not in ('pending_payment', 'delivery_quote_pending') then
    raise exception 'Order is no longer open for a discount';
  end if;
  if v_order.promo_code_id is not null then
    raise exception 'A promo code is already applied to this order';
  end if;

  select * into v_promo from shop_promo_codes where id = p_promo_code_id for update;
  if not found or not v_promo.is_active
     or v_promo.valid_from > now()
     or (v_promo.valid_until is not null and v_promo.valid_until <= now()) then
    raise exception 'Invalid or expired promo code';
  end if;
  if v_order.subtotal_kobo < coalesce(v_promo.min_order_kobo, 0) then
    raise exception 'Order is below the promo minimum';
  end if;
  if v_promo.applicable_segments is not null and v_order.segment is not null
     and not (v_order.segment = any (v_promo.applicable_segments)) then
    raise exception 'Promo code is not valid for this order segment';
  end if;
  if v_promo.usage_limit is not null and v_promo.used_count >= v_promo.usage_limit then
    raise exception 'Promo code has reached its usage limit';
  end if;
  if v_promo.usage_limit_per_user is not null
     and (select count(*) from shop_promo_code_usage
           where promo_code_id = v_promo.id and user_id = v_order.customer_id) >= v_promo.usage_limit_per_user then
    raise exception 'You have already used this promo code';
  end if;

  if v_promo.discount_type = 'percentage' then
    v_discount := (v_order.subtotal_kobo::bigint * v_promo.discount_value / 100)::integer;
    if v_promo.max_discount_kobo is not null then v_discount := least(v_discount, v_promo.max_discount_kobo); end if;
  else
    v_discount := v_promo.discount_value;
  end if;
  v_discount := greatest(0, least(v_discount, v_order.subtotal_kobo));

  insert into shop_promo_code_usage (promo_code_id, user_id, order_id, discount_kobo)
  values (v_promo.id, v_order.customer_id, v_order.id, v_discount);
  update shop_promo_codes set used_count = used_count + 1, updated_at = now() where id = v_promo.id;
  update shop_orders
     set total_kobo = greatest(0, total_kobo - v_discount),
         promo_code_id = v_promo.id,
         discount_kobo = v_discount,
         updated_at = now()
   where id = v_order.id;
  update shop_payments set amount_kobo = greatest(0, amount_kobo - v_discount)
   where order_id = v_order.id and status = 'pending';
end;
$$;

revoke all on function public.apply_promo_code_to_order(uuid, uuid, integer) from public, anon;
grant execute on function public.apply_promo_code_to_order(uuid, uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- 6. shop_orders / shop_payments: stop customers writing money & status columns directly
--    (SECURITY DEFINER RPCs run as the function owner, so current_user is not
--    authenticated/anon there and they pass through untouched.)
-- ---------------------------------------------------------------------------------------
create or replace function public.guard_shop_order_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and not (auth.role() = 'service_role' or public.is_platform_admin()) then
    if new.payment_status    is distinct from old.payment_status
       or new.total_kobo     is distinct from old.total_kobo
       or new.subtotal_kobo  is distinct from old.subtotal_kobo
       or new.commission_kobo is distinct from old.commission_kobo
       or new.fulfilment_kobo is distinct from old.fulfilment_kobo
       or new.delivery_kobo  is distinct from old.delivery_kobo
       or new.paystack_reference is distinct from old.paystack_reference
       or new.payment_reference  is distinct from old.payment_reference
       or new.customer_id    is distinct from old.customer_id
       or new.vendor_business_id is distinct from old.vendor_business_id
       or new.order_ref      is distinct from old.order_ref
       or new.promo_code_id  is distinct from old.promo_code_id
       or new.discount_kobo  is distinct from old.discount_kobo then
      raise exception 'shop_orders: payment and identity columns are server-managed' using errcode = '42501';
    end if;
    -- status may be changed directly only by the vendor's own business (customers use cancel_shop_order)
    if new.status is distinct from old.status
       and not (old.vendor_business_id in (select public.current_business_ids())) then
      raise exception 'shop_orders: status is server-managed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_shop_order_columns on public.shop_orders;
create trigger trg_guard_shop_order_columns
  before update on public.shop_orders
  for each row execute function public.guard_shop_order_columns();

revoke all on function public.guard_shop_order_columns() from public, anon;

-- Orders are created only through create_shop_order (SECURITY DEFINER, validates prices/fees/total).
drop policy if exists "shop_orders customer insert" on public.shop_orders;
create policy "shop_orders admin insert" on public.shop_orders
  for insert to authenticated with check (public.is_platform_admin());

-- Payment rows are written by the service role / settle RPCs only.
drop policy if exists "shop_payments system update" on public.shop_payments;
create policy "shop_payments admin update" on public.shop_payments
  for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

commit;

-- ---------------------------------------------------------------------------------------
-- Post-apply verification (run; do not trust the DDL completing):
--   select proname, pg_get_function_identity_arguments(oid) args, proacl::text
--     from pg_proc where pronamespace = 'public'::regnamespace and proname in
--     ('mark_payout_paid','calculate_agent_earnings','_calculate_agent_earnings_impl','verify_shop_payment',
--      'apply_promo_code_to_order','cancel_shop_order','update_withdrawal_trust_after_withdrawal',
--      'cleanup_pending_shop_orders');
--   expected: verify_shop_payment / update_withdrawal_trust_* / cleanup_pending_shop_orders / _impl
--             = postgres + service_role only; the rest = postgres + authenticated + service_role, no anon.
--   select policyname, cmd from pg_policies where tablename in ('shop_orders','shop_payments');
-- ---------------------------------------------------------------------------------------
