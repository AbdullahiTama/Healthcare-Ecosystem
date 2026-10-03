// get_shop_order_detail returns an order with its chat. shop_order_messages.sender_id references auth.users, not
// profiles, so embedding profiles in that select fails ("Could not find a relationship ...") - and because the
// error was ignored, the admin order screen showed "No messages" for every order. Names are looked up separately and
// supplied as `sender_name`, the field AdminShop reads.
const h = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: h.createClient }))
vi.mock('../_lib/emailService.js', () => ({ processBatch: vi.fn() }))
vi.mock('../_lib/withdrawalAdmin.js', () => ({ decideAdminApprove: vi.fn(), decideAdminReject: vi.fn() }))
// Authentication is not what is under test; an authorised admin is supplied so the action body runs.
vi.mock('../_lib/requireAdmin.js', () => ({ requireAdmin: async () => ({ admin: { id: 'admin-1', role: 'super_admin' } }) }))

import handler from './admin-auth.js'

const ORDER = { id: 'o1', order_ref: 'CF-1' }
const MESSAGES = [
  { id: 'm1', order_id: 'o1', sender_id: 'u1', sender_role: 'customer', message: 'hi', created_at: '2026-10-01T10:00:00Z' },
  { id: 'm2', order_id: 'o1', sender_id: 'u2', sender_role: 'vendor', message: 'hello', created_at: '2026-10-01T10:05:00Z' },
]

// Answers each table from `tables` and records every select().
function makeClient(tables) {
  const selects = []
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } }, error: null }) },
    rpc: async () => ({ data: [], error: null }),
    from: (table) => {
      const q = { table, select: null, filters: [] }
      selects.push(q)
      const result = tables[table] ?? { data: [], error: null }
      const b = {}
      b.select = (cols) => { q.select = cols; return b }
      for (const m of ['eq', 'order', 'in']) b[m] = (...a) => { q.filters.push([m, ...a]); return b }
      b.maybeSingle = async () => result
      b.then = (resolve) => resolve(result)
      return b
    },
  }
  h.createClient.mockReturnValue(client)
  return { selects }
}

async function getDetail() {
  const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this }, json(v) { this.body = v; return this } }
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: { action: 'get_shop_order_detail', orderId: 'o1' } }, res)
  return res
}

describe('admin-auth get_shop_order_detail messages', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('reads the messages without embedding profiles through sender_id', async () => {
    const { selects } = makeClient({
      shop_orders: { data: ORDER, error: null },
      shop_order_messages: { data: MESSAGES, error: null },
      profiles: { data: [], error: null },
    })

    await getDetail()

    expect(selects.find((q) => q.table === 'shop_order_messages').select).toBe('*')
  })

  it('supplies each sender\'s name as sender_name, the field the admin screen reads', async () => {
    makeClient({
      shop_orders: { data: ORDER, error: null },
      shop_order_messages: { data: MESSAGES, error: null },
      profiles: { data: [{ id: 'u1', full_name: 'Ada', display_name: 'ada_o' }, { id: 'u2', full_name: null, display_name: 'Pharma Ltd' }], error: null },
    })

    const res = await getDetail()

    expect(res.statusCode).toBe(200)
    expect(res.body.data.messages.map((m) => m.sender_name)).toEqual(['Ada', 'Pharma Ltd'])
  })

  it('still returns the messages when the name lookup fails', async () => {
    makeClient({
      shop_orders: { data: ORDER, error: null },
      shop_order_messages: { data: MESSAGES, error: null },
      profiles: { data: null, error: { message: 'boom' } },
    })

    const res = await getDetail()

    expect(res.statusCode).toBe(200)
    expect(res.body.data.messages).toHaveLength(2)
    expect(res.body.data.messages[0].message).toBe('hi')
  })

  it('does not hide a failure to read the messages themselves', async () => {
    makeClient({
      shop_orders: { data: ORDER, error: null },
      shop_order_messages: { data: null, error: { message: 'permission denied' } },
    })

    const res = await getDetail()

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/permission denied/)
  })
})
