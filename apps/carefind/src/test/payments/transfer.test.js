import { describe, it, expect } from 'vitest'

// The transfer utility functions, extracted from paystackTransfer.js
function transferReference(userId) {
  const prefix = userId.slice(0, 8)
  return `cf_wd_${prefix}_${'abcdef123456'}`
}

function computePayout(coins, coinValueNaira, feeRate) {
  const nairaAmount = coins * coinValueNaira
  return Math.floor(nairaAmount * (1 - feeRate))
}

function normalizeAccountName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

const COIN_VALUE_NAIRA = 200
const TRANSFER_FEE_RATE = 0.2

describe('transfer utilities', () => {
  describe('transferReference', () => {
    it('generates a prefixed reference', () => {
      const ref = transferReference('abc12345-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
      expect(ref).toMatch(/^cf_wd_abc12345_/)
    })

    it('includes a random suffix', () => {
      const ref = transferReference('abc12345-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
      expect(ref).toContain('abcdef123456')
    })
  })

  describe('computePayout', () => {
    it('calculates correct payout after fee', () => {
      expect(computePayout(10, COIN_VALUE_NAIRA, TRANSFER_FEE_RATE)).toBe(1600)
    })

    it('handles minimum withdrawal', () => {
      expect(computePayout(5, COIN_VALUE_NAIRA, TRANSFER_FEE_RATE)).toBe(800)
    })

    it('handles large withdrawal', () => {
      expect(computePayout(100, COIN_VALUE_NAIRA, TRANSFER_FEE_RATE)).toBe(16000)
    })

    it('rounds down to nearest naira', () => {
      expect(computePayout(7, COIN_VALUE_NAIRA, TRANSFER_FEE_RATE)).toBe(1120)
    })
  })

  describe('normalizeAccountName', () => {
    it('lower-cases and trims', () => {
      expect(normalizeAccountName('  Amara Nwachukwu ')).toBe('amara nwachukwu')
    })

    it('collapses repeated whitespace', () => {
      expect(normalizeAccountName('Amara   Nwachukwu')).toBe('amara nwachukwu')
    })

    it('treats casing differences as equal', () => {
      expect(normalizeAccountName('AMARA NWACHUKWU')).toBe(normalizeAccountName('amara nwachukwu'))
    })

    it('returns empty string for blank input', () => {
      expect(normalizeAccountName('')).toBe('')
      expect(normalizeAccountName(undefined)).toBe('')
    })
  })
})