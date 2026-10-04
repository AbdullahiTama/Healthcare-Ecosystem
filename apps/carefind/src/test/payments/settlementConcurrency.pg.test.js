// @vitest-environment node
// Phase 04: REAL concurrency tests for the settlement engine. PGlite is a single connection, so it can
// only prove replay-idempotency; these open many connections to a real Postgres and fire settlements
// at the same instant, which is what actually happens when a webhook, a redirect and a retry collide.
//
// They run only when PG_CONCURRENCY_URL points at a Postgres you can create databases in:
//   PG_CONCURRENCY_URL=postgres://postgres:pw@127.0.0.1:54999/postgres npm run test:concurrency
// (any local Postgres 15+, a Docker container, or the embedded-postgres package). A throw-away
// database is created per run and dropped afterwards. Without the variable the suite is skipped.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createTestDatabase } from './fixtures/realPostgres.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A cold local Postgres on a slow disk can take a while; correctness, not speed, is under test.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 600_000 })

const URL_ENV = process.env.PG_CONCURRENCY_URL
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const SQL = [
  read('./fixtures/liveSchemaSubset.sql'),
  read('../../../../../supabase/migrations/carefind_20261003_payment_intents_foundation.sql'),
  read('../../../../../supabase/migrations/carefind_20261004_settle_payment_intent.sql'),
  read('../../../../../supabase/migrations/carefind_20261006_settle_plan_and_carehub_appointments.sql'),
]

