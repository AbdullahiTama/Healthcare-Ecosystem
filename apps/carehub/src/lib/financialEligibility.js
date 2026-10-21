import { getNavItems } from './permissions'

// ── Financial eligibility matrix ──────────────────────────────────────────────
// One place that answers "what may a business of this type do with money and
// identity checks?". It does not add rules: it reads the module registry (the
// single source of truth for who sees Wallet) and states the server-side policy
// so the two can be tested against each other.
//
// Server-side policy (verified 2026-10-21, see docs/architecture/Financial-Eligibility.md):
//   * Wallet, balances, transactions, top-up and withdrawal are decided by the
//     business's tenancy (RLS: business_id IN current_business_ids()) and by the
//     verified OWNER (initiate-business-withdrawal + PIN + emailed code), never by
//     business type. No wallet/KYC function or API handler reads business_type.
//   * Identity verification (KYC) is switched OFF platform-wide by owner decision
//     H06 (financial_config.kyc_enabled = 0). When an owner switches it on it is
//     per PERSON, not per business type, so it is available to every type at once.
//
// Anything not listed here is not granted: add the rule to the server first.

export const WALLET_OPERATIONS = ['view', 'topUp', 'withdraw']

/**
 * @param {string} businessType  any id the registry knows (unknown ids normalise to 'other')
 * @param {{ kycEnabled?: boolean }} [server]  platform switches read from the server
 */
export function financialEligibility(businessType, { kycEnabled = false } = {}) {
  const ownerHasWallet = getNavItems('Owner', businessType).some(([id]) => id === 'wallet')
  return {
    businessType,
    wallet: {
      // Owner always; staff only when the owner grants the Wallet module to a custom role (read-only).
      view: ownerHasWallet,
      topUp: ownerHasWallet,
      // Owner-only on the server too; PIN + emailed code on every withdrawal.
      withdraw: ownerHasWallet,
    },
    kyc: {
      // The identity card appears on the payout screen only while the platform switch is on.
      interface: ownerHasWallet && kycEnabled,
      // Never a prerequisite for payments or withdrawals (H02/H06).
      requiredForPayments: false,
    },
  }
}
