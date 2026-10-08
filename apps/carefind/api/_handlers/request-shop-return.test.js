// The customer's return request. The endpoint authenticates the user, checks the order is theirs and returnable, then asks the database
// to create the request. It calls with the SERVICE-ROLE key, so it must NAME the customer (p_customer_id): without that the function
// (rightly) refuses every call, which is exactly the regression this test pins.
const h = vi.hoisted(() => ({ verifyUser: vi.fn(), order: { data: null, error: null }, existing: { data: null }, rpc: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => {
      const b = {}
      for (const m of ['select', 'eq', 'in']) b[m] = () => b
      b.maybeSingle = async () => (table === 'shop_orders' ? h.order : h.existing)
      return b
    },
    rpc: (...a) => h.rpc(...a),
  }),
}))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: h.verifyUser }))

import handler from './request-shop-return.js'

const res = () => { const r = { statusCode: null, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const call = async (body = { order_id: 'o1', reason: 'damaged' }, method = 'POST') => { const r = res(); await handler({ method, headers: {}, body }, r); return r }
const order = (over = {}) => ({ id: 'o1', customer_id: 'u1', status: 'delivered', total_kobo: 1050000, order_ref: 'CF-1', updated_at: new Date().toISOString(), ...over })

beforeEach(() => {
  h.verifyUser.mockReset().mockResolvedValue({ id: 'u1' })
  h.order = { data: order(), error: null }
  h.existing = { data: null }
  h.rpc.mockReset().mockResolvedValue({ data: 'ret-1', error: null })
})

describe('request-shop-return', () => {
  it('creates the request for the signed-in owner, naming the customer for the service-role call and asking for the order total', async () => {
    const r = await call({ order_id: 'o1', reason: 'damaged', description: 'cracked' })
    expect(r.statusCode).toBe(200)
    expect(r.body).toMatchObject({ success: true, return_id: 'ret-1' })
    expect(h.rpc).toHaveBeenCalledWith('request_shop_return', { p_order_id: 'o1', p_reason: 'damaged', p_description: 'cracked', p_refund_amount_kobo: 1050000, p_customer_id: 'u1' })
  })

  it('the customer named is the AUTHENTICATED user, never one from the request body', async () => {
    await call({ order_id: 'o1', reason: 'x', p_customer_id: 'someone-else', customer_id: 'someone-else' })
    expect(h.rpc.mock.calls[0][1].p_customer_id).toBe('u1')
  })

  it('refuses a wrong method, no session, and missing fields without touching the database', async () => {
    expect((await call(undefined, 'GET')).statusCode).toBe(405)
    h.verifyUser.mockResolvedValue(null)
    expect((await call()).statusCode).toBe(401)
    h.verifyUser.mockResolvedValue({ id: 'u1' })
    expect((await call({ reason: 'x' })).statusCode).toBe(400)
    expect((await call({ order_id: 'o1' })).statusCode).toBe(400)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('an order that is not found is 404; somebody else\'s order is 403', async () => {
    h.order = { data: null, error: null }
    expect((await call()).statusCode).toBe(404)
    h.order = { data: order({ customer_id: 'u2' }), error: null }
    expect((await call()).statusCode).toBe(403)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('only a delivered order, inside the window, with no return already open', async () => {
    h.order = { data: order({ status: 'paid' }), error: null }
    expect((await call()).body.error).toMatch(/delivered orders/)
    h.order = { data: order({ updated_at: new Date(Date.now() - 9 * 86400_000).toISOString() }), error: null }
    expect((await call()).body.error).toMatch(/window/)
    h.order = { data: order(), error: null }
    h.existing = { data: { id: 'r0', status: 'requested' } }
    expect((await call()).body.error).toMatch(/already requested/)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('reports a database refusal (for example the window measured from the first delivery) as an error', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'Return window (7 days) has expired' } })
    const r = await call()
    expect(r.statusCode).toBe(500)
    expect(r.body.error).toMatch(/window/)
  })
})
