// @vitest-environment node
// Phase 06: CareHub plan payments and appointment payments through payment intents and the settlement
// engine. The engine itself (SQL) is proven in carehubSettlement.db.test.js; here the handlers are checked
// to price on the server, record the intent first, authorise by business, and settle only via the engine.
const h = vi.hoisted(() => ({ db: null, provider: null, auth: null, commission: vi.fn(), enqueue: vi.fn(), flush: vi.fn() }))

vi.mock('../_lib/supabase.js', () => ({
  supabase: { from: (...a) => h.db.from(...a), rpc: (...a) => h.db.rpc(...a), auth: { admin: { getUserById: (...a) => h.db.auth.admin.getUserById(...a) } } },
}))
vi.mock('../_lib/verifyBusiness.js', () => ({ verifyBusiness: async () => h.auth }))
vi.mock('../_lib/payments.js', () => ({ getPaystackProvider: () => h.provider, paymentLogger: { info() {}, warn() {}, error() {} } }))
vi.mock('../_lib/commissions.js', () => ({ computeCommission: (...a) => h.commission(...a) }))
vi.mock('../../src/lib/emailService.js', () => ({ emailService: { enqueue: (...a) => h.enqueue(...a), processBatch: (...a) => h.flush(...a) } }))

import initiatePlan from '../_handlers/initiate-plan-payment.js'
import verifyPlan from '../_handlers/verify-plan-payment.js'
import initiateAppt from '../_handlers/initiate-appointment-payment.js'
import verifyAppt from '../_handlers/verify-appointment-payment.js'
import { createFakeSupabase, createFakeProvider, createRes, verifiedPayment } from '@care-ecosystem/shared-payments/testing'

const post = (handler, body, headers = { host: 'carehub.test' }) => { const res = createRes(); return handler({ method: 'POST', body, headers }, res).then(() => res) }
const BIZ = { id: 'biz-1', email: 'owner@clinic.com', plan: 'growth', plan_expires_at: null, parent_business_id: null }
const rpc = (answer) => ({ settle_payment_intent: async (args, data) => (typeof answer === 'function' ? answer(args, data) : answer) })

beforeEach(() => {
  h.auth = { business: { ...BIZ } }
  h.provider = createFakeProvider()
  h.db = createFakeSupabase()
  h.commission.mockReset().mockResolvedValue({})
  h.enqueue.mockReset().mockResolvedValue(undefined)
  h.flush.mockReset().mockResolvedValue(undefined)
})

