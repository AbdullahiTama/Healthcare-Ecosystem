import crypto from 'crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const SECRET = 'sk_test_webhook_secret'

const { db, mockAnnounce, mockBooking } = vi.hoisted(() => ({
  db: { rpc: {}, tables: {}, inserts: [] },
  mockAnnounce: vi.fn(),
  mockBooking: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (name) => ({ data: db.rpc[name] ?? null, error: null }),
    from(table) {
      const result = () => ({ data: db.tables[table] ?? null, error: null })
      const chain = {
        select: () => chain, eq: () => chain, limit: () => chain, update: () => chain,
        insert: (row) => { db.inserts.push({ table, row }); return chain },
        maybeSingle: async () => result(),
        then: (resolve) => resolve(result()),
      }
      return chain
    },
  }),
}))
vi.mock('../../../api/_lib/purchaseAnnouncements.js', () => ({
  announcePurchase: mockAnnounce,
  appUrlFor: () => 'https://carefind.example',
  subscriptionExpiry: async () => '2026-11-08T12:00:00Z',
}))
vi.mock('../../../api/_lib/bookingPaid.js', () => ({ announceBookingPaid: mockBooking }))

process.env.PAYSTACK_SECRET_KEY = SECRET
const { default: handler } = await import('../../../api/_handlers/paystack-webhook.js')

function chargeSuccess(data) {
  const raw = Buffer.from(JSON.stringify({ event: 'charge.success', data }))
  return {
    method: 'POST',
    headers: { 'x-paystack-signature': crypto.createHmac('sha512', SECRET).update(raw).digest('hex'), host: 'carefind.example' },
    on(evt, cb) {
      if (evt === 'data') queueMicrotask(() => cb(raw))
      if (evt === 'end') setTimeout(cb, 0)
    },
  }
}
const makeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(o) { this.body = o; return this } })
const fire = async (data) => { const res = makeRes(); await handler(chargeSuccess(data), res); return res }

beforeEach(() => {
  mockAnnounce.mockReset().mockResolvedValue({ announced: true })
  mockBooking.mockReset().mockResolvedValue({ announced: true })
  db.rpc = {}; db.tables = {}; db.inserts = []
})

describe('paystack webhook — receipts go to the caller that settled, once', () => {
  const topup = { reference: 'cf_u1_abc', amount: 500000, metadata: { user_id: 'u1', coins: '25' } }

  it('top-up: confirms the purchase when the webhook credited the wallet', async () => {
    db.rpc.credit_wallet_topup = [{ already_processed: false, new_balance: 40 }]
    const res = await fire(topup)
    expect(res.statusCode).toBe(200)
    expect(mockAnnounce).toHaveBeenCalledTimes(1)
    expect(mockAnnounce).toHaveBeenCalledWith(
      'topup',
      { buyerId: 'u1', reference: 'cf_u1_abc', amountKobo: 500000, coins: 25, newBalance: 40 },
      { supabase: expect.anything(), appUrl: 'https://carefind.example' },
    )
  })

  it('top-up: says nothing when the redirect handler already credited it', async () => {
    db.rpc.credit_wallet_topup = [{ already_processed: true, new_balance: 40 }]
    const res = await fire(topup)
    expect(res.body).toMatchObject({ alreadyProcessed: true })
    expect(mockAnnounce).not.toHaveBeenCalled()
  })

  const consult = { reference: 'cf_consult_1', amount: 500000, metadata: { purpose: 'consultation', user_id: 'p1', professional_id: 'd1' } }

  it('consultation: announces a newly settled booking with the Paystack amount in kobo', async () => {
    db.rpc.settle_consultation_payment = [{ already_processed: false, already_booked: false }]
    await fire(consult)
    expect(mockAnnounce).toHaveBeenCalledWith(
      'consultation',
      { buyerId: 'p1', professionalId: 'd1', amountKobo: 500000, method: 'card', reference: 'cf_consult_1' },
      expect.any(Object),
    )
  })

  it.each([
    ['already processed', { already_processed: true, already_booked: false }],
    ['already booked', { already_processed: false, already_booked: true }],
  ])('consultation: silent when %s', async (_label, row) => {
    db.rpc.settle_consultation_payment = [row]
    await fire(consult)
    expect(mockAnnounce).not.toHaveBeenCalled()
  })

  it('subscription: announces once, with the access expiry on the receipt', async () => {
    db.rpc.pay_creator_subscription = 'ok'
    await fire({ reference: 'cf_sub_1', amount: 240000, metadata: { purpose: 'subscription', user_id: 'u1', creator_id: 'c1', coins: '12' } })
    expect(mockAnnounce).toHaveBeenCalledWith(
      'subscription',
      expect.objectContaining({
        buyerId: 'u1', creatorId: 'c1', coins: 12, amountKobo: 240000, method: 'card', reference: 'cf_sub_1',
        expiresAt: '2026-11-08T12:00:00Z',
      }),
      expect.any(Object),
    )
  })

  it('subscription: silent when this reference was already processed', async () => {
    db.tables.transactions = { id: 't1' } // the idempotency lookup finds it
    await fire({ reference: 'cf_sub_1', amount: 240000, metadata: { purpose: 'subscription', user_id: 'u1', creator_id: 'c1', coins: '12' } })
    expect(mockAnnounce).not.toHaveBeenCalled()
  })

  const bookingEvent = { reference: 'bk_1', amount: 300000, metadata: { appointment_id: 'a1', client_email: 'patient@example.com' } }
  const appt = { id: 'a1', business_id: 'b1', client_name: 'Ada', booking_type: 'physical', date: '2026-10-12', time: '10:00', fee_amount: 300000, payment_status: 'unpaid' }

  it('booking: the settling call notifies the business and emails the patient', async () => {
    db.tables.appointments = appt
    db.rpc.settle_card_booking = 'ok'
    await fire(bookingEvent)
    expect(mockBooking).toHaveBeenCalledTimes(1)
    expect(mockBooking).toHaveBeenCalledWith(expect.anything(), {
      appt, method: 'card', reference: 'bk_1', buyerEmail: 'patient@example.com', appUrl: 'https://carefind.example',
    })
    // The old inline insert (with its corrupted characters) is gone.
    expect(db.inserts.filter((i) => i.table === 'staff_notifications')).toHaveLength(0)
  })

  it('booking: the loser of the race notifies nobody', async () => {
    db.tables.appointments = appt
    db.rpc.settle_card_booking = 'already_paid'
    const res = await fire(bookingEvent)
    expect(res.body).toEqual({ alreadyProcessed: true })
    expect(mockBooking).not.toHaveBeenCalled()
  })

  it('booking: a mismatched amount settles nothing and announces nothing', async () => {
    db.tables.appointments = appt
    db.rpc.settle_card_booking = 'ok'
    await fire({ ...bookingEvent, amount: 1 })
    expect(mockBooking).not.toHaveBeenCalled()
  })

  it('refuses an unsigned request and announces nothing', async () => {
    const req = chargeSuccess(topup)
    req.headers['x-paystack-signature'] = 'forged'
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(mockAnnounce).not.toHaveBeenCalled()
  })
})
