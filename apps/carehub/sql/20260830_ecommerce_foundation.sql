-- ============================================================================
-- Shop Foundation — Vendor onboarding and product activation
--
-- Status: APPLIED — 2026-08-30
--
-- Part of Combined Ecommerce Spec A2-A4, A19: onboarding application,
-- inventory-linked ecommerce_products, ordered multi-image set.
-- ============================================================================

-- 1. Applications
CREATE TABLE IF NOT EXISTS ecommerce_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'Not Applied' CHECK (status IN ('Not Applied','Draft','Submitted','Under Review','Approved','Rejected','Suspended')),
  terms_accepted boolean NOT NULL DEFAULT false,
  seller_info jsonb,
  rejection_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id)
);

CREATE INDEX IF NOT EXISTS idx_ecommerce_applications_business ON ecommerce_applications(business_id);
CREATE INDEX IF NOT EXISTS idx_ecommerce_applications_status ON ecommerce_applications(status);

-- 2. E-commerce products (link to inventory products)
CREATE TABLE IF NOT EXISTS ecommerce_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'Not Activated' CHECK (status IN ('Not Activated','Incomplete','Active','Paused','Out of Stock','Restricted')),
  description text,
  category text,
  ecommerce_price_kobo integer CHECK (ecommerce_price_kobo IS NULL OR ecommerce_price_kobo >= 0),
  attributes jsonb,
  active_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_ecommerce_products_business ON ecommerce_products(business_id);
CREATE INDEX IF NOT EXISTS idx_ecommerce_products_product ON ecommerce_products(product_id);
CREATE INDEX IF NOT EXISTS idx_ecommerce_products_status ON ecommerce_products(status);
CREATE INDEX IF NOT EXISTS idx_ecommerce_products_active ON ecommerce_products(business_id) WHERE status = 'Active';

-- 3. Ordered multi-image set per ecommerce product
CREATE TABLE IF NOT EXISTS ecommerce_product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecommerce_product_id uuid NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
  url text NOT NULL CHECK (char_length(trim(url)) > 0),
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ecommerce_product_id, position)
);

CREATE INDEX IF NOT EXISTS idx_ecommerce_product_images_product ON ecommerce_product_images(ecommerce_product_id);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.update_ecommerce_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_ecommerce_applications_updated_at ON ecommerce_applications;
CREATE TRIGGER trg_ecommerce_applications_updated_at
  BEFORE UPDATE ON ecommerce_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_ecommerce_updated_at();

DROP TRIGGER IF EXISTS trg_ecommerce_products_updated_at ON ecommerce_products;
CREATE TRIGGER trg_ecommerce_products_updated_at
  BEFORE UPDATE ON ecommerce_products
  FOR EACH ROW EXECUTE FUNCTION public.update_ecommerce_updated_at();

-- Helper: is product complete? used by activate gate (image count + required fields)
CREATE OR REPLACE FUNCTION public.is_ecommerce_product_complete(p_ecommerce_product_id uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
declare
  v_row RECORD;
  v_image_count int;
begin
  SELECT description, category INTO v_row FROM ecommerce_products WHERE id = p_ecommerce_product_id;
  IF v_row.description IS NULL OR char_length(trim(v_row.description)) < 10 THEN RETURN false; END IF;
  IF v_row.category IS NULL OR char_length(trim(v_row.category)) = 0 THEN RETURN false; END IF;
  SELECT count(*) INTO v_image_count FROM ecommerce_product_images WHERE ecommerce_product_id = p_ecommerce_product_id;
  IF v_image_count = 0 THEN RETURN false; END IF;
  RETURN true;
end;
$$;

-- RLS
ALTER TABLE ecommerce_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_product_images ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ecommerce_applications' AND policyname = 'ecommerce_applications tenant visibility') THEN
    CREATE POLICY "ecommerce_applications tenant visibility" ON ecommerce_applications
      USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ecommerce_applications' AND policyname = 'ecommerce_applications tenant write') THEN
    CREATE POLICY "ecommerce_applications tenant write" ON ecommerce_applications
      FOR ALL USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
      WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ecommerce_products' AND policyname = 'ecommerce_products tenant visibility') THEN
    CREATE POLICY "ecommerce_products tenant visibility" ON ecommerce_products
      USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ecommerce_products' AND policyname = 'ecommerce_products tenant write') THEN
    CREATE POLICY "ecommerce_products tenant write" ON ecommerce_products
      FOR ALL USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
      WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ecommerce_product_images' AND policyname = 'ecommerce_product_images tenant visibility') THEN
    CREATE POLICY "ecommerce_product_images tenant visibility" ON ecommerce_product_images
      USING (ecommerce_product_id IN (SELECT id FROM ecommerce_products WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ecommerce_product_images' AND policyname = 'ecommerce_product_images tenant write') THEN
    CREATE POLICY "ecommerce_product_images tenant write" ON ecommerce_product_images
      FOR ALL USING (ecommerce_product_id IN (SELECT id FROM ecommerce_products WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin()))
      WITH CHECK (ecommerce_product_id IN (SELECT id FROM ecommerce_products WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin()));
  END IF;
END $$;

-- Storage bucket for ecommerce images (public read after activation, tenant-scoped write)
-- Note: create via Supabase Storage API if not exists; policy below is example for storage.objects
-- Bucket: ecommerce-images, public true, file_size_limit 5MB, allowed_mime image/*
-- Policy: (storage.foldername(name))[1] = business_id::text for write, public read for select

-- Verify after applying:
-- select count(*) from ecommerce_applications; -- 0
-- select count(*) from ecommerce_products; -- 0
-- select public.is_ecommerce_product_complete('00000000-0000-0000-0000-000000000000'); -- false
