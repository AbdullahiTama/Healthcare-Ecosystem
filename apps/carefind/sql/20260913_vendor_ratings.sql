-- Vendor rating system for e-commerce orders
-- Allows customers to rate vendors after delivery

CREATE TABLE IF NOT EXISTS vendor_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  vendor_business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Rating categories (1-5 stars each)
  fulfillment_speed integer NOT NULL CHECK (fulfillment_speed >= 1 AND fulfillment_speed <= 5),
  packaging_quality integer NOT NULL CHECK (packaging_quality >= 1 AND packaging_quality <= 5),
  accuracy integer NOT NULL CHECK (accuracy >= 1 AND accuracy <= 5),
  overall_rating integer NOT NULL CHECK (overall_rating >= 1 AND overall_rating <= 5),
  
  -- Optional feedback
  comment text,
  
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- One rating per order per customer
  UNIQUE(order_id, customer_id)
);

-- Enable RLS
ALTER TABLE vendor_ratings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Customers can view their own ratings"
  ON vendor_ratings FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());

CREATE POLICY "Customers can create ratings for their orders"
  ON vendor_ratings FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Customers can update their own ratings"
  ON vendor_ratings FOR UPDATE
  TO authenticated
  USING (customer_id = auth.uid());

-- Vendors can view ratings for their business
CREATE POLICY "Vendors can view ratings for their business"
  ON vendor_ratings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = vendor_ratings.vendor_business_id
      AND businesses.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_vendor_ratings_vendor ON vendor_ratings(vendor_business_id);
CREATE INDEX IF NOT EXISTS idx_vendor_ratings_customer ON vendor_ratings(customer_id);
CREATE INDEX IF NOT EXISTS idx_vendor_ratings_order ON vendor_ratings(order_id);

-- Function to calculate vendor average ratings
CREATE OR REPLACE FUNCTION get_vendor_rating_stats(p_vendor_business_id uuid)
RETURNS TABLE (
  total_ratings bigint,
  avg_overall numeric,
  avg_fulfillment_speed numeric,
  avg_packaging_quality numeric,
  avg_accuracy numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::bigint as total_ratings,
    ROUND(AVG(overall_rating)::numeric, 2) as avg_overall,
    ROUND(AVG(fulfillment_speed)::numeric, 2) as avg_fulfillment_speed,
    ROUND(AVG(packaging_quality)::numeric, 2) as avg_packaging_quality,
    ROUND(AVG(accuracy)::numeric, 2) as avg_accuracy
  FROM vendor_ratings
  WHERE vendor_business_id = p_vendor_business_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_vendor_rating_stats TO authenticated;

-- Updated at trigger
CREATE TRIGGER update_vendor_ratings_updated_at
  BEFORE UPDATE ON vendor_ratings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
