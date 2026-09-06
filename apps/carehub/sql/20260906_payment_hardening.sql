-- ============================================================================
-- Phase A: Payment Hardening (applied via supabase_apply_migration)
--
-- 1. Pending order cleanup (auto-cancel after 30min, restore stock)
-- 2. Server-side fee calculation (delivery, fulfilment, commission)
-- 3. Server-side fee validation in create_shop_order
-- 4. Payment event deduplication table + claim_payment_event RPC
-- 5. Segment column on shop_orders
-- ============================================================================

-- Add segment column to shop_orders (retail/wholesale/distributor)
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS segment text DEFAULT 'retail';

-- ── 1. Pending order cleanup ──────────────────────────────────────────────────
-- Automatically cancels orders stuck in pending_payment for >30min, restores
-- stock, and notifies the customer. Schedule externally (pg_cron not available).
CREATE OR REPLACE FUNCTION public.cleanup_pending_shop_orders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
$$;

-- ── 2. Server-side fee calculation functions ──────────────────────────────────
-- Mirror pricing.js so fees are enforced server-side.

CREATE OR REPLACE FUNCTION public.calculate_shop_delivery_fee(
  p_distance_km numeric, p_delivery_preference text
) RETURNS integer LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_delivery_preference = 'pickup' OR p_distance_km IS NULL THEN RETURN 0; END IF;
  IF p_distance_km <= 3 THEN RETURN 0; END IF;
  RETURN ceil((p_distance_km - 3) / 3) * 60000;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_shop_fulfilment_fee(
  p_segment text, p_order_total_kobo integer, p_carton_count integer DEFAULT 1
) RETURNS integer LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_min integer; v_rate numeric; v_eff_min integer;
BEGIN
  IF p_segment = 'retail' THEN v_min := 60000; v_rate := 0.03;
  ELSIF p_segment = 'wholesale' THEN v_min := 150000; v_rate := 0.02;
  ELSIF p_segment = 'distributor' THEN v_min := 35000; v_rate := 0.01;
  ELSE RAISE EXCEPTION 'Invalid segment: %', p_segment; END IF;
  v_eff_min := CASE WHEN p_segment = 'distributor' AND p_carton_count > 1 THEN v_min * p_carton_count ELSE v_min END;
  RETURN GREATEST(v_eff_min, round(p_order_total_kobo * v_rate));
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_shop_commission(
  p_segment text, p_order_total_kobo integer
) RETURNS integer LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_rate numeric;
BEGIN
  IF p_segment = 'retail' THEN v_rate := 0.10;
  ELSIF p_segment = 'wholesale' THEN v_rate := 0.05;
  ELSIF p_segment = 'distributor' THEN v_rate := 0.025;
  ELSE RAISE EXCEPTION 'Invalid segment: %', p_segment; END IF;
  RETURN round(p_order_total_kobo * v_rate);
END;
$$;

-- ── 3. create_shop_order with server-side fee validation ─────────────────────
-- Determines segment from items, recalculates fees, validates against client
-- values. Commission must match exactly, delivery ±5%, total ±2 kobo tolerance.

