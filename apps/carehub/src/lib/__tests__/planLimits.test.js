import { describe, it, expect } from 'vitest'
import { PLAN_LIMITS, PLAN_LABELS, PLAN_MONTHLY_NAIRA, PLAN_YEARLY_NAIRA, planLimitsFor, isPlanAllowedForBusinessType, getMinPlanForBusinessType } from '../planLimits.js'

describe('plan limits', () => {
  it('caps basic at 5 staff, 2 locations and 5000 products', () => {
    const limits = planLimitsFor('basic')
    expect(limits.maxStaff).toBe(5)
    expect(limits.maxLocations).toBe(2)
    expect(limits.maxProducts).toBe(5000)
  })

  it('gives growth unlimited staff/products but 5 locations', () => {
    const limits = planLimitsFor('growth')
    expect(limits.maxStaff).toBe(Infinity)
    expect(limits.maxLocations).toBe(5)
    expect(limits.maxProducts).toBe(Infinity)
  })

  it('gives premium 10 locations', () => {
    expect(planLimitsFor('premium').maxLocations).toBe(10)
    expect(planLimitsFor('premium').maxStaff).toBe(Infinity)
  })

  it('gives enterprise 30 locations', () => {
    expect(planLimitsFor('enterprise').maxLocations).toBe(30)
  })

  it('gives custom unlimited everything', () => {
    const l = planLimitsFor('custom')
    expect(l.maxStaff).toBe(Infinity)
    expect(l.maxLocations).toBe(Infinity)
    expect(l.maxProducts).toBe(Infinity)
  })

  it('keeps hospital mapped to growth limits for backward compat', () => {
    expect(planLimitsFor('hospital')).toEqual(planLimitsFor('growth'))
  })

  it('falls back to the basic plan for an unknown plan name', () => {
    expect(planLimitsFor('whatever')).toEqual(PLAN_LIMITS.basic)
    expect(planLimitsFor(undefined)).toEqual(PLAN_LIMITS.basic)
  })

  it('blocks Basic for hospitals, allows Growth+', () => {
    expect(isPlanAllowedForBusinessType('basic', 'hospital')).toBe(false)
    expect(isPlanAllowedForBusinessType('growth', 'hospital')).toBe(true)
    expect(isPlanAllowedForBusinessType('premium', 'hospital')).toBe(true)
    expect(getMinPlanForBusinessType('hospital')).toBe('growth')
    expect(getMinPlanForBusinessType('pharmacy')).toBe('basic')
  })
})

describe('plan pricing', () => {
  it('defines yearly naira price per brief', () => {
    expect(PLAN_YEARLY_NAIRA.basic).toBe(60000)
    expect(PLAN_YEARLY_NAIRA.growth).toBe(100000)
    expect(PLAN_YEARLY_NAIRA.premium).toBe(150000)
    expect(PLAN_YEARLY_NAIRA.enterprise).toBe(250000)
    expect(PLAN_YEARLY_NAIRA.custom).toBeNull()
  })

  it('derives monthly as yearly/12', () => {
    expect(PLAN_MONTHLY_NAIRA.basic).toBe(5000)
    expect(PLAN_MONTHLY_NAIRA.growth).toBe(Math.round(100000 / 12))
    expect(PLAN_MONTHLY_NAIRA.premium).toBe(Math.round(150000 / 12))
    expect(PLAN_MONTHLY_NAIRA.enterprise).toBe(Math.round(250000 / 12))
  })

  it('labels every plan for display', () => {
    for (const plan of ['basic','growth','premium','enterprise','custom']) {
      expect(PLAN_LABELS[plan], `${plan} label`).toBeTruthy()
    }
  })
})
