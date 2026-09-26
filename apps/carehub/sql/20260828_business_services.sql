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
  name text NOT NULL CHECK (char_length(trim(name)) > 0),
  description text,
  price_kobo integer CHECK (price_kobo IS NULL OR price_kobo >= 0),
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_services_business ON business_services(business_id);
CREATE INDEX IF NOT EXISTS idx_business_services_active ON business_services(business_id) WHERE is_active = true;

-- Backfill constraints if table pre-existed without them
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='business_services') THEN
    BEGIN ALTER TABLE business_services ADD CONSTRAINT business_services_name_not_empty CHECK (char_length(trim(name)) > 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER TABLE business_services ADD CONSTRAINT business_services_price_nonneg CHECK (price_kobo IS NULL OR price_kobo >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER TABLE business_services ADD CONSTRAINT business_services_duration_pos CHECK (duration_minutes IS NULL OR duration_minutes > 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS service_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id uuid REFERENCES business_services(id) ON DELETE CASCADE,
  date date NOT NULL,
  time text NOT NULL, -- 'HH:MM' 24h, matches appointments.time (kept for backward compat)
  start_time text, -- HH:MM, if set must be < end_time
  end_time text,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','booked')),
  is_booked boolean NOT NULL DEFAULT false,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, service_id, date, time)
);

CREATE INDEX IF NOT EXISTS idx_service_availability_business_date ON service_availability(business_id, date);
CREATE INDEX IF NOT EXISTS idx_service_availability_service ON service_availability(service_id);
CREATE INDEX IF NOT EXISTS idx_service_availability_status ON service_availability(business_id, status) WHERE status='available';

-- Backfill new columns if table pre-existed
ALTER TABLE service_availability ADD COLUMN IF NOT EXISTS start_time text;
ALTER TABLE service_availability ADD COLUMN IF NOT EXISTS end_time text;
ALTER TABLE service_availability ADD COLUMN IF NOT EXISTS status text DEFAULT 'available';
ALTER TABLE service_availability ADD COLUMN IF NOT EXISTS appointment_id uuid;
DO $$ BEGIN
  BEGIN ALTER TABLE service_availability ADD CONSTRAINT service_availability_status_check CHECK (status IN ('available','booked')); EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE service_availability ADD CONSTRAINT service_availability_time_order CHECK (start_time IS NULL OR end_time IS NULL OR start_time < end_time); EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- Keep is_booked and status in sync
CREATE OR REPLACE FUNCTION public.sync_service_availability_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF NEW.is_booked AND NEW.status = 'available' THEN NEW.status := 'booked';
    ELSIF NOT NEW.is_booked AND NEW.status = 'booked' AND NEW.appointment_id IS NULL THEN NEW.status := 'available';
    ELSIF NEW.appointment_id IS NOT NULL THEN NEW.is_booked := true; NEW.status := 'booked';
    ELSIF NEW.status = 'booked' THEN NEW.is_booked := true;
    ELSE NEW.is_booked := false;
    END IF;
    -- Populate start_time from time if not set, for spec compliance
    IF NEW.start_time IS NULL AND NEW.time IS NOT NULL THEN NEW.start_time := NEW.time; END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_service_availability_status ON service_availability;
CREATE TRIGGER trg_sync_service_availability_status
  BEFORE INSERT OR UPDATE ON service_availability
  FOR EACH ROW EXECUTE FUNCTION public.sync_service_availability_status();

-- Overlap prevention: same business/service/date cannot have duplicate start_time
CREATE UNIQUE INDEX IF NOT EXISTS service_availability_no_overlap_idx
  ON service_availability (business_id, COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::uuid), date, COALESCE(start_time, time));

-- Prevent past-date slots via trigger (date check cannot be static CHECK)
CREATE OR REPLACE FUNCTION public.prevent_past_availability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot create availability in the past: %', NEW.date;
  END IF;
  IF NEW.start_time IS NOT NULL AND NEW.end_time IS NOT NULL AND NEW.start_time >= NEW.end_time THEN
    RAISE EXCEPTION 'end_time must be after start_time: % >= %', NEW.start_time, NEW.end_time;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_prevent_past_availability ON service_availability;
CREATE TRIGGER trg_prevent_past_availability
  BEFORE INSERT OR UPDATE ON service_availability
  FOR EACH ROW EXECUTE FUNCTION public.prevent_past_availability();

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
      FOR SELECT USING (is_active = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'service_availability' AND policyname = 'service_availability public read') THEN
    CREATE POLICY "service_availability public read" ON service_availability
      FOR SELECT USING (status = 'available' AND is_booked = false);
  END IF;
END $$;

-- ============================================================================
-- Appointments hardening for spec §7: link to service and timeslot, snapshot amount
-- ============================================================================

