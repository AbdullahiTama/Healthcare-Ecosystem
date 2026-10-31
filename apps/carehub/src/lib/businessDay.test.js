import { describe, it, expect, afterEach } from 'vitest'
import {
  BUSINESS_TZ, businessDate, businessDateOf, businessTime, businessDateTime, businessPeriod,
  startOfBusinessDate, msUntilNextBusinessDay, parseDbTime,
} from './businessDay'

// Lagos is UTC+1 all year. An instant at a given Lagos wall-clock time:
const lagos = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h - 1, min))

describe('the business day is Lagos time', () => {
  it('is Africa/Lagos', () => {
    expect(BUSINESS_TZ).toBe('Africa/Lagos')
  })

  it('00:00, 00:59 and 23:59 Lagos time all belong to the same Lagos date', () => {
    expect(businessDate(lagos(2026, 10, 31, 0, 0))).toBe('2026-10-31')
    expect(businessDate(lagos(2026, 10, 31, 0, 59))).toBe('2026-10-31')
    expect(businessDate(lagos(2026, 10, 31, 23, 59))).toBe('2026-10-31')
    // 23:30 UTC is already the next day in Lagos: the hour the UTC cut got wrong.
    expect(businessDate(new Date('2026-10-30T23:30:00Z'))).toBe('2026-10-31')
  })

  it("today's window runs Lagos midnight to Lagos midnight at every hour of the day", () => {
    for (const [h, min] of [[0, 0], [0, 59], [12, 0], [23, 59]]) {
      expect(businessPeriod('today', { now: lagos(2026, 10, 31, h, min) }))
        .toEqual({ start: lagos(2026, 10, 31), end: lagos(2026, 11, 1) })
    }
  })

  it('weeks run Monday to Sunday; months and years roll over', () => {
    // Saturday 31 Oct 2026.
    expect(businessPeriod('week', { now: lagos(2026, 10, 31, 9) })).toEqual({ start: lagos(2026, 10, 26), end: lagos(2026, 11, 2) })
    expect(businessPeriod('month', { now: lagos(2026, 12, 15) })).toEqual({ start: lagos(2026, 12, 1), end: lagos(2027, 1, 1) })
    expect(businessPeriod('month', { month: '2026-02' })).toEqual({ start: lagos(2026, 2, 1), end: lagos(2026, 3, 1) })
    expect(businessPeriod('month', { month: '' })).toBeNull()
    expect(businessPeriod('year', { now: lagos(2026, 6, 1) })).toEqual({ start: lagos(2026, 1, 1), end: lagos(2027, 1, 1) })
  })

  it('custom ranges are inclusive and refuse reversed or impossible dates', () => {
    expect(businessPeriod('custom', { from: '2026-10-30', to: '2026-10-31' })).toEqual({ start: lagos(2026, 10, 30), end: lagos(2026, 11, 1) })
    expect(businessPeriod('custom', { from: '2026-10-31', to: '2026-10-30' })).toBeNull()
    expect(businessPeriod('custom', { from: '2026-02-30', to: '2026-03-01' })).toBeNull()
    expect(businessPeriod('nonsense')).toBeNull()
  })

  it('normalises out-of-range days when finding a midnight', () => {
    expect(startOfBusinessDate(2026, 10, 32)).toEqual(lagos(2026, 11, 1))
    expect(startOfBusinessDate(2026, 1, 0)).toEqual(lagos(2025, 12, 31))
  })

  it('counts down to the next Lagos midnight', () => {
    expect(msUntilNextBusinessDay(lagos(2026, 10, 31, 23, 0))).toBe(60 * 60 * 1000)
  })
})

describe('the device zone does not matter', () => {
  const original = process.env.TZ
  afterEach(() => { process.env.TZ = original })

  it('gives the same window on a device set to New York, Tokyo or UTC', () => {
    const now = new Date('2026-10-30T23:30:00Z') // 00:30 on the 31st in Lagos
    const results = ['America/New_York', 'Asia/Tokyo', 'UTC'].map((tz) => {
      process.env.TZ = tz
      return { day: businessDate(now), today: businessPeriod('today', { now }), week: businessPeriod('week', { now }) }
    })
    for (const r of results) expect(r).toEqual(results[0])
    expect(results[0].day).toBe('2026-10-31')
  })
})

describe('reading stored values', () => {
  it('reads a zone-less database time as UTC', () => {
    expect(parseDbTime('2026-10-30T23:30:00').toISOString()).toBe('2026-10-30T23:30:00.000Z')
    expect(parseDbTime('2026-10-30T23:30:00+00:00').toISOString()).toBe('2026-10-30T23:30:00.000Z')
    expect(parseDbTime('garbage')).toBeNull()
    expect(parseDbTime(null)).toBeNull()
  })

  it('places a database time on its Lagos date and clock', () => {
    expect(businessDateOf('2026-10-30T23:30:00')).toBe('2026-10-31')
    expect(businessTime('2026-10-30T23:30:00')).toBe('00:30')
    expect(businessDateTime('2026-09-29T10:20:00')).toBe('2026-09-29 11:20')
  })

  it('keeps a bare date (an expense or supply date) as written', () => {
    expect(businessDateOf('2026-10-30')).toBe('2026-10-30')
    expect(businessDateOf('')).toBe('')
    expect(businessDateOf(null)).toBe('')
    expect(businessTime(null)).toBe('')
  })
})
