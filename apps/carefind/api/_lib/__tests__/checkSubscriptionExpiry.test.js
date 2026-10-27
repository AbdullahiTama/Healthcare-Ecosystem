import { describe, it, expect, vi, beforeEach } from 'vitest'

// Lives under api/_lib (not next to the handler) because every file under api/ that does not start with _ is a
// Vercel function, and CareFind is at the Hobby plan's 12-function limit.
// The daily plan-expiry reminder. It must refuse to run without the cron secret (Financial-Architecture-Audit F-21:
// a request with no Authorization header used to skip the check), and it reminds main businesses only: a branch
// follows its main business's plan and has no owner email of its own (carehub_20261212_branches_without_email).
const h = vi.hoisted(() => ({ filters: [], businesses: [], inserts: [], insertError: null, enforcementStartedAt: null, processBatch: vi.fn(async () => {}) }))

function query(table) {
  const q = {
    select: () => q,
    gt: (col, v) => { h.filters.push(['gt', table, col, v]); return q },
    lte: (col, v) => { h.filters.push(['lte', table, col, v]); return q },
    gte: () => q,
    eq: (col, v) => { h.filters.push(['eq', table, col, v]); return q },
    is: (col, v) => { h.filters.push(['is', table, col, v]); return q },
    maybeSingle: async () => ({ data: null, error: null }),
    insert: async (row) => { h.inserts.push(row); return { error: h.insertError } },
    then: (resolve) => resolve({ data: h.businesses, error: null }),
  }
  return q
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: query, rpc: async () => ({ data: h.enforcementStartedAt, error: h.enforcementStartedAt ? null : { message: 'Could not find the function' } }) }) }))
vi.mock('@care-ecosystem/shared-email', () => ({ EmailService: class { processBatch() { return h.processBatch() } }, senderFor: (app) => (app === 'carehub' ? 'CareHub <support@mail.carefindhub.com>' : 'CareFind <x>') }))

import handler from '../../cron/check-subscription-expiry.js'

const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const call = (headers = {}) => { const r = res(); return handler({ method: 'GET', headers }, r).then(() => r) }

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  process.env.CRON_SECRET = 'cron-secret'
  h.filters = []
  h.inserts = []
  h.insertError = null
  h.enforcementStartedAt = null
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

  it('asks only for main businesses, never branches', async () => {
    await call({ authorization: 'Bearer cron-secret' })
    expect(h.filters).toContainEqual(['is', 'businesses', 'parent_business_id', null])
  })

  it('is sent as CareHub, with an idempotency key so a re-run cannot mail twice', async () => {
    await call({ authorization: 'Bearer cron-secret' })
    expect(h.inserts[0]).toMatchObject({ app: 'carehub', from_email: 'CareHub <support@mail.carefindhub.com>', payload: { stage: 'before_3', daysLeft: 3 } })
    expect(h.inserts[0].idempotency_key).toMatch(/^plan_reminder:root:\d{4}-\d{2}-\d{2}:before_3$/)
    h.inserts = []
    h.insertError = { code: '23505', message: 'duplicate key' }
    const r = await call({ authorization: 'Bearer cron-secret' })
    expect(r.body).toMatchObject({ enqueued: 0, alreadySent: 1 })
  })

  it('keeps reminding after expiry: the grace period, then restricted (once restrictions are switched on)', async () => {
    h.enforcementStartedAt = new Date(Date.now() - 60 * 864e5).toISOString()
    h.businesses = [
      { id: 'g', name: 'Grace', plan: 'basic', plan_expires_at: new Date(Date.now() - 2 * 864e5).toISOString(), email: 'g@a.test', status: 'active' },
      { id: 'r', name: 'Lapsed', plan: 'basic', plan_expires_at: new Date(Date.now() - 40 * 864e5).toISOString(), email: 'r@a.test', status: 'active' },
    ]
    const r = await call({ authorization: 'Bearer cron-secret' })
    expect(r.body).toMatchObject({ scanned: 2, enqueued: 2, stages: { expired: 1, restricted: 1 } })
    expect(h.inserts.find((i) => i.to_email === 'r@a.test')).toMatchObject({ subject: 'Some CareHub features are paused', payload: { stage: 'restricted' } })
    expect(h.inserts.find((i) => i.to_email === 'g@a.test').payload.graceEndDate).toBeTruthy()
    // Expired businesses are now included: the query no longer stops at "not yet expired".
    expect(h.filters.find((f) => f[0] === 'gt')).toBeUndefined()
  })
})
