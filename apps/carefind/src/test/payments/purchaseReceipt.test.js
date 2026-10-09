import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHandler } from '../../../api/_handlers/purchase-receipt.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'ada@example.com' }
const PRO = '22222222-2222-4222-8222-222222222222'
const CREATOR = '33333333-3333-4333-8333-333333333333'
const NOW = Date.parse('2026-10-09T12:00:00Z')

function fakeDb(tables) {
  const queries = []
  return {
    queries,
    from(table) {
      const q = { table, eq: {} }
      queries.push(q)
      const chain = {
        select: () => chain,
        eq: (col, val) => { q.eq[col] = val; return chain },
        maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
      }
      return chain
    },
  }
}

function setup({ user = USER, tables = {} } = {}) {
  const supabase = fakeDb(tables)
  const announce = vi.fn().mockResolvedValue({ announced: true, emailed: true })
  const handler = createHandler({ getSupabase: () => supabase, verify: async () => user, announce, now: () => NOW })
  return { supabase, announce, handler }
}

function call(handler, body, { method = 'POST', headers = { host: 'carefind.example' } } = {}) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(o) { this.body = o; return this } }
  return handler({ method, headers, body }, res).then(() => res)
}

describe('purchase-receipt', () => {
  // The link base for emails comes from server config only, never from headers.
  beforeEach(() => vi.stubEnv('CAREFIND_APP_URL', 'https://carefind.example'))
  afterEach(() => vi.unstubAllEnvs())

  it('rejects anything but POST and anonymous callers', async () => {
    const { handler } = setup()
    expect((await call(handler, {}, { method: 'GET' })).statusCode).toBe(405)

    const anon = createHandler({ getSupabase: () => fakeDb({}), verify: async () => null, announce: vi.fn(), now: () => NOW })
    const res = await call(anon, { kind: 'consultation', professionalId: PRO })
    expect(res.statusCode).toBe(401)
  })

  it('announces a CareCoin consultation from the booking row, not from anything the client sent', async () => {
    const { handler, announce, supabase } = setup({
      tables: { professional_consultations: { id: 'abcdef12-0000-4000-8000-000000000000', fee: 5000, created_at: '2026-10-09T11:58:00Z' } },
    })
    // The client also tries to dictate an amount; it must be ignored.
    const res = await call(handler, { kind: 'consultation', professionalId: PRO, amountKobo: 1, fee: 1 }, { headers: { host: 'evil.example' } })

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ announced: true, emailed: true })
    // The lookup is scoped to the verified caller as the patient.
    expect(supabase.queries[0]).toMatchObject({
      table: 'professional_consultations',
      eq: { professional_id: PRO, patient_id: USER.id, status: 'paid' },
    })
    const [kind, facts, ctx] = announce.mock.calls[0]
    expect(kind).toBe('consultation')
    expect(facts).toMatchObject({
      buyerId: USER.id, professionalId: PRO, amountKobo: 500000, coins: 25, method: 'coins',
      reference: 'cf_consult_coin_abcdef12', dedupeId: 'abcdef12-0000-4000-8000-000000000000',
    })
    expect(ctx).toMatchObject({ buyerEmail: 'ada@example.com', appUrl: 'https://carefind.example' })
  })

  it('404s when the caller has no such booking (cannot receipt someone else\'s purchase)', async () => {
    const { handler, announce } = setup({ tables: {} })
    const res = await call(handler, { kind: 'consultation', professionalId: PRO })
    expect(res.statusCode).toBe(404)
    expect(announce).not.toHaveBeenCalled()
  })

  it('does not re-announce a booking made long ago', async () => {
    const { handler, announce } = setup({
      tables: { professional_consultations: { id: 'abcdef12-0000-4000-8000-000000000000', fee: 5000, created_at: '2026-09-01T00:00:00Z' } },
    })
    const res = await call(handler, { kind: 'consultation', professionalId: PRO })
    expect(res.body).toEqual({ announced: false, reason: 'not_recent' })
    expect(announce).not.toHaveBeenCalled()
  })

  it('announces a subscription period from the subscription row', async () => {
    const expires = '2026-11-08T12:00:00Z' // ~30 days out
    const { handler, announce, supabase } = setup({ tables: { creator_subscriptions: { price: 12, expires_at: expires } } })
    const res = await call(handler, { kind: 'subscription', creatorId: CREATOR, renewal: true })

    expect(res.statusCode).toBe(200)
    expect(supabase.queries[0]).toMatchObject({ table: 'creator_subscriptions', eq: { subscriber_id: USER.id, creator_id: CREATOR } })
    const [kind, facts] = announce.mock.calls[0]
    expect(kind).toBe('subscription')
    expect(facts).toMatchObject({
      buyerId: USER.id, creatorId: CREATOR, coins: 12, amountKobo: 240000, method: 'coins',
      dedupeId: `${USER.id}:${CREATOR}:${expires}`, expiresAt: expires, renewal: true,
    })
    expect(facts.reference).toMatch(/^cf_sub_coin_[0-9a-f]{10}$/)
  })

  it('a renewal gets a different identity from the period before it', async () => {
    const first = setup({ tables: { creator_subscriptions: { price: 12, expires_at: '2026-11-08T12:00:00Z' } } })
    const renewed = setup({ tables: { creator_subscriptions: { price: 12, expires_at: '2026-12-08T12:00:00Z' } } })
    await call(first.handler, { kind: 'subscription', creatorId: CREATOR })
    await call(renewed.handler, { kind: 'subscription', creatorId: CREATOR })
    expect(first.announce.mock.calls[0][1].dedupeId).not.toBe(renewed.announce.mock.calls[0][1].dedupeId)
  })

  it('does not announce a subscription that is not a freshly bought period', async () => {
    const { handler, announce } = setup({ tables: { creator_subscriptions: { price: 12, expires_at: '2026-10-12T12:00:00Z' } } })
    const res = await call(handler, { kind: 'subscription', creatorId: CREATOR })
    expect(res.body).toEqual({ announced: false, reason: 'not_recent' })
    expect(announce).not.toHaveBeenCalled()
  })

  it('treats renewal as wording only: only a literal true counts', async () => {
    const { handler, announce } = setup({ tables: { creator_subscriptions: { price: 12, expires_at: '2026-11-08T12:00:00Z' } } })
    await call(handler, { kind: 'subscription', creatorId: CREATOR, renewal: 'yes' })
    expect(announce.mock.calls[0][1].renewal).toBe(false)
  })

  it('validates input before touching the database', async () => {
    const { handler, supabase, announce } = setup()
    expect((await call(handler, { kind: 'consultation', professionalId: 'not-a-uuid' })).statusCode).toBe(400)
    expect((await call(handler, { kind: 'consultation', professionalId: "x' or '1'='1" })).statusCode).toBe(400)
    expect((await call(handler, { kind: 'subscription' })).statusCode).toBe(400)
    expect((await call(handler, { kind: 'gift-card' })).statusCode).toBe(400)
    expect((await call(handler, undefined)).statusCode).toBe(400)
    expect(supabase.queries).toHaveLength(0)
    expect(announce).not.toHaveBeenCalled()
  })
})
