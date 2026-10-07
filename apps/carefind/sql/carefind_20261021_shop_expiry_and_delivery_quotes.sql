-- Shop flow review, part 2 (docs/architecture/Shop-Flow-Review.md, SD-1 / SD-2 / SD-3 / SD-7 and the order emails).
--
--  SD-1  Unpaid orders were never released. cleanup_pending_shop_orders() existed but nothing called it (and it could not have
--        worked: it set payment_status 'expired', which shop_orders_payment_status_check does not allow), so every abandoned checkout
--        kept its stock reserved for good. expire_unpaid_shop_orders() is run by the finance cron (step shop_order_expiry):
--          * pending_payment, sent to Paystack:     60 minutes after the latest payment attempt
--          * pending_payment, never sent to Paystack: 72 hours (orders placed as Pay at Pickup before it was paused)
--          * delivery_quote_pending:                  7 days without a quote
--        It cancels the order the way cancel_shop_order does (stock back, open attempts closed, history, notice, status email). A
--        Paystack payment that still arrives for an expired order is refunded by the settlement engine (order_not_payable).
--
--  SD-3  Delivery outside the approved cities was never charged: the customer could pay before the quote, and "Quote Delivery" only
--        moved the status (the amount went into a note). quote_shop_order_delivery() now sets delivery_kobo and total_kobo and opens
--        the order for payment; update_shop_order_status no longer lets a vendor skip the quote. (initiate-shop-payment refuses an
--        order that is still waiting for its quote.)
--
--  SD-7  A PICKUP order in a city outside the approved list went to delivery_quote_pending although there is nothing to deliver.
--
--  SD-2  Pay at Pickup is paused (checkout no longer offers it): there is no way yet to record a cash payment, so such an order could
--        never progress. create_shop_order no longer tells vendors "pay at pickup" (it did so for EVERY pickup order of a vendor with
--        the option on, including orders paid online).
--
--  Emails: the order status email links to /orders/<id> (it linked to /orders/<order ref>, which the order page cannot open) and
--        tells the customer when delivery has been quoted.

do $$
begin
  if to_regprocedure('public.shop_restore_inventory_on_cancel(uuid)') is null then raise exception 'shop_restore_inventory_on_cancel is missing'; end if;
  if to_regclass('public.payment_intents') is null then raise exception 'apply the payment intents foundation first'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- SD-1 expire_unpaid_shop_orders
