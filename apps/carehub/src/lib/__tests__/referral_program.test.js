import { describe, it, expect } from 'vitest'
import {
  REFERRAL_RATES,
  ACCRUED_WHILE_INACTIVE,
  REFERRAL_CODE_PREFIX,
  generateReferralCode,
} from '../referral_program.js'

describe('referral money rules', () => {
  it('pays a 40% one-time bonus on the first payment', () => {
    expect(REFERRAL_RATES.referral_bonus).toBe(0.40)
  })

  it('pays a 5% recurring residual on later payments', () => {
    expect(REFERRAL_RATES.residual).toBe(0.05)
  })

  it('does not accrue commissions while an agent is inactive (safe default)', () => {
    expect(ACCRUED_WHILE_INACTIVE).toBe(false)
  })
})

describe('referral codes', () => {
  it('uses the CH prefix', () => {
    expect(REFERRAL_CODE_PREFIX).toBe('CH')
  })

  it('generates a CH-XXXXXX code', () => {
    expect(generateReferralCode()).toMatch(/^CH-[A-Z0-9]{6}$/)
  })

  it('generates different codes on consecutive calls', () => {
    expect(generateReferralCode()).not.toBe(generateReferralCode())
  })

  it('never generates an empty suffix', () => {
    expect(generateReferralCode()).not.toBe('CH-')
  })
})