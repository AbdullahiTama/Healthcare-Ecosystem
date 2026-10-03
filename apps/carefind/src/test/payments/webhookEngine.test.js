// @vitest-environment node
// Phase 04: the Paystack webhook and the redirect handlers converge on ONE settlement. Real
// shared-payments code and the real handlers; only the database, Paystack and email are fakes.
// (The engine's SQL is proven in settlementEngine.db.test.js.)
import crypto from 'crypto'
import { EventEmitter } from 'events'

const h = vi.hoisted(() => ({ db: null, provider: null, creditTopup: null, enqueue: null, user: null }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (...a) => h.db.from(...a), rpc: (...a) => h.db.rpc(...a), auth: { admin: { getUserById: (...a) => h.db.auth.admin.getUserById(...a) } } }) }))
vi.mock('../../../api/_lib/paystack.js', () => ({ getPaystackSecretKey: () => 'sk_test_secret' }))
vi.mock('../../../api/_lib/payments.js', () => ({ getPaystackProvider: () => h.provider, paymentLogger: { info() {}, warn() {}, error() {} } }))
vi.mock('../../../api/_lib/paystackCredit.js', () => ({ creditTopup: (...a) => h.creditTopup(...a) }))
vi.mock('../../../api/_lib/consultationSettle.js', () => ({ settleConsultationPayment: vi.fn() }))
vi.mock('../../../api/_lib/emailService.js', () => ({ enqueue: (...a) => h.enqueue(...a), processBatch: vi.fn(async () => {}) }))
vi.mock('../../../api/_lib/verifyUser.js', () => ({ verifyUser: async () => h.user }))

import webhook from '../../../api/_handlers/paystack-webhook.js'
import verifyTopup from '../../../api/_handlers/verify-payment.js'
import { createFakeSupabase, createFakeProvider, createRes, verifiedPayment } from './fixtures/fakeSupabase.js'

const REF = 'cf_topup_u1234567_aaaaaaaaaaaa'
const intentRow = (over = {}) => ({ id: 'i1', reference: REF, purpose: 'wallet_topup', customer_id: 'u1234567-aaaa', status: 'pending', expected_amount: 95000, metadata: { coins: 5 }, ...over })
const chargeSuccess = (over = {}) => ({ event: 'charge.success', data: { id: 4099, reference: REF, amount: 95000, ...over } })

function signedRequest(body, { signature } = {}) {
  const raw = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  const req = new EventEmitter()
  req.method = 'POST'
  req.headers = { 'x-paystack-signature': signature ?? crypto.createHmac('sha512', 'sk_test_secret').update(raw).digest('hex') }
  setImmediate(() => { req.emit('data', raw); req.emit('end') })
  return req
}
const deliver = (body, opts) => { const res = createRes(); return webhook(signedRequest(body, opts), res).then(() => res) }
const redirect = () => { const res = createRes(); return verifyTopup({ method: 'POST', body: { reference: REF }, headers: {} }, res).then(() => res) }

// An engine that behaves like settle_payment_intent for the parts the handlers can observe:
// the first call settles (and flips the intent), a later call finds it settled.
function settlingEngine(extra = {}) {
  return {
    settle_payment_intent: async (args, data) => {
      const i = data.payment_intents.find((r) => r.reference === args.p_reference)
      if (i.status === 'settled') return { outcome: 'already_settled', purpose: i.purpose }
      i.status = 'settled'
      return { outcome: 'settled', purpose: i.purpose, coins: 5, new_balance: 5, ...extra }
    },
  }
}

beforeEach(() => {
  h.user = { id: 'u1234567-aaaa', email: 'u@example.com' }
  h.creditTopup = vi.fn(async () => ({ alreadyProcessed: false, newBalance: 1 }))
  h.enqueue = vi.fn(async () => {})
  h.provider = createFakeProvider({ verify: async () => verifiedPayment({ amountKobo: 95000, providerTransactionId: '4099' }) })
  h.db = createFakeSupabase({ tables: { payment_intents: [intentRow()], payment_provider_events: [] }, rpc: settlingEngine() })
})

