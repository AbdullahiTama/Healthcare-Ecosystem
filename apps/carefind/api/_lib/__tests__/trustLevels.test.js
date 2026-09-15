import { describe, it, expect } from 'vitest'
import {
  TRUST_LEVELS,
  getRequiredAuth,
  isInstantEligible,
  getTrustDescription,
} from '../trustLevels.js'

describe('TRUST_LEVELS shape', () => {
  it('has new, trusted, and veteran keys', () => {
    expect(Object.keys(TRUST_LEVELS)).toEqual(['new', 'trusted', 'veteran'])
  })

  it('each level has the required fields', () => {
    for (const key of ['new', 'trusted', 'veteran']) {
      const level = TRUST_LEVELS[key]
      expect(level).toHaveProperty('minWithdrawals')
      expect(level).toHaveProperty('maxWithdrawals')
      expect(level).toHaveProperty('minConsecutiveSuccess')
      expect(level).toHaveProperty('instantThreshold')
      expect(level).toHaveProperty('requiredAuth')
      expect(level).toHaveProperty('label')
      expect(Array.isArray(level.requiredAuth)).toBe(true)
      expect(level.requiredAuth.length).toBeGreaterThan(0)
    }
  })
})

describe('getRequiredAuth', () => {
  it('returns pin and email for new level', () => {
    expect(getRequiredAuth('new')).toEqual(['pin', 'email'])
  })

  it('returns pin for trusted level', () => {
    expect(getRequiredAuth('trusted')).toEqual(['pin'])
  })

  it('returns biometric and device for veteran level', () => {
    expect(getRequiredAuth('veteran')).toEqual(['biometric', 'device'])
  })

  it('adds email for new level when amount > 10', () => {
    const auth = getRequiredAuth('new', 15)
    expect(auth).toContain('email')
    expect(auth.length).toBe(3)
  })

  it('does not duplicate email for new level when amount <= 10', () => {
    const auth = getRequiredAuth('new', 5)
    expect(auth).toEqual(['pin', 'email'])
  })

  it('defaults to new behavior for unknown trust level', () => {
    expect(getRequiredAuth('unknown')).toEqual(['pin', 'email'])
  })
})

describe('isInstantEligible', () => {
  it('returns false for new level regardless of amount', () => {
    expect(isInstantEligible('new', 0)).toBe(false)
    expect(isInstantEligible('new', 5)).toBe(false)
    expect(isInstantEligible('new', 100)).toBe(false)
  })

  it('returns true for trusted level when amount <= 20', () => {
    expect(isInstantEligible('trusted', 0)).toBe(true)
    expect(isInstantEligible('trusted', 10)).toBe(true)
    expect(isInstantEligible('trusted', 20)).toBe(true)
  })

  it('returns false for trusted level when amount > 20', () => {
    expect(isInstantEligible('trusted', 21)).toBe(false)
    expect(isInstantEligible('trusted', 100)).toBe(false)
  })

  it('returns true for veteran level when amount <= 50', () => {
    expect(isInstantEligible('veteran', 0)).toBe(true)
    expect(isInstantEligible('veteran', 25)).toBe(true)
    expect(isInstantEligible('veteran', 50)).toBe(true)
  })

  it('returns false for veteran level when amount > 50', () => {
    expect(isInstantEligible('veteran', 51)).toBe(false)
    expect(isInstantEligible('veteran', 200)).toBe(false)
  })

  it('defaults to new behavior for unknown trust level', () => {
    expect(isInstantEligible('unknown', 5)).toBe(false)
  })
})

describe('getTrustDescription', () => {
  it('returns a non-empty string for new level', () => {
    const desc = getTrustDescription('new')
    expect(typeof desc).toBe('string')
    expect(desc.length).toBeGreaterThan(0)
  })

  it('returns a non-empty string for trusted level', () => {
    const desc = getTrustDescription('trusted')
    expect(typeof desc).toBe('string')
    expect(desc.length).toBeGreaterThan(0)
    expect(desc).toContain('20')
  })

  it('returns a non-empty string for veteran level', () => {
    const desc = getTrustDescription('veteran')
    expect(typeof desc).toBe('string')
    expect(desc.length).toBeGreaterThan(0)
    expect(desc).toContain('50')
  })

  it('defaults to new data for unknown trust level', () => {
    const desc = getTrustDescription('unknown')
    expect(typeof desc).toBe('string')
    expect(desc.length).toBeGreaterThan(0)
    expect(desc).toContain('0')
  })
})