const COIN = 20000
let pool, drop, n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 20000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}_${Math.random().toString(36).slice(2, 9)}`

async function newDatabase() {
  ;({ pool, drop } = await createTestDatabase(SQL))
}

async function intent(over = {}) {
  const r = { reference: ref('ref'), purpose: 'wallet_topup', customer_id: uid(), business_id: null, entity_type: null, entity_id: null, expected_amount: 5 * COIN, metadata: { coins: 5 }, ...over }
  const q = await pool.query(
    `insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount, metadata)
     values ($1,'carefind',$2,$3,$4,$5,$6,$7,$8::jsonb) returning *`,
    [r.reference, r.purpose, r.customer_id, r.business_id, r.entity_type, r.entity_id, r.expected_amount, JSON.stringify(r.metadata)]
  )
  return q.rows[0]
}
const settle = async (i, over = {}) => {
  const a = { txn: `T${i.reference}`, amount: i.expected_amount, ...over }
  return (await pool.query('select settle_payment_intent($1,$2,$3,$4,$5) r', [i.reference, 'paystack', a.txn, a.amount, 'NGN'])).rows[0].r
}
const tally = (results) => results.reduce((m, r) => ((m[r.outcome] = (m[r.outcome] || 0) + 1), m), {})
const one = async (sql, p = []) => (await pool.query(sql, p)).rows[0]
const bal = async (u) => Number((await one('select balance from wallets where user_id = $1', [u]))?.balance ?? 0)

describe.skipIf(!URL_ENV)('settlement engine under real concurrency', () => {
  beforeAll(newDatabase, 600000)
  afterAll(async () => {
    await drop?.()
  })

  it('the same intent settled by 25 callers at once (webhook + redirect + retries): exactly one settles, the rest see already_settled', async () => {
    const i = await intent()
    const results = await Promise.all(Array.from({ length: 25 }, () => settle(i)))
    expect(tally(results)).toEqual({ settled: 1, already_settled: 24 })
    expect(await bal(i.customer_id)).toBe(5)
    expect(Number((await one('select count(*) c from transactions where reference = $1', [i.reference])).c)).toBe(1)
  })

  it('150 independent webhook+redirect races (two simultaneous callers each): never a double credit, never both "settled"', async () => {
    const intents = await Promise.all(Array.from({ length: 150 }, () => intent()))
    const pairs = await Promise.all(intents.map((i) => Promise.all([settle(i), settle(i)])))
    for (const [a, b] of pairs) expect([a.outcome, b.outcome].sort()).toEqual(['already_settled', 'settled'])
    const total = Number((await one(`select coalesce(sum(balance),0) s from wallets where user_id = any($1)`, [intents.map((i) => i.customer_id)])).s)
    expect(total).toBe(150 * 5)
  })

  it('20 DIFFERENT top-ups for one user at once: every payment credited, none lost', async () => {
    const user = uid()
    const intents = await Promise.all(Array.from({ length: 20 }, () => intent({ customer_id: user })))
    const results = await Promise.all(intents.map((i) => settle(i)))
    expect(tally(results)).toEqual({ settled: 20 })
    expect(await bal(user)).toBe(100)
  })

  it('10 payments for ONE appointment at once: exactly one pays it, nine are needs_refund(already_paid), the business is credited once', async () => {
    const business = uid()
    const a = (await pool.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status) values ($1,'Ada','carefind',150050,'unpaid') returning id`, [business])).rows[0]
    const intents = await Promise.all(Array.from({ length: 10 }, () => intent({ purpose: 'booking', customer_id: null, business_id: business, entity_type: 'appointment', entity_id: a.id, expected_amount: 150050, metadata: {} })))
    const results = await Promise.all(intents.map((i) => settle(i)))
    expect(tally(results)).toEqual({ settled: 1, needs_refund: 9 })
    expect(results.filter((r) => r.outcome === 'needs_refund').every((r) => r.reason === 'already_paid')).toBe(true)
    expect(Number((await one('select held_balance h from business_wallets where business_id = $1', [business])).h)).toBe(120040)
    expect(Number((await one(`select count(*) c from platform_transactions where business_id = $1`, [business])).c)).toBe(1)
  })

  it('8 payments for ONE consultation pair at once: one booking, one professional credit, seven needs_refund(already_booked) with nothing written', async () => {
    const professional = uid(), patient = uid()
    await pool.query('insert into profiles (id) values ($1)', [professional])
    const intents = await Promise.all(Array.from({ length: 8 }, () => intent({ purpose: 'consultation', customer_id: patient, entity_type: 'professional', entity_id: professional, expected_amount: 500000, metadata: {} })))
    const results = await Promise.all(intents.map((i) => settle(i)))
    expect(tally(results)).toEqual({ settled: 1, needs_refund: 7 })
    expect(results.filter((r) => r.outcome === 'needs_refund').every((r) => r.reason === 'already_booked')).toBe(true)
    expect(await bal(professional)).toBe(20)
    expect(Number((await one(`select count(*) c from professional_consultations where professional_id = $1 and status = 'paid'`, [professional])).c)).toBe(1)
    expect(Number((await one(`select count(*) c from transactions where user_id = $1 and type = 'consultation_earnings'`, [professional])).c)).toBe(1)
  })

  it('6 subscription payments by one subscriber to one creator at once: all credited, and the 30-day extensions STACK (no lost update)', async () => {
    const creator = uid(), subscriber = uid()
    await pool.query('insert into profiles (id, subscription_price) values ($1, 10)', [creator])
    const intents = await Promise.all(Array.from({ length: 6 }, () => intent({ purpose: 'creator_subscription', customer_id: subscriber, entity_type: 'creator', entity_id: creator, expected_amount: 10 * COIN, metadata: { coins: 10 } })))
    const results = await Promise.all(intents.map((i) => settle(i)))
    expect(tally(results)).toEqual({ settled: 6 })
    expect(await bal(creator)).toBe(6 * 8)
    const sub = await one('select expires_at from creator_subscriptions where subscriber_id = $1 and creator_id = $2', [subscriber, creator])
    const days = (new Date(sub.expires_at).getTime() - Date.now()) / 86400e3
    expect(days).toBeGreaterThan(6 * 30 - 1) // six paid months, not one
    expect(days).toBeLessThan(6 * 30 + 1)
  })

  it('6 subscription payments of a ONE-coin price (creator share rounds to 0, so no wallet row serialises them): the extensions still stack', async () => {
    const creator = uid(), subscriber = uid()
    await pool.query('insert into profiles (id, subscription_price) values ($1, 1)', [creator])
    const intents = await Promise.all(Array.from({ length: 6 }, () => intent({ purpose: 'creator_subscription', customer_id: subscriber, entity_type: 'creator', entity_id: creator, expected_amount: COIN, metadata: { coins: 1 } })))
    const results = await Promise.all(intents.map((i) => settle(i)))
    expect(tally(results)).toEqual({ settled: 6 })
    const sub = await one('select expires_at from creator_subscriptions where subscriber_id = $1 and creator_id = $2', [subscriber, creator])
    const days = (new Date(sub.expires_at).getTime() - Date.now()) / 86400e3
    expect(days).toBeGreaterThan(6 * 30 - 1) // six paid months, not one
  })

  it('the same CareHub plan payment settled by 25 callers at once renews the plan exactly once', async () => {
    const b = (await pool.query(`insert into businesses (name) values ('Clinic') returning id`)).rows[0].id
    const i = await intent({ purpose: 'plan_renewal', customer_id: null, business_id: b, expected_amount: 500000, metadata: { months: 1 } })
    const results = await Promise.all(Array.from({ length: 25 }, () => settle(i)))
    expect(tally(results)).toEqual({ settled: 1, already_settled: 24 })
    expect(Number((await one('select count(*) c from plan_payments where business_id = $1', [b])).c)).toBe(1)
    const days = (new Date((await one('select plan_expires_at e from businesses where id = $1', [b])).e).getTime() - Date.now()) / 86400e3
    expect(days).toBeGreaterThan(27)
    expect(days).toBeLessThan(32)
  })

  it('6 DIFFERENT plan payments for one business at once: every one recorded and the paid months stack (no lost renewal)', async () => {
    const b = (await pool.query(`insert into businesses (name) values ('Clinic') returning id`)).rows[0].id
    const intents = await Promise.all(Array.from({ length: 6 }, () => intent({ purpose: 'plan_renewal', customer_id: null, business_id: b, expected_amount: 500000, metadata: { months: 1 } })))
    const results = await Promise.all(intents.map((i) => settle(i)))
    expect(tally(results)).toEqual({ settled: 6 })
    expect(Number((await one('select count(*) c from plan_payments where business_id = $1', [b])).c)).toBe(6)
    const days = (new Date((await one('select plan_expires_at e from businesses where id = $1', [b])).e).getTime() - Date.now()) / 86400e3
    expect(days).toBeGreaterThan(6 * 28) // six paid months, not one
  })

  it('10 card payments for ONE CareHub appointment at once: one pays it, nine are needs_refund(already_paid), the business is credited once', async () => {
    const business = uid()
    const a = (await pool.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status) values ($1,'Ada','carehub',150050,'unpaid') returning id`, [business])).rows[0]
    const intents = await Promise.all(Array.from({ length: 10 }, () => intent({ purpose: 'appointment', customer_id: null, business_id: business, entity_type: 'appointment', entity_id: a.id, expected_amount: 150050, metadata: {} })))
    const results = await Promise.all(intents.map((i) => settle(i)))
    expect(tally(results)).toEqual({ settled: 1, needs_refund: 9 })
    expect(Number((await one('select held_balance h from business_wallets where business_id = $1', [business])).h)).toBe(120040)
  })

  it('a mixed storm (top-ups, subscriptions, consultations, bookings, duplicates) completes with no deadlock or error', async () => {
    const creator = uid(), pro = uid(), business = uid()
    await pool.query('insert into profiles (id, subscription_price) values ($1, 4), ($2, null)', [creator, pro])
    const jobs = []
    for (let k = 0; k < 15; k++) {
      const u = uid()
      jobs.push(intent({ purpose: 'wallet_topup', customer_id: u }))
      jobs.push(intent({ purpose: 'creator_subscription', customer_id: u, entity_type: 'creator', entity_id: creator, expected_amount: 4 * COIN, metadata: { coins: 4 } }))
      jobs.push(intent({ purpose: 'consultation', customer_id: u, entity_type: 'professional', entity_id: pro, expected_amount: 300000, metadata: {} }))
      const a = (await pool.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status) values ($1,'x','carefind',100000,'unpaid') returning id`, [business])).rows[0]
      jobs.push(intent({ purpose: 'booking', customer_id: null, business_id: business, entity_type: 'appointment', entity_id: a.id, expected_amount: 100000, metadata: {} }))
    }
    const intents = await Promise.all(jobs)
    const settled = await Promise.allSettled([...intents, ...intents].map((i) => settle(i))) // every intent hit twice, all at once
    expect(settled.filter((s) => s.status === 'rejected').map((s) => s.reason.message)).toEqual([])
    const outcomes = tally(settled.map((s) => s.value))
    expect(outcomes.settled).toBe(intents.length)
    expect(outcomes.already_settled).toBe(intents.length)
    // conservation: creator got 80% of 15 x 4 coins (floor 3.2 -> 3) and the pro 80% of 15 x N3,000 (floor 2400000/20000 = 120... per payment 12)
    expect(await bal(creator)).toBe(15 * 3)
    expect(await bal(pro)).toBe(15 * 12)
    expect(Number((await one('select held_balance h from business_wallets where business_id = $1', [business])).h)).toBe(15 * 80000)
  })
})
