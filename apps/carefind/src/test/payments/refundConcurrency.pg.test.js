// @vitest-environment node
// Phase 09: REAL concurrency tests for the refund engine. Many connections hit a real Postgres at the same instant: a payment
// is refunded once however many cancels/admins/webhooks race, the business is debited once and restored at most once, CareCoins
// go back once, and the wallet never goes negative. Runs only with PG_CONCURRENCY_URL (see settlementConcurrency.pg.test.js).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createTestDatabase, hasRealPostgres } from './fixtures/realPostgres.js'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

vi.setConfig({ testTimeout: 180_000, hookTimeout: 600_000 })

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
const SQL = [
  read('./fixtures/liveSchemaSubset.sql'),
  M('carefind_20261003_payment_intents_foundation'),
  M('carefind_20261004_settle_payment_intent'),
  M('carefind_20261005_coin_ledger'),
  M('carefind_20261005_coin_writers_use_ledger'),
  M('carefind_20261005_lock_wallets_to_ledger'),
  M('carefind_20261006_settle_plan_and_carehub_appointments'),
  M('carefind_20261009_refund_engine'),
]

let pool, drop, n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 140000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}_${Math.random().toString(36).slice(2, 8)}`
const q = async (sql, p = []) => (await pool.query(sql, p)).rows
const tally = (results) => results.reduce((m, r) => { const k = r.status === 'fulfilled' ? String(r.value) : `error:${r.reason.code || r.reason.message}`; m[k] = (m[k] || 0) + 1; return m }, {})
const FEE = 1_000_000
const wallet = async (b) => (await q('select held_balance::int held, available_balance::int avail from business_wallets where business_id = $1', [b]))[0]

async function together(count, work, ms = 400) {
  const clients = await Promise.all(Array.from({ length: count }, () => pool.connect()))
  try {
    return await Promise.allSettled(clients.map(async (c, i) => {
      try { await c.query('begin'); const r = await work(c, i); await c.query('select pg_sleep($1)', [ms / 1000]); await c.query('commit'); return r }
      catch (e) { await c.query('rollback').catch(() => {}); throw e }
    }))
  } finally { clients.forEach((c) => c.release()) }
}

async function paidCard(fee = FEE) {
  const b = uid()
  const a = (await q(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'Ada','carehub',$2,'unpaid',$3) returning id`, [b, fee, ref('appt')]))[0]
  const reference = ref('chapp')
  await pool.query(`insert into payment_intents (reference, application, purpose, business_id, entity_type, entity_id, expected_amount, metadata) values ($1,'carehub','appointment',$2,'appointment',$3,$4,'{}'::jsonb)`, [reference, b, a.id, fee])
  await pool.query('select settle_payment_intent($1,$2,$3,$4,$5)', [reference, 'paystack', `T${reference}`, fee, 'NGN'])
  return { b, id: a.id, reference }
}
const request = (id, cause = 'booking_cancelled') => pool.query('select request_refund($1,$2,$3) r', [cause, 'appointment', id]).then((r) => r.rows[0].r)
const settle = (outcome, reference) => pool.query('select settle_refund($1,null,$2) r', [outcome, reference]).then((r) => r.rows[0].r)
const clean = async () => {
  expect((await q("select * from reconcile_refunds(60) where kind not in ('stuck','business_shortfall')"))).toEqual([])
  expect(await q('select 1 from business_wallets where held_balance < 0 or available_balance < 0')).toEqual([])
  expect(await q('select * from reconcile_coin_wallets()')).toEqual([])
}

