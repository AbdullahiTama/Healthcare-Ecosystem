-- ============================================================================
-- 2026-10-26 - Withdrawal limits for saved payout accounts (Phase 4)
--
-- Configuration only; no schema or function change. The API folds these into the withdrawal engine's own per-call
-- daily cap (create_withdrawal.p_daily_cap_coins, create_business_withdrawal.p_daily_cap_kobo), so the engine enforces
-- them atomically; the lowest applicable ceiling wins and nothing here can RAISE an existing limit.
--
--   kyc_tier1_daily_cap_kobo / kyc_tier2_daily_cap_kobo   rolling-24h ceiling for a PERSON (CareFind) withdrawing to a
--       saved account: tier 1 = BVN + NIN verified, tier 2 = + selfie match. (Businesses keep the engine's
--       business_withdrawal_daily_cap_kobo.) Withdrawals to typed-in details are unchanged until payout_account_required = 1.
--   payout_account_cooloff_hours / payout_account_cooloff_daily_cap_kobo   for this long after an account is saved, the
--       owner's rolling-24h total (person or business) is capped at the small amount, whatever the tier.
--
-- Changing a number takes effect within a minute, without a deploy. 0 hours turns the cooling-off off.
-- Re-runnable; existing values are never overwritten.
-- ============================================================================
insert into public.financial_config (key, value, unit, description) values
  ('kyc_tier1_daily_cap_kobo',               5000000,  'kobo',  'Rolling-24h withdrawal ceiling for a person verified to tier 1 (BVN + NIN), to a saved payout account (N50,000).'),
  ('kyc_tier2_daily_cap_kobo',               50000000, 'kobo',  'Rolling-24h withdrawal ceiling for a person verified to tier 2 (+ selfie), to a saved payout account (N500,000).'),
  ('payout_account_cooloff_hours',           24,       'hours', 'How long a newly saved payout account is in cooling-off. 0 disables it.'),
  ('payout_account_cooloff_daily_cap_kobo',  2000000,  'kobo',  'Rolling-24h withdrawal total allowed while a payout account is in cooling-off (N20,000).')
on conflict (key) do nothing;

-- VERIFY AFTER APPLYING
--   select key, value from financial_config where key like 'kyc_tier%' or key like 'payout_account%' order by key;  -- 5 rows incl. payout_account_required
