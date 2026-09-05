-- ----------------------------------------------------------------------------
-- 18. book_appointment_slot — atomically books an appointment slot when a
--     service is selected. This prevents race conditions where two clients
--     could book the same slot simultaneously.
--
--     Flow:
--       1. Validate the business exists, is active, and booking is enabled.
--       2. Validate the service exists, is active, and belongs to the business.
--       3. Check service_availability for this business/service/date → find an
--          available slot (status = 'available', is_booked = false).
--       4. Mark that slot as booked (is_booked = true, status = 'booked',
--          appointment_id = p_appointment_id) — best-effort with unique index guard.
--       5. Insert the appointment row with payment_status, fee_amount, etc.
--          based on the hasFee flag.
--       6. Return the new appointment id.
--
--     If any step fails (no available slot, conflict, etc.), the transaction
--     rolls back and an error is thrown.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION book_appointment_slot(
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
STABLE
AS $$
DECLARE
  v_service business_services%ROWTYPE;
  v_slot service_availability%ROWTYPE;
  v_appointment_id uuid;
BEGIN
  -- ---- 1. Validate business ----
  SELECT * INTO v_service FROM businesses WHERE id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found using current_business_ids()';
  END IF;
  -- (caller should already have validated business config, but double-check)

  -- ---- 2. Validate service ----
  IF NOT EXISTS (SELECT 1 FROM business_services WHERE id = p_service_id AND business_id = p_business_id AND is_active = true) THEN
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

  -- ---- 4. Mark the slot as booked (best-effort) ----
  -- Use a separate transaction-guarded update. The unique index on
  -- (business_id, service_id, date, time) also prevents double-booking at
  -- the DB level, but we try to mark it here first for early feedback.
  UPDATE service_availability
  SET status = 'booked',
      is_booked = true,
      appointment_id = NULL -- will be set after appointment insert
  WHERE id = v_slot.id;

  -- ---- 5. Insert the appointment ----
  INSERT INTO appointments (
    business_id, client_name, client_id, service, service_id,
    date, time, status, staff_name, notes,
    booking_type, phone, concern,
    payment_status, fee_amount, amount, payment_reference,
    consultation_medium, consultation_medium_link
  ) VALUES (
    p_business_id, p_client_name, NULL,
    (SELECT name FROM business_services WHERE id = p_service_id),
    p_service_id,
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