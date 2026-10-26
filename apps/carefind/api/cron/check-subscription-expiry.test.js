import { describe, it, expect, vi, beforeEach } from 'vitest'

// The daily plan-expiry reminder. It must refuse to run without the cron secret (Financial-Architecture-Audit F-21:
// a request with no Authorization header used to skip the check).
const h = vi.hoisted(() => ({ filters: [], businesses: [], inserts: [], processBatch: vi.fn(async () => {}) }))

function query(table) {
  const q = {
    select: () => q,
    gt: (col, v) => { h.filters.push(['gt', table, col, v]); return q },
    lte: (col, v) => { h.filters.push(['lte', table, col, v]); return q },
    gte: () => q,
    eq: (col, v) => { h.filters.push(['eq', table, col, v]); return q },
    is: (col, v) => { h.filters.push(['is', table, col, v]); return q },
    maybeSingle: async () => ({ data: null, error: null }),
    insert: async (row) => { h.inserts.push(row); return { error: null } },
    then: (resolve) => resolve({ data: h.businesses, error: null }),
  }
  return q
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: query }) }))
vi.mock('@care-ecosystem/shared-email', () => ({ EmailService: class { processBatch() { return h.processBatch() } } }))

import handler from './check-subscription-expiry.js'

const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const call = (headers = {}) => { const r = res(); return handler({ method: 'GET', headers }, r).then(() => r) }

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  process.env.CRON_SECRET = 'cron-secret'
  h.filters = []
  h.inserts = []
  h.businesses = [{ id: 'root', name: 'Allen Pharmacy', plan: 'growth', plan_expires_at: new Date(Date.now() + 3 * 864e5).toISOString(), email: 'owner@a.test', status: 'active' }]
})

describe('check-subscription-expiry cron', () => {
  it('refuses to run with no CRON_SECRET configured', async () => {
    delete process.env.CRON_SECRET
    const r = await call({ authorization: 'Bearer anything' })
    expect(r.statusCode).toBe(500)
    expect(h.inserts).toHaveLength(0)
  })

  it('rejects a request with no token (it used to skip the check), and one with the wrong token', async () => {
    expect((await call()).statusCode).toBe(401)
    expect((await call({ authorization: 'Bearer nope' })).statusCode).toBe(401)
    expect(h.inserts).toHaveLength(0)
  })

  it('with the secret, reminds the owner of an expiring main business', async () => {
    const r = await call({ authorization: 'Bearer cron-secret' })
    expect(r.statusCode).toBe(200)
    expect(r.body).toMatchObject({ ok: true, scanned: 1, enqueued: 1 })
    expect(h.inserts[0]).toMatchObject({ to_email: 'owner@a.test', template_key: 'subscription_expiry' })
  })
})
