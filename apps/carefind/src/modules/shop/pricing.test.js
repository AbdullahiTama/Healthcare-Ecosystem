import { describe, it, expect } from 'vitest'
import {
  calculateCommission,
  calculateFulfilmentFee,
  calculateDeliveryFee,
  calculateTotalFees,
  SEGMENTS,
  COMMISSION_RATES,
  FULFILMENT_RATES,
  DELIVERY_BRACKETS
} from './pricing.js'

describe('Pricing Engine', () => {
  describe('calculateCommission', () => {
    it('calculates retail commission (10%)', () => {
      expect(calculateCommission('retail', 350000)).toBe(35000) // ₦3500 → ₦350
      expect(calculateCommission('retail', 100000)).toBe(10000) // ₦1000 → ₦100
    })

    it('calculates wholesale commission (5%)', () => {
      expect(calculateCommission('wholesale', 1000000)).toBe(50000) // ₦10000 → ₦500
      expect(calculateCommission('wholesale', 200000)).toBe(10000) // ₦2000 → ₦100
    })

    it('calculates distributor commission (2.5%)', () => {
      expect(calculateCommission('distributor', 5000000)).toBe(125000) // ₦50000 → ₦1250
      expect(calculateCommission('distributor', 1000000)).toBe(25000) // ₦10000 → ₦250
    })

    it('returns 0 for zero order total', () => {
      expect(calculateCommission('retail', 0)).toBe(0)
      expect(calculateCommission('wholesale', 0)).toBe(0)
      expect(calculateCommission('distributor', 0)).toBe(0)
    })

    it('throws error for invalid segment', () => {
      expect(() => calculateCommission('invalid', 100000)).toThrow('Invalid segment')
      expect(() => calculateCommission('', 100000)).toThrow('Invalid segment')
    })

    it('throws error for negative order total', () => {
      expect(() => calculateCommission('retail', -1000)).toThrow('Order total must be ≥ 0')
    })
  })

  describe('calculateFulfilmentFee', () => {
    it('calculates retail fulfilment (MAX(₦600, 3%))', () => {
      // ₦3500 → 3% = ₦105, MIN = ₦600 → ₦600
      expect(calculateFulfilmentFee('retail', 350000)).toBe(60000)
      // ₦100000 → 3% = ₦3000, MIN = ₦600 → ₦3000
      expect(calculateFulfilmentFee('retail', 10000000)).toBe(300000)
    })

    it('calculates wholesale fulfilment (MAX(₦1500, 2%))', () => {
      // ₦10000 → 2% = ₦200, MIN = ₦1500 → ₦1500
      expect(calculateFulfilmentFee('wholesale', 1000000)).toBe(150000)
      // ₦100000 → 2% = ₦2000, MIN = ₦1500 → ₦2000
      expect(calculateFulfilmentFee('wholesale', 10000000)).toBe(200000)
    })

    it('calculates distributor fulfilment (MAX(₦350, 1%))', () => {
      // ₦50000 → 1% = ₦500, MIN = ₦350 → ₦500
      expect(calculateFulfilmentFee('distributor', 5000000)).toBe(50000)
      // ₦10000 → 1% = ₦100, MIN = ₦350 → ₦350
      expect(calculateFulfilmentFee('distributor', 1000000)).toBe(35000)
    })

    it('returns minimum for zero order total', () => {
      expect(calculateFulfilmentFee('retail', 0)).toBe(60000) // ₦600
      expect(calculateFulfilmentFee('wholesale', 0)).toBe(150000) // ₦1500
      expect(calculateFulfilmentFee('distributor', 0)).toBe(35000) // ₦350
    })

    it('throws error for invalid segment', () => {
      expect(() => calculateFulfilmentFee('invalid', 100000)).toThrow('Invalid segment')
    })

    it('throws error for negative order total', () => {
      expect(() => calculateFulfilmentFee('retail', -1000)).toThrow('Order total must be ≥ 0')
    })
  })

  describe('calculateDeliveryFee', () => {
    it('returns 0 for distance ≤ 3km (FREE)', () => {
      expect(calculateDeliveryFee(0, 'retail')).toBe(0)
      expect(calculateDeliveryFee(1, 'retail')).toBe(0)
      expect(calculateDeliveryFee(2, 'retail')).toBe(0)
      expect(calculateDeliveryFee(3, 'retail')).toBe(0)
    })

    it('calculates 4-6km bracket (₦600)', () => {
      expect(calculateDeliveryFee(4, 'retail')).toBe(60000)
      expect(calculateDeliveryFee(5, 'retail')).toBe(60000)
      expect(calculateDeliveryFee(6, 'retail')).toBe(60000)
    })

    it('calculates 7-9km bracket (₦1200)', () => {
      expect(calculateDeliveryFee(7, 'retail')).toBe(120000)
      expect(calculateDeliveryFee(8, 'retail')).toBe(120000)
      expect(calculateDeliveryFee(9, 'retail')).toBe(120000)
    })

    it('calculates 10-12km bracket (₦1800)', () => {
      expect(calculateDeliveryFee(10, 'retail')).toBe(180000)
      expect(calculateDeliveryFee(11, 'retail')).toBe(180000)
      expect(calculateDeliveryFee(12, 'retail')).toBe(180000)
    })

    it('calculates >12km (multiple brackets)', () => {
      expect(calculateDeliveryFee(13, 'retail')).toBe(240000) // 4 brackets
      expect(calculateDeliveryFee(15, 'retail')).toBe(240000) // 4 brackets
      expect(calculateDeliveryFee(16, 'retail')).toBe(300000) // 5 brackets
    })

    it('handles fractional distances', () => {
      expect(calculateDeliveryFee(3.5, 'retail')).toBe(60000) // 4km bracket
      expect(calculateDeliveryFee(6.5, 'retail')).toBe(120000) // 7km bracket
    })

    it('throws error for negative distance', () => {
      expect(() => calculateDeliveryFee(-1, 'retail')).toThrow('Distance must be ≥ 0')
    })

    it('throws error for invalid segment', () => {
      expect(() => calculateDeliveryFee(5, 'invalid')).toThrow('Invalid segment')
    })
  })

  describe('calculateTotalFees', () => {
    it('calculates all fees without delivery', () => {
      const result = calculateTotalFees({
        segment: 'retail',
        orderTotalKobo: 350000,
        distanceKm: 5,
        includeDelivery: false
      })
      
      expect(result.commission).toBe(35000) // 10% of ₦3500
      expect(result.fulfilment).toBe(60000) // MAX(₦600, 3% of ₦3500)
      expect(result.delivery).toBe(0) // not included
      expect(result.total).toBe(95000) // 35000 + 60000 + 0
    })

    it('calculates all fees with delivery', () => {
      const result = calculateTotalFees({
        segment: 'retail',
        orderTotalKobo: 350000,
        distanceKm: 5,
        includeDelivery: true
      })
      
      expect(result.commission).toBe(35000)
      expect(result.fulfilment).toBe(60000)
      expect(result.delivery).toBe(60000) // 4-6km bracket
      expect(result.total).toBe(155000) // 35000 + 60000 + 60000
    })

    it('defaults to no delivery', () => {
      const result = calculateTotalFees({
        segment: 'wholesale',
        orderTotalKobo: 1000000
      })
      
      expect(result.delivery).toBe(0)
    })

    it('defaults distance to 0', () => {
      const result = calculateTotalFees({
        segment: 'retail',
        orderTotalKobo: 100000,
        includeDelivery: true
      })
      
      expect(result.delivery).toBe(0) // 0km = FREE
    })
  })

  describe('Constants', () => {
    it('exports SEGMENTS array', () => {
      expect(SEGMENTS).toEqual(['retail', 'wholesale', 'distributor'])
    })

    it('exports COMMISSION_RATES', () => {
      expect(COMMISSION_RATES.retail).toBe(0.10)
      expect(COMMISSION_RATES.wholesale).toBe(0.05)
      expect(COMMISSION_RATES.distributor).toBe(0.025)
    })

    it('exports FULFILMENT_RATES', () => {
      expect(FULFILMENT_RATES.retail.min).toBe(60000)
      expect(FULFILMENT_RATES.retail.rate).toBe(0.03)
      expect(FULFILMENT_RATES.wholesale.min).toBe(150000)
      expect(FULFILMENT_RATES.distributor.min).toBe(35000)
    })

    it('exports DELIVERY_BRACKETS', () => {
      expect(DELIVERY_BRACKETS.free).toBe(3)
      expect(DELIVERY_BRACKETS.bracketSize).toBe(3)
      expect(DELIVERY_BRACKETS.bracketCost).toBe(60000)
    })
  })
})
