-- Shop pickup stations seed + payment verification (APPLIED 2026-08-31 via MCP)
INSERT INTO shop_pickup_stations (name, address, city, state, lat, lng, is_active)
VALUES
  ('Yaba Hub', '123 Herbert Macaulay Way, Yaba', 'Lagos', 'Lagos', 6.506, 3.371, true),
  ('Lekki Hub', 'Admiralty Way, Lekki Phase 1', 'Lagos', 'Lagos', 6.447, 3.472, true),
  ('Ikeja Hub', 'Obafemi Awolowo Way, Ikeja', 'Lagos', 'Lagos', 6.601, 3.351, true),
  ('Abuja Hub', 'Aminu Kano Crescent, Wuse II', 'Abuja', 'FCT - Abuja', 9.064, 7.491, true),
  ('PH Hub', 'Peter Odili Road, Trans-Amadi', 'Port Harcourt', 'Rivers', 4.824, 7.033, true)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.verify_shop_payment(p_order_id uuid, p_paystack_reference text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
declare v_status text; v_ref text;
begin
  SELECT status, order_ref INTO v_status, v_ref FROM shop_orders WHERE id = p_order_id FOR UPDATE;
  IF v_status IS NULL THEN RETURN 'not_found'; END IF;
  IF v_status = 'paid' THEN RETURN 'already_paid'; END IF;
  IF p_paystack_reference IS NULL OR char_length(trim(p_paystack_reference)) < 5 THEN RETURN 'invalid_reference'; END IF;
  UPDATE shop_orders SET payment_status='paid', status='paid', paystack_reference=p_paystack_reference, updated_at=now() WHERE id=p_order_id;
  UPDATE shop_payments SET status='success', gateway_response=jsonb_build_object('paystack_reference', p_paystack_reference), updated_at=now() WHERE order_id=p_order_id AND status='pending';
  INSERT INTO shop_order_status_history (order_id, from_status, to_status, changed_by, note) VALUES (p_order_id, v_status, 'paid', auth.uid(), 'Payment verified ' || p_paystack_reference);
  INSERT INTO notifications (recipient_id, type, message, link) SELECT customer_id, 'shop_payment', 'Payment confirmed for order ' || v_ref, '/orders/' || p_order_id::text FROM shop_orders WHERE id=p_order_id;
  RETURN 'ok';
end; $$;
REVOKE ALL ON FUNCTION public.verify_shop_payment(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_shop_payment(uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_shop_order(p_order_id uuid, p_reason text DEFAULT null)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
declare v_status text; v_vendor uuid; v_customer uuid; v_ref text;
begin
  SELECT status, vendor_business_id, customer_id, order_ref INTO v_status, v_vendor, v_customer, v_ref FROM shop_orders WHERE id=p_order_id FOR UPDATE;
  IF v_status IS NULL THEN RETURN 'not_found'; END IF;
  IF v_status IN ('delivered','cancelled','refunded') THEN RETURN 'already_' || v_status; END IF;
  PERFORM shop_restore_inventory_on_cancel(p_order_id);
  UPDATE shop_orders SET status='cancelled', updated_at=now() WHERE id=p_order_id;
  UPDATE shop_payments SET status='failed' WHERE order_id=p_order_id AND status='pending';
  INSERT INTO shop_order_status_history (order_id, from_status, to_status, changed_by, note) VALUES (p_order_id, v_status, 'cancelled', auth.uid(), COALESCE(p_reason,'Cancelled'));
  INSERT INTO notifications (recipient_id, type, message, link) VALUES (v_customer, 'shop_cancelled', 'Order ' || v_ref || ' cancelled', '/orders/' || p_order_id::text);
  INSERT INTO staff_notifications (business_id, staff_id, is_owner, kind, title, body, link) VALUES (v_vendor, null, true, 'shop_cancelled', 'Order ' || v_ref || ' cancelled', COALESCE(p_reason,'Customer cancelled'), '/dashboard/ecommerce/orders/' || p_order_id::text);
  RETURN 'ok';
end; $$;
REVOKE ALL ON FUNCTION public.cancel_shop_order(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_shop_order(uuid,text) TO authenticated, service_role;
