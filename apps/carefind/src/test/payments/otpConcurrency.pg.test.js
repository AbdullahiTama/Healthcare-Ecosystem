// @vitest-environment node
// H01: REAL concurrency for one-time codes. Many connections hit a real Postgres at the same instant: a code verifies
// exactly once however many requests race, the per-user gap, the per-IP ceiling and the platform ceiling hold exactly
// (the advisory locks make the count-then-insert atomic), and parallel wrong guesses burn the code at five.
// Runs only with PG_CONCURRENCY_URL (see settlementConcurrency.pg.test.js); SKIPPED otherwise.
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
  M('carefind_20261024_otp_challenges'),
  M('carefind_20261027_withdrawal_otp_purpose'),
  M('carefind_20261028_otp_hardening'),
]

let pool, drop, n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 280000).toString(16).padStart(12, '0')}`
const newUser = async () => { const u = uid(); await pool.query('insert into auth.users (id) values ($1)', [u]); return u }
const setCap = (key, value) => pool.query('update financial_config set value = $2 where key = $1', [key, value])
const reset = async () => {
  await pool.query('truncate otp_challenges')
  await setCap('otp_ip_hourly_cap', 10)
  await setCap('otp_global_hourly_cap', 500)
}
const tally = (results) => results.reduce((m, r) => {
  const k = r.status === 'fulfilled' ? String(r.value) : `error:${r.reason.code || r.reason.message}`
  m[k] = (m[k] || 0) + 1
  return m
}, {})

// Callers acquire their connection BEFORE any call starts (connecting is slow and would stagger them so they never overlap).
async function together(count, work) {
  const clients = await Promise.all(Array.from({ length: count }, () => pool.connect()))
  try {
    return await Promise.allSettled(clients.map(async (c, i) => {
      try {
        await c.query('begin')
        const r = await work(c, i)
        await c.query('select pg_sleep(0.2)')
        await c.query('commit')
        return r
      } catch (e) { await c.query('rollback').catch(() => {}); throw e }
    }))
  } finally { clients.forEach((c) => c.release()) }
}
const issue = (c, user, purpose, hash, ip = null) =>
  c.query('select issue_otp($1, $2, $3, 300, $4) as r', [user, purpose, hash, ip]).then((r) => r.rows[0].r)
const verify = (c, user, purpose, hash) =>
  c.query('select verify_otp($1, $2, $3) as r', [user, purpose, hash]).then((r) => r.rows[0].r)

describe.skipIf(!hasRealPostgres)('one-time codes under real concurrency', () => {
  beforeAll(async () => { ;({ pool, drop } = await createTestDatabase(SQL)) }, 600_000)
  afterAll(async () => { await drop?.() })

  it('30 requests presenting the same correct code: exactly one succeeds', async () => {
    await reset()
    const u = await newUser()
    await pool.query(`select issue_otp($1, 'withdrawal', 'the-code', 300)`, [u])
    const results = await together(30, (c) => verify(c, u, 'withdrawal', 'the-code'))
    const t = tally(results)
    expect(t.ok).toBe(1)
    expect(t.ok + (t.none || 0)).toBe(30)
  })

  it('20 parallel wrong guesses burn the code at five, and the right code afterwards is refused', async () => {
    await reset()
    const u = await newUser()
    await pool.query(`select issue_otp($1, 'withdrawal', 'right', 300)`, [u])
    const t = tally(await together(20, (c, i) => verify(c, u, 'withdrawal', `wrong${i}`)))
    expect(t.invalid).toBe(4)
    expect(t.locked).toBe(1)
    expect(t.none).toBe(15)
    expect(await pool.query(`select verify_otp($1, 'withdrawal', 'right') as r`, [u]).then((r) => r.rows[0].r)).toBe('none')
  })

  it('10 simultaneous issues for one user and purpose: one code, the rest wait out the gap', async () => {
    await reset()
    const u = await newUser()
    const t = tally(await together(10, (c, i) => issue(c, u, 'pin_set', `h${i}`)))
    expect(t.ok).toBe(1)
    expect(t.cooldown).toBe(9)
    const { rows } = await pool.query(`select count(*)::int c from otp_challenges where user_id = $1 and consumed_at is null`, [u])
    expect(rows[0].c).toBe(1)
  })

  it('40 accounts behind one address: exactly the per-IP ceiling is issued', async () => {
    await reset()
    await setCap('otp_ip_hourly_cap', 10)
    const users = await Promise.all(Array.from({ length: 40 }, newUser))
    const t = tally(await together(40, (c, i) => issue(c, users[i], 'pin_set', `i${i}`, 'one-address')))
    expect(t.ok).toBe(10)
    expect(t.ip_limited).toBe(30)
    expect((await pool.query(`select count(*)::int c from otp_challenges where ip_hash = 'one-address'`)).rows[0].c).toBe(10)
  })

  it('40 accounts on 40 addresses: exactly the platform ceiling is issued', async () => {
    await reset()
    await setCap('otp_global_hourly_cap', 15)
    const users = await Promise.all(Array.from({ length: 40 }, newUser))
    const t = tally(await together(40, (c, i) => issue(c, users[i], 'pin_set', `g${i}`, `addr-${i}`)))
    expect(t.ok).toBe(15)
    expect(t.global_limited).toBe(25)
    expect((await pool.query('select count(*)::int c from otp_challenges')).rows[0].c).toBe(15)
  })

  it('mixed load never deadlocks or errors', async () => {
    await reset()
    const users = await Promise.all(Array.from({ length: 12 }, newUser))
    const t = tally(await together(36, (c, i) => issue(c, users[i % 12], ['pin_set', 'withdrawal', 'payout_account'][i % 3], `m${i}`, `addr-${i % 4}`)))
    const errors = Object.keys(t).filter((k) => k.startsWith('error:'))
    expect(errors).toEqual([])
  })
})
