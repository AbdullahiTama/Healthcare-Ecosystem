// @vitest-environment node
// Phase 08: REAL concurrency tests for the withdrawal engine. Many connections hit a real Postgres at the same
// instant: a request is refunded once however many webhooks/sweeps/admins race, a wallet is never overdrawn,
// the daily cap holds, and the books balance afterwards. Runs only with PG_CONCURRENCY_URL (see
// settlementConcurrency.pg.test.js); skipped otherwise.
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
]

let pool, drop, n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 120000).toString(16).padStart(12, '0')}`
const q = async (sql, p = []) => (await pool.query(sql, p)).rows
const bal = async (u) => Number((await q('select balance from wallets where user_id = $1', [u]))[0]?.balance ?? 0)
const tally = (results) => results.reduce((m, r) => { const k = r.status === 'fulfilled' ? String(r.value) : `error:${r.reason.code || r.reason.message}`; m[k] = (m[k] || 0) + 1; return m }, {})

async function user(coins = 0) {
  const u = uid()
  await pool.query('insert into auth.users (id) values ($1)', [u])
  if (coins) await pool.query(`select _post_coin_entry($1,$2,'topup',$3)`, [u, coins, `seed_${++n}`])
  return u
}
const create = async (u, coins, cap = null) =>
  (await pool.query(`select create_withdrawal($1,$2,'GTBank','058','0123456789','Ada Obi',$3) r`, [u, coins, cap])).rows[0].r
const settle = async (outcome, key) => (await pool.query('select settle_withdrawal($1,$2) r', [outcome, key])).rows[0].r
const bsettle = async (outcome, key) => (await pool.query('select settle_business_withdrawal($1,$2) r', [outcome, key])).rows[0].r
const bcreate = async (b, kobo, cap = null) =>
  (await pool.query(`select create_business_withdrawal($1,$2,'GTBank','058','0123456789','Clinic',null,$3) r`, [b, kobo, cap])).rows[0].r
const biz = async (kobo) => { const b = uid(); await pool.query('insert into business_wallets (business_id, available_balance) values ($1,$2)', [b, kobo]); return b }
const avail = async (b) => Number((await q('select available_balance a from business_wallets where business_id = $1', [b]))[0].a)
// Callers whose transactions all stay open for `ms` after the work. Connections are acquired BEFORE any call starts
// (connecting is slow and would stagger the callers so they never overlap).
async function together(count, work, ms = 400) {
  const clients = await Promise.all(Array.from({ length: count }, () => pool.connect()))
  try {
    return await Promise.allSettled(clients.map(async (c, i) => {
      try {
        await c.query('begin')
        const r = await work(c, i)
        await c.query('select pg_sleep($1)', [ms / 1000])
        await c.query('commit')
        return r
      } catch (e) { await c.query('rollback').catch(() => {}); throw e }
    }))
  } finally { clients.forEach((c) => c.release()) }
}
const books = async () => {
  expect(await q('select * from reconcile_coin_wallets()')).toEqual([])
  expect(await q('select * from verify_coin_ledger_chain()')).toEqual([])
  expect(await q('select 1 from wallets where balance < 0')).toEqual([])
  expect(await q('select 1 from business_wallets where available_balance < 0')).toEqual([])
  expect((await q("select * from reconcile_withdrawals(60) where kind <> 'stuck'"))).toEqual([])
}

describe.skipIf(!hasRealPostgres)('withdrawal engine under real concurrency', () => {
  beforeAll(async () => {
    ;({ pool, drop } = await createTestDatabase(SQL, { beforeFile: async (i, db) => { if (i === 4) await createLegacyStubs(db) } }))
  }, 600_000)
  afterAll(async () => { await drop?.() })

  it('40 simultaneous "failed" notifications for one withdrawal (webhook + sweep + admin + retries): refunded exactly once', async () => {
    const u = await user(20); const r = await create(u, 10)
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => settle('failed', r.reference).then((x) => x.result)))
    expect(tally(results)).toEqual({ refunded: 1, already_refunded: 39 })
    expect(await bal(u)).toBe(20)
    expect((await q(`select count(*)::int c from coin_ledger where user_id = $1 and kind = 'withdrawal_refund'`, [u]))[0].c).toBe(1)
    await books()
  })

  it('12 OVERLAPPING transactions (held open 400ms) settling one withdrawal as failed/reversed: refunded once, no errors', async () => {
    const u = await user(20); const r = await create(u, 10)
    const results = await together(12, async (c, i) => (await c.query('select settle_withdrawal($1,$2) r', [i % 2 ? 'failed' : 'reversed', r.reference])).rows[0].r.result)
    expect(results.filter((x) => x.status === 'rejected').map((x) => x.reason.message)).toEqual([])
    expect(tally(results)).toEqual({ refunded: 1, already_refunded: 11 })
    expect(await bal(u)).toBe(20)
    await books()
  })

  it('12 OVERLAPPING business settlements: refunded once, no errors', async () => {
    const b = await biz(5_000_000); const r = await bcreate(b, 1_000_000)
    const results = await together(12, async (c) => (await c.query('select settle_business_withdrawal($1,$2) r', ['failed', r.reference])).rows[0].r.result)
    expect(results.filter((x) => x.status === 'rejected').map((x) => x.reason.message)).toEqual([])
    expect(tally(results)).toEqual({ refunded: 1, already_refunded: 11 })
    expect(await avail(b)).toBe(5_000_000)
  })

  it('failed + reversed + success racing on one withdrawal: one consistent outcome, never refunded AND completed-and-kept', async () => {
    for (let round = 0; round < 6; round++) {
      const u = await user(20); const r = await create(u, 10)
      const calls = []
      for (let i = 0; i < 8; i++) { calls.push(settle('failed', r.reference), settle('reversed', r.reference), settle('success', r.reference)) }
      const results = await Promise.allSettled(calls)
      expect(results.filter((x) => x.status === 'rejected')).toEqual([])
      const [w] = await q('select status from withdrawal_requests where id = $1', [r.id])
      const refunds = (await q(`select count(*)::int c from coin_ledger where user_id = $1 and kind = 'withdrawal_refund'`, [u]))[0].c
      if (w.status === 'refunded') { expect(refunds).toBe(1); expect(await bal(u)).toBe(20) }
      else { expect(w.status).toBe('completed'); expect(refunds).toBe(0); expect(await bal(u)).toBe(10) }
      await books()
    }
  })

  it('40 simultaneous 5-coin withdrawals from a 25-coin wallet: exactly 5 are reserved, 35 refused, balance 0', async () => {
    const u = await user(25)
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => create(u, 5).then((x) => x.outcome)))
    expect(tally(results)).toEqual({ ok: 5, insufficient: 35 })
    expect(await bal(u)).toBe(0)
    expect((await q('select count(*)::int c from withdrawal_requests where user_id = $1', [u]))[0].c).toBe(5)
    expect(new Set((await q('select paystack_reference r from withdrawal_requests where user_id = $1', [u])).map((x) => x.r)).size).toBe(5)
    await books()
  })

  it('the 24h cap cannot be slipped under by concurrent requests: cap 50, twenty 10-coin requests -> exactly 5', async () => {
    const u = await user(1000)
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => create(u, 10, 50).then((x) => x.outcome)))
    expect(tally(results)).toEqual({ ok: 5, daily_limit: 15 })
    expect(await bal(u)).toBe(950)
    await books()
  })

  it('business: 40 simultaneous reversals/failures of one withdrawal refund the wallet once', async () => {
    const b = await biz(5_000_000)
    const r = await bcreate(b, 1_000_000)
    const calls = Array.from({ length: 40 }, (_, i) => bsettle(i % 2 ? 'failed' : 'reversed', r.reference).then((x) => x.result))
    expect(tally(await Promise.allSettled(calls))).toEqual({ refunded: 1, already_refunded: 39 })
    expect(await avail(b)).toBe(5_000_000)
    expect((await q(`select count(*)::int c from business_wallet_transactions where business_id = $1 and type = 'withdrawal_refund'`, [b]))[0].c).toBe(1)
    await books()
  })

  it('business: 30 simultaneous 1M-kobo withdrawals from a 10M wallet (cap disabled): exactly 10 reserved, wallet 0', async () => {
    const b = await biz(10_000_000)
    const results = await Promise.allSettled(Array.from({ length: 30 }, () => bcreate(b, 1_000_000, 0).then((x) => x.outcome)))
    expect(tally(results)).toEqual({ ok: 10, insufficient: 20 })
    expect(await avail(b)).toBe(0)
    await books()
  })

  it('business: the default daily cap (N1,000,000) holds under concurrency', async () => {
    const b = await biz(900_000_000)
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => bcreate(b, 30_000_000).then((x) => x.outcome)))   // N300,000 each
    expect(tally(results)).toEqual({ ok: 3, daily_limit: 17 })
    expect(await avail(b)).toBe(900_000_000 - 90_000_000)
    await books()
  })

  it('creating and settling many different requests at once: no deadlock, books balance', async () => {
    const users = await Promise.all(Array.from({ length: 10 }, () => user(200)))
    const reqs = await Promise.all(users.flatMap((u) => Array.from({ length: 4 }, () => create(u, 10))))
    const calls = reqs.map((r, i) => settle(['failed', 'success', 'reversed', 'failed'][i % 4], r.reference))
    const more = users.map((u) => create(u, 10))
    const results = await Promise.allSettled([...calls, ...more])
    expect(results.filter((x) => x.status === 'rejected').map((x) => x.reason.message)).toEqual([])
    await books()
  })
})
