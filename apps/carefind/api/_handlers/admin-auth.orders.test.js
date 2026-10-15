import { describe, it, expect, vi } from 'vitest'

vi.mock('../_lib/requireAdmin.js', () => ({ requireAdmin: vi.fn(async () => ({ admin: { id: 'a-1', role: 'super_admin' }, status: 0, error: null })) }))
vi.mock('../_lib/emailService.js', () => ({ processBatch: vi.fn(async () => {}) }))

const h = vi.hoisted(() => {
  const s = { built: [], result: { data: [], count: 0, error: null }, tokenOk: true }
  const q = new Proxy({}, {
    get: (_t, prop) => {
      // Awaiting the builder resolves to the configured result, the way PostgREST does.
      if (prop === 'then') return (resolve) => resolve(s.result)
      return (...args) => { s.built.push([prop, ...args]); return q }
    },
  })
  s.client = {
    from: (table) => { s.built.push(['from', table]); return q },
    rpc: async () => ({ data: null, error: null }),
    auth: { getUser: async () => (s.tokenOk ? { data: { user: { id: 'a-1', email: 'a@b.c' } }, error: null } : { data: {}, error: { message: 'bad' } }) },
  }
  return s
})
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))

process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'
import handler from './admin-auth.js'

const req = (action, body = {}) => ({
  method: 'POST',
  url: '/api/admin-auth',
  headers: { authorization: 'Bearer tok' },
  body: { action, ...body },
})
const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; r.setHeader = () => {}; return r }
const orFilters = () => h.built.filter(([op]) => op === 'or').map(([, v]) => v)
// The PostgREST filter grammar a chained call produces, e.g. eq('status','paid') -> 'status.eq.paid'.
const filterStr = () => h.built.map(([op, ...args]) => `${op}.${args.join(',')}`).join(' | ')
const argsOf = (op) => h.built.filter(([o]) => o === op).map(([, ...rest]) => rest)

const reset = () => { h.built.length = 0; h.result = { data: [], count: 0, error: null } }