describe.skipIf(!hasRealPostgres)('refund engine under real concurrency', () => {
  beforeAll(async () => {
    ;({ pool, drop } = await createTestDatabase(SQL, { beforeFile: async (i, db) => { if (i === 4) await createLegacyStubs(db) } }))
  }, 600_000)
  afterAll(async () => { await drop?.() })

  it('40 simultaneous refund requests for one paid booking (cancel + admin + retries): exactly one refund, the business debited once', async () => {
    const p = await paidCard()
    const results = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => request(p.id, i % 2 ? 'admin_refund' : 'booking_cancelled').then((r) => r.outcome)))
    expect(tally(results)).toEqual({ requested: 1, already_requested: 39 })
    expect(await wallet(p.b)).toEqual({ held: 0, avail: 0 })
    expect((await q(`select count(*)::int c from business_wallet_transactions where business_id = $1 and type = 'refund_debit'`, [p.b]))[0].c).toBe(1)
    expect((await q('select count(*)::int c from refunds where entity_id = $1', [p.id]))[0].c).toBe(1)
    await clean()
  })

  it('12 OVERLAPPING transactions (held open 400ms) requesting one refund: one refund, no errors', async () => {
    const p = await paidCard()
    const results = await together(12, async (c) => (await c.query(`select request_refund('booking_cancelled','appointment',$1) r`, [p.id])).rows[0].r.outcome)
    expect(results.filter((x) => x.status === 'rejected').map((x) => x.reason.message)).toEqual([])
    expect(tally(results)).toEqual({ requested: 1, already_requested: 11 })
    expect((await q(`select count(*)::int c from business_wallet_transactions where business_id = $1 and type = 'refund_debit'`, [p.b]))[0].c).toBe(1)
  })

  it('40 simultaneous failure notices for one refund: the business is restored exactly once', async () => {
    const p = await paidCard()
    const r = await request(p.id)
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => settle('failed', r.reference).then((x) => x.result)))
    expect(tally(results)).toEqual({ failed: 1, already_failed: 39 })
    expect(await wallet(p.b)).toEqual({ held: 800_000, avail: 0 })
    expect((await q(`select count(*)::int c from business_wallet_transactions where business_id = $1 and type = 'refund_restore'`, [p.b]))[0].c).toBe(1)
    await clean()
  })

  it('12 OVERLAPPING failure notices: restored once, no errors', async () => {
    const p = await paidCard()
    const r = await request(p.id)
    const results = await together(12, async (c) => (await c.query(`select settle_refund('failed',null,$1) r`, [r.reference])).rows[0].r.result)
    expect(results.filter((x) => x.status === 'rejected').map((x) => x.reason.message)).toEqual([])
    expect(tally(results)).toEqual({ failed: 1, already_failed: 11 })
    expect(await wallet(p.b)).toEqual({ held: 800_000, avail: 0 })
  })

  it('processed / failed / processing racing on one refund: one consistent outcome, never "completed AND restored"', async () => {
    for (let round = 0; round < 8; round++) {
      const p = await paidCard()
      const r = await request(p.id)
      const calls = []
      for (let i = 0; i < 6; i++) calls.push(settle('processed', r.reference), settle('failed', r.reference), settle('processing', r.reference))
      const results = await Promise.allSettled(calls)
      expect(results.filter((x) => x.status === 'rejected').map((x) => x.reason.message)).toEqual([])
      const [row] = await q('select status from refunds where id = $1', [r.id])
      const restores = (await q(`select count(*)::int c from business_wallet_transactions where business_id = $1 and type = 'refund_restore'`, [p.b]))[0].c
      const [appt] = await q('select payment_status from appointments where id = $1', [p.id])
      if (row.status === 'completed') { expect(restores).toBe(0); expect(appt.payment_status).toBe('refunded'); expect(await wallet(p.b)).toEqual({ held: 0, avail: 0 }) }
      else { expect(row.status).toBe('failed'); expect(restores).toBe(1); expect(appt.payment_status).toBe('paid'); expect(await wallet(p.b)).toEqual({ held: 800_000, avail: 0 }) }
    }
    await clean()
  })

  it('30 simultaneous requests for one CareCoin booking: coins returned once', async () => {
    const b = uid(); const u = uid()
    await pool.query('insert into auth.users (id) values ($1)', [u])
    await pool.query(`select _post_coin_entry($1,20,'topup',$2)`, [u, ref('seed')])
    const a = (await q(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'Ada','carefind',100000,'unpaid',$2) returning id`, [b, ref('cfappt')]))[0]
    expect((await q('select pay_booking_with_credits($1,$2) r', [u, a.id]))[0].r).toBe('ok')
    const results = await Promise.allSettled(Array.from({ length: 30 }, () => request(a.id).then((r) => r.outcome)))
    expect(tally(results)).toEqual({ completed: 1, already_refunded: 29 })
    expect(Number((await q('select balance from wallets where user_id = $1', [u]))[0].balance)).toBe(20)
    expect((await q(`select count(*)::int c from coin_ledger where user_id = $1 and kind = 'booking_refund'`, [u]))[0].c).toBe(1)
    await clean()
  })

  it('refunds of many bookings of one business at once: the wallet never goes negative, every refund recovers exactly what the wallet could cover', async () => {
    const b = uid()
    const ids = []
    for (let i = 0; i < 6; i++) {
      const a = (await q(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'Ada','carehub',$2,'unpaid',$3) returning id`, [b, FEE, ref('appt')]))[0]
      const reference = ref('chapp')
      await pool.query(`insert into payment_intents (reference, application, purpose, business_id, entity_type, entity_id, expected_amount, metadata) values ($1,'carehub','appointment',$2,'appointment',$3,$4,'{}'::jsonb)`, [reference, b, a.id, FEE])
      await pool.query('select settle_payment_intent($1,$2,$3,$4,$5)', [reference, 'paystack', `T${reference}`, FEE, 'NGN'])
      ids.push(a.id)
    }
    // credited 6 x 800,000 = 4.8M; the business has already withdrawn 1.5M of it
    await pool.query('update business_wallets set held_balance = 2_000_000, available_balance = 1_300_000 where business_id = $1', [b])
    const results = await Promise.allSettled(ids.map((id) => request(id)))
    expect(results.filter((x) => x.status === 'rejected')).toEqual([])
    expect(await wallet(b)).toEqual({ held: 0, avail: 0 })
    const rows = await q('select business_recovered_held_kobo::int h, business_recovered_available_kobo::int a, business_shortfall_kobo::int s from refunds where business_id = $1', [b])
    const sum = (k) => rows.reduce((t, r) => t + r[k], 0)
    expect(sum('h') + sum('a')).toBe(3_300_000)
    expect(sum('h') + sum('a') + sum('s')).toBe(4_800_000)
    await clean()
  })

  it('refunding and settling many different refunds at once: no deadlock, books balance', async () => {
    const ps = await Promise.all(Array.from({ length: 12 }, () => paidCard()))
    const rs = await Promise.all(ps.map((p) => request(p.id)))
    const outcomes = ['processed', 'failed', 'processing']
    const results = await Promise.allSettled(rs.flatMap((r, i) => [settle(outcomes[i % 3], r.reference), settle(outcomes[(i + 1) % 3], r.reference)]))
    expect(results.filter((x) => x.status === 'rejected').map((x) => x.reason.message)).toEqual([])
    await clean()
  })
})
