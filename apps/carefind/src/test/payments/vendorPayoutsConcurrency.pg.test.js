// @vitest-environment node
// Vendor payouts under REAL concurrency: many orders credited to one vendor at once, overlapping release sweeps, overlapping refund
// requests, and a release racing a refund of the same order. The vendor is credited exactly once, released exactly once, debited
// exactly once, and the wallet never goes negative. Runs only with PG_CONCURRENCY_URL (see settlementConcurrency.pg.test.js).
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
  M('carefind_20261008_commission_reconcile_first_payment'),
  M('carefind_20261008_withdrawal_engine'),
  M('carefind_20261009_refund_engine'),
  M('carefind_20261010_central_settlement'),
  M('carefind_20261012_shop_vendor_payouts'),
  M('carefind_20261014_reconciliation'),
  M('carefind_20261015_reconciliation_ops'),
  M('carefind_20261016_reconciliation_scale'),
  M('carefind_20261017_engine_timeouts_and_hot_paths'),
]

const SUBTOTAL = 2_000_000, COMMISSION = 400_000, TOTAL = 2_050_000, VENDOR = 1_600_000
let pool, drop, n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 180000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}_${Math.random().toString(36).slice(2, 8)}`
const q = async (sql, p = []) => (await pool.query(sql, p)).rows
const tally = (results) => results.reduce((m, r) => { const k = r.status === 'fulfilled' ? String(r.value) : `error:${r.reason.code || r.reason.message}`; m[k] = (m[k] || 0) + 1; return m }, {})

async function together(count, work, ms = 400) {
  const clients = await Promise.all(Array.from({ length: count }, () => pool.connect()))
  try {
    return await Promise.allSettled(clients.map(async (c, i) => {
      try { await c.query('begin'); const r = await work(c, i); await c.query('select pg_sleep($1)', [ms / 1000]); await c.query('commit'); return r }
      catch (e) { await c.query('rollback').catch(() => {}); throw e }
    }))
  } finally { clients.forEach((c) => c.release()) }
}
const wallet = async (b) => (await q('select held_balance::int held, available_balance::int avail from business_wallets where business_id = $1', [b]))[0]
async function newOrder(vendor, customer = uid()) {
  const o = (await q(`insert into shop_orders (order_ref, customer_id, vendor_business_id, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,$4,$5,$6) returning id`, [ref('CF'), customer, vendor, TOTAL, SUBTOTAL, COMMISSION]))[0]
  const reference = ref('cf_shop')
  await pool.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount) values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,$5)`, [reference, customer, vendor, o.id, TOTAL])
  await pool.query(`insert into shop_payments (order_id, payment_reference, amount_kobo, status) values ($1,$2,$3,'pending')`, [o.id, reference, TOTAL])
  return { id: o.id, reference, vendor }
}
const settle = (reference) => pool.query('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', `T${reference}`, TOTAL, 'NGN']).then((r) => r.rows[0].r.outcome)
async function deliveredOrder(vendor) {
  const o = await newOrder(vendor)
  expect(await settle(o.reference)).toBe('settled')
  await pool.query(`update shop_orders set status = 'delivered' where id = $1`, [o.id])
  await pool.query(`insert into shop_order_status_history (order_id, from_status, to_status, created_at) values ($1,'in_transit','delivered', now() - interval '30 days')`, [o.id])
  return o
}

describe.skipIf(!hasRealPostgres)('vendor payouts under real concurrency', () => {
  beforeAll(async () => {
    ;({ pool, drop } = await createTestDatabase(SQL, { beforeFile: async (i, db) => { if (i === 4) await createLegacyStubs(db) } }))
  }, 600_000)
  afterAll(async () => { await drop?.() })

  it('30 orders of one vendor paid at the same moment: every credit lands once, the held balance is their exact sum', async () => {
    const vendor = uid()
    const orders = []
    for (let i = 0; i < 30; i++) orders.push(await newOrder(vendor))
    const results = await Promise.allSettled(orders.map((o) => settle(o.reference)))
    expect(tally(results)).toEqual({ settled: 30 })
    expect(await wallet(vendor)).toEqual({ held: 30 * VENDOR, avail: 0 })
    expect((await q("select count(*)::int c from business_wallet_transactions where business_id = $1 and type = 'shop_credit'", [vendor]))[0].c).toBe(30)
  })

  it('12 overlapping release sweeps of one delivered order: released once, one ledger row', async () => {
    const vendor = uid()
    const o = await deliveredOrder(vendor)
    const results = await together(12, async (c) => (await c.query('select release_shop_vendor_credits(200) r')).rows[0].r.released)
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    expect(results.reduce((s, r) => s + r.value, 0)).toBe(1)
    expect(await wallet(vendor)).toEqual({ held: 0, avail: VENDOR })
    expect((await q("select count(*)::int c from business_wallet_transactions where reference = $1", [`shoprl_${o.id}`]))[0].c).toBe(1)
  })

  it('12 overlapping refund requests of one order: one refund, the vendor debited once', async () => {
    const vendor = uid()
    const o = await newOrder(vendor); await settle(o.reference)
    const results = await together(12, async (c) => (await c.query(`select request_refund('order_cancelled','shop_order',$1,null,null,false,null) r`, [o.id])).rows[0].r.outcome)
    expect(tally(results)).toEqual({ requested: 1, already_requested: 11 })
    expect(await wallet(vendor)).toEqual({ held: 0, avail: 0 })
    expect((await q('select count(*)::int c from refunds where entity_id = $1', [o.id]))[0].c).toBe(1)
    expect((await q("select reversed_kobo::int r, status from shop_vendor_credits where order_id = $1", [o.id]))[0]).toEqual({ r: VENDOR, status: 'reversed' })
  })

  it('a release racing a refund of the same order: whoever wins, the vendor ends at zero, debited once, never negative', async () => {
    const vendor = uid()
    const o = await deliveredOrder(vendor)
    const results = await together(8, async (c, i) => {
      if (i % 2 === 0) return (await c.query('select release_shop_vendor_credits(200) r')).rows[0].r.released
      return (await c.query(`select request_refund('shop_return','shop_order',$1,null,null,false,null) r`, [o.id])).rows[0].r.outcome
    })
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    expect(await wallet(vendor)).toEqual({ held: 0, avail: 0 })
    expect((await q('select count(*)::int c from refunds where entity_id = $1', [o.id]))[0].c).toBe(1)
    const debits = await q("select amount::int a from business_wallet_transactions where business_id = $1 and type = 'refund_debit'", [vendor])
    expect(debits).toEqual([{ a: -VENDOR }])
    expect((await q('select business_shortfall_kobo::int s from refunds where entity_id = $1', [o.id]))[0].s).toBe(0)
    expect((await q('select status from shop_vendor_credits where order_id = $1', [o.id]))[0].status).toBe('reversed')
  })

  it('a refund outcome racing a replay of the same outcome: restored once', async () => {
    const vendor = uid()
    const o = await newOrder(vendor); await settle(o.reference)
    const r = (await q(`select request_refund('order_cancelled','shop_order',$1,null,null,false,null) r`, [o.id]))[0].r
    const results = await together(10, async (c) => (await c.query(`select settle_refund('failed',$1) r`, [r.id])).rows[0].r.result)
    expect(tally(results)).toEqual({ failed: 1, already_failed: 9 })
    expect(await wallet(vendor)).toEqual({ held: VENDOR, avail: 0 })
    expect((await q("select reversed_kobo::int r, status from shop_vendor_credits where order_id = $1", [o.id]))[0]).toEqual({ r: 0, status: 'held' })
  })
})
