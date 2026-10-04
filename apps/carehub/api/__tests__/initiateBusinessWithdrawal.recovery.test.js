// CareHub business withdrawals through the withdrawal engine. The owner must prove the withdrawal PIN and the bank
// account name BEFORE anything is reserved; the reservation is one atomic database step with a database-derived
// reference; Paystack is called with no lock held; and when the transfer does not start the money comes back -
// at once if nothing was ever sent, only after Paystack confirms if the transfer call itself failed.
const h = vi.hoisted(() => {
  const s = { initiateTransfer: vi.fn(), createTransferRecipient: vi.fn(), checkBalance: vi.fn(), resolveAccount: vi.fn(), paystackFetch: vi.fn(), rpcCalls: [], owned: true, auth: null }
  const builderFor = (table) => {
    const b = {
      select: () => b, eq: () => b, or: () => b, in: () => b, is: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => (table === 'businesses' ? { data: s.owned ? { id: 'biz-1' } : null } : { data: null }),
    }
    return b
  }
  s.routes = {}
  s.client = { from: builderFor, rpc: async (n, a) => { s.rpcCalls.push([n, a]); const r = s.routes[n]; return typeof r === 'function' ? r(a) : r || { data: null } } }
  return s
})

vi.mock('../_lib/supabase.js', () => ({ supabase: h.client }))
vi.mock('../_lib/verifyBusiness.js', () => ({ verifyBusiness: async () => h.auth }))
vi.mock('../_lib/paystack.js', () => ({ paystackFetch: h.paystackFetch }))
vi.mock('../../src/lib/emailService.js', () => ({ emailService: { enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) } }))
vi.mock('../_lib/paystackTransfer.js', () => ({
  createTransferRecipient: h.createTransferRecipient,
  initiateTransfer: h.initiateTransfer,
  checkBalance: h.checkBalance,
  resolveAccount: h.resolveAccount,
}))

import { hashPin } from '@care-ecosystem/shared-payments'
import handler from '../_handlers/initiate-business-withdrawal.js'

const REF = 'ch_wd_0123456789abcdef0123456789abcdef'
const SALT = '00112233445566778899aabbccddeeff'
const body = { business_id: 'biz-1', amount: 500000, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'Clinic Ltd', pin: '1234' }
const req = { method: 'POST', body }
const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const calls = (n) => h.rpcCalls.filter(([name]) => name === n)
const settles = () => calls('settle_business_withdrawal').map(([, a]) => a)
const created = { data: { outcome: 'ok', id: 'bw-1', reference: REF, amount_kobo: 500000 } }

beforeEach(() => {
  h.rpcCalls.length = 0
  h.owned = true
  h.auth = { business: { id: 'biz-1', email: 'b@example.com' }, user: { id: 'user-1', email: 'b@example.com', email_confirmed_at: '2026-01-01' } }
  h.routes.get_withdrawal_pin = { data: [{ pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null }] }
  h.routes.verify_withdrawal_pin = { data: true }
  h.routes.create_business_withdrawal = created
  h.routes.attach_business_withdrawal_transfer = { data: 'ok' }
  h.routes.settle_business_withdrawal = (a) => ({ data: { result: a.p_outcome === 'success' ? 'completed' : 'refunded', id: 'bw-1', business_id: 'biz-1', amount: 500000, from_status: 'reserved', reference: REF } })
  h.initiateTransfer.mockReset()
  h.createTransferRecipient.mockReset().mockResolvedValue('RCP_1')
  h.checkBalance.mockReset().mockResolvedValue(10_000_000_00)
  h.resolveAccount.mockReset().mockResolvedValue({ accountName: 'Clinic Ltd' })
  h.paystackFetch.mockReset()
})

