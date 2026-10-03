// Financial audit H-1 for CareHub: request_business_withdrawal reserves the available balance, then Paystack
// is called. When the transfer does not start the money must come back - but only once Paystack confirms
// the transfer was not created, because a timeout can mean it exists anyway.
const h = vi.hoisted(() => {
  const s = { initiateTransfer: vi.fn(), paystackFetch: vi.fn(), rpcCalls: [], reads: 0, row: null }
  const builderFor = (table) => {
    const b = {
      select: () => b, eq: () => b, or: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, update: () => b,
      maybeSingle: async () => {
        if (table === 'businesses') return { data: { id: 'biz-1' } }
        if (table === 'business_withdrawal_requests') { s.reads++; return { data: s.reads === 1 ? null : s.row } }
        return { data: null }
      },
      then: (r) => r({ error: null }),
    }
    return b
  }
  const routes = { request_business_withdrawal: { data: 'ok' }, reject_business_withdrawal: { data: 'ok' } }
  s.client = { from: builderFor, rpc: async (n, a) => { s.rpcCalls.push([n, a]); return routes[n] || { data: null } } }
  return s
})

vi.mock('../_lib/supabase.js', () => ({ supabase: h.client }))
vi.mock('../_lib/verifyBusiness.js', () => ({ verifyBusiness: async () => ({ business: { id: 'biz-1', email: 'b@example.com' } }) }))
vi.mock('../_lib/paystack.js', () => ({ paystackFetch: h.paystackFetch }))
vi.mock('../../src/lib/emailService.js', () => ({ emailService: { enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) } }))
vi.mock('../_lib/paystackTransfer.js', () => ({
  createTransferRecipient: async () => 'RCP_1',
  initiateTransfer: h.initiateTransfer,
  checkBalance: async () => 10_000_000_00,
  transferReference: () => 'ch_wd_ref1',
}))

import handler from '../_handlers/initiate-business-withdrawal.js'

const req = { method: 'POST', body: { business_id: 'biz-1', amount: 500000, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'Clinic' } }
const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const refunds = () => h.rpcCalls.filter(([n]) => n === 'reject_business_withdrawal')
const row = (ageMs) => ({ id: 'bw-1', status: 'pending', paystack_reference: 'ch_wd_ref1', paystack_transfer_code: null, created_at: new Date(Date.now() - ageMs).toISOString() })

beforeEach(() => {
  h.rpcCalls.length = 0
  h.reads = 0
  h.row = row(1000)
  h.initiateTransfer.mockReset()
  h.paystackFetch.mockReset()
})

describe('initiate-business-withdrawal recovery after the balance is reserved', () => {
  it('Paystack rejects and confirms the transfer was never created: refunded at once', async () => {
    h.initiateTransfer.mockRejectedValue(Object.assign(new Error('Insufficient balance'), { paystackRejected: true }))
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    const r = res()
    await handler(req, r)
    expect(refunds()).toEqual([['reject_business_withdrawal', { p_request_id: 'bw-1' }]])
    expect(r.statusCode).toBe(502)
    expect(r.body.refunded).toBe(true)
  })

  it('duplicate-reference rejection where the transfer exists and succeeded: NO refund', async () => {
    h.initiateTransfer.mockRejectedValue(Object.assign(new Error('Duplicate Transfer Reference'), { paystackRejected: true }))
    h.paystackFetch.mockResolvedValue({ status: true, data: { status: 'success' } })
    const r = res()
    await handler(req, r)
    expect(refunds()).toHaveLength(0)
    expect(r.body.refunded).toBeUndefined()
  })

  it('ambiguous failure (timeout) on a fresh request: left pending, never refunded on a guess', async () => {
    h.initiateTransfer.mockRejectedValue(new Error('fetch failed'))
    const r = res()
    await handler(req, r)
    expect(refunds()).toHaveLength(0)
    expect(h.paystackFetch).not.toHaveBeenCalled()
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
})