describe('initiate-plan-payment', () => {
  it('prices the plan on the server, records the intent for the verified business BEFORE Paystack, and charges exactly that', async () => {
    const res = await post(initiatePlan, { months: 1, callback_url: 'https://app/cb' })
    expect(res.statusCode).toBe(200)
    const intent = h.db.data.payment_intents[0]
    expect(intent).toMatchObject({ purpose: 'plan_renewal', application: 'carehub', business_id: 'biz-1', expected_amount: 8333 * 100, metadata: { months: 1, plan: 'growth' }, status: 'pending' })
    expect(h.provider.initializePayment).toHaveBeenCalledWith(expect.objectContaining({ amountKobo: 833300, email: 'owner@clinic.com', reference: intent.reference }))
    expect(res.body).toEqual({ authorization_url: expect.stringContaining('https://checkout.test/'), reference: intent.reference })
    expect(intent.reference).toMatch(/^ch_plan_biz1_[0-9a-f]{12}$/)
  })

  it('the annual option charges the yearly price (N100,000 for growth)', async () => {
    await post(initiatePlan, { months: 12, callback_url: 'x' })
    expect(h.db.data.payment_intents[0].expected_amount).toBe(100000 * 100)
  })

  it('ignores any amount, plan, business or user the client tries to supply', async () => {
    await post(initiatePlan, { months: 1, callback_url: 'x', amount: 1, price: 1, naira: 1, plan: 'enterprise', business_id: 'someone-else', businessId: 'someone-else' })
    expect(h.db.data.payment_intents[0]).toMatchObject({ business_id: 'biz-1', expected_amount: 833300, metadata: { plan: 'growth' } })
  })

  it.each([[3], ['1'], [0], [24], [1.5], [-1], [null], [undefined]])('refuses months = %p without creating an intent or calling Paystack', async (months) => {
    const res = await post(initiatePlan, { months, callback_url: 'x' })
    expect(res.statusCode).toBe(400)
    expect(h.db.data.payment_intents || []).toHaveLength(0)
    expect(h.provider.initializePayment).not.toHaveBeenCalled()
  })

  it('refuses a custom plan, an unknown plan, a missing callback and an unverified caller', async () => {
    h.auth = { business: { ...BIZ, plan: 'custom' } }
    expect((await post(initiatePlan, { months: 1, callback_url: 'x' })).statusCode).toBe(400)
    h.auth = { business: { ...BIZ, plan: 'mystery' } }
    expect((await post(initiatePlan, { months: 1, callback_url: 'x' })).statusCode).toBe(400)
    h.auth = { business: { ...BIZ } }
    expect((await post(initiatePlan, { months: 1 })).statusCode).toBe(400)
    h.auth = { error: 'not_logged_in' }
    expect((await post(initiatePlan, { months: 1, callback_url: 'x' })).statusCode).toBe(401)
    expect(h.provider.initializePayment).not.toHaveBeenCalled()
  })

  it('closes the intent when Paystack refuses, leaves it open on an ambiguous failure', async () => {
    h.provider.initializePayment.mockRejectedValue(Object.assign(new Error('Invalid key'), { code: 'provider_rejected', ambiguous: false }))
    expect((await post(initiatePlan, { months: 1, callback_url: 'x' })).statusCode).toBe(502)
    expect(h.db.data.payment_intents[0].status).toBe('failed')
    h.db = createFakeSupabase()
    h.provider.initializePayment.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'timeout', ambiguous: true }))
    await post(initiatePlan, { months: 1, callback_url: 'x' })
    expect(h.db.data.payment_intents[0].status).toBe('created')
  })

  it('every attempt gets its own reference', async () => {
    await post(initiatePlan, { months: 1, callback_url: 'x' })
    await post(initiatePlan, { months: 1, callback_url: 'x' })
    const [a, b] = h.db.data.payment_intents.map((i) => i.reference)
    expect(a).not.toBe(b)
  })
})

