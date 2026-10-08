// @vitest-environment node
// Phase 05: REAL concurrency tests for the CareCoin wallet. Up to 40 connections hit a real Postgres at
// the same instant: a wallet must never go negative, a refund must happen once, two wallets gifting each
// other must not deadlock, and after any storm wallet = sum(ledger). Runs only with PG_CONCURRENCY_URL
// (see settlementConcurrency.pg.test.js); skipped otherwise.
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
  M('carefind_20261006_coin_paths_platform_fee'),
]

let pool, drop, n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 60000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}`
const one = async (sql, p = []) => (await pool.query(sql, p)).rows[0]
const bal = async (u) => Number((await one('select balance from wallets where user_id = $1', [u]))?.balance ?? 0)

async function user(coins = 0) {
  const u = uid()
  await pool.query('insert into auth.users (id) values ($1)', [u])
  await pool.query('insert into profiles (id) values ($1) on conflict do nothing', [u])
  if (coins) await pool.query(`select _post_coin_entry($1,$2,'topup',$3)`, [u, coins, ref('seed')])
  return u
}
// Run a signed-in call (auth.uid() is read from the transaction-local claim).
async function asUser(u, sql, params = []) {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [u])
    const r = await c.query(sql, params)
    await c.query('commit')
    return r.rows[0].r
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}
const tally = (results) => results.reduce((m, r) => { const k = r.status === 'fulfilled' ? String(r.value) : `error:${r.reason.code || 'x'}`; m[k] = (m[k] || 0) + 1; return m }, {})
const books = async () => {
  expect((await pool.query('select * from reconcile_coin_wallets()')).rows).toEqual([])
  expect((await pool.query('select * from verify_coin_ledger_chain()')).rows).toEqual([])
  expect((await pool.query('select 1 from wallets where balance < 0')).rows).toEqual([])
}

describe.skipIf(!hasRealPostgres)('CareCoin wallet under real concurrency', () => {
  beforeAll(async () => {
    // stubs of production's legacy functions must exist BEFORE the writers migration (index 4) replaces them
    ;({ pool, drop } = await createTestDatabase(SQL, { beforeFile: async (i, db) => { if (i === 4) await createLegacyStubs(db) } }))
  }, 600_000)
  afterAll(async () => { await drop?.() })

  it('40 simultaneous 1-coin gifts from a 25-coin wallet: exactly 25 succeed, 15 are refused, the wallet ends at 0, never below', async () => {
    const sender = await user(25)
    const recipients = await Promise.all(Array.from({ length: 40 }, () => user()))
    const results = await Promise.allSettled(recipients.map((r) => asUser(sender, `select send_gift($1, 1, 'rose', 'R', null, null) r`, [r])))
    expect(tally(results)).toEqual({ ok: 25, insufficient: 15 })
    expect(await bal(sender)).toBe(0)
    const got = await Promise.all(recipients.map(bal))
    expect(got.reduce((a, b) => a + b, 0)).toBe(25)
    await books()
  })

  it('60 pairs of gifts A->B and B->A fired at the same instant: no deadlock, no error, coins conserved', async () => {
    const a = await user(500), b = await user(500)
    const calls = []
    for (let i = 0; i < 60; i++) {
      calls.push(asUser(a, `select send_gift($1, 3, 'x', 'x', null, null) r`, [b]))
      calls.push(asUser(b, `select send_gift($1, 2, 'x', 'x', null, null) r`, [a]))
    }
    const results = await Promise.allSettled(calls)
    expect(tally(results)).toEqual({ ok: 120 })
    expect((await bal(a)) + (await bal(b))).toBe(1000)
    expect(await bal(a)).toBe(500 - 60 * 3 + 60 * 2)
    await books()
  })

  it('a ring of gifts A->B->C->A, all at once, across many rounds: no deadlock', async () => {
    const [a, b, c] = await Promise.all([user(200), user(200), user(200)])
    const calls = []
    for (let i = 0; i < 40; i++) {
      calls.push(asUser(a, `select send_gift($1, 1, 'x', 'x', null, null) r`, [b]))
      calls.push(asUser(b, `select send_gift($1, 1, 'x', 'x', null, null) r`, [c]))
      calls.push(asUser(c, `select send_gift($1, 1, 'x', 'x', null, null) r`, [a]))
    }
    expect(tally(await Promise.allSettled(calls))).toEqual({ ok: 120 })
    expect((await bal(a)) + (await bal(b)) + (await bal(c))).toBe(600)
    await books()
  })

  it('a spending storm from ONE 30-coin wallet (gifts, withdrawals, subscriptions, consultations, bookings): never overspent, every success accounted for', async () => {
    const me = await user(30)
    const creator = await user(), pro = await user(), business = uid()
    await pool.query('update profiles set subscription_price = 3 where id = $1', [creator])
    await pool.query(`insert into professional_consultations (professional_id, patient_id, fee, status) values ($1,$1,1000,'setup')`, [pro]) // N1,000 = 5 coins
    const appts = await Promise.all(Array.from({ length: 4 }, async () => (await pool.query(
      `insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'x','carefind',100000,'unpaid',$2) returning id`, [business, ref('bk')])).rows[0].id))
    const friends = await Promise.all(Array.from({ length: 6 }, () => user()))

    const calls = [
      ...friends.map((f) => asUser(me, `select send_gift($1, 2, 'x', 'x', null, null) r`, [f])),                                   // 6 x 2 coins
      ...Array.from({ length: 4 }, (_, i) => pool.query(`select request_withdrawal($1, 5, 'GTB', '0123456789', 'x', $2, null) r`, [me, `storm-wd-${n}-${i}`]).then((r) => r.rows[0].r)), // 4 x 5 coins
      ...Array.from({ length: 3 }, () => asUser(me, `select pay_creator_subscription($1, 3) r`, [creator])),                         // 3 x 3 coins
      asUser(me, `select pay_professional_consultation($1) r`, [pro]),                                                              // 5 coins (once)
      ...appts.map((a) => pool.query(`select pay_booking_with_credits($1, $2) r`, [me, a]).then((r) => r.rows[0].r)),               // 4 x 5 coins
    ]
    const results = await Promise.allSettled(calls)
    expect(results.filter((r) => r.status === 'rejected').map((r) => r.reason.message)).toEqual([])

    const spent = (await one(`select coalesce(-sum(delta),0)::int s from coin_ledger where user_id = $1 and delta < 0`, [me])).s
    const credited = (await one(`select coalesce(sum(delta),0)::int s from coin_ledger where user_id = $1 and kind <> 'topup'`, [me])).s
    expect(credited).toBeLessThanOrEqual(0)
    expect(spent).toBeLessThanOrEqual(30)
    expect(await bal(me)).toBe(30 - spent)
    expect(await bal(me)).toBeGreaterThanOrEqual(0)
    // the three subscription payments all fit or are refused cleanly; the consultation books at most once
    expect(Number((await one(`select count(*) c from professional_consultations where professional_id = $1 and status = 'paid'`, [pro])).c)).toBeLessThanOrEqual(1)
    await books()
  })

  it('20 simultaneous rejections of ONE withdrawal refund it exactly once', async () => {
    const u = await user(30)
    expect((await one(`select request_withdrawal($1, 10, 'GTB', '0123456789', 'x', 'rej-ref-1', null) r`, [u])).r).toBe('ok')
    const id = (await one(`select id from withdrawal_requests where paystack_reference = 'rej-ref-1'`)).id
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => pool.query('select reject_withdrawal_request($1) r', [id]).then((r) => r.rows[0].r)))
    expect(tally(results)).toEqual({ ok: 1, already_rejected: 19 })
    expect(await bal(u)).toBe(30)
    expect(Number((await one(`select count(*) c from coin_ledger where user_id = $1 and kind = 'withdrawal_refund'`, [u])).c)).toBe(1)
    await books()
  })

  it('15 simultaneous identical withdrawal requests (a retry storm): ONE request, ONE debit, and every caller gets "ok"', async () => {
    const u = await user(100)
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => pool.query(`select request_withdrawal($1, 10, 'GTB', '0123456789', 'Ada', 'storm-ref-1', null) r`, [u]).then((r) => r.rows[0].r)))
    expect(tally(results)).toEqual({ ok: 15 })
    expect(await bal(u)).toBe(90)
    expect(Number((await one(`select count(*) c from withdrawal_requests where paystack_reference = 'storm-ref-1'`)).c)).toBe(1)
    expect(Number((await one(`select count(*) c from coin_ledger where user_id = $1 and kind = 'withdrawal'`, [u])).c)).toBe(1)
    await books()
  })

  it('F-01 under fire: 10 different users racing for the SAME withdrawal reference: exactly one wins, nine get reference_conflict, one debit in total', async () => {
    const users = await Promise.all(Array.from({ length: 10 }, () => user(50)))
    const results = await Promise.allSettled(users.map((u) => pool.query(`select request_withdrawal($1, 10, 'GTB', '0123456789', 'x', 'steal-ref-1', null) r`, [u]).then((r) => r.rows[0].r)))
    expect(tally(results)).toEqual({ ok: 1, reference_conflict: 9 })
    const balances = await Promise.all(users.map(bal))
    expect(balances.filter((b) => b === 40)).toHaveLength(1)
    expect(balances.filter((b) => b === 50)).toHaveLength(9)
    await books()
  })

  it('100 simultaneous top-ups credited by the settlement engine while the same wallet is being spent: conservation holds', async () => {
    const me = await user(0)
    const friends = await Promise.all(Array.from({ length: 20 }, () => user()))
    const intents = await Promise.all(Array.from({ length: 100 }, async () => (await pool.query(
      `insert into payment_intents (reference, application, purpose, customer_id, expected_amount, metadata) values ($1,'carefind','wallet_topup',$2,20000,'{"coins":1}') returning *`,
      [`${ref('cf_t')}_abcdefgh`, me])).rows[0]))
    const credits = intents.map((i) => pool.query('select settle_payment_intent($1,$2,$3,$4,$5) r', [i.reference, 'paystack', `T${i.reference}`, 20000, 'NGN']).then((r) => r.rows[0].r.outcome))
    const spends = friends.map((f) => asUser(me, `select send_gift($1, 1, 'x', 'x', null, null) r`, [f]))
    const [creditRes, spendRes] = await Promise.all([Promise.allSettled(credits), Promise.allSettled(spends)])
    expect(tally(creditRes)).toEqual({ settled: 100 })
    const okGifts = spendRes.filter((r) => r.status === 'fulfilled' && r.value === 'ok').length
    expect(await bal(me)).toBe(100 - okGifts)
    await books()
  })

  it('after every storm in this file, wallets reconcile with the ledger and the chain is intact', async () => {
    await books()
  })
})
