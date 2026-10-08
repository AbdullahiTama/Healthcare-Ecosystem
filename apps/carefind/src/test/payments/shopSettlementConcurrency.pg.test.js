// @vitest-environment node
// Phase 10: the shop under REAL concurrency. A webhook, a redirect and a retry can all settle the same shop payment at the same
// instant, and a customer who retries can have TWO attempts both succeed at Paystack. The order is paid exactly once, every
// extra payment is parked as needs_refund (never dropped, never applied twice), and the books reconcile. Runs only with
// PG_CONCURRENCY_URL (see settlementConcurrency.pg.test.js); skipped otherwise.
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
  M('carefind_20261007_commission_engine'),
  M('carefind_20261009_refund_engine'),
  M('carefind_20261010_central_settlement'),
]

let pool, drop, n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 160000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}_${Math.random().toString(36).slice(2, 8)}`
const q = async (sql, p = []) => (await pool.query(sql, p)).rows
const tally = (results) => results.reduce((m, r) => { const k = r.status === 'fulfilled' ? String(r.value) : `error:${r.reason.code || r.reason.message}`; m[k] = (m[k] || 0) + 1; return m }, {})
const FEE = 2_500_000

async function together(count, work, ms = 400) {
  const clients = await Promise.all(Array.from({ length: count }, () => pool.connect()))
  try {
    return await Promise.allSettled(clients.map(async (c, i) => {
      try { await c.query('begin'); const r = await work(c, i); await c.query('select pg_sleep($1)', [ms / 1000]); await c.query('commit'); return r }
      catch (e) { await c.query('rollback').catch(() => {}); throw e }
    }))
  } finally { clients.forEach((c) => c.release()) }
}
async function shopOrder() {
  const customer = uid(); const vendor = uid()
  const o = (await q(`insert into shop_orders (order_ref, customer_id, vendor_business_id, total_kobo, subtotal_kobo) values ($1,$2,$3,$4,$4) returning id`, [ref('CF'), customer, vendor, FEE]))[0]
  return { id: o.id, customer, vendor }
}
async function intentFor(o) {
  const reference = ref('cf_shop')
  await pool.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount) values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,$5)`, [reference, o.customer, o.vendor, o.id, FEE])
  await pool.query(`insert into shop_payments (order_id, payment_reference, amount_kobo, status) values ($1,$2,$3,'pending')`, [o.id, reference, FEE])
  return reference
}
const settle = (reference) => pool.query('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', `T${reference}`, FEE, 'NGN']).then((r) => r.rows[0].r.outcome)

describe.skipIf(!hasRealPostgres)('shop settlement under real concurrency', () => {
  beforeAll(async () => {
    ;({ pool, drop } = await createTestDatabase(SQL, { beforeFile: async (i, db) => { if (i === 4) await createLegacyStubs(db) } }))
  }, 600_000)
  afterAll(async () => { await drop?.() })

  it('40 callers (webhook + redirect + retries) settling ONE shop payment: the order is paid once, one history row, one notice', async () => {
    const o = await shopOrder(); const reference = await intentFor(o)
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => settle(reference)))
    expect(tally(results)).toEqual({ settled: 1, already_settled: 39 })
    expect((await q('select status, payment_status from shop_orders where id = $1', [o.id]))[0]).toEqual({ status: 'paid', payment_status: 'paid' })
    expect((await q('select count(*)::int c from shop_order_status_history where order_id = $1', [o.id]))[0].c).toBe(1)
    expect((await q('select count(*)::int c from notifications where recipient_id = $1', [o.customer]))[0].c).toBe(1)
    expect((await q("select count(*)::int c from shop_payments where order_id = $1 and status = 'success'", [o.id]))[0].c).toBe(1)
  })

  it('12 OVERLAPPING transactions (held open 400ms) settling one payment: paid once, no errors', async () => {
    const o = await shopOrder(); const reference = await intentFor(o)
    const results = await together(12, async (c) => (await c.query('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', `T${reference}`, FEE, 'NGN'])).rows[0].r.outcome)
    expect(results.filter((x) => x.status === 'rejected').map((x) => x.reason.message)).toEqual([])
    expect(tally(results)).toEqual({ settled: 1, already_settled: 11 })
    expect((await q('select count(*)::int c from shop_order_status_history where order_id = $1', [o.id]))[0].c).toBe(1)
  })

  it('two attempts of one order paid at once: exactly one settles, the other is needs_refund (already_paid) and the refund engine can refund it', async () => {
    const o = await shopOrder()
    const a = await intentFor(o); const b = await intentFor(o)
    const results = await Promise.allSettled([settle(a), settle(b)])
    const outcomes = results.map((r) => r.value).sort()
    expect(outcomes).toEqual(['needs_refund', 'settled'])
    expect((await q('select count(*)::int c from shop_order_status_history where order_id = $1', [o.id]))[0].c).toBe(1)
    const parked = (await q("select id, metadata from payment_intents where entity_id = $1 and status = 'needs_refund'", [o.id]))[0]
    expect(parked.metadata.refund_reason).toBe('already_paid')
    const r = (await q(`select request_refund('needs_refund_intent','payment_intent',$1) r`, [parked.id]))[0].r
    expect(r).toMatchObject({ outcome: 'requested', amount_kobo: FEE })
  })

  it('many different orders at once: no deadlock, every order paid exactly once', async () => {
    const orders = await Promise.all(Array.from({ length: 25 }, () => shopOrder()))
    const refs = await Promise.all(orders.map(intentFor))
    const results = await Promise.allSettled(refs.flatMap((r) => [settle(r), settle(r)]))
    expect(results.filter((x) => x.status === 'rejected')).toEqual([])
    expect(tally(results)).toEqual({ settled: 25, already_settled: 25 })
    expect((await q("select count(*)::int c from shop_orders where payment_status = 'paid'"))[0].c).toBeGreaterThanOrEqual(25)
  })
})
