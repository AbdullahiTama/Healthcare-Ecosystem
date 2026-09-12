-- Shop stock alerts - notify users when out-of-stock products are back in stock
-- Allows users to subscribe to stock alerts for specific products

CREATE TABLE IF NOT EXISTS shop_stock_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ecommerce_product_id uuid NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, ecommerce_product_id)
);

CREATE INDEX IF NOT EXISTS idx_shop_stock_alerts_user ON shop_stock_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_stock_alerts_product ON shop_stock_alerts(ecommerce_product_id);
CREATE INDEX IF NOT EXISTS idx_shop_stock_alerts_active ON shop_stock_alerts(is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE shop_stock_alerts ENABLE ROW LEVEL SECURITY;

-- RLS policies
DO $$ BEGIN
  -- Users can view their own alerts
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_stock_alerts_user_select' AND tablename = 'shop_stock_alerts') THEN
    CREATE POLICY "shop_stock_alerts_user_select" ON shop_stock_alerts
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());
  END IF;

  -- Users can create their own alerts
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_stock_alerts_user_insert' AND tablename = 'shop_stock_alerts') THEN
    CREATE POLICY "shop_stock_alerts_user_insert" ON shop_stock_alerts
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());
  END IF;

  -- Users can update their own alerts
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_stock_alerts_user_update' AND tablename = 'shop_stock_alerts') THEN
    CREATE POLICY "shop_stock_alerts_user_update" ON shop_stock_alerts
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
  END IF;

  -- Users can delete their own alerts
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_stock_alerts_user_delete' AND tablename = 'shop_stock_alerts') THEN
    CREATE POLICY "shop_stock_alerts_user_delete" ON shop_stock_alerts
    FOR DELETE TO authenticated
    USING (user_id = auth.uid());
  END IF;
END $$;

-- Trigger to notify users when product stock is restored
CREATE OR REPLACE FUNCTION public.notify_stock_alerts_on_restock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_alert record;
  v_product_name text;
BEGIN
  -- Only trigger when stock goes from 0 to > 0
  IF OLD.stock <= 0 AND NEW.stock > 0 THEN
    -- Get product name
    SELECT ep.description INTO v_product_name
    FROM ecommerce_products ep
    WHERE ep.id = NEW.id;

    -- Notify all active subscribers
    FOR v_alert IN
      SELECT sa.id, sa.user_id
      FROM shop_stock_alerts sa
      WHERE sa.ecommerce_product_id = NEW.id
        AND sa.is_active = true
        AND sa.notified_at IS NULL
    LOOP
      -- Insert notification
      INSERT INTO notifications (user_id, type, title, message, data)
      VALUES (
        v_alert.user_id,
        'stock_alert',
        'Product Back in Stock',
        COALESCE(v_product_name, 'A product you''re watching') || ' is now available!',
        jsonb_build_object('ecommerce_product_id', NEW.id)
      );

      -- Mark as notified
      UPDATE shop_stock_alerts
      SET notified_at = now(), is_active = false, updated_at = now()
      WHERE id = v_alert.id;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on products table
DROP TRIGGER IF EXISTS trg_notify_stock_alerts ON products;
CREATE TRIGGER trg_notify_stock_alerts
  AFTER UPDATE OF stock ON products
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_stock_alerts_on_restock();

-- Grant permissions
REVOKE ALL ON TABLE shop_stock_alerts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON shop_stock_alerts TO authenticated;