describe('verify-plan-payment', () => {
  const REF = 'ch_plan_biz1_aaaaaaaaaaaa'
  const seed = (over = {}) => ({ id: 'i1', reference: REF, purpose: 'plan_renewal', business_id: 'biz-1', status: 'pending', expected_amount: 833300, metadata: { months: 1 }, ...over })
  const settledAnswer = { outcome: 'settled', purpose: 'plan_renewal', payment_id: 'pay-1', new_expiry: '2026-11-05T00:00:00Z', is_first_payment: true, months: 1 }
  const verified = () => createFakeProvider({ verify: async () => verifiedPayment({ amountKobo: 833300, providerTransactionId: '777' }) })

  it('settles through the engine with PAYSTACK\'s numbers, then computes the commission once and emails the owner', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed()], businesses: [{ id: 'biz-1', name: 'Clinic', plan: 'growth', plan_expires_at: '2026-11-05T00:00:00Z', owner_name: 'Dr Obi', owner_email: 'o@x.com' }] }, rpc: rpc(settledAnswer) })
    h.provider = verified()
    const res = await post(verifyPlan, { reference: REF, months: 99, amount: 1 })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ credited: true, newExpiry: '2026-11-05T00:00:00Z' })
    expect(h.db.calls.find((c) => c.op === 'rpc').args).toEqual({ p_reference: REF, p_provider: 'paystack', p_provider_txn_id: '777', p_amount_kobo: 833300, p_currency: 'NGN' })
    expect(h.commission).toHaveBeenCalledTimes(1)
    expect(h.commission).toHaveBeenCalledWith(expect.anything(), { paymentId: 'pay-1', businessId: 'biz-1', nairaCharged: 8333, isFirstPayment: true })
    expect(h.enqueue).toHaveBeenCalledTimes(1)
    expect(h.enqueue.mock.calls[0][0]).toMatchObject({ templateKey: 'subscription_created', toEmail: 'o@x.com', idempotencyKey: `subscription-started:${REF}` })
  })

  it('a commission failure never fails the renewal', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed()], businesses: [{ id: 'biz-1', name: 'C', owner_email: 'o@x.com' }] }, rpc: rpc(settledAnswer) })
    h.provider = verified()
    h.commission.mockRejectedValue(new Error('commission db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await post(verifyPlan, { reference: REF })).statusCode).toBe(200)
    err.mockRestore()
  })

  it('refuses another business\'s reference before contacting Paystack or the engine', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ business_id: 'biz-OTHER' })] } })
    const res = await post(verifyPlan, { reference: REF })
    expect(res.statusCode).toBe(403)
    expect(h.provider.verifyPayment).not.toHaveBeenCalled()
    expect(h.db.calls.some((c) => c.op === 'rpc')).toBe(false)
  })

  it('refuses a reference that is not a plan payment (an appointment reference cannot extend a plan)', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ purpose: 'appointment' })] } })
    expect((await post(verifyPlan, { reference: REF })).statusCode).toBe(400)
  })

  it('a replay (the webhook settled first): alreadyProcessed, no second email, commission attempted idempotently from the stored payment', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ status: 'settled' })], plan_payments: [{ id: 'pay-9', reference: REF, is_first_payment: false }] } })
    const res = await post(verifyPlan, { reference: REF })
    expect(res.body).toEqual({ alreadyProcessed: true })
    expect(h.provider.verifyPayment).not.toHaveBeenCalled()
    expect(h.enqueue).not.toHaveBeenCalled()
    expect(h.commission).toHaveBeenCalledWith(expect.anything(), { paymentId: 'pay-9', businessId: 'biz-1', nairaCharged: 8333, isFirstPayment: false })
  })

  it('a payment the engine cannot apply is 409 needs-refund: no commission, no email, no renewal reported', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed()] }, rpc: rpc({ outcome: 'needs_refund', purpose: 'plan_renewal', reason: 'amount_mismatch' }) })
    h.provider = verified()
    const res = await post(verifyPlan, { reference: REF })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ needsRefund: true, reason: 'amount_mismatch' })
    expect(res.body.credited).toBeUndefined()
    expect(h.commission).not.toHaveBeenCalled()
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('does not renew when Paystack does not report success; 404s an unknown reference; needs a verified owner', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed()] } })
    h.provider = createFakeProvider({ verify: async () => verifiedPayment({ status: 'abandoned' }) })
    expect((await post(verifyPlan, { reference: REF })).statusCode).toBe(400)
    expect(h.db.calls.some((c) => c.op === 'rpc')).toBe(false)
    expect((await post(verifyPlan, { reference: 'unknown_reference_01' })).statusCode).toBe(404)
    h.auth = { error: 'no_business' }
    expect((await post(verifyPlan, { reference: REF })).statusCode).toBe(401)
  })
})

