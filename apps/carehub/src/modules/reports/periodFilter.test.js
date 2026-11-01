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
    // now is Friday 23 Oct; this week is Mon 19 to Sun 25 Oct.
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
  // 15:30 UTC = 16:30 Lagos, Monday 26 Oct 2026. Bounds are Lagos midnights as UTC instants.
  const now = new Date('2026-10-26T15:30:00Z')
  it('today is the Lagos business day', () => {
    expect(periodRange({ period: 'today', now })).toEqual({ from: '2026-10-25T23:00:00.000Z', to: '2026-10-26T23:00:00.000Z' })
  })
  it('month is the chosen month, December rolls the year', () => {
    expect(periodRange({ period: 'month', month: '2026-10', now })).toEqual({ from: '2026-09-30T23:00:00.000Z', to: '2026-10-31T23:00:00.000Z' })
    expect(periodRange({ period: 'month', month: '2026-12', now })).toEqual({ from: '2026-11-30T23:00:00.000Z', to: '2026-12-31T23:00:00.000Z' })
  })
  it('year is the current year; week runs Monday to Sunday, as in Sales & Accounts', () => {
    expect(periodRange({ period: 'year', now })).toEqual({ from: '2025-12-31T23:00:00.000Z', to: '2026-12-31T23:00:00.000Z' })
    expect(periodRange({ period: 'week', now })).toEqual({ from: '2026-10-25T23:00:00.000Z', to: '2026-11-01T23:00:00.000Z' })
  })
  it('all (or a bad month) has no bounds', () => {
    expect(periodRange({ period: 'all', now })).toEqual({ from: null, to: null })
    expect(periodRange({ period: 'month', month: 'oops', now })).toEqual({ from: null, to: null })
  })
  it('every row inPeriod accepts falls inside the range, at the Lagos midnight edges', () => {
    // Zone-less database times are UTC: 23:00 on 30 Sep is 00:00 on 1 Oct in Lagos.
    const rows = ['2026-09-30T22:59:59', '2026-09-30T23:00:00', '2026-10-31T22:59:59', '2026-10-31T23:00:00'].map((created_at) => ({ created_at }))
    const { from, to } = periodRange({ period: 'month', month: '2026-10', now })
    const accepted = rows.map((r) => inPeriod(r, { period: 'month', month: '2026-10', now }))
    expect(accepted).toEqual([false, true, true, false])
    for (const r of rows) {
      const t = new Date(r.created_at + 'Z').toISOString()
      expect(t >= from && t < to).toBe(inPeriod(r, { period: 'month', month: '2026-10', now }))
    }
  })
  it('a bare date (an expense date) is a business date as written', () => {
    expect(inPeriod({ date: '2026-10-26' }, { period: 'today', now, dateOf: (e) => e.date })).toBe(true)
    expect(inPeriod({ date: '2026-10-25' }, { period: 'today', now, dateOf: (e) => e.date })).toBe(false)
  })
})
