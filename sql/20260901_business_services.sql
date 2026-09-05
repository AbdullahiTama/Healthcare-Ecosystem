-- ----------------------------------------------------------------------------
-- 16. business_services — businesses define their bookable services.
--    Each service has a name, description, price (in kobo), and availability state.
--    A business can have multiple services; each is scoped to that business.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price_kobo integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  duration_minutes integer NOT NULL DEFAULT 30,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE business_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON business_services;
CREATE POLICY "business_services of own business" ON business_services
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());

-- Also allow public read for services that are active (CareFind discovery)
CREATE POLICY "business_services public can view active" ON business_services
  FOR SELECT
  USING (is_active = true);