// Financial audit F-25: cancel-appointment trusted `cancelled_by: "owner"` from the request body,
// so anyone holding an appointment id could claim the owner role and skip the patient's
// 24-hour / past-appointment rules. The owner role now needs a verified owner session.
const h = vi.hoisted(() => {
  const s = { user: null, owns: false, updates: [], appt: null }
  const builderFor = (table) => {
    const b = {
      select: () => b, eq: () => b,
      update: (v) => { s.updates.push([table, v]); return b },
      insert: () => Promise.resolve({ error: null }),
      maybeSingle: async () => (table === 'appointments' ? { data: s.appt } : { data: null }),
      then: (resolve) => resolve({ error: null }),
    }
    return b
  }
  s.client = { from: builderFor, rpc: async () => ({ data: null }) }
  return s
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => h.user }))
vi.mock('../_lib/businessOwnership.js', () => ({ userOwnsBusiness: async () => h.owns }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))

import handler from './cancel-appointment.js'

function call(body) {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  return handler({ method: 'POST', body, headers: {} }, res).then(() => res)
}

const soon = () => new Date(Date.now() + 2 * 3600 * 1000)
const ymd = (d) => d.toISOString().slice(0, 10)
const hm = (d) => d.toISOString().slice(11, 16)

beforeEach(() => {
  h.user = null
  h.owns = false
  h.updates.length = 0
  const d = soon()
  // Appointment starting in 2 hours: a patient may NOT cancel inside the 24h window.
  h.appt = { id: 'a1', business_id: 'b1', status: 'confirmed', payment_status: 'unpaid', fee_amount: 0, date: ymd(d), time: hm(d), client_name: 'Ada' }
})

describe('cancel-appointment owner role', () => {
  it('rejects an anonymous caller claiming to be the owner, and changes nothing', async () => {
    const res = await call({ appointment_id: 'a1', cancelled_by: 'owner' })
    expect(res.statusCode).toBe(401)
    expect(h.updates).toHaveLength(0)
  })

  it('rejects a signed-in user who does not own the business', async () => {
    h.user = { id: 'u1', email: 'x@y.com' }
    const res = await call({ appointment_id: 'a1', cancelled_by: 'owner' })
    expect(res.statusCode).toBe(403)
    expect(h.updates).toHaveLength(0)
  })

  it('lets the verified owner cancel, including inside the patient window', async () => {
    h.user = { id: 'u1', email: 'owner@clinic.com' }
    h.owns = true
    const res = await call({ appointment_id: 'a1', cancelled_by: 'owner' })
    expect(res.statusCode).toBe(200)
    expect(h.updates.some(([t, v]) => t === 'appointments' && v.status === 'cancelled')).toBe(true)
  })

  it('keeps the patient rules for the patient role (no session needed, 24h window enforced)', async () => {
    const res = await call({ appointment_id: 'a1', cancelled_by: 'patient' })
    expect(res.statusCode).toBe(400)
    expect(h.updates).toHaveLength(0)
  })
})
