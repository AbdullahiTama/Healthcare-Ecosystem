// initiate-withdrawal reserves through the database (create_withdrawal: balance, cap, ledger debit, request row
// and a reference DERIVED from the request id, all in one step), then calls Paystack with no lock held. When the
// transfer does not start, the coins must come back - at once if nothing was ever sent, and only once Paystack
// confirms the transfer was not created if the transfer call itself failed (a timeout can mean it exists anyway).
const h = vi.hoisted(() => {
  const s = {
    initiateTransfer: vi.fn(),
    createTransferRecipient: vi.fn(),
    checkBalance: vi.fn(),
    paystackFetch: vi.fn(),
    rpcCalls: [],
  }
  const builderFor = () => {
    const b = { select: () => b, eq: () => b, is: () => b, order: () => b, limit: () => b, update: () => b, maybeSingle: async () => ({ data: null }), then: (resolve) => resolve({ error: null }) }
    return b
  }
  s.routes = {}
  s.client = {
    from: () => builderFor(),
    rpc: async (name, args) => { s.rpcCalls.push([name, args]); const r = s.routes[name]; return typeof r === 'function' ? r(args) : r || { data: null } },
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
  createTransferRecipient: h.createTransferRecipient,
  initiateTransfer: h.initiateTransfer,
  checkBalance: h.checkBalance,
  normalizeAccountName: (n) => String(n).trim().toLowerCase(),
  resolveAccount: async () => ({ accountName: 'Ada Obi' }),
}))

process.env.OTP_HMAC_SECRET = 'test-secret' // the withdrawal code check keys its hash with this
import handler from './initiate-withdrawal.js'

const REF = 'cf_wd_0123456789abcdef0123456789abcdef'
const req = { method: 'POST', body: { amount: 10, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'Ada Obi', pin: '1234', otp: '123456' } }
const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; r.setHeader = () => {}; return r }
const calls = (name) => h.rpcCalls.filter(([n]) => n === name)
const settles = () => calls('settle_withdrawal').map(([, a]) => a)
const created = { data: { outcome: 'ok', id: 'wd-1', reference: REF, coins: 10, payout_kobo: 160000 } }

beforeEach(() => {
  h.rpcCalls.length = 0
  h.routes.get_withdrawal_trust = { data: { trust_level: 'new' } }
  h.routes.get_withdrawal_pin = { data: [{ pin_hash: 'x', pin_salt: 's', locked_until: null }] }
  h.routes.verify_withdrawal_pin = { data: true }
  h.routes.verify_otp = { data: 'ok' }
  h.routes.create_withdrawal = created
  h.routes.attach_withdrawal_transfer = { data: 'ok' }
  h.routes.settle_withdrawal = (a) => ({ data: { result: a.p_outcome === 'success' ? 'completed' : 'refunded', id: 'wd-1', user_id: 'user-12345678', amount: 10, from_status: 'reserved', reference: REF } })
  h.initiateTransfer.mockReset()
  h.createTransferRecipient.mockReset().mockResolvedValue('RCP_1')
  h.checkBalance.mockReset().mockResolvedValue(10_000_000_00)
  h.paystackFetch.mockReset()
})