describe('initiate-appointment-payment', () => {
  const appt = (over = {}) => ({ id: 'a1b2c3d4-0000', business_id: 'biz-1', fee_amount: 150050, payment_status: 'unpaid', payment_reference: null, ...over })

  it('records an intent for the appointment\'s OWN fee before Paystack and points the appointment at the new reference', async () => {
    h.db = createFakeSupabase({ tables: { appointments: [appt()] } })
    const res = await post(initiateAppt, { appointment_id: 'a1b2c3d4-0000', fee: 1, amount: 1 })
    expect(res.statusCode).toBe(200)
    const intent = h.db.data.payment_intents[0]
    expect(intent).toMatchObject({ purpose: 'appointment', application: 'carehub', business_id: 'biz-1', entity_type: 'appointment', entity_id: 'a1b2c3d4-0000', expected_amount: 150050, status: 'pending' })
    expect(h.provider.initializePayment).toHaveBeenCalledWith(expect.objectContaining({ amountKobo: 150050, reference: intent.reference }))
    expect(h.db.data.appointments[0].payment_reference).toBe(intent.reference)
    expect(res.body).toMatchObject({ reference: intent.reference, fee: 150050 })
  })

  it('a retry after an abandoned attempt gets a NEW reference (Paystack refuses to reuse one) and the appointment follows it', async () => {
    h.db = createFakeSupabase({ tables: { appointments: [appt()] } })
    await post(initiateAppt, { appointment_id: 'a1b2c3d4-0000' })
    await post(initiateAppt, { appointment_id: 'a1b2c3d4-0000' })
    const refs = h.db.data.payment_intents.map((i) => i.reference)
    expect(new Set(refs).size).toBe(2)
    expect(h.db.data.appointments[0].payment_reference).toBe(refs[1])
  })

  it.each([
    ['another business\'s appointment', { business_id: 'biz-OTHER' }, 404],
    ['an already paid appointment', { payment_status: 'paid' }, 400],
    ['no fee', { fee_amount: null }, 400],
    ['a zero fee', { fee_amount: 0 }, 400],
    ['a fractional fee', { fee_amount: 100.5 }, 400],
  ])('refuses %s, creating nothing', async (_l, over, status) => {
    h.db = createFakeSupabase({ tables: { appointments: [appt(over)] } })
    const res = await post(initiateAppt, { appointment_id: 'a1b2c3d4-0000' })
    expect(res.statusCode).toBe(status)
    expect(h.db.data.payment_intents || []).toHaveLength(0)
    expect(h.provider.initializePayment).not.toHaveBeenCalled()
  })

  it('needs an appointment id (and not an object smuggled in) and a verified owner', async () => {
    h.db = createFakeSupabase({ tables: { appointments: [appt()] } })
    expect((await post(initiateAppt, {})).statusCode).toBe(400)
    expect((await post(initiateAppt, { appointment_id: { $ne: null } })).statusCode).toBe(400)
    h.auth = { error: 'not_logged_in' }
    expect((await post(initiateAppt, { appointment_id: 'a1b2c3d4-0000' })).statusCode).toBe(401)
  })

  it('closes the intent on a refusal and leaves the appointment untouched', async () => {
    h.db = createFakeSupabase({ tables: { appointments: [appt()] } })
    h.provider.initializePayment.mockRejectedValue(Object.assign(new Error('no'), { code: 'provider_rejected', ambiguous: false }))
    expect((await post(initiateAppt, { appointment_id: 'a1b2c3d4-0000' })).statusCode).toBe(502)
    expect(h.db.data.payment_intents[0].status).toBe('failed')
    expect(h.db.data.appointments[0].payment_reference).toBeNull()
  })
})

