-- Delivery tracking and notifications
-- Enhances order tracking with delivery zones, status notifications, and public tracking

-- 1. Delivery zones table
CREATE TABLE IF NOT EXISTS shop_delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  zone_type text NOT NULL CHECK (zone_type IN ('free', 'standard', 'express', 'custom')),
  base_fee_kobo integer NOT NULL DEFAULT 0,
  per_km_fee_kobo integer NOT NULL DEFAULT 0,
  min_distance_km numeric(8,2) DEFAULT 0,
  max_distance_km numeric(8,2),
  estimated_days integer DEFAULT 3,
  is_active boolean NOT NULL DEFAULT true,
  polygon jsonb, -- GeoJSON polygon for zone boundaries
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_delivery_zones_active ON shop_delivery_zones(is_active) WHERE is_active = true;

-- 2. Order tracking events table
CREATE TABLE IF NOT EXISTS shop_order_tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  status text NOT NULL,
  location jsonb, -- {lat, lng, address}
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_tracking_events_order ON shop_order_tracking_events(order_id);
CREATE INDEX IF NOT EXISTS idx_shop_tracking_events_time ON shop_order_tracking_events(created_at);

-- 3. Public tracking tokens (for sharing tracking without login)
CREATE TABLE IF NOT EXISTS shop_tracking_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_tracking_tokens_token ON shop_tracking_tokens(token);
CREATE INDEX IF NOT EXISTS idx_shop_tracking_tokens_order ON shop_tracking_tokens(order_id);

