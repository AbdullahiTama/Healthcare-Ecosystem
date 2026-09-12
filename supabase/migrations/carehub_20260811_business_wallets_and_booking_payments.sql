-- ============================================================================
-- Business wallets, booking payment settlement, 20% commission, and release
--
-- Status: NOT YET APPLIED — run via Supabase SQL editor / psql.
--
-- Implements ADR-005 (decisions/ADR/005-consultation-payment-and-release.md).
--
-- Model summary
-- ------------
-- * business_wallets — one naira ledger per business. Two balances: `held`
--   (paid but awaiting consultation completion) and `available` (withdrawable).
--   Balances are stored in KOBO (integer), matching appointments.fee_amount,
--   so the 80/20 split is always exact for CareCoin payments.
-- * business_wallet_transactions — immutable ledger per business.
-- * platform_transactions — the platform's 20% commission ledger.
-- * business_withdrawal_requests — mirrors CareFind's withdrawal_requests,
--   keyed by business instead of user.
-- * appointments gains payment_channel, consultation_medium(+link) snapshots,
--   patient_user_id (who paid with coins, so refunds can find them),
--   release_after, released_at, dispute_until, refunded_at.
-- * businesses gains a consultation_medium default + link (ADR-005 Q7).
--
-- Money moves ONLY through SECURITY DEFINER RPCs, service-role only — never
-- client-side, never via anon/authenticated. Same class as credit_wallet_topup.
--
-- NOTE: this migration does NOT retroactively settle bookings that were already
-- `paid` before it runs. Only bookings settled after apply flow into wallets.
-- ============================================================================

-- ============================================================================
-- 1. New columns
-- ============================================================================

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_channel text;          -- 'cash'|'transfer'|'pos'|'credit'|'card'|'carecoins'
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS consultation_medium text;      -- snapshot of businesses.consultation_medium
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS consultation_medium_link text; -- snapshot of businesses.consultation_medium_link
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_user_id uuid;          -- who paid with coins (refund routing)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS released_at timestamptz;       -- when held -> available happened
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS dispute_until timestamptz;     -- refund window after completion
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS consultation_medium text DEFAULT 'whatsapp'; -- 'whatsapp'|'zoom'|'google_meet'|'phone'|'other'
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS consultation_medium_link text;                -- link / dial-in identifier

-- ============================================================================
-- 2. Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS business_wallets (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  held_balance integer NOT NULL DEFAULT 0,     -- kobo, awaiting consultation completion
  available_balance integer NOT NULL DEFAULT 0, -- kobo, withdrawable
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  type text NOT NULL,            -- 'booking_credit' | 'release' | 'refund' | 'withdrawal'
  amount integer NOT NULL,       -- kobo; positive credit, negative debit
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_wallet_tx_business ON business_wallet_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_business_wallet_tx_appointment ON business_wallet_transactions(appointment_id);

-- Idempotency anchor: one booking_credit per payment_reference. A retried
-- settle call can never double-credit the wallet (mirrors credit_wallet_topup).
CREATE UNIQUE INDEX IF NOT EXISTS business_wallet_tx_credit_ref_uniq
  ON business_wallet_transactions (reference) WHERE type = 'booking_credit';

CREATE TABLE IF NOT EXISTS platform_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type text NOT NULL,            -- 'commission'
  amount integer NOT NULL,       -- kobo
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_tx_business ON platform_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_platform_tx_appointment ON platform_transactions(appointment_id);
CREATE UNIQUE INDEX IF NOT EXISTS platform_tx_commission_ref_uniq
  ON platform_transactions (reference) WHERE type = 'commission';

CREATE TABLE IF NOT EXISTS business_withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  amount integer NOT NULL,       -- kobo
  bank_name text,
  account_number text,
  account_name text,
  status text NOT NULL DEFAULT 'pending',  -- 'pending'|'processing'|'completed'|'failed'
  paystack_reference text,
  paystack_transfer_code text,
  paystack_recipient_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_withdrawal_business ON business_withdrawal_requests(business_id);

-- ============================================================================
-- 3. RLS
--    Tenants see their own wallet + transactions via current_business_ids();
--    platform admins see everything. Same scoping as every other tenant table.
-- ============================================================================

ALTER TABLE business_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_withdrawal_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_wallets' AND policyname = 'business_wallets tenant visibility') THEN
    CREATE POLICY "business_wallets tenant visibility" ON business_wallets
      USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_wallet_transactions' AND policyname = 'business_wallet_transactions tenant visibility') THEN
    CREATE POLICY "business_wallet_transactions tenant visibility" ON business_wallet_transactions
      USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'platform_transactions' AND policyname = 'platform_transactions admin only') THEN
    CREATE POLICY "platform_transactions admin only" ON platform_transactions
      USING (is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_withdrawal_requests' AND policyname = 'business_withdrawal_requests tenant visibility') THEN
    CREATE POLICY "business_withdrawal_requests tenant visibility" ON business_withdrawal_requests
      USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
END $$;

-- ============================================================================
-- 4. Settlement RPCs (SECURITY DEFINER, service-role only)
-- ============================================================================

-- Shared: given a settled booking, credit the business wallet (held) 80% and
-- book the platform's 20%. All in kobo. Idempotent on reference.
CREATE OR REPLACE FUNCTION public.fn_credit_business_booking(
  p_business_id uuid,
  p_appointment_id uuid,
  p_rounded_kobo integer,
  p_platform_kobo integer,
  p_reference text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_business_kobo integer := p_rounded_kobo - p_platform_kobo;
begin
  insert into business_wallets (business_id, held_balance)
  values (p_business_id, v_business_kobo)
  on conflict (business_id)
  do update set held_balance = business_wallets.held_balance + excluded.held_balance,
                updated_at = now();

  insert into business_wallet_transactions (business_id, appointment_id, type, amount, reference)
  values (p_business_id, p_appointment_id, 'booking_credit', v_business_kobo, p_reference)
  on conflict (reference) where type = 'booking_credit' do nothing;

  insert into platform_transactions (appointment_id, business_id, type, amount, reference)
  values (p_appointment_id, p_business_id, 'commission', p_platform_kobo, p_reference)
  on conflict (reference) where type = 'commission' do nothing;
end;
$$;

-- CareCoin payment: deducts coins from the user's wallet, credits the business
-- wallet (held) 80% of the rounded fee, books the 20% commission, and marks the
-- appointment paid. Atomic and idempotent.
CREATE OR REPLACE FUNCTION public.pay_booking_with_credits(
  p_user_id uuid,
  p_appointment_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_business_id uuid;
  v_fee_kobo integer;
  v_payment_status text;
  v_reference text;
  v_source text;
  v_coins integer;
  v_rounded_kobo integer;
  v_platform_kobo integer;
  v_balance integer;
begin
  select business_id, fee_amount, payment_status, payment_reference, source
    into v_business_id, v_fee_kobo, v_payment_status, v_reference, v_source
    from appointments where id = p_appointment_id
    for update;
  if v_business_id is null then
    return 'not_found';
  end if;
  if coalesce(v_source, '') <> 'carefind' then
    return 'invalid_source';
  end if;
  if v_fee_kobo is null or v_fee_kobo <= 0 then
    return 'no_fee';
  end if;
  if v_payment_status in ('paid', 'refunded') then
    return 'already_paid';
  end if;
  if v_reference is null then
    return 'no_reference';
  end if;

  -- coins spent = ceil(fee / 20000). rounded value = coins * 20000 kobo.
  v_coins := ceil(v_fee_kobo / 20000.0)::int;
  v_rounded_kobo := v_coins * 20000;
  v_platform_kobo := (v_rounded_kobo * 0.2)::int;

  select balance into v_balance from wallets where user_id = p_user_id for update;
  if v_balance is null then
    return 'no_wallet';
  end if;
  if v_balance < v_coins then
    return 'insufficient';
  end if;

  update wallets set balance = balance - v_coins where user_id = p_user_id;

  insert into transactions (user_id, type, amount, naira_amount, reference, status)
  values (p_user_id, 'booking_payment', v_coins, (v_rounded_kobo / 100), v_reference, 'success');

  perform public.fn_credit_business_booking(v_business_id, p_appointment_id, v_rounded_kobo, v_platform_kobo, v_reference);

  update appointments
     set payment_status = 'paid',
         payment_channel = 'carecoins',
         patient_user_id = p_user_id,
         refunded_at = null
   where id = p_appointment_id;

  return 'ok';
end;
$$;

-- Card payment settlement: called by verify-booking-payment.js once Paystack
-- confirms. Credits held + books commission; marks the appointment paid.
CREATE OR REPLACE FUNCTION public.settle_card_booking(
  p_appointment_id uuid,
  p_reference text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_business_id uuid;
  v_fee_kobo integer;
  v_payment_status text;
  v_source text;
  v_coins integer;
  v_rounded_kobo integer;
  v_platform_kobo integer;
begin
  select business_id, fee_amount, payment_status, source
    into v_business_id, v_fee_kobo, v_payment_status, v_source
    from appointments where id = p_appointment_id
    for update;
  if v_business_id is null then
    return 'not_found';
  end if;
  if v_payment_status in ('paid', 'refunded') then
    return 'already_paid';
  end if;
  if v_fee_kobo is null or v_fee_kobo <= 0 then
    return 'no_fee';
  end if;

  v_coins := ceil(v_fee_kobo / 20000.0)::int;
  v_rounded_kobo := v_coins * 20000;
  v_platform_kobo := (v_rounded_kobo * 0.2)::int;

  perform public.fn_credit_business_booking(v_business_id, p_appointment_id, v_rounded_kobo, v_platform_kobo, coalesce(p_reference, gen_random_uuid()::text));

  update appointments
     set payment_status = 'paid',
         payment_channel = 'card',
         refunded_at = null
   where id = p_appointment_id;

  return 'ok';
end;
$$;

-- ============================================================================
-- 5. Release trigger: appointment marked 'completed' -> held becomes available
-- ============================================================================

CREATE OR REPLACE FUNCTION public.appointments_after_update() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_amount integer;
begin
  -- Release paid, CareFind-processed bookings the moment the vendor marks the
  -- consultation completed. The ledger row is the source of truth for the 80%.
  if NEW.status = 'completed'
     and NEW.payment_status = 'paid'
     and NEW.released_at is null
     and OLD.status is distinct from 'completed'
     and coalesce(NEW.payment_channel, '') in ('carecoins', 'card')
  then
    select amount into v_amount
      from business_wallet_transactions
     where appointment_id = NEW.id
       and type = 'booking_credit'
     limit 1;

    if v_amount is not null then
      update business_wallets
         set held_balance = held_balance - v_amount,
             available_balance = available_balance + v_amount,
             updated_at = now()
       where business_id = NEW.business_id;

      insert into business_wallet_transactions (business_id, appointment_id, type, amount, reference)
      values (NEW.business_id, NEW.id, 'release', v_amount, null);
    end if;

    NEW.released_at := now();
    NEW.dispute_until := now() + interval '72 hours';
  end if;

  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS trg_appointments_release ON appointments;
CREATE TRIGGER trg_appointments_release
  AFTER UPDATE OF status ON appointments
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.appointments_after_update();

-- ============================================================================
-- 6. Refund RPC (cancellation / dispute). Returns coins to the paying user.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refund_appointment_payment(
  p_appointment_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_business_id uuid;
  v_payment_status text;
  v_reference text;
  v_user_id uuid;
  v_credit_amount integer;
  v_coins integer;
  v_available integer;
  v_held integer;
begin
  select business_id, payment_status, payment_reference, patient_user_id
    into v_business_id, v_payment_status, v_reference, v_user_id
    from appointments where id = p_appointment_id
    for update;
  if v_business_id is null then
    return 'not_found';
  end if;
  if v_payment_status = 'refunded' then
    return 'already_refunded';
  end if;
  if v_payment_status is distinct from 'paid' then
    return 'not_paid';
  end if;

  select amount into v_credit_amount
    from business_wallet_transactions
   where appointment_id = p_appointment_id
     and type = 'booking_credit'
   limit 1;
  if v_credit_amount is null then
    return 'not_settled';
  end if;

  select available_balance, held_balance into v_available, v_held
    from business_wallets where business_id = v_business_id for update;

  -- Debit from whichever bucket currently holds it; if the money was already
  -- withdrawn, the platform covers the refund from its own account.
  if v_held >= v_credit_amount then
    update business_wallets
       set held_balance = held_balance - v_credit_amount,
           updated_at = now()
     where business_id = v_business_id;
  elsif v_available >= v_credit_amount then
    update business_wallets
       set available_balance = available_balance - v_credit_amount,
           updated_at = now()
     where business_id = v_business_id;
  else
    -- Released AND already withdrawn: platform-funded refund.
    null;
  end if;

  insert into business_wallet_transactions (business_id, appointment_id, type, amount, reference)
  values (v_business_id, p_appointment_id, 'refund', -v_credit_amount, null);

  -- CareCoin bookings refund the user's coins (v_coins reconstructed from the
  -- credit ledger). Card bookings have nothing to return to a wallet.
  if v_user_id is not null then
    v_coins := ceil((v_credit_amount / 0.8) / 20000.0)::int;
    insert into wallets (user_id, balance)
    values (v_user_id, v_coins)
    on conflict (user_id) do update set balance = wallets.balance + v_coins;

    insert into transactions (user_id, type, amount, naira_amount, reference, status)
    values (v_user_id, 'booking_refund', v_coins, (v_credit_amount * 1.25 / 100)::int, coalesce(v_reference, gen_random_uuid()::text), 'success');
  end if;

  update appointments
     set payment_status = 'refunded',
         refunded_at = now()
   where id = p_appointment_id;

  return 'ok';
end;
$$;

-- ============================================================================
-- 7. Business withdrawal
-- ============================================================================

-- Atomically reserves available balance and records the withdrawal request.
-- The transfer itself fires from the API (initiate-business-withdrawal.js),
-- mirroring initiate-withdrawal.js for CareFind users.
CREATE OR REPLACE FUNCTION public.request_business_withdrawal(
  p_business_id uuid,
  p_amount integer,
  p_bank_name text,
  p_account_number text,
  p_account_name text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_available integer;
begin
  select available_balance into v_available
    from business_wallets where business_id = p_business_id for update;
  if v_available is null then
    return 'no_wallet';
  end if;
  if v_available < p_amount then
    return 'insufficient';
  end if;

  update business_wallets
     set available_balance = available_balance - p_amount,
         updated_at = now()
   where business_id = p_business_id;

  insert into business_wallet_transactions (business_id, type, amount)
  values (p_business_id, 'withdrawal', -p_amount);

  insert into business_withdrawal_requests
    (business_id, amount, bank_name, account_number, account_name, status)
  values
    (p_business_id, p_amount, p_bank_name, p_account_number, p_account_name, 'pending');

  return 'ok';
end;
$$;

-- ============================================================================
-- 8. Access control: these RPCs are internal plumbing only.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.fn_credit_business_booking(uuid, uuid, integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pay_booking_with_credits(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_card_booking(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_appointment_payment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_business_withdrawal(uuid, integer, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.appointments_after_update() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 9. Verify after applying
-- ============================================================================
--
-- Run each check; every one must return exactly one row.
--
-- 1. Wallets exist for every business, created lazily by the trigger:
--    select count(*) from businesses b
--    left join business_wallets w on w.business_id = b.id
--    where w.business_id is null;
--    --> 0 rows.
--
-- 2. Wallet transaction IDs are unique:
--    select count(*) from business_wallet_transactions
--    where id in (select id from business_wallet_transactions group by id having count(*) > 1);
--    --> 0 rows.
--
-- 3. Booking credits (80% to the vendor) equal the Paystack intake minus 20%:
--    select * from business_wallet_transactions where type = 'booking_credit' limit 5;
--    --> amount = round_down(paid_kobo * 0.8).
--
-- 4. RPCs are locked down to authenticated+service_role only:
--    select proname from pg_proc
--    where proname in ('fn_credit_business_booking','pay_booking_with_credits',
--      'settle_card_booking','refund_appointment_payment','request_business_withdrawal');
--    --> 5 rows; and none callable by anon (test with a fresh anon JWT).
--
-- 5. The release trigger fires on 'completed':
--    select * from appointments where status = 'completed' and payment_status = 'paid'
--      and released_at is not null limit 5;
--    --> rows only for bookings paid via 'carecoins' or 'card'.
--
-- 6. Confirm a refund returns the correct coin count for a CareCoin booking:
--    select public.refund_appointment_payment('<appointment_id>');
--    --> 'ok', wallet credited with ceil(paid_kobo / 16000), transaction 'booking_refund'.
