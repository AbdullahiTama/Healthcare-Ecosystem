-- ─────────────────────────────────────────────────────────────────────────────
-- Shop orders onto the stock ledger.
-- 2026-10-30. Docs: docs/architecture/Stock-Ledger.md
-- APPLIED to the live carehub project 2026-10-30 as carehub_20261225_shop_order_stock_ledger
-- (version 20261030141913). Live bodies of shop_take_stock, create_shop_order,
-- shop_restore_inventory_on_cancel and cleanup_pending_shop_orders match this file (md5).
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
-- CareFind shop orders changed vendor stock outside apply_stock_change, the
-- single stock-writing function, with no stock_movements row:
--   * create_shop_order reserved stock with UPDATE products SET stock = stock - qty,
--     on whatever product the listing (ecommerce_products) pointed at. The listing
--     write policy checks the listing's business, not the product's, so a listing
--     pointing at another business's product would have reduced that business's
--     stock (none does live: 0 of 16 listings).
--   * shop_restore_inventory_on_cancel (cancel_shop_order, expire_unpaid_shop_orders,
--     process_shop_return) and cleanup_pending_shop_orders put the line quantity
--     back by id alone, with nothing stopping a second restore: approving a second
--     return on the same order would have restocked the whole order again.
--
-- WHAT
-- * shop_take_stock: reserves one order line through apply_stock_change
--   ('sale', source 'shop_order', source_id the order, source_line_id the line,
--   key shop_order:<order>:<line>). The product must belong to the vendor. A
--   batch-tracked product takes from available, unexpired batches, earliest
--   expiry first, and only those count as stock. Not enough stock RAISES with the
--   message the CareFind app already maps to INSUFFICIENT_STOCK: an online order
--   is refused before any payment, unlike a till sale, which is never refused.
-- * create_shop_order: the live body, unchanged except that the line is inserted
--   first and its stock reserved through shop_take_stock (previous body in
--   docs/architecture/shop-stock-pre-ledger-snapshot.sql).
-- * shop_restore_inventory_on_cancel: the one way order stock goes back (cancel,
--   expiry, the 30 minute cleanup, an approved return). Gives back what the ledger
--   recorded for each line, to the batches it came from; an order reserved before
--   this migration gives back its line quantity, as before. Each line goes back at
--   most once, whichever path runs and however often (key
--   shop_order:<order>:<line>:release:<batch or ->). An approved return journals
--   'return_restock', everything else 'sale_reversal'. It never raises: a
--   cancellation or refund is never blocked by stock. A line that cannot go back
--   (its product was deleted or merged away, or a tracked product's batches
--   disagree with its stock) is skipped with a WARNING, leaving stock under, not
--   over, counted.
-- * cleanup_pending_shop_orders: unchanged except that it restores through the
--   function above. Nothing in the repository or the database schedule calls it
--   (expire_unpaid_shop_orders replaced it); drop it once confirmed unused.
--
-- SECURITY
-- No new entry point. create_shop_order keeps its grants and checks (the caller
-- must be the customer); shop_take_stock and shop_restore_inventory_on_cancel are
-- revoked from PUBLIC, anon and authenticated and reached only from SECURITY
-- DEFINER functions owned by postgres, which already bypass RLS; every ledger
-- write is scoped to the order's vendor_business_id, and apply_stock_change
-- refuses a product outside it. The ledger row's actor is the signed-in user
-- (auth.uid(): the customer for an order or their own cancellation, vendor staff
-- for theirs); the moved_by label is 'Online shop order', or 'Online shop
-- (automatic)' when no one is signed in (expiry), so customer emails are not
-- copied into the vendor's stock history.
--
-- ROLLBACK
-- Run the three functions in docs/architecture/shop-stock-pre-ledger-snapshot.sql,
-- then DROP FUNCTION public.shop_take_stock(uuid, uuid, integer, uuid, uuid, text, text).
-- Orders reserved through the ledger in the meantime still restore correctly under
-- the old body (line quantity) for untracked, non-service products, because
-- shop_take_stock always takes the full line; every listed product live is one.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.shop_take_stock(
  p_business uuid,
  p_product  uuid,
  p_qty      integer,
  p_order    uuid,
  p_item     uuid,
  p_ref      text,
  p_name     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stock    integer;
  v_mode     text;
  v_category text;
  v_avail    bigint;
  v_left     integer := p_qty;
  v_take     integer;
  v_key      text := 'shop_order:' || p_order || ':' || p_item;
  v_reason   text := 'Shop order ' || coalesce(p_ref, '');
  b          record;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity %', p_qty; END IF;
  SELECT coalesce(stock, 0), tracking_mode, category INTO v_stock, v_mode, v_category
    FROM public.products
   WHERE id = p_product AND business_id = p_business
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % does not belong to vendor', coalesce(p_name, p_product::text) USING ERRCODE = '42501';
  END IF;
  IF coalesce(v_category, '') = 'Services' THEN RETURN; END IF;

  IF v_mode = 'none' THEN
    IF v_stock < p_qty THEN
      RAISE EXCEPTION 'Insufficient stock for %: have %, need %', p_name, v_stock, p_qty;
    END IF;
    PERFORM public.apply_stock_change(
      p_business, p_product, -p_qty, 'sale', NULL, 'shop_order', p_order::text, p_item::text,
      v_reason, v_key, 'Online shop order');
    RETURN;
  END IF;

  -- Tracked by batch: only available, unexpired units can be sold online.
  SELECT coalesce(sum(quantity), 0) INTO v_avail FROM public.stock_batches
   WHERE product_id = p_product AND business_id = p_business AND quantity > 0
     AND status = 'available' AND (expiry_date IS NULL OR expiry_date >= current_date);
  IF v_avail < p_qty THEN
    RAISE EXCEPTION 'Insufficient stock for %: have %, need %', p_name, v_avail, p_qty;
  END IF;
  FOR b IN
    SELECT id, quantity FROM public.stock_batches
     WHERE product_id = p_product AND business_id = p_business AND quantity > 0
       AND status = 'available' AND (expiry_date IS NULL OR expiry_date >= current_date)
     ORDER BY expiry_date NULLS LAST, created_at, id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := least(v_left, b.quantity);
    PERFORM public.apply_stock_change(
      p_business, p_product, -v_take, 'sale', b.id, 'shop_order', p_order::text, p_item::text,
      v_reason, v_key || ':' || b.id, 'Online shop order');
    v_left := v_left - v_take;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_shop_order(p_customer_id uuid, p_vendor_business_id uuid, p_items jsonb, p_subtotal_kobo integer, p_commission_kobo integer, p_fulfilment_kobo integer, p_delivery_kobo integer, p_total_kobo integer, p_delivery_address text, p_delivery_city text, p_delivery_state text, p_delivery_phone text, p_delivery_email text, p_delivery_instructions text, p_delivery_preference text, p_distance_km numeric, p_is_approved_city boolean, p_customer_name text, p_payment_reference text, p_pickup_station_id uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  v_item_id uuid;
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
    INSERT INTO shop_order_items (order_id, ecommerce_product_id, product_id, product_name, quantity, unit_price_kobo, line_total_kobo)
    VALUES (v_order_id, v_ecom_id, v_product_id, v_prod_name, v_qty, v_unit_price, v_line_total)
    RETURNING id INTO v_item_id;
    -- through the stock ledger (carehub_20261225_shop_order_stock_ledger)
    PERFORM public.shop_take_stock(p_vendor_business_id, v_product_id, v_qty, v_order_id, v_item_id, v_order_ref, v_prod_name);
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
$$;

CREATE OR REPLACE FUNCTION public.shop_restore_inventory_on_cancel(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vendor uuid;
  v_ref    text;
  v_type   text;
  v_reason text;
  v_actor  text := CASE WHEN auth.uid() IS NULL THEN 'Online shop (automatic)' ELSE 'Online shop order' END;
  v_mode   text;
  v_batch  uuid;
  v_taken  boolean;
  v_key    text;
  i        record;
  t        record;
BEGIN
  SELECT vendor_business_id, order_ref INTO v_vendor, v_ref FROM public.shop_orders WHERE id = p_order_id;
  IF v_vendor IS NULL THEN RETURN; END IF;

  -- process_shop_return marks the return approved before calling this: returned
  -- goods are a restock; every other caller is undoing the reservation.
  IF EXISTS (SELECT 1 FROM public.shop_order_returns WHERE order_id = p_order_id AND status = 'approved') THEN
    v_type := 'return_restock';  v_reason := 'Shop order ' || coalesce(v_ref, '') || ' returned';
  ELSE
    v_type := 'sale_reversal';   v_reason := 'Shop order ' || coalesce(v_ref, '') || ' cancelled';
  END IF;

  FOR i IN
    SELECT id, product_id, quantity FROM public.shop_order_items
     WHERE order_id = p_order_id AND product_id IS NOT NULL
     ORDER BY product_id, id
  LOOP
    BEGIN
      v_key := 'shop_order:' || p_order_id || ':' || i.id || ':release:';
      v_taken := false;
      -- What the ledger recorded for this line, per batch.
      FOR t IN
        SELECT batch_id, -sum(quantity)::integer AS qty FROM public.stock_movements
         WHERE business_id = v_vendor AND source_type = 'shop_order' AND movement_type = 'sale'
           AND source_id = p_order_id::text AND source_line_id = i.id::text
         GROUP BY batch_id
         ORDER BY batch_id NULLS LAST
      LOOP
        v_taken := true;
        IF t.qty > 0 THEN
          PERFORM public.apply_stock_change(
            v_vendor, i.product_id, t.qty, v_type, t.batch_id, 'shop_order', p_order_id::text, i.id::text,
            v_reason, v_key || coalesce(t.batch_id::text, '-'), v_actor);
        END IF;
      END LOOP;

      -- Reserved before the ledger: the old direct write took the line quantity.
      IF NOT v_taken AND coalesce(i.quantity, 0) > 0 THEN
        SELECT tracking_mode INTO v_mode FROM public.products WHERE id = i.product_id AND business_id = v_vendor;
        IF NOT FOUND THEN
          RAISE NOTICE 'shop order %: product % no longer exists; % unit(s) not put back', v_ref, i.product_id, i.quantity;
        ELSE
          v_batch := NULL;
          IF v_mode <> 'none' THEN
            SELECT id INTO v_batch FROM public.stock_batches
             WHERE business_id = v_vendor AND product_id = i.product_id
             ORDER BY created_at DESC, id DESC LIMIT 1;
          END IF;
          PERFORM public.apply_stock_change(
            v_vendor, i.product_id, i.quantity, v_type, v_batch, 'shop_order', p_order_id::text, i.id::text,
            v_reason, v_key || '-', v_actor);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'shop order %: stock for product % not put back (%)', v_ref, i.product_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_pending_shop_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_cancelled integer := 0; v_order record;
BEGIN
  FOR v_order IN
    SELECT id, order_ref, customer_id FROM shop_orders
    WHERE status = 'pending_payment' AND created_at < now() - interval '30 minutes'
  LOOP
    PERFORM public.shop_restore_inventory_on_cancel(v_order.id);
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

REVOKE ALL ON FUNCTION public.shop_take_stock(uuid, uuid, integer, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shop_restore_inventory_on_cancel(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_pending_shop_orders() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.shop_take_stock(uuid, uuid, integer, uuid, uuid, text, text) IS
  'Reserves one shop order line through apply_stock_change (sale, source shop_order). Raises Insufficient stock when short. Internal: called by create_shop_order.';
COMMENT ON FUNCTION public.shop_restore_inventory_on_cancel(uuid) IS
  'Puts a shop order''s stock back through apply_stock_change: what the ledger recorded per line (line quantity for orders from before the ledger), at most once per line. return_restock after an approved return, otherwise sale_reversal. Never raises.';
