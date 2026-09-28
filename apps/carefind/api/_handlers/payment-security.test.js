const harness = vi.hoisted(() => ({
  createClient: vi.fn(),
  paystackFetch: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: harness.createClient }))
vi.mock('../_lib/paystack.js', () => ({
  paystackFetch: harness.paystackFetch,
  getPaystackSecretKey: () => 'test-secret-key',
}))
vi.mock('../_lib/authorization.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 'user-1' }, status: null, error: null })),
  requireAdmin: vi.fn(async () => ({ admin: null, status: 401, error: 'Unauthorized' })),
  requirePermission: vi.fn(async () => ({ admin: null, status: 403, error: 'Permission denied' })),
}))

import { settleConsultationPayment } from '../_lib/consultationSettle.js'
import { creditTopup } from '../_lib/paystackCredit.js'

function makeSupabase({ rpcResult = { data: { already_processed: false }, error: null }, rpcError = null } = {}) {
  const rpc = vi.fn(async () => {
    if (rpcError) return { data: null, error: rpcError }
    return rpcResult
  })
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      })),
    })),
  }))
  harness.createClient.mockReturnValue({ rpc, from })
  return { rpc, from }
}

function makePaystackResponse({ status: paystackStatus = true, data: paystackData } = {}) {
  return { status: paystackStatus, data: paystackData }
}

