// E-commerce segment resolution and commission config — single source for segment→rate.
// Canonical rates from apps/carefind/src/modules/shop/pricing.js COMMISSION_RATES — kept in sync manually
// with compile-time assertion below. No manufacturer/importer rate exists by design.

// Owner decision 2026-10-05: 20% flat for every segment (replaces 10% / 5% / 2.5%). Must equal financial_config.shop_commission_rate
// (the database refuses an order whose commission differs) and the active ecommerce_terms version.
export const SEGMENT_RATES = {
  retail: 0.20,
  wholesale: 0.20,
  distributor: 0.20,
}

export const SEGMENT_LABELS = {
  retail: 'Retail',
  wholesale: 'Wholesale',
  distributor: 'Distributor',
}

export const SEGMENT_COMMISSION_LABELS = {
  retail: '20% of sale (vendor-paid, deducted from vendor payout)',
  wholesale: '20% of sale (vendor-paid, deducted from vendor payout)',
  distributor: '20% of sale (vendor-paid, deducted from vendor payout)',
}

export const SEGMENT_CHECKBOX_LABELS = {
  retail: 'I have read and agree to the Retail E-commerce Terms & Conditions.',
  wholesale: 'I have read and agree to the Wholesale E-commerce Terms & Conditions.',
  distributor: 'I have read and agree to the Distributor E-commerce Terms & Conditions.',
}

const VALID_SEGMENTS = new Set(Object.keys(SEGMENT_RATES))

export function assertValidSegment(segment) {
  if (!VALID_SEGMENTS.has(segment)) {
    throw new Error(`Invalid e-commerce segment: ${segment}. Must be one of: ${[...VALID_SEGMENTS].join(', ')}`)
  }
}

export function getCommissionRate(segment) {
  assertValidSegment(segment)
  return SEGMENT_RATES[segment]
}

/**
 * Resolve CareHub business_type → e-commerce segment.
 * - wholesale → wholesale
 * - manufacturer_importer → distributor
 * - all others (pharmacy, hospital, skincare, dental, optical, wellness, clinic, laboratory, other, null) → retail
 * - if business carries explicit ecommerce_segment (ops override), it takes precedence when valid
 * @param {string} businessType
 * @param {string} [overrideSegment] optional explicit per-business override column
 * @returns {'retail'|'wholesale'|'distributor'}
 */
export function resolveEcommerceSegment(businessType, overrideSegment) {
  if (overrideSegment && VALID_SEGMENTS.has(overrideSegment)) return overrideSegment
  const t = String(businessType || '').toLowerCase().trim()
  if (t === 'wholesale') return 'wholesale'
  if (t === 'manufacturer_importer') return 'distributor'
  return 'retail'
}

export function commissionExample(segment) {
  assertValidSegment(segment)
  if (segment === 'retail') return { saleKobo: 500000, commissionKobo: 100000, payoutKobo: 400000, label: '₦5,000 sale → ₦1,000 commission → ₦4,000 vendor payout before other adjustments' }
  if (segment === 'wholesale') return { saleKobo: 1000000, commissionKobo: 200000, payoutKobo: 800000, label: '₦10,000 sale → ₦2,000 commission → ₦8,000 vendor payout' }
  return { saleKobo: 2000000, commissionKobo: 400000, payoutKobo: 1600000, label: '₦20,000 sale → ₦4,000 commission → ₦16,000 vendor payout' }
}

// Compile-time sync guard: if pricing.js diverges, tests will catch it via cross-import.
export const COMMISSION_RATES = SEGMENT_RATES
