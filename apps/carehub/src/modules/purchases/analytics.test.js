import { describe, it, expect } from 'vitest'
import { purchaseFrequency, priceChange, share } from './analytics'

describe('purchase analytics', () => {
  it('frequency per week when purchases are frequent, otherwise every N days', () => {
    expect(purchaseFrequency(12, { from: '2026-10-01', to: '2026-10-28' })).toBe('3 per week')
    expect(purchaseFrequency(3, { from: '2026-10-01', to: '2026-10-30' })).toBe('about every 10 days')
  })

  it('all time uses the span from the first to the last purchase', () => {
    expect(purchaseFrequency(8, { from: null, to: null }, { firstDate: '2026-09-01', lastDate: '2026-09-28' })).toBe('2 per week')
  })

  it('one purchase, or none, says so plainly', () => {
    expect(purchaseFrequency(1, { from: '2026-10-01', to: '2026-10-31' })).toBe('1 purchase in 31 days')
    expect(purchaseFrequency(1, { from: null, to: null })).toBe('1 purchase')
    expect(purchaseFrequency(0, { from: null, to: null })).toBeNull()
  })

  it('price change and share', () => {
    expect(priceChange(110, 100)).toBe(10)
    expect(priceChange(90, 100)).toBe(-10)
    expect(priceChange(90, null)).toBeNull()
    expect(share(25, 200)).toBe(13)
    expect(share(5, 0)).toBe(0)
  })
})
