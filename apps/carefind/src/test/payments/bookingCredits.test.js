// @vitest-environment node
// CareFind booking: paying with CareCoins (the wallet debit and the business credit happen inside pay_booking_with_credits; the endpoint
// only identifies the user, checks the preconditions and reports), plus the input validation of the public create form.
const h = vi.hoisted(() => ({ db: null, user: { id: 'u1' }, enqueue: null }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (...a) => h.db.from(...a), rpc: (...a) => h.db.rpc(...a) }) }))
vi.mock('../../../api/_lib/verifyUser.js', () => ({ verifyUser: async () => h.user }))
vi.mock('../../../api/_lib/payments.js', () => ({ getPaystackProvider: () => ({}), paymentLogger: { info() {}, warn() {}, error() {} } }))
vi.mock('../../../api/_lib/emailService.js', () => ({ enqueue: (...a) => h.enqueue(...a), processBatch: vi.fn(async () => {}) }))

import booking from '../../../api/_handlers/booking.js'
import { createFakeSupabase, createRes } from './fixtures/fakeSupabase.js'

const post = (body, method = 'POST') => { const res = createRes(); return booking({ method, body, headers: { host: 'carefind.test' } }, res).then(() => res) }
const appt = (over = {}) => ({ id: 'a1', business_id: 'biz-1', client_name: 'Ada Obi', booking_type: 'physical', date: '2026-11-01', time: '10:00', fee_amount: 150050, payment_status: 'unpaid', payment_reference: 'r', source: 'carefind', client_email: 'ada@example.com', service: 'Checkup', ...over })

function world({ appointment = appt(), balance = 100, rpc = () => ({ data: 'ok', error: null }) } = {}) {
  h.db = createFakeSupabase({
    tables: { appointments: appointment ? [appointment] : [], wallets: balance == null ? [] : [{ user_id: 'u1', balance }], staff_notifications: [] },
    rpc: { pay_booking_with_credits: rpc },
  })
}

beforeEach(() => { h.user = { id: 'u1' }; h.enqueue = vi.fn(async () => {}); world() })