describe('list_shop_orders_filtered', () => {
  it('requires a valid admin token', async () => {
    reset(); h.tokenOk = false
    const r = res()
    await handler(req('list_shop_orders_filtered'), r)
    expect(r.statusCode).toBe(401)
    h.tokenOk = true
  })

  it('searches order number, receipt reference, paystack reference, customer name and vendor name together', async () => {
    reset()
    const r = res()
    await handler(req('list_shop_orders_filtered', { search: 'CF-000027' }), r)
    const f = orFilters().join(' ')
    // An operator searching "CF-000027" must find it by order ref OR receipt OR customer OR vendor, not just one column.
    expect(f).toMatch(/order_ref\.ilike/)
    expect(f).toMatch(/payment_reference\.ilike/)
    expect(f).toMatch(/paystack_reference\.ilike/)
    expect(f).toMatch(/customer_name\.ilike/)
    expect(f).toMatch(/businesses\.name\.ilike/)
  })

  // The search term is interpolated into a PostgREST .or(...) string whose grammar treats , ( ) and . as structure.
  // A raw term could append an OR branch and read past the intended filter.
  it('strips PostgREST filter syntax from the search term so it cannot alter the filter', async () => {
    reset()
    const r = res()
    await handler(req('list_shop_orders_filtered', { search: 'x),other.eq.1' }), r)
    const f = orFilters().join(' ')
    // The structural characters are gone: `),` can no longer split one clause into another condition. What survives is
    // inert text inside a single %value%, and the filter is still exactly the five intended columns.
    expect(f).not.toContain('),')
    expect(f.match(/\.ilike\./g)).toHaveLength(5)
    expect(f).toContain('order_ref.ilike.%xother.eq.1%')
  })

  it('strips wildcards so a term cannot become a full table scan', async () => {
    reset()
    const r = res()
    await handler(req('list_shop_orders_filtered', { search: '%%%' }), r)
    expect(orFilters().length).toBe(0)
  })

  it('applies order state, payment state, vendor, customer and both date bounds', async () => {
    reset()
    const r = res()
    await handler(req('list_shop_orders_filtered', {
      status: 'paid', paymentStatus: 'paid', vendorId: 'b-1', customerId: 'c-1', dateFrom: '2026-10-01', dateTo: '2026-10-15',
    }), r)
    const flat = filterStr()
    expect(flat).toContain('eq.status,paid')
    expect(flat).toContain('eq.payment_status,paid')
    expect(flat).toContain('eq.vendor_business_id,b-1')
    expect(flat).toContain('eq.customer_id,c-1')
    expect(flat).toContain('gte.created_at,2026-10-01')
    expect(flat).toContain('lte.created_at,2026-10-15T23:59:59')
  })

  it('pages with a bounded range instead of an unbounded limit', async () => {
    reset()
    const r = res()
    await handler(req('list_shop_orders_filtered', { limit: 25, offset: 50 }), r)
    expect(r.body).toMatchObject({ limit: 25, offset: 50 })
    expect(argsOf('range')).toEqual([[50, 74]])
  })

  it('clamps a hostile page size rather than trusting the caller', async () => {
    reset()
    const r = res()
    await handler(req('list_shop_orders_filtered', { limit: 100000, offset: -5 }), r)
    expect(r.body.limit).toBe(200)
    expect(r.body.offset).toBe(0)
  })

  it('reports a database failure instead of answering 200 with an empty list', async () => {
    reset()
    h.result = { data: null, count: 0, error: { message: 'relation "shop_orders" does not exist' } }
    const r = res()
    await handler(req('list_shop_orders_filtered'), r)
    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(/does not exist/)
    h.result = { data: [], count: 0, error: null }
  })

  // shop_orders.customer_id is a FOREIGN KEY to auth.users, not to profiles. Embedding `profiles!shop_orders_customer_id_fkey(...)`
  // makes PostgREST fail the WHOLE query with "Could not find a relationship", which blanks the entire order list.
  // The same trap is already documented in this file for shop_order_messages.sender_id.
  it('never embeds profiles on shop_orders, which would fail the whole query', async () => {
    reset()
    const r = res()
    await handler(req('list_shop_orders_filtered'), r)
    const select = h.built.find(([op]) => op === 'select')
    expect(select).toBeTruthy()
    expect(String(select[1])).not.toMatch(/profiles!/)
    // The vendor embed is legitimate and must stay: that FK exists.
    expect(String(select[1])).toMatch(/businesses!shop_orders_vendor_business_id_fkey/)
  })

  it('resolves a missing customer name from profiles in a separate query, never by embedding', async () => {
    reset()
    h.result = { data: [{ id: 'o-1', customer_id: 'c-1', customer_name: null }], count: 1, error: null }
    const r = res()
    await handler(req('list_shop_orders_filtered'), r)
    expect(r.statusCode).toBe(200)
    expect(h.built.some(([op, table]) => op === 'from' && table === 'profiles')).toBe(true)
    // ...and the main order select still carries no embed that would take the list down with it.
    const mainSelect = h.built.filter(([op]) => op === 'select')[0]
    expect(String(mainSelect[1])).not.toMatch(/profiles!/)
  })
})

describe('admin reads that used to fail silently', () => {
  it('list_transactions surfaces a failure rather than returning an empty list with 200', async () => {
    reset()
    h.result = { data: null, count: 0, error: { message: 'permission denied for table transactions' } }
    const r = res()
    await handler(req('list_transactions'), r)
    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(/permission denied/)
    h.result = { data: [], count: 0, error: null }
  })

  it('list_shop_orders_admin surfaces a failure too', async () => {
    reset()
    h.result = { data: null, count: 0, error: { message: 'boom' } }
    const r = res()
    await handler(req('list_shop_orders_admin'), r)
    expect(r.statusCode).toBe(400)
    h.result = { data: [], count: 0, error: null }
  })
})