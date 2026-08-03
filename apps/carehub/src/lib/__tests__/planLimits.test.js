import { describe, it, expect } from 'vitest'
import { PLAN_LIMITS, PLAN_LABELS, PLAN_MONTHLY_NAIRA, planLimitsFor } from '../planLimits.js'

describe('plan limits', () => {
  it('caps basic at 5 staff and 1 location', () => {
    const limits = planLimitsFor('basic')
    expect(limits.maxStaff).toBe(5)
    expect(limits.maxLocations).toBe(1)
  })

  it('gives growth unlimited staff but 5 locations', () => {
    const limits = planLimitsFor('growth')
    expect(limits.maxStaff).toBe(Infinity)
    expect(limits.maxLocations).toBe(5)
  })

  it('keeps hospital on a single location with unlimited staff', () => {
    const limits = planLimitsFor('hospital')
    expect(limits.maxStaff).toBe(Infinity)
    expect(limits.maxLocations).toBe(1)
  })

  it('gives enterprise unlimited everything', () => {
    const limits = planLimitsFor('enterprise')
    expect(limits.maxStaff).toBe(Infinity)
    expect(limits.maxLocations).toBe(Infinity)
  })

  it('falls back to the basic plan for an unknown plan name', () => {
    expect(planLimitsFor('whatever')).toEqual(PLAN_LIMITS.basic)
    expect(planLimitsFor(undefined)).toEqual(PLAN_LIMITS.basic)
  })
})

describe('plan pricing', () => {
  it('defines a positive monthly naira price for every plan', () => {
    for (const plan of Object.keys(PLAN_LIMITS)) {
      expect(PLAN_MONTHLY_NAIRA[plan], `${plan} pricing`).toBeGreaterThan(0)
    }
  })

  it('labels every plan for display', () => {
    for (const plan of Object.keys(PLAN_LIMITS)) {
      expect(PLAN_LABELS[plan], `${plan} label`).toBeTruthy()
    }
  })
})