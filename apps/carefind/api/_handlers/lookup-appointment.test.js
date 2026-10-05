// The public appointment lookup (no sign-in): a patient finds their appointments by business id + phone number.
const h = vi.hoisted(() => ({ result: { data: [], error: null }, calls: [] }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => {
      const b = { table }
      for (const m of ['select', 'eq', 'gte', 'order']) b[m] = (...a) => { h.calls.push([m, ...a]); return b }
      b.then = (resolve) => resolve(h.result)
      return b
    },
  }),
}))
import handler from './lookup-appointment.js'

const res = () => { const r = { statusCode: null, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const call = async ({ method = 'GET', query = {}, body } = {}) => { const r = res(); await handler({ method, query, body }, r); return r }
beforeEach(() => { h.calls.length = 0; h.result = { data: [{ id: 'a1', client_name: 'Ada' }], error: null } })

describe('lookup-appointment', () => {
  it('finds the appointments of this business and phone (spaces and dashes removed), newest first, last 90 days only', async () => {
    const r = await call({ query: { business_id: 'b1', phone: '0803 123-4567' } })
    expect(r).toMatchObject({ statusCode: 200, body: { success: true, appointments: [{ id: 'a1' }] } })
    expect(h.calls).toContainEqual(['eq', 'business_id', 'b1'])
    expect(h.calls).toContainEqual(['eq', 'phone', '08031234567'])
    const gte = h.calls.find((c) => c[0] === 'gte')
    expect(gte[1]).toBe('date')
    expect(Date.now() - Date.parse(gte[2])).toBeGreaterThan(89 * 86400_000)
    expect(Date.now() - Date.parse(gte[2])).toBeLessThan(92 * 86400_000)
  })

  it('works with POST', async () => {
    expect((await call({ method: 'POST', body: { business_id: 'b1', phone: '08031234567' } })).statusCode).toBe(200)
  })

  it('refuses a wrong method, missing fields and an implausible phone without querying', async () => {
    expect((await call({ method: 'DELETE' })).statusCode).toBe(405)
    expect((await call({ query: { business_id: 'b1' } })).statusCode).toBe(400)
    expect((await call({ query: { phone: '08031234567' } })).statusCode).toBe(400)
    expect((await call({ query: { business_id: 'b1', phone: '123' } })).statusCode).toBe(400)
    expect((await call({ query: { business_id: 'b1', phone: '1'.repeat(16) } })).statusCode).toBe(400)
    expect(h.calls).toEqual([])
  })

  it('nothing found is 404; a database error is a generic 500 that leaks nothing', async () => {
    h.result = { data: [], error: null }
    expect((await call({ query: { business_id: 'b1', phone: '08031234567' } })).statusCode).toBe(404)
    h.result = { data: null, error: { message: 'relation "appointments" secret detail' } }
    const r = await call({ query: { business_id: 'b1', phone: '08031234567' } })
    expect(r.statusCode).toBe(500)
    expect(JSON.stringify(r.body)).not.toMatch(/secret detail/)
  })

  it('never selects the patient contact details, payment references or user links (only what the lookup form shows)', async () => {
    await call({ query: { business_id: 'b1', phone: '08031234567' } })
    const sel = h.calls.find((c) => c[0] === 'select')[1]
    for (const secret of ['phone', 'email', 'payment_reference', 'patient_user_id', 'notes']) expect(sel.split(',').map((s) => s.trim())).not.toContain(secret)
  })
})
