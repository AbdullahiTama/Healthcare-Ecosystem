-- ============================================================================
-- Payments — Appointments (CareHub) + E-commerce Shop strict Paystack
-- Spec: _bmad-output/specs/spec-payments-appointments-ecommerce
--
-- Story 1: DB columns + guard + manual confirm RPCs + vendor COD flag
-- Status: NOT YET APPLIED — run via Supabase SQL editor / psql
--
-- Implements CAP-1..CAP-4 (appointment channels) + CAP-6 (vendor toggle)
-- foundation for CAP-5/7/8. Preserves 20260811_business_wallets_and_booking_payments.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Appointments — verification audit columns
-- ----------------------------------------------------------------------------

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_channel text
  CHECK (payment_channel IN ('cash','pos','transfer','paystack','carecoins','card'));
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS paystack_reference text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS pos_reference text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS transfer_proof_url text;

-- Ensure payment_status covers new manual states; existing check is app-level,
-- but add explicit check if not exists (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_payment_status_check'
  ) THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_payment_status_check
      CHECK (payment_status IS NULL OR payment_status IN ('unpaid','paid','refunded','pending'));
  END IF;
END $$;

-- Idempotency indexes (partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS appointments_payment_reference_uidx
  ON appointments(payment_reference) WHERE payment_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS appointments_paystack_reference_uidx
  ON appointments(paystack_reference) WHERE paystack_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_verified_by ON appointments(verified_by);
CREATE INDEX IF NOT EXISTS idx_appointments_payment_channel ON appointments(payment_channel);

-- ----------------------------------------------------------------------------
-- 2. Businesses — vendor pay-on-delivery toggle (CAP-6)
-- ----------------------------------------------------------------------------

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS shop_allow_pay_on_delivery boolean NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- 3. Guard: payment_status/payment_channel only via RPC / service-role
--    Mirrors guard_business_privileged_columns pattern (20260805_guard...)
--    Normal staff updates to these columns are rejected; service_role + platform
--    admin pass through. This prevents direct PATCH to 'paid'.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_appointment_payment_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Allow service_role and platform_admin to bypass
  IF coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  -- For non-privileged callers, forbid flipping payment_status to paid or
  -- changing verification columns via direct UPDATE. RPCs run as SECURITY DEFINER
  -- with service_role, so they bypass this.
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.payment_status IS DISTINCT FROM NEW.payment_status
        AND NEW.payment_status = 'paid'
        AND coalesce(OLD.payment_status, '') <> 'paid') THEN
      RAISE EXCEPTION 'payment_status to paid must go through confirm RPC or Paystack verify';
    END IF;
    IF (OLD.payment_channel IS DISTINCT FROM NEW.payment_channel
        OR OLD.verified_by IS DISTINCT FROM NEW.verified_by
        OR OLD.verified_at IS DISTINCT FROM NEW.verified_at
        OR OLD.paystack_reference IS DISTINCT FROM NEW.paystack_reference) THEN
      -- Allow the initial INSERT to set channel/status (carehub cash flow creates paid)
      -- but on UPDATE only RPC should touch these. We allow channel change only if
      -- status is still unpaid and actor owns the business — handled by RLS + RPC;
      -- here we block generic UPDATEs that try to set verified_* or flip channel after paid.
      IF OLD.payment_status = 'paid' THEN
        RAISE EXCEPTION 'paid appointment payment fields are immutable';
      END IF;
      -- For pos/transfer pending, direct UPDATE to paid is already blocked above;
      -- setting verified_* directly is also blocked.
      IF NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
        RAISE EXCEPTION 'verification fields must be set via confirm RPC';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_appointment_payment ON appointments;
CREATE TRIGGER trg_guard_appointment_payment
  BEFORE UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_appointment_payment_columns();

REVOKE EXECUTE ON FUNCTION public.guard_appointment_payment_columns() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Helpers to resolve caller's staff id
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_staff_id_for_business(p_business_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id FROM staff
  WHERE business_id = p_business_id
    AND auth_user_id = auth.uid()
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_staff_id_for_business(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_staff_id_for_business(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Manual confirm RPCs — POS / Transfer (CAP-2)
--    SECURITY DEFINER so they can bypass the guard; ownership enforced inside.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_pos_payment(
  p_appointment_id uuid,
  p_pos_reference text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_business_id uuid;
  v_fee integer;
  v_channel text;
  v_status text;
  v_staff_id uuid;
BEGIN
  SELECT business_id, fee_amount, payment_channel, payment_status
    INTO v_business_id, v_fee, v_channel, v_status
    FROM appointments WHERE id = p_appointment_id
    FOR UPDATE;
  IF v_business_id IS NULL THEN RETURN 'not_found'; END IF;

  -- Ownership: caller must belong to the appointment's business or be platform admin
  IF NOT (v_business_id IN (SELECT public.current_business_ids()) OR public.is_platform_admin()) THEN
    RETURN 'forbidden';
  END IF;

  IF v_status = 'paid' THEN RETURN 'already_paid'; END IF;
  IF coalesce(v_channel, '') <> 'pos' THEN RETURN 'wrong_channel'; END IF;
  IF v_status IS DISTINCT FROM 'unpaid' THEN RETURN 'not_pending'; END IF;

  -- Resolve staff id (may be null for owner via businesses.email; allow null)
  v_staff_id := public.current_staff_id_for_business(v_business_id);

  UPDATE appointments
     SET payment_status = 'paid',
         verified_by = v_staff_id,
         verified_at = now(),
         pos_reference = coalesce(nullif(trim(p_pos_reference), ''), pos_reference),
         paystack_reference = coalesce(paystack_reference, payment_reference)
   WHERE id = p_appointment_id;

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_transfer_payment(
  p_appointment_id uuid,
  p_proof_url text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_business_id uuid;
  v_channel text;
  v_status text;
  v_staff_id uuid;
BEGIN
  SELECT business_id, payment_channel, payment_status
    INTO v_business_id, v_channel, v_status
    FROM appointments WHERE id = p_appointment_id
    FOR UPDATE;
  IF v_business_id IS NULL THEN RETURN 'not_found'; END IF;
  IF NOT (v_business_id IN (SELECT public.current_business_ids()) OR public.is_platform_admin()) THEN
    RETURN 'forbidden';
  END IF;
  IF v_status = 'paid' THEN RETURN 'already_paid'; END IF;
  IF coalesce(v_channel, '') <> 'transfer' THEN RETURN 'wrong_channel'; END IF;
  IF v_status IS DISTINCT FROM 'unpaid' THEN RETURN 'not_pending'; END IF;

  v_staff_id := public.current_staff_id_for_business(v_business_id);

  UPDATE appointments
     SET payment_status = 'paid',
         verified_by = v_staff_id,
         verified_at = now(),
         transfer_proof_url = coalesce(nullif(trim(p_proof_url), ''), transfer_proof_url),
         paystack_reference = coalesce(paystack_reference, payment_reference)
   WHERE id = p_appointment_id;

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_pos_payment(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_transfer_payment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_pos_payment(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_transfer_payment(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Shop — add shop_allow_pay_on_delivery handling for RPCs (minimal)
--    create_shop_order already exists (shop_conformance_v2); no change needed
--    to accept pay-on-delivery — the API layer will skip Paystack when flag true.
--    We only ensure the business flag is readable via RLS.
-- ----------------------------------------------------------------------------

-- No extra RLS needed — businesses is already tenant-scoped; flag inherits it.

-- ----------------------------------------------------------------------------
-- 7. Verification queries (run after apply — each must return expected)
-- ----------------------------------------------------------------------------
-- SELECT column_name FROM information_schema.columns WHERE table_name='appointments' AND column_name IN ('payment_channel','paystack_reference','verified_by','verified_at','pos_reference','transfer_proof_url');
-- --> 6 rows
-- SELECT column_name FROM information_schema.columns WHERE table_name='businesses' AND column_name='shop_allow_pay_on_delivery';
-- --> 1 row, default false
-- SELECT proname FROM pg_proc WHERE proname IN ('confirm_pos_payment','confirm_transfer_payment');
-- --> 2 rows
-- SELECT has_function_privilege('anon', 'public.confirm_pos_payment(uuid,text)', 'execute'); --> false
-- SELECT has_function_privilege('authenticated', 'public.confirm_pos_payment(uuid,text)', 'execute'); --> true