CREATE OR REPLACE FUNCTION public.create_shop_order(
  p_customer_id uuid, p_vendor_business_id uuid, p_items jsonb,
  p_subtotal_kobo integer, p_commission_kobo integer, p_fulfilment_kobo integer,
  p_delivery_kobo integer, p_total_kobo integer,
  p_delivery_address text, p_delivery_city text, p_delivery_state text,
  p_delivery_phone text, p_delivery_email text, p_delivery_instructions text,
  p_delivery_preference text, p_distance_km numeric, p_is_approved_city boolean,
  p_customer_name text, p_payment_reference text,
  p_pickup_station_id uuid DEFAULT null
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
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

  -- Determine segment server-side from item sale_type
  SELECT array_agg(COALESCE(LOWER(ep.sale_type), 'retail')) INTO v_item_types
  FROM jsonb_array_elements(p_items) elem
  JOIN ecommerce_products ep ON ep.id = (elem->>'ecommerce_product_id')::uuid;
  IF v_item_types @> ARRAY['distributor'] THEN v_segment := 'distributor';
  ELSIF v_item_types @> ARRAY['wholesale'] THEN v_segment := 'wholesale';
  ELSE v_segment := 'retail'; END IF;
  SELECT COALESCE(SUM((elem->>'quantity')::int), 0) INTO v_total_qty
  FROM jsonb_array_elements(p_items) elem;
  IF v_segment = 'retail' AND v_total_qty >= 100 THEN v_segment := 'distributor';
  ELSIF v_segment = 'retail' AND v_total_qty >= 10 THEN v_segment := 'wholesale'; END IF;

  v_order_ref := generate_shop_order_ref();
  v_status := CASE WHEN p_is_approved_city = false THEN 'delivery_quote_pending' ELSE 'pending_payment' END;

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

  -- Process items (validate prices, deduct stock)
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

  -- Server-side fee validation
  v_commission_calc := public.calculate_shop_commission(v_segment, v_subtotal_calc);
  v_fulfilment_calc := public.calculate_shop_fulfilment_fee(v_segment, v_subtotal_calc, v_total_qty);
  v_delivery_calc := public.calculate_shop_delivery_fee(p_distance_km, p_delivery_preference);
  v_total_calc := v_subtotal_calc + v_commission_calc + v_fulfilment_calc + v_delivery_calc;

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

  IF p_delivery_preference = 'pickup' AND EXISTS (
    SELECT 1 FROM businesses WHERE id = p_vendor_business_id AND shop_allow_pay_on_delivery = true
  ) THEN
    INSERT INTO staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
    SELECT p_vendor_business_id, s.id, false, 'shop_order', 'New Shop Order '||v_order_ref,
      'Customer placed an order — pay at pickup',
      '/dashboard/ecommerce/orders/'||v_order_id::text
    FROM staff s WHERE s.business_id=p_vendor_business_id AND s.status='active';
    INSERT INTO staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
    VALUES (p_vendor_business_id, null, true, 'shop_order', 'New Shop Order '||v_order_ref,
      'Customer placed order '||v_order_ref||' — pay at pickup',
      '/dashboard/ecommerce/orders/'||v_order_id::text);
    INSERT INTO notifications (recipient_id, type, message, link)
    VALUES (p_customer_id, 'shop_order', 'Order '||v_order_ref||' placed — pay at pickup', '/orders/'||v_order_id::text);
  ELSE
    INSERT INTO notifications (recipient_id, type, message, link)
    VALUES (p_customer_id, 'shop_order_pending', 'Order '||v_order_ref||' created — complete payment to confirm', '/orders/'||v_order_id::text);
  END IF;
  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_shop_order(uuid,uuid,jsonb,integer,integer,integer,integer,integer,text,text,text,text,text,text,text,numeric,boolean,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_shop_order(uuid,uuid,jsonb,integer,integer,integer,integer,integer,text,text,text,text,text,text,text,numeric,boolean,text,text,uuid) TO authenticated, service_role;

-- 20-arg convenience overload (delegates to 21-arg with null pickup_station_id)
CREATE OR REPLACE FUNCTION public.create_shop_order(
  p_customer_id uuid, p_vendor_business_id uuid, p_items jsonb, p_subtotal_kobo integer, p_commission_kobo integer, p_fulfilment_kobo integer, p_delivery_kobo integer, p_total_kobo integer, p_delivery_address text, p_delivery_city text, p_delivery_state text, p_delivery_phone text, p_delivery_email text, p_delivery_instructions text, p_delivery_preference text, p_distance_km numeric, p_is_approved_city boolean, p_customer_name text, p_payment_reference text
) RETURNS uuid LANGUAGE sql AS $$ SELECT public.create_shop_order(p_customer_id, p_vendor_business_id, p_items, p_subtotal_kobo, p_commission_kobo, p_fulfilment_kobo, p_delivery_kobo, p_total_kobo, p_delivery_address, p_delivery_city, p_delivery_state, p_delivery_phone, p_delivery_email, p_delivery_instructions, p_delivery_preference, p_distance_km, p_is_approved_city, p_customer_name, p_payment_reference, null::uuid) $$;

-- ── 4. Payment event deduplication ────────────────────────────────────────────
-- Ensures each Paystack charge.success event is processed exactly once per order.

CREATE TABLE IF NOT EXISTS shop_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  payment_reference text NOT NULL,
  paystack_reference text,
  event_type text NOT NULL DEFAULT 'charge.success',
  amount_kobo integer,
  status text NOT NULL DEFAULT 'processed',
  processed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}',
  UNIQUE(payment_reference, event_type)
);

CREATE INDEX IF NOT EXISTS idx_shop_payment_events_order ON shop_payment_events(order_id);
CREATE INDEX IF NOT EXISTS idx_shop_payment_events_ref ON shop_payment_events(payment_reference);

ALTER TABLE shop_payment_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_payment_events_service_role' AND tablename = 'shop_payment_events') THEN
    CREATE POLICY "shop_payment_events_service_role" ON shop_payment_events FOR ALL TO service_role USING (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.claim_payment_event(
  p_order_id uuid, p_payment_reference text, p_event_type text DEFAULT 'charge.success',
  p_amount_kobo integer DEFAULT NULL, p_metadata jsonb DEFAULT '{}'
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO shop_payment_events (order_id, payment_reference, event_type, amount_kobo, status, metadata)
  VALUES (p_order_id, p_payment_reference, p_event_type, p_amount_kobo, 'processed', p_metadata);
  RETURN 'ok';
EXCEPTION WHEN unique_violation THEN
  UPDATE shop_payment_events SET status = 'duplicate'
  WHERE payment_reference = p_payment_reference AND event_type = p_event_type AND status = 'processed';
  RETURN 'already_processed';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_payment_event(uuid, text, text, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_payment_event(uuid, text, text, integer, jsonb) TO service_role;
