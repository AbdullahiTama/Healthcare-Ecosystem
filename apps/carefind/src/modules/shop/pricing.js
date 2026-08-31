// Pricing Engine — Pure functions for commission, fulfilment, and delivery fees
// All amounts in kobo (integer), all functions pure (no DB, no async, no side effects)

export const SEGMENTS = ['retail', 'wholesale', 'distributor']

export const COMMISSION_RATES = {
  retail: 0.10,      // 10%
  wholesale: 0.05,   // 5%
  distributor: 0.025 // 2.5%
}

export const FULFILMENT_RATES = {
  retail: { min: 60000, rate: 0.03 },      // MIN(₦600, 3%)
  wholesale: { min: 150000, rate: 0.02 },  // MIN(₦1500, 2%)
  distributor: { min: 35000, rate: 0.01 }  // MIN(₦350, 1%)
}

export const DELIVERY_BRACKETS = {
  free: 3,      // 0-3km FREE
  bracketSize: 3, // each 3km bracket
  bracketCost: 60000 // ₦600 per bracket
}

/**
 * Calculate vendor commission (deducted from vendor payout)
 * @param {string} segment - 'retail' | 'wholesale' | 'distributor'
 * @param {number} orderTotalKobo - order total in kobo (integer)
 * @returns {number} commission in kobo
 */
export function calculateCommission(segment, orderTotalKobo) {
  if (!SEGMENTS.includes(segment)) {
    throw new Error(`Invalid segment: ${segment}. Must be one of: ${SEGMENTS.join(', ')}`)
  }
  if (orderTotalKobo < 0) {
    throw new Error('Order total must be ≥ 0')
  }
  
  const rate = COMMISSION_RATES[segment]
  return Math.round(orderTotalKobo * rate)
}

/**
 * Calculate customer fulfilment fee (covers pick, pack, deliver to pickup station)
 * @param {string} segment - 'retail' | 'wholesale' | 'distributor'
 * @param {number} orderTotalKobo - order total in kobo (integer)
 * @param {object|number} opts - { cartonCount?: number } or cartonCount for distributor
 * @returns {number} fulfilment fee in kobo
 */
export function calculateFulfilmentFee(segment, orderTotalKobo, opts = {}) {
  if (!SEGMENTS.includes(segment)) {
    throw new Error(`Invalid segment: ${segment}. Must be one of: ${SEGMENTS.join(', ')}`)
  }
  if (orderTotalKobo < 0) {
    throw new Error('Order total must be ≥ 0')
  }
  
  const { min, rate } = FULFILMENT_RATES[segment]
  let effectiveMin = min
  // Distributor: MAX(₦350/carton, 1%) — min scales with carton count (Spec B24.2)
  if (segment === 'distributor') {
    const cartonCount = typeof opts === 'number' ? opts : (opts.cartonCount ?? 1)
    if (cartonCount > 1) effectiveMin = min * cartonCount
  }
  const percentage = Math.round(orderTotalKobo * rate)
  return Math.max(effectiveMin, percentage)
}

/**
 * Calculate customer delivery fee (optional, only if choosing home delivery)
 * @param {number} distanceKm - distance in kilometers (float)
 * @param {string} segment - 'retail' | 'wholesale' | 'distributor'
 * @returns {number} delivery fee in kobo
 */
export function calculateDeliveryFee(distanceKm, segment) {
  if (!SEGMENTS.includes(segment)) {
    throw new Error(`Invalid segment: ${segment}. Must be one of: ${SEGMENTS.join(', ')}`)
  }
  if (distanceKm < 0) {
    throw new Error('Distance must be ≥ 0')
  }
  
  const { free, bracketSize, bracketCost } = DELIVERY_BRACKETS
  
  // 0-3km FREE
  if (distanceKm <= free) {
    return 0
  }
  
  // Calculate brackets: 4-6km = 1 bracket, 7-9km = 2 brackets, etc.
  const kmBeyondFree = distanceKm - free
  const brackets = Math.ceil(kmBeyondFree / bracketSize)
  
  return brackets * bracketCost
}

/**
 * Calculate total fees for an order
 * @param {Object} params
 * @param {string} params.segment - 'retail' | 'wholesale' | 'distributor'
 * @param {number} params.orderTotalKobo - order total in kobo
 * @param {number} params.distanceKm - distance in kilometers (for delivery)
 * @param {boolean} params.includeDelivery - whether to include delivery fee (default: false)
 * @param {number} params.cartonCount - distributor carton count (default 1)
 * @returns {Object} { commission, fulfilment, delivery, total } all in kobo
 */
export function calculateTotalFees({ segment, orderTotalKobo, distanceKm = 0, includeDelivery = false, cartonCount = 1 }) {
  const commission = calculateCommission(segment, orderTotalKobo)
  const fulfilment = calculateFulfilmentFee(segment, orderTotalKobo, { cartonCount })
  const delivery = includeDelivery ? calculateDeliveryFee(distanceKm, segment) : 0
  
  return {
    commission,
    fulfilment,
    delivery,
    total: commission + fulfilment + delivery
  }
}
