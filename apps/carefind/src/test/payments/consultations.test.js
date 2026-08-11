import { describe, it, expect } from 'vitest'
import { NAIRA_PER_COIN, coinsForConsultation } from '../../modules/subscriptions-monetization/consultations.js'

describe('consultation utilities', () => {
  describe('coinsForConsultation', () => {
    it('rounds the fee up to whole CareCoins', () => {
      expect(coinsForConsultation(200)).toBe(1)
      expect(coinsForConsultation(1000)).toBe(5)
      expect(coinsForConsultation(2000)).toBe(10)
    })

    it('rounds up partial coins (never over-credits)', () => {
      expect(coinsForConsultation(201)).toBe(2)
      expect(coinsForConsultation(2500)).toBe(13)
      expect(coinsForConsultation(500)).toBe(3)
    })

    it('handles zero and negatives as zero coins', () => {
      expect(coinsForConsultation(0)).toBe(0)
      expect(coinsForConsultation(-50)).toBe(0)
    })

    it('handles null/undefined', () => {
      expect(coinsForConsultation(null)).toBe(0)
      expect(coinsForConsultation(undefined)).toBe(0)
    })

    it('handles string input', () => {
      expect(coinsForConsultation('1500')).toBe(8)
    })
  })

  describe('constants', () => {
    it('NAIRA_PER_COIN is 200', () => {
      expect(NAIRA_PER_COIN).toBe(200)
    })
  })
})