describe('booking: pay-credits', () => {
  it('pays, charging the signed-in user for ceil(fee / 1 coin) coins, and tells the business and the client', async () => {
    const res = await post({ action: 'pay-credits', appointment_id: 'a1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ success: true, id: 'a1', coins: 8 })       // 150050 kobo / 20000 = 7.5 -> 8 coins
    const rpc = h.db.calls.find((c) => c.name === 'pay_booking_with_credits')
    expect(rpc.args).toEqual({ p_user_id: 'u1', p_appointment_id: 'a1' })        // the user is the AUTHENTICATED one
    expect(h.db.data.staff_notifications).toHaveLength(1)
    expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({ templateKey: 'booking_confirmed', toEmail: 'ada@example.com', idempotencyKey: 'booking-confirmed:a1' }))
  })

  it('needs a signed-in user and an appointment id, and never calls the database function without them', async () => {
    h.user = null
    expect((await post({ action: 'pay-credits', appointment_id: 'a1' })).statusCode).toBe(401)
    h.user = { id: 'u1' }
    expect((await post({ action: 'pay-credits' })).statusCode).toBe(400)
    expect(h.db.calls.some((c) => c.name === 'pay_booking_with_credits')).toBe(false)
  })

  it('refuses a booking that is not found, not a CareFind booking, free, or from the wrong source', async () => {
    world({ appointment: null })
    expect((await post({ action: 'pay-credits', appointment_id: 'a1' })).statusCode).toBe(404)
    world({ appointment: appt({ source: 'carehub' }) })
    expect((await post({ action: 'pay-credits', appointment_id: 'a1' })).body.error).toMatch(/not payable online/)
    world({ appointment: appt({ fee_amount: 0 }) })
    expect((await post({ action: 'pay-credits', appointment_id: 'a1' })).body.error).toMatch(/free/)
    world({ appointment: appt({ fee_amount: null }) })
    expect((await post({ action: 'pay-credits', appointment_id: 'a1' })).statusCode).toBe(400)
    expect(h.db.calls.some((c) => c.name === 'pay_booking_with_credits')).toBe(false)
  })

  it('an already paid or refunded booking is reported as paid and is NOT charged again', async () => {
    for (const payment_status of ['paid', 'refunded']) {
      world({ appointment: appt({ payment_status }) })
      const res = await post({ action: 'pay-credits', appointment_id: 'a1' })
      expect(res.body).toMatchObject({ success: true, alreadyPaid: true })
      expect(h.db.calls.some((c) => c.name === 'pay_booking_with_credits')).toBe(false)
    }
  })

  it('too few CareCoins (or no wallet) is refused before the database function, with the price and the balance', async () => {
    world({ balance: 3 })
    const res = await post({ action: 'pay-credits', appointment_id: 'a1' })
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ coins: 8, balance: 3 })
    world({ balance: null })
    expect((await post({ action: 'pay-credits', appointment_id: 'a1' })).body).toMatchObject({ coins: 8, balance: 0 })
    expect(h.db.calls.some((c) => c.name === 'pay_booking_with_credits')).toBe(false)
  })

  it.each([['insufficient', /Not enough CareCoins/], ['already_paid', /already paid/], ['something_else', /Could not complete payment/]])('the database answer "%s" is a clear refusal, never a success', async (answer, expected) => {
    world({ rpc: () => ({ data: answer, error: null }) })
    const res = await post({ action: 'pay-credits', appointment_id: 'a1' })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(expected)
    expect(h.db.data.staff_notifications).toHaveLength(0)
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('a database error is a 500 and nothing is announced', async () => {
    world({ rpc: () => ({ data: null, error: { message: 'boom' } }) })
    expect((await post({ action: 'pay-credits', appointment_id: 'a1' })).statusCode).toBe(500)
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('a booking with no client email notifies the business only; a failing email never breaks the paid booking', async () => {
    world({ appointment: appt({ client_email: '' }) })
    await post({ action: 'pay-credits', appointment_id: 'a1' })
    expect(h.enqueue).not.toHaveBeenCalled()
    world()
    h.enqueue = vi.fn(async () => { throw new Error('smtp down') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await post({ action: 'pay-credits', appointment_id: 'a1' })).statusCode).toBe(200)
  })
})

describe('booking: the public create form refuses bad input before touching the database', () => {
  const body = (over = {}) => ({ action: 'create', business_id: 'biz-1', name: 'Ada Obi', phone: '08012345678', date: '2026-11-01', time: '10:00', ...over })
  it.each([
    ['missing fields', { name: undefined }, /required/],
    ['a one-letter name', { name: 'A' }, /2-80/],
    ['an 81-character name', { name: 'A'.repeat(81) }, /2-80/],
    ['a letters-only phone', { phone: 'call me' }, /Invalid phone/],
    ['a 5-digit phone', { phone: '12345' }, /Invalid phone/],
    ['a 16-digit phone', { phone: '1'.repeat(16) }, /Invalid phone/],
    ['a bad email', { email: 'not-an-email' }, /Invalid email/],
    ['a 501-character concern', { concern: 'x'.repeat(501) }, /under 500/],
    ['angle brackets in the name', { name: 'Ada <script>' }, /Invalid characters/],
    ['angle brackets in the concern', { concern: '<img src=x>' }, /Invalid characters/],
  ])('%s', async (_label, over, expected) => {
    const res = await post(body(over))
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(expected)
    expect(h.db.calls.some((c) => c.op === 'insert')).toBe(false)
  })

  it('a wrong method is 405 and an unknown action is 400', async () => {
    expect((await post(body(), 'GET')).statusCode).toBe(405)
    expect((await post({ action: 'free-money' })).statusCode).toBe(400)
  })
})
