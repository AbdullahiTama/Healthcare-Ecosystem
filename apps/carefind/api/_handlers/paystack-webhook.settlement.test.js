// Settlement behaviour of the shared Paystack webhook, driven through the real handler with a signed event.
import crypto from 'crypto'
import { EventEmitter } from 'events'

const h = vi.hoisted(() => ({ rpcCalls: [], touched: [], rpcImpl: null, updateRows: null, businessApplied: [], refundApplied: [] }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (name, args) => { h.rpcCalls.push([name, args]); return h.rpcImpl(name, args) },
    from: (table) => {
      const b = {
        select: () => b, eq: () => b, in: () => b, limit: () => b, order: () => b,
        maybeSingle: async () => ({ data: h.maybeSingle?.[table] ?? null }),
        insert: async (row) => { h.touched.push(['insert', table, row]); return { error: null } },
        upsert: async (row) => { h.touched.push(['upsert', table, row]); return { error: null } },
        update: (row) => { h.touched.push(['update', table, row]); return b },
        then: (resolve) => resolve({ data: h.updateRows, error: null }),
      }
      return b
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'u@example.com' } } }) } },
  }),
}))
vi.mock('../_lib/paystack.js', () => ({ getPaystackSecretKey: () => 'sk_test_secret' }))
vi.mock('../_lib/businessWithdrawalEffects.js', () => ({ applyBusinessWithdrawalResult: async (_s, result) => { h.businessApplied.push(result) } }))
vi.mock('../_lib/refundEffects.js', () => ({ applyRefundResult: async (_s, result) => { h.refundApplied.push(result) } }))
vi.mock('../_lib/paystackCredit.js', () => ({ creditTopup: vi.fn() }))
vi.mock('../_lib/consultationSettle.js', () => ({ settleConsultationPayment: vi.fn() }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))

vi.mock('@care-ecosystem/shared-payments', async (importOriginal) => ({
  ...(await importOriginal()),
  // These tests are about how each event type is mapped; the charge.success engine routing has its own test file.
  recordProviderEvent: async () => ({ event: { id: 'e1', attempts: 0 }, isNew: true, alreadyHandled: false }),
  finishProviderEvent: async () => {},
  settleByReference: async () => ({ outcome: 'unknown_reference' }),
}))
vi.mock('../_lib/payments.js', () => ({ getPaystackProvider: () => ({}), paymentLogger: { info() {}, warn() {}, error() {} } }))

import handler from './paystack-webhook.js'

function post(body) {
  const raw = Buffer.from(JSON.stringify(body))
  const req = new EventEmitter()
  req.method = 'POST'
  req.headers = { 'x-paystack-signature': crypto.createHmac('sha512', 'sk_test_secret').update(raw).digest('hex') }
  setImmediate(() => { req.emit('data', raw); req.emit('end') })
  const res = { statusCode: 0 }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = () => res
  return handler(req, res).then(() => res)
}
const rpc = (name) => h.rpcCalls.find(([n]) => n === name)?.[1]

beforeEach(() => {
  h.rpcCalls.length = 0
  h.touched.length = 0
  h.businessApplied.length = 0
  h.refundApplied.length = 0
  h.maybeSingle = {}
  h.updateRows = null
  h.rpcImpl = async () => ({ data: [{ already_processed: true }], error: null })
})

