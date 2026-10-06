// Shop payments through the one settlement engine. Real handlers and shared-payments code; the database, Paystack and email are
// fakes (the engine's SQL, including _settle_shop_order, is proven on a real Postgres in centralSettlement.db.test.js).
const h = vi.hoisted(() => ({ db: null, provider: null, user: null, enqueue: null, log: null }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (...a) => h.db.from(...a), rpc: (...a) => h.db.rpc(...a), auth: h.db?.auth }) }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => h.user }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: (...a) => h.enqueue(...a), processBatch: vi.fn(async () => {}) }))
vi.mock('../_lib/payments.js', () => ({ getPaystackProvider: () => h.provider, paymentLogger: { info() {}, warn() {}, error: (...a) => h.log(...a) } }))

import { createFakeSupabase, createFakeProvider, verifiedPayment, createRes } from '@care-ecosystem/shared-payments/testing'
import initiate from './initiate-shop-payment.js'
import verify from './verify-shop-payment.js'

const U = 'user-1111-aaaa'
const ORDER = 'order-0001'
const TOTAL = 2500000
const order = (over = {}) => ({ id: ORDER, customer_id: U, vendor_business_id: 'vendor-1', total_kobo: TOTAL, subtotal_kobo: TOTAL, payment_reference: null, paystack_reference: null, status: 'pending_payment', payment_status: 'pending', order_ref: 'CF-1', delivery_email: 'buyer@x.com', customer_name: 'Ada', ...over })
const intent = (over = {}) => ({ id: 'i1', reference: 'cf_shop_order000_aaaaaaaaaaaa', provider: 'paystack', purpose: 'shop_order', customer_id: U, business_id: 'vendor-1', entity_type: 'shop_order', entity_id: ORDER, status: 'pending', expected_amount: TOTAL, currency: 'NGN', metadata: {}, ...over })
const call = (handler, body, headers = {}) => { const res = createRes(); return handler({ method: 'POST', body, headers: { host: 'carefind.test', ...headers } }, res).then(() => res) }
const rpcNames = () => h.db.calls.filter((c) => c.op === 'rpc').map((c) => c.name)

const settledAnswer = { outcome: 'settled', purpose: 'shop_order', order_id: ORDER, order_ref: 'CF-1', vendor_business_id: 'vendor-1', total_kobo: TOTAL }

beforeEach(() => {
  h.user = { id: U, email: 'u@example.com' }
  h.enqueue = vi.fn(async () => {})
  h.log = vi.fn()
  h.provider = createFakeProvider({ verify: async ({ reference }) => verifiedPayment({ reference, amountKobo: TOTAL, providerTransactionId: '9001' }) })
  h.provider.initializePayment = vi.fn(async ({ reference }) => ({ reference, authorizationUrl: `https://checkout.test/${reference}`, accessCode: 'ac' }))
  h.db = createFakeSupabase({ tables: { shop_orders: [order()], shop_payments: [], payment_intents: [], payment_provider_events: [], staff_notifications: [], shop_order_items: [] }, rpc: { settle_payment_intent: async () => settledAnswer, track_purchase_pattern: async () => null } })
})

