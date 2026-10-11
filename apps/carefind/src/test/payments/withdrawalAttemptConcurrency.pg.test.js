// @vitest-environment node
// H04: REAL concurrency for the attempt marker and the provider-conflict stamp. Many connections hit a real Postgres at
// the same instant: duplicate provider events complete a withdrawal once, a mark racing a failure settles to one
// consistent state, a payout reported after a refund is stamped once and moves nothing, and simultaneous withdrawals
// through the marked path still sum within the balance. Runs only with PG_CONCURRENCY_URL; SKIPPED otherwise.
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
  M('carefind_20261008_withdrawal_engine'),
  M('carefind_20261031_withdrawal_attempt_and_conflicts'),
]

let pool, drop, n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 270000).toString(16).padStart(12, '0')}`
const q = async (sql, p = []) => (await pool.query(sql, p)).rows
const tally = (results) => results.reduce((m, r) => {
  const k = r.status === 'fulfilled' ? String(r.value) : `error:${r.reason.code || r.reason.message}`
  m[k] = (m[k] || 0) + 1
  return m
}, {})
const bal = async (u) => Number((await q('select balance from wallets where user_id = $1', [u]))[0]?.balance ?? 0)
const avail = async (b) => Number((await q('select available_balance a from business_wallets where business_id = $1', [b]))[0].a)

async function user(coins = 0) {
  const u = uid()
  await pool.query('insert into auth.users (id) values ($1)', [u])
  if (coins) await pool.query(`select _post_coin_entry($1,$2,'topup',$3)`, [u, coins, `seed_${++n}`])
  return u
}
const create = async (u, coins) => (await pool.query(`select create_withdrawal($1,$2,'GTBank','058','0123456789','Ada Obi',null) r`, [u, coins])).rows[0].r
const mark = (id) => pool.query('select mark_withdrawal_transfer_attempt($1) r', [id]).then((r) => r.rows[0].r)
const settle = (outcome, key, amount = null) => pool.query('select settle_withdrawal($1,$2,null,$3,null) r', [outcome, key, amount]).then((r) => r.rows[0].r.result)
const biz = async (kobo) => { const b = uid(); await pool.query('insert into business_wallets (business_id, available_balance) values ($1,$2)', [b, kobo]); return b }
const bcreate = async (b, kobo) => (await pool.query(`select create_business_withdrawal($1,$2,'GTBank','058','0123456789','Clinic',null,null) r`, [b, kobo])).rows[0].r
const bmark = (id) => pool.query('select mark_business_withdrawal_transfer_attempt($1) r', [id]).then((r) => r.rows[0].r)
const bsettle = (outcome, key) => pool.query('select settle_business_withdrawal($1,$2) r', [outcome, key]).then((r) => r.rows[0].r.result)
const books = async () => {
  expect(await q('select * from reconcile_coin_wallets()')).toEqual([])
  expect(await q('select * from verify_coin_ledger_chain()')).toEqual([])
  expect(await q('select 1 from wallets where balance < 0')).toEqual([])
  expect(await q('select 1 from business_wallets where available_balance < 0')).toEqual([])
}

describe.skipIf(!hasRealPostgres)('withdrawal attempt marker and provider conflicts under real concurrency', () => {
  beforeAll(async () => {
    ;({ pool, drop } = await createTestDatabase(SQL, { beforeFile: async (i, db) => { if (i === 4) await createLegacyStubs(db) } }))
  }, 600_000)
  afterAll(async () => { await drop?.() })

  it('40 duplicate provider "success" events (webhook retries, sweep, admin): completed exactly once, nothing refunded', async () => {
    const u = await user(20); const w = await create(u, 10)
    await mark(w.id)
    const t = tally(await Promise.allSettled(Array.from({ length: 40 }, () => settle('success', w.reference))))
    expect(t).toEqual({ completed: 1, already_completed: 39 })
    expect((await q('select status from withdrawal_requests where id = $1', [w.id]))[0].status).toBe('completed')
    expect(await bal(u)).toBe(10)
    await books()
  })

  it('20 marks racing 20 failures of one request: one consistent end state, refunded exactly once, no errors', async () => {
    for (let round = 0; round < 4; round++) {
      const u = await user(20); const w = await create(u, 10)
      const calls = []
      for (let i = 0; i < 20; i++) { calls.push(mark(w.id), settle('failed', w.reference)) }
      const results = await Promise.allSettled(calls)
      expect(results.filter((r) => r.status === 'rejected')).toEqual([])
      const [row] = await q('select status from withdrawal_requests where id = $1', [w.id])
      expect(row.status).toBe('refunded')
      expect(await bal(u)).toBe(20)
      expect((await q(`select count(*)::int c from coin_ledger where user_id = $1 and kind = 'withdrawal_refund'`, [u]))[0].c).toBe(1)
      // every mark answered ok (it won the race) or already_refunded (it lost it): never anything else
      const marks = results.filter((_r, i) => i % 2 === 0).map((r) => r.value)
      expect(new Set(marks)).toSatisfy((s) => [...s].every((v) => v === 'ok' || v === 'already_refunded'))
      await books()
    }
  })

  it('25 "success" events after a refund: stamped exactly once, wallet untouched, one reconciliation finding', async () => {
    const u = await user(20); const w = await create(u, 10)
    await mark(w.id)
    expect(await settle('failed', w.reference)).toBe('refunded')
    const t = tally(await Promise.allSettled(Array.from({ length: 25 }, () => settle('success', w.reference))))
    expect(t).toEqual({ conflict_paid_after_refund: 25 })
    const [row] = await q('select status, failure_reason from withdrawal_requests where id = $1', [w.id])
    expect(row.status).toBe('refunded')
    expect(row.failure_reason.match(/conflict:paid_after_refund/g)).toHaveLength(1)
    expect(await bal(u)).toBe(20)
    expect(await q(`select 1 from reconcile_withdrawals(60) where kind = 'provider_conflict' and request_id = $1`, [w.id])).toHaveLength(1)
    await books()
  })

  it('20 wrong-amount "success" events: refused every time, stamped once, request stays in flight', async () => {
    const u = await user(20); const w = await create(u, 10)
    await mark(w.id)
    const t = tally(await Promise.allSettled(Array.from({ length: 20 }, () => settle('success', w.reference, 99))))
    expect(t).toEqual({ amount_mismatch: 20 })
    const [row] = await q('select status, failure_reason from withdrawal_requests where id = $1', [w.id])
    expect(row.status).toBe('processing')
    expect(row.failure_reason.match(/conflict:amount_mismatch/g)).toHaveLength(1)
  })

  it('a code attach racing the success event: completed once, linkage recorded either way', async () => {
    for (let round = 0; round < 4; round++) {
      const u = await user(20); const w = await create(u, 10)
      await mark(w.id)
      const results = await Promise.allSettled([
        pool.query(`select attach_withdrawal_transfer($1,'TRF_X','RCP_X') r`, [w.id]),
        settle('success', w.reference), settle('success', w.reference),
      ])
      expect(results.filter((r) => r.status === 'rejected')).toEqual([])
      const [row] = await q('select status, paystack_transfer_code from withdrawal_requests where id = $1', [w.id])
      expect(row).toMatchObject({ status: 'completed', paystack_transfer_code: 'TRF_X' })
      expect(await bal(u)).toBe(10)
    }
  })

  it('40 simultaneous 5-coin withdrawals, each marked straight away, from a 25-coin wallet: exactly 5 in flight, balance 0', async () => {
    const u = await user(25)
    const results = await Promise.allSettled(Array.from({ length: 40 }, async () => {
      const r = await create(u, 5)
      if (r.outcome !== 'ok') return r.outcome
      return (await mark(r.id)) === 'ok' ? 'processing' : 'mark_failed'
    }))
    expect(tally(results)).toEqual({ processing: 5, insufficient: 35 })
    expect(await bal(u)).toBe(0)
    expect((await q(`select count(*)::int c from withdrawal_requests where user_id = $1 and status = 'processing'`, [u]))[0].c).toBe(5)
    await books()
  })

  it('business: 30 marks racing 30 failures of one withdrawal refund the wallet exactly once', async () => {
    const b = await biz(5_000_000); const w = await bcreate(b, 1_000_000)
    const calls = []
    for (let i = 0; i < 30; i++) { calls.push(bmark(w.id), bsettle('failed', w.reference)) }
    const results = await Promise.allSettled(calls)
    expect(results.filter((r) => r.status === 'rejected')).toEqual([])
    expect((await q('select status from business_withdrawal_requests where id = $1', [w.id]))[0].status).toBe('refunded')
    expect(await avail(b)).toBe(5_000_000)
    expect((await q(`select count(*)::int c from business_wallet_transactions where type = 'withdrawal_refund' and reference = $1`, ['bwd_refund_' + w.id]))[0].c).toBe(1)
    await books()
  })

  it('business: 25 success events after a refund are stamped once and move no money', async () => {
    const b = await biz(2_000_000); const w = await bcreate(b, 500_000)
    await bmark(w.id)
    expect(await bsettle('failed', w.reference)).toBe('refunded')
    const t = tally(await Promise.allSettled(Array.from({ length: 25 }, () => bsettle('success', w.reference))))
    expect(t).toEqual({ conflict_paid_after_refund: 25 })
    const [row] = await q('select failure_reason from business_withdrawal_requests where id = $1', [w.id])
    expect(row.failure_reason.match(/conflict:paid_after_refund/g)).toHaveLength(1)
    expect(await avail(b)).toBe(2_000_000)
  })
})
