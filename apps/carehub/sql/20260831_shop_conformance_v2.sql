-- ============================================================================
-- Shop Conformance Hardening v2 — Closes P0 gaps from Aug 30 audit
-- - Preserves enterprise `orders` (rep orders) by using `shop_` prefix
-- - Adds medical compliance fields, approved-vendor public filter, row-locked
--   order creation, payments + idempotency, status model, notifications
-- Status: APPLIED 2026-08-31 (shop_conformance_v2, shop_conformance_rpcs, shop_message_rpc, shop_update_status_fix)
-- ============================================================================

-- 1. Ecommerce compliance fields (A4.2, A12)
ALTER TABLE ecommerce_products
  ADD COLUMN IF NOT EXISTS prescription_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warnings text,
  ADD COLUMN IF NOT EXISTS restrictions text,
  ADD COLUMN IF NOT EXISTS is_restricted boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_ecommerce_vendor_approved(p_business_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM ecommerce_applications WHERE business_id = p_business_id AND status = 'Approved'); $$;
REVOKE ALL ON FUNCTION public.is_ecommerce_vendor_approved(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ecommerce_vendor_approved(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_ecommerce_product_complete(p_ecommerce_product_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
declare v_row RECORD; v_image_count int;
begin
  SELECT description, category, is_restricted INTO v_row FROM ecommerce_products WHERE id = p_ecommerce_product_id;
  IF v_row IS NULL THEN RETURN false; END IF;
  IF v_row.description IS NULL OR char_length(trim(v_row.description)) < 10 THEN RETURN false; END IF;
  IF v_row.category IS NULL OR char_length(trim(v_row.category)) = 0 THEN RETURN false; END IF;
  IF v_row.is_restricted THEN RETURN false; END IF;
  SELECT count(*) INTO v_image_count FROM ecommerce_product_images WHERE ecommerce_product_id = p_ecommerce_product_id;
  IF v_image_count = 0 THEN RETURN false; END IF;
  RETURN true;
end; $$;

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ecommerce_products' AND policyname='ecommerce_products public read') THEN DROP POLICY "ecommerce_products public read" ON ecommerce_products; END IF; END $$;
CREATE POLICY "ecommerce_products public read" ON ecommerce_products FOR SELECT USING (
  status = 'Active' AND is_restricted = false
  AND public.is_ecommerce_vendor_approved(business_id)
  AND EXISTS (SELECT 1 FROM products p WHERE p.id = ecommerce_products.product_id AND (p.stock IS NULL OR p.stock > 0))
);

-- 2. Shop tables
CREATE TABLE IF NOT EXISTS shop_pickup_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (char_length(trim(name)) > 0),
  address text NOT NULL, city text NOT NULL, state text NOT NULL, lat double precision, lng double precision,
  warehouse_id uuid REFERENCES enterprise_locations(id) ON DELETE SET NULL, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_pickup_city ON shop_pickup_stations(city);
CREATE INDEX IF NOT EXISTS idx_shop_pickup_active ON shop_pickup_stations(is_active) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_ref text UNIQUE NOT NULL,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','paid','accepted','processing','ready_for_pickup','in_transit','delivered','cancelled','refund_requested','refunded','disputed','delivery_quote_pending')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded')),
  subtotal_kobo integer NOT NULL CHECK (subtotal_kobo >= 0), commission_kobo integer NOT NULL CHECK (commission_kobo >= 0),
  fulfilment_kobo integer NOT NULL CHECK (fulfilment_kobo >= 0), delivery_kobo integer NOT NULL CHECK (delivery_kobo >= 0), total_kobo integer NOT NULL CHECK (total_kobo >= 0),
  delivery_address text NOT NULL, delivery_city text, delivery_state text, delivery_phone text, delivery_email text, delivery_instructions text,
  delivery_preference text NOT NULL CHECK (delivery_preference IN ('pickup','home')),
  distance_km numeric(8,2), is_approved_city boolean, pickup_station_id uuid REFERENCES shop_pickup_stations(id) ON DELETE SET NULL,
  customer_name text, payment_reference text UNIQUE, paystack_reference text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_orders_customer ON shop_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_shop_orders_vendor ON shop_orders(vendor_business_id);
CREATE INDEX IF NOT EXISTS idx_shop_orders_status ON shop_orders(status);
CREATE INDEX IF NOT EXISTS idx_shop_orders_payment_ref ON shop_orders(payment_reference);
CREATE INDEX IF NOT EXISTS idx_shop_orders_order_ref ON shop_orders(order_ref);

CREATE TABLE IF NOT EXISTS shop_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  ecommerce_product_id uuid NOT NULL REFERENCES ecommerce_products(id) ON DELETE RESTRICT, product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name text NOT NULL, quantity integer NOT NULL CHECK (quantity > 0), unit_price_kobo integer NOT NULL CHECK (unit_price_kobo >= 0), line_total_kobo integer NOT NULL CHECK (line_total_kobo >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_order_items_order ON shop_order_items(order_id);

CREATE TABLE IF NOT EXISTS shop_order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  from_status text, to_status text NOT NULL, changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_status_history_order ON shop_order_status_history(order_id);

CREATE TABLE IF NOT EXISTS shop_order_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, sender_role text NOT NULL DEFAULT 'customer' CHECK (sender_role IN ('customer','vendor','carefind_ops')),
  message text NOT NULL CHECK (char_length(trim(message)) > 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_order_messages_order ON shop_order_messages(order_id);

CREATE TABLE IF NOT EXISTS shop_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  payment_reference text UNIQUE NOT NULL, amount_kobo integer NOT NULL CHECK (amount_kobo >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','refunded')), gateway text NOT NULL DEFAULT 'paystack', gateway_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_payments_order ON shop_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_shop_payments_ref ON shop_payments(payment_reference);

CREATE OR REPLACE FUNCTION public.generate_shop_order_ref() RETURNS text LANGUAGE plpgsql AS $$ declare v_seq int; v_ref text; begin SELECT count(*)::int + 1 INTO v_seq FROM shop_orders; v_ref := 'CF-' || lpad(v_seq::text, 6, '0'); RETURN v_ref; end; $$;
CREATE OR REPLACE FUNCTION public.update_shop_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_shop_orders_updated_at ON shop_orders; CREATE TRIGGER trg_shop_orders_updated_at BEFORE UPDATE ON shop_orders FOR EACH ROW EXECUTE FUNCTION public.update_shop_updated_at();
DROP TRIGGER IF EXISTS trg_shop_payments_updated_at ON shop_payments; CREATE TRIGGER trg_shop_payments_updated_at BEFORE UPDATE ON shop_payments FOR EACH ROW EXECUTE FUNCTION public.update_shop_updated_at();

-- RLS (see detailed policies in migration history: shop_conformance_v2)
ALTER TABLE shop_pickup_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_order_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_payments ENABLE ROW LEVEL SECURITY;
-- (Policies created idempotently in migration; omitted here for brevity — see shop_conformance_v2 applied)

-- RPCs: create_shop_order (row-locked, price-validated, idempotent), update_shop_order_status, shop_restore_inventory_on_cancel, shop_add_message
-- Full definitions applied in shop_conformance_rpcs / shop_message_rpc / shop_update_status_fix — see those migrations for complete bodies.