describe('initiate-shop-payment', () => {
  it('records the intent for the order\'s OWN total and customer before Paystack, ignoring any amount the client sends', async () => {
    const res = await call(initiate, { order_id: ORDER, amount: 1, total_kobo: 1, customer_id: 'attacker' })
    expect(res.statusCode).toBe(200)
    const [i] = h.db.data.payment_intents
    expect(i).toMatchObject({ purpose: 'shop_order', application: 'carefind', customer_id: U, business_id: 'vendor-1', entity_type: 'shop_order', entity_id: ORDER, expected_amount: TOTAL, status: 'pending' })
    expect(h.provider.initializePayment).toHaveBeenCalledWith(expect.objectContaining({ reference: i.reference, amountKobo: TOTAL, email: 'u@example.com' }))
    expect(res.body).toMatchObject({ authorization_url: expect.stringContaining(i.reference), reference: i.reference, amount: TOTAL })
    expect(h.db.data.shop_payments[0]).toMatchObject({ order_id: ORDER, payment_reference: i.reference, amount_kobo: TOTAL, status: 'pending' })
    expect(h.db.data.shop_orders[0].payment_reference).toBe(i.reference)
  })

  it('every attempt gets its own intent and reference', async () => {
    await call(initiate, { order_id: ORDER })
    h.db.data.shop_orders[0].payment_reference = null
    h.db.data.shop_payments.forEach((p) => { p.status = 'failed' })
    await call(initiate, { order_id: ORDER })
    const refs = h.db.data.payment_intents.map((i) => i.reference)
    expect(new Set(refs).size).toBe(2)
  })

  it('refuses: not signed in, someone else\'s order, already paid, not payable, nothing to pay, unknown order', async () => {
    h.user = null
    expect((await call(initiate, { order_id: ORDER })).statusCode).toBe(401)
    h.user = { id: 'someone-else', email: 'x@y.com' }
    expect((await call(initiate, { order_id: ORDER })).statusCode).toBe(403)
    h.user = { id: U, email: 'u@example.com' }
    h.db.data.shop_orders[0].payment_status = 'paid'
    expect((await call(initiate, { order_id: ORDER })).statusCode).toBe(400)
    Object.assign(h.db.data.shop_orders[0], { payment_status: 'pending', status: 'cancelled' })
    expect((await call(initiate, { order_id: ORDER })).statusCode).toBe(400)
    Object.assign(h.db.data.shop_orders[0], { status: 'pending_payment', total_kobo: 0 })
    expect((await call(initiate, { order_id: ORDER })).statusCode).toBe(400)
    expect((await call(initiate, { order_id: 'nope' })).statusCode).toBe(404)
    expect((await call(initiate, {})).statusCode).toBe(400)
    expect(h.db.data.payment_intents).toHaveLength(0)
    expect(h.provider.initializePayment).not.toHaveBeenCalled()
  })

  describe('a previous attempt exists', () => {
    const withPrevious = (prevIntent = intent(), rpc = {}) => {
      h.db = createFakeSupabase({
        tables: {
          shop_orders: [order({ payment_reference: prevIntent?.reference || 'legacy_ref_000001' })],
          shop_payments: [{ id: 'sp1', order_id: ORDER, payment_reference: prevIntent?.reference || 'legacy_ref_000001', amount_kobo: TOTAL, status: 'pending' }],
          payment_intents: prevIntent ? [prevIntent] : [], payment_provider_events: [], staff_notifications: [], shop_order_items: [],
        },
        rpc: { settle_payment_intent: async () => settledAnswer, track_purchase_pattern: async () => null, ...rpc },
      })
    }

    it('one that was actually paid is settled now and the customer is told, NOT charged twice', async () => {
      withPrevious()
      const res = await call(initiate, { order_id: ORDER })
      expect(res.body).toMatchObject({ alreadyPaid: true, reference: 'cf_shop_order000_aaaaaaaaaaaa' })
      expect(h.provider.initializePayment).not.toHaveBeenCalled()
      expect(h.db.data.payment_intents).toHaveLength(1)
      expect(h.db.data.staff_notifications).toHaveLength(1)            // the settle-once effects ran
    })

    it('one that was already settled: alreadyPaid, nothing new created', async () => {
      withPrevious(intent(), { settle_payment_intent: async () => ({ outcome: 'already_settled', purpose: 'shop_order' }) })
      const res = await call(initiate, { order_id: ORDER })
      expect(res.body.alreadyPaid).toBe(true)
      expect(h.db.data.payment_intents).toHaveLength(1)
    })

    it('one that was not paid is closed (ledger and intent) and a fresh attempt starts', async () => {
      withPrevious()
      h.provider.verifyPayment.mockResolvedValue(verifiedPayment({ status: 'abandoned', amountKobo: TOTAL }))
      const res = await call(initiate, { order_id: ORDER })
      expect(res.statusCode).toBe(200)
      expect(h.db.data.shop_payments.find((p) => p.id === 'sp1').status).toBe('failed')
      expect(h.db.data.payment_intents.find((i) => i.id === 'i1').status).toBe('failed')
      expect(h.db.data.payment_intents).toHaveLength(2)
    })

    it('cannot check it (Paystack down): refuses with 502 and starts nothing, so nobody pays twice', async () => {
      withPrevious()
      h.provider.verifyPayment.mockRejectedValue(new Error('timeout'))
      const res = await call(initiate, { order_id: ORDER })
      expect(res.statusCode).toBe(502)
      expect(h.provider.initializePayment).not.toHaveBeenCalled()
      expect(h.db.data.payment_intents).toHaveLength(1)
    })

    it('a pre-intent attempt that Paystack says was PAID is never doubled: 409, logged for a human', async () => {
      withPrevious(null)
      const res = await call(initiate, { order_id: ORDER })
      expect(res.statusCode).toBe(409)
      expect(h.log).toHaveBeenCalledWith('payment.shop.legacy_attempt_paid', { order: ORDER, reference: 'legacy_ref_000001' })
      expect(h.provider.initializePayment).not.toHaveBeenCalled()
    })

    it('a pre-intent attempt that was NOT paid is closed and a fresh attempt starts', async () => {
      withPrevious(null)
      h.provider.verifyPayment.mockResolvedValue(verifiedPayment({ status: 'abandoned', amountKobo: TOTAL }))
      const res = await call(initiate, { order_id: ORDER })
      expect(res.statusCode).toBe(200)
      expect(h.db.data.shop_payments.find((p) => p.id === 'sp1').status).toBe('failed')
    })
  })

  it('a definite Paystack refusal closes the intent; an ambiguous failure leaves it to expire', async () => {
    h.provider.initializePayment.mockRejectedValueOnce(Object.assign(new Error('Invalid amount'), { code: 'provider_rejected', ambiguous: false }))
    expect((await call(initiate, { order_id: ORDER })).statusCode).toBe(502)
    expect(h.db.data.payment_intents[0].status).toBe('failed')
    h.db.data.shop_orders[0].payment_reference = null
    h.db.data.shop_payments.forEach((p) => { p.status = 'failed' })
    h.provider.initializePayment.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'timeout', ambiguous: true }))
    expect((await call(initiate, { order_id: ORDER })).statusCode).toBe(502)
    expect(h.db.data.payment_intents[1].status).toBe('created')
  })
})

