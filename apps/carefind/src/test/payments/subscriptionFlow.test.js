// @vitest-environment node
// Phase 04, flow 2: creator subscription by card. The PRICE is the creator's listed price, decided on
// the server (audit F-04); the 20% platform split and idempotency live in the engine (SQL tests).
const h = vi.hoisted(() => ({ db: null, provider: null, user: null }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (...a) => h.db.from(...a), rpc: (...a) => h.db.rpc(...a) }) }))
vi.mock('../../../api/_lib/verifyUser.js', () => ({ verifyUser: async () => h.user }))
vi.mock('../../../api/_lib/payments.js', () => ({ getPaystackProvider: () => h.provider, paymentLogger: { info() {}, warn() {}, error() {} } }))
vi.mock('../../../api/_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))

import charge from '../../../api/_handlers/charge-subscription.js'
import verify from '../../../api/_handlers/verify-subscription-payment.js'
import { clearFinancialConfigCache } from '../../../api/_lib/financialConfig.js'
import { createFakeSupabase, createFakeProvider, createRes, verifiedPayment } from './fixtures/fakeSupabase.js'

const config = [
  { key: 'coin_value_kobo', value: 20000 },
  { key: 'subscription_max_coins', value: 12 },
]
const post = (handler, body) => { const res = createRes(); return handler({ method: 'POST', body, headers: {} }, res).then(() => res) }
const world = (price, extra = {}) => createFakeSupabase({ tables: { profiles: [{ id: 'creator-1', subscription_price: price }], financial_config: config, ...extra } })

beforeEach(() => {
  clearFinancialConfigCache()
  h.user = { id: 'sub12345-aaaa', email: 's@example.com' }
  h.provider = createFakeProvider()
  h.db = world(12)
})

describe('charge-subscription: the price is the creator\'s, not the caller\'s', () => {
  it('creates an intent for the creator\'s LISTED price and charges exactly that', async () => {
    const res = await post(charge, { creatorId: 'creator-1', callback_url: 'https://app/cb' })
    expect(res.statusCode).toBe(200)
    const intent = h.db.data.payment_intents[0]
    expect(intent).toMatchObject({ purpose: 'creator_subscription', customer_id: h.user.id, entity_type: 'creator', entity_id: 'creator-1', expected_amount: 12 * 20000, metadata: { coins: 12 }, status: 'pending' })
    expect(h.provider.initializePayment).toHaveBeenCalledWith(expect.objectContaining({ amountKobo: 240000, reference: intent.reference }))
  })

  it.each([[1], [5.5], ['1'], [0], [-3], [99999], [{ $gt: 0 }]])('ignores a client price of %p', async (priceCoins) => {
    h.db = world(7)
    await post(charge, { creatorId: 'creator-1', priceCoins, price: priceCoins, amount: priceCoins, callback_url: 'https://app/cb' })
    expect(h.db.data.payment_intents[0].expected_amount).toBe(7 * 20000)
    expect(h.db.data.payment_intents[0].metadata.coins).toBe(7)
  })

  it.each([
    ['not listed (null)', null], ['zero', 0], ['negative', -5], ['above the cap (13)', 13], ['absurd (100)', 100], ['fractional', 5.5], ['a string', '5'],
  ])('refuses a creator whose listed price is %s, creating nothing and not calling Paystack', async (_l, price) => {
    h.db = world(price)
    const res = await post(charge, { creatorId: 'creator-1', callback_url: 'https://app/cb' })
    expect(res.statusCode).toBe(400)
    expect(h.db.data.payment_intents || []).toHaveLength(0)
    expect(h.provider.initializePayment).not.toHaveBeenCalled()
  })

  it('allows the cap exactly (12) and the minimum (1)', async () => {
    expect((await post(charge, { creatorId: 'creator-1', callback_url: 'x' })).statusCode).toBe(200)
    h.db = world(1)
    clearFinancialConfigCache()
    expect((await post(charge, { creatorId: 'creator-1', callback_url: 'x' })).statusCode).toBe(200)
    expect(h.db.data.payment_intents[0].expected_amount).toBe(20000)
  })

  it('refuses an unknown creator, subscribing to yourself, and missing fields', async () => {
    expect((await post(charge, { creatorId: 'nobody', callback_url: 'x' })).statusCode).toBe(400)
    expect((await post(charge, { creatorId: h.user.id, callback_url: 'x' })).statusCode).toBe(400)
    expect((await post(charge, { callback_url: 'x' })).statusCode).toBe(400)
    expect((await post(charge, { creatorId: 'creator-1' })).statusCode).toBe(400)
    expect((await post(charge, { creatorId: { $ne: null }, callback_url: 'x' })).statusCode).toBe(400)
    h.user = null
    expect((await post(charge, { creatorId: 'creator-1', callback_url: 'x' })).statusCode).toBe(401)
  })

  it('reads the cap and the coin value from financial_config, not from constants', async () => {
    h.db = world(13, { financial_config: [{ key: 'coin_value_kobo', value: 30000 }, { key: 'subscription_max_coins', value: 20 }] })
    await post(charge, { creatorId: 'creator-1', callback_url: 'x' })
    expect(h.db.data.payment_intents[0].expected_amount).toBe(13 * 30000)
  })

  it('never sends a Paystack subaccount split (the creator is paid through the CareCoin wallet)', async () => {
    await post(charge, { creatorId: 'creator-1', callback_url: 'x' })
    const sent = JSON.stringify(h.provider.initializePayment.mock.calls[0][0])
    expect(sent).not.toMatch(/subaccount|split/i)
  })
})

describe('verify-subscription-payment', () => {
  const ref = 'cf_sub_sub12345_aaaaaaaaaaaa'
  const seed = (over = {}) => ({ id: 'i1', reference: ref, purpose: 'creator_subscription', customer_id: 'sub12345-aaaa', entity_id: 'creator-1', status: 'pending', expected_amount: 240000, metadata: { coins: 12 }, ...over })
  const rpc = (r) => ({ settle_payment_intent: async () => r })

  it('settles through the engine and reports the coins', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed()], profiles: [{ id: 'creator-1', display_name: 'Dr C' }] }, rpc: rpc({ outcome: 'settled', purpose: 'creator_subscription', coins: 12, creator_coins: 9 }) })
    h.provider = createFakeProvider({ verify: async () => verifiedPayment({ amountKobo: 240000 }) })
    const res = await post(verify, { reference: ref })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ success: true, coins: 12 })
  })

  it('a replay is alreadyProcessed and never contacts Paystack', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ status: 'settled' })] } })
    const res = await post(verify, { reference: ref })
    expect(res.body).toMatchObject({ success: true, alreadyProcessed: true, coins: 12 })
    expect(h.provider.verifyPayment).not.toHaveBeenCalled()
  })

  it('refuses another user\'s reference and a reference of another purpose', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ customer_id: 'other' })] } })
    expect((await post(verify, { reference: ref })).statusCode).toBe(403)
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ purpose: 'wallet_topup' })] } })
    expect((await post(verify, { reference: ref })).statusCode).toBe(400)
  })

  it('a price that no longer matches (needs_refund) is reported as such, not as a subscription', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed()] }, rpc: rpc({ outcome: 'needs_refund', reason: 'price_mismatch' }) })
    h.provider = createFakeProvider({ verify: async () => verifiedPayment({ amountKobo: 240000 }) })
    const res = await post(verify, { reference: ref })
    expect(res.statusCode).toBe(409)
    expect(res.body.success).toBeUndefined()
  })
})
