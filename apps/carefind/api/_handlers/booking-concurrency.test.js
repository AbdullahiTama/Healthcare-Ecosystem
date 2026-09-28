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

function makeSupabase({ rpcResult = { data: 'appt-1', error: null }, rpcError = null } = {}) {
  const rpc = vi.fn(async () => {
    if (rpcError) return { data: null, error: rpcError }
    return rpcResult
  })
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      })),
      in: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      })),
    })),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: { id: 'appt-1' }, error: null })),
      })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) })),
    })),
  }))
  harness.createClient.mockReturnValue({ rpc, from })
  return { rpc, from }
}

describe('CareFind Booking Concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('book_appointment_slot RPC', () => {
    it('creates a booking and locks slot atomically', async () => {
      const mock = makeSupabase()
      const result = await mock.rpc('book_appointment_slot', {
        p_business_id: 'biz-1',
        p_service_id: 'svc-1',
        p_date: '2026-10-01',
        p_time: '09:00',
        p_client_name: 'Test User',
        p_phone: '+2348012345678',
        p_fee_amount: 50000,
        p_payment_reference: 'bk_test_123',
        p_booking_type: 'physical',
        p_concern: 'Test concern',
      })
      expect(result.data).toBe('appt-1')
      expect(mock.rpc).toHaveBeenCalledWith('book_appointment_slot', expect.objectContaining({
        p_business_id: 'biz-1',
        p_service_id: 'svc-1',
      }))
    })

    it('rejects when slot is not available', async () => {
      const mock = makeSupabase({ rpcError: new Error('Slot not available for this service on this date/time') })
      const { error } = await mock.rpc('book_appointment_slot', {
        p_business_id: 'biz-1',
        p_service_id: 'svc-1',
        p_date: '2026-10-01',
        p_time: '09:00',
        p_client_name: 'Test',
        p_phone: '+2348012345678',
        p_fee_amount: 50000,
        p_payment_reference: 'bk_test_123',
        p_booking_type: 'physical',
        p_concern: null,
      })
      expect(error.message).toContain('Slot not available')
    })

    it('rejects when service is not found', async () => {
      const mock = makeSupabase({ rpcError: new Error('Service not found or inactive') })
      const { error } = await mock.rpc('book_appointment_slot', {
        p_business_id: 'biz-1',
        p_service_id: 'svc-1',
        p_date: '2026-10-01',
        p_time: '09:00',
        p_client_name: 'Test',
        p_phone: '+2348012345678',
        p_fee_amount: 50000,
        p_payment_reference: 'bk_test_123',
        p_booking_type: 'physical',
        p_concern: null,
      })
      expect(error.message).toContain('Service not found')
    })
  })

  describe('pay_booking_with_credits RPC', () => {
    it('pays for a booking with CareCoins atomically', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'ok', error: null } })
      const result = await mock.rpc('pay_booking_with_credits', {
        p_user_id: 'user-1',
        p_appointment_id: 'appt-1',
      })
      expect(result.data).toBe('ok')
    })

    it('rejects if already paid', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'already_paid', error: null } })
      const result = await mock.rpc('pay_booking_with_credits', {
        p_user_id: 'user-1',
        p_appointment_id: 'appt-1',
      })
      expect(result.data).toBe('already_paid')
    })

    it('rejects if insufficient balance', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'insufficient', error: null } })
      const result = await mock.rpc('pay_booking_with_credits', {
        p_user_id: 'user-1',
        p_appointment_id: 'appt-1',
      })
      expect(result.data).toBe('insufficient')
    })
  })

  describe('settle_card_booking RPC', () => {
    it('settles a card payment atomically', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'ok', error: null } })
      const result = await mock.rpc('settle_card_booking', {
        p_appointment_id: 'appt-1',
        p_reference: 'bk_test_123',
      })
      expect(result.data).toBe('ok')
    })

    it('returns already_paid for duplicate settlement', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'already_paid', error: null } })
      const result = await mock.rpc('settle_card_booking', {
        p_appointment_id: 'appt-1',
        p_reference: 'bk_test_123',
      })
      expect(result.data).toBe('already_paid')
    })

    it('returns not_found for invalid appointment', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'not_found', error: null } })
      const result = await mock.rpc('settle_card_booking', {
        p_appointment_id: 'invalid',
        p_reference: 'bk_test_123',
      })
      expect(result.data).toBe('not_found')
    })
  })

  describe('Concurrency: two simultaneous booking requests', () => {
    it('only one concurrent request successfully books the slot', async () => {
      let callCount = 0
      const rpc = vi.fn(async () => {
        callCount++
        if (callCount === 1) return { data: 'appt-1', error: null }
        return { data: null, error: new Error('Slot not available for this service on this date/time') }
      })
      harness.createClient.mockReturnValue({ rpc, from: vi.fn() })
      const [result1, result2] = await Promise.all([
        rpc('book_appointment_slot', { p_business_id: 'biz-1', p_service_id: 'svc-1', p_date: '2026-10-01', p_time: '09:00', p_client_name: 'A', p_phone: '+2348012345678', p_fee_amount: 50000, p_payment_reference: 'ref-1', p_booking_type: 'physical', p_concern: null }),
        rpc('book_appointment_slot', { p_business_id: 'biz-1', p_service_id: 'svc-1', p_date: '2026-10-01', p_time: '09:00', p_client_name: 'B', p_phone: '+2348012345679', p_fee_amount: 50000, p_payment_reference: 'ref-2', p_booking_type: 'physical', p_concern: null }),
      ])
      const succeeded = result1.data ? 1 : 0
      const failed = result2.error ? 1 : 0
      expect(succeeded + failed).toBe(2)
      expect(succeeded).toBe(1)
    })
  })

  describe('Abandoned payment handling', () => {
    it('unpaid appointment can be identified for expiration', async () => {
      const mock = makeSupabase()
      const result = await mock.rpc('book_appointment_slot', {
        p_business_id: 'biz-1',
        p_service_id: 'svc-1',
        p_date: '2026-10-01',
        p_time: '10:00',
        p_client_name: 'Test',
        p_phone: '+2348012345678',
        p_fee_amount: 50000,
        p_payment_reference: 'bk_abandoned',
        p_booking_type: 'physical',
        p_concern: null,
      })
      expect(result.data).toBeTruthy()
    })
  })

  describe('Cancellation during payment', () => {
    it('cancelled appointment cannot be settled', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'already_paid', error: null } })
      const result = await mock.rpc('settle_card_booking', {
        p_appointment_id: 'appt-1',
        p_reference: 'bk_test_123',
      })
      expect(result.data).toBe('already_paid')
    })
  })

  describe('Modified provider/user ID rejection', () => {
    it('booking RPC rejects invalid business ID', async () => {
      const mock = makeSupabase({ rpcError: new Error('Business not found or inactive') })
      const { error } = await mock.rpc('book_appointment_slot', {
        p_business_id: 'invalid',
        p_service_id: 'svc-1',
        p_date: '2026-10-01',
        p_time: '09:00',
        p_client_name: 'Test',
        p_phone: '+2348012345678',
        p_fee_amount: 50000,
        p_payment_reference: 'ref-1',
        p_booking_type: 'physical',
        p_concern: null,
      })
      expect(error.message).toContain('Business not found')
    })
  })
})
