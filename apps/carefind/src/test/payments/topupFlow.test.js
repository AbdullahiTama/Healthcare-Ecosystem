// @vitest-environment node
// Phase 04, flow 1: CareCoin top-up through a payment intent and the settlement engine.
// The engine itself (SQL) is proven in settlementEngine.db.test.js; here the handlers are checked to
// create the intent first, to let the SERVER decide the amount, and to settle only through the engine.
const h = vi.hoisted(() => ({ db: null, provider: null, user: { id: 'u1234567-aaaa', email: 'u@example.com' } }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (...a) => h.db.from(...a), rpc: (...a) => h.db.rpc(...a) }) }))
vi.mock('../../../api/_lib/verifyUser.js', () => ({ verifyUser: async () => h.user }))
vi.mock('../../../api/_lib/payments.js', () => ({ getPaystackProvider: () => h.provider, paymentLogger: { info() {}, warn() {}, error() {} } }))
vi.mock('../../../api/_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))

import initiate from '../../../api/_handlers/initiate-payment.js'
import verify from '../../../api/_handlers/verify-payment.js'
import { createFakeSupabase, createFakeProvider, createRes, verifiedPayment } from './fixtures/fakeSupabase.js'

const settleRpc = (outcome, extra = {}) => ({ settle_payment_intent: async () => ({ outcome, purpose: 'wallet_topup', ...extra }) })
const post = (handler, body) => { const res = createRes(); return handler({ method: 'POST', body, headers: { host: 'carefind.test' } }, res).then(() => res) }

beforeEach(() => {
  h.user = { id: 'u1234567-aaaa', email: 'u@example.com' }
  h.db = createFakeSupabase()
  h.provider = createFakeProvider()
})

describe('initiate-payment (top-up)', () => {
  it('creates the intent BEFORE calling Paystack, with the server-decided amount, coins and payer', async () => {
    const order = []
    h.db = createFakeSupabase()
    const origFrom = h.db.from
    h.db.from = (t) => { const b = origFrom(t); if (t === 'payment_intents') order.push(`db:${t}`); return b }
    h.provider.initializePayment.mockImplementation(async ({ reference }) => { order.push('paystack'); return { reference, authorizationUrl: 'https://checkout.test/x', accessCode: 'a' } })

    const res = await post(initiate, { packageId: 5, callback_url: 'https://carefind.test/cb' })
    expect(res.statusCode).toBe(200)
    expect(order[0]).toBe('db:payment_intents')
    expect(order).toContain('paystack')

    const intent = h.db.data.payment_intents[0]
    // The card is charged the package price PLUS the 10% processing fee (N950 + N95 = N1,045); the coins are whole.
    expect(intent).toMatchObject({
      purpose: 'wallet_topup', application: 'carefind', customer_id: h.user.id, expected_amount: 104_500, currency: 'NGN',
      metadata: { coins: 5, package_id: '5', base_amount_kobo: 95_000, fee_kobo: 9_500, fee_rate: 0.1 },
    })
    expect(intent.status).toBe('pending')
    expect(h.provider.initializePayment).toHaveBeenCalledWith(expect.objectContaining({ reference: intent.reference, amountKobo: 104_500, email: 'u@example.com' }))
    expect(res.body).toEqual({ authorization_url: expect.stringContaining('https://checkout.test/'), reference: intent.reference, base_kobo: 95_000, fee_kobo: 9_500, total_kobo: 104_500 })
  })

  it('ignores any amount, coins or user the client tries to supply', async () => {
    await post(initiate, { packageId: 1, callback_url: 'https://carefind.test/cb', amount: 1, naira: 1, coins: 99999, user_id: 'someone-else', customerId: 'someone-else' })
    const intent = h.db.data.payment_intents[0]
    expect(intent).toMatchObject({ customer_id: h.user.id, expected_amount: 22_000, metadata: { coins: 1, base_amount_kobo: 20_000, fee_kobo: 2_000 } })
  })

  it.each([[undefined], ['abc'], [0], [999], ['__proto__'], ['constructor'], ['toString']])('rejects package id %p without creating an intent or calling Paystack', async (packageId) => {
    const res = await post(initiate, { packageId, callback_url: 'https://carefind.test/cb' })
    expect(res.statusCode).toBe(400)
    expect(h.db.data.payment_intents || []).toHaveLength(0)
    expect(h.provider.initializePayment).not.toHaveBeenCalled()
  })

  it('requires a signed-in user and a callback url', async () => {
    h.user = null
    expect((await post(initiate, { packageId: 1, callback_url: 'https://carefind.test/cb' })).statusCode).toBe(401)
    h.user = { id: 'u1', email: 'u@example.com' }
    expect((await post(initiate, { packageId: 1 })).statusCode).toBe(400)
  })

  it('closes the intent when Paystack definitively refuses, but leaves it open on an ambiguous failure', async () => {
    h.provider.initializePayment.mockRejectedValue(Object.assign(new Error('Invalid key'), { code: 'provider_rejected', ambiguous: false }))
    const refused = await post(initiate, { packageId: 1, callback_url: 'https://carefind.test/cb' })
    expect(refused.statusCode).toBe(502)
    expect(h.db.data.payment_intents[0].status).toBe('failed')

    h.db = createFakeSupabase()
    h.provider.initializePayment.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'timeout', ambiguous: true }))
    const flaky = await post(initiate, { packageId: 1, callback_url: 'https://carefind.test/cb' })
    expect(flaky.statusCode).toBe(502)
    expect(h.db.data.payment_intents[0].status).toBe('created')
  })

  it('every request gets a different, unguessable reference', async () => {
    await post(initiate, { packageId: 1, callback_url: 'https://carefind.test/cb' })
    await post(initiate, { packageId: 1, callback_url: 'https://carefind.test/cb' })
    const [a, b] = h.db.data.payment_intents.map((i) => i.reference)
    expect(a).not.toBe(b)
    expect(a).toMatch(/^cf_topup_u1234567_[0-9a-f]{12}$/)
  })
})

