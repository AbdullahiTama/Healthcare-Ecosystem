import { describe, it, expect } from 'vitest'
import { reminderStage, reminderKey } from '../planReminders.js'

const NOW = new Date('2026-10-27T08:00:00Z')
const at = (days) => new Date(NOW.getTime() + days * 864e5).toISOString()
const stage = (expiresInDays, startedDaysAgo = null) =>
  reminderStage({ expiresAt: at(expiresInDays), enforcementStartedAt: startedDaysAgo == null ? null : at(-startedDaysAgo), now: NOW })?.stage ?? null

describe('reminderStage', () => {
  it('counts down 14, 7, 3 and 1 day before expiry, and is silent before that', () => {
    expect(stage(30)).toBeNull()
    expect(stage(14)).toBe('before_14')
    expect(stage(8)).toBe('before_14')
    expect(stage(7)).toBe('before_7')
    expect(stage(3)).toBe('before_3')
    expect(stage(1)).toBe('before_1')
    expect(stage(0.2)).toBe('before_1')
  })

  it('after expiry: expired, mid-grace, last day of grace, then weekly while restricted', () => {
    expect(stage(-0.5, 100)).toBe('expired')
    expect(stage(-4, 100)).toBe('grace_mid')
    expect(stage(-6.5, 100)).toBe('grace_last')
    expect(stage(-8, 100)).toBe('restricted_w0')
    expect(stage(-15, 100)).toBe('restricted_w1')
    expect(stage(-7 - 7 * 9, 400)).toBe('restricted_m2')
  })

  it('a business already expired when restrictions were switched on gets the full grace period from that moment', () => {
    const due = reminderStage({ expiresAt: at(-70), enforcementStartedAt: at(0), now: NOW })
    expect(due).toMatchObject({ stage: 'expired', templateStage: 'expired' })
    expect(due.graceEndsAt).toBe(at(7))
  })

  it('before restrictions are switched on, an expired plan gets plain weekly reminders', () => {
    expect(reminderStage({ expiresAt: at(-1), now: NOW })).toMatchObject({ stage: 'lapsed_w0', templateStage: 'lapsed', graceEndsAt: null })
    expect(stage(-20)).toBe('lapsed_w2')
  })

  it('nothing for a missing or unreadable expiry; keys are per business, plan period and stage', () => {
    expect(reminderStage({ expiresAt: null, now: NOW })).toBeNull()
    expect(reminderStage({ expiresAt: 'not a date', now: NOW })).toBeNull()
    expect(reminderKey('b1', '2026-11-01T00:00:00Z', 'before_7')).toBe('plan_reminder:b1:2026-11-01:before_7')
  })
})
