// @vitest-environment node
// Phase 05 (3/3): the ledger is the ONLY way a CareCoin balance changes. Every migration of the phase,
// in production order, on a real Postgres (PGlite).
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 50000).toString(16).padStart(12, '0')}`
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await db.exec(read('./fixtures/liveSchemaSubset.sql'))
  // Production has these foreign keys (read live): they are what the append-only guard must not break.
  await db.exec(`
    alter table public.transactions add constraint transactions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
    alter table public.transactions add constraint transactions_recipient_id_fkey foreign key (recipient_id) references auth.users(id) on delete set null;
    alter table public.gifts add constraint gifts_sender_id_fkey foreign key (sender_id) references auth.users(id) on delete cascade;
    alter table public.wallets add constraint wallets_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  `)
  await db.exec(M('carefind_20261003_payment_intents_foundation'))
  await db.exec(M('carefind_20261004_settle_payment_intent'))
  await db.exec(M('carefind_20261005_coin_ledger'))
  await createLegacyStubs(db)
  await db.exec(M('carefind_20261005_coin_writers_use_ledger'))
  await db.exec(M('carefind_20261005_lock_wallets_to_ledger'))
}, 180_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const user = async (coins = 0) => {
  const u = uid()
  await db.query('insert into auth.users (id) values ($1)', [u])
  if (coins) await db.query(`select _post_coin_entry($1,$2,'topup',$3)`, [u, coins, `seed_${++n}`])
  return u
}
const bal = async (u) => (await one('select balance from wallets where user_id = $1', [u]))?.balance
const asRole = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn() } finally { await db.exec('reset role') } }

describe('wallets: a balance changes only through the ledger', () => {
  it('refuses a hand-written balance change, even from the table owner', async () => {
    const u = await user(10)
    await expect(db.query('update wallets set balance = 1000000 where user_id = $1', [u])).rejects.toThrow(/only through the coin ledger/)
    await expect(db.query('update wallets set balance = balance + 1 where user_id = $1', [u])).rejects.toThrow(/only through the coin ledger/)
    expect(await bal(u)).toBe(10)
  })

  it('refuses a hand-written change that would LOWER a balance too (no silent debits either)', async () => {
    const u = await user(10)
    await expect(db.query('update wallets set balance = 0 where user_id = $1', [u])).rejects.toThrow(/only through the coin ledger/)
    expect(await bal(u)).toBe(10)
  })

  it('refuses to create a wallet with coins in it, but allows an empty one (the client\'s ensureWallet)', async () => {
    await expect(db.query('insert into wallets (user_id, balance) values ($1, 500)', [uid()])).rejects.toThrow(/only through the coin ledger/)
    const u = uid()
    await db.query('insert into auth.users (id) values ($1)', [u])
    await expect(db.query('insert into wallets (user_id, balance) values ($1, 0)', [u])).resolves.toBeDefined()
  })

  it('refuses to delete a wallet that still holds coins, allows deleting an empty one', async () => {
    const rich = await user(5), empty = await user()
    await db.query('insert into wallets (user_id, balance) values ($1, 0) on conflict do nothing', [empty])
    await expect(db.query('delete from wallets where user_id = $1', [rich])).rejects.toThrow(/only through the coin ledger/)
    await expect(db.query('delete from wallets where user_id = $1', [empty])).resolves.toBeDefined()
    expect(await bal(rich)).toBe(5)
  })

  it('refuses to truncate wallets', async () => {
    await expect(db.exec('truncate wallets')).rejects.toThrow(/not allowed/)
  })

  it('a client role cannot mint coins by any route: UPDATE, INSERT with coins, or setting the marker itself', async () => {
    const u = await user(10)
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [u])
    const attempt = async (sql, beforeSql) => {
      try {
        await asRole('authenticated', async () => {
          if (beforeSql) await db.query(beforeSql)
          return db.query(sql)
        })
        return 'no-error'
      } catch (e) {
        return e.message
      }
    }
    // Production: no UPDATE grant -> permission denied. Here RLS has no UPDATE policy -> zero rows. Either way nothing moves.
    await attempt(`update wallets set balance = 999 where user_id = '${u}'`)
    await attempt(`update wallets set balance = 999 where user_id = '${u}'`, `select set_config('app.coin_write', 'on', false)`)
    expect(await attempt(`insert into wallets (user_id, balance) values ('${uid()}', 999)`)).toMatch(/row-level security|only through the coin ledger|permission denied/)
    await db.query(`select set_config('app.coin_write', '', false)`)
    expect(await bal(u)).toBe(10)
  })

  it('the marker is cleared the moment the posting update is done: a later hand-write in the SAME transaction is refused', async () => {
    const u = await user(10)
    await db.exec('begin')
    try {
      await db.query(`select _post_coin_entry($1, 1, 'topup', $2)`, [u, `m_${++n}`])
      await expect(db.query('update wallets set balance = 9999 where user_id = $1', [u])).rejects.toThrow(/only through the coin ledger/)
    } finally {
      await db.exec('rollback')
    }
  })

  it('the ledger path itself still works', async () => {
    const u = await user(10)
    expect((await one(`select _post_coin_entry($1, -4, 'adjustment', $2) b`, [u, `ok_${++n}`])).b).toBe(6)
    expect(await bal(u)).toBe(6)
  })
})

describe('transactions and gifts are append-only', () => {
  it('refuse direct UPDATE, DELETE and TRUNCATE', async () => {
    const u = await user()
    await db.query(`insert into transactions (user_id, type, amount, reference, status) values ($1,'topup',5,$2,'success')`, [u, `tx_${++n}`])
    await db.query(`insert into gifts (sender_id, recipient_id, gift_type, gift_emoji, coins) values ($1,$1,'rose','R',1)`, [u])
    await expect(db.query(`update transactions set amount = 500 where user_id = $1`, [u])).rejects.toThrow(/append-only/)
    await expect(db.query(`delete from transactions where user_id = $1`, [u])).rejects.toThrow(/append-only/)
    await expect(db.query(`update gifts set coins = 500 where sender_id = $1`, [u])).rejects.toThrow(/append-only/)
    await expect(db.query(`delete from gifts where sender_id = $1`, [u])).rejects.toThrow(/append-only/)
    await expect(db.exec('truncate transactions')).rejects.toThrow(/not allowed/)
    await expect(db.exec('truncate gifts')).rejects.toThrow(/not allowed/)
  })

  it('still lets the foreign keys to auth.users do their job: deleting an account removes its history and nulls recipients', async () => {
    const a = await user(), b = await user()
    await db.query(`insert into transactions (user_id, type, amount, reference, recipient_id, status) values ($1,'gift_sent',-1,$3,$2,'success'), ($2,'gift_received',1,$3,$1,'success')`, [a, b, `gx_${++n}`])
    await db.query(`insert into gifts (sender_id, recipient_id, gift_type, gift_emoji, coins) values ($1,$2,'rose','R',1)`, [a, b])
    await db.query('delete from auth.users where id = $1', [a]) // cascade: a's transactions + gifts; set null: b's recipient_id
    expect((await db.query('select 1 from transactions where user_id = $1', [a])).rows).toHaveLength(0)
    expect((await db.query('select 1 from gifts where sender_id = $1', [a])).rows).toHaveLength(0)
    expect((await one('select recipient_id from transactions where user_id = $1', [b])).recipient_id).toBeNull()
  })

  it('deleting an account that still holds coins is REFUSED (money cannot vanish with the account); its ledger would survive anyway', async () => {
    const rich = await user(5)
    await expect(db.query('delete from auth.users where id = $1', [rich])).rejects.toThrow(/only through the coin ledger/)
    expect(await bal(rich)).toBe(5)
    expect((await db.query('select 1 from coin_ledger where user_id = $1', [rich])).rows.length).toBeGreaterThan(0)
  })
})

describe('withdrawal_requests: a reference is never reused (production index, which this phase relies on)', () => {
  const req = (u, ref, status = 'pending') => db.query(`insert into withdrawal_requests (user_id, amount, bank_name, account_number, account_name, status, paystack_reference) values ($1,5,'GTB','0123456789','x',$3,$2)`, [u, ref, status])

  it('refuses any second request under the same reference, from anyone, in any state', async () => {
    const a = await user(), b = await user()
    await req(a, 'uniq-ref-1')
    await expect(req(a, 'uniq-ref-1')).rejects.toThrow(/duplicate key|paystack_reference_uniq/)
    await expect(req(b, 'uniq-ref-1', 'processing')).rejects.toThrow(/duplicate key|paystack_reference_uniq/)
    await req(a, 'uniq-ref-2', 'rejected')
    await expect(req(a, 'uniq-ref-2', 'pending')).rejects.toThrow(/duplicate key|paystack_reference_uniq/)
  })

  it('allows any number of requests without a reference', async () => {
    const a = await user()
    await req(a, null); await req(a, null)
  })
})

describe('the guard functions and the books', () => {
  it('guard functions are executable by nobody but the owner', async () => {
    const r = await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u, has_function_privilege('service_role', p.oid, 'execute') s from pg_proc p where p.proname in ('wallets_guard','append_only_guard')`)
    expect(r.rows).toHaveLength(2)
    expect(r.rows.every((x) => !x.a && !x.u && !x.s)).toBe(true)
  })

  it('every wallet still reconciles with the ledger', async () => {
    expect((await db.query('select * from reconcile_coin_wallets()')).rows).toEqual([])
    expect((await db.query('select * from verify_coin_ledger_chain()')).rows).toEqual([])
  })
})
