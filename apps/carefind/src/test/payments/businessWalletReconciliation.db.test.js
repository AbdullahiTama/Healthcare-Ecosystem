// @vitest-environment node
// Business wallet reconciliation (Rem-06). Real Postgres (PGlite).
//
// business_wallets has no wallets_guard, so a balance can be written with no ledger row behind it and nothing detects
// it. In production on 2026-10-15 that had already happened: NGN 10,000 of business balance its own ledger could not
// explain. This function DETECTS. It never corrects - adjusting a real balance is an owner's decision.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 190000).toString(16).padStart(12, '0')}`
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
  await db.exec(M('carefind_20261003_payment_intents_foundation'))
  await db.exec(M('carefind_20261004_settle_payment_intent'))
  await db.exec(M('carefind_20261005_coin_ledger'))
  await createLegacyStubs(db)
  await db.exec(M('carefind_20261005_coin_writers_use_ledger'))
  await db.exec(M('carefind_20261005_lock_wallets_to_ledger'))
  await db.exec(M('carefind_20261006_settle_plan_and_carehub_appointments'))
  await db.exec(M('carefind_20261007_commission_engine'))
  await db.exec(M('carefind_20261008_commission_reconcile_first_payment'))
  await db.exec(M('carefind_20261008_withdrawal_engine'))
  await db.exec(M('carefind_20261009_refund_engine'))
  await db.exec(M('carefind_20261010_central_settlement'))
  await db.exec(`
    create function public.cancel_shop_order(p_order_id uuid, p_reason text default null) returns text language sql as $$ select 'old'::text $$;
    create function public.process_shop_return(p_return_id uuid, p_action text, p_notes text default null) returns text language sql as $$ select 'old'::text $$;
    grant execute on function public.cancel_shop_order(uuid, text), public.process_shop_return(uuid, text, text) to anon, authenticated, service_role;
  `)
  await db.exec(M('carefind_20261012_shop_vendor_payouts'))
  await db.exec(`
    create function public.request_shop_return(p_order_id uuid, p_reason text, p_description text default null, p_refund_amount_kobo integer default null) returns uuid language sql as $$ select null::uuid $$;
    grant execute on function public.request_shop_return(uuid, text, text, integer) to anon, authenticated, service_role;
  `)
  await db.exec(M('carefind_20261013_shop_return_hardening'))
  await db.exec(M('carefind_20261014_reconciliation'))
  await db.exec(M('carefind_20261015_reconciliation_ops'))
  await db.exec(M('carefind_20261016_reconciliation_scale'))
  await db.exec(M('carefind_20261017_engine_timeouts_and_hot_paths'))
  await db.exec(M('carefind_20261019_red_team_fixes'))
  await db.exec(M('carefind_20261105_release_on_delivery'))
  await db.exec(M('carefind_20261113_pickup_receipt_release'))
  // confirm_appointment lives in a CareHub migration this chain does not load. Stub it with the EXACT production ACL
  // (executable by authenticated), so the test proves the migration actually revokes it rather than trivially passing
  // on a function that was never there.
  await db.exec(`
    create function public.confirm_appointment(p_appointment_id uuid) returns text
      language plpgsql security definer set search_path = public, pg_temp as $$
    begin return 'legacy'::text; end; $$;
    grant execute on function public.confirm_appointment(uuid) to anon, authenticated, service_role;
  `)
  expect((await one("select has_function_privilege('authenticated','public.confirm_appointment(uuid)','execute') v")).v).toBe(true)
  await db.exec(M('carefind_20261115_business_wallet_reconciliation'))
  await db.exec(M('carefind_20261116_business_wallet_reconciliation_wiring'))
}, 240_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const all = async (sql, p = []) => (await db.query(sql, p)).rows
const asRole = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn() } finally { await db.exec('reset role') } }
// The reconcile function is global by design (it sweeps every business), and these tests share one database, so each
// assertion is scoped to the business it created. A business left broken by an earlier test is still reported by the
// function - that is the point - but it is not this test's business to assert on.
const findings = () => all('select business_id, kind, detail, balance_total::int, ledger_total::int, delta::int from reconcile_business_wallets() order by business_id')
const findingsFor = async (b) => (await findings()).filter((x) => x.business_id === b)

async function business({ held = 0, available = 0 } = {}) {
  const b = (await db.query('insert into businesses (name) values ($1) returning id', ['V'])).rows[0].id
  await db.query('insert into business_wallets (business_id, held_balance, available_balance) values ($1,$2,$3)', [b, held, available])
  return b
}
const ledgerRow = (b, type, amount, status = 'confirmed') =>
  db.query('insert into business_wallet_transactions (business_id, type, amount, reference, status) values ($1,$2,$3,$4,$5)', [b, type, amount, ref('x'), status])

