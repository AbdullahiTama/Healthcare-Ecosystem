// @vitest-environment node
// Phase 07: REAL concurrency tests for the referral commission engine. Many connections pay the same
// business at the same instant; the business must end with exactly one first payment and one 40% bonus,
// every payment exactly one commission, and reconcile_commissions() must stay empty. Runs only with
// PG_CONCURRENCY_URL (see settlementConcurrency.pg.test.js); skipped otherwise.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createTestDatabase, hasRealPostgres } from './fixtures/realPostgres.js'

vi.setConfig({ testTimeout: 180_000, hookTimeout: 600_000 })

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
const SQL = [
  read('./fixtures/liveSchemaSubset.sql'),
  M('carefind_20261003_payment_intents_foundation'),
  M('carefind_20261004_settle_payment_intent'),
  M('carefind_20261006_settle_plan_and_carehub_appointments'),
  M('carefind_20261007_commission_engine'),
]

let pool, drop, n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 80000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}_${Math.random().toString(36).slice(2, 8)}`
const q = async (sql, p = []) => (await pool.query(sql, p)).rows
const agent = async (status = 'active') => { const id = uid(); await pool.query('insert into agents (id, status) values ($1,$2)', [id, status]); return id }
const business = async (a) => { const id = uid(); await pool.query('insert into businesses (id, name, referring_agent_id) values ($1,$2,$3)', [id, 'Clinic', a]); return id }
const renew = (b, naira = 5000, reference = ref('pay')) => pool.query('select * from renew_business_plan($1,1,$2,$3)', [b, naira, reference]).then((r) => r.rows[0])
// Renewals whose transactions all stay open for `ms` after the work. The connections are acquired BEFORE any
// call starts (connecting is slow and would otherwise stagger the callers so they never overlap).
async function renewHeldTogether(b, naira, count, ms = 400) {
  const clients = await Promise.all(Array.from({ length: count }, () => pool.connect()))
  try {
    return await Promise.allSettled(clients.map(async (c) => {
      try {
        await c.query('begin')
        const r = (await c.query('select * from renew_business_plan($1,1,$2,$3)', [b, naira, ref('held')])).rows[0]
        await c.query('select pg_sleep($1)', [ms / 1000])
        await c.query('commit')
        return r
      } catch (e) { await c.query('rollback').catch(() => {}); throw e }
    }))
  } finally { clients.forEach((c) => c.release()) }
}
const clean = async () => expect(await q('select * from reconcile_commissions()')).toEqual([])

describe.skipIf(!hasRealPostgres)('referral commissions under real concurrency', () => {
  beforeAll(async () => { ;({ pool, drop } = await createTestDatabase(SQL)) }, 600_000)
  afterAll(async () => { await drop?.() })

  it('30 different payments for one NEW business at the same instant: exactly one is first, exactly one 40% bonus, 29 residuals', async () => {
    const a = await agent(); const b = await business(a)
    const results = await Promise.allSettled(Array.from({ length: 30 }, () => renew(b, 5000)))
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    expect(results.filter((r) => r.value.is_first_payment)).toHaveLength(1)
    const rows = await q('select type, amount from commissions where business_id = $1', [b])
    expect(rows).toHaveLength(30)
    expect(rows.filter((r) => r.type === 'referral_bonus')).toHaveLength(1)
    expect(rows.filter((r) => r.type === 'residual')).toHaveLength(29)
    expect(rows.reduce((s, r) => s + Number(r.amount), 0)).toBe(2000 + 29 * 250)
    expect((await q('select count(*)::int c from plan_payments where business_id = $1 and is_first_payment', [b]))[0].c).toBe(1)
    await clean()
  })

  it('12 OVERLAPPING transactions for one new business (each held open 400ms): one first payment, one 40% bonus', async () => {
    const a = await agent(); const b = await business(a)
    const results = await renewHeldTogether(b, 5000, 12)
    expect(results.filter((r) => r.status === 'rejected').map((r) => r.reason.message)).toEqual([])
    expect(results.filter((r) => r.value.is_first_payment)).toHaveLength(1)
    const rows = await q('select type from commissions where business_id = $1', [b])
    expect(rows.filter((r) => r.type === 'referral_bonus')).toHaveLength(1)
    expect(rows).toHaveLength(12)
    await clean()
  })

  it('40 callers settling the SAME reference: one payment, one commission, 39 already-processed', async () => {
    const a = await agent(); const b = await business(a)
    const reference = ref('same')
    const results = await Promise.all(Array.from({ length: 40 }, () => renew(b, 5000, reference)))
    expect(results.filter((r) => !r.already_processed)).toHaveLength(1)
    expect((await q('select count(*)::int c from commissions where business_id = $1', [b]))[0].c).toBe(1)
    await clean()
  })

  it('many businesses and agents at once: every payment gets exactly one commission and no deadlock', async () => {
    const agents = await Promise.all(Array.from({ length: 5 }, () => agent()))
    const bs = await Promise.all(Array.from({ length: 20 }, (_, i) => business(agents[i % 5])))
    const calls = bs.flatMap((b) => Array.from({ length: 6 }, () => renew(b, 2000)))
    const results = await Promise.allSettled(calls)
    expect(results.filter((r) => r.status === 'rejected')).toEqual([])
    for (const b of bs) {
      const rows = await q('select type from commissions where business_id = $1', [b])
      expect(rows).toHaveLength(6)
      expect(rows.filter((r) => r.type === 'referral_bonus')).toHaveLength(1)
    }
    await clean()
  })

  it('the backfill running while payments arrive creates no duplicates', async () => {
    const a = await agent(); const b = await business(a)
    for (let i = 0; i < 8; i++) {
      await pool.query("insert into plan_payments (business_id, months, naira_amount, reference, status, is_first_payment, created_at) values ($1,1,1000,$2,'success',$3, now() - ($4 || ' hours')::interval)", [b, ref('legacy'), i === 0, String(100 - i)])
    }
    const calls = [
      ...Array.from({ length: 6 }, () => pool.query('select backfill_missing_commissions(100) c')),
      ...Array.from({ length: 6 }, () => renew(b, 1000)),
    ]
    const results = await Promise.allSettled(calls)
    expect(results.filter((r) => r.status === 'rejected').map((r) => r.reason.message)).toEqual([])
    const rows = await q('select type from commissions where business_id = $1', [b])
    expect(rows).toHaveLength(14)
    expect(rows.filter((r) => r.type === 'referral_bonus')).toHaveLength(1)
    await clean()
  })

  it('settling plan_renewal intents through the engine concurrently also yields one commission per payment', async () => {
    const a = await agent(); const b = await business(a)
    const refs = Array.from({ length: 12 }, () => ref('ch'))
    for (const r of refs) {
      await pool.query(`insert into payment_intents (reference, application, purpose, business_id, expected_amount, metadata) values ($1,'carehub','plan_renewal',$2,500000,'{"months":1}'::jsonb)`, [r, b])
    }
    // each reference is settled by 3 competing callers (webhook, redirect, retry)
    const calls = refs.flatMap((r) => Array.from({ length: 3 }, () => pool.query('select settle_payment_intent($1,$2,$3,$4,$5) r', [r, 'paystack', `T${r}`, 500000, 'NGN'])))
    const results = await Promise.allSettled(calls)
    expect(results.filter((r) => r.status === 'rejected').map((r) => r.reason.message)).toEqual([])
    const rows = await q('select type from commissions where business_id = $1', [b])
    expect(rows).toHaveLength(12)
    expect(rows.filter((r) => r.type === 'referral_bonus')).toHaveLength(1)
    await clean()
  })
})
