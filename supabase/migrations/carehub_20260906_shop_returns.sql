-- Shop order returns and refunds
-- Allows customers to request returns for delivered orders within 7 days
-- Vendors can approve/reject return requests

CREATE TABLE IF NOT EXISTS shop_order_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','completed','cancelled')),
  reason text NOT NULL,
  description text,
  refund_amount_kobo integer NOT NULL CHECK (refund_amount_kobo >= 0),
  refund_method text DEFAULT 'original_payment' CHECK (refund_method IN ('original_payment','wallet','manual')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_returns_order ON shop_order_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_shop_returns_customer ON shop_order_returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_shop_returns_vendor ON shop_order_returns(vendor_business_id);
CREATE INDEX IF NOT EXISTS idx_shop_returns_status ON shop_order_returns(status);

-- Enable RLS
ALTER TABLE shop_order_returns ENABLE ROW LEVEL SECURITY;

-- RLS policies
DO $$ BEGIN
  -- Customers can view their own returns
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_returns_customer_select' AND tablename = 'shop_order_returns') THEN
    CREATE POLICY "shop_returns_customer_select" ON shop_order_returns
    FOR SELECT TO authenticated
    USING (customer_id = auth.uid());
  END IF;

  -- Customers can create returns for their own orders
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_returns_customer_insert' AND tablename = 'shop_order_returns') THEN
    CREATE POLICY "shop_returns_customer_insert" ON shop_order_returns
    FOR INSERT TO authenticated
    WITH CHECK (customer_id = auth.uid());
  END IF;

  -- Vendors can view returns for their orders
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_returns_vendor_select' AND tablename = 'shop_order_returns') THEN
    CREATE POLICY "shop_returns_vendor_select" ON shop_order_returns
    FOR SELECT TO authenticated
    USING (vendor_business_id IN (SELECT id FROM businesses WHERE lower(email) = lower(auth.email())));
  END IF;

  -- Vendors can update returns for their orders (approve/reject)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_returns_vendor_update' AND tablename = 'shop_order_returns') THEN
    CREATE POLICY "shop_returns_vendor_update" ON shop_order_returns
    FOR UPDATE TO authenticated
    USING (vendor_business_id IN (SELECT id FROM businesses WHERE lower(email) = lower(auth.email())));
  END IF;
END $$;

-- Request return RPC
CREATE OR REPLACE FUNCTION public.request_shop_return(
  p_order_id uuid,
  p_reason text,
  p_description text DEFAULT NULL,
  p_refund_amount_kobo integer DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order record;
  v_return_id uuid;
  v_days_since_delivery integer;
BEGIN
  -- Get order details
  SELECT * INTO v_order FROM shop_orders WHERE id = p_order_id FOR UPDATE;
  
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  
  -- Verify customer owns the order
  IF v_order.customer_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  
  -- Check order is delivered
  IF v_order.status != 'delivered' THEN
    RAISE EXCEPTION 'Can only request return for delivered orders';
  END IF;
  
  -- Check within 7-day return window
  SELECT EXTRACT(DAY FROM (now() - v_order.updated_at))::integer INTO v_days_since_delivery;
  IF v_days_since_delivery > 7 THEN
    RAISE EXCEPTION 'Return window (7 days) has expired';
  END IF;
  
  -- Check no existing return request
  IF EXISTS (SELECT 1 FROM shop_order_returns WHERE order_id = p_order_id AND status IN ('requested','approved','completed')) THEN
    RAISE EXCEPTION 'Return already requested for this order';
  END IF;
  
  -- Default refund amount to order total if not specified
  IF p_refund_amount_kobo IS NULL THEN
    p_refund_amount_kobo := v_order.total_kobo;
  END IF;
  
  -- Create return request
  INSERT INTO shop_order_returns (
    order_id, customer_id, vendor_business_id, reason, description, refund_amount_kobo
  ) VALUES (
    p_order_id, v_order.customer_id, v_order.vendor_business_id, p_reason, p_description, p_refund_amount_kobo
  ) RETURNING id INTO v_return_id;
  
  -- Update order status
  UPDATE shop_orders SET status = 'refund_requested', updated_at = now() WHERE id = p_order_id;
  
  -- Notify vendor via staff_notifications
  INSERT INTO staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  VALUES (v_order.vendor_business_id, null, true, 'return_request', 'Return Request', 
    'Customer requested return for order ' || v_order.order_ref || ' - Reason: ' || p_reason,
    '/dashboard/ecommerce/orders/' || p_order_id::text);
  
  RETURN v_return_id;
END;
$$;

-- Process return (approve/reject) RPC
CREATE OR REPLACE FUNCTION public.process_shop_return(
  p_return_id uuid,
  p_action text, -- 'approve' or 'reject'
  p_notes text DEFAULT NULL
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_return record;
  v_order record;
BEGIN
  -- Get return details
  SELECT * INTO v_return FROM shop_order_returns WHERE id = p_return_id FOR UPDATE;
  
  IF v_return IS NULL THEN
    RAISE EXCEPTION 'Return not found';
  END IF;
  
  -- Verify vendor owns the order
  IF NOT EXISTS (
    SELECT 1 FROM businesses 
    WHERE id = v_return.vendor_business_id AND lower(email) = lower(auth.email())
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  
  -- Check return is pending
  IF v_return.status != 'requested' THEN
    RAISE EXCEPTION 'Return is not pending';
  END IF;
  
  -- Get order details
  SELECT * INTO v_order FROM shop_orders WHERE id = v_return.order_id;
  
  IF p_action = 'approve' THEN
    -- Approve return
    UPDATE shop_order_returns 
    SET status = 'approved', resolved_at = now(), resolved_by = auth.uid(), resolution_notes = p_notes
    WHERE id = p_return_id;
    
    -- Update order status
    UPDATE shop_orders SET status = 'refunded', payment_status = 'refunded', updated_at = now()
    WHERE id = v_return.order_id;
    
    -- Restore inventory
    PERFORM shop_restore_inventory_on_cancel(v_return.order_id);
    
    -- Notify customer
    INSERT INTO notifications (user_id, type, title, message, data)
    VALUES (v_return.customer_id, 'return_approved', 'Return Approved',
      'Your return for order ' || v_order.order_ref || ' has been approved. Refund of ₦' || 
      (v_return.refund_amount_kobo / 100)::text || ' will be processed.',
      jsonb_build_object('return_id', p_return_id, 'order_id', v_return.order_id));
    
    RETURN 'approved';
    
  ELSIF p_action = 'reject' THEN
    -- Reject return
    UPDATE shop_order_returns 
    SET status = 'rejected', resolved_at = now(), resolved_by = auth.uid(), resolution_notes = p_notes
    WHERE id = p_return_id;
    
    -- Update order status back to delivered
    UPDATE shop_orders SET status = 'delivered', updated_at = now()
    WHERE id = v_return.order_id;
    
    -- Notify customer
    INSERT INTO notifications (user_id, type, title, message, data)
    VALUES (v_return.customer_id, 'return_rejected', 'Return Rejected',
      'Your return for order ' || v_order.order_ref || ' has been rejected.' ||
      COALESCE(' Reason: ' || p_notes, ''),
      jsonb_build_object('return_id', p_return_id, 'order_id', v_return.order_id));
    
    RETURN 'rejected';
  ELSE
    RAISE EXCEPTION 'Invalid action. Must be approve or reject';
  END IF;
END;
$$;

-- Grant execute permissions
REVOKE ALL ON FUNCTION public.request_shop_return(uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_shop_return(uuid, text, text, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.process_shop_return(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_shop_return(uuid, text, text) TO authenticated;
