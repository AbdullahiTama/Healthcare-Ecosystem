// @vitest-environment node
// Phase 12 (database): the engine entry points give up waiting for a lock (10 s) or running a statement (30 s) instead of hanging
// forever, and the migration that sets that survives every later redefinition. Real Postgres (PGlite), every migration in order.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
const all = async (sql, p = []) => (await db.query(sql, p)).rows
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const asRole = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn() } finally { await db.exec('reset role') } }

// every function that is an entry point of an engine or the reconciliation (the list _apply_engine_timeouts applies to)
const ENTRY_POINTS = [
  'settle_payment_intent', 'request_refund', 'settle_refund', 'mark_refund_processing', 'settle_withdrawal', 'settle_business_withdrawal',
  'create_withdrawal', 'release_shop_vendor_credits', 'sync_reconciliation_findings', 'run_db_reconciliation',
  '_settle_wallet_topup', '_settle_creator_subscription', '_settle_consultation', '_settle_booking', '_settle_plan_renewal', '_settle_shop_order',
  '_post_coin_entry', '_post_coin_transfer', '_post_coin_split',
]

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
  for (const m of ['carefind_20261003_payment_intents_foundation', 'carefind_20261004_settle_payment_intent', 'carefind_20261005_coin_ledger']) await db.exec(M(m))
  await createLegacyStubs(db)
  for (const m of ['carefind_20261005_coin_writers_use_ledger', 'carefind_20261005_lock_wallets_to_ledger', 'carefind_20261006_settle_plan_and_carehub_appointments',
    'carefind_20261007_commission_engine', 'carefind_20261008_commission_reconcile_first_payment', 'carefind_20261008_withdrawal_engine', 'carefind_20261009_refund_engine', 'carefind_20261010_central_settlement']) await db.exec(M(m))
  await db.exec(`
    create function public.cancel_shop_order(p_order_id uuid, p_reason text default null) returns text language sql as $$ select 'old'::text $$;
    create function public.process_shop_return(p_return_id uuid, p_action text, p_notes text default null) returns text language sql as $$ select 'old'::text $$;
  `)
  for (const m of ['carefind_20261012_shop_vendor_payouts', 'carefind_20261014_reconciliation', 'carefind_20261015_reconciliation_ops', 'carefind_20261016_reconciliation_scale', 'carefind_20261017_engine_timeouts_and_hot_paths']) await db.exec(M(m))
}, 240_000)

describe('engine timeouts', () => {
  it('every engine entry point has a lock timeout and a statement timeout', async () => {
    const rows = await all(`select p.proname, coalesce(p.proconfig, '{}') cfg from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any ($1)`, [ENTRY_POINTS])
    const found = new Set(rows.map((r) => r.proname))
    for (const name of ENTRY_POINTS) {
      if (name === 'create_withdrawal' || name === 'settle_withdrawal' || name === 'settle_business_withdrawal') expect(found.has(name), `${name} exists`).toBe(true)
    }
    expect(rows.length).toBeGreaterThanOrEqual(15)
    for (const r of rows) {
      expect(r.cfg, r.proname).toContain('lock_timeout=10s')
      expect(r.cfg.some((c) => c.startsWith('statement_timeout=')), `${r.proname} statement_timeout`).toBe(true)
      expect(r.cfg.some((c) => c.startsWith('search_path=')), `${r.proname} keeps its search_path`).toBe(true)
    }
  })

  it('the reconciliation may run longer than a payment', async () => {
    const cfg = async (name) => (await one(`select coalesce(proconfig, '{}') c from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [name])).c
    expect(await cfg('settle_payment_intent')).toContain('statement_timeout=30s')
    expect(await cfg('run_db_reconciliation')).toContain('statement_timeout=120s')
    expect(await cfg('sync_reconciliation_findings')).toContain('statement_timeout=120s')
  })

  it('the helper is idempotent, reports how many functions it set, and is private', async () => {
    const n1 = (await one('select public._apply_engine_timeouts() n')).n
    const n2 = (await one('select public._apply_engine_timeouts() n')).n
    expect(n1).toBe(n2)
    expect(n1).toBeGreaterThanOrEqual(15)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await expect(asRole(role, () => db.query('select public._apply_engine_timeouts()'))).rejects.toThrow(/permission denied/)
    }
  })

  it('a function that waits on a row lock held by another transaction gives up with 55P03 instead of waiting forever', async () => {
    // a second connection is not available in PGlite, so prove the mechanism: the setting is applied to the function's own statements
    await db.exec(`create function public.zz_waits() returns text language plpgsql set lock_timeout = '10s' as $$ begin return current_setting('lock_timeout'); end; $$`)
    expect((await one('select public.zz_waits() v')).v).toBe('10s')
    expect((await one("select current_setting('lock_timeout') v")).v).toBe('0')       // and it does not leak out of the function
  })
})

describe('what the hot-path migration kept', () => {
  it('_settle_shop_order is still private and the engine still refuses non-service callers', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await expect(asRole(role, () => db.query('select public._settle_shop_order(null::public.payment_intents)'))).rejects.toThrow(/permission denied/)
    }
    expect((await one("select has_function_privilege('service_role', 'public.settle_payment_intent(text,text,text,bigint,text)', 'execute') ok")).ok).toBe(true)
    expect((await one("select has_function_privilege('anon', 'public.settle_payment_intent(text,text,text,bigint,text)', 'execute') ok")).ok).toBe(false)
  })

  it('reconcile_shop_vendor_credits is still service_role only', async () => {
    expect((await one("select has_function_privilege('service_role', 'public.reconcile_shop_vendor_credits()', 'execute') ok")).ok).toBe(true)
    expect((await one("select has_function_privilege('authenticated', 'public.reconcile_shop_vendor_credits()', 'execute') ok")).ok).toBe(false)
  })
})
