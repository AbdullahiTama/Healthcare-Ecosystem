// Test helpers shared by both apps' payment suites (import from '@care-ecosystem/shared-payments/testing').
// Test-only: relies on vitest's `vi` global, which both apps enable.
// A small in-memory stand-in for the supabase-js query builder, enough for the payment handlers:
// select/eq/in/maybeSingle/single, insert (with a unique `reference` on payment_intents, like the
// real table), update with filters, and scripted rpc() answers. Every call is recorded.
export function createFakeSupabase({ tables = {}, rpc = {} } = {}) {
  const data = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]))
  const calls = []
  let seq = 0

  const from = (table) => {
    data[table] ||= []
    const st = { op: 'select', filters: [], row: null, patch: null }
    const matches = (r) => st.filters.every(([k, v, kind]) => (kind === 'in' ? v.includes(r[k]) : r[k] === v))
    const run = () => {
      calls.push({ table, op: st.op, row: st.row, patch: st.patch, filters: st.filters.map(([k, v]) => [k, v]) })
      if (st.op === 'insert') {
        const row = { id: `${table}-${++seq}`, created_at: new Date().toISOString(), ...st.row }
        if (table === 'payment_intents' && data[table].some((r) => r.reference === row.reference)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
        }
        if (table === 'payment_provider_events' && data[table].some((r) => r.provider === row.provider && r.event_id === row.event_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
        }
        if (table === 'payment_intents') Object.assign(row, { status: 'created', currency: 'NGN', provider: 'paystack', ...st.row })
        data[table].push(row)
        return { data: row, error: null }
      }
      if (st.op === 'update') {
        const hit = data[table].filter(matches)
        hit.forEach((r) => Object.assign(r, st.patch))
        return { data: hit, error: null }
      }
      return { data: data[table].filter(matches), error: null }
    }
    const b = {
      select: () => b,
      insert: (row) => { st.op = 'insert'; st.row = row; return b },
      update: (patch) => { st.op = 'update'; st.patch = patch; return b },
      eq: (k, v) => { st.filters.push([k, v, 'eq']); return b },
      in: (k, v) => { st.filters.push([k, v, 'in']); return b },
      order: () => b,
      limit: () => b,
      is: () => b,
      maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error } },
      single: async () => { const r = run(); const row = Array.isArray(r.data) ? r.data[0] : r.data; return row ? { data: row, error: r.error } : { data: null, error: r.error || { message: 'no rows' } } },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    }
    return b
  }

  const client = {
    from,
    rpc: async (name, args) => {
      calls.push({ table: null, op: 'rpc', name, args })
      const fn = rpc[name]
      if (!fn) return { data: null, error: { message: `rpc ${name} not scripted` } }
      const out = await fn(args, data)
      return out && 'data' in out ? out : { data: out, error: null }
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'user@example.com' } } }) } },
  }
  return Object.assign(client, { data, calls })
}

/** A fake PaymentProvider whose verifyPayment answers come from `verify(reference)`. */
export function createFakeProvider({ verify, initialize } = {}) {
  return {
    name: 'paystack',
    initializePayment: globalThis.vi.fn(initialize || (async ({ reference }) => ({ reference, authorizationUrl: `https://checkout.test/${reference}`, accessCode: 'ac' }))),
    verifyPayment: globalThis.vi.fn(verify || (async () => { throw new Error('verify not scripted') })),
  }
}

export const verifiedPayment = (over = {}) => ({
  provider: 'paystack', reference: 'r', providerTransactionId: '4099', status: 'success', amountKobo: 0, currency: 'NGN', metadata: {}, ...over,
})

export function createRes() {
  const r = { statusCode: 200, body: null, headers: {} }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.setHeader = (k, v) => { r.headers[k] = v }
  return r
}
