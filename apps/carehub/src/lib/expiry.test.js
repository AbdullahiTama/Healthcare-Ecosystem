import { describe, it, expect } from 'vitest'
import { daysToExpiry, expiryGroups, EXPIRY_SOON_DAYS } from './expiry.js'

const NOW = new Date('2026-11-19T10:00:00Z').getTime()
const p = (id, expiry_date, stock = 5) => ({ id, name: id.toUpperCase(), stock, expiry_date })

describe('expiry', () => {
  it('days to expiry: positive in date, negative expired, null without a date', () => {
    expect(daysToExpiry(p('a', '2026-11-29'), NOW)).toBe(10)
    expect(daysToExpiry(p('a', '2026-11-10'), NOW)).toBe(-9)
    expect(daysToExpiry(p('a', null), NOW)).toBeNull()
    expect(daysToExpiry(p('a', 'garbage'), NOW)).toBeNull()
  })

  it('groups products: expiring within 60 days (soonest first), expired (most recent first), with quantity and date', () => {
    const g = expiryGroups([p('later', '2027-06-01'), p('soon', '2026-12-01', 12), 
      p('sooner', '2026-11-25', 0), p('old', '2026-01-01'), p('recent', '2026-11-15', 3), p('none', null)], { now: NOW })
    expect(g.expiring.map(r => r.id)).toEqual(['sooner', 'soon'])
    expect(g.expiring[1]).toEqual({ id: 'soon', name: 'SOON', stock: 12, expiry_date: '2026-12-01', days: 12 })
    expect(g.expired.map(r => r.id)).toEqual(['recent', 'old'])
    expect(EXPIRY_SOON_DAYS).toBe(60)
  })

  it('the 60-day edge is included, 61 days is not', () => {
    const g = expiryGroups([p('d60', '2027-01-18'), p('d61', '2027-01-19')], { now: NOW })
    expect(g.expiring.map(r => [r.id, r.days])).toEqual([['d60', 60]])
  })
})