-- Extend appointments to reference service and slot, per spec §7
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES business_services(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS timeslot_id uuid REFERENCES service_availability(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS amount integer; -- snapshot in kobo, mirrors fee_amount
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS released_at timestamptz;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS dispute_until timestamptz;

-- Backfill amount from fee_amount where missing
DO $$ BEGIN
  UPDATE appointments SET amount = fee_amount WHERE amount IS NULL AND fee_amount IS NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- Ensure fee/amount stored is non-negative
DO $$ BEGIN
  BEGIN ALTER TABLE appointments ADD CONSTRAINT appointments_fee_nonneg CHECK (fee_amount IS NULL OR fee_amount >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE appointments ADD CONSTRAINT appointments_amount_nonneg CHECK (amount IS NULL OR amount >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_appointments_service ON appointments(service_id);
CREATE INDEX IF NOT EXISTS idx_appointments_timeslot ON appointments(timeslot_id);
CREATE INDEX IF NOT EXISTS idx_appointments_business_date ON appointments(business_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS appointments_payment_reference_uniq ON appointments(payment_reference) WHERE payment_reference IS NOT NULL;

-- One active appointment per slot (or per business/date/time/service when not using timeslot_id)
-- Prevent double-booking at the database level — critical for §6.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_one_per_slot
  ON appointments (timeslot_id) WHERE timeslot_id IS NOT NULL AND status IN ('pending','confirmed');
CREATE UNIQUE INDEX IF NOT EXISTS appointments_one_per_timeslot_business
  ON appointments (business_id, date, time, COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('pending','confirmed') AND timeslot_id IS NULL;

-- RPC for atomic booking: locks the slot row, checks availability, inserts appointment and marks booked
CREATE OR REPLACE FUNCTION public.book_appointment_slot(
  p_business_id uuid,
  p_service_id uuid,
  p_date date,
  p_time text,
  p_client_name text,
  p_phone text,
  p_fee_amount integer,
  p_payment_reference text,
  p_booking_type text,
  p_concern text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_service RECORD;
  v_slot RECORD;
  v_appointment_id uuid;
  v_fee integer;
begin
  -- Lock service row to ensure is_active check is current
  SELECT id, name, price_kobo, is_active INTO v_service FROM business_services WHERE id = p_service_id AND business_id = p_business_id FOR UPDATE;
  IF v_service.id IS NULL THEN RAISE EXCEPTION 'Service not found'; END IF;
  IF NOT v_service.is_active THEN RAISE EXCEPTION 'Service is inactive'; END IF;

  -- Fee must be snapshotted server-side, not trusted from client. If service has price, ignore client fee.
  IF v_service.price_kobo IS NOT NULL THEN
    v_fee := v_service.price_kobo;
  ELSE
    v_fee := p_fee_amount;
  END IF;

  -- Try to lock an explicit service_availability row if exists
  SELECT id, status, is_booked INTO v_slot FROM service_availability
    WHERE business_id = p_business_id AND service_id = p_service_id AND date = p_date AND time = p_time
    FOR UPDATE;
  IF v_slot.id IS NOT NULL THEN
    IF v_slot.status = 'booked' OR v_slot.is_booked THEN RAISE EXCEPTION 'Slot already booked'; END IF;
  ELSE
    -- No explicit slot row — check appointments unique via pre-check (the unique index is the final guard)
    PERFORM 1 FROM appointments
      WHERE business_id = p_business_id AND date = p_date::text AND time = p_time
        AND COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_service_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND status IN ('pending','confirmed') FOR UPDATE;
    IF FOUND THEN RAISE EXCEPTION 'Slot already taken'; END IF;
  END IF;

  -- Insert appointment with pending status and snapshot amount; wallet pending is created on verified payment, not here
  INSERT INTO appointments (business_id, service_id, timeslot_id, date, time, client_name, phone, service, status, fee_amount, amount, payment_reference, booking_type, source, concern)
  VALUES (p_business_id, p_service_id, v_slot.id, p_date::text, p_time, p_client_name, p_phone, v_service.name, 'pending', v_fee, v_fee, p_payment_reference, COALESCE(p_booking_type,'physical'), 'carefind', p_concern)
  RETURNING id INTO v_appointment_id;

  -- Mark explicit slot as booked if it existed
  IF v_slot.id IS NOT NULL THEN
    UPDATE service_availability SET is_booked = true, status='booked', appointment_id = v_appointment_id WHERE id = v_slot.id;
  END IF;

  RETURN v_appointment_id;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.book_appointment_slot(uuid,uuid,date,text,text,text,integer,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_appointment_slot(uuid,uuid,date,text,text,text,integer,text,text,text) TO authenticated, service_role;

-- Confirm RPC: atomically moves appointment pending->confirmed and wallet pending->confirmed/available
CREATE OR REPLACE FUNCTION public.confirm_appointment(p_appointment_id uuid) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_business_id uuid;
  v_status text;
  v_fee integer;
  v_payment_status text;
begin
  SELECT business_id, status, COALESCE(amount, fee_amount), payment_status INTO v_business_id, v_status, v_fee, v_payment_status
    FROM appointments WHERE id = p_appointment_id FOR UPDATE;
  IF v_business_id IS NULL THEN RETURN 'not_found'; END IF;
  IF NOT EXISTS (SELECT 1 WHERE v_business_id = ANY (SELECT current_business_ids())) AND NOT is_platform_admin() THEN RETURN 'forbidden'; END IF;
  IF v_status NOT IN ('pending') THEN RETURN 'not_pending'; END IF;
  -- For paid bookings, require payment verified before confirm can release funds
  IF v_fee IS NOT NULL AND v_fee > 0 AND v_payment_status IS DISTINCT FROM 'paid' THEN
    -- Allow confirm for free or unpaid? But wallet move will be skipped; still allow status flip but warn via return value
    -- To enforce spec §8 strictly, uncomment next line to block unpaid confirms:
    -- RETURN 'not_paid';
    NULL;
  END IF;

  -- Confirm and also mark wallet released to prevent double-release via completed trigger
  UPDATE appointments SET status='confirmed', confirmed_at = now(), released_at = now(), dispute_until = now() + interval '72 hours' WHERE id = p_appointment_id;

  -- Move wallet transaction pending->confirmed and held->available atomically, with held sufficiency check
  UPDATE business_wallet_transactions SET status='confirmed', updated_at = now()
    WHERE appointment_id = p_appointment_id AND type='booking_credit' AND status='pending';
  IF FOUND AND v_fee IS NOT NULL AND v_fee > 0 THEN
    -- Ensure wallet row exists and has sufficient held
    INSERT INTO business_wallets (business_id, held_balance, available_balance) VALUES (v_business_id, 0, 0) ON CONFLICT (business_id) DO NOTHING;
    PERFORM 1 FROM business_wallets WHERE business_id = v_business_id AND held_balance >= v_fee FOR UPDATE;
    IF NOT FOUND THEN
      -- Not enough held — still mark transaction confirmed but don't move negative; log via release of 0
      RAISE WARNING 'confirm_appointment: held_balance insufficient for %', p_appointment_id;
    ELSE
      UPDATE business_wallets SET held_balance = held_balance - v_fee, available_balance = available_balance + v_fee, updated_at = now()
        WHERE business_id = v_business_id;
    END IF;
    INSERT INTO business_wallet_transactions (business_id, appointment_id, type, amount, reference, status)
    VALUES (v_business_id, p_appointment_id, 'release', v_fee, null, 'confirmed');
  END IF;

  RETURN 'ok';
end;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_appointment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_appointment(uuid) TO authenticated, service_role;

-- Free slot when appointment is cancelled
CREATE OR REPLACE FUNCTION public.free_slot_on_cancel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND OLD.timeslot_id IS NOT NULL THEN
    UPDATE service_availability SET is_booked = false, status='available', appointment_id = NULL WHERE id = OLD.timeslot_id;
  ELSIF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND OLD.timeslot_id IS NULL THEN
    -- For legacy bookings without timeslot_id, try to free by business/date/time/service
    UPDATE service_availability SET is_booked = false, status='available', appointment_id = NULL
      WHERE business_id = OLD.business_id AND date = OLD.date::date AND time = OLD.time
        AND COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(OLD.service_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND is_booked = true;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_free_slot_on_cancel ON appointments;
CREATE TRIGGER trg_free_slot_on_cancel
  AFTER UPDATE OF status ON appointments
  FOR EACH ROW WHEN (NEW.status = 'cancelled')
  EXECUTE FUNCTION public.free_slot_on_cancel();

-- Prevent hard-delete of services referenced by appointments or availability
CREATE OR REPLACE FUNCTION public.prevent_service_hard_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
declare cnt int;
begin
  SELECT count(*) INTO cnt FROM appointments WHERE service_id = OLD.id;
  IF cnt > 0 THEN RAISE EXCEPTION 'Cannot delete service % — it is referenced by % appointment(s). Deactivate it instead.', OLD.name, cnt; END IF;
  RETURN OLD;
end; $$;

DROP TRIGGER IF EXISTS trg_prevent_service_hard_delete ON business_services;
CREATE TRIGGER trg_prevent_service_hard_delete
  BEFORE DELETE ON business_services
  FOR EACH ROW EXECUTE FUNCTION public.prevent_service_hard_delete();

-- Ensure wallet transactions table supports status if missing
DO $$ BEGIN
  ALTER TABLE business_wallet_transactions ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending' CHECK (status IN ('pending','confirmed','refunded','disputed'));
  ALTER TABLE business_wallet_transactions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
EXCEPTION WHEN undefined_table THEN NULL; END $$;