-- ---------------------------------------------------------------------------------------------
create or replace function public.expire_unpaid_shop_orders(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_after_attempt   constant interval := interval '60 minutes';
  v_never_attempted constant interval := interval '72 hours';
  v_quote_wait      constant interval := interval '7 days';
  r record;
  o public.shop_orders%rowtype;
  v_expired integer := 0;
begin
  for r in
    select so.id
      from public.shop_orders so
      left join lateral (select max(i.created_at) as at from public.payment_intents i where i.entity_type = 'shop_order' and i.entity_id = so.id) a on true
      left join lateral (select max(h.created_at) as at from public.shop_order_status_history h where h.order_id = so.id) h on true
     where so.payment_status = 'pending'
       and ((so.status = 'pending_payment'
             and greatest(so.created_at, h.at, a.at) < now() - case when a.at is null then v_never_attempted else v_after_attempt end)
         or (so.status = 'delivery_quote_pending' and greatest(so.created_at, h.at) < now() - v_quote_wait))
     order by so.created_at
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    -- a checkout or settlement holding the order right now wins; the next run looks again
    select * into o from public.shop_orders where id = r.id for update skip locked;
    if not found or o.payment_status <> 'pending' or o.status not in ('pending_payment', 'delivery_quote_pending') then continue; end if;
    -- paid at Paystack and being applied: the settlement engine (or reconciliation) decides, never the expiry
    if exists (select 1 from public.payment_intents i where i.entity_type = 'shop_order' and i.entity_id = o.id and i.status = 'verified') then continue; end if;

    perform public.shop_restore_inventory_on_cancel(o.id);
    update public.shop_orders set status = 'cancelled', payment_status = 'failed', updated_at = now() where id = o.id;
    update public.shop_payments set status = 'failed', updated_at = now() where order_id = o.id and status = 'pending';
    update public.payment_intents set status = 'expired', updated_at = now()
     where entity_type = 'shop_order' and entity_id = o.id and status in ('created', 'pending');
    insert into public.shop_order_status_history (order_id, from_status, to_status, changed_by, note)
    values (o.id, o.status, 'cancelled', null,
            case when o.status = 'delivery_quote_pending' then 'Expired: delivery was not quoted within 7 days' else 'Expired: payment was not completed' end);
    insert into public.notifications (recipient_id, type, message, link)
    values (o.customer_id, 'shop_order_cancelled',
            'Order ' || o.order_ref || case when o.status = 'delivery_quote_pending' then ' was cancelled: delivery could not be quoted in time' else ' was cancelled: payment was not completed' end,
            '/orders/' || o.id::text);
    v_expired := v_expired + 1;
  end loop;
  return jsonb_build_object('expired', v_expired);
end;
$$;
revoke all on function public.expire_unpaid_shop_orders(integer) from public, anon, authenticated;
grant execute on function public.expire_unpaid_shop_orders(integer) to service_role;
-- like the other cron sweeps: never wait long on a lock, never run away
alter function public.expire_unpaid_shop_orders(integer) set lock_timeout = '10s' set statement_timeout = '30s';

-- superseded by expire_unpaid_shop_orders (never called, and its payment_status 'expired' violates the table's check)
drop function if exists public.cleanup_pending_shop_orders();

-- ---------------------------------------------------------------------------------------------
-- SD-3 quote_shop_order_delivery
-- ---------------------------------------------------------------------------------------------
create or replace function public.quote_shop_order_delivery(p_order_id uuid, p_delivery_kobo integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o shop_orders%rowtype;
  v_total integer;
begin
  if p_delivery_kobo is null or p_delivery_kobo <= 0 or p_delivery_kobo > 100000000 then
    raise exception 'The delivery quote must be more than ₦0 and at most ₦1,000,000';
  end if;
  select * into o from shop_orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (auth.role() = 'service_role' or public.is_platform_admin() or o.vendor_business_id in (select public.current_business_ids())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if o.status <> 'delivery_quote_pending' or o.payment_status <> 'pending' then
    raise exception 'This order is not waiting for a delivery quote';
  end if;

  -- the same formula as create_shop_order, with the quoted delivery (and any promo discount already applied)
  v_total := o.subtotal_kobo + coalesce(o.fulfilment_kobo, 0) + p_delivery_kobo - coalesce(o.discount_kobo, 0);
  if v_total <= 0 then raise exception 'The order total would not be positive'; end if;

  update shop_orders set delivery_kobo = p_delivery_kobo, total_kobo = v_total, status = 'pending_payment', updated_at = now() where id = o.id;
  update shop_payments set amount_kobo = v_total, updated_at = now() where order_id = o.id and status = 'pending';
  insert into shop_order_status_history (order_id, from_status, to_status, changed_by, note)
  values (o.id, o.status, 'pending_payment', auth.uid(), 'Delivery quoted: ₦' || to_char(p_delivery_kobo / 100.0, 'FM999,999,990.00'));
  insert into notifications (recipient_id, type, message, link)
  values (o.customer_id, 'shop_delivery_quoted',
          'Delivery for order ' || o.order_ref || ' is ₦' || to_char(p_delivery_kobo / 100.0, 'FM999,999,990.00')
            || '. Pay ₦' || to_char(v_total / 100.0, 'FM999,999,990.00') || ' to confirm your order.',
          '/orders/' || o.id::text);
end;
$$;
revoke all on function public.quote_shop_order_delivery(uuid, integer) from public, anon;
grant execute on function public.quote_shop_order_delivery(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- SD-3 / SD-7 / SD-2 create_shop_order (from carefind_20261019_red_team_fixes; changed: the quote status and the notices)
-- ---------------------------------------------------------------------------------------------
create or replace function public.create_shop_order(
  p_customer_id uuid, p_vendor_business_id uuid, p_items jsonb, p_subtotal_kobo integer, p_commission_kobo integer, p_fulfilment_kobo integer,
  p_delivery_kobo integer, p_total_kobo integer, p_delivery_address text, p_delivery_city text, p_delivery_state text, p_delivery_phone text,
  p_delivery_email text, p_delivery_instructions text, p_delivery_preference text, p_distance_km numeric, p_is_approved_city boolean,
  p_customer_name text, p_payment_reference text, p_pickup_station_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_order_id uuid; v_order_ref text; v_item jsonb; v_ecom_id uuid;
  v_product_id uuid; v_qty int; v_ecom_price int; v_prod_price numeric;
  v_stock int; v_prod_name text; v_expected_price int; v_unit_price int;
  v_line_total int; v_existing uuid; v_ecom_status text; v_ecom_restricted boolean;
  v_ecom_business uuid; v_status text;
  v_subtotal_calc integer := 0; v_segment text; v_total_qty integer := 0;
  v_item_types text[]; v_commission_calc integer; v_fulfilment_calc integer;
  v_delivery_calc integer; v_total_calc integer;
BEGIN
  IF p_payment_reference IS NOT NULL THEN
    SELECT id INTO v_existing FROM shop_orders WHERE payment_reference = p_payment_reference;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;
  IF p_customer_id IS DISTINCT FROM auth.uid() AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  IF NOT is_ecommerce_vendor_approved(p_vendor_business_id) THEN
    RAISE EXCEPTION 'Vendor not approved' USING ERRCODE='42501';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart is empty'; END IF;
  IF p_pickup_station_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM shop_pickup_stations WHERE id = p_pickup_station_id AND is_active
  ) THEN RAISE EXCEPTION 'Invalid pickup station'; END IF;

  SELECT array_agg(COALESCE(LOWER(p.sale_type), 'retail')) INTO v_item_types
  FROM jsonb_array_elements(p_items) elem
  JOIN ecommerce_products ep ON ep.id = (elem->>'ecommerce_product_id')::uuid
  JOIN products p ON p.id = ep.product_id;
  IF v_item_types @> ARRAY['distributor'] THEN v_segment := 'distributor';
  ELSIF v_item_types @> ARRAY['wholesale'] THEN v_segment := 'wholesale';
  ELSE v_segment := 'retail'; END IF;
  SELECT COALESCE(SUM((elem->>'quantity')::int), 0) INTO v_total_qty
  FROM jsonb_array_elements(p_items) elem;
  IF v_segment = 'retail' AND v_total_qty >= 100 THEN v_segment := 'distributor';
  ELSIF v_segment = 'retail' AND v_total_qty >= 10 THEN v_segment := 'wholesale'; END IF;

  v_order_ref := generate_shop_order_ref();
  -- only HOME delivery outside the approved cities waits for a quote; a pickup order has nothing to deliver
  v_status := CASE WHEN p_is_approved_city = false AND p_delivery_preference = 'home' THEN 'delivery_quote_pending' ELSE 'pending_payment' END;

  BEGIN
    INSERT INTO shop_orders (order_ref, customer_id, vendor_business_id, status, payment_status,
      subtotal_kobo, commission_kobo, fulfilment_kobo, delivery_kobo, total_kobo,
      delivery_address, delivery_city, delivery_state, delivery_phone, delivery_email,
      delivery_instructions, delivery_preference, distance_km, is_approved_city,
      customer_name, payment_reference, pickup_station_id, segment)
    VALUES (v_order_ref, p_customer_id, p_vendor_business_id, v_status, 'pending',
      p_subtotal_kobo, p_commission_kobo, p_fulfilment_kobo, p_delivery_kobo, p_total_kobo,
      p_delivery_address, p_delivery_city, p_delivery_state, p_delivery_phone, p_delivery_email,
      p_delivery_instructions, p_delivery_preference, p_distance_km, p_is_approved_city,
      p_customer_name, p_payment_reference, p_pickup_station_id, v_segment)
    RETURNING id INTO v_order_id;
  EXCEPTION WHEN unique_violation THEN
    IF p_payment_reference IS NOT NULL THEN
      SELECT id INTO v_existing FROM shop_orders WHERE payment_reference = p_payment_reference;
      IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
    END IF;
    v_order_ref := 'CF-' || lpad((floor(random()*900000)::int + 100000)::text, 6, '0');
    INSERT INTO shop_orders (order_ref, customer_id, vendor_business_id, status, payment_status,
      subtotal_kobo, commission_kobo, fulfilment_kobo, delivery_kobo, total_kobo,
      delivery_address, delivery_city, delivery_state, delivery_phone, delivery_email,
      delivery_instructions, delivery_preference, distance_km, is_approved_city,
      customer_name, payment_reference, pickup_station_id, segment)
    VALUES (v_order_ref, p_customer_id, p_vendor_business_id, v_status, 'pending',
      p_subtotal_kobo, p_commission_kobo, p_fulfilment_kobo, p_delivery_kobo, p_total_kobo,
      p_delivery_address, p_delivery_city, p_delivery_state, p_delivery_phone, p_delivery_email,
      p_delivery_instructions, p_delivery_preference, p_distance_km, p_is_approved_city,
      p_customer_name, p_payment_reference, p_pickup_station_id, v_segment)
    RETURNING id INTO v_order_id;
  END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_ecom_id := (v_item->>'ecommerce_product_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity %', v_qty; END IF;
    SELECT business_id, product_id, status, is_restricted, ecommerce_price_kobo
    INTO v_ecom_business, v_product_id, v_ecom_status, v_ecom_restricted, v_ecom_price
    FROM ecommerce_products WHERE id = v_ecom_id FOR UPDATE;
    IF v_product_id IS NULL THEN RAISE EXCEPTION 'E-commerce product not found %', v_ecom_id; END IF;
    IF v_ecom_business != p_vendor_business_id THEN RAISE EXCEPTION 'Product % does not belong to vendor', v_ecom_id; END IF;
    IF v_ecom_status != 'Active' THEN RAISE EXCEPTION 'Product % is not active', v_ecom_id; END IF;
    IF v_ecom_restricted THEN RAISE EXCEPTION 'Product % is restricted', v_ecom_id; END IF;
    SELECT name, price, stock INTO v_prod_name, v_prod_price, v_stock
    FROM products WHERE id = v_product_id FOR UPDATE;
    IF v_prod_name IS NULL THEN RAISE EXCEPTION 'Inventory product not found for ecom %', v_ecom_id; END IF;
    IF v_stock < v_qty THEN RAISE EXCEPTION 'Insufficient stock for %: have %, need %', v_prod_name, v_stock, v_qty; END IF;
    v_expected_price := COALESCE(v_ecom_price, (v_prod_price * 100)::int);
    v_unit_price := (v_item->>'unit_price_kobo')::int;
    IF v_unit_price IS NULL THEN v_unit_price := v_expected_price; END IF;
    IF v_unit_price != v_expected_price THEN
      RAISE EXCEPTION 'Price mismatch for %: expected %, got %', v_prod_name, v_expected_price, v_unit_price USING ERRCODE='P0001';
    END IF;
    v_line_total := v_unit_price * v_qty;
    v_subtotal_calc := v_subtotal_calc + v_line_total;
    UPDATE products SET stock = stock - v_qty WHERE id = v_product_id;
    INSERT INTO shop_order_items (order_id, ecommerce_product_id, product_id, product_name, quantity, unit_price_kobo, line_total_kobo)
    VALUES (v_order_id, v_ecom_id, v_product_id, v_prod_name, v_qty, v_unit_price, v_line_total);
  END LOOP;

  v_commission_calc := public.calculate_shop_commission(v_segment, v_subtotal_calc);
  v_fulfilment_calc := public.calculate_shop_fulfilment_fee(v_segment, v_subtotal_calc, v_total_qty);
  v_delivery_calc := public.calculate_shop_delivery_fee(p_distance_km, p_delivery_preference);
  v_total_calc := v_subtotal_calc + v_fulfilment_calc + v_delivery_calc;

  -- The subtotal is what the vendor is credited from (subtotal - commission): it must be the items' own sum, never the caller's number.
  IF p_subtotal_kobo IS DISTINCT FROM v_subtotal_calc THEN
    RAISE EXCEPTION 'Subtotal mismatch: expected %, got %', v_subtotal_calc, p_subtotal_kobo USING ERRCODE='P0002';
  END IF;
  IF p_commission_kobo != v_commission_calc THEN
    RAISE EXCEPTION 'Commission mismatch: expected %, got %', v_commission_calc, p_commission_kobo USING ERRCODE='P0002';
  END IF;
  IF p_fulfilment_kobo != v_fulfilment_calc THEN
    RAISE EXCEPTION 'Fulfilment fee mismatch: expected %, got %', v_fulfilment_calc, p_fulfilment_kobo USING ERRCODE='P0002';
  END IF;
  IF abs(p_delivery_kobo - v_delivery_calc) > (v_delivery_calc * 0.05)::int + 1 THEN
    RAISE EXCEPTION 'Delivery fee mismatch: expected ~%, got %', v_delivery_calc, p_delivery_kobo USING ERRCODE='P0002';
  END IF;
  IF abs(p_total_kobo - v_total_calc) > 2 THEN
    RAISE EXCEPTION 'Order total mismatch: expected %, got %', v_total_calc, p_total_kobo USING ERRCODE='P0002';
  END IF;

  INSERT INTO shop_order_status_history (order_id, from_status, to_status, changed_by, note)
  VALUES (v_order_id, null, v_status, p_customer_id, 'Order created');
  INSERT INTO shop_payments (order_id, payment_reference, amount_kobo, status, gateway)
  VALUES (v_order_id, COALESCE(p_payment_reference, 'pay_' || v_order_ref), p_total_kobo, 'pending', 'paystack');

  -- Pay at Pickup is paused (no way to record a cash payment yet), so every order is paid online: the vendor is told when it
  -- is paid (settlement effects), not when it is created.
  INSERT INTO notifications (recipient_id, type, message, link)
  VALUES (p_customer_id, 'shop_order_pending',
    CASE WHEN v_status = 'delivery_quote_pending'
      THEN 'Order '||v_order_ref||' received — the seller will quote delivery, then you can pay'
      ELSE 'Order '||v_order_ref||' created — complete payment to confirm' END,
    '/orders/'||v_order_id::text);
  RETURN v_order_id;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- SD-3 update_shop_order_status (from carefind_20261019_red_team_fixes; changed: a vendor can no longer skip the delivery quote)
-- ---------------------------------------------------------------------------------------------
create or replace function public.update_shop_order_status(p_order_id uuid, p_to_status text, p_changed_by uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text; v_customer uuid; v_vendor uuid; v_ref text; v_pay text;
  v_admin boolean := (auth.role() = 'service_role' or public.is_platform_admin());
  v_actor uuid;
  v_rank_from integer; v_rank_to integer;
begin
  select status, customer_id, vendor_business_id, order_ref, payment_status into v_from, v_customer, v_vendor, v_ref, v_pay
    from shop_orders where id = p_order_id for update;
  if v_from is null then raise exception 'Order not found'; end if;
  if p_to_status = v_from then return; end if;

  -- who is acting: the signed-in caller, never an id the caller names (only the server may name one)
  v_actor := case when v_admin then coalesce(p_changed_by, auth.uid()) else auth.uid() end;

  if not v_admin then
    if v_vendor not in (select public.current_business_ids()) then
      raise exception 'Not authorized to change order status' using errcode = '42501';
    end if;
    -- a vendor moves a PAID order forward through fulfilment. Payment, refunds, cancellation, disputes and delivery quotes
    -- (quote_shop_order_delivery, which also sets the amount) are never the vendor's to set here.
    v_rank_from := case v_from when 'paid' then 1 when 'accepted' then 2 when 'processing' then 3 when 'packed' then 4
                     when 'at_pickup_station' then 5 when 'ready_for_pickup' then 5 when 'in_transit' then 6 end;
    v_rank_to := case p_to_status when 'accepted' then 2 when 'processing' then 3 when 'packed' then 4
                   when 'at_pickup_station' then 5 when 'ready_for_pickup' then 5 when 'in_transit' then 6 when 'delivered' then 7 end;
    if v_pay is distinct from 'paid' or v_rank_from is null or v_rank_to is null or v_rank_to <= v_rank_from then
      raise exception 'This status change is not allowed (% to %)', v_from, p_to_status using errcode = '42501';
    end if;
  end if;

  update shop_orders set status = p_to_status, updated_at = now() where id = p_order_id;
  insert into shop_order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_from, p_to_status, v_actor, p_note);
  insert into notifications (recipient_id, type, message, link)
  values (v_customer, 'shop_order_status', 'Order ' || v_ref || ' is now ' || p_to_status, '/orders/' || p_order_id::text);
  insert into staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  values (v_vendor, null, true, 'shop_order_status', 'Order ' || v_ref || ' → ' || p_to_status, 'Status changed from ' || coalesce(v_from, '') || ' to ' || p_to_status, '/dashboard/ecommerce/orders/' || p_order_id::text);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Order status email (from carefind_20260919_shop_orders_status_email_trigger; changed: the order id for the link, the quote)
-- ---------------------------------------------------------------------------------------------
create or replace function public.enqueue_shop_order_status_email()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_business_name text;
  v_template_status text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_template_status := case new.status
    when 'in_transit' then 'shipped'
    when 'delivered' then 'delivered'
    when 'cancelled' then 'cancelled'
    when 'rejected' then 'cancelled'
    when 'accepted' then 'processing'
    when 'processing' then 'processing'
    when 'packed' then 'processing'
    when 'at_pickup_station' then 'processing'
    when 'ready_for_pickup' then 'processing'
    when 'pending_payment' then case when old.status = 'delivery_quote_pending' then 'delivery_quoted' end
    else null
  end;

  if v_template_status is null then
    return new;
  end if;

  if new.delivery_email is null or position('@' in new.delivery_email) = 0 then
    return new;
  end if;

  select name into v_business_name
  from public.businesses
  where id = new.vendor_business_id;

  insert into public.email_outbox (
    to_email, from_email, subject, template_key, payload,
    status, next_retry_at
  ) values (
    new.delivery_email,
    'CareFind <support@mail.carefind.app>',
    case when v_template_status = 'delivery_quoted' then 'Your delivery has been quoted' else 'Your CareFind order has been updated' end,
    'order_status_update',
    jsonb_build_object(
      'fullName', coalesce(new.customer_name, 'Valued Customer'),
      'orderRef', new.order_ref,
      'orderId', new.id,
      'status', v_template_status,
      'businessName', coalesce(v_business_name, 'CareFind')
    ),
    'pending', now()
  );

  return new;
end;
$function$;
