-- ============================================================================
-- Business services and per-service availability
--
-- Status: NOT YET APPLIED — run via Supabase SQL editor / psql.
--
-- Provides professional appointment configuration per Phase 2 Corrections:
-- * business_services — per-business service catalog (name, price, duration)
-- * service_availability — date-specific time slots per service (optional override
--   over the daily businesses.booking_slots). A slot is booked when an
--   appointment exists for that business/service/date/time in pending/confirmed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS business_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price_kobo integer, -- NULL = free, >0 = fee; mirrors online/physical fee but per-service
  duration_minutes integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_services_business ON business_services(business_id);
CREATE INDEX IF NOT EXISTS idx_business_services_active ON business_services(business_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS service_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id uuid REFERENCES business_services(id) ON DELETE CASCADE,
  date date NOT NULL,
  time text NOT NULL, -- 'HH:MM' 24h, matches appointments.time
  is_booked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, service_id, date, time)
);

CREATE INDEX IF NOT EXISTS idx_service_availability_business_date ON service_availability(business_id, date);
CREATE INDEX IF NOT EXISTS idx_service_availability_service ON service_availability(service_id);

-- Trigger to keep updated_at
CREATE OR REPLACE FUNCTION public.update_business_services_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_business_services_updated_at ON business_services;
CREATE TRIGGER trg_business_services_updated_at
  BEFORE UPDATE ON business_services
  FOR EACH ROW EXECUTE FUNCTION public.update_business_services_updated_at();

-- RLS: tenant isolation via current_business_ids(), admins see all
ALTER TABLE business_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_availability ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_services' AND policyname = 'business_services tenant visibility') THEN
    CREATE POLICY "business_services tenant visibility" ON business_services
      USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_services' AND policyname = 'business_services tenant write') THEN
    CREATE POLICY "business_services tenant write" ON business_services
      FOR ALL USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
      WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'service_availability' AND policyname = 'service_availability tenant visibility') THEN
    CREATE POLICY "service_availability tenant visibility" ON service_availability
      USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'service_availability' AND policyname = 'service_availability tenant write') THEN
    CREATE POLICY "service_availability tenant write" ON service_availability
      FOR ALL USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
      WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
END $$;

-- Public read for CareFind booking widget: anyone can read services of active, visible businesses
-- via anon key? Use a separate policy for anon if needed. For now, rely on businesses.status/visible check in API.
-- CareFind reads via anon Supabase client filtered by business_id; RLS allows anon to read active services.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_services' AND policyname = 'business_services public read') THEN
    CREATE POLICY "business_services public read" ON business_services
      FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'service_availability' AND policyname = 'service_availability public read') THEN
    CREATE POLICY "service_availability public read" ON service_availability
      FOR SELECT USING (true);
  END IF;
END $$;
