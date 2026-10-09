import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { db, mockPaystack, mockVerifyUser, mockAnnounceBooking } = vi.hoisted(() => ({
  db: { rows: {}, rpc: {}, inserted: [] },
  mockPaystack: vi.fn(),
  mockVerifyUser: vi.fn(),
  mockAnnounceBooking: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (name) => ({ data: db.rpc[name] ?? null, error: null }),
    from(table) {
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, update: () => chain,
        insert: (row) => { db.inserted.push({ table, row }); return chain },
        maybeSingle: async () => ({ data: db.rows[table] ?? null, error: null }),
        single: async () => ({ data: table === 'appointments' ? { id: 'appt-1' } : db.rows[table] ?? null, error: null }),
        then: (resolve) => resolve({ data: null, error: null }),
      }
      return chain
    },
  }),
}))
vi.mock('../../../api/_lib/paystack.js', () => ({ paystackFetch: mockPaystack }))
vi.mock('../../../api/_lib/verifyUser.js', () => ({ verifyUser: mockVerifyUser }))
vi.mock('../../../api/_lib/bookingPaid.js', () => ({ announceBookingPaid: mockAnnounceBooking }))

const { default: handler } = await import('../../../api/_handlers/booking.js')

const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
const BUSINESS = {
  id: 'b1', name: 'GreenLeaf Pharmacy', status: 'active', visible_on_carefind: true, booking_enabled: true,
  booking_type: 'both', booking_slots: ['10:00'], online_consultation_fee: 300000, physical_consultation_fee: 300000,
}
const CREATE = { action: 'create', business_id: 'b1', name: 'Ada', phone: '0801', date: tomorrow, time: '10:00', booking_type: 'physical' }

const makeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(o) { this.body = o; return this } })
const call = async (body) => {
  const res = makeRes()
  await handler({ method: 'POST', headers: { host: 'carefind.example' }, body }, res)
  return res
}

beforeEach(() => {
  vi.stubEnv('CAREFIND_APP_URL', 'https://carefind.example')
  db.rows = {}; db.rpc = {}; db.inserted = []
  mockPaystack.mockReset().mockResolvedValue({ status: true, data: { authorization_url: 'https://pay.example/x' } })
  mockVerifyUser.mockReset()
  mockAnnounceBooking.mockReset().mockResolvedValue({})
})

afterEach(() => vi.unstubAllEnvs())

describe('booking — receipt address', () => {
  beforeEach(() => { db.rows.businesses = BUSINESS })
  const metadataSent = () => JSON.parse(mockPaystack.mock.calls[0][1].body).metadata
  const emailSent = () => JSON.parse(mockPaystack.mock.calls[0][1].body).email

  it('carries a valid receipt email in the Paystack metadata, not as the Paystack customer', async () => {
    const res = await call({ ...CREATE, email: '  patient@example.com ' })
    expect(res.body).toMatchObject({ success: true, paymentRequired: true })
    expect(metadataSent()).toMatchObject({ appointment_id: 'appt-1', business_id: 'b1', client_email: 'patient@example.com' })
    expect(emailSent()).toBe('booking+appt-1@carefind.ng')
  })

  it.each([['not-an-email'], ['a@b'], ['x@y.co,z@y.co'], ['<script>@x.co'], [undefined], ['']])(
    'drops %j instead of storing or mailing it', async (email) => {
      const res = await call({ ...CREATE, email })
      expect(res.body.success).toBe(true)
      expect(metadataSent()).not.toHaveProperty('client_email')
    })

  it('a free booking never reaches Paystack', async () => {
    db.rows.businesses = { ...BUSINESS, physical_consultation_fee: null }
    const res = await call({ ...CREATE, email: 'patient@example.com' })
    expect(res.statusCode).toBe(201)
    expect(mockPaystack).not.toHaveBeenCalled()
  })
})

describe('booking — pay with CareCoins', () => {
  const APPT = {
    id: 'appt-1', business_id: 'b1', client_name: 'Ada', booking_type: 'physical', date: tomorrow, time: '10:00',
    fee_amount: 300000, payment_status: 'unpaid', payment_reference: 'bk_appt-1_abc', source: 'carefind',
  }
  beforeEach(() => {
    mockVerifyUser.mockResolvedValue({ id: 'u1', email: 'ada@example.com' })
    db.rows.appointments = APPT
    db.rows.wallets = { balance: 100 }
  })

  it('confirms to the business and the patient once the RPC settled the booking', async () => {
    db.rpc.pay_booking_with_credits = 'ok'
    const res = await call({ action: 'pay-credits', appointment_id: 'appt-1' })
    expect(res.body).toEqual({ success: true, id: 'appt-1', coins: 15 })
    expect(mockAnnounceBooking).toHaveBeenCalledTimes(1)
    expect(mockAnnounceBooking).toHaveBeenCalledWith(expect.anything(), {
      appt: APPT, method: 'coins', reference: 'bk_appt-1_abc', buyerId: 'u1', buyerEmail: 'ada@example.com',
      appUrl: 'https://carefind.example',
    })
  })

  it('announces nothing when the RPC did not settle it (already paid / insufficient)', async () => {
    for (const outcome of ['already_paid', 'insufficient', 'no_wallet']) {
      mockAnnounceBooking.mockClear()
      db.rpc.pay_booking_with_credits = outcome
      const res = await call({ action: 'pay-credits', appointment_id: 'appt-1' })
      expect(res.statusCode, outcome).toBe(400)
      expect(mockAnnounceBooking, outcome).not.toHaveBeenCalled()
    }
  })

  it('requires a signed-in user', async () => {
    mockVerifyUser.mockResolvedValue(null)
    const res = await call({ action: 'pay-credits', appointment_id: 'appt-1' })
    expect(res.statusCode).toBe(401)
    expect(mockAnnounceBooking).not.toHaveBeenCalled()
  })
})
