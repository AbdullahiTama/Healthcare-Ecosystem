-- ============================================================================
-- 2026-11-02 - Identity verification (KYC) is OFF unless this switch says otherwise (H06 of the payment-security track)
--
-- Owner decision 2026-10-10: paid identity verification (Dojah BVN / NIN / selfie) is NOT a requirement for payments or
-- withdrawals. It is DISABLED, not deleted: the tables, rows, functions and provider code stay, behind one switch.
--   financial_config.kyc_enabled   0 = off (the default, and also what a MISSING row means)   1 = on
-- While it is 0: /api/kyc/verify and /selfie answer 404 kyc_disabled without constructing the provider (no paid call is
-- possible); /api/kyc/status answers { enabled: false }; no KYC row is read by any limit (the tier ceilings never lift a
-- cap); the payout-account screen shows no identity UI and loads without calling KYC at all.
-- Re-enabling is one row (set it to 1) plus the Dojah credentials and a dedicated KYC_HASH_SECRET; see
-- docs/architecture/Payout-Accounts-and-KYC.md.
--
-- Existing kyc_verifications rows (2 attempt rows, tier 0, at the time of writing) are left exactly as they are.
-- NOT APPLIED to production. Safe before or after the deploy: the code treats a missing row as off. Re-runnable.
-- ============================================================================
do $$
begin
  if to_regclass('public.financial_config') is null then raise exception 'apply the financial foundation first (financial_config)'; end if;
end $$;

insert into public.financial_config (key, value, unit, description) values
  ('kyc_enabled', 0, 'flag', '1 = identity verification (BVN / NIN / selfie, paid provider) is available and may lift withdrawal limits; 0 = off: nothing about payments or withdrawals depends on it.')
on conflict (key) do nothing;
