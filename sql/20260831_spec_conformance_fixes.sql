-- ============================================================================
-- Appointment Booking Spec Conformance Fixes
-- Date: 2026-08-31
-- Fixes:
--   1. book_appointment_slot: STABLE → VOLATILE (data-modifying function)
--   2. complete_appointment_and_release: new RPC for confirmed→completed
--   3. service_availability: ensure end_time column exists
--   4. appointments: ensure timeslot_id column exists
-- ============================================================================

-- 1. Fix book_appointment_slot volatility
--    Function performs INSERT + UPDATE → must be VOLATILE, not STABLE
DROP FUNCTION IF EXISTS public.book_appointment_slot(uuid, uuid, date, time, text, text, integer, text, text, text);
CREATE OR REPLACE FUNCTION public.book_appointment_slot(
  p_business_id uuid,
  p_service_id uuid,
  p_date date,
  p_time time,
  p_client_name text,
  p_phone text,
  p_fee_amount integer,
  p_payment_reference text,
  p_booking_type text,
  p_concern text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_service business_services%ROWTYPE;
  v_slot service_availability%ROWTYPE;
  v_appointment_id uuid;
BEGIN
  -- ---- 1. Validate business ----
  IF NOT EXISTS (SELECT 1 FROM businesses WHERE id = p_business_id AND status = 'active') THEN
    RAISE EXCEPTION 'Business not found or inactive';
  END IF;

  -- ---- 2. Validate service ----
  SELECT * INTO v_service FROM business_services
  WHERE id = p_service_id AND business_id = p_business_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found or inactive';
  END IF;

  -- ---- 3. Find an available slot for this service/date -----
  SELECT * INTO v_slot FROM service_availability
  WHERE business_id = p_business_id
    AND service_id = p_service_id
    AND date = p_date
    AND time = p_time
    AND status = 'available'
    AND is_booked = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slot not available for this service on this date/time';
  END IF;

  -- ---- 4. Mark the slot as booked ----
  UPDATE service_availability
  SET status = 'booked',
      is_booked = true
  WHERE id = v_slot.id;

  -- ---- 5. Insert the appointment ----
  INSERT INTO appointments (
    business_id, client_name, client_id, service, service_id, timeslot_id,
    date, time, status, staff_name, notes,
    booking_type, phone, concern,
    payment_status, fee_amount, amount, payment_reference,
    consultation_medium, consultation_medium_link
  ) VALUES (
    p_business_id, p_client_name, NULL,
    v_service.name,
    p_service_id, v_slot.id,
    p_date, p_time, 'pending', '', 'Booked via CareFind',
    p_booking_type, p_phone, p_concern,
    CASE WHEN p_fee_amount IS NOT NULL AND p_fee_amount > 0 THEN 'unpaid' ELSE NULL END,
    p_fee_amount, p_fee_amount,
    p_payment_reference,
    (SELECT consultation_medium FROM businesses WHERE id = p_business_id),
    (SELECT consultation_medium_link FROM businesses WHERE id = p_business_id)
  )
  RETURNING id INTO v_appointment_id;

  -- ---- 6. Link the appointment to the booked slot ----
  UPDATE service_availability
  SET appointment_id = v_appointment_id
  WHERE id = v_slot.id;

  RETURN v_appointment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.book_appointment_slot(uuid, uuid, date, time, text, text, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_appointment_slot(uuid, uuid, date, time, text, text, integer, text, text, text) TO authenticated, service_role;

-- 2. Create complete_appointment_and_release RPC
--    Moves appointment confirmed→completed and releases held→available balance
CREATE OR REPLACE FUNCTION public.complete_appointment_and_release(p_appointment_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_business_id uuid;
  v_status text;
  v_fee integer;
  v_payment_status text;
  v_timeslot_id uuid;
BEGIN
  SELECT business_id, status, COALESCE(amount, fee_amount), payment_status, timeslot_id
  INTO v_business_id, v_status, v_fee, v_payment_status, v_timeslot_id
  FROM appointments WHERE id = p_appointment_id FOR UPDATE;

  IF v_business_id IS NULL THEN RETURN 'not_found'; END IF;
  IF NOT EXISTS (SELECT 1 WHERE v_business_id = ANY (SELECT current_business_ids())) AND NOT is_platform_admin() THEN
    RETURN 'forbidden';
  END IF;
  IF v_status NOT IN ('confirmed') THEN RETURN 'not_confirmed'; END IF;
  IF v_fee IS NULL OR v_fee <= 0 THEN RETURN 'no_fee'; END IF;

  -- Mark appointment as completed
  UPDATE appointments SET status = 'completed', completed_at = now() WHERE id = p_appointment_id;

  -- Release held balance to available
  INSERT INTO business_wallets (business_id, held_balance, available_balance)
  VALUES (v_business_id, 0, 0) ON CONFLICT (business_id) DO NOTHING;

  PERFORM 1 FROM business_wallets WHERE business_id = v_business_id AND held_balance >= v_fee FOR UPDATE;
  IF FOUND THEN
    UPDATE business_wallets
    SET held_balance = held_balance - v_fee,
        available_balance = available_balance + v_fee,
        updated_at = now()
    WHERE business_id = v_business_id;

    -- Record the release in the ledger
    INSERT INTO business_wallet_transactions (business_id, appointment_id, type, amount, reference, status)
    VALUES (v_business_id, p_appointment_id, 'release', v_fee, NULL, 'confirmed');
  ELSE
    RAISE WARNING 'complete_appointment_and_release: held_balance insufficient for %', p_appointment_id;
  END IF;

  -- Free the timeslot if linked
  IF v_timeslot_id IS NOT NULL THEN
    UPDATE service_availability
    SET is_booked = false, status = 'available', appointment_id = NULL
    WHERE id = v_timeslot_id;
  END IF;

  RETURN 'ok';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_appointment_and_release(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_appointment_and_release(uuid) TO authenticated, service_role;

-- 3. Ensure service_availability has end_time column (may already exist)
DO $$ BEGIN
  ALTER TABLE service_availability ADD COLUMN IF NOT EXISTS end_time text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 4. Ensure appointments has timeslot_id column (may already exist)
DO $$ BEGIN
  ALTER TABLE appointments ADD COLUMN IF NOT EXISTS timeslot_id uuid REFERENCES service_availability(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 5. Ensure business_wallet_transactions has status column (may already exist)
DO $$ BEGIN
  ALTER TABLE business_wallet_transactions ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending' CHECK (status IN ('pending','confirmed','refunded','disputed'));
  ALTER TABLE business_wallet_transactions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