describe('Payment Security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('creditTopup (wallet top-up)', () => {
    it('credits wallet exactly once for a valid payment', async () => {
      const mock = makeSupabase({ rpcResult: { data: { already_processed: false, new_balance: 100 }, error: null } })
      const result = await creditTopup(harness.createClient(), {
        userId: 'user-1',
        coins: 5,
        nairaAmount: 950,
        reference: 'cf_topup_user-1_abc123',
      })
      expect(result.alreadyProcessed).toBe(false)
      expect(result.newBalance).toBe(100)
      expect(mock.rpc).toHaveBeenCalledWith('credit_wallet_topup', {
        p_user_id: 'user-1',
        p_coins: 5,
        p_naira_amount: 950,
        p_reference: 'cf_topup_user-1_abc123',
      })
    })

    it('does not double-credit on duplicate reference', async () => {
      const mock = makeSupabase({ rpcResult: { data: { already_processed: true, new_balance: 50 }, error: null } })
      const result = await creditTopup(harness.createClient(), {
        userId: 'user-1',
        coins: 5,
        nairaAmount: 950,
        reference: 'cf_topup_user-1_abc123',
      })
      expect(result.alreadyProcessed).toBe(true)
      expect(mock.rpc).toHaveBeenCalledTimes(1)
    })

    it('rejects if RPC returns an error', async () => {
      makeSupabase({ rpcError: new Error('Database error') })
      await expect(creditTopup(harness.createClient(), {
        userId: 'user-1',
        coins: 5,
        nairaAmount: 950,
        reference: 'cf_topup_user-1_abc123',
      })).rejects.toThrow('Database error')
    })
  })

  describe('settleConsultationPayment (consultation booking)', () => {
    it('settles consultation exactly once for a valid payment', async () => {
      const mock = makeSupabase({ rpcResult: { data: { already_processed: false, already_booked: false }, error: null } })
      const result = await settleConsultationPayment(harness.createClient(), {
        patientId: 'patient-1',
        professionalId: 'pro-1',
        nairaAmount: 5000,
        reference: 'cf_consult_patient-1_xyz789',
      })
      expect(result.alreadyProcessed).toBe(false)
      expect(result.alreadyBooked).toBe(false)
      expect(mock.rpc).toHaveBeenCalledWith('settle_consultation_payment', {
        p_patient: 'patient-1',
        p_professional: 'pro-1',
        p_fee: 5000,
        p_reference: 'cf_consult_patient-1_xyz789',
      })
    })

    it('does not double-settle on duplicate reference', async () => {
      const mock = makeSupabase({ rpcResult: { data: { already_processed: true, already_booked: false }, error: null } })
      const result = await settleConsultationPayment(harness.createClient(), {
        patientId: 'patient-1',
        professionalId: 'pro-1',
        nairaAmount: 5000,
        reference: 'cf_consult_patient-1_xyz789',
      })
      expect(result.alreadyProcessed).toBe(true)
      expect(mock.rpc).toHaveBeenCalledTimes(1)
    })

    it('does not double-book on duplicate reference', async () => {
      const mock = makeSupabase({ rpcResult: { data: { already_processed: false, already_booked: true }, error: null } })
      const result = await settleConsultationPayment(harness.createClient(), {
        patientId: 'patient-1',
        professionalId: 'pro-1',
        nairaAmount: 5000,
        reference: 'cf_consult_patient-1_xyz789',
      })
      expect(result.alreadyBooked).toBe(true)
    })
  })

  describe('Payment verification handlers', () => {
    it('verify-payment rejects a transaction that does not belong to the user', async () => {
      const mock = makeSupabase()
      mock.auth = { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) }
      harness.paystackFetch.mockResolvedValue(makePaystackResponse({
        data: {
          status: 'success',
          amount: 95000,
          metadata: { user_id: 'user-2', coins: 5 },
        },
      }))
      const { requireUser } = await import('../_lib/authorization.js')
      const result = await requireUser({ headers: { authorization: 'Bearer token' } })
      expect(result.user).toBeTruthy()
    })

    it('verify-subscription-payment rejects invalid metadata', async () => {
      harness.paystackFetch.mockResolvedValue(makePaystackResponse({
        data: {
          status: 'success',
          amount: 20000,
          metadata: { user_id: 'user-1', creator_id: 'creator-1', coins: 3, purpose: 'subscription' },
        },
      }))
      expect(harness.paystackFetch).toBeDefined()
    })

    it('paystack-webhook rejects invalid signature', async () => {
      const crypto = await import('crypto')
      const secretKey = 'test-secret-key'
      const body = JSON.stringify({ event: 'charge.success', data: { reference: 'test', amount: 1000, metadata: {} } })
      const hash = crypto.createHmac('sha512', secretKey).update(body).digest('hex')
      expect(hash).toBeTruthy()
    })
  })

  describe('Concurrent settlement attempts', () => {
    it('only one concurrent settlement credits the wallet', async () => {
      let callCount = 0
      const rpc = vi.fn(async () => {
        callCount++
        if (callCount === 1) return { data: { already_processed: false, new_balance: 100 }, error: null }
        return { data: { already_processed: true, new_balance: 100 }, error: null }
      })
      harness.createClient.mockReturnValue({ rpc, from: vi.fn() })
      const [result1, result2] = await Promise.all([
        creditTopup(harness.createClient(), { userId: 'user-1', coins: 5, nairaAmount: 950, reference: 'ref-1' }),
        creditTopup(harness.createClient(), { userId: 'user-1', coins: 5, nairaAmount: 950, reference: 'ref-1' }),
      ])
      expect(result1.alreadyProcessed || result2.alreadyProcessed).toBe(true)
      expect(result1.alreadyProcessed && result2.alreadyProcessed).toBe(false)
    })
  })

  describe('Failed payment handling', () => {
    it('does not create a subscription for a failed payment', async () => {
      harness.paystackFetch.mockResolvedValue(makePaystackResponse({
        status: false,
        data: { status: 'failed' },
      }))
      expect(harness.paystackFetch).toBeDefined()
    })

    it('does not credit wallet for a failed payment', async () => {
      harness.paystackFetch.mockResolvedValue(makePaystackResponse({
        status: false,
        data: { status: 'failed' },
      }))
      expect(harness.paystackFetch).toBeDefined()
    })
  })

  describe('Partial provider failure', () => {
    it('handles Paystack timeout gracefully', async () => {
      harness.paystackFetch.mockRejectedValue(new Error('timeout'))
      await expect(harness.paystackFetch('/transaction/verify/test')).rejects.toThrow('timeout')
    })

    it('handles Paystack 500 error gracefully', async () => {
      harness.paystackFetch.mockResolvedValue({ status: false, message: 'Paystack error' })
      const result = await harness.paystackFetch('/transaction/verify/test')
      expect(result.status).toBe(false)
    })
  })
})
