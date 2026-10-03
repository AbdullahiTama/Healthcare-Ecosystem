// Financial audit H-1: initiate-withdrawal debits the wallet, then calls Paystack. When the
// transfer does not start, the coins must come back - but only once Paystack confirms the
// transfer was not created, because a timeout can mean it exists anyway.
const h = vi.hoisted(() => {
  const s = {
    initiateTransfer: vi.fn(),
    paystackFetch: vi.fn(),
    rpcCalls: [],
    rows: { current: null },
    isCalls: 0,
  }
  const builderFor = (table) => {
    const b = {
      select: () => b, eq: () => b, is: () => { s.isCalls++; return b }, order: () => b, limit: () => b, update: () => b,
      maybeSingle: async () => {
        if (table === 'wallets') return { data: { balance: 100 } }
        if (table === 'withdrawal_requests') {
          return { data: s.rows.current }
        }
        return { data: null }
      },
      then: (resolve) => resolve({ error: null }),
    }
    return b
  }
  const routes = {
    get_withdrawal_trust: { data: { trust_level: 'new' } },
    get_withdrawal_pin: { data: [{ pin_hash: 'x', pin_salt: 's', locked_until: null }] },
    verify_withdrawal_pin: { data: true },
    request_withdrawal: { data: 'ok' },
    reject_withdrawal_request: { data: 'ok' },
    update_withdrawal_trust_after_withdrawal: { data: 'new' },
  }
  s.routes = routes
  s.client = {
    from: (t) => builderFor(t),
    rpc: async (name, args) => { s.rpcCalls.push([name, args]); return routes[name] || { data: null } },
  }
  return s
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => ({ id: 'user-12345678', email: 'u@example.com' }) }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))
vi.mock('../_lib/pinCrypto.js', () => ({ hashPin: () => 'h', verifyPin: () => true, isValidPin: () => true }))
vi.mock('../_lib/trustLevels.js', () => ({ getRequiredAuth: () => ['pin'], isInstantEligible: () => false, getDailyCap: () => 50 }))
vi.mock('../_lib/paystack.js', () => ({ paystackFetch: h.paystackFetch }))
vi.mock('../_lib/paystackTransfer.js', () => ({
  createTransferRecipient: async () => 'RCP_1',
  initiateTransfer: h.initiateTransfer,
  checkBalance: async () => 10_000_000_00,
  normalizeAccountName: (n) => String(n).trim().toLowerCase(),
  resolveAccount: async () => ({ accountName: 'Ada Obi' }),
  transferReference: () => 'cf_wd_ref1',
}))

import handler from './initiate-withdrawal.js'

const req = { method: 'POST', body: { amount: 10, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'Ada Obi', pin: '1234' } }
const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const refunds = () => h.rpcCalls.filter(([n]) => n === 'reject_withdrawal_request')
const row = (ageMs) => ({ id: 'wd-1', status: 'pending', paystack_reference: 'cf_wd_ref1', paystack_transfer_code: null, created_at: new Date(Date.now() - ageMs).toISOString() })

beforeEach(() => {
  h.routes.request_withdrawal = { data: 'ok' }
  h.rpcCalls.length = 0
  h.isCalls = 0
  h.rows.current = row(1000)
  h.initiateTransfer.mockReset()
  h.paystackFetch.mockReset()
})

