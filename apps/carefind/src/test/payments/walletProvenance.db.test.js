// @vitest-environment node
// Phase 16 (database, milestone D1): coin provenance. A positive coin_ledger credit must trace
// to a settled payment intent, an allowed internal kind, a service-role reference prefix, or the
// legacy transactions settlement row. The withdrawal reservation refuses the untraceable portion,
// the report lists the offending entries, and the reconciliation is left untouched when it does
// not exist yet (guarded recreate in carefind_20261020).
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 160000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}_abcdefgh`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await db.exec(read('./fixtures/liveSchemaSubset.sql'))
  await db.exec(`
    alter table public.transactions add constraint transactions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
    alter table public.wallets add constraint wallets_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  `)
  await db.exec(M('carefind_20261003_payment_intents_foundation'))
  await db.exec(M('carefind_20261004_settle_payment_intent'))
  await db.exec(M('carefind_20261005_coin_ledger'))
  await createLegacyStubs(db)
  await db.exec(M('carefind_20261005_coin_writers_use_ledger'))
  await db.exec(M('carefind_20261005_lock_wallets_to_ledger'))
  await db.exec(M('carefind_20261008_withdrawal_engine'))
  await db.exec(M('carefind_20261020_wallet_spend_and_topup'))
}, 180_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const all = async (sql, p = []) => (await db.query(sql, p)).rows
const user = async () => {
  const u = uid()
  await db.query('insert into auth.users (id) values ($1)', [u])
  return u
}
const seed = (u, coins, kind, reference) => db.query('select _post_coin_entry($1,$2,$3,$4)', [u, coins, kind, reference])
const bal = async (u) => Number((await one('select balance from wallets where user_id = $1', [u]))?.balance ?? 0)
const create = async (u, coins) =>
  (await one(`select create_withdrawal($1,$2,'GTBank','058','0123456789','Ada Obi',null) r`, [u, coins])).r
const provenance = (u) => all('select * from reconcile_coin_provenance() where user_id = $1', [u])

describe('reconcile_coin_provenance', () => {
  it('reports a forged adjustment whose reference carries no allowed prefix, and nothing else', async () => {
    const u = await user()
    await seed(u, 100, 'topup', ref('seed'))          // engine kind: traceable
    await seed(u, 10, 'opening_balance', ref('op'))   // engine kind: traceable
    await seed(u, 50, 'adjustment', ref('manual'))    // forged: arbitrary reference
    const rows = await provenance(u)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      user_id: u,
      kind: 'adjustment',
      delta: 50,
      reason: 'adjustment_without_allowed_reference',
    })
    expect(rows[0].reference.startsWith('manual_')).toBe(true)  // the forged reference itself
  })

  it('trusts an adjustment that carries the service-role adj_ prefix', async () => {
    const u = await user()
    await seed(u, 40, 'adjustment', `adj_manual_${u.slice(0, 8)}`)
    expect(await provenance(u)).toEqual([])
  })

  it('trusts an earning vouched for by a settled payment intent', async () => {
    const u = await user()
    const reference = `PSPTXN${String(++n).padStart(8, '0')}` // provider reference, no known prefix
    await seed(u, 60, 'consultation_earning', reference)
    expect(await provenance(u)).toHaveLength(1)         // not traceable yet
    // The guard only accepts a fresh row; walk the state machine to settled.
    await db.query(`insert into payment_intents (reference, application, purpose, customer_id, expected_amount, provider)
      values ($1,'carefind','consultation',$2,1200000,'paystack')`, [reference, u])
    await db.query(`update payment_intents set status = 'verified' where reference = $1`, [reference])
    await db.query(`update payment_intents set status = 'settled', provider_transaction_id = 'TXN_' || $1 where reference = $1`, [reference])
    expect(await provenance(u)).toEqual([])
  })

  it('trusts an earning vouched for by the legacy transactions settlement row', async () => {
    const u = await user()
    const reference = `CASH_${++n}`
    await seed(u, 30, 'subscription_earning', reference)
    expect(await provenance(u)).toHaveLength(1)
    await db.query('insert into transactions (user_id, type, amount, reference, status) values ($1,$2,$3,$4,$5)',
      [u, 'subscription_earning', 600000, reference, 'success'])
    expect(await provenance(u)).toEqual([])
  })
})

describe('create_withdrawal provenance reservation', () => {
  it('allows the withdrawal when every credit traces (plan: normal topup)', async () => {
    const u = await user()
    await seed(u, 100, 'topup', ref('seed'))
    const r = await create(u, 10)
    expect(r.outcome).toBe('ok')
    expect(await bal(u)).toBe(90)
    expect(await provenance(u)).toEqual([])
  })

  it('refuses the untraceable portion, debits nothing, and creates no request (plan: forged adjustment)', async () => {
    const u = await user()
    await seed(u, 100, 'topup', ref('seed'))
    await seed(u, 50, 'adjustment', ref('manual'))
    expect(await bal(u)).toBe(150)

    const refused = await create(u, 120)
    expect(refused.outcome).toBe('untraceable_credits')
    expect(refused.withdrawable_coins).toBe(100)   // 150 - 50
    expect(refused.untraceable_coins).toBe(50)
    expect(await bal(u)).toBe(150)                 // nothing moved
    expect(await all('select id from withdrawal_requests where user_id = $1', [u])).toEqual([])
    expect(await all('select id from coin_ledger where user_id = $1 and delta < 0', [u])).toEqual([])
    expect(await all('select id from transactions where user_id = $1 and type = $2', [u, 'withdrawal'])).toEqual([])

    // exactly the traced balance still withdraws...
    const ok = await create(u, 100)
    expect(ok.outcome).toBe('ok')
    expect(await bal(u)).toBe(50)

    // ...and the quarantined 50 can never be withdrawn, even in the smallest amount.
    const again = await create(u, 5)
    expect(again.outcome).toBe('untraceable_credits')
    expect(again.withdrawable_coins).toBe(0)
    expect(again.untraceable_coins).toBe(50)
    expect(await bal(u)).toBe(50)
  })

  it('does not flag users whose credits all trace, so existing withdrawals are unaffected', async () => {
    const u = await user()
    await seed(u, 100, 'topup', ref('seed'))
    await seed(u, 25, 'gift_received', ref('gift'))
    await seed(u, 35, 'consultation_earning', `consult_${u.slice(0, 8)}`)   // allowed prefix
    const r = await create(u, 160)
    expect(r.outcome).toBe('ok')
    expect(await bal(u)).toBe(0)
  })
})

describe('function access', () => {
  it('keeps the provenance report and the reservation out of client-role reach', async () => {
    for (const fn of ['public.reconcile_coin_provenance()', 'public.create_withdrawal(uuid, integer, text, text, text, text, integer)']) {
      expect(await one(`select has_function_privilege('anon', $1::text, 'execute') p`, [fn])).toMatchObject({ p: false })
      expect(await one(`select has_function_privilege('authenticated', $1::text, 'execute') p`, [fn])).toMatchObject({ p: false })
      expect(await one(`select has_function_privilege('service_role', $1::text, 'execute') p`, [fn])).toMatchObject({ p: true })
    }
  })

  it('does not create run_db_reconciliation in a chain that never applied the reconciliation migrations', async () => {
    expect(await one(`select to_regprocedure('public.run_db_reconciliation(boolean)') f`)).toMatchObject({ f: null })
  })
})
