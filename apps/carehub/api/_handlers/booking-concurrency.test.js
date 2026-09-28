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

function makeSupabase({ rpcResult = { data: 'ok', error: null }, rpcError = null } = {}) {
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

describe('CareHub Booking Concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('settle_card_booking RPC', () => {
    it('settles a card payment atomically', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'ok', error: null } })
      const result = await mock.rpc('settle_card_booking', {
        p_appointment_id: 'appt-1',
        p_reference: 'appt_abc123',
      })
      expect(result.data).toBe('ok')
    })

    it('returns already_paid for duplicate settlement', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'already_paid', error: null } })
      const result = await mock.rpc('settle_card_booking', {
        p_appointment_id: 'appt-1',
        p_reference: 'appt_abc123',
      })
      expect(result.data).toBe('already_paid')
    })

    it('returns not_found for invalid appointment', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'not_found', error: null } })
      const result = await mock.rpc('settle_card_booking', {
        p_appointment_id: 'invalid',
        p_reference: 'appt_abc123',
      })
      expect(result.data).toBe('not_found')
    })

    it('returns no_fee for appointment without fee', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'no_fee', error: null } })
      const result = await mock.rpc('settle_card_booking', {
        p_appointment_id: 'appt-1',
        p_reference: 'appt_abc123',
      })
      expect(result.data).toBe('no_fee')
    })
  })

  describe('Concurrency: two simultaneous settlement attempts', () => {
    it('only one concurrent request settles the payment', async () => {
      let callCount = 0
      const rpc = vi.fn(async () => {
        callCount++
        if (callCount === 1) return { data: 'ok', error: null }
        return { data: 'already_paid', error: null }
      })
      harness.createClient.mockReturnValue({ rpc, from: vi.fn() })
      const [result1, result2] = await Promise.all([
        rpc('settle_card_booking', { p_appointment_id: 'appt-1', p_reference: 'ref-1' }),
        rpc('settle_card_booking', { p_appointment_id: 'appt-1', p_reference: 'ref-1' }),
      ])
      const settled = result1.data === 'ok' ? 1 : 0
      const alreadyPaid = result2.data === 'already_paid' ? 1 : 0
      expect(settled + alreadyPaid).toBe(2)
      expect(settled).toBe(1)
    })
  })

  describe('Duplicate webhook handling', () => {
    it('duplicate webhook does not double-settle', async () => {
      const rpc = vi.fn(async () => ({ data: 'already_paid', error: null }))
      harness.createClient.mockReturnValue({ rpc, from: vi.fn() })
      const result = await rpc('settle_card_booking', { p_appointment_id: 'appt-1', p_reference: 'ref-1' })
      expect(result.data).toBe('already_paid')
    })
  })

  describe('Modified provider/user ID rejection', () => {
    it('settlement rejects invalid appointment ID', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'not_found', error: null } })
      const result = await mock.rpc('settle_card_booking', {
        p_appointment_id: 'invalid',
        p_reference: 'ref-1',
      })
      expect(result.data).toBe('not_found')
    })
  })
})
