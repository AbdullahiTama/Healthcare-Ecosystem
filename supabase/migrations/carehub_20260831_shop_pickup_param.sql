-- Extend create_shop_order with pickup_station_id (APPLIED 2026-08-31 via MCP)
CREATE OR REPLACE FUNCTION public.create_shop_order(
  p_customer_id uuid, p_vendor_business_id uuid, p_items jsonb, p_subtotal_kobo integer, p_commission_kobo integer, p_fulfilment_kobo integer, p_delivery_kobo integer, p_total_kobo integer,
  p_delivery_address text, p_delivery_city text, p_delivery_state text, p_delivery_phone text, p_delivery_email text, p_delivery_instructions text,
  p_delivery_preference text, p_distance_km numeric, p_is_approved_city boolean, p_customer_name text, p_payment_reference text, p_pickup_station_id uuid DEFAULT null
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
declare v_order_id uuid; v_order_ref text; v_item jsonb; v_ecom_id uuid; v_product_id uuid; v_qty int; v_ecom_price int; v_prod_price numeric; v_stock int; v_prod_name text; v_expected_price int; v_unit_price int; v_line_total int; v_existing uuid; v_ecom_status text; v_ecom_restricted boolean; v_ecom_business uuid;
begin
  IF p_payment_reference IS NOT NULL THEN SELECT id INTO v_existing FROM shop_orders WHERE payment_reference = p_payment_reference; IF v_existing IS NOT NULL THEN RETURN v_existing; END IF; END IF;
  IF p_customer_id IS DISTINCT FROM auth.uid() AND NOT is_platform_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  IF NOT is_ecommerce_vendor_approved(p_vendor_business_id) THEN RAISE EXCEPTION 'Vendor not approved' USING ERRCODE='42501'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Cart is empty'; END IF;
  IF p_pickup_station_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shop_pickup_stations WHERE id = p_pickup_station_id AND is_active) THEN RAISE EXCEPTION 'Invalid pickup station'; END IF;
  v_order_ref := generate_shop_order_ref();
  BEGIN INSERT INTO shop_orders (order_ref, customer_id, vendor_business_id, status, payment_status, subtotal_kobo, commission_kobo, fulfilment_kobo, delivery_kobo, total_kobo, delivery_address, delivery_city, delivery_state, delivery_phone, delivery_email, delivery_instructions, delivery_preference, distance_km, is_approved_city, customer_name, payment_reference, pickup_station_id)
  VALUES (v_order_ref, p_customer_id, p_vendor_business_id, CASE WHEN p_is_approved_city=false THEN 'delivery_quote_pending' ELSE 'pending_payment' END, 'pending', p_subtotal_kobo, p_commission_kobo, p_fulfilment_kobo, p_delivery_kobo, p_total_kobo, p_delivery_address, p_delivery_city, p_delivery_state, p_delivery_phone, p_delivery_email, p_delivery_instructions, p_delivery_preference, p_distance_km, p_is_approved_city, p_customer_name, p_payment_reference, p_pickup_station_id) RETURNING id INTO v_order_id;
  EXCEPTION WHEN unique_violation THEN IF p_payment_reference IS NOT NULL THEN SELECT id INTO v_existing FROM shop_orders WHERE payment_reference = p_payment_reference; IF v_existing IS NOT NULL THEN RETURN v_existing; END IF; END IF;
    v_order_ref := 'CF-' || lpad((floor(random()*900000)::int + 100000)::text, 6, '0');
    INSERT INTO shop_orders (order_ref, customer_id, vendor_business_id, status, payment_status, subtotal_kobo, commission_kobo, fulfilment_kobo, delivery_kobo, total_kobo, delivery_address, delivery_city, delivery_state, delivery_phone, delivery_email, delivery_instructions, delivery_preference, distance_km, is_approved_city, customer_name, payment_reference, pickup_station_id)
    VALUES (v_order_ref, p_customer_id, p_vendor_business_id, CASE WHEN p_is_approved_city=false THEN 'delivery_quote_pending' ELSE 'pending_payment' END, 'pending', p_subtotal_kobo, p_commission_kobo, p_fulfilment_kobo, p_delivery_kobo, p_total_kobo, p_delivery_address, p_delivery_city, p_delivery_state, p_delivery_phone, p_delivery_email, p_delivery_instructions, p_delivery_preference, p_distance_km, p_is_approved_city, p_customer_name, p_payment_reference, p_pickup_station_id) RETURNING id INTO v_order_id;
  END;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP v_ecom_id := (v_item->>'ecommerce_product_id')::uuid; v_qty := (v_item->>'quantity')::int; IF v_qty IS NULL OR v_qty <=0 THEN RAISE EXCEPTION 'Invalid quantity %', v_qty; END IF;
    SELECT business_id, product_id, status, is_restricted, ecommerce_price_kobo INTO v_ecom_business, v_product_id, v_ecom_status, v_ecom_restricted, v_ecom_price FROM ecommerce_products WHERE id=v_ecom_id FOR UPDATE;
    IF v_product_id IS NULL THEN RAISE EXCEPTION 'E-commerce product not found %', v_ecom_id; END IF;
    IF v_ecom_business != p_vendor_business_id THEN RAISE EXCEPTION 'Product % does not belong to vendor', v_ecom_id; END IF;
    IF v_ecom_status != 'Active' THEN RAISE EXCEPTION 'Product % is not active', v_ecom_id; END IF;
    IF v_ecom_restricted THEN RAISE EXCEPTION 'Product % is restricted', v_ecom_id; END IF;
    SELECT name, price, stock INTO v_prod_name, v_prod_price, v_stock FROM products WHERE id=v_product_id FOR UPDATE;
    IF v_prod_name IS NULL THEN RAISE EXCEPTION 'Inventory product not found for ecom %', v_ecom_id; END IF;
    IF v_stock < v_qty THEN RAISE EXCEPTION 'Insufficient stock for %: have %, need %', v_prod_name, v_stock, v_qty; END IF;
    v_expected_price := COALESCE(v_ecom_price, (v_prod_price*100)::int); v_unit_price := (v_item->>'unit_price_kobo')::int; IF v_unit_price IS NULL THEN v_unit_price := v_expected_price; END IF;
    IF v_unit_price != v_expected_price THEN RAISE EXCEPTION 'Price mismatch for %: expected %, got %', v_prod_name, v_expected_price, v_unit_price USING ERRCODE='P0001'; END IF;
    v_line_total := v_unit_price * v_qty; UPDATE products SET stock=stock - v_qty WHERE id=v_product_id;
    INSERT INTO shop_order_items (order_id, ecommerce_product_id, product_id, product_name, quantity, unit_price_kobo, line_total_kobo) VALUES (v_order_id, v_ecom_id, v_product_id, v_prod_name, v_qty, v_unit_price, v_line_total);
  END LOOP;
  INSERT INTO shop_order_status_history (order_id, from_status, to_status, changed_by, note) VALUES (v_order_id, null, CASE WHEN p_is_approved_city=false THEN 'delivery_quote_pending' ELSE 'pending_payment' END, p_customer_id, 'Order created');
  INSERT INTO shop_payments (order_id, payment_reference, amount_kobo, status, gateway) VALUES (v_order_id, COALESCE(p_payment_reference, 'pay_'||v_order_ref), p_total_kobo, 'pending', 'paystack');
  INSERT INTO staff_notifications (business_id, staff_id, is_owner, kind, title, body, link) SELECT p_vendor_business_id, s.id, false, 'shop_order', 'New Shop Order '||v_order_ref, 'Customer '||COALESCE(p_customer_name, p_customer_id::text)||' placed an order ('||(SELECT count(*)::text FROM jsonb_array_elements(p_items))||' items) — '||p_delivery_preference, '/dashboard/ecommerce/orders/'||v_order_id::text FROM staff s WHERE s.business_id=p_vendor_business_id AND s.status='active';
  INSERT INTO staff_notifications (business_id, staff_id, is_owner, kind, title, body, link) VALUES (p_vendor_business_id, null, true, 'shop_order', 'New Shop Order '||v_order_ref, 'Customer '||COALESCE(p_customer_name, p_customer_id::text)||' placed order '||v_order_ref||' — view in E-commerce → Orders', '/dashboard/ecommerce/orders/'||v_order_id::text);
  INSERT INTO notifications (recipient_id, type, message, link) VALUES (p_customer_id, 'shop_order', 'Order '||v_order_ref||' placed — '||CASE WHEN p_is_approved_city=false THEN 'delivery quote pending (we will contact you within 24h)' ELSE 'payment pending' END, '/orders/'||v_order_id::text);
  RETURN v_order_id;
