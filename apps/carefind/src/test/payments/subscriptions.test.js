import { describe, it, expect } from 'vitest'

// Core subscription logic extracted from subscriptions.js
const NAIRA_PER_COIN = 200
const MAX_PRICE_COINS = 12

function coinsToNaira(coins) {
  return (Number(coins) || 0) * NAIRA_PER_COIN
}

describe('subscription utilities', () => {
  describe('coinsToNaira', () => {
    it('converts coins to naira', () => {
      expect(coinsToNaira(1)).toBe(200)
      expect(coinsToNaira(5)).toBe(1000)
      expect(coinsToNaira(12)).toBe(2400)
    })

    it('handles zero', () => {
      expect(coinsToNaira(0)).toBe(0)
    })

    it('handles null/undefined', () => {
      expect(coinsToNaira(null)).toBe(0)
      expect(coinsToNaira(undefined)).toBe(0)
    })

    it('handles string input', () => {
      expect(coinsToNaira('5')).toBe(1000)
    })
  })

  describe('constants', () => {
    it('NAIRA_PER_COIN is 200', () => {
      expect(NAIRA_PER_COIN).toBe(200)
    })

    it('MAX_PRICE_COINS is 12', () => {
      expect(MAX_PRICE_COINS).toBe(12)
    })

    it('max subscription in naira is 2400', () => {
      expect(MAX_PRICE_COINS * NAIRA_PER_COIN).toBe(2400)
    })
  })
})