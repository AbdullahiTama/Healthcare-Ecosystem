-- Regression fix for carefind_20261013_shop_return_hardening, found by the Phase 13 review of every money endpoint against the function it calls.
--
-- The ONLY caller of request_shop_return is the server endpoint api/request-shop-return.js, which uses the SERVICE-ROLE key (no user
-- session): there, auth.uid() is null. The old body skipped its ownership test for exactly that reason (null != x is null, so the
-- check never fired), and the endpoint checked ownership itself. The hardening migration added `if auth.uid() is null then raise
-- 'Not authorized'`, which is right for an anonymous caller but ALSO refuses the endpoint: every customer return request has failed
-- since it was applied.
--
-- The fix keeps both guarantees. A SIGNED-IN caller is the acting customer (auth.uid()), whatever it passes. A SERVICE-ROLE caller (trusted
-- server code that has already authenticated the user) must NAME the customer it acts for (p_customer_id), and the function applies the
-- same ownership test to that id. No caller can act for somebody else: an authenticated user's p_customer_id is ignored, and anon and a
-- service-role call that names nobody are refused.

do $$
begin
  if to_regprocedure('public.request_shop_return(uuid,text,text,integer)') is null then raise exception 'apply carefind_20261013_shop_return_hardening first'; end if;
end $$;

drop function public.request_shop_return(uuid, text, text, integer);
create function public.request_shop_return(p_order_id uuid, p_reason text, p_description text default null, p_refund_amount_kobo integer default null, p_customer_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := case when auth.role() = 'service_role' then p_customer_id else auth.uid() end;
  v_order record;
  v_return_id uuid;
  v_delivered_at timestamptz;
  v_window integer := public._fin_cfg('shop_vendor_return_window_days')::integer;
begin
  if v_actor is null then raise exception 'Not authorized'; end if;

  select * into v_order from shop_orders where id = p_order_id for update;
  if v_order is null then raise exception 'Order not found'; end if;
  if v_order.customer_id is distinct from v_actor then raise exception 'Not authorized'; end if;
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
revoke all on function public.request_shop_return(uuid, text, text, integer, uuid) from public, anon;
grant execute on function public.request_shop_return(uuid, text, text, integer, uuid) to authenticated, service_role;

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'request_shop_return';
  if v_n <> 1 then raise exception 'request_shop_return must exist exactly once, found %', v_n; end if;
  if has_function_privilege('anon', 'public.request_shop_return(uuid,text,text,integer,uuid)', 'execute') then raise exception 'anon can request a return'; end if;
end $$;