describe('initiate-withdrawal: reservation', () => {
  it('reserves through create_withdrawal (no client reference, server-chosen cap) and sends the DATABASE\'s reference and payout to Paystack', async () => {
    h.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1' })
    const r = res()
    await handler(req, r)
    const [[, args]] = calls('create_withdrawal')
    expect(args).toEqual({ p_user_id: 'user-12345678', p_coins: 10, p_bank_name: 'GTB', p_bank_code: '058', p_account_number: '0123456789', p_account_name: 'Ada Obi', p_daily_cap_coins: 50 })
    expect(args).not.toHaveProperty('p_reference')
    expect(h.initiateTransfer).toHaveBeenCalledWith(expect.objectContaining({ reference: REF, amountKobo: 160000, recipientCode: 'RCP_1' }))
    expect(r.statusCode).toBe(200)
    expect(r.body).toMatchObject({ success: true, reference: REF, coins: 10, payoutNaira: 1600, transferCode: 'TRF_1' })
  })

  it('links the provider codes to THIS request by id', async () => {
    h.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1' })
    await handler(req, res())
    expect(calls('attach_withdrawal_transfer')[0][1]).toEqual({ p_request_id: 'wd-1', p_transfer_code: 'TRF_1', p_recipient_code: 'RCP_1' })
  })

  it('a failure to record the linkage does not fail a transfer that is already on its way', async () => {
    h.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1' })
    h.routes.attach_withdrawal_transfer = () => { throw new Error('db blip') }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = res()
    await handler(req, r)
    expect(r.statusCode).toBe(200)
    expect(settles()).toHaveLength(0)
    err.mockRestore()
  })

  it('a client cannot choose its own cap or its own reference', async () => {
    h.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1' })
    await handler({ ...req, body: { ...req.body, dailyCapCoins: 999999, p_daily_cap_coins: 999999, reference: 'mine', p_reference: 'mine', payout: 1 } }, res())
    const args = calls('create_withdrawal')[0][1]
    expect(args.p_daily_cap_coins).toBe(50)
    expect(JSON.stringify(args)).not.toContain('mine')
    expect(h.initiateTransfer).toHaveBeenCalledWith(expect.objectContaining({ reference: REF, amountKobo: 160000 }))
  })

  it('over the daily limit: 429, Paystack is never called and there is nothing to refund', async () => {
    h.routes.create_withdrawal = { data: { outcome: 'daily_limit' } }
    const r = res()
    await handler(req, r)
    expect(r.statusCode).toBe(429)
    expect(r.body).toMatchObject({ error: 'daily_limit', dailyCapCoins: 50 })
    expect(h.initiateTransfer).not.toHaveBeenCalled()
    expect(h.checkBalance).not.toHaveBeenCalled()
    expect(settles()).toHaveLength(0)
  })

  it('insufficient coins and other refusals: 400, nothing sent', async () => {
    h.routes.create_withdrawal = { data: { outcome: 'insufficient' } }
    let r = res(); await handler(req, r)
    expect(r.statusCode).toBe(400); expect(r.body.error).toBe('insufficient')
    h.routes.create_withdrawal = { data: { outcome: 'below_minimum' } }
    r = res(); await handler(req, r)
    expect(r.statusCode).toBe(400)
    expect(h.initiateTransfer).not.toHaveBeenCalled()
  })

  it('a database error is a 500 and nothing is sent', async () => {
    h.routes.create_withdrawal = { data: null, error: { message: 'db down' } }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = res(); await handler(req, r)
    expect(r.statusCode).toBe(500)
    expect(h.initiateTransfer).not.toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('initiate-withdrawal: recovery after the coins are reserved', () => {
  it('nothing was sent (Paystack balance low): the reservation is released at once, with no provider lookup', async () => {
    h.checkBalance.mockResolvedValue(1000)
    const r = res()
    await handler(req, r)
    expect(r.statusCode).toBe(503)
    expect(r.body.refunded).toBe(true)
    expect(settles()).toEqual([{ p_outcome: 'failed', p_reference: null, p_request_id: 'wd-1', p_amount_kobo: null, p_detail: 'provider_balance_low' }])
    expect(h.initiateTransfer).not.toHaveBeenCalled()
    expect(h.paystackFetch).not.toHaveBeenCalled()
  })

  it('nothing was sent (recipient creation failed): released at once', async () => {
    h.createTransferRecipient.mockRejectedValue(new Error('bad account'))
    const r = res()
    await handler(req, r)
    expect(r.statusCode).toBe(502)
    expect(r.body.refunded).toBe(true)
    expect(settles()).toHaveLength(1)
    expect(h.initiateTransfer).not.toHaveBeenCalled()
  })

  it('Paystack rejects the transfer and confirms it was never created: refunded at once, by request id', async () => {
    h.initiateTransfer.mockRejectedValue(Object.assign(new Error('Your balance is not enough'), { paystackRejected: true }))
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    const r = res()
    await handler(req, r)
    expect(settles()).toHaveLength(1)
    expect(settles()[0]).toMatchObject({ p_outcome: 'failed', p_request_id: 'wd-1', p_reference: null })
    expect(r.statusCode).toBe(502)
    expect(r.body.refunded).toBe(true)
  })

  it('Paystack rejects as a duplicate reference but the transfer exists and succeeded: completed, NEVER refunded', async () => {
    h.initiateTransfer.mockRejectedValue(Object.assign(new Error('Duplicate Transfer Reference'), { paystackRejected: true }))
    h.paystackFetch.mockResolvedValue({ status: true, data: { status: 'success' } })
    const r = res()
    await handler(req, r)
    expect(settles().map((s) => s.p_outcome)).toEqual(['success'])
    expect(r.body.refunded).toBeUndefined()
  })

  it('ambiguous failure (timeout): left for the sweep, never refunded on a guess, Paystack not even asked yet', async () => {
    h.initiateTransfer.mockRejectedValue(new Error('fetch failed'))
    const r = res()
    await handler(req, r)
    expect(settles()).toHaveLength(0)
    expect(h.paystackFetch).not.toHaveBeenCalled()
    expect(r.statusCode).toBe(502)
    expect(r.body.pending).toBe(true)
  })

  it('cannot reach Paystack to confirm: left pending, not refunded', async () => {
    h.initiateTransfer.mockRejectedValue(Object.assign(new Error('rejected'), { paystackRejected: true }))
    h.paystackFetch.mockRejectedValue(new Error('network down'))
    const r = res()
    await handler(req, r)
    expect(settles()).toHaveLength(0)
    expect(r.body.pending).toBe(true)
  })

  it('a successful transfer never triggers a settlement or a refund', async () => {
    h.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1' })
    const r = res()
    await handler(req, r)
    expect(settles()).toHaveLength(0)
    expect(r.statusCode).toBe(200)
  })

  // Trust is recorded when a transfer settles (webhook / sweep), never here.
  const trustUpdates = () => calls('update_withdrawal_trust_after_withdrawal')

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
