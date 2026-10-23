import { describe, it, expect } from 'vitest'
import { inPeriod } from './periodFilter'

const now = new Date('2026-10-23T12:00:00Z')
const rows = [
  { id: 1, created_at: '2026-10-22T09:00:00Z' },
  { id: 2, created_at: '2026-09-05T09:00:00Z' },
  { id: 3, created_at: null },
]

describe('inPeriod', () => {
  it('works as an Array.filter callback wrapper for sales, purchases and ADR rows', () => {
    const opts = { period: 'month', month: '2026-10', now }
    expect(rows.filter(r => inPeriod(r, opts)).map(r => r.id)).toEqual([1])
  })
  it('uses a custom date accessor', () => {
    const opts = { period: 'month', month: '2026-09', now, dateOf: r => (r.id === 2 ? '2026-09-01' : '') }
    expect(rows.filter(r => inPeriod(r, opts)).map(r => r.id)).toEqual([2])
  })
  it('handles today, week, year and all', () => {
    expect(inPeriod(rows[0], { period: 'today', now })).toBe(false)
    expect(inPeriod(rows[0], { period: 'week', now })).toBe(true)
    expect(inPeriod(rows[1], { period: 'week', now })).toBe(false)
    expect(inPeriod(rows[1], { period: 'year', now })).toBe(true)
    expect(inPeriod(rows[2], { period: 'all', now })).toBe(true)
  })
  it('does not throw on a missing date', () => {
    expect(() => inPeriod(rows[2], { period: 'month', month: '2026-10', now })).not.toThrow()
  })
})
