-- ============================================================================
-- Stock Validation — session-based physical stock audit.
--
-- A user walks the shelf, counts each product, and records the difference
-- between what the system says and what is actually there. Each audit run is
-- one session; each counted product is one item row. When an adjustment is
-- made, the product's live stock is updated atomically inside the same RPC
-- transaction so the journal and the product table can never disagree.
--
-- Depends on: phase2_rls_pilot.sql (current_business_ids(), is_platform_admin())
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. stock_validation_sessions — one row per audit run.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_validation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  user_id uuid REFERENCES auth.users(id),
  user_name text NOT NULL,
  products_checked int NOT NULL DEFAULT 0,
  products_adjusted int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_validation_sessions_business_id
  ON stock_validation_sessions(business_id);

CREATE INDEX IF NOT EXISTS idx_stock_validation_sessions_created_at
  ON stock_validation_sessions(created_at DESC);

ALTER TABLE stock_validation_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock_validation_sessions of own business" ON stock_validation_sessions;
CREATE POLICY "stock_validation_sessions of own business" ON stock_validation_sessions
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

-- ----------------------------------------------------------------------------
-- 2. stock_validation_items — one row per product counted in a session.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_validation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES stock_validation_sessions(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  shelf_label text,
  previous_stock int NOT NULL DEFAULT 0,
  adjustment_qty int NOT NULL DEFAULT 0,
  adjustment_direction text NOT NULL CHECK (adjustment_direction IN ('+', '-')),
  new_stock int NOT NULL DEFAULT 0,
  reason text,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_validation_items_session_id
  ON stock_validation_items(session_id);

CREATE INDEX IF NOT EXISTS idx_stock_validation_items_product_id
  ON stock_validation_items(product_id);

ALTER TABLE stock_validation_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock_validation_items via parent session" ON stock_validation_items;
CREATE POLICY "stock_validation_items via parent session" ON stock_validation_items
  FOR ALL
  USING (is_platform_admin() OR session_id IN (
    SELECT id FROM stock_validation_sessions WHERE business_id IN (SELECT current_business_ids())
  ))
  WITH CHECK (is_platform_admin() OR session_id IN (
    SELECT id FROM stock_validation_sessions WHERE business_id IN (SELECT current_business_ids())
  ));

-- ----------------------------------------------------------------------------
-- 3. products — add shelf_label column if not already present.
-- ----------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS shelf_label text;

-- ----------------------------------------------------------------------------
-- 4. save_stock_validation_session — atomic RPC: inserts the session, loops
--    through the JSONB items array, inserts each item row, and updates the
--    product's live stock in the same transaction.
--
--    p_items shape:
--    [
--      {
--        "product_id": uuid,
--        "product_name": text,
--        "shelf_label": text | null,
--        "previous_stock": int,
--        "adjustment_qty": int,
--        "adjustment_direction": "+" | "-",
--        "new_stock": int,
--        "reason": text | null,
--        "unit_price": numeric
--      },
--      ...
--    ]
--
--    SECURITY INVOKER — products RLS enforces the tenant boundary; a caller
--    can only adjust products in their own business.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_stock_validation_session(
  p_business_id uuid,
  p_user_id uuid,
  p_user_name text,
  p_products_checked int,
  p_products_adjusted int,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session_id uuid;
  v_item jsonb;
BEGIN
  INSERT INTO stock_validation_sessions (business_id, user_id, user_name, products_checked, products_adjusted)
  VALUES (p_business_id, p_user_id, p_user_name, p_products_checked, p_products_adjusted)
  RETURNING id INTO v_session_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO stock_validation_items (
      session_id,
      product_id,
      product_name,
      shelf_label,
      previous_stock,
      adjustment_qty,
      adjustment_direction,
      new_stock,
      reason,
      unit_price
    ) VALUES (
      v_session_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      v_item->>'shelf_label',
      (v_item->>'previous_stock')::int,
      (v_item->>'adjustment_qty')::int,
      v_item->>'adjustment_direction',
      (v_item->>'new_stock')::int,
      v_item->>'reason',
      COALESCE((v_item->>'unit_price')::numeric, 0)
    );

    UPDATE products
       SET stock = (v_item->>'new_stock')::int
     WHERE id = (v_item->>'product_id')::uuid
       AND business_id = p_business_id;
  END LOOP;

  RETURN v_session_id;
END;
$$;

COMMENT ON FUNCTION public.save_stock_validation_session(uuid, uuid, text, int, int, jsonb) IS
  'Atomic stock validation: inserts a session with its item rows and updates '
  'each product stock in a single transaction. SECURITY INVOKER — products '
  'RLS enforces the tenant boundary.';

REVOKE ALL ON FUNCTION public.save_stock_validation_session(uuid, uuid, text, int, int, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_stock_validation_session(uuid, uuid, text, int, int, jsonb) TO authenticated;
