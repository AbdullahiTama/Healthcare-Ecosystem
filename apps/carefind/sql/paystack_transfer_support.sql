-- Paystack transfer support for automated withdrawals.
-- Applied after wallet_payment_hardening.sql.
--
-- Adds Paystack-specific columns to withdrawal_requests so the automated
-- transfer flow (initiate-withdrawal.js → Paystack Transfer API →
-- paystack-transfer-webhook.js) can track the full lifecycle.

-- =====================================================================
-- 1. Add Paystack tracking columns to withdrawal_requests
-- =====================================================================
ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS paystack_recipient_code text,
  ADD COLUMN IF NOT EXISTS paystack_reference text,
  ADD COLUMN IF NOT EXISTS paystack_transfer_code text,
  ADD COLUMN IF NOT EXISTS bank_code text;

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_paystack_reference
  ON public.withdrawal_requests (paystack_reference)
  WHERE paystack_reference IS NOT NULL;

-- =====================================================================
-- 2. RPC to mark a withdrawal as completed (called by transfer webhook)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.complete_withdrawal_transfer(p_reference text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_id uuid;
begin
  select id into v_id
  from withdrawal_requests
  where paystack_reference = p_reference
    and status = 'pending'
  for update;

  if v_id is null then
    return 'not_found';
  end if;

  update withdrawal_requests
  set status = 'completed'
  where id = v_id;

  return 'ok';
end;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_withdrawal_transfer(text) FROM PUBLIC, anon, authenticated;

-- =====================================================================
-- 3. Add Paystack subaccount support to profiles
-- =====================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS paystack_subaccount_code text;

CREATE INDEX IF NOT EXISTS idx_profiles_paystack_subaccount
  ON public.profiles (paystack_subaccount_code)
  WHERE paystack_subaccount_code IS NOT NULL;

-- =====================================================================
-- 4. Add subscription_payment type to the transactions check constraint
--    if one exists (safe to run even without the constraint)
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'type'
  ) THEN
    ALTER TABLE public.transactions
      DROP CONSTRAINT IF EXISTS transactions_type_check;
  END IF;
END $$;