// Transfer webhooks are settled by the DATABASE (settle_withdrawal / settle_business_withdrawal); the handler maps the
// event, then runs trust + email only for a change THIS delivery made (so a redelivery or a racing sweep cannot
// count a withdrawal twice).
describe('transfer webhooks settle through the withdrawal engine', () => {
  const trust = () => h.rpcCalls.filter(([n]) => n === 'update_withdrawal_trust_after_withdrawal').map(([, a]) => a)
  const settles = () => h.rpcCalls.filter(([n]) => n.startsWith('settle_')).map(([n, a]) => [n, a])
  const row = { id: 'w1', user_id: 'u1', amount: 10, payout_kobo: 160000, reference: 'cf_wd_1' }
  const answer = (result, extra = {}) => async (name) => (name === 'settle_withdrawal' ? { data: { ...row, result, from_status: 'processing', ...extra }, error: null } : { data: null, error: null })

  it('transfer.success completes the request with the provider amount and records one completed withdrawal', async () => {
    h.rpcImpl = answer('completed')
    await post({ event: 'transfer.success', data: { reference: 'cf_wd_1', amount: 160000 } })
    expect(settles()[0]).toEqual(['settle_withdrawal', { p_outcome: 'success', p_reference: 'cf_wd_1', p_request_id: null, p_amount_kobo: 160000, p_detail: 'transfer.success' }])
    expect(trust()).toEqual([{ p_user_id: 'u1', p_amount: 10, p_status: 'completed' }])
    expect(h.businessApplied).toEqual([]) // CareHub's effect never runs for a CareFind request
  })

  it('a redelivery (already completed) records nothing', async () => {
    h.rpcImpl = answer('already_completed')
    await post({ event: 'transfer.success', data: { reference: 'cf_wd_1', amount: 160000 } })
    expect(trust()).toHaveLength(0)
  })

  it('an amount mismatch completes nothing and records nothing', async () => {
    h.rpcImpl = answer('amount_mismatch')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await post({ event: 'transfer.success', data: { reference: 'cf_wd_1', amount: 1 } })
    expect(trust()).toHaveLength(0)
    err.mockRestore()
  })

  it('transfer.failed that this delivery refunded records a failed withdrawal', async () => {
    h.rpcImpl = answer('refunded')
    await post({ event: 'transfer.failed', data: { reference: 'cf_wd_1' } })
    expect(settles()[0][1]).toMatchObject({ p_outcome: 'failed', p_amount_kobo: null })
    expect(trust()).toEqual([{ p_user_id: 'u1', p_amount: 10, p_status: 'failed' }])
  })

  it('transfer.failed already settled by another path records nothing', async () => {
    h.rpcImpl = answer('already_refunded')
    await post({ event: 'transfer.failed', data: { reference: 'cf_wd_1' } })
    expect(trust()).toHaveLength(0)
  })

  it('transfer.reversed of an already-completed transfer is refunded and does NOT record a failure (it was counted as completed)', async () => {
    h.rpcImpl = answer('refunded', { from_status: 'completed' })
    await post({ event: 'transfer.reversed', data: { reference: 'cf_wd_1', amount: 160000 } })
    expect(settles()[0][1]).toMatchObject({ p_outcome: 'reversed', p_amount_kobo: null })
    expect(trust()).toHaveLength(0)
  })

  it('a CareHub business reference is settled by the business function and runs only CareHub effects', async () => {
    h.rpcImpl = async (name) => (name === 'settle_withdrawal' ? { data: { result: 'not_found' }, error: null }
      : name === 'settle_business_withdrawal' ? { data: { result: 'refunded', id: 'b1', business_id: 'biz', amount: 500000, from_status: 'processing', reference: 'ch_wd_1' }, error: null }
      : { data: null, error: null })
    const res = await post({ event: 'transfer.failed', data: { reference: 'ch_wd_1' } })
    expect(res.statusCode).toBe(200)
    expect(settles().map(([n]) => n)).toEqual(['settle_withdrawal', 'settle_business_withdrawal'])
    expect(trust()).toHaveLength(0)
    expect(h.businessApplied).toHaveLength(1)
    expect(h.businessApplied[0]).toMatchObject({ result: 'refunded', id: 'b1', reference: 'ch_wd_1' })
  })

  it('a reference nobody knows is acknowledged (200) and changes nothing', async () => {
    h.rpcImpl = async () => ({ data: { result: 'not_found' }, error: null })
    const res = await post({ event: 'transfer.success', data: { reference: 'zzz', amount: 1 } })
    expect(res.statusCode).toBe(200)
    expect(trust()).toHaveLength(0)
  })
})

// Refund webhooks are settled by the DATABASE (settle_refund); the handler maps the event and the payment reference.
describe('refund webhooks settle through the refund engine', () => {
  const settles = () => h.rpcCalls.filter(([n]) => n === 'settle_refund').map(([, a]) => a)
  const answer = (result) => async (name) => (name === 'settle_refund' ? { data: { result, id: 'rf1', reference: 'rf_1' }, error: null } : { data: null, error: null })
  const ev = (event, extra = {}) => ({ event, data: { id: 77, transaction_reference: 'chapp_1_abcdefgh', amount: 1000000, ...extra } })

  it('refund.processed completes the refund with the provider id, the payment reference and the refunded amount', async () => {
    h.rpcImpl = answer('completed')
    const res = await post(ev('refund.processed'))
    expect(res.statusCode).toBe(200)
    expect(settles()[0]).toEqual({ p_outcome: 'processed', p_refund_id: null, p_reference: null, p_provider_refund_id: '77', p_transaction_reference: 'chapp_1_abcdefgh', p_amount_kobo: 1000000, p_detail: 'refund.processed' })
    expect(h.refundApplied).toHaveLength(1)
    expect(h.refundApplied[0]).toMatchObject({ result: 'completed', id: 'rf1', reference: 'rf_1' })
  })

  it('only THIS delivery flipping the refund completed notifies the payer; replays and failures notify nobody', async () => {
    for (const result of ['already_completed', 'failed', 'not_found']) {
      h.rpcImpl = answer(result)
      await post(ev('refund.processed'))
    }
    expect(h.refundApplied).toEqual([])
  })

  it('refund.failed fails it (the business is restored by the database); pending/processing only mark it in flight', async () => {
    h.rpcImpl = answer('failed')
    await post(ev('refund.failed'))
    expect(settles()[0]).toMatchObject({ p_outcome: 'failed', p_amount_kobo: null })
    for (const e of ['refund.pending', 'refund.processing']) await post(ev(e))
    expect(settles().slice(1).every((s) => s.p_outcome === 'processing')).toBe(true)
  })

  it('a redelivery, an unknown refund, or a contradiction is acknowledged (200) and never throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const result of ['already_completed', 'not_found', 'conflict_processed_after_failed', 'amount_mismatch']) {
      h.rpcImpl = answer(result)
      expect((await post(ev('refund.processed'))).statusCode).toBe(200)
    }
    err.mockRestore()
  })

  it('a database error answers 500 so Paystack redelivers the event', async () => {
    h.rpcImpl = async () => ({ data: null, error: { message: 'db down' } })
    expect((await post(ev('refund.processed'))).statusCode).toBe(500)
  })
})
