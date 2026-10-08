// @vitest-environment node
// Phase 04, flow 3: professional consultation by card. The fee is the professional's offer, decided on
// the server; a card payment never debits CareCoins (engine proven in settlementEngine.db.test.js).
const h = vi.hoisted(() => ({ db: null, provider: null, user: null }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (...a) => h.db.from(...a), rpc: (...a) => h.db.rpc(...a) }) }))
vi.mock('../../../api/_lib/verifyUser.js', () => ({ verifyUser: async () => h.user }))
vi.mock('../../../api/_lib/payments.js', () => ({ getPaystackProvider: () => h.provider, paymentLogger: { info() {}, warn() {}, error() {} } }))
vi.mock('../../../api/_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))

import charge from '../../../api/_handlers/charge-consultation.js'
import verify from '../../../api/_handlers/verify-consultation-payment.js'
import createSubaccount from '../../../api/_handlers/create-subaccount.js'
import { createFakeSupabase, createFakeProvider, createRes, verifiedPayment } from './fixtures/fakeSupabase.js'

const post = (handler, body) => { const res = createRes(); return handler({ method: 'POST', body, headers: {} }, res).then(() => res) }
const offer = (fee, over = {}) => ({ id: 'o1', professional_id: 'pro-1', patient_id: 'pro-1', status: 'setup', fee, type: 'video', ...over })

beforeEach(() => {
  h.user = { id: 'patient1-aaaa', email: 'p@example.com' }
  h.provider = createFakeProvider()
  h.db = createFakeSupabase({ tables: { professional_consultations: [offer(5000)] } })
})

describe('charge-consultation: the fee is the professional\'s offer', () => {
  it('creates an intent in kobo for the offered fee and charges exactly that', async () => {
    const res = await post(charge, { professionalId: 'pro-1', callback_url: 'https://app/cb' })
    expect(res.statusCode).toBe(200)
    const intent = h.db.data.payment_intents[0]
    expect(intent).toMatchObject({ purpose: 'consultation', customer_id: h.user.id, entity_type: 'professional', entity_id: 'pro-1', expected_amount: 500000, status: 'pending' })
    expect(h.provider.initializePayment).toHaveBeenCalledWith(expect.objectContaining({ amountKobo: 500000 }))
  })

  it.each([[1], ['1'], [0], [-5], [{ $gt: 0 }]])('ignores a client fee of %p', async (fee) => {
    await post(charge, { professionalId: 'pro-1', fee, amount: fee, price: fee, callback_url: 'x' })
    expect(h.db.data.payment_intents[0].expected_amount).toBe(500000)
  })

  it('rounds a fractional-naira offer to whole kobo (N1,049.99 = 104999 kobo)', async () => {
    h.db = createFakeSupabase({ tables: { professional_consultations: [offer(1049.99)] } })
    await post(charge, { professionalId: 'pro-1', callback_url: 'x' })
    expect(h.db.data.payment_intents[0].expected_amount).toBe(104999)
  })

  it.each([[null], [0], [-100], ['abc'], [0.001]])('refuses an offer with fee %p', async (fee) => {
    h.db = createFakeSupabase({ tables: { professional_consultations: [offer(fee)] } })
    const res = await post(charge, { professionalId: 'pro-1', callback_url: 'x' })
    expect(res.statusCode).toBe(400)
    expect(h.db.data.payment_intents || []).toHaveLength(0)
    expect(h.provider.initializePayment).not.toHaveBeenCalled()
  })

  it('refuses a professional with no offer, booking yourself, and malformed input', async () => {
    expect((await post(charge, { professionalId: 'nobody', callback_url: 'x' })).statusCode).toBe(400)
    expect((await post(charge, { professionalId: h.user.id, callback_url: 'x' })).statusCode).toBe(400)
    expect((await post(charge, { professionalId: { $ne: null }, callback_url: 'x' })).statusCode).toBe(400)
    expect((await post(charge, { callback_url: 'x' })).statusCode).toBe(400)
    h.user = null
    expect((await post(charge, { professionalId: 'pro-1', callback_url: 'x' })).statusCode).toBe(401)
  })

  it('does not take money for a booking the patient already has', async () => {
    h.db = createFakeSupabase({ tables: { professional_consultations: [offer(5000), { id: 'b1', professional_id: 'pro-1', patient_id: h.user.id, status: 'paid', fee: 5000 }] } })
    const res = await post(charge, { professionalId: 'pro-1', callback_url: 'x' })
    expect(res.statusCode).toBe(409)
    expect(res.body.alreadyBooked).toBe(true)
    expect(h.db.data.payment_intents || []).toHaveLength(0)
    expect(h.provider.initializePayment).not.toHaveBeenCalled()
  })

  it('never splits the payment at Paystack, and never reads or writes the patient\'s CareCoin wallet', async () => {
    await post(charge, { professionalId: 'pro-1', callback_url: 'x' })
    expect(JSON.stringify(h.provider.initializePayment.mock.calls[0][0])).not.toMatch(/subaccount|split|transaction_charge/i)
    expect(h.db.calls.some((c) => c.table === 'wallets' || (c.op === 'rpc' && /wallet|pay_/.test(c.name)))).toBe(false)
  })

  it('create-subaccount stays disabled', async () => {
    const res = createRes()
    await createSubaccount({ method: 'POST', body: { bankCode: '1', accountNumber: '1', accountName: 'x' }, headers: {} }, res)
    expect(res.statusCode).toBe(410)
  })
})

describe('verify-consultation-payment', () => {
  const ref = 'cf_consult_patient1_aaaaaaaaaaaa'
  const seed = (over = {}) => ({ id: 'i1', reference: ref, purpose: 'consultation', customer_id: 'patient1-aaaa', entity_id: 'pro-1', status: 'pending', expected_amount: 500000, ...over })
  const rpc = (r) => ({ settle_payment_intent: async () => r })
  const verified = () => createFakeProvider({ verify: async () => verifiedPayment({ amountKobo: 500000 }) })

  it('settles through the engine and never touches wallets itself', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed()] }, rpc: rpc({ outcome: 'settled', purpose: 'consultation', professional_coins: 20 }) })
    h.provider = verified()
    const res = await post(verify, { reference: ref })
    expect(res.body).toEqual({ success: true, alreadyProcessed: false, alreadyBooked: false })
    expect(h.db.calls.filter((c) => c.op === 'rpc').map((c) => c.name)).toEqual(['settle_payment_intent'])
    expect(h.db.calls.some((c) => c.table === 'wallets')).toBe(false)
  })

  it('a replay is alreadyProcessed and never contacts Paystack', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ status: 'settled' })] } })
    expect((await post(verify, { reference: ref })).body).toMatchObject({ success: true, alreadyProcessed: true })
    expect(h.provider.verifyPayment).not.toHaveBeenCalled()
  })

  it('a patient who already booked keeps the booking and the card payment is flagged for refund', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed()] }, rpc: rpc({ outcome: 'needs_refund', purpose: 'consultation', reason: 'already_booked' }) })
    h.provider = verified()
    const res = await post(verify, { reference: ref })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ success: true, alreadyBooked: true, needsRefund: true })
  })

  it('any other needs_refund is not reported as a booking', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed()] }, rpc: rpc({ outcome: 'needs_refund', reason: 'amount_mismatch' }) })
    h.provider = verified()
    const res = await post(verify, { reference: ref })
    expect(res.statusCode).toBe(409)
    expect(res.body.success).toBeUndefined()
  })

  it('refuses another user\'s reference and a reference of another purpose', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ customer_id: 'other' })] } })
    expect((await post(verify, { reference: ref })).statusCode).toBe(403)
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ purpose: 'booking' })] } })
    expect((await post(verify, { reference: ref })).statusCode).toBe(400)
  })
})
