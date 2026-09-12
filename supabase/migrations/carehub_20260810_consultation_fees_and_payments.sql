-- ============================================================================
-- Consultation fees, concern field, and payment tracking
--
-- Status: NOT YET APPLIED — run via Supabase SQL editor / psql.
--
-- Adds per-appointment-type consultation fees to the `businesses` row (so
-- CareFind can show and charge the right fee at booking time), a free-text
-- "concern" field to `appointments` (the client's stated reason for booking),
-- and payment-tracking columns so the expert dashboard can show what has been
-- paid and what is still outstanding.
--
-- Fees are stored in kobo (₦1 = 100 kobo) as integers. NULL means "free".
-- A business that sets physical_consultation_fee = NULL is saying "physical
-- visits are free; only online is charged", and vice versa.
-- ============================================================================

-- Consultation fees on the business record (publicly readable — CareFind's
-- booking widget needs them to show the price before the client commits).
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS online_consultation_fee integer;  -- kobo, NULL = free
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS physical_consultation_fee integer; -- kobo, NULL = free

-- Client's stated reason for booking — a short free-text field the public
-- booking form fills in. Shown on the expert's appointment row.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS concern text;

-- Payment tracking. Every CareFind booking that carries a fee lands as
-- 'unpaid' and is flipped to 'paid' by the verify-payment endpoint once
-- Paystack confirms the transfer. CareHub-created appointments (source =
-- 'carehub') leave these NULL — payment is handled in person, not online.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid'; -- 'unpaid' | 'paid' | 'refunded'
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_reference text;                  -- Paystack reference
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS fee_amount integer;                      -- kobo actually charged