describe('initiate-business-withdrawal: authorisation happens before any money is reserved', () => {
  const nothingReserved = () => {
    expect(calls('create_business_withdrawal')).toHaveLength(0)
    expect(h.initiateTransfer).not.toHaveBeenCalled()
  }

  it('no PIN, malformed PIN or wrong PIN: refused, nothing reserved', async () => {
    for (const pin of [undefined, '', 'abcd', '12']) {
      const r = res(); await handler({ method: 'POST', body: { ...body, pin } }, r)
      expect(r.statusCode).toBe(400)
    }
    h.routes.verify_withdrawal_pin = { data: false }
    const r = res(); await handler({ method: 'POST', body: { ...body, pin: '9999' } }, r)
    expect(r.statusCode).toBe(403)
    nothingReserved()
  })

  it('an account with no PIN yet is told to set one (needsPin), nothing reserved', async () => {
    h.routes.get_withdrawal_pin = { data: [] }
    const r = res(); await handler(req, r)
    expect(r.statusCode).toBe(400)
    expect(r.body).toMatchObject({ error: 'Set a withdrawal PIN first', needsPin: true })
    nothingReserved()
  })

  it('a locked PIN is refused without another attempt being counted', async () => {
    h.routes.get_withdrawal_pin = { data: [{ pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: new Date(Date.now() + 600000).toISOString() }] }
    const r = res(); await handler(req, r)
    expect(r.statusCode).toBe(403)
    expect(calls('verify_withdrawal_pin')).toHaveLength(0)
    nothingReserved()
  })

  it('the PIN is checked for the VERIFIED user, never an id from the body', async () => {
    await handler({ method: 'POST', body: { ...body, user_id: 'attacker', userId: 'attacker' } }, res())
    expect(calls('get_withdrawal_pin').every(([, a]) => a.p_user_id === 'user-1')).toBe(true)
  })

  it('not signed in as an owner: 401; someone else\'s business: 403; nothing reserved', async () => {
    h.auth = { error: 'not_logged_in' }
    let r = res(); await handler(req, r); expect(r.statusCode).toBe(401)
    h.auth = { business: { id: 'biz-1' }, user: { id: 'user-1', email_confirmed_at: 'x' } }
    h.owned = false
    r = res(); await handler(req, r); expect(r.statusCode).toBe(403)
    expect(calls('get_withdrawal_pin')).toHaveLength(0)
    nothingReserved()
  })

  it('invalid amounts and details are refused: zero, negative, fractional, text, huge, short account number', async () => {
    for (const patch of [{ amount: 0 }, { amount: -5 }, { amount: 1.5 }, { amount: 'abc' }, { amount: 3_000_000_000 }, { accountNumber: '123' }, { accountName: '' }, { bankCode: '' }]) {
      const r = res(); await handler({ method: 'POST', body: { ...body, ...patch } }, r)
      expect(r.statusCode).toBe(400)
    }
    nothingReserved()
  })

  it('an account name that does not belong to the account number is refused before reserving', async () => {
    h.resolveAccount.mockResolvedValue({ accountName: 'Someone Else' })
    const r = res(); await handler(req, r)
    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(/does not match/)
    nothingReserved()
  })

  it('cannot reach the bank to resolve the account: refused, never paid on a guess', async () => {
    h.resolveAccount.mockRejectedValue(new Error('timeout'))
    const r = res(); await handler(req, r)
    expect(r.statusCode).toBe(400)
    nothingReserved()
  })
})

