import { describe, it, expect } from 'vitest'
import { calculateDeadlineWithRule, DEFAULT_BRIEF_RULE } from './services.js'

const CREATED = '2026-01-01T00:00:00Z'
const hoursAfter = (h) => new Date(new Date(CREATED).getTime() + h * 3600 * 1000).toISOString()

describe('calculateDeadlineWithRule', () => {
  it('is table-driven: a custom rule set changes every branch', () => {
    const rule = {
      serious_unexpected_hours: 24,
      serious_expected_days: 7,
      non_serious_unexpected_days: 10,
      non_serious_expected_days: 30,
      safety_signal_days: 1,
    }
    expect(calculateDeadlineWithRule(CREATED, true, false, false, rule).toISOString()).toBe(hoursAfter(24))
    expect(calculateDeadlineWithRule(CREATED, true, true, false, rule).toISOString()).toBe(hoursAfter(7 * 24))
    expect(calculateDeadlineWithRule(CREATED, false, false, false, rule).toISOString()).toBe(hoursAfter(10 * 24))
    expect(calculateDeadlineWithRule(CREATED, false, true, false, rule).toISOString()).toBe(hoursAfter(30 * 24))
    expect(calculateDeadlineWithRule(CREATED, false, true, true, rule).toISOString()).toBe(hoursAfter(24))
  })

  it('ships the brief values only under an explicitly unverified default', () => {
    expect(DEFAULT_BRIEF_RULE.serious_unexpected_hours).toBe(72)
    expect(DEFAULT_BRIEF_RULE.__unverified).toBe(true)
    const d = calculateDeadlineWithRule(CREATED, true, false, false, DEFAULT_BRIEF_RULE)
    expect(d.toISOString()).toBe(hoursAfter(72))
  })
})
