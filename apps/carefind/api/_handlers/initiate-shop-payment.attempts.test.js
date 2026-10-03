// Every payment attempt on a shop order gets its own Paystack reference, recorded in shop_payments. Reusing one
// reference for the whole order makes a retry after an abandoned payment depend on how Paystack treats a repeated
// reference, and leaves no record of which attempt a customer actually paid.
const h = vi.hoisted(() => ({ order: null, pending: null, insertError: null, touched: [], paystack: null, paystackCalls: [], user: null }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => {
      const b = {
        select: () => b, eq: () => b, order: () => b, limit: () => b,
        maybeSingle: async () => ({ data: table === 'shop_orders' ? h.order : table === 'shop_payments' ? h.pending : null }),
        insert: async (row) => { h.touched.push(['insert', table, row]); return { error: table === 'shop_payments' ? h.insertError : null } },
        update: (row) => { h.touched.push(['update', table, row]); return b },
        then: (resolve) => resolve({ error: null }),
      }
      return b
    },
  }),
}))
vi.mock('../_lib/paystack.js', () => ({
  paystackFetch: async (path, options) => { h.paystackCalls.push([path, options?.body ? JSON.parse(options.body) : null]); return h.paystack(path) },
}))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => h.user }))

import handler from './initiate-shop-payment.js'

const ORDER = {
  id: 'order-B', customer_id: 'user-1', vendor_business_id: 'v1', total_kobo: 650000, subtotal_kobo: 650000,
  payment_reference: 'CF-OLD', status: 'pending_payment', payment_status: 'pending', order_ref: 'CF-B',
}
const INIT_OK = { status: true, data: { authorization_url: 'https://checkout.paystack.com/abc', access_code: 'abc' } }

function call(body = { order_id: 'order-B' }) {
  const res = { statusCode: 0, body: null }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  return handler({ method: 'POST', headers: { host: 'carefind.test' }, body }, res).then(() => res)
}
const initialized = () => h.paystackCalls.filter(([p]) => p === '/transaction/initialize')
const inserted = (table) => h.touched.filter(([op, t]) => op === 'insert' && t === table).map(([, , row]) => row)
const updated = (table) => h.touched.filter(([op, t]) => op === 'update' && t === table).map(([, , row]) => row)

beforeEach(() => {
  h.order = { ...ORDER }
  h.pending = null
  h.insertError = null
  h.touched.length = 0
  h.paystackCalls.length = 0
  h.user = { id: 'user-1', email: 'c@example.com' }
  h.paystack = (path) => (path === '/transaction/initialize' ? INIT_OK : { status: true, data: { status: 'abandoned' } })
})

describe('initiate-shop-payment records one attempt per Paystack reference', () => {
  it('the first payment mints a reference, records the attempt and charges the order total from the database', async () => {
    h.order = { ...ORDER, payment_reference: null }

    const res = await call()

    expect(res.statusCode).toBe(200)
    const [, init] = initialized()[0]
    expect(init).toMatchObject({ amount: 650000, currency: 'NGN', metadata: expect.objectContaining({ order_id: 'order-B' }) })
    expect(init.reference).toMatch(/^CF-/)
    expect(inserted('shop_payments')).toEqual([expect.objectContaining({ order_id: 'order-B', payment_reference: init.reference, amount_kobo: 650000, status: 'pending' })])
    expect(updated('shop_orders')).toContainEqual({ payment_reference: init.reference })
    expect(res.body).toMatchObject({ authorization_url: INIT_OK.data.authorization_url, reference: init.reference })
  })

  it('a retry after an abandoned payment uses a new reference and marks the old attempt failed', async () => {
    h.pending = { id: 'a1', order_id: 'order-B', payment_reference: 'CF-OLD', status: 'pending' }

    const res = await call()

    expect(res.statusCode).toBe(200)
    const [, init] = initialized()[0]
    expect(init.reference).toMatch(/^CF-/)
    expect(init.reference).not.toBe('CF-OLD')
    expect(updated('shop_payments')).toContainEqual(expect.objectContaining({ status: 'failed' }))
    expect(res.body.reference).toBe(init.reference)
  })

  it('a reference Paystack does not know is treated as unpaid and a new attempt is started', async () => {
    h.pending = { id: 'a1', order_id: 'order-B', payment_reference: 'CF-OLD', status: 'pending' }
    h.paystack = (path) => (path === '/transaction/initialize' ? INIT_OK : { status: false, message: 'Transaction reference not found' })

    const res = await call()

    expect(res.statusCode).toBe(200)
    expect(initialized()).toHaveLength(1)
  })

  it('an earlier attempt that was actually paid starts no new payment and tells the client to verify it', async () => {
    h.pending = { id: 'a1', order_id: 'order-B', payment_reference: 'CF-OLD', status: 'pending' }
    h.paystack = () => ({ status: true, data: { status: 'success', amount: 650000 } })

    const res = await call()

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ alreadyPaid: true, reference: 'CF-OLD' })
    expect(initialized()).toHaveLength(0)
    expect(inserted('shop_payments')).toHaveLength(0)
  })

  it('when Paystack cannot be reached to check the earlier attempt, no new attempt is started (502)', async () => {
    h.pending = { id: 'a1', order_id: 'order-B', payment_reference: 'CF-OLD', status: 'pending' }
    h.paystack = () => { throw new Error('Paystack returned an empty response (HTTP 503)') }

    const res = await call()

    expect(res.statusCode).toBe(502)
    expect(initialized()).toHaveLength(0)
    expect(inserted('shop_payments')).toHaveLength(0)
  })

  it('if the attempt cannot be recorded, Paystack is never called (500)', async () => {
    h.insertError = { message: 'db down' }

    const res = await call()

    expect(res.statusCode).toBe(500)
    expect(initialized()).toHaveLength(0)
  })
})
