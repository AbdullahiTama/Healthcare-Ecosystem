// @vitest-environment node
// Phase 05 (1/3): the CareCoin ledger foundation - cutover, posting primitives, immutability, access,
// reconciliation. Real Postgres (PGlite) + the real migrations + a replica of the live tables.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 30000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}`

// Legacy wallets that exist BEFORE the migration (numeric balances, like production).
const LEGACY = { whole: uid(), fractional: uid(), zero: uid(), tiny: uid() }

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await db.exec(read('./fixtures/liveSchemaSubset.sql'))
  await db.query(`insert into wallets (user_id, balance) values ($1, 25), ($2, 10.4), ($3, 0), ($4, 0.4)`, [LEGACY.whole, LEGACY.fractional, LEGACY.zero, LEGACY.tiny])
  await db.exec(read('../../../../../supabase/migrations/carefind_20261003_payment_intents_foundation.sql'))
  await db.exec(read('../../../../../supabase/migrations/carefind_20261005_coin_ledger.sql'))
}, 120_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const bal = async (u) => (await one('select balance from wallets where user_id = $1', [u]))?.balance
const entries = async (u) => (await db.query('select * from coin_ledger where user_id = $1 order by id', [u])).rows
const post = async (u, d, kind = 'adjustment', r = ref('r'), cp = null, meta = {}) =>
  (await one('select _post_coin_entry($1,$2,$3,$4,$5,$6::jsonb) b', [u, d, kind, r, cp, JSON.stringify(meta)])).b
const asRole = async (role, fn, claims = {}) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [claims.sub || ''])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec('reset role') }
}

describe('cutover of the existing wallets', () => {
  it('turns every positive balance into one opening entry, in whole coins, chained from zero', async () => {
    const whole = await entries(LEGACY.whole)
    expect(whole).toHaveLength(1)
    expect(whole[0]).toMatchObject({ kind: 'opening_balance', delta: 25, balance_after: 25 })
    expect(await bal(LEGACY.whole)).toBe(25)
  })

  it('floors a fractional legacy balance and keeps the original and the dropped fraction in the entry', async () => {
    const e = (await entries(LEGACY.fractional))[0]
    expect(e).toMatchObject({ delta: 10, balance_after: 10 })
    expect(e.meta).toMatchObject({ legacy_balance: '10.4000', fraction_dropped: '0.4000' })
    expect(await bal(LEGACY.fractional)).toBe(10)
  })

  it('writes no entry for an empty wallet or one worth less than a coin', async () => {
    expect(await entries(LEGACY.zero)).toHaveLength(0)
    expect(await entries(LEGACY.tiny)).toHaveLength(0)
    expect(await bal(LEGACY.tiny)).toBe(0)
  })

  it('leaves balances as integers, non-null, non-negative, and every wallet reconciled with an intact chain', async () => {
    const col = await one(`select data_type, is_nullable from information_schema.columns where table_name = 'wallets' and column_name = 'balance'`)
    expect(col).toMatchObject({ data_type: 'integer', is_nullable: 'NO' })
    await expect(db.query(`update wallets set balance = -1 where user_id = $1`, [LEGACY.whole])).rejects.toThrow(/wallets_balance_nonnegative|check constraint/)
    expect((await db.query('select * from reconcile_coin_wallets()')).rows).toEqual([])
    expect((await db.query('select * from verify_coin_ledger_chain()')).rows).toEqual([])
  })
})

