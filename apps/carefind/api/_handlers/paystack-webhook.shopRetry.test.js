// Shop settlement through the shared Paystack webhook must be retryable. Paystack redelivers an event only
// when it is answered with a non-2xx status, and claim_payment_event records the delivery as "processed"
// BEFORE settlement runs - so a settlement that fails after the claim, and is then acknowledged with 200 or
// skipped as "already processed" on redelivery, leaves a paid order unpaid for good.
import crypto from 'crypto'
import { EventEmitter } from 'events'

const h = vi.hoisted(() => ({ rpcCalls: [], touched: [], orders: null, claim: 'ok', verify: null, updateRows: [], updateError: null }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (name, args) => {
      h.rpcCalls.push([name, args])
      if (name === 'claim_payment_event') return { data: h.claim, error: null }
      if (name === 'verify_shop_payment') return h.verify
      return { data: null, error: { message: `unmocked rpc ${name}` } }
    },
    from: (table) => {
      const b = {
        select: () => b, eq: () => b, in: () => b, limit: () => b, order: () => b,
        maybeSingle: async () => ({ data: table === 'shop_orders' ? h.orders : null }),
        insert: async (row) => { h.touched.push(['insert', table, row]); return { error: null } },
        upsert: async (row) => { h.touched.push(['upsert', table, row]); return { error: null } },
        update: (row) => { h.touched.push(['update', table, row]); return b },
        then: (resolve) => resolve({ data: h.updateRows, error: h.updateError }),
      }
      return b
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'u@example.com' } } }) } },
  }),
}))
vi.mock('../_lib/paystack.js', () => ({ getPaystackSecretKey: () => 'sk_test_secret' }))
vi.mock('../_lib/paystackCredit.js', () => ({ creditTopup: vi.fn() }))
vi.mock('../_lib/consultationSettle.js', () => ({ settleConsultationPayment: vi.fn() }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))

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
const settleCalled = () => h.rpcCalls.some(([n]) => n === 'verify_shop_payment')
const event = { event: 'charge.success', data: { reference: 'CF-1', amount: 100000, metadata: { order_id: 'o1' } } }
const unpaid = { id: 'o1', vendor_business_id: 'v1', total_kobo: 100000, payment_status: 'pending', status: 'pending_payment', order_ref: 'CF-1' }

beforeEach(() => {
  h.rpcCalls.length = 0
  h.touched.length = 0
  h.orders = { ...unpaid }
  h.claim = 'ok'
  h.verify = { data: 'ok', error: null }
  h.updateRows = []
  h.updateError = null
})

describe('shop order settlement via the webhook is retryable', () => {
  it('a settlement that fails answers 500 so Paystack redelivers the event', async () => {
    h.verify = { data: 'invalid_reference', error: null }

    const res = await post(event)

    expect(res.statusCode).toBe(500)
  })

  it('a redelivery whose claim is already recorded still settles an order that is not paid', async () => {
    h.claim = 'already_processed'

    const res = await post(event)

    expect(settleCalled()).toBe(true)
    expect(res.statusCode).toBe(200)
  })

  it('a redelivery for an order that is already paid is acknowledged without settling again', async () => {
    h.claim = 'already_processed'
    h.orders = { ...unpaid, status: 'paid', payment_status: 'paid' }

    const res = await post(event)

    expect(settleCalled()).toBe(false)
    expect(res.statusCode).toBe(200)
  })

  it('an amount that does not match the order is acknowledged, not retried, and never settles', async () => {
    const res = await post({ ...event, data: { ...event.data, amount: 5000 } })

    expect(res.statusCode).toBe(200)
    expect(settleCalled()).toBe(false)
  })
})
