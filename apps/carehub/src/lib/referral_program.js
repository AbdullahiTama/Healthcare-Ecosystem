// CareHub Referral Agent program — single source of truth for the money rules
// (plan §3). Referenced by the client for display only and by the server-side
// commission job (api/_lib/commissions.js) for the actual math — any rate or
// policy change is a one-line edit here, never a schema change.
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