end; $$;
REVOKE ALL ON FUNCTION public.create_shop_order(uuid,uuid,jsonb,integer,integer,integer,integer,integer,text,text,text,text,text,text,text,numeric,boolean,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_shop_order(uuid,uuid,jsonb,integer,integer,integer,integer,integer,text,text,text,text,text,text,text,numeric,boolean,text,text,uuid) TO authenticated, service_role;
-- backward compat
CREATE OR REPLACE FUNCTION public.create_shop_order(p_customer_id uuid, p_vendor_business_id uuid, p_items jsonb, p_subtotal_kobo integer, p_commission_kobo integer, p_fulfilment_kobo integer, p_delivery_kobo integer, p_total_kobo integer, p_delivery_address text, p_delivery_city text, p_delivery_state text, p_delivery_phone text, p_delivery_email text, p_delivery_instructions text, p_delivery_preference text, p_distance_km numeric, p_is_approved_city boolean, p_customer_name text, p_payment_reference text)
RETURNS uuid LANGUAGE sql AS $$ SELECT public.create_shop_order(p_customer_id, p_vendor_business_id, p_items, p_subtotal_kobo, p_commission_kobo, p_fulfilment_kobo, p_delivery_kobo, p_total_kobo, p_delivery_address, p_delivery_city, p_delivery_state, p_delivery_phone, p_delivery_email, p_delivery_instructions, p_delivery_preference, p_distance_km, p_is_approved_city, p_customer_name, p_payment_reference, null::uuid) $$;