describe('verify-payment (top-up redirect)', () => {
  const seedIntent = (over = {}) => ({ id: 'i1', reference: 'cf_topup_u1234567_aaaaaaaaaaaa', purpose: 'wallet_topup', customer_id: 'u1234567-aaaa', status: 'pending', expected_amount: 95000, ...over })

  it('settles through the engine with the PROVIDER\'s numbers and returns the credit', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seedIntent()] }, rpc: settleRpc('settled', { coins: 5, new_balance: 12 }) })
    h.provider = createFakeProvider({ verify: async () => verifiedPayment({ amountKobo: 95000, providerTransactionId: '777' }) })
    const res = await post(verify, { reference: 'cf_topup_u1234567_aaaaaaaaaaaa', coins: 99999, amount: 1 })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ credited: 5, newBalance: 12 })
    const rpc = h.db.calls.find((c) => c.op === 'rpc')
    expect(rpc.args).toEqual({ p_reference: 'cf_topup_u1234567_aaaaaaaaaaaa', p_provider: 'paystack', p_provider_txn_id: '777', p_amount_kobo: 95000, p_currency: 'NGN' })
  })

  it('answers a replay (webhook already settled it) as alreadyProcessed without asking Paystack again', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seedIntent({ status: 'settled' })] } })
    const res = await post(verify, { reference: 'cf_topup_u1234567_aaaaaaaaaaaa' })
    expect(res.body).toEqual({ alreadyProcessed: true })
    expect(h.provider.verifyPayment).not.toHaveBeenCalled()
  })

  it('refuses a reference that belongs to another user, before contacting Paystack', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seedIntent({ customer_id: 'someone-else' })] } })
    const res = await post(verify, { reference: 'cf_topup_u1234567_aaaaaaaaaaaa' })
    expect(res.statusCode).toBe(403)
    expect(h.provider.verifyPayment).not.toHaveBeenCalled()
  })

  it('refuses a reference of another purpose (a booking or subscription reference cannot credit a wallet)', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seedIntent({ purpose: 'booking' })] } })
    expect((await post(verify, { reference: 'cf_topup_u1234567_aaaaaaaaaaaa' })).statusCode).toBe(400)
  })

  it('404s a reference with no intent and never calls the engine', async () => {
    const res = await post(verify, { reference: 'unknown_reference_000' })
    expect(res.statusCode).toBe(404)
    expect(h.db.calls.some((c) => c.op === 'rpc')).toBe(false)
  })

  it('does not credit when Paystack says the payment is not successful', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seedIntent()] } })
    h.provider = createFakeProvider({ verify: async () => verifiedPayment({ status: 'abandoned' }) })
    const res = await post(verify, { reference: 'cf_topup_u1234567_aaaaaaaaaaaa' })
    expect(res.statusCode).toBe(400)
    expect(h.db.calls.some((c) => c.op === 'rpc')).toBe(false)
  })

  it('reports a payment the engine cannot apply as needing a refund (409), never as success', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seedIntent()] }, rpc: settleRpc('needs_refund', { reason: 'amount_mismatch' }) })
    h.provider = createFakeProvider({ verify: async () => verifiedPayment({ amountKobo: 1 }) })
    const res = await post(verify, { reference: 'cf_topup_u1234567_aaaaaaaaaaaa' })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ needsRefund: true, reason: 'amount_mismatch' })
  })

  it('answers 502 (retryable) when Paystack cannot be reached, and never exposes the provider error text', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seedIntent()] } })
    h.provider = createFakeProvider({ verify: async () => { throw Object.assign(new Error('Bearer sk_test_SECRETSECRET exploded'), { name: 'ProviderError', code: 'timeout' }) } })
    const res = await post(verify, { reference: 'cf_topup_u1234567_aaaaaaaaaaaa' })
    expect(res.statusCode).toBeGreaterThanOrEqual(500)
    expect(JSON.stringify(res.body)).not.toContain('SECRET')
  })

  it('requires sign-in', async () => {
    h.user = null
    expect((await post(verify, { reference: 'x' })).statusCode).toBe(401)
  })
})

describe('initiate-payment (top-up): the 10% processing fee is added on top, server-side', () => {
  it.each([[1, 20_000, 2_000], [5, 95_000, 9_500], [15, 270_000, 27_000], [50, 850_000, 85_000]])('package %p: base %p + fee %p, whole coins credited', async (packageId, base, fee) => {
    h.db = createFakeSupabase()
    const res = await post(initiate, { packageId, callback_url: 'https://carefind.test/cb' })
    expect(res.statusCode).toBe(200)
    const intent = h.db.data.payment_intents[0]
    expect(intent.expected_amount).toBe(base + fee)
    expect(intent.metadata).toMatchObject({ coins: packageId, base_amount_kobo: base, fee_kobo: fee })
    expect(Number.isInteger(intent.expected_amount)).toBe(true)
  })

  it('a client-supplied fee, total or rate is ignored', async () => {
    h.db = createFakeSupabase()
    await post(initiate, { packageId: 1, callback_url: 'https://carefind.test/cb', fee: 0, fee_kobo: 0, fee_rate: 0, total: 20_000, expected_amount: 20_000 })
    expect(h.db.data.payment_intents[0]).toMatchObject({ expected_amount: 22_000, metadata: { fee_kobo: 2_000, fee_rate: 0.1 } })
  })

  it('the rate is read from financial_config on every top-up (no deploy to change it)', async () => {
    h.db = createFakeSupabase({ tables: { financial_config: [{ key: 'topup_processing_fee_rate', value: 0.05 }] } })
    await post(initiate, { packageId: 1, callback_url: 'https://carefind.test/cb' })
    expect(h.db.data.payment_intents[0]).toMatchObject({ expected_amount: 21_000, metadata: { fee_kobo: 1_000, fee_rate: 0.05 } })
  })

  it('a rate of 0 means no fee', async () => {
    h.db = createFakeSupabase({ tables: { financial_config: [{ key: 'topup_processing_fee_rate', value: 0 }] } })
    await post(initiate, { packageId: 1, callback_url: 'https://carefind.test/cb' })
    expect(h.db.data.payment_intents[0]).toMatchObject({ expected_amount: 20_000, metadata: { fee_kobo: 0 } })
  })

  it('an unreadable or invalid rate falls back to 10% (it never waives the fee and never stops a top-up)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const value of [undefined, 7, 'abc']) {
      h.db = createFakeSupabase({ tables: value === undefined ? {} : { financial_config: [{ key: 'topup_processing_fee_rate', value }] } })
      const res = await post(initiate, { packageId: 1, callback_url: 'https://carefind.test/cb' })
      expect(res.statusCode).toBe(200)
      expect(h.db.data.payment_intents[0].expected_amount).toBe(22_000)
    }
    warn.mockRestore()
  })

  it('{ quote: true } returns the rate and creates nothing', async () => {
    h.db = createFakeSupabase()
    const res = await post(initiate, { quote: true })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ fee_rate: 0.1 })
    expect(h.db.data.payment_intents || []).toHaveLength(0)
    expect(h.provider.initializePayment).not.toHaveBeenCalled()
  })

  it('a quote still needs a signed-in user', async () => {
    h.user = null
    expect((await post(initiate, { quote: true })).statusCode).toBe(401)
  })
})

describe('initiate-payment: where the customer is sent back is never chosen by the browser (F-27)', () => {
  it.each([
  ['another host', 'https://evil.example/wallet'],
  ['a look-alike host', 'https://carefind.test.evil.example/wallet'],
  ['credentials in the URL', 'https://carefind.test@evil.example/wallet'],
  ['javascript:', 'javascript:alert(1)'],
  ['protocol-relative', '//evil.example/wallet'],
  ['a relative path', '/wallet'],
  ['plain http', 'http://carefind.test/wallet'],
])('refuses %s before any intent is created or Paystack is called', async (_label, callback_url) => {
    const res = await post(initiate, { ...{ packageId: 1 }, callback_url })
    expect(res.statusCode).toBe(400)
    expect(res.body.code).toBe('invalid_callback_url')
    expect(h.db.data.payment_intents || []).toHaveLength(0)
    expect(h.provider.initializePayment).not.toHaveBeenCalled()
  })

  it('passes the validated address to Paystack unchanged', async () => {
    const res = await post(initiate, { ...{ packageId: 1 }, callback_url: 'https://carefind.test/wallet?tab=topup' })
    expect(res.statusCode).toBe(200)
    expect(h.provider.initializePayment).toHaveBeenCalledWith(expect.objectContaining({ callbackUrl: 'https://carefind.test/wallet?tab=topup' }))
  })
})