describe('_post_coin_entry', () => {
  it('credits: balance and ledger move together, the entry records the balance after and the counterparty', async () => {
    const u = uid(), other = uid()
    expect(await post(u, 7, 'topup', 'ref-credit-1', other, { note: 'x' })).toBe(7)
    expect(await bal(u)).toBe(7)
    expect((await entries(u))[0]).toMatchObject({ user_id: u, delta: 7, balance_after: 7, kind: 'topup', reference: 'ref-credit-1', counterparty_id: other, meta: { note: 'x' } })
  })

  it('debits down to exactly zero and chains balance_after', async () => {
    const u = uid()
    await post(u, 10, 'topup')
    expect(await post(u, -4, 'gift_sent')).toBe(6)
    expect(await post(u, -6, 'withdrawal')).toBe(0)
    expect((await entries(u)).map((e) => e.balance_after)).toEqual([10, 6, 0])
  })

  it('returns NULL and writes NOTHING when the wallet cannot cover a debit', async () => {
    const u = uid()
    await post(u, 5, 'topup')
    const before = (await entries(u)).length
    expect(await post(u, -6, 'gift_sent')).toBeNull()
    expect(await bal(u)).toBe(5)
    expect(await entries(u)).toHaveLength(before)
  })

  it('a debit from a user with no wallet is refused (and creates an empty one, never a negative one)', async () => {
    const u = uid()
    expect(await post(u, -1, 'gift_sent')).toBeNull()
    expect(await bal(u)).toBe(0)
  })

  it('refuses a zero delta', async () => {
    await expect(post(uid(), 0)).rejects.toThrow(/non-zero integer/)
  })

  it('is idempotent per (user, kind, reference): a replay aborts and changes nothing', async () => {
    const u = uid()
    await post(u, 5, 'topup', 'same-ref')
    await expect(post(u, 5, 'topup', 'same-ref')).rejects.toThrow(/coin_ledger_leg_key|duplicate key/)
    expect(await bal(u)).toBe(5)
    expect(await entries(u)).toHaveLength(1)
  })

  it('allows the same reference for a different kind or a different user', async () => {
    const a = uid(), b = uid()
    await post(a, 5, 'topup', 'shared')
    await post(a, 1, 'adjustment', 'shared')
    await post(b, 5, 'topup', 'shared')
    expect(await bal(a)).toBe(6)
    expect(await bal(b)).toBe(5)
  })

  it('rejects an unknown kind', async () => {
    await expect(post(uid(), 1, 'free_money')).rejects.toThrow(/coin_ledger_kind_check|check constraint/)
  })
})

describe('_post_coin_transfer', () => {
  const transfer = async (from, to, coins, r = ref('t')) =>
    (await one(`select _post_coin_transfer($1,$2,$3,'gift_sent','gift_received',$4) ok`, [from, to, coins, r])).ok

  it('moves coins as one unit: two legs, one reference, counterparties pointing at each other', async () => {
    const a = uid(), b = uid()
    await post(a, 10, 'topup')
    expect(await transfer(a, b, 4, 'gift-1')).toBe(true)
    expect(await bal(a)).toBe(6)
    expect(await bal(b)).toBe(4)
    expect((await entries(a)).at(-1)).toMatchObject({ kind: 'gift_sent', delta: -4, reference: 'gift-1', counterparty_id: b })
    expect((await entries(b))[0]).toMatchObject({ kind: 'gift_received', delta: 4, reference: 'gift-1', counterparty_id: a })
  })

  it('an unaffordable transfer returns false and writes nothing on EITHER side', async () => {
    const a = uid(), b = uid()
    await post(a, 3, 'topup')
    expect(await transfer(a, b, 4)).toBe(false)
    expect(await bal(a)).toBe(3)
    expect(await bal(b)).toBe(0)
    expect(await entries(b)).toHaveLength(0)
  })

  it.each([[0], [-5]])('refuses to move %p coins', async (coins) => {
    const a = uid(), b = uid()
    await post(a, 5, 'topup')
    await expect(transfer(a, b, coins)).rejects.toThrow(/positive whole number/)
    expect(await bal(a)).toBe(5)
  })

  it('refuses a transfer to yourself', async () => {
    const a = uid()
    await post(a, 5, 'topup')
    await expect(transfer(a, a, 1)).rejects.toThrow(/two different wallets/)
  })

  it('a replayed transfer reference aborts as a whole (no half transfer)', async () => {
    const a = uid(), b = uid()
    await post(a, 10, 'topup')
    await transfer(a, b, 2, 'dup')
    await expect(transfer(a, b, 2, 'dup')).rejects.toThrow(/duplicate key|coin_ledger_leg_key/)
    expect(await bal(a)).toBe(8)
    expect(await bal(b)).toBe(2)
  })

  it('conserves coins across a chain of transfers', async () => {
    const [a, b, c] = [uid(), uid(), uid()]
    await post(a, 100, 'topup')
    for (let i = 0; i < 20; i++) {
      await transfer(a, b, 3); await transfer(b, c, 2); await transfer(c, a, 1)
    }
    expect((await bal(a)) + (await bal(b)) + (await bal(c))).toBe(100)
  })
})