-- Enable RLS
ALTER TABLE shop_delivery_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_order_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_tracking_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DO $$ BEGIN
  -- Delivery zones: public read
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_delivery_zones_select' AND tablename = 'shop_delivery_zones') THEN
    CREATE POLICY "shop_delivery_zones_select" ON shop_delivery_zones
    FOR SELECT TO authenticated
    USING (true);
  END IF;

  -- Tracking events: customers see their own, vendors see their orders
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_tracking_events_customer_select' AND tablename = 'shop_order_tracking_events') THEN
    CREATE POLICY "shop_tracking_events_customer_select" ON shop_order_tracking_events
    FOR SELECT TO authenticated
    USING (
      order_id IN (SELECT id FROM shop_orders WHERE customer_id = auth.uid())
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_tracking_events_vendor_select' AND tablename = 'shop_order_tracking_events') THEN
    CREATE POLICY "shop_tracking_events_vendor_select" ON shop_order_tracking_events
    FOR SELECT TO authenticated
    USING (
      order_id IN (SELECT id FROM shop_orders WHERE vendor_business_id IN (
        SELECT id FROM businesses WHERE owner_id = auth.uid()
      ))
    );
  END IF;

  -- Tracking tokens: public read (for sharing)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_tracking_tokens_select' AND tablename = 'shop_tracking_tokens') THEN
    CREATE POLICY "shop_tracking_tokens_select" ON shop_tracking_tokens
    FOR SELECT TO anon, authenticated
    USING (true);
  END IF;

  -- Tracking tokens: authenticated users can create for their orders
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_tracking_tokens_insert' AND tablename = 'shop_tracking_tokens') THEN
    CREATE POLICY "shop_tracking_tokens_insert" ON shop_tracking_tokens
    FOR INSERT TO authenticated
    WITH CHECK (
      order_id IN (SELECT id FROM shop_orders WHERE customer_id = auth.uid())
    );
  END IF;
END $$;

-- Function to generate tracking token
CREATE OR REPLACE FUNCTION public.generate_tracking_token(p_order_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_token text;
  v_customer_id uuid;
BEGIN
  -- Verify order exists and get customer
  SELECT customer_id INTO v_customer_id FROM shop_orders WHERE id = p_order_id;
  
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  
  -- Verify caller is the customer
  IF v_customer_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  
  -- Check if token already exists
  SELECT token INTO v_token FROM shop_tracking_tokens WHERE order_id = p_order_id AND expires_at > now();
  
  IF v_token IS NOT NULL THEN
    RETURN v_token;
  END IF;
  
  -- Generate new token
  v_token := 'TRK-' || encode(gen_random_bytes(8), 'hex');
  
  INSERT INTO shop_tracking_tokens (order_id, token)
  VALUES (p_order_id, v_token);
  
  RETURN v_token;
END;
$$;

-- Function to get tracking info by token (public access)
CREATE OR REPLACE FUNCTION public.get_tracking_by_token(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order record;
  v_events jsonb;
  v_result jsonb;
BEGIN
  -- Get order by token
  SELECT o.* INTO v_order
  FROM shop_orders o
  JOIN shop_tracking_tokens t ON t.order_id = o.id
  WHERE t.token = p_token AND t.expires_at > now();
  
  IF v_order IS NULL THEN
    RETURN jsonb_build_object('error', 'Invalid or expired tracking token');
  END IF;
  
  -- Get tracking events
  SELECT jsonb_agg(jsonb_build_object(
    'status', status,
    'notes', notes,
    'location', location,
    'created_at', created_at
  ) ORDER BY created_at DESC) INTO v_events
  FROM shop_order_tracking_events
  WHERE order_id = v_order.id;
  
  -- Build result
  v_result := jsonb_build_object(
    'order_ref', v_order.order_ref,
    'status', v_order.status,
    'created_at', v_order.created_at,
    'estimated_delivery', CASE
      WHEN v_order.status = 'delivered' THEN v_order.updated_at
      WHEN v_order.delivery_preference = 'pickup' THEN v_order.created_at + interval '1 day'
      ELSE v_order.created_at + interval '3 days'
    END,
    'delivery_preference', v_order.delivery_preference,
    'tracking_events', COALESCE(v_events, '[]'::jsonb)
  );
  
  RETURN v_result;
END;
$$;

-- Function to add tracking event
CREATE OR REPLACE FUNCTION public.add_tracking_event(
  p_order_id uuid,
  p_status text,
  p_notes text DEFAULT NULL,
  p_location jsonb DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_vendor_business_id uuid;
BEGIN
  -- Get order's vendor
  SELECT vendor_business_id INTO v_vendor_business_id FROM shop_orders WHERE id = p_order_id;
  
  IF v_vendor_business_id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  
  -- Verify caller is the vendor
  IF NOT EXISTS (
    SELECT 1 FROM businesses
    WHERE id = v_vendor_business_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  
  -- Insert tracking event
  INSERT INTO shop_order_tracking_events (order_id, status, location, notes, created_by)
  VALUES (p_order_id, p_status, p_location, p_notes, auth.uid());
  
  -- Update order status
  UPDATE shop_orders
  SET status = p_status, updated_at = now()
  WHERE id = p_order_id;
  
  -- Notify customer
  INSERT INTO notifications (user_id, type, title, message, data)
  SELECT
    customer_id,
    'order_status_update',
    'Order Status Updated',
    'Your order ' || (SELECT order_ref FROM shop_orders WHERE id = p_order_id) || ' is now: ' || p_status,
    jsonb_build_object('order_id', p_order_id, 'status', p_status)
  FROM shop_orders
  WHERE id = p_order_id;
END;
$$;

-- Function to calculate delivery fee based on distance
CREATE OR REPLACE FUNCTION public.calculate_delivery_fee(
  p_distance_km numeric,
  p_zone_type text DEFAULT 'standard'
)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_zone record;
  v_fee integer;
BEGIN
  -- Get zone pricing
  SELECT * INTO v_zone
  FROM shop_delivery_zones
  WHERE zone_type = p_zone_type
    AND is_active = true
    AND (p_distance_km >= min_distance_km OR min_distance_km IS NULL)
    AND (p_distance_km <= max_distance_km OR max_distance_km IS NULL)
  LIMIT 1;
  
  IF v_zone IS NULL THEN
    -- Default pricing if no zone found
    IF p_distance_km <= 3 THEN
      RETURN 0; -- Free within 3km
    ELSIF p_distance_km <= 6 THEN
      RETURN 60000; -- ₦600
    ELSIF p_distance_km <= 9 THEN
      RETURN 120000; -- ₦1,200
    ELSE
      RETURN 180000; -- ₦1,800
    END IF;
  END IF;
  
  -- Calculate fee
  v_fee := v_zone.base_fee_kobo + (p_distance_km * v_zone.per_km_fee_kobo);
  
  RETURN v_fee;
END;
$$;

-- Grant permissions
REVOKE ALL ON FUNCTION public.generate_tracking_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_tracking_token(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_tracking_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tracking_by_token(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.add_tracking_event(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_tracking_event(uuid, text, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.calculate_delivery_fee(numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_delivery_fee(numeric, text) TO authenticated;

-- Insert default delivery zones
INSERT INTO shop_delivery_zones (name, zone_type, base_fee_kobo, per_km_fee_kobo, min_distance_km, max_distance_km, estimated_days)
VALUES
  ('Free Delivery Zone', 'free', 0, 0, 0, 3, 1),
  ('Standard Delivery', 'standard', 60000, 20000, 3, 10, 3),
  ('Express Delivery', 'express', 150000, 30000, 0, 5, 1)
ON CONFLICT DO NOTHING;
