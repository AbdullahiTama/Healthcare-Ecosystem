// @vitest-environment node
// Phase 04, flow 4: paid CareFind appointment (card). The fee is the service/business price on the
// server; settlement credits the business from the ACTUAL amount (engine proven in
// settlementEngine.db.test.js + settleCardBookingActualAmount.db.test.js).
const h = vi.hoisted(() => ({ db: null, provider: null }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (...a) => h.db.from(...a), rpc: (...a) => h.db.rpc(...a) }) }))
vi.mock('../../../api/_lib/verifyUser.js', () => ({ verifyUser: async () => null }))
vi.mock('../../../api/_lib/payments.js', () => ({ getPaystackProvider: () => h.provider, paymentLogger: { info() {}, warn() {}, error() {} } }))
vi.mock('../../../api/_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))

import booking from '../../../api/_handlers/booking.js'
import verify from '../../../api/_handlers/verify-booking-payment.js'
import { createFakeSupabase, createFakeProvider, createRes, verifiedPayment } from './fixtures/fakeSupabase.js'

const post = (handler, body, headers = { host: 'carefind.test' }) => { const res = createRes(); return handler({ method: 'POST', body, headers }, res).then(() => res) }

const tomorrow = new Date(Date.now() + 86400e3).toLocaleDateString('en-CA')
const bookingBody = (over = {}) => ({ action: 'create', business_id: 'biz-1', name: 'Ada Obi', phone: '08012345678', date: tomorrow, time: '10:00', booking_type: 'physical', ...over })
const business = (over = {}) => ({ id: 'biz-1', name: 'Clinic', status: 'active', visible_on_carefind: true, booking_enabled: true, booking_type: 'both', booking_slots: ['10:00'], online_consultation_fee: 300000, physical_consultation_fee: 150050, ...over })

function bookWorld(biz = business(), extra = {}) {
  const db = createFakeSupabase({
    tables: { businesses: [biz], appointments: [], ...extra },
    rpc: {},
  })
  // legacy insert path: appointments.insert(...).select('id').single() already works in the fake
  return db
}

beforeEach(() => {
  h.provider = createFakeProvider()
  h.db = bookWorld()
})

describe('booking (card path)', () => {
  it('records an intent for the SERVER-side fee before Paystack, with the appointment and business', async () => {
    const res = await post(booking, bookingBody())
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ success: true, paymentRequired: true, fee: 150050 })
    const appt = h.db.data.appointments[0]
    const intent = h.db.data.payment_intents[0]
    expect(intent).toMatchObject({ purpose: 'booking', application: 'carefind', business_id: 'biz-1', entity_type: 'appointment', entity_id: appt.id, expected_amount: 150050, customer_id: null, status: 'pending' })
    expect(intent.reference).toBe(appt.payment_reference)
    expect(h.provider.initializePayment).toHaveBeenCalledWith(expect.objectContaining({ amountKobo: 150050, reference: intent.reference }))
    expect(res.body.reference).toBe(intent.reference)
  })

  it.each([[1], [0], [-5], ['1']])('ignores a client-supplied fee of %p', async (fee) => {
    await post(booking, bookingBody({ fee, fee_amount: fee, amount: fee, price: fee }))
    expect(h.db.data.payment_intents[0].expected_amount).toBe(150050)
  })

  it('uses the online fee for an online booking', async () => {
    await post(booking, bookingBody({ booking_type: 'online' }))
    expect(h.db.data.payment_intents[0].expected_amount).toBe(300000)
  })

  it('a free booking creates no intent and never contacts Paystack', async () => {
    h.db = bookWorld(business({ physical_consultation_fee: null }))
    const res = await post(booking, bookingBody())
    expect(res.body.paymentRequired).toBe(false)
    expect(h.db.data.payment_intents || []).toHaveLength(0)
    expect(h.provider.initializePayment).not.toHaveBeenCalled()
  })

  it('answers 500 (not a half-started payment) if the intent cannot be recorded', async () => {
    h.provider = createFakeProvider()
    const realFrom = h.db.from
    h.db.from = (t) => (t === 'payment_intents' ? { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: 'XX000', message: 'db down' } }) }) }) } : realFrom(t))
    const res = await post(booking, bookingBody())
    expect(res.statusCode).toBe(500)
    expect(h.provider.initializePayment).not.toHaveBeenCalled()
  })

  it('a Paystack refusal is reported as a gateway error', async () => {
    h.provider.initializePayment.mockRejectedValue(Object.assign(new Error('Invalid key'), { code: 'provider_rejected' }))
    expect((await post(booking, bookingBody())).statusCode).toBe(502)
  })
})