describe('the ledger is append-only and readable only by its owner', () => {
  it('cannot be updated, deleted or truncated, even by the owner role', async () => {
    const u = uid()
    await post(u, 5, 'topup')
    await expect(db.query(`update coin_ledger set delta = 500 where user_id = $1`, [u])).rejects.toThrow(/append-only/)
    await expect(db.query(`delete from coin_ledger where user_id = $1`, [u])).rejects.toThrow(/append-only/)
    await expect(db.exec('truncate coin_ledger')).rejects.toThrow(/not allowed/)
  })

  it('clients and the service role cannot write it directly', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await expect(asRole(role, () => db.query(`insert into coin_ledger (user_id, delta, balance_after, kind, reference) values ($1, 5, 5, 'adjustment', 'x')`, [uid()]))).rejects.toThrow(/permission denied/)
    }
  })

  it('a signed-in user sees only their own entries; anon sees nothing', async () => {
    const a = uid(), b = uid()
    await post(a, 5, 'topup'); await post(b, 9, 'topup')
    const mine = await asRole('authenticated', () => db.query('select user_id, delta from coin_ledger'), { sub: a })
    expect(mine.rows.length).toBeGreaterThan(0)
    expect(mine.rows.every((r) => r.user_id === a)).toBe(true)
    await expect(asRole('anon', () => db.query('select * from coin_ledger'))).rejects.toThrow(/permission denied/)
  })
})

describe('reconciliation', () => {
  it('reports a wallet whose balance was changed without the ledger, with the exact difference', async () => {
    const u = uid()
    await post(u, 10, 'topup')
    await db.query('update wallets set balance = 15 where user_id = $1', [u]) // owner-level tamper (no guard until migration 3/3)
    const bad = (await db.query('select * from reconcile_coin_wallets() where user_id = $1', [u])).rows
    expect(bad).toHaveLength(1)
    expect({ user_id: bad[0].user_id, balance: Number(bad[0].balance), ledger_sum: Number(bad[0].ledger_sum), difference: Number(bad[0].difference) })
      .toEqual({ user_id: u, balance: 15, ledger_sum: 10, difference: 5 })
    await db.query('update wallets set balance = 10 where user_id = $1', [u])
    expect((await db.query('select * from reconcile_coin_wallets() where user_id = $1', [u])).rows).toEqual([])
  })

  it('detects a broken running balance in the chain', async () => {
    const u = uid()
    await post(u, 10, 'topup')
    // a forged row that does not continue the chain (inserted as the owner; clients cannot do this)
    await db.query(`insert into coin_ledger (user_id, delta, balance_after, kind, reference) values ($1, 1, 99, 'adjustment', 'forged')`, [u])
    const bad = (await db.query('select * from verify_coin_ledger_chain() where user_id = $1', [u])).rows
    expect(bad).toHaveLength(1)
    expect(bad[0]).toMatchObject({ expected_balance: 11, balance_after: 99 })
  })

  it('is callable by service_role only', async () => {
    await expect(asRole('authenticated', () => db.query('select * from reconcile_coin_wallets()'))).rejects.toThrow(/permission denied/)
    await expect(asRole('anon', () => db.query('select * from verify_coin_ledger_chain()'))).rejects.toThrow(/permission denied/)
    await expect(asRole('service_role', () => db.query('select * from reconcile_coin_wallets()'))).resolves.toBeDefined()
  })
})

describe('private primitives', () => {
  it('are executable by nobody but the owner', async () => {
    const r = await db.query(`
      select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u, has_function_privilege('service_role', p.oid, 'execute') s
        from pg_proc p where p.proname in ('_post_coin_entry','_post_coin_transfer','coin_ledger_guard')`)
    expect(r.rows).toHaveLength(3)
    expect(r.rows.every((x) => !x.a && !x.u && !x.s)).toBe(true)
  })
})
