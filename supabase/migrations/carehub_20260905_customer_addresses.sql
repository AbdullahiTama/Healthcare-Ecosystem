-- Customer saved addresses — structured fields for delivery, backward-compatible with shop_orders.delivery_address
-- RLS: user-owned (same pattern as shop_wishlist)

CREATE TABLE IF NOT EXISTS customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Home',
  street text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  postal_code text,
  country text NOT NULL DEFAULT 'Nigeria',
  lat numeric(10, 7),
  lng numeric(10, 7),
  is_default boolean NOT NULL DEFAULT false,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_user ON customer_addresses(user_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_customer_addresses_user_default ON customer_addresses(user_id) WHERE is_default = true AND is_deleted = false;

ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='customer_addresses' AND policyname='customer_addresses user select') THEN
    CREATE POLICY "customer_addresses user select" ON customer_addresses FOR SELECT USING (user_id = auth.uid() OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='customer_addresses' AND policyname='customer_addresses user insert') THEN
    CREATE POLICY "customer_addresses user insert" ON customer_addresses FOR INSERT WITH CHECK (user_id = auth.uid() OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='customer_addresses' AND policyname='customer_addresses user update') THEN
    CREATE POLICY "customer_addresses user update" ON customer_addresses FOR UPDATE USING (user_id = auth.uid() OR is_platform_admin()) WITH CHECK (user_id = auth.uid() OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='customer_addresses' AND policyname='customer_addresses user delete') THEN
    CREATE POLICY "customer_addresses user delete" ON customer_addresses FOR DELETE USING (user_id = auth.uid() OR is_platform_admin());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.update_customer_addresses_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_customer_addresses_updated_at ON customer_addresses;
CREATE TRIGGER trg_customer_addresses_updated_at BEFORE UPDATE ON customer_addresses FOR EACH ROW EXECUTE FUNCTION public.update_customer_addresses_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_customer_addresses_max() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  addr_count int;
BEGIN
  SELECT count(*) INTO addr_count FROM customer_addresses WHERE user_id = NEW.user_id AND is_deleted = false;
  IF addr_count >= 10 THEN
    RAISE EXCEPTION 'Maximum 10 addresses reached. Delete one to add another.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_customer_addresses_max ON customer_addresses;
CREATE TRIGGER trg_customer_addresses_max BEFORE INSERT ON customer_addresses FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_addresses_max();

CREATE OR REPLACE FUNCTION public.set_default_address(p_address_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT user_id INTO v_user_id FROM customer_addresses WHERE id = p_address_id AND is_deleted = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Address not found or has been deleted';
  END IF;
  IF v_user_id != auth.uid() AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE customer_addresses SET is_default = false WHERE user_id = v_user_id AND is_deleted = false AND id != p_address_id;
  UPDATE customer_addresses SET is_default = true WHERE id = p_address_id;
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_one_default_address() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_deleted = true THEN
    RETURN NEW;
  END IF;
  IF NEW.is_default = true THEN
    UPDATE customer_addresses SET is_default = false WHERE user_id = NEW.user_id AND id != NEW.id AND is_default = true AND is_deleted = false;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.is_default = false THEN
    IF NOT EXISTS (SELECT 1 FROM customer_addresses WHERE user_id = NEW.user_id AND is_default = true AND is_deleted = false) THEN
      NEW.is_default := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_customer_addresses_ensure_default ON customer_addresses;
CREATE TRIGGER trg_customer_addresses_ensure_default BEFORE INSERT OR UPDATE ON customer_addresses FOR EACH ROW EXECUTE FUNCTION public.ensure_one_default_address();
