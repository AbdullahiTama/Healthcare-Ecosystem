// @vitest-environment node
// Plan B2: the business-wallet top-up handlers. The engine itself (SQL) is proven in
// carefind's walletSpendAndTopup.db.test.js; here the handlers are checked to bound the
// amount on the server, record the intent for the verified business BEFORE Paystack,
// price exactly what the intent says, and settle only through the engine.
const h = vi.hoisted(() => ({ db: null, provider: null, auth: null }))

vi.mock('../_lib/supabase.js', () => ({
  supabase: { from: (...a) => h.db.from(...a), rpc: (...a) => h.db.rpc(...a), auth: { admin: { getUserById: (...a) => h.db.auth.admin.getUserById(...a) } } },
}))
vi.mock('../_lib/verifyBusiness.js', () => ({ verifyBusiness: async () => h.auth }))
vi.mock('../_lib/payments.js', () => ({ getPaystackProvider: () => h.provider, paymentLogger: { info() {}, warn() {}, error() {} } }))
vi.mock('../../src/lib/emailService.js', () => ({ emailService: { enqueue: async () => {}, processBatch: async () => {} } }))

import initiateTopup from '../_handlers/initiate-wallet-topup.js'
import verifyTopup from '../_handlers/verify-wallet-topup.js'
import { createFakeSupabase, createFakeProvider, createRes, verifiedPayment } from '@care-ecosystem/shared-payments/testing'

const post = (handler, body, headers = { host: 'carehub.test' }) => { const res = createRes(); return handler({ method: 'POST', body, headers }, res).then(() => res) }
const BIZ = { id: 'biz-1', email: 'owner@clinic.com', plan: 'growth', plan_expires_at: null, parent_business_id: null }
const rpc = (answer) => ({ settle_payment_intent: async (args, data) => (typeof answer === 'function' ? answer(args, data) : answer) })

beforeEach(() => {
  h.auth = { business: { ...BIZ } }
  h.provider = createFakeProvider()
  h.db = createFakeSupabase()
})

describe('initiate-wallet-topup', () => {
  it('records the intent for the verified business BEFORE Paystack and charges exactly that amount', async () => {
    const res = await post(initiateTopup, { amount: 500_000, callback_url: 'https://app/dashboard/wallet' })
    expect(res.statusCode).toBe(200)
    const intent = h.db.data.payment_intents[0]
    expect(intent).toMatchObject({ purpose: 'business_wallet_topup', application: 'carehub', business_id: 'biz-1', expected_amount: 500_000, status: 'pending' })
    expect(intent.reference).toMatch(/^ch_topup_biz1_[0-9a-f]{12}$/)
    expect(h.provider.initializePayment).toHaveBeenCalledWith(expect.objectContaining({ amountKobo: 500_000, email: 'owner@clinic.com', reference: intent.reference, callbackUrl: 'https://app/dashboard/wallet' }))
    expect(res.body).toEqual({ authorization_url: expect.stringContaining('https://checkout.test/'), reference: intent.reference })
  })

  it('ignores any purpose, business, application or amount the client tries to supply', async () => {
    await post(initiateTopup, { amount: 500_000, callback_url: 'x', purpose: 'plan_renewal', business_id: 'someone-else', application: 'carefind', expected_amount: 1 })
    expect(h.db.data.payment_intents[0]).toMatchObject({ purpose: 'business_wallet_topup', application: 'carehub', business_id: 'biz-1', expected_amount: 500_000 })
  })

  it.each([[9_999], [10_000_001], [1.5], [-100], [0], [null], [undefined], ['']])('refuses amount = %p without creating an intent or calling Paystack', async (amount) => {
    const res = await post(initiateTopup, { amount, callback_url: 'x' })
    expect(res.statusCode).toBe(400)
    expect(h.db.data.payment_intents || []).toHaveLength(0)
    expect(h.provider.initializePayment).not.toHaveBeenCalled()
  })

  it('refuses a missing callback, a non-POST method and an unverified caller', async () => {
    expect((await post(initiateTopup, { amount: 50_000 })).statusCode).toBe(400)
    const res = createRes()
    await initiateTopup({ method: 'GET', body: {}, headers: {} }, res)
    expect(res.statusCode).toBe(405)
    h.auth = { error: 'not_logged_in' }
    expect((await post(initiateTopup, { amount: 50_000, callback_url: 'x' })).statusCode).toBe(401)
    expect(h.db.data.payment_intents || []).toHaveLength(0)
  })

  it('closes the intent when Paystack refuses', async () => {
    h.provider.initializePayment.mockRejectedValue(Object.assign(new Error('Invalid key'), { code: 'provider_rejected', ambiguous: false }))
    expect((await post(initiateTopup, { amount: 50_000, callback_url: 'x' })).statusCode).toBe(502)
    expect(h.db.data.payment_intents[0].status).toBe('failed')
  })
})