describe('verify-booking-payment', () => {
  const ref = 'bk_0123456789ab_abcdef'
  const seedIntent = (over = {}) => ({ id: 'i1', reference: ref, purpose: 'booking', customer_id: null, business_id: 'biz-1', entity_id: 'a1', status: 'pending', expected_amount: 150050, ...over })
  const rpc = (r) => ({ settle_payment_intent: async () => r })
  const verified = () => createFakeProvider({ verify: async () => verifiedPayment({ amountKobo: 150050 }) })
  const appt = { id: 'a1', business_id: 'biz-1', client_name: 'Ada', date: '2026-10-10', time: '10:00', fee_amount: 150050, client_email: 'a@b.com', service: 'Consult' }

  it('settles through the engine; needs no sign-in; notifies the business', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seedIntent()], appointments: [appt], businesses: [{ id: 'biz-1', name: 'Clinic' }], staff_notifications: [] }, rpc: rpc({ outcome: 'settled', purpose: 'booking', business_kobo: 120040, platform_kobo: 30010 }) })
    h.provider = verified()
    const res = await post(verify, { reference: ref })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ success: true, id: 'a1', paid: true })
    expect(h.db.data.staff_notifications).toHaveLength(1)
    // the handler itself moves no money and does not touch wallets
    expect(h.db.calls.filter((c) => c.op === 'rpc').map((c) => c.name)).toEqual(['settle_payment_intent'])
    expect(h.db.calls.some((c) => /wallet/.test(c.table || ''))).toBe(false)
  })

  it('a replay (webhook already settled) is alreadyPaid: no second notification and no Paystack call', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seedIntent({ status: 'settled' })], staff_notifications: [] } })
    const res = await post(verify, { reference: ref })
    expect(res.body).toEqual({ success: true, id: 'a1', alreadyPaid: true })
    expect(h.db.data.staff_notifications).toHaveLength(0)
    expect(h.provider.verifyPayment).not.toHaveBeenCalled()
  })

  it('an appointment already paid another way keeps its booking; the card payment is flagged for refund', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seedIntent()], staff_notifications: [] }, rpc: rpc({ outcome: 'needs_refund', purpose: 'booking', reason: 'already_paid' }) })
    h.provider = verified()
    const res = await post(verify, { reference: ref })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ success: true, alreadyPaid: true, needsRefund: true })
    expect(h.db.data.staff_notifications).toHaveLength(0)
  })

  it('any other needs_refund (e.g. amount mismatch) is not reported as a paid booking', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seedIntent()] }, rpc: rpc({ outcome: 'needs_refund', reason: 'amount_mismatch' }) })
    h.provider = verified()
    const res = await post(verify, { reference: ref })
    expect(res.statusCode).toBe(409)
    expect(res.body.success).toBeUndefined()
  })

  it('does not settle when Paystack says the payment was not successful', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seedIntent()] } })
    h.provider = createFakeProvider({ verify: async () => verifiedPayment({ status: 'failed' }) })
    expect((await post(verify, { reference: ref })).statusCode).toBe(400)
    expect(h.db.calls.some((c) => c.op === 'rpc')).toBe(false)
  })

  it('refuses a reference that is not a booking (a top-up reference cannot mark an appointment paid)', async () => {
    h.db = createFakeSupabase({ tables: { payment_intents: [seedIntent({ purpose: 'wallet_topup' })] } })
    expect((await post(verify, { reference: ref })).statusCode).toBe(400)
  })

  it('transition: a booking paid before the engine shipped (no intent) reports paid if already settled, 404 otherwise', async () => {
    h.db = createFakeSupabase({ tables: { appointments: [{ id: 'old1', payment_reference: 'bk_old', payment_status: 'paid' }] } })
    expect((await post(verify, { reference: 'bk_old' })).body).toEqual({ success: true, id: 'old1', alreadyPaid: true })
    h.db = createFakeSupabase({ tables: { appointments: [{ id: 'old2', payment_reference: 'bk_old2', payment_status: 'unpaid' }] } })
    expect((await post(verify, { reference: 'bk_old2' })).statusCode).toBe(404)
  })

  it('requires a reference', async () => {
    expect((await post(verify, {})).statusCode).toBe(400)
  })
})
