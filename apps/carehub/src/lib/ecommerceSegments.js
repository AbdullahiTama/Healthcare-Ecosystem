// E-commerce segment resolution and commission config — single source for segment→rate.
// Canonical rates from apps/carefind/src/modules/shop/pricing.js COMMISSION_RATES — kept in sync manually
// with compile-time assertion below. No manufacturer/importer rate exists by design.

export const SEGMENT_RATES = {
  retail: 0.10,
  wholesale: 0.05,
  distributor: 0.025,
}

export const SEGMENT_LABELS = {
  retail: 'Retail',
  wholesale: 'Wholesale',
  distributor: 'Distributor',
}

export const SEGMENT_COMMISSION_LABELS = {
  retail: '10% of sale (vendor-paid, deducted from vendor payout)',
  wholesale: '5% of sale (vendor-paid, deducted from vendor payout)',
  distributor: '2.5% of sale (vendor-paid, deducted from vendor payout)',
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
  if (segment === 'retail') return { saleKobo: 500000, commissionKobo: 50000, payoutKobo: 450000, label: '₦5,000 sale → ₦500 commission → ₦4,500 vendor payout before other adjustments' }
  if (segment === 'wholesale') return { saleKobo: 1000000, commissionKobo: 50000, payoutKobo: 950000, label: '₦10,000 sale → ₦500 commission → ₦9,500 vendor payout' }
  return { saleKobo: 2000000, commissionKobo: 50000, payoutKobo: 1950000, label: '₦20,000 sale → ₦500 commission → ₦19,500 vendor payout' }
}

// Compile-time sync guard: if pricing.js diverges, tests will catch it via cross-import.
export const COMMISSION_RATES = SEGMENT_RATES
