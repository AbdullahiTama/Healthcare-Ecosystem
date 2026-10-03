// Payment binding for the shop redirect-verify: a successful Paystack transaction may settle a shop order
// only if it is THAT order's own payment. Amount equality alone is not binding - a wallet top-up, booking
// or another customer's payment of the same amount would otherwise settle any order of that total.
const h = vi.hoisted(() => ({ orders: [], rpcCalls: [], touched: [], paystack: null, user: null, paystackCalls: [] }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (name, args) => { h.rpcCalls.push([name, args]); return { data: 'ok', error: null } },
    from: (table) => {
      const filters = {}
      const b = {
        select: () => b,
        eq: (col, val) => { filters[col] = val; return b },
        maybeSingle: async () => ({
          data: table === 'shop_orders' ? h.orders.find((o) => Object.entries(filters).every(([k, v]) => o[k] === v)) ?? null : null,
        }),
        insert: async (row) => { h.touched.push(['insert', table, row]); return { error: null } },
        upsert: async (row) => { h.touched.push(['upsert', table, row]); return { error: null } },
        update: (row) => { h.touched.push(['update', table, row]); return b },
        then: (resolve) => resolve({ data: [], error: null }),
      }
      return b
    },
  }),
}))
vi.mock('../_lib/paystack.js', () => ({
  paystackFetch: async (path) => { h.paystackCalls.push(path); return h.paystack(path) },
}))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => h.user }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))

import handler from './verify-shop-payment.js'

const ORDER = {
  id: 'order-B', customer_id: 'user-1', vendor_business_id: 'v1', total_kobo: 650000,
  payment_reference: 'CF-ORDER-B', paystack_reference: null, status: 'pending_payment', payment_status: 'pending', order_ref: 'CF-B',
}

function call(body) {
  const res = { statusCode: 0, body: null }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  return handler({ method: 'POST', headers: {}, body }, res).then(() => res)
}
const paystackOk = (data) => ({ status: true, data: { status: 'success', amount: 650000, ...data } })
const settled = () => h.rpcCalls.some(([n]) => n === 'verify_shop_payment' || n === 'settle_shop_payment')
const orderWritten = () => h.touched.some(([op, t]) => op === 'update' && t === 'shop_orders')

beforeEach(() => {
  h.orders = [{ ...ORDER }]
  h.rpcCalls.length = 0
  h.touched.length = 0
  h.paystackCalls.length = 0
  h.user = { id: 'user-1' }
})

describe('verify-shop-payment binds the Paystack transaction to the order', () => {
  it('a successful payment of the same amount made for something else (wallet top-up) does not settle the order', async () => {
    h.paystack = () => paystackOk({ reference: 'WALLET-TOPUP-REF', metadata: { user_id: 'user-1', coins: 50 } })

    const res = await call({ order_id: 'order-B', reference: 'WALLET-TOPUP-REF' })

    expect(res.statusCode).toBe(400)
    expect(settled()).toBe(false)
    expect(orderWritten()).toBe(false)
  })

  it('a payment whose metadata names a different order does not settle this one', async () => {
    h.paystack = () => paystackOk({ reference: 'CF-ORDER-A', metadata: { order_id: 'order-A', type: 'shop_order' } })

    const res = await call({ order_id: 'order-B', reference: 'CF-ORDER-A' })

    expect(res.statusCode).toBe(400)
    expect(settled()).toBe(false)
    expect(orderWritten()).toBe(false)
  })

  it('verifies the order\'s own stored reference with Paystack, never one the client supplied', async () => {
    h.paystack = (path) => paystackOk({ reference: decodeURIComponent(path.split('/').pop()), metadata: { order_id: 'order-B', type: 'shop_order' } })

    await call({ order_id: 'order-B', reference: 'WALLET-TOPUP-REF' })

    expect(h.paystackCalls).not.toContain('/transaction/verify/WALLET-TOPUP-REF')
  })

  it('the order\'s own payment still settles it, recorded against the order\'s own reference', async () => {
    h.paystack = () => paystackOk({ reference: 'CF-ORDER-B', metadata: { order_id: 'order-B', type: 'shop_order' } })

    const res = await call({ order_id: 'order-B', reference: 'CF-ORDER-B' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ success: true, id: 'order-B' })
    const args = h.rpcCalls.find(([n]) => n === 'verify_shop_payment')?.[1]
    expect(args).toEqual({ p_order_id: 'order-B', p_paystack_reference: 'CF-ORDER-B' })
  })
})