describe('verify-shop-payment', () => {
  const seed = (i = intent(), rpc = {}) => {
    h.db = createFakeSupabase({
      tables: { shop_orders: [order({ payment_reference: i?.reference ?? null })], shop_payments: [], payment_intents: i ? [i] : [], payment_provider_events: [], staff_notifications: [], shop_order_items: [] },
      rpc: { settle_payment_intent: async () => settledAnswer, track_purchase_pattern: async () => null, ...rpc },
    })
  }

  it('settles through the engine with Paystack\'s verified facts, then runs the effects once (vendor notice, confirmation email)', async () => {
    seed()
    const res = await call(verify, { reference: 'cf_shop_order000_aaaaaaaaaaaa', order_id: ORDER })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ success: true, id: ORDER, paid: true })
    expect(rpcNames()).toContain('settle_payment_intent')
    expect(h.db.calls.find((c) => c.name === 'settle_payment_intent').args).toEqual({ p_reference: 'cf_shop_order000_aaaaaaaaaaaa', p_provider: 'paystack', p_provider_txn_id: '9001', p_amount_kobo: TOTAL, p_currency: 'NGN' })
    expect(h.db.data.staff_notifications[0]).toMatchObject({ business_id: 'vendor-1', kind: 'shop_order_paid' })
    expect(h.enqueue.mock.calls[0][0]).toMatchObject({ templateKey: 'order_confirmation', toEmail: 'buyer@x.com', idempotencyKey: 'order-confirmation:order-0001' })
    // the legacy settlement functions are never called
    expect(rpcNames()).not.toContain('verify_shop_payment')
    expect(rpcNames()).not.toContain('claim_payment_event')
  })

  it('a replay (the webhook settled first): alreadyPaid, no second notice or email', async () => {
    seed(intent(), { settle_payment_intent: async () => ({ outcome: 'already_settled', purpose: 'shop_order' }) })
    const res = await call(verify, { reference: 'cf_shop_order000_aaaaaaaaaaaa' })
    expect(res.body).toMatchObject({ success: true, alreadyPaid: true })
    expect(h.enqueue).not.toHaveBeenCalled()
    expect(h.db.data.staff_notifications).toHaveLength(0)
  })

  it('the order was already paid by another attempt: it stays paid, this payment is queued for refund (200, needsRefund)', async () => {
    seed(intent(), { settle_payment_intent: async () => ({ outcome: 'needs_refund', purpose: 'shop_order', reason: 'already_paid' }) })
    const res = await call(verify, { reference: 'cf_shop_order000_aaaaaaaaaaaa' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ alreadyPaid: true, needsRefund: true })
  })

  it('a payment that could not be applied (amount changed) is a 409 needs-refund, no effects', async () => {
    seed(intent(), { settle_payment_intent: async () => ({ outcome: 'needs_refund', purpose: 'shop_order', reason: 'amount_changed' }) })
    const res = await call(verify, { reference: 'cf_shop_order000_aaaaaaaaaaaa' })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ needsRefund: true, reason: 'amount_changed' })
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('does not settle when Paystack does not report success', async () => {
    seed()
    h.provider.verifyPayment.mockResolvedValue(verifiedPayment({ status: 'abandoned', amountKobo: TOTAL }))
    const res = await call(verify, { reference: 'cf_shop_order000_aaaaaaaaaaaa' })
    expect(res.statusCode).toBe(400)
    expect(rpcNames()).not.toContain('settle_payment_intent')
  })

  it('refuses a reference that is not a shop payment, another customer\'s payment, and another order\'s reference; settles nothing', async () => {
    seed(intent({ purpose: 'wallet_topup' }))
    expect((await call(verify, { reference: 'cf_shop_order000_aaaaaaaaaaaa' })).statusCode).toBe(400)
    seed(intent({ customer_id: 'someone-else' }))
    expect((await call(verify, { reference: 'cf_shop_order000_aaaaaaaaaaaa' })).statusCode).toBe(403)
    seed(intent({ entity_id: 'order-OTHER' }))
    const res = await call(verify, { reference: 'cf_shop_order000_aaaaaaaaaaaa', order_id: ORDER })
    expect(res.statusCode).toBe(403)
    expect(rpcNames()).not.toContain('settle_payment_intent')
  })

  it('the redirect may arrive without a session: the unguessable reference is the handle, and money can only go to the intent\'s own order', async () => {
    seed()
    h.user = null
    const res = await call(verify, { reference: 'cf_shop_order000_aaaaaaaaaaaa' })
    expect(res.statusCode).toBe(200)
    expect(res.body.id).toBe(ORDER)
  })

  it('the client may name only the order: its latest attempt is used', async () => {
    seed()
    const res = await call(verify, { order_id: ORDER })
    expect(res.statusCode).toBe(200)
    expect(h.db.calls.find((c) => c.name === 'settle_payment_intent').args.p_reference).toBe('cf_shop_order000_aaaaaaaaaaaa')
    h.db.data.shop_orders[0].payment_reference = null
    expect((await call(verify, { order_id: ORDER })).statusCode).toBe(400)
    expect((await call(verify, {})).statusCode).toBe(400)
  })

  it('a reference from before payment intents: an already-paid order is reported paid, an unknown one is a 404; nothing is guessed', async () => {
    seed(null)
    h.db.data.shop_orders[0].payment_reference = 'legacy_ref_000001'
    expect((await call(verify, { reference: 'legacy_ref_000001' })).statusCode).toBe(404)
    Object.assign(h.db.data.shop_orders[0], { payment_status: 'paid', status: 'paid' })
    const res = await call(verify, { reference: 'legacy_ref_000001' })
    expect(res.body).toMatchObject({ success: true, alreadyPaid: true })
    expect(rpcNames()).not.toContain('settle_payment_intent')
  })
})
