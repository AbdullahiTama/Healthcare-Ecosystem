-- SNAPSHOT, NOT A MIGRATION. Do not run except to roll back.
-- The three shop order stock functions as they were live on 2026-10-30, before
-- carehub_20261225_shop_order_stock_ledger moved them onto the stock ledger.
-- The repository's latest create_shop_order (carefind_20261021_shop_expiry_and_delivery_quotes)
-- had drifted from production, so this is the only copy of the live bodies.
-- Bodies are byte for byte the live prosrc (md5 checked):
--   create_shop_order (20 args)     37f7bda6c5da08c81e106258466c71f0
--   shop_restore_inventory_on_cancel 3b4a6e21dd5c3baa50f2a3e5d7f307b0
--   cleanup_pending_shop_orders      c994fe39e8d3d8c850d17c555a0f2a9b
-- Owner postgres; grants are kept by CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.create_shop_order(p_customer_id uuid, p_vendor_business_id uuid, p_items jsonb, p_subtotal_kobo integer, p_commission_kobo integer, p_fulfilment_kobo integer, p_delivery_kobo integer, p_total_kobo integer, p_delivery_address text, p_delivery_city text, p_delivery_state text, p_delivery_phone text, p_delivery_email text, p_delivery_instructions text, p_delivery_preference text, p_distance_km numeric, p_is_approved_city boolean, p_customer_name text, p_payment_reference text, p_pickup_station_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Pay at Pickup is paused: every order is paid online and the vendor is told when it is paid (settlement effects)
  INSERT INTO notifications (recipient_id, type, message, link)
  VALUES (p_customer_id, 'shop_order_pending',
    CASE WHEN v_status = 'delivery_quote_pending'
      THEN 'Order '||v_order_ref||' received — the seller will quote delivery, then you can pay'
      ELSE 'Order '||v_order_ref||' created — complete payment to confirm' END,
    '/orders/'||v_order_id::text);
  RETURN v_order_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.shop_restore_inventory_on_cancel(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_item RECORD;
begin
  FOR v_item IN SELECT product_id, quantity FROM shop_order_items WHERE order_id = p_order_id LOOP
    UPDATE products SET stock = stock + v_item.quantity WHERE id = v_item.product_id;
  END LOOP;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_pending_shop_orders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cancelled integer := 0; v_order record; v_item record;
BEGIN
  FOR v_order IN
    SELECT id, order_ref, customer_id FROM shop_orders
    WHERE status = 'pending_payment' AND created_at < now() - interval '30 minutes'
  LOOP
    FOR v_item IN SELECT product_id, quantity FROM shop_order_items WHERE order_id = v_order.id LOOP
      UPDATE products SET stock = stock + v_item.quantity WHERE id = v_item.product_id;
    END LOOP;
    UPDATE shop_orders SET status = 'cancelled', payment_status = 'expired', updated_at = now() WHERE id = v_order.id;
    INSERT INTO shop_order_status_history (order_id, from_status, to_status, note)
    VALUES (v_order.id, 'pending_payment', 'cancelled', 'Auto-cancelled: payment not completed within 30 minutes');
    INSERT INTO notifications (recipient_id, type, message, link)
    VALUES (v_order.customer_id, 'shop_order_cancelled',
      'Order ' || v_order.order_ref || ' expired — payment was not completed',
      '/orders/' || v_order.id::text);
    v_cancelled := v_cancelled + 1;
  END LOOP;
  RETURN v_cancelled;
END;
$function$;
