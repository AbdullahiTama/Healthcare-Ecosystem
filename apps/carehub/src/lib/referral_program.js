// CareHub Referral Agent program - the money rules (plan 3), for DISPLAY on the client.
// The commission itself is computed by the database (renew_business_plan ->
// _record_referral_commission) from financial_config: referral_first_payment_rate,
// referral_residual_rate and referral_accrue_while_inactive. These constants must match
// those rows (a test asserts it); change the rate in financial_config, not only here.
export const REFERRAL_RATES = {
  referral_bonus: 0.40,   // one-time, on the business's FIRST successful payment
  residual: 0.05,         // recurring, on every subsequent payment
}

// Product rule (spec §6 #1): what happens when a payment lands while the
// referring agent is not `active`. false = record+flag, no commission accrues
// (safe default). true = keep accruing until the agent is resolved.
export const ACCRUED_WHILE_INACTIVE = false

export const REFERRAL_CODE_PREFIX = 'CH'   // generated codes look like CH-8F3K2Q

export function generateReferralCode() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return REFERRAL_CODE_PREFIX + '-' + (rand || 'ABC123')
}