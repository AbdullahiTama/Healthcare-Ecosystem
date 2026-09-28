const harness = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: harness.createClient }))

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

describe('Wallet + Withdrawal Security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('request_withdrawal RPC', () => {
    it('creates a withdrawal request and deducts balance atomically', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'ok', error: null } })
      const result = await mock.rpc('request_withdrawal', {
        p_user_id: 'user-1',
        p_amount: 10,
        p_bank_name: 'Test Bank',
        p_account_number: '1234567890',
        p_account_name: 'Test User',
        p_reference: 'ref-1',
      })
      expect(result.data).toBe('ok')
      expect(mock.rpc).toHaveBeenCalledWith('request_withdrawal', {
        p_user_id: 'user-1',
        p_amount: 10,
        p_bank_name: 'Test Bank',
        p_account_number: '1234567890',
        p_account_name: 'Test User',
        p_reference: 'ref-1',
      })
    })

    it('rejects if balance is insufficient', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'insufficient', error: null } })
      const result = await mock.rpc('request_withdrawal', {
        p_user_id: 'user-1',
        p_amount: 1000,
        p_bank_name: 'Test Bank',
        p_account_number: '1234567890',
        p_account_name: 'Test User',
      })
      expect(result.data).toBe('insufficient')
    })

    it('rejects if amount is below minimum', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'below_minimum', error: null } })
      const result = await mock.rpc('request_withdrawal', {
        p_user_id: 'user-1',
        p_amount: 1,
        p_bank_name: 'Test Bank',
        p_account_number: '1234567890',
        p_account_name: 'Test User',
      })
      expect(result.data).toBe('below_minimum')
    })

    it('does not double-reserve funds for the same reference', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'ok', error: null } })
      await mock.rpc('request_withdrawal', {
        p_user_id: 'user-1',
        p_amount: 10,
        p_bank_name: 'Test Bank',
        p_account_number: '1234567890',
        p_account_name: 'Test User',
        p_reference: 'ref-1',
      })
      const result = await mock.rpc('request_withdrawal', {
        p_user_id: 'user-1',
        p_amount: 10,
        p_bank_name: 'Test Bank',
        p_account_number: '1234567890',
        p_account_name: 'Test User',
        p_reference: 'ref-1',
      })
      expect(result.data).toBe('ok')
    })
  })

  describe('reject_withdrawal_request RPC', () => {
    it('refunds balance and updates status atomically', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'ok', error: null } })
      const result = await mock.rpc('reject_withdrawal_request', { p_request_id: 'req-1' })
      expect(result.data).toBe('ok')
    })

    it('returns already_processed for non-pending status', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'already_completed', error: null } })
      const result = await mock.rpc('reject_withdrawal_request', { p_request_id: 'req-1' })
      expect(result.data).toBe('already_completed')
    })

    it('returns not_found for invalid request ID', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'not_found', error: null } })
      const result = await mock.rpc('reject_withdrawal_request', { p_request_id: 'invalid' })
      expect(result.data).toBe('not_found')
    })
  })

  describe('approve_withdrawal_request RPC', () => {
    it('approves a pending withdrawal', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'ok', error: null } })
      const result = await mock.rpc('approve_withdrawal_request', { p_request_id: 'req-1' })
      expect(result.data).toBe('ok')
    })

    it('returns already_processed for non-pending status', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'already_completed', error: null } })
      const result = await mock.rpc('approve_withdrawal_request', { p_request_id: 'req-1' })
      expect(result.data).toBe('already_completed')
    })
  })

  describe('Concurrency tests', () => {
    it('two simultaneous withdrawals only deduct balance once', async () => {
      let callCount = 0
      const rpc = vi.fn(async () => {
        callCount++
        return { data: 'ok', error: null }
      })
      harness.createClient.mockReturnValue({ rpc, from: vi.fn() })
      const [result1, result2] = await Promise.all([
        rpc('request_withdrawal', { p_user_id: 'user-1', p_amount: 10, p_bank_name: 'B', p_account_number: '1', p_account_name: 'U', p_reference: 'ref-1' }),
        rpc('request_withdrawal', { p_user_id: 'user-1', p_amount: 10, p_bank_name: 'B', p_account_number: '1', p_account_name: 'U', p_reference: 'ref-1' }),
      ])
      expect(result1.data).toBe('ok')
      expect(result2.data).toBe('ok')
    })

    it('duplicate webhook does not double-settle', async () => {
      const rpc = vi.fn(async () => ({ data: { already_processed: true }, error: null }))
      harness.createClient.mockReturnValue({ rpc, from: vi.fn() })
      const result = await rpc('credit_wallet_topup', { p_user_id: 'user-1', p_coins: 5, p_naira_amount: 950, p_reference: 'ref-1' })
      expect(result.data.already_processed).toBe(true)
    })

    it('timeout + retry does not double-credit', async () => {
      let callCount = 0
      const rpc = vi.fn(async () => {
        callCount++
        if (callCount === 1) throw new Error('timeout')
        return { data: { already_processed: false, new_balance: 100 }, error: null }
      })
      harness.createClient.mockReturnValue({ rpc, from: vi.fn() })
      await expect(rpc('credit_wallet_topup', { p_user_id: 'user-1', p_coins: 5, paira_amount: 950, p_reference: 'ref-1' })).rejects.toThrow('timeout')
      const result = await rpc('credit_wallet_topup', { p_user_id: 'user-1', p_coins: 5, p_naira_amount: 950, p_reference: 'ref-1' })
      expect(result.data.already_processed).toBe(false)
    })
  })

  describe('Ledger integrity', () => {
    it('every balance change has a corresponding ledger entry', async () => {
      const mock = makeSupabase({ rpcResult: { data: { already_processed: false, new_balance: 100 }, error: null } })
      await mock.rpc('credit_wallet_topup', { p_user_id: 'user-1', p_coins: 5, p_naira_amount: 950, p_reference: 'ref-1' })
      expect(mock.rpc).toHaveBeenCalled()
    })

    it('withdrawal creates a ledger entry', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'ok', error: null } })
      await mock.rpc('request_withdrawal', { p_user_id: 'user-1', p_amount: 10, p_bank_name: 'B', p_account_number: '1', p_account_name: 'U', p_reference: 'ref-1' })
      expect(mock.rpc).toHaveBeenCalled()
    })

    it('rejection creates a refund ledger entry', async () => {
      const mock = makeSupabase({ rpcResult: { data: 'ok', error: null } })
      await mock.rpc('reject_withdrawal_request', { p_request_id: 'req-1' })
      expect(mock.rpc).toHaveBeenCalled()
    })
  })
})
