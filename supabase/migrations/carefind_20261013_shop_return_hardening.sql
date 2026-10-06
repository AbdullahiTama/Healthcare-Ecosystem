-- Hardening of request_shop_return (found while building the vendor payout model):
--   * anon could EXECUTE it (the body refuses a caller who is not the order's customer, but a money function must not be
--     reachable without a session);
--   * the customer chose the refund amount with no upper bound: a return of a 10,000 order could ask for 1,000,000 and the
--     vendor's approval would then have tried to refund it (process_shop_return now caps at what was paid, this refuses it early);
--   * the return window was measured from shop_orders.updated_at, which ANY later update moves (a note, a status touch), so a
--     delivered order could stay returnable forever. It is now measured from the first 'delivered' history row, with the same
--     number of days the vendor's payout is held (financial_config shop_vendor_return_window_days), so the customer can return
--     exactly as long as the vendor's money is held.

do $$
begin
  if to_regclass('public.shop_vendor_credits') is null then raise exception 'apply carefind_20261012_shop_vendor_payouts first'; end if;
end $$;

create or replace function public.request_shop_return(p_order_id uuid, p_reason text, p_description text default null, p_refund_amount_kobo integer default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_return_id uuid;
  v_delivered_at timestamptz;
  v_window integer := public._fin_cfg('shop_vendor_return_window_days')::integer;
begin
  if auth.uid() is null then raise exception 'Not authorized'; end if;

  select * into v_order from shop_orders where id = p_order_id for update;
  if v_order is null then raise exception 'Order not found'; end if;
  if v_order.customer_id != auth.uid() then raise exception 'Not authorized'; end if;
  if v_order.status != 'delivered' then raise exception 'Can only request return for delivered orders'; end if;
  if v_order.payment_status is distinct from 'paid' then raise exception 'Only a paid order can be returned'; end if;

  select min(created_at) into v_delivered_at from shop_order_status_history where order_id = p_order_id and to_status = 'delivered';
  v_delivered_at := coalesce(v_delivered_at, v_order.updated_at);
  if now() - v_delivered_at > make_interval(days => v_window) then
    raise exception 'Return window (% days) has expired', v_window;
  end if;

  if exists (select 1 from shop_order_returns where order_id = p_order_id and status in ('requested','approved','completed')) then
    raise exception 'Return already requested for this order';
  end if;

  if p_refund_amount_kobo is null then p_refund_amount_kobo := v_order.total_kobo; end if;
  if p_refund_amount_kobo <= 0 or p_refund_amount_kobo > v_order.total_kobo then
    raise exception 'The refund amount must be between 1 and the order total';
  end if;

  insert into shop_order_returns (order_id, customer_id, vendor_business_id, reason, description, refund_amount_kobo)
  values (p_order_id, v_order.customer_id, v_order.vendor_business_id, p_reason, p_description, p_refund_amount_kobo)
  returning id into v_return_id;

  update shop_orders set status = 'refund_requested', updated_at = now() where id = p_order_id;

  insert into staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  values (v_order.vendor_business_id, null, true, 'return_request', 'Return Request',
    'Customer requested return for order ' || v_order.order_ref || ' - Reason: ' || p_reason,
    '/dashboard/ecommerce/orders/' || p_order_id::text);

  return v_return_id;
end;
$$;
revoke all on function public.request_shop_return(uuid, text, text, integer) from public, anon;
grant execute on function public.request_shop_return(uuid, text, text, integer) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.request_shop_return(uuid,text,text,integer)', 'execute') then raise exception 'anon can still request a return'; end if;
end $$;
