// Shop settlement through the shared Paystack webhook must be retryable. Paystack redelivers an event only
// when it is answered with a non-2xx status, and claim_payment_event records the delivery as "processed"
// BEFORE settlement runs - so a settlement that fails after the claim, and is then acknowledged with 200 or
// skipped as "already processed" on redelivery, leaves a paid order unpaid for good.
import crypto from 'crypto'
import { EventEmitter } from 'events'

const h = vi.hoisted(() => ({ rpcCalls: [], touched: [], orders: null, attempt: null, claim: 'ok', verify: null, updateRows: [], updateError: null }))

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
        maybeSingle: async () => ({ data: table === 'shop_orders' ? h.orders : table === 'shop_payments' ? h.attempt : null }),
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
const unpaid = { id: 'o1', payment_reference: 'CF-1', paystack_reference: null, vendor_business_id: 'v1', total_kobo: 100000, payment_status: 'pending', status: 'pending_payment', order_ref: 'CF-1' }

beforeEach(() => {
  h.rpcCalls.length = 0
  h.touched.length = 0
  h.orders = { ...unpaid }
  h.attempt = null
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
    h.orders = { ...unpaid, status: 'paid', payment_status: 'paid', paystack_reference: 'CF-1' }

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

// The webhook path writes the vendor and customer notification text. A file saved in the wrong encoding once
// turned the em dash into U+FFFD and the naira sign into "?", which shoppers and vendors then read.
describe('shop payment notification text', () => {
  it('shows the naira sign and no replacement characters when the webhook settles an order', async () => {
    await post(event)

    const texts = h.touched
      .filter(([op, t]) => op === 'insert' && (t === 'staff_notifications' || t === 'notifications'))
      .flatMap(([, , row]) => [row.title, row.body, row.message].filter(Boolean))

    expect(texts.length).toBeGreaterThan(0)
    expect(texts.join(' ')).toContain('₦1,000')
    // Built at runtime so this file never contains the replacement character the contract test scans for.
    expect(texts.join(' ')).not.toContain(String.fromCodePoint(0xfffd))
    expect(texts.join(' ')).not.toContain('?1,000')
  })
})

// A retried payment has several references. The webhook must only act on an attempt of the order named in the
// metadata, and a second successful attempt on an order that is already paid must be recorded for refund, never
// silently dropped and never settled twice.
describe('shop payment attempts via the webhook', () => {
  const retryEvent = { ...event, data: { ...event.data, reference: 'CF-2' } }
  const upserted = (table) => h.touched.filter(([op, t]) => op === 'upsert' && t === table).map(([, , row]) => row)

  it('a reference that is not an attempt of the order is acknowledged and never settles it', async () => {
    h.attempt = null

    const res = await post(retryEvent)

    expect(res.statusCode).toBe(200)
    expect(settleCalled()).toBe(false)
  })

  it('an earlier attempt recorded in the ledger settles an order that is not paid', async () => {
    h.attempt = { id: 'a1', order_id: 'o1', payment_reference: 'CF-2', status: 'failed' }

    const res = await post(retryEvent)

    expect(res.statusCode).toBe(200)
    expect(h.rpcCalls.find(([n]) => n === 'verify_shop_payment')?.[1]).toEqual({ p_order_id: 'o1', p_paystack_reference: 'CF-2' })
  })

  it('a second successful attempt on an already-paid order is recorded as a duplicate for refund, not settled again', async () => {
    h.attempt = { id: 'a1', order_id: 'o1', payment_reference: 'CF-2', status: 'pending' }
    h.orders = { ...unpaid, status: 'paid', payment_status: 'paid', paystack_reference: 'CF-1' }

    const res = await post(retryEvent)

    expect(res.statusCode).toBe(200)
    expect(settleCalled()).toBe(false)
    expect(upserted('shop_payments')).toEqual([expect.objectContaining({
      order_id: 'o1', payment_reference: 'CF-2', amount_kobo: 100000, status: 'success',
      gateway_response: expect.objectContaining({ duplicate: true }),
    })])
    const alert = h.touched.find(([op, t]) => op === 'insert' && t === 'staff_notifications')?.[2]
    expect(alert).toMatchObject({ business_id: 'v1', kind: 'shop_duplicate_payment' })
  })

  it('a redelivery of the reference that settled the order is not mistaken for a duplicate', async () => {
    h.claim = 'already_processed'
    h.orders = { ...unpaid, status: 'paid', payment_status: 'paid', paystack_reference: 'CF-1' }

    await post(event)

    expect(upserted('shop_payments')).toEqual([])
  })
})