const eventsOf = () => h.db.data.payment_provider_events
const engineCalls = () => h.db.calls.filter((c) => c.op === 'rpc' && c.name === 'settle_payment_intent')

describe('webhook -> settlement engine', () => {
  it('settles an intent payment through the engine with Paystack\'s verified facts, and never runs the legacy handlers', async () => {
    const res = await deliver(chargeSuccess())
    expect(res.statusCode).toBe(200)
    expect(engineCalls()).toHaveLength(1)
    expect(engineCalls()[0].args).toEqual({ p_reference: REF, p_provider: 'paystack', p_provider_txn_id: '4099', p_amount_kobo: 95000, p_currency: 'NGN' })
    expect(h.creditTopup).not.toHaveBeenCalled()
    expect(h.db.data.payment_intents[0].status).toBe('settled')
  })

  it('persists the event before processing and marks it processed', async () => {
    await deliver(chargeSuccess())
    expect(eventsOf()).toHaveLength(1)
    expect(eventsOf()[0]).toMatchObject({ provider: 'paystack', event_id: 'charge.success:4099', event_type: 'charge.success', reference: REF, signature_ok: true, outcome: 'processed', attempts: 1 })
    expect(eventsOf()[0].processed_at).toBeTruthy()
    const order = h.db.calls.filter((c) => c.table === 'payment_provider_events').map((c) => c.op)
    expect(order[0]).toBe('insert')
  })

  it('runs the confirmation side effects once, for the call that settled', async () => {
    await deliver(chargeSuccess())
    expect(h.enqueue).toHaveBeenCalledTimes(1)
    expect(h.enqueue.mock.calls[0][0]).toMatchObject({ templateKey: 'payment_success', idempotencyKey: `payment-success:${REF}` })
  })

  it('a webhook then a redirect settle once: the redirect sees alreadyProcessed, no second email, no second engine call', async () => {
    await deliver(chargeSuccess())
    const res = await redirect()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ alreadyProcessed: true })
    expect(engineCalls()).toHaveLength(1)
    expect(h.enqueue).toHaveBeenCalledTimes(1)
  })

  it('a redirect then a webhook settle once too (the other order)', async () => {
    const res = await redirect()
    expect(res.body).toMatchObject({ credited: 5 })
    const hook = await deliver(chargeSuccess())
    expect(hook.statusCode).toBe(200)
    expect(engineCalls()).toHaveLength(1)
    expect(h.enqueue).toHaveBeenCalledTimes(1)
  })

  it('a duplicate delivery of an already-handled event is acknowledged without reprocessing', async () => {
    await deliver(chargeSuccess())
    h.provider.verifyPayment.mockClear()
    const again = await deliver(chargeSuccess())
    expect(again.statusCode).toBe(200)
    expect(again.body).toEqual({ received: true, duplicate: true })
    expect(h.provider.verifyPayment).not.toHaveBeenCalled()
    expect(engineCalls()).toHaveLength(1)
    expect(eventsOf()).toHaveLength(1)
  })

  it('a failed attempt answers 500, stays retryable (processed_at unset), and the retry succeeds', async () => {
    h.provider.verifyPayment.mockRejectedValueOnce(new Error('provider timeout'))
    const first = await deliver(chargeSuccess())
    expect(first.statusCode).toBe(500)
    expect(eventsOf()[0]).toMatchObject({ outcome: 'failed', attempts: 1 })
    expect(eventsOf()[0].processed_at).toBeUndefined()
    expect(h.db.data.payment_intents[0].status).toBe('pending')

    const retry = await deliver(chargeSuccess())
    expect(retry.statusCode).toBe(200)
    expect(eventsOf()).toHaveLength(1)
    expect(eventsOf()[0]).toMatchObject({ outcome: 'processed', attempts: 2 })
    expect(h.db.data.payment_intents[0].status).toBe('settled')
  })

  it('answers 500 (so Paystack redelivers) when charge.success is delivered but Paystack still reports the payment as pending', async () => {
    h.provider = createFakeProvider({ verify: async () => verifiedPayment({ status: 'pending' }) })
    expect((await deliver(chargeSuccess())).statusCode).toBe(500)
    expect(engineCalls()).toHaveLength(0)
  })

  it('a payment the engine cannot apply is acknowledged (never dropped, never retried forever) and parked as needs_refund', async () => {
    h.db = createFakeSupabase({
      tables: { payment_intents: [intentRow()], payment_provider_events: [] },
      rpc: { settle_payment_intent: async () => ({ outcome: 'needs_refund', purpose: 'wallet_topup', reason: 'amount_mismatch' }) },
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await deliver(chargeSuccess())
    expect(res.statusCode).toBe(200)
    expect(eventsOf()[0].outcome).toBe('processed')
    expect(err.mock.calls.some(([tag]) => tag === '[payment-needs-refund]')).toBe(true)
    expect(h.enqueue).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('answers 500 when the engine refuses the payment (rejected), so it is re-examined', async () => {
    h.db = createFakeSupabase({
      tables: { payment_intents: [intentRow()], payment_provider_events: [] },
      rpc: { settle_payment_intent: async () => ({ outcome: 'rejected', reason: 'transaction_id_conflict' }) },
    })
    expect((await deliver(chargeSuccess())).statusCode).toBe(500)
  })
})

describe('webhook: transition and hygiene', () => {
  it('a payment with no intent (started before the engine) still goes through the legacy metadata path', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [], payment_provider_events: [] } })
    const res = await deliver({ event: 'charge.success', data: { id: 7, reference: 'legacy_ref_00001', amount: 100000, metadata: { user_id: 'u1', coins: '5' } } })
    expect(res.statusCode).toBe(200)
    expect(h.creditTopup).toHaveBeenCalledTimes(1)
    expect(h.db.calls.filter((c) => c.name === 'settle_payment_intent')).toHaveLength(0)
    expect(eventsOf()[0].outcome).toBe('processed')
  })

  it('an event nobody handles is recorded as ignored and acknowledged', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [], payment_provider_events: [] } })
    const res = await deliver({ event: 'charge.success', data: { id: 8, reference: 'orphan_ref_00001', amount: 100, metadata: {} } })
    expect(res.statusCode).toBe(200)
    expect(eventsOf()[0].outcome).toBe('ignored')
    const other = await deliver({ event: 'customeridentification.success', data: { id: 9 } })
    expect(other.statusCode).toBe(200)
  })

  it('rejects a bad signature before anything is recorded or verified', async () => {
    const res = await deliver(chargeSuccess(), { signature: 'f'.repeat(128) })
    expect(res.statusCode).toBe(401)
    expect(eventsOf()).toHaveLength(0)
    expect(h.provider.verifyPayment).not.toHaveBeenCalled()
  })

  it('a correctly signed but non-JSON body is a 400, not a retry storm', async () => {
    const res = await deliver('this is not json')
    expect(res.statusCode).toBe(400)
    expect(eventsOf()).toHaveLength(0)
  })

  it('answers 500 if the event cannot be persisted (so Paystack retries) and settles nothing', async () => {
    const realFrom = h.db.from
    h.db.from = (t) => (t === 'payment_provider_events' ? { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: 'XX000', message: 'db down' } }) }) }) } : realFrom(t))
    const res = await deliver(chargeSuccess())
    expect(res.statusCode).toBe(500)
    expect(engineCalls()).toHaveLength(0)
  })

  it('an event without data.id is still persisted, keyed by its reference, and settled', async () => {
    const res = await deliver({ event: 'charge.success', data: { reference: REF, amount: 95000 } })
    expect(res.statusCode).toBe(200)
    expect(eventsOf()[0].event_id).toBe(`charge.success:${REF}`)
    expect(engineCalls()).toHaveLength(1)
  })

  it('an event with no id and no reference at all is acknowledged but cannot be persisted or settled', async () => {
    const res = await deliver({ event: 'charge.success', data: { amount: 95000, metadata: {} } })
    expect(res.statusCode).toBe(200)
    expect(eventsOf()).toHaveLength(0)
    expect(engineCalls()).toHaveLength(0)
  })
})
