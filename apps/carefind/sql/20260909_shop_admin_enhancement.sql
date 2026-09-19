-- 20260909_shop_admin_enhancement.sql
-- Enhances the Shop admin with order notification tracking and
-- additional fulfilment status support for the CareFind Admin Dashboard.

-- ============================================================================
-- 1. shop_order_notifications — tracks customer-facing notifications
--    triggered at each order stage. The admin system records the stage
--    and marks when the notification was sent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS shop_order_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  message text NOT NULL,
  channel text NOT NULL DEFAULT 'in_app',
  recipient_id uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_order_notifications_order
  ON shop_order_notifications(order_id);
CREATE INDEX IF NOT EXISTS idx_shop_order_notifications_recipient
  ON shop_order_notifications(recipient_id);

-- Notification type CHECK — matches the required customer notification stages.
ALTER TABLE shop_order_notifications
  ADD CONSTRAINT chk_shop_order_notification_type
  CHECK (notification_type IN (
    'order_received',
    'payment_confirmed',
    'order_processing',
    'order_packed',
    'at_pickup_station',
    'ready_for_pickup',
    'ready_for_delivery',
    'out_for_delivery',
    'order_delivered',
    'order_cancelled',
    'refund_requested',
    'refund_processed',
    'review_request'
  ));

-- RLS: deny-all for anon/authenticated, service-role only.
ALTER TABLE shop_order_notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. RPC: record_shop_notification
--    Records a notification triggered at an order stage.
--    Also inserts into the main notifications table for in-app delivery.
-- ============================================================================
CREATE OR REPLACE FUNCTION record_shop_notification(
  p_order_id uuid,
  p_notification_type text,
  p_message text,
  p_recipient_id uuid,
  p_channel text DEFAULT 'in_app'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notif_id uuid;
BEGIN
  INSERT INTO shop_order_notifications (order_id, notification_type, message, channel, recipient_id)
  VALUES (p_order_id, p_notification_type, p_message, p_channel, p_recipient_id)
  RETURNING id INTO v_notif_id;

  INSERT INTO notifications (recipient_id, type, message, title, data)
  VALUES (
    p_recipient_id,
    'shop_order',
    p_message,
    CASE p_notification_type
      WHEN 'order_received' THEN 'Order Received'
      WHEN 'payment_confirmed' THEN 'Payment Confirmed'
      WHEN 'order_processing' THEN 'Order Processing'
      WHEN 'order_packed' THEN 'Order Packed'
      WHEN 'at_pickup_station' THEN 'At Pickup Station'
      WHEN 'ready_for_pickup' THEN 'Ready for Pickup'
      WHEN 'ready_for_delivery' THEN 'Ready for Delivery'
      WHEN 'out_for_delivery' THEN 'Out for Delivery'
      WHEN 'order_delivered' THEN 'Order Delivered'
      WHEN 'order_cancelled' THEN 'Order Cancelled'
      WHEN 'refund_requested' THEN 'Refund Requested'
      WHEN 'refund_processed' THEN 'Refund Processed'
      WHEN 'review_request' THEN 'Rate Your Order'
      ELSE 'Order Update'
    END,
    jsonb_build_object('order_id', p_order_id, 'notification_type', p_notification_type)
  );

  RETURN v_notif_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_shop_notification(uuid, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_shop_notification(uuid, text, text, uuid, text) TO authenticated, service_role;

-- ============================================================================
-- 3. RPC: get_order_notification_history
--    Returns all notifications sent for a given order.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_order_notification_history(p_order_id uuid)
RETURNS TABLE (
  id uuid,
  notification_type text,
  message text,
  channel text,
  sent_at timestamptz,
  read_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT son.id, son.notification_type, son.message, son.channel, son.sent_at, son.read_at
  FROM shop_order_notifications son
  WHERE son.order_id = p_order_id
  ORDER BY son.sent_at ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_order_notification_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_order_notification_history(uuid) TO authenticated, service_role;

-- ============================================================================
-- 4. RPC: get_customer_purchase_summary
--    Returns a customer's lifetime purchase intelligence.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_customer_purchase_summary(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_orders', COUNT(*) FILTER (WHERE status NOT IN ('cancelled')),
    'completed_orders', COUNT(*) FILTER (WHERE status = 'delivered'),
    'total_spent_kobo', COALESCE(SUM(total_kobo) FILTER (WHERE status NOT IN ('cancelled')), 0),
    'total_refunded_kobo', COALESCE(SUM(total_kobo) FILTER (WHERE status = 'refunded'), 0),
    'first_order_at', MIN(created_at),
    'last_order_at', MAX(created_at),
    'average_order_value_kobo', COALESCE(AVG(total_kobo) FILTER (WHERE status NOT IN ('cancelled')), 0),
    'unique_vendors', COUNT(DISTINCT vendor_business_id) FILTER (WHERE status NOT IN ('cancelled')),
    'delivery_preference_breakdown', jsonb_build_object(
      'pickup', COUNT(*) FILTER (WHERE delivery_preference = 'pickup' AND status NOT IN ('cancelled')),
      'home', COUNT(*) FILTER (WHERE delivery_preference = 'home' AND status NOT IN ('cancelled'))
    )
  ) INTO v_result
  FROM shop_orders
  WHERE customer_id = p_customer_id;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_customer_purchase_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_customer_purchase_summary(uuid) TO authenticated, service_role;

-- ============================================================================
-- 5. RPC: get_admin_shop_overview
--    Returns high-level shop metrics for the admin dashboard.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_admin_shop_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_orders', (SELECT COUNT(*) FROM shop_orders),
    'pending_orders', (SELECT COUNT(*) FROM shop_orders WHERE status IN ('pending_payment', 'paid')),
    'processing_orders', (SELECT COUNT(*) FROM shop_orders WHERE status IN ('accepted', 'processing')),
    'ready_orders', (SELECT COUNT(*) FROM shop_orders WHERE status = 'ready_for_pickup'),
    'in_transit_orders', (SELECT COUNT(*) FROM shop_orders WHERE status = 'in_transit'),
    'delivered_orders', (SELECT COUNT(*) FROM shop_orders WHERE status = 'delivered'),
    'cancelled_orders', (SELECT COUNT(*) FROM shop_orders WHERE status = 'cancelled'),
    'disputed_orders', (SELECT COUNT(*) FROM shop_orders WHERE status IN ('disputed', 'refund_requested')),
    'total_revenue_kobo', (SELECT COALESCE(SUM(total_kobo), 0) FROM shop_orders WHERE status NOT IN ('cancelled', 'refunded')),
    'total_commission_kobo', (SELECT COALESCE(SUM(commission_kobo), 0) FROM shop_orders WHERE status NOT IN ('cancelled', 'refunded')),
    'active_vendors', (SELECT COUNT(DISTINCT vendor_business_id) FROM shop_orders WHERE created_at > now() - INTERVAL '30 days'),
    'active_customers', (SELECT COUNT(DISTINCT customer_id) FROM shop_orders WHERE created_at > now() - INTERVAL '30 days'),
    'today_orders', (SELECT COUNT(*) FROM shop_orders WHERE created_at >= CURRENT_DATE),
    'today_revenue_kobo', (SELECT COALESCE(SUM(total_kobo), 0) FROM shop_orders WHERE created_at >= CURRENT_DATE AND status NOT IN ('cancelled', 'refunded'))
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_admin_shop_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_admin_shop_overview() TO authenticated, service_role;