describe('reconcile_business_wallets', () => {
  it('says nothing when the balance is exactly what the ledger explains', async () => {
    const b = await business({ available: 500_000 })
    await ledgerRow(b, 'topup', 500_000)
    expect(await findingsFor(b)).toEqual([])
  })

  it('flags a wallet whose balance was written with no ledger row behind it', async () => {
    // The production case: 500,000 kobo and not one transaction.
    const b = await business({ available: 500_000 })
    const f = await findingsFor(b)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ business_id: b, kind: 'no_ledger_rows', balance_total: 500_000, ledger_total: 0, delta: 500_000 })
  })

  it('flags a balance larger than its ledger, with the exact gap', async () => {
    const b = await business({ available: 1_840_000 })
    await ledgerRow(b, 'topup', 1_340_000)
    const f = await findingsFor(b)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ kind: 'balance_not_derivable', balance_total: 1_840_000, ledger_total: 1_340_000, delta: 500_000 })
    expect(f[0].detail).toContain('500000')
  })

  it('does NOT count a shop_release as income: it moves held to available and changes no total', async () => {
    // Counting releases would overstate every released order by its full value.
    const b = await business({ available: 16_000 })
    await ledgerRow(b, 'shop_credit', 16_000)
    await ledgerRow(b, 'shop_release', 16_000)
    expect(await findingsFor(b)).toEqual([])
  })

  it('ignores a PENDING withdrawal: it has reserved nothing yet', async () => {
    const b = await business({ available: 500_000 })
    await ledgerRow(b, 'topup', 500_000)
    await ledgerRow(b, 'withdrawal', -200_000, 'pending')
    expect(await findingsFor(b)).toEqual([])
  })

  it('still counts a CONFIRMED withdrawal against the balance', async () => {
    const b = await business({ available: 300_000 })
    await ledgerRow(b, 'topup', 500_000)
    await ledgerRow(b, 'withdrawal', -200_000)
    expect(await findingsFor(b)).toEqual([])
  })

  it('handles several businesses at once and names only the broken one', async () => {
    const good = await business({ available: 100_000 })
    await ledgerRow(good, 'topup', 100_000)
    const bad = await business({ available: 250_000 })
    const f = await findings()
    const ids = f.map((x) => x.business_id)
    expect(ids).toContain(bad)
    expect(ids).not.toContain(good)
  })

  it('CORRECTS NOTHING: the balance is exactly as it was after being flagged', async () => {
    const b = await business({ available: 500_000 })
    await findings()
    expect((await one('select held_balance::int held, available_balance::int avail from business_wallets where business_id = $1', [b])))
      .toEqual({ held: 0, avail: 500_000 })
  })

  it('is readable by the reconciliation job and by nobody else', async () => {
    expect((await one("select has_function_privilege('service_role','public.reconcile_business_wallets()','execute') v")).v).toBe(true)
    for (const role of ['anon', 'authenticated']) {
      expect((await one('select has_function_privilege($1,\'public.reconcile_business_wallets()\',\'execute\') v', [role])).v, role).toBe(false)
    }
  })
})

describe('the legacy release path is closed', () => {
  it('confirm_appointment is no longer executable by a signed-in user', async () => {
    expect((await one("select has_function_privilege('authenticated','public.confirm_appointment(uuid)','execute') v")).v).toBe(false)
    expect((await one("select has_function_privilege('anon','public.confirm_appointment(uuid)','execute') v")).v).toBe(false)
  })

  it('but still works for the server, which is its only real caller', async () => {
    expect((await one("select has_function_privilege('service_role','public.confirm_appointment(uuid)','execute') v")).v).toBe(true)
    expect((await one("select to_regprocedure('public.confirm_appointment(uuid)') is not null v")).v).toBe(true)
  })
})

describe('the nightly scan publishes business wallets (carefind_20261116)', () => {
  const runLight = async () => (await asRole('service_role', () => one('select run_db_reconciliation(false) r'))).r
  const rowsFor = (b) => all("select kind, severity, status from reconciliation_findings where source = 'business_wallets' and subject_id = $1 order by kind", [b])
  const occOf = (b) => one("select occurrences::int occ, status from reconciliation_findings where source = 'business_wallets' and subject_id = $1", [b])

  it('is a source of the scan, beside the others', async () => {
    const r = await runLight()
    expect(r.sources.map((s) => s.source)).toEqual(['commissions', 'withdrawals', 'refunds', 'shop_vendor', 'business_wallets', 'events'])
  })

  it('publishes a drifted wallet as a warning finding, and resolves it once the ledger agrees', async () => {
    const b = await business({ available: 500_000 })
    await runLight()
    expect(await rowsFor(b)).toEqual([{ kind: 'no_ledger_rows', severity: 'warning', status: 'open' }])

    await ledgerRow(b, 'topup', 500_000)
    await runLight()
    expect(await rowsFor(b)).toEqual([{ kind: 'no_ledger_rows', severity: 'warning', status: 'resolved' }])
  })

  it('counts a repeat sighting, resolves when the ledger agrees, and reopens if the wallet breaks again', async () => {
    const b = await business({ available: 300_000 })
    await runLight()
    await runLight()
    expect(await occOf(b)).toMatchObject({ occ: 2, status: 'open' })

    await ledgerRow(b, 'topup', 300_000)
    await runLight()
    expect(await occOf(b)).toMatchObject({ occ: 2, status: 'resolved' })

    await db.query('delete from business_wallet_transactions where business_id = $1', [b])
    await runLight()
    expect(await occOf(b)).toMatchObject({ occ: 3, status: 'open' })
  })

  it('kept the runner service_role-only and time-bounded when it was redefined', async () => {
    const cfg = (await one("select proconfig from pg_proc where proname = 'run_db_reconciliation' and pronamespace = 'public'::regnamespace")).proconfig
    expect(cfg).toContain('lock_timeout=10s')
    expect(cfg).toContain('statement_timeout=120s')
    expect((await one("select has_function_privilege('service_role','public.run_db_reconciliation(boolean)','execute') v")).v).toBe(true)
    for (const role of ['anon', 'authenticated']) {
      expect((await one("select has_function_privilege($1,'public.run_db_reconciliation(boolean)','execute') v", [role])).v, role).toBe(false)
    }
  })
})