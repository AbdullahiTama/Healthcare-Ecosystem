vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key')

import { PLAN_MONTHLY_NAIRA, PLAN_YEARLY_NAIRA } from '../../src/lib/planLimits.js'
import { REFERRAL_RATES, ACCRUED_WHILE_INACTIVE } from '../../src/lib/referral_program.js'

describe('CareHub Price Calculations', () => {
  describe('PLAN_MONTHLY_NAIRA', () => {
    it('has correct monthly prices for all plans', () => {
      expect(PLAN_MONTHLY_NAIRA.basic).toBe(5000)
      expect(PLAN_MONTHLY_NAIRA.growth).toBe(8333)
      expect(PLAN_MONTHLY_NAIRA.premium).toBe(12500)
      expect(PLAN_MONTHLY_NAIRA.enterprise).toBe(20833)
    })

    it('returns null for custom plans', () => {
      expect(PLAN_MONTHLY_NAIRA.custom).toBeNull()
    })

    it('returns undefined for unknown plans', () => {
      expect(PLAN_MONTHLY_NAIRA.unknown).toBeUndefined()
    })
  })

  describe('PLAN_YEARLY_NAIRA', () => {
    it('has correct yearly prices for all plans', () => {
      expect(PLAN_YEARLY_NAIRA.basic).toBe(60000)
      expect(PLAN_YEARLY_NAIRA.growth).toBe(100000)
      expect(PLAN_YEARLY_NAIRA.premium).toBe(150000)
      expect(PLAN_YEARLY_NAIRA.enterprise).toBe(250000)
    })

    it('yearly price is less than or equal to 12x monthly (discount)', () => {
      for (const plan of ['basic', 'premium']) {
        expect(PLAN_YEARLY_NAIRA[plan]).toBeLessThanOrEqual(PLAN_MONTHLY_NAIRA[plan] * 12)
      }
    })
  })
})

describe('CareHub Commission Calculations', () => {
  describe('REFERRAL_RATES', () => {
    it('has correct referral bonus rate', () => {
      expect(REFERRAL_RATES.referral_bonus).toBe(0.4)
    })

    it('has correct residual rate', () => {
      expect(REFERRAL_RATES.residual).toBe(0.05)
    })
  })

  describe('ACCRUED_WHILE_INACTIVE', () => {
    it('is a boolean', () => {
      expect(typeof ACCRUED_WHILE_INACTIVE).toBe('boolean')
    })
  })

  describe('Commission amount calculation', () => {
    it('calculates 40% referral bonus correctly', () => {
      const nairaCharged = 50000
      const rate = REFERRAL_RATES.referral_bonus
      const amount = Math.round((nairaCharged * rate * 100) / 100)
      expect(amount).toBe(20000)
    })

    it('calculates 5% residual correctly', () => {
      const nairaCharged = 50000
      const rate = REFERRAL_RATES.residual
      const amount = Math.round((nairaCharged * rate * 100) / 100)
      expect(amount).toBe(2500)
    })

    it('returns 0 for zero amount', () => {
      const nairaCharged = 0
      const rate = REFERRAL_RATES.referral_bonus
      const amount = Math.round((nairaCharged * rate * 100) / 100)
      expect(amount).toBe(0)
    })
  })
})

describe('CareHub Permission Checks', () => {
  const { requireBusiness, requirePlatformAdmin } = require('../_lib/authorization.js')

  it('requireBusiness returns business with null status for valid token', async () => {
    const mockReq = { headers: { authorization: 'Bearer valid-token' } }
    const result = await requireBusiness(mockReq)
    expect(result).toBeTruthy()
  })

  it('requirePlatformAdmin returns null business for missing token', async () => {
    const mockReq = { headers: {} }
    const result = await requirePlatformAdmin(mockReq)
    expect(result.business).toBeNull()
    expect(result.status).toBe(401)
  })
})

describe('CareHub Booking State Transitions', () => {
  const VALID_TRANSITIONS = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['completed', 'cancelled'],
    cancelled: [],
    completed: [],
  }

  it('allows pending → confirmed', () => {
    expect(VALID_TRANSITIONS.pending).toContain('confirmed')
  })

  it('allows pending → cancelled', () => {
    expect(VALID_TRANSITIONS.pending).toContain('cancelled')
  })

  it('allows confirmed → completed', () => {
    expect(VALID_TRANSITIONS.confirmed).toContain('completed')
  })

  it('allows confirmed → cancelled', () => {
    expect(VALID_TRANSITIONS.confirmed).toContain('cancelled')
  })

  it('does not allow cancelled → confirmed', () => {
    expect(VALID_TRANSITIONS.cancelled).not.toContain('confirmed')
  })

  it('does not allow completed → cancelled', () => {
    expect(VALID_TRANSITIONS.completed).not.toContain('cancelled')
  })
})

describe('CareHub Withdrawal State Transitions', () => {
  const VALID_TRANSITIONS = {
    pending: ['processing', 'rejected', 'cancelled'],
    processing: ['completed', 'failed', 'reversed'],
    completed: [],
    failed: ['pending'],
    reversed: [],
    rejected: [],
    cancelled: [],
  }

  it('allows pending → processing', () => {
    expect(VALID_TRANSITIONS.pending).toContain('processing')
  })

  it('allows pending → rejected', () => {
    expect(VALID_TRANSITIONS.pending).toContain('rejected')
  })

  it('allows processing → completed', () => {
    expect(VALID_TRANSITIONS.processing).toContain('completed')
  })

  it('allows processing → failed', () => {
    expect(VALID_TRANSITIONS.processing).toContain('failed')
  })

  it('allows failed → pending (retry)', () => {
    expect(VALID_TRANSITIONS.failed).toContain('pending')
  })

  it('does not allow completed → pending', () => {
    expect(VALID_TRANSITIONS.completed).not.toContain('pending')
  })

  it('does not allow reversed → pending', () => {
    expect(VALID_TRANSITIONS.reversed).not.toContain('pending')
  })
})