describe('verify-wallet-topup', () => {
  const REF = 'ch_topup_biz1_aaaaaaaaaaaa'
  const seed = (over = {}) => ({ id: 'i1', reference: REF, purpose: 'business_wallet_topup', application: 'carehub', business_id: 'biz-1', status: 'pending', expected_amount: 500_000, metadata: {}, ...over })
  const settled = { outcome: 'settled', purpose: 'business_wallet_topup', intent_id: 'i1', new_available: 900_000 }

  it('settles through the engine with PAYSTACK\'s numbers and reports the new balance', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed()] }, rpc: rpc(settled) })
    h.provider = createFakeProvider({ verify: async () => verifiedPayment({ amountKobo: 500_000, providerTransactionId: '777' }) })
    const res = await post(verifyTopup, { reference: REF, amount: 1 })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ credited: true, newAvailable: 900_000 })
    expect(h.db.calls.find((c) => c.op === 'rpc').args).toEqual({ p_reference: REF, p_provider: 'paystack', p_provider_txn_id: '777', p_amount_kobo: 500_000, p_currency: 'NGN' })
    expect(h.db.calls.some((c) => /wallet/.test(c.table || ''))).toBe(false) // the handler moves no money itself
  })

  it('a replay (the webhook settled first): alreadyProcessed, Paystack not asked again', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ status: 'settled' })] } })
    const res = await post(verifyTopup, { reference: REF })
    expect(res.body).toEqual({ alreadyProcessed: true })
    expect(h.provider.verifyPayment).not.toHaveBeenCalled()
  })

  it('refuses another business\'s reference before contacting Paystack or the engine', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ business_id: 'biz-OTHER' })] } })
    const res = await post(verifyTopup, { reference: REF })
    expect(res.statusCode).toBe(403)
    expect(h.provider.verifyPayment).not.toHaveBeenCalled()
    expect(h.db.calls.some((c) => c.op === 'rpc')).toBe(false)
  })

  it('refuses a reference that is not a wallet top-up', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ purpose: 'plan_renewal' })] } })
    expect((await post(verifyTopup, { reference: REF })).statusCode).toBe(400)
    expect(h.provider.verifyPayment).not.toHaveBeenCalled()
  })

  it('a payment Paystack does not confirm is not credited; an unknown reference is a 404', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed()] } })
    h.provider = createFakeProvider({ verify: async () => verifiedPayment({ status: 'abandoned' }) })
    expect((await post(verifyTopup, { reference: REF })).statusCode).toBe(400)
    expect(h.db.data.payment_intents[0].status).toBe('failed')
    h.db = createFakeSupabase({ tables: { payment_intents: [seed()] } })
    expect((await post(verifyTopup, { reference: 'unknown_reference_01' })).statusCode).toBe(404)
  })

  it('a payment the engine cannot apply is 409 needs-refund, and a verified owner is required', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed()] }, rpc: rpc({ outcome: 'needs_refund', purpose: 'business_wallet_topup', reason: 'amount_mismatch' }) })
    h.provider = createFakeProvider({ verify: async () => verifiedPayment({ amountKobo: 500_000 }) })
    const res = await post(verifyTopup, { reference: REF })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ needsRefund: true, reason: 'amount_mismatch' })
    expect(res.body.credited).toBeUndefined()
    h.auth = { error: 'no_business' }
    expect((await post(verifyTopup, { reference: REF })).statusCode).toBe(401)
    h.auth = { business: { ...BIZ } }
    expect((await post(verifyTopup, {})).statusCode).toBe(400)
  })
})