describe('initiate-withdrawal recovery after the wallet is debited', () => {
  // Financial audit F-01: reusing an earlier pending row's reference made request_withdrawal return
  // 'ok' without debiting, while the transfer went out for the NEW amount.
  it('always files the request under a fresh reference and never looks for an earlier pending row to reuse', async () => {
    h.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1' })
    await handler(req, res())
    const call = h.rpcCalls.find(([n]) => n === 'request_withdrawal')
    expect(call[1].p_reference).toBe('cf_wd_ref1')
    expect(h.isCalls).toBe(0)
  })

  it('Paystack rejects the transfer and confirms it was never created: coins are refunded at once', async () => {
    h.initiateTransfer.mockRejectedValue(Object.assign(new Error('Your balance is not enough'), { paystackRejected: true }))
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    const r = res()
    await handler(req, r)
    expect(refunds()).toHaveLength(1)
    expect(refunds()[0][1]).toEqual({ p_request_id: 'wd-1' })
    expect(r.statusCode).toBe(502)
    expect(r.body.refunded).toBe(true)
  })

  it('Paystack rejects as a duplicate reference but the transfer exists and succeeded: NO refund', async () => {
    h.initiateTransfer.mockRejectedValue(Object.assign(new Error('Duplicate Transfer Reference'), { paystackRejected: true }))
    h.paystackFetch.mockResolvedValue({ status: true, data: { status: 'success' } })
    const r = res()
    await handler(req, r)
    expect(refunds()).toHaveLength(0)
    expect(r.body.refunded).toBeUndefined()
  })

  it('ambiguous failure (timeout) on a fresh request: left pending for the sweep, never refunded on a guess', async () => {
    h.initiateTransfer.mockRejectedValue(new Error('fetch failed'))
    const r = res()
    await handler(req, r)
    expect(refunds()).toHaveLength(0)
    expect(h.paystackFetch).not.toHaveBeenCalled()
    expect(r.statusCode).toBe(502)
    expect(r.body.pending).toBe(true)
  })

  it('cannot reach Paystack to confirm: left pending, not refunded', async () => {
    h.initiateTransfer.mockRejectedValue(Object.assign(new Error('rejected'), { paystackRejected: true }))
    h.paystackFetch.mockRejectedValue(new Error('network down'))
    const r = res()
    await handler(req, r)
    expect(refunds()).toHaveLength(0)
    expect(r.body.pending).toBe(true)
  })

  it('a successful transfer never triggers a refund', async () => {
    h.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1' })
    const r = res()
    await handler(req, r)
    expect(refunds()).toHaveLength(0)
    expect(r.statusCode).toBe(200)
  })

  // Financial audit M-3: the tier's rolling-24h ceiling is enforced inside request_withdrawal.
  it('passes the server-chosen daily cap for the user\'s tier to request_withdrawal', async () => {
    h.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1' })
    await handler(req, res())
    const call = h.rpcCalls.find(([n]) => n === 'request_withdrawal')
    expect(call[1].p_daily_cap_coins).toBe(50) // trust level 'new'
  })

  it('a client cannot choose its own cap', async () => {
    h.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1' })
    await handler({ ...req, body: { ...req.body, dailyCapCoins: 999999, p_daily_cap_coins: 999999 } }, res())
    expect(h.rpcCalls.find(([n]) => n === 'request_withdrawal')[1].p_daily_cap_coins).toBe(50)
  })

  it('over the daily limit: 429, and Paystack is never called and nothing is reserved', async () => {
    h.routes.request_withdrawal = { data: 'daily_limit' }
    const r = res()
    await handler(req, r)
    expect(r.statusCode).toBe(429)
    expect(r.body.error).toBe('daily_limit')
    expect(r.body.dailyCapCoins).toBe(50)
    expect(h.initiateTransfer).not.toHaveBeenCalled()
    expect(refunds()).toHaveLength(0)
  })

  // Financial audit M-2: trust is recorded when a transfer settles (webhook / sweep), never here.
  const trustUpdates = () => h.rpcCalls.filter(([n]) => n === 'update_withdrawal_trust_after_withdrawal')

  it('an accepted transfer does not count as a completed withdrawal yet', async () => {
    h.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1' })
    await handler(req, res())
    expect(trustUpdates()).toHaveLength(0)
  })

  it('a transfer that never started does not touch trust either', async () => {
    h.initiateTransfer.mockRejectedValue(Object.assign(new Error('rejected'), { paystackRejected: true }))
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    await handler(req, res())
    expect(trustUpdates()).toHaveLength(0)
  })
})