describe('initiate-business-withdrawal: reservation', () => {
  it('reserves through create_business_withdrawal with the VERIFIED account name and initiator, no client reference, and sends the database reference to Paystack', async () => {
    h.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1' })
    const r = res()
    await handler({ method: 'POST', body: { ...body, reference: 'mine', p_reference: 'mine' } }, r)
    const [[, args]] = calls('create_business_withdrawal')
    expect(args).toEqual({ p_business_id: 'biz-1', p_amount_kobo: 500000, p_bank_name: 'GTB', p_bank_code: '058', p_account_number: '0123456789', p_account_name: 'Clinic Ltd', p_initiated_by: 'user-1' })
    expect(JSON.stringify(args)).not.toContain('mine')
    expect(h.initiateTransfer).toHaveBeenCalledWith(expect.objectContaining({ reference: REF, amountKobo: 500000, recipientCode: 'RCP_1' }))
    expect(r.statusCode).toBe(200)
    expect(r.body).toMatchObject({ success: true, reference: REF, amount: 500000 })
  })

  it('links the provider codes to THIS request by id; a failure to record them does not fail a transfer already on its way', async () => {
    h.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1' })
    await handler(req, res())
    expect(calls('attach_business_withdrawal_transfer')[0][1]).toEqual({ p_request_id: 'bw-1', p_transfer_code: 'TRF_1', p_recipient_code: 'RCP_1' })
    h.routes.attach_business_withdrawal_transfer = () => { throw new Error('blip') }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = res(); await handler(req, r)
    expect(r.statusCode).toBe(200)
    expect(settles()).toHaveLength(0)
    err.mockRestore()
  })

  it('maps the database refusals: daily limit 429, below minimum 400, insufficient 400, nothing sent', async () => {
    h.routes.create_business_withdrawal = { data: { outcome: 'daily_limit' } }
    let r = res(); await handler(req, r); expect(r.statusCode).toBe(429); expect(r.body.error).toBe('daily_limit')
    h.routes.create_business_withdrawal = { data: { outcome: 'below_minimum' } }
    r = res(); await handler(req, r); expect(r.statusCode).toBe(400); expect(r.body.error).toBe('below_minimum')
    h.routes.create_business_withdrawal = { data: { outcome: 'insufficient' } }
    r = res(); await handler(req, r); expect(r.statusCode).toBe(400); expect(r.body.error).toBe('insufficient')
    h.routes.create_business_withdrawal = { data: { outcome: 'no_wallet' } }
    r = res(); await handler(req, r); expect(r.body.error).toBe('insufficient')
    expect(h.initiateTransfer).not.toHaveBeenCalled()
    expect(settles()).toHaveLength(0)
  })

  it('a database error is a 500 and nothing is sent', async () => {
    h.routes.create_business_withdrawal = { data: null, error: { message: 'db down' } }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = res(); await handler(req, r)
    expect(r.statusCode).toBe(500)
    expect(h.initiateTransfer).not.toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('initiate-business-withdrawal: recovery after the balance is reserved', () => {
  it('nothing was sent (Paystack balance low): released at once with no provider lookup', async () => {
    h.checkBalance.mockResolvedValue(1000)
    const r = res(); await handler(req, r)
    expect(r.statusCode).toBe(503)
    expect(r.body.refunded).toBe(true)
    expect(settles()).toEqual([{ p_outcome: 'failed', p_reference: null, p_request_id: 'bw-1', p_amount_kobo: null, p_detail: 'provider_balance_low' }])
    expect(h.paystackFetch).not.toHaveBeenCalled()
  })

  it('nothing was sent (recipient creation failed): released at once', async () => {
    h.createTransferRecipient.mockRejectedValue(new Error('bad account'))
    const r = res(); await handler(req, r)
    expect(r.statusCode).toBe(502)
    expect(r.body.refunded).toBe(true)
    expect(settles()).toHaveLength(1)
    expect(h.initiateTransfer).not.toHaveBeenCalled()
  })

  it('Paystack rejects the transfer and confirms it was never created: refunded at once, by request id', async () => {
    h.initiateTransfer.mockRejectedValue(Object.assign(new Error('Insufficient balance'), { paystackRejected: true }))
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    const r = res(); await handler(req, r)
    expect(settles()).toHaveLength(1)
    expect(settles()[0]).toMatchObject({ p_outcome: 'failed', p_request_id: 'bw-1', p_reference: null })
    expect(r.statusCode).toBe(502)
    expect(r.body.refunded).toBe(true)
  })

  it('duplicate-reference rejection where the transfer exists and succeeded: completed, NEVER refunded', async () => {
    h.initiateTransfer.mockRejectedValue(Object.assign(new Error('Duplicate Transfer Reference'), { paystackRejected: true }))
    h.paystackFetch.mockResolvedValue({ status: true, data: { status: 'success' } })
    const r = res(); await handler(req, r)
    expect(settles().map((s) => s.p_outcome)).toEqual(['success'])
    expect(r.body.refunded).toBeUndefined()
  })

  it('ambiguous failure (timeout): left for the cron, never refunded on a guess, Paystack not even asked yet', async () => {
    h.initiateTransfer.mockRejectedValue(new Error('fetch failed'))
    const r = res(); await handler(req, r)
    expect(settles()).toHaveLength(0)
    expect(h.paystackFetch).not.toHaveBeenCalled()
    expect(r.statusCode).toBe(502)
    expect(r.body.pending).toBe(true)
  })

  it('cannot reach Paystack to confirm: left pending, not refunded', async () => {
    h.initiateTransfer.mockRejectedValue(Object.assign(new Error('rejected'), { paystackRejected: true }))
    h.paystackFetch.mockRejectedValue(new Error('network down'))
    const r = res(); await handler(req, r)
    expect(settles()).toHaveLength(0)
    expect(r.body.pending).toBe(true)
  })

  it('a successful transfer never triggers a settlement or a refund', async () => {
    h.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1' })
    const r = res(); await handler(req, r)
    expect(settles()).toHaveLength(0)
    expect(r.statusCode).toBe(200)
  })
})
