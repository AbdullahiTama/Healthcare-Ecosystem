-- ----------------------------------------------------------------------------
-- 17. service_availability — each business defines available time slots per
--     service per date. A slot can be 'available', 'booked', or 'unavailable'.
--     When a booking is made via the book_appointment_slot RPC, the matching
--     slot is atomically marked as booked (best-effort race protection).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  date date NOT NULL,
  time time NOT NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'booked', 'unavailable')),
  is_booked boolean NOT NULL DEFAULT false,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id, service_id, date, time)
);

ALTER TABLE service_availability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON service_availability;
CREATE POLICY "service_availability of own business" ON service_availability
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());