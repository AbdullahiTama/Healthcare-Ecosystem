// @vitest-environment node
// Phase 11 under REAL concurrency: overlapping reconciliation runs (the cron, an admin "run now", a second instance) must never
// double-report, error out, or lose a finding. Runs only with PG_CONCURRENCY_URL (see settlementConcurrency.pg.test.js).
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
]

let pool, drop
const q = async (sql, p = []) => (await pool.query(sql, p)).rows
const tally = (results) => results.reduce((m, r) => { const k = r.status === 'fulfilled' ? 'ok' : `error:${r.reason.code || r.reason.message}`; m[k] = (m[k] || 0) + 1; return m }, {})
async function together(count, work, ms = 400) {
  const clients = await Promise.all(Array.from({ length: count }, () => pool.connect()))
  try {
    return await Promise.allSettled(clients.map(async (c, i) => {
      try { await c.query('begin'); const r = await work(c, i); await c.query('select pg_sleep($1)', [ms / 1000]); await c.query('commit'); return r }
      catch (e) { await c.query('rollback').catch(() => {}); throw e }
    }))
  } finally { clients.forEach((c) => c.release()) }
}
const item = (id) => ({ kind: 'k', subject_type: 't', subject_id: id, severity: 'warning', detail: 'd' })

describe.skipIf(!hasRealPostgres)('reconciliation under real concurrency', () => {
  beforeAll(async () => {
    ;({ pool, drop } = await createTestDatabase(SQL, { beforeFile: async (i, db) => { if (i === 4) await createLegacyStubs(db) } }))
  }, 600_000)
  afterAll(async () => { await drop?.() })

  it('12 overlapping syncs reporting the SAME new findings: each is inserted once, nobody errors', async () => {
    const current = JSON.stringify([item('1'), item('2'), item('3')])
    const results = await together(12, async (c) => (await c.query('select sync_reconciliation_findings($1,$2::jsonb) r', ['conc_a', current])).rows[0].r)
    expect(tally(results)).toEqual({ ok: 12 })
    expect(results.reduce((s, r) => s + r.value.inserted, 0)).toBe(3)
    const rows = await q("select subject_id, occurrences::int occ from reconciliation_findings where source = 'conc_a' order by subject_id")
    expect(rows).toEqual([{ subject_id: '1', occ: 12 }, { subject_id: '2', occ: 12 }, { subject_id: '3', occ: 12 }])
  })

  it('syncs that clear a finding racing syncs that report it end in a consistent state (resolved or open, never duplicated or erroring)', async () => {
    await pool.query("select sync_reconciliation_findings('conc_b', $1::jsonb)", [JSON.stringify([item('1')])])
    const results = await together(10, async (c, i) => (await c.query('select sync_reconciliation_findings($1,$2::jsonb) r', ['conc_b', JSON.stringify(i % 2 ? [item('1')] : [])])).rows[0].r)
    expect(tally(results)).toEqual({ ok: 10 })
    const rows = await q("select status from reconciliation_findings where source = 'conc_b'")
    expect(rows).toHaveLength(1)
    expect(['open', 'resolved']).toContain(rows[0].status)
  })

  it('8 overlapping full database reconciliations: every run completes, runs are recorded, findings are not duplicated', async () => {
    await pool.query(`insert into payment_provider_events (provider, event_id, event_type, reference, payload, signature_ok, received_at, outcome) values ('paystack','charge.success:1','charge.success','ref_stranger_1','{"data":{"amount":100000}}'::jsonb,true, now() - interval '2 hours','ignored')`)
    const results = await together(8, async (c) => (await c.query('select run_db_reconciliation() r')).rows[0].r.totals)
    expect(tally(results)).toEqual({ ok: 8 })
    expect((await q('select count(*)::int c from reconciliation_runs where finished_at is not null'))[0].c).toBe(8)
    expect(await q("select kind, status, occurrences::int occ from reconciliation_findings where kind = 'unmatched_charge'")).toEqual([{ kind: 'unmatched_charge', status: 'open', occ: 8 }])
  })
})