describe('verify-appointment-payment', () => {
  const REF = 'ch_appt_a1b2c3d4_aaaaaaaaaaaa'
  const seed = (over = {}) => ({ id: 'i1', reference: REF, purpose: 'appointment', business_id: 'biz-1', entity_id: 'a1', status: 'pending', expected_amount: 150050, ...over })
  const apptRow = { id: 'a1', business_id: 'biz-1', client_name: 'Ada', date: '2026-10-10', time: '10:00', fee_amount: 150050, client_email: 'ada@x.com', service: 'Consult', source: 'carehub' }
  const world = (answer, extra = {}) => createFakeSupabase({ tables: { payment_intents: [seed()], appointments: [apptRow], businesses: [{ id: 'biz-1', name: 'Clinic' }], staff_notifications: [], ...extra }, rpc: rpc(answer) })
  const verified = () => createFakeProvider({ verify: async () => verifiedPayment({ amountKobo: 150050 }) })

  it('settles through the engine, notifies the business once and confirms to the client with the CareHub template', async () => {
    h.db = world({ outcome: 'settled', purpose: 'appointment', business_kobo: 120040, platform_kobo: 30010 })
    h.provider = verified()
    const res = await post(verifyAppt, { reference: REF })
    expect(res.body).toEqual({ success: true, id: 'a1', paid: true })
    expect(h.db.data.staff_notifications).toHaveLength(1)
    expect(h.enqueue.mock.calls[0][0]).toMatchObject({ templateKey: 'appointment_confirmed', toEmail: 'ada@x.com', idempotencyKey: 'appointment-confirmed:a1' })
    // the handler moves no money itself
    expect(h.db.calls.filter((c) => c.op === 'rpc').map((c) => c.name)).toEqual(['settle_payment_intent'])
    expect(h.db.calls.some((c) => /wallet/.test(c.table || ''))).toBe(false)
  })

  it('a replay is alreadyPaid: no second notification or email, no Paystack call', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ status: 'settled' })], staff_notifications: [] } })
    const res = await post(verifyAppt, { reference: REF })
    expect(res.body).toEqual({ success: true, id: 'a1', alreadyPaid: true })
    expect(h.db.data.staff_notifications).toHaveLength(0)
    expect(h.enqueue).not.toHaveBeenCalled()
    expect(h.provider.verifyPayment).not.toHaveBeenCalled()
  })

  it('an appointment already paid at the POS keeps its state; the card payment is flagged for refund', async () => {
    h.db = world({ outcome: 'needs_refund', purpose: 'appointment', reason: 'already_paid' })
    h.provider = verified()
    const res = await post(verifyAppt, { reference: REF })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ success: true, alreadyPaid: true, needsRefund: true })
    expect(h.db.data.staff_notifications).toHaveLength(0)
  })

  it('any other needs_refund is not reported as a paid appointment', async () => {
    h.db = world({ outcome: 'needs_refund', purpose: 'appointment', reason: 'amount_mismatch' })
    h.provider = verified()
    const res = await post(verifyAppt, { reference: REF })
    expect(res.statusCode).toBe(409)
    expect(res.body.success).toBeUndefined()
  })

  it('refuses another business\'s reference and a reference of another purpose', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ business_id: 'biz-OTHER' })] } })
    expect((await post(verifyAppt, { reference: REF })).statusCode).toBe(403)
    h.db = createFakeSupabase({ tables: { payment_intents: [seed({ purpose: 'plan_renewal' })] } })
    expect((await post(verifyAppt, { reference: REF })).statusCode).toBe(400)
    expect(h.provider.verifyPayment).not.toHaveBeenCalled()
  })

  it('transition: an appointment paid before the engine shipped (no intent) reports paid if so, 404 otherwise', async () => {
    h.db = createFakeSupabase({ tables: { appointments: [{ id: 'old1', business_id: 'biz-1', payment_reference: 'appt_old', payment_status: 'paid' }] } })
    expect((await post(verifyAppt, { reference: 'appt_old' })).body).toEqual({ success: true, id: 'old1', alreadyPaid: true })
    h.db = createFakeSupabase({ tables: { appointments: [{ id: 'old2', business_id: 'biz-1', payment_reference: 'appt_old2', payment_status: 'unpaid' }] } })
    expect((await post(verifyAppt, { reference: 'appt_old2' })).statusCode).toBe(404)
  })

  it('needs a reference and a verified owner', async () => {
    expect((await post(verifyAppt, {})).statusCode).toBe(400)
    h.auth = { error: 'no_business' }
    expect((await post(verifyAppt, { reference: REF })).statusCode).toBe(401)
  })
})
