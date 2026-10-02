// Settlement behaviour of the shared Paystack webhook, driven through the real handler with a signed event.
import crypto from 'crypto'
import { EventEmitter } from 'events'

const h = vi.hoisted(() => ({ rpcCalls: [], touched: [], rpcImpl: null, updateRows: null }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (name, args) => { h.rpcCalls.push([name, args]); return h.rpcImpl(name, args) },
    from: (table) => {
      const b = {
        select: () => b, eq: () => b, in: () => b, limit: () => b, order: () => b,
        maybeSingle: async () => ({ data: h.maybeSingle?.[table] ?? null }),
        insert: async (row) => { h.touched.push(['insert', table, row]); return { error: null } },
        upsert: async (row) => { h.touched.push(['upsert', table, row]); return { error: null } },
        update: (row) => { h.touched.push(['update', table, row]); return b },
        then: (resolve) => resolve({ data: h.updateRows, error: null }),
      }
      return b
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'u@example.com' } } }) } },
  }),
}))
vi.mock('../_lib/paystack.js', () => ({ getPaystackSecretKey: () => 'sk_test_secret' }))
vi.mock('../_lib/paystackCredit.js', () => ({ creditTopup: vi.fn() }))
vi.mock('../_lib/consultationSettle.js', () => ({ settleConsultationPayment: vi.fn() }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))

import handler from './paystack-webhook.js'

function post(body) {
  const raw = Buffer.from(JSON.stringify(body))
  const req = new EventEmitter()
  req.method = 'POST'
  req.headers = { 'x-paystack-signature': crypto.createHmac('sha512', 'sk_test_secret').update(raw).digest('hex') }
  setImmediate(() => { req.emit('data', raw); req.emit('end') })
  const res = { statusCode: 0 }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = () => res
  return handler(req, res).then(() => res)
}
const rpc = (name) => h.rpcCalls.find(([n]) => n === name)?.[1]

beforeEach(() => {
  h.rpcCalls.length = 0
  h.touched.length = 0
  h.maybeSingle = {}
  h.updateRows = null
  h.rpcImpl = async () => ({ data: [{ already_processed: true }], error: null })
})

// Financial audit M-7: the shop fallback (used only when both settle RPCs error) is a guarded UPDATE. If it
// matches no row, another path (the redirect verify, or an earlier delivery) already settled the order, and
// repeating the history row, vendor notification and customer email would duplicate them.
describe('shop order fallback settlement', () => {
  const shopEvent = { event: 'charge.success', data: { reference: 'cf_shop_1', amount: 100000, metadata: { order_id: 'o1' } } }
  const wrote = (table) => h.touched.some(([, t]) => t === table)

  beforeEach(() => {
    h.maybeSingle = { shop_orders: { id: 'o1', vendor_business_id: 'v1', total_kobo: 100000, payment_status: 'pending', status: 'pending_payment', order_ref: 'CF-1' } }
    h.rpcImpl = async (name) => (name === 'claim_payment_event' ? { data: 'new', error: null } : { data: null, error: { message: 'rpc unavailable' } })
  })

  it('the update matched no row (already settled elsewhere): no duplicate history, notification or payment row', async () => {
    h.updateRows = []
    const res = await post(shopEvent)
    expect(res.statusCode).toBe(200)
    expect(wrote('shop_order_status_history')).toBe(false)
    expect(wrote('staff_notifications')).toBe(false)
    expect(wrote('shop_payments')).toBe(false)
  })

  it('the update settled the order: history, payment row and vendor notification are written once', async () => {
    h.updateRows = [{ id: 'o1' }]
    await post(shopEvent)
    expect(h.touched.filter(([, t]) => t === 'shop_order_status_history')).toHaveLength(1)
    expect(h.touched.filter(([, t]) => t === 'staff_notifications')).toHaveLength(1)
    expect(wrote('shop_payments')).toBe(true)
  })
})

describe('plan and subscription amounts are stored in naira (Paystack reports kobo)', () => {
  it('CareHub plan renewal: 500000 kobo is recorded as 5000 naira', async () => {
    const res = await post({ event: 'charge.success', data: { reference: 'ch_1', amount: 500000, metadata: { business_id: 'biz-1', months: '1' } } })
    expect(res.statusCode).toBe(200)
    expect(rpc('renew_business_plan')).toMatchObject({ p_business_id: 'biz-1', p_months: 1, p_naira_amount: 5000, p_reference: 'ch_1' })
  })

  it('CareFind creator subscription: 100000 kobo is recorded as 1000 naira', async () => {
    await post({ event: 'charge.success', data: { reference: 'cf_sub_1', amount: 100000, metadata: { purpose: 'subscription', user_id: 'u1', creator_id: 'c1', coins: '5' } } })
    expect(rpc('settle_subscription_payment')).toMatchObject({ p_subscriber: 'u1', p_creator: 'c1', p_price: 5, p_naira_amount: 1000, p_reference: 'cf_sub_1' })
  })
})
