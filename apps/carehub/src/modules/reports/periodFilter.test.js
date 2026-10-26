import { describe, it, expect } from 'vitest'
import { inPeriod, periodRange } from './periodFilter'

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

describe('periodRange', () => {
  const now = new Date('2026-10-26T15:30:00Z')
  it('today is the UTC day', () => {
    expect(periodRange({ period: 'today', now })).toEqual({ from: '2026-10-26T00:00:00', to: '2026-10-27T00:00:00' })
  })
  it('month is the chosen month, December rolls the year', () => {
    expect(periodRange({ period: 'month', month: '2026-10', now })).toEqual({ from: '2026-10-01T00:00:00', to: '2026-11-01T00:00:00' })
    expect(periodRange({ period: 'month', month: '2026-12', now })).toEqual({ from: '2026-12-01T00:00:00', to: '2027-01-01T00:00:00' })
  })
  it('year is the current year; week is the last 7 days', () => {
    expect(periodRange({ period: 'year', now })).toEqual({ from: '2026-01-01T00:00:00', to: '2027-01-01T00:00:00' })
    expect(periodRange({ period: 'week', now })).toEqual({ from: '2026-10-19T15:30:00.000Z', to: null })
  })
  it('all (or a bad month) has no bounds', () => {
    expect(periodRange({ period: 'all', now })).toEqual({ from: null, to: null })
    expect(periodRange({ period: 'month', month: 'oops', now })).toEqual({ from: null, to: null })
  })
  it('every row inPeriod accepts falls inside the range', () => {
    const rows = ['2026-10-01T00:00:00', '2026-10-31T23:59:59', '2026-11-01T00:00:00', '2026-09-30T23:59:59'].map((created_at) => ({ created_at }))
    const { from, to } = periodRange({ period: 'month', month: '2026-10', now })
    for (const r of rows) {
      const inRange = r.created_at >= from && r.created_at < to
      expect(inRange).toBe(inPeriod(r, { period: 'month', month: '2026-10', now }))
    }
  })
})
