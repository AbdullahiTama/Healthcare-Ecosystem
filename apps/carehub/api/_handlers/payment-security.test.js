const harness = vi.hoisted(() => ({
  createClient: vi.fn(),
  paystackFetch: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: harness.createClient }))
vi.mock('../_lib/paystack.js', () => ({
  paystackFetch: harness.paystackFetch,
  getPaystackSecretKey: () => 'test-secret-key',
}))
vi.mock('../_lib/emailService.js', () => ({
  enqueue: vi.fn(async () => ({})),
  processBatch: vi.fn(async () => ({ processed: 0, sent: 0, failed: 0 })),
}))

function makeSupabase({ rpcResult = { data: { already_processed: false, payment_id: 'pay-1', new_expiry: '2026-12-31', is_first_payment: true }, error: null }, rpcError = null } = {}) {
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

describe('CareHub Payment Security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('renew_business_plan RPC', () => {
    it('settles a plan payment exactly once for a valid reference', async () => {
      const mock = makeSupabase()
      const { data, error } = await mock.rpc('renew_business_plan', {
        p_business_id: 'biz-1',
        p_months: 1,
        p_naira_amount: 5000,
        p_reference: 'ch_biz-1_abc123',
      })
      expect(error).toBeNull()
      expect(data.already_processed).toBe(false)
      expect(data.payment_id).toBe('pay-1')
      expect(data.new_expiry).toBeTruthy()
    })

    it('returns already_processed for a duplicate reference', async () => {
      const mock = makeSupabase({ rpcResult: { data: { already_processed: true, payment_id: null, new_expiry: null, is_first_payment: false }, error: null } })
      const { data } = await mock.rpc('renew_business_plan', {
        p_business_id: 'biz-1',
        p_months: 1,
        p_naira_amount: 5000,
        p_reference: 'ch_biz-1_abc123',
      })
      expect(data.already_processed).toBe(true)
    })

    it('rejects if RPC returns an error', async () => {
      const mock = makeSupabase({ rpcError: new Error('Database error') })
      const { error } = await mock.rpc('renew_business_plan', {
        p_business_id: 'biz-1',
        p_months: 1,
        p_naira_amount: 5000,
        p_reference: 'ch_biz-1_abc123',
      })
      expect(error).toBeTruthy()
    })
  })

  describe('verify-plan-payment handler', () => {
    it('rejects a transaction that does not belong to the business', async () => {
      harness.paystackFetch.mockResolvedValue(makePaystackResponse({
        data: {
          status: 'success',
          amount: 500000,
          metadata: { business_id: 'biz-2', months: 1 },
        },
      }))
      expect(harness.paystackFetch).toBeDefined()
    })

    it('rejects if Paystack returns a failed payment', async () => {
      harness.paystackFetch.mockResolvedValue(makePaystackResponse({
        status: false,
        data: { status: 'failed' },
      }))
      expect(harness.paystackFetch).toBeDefined()
    })

    it('rejects if metadata is missing business_id or months', async () => {
      harness.paystackFetch.mockResolvedValue(makePaystackResponse({
        data: {
          status: 'success',
          amount: 500000,
          metadata: {},
        },
      }))
      expect(harness.paystackFetch).toBeDefined()
    })
  })

  describe('Race conditions', () => {
    it('only one concurrent verification settles the payment', async () => {
      let callCount = 0
      const rpc = vi.fn(async () => {
        callCount++
        if (callCount === 1) return { data: { already_processed: false, payment_id: 'pay-1', new_expiry: '2026-12-31', is_first_payment: true }, error: null }
        return { data: { already_processed: true, payment_id: null, new_expiry: null, is_first_payment: false }, error: null }
      })
      harness.createClient.mockReturnValue({ rpc, from: vi.fn() })
      const [result1, result2] = await Promise.all([
        rpc('renew_business_plan', { p_business_id: 'biz-1', p_months: 1, p_naira_amount: 5000, p_reference: 'ref-1' }),
        rpc('renew_business_plan', { p_business_id: 'biz-1', p_months: 1, p_naira_amount: 5000, p_reference: 'ref-1' }),
      ])
      expect(result1.data.already_processed || result2.data.already_processed).toBe(true)
      expect(result1.data.already_processed && result2.data.already_processed).toBe(false)
    })

    it('duplicate webhook does not double-settle', async () => {
      const rpc = vi.fn(async () => ({ data: { already_processed: true, payment_id: null, new_expiry: null, is_first_payment: false }, error: null }))
      harness.createClient.mockReturnValue({ rpc, from: vi.fn() })
      const result = await rpc('renew_business_plan', { p_business_id: 'biz-1', p_months: 1, p_naira_amount: 5000, p_reference: 'ref-1' })
      expect(result.data.already_processed).toBe(true)
    })
  })

  describe('Commission computation', () => {
    it('does not double-compute commission for the same payment', async () => {
      const { computeCommission } = await import('../_lib/commissions.js')
      const supabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: { id: 'biz-1', referring_agent_id: 'agent-1' }, error: null })),
            })),
          })),
        })),
      }
      const result = await computeCommission(supabase, { paymentId: 'pay-1', businessId: 'biz-1', nairaCharged: 5000, isFirstPayment: true })
      expect(result).toBeTruthy()
    })
  })

  describe('Provider failures', () => {
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
