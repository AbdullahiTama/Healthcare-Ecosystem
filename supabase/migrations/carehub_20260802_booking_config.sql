-- ============================================================================
-- Configurable online/physical appointment booking
--
-- Status: NOT YET APPLIED — run via Supabase SQL editor / psql.
--
-- Adds booking configuration to the `businesses` row (publicly readable, so
-- CareFind's public business profile can show the booking widget) and
-- booking-source columns to `appointments` (so CareHub staff can see which
-- bookings came from the public web and whether they are online/physical).
--
-- CareFind consumers never write `appointments` directly: the public booking
-- request goes to api/booking.js (Vercel function, service-role), which
-- validates business/slot availability before inserting — RLS stays exactly
-- as phase2_rls_pilot.sql defined it.
-- ============================================================================

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_enabled boolean DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_type text DEFAULT 'physical'; -- 'physical' | 'online' | 'both'
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS booking_slots jsonb DEFAULT '["09:00","10:00","11:00","12:00","14:00","15:00","16:00"]'::jsonb;

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_type text DEFAULT 'physical'; -- 'physical' | 'online'
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source text DEFAULT 'carehub';        -- 'carehub' | 'carefind'
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS phone text;
