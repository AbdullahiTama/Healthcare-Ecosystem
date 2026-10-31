import { describe, it, expect } from 'vitest'
import { periodBounds, presetPeriod, weekOf, monthOf, addDays, isIsoDay, periodDays } from './datePeriods'

describe('datePeriods', () => {
  it('a day is that one date', () => {
    expect(periodBounds({ mode: 'day', date: '2026-10-31' })).toEqual({ from: '2026-10-31', to: '2026-10-31', label: '31 Oct 2026' })
  })

  it('a week runs Monday to Sunday around the chosen day, across a month end', () => {
    // 2026-10-31 is a Saturday.
    expect(weekOf('2026-10-31')).toEqual({ from: '2026-10-26', to: '2026-11-01' })
    expect(weekOf('2026-10-26')).toEqual({ from: '2026-10-26', to: '2026-11-01' })   // Monday
    expect(weekOf('2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' })   // Sunday
    expect(periodBounds({ mode: 'week', date: '2026-10-31' }).label).toBe('Week of 26 Oct 2026 to 1 Nov 2026')
  })

  it('a month ends on its last day, leap years included', () => {
    expect(monthOf('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthOf('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(periodBounds({ mode: 'month', month: '2026-12' })).toEqual({ from: '2026-12-01', to: '2026-12-31', label: 'Dec 2026' })
  })

  it('a year is 1 January to 31 December', () => {
    expect(periodBounds({ mode: 'year', year: '2026' })).toEqual({ from: '2026-01-01', to: '2026-12-31', label: '2026' })
  })

  it('a custom range is put in order and may be open at one end', () => {
    expect(periodBounds({ mode: 'range', from: '2026-10-20', to: '2026-10-01' })).toMatchObject({ from: '2026-10-01', to: '2026-10-20' })
    expect(periodBounds({ mode: 'range', from: '2026-10-01', to: '' })).toEqual({ from: '2026-10-01', to: null, label: 'From 1 Oct 2026' })
    expect(periodBounds({ mode: 'range', from: '', to: '2026-10-01' })).toEqual({ from: null, to: '2026-10-01', label: 'Up to 1 Oct 2026' })
  })

  it('an incomplete or invalid period is all time, never "nothing"', () => {
    for (const p of [null, { mode: 'all' }, { mode: 'day' }, { mode: 'day', date: '2026-02-30' }, { mode: 'month', month: '2026-13' }, { mode: 'range' }, { mode: 'year', year: '26' }]) {
      expect(periodBounds(p)).toEqual({ from: null, to: null, label: 'All time' })
    }
  })

  it('presets resolve against the given today', () => {
    const today = '2026-03-01'
    expect(periodBounds(presetPeriod('yesterday', today))).toMatchObject({ from: '2026-02-28', to: '2026-02-28' })
    expect(periodBounds(presetPeriod('last_month', today))).toMatchObject({ from: '2026-02-01', to: '2026-02-28' })
    expect(periodBounds(presetPeriod('last_month', '2026-01-15'))).toMatchObject({ from: '2025-12-01', to: '2025-12-31' })
    expect(periodBounds(presetPeriod('last_30', today))).toMatchObject({ from: '2026-01-31', to: '2026-03-01' })
    expect(periodBounds(presetPeriod('this_year', today))).toMatchObject({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('date helpers', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(isIsoDay('2026-02-29')).toBe(false)
    expect(isIsoDay('2028-02-29')).toBe(true)
    expect(periodDays({ from: '2026-10-01', to: '2026-10-31' })).toBe(31)
    expect(periodDays({ from: null, to: '2026-10-31' })).toBe(null)
  })
})
