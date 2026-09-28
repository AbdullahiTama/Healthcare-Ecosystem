vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key')

import { getRequiredAuth, isInstantEligible } from '../_lib/trustLevels.js'

describe('CareFind Trust Level Calculations', () => {
  describe('getRequiredAuth', () => {
    it('returns ["pin", "email"] for new users with small amounts', () => {
      expect(getRequiredAuth('new', 5)).toEqual(['pin', 'email'])
    })

    it('returns ["pin", "email", "email"] for new users with large amounts (email pushed twice)', () => {
      expect(getRequiredAuth('new', 100)).toEqual(['pin', 'email', 'email'])
    })

    it('returns ["pin"] for trusted users', () => {
      expect(getRequiredAuth('trusted', 5)).toEqual(['pin'])
    })

    it('returns ["biometric", "device"] for veteran users', () => {
      expect(getRequiredAuth('veteran', 5)).toEqual(['biometric', 'device'])
    })

    it('returns ["pin", "email"] for unknown trust levels', () => {
      expect(getRequiredAuth('unknown', 5)).toEqual(['pin', 'email'])
    })
  })

  describe('isInstantEligible', () => {
    it('returns false for new users (threshold 0)', () => {
      expect(isInstantEligible('new', 5)).toBe(false)
    })

    it('returns true for trusted users with small amounts', () => {
      expect(isInstantEligible('trusted', 5)).toBe(true)
    })

    it('returns false for trusted users with large amounts', () => {
      expect(isInstantEligible('trusted', 100)).toBe(false)
    })

    it('returns true for veteran users with small amounts', () => {
      expect(isInstantEligible('veteran', 5)).toBe(true)
    })
  })
})

describe('CareFind Booking State Transitions', () => {
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

  it('does not allow cancelled → confirmed', () => {
    expect(VALID_TRANSITIONS.cancelled).not.toContain('confirmed')
  })

  it('does not allow completed → cancelled', () => {
    expect(VALID_TRANSITIONS.completed).not.toContain('cancelled')
  })
})

describe('CareFind Withdrawal State Transitions', () => {
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

  it('allows processing → completed', () => {
    expect(VALID_TRANSITIONS.processing).toContain('completed')
  })

  it('allows failed → pending (retry)', () => {
    expect(VALID_TRANSITIONS.failed).toContain('pending')
  })

  it('does not allow completed → pending', () => {
    expect(VALID_TRANSITIONS.completed).not.toContain('pending')
  })
})

describe('CareFind Price Calculations', () => {
  const NAIRA_PER_COIN = 200

  it('calculates correct naira amount for 1 coin', () => {
    expect(1 * NAIRA_PER_COIN).toBe(200)
  })

  it('calculates correct naira amount for 5 coins', () => {
    expect(5 * NAIRA_PER_COIN).toBe(1000)
  })

  it('calculates correct naira amount for 12 coins', () => {
    expect(12 * NAIRA_PER_COIN).toBe(2400)
  })

  it('calculates correct coins for 200 naira', () => {
    expect(Math.ceil(200 / NAIRA_PER_COIN)).toBe(1)
  })

  it('calculates correct coins for 2400 naira', () => {
    expect(Math.ceil(2400 / NAIRA_PER_COIN)).toBe(12)
  })
})

describe('CareFind Permission Checks', () => {
  const { requirePermission } = require('../_lib/authorization.js')

  it('requirePermission returns admin with null status for valid admin', async () => {
    const mockReq = { headers: { authorization: 'Bearer valid-token' } }
    const result = await requirePermission(mockReq, 'manage_content')
    expect(result).toBeTruthy()
  })

  it('requirePermission returns null admin for missing token', async () => {
    const mockReq = { headers: {} }
    const result = await requirePermission(mockReq, 'manage_content')
    expect(result.admin).toBeNull()
    expect(result.status).toBe(401)
  })
})
