-- Product Recommendations System
-- Tracks product relationships and provides smart recommendations

-- 1. Product relationships table (manual + auto-generated)
CREATE TABLE IF NOT EXISTS shop_product_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
  related_product_id uuid NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (relationship_type IN ('related', 'frequently_bought_together', 'alternative', 'complementary')),
  strength numeric(3,2) DEFAULT 1.00 CHECK (strength >= 0 AND strength <= 1), -- 0.00 to 1.00
  is_manual boolean NOT NULL DEFAULT false, -- true if manually set by admin
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, related_product_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_shop_product_rel_product ON shop_product_relationships(product_id);
CREATE INDEX IF NOT EXISTS idx_shop_product_rel_related ON shop_product_relationships(related_product_id);
CREATE INDEX IF NOT EXISTS idx_shop_product_rel_type ON shop_product_relationships(relationship_type);

-- 2. Product view tracking (for analytics and recommendations)
CREATE TABLE IF NOT EXISTS shop_product_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id text,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_product_views_product ON shop_product_views(product_id);
CREATE INDEX IF NOT EXISTS idx_shop_product_views_user ON shop_product_views(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_product_views_time ON shop_product_views(viewed_at);

-- 3. Frequently bought together tracking
CREATE TABLE IF NOT EXISTS shop_purchase_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id_1 uuid NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
  product_id_2 uuid NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
  purchase_count integer NOT NULL DEFAULT 1,
  last_purchased_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id_1, product_id_2)
);

CREATE INDEX IF NOT EXISTS idx_shop_purchase_patterns_p1 ON shop_purchase_patterns(product_id_1);
CREATE INDEX IF NOT EXISTS idx_shop_purchase_patterns_p2 ON shop_purchase_patterns(product_id_2);
CREATE INDEX IF NOT EXISTS idx_shop_purchase_patterns_count ON shop_purchase_patterns(purchase_count DESC);

-- Enable RLS
ALTER TABLE shop_product_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_product_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_purchase_patterns ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DO $$ BEGIN
  -- Product relationships: public read
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_product_relationships_select' AND tablename = 'shop_product_relationships') THEN
    CREATE POLICY "shop_product_relationships_select" ON shop_product_relationships
    FOR SELECT TO authenticated
    USING (true);
  END IF;

  -- Product views: users can insert their own views
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_product_views_insert' AND tablename = 'shop_product_views') THEN
    CREATE POLICY "shop_product_views_insert" ON shop_product_views
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_product_views_select' AND tablename = 'shop_product_views') THEN
    CREATE POLICY "shop_product_views_select" ON shop_product_views
    FOR SELECT TO authenticated
    USING (true);
  END IF;

  -- Purchase patterns: public read
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_purchase_patterns_select' AND tablename = 'shop_purchase_patterns') THEN
    CREATE POLICY "shop_purchase_patterns_select" ON shop_purchase_patterns
    FOR SELECT TO authenticated
    USING (true);
  END IF;
END $$;

-- Function to track product view
CREATE OR REPLACE FUNCTION public.track_product_view(
  p_product_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_session_id text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO shop_product_views (product_id, user_id, session_id)
  VALUES (p_product_id, p_user_id, p_session_id);
END;
$$;

-- Function to track purchase patterns (called after order completion)
CREATE OR REPLACE FUNCTION public.track_purchase_pattern(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_items uuid[];
  v_item1 uuid;
  v_item2 uuid;
  v_i integer;
  v_j integer;
BEGIN
  -- Get all products in this order
  SELECT ARRAY_AGG(ecommerce_product_id) INTO v_items
  FROM shop_order_items
  WHERE order_id = p_order_id;

  -- If less than 2 items, no patterns to track
  IF v_items IS NULL OR array_length(v_items, 1) < 2 THEN
    RETURN;
  END IF;

  -- Track all pairs
  FOR v_i IN 1..array_length(v_items, 1) LOOP
    FOR v_j IN (v_i + 1)..array_length(v_items, 1) LOOP
      v_item1 := v_items[v_i];
      v_item2 := v_items[v_j];

      -- Ensure consistent ordering (smaller ID first)
      IF v_item1 > v_item2 THEN
        v_item1 := v_items[v_j];
        v_item2 := v_items[v_i];
      END IF;

      -- Insert or update pattern
      INSERT INTO shop_purchase_patterns (product_id_1, product_id_2, purchase_count, last_purchased_at)
      VALUES (v_item1, v_item2, 1, now())
      ON CONFLICT (product_id_1, product_id_2)
      DO UPDATE SET
        purchase_count = shop_purchase_patterns.purchase_count + 1,
        last_purchased_at = now();
    END LOOP;
  END LOOP;
END;
$$;

-- Function to auto-generate related products based on category and views
CREATE OR REPLACE FUNCTION public.auto_generate_recommendations(p_product_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_category text;
  v_business_id uuid;
BEGIN
  -- Get product details
  SELECT category, business_id INTO v_category, v_business_id
  FROM ecommerce_products
  WHERE id = p_product_id;

  IF v_category IS NULL THEN
    RETURN;
  END IF;

  -- Insert related products from same category (if not already exists)
  INSERT INTO shop_product_relationships (product_id, related_product_id, relationship_type, strength, is_manual)
  SELECT
    p_product_id,
    ep.id,
    'related',
    0.7,
    false
  FROM ecommerce_products ep
  WHERE ep.category = v_category
    AND ep.id != p_product_id
    AND ep.status = 'Active'
    AND ep.is_restricted = false
    AND NOT EXISTS (
      SELECT 1 FROM shop_product_relationships spr
      WHERE spr.product_id = p_product_id
        AND spr.related_product_id = ep.id
    )
  LIMIT 10;
END;
$$;

-- Function to get product recommendations
CREATE OR REPLACE FUNCTION public.get_product_recommendations(
  p_product_id uuid,
  p_limit integer DEFAULT 6,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  product_id uuid,
  name text,
  price integer,
  image_url text,
  relationship_type text,
  strength numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH manual_recs AS (
    -- Manual recommendations (highest priority)
    SELECT
      spr.related_product_id,
      p.name,
      p.price,
      (SELECT url FROM ecommerce_product_images WHERE ecommerce_product_id = spr.related_product_id ORDER BY position LIMIT 1) as image_url,
      spr.relationship_type,
      spr.strength
    FROM shop_product_relationships spr
    JOIN ecommerce_products ep ON ep.id = spr.related_product_id
    JOIN products p ON p.id = ep.product_id
    WHERE spr.product_id = p_product_id
      AND ep.status = 'Active'
      AND ep.is_restricted = false
    ORDER BY spr.is_manual DESC, spr.strength DESC
    LIMIT p_limit
  ),
  category_recs AS (
    -- Category-based recommendations (if manual not enough)
    SELECT
      ep.id as related_product_id,
      p.name,
      p.price,
      (SELECT url FROM ecommerce_product_images WHERE ecommerce_product_id = ep.id ORDER BY position LIMIT 1) as image_url,
      'related' as relationship_type,
      0.5 as strength
    FROM ecommerce_products ep
    JOIN products p ON p.id = ep.product_id
    WHERE ep.category = (SELECT category FROM ecommerce_products WHERE id = p_product_id)
      AND ep.id != p_product_id
      AND ep.status = 'Active'
      AND ep.is_restricted = false
      AND NOT EXISTS (SELECT 1 FROM manual_recs mr WHERE mr.related_product_id = ep.id)
    ORDER BY p.stock DESC, ep.active_at DESC
    LIMIT p_limit - (SELECT count(*) FROM manual_recs)
  ),
  fbt_recs AS (
    -- Frequently bought together (if still not enough)
    SELECT
      CASE WHEN pp.product_id_1 = p_product_id THEN pp.product_id_2 ELSE pp.product_id_1 END as related_product_id,
      p.name,
      p.price,
      (SELECT url FROM ecommerce_product_images WHERE ecommerce_product_id = (CASE WHEN pp.product_id_1 = p_product_id THEN pp.product_id_2 ELSE pp.product_id_1 END) ORDER BY position LIMIT 1) as image_url,
      'frequently_bought_together' as relationship_type,
      LEAST(1.0, pp.purchase_count::numeric / 10) as strength
    FROM shop_purchase_patterns pp
    JOIN ecommerce_products ep ON ep.id = (CASE WHEN pp.product_id_1 = p_product_id THEN pp.product_id_2 ELSE pp.product_id_1 END)
    JOIN products p ON p.id = ep.product_id
    WHERE (pp.product_id_1 = p_product_id OR pp.product_id_2 = p_product_id)
      AND ep.status = 'Active'
      AND ep.is_restricted = false
      AND NOT EXISTS (SELECT 1 FROM manual_recs mr WHERE mr.related_product_id = (CASE WHEN pp.product_id_1 = p_product_id THEN pp.product_id_2 ELSE pp.product_id_1 END))
      AND NOT EXISTS (SELECT 1 FROM category_recs cr WHERE cr.related_product_id = (CASE WHEN pp.product_id_1 = p_product_id THEN pp.product_id_2 ELSE pp.product_id_1 END))
    ORDER BY pp.purchase_count DESC
    LIMIT p_limit - (SELECT count(*) FROM manual_recs) - (SELECT count(*) FROM category_recs)
  )
  SELECT * FROM manual_recs
  UNION ALL
  SELECT * FROM category_recs
  UNION ALL
  SELECT * FROM fbt_recs
  LIMIT p_limit;
END;
$$;

-- Grant execute permissions
REVOKE ALL ON FUNCTION public.track_product_view(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_product_view(uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.track_purchase_pattern(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_purchase_pattern(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.auto_generate_recommendations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_generate_recommendations(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_product_recommendations(uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_recommendations(uuid, integer, uuid) TO authenticated;
