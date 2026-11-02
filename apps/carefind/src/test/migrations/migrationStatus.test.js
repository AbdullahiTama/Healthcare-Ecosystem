// @vitest-environment node
// Migration status headers must agree with the live ledger (planning/CODE_AUDIT.md A3).
//
// THE PROBLEM THIS EXISTS FOR
//   A migration's header is how a reader knows whether a protection is live. On 2026-11-02, 27 files in
//   supabase/migrations still said "NOT YET APPLIED", "DRAFT" or "REVIEW ONLY" although every one was in the live
//   ledger, and an applied migration sat in docs/architecture/pending-migrations/ (the folder for drafts that must not
//   be applied). Someone could re-apply a live migration, or assume a guard is absent when it is in force.
//
// THE RULE
//   Every file in supabase/migrations is in exactly one honest state:
//     * applied: its name is in appliedLedger.snapshot.json, and its header does not claim otherwise
//       (an older "not applied" line is fine once a "LEDGER STATUS: APPLIED" line sits above it);
//     * not applied yet: its name is not in the snapshot, and its header says NOT YET APPLIED;
//     * a known legacy exception (KNOWN_UNRECORDED below), which may only shrink.
//   A header that says APPLIED must be backed by the snapshot, so applying a migration means updating both.
//   Nothing in pending-migrations may be in the ledger.
//
// UPDATING THE SNAPSHOT
//   After applying a migration, add its name to appliedLedger.snapshot.json (or regenerate the file from
//   `select json_agg(name order by name) from supabase_migrations.schema_migrations`) and set its header Status line.
//   It needs no database, so it runs in the ordinary unit suite.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const snapshot = JSON.parse(readFileSync(new URL('./appliedLedger.snapshot.json', import.meta.url), 'utf8'))
const applied = new Set(snapshot.names)

// In the repo with no ledger row under the file's name and no status header (2026-11-02). Some shipped under other names
// (the ledger has `staff_activity` and `sales_owner_corrections_1/2/4`; plan_enforcement's functions are live). Each needs
// a per-file reconciliation like the 2026-10-15 one; remove a name here once its header and the ledger agree.
const KNOWN_UNRECORDED = [
  'carehub_20261212_supplier_payments',
  'carehub_20261213_credit_customer_and_purchase_items',
  'carehub_20261214_plan_enforcement',
  'carehub_20261215_catalogue_foundation',
  'carehub_20261216_sales_owner_corrections',
  'carehub_20261217_staff_activity',
  'carehub_20261220_client_totals_and_held_sales',
  'carehub_20261221_prescription_safety',
  'carehub_20261222_branch_stock_transfers',
]

const HEADER_LINES = 40
const NOT_APPLIED = /not yet applied|status:\s*not applied|not applied yet|review only/i
const SAYS_APPLIED = /ledger status:\s*applied|status:\s*\**\s*applied|applied to production|applied live/i
const LEDGER_MARK = /ledger status:\s*applied/i

const migrationsDir = join(repoRoot, 'supabase/migrations')
const pendingDir = join(repoRoot, 'docs/architecture/pending-migrations')
const sqlNames = (dir) => readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -4)).sort()
const header = (dir, name) => readFileSync(join(dir, `${name}.sql`), 'utf8').split('\n').slice(0, HEADER_LINES).join('\n')

const files = sqlNames(migrationsDir).map((name) => {
  const h = header(migrationsDir, name)
  return { name, inLedger: applied.has(name), saysApplied: SAYS_APPLIED.test(h), saysNotApplied: NOT_APPLIED.test(h) && !LEDGER_MARK.test(h) }
})

describe('migration status headers agree with the ledger', () => {
  it('the snapshot is well-formed', () => {
    expect(snapshot.count).toBe(snapshot.names.length)
    expect(new Set(snapshot.names).size).toBe(snapshot.names.length)
  })

  it('no applied migration claims to be unapplied, a draft or review-only', () => {
    const stale = files.filter((f) => f.inLedger && f.saysNotApplied).map((f) => f.name)
    expect(stale, 'add a "LEDGER STATUS: APPLIED" line (see A3) or update the Status line').toEqual([])
  })

  it('every header that says APPLIED is in the ledger snapshot', () => {
    const unbacked = files.filter((f) => f.saysApplied && !f.inLedger).map((f) => f.name)
    expect(unbacked, 'add the applied name to appliedLedger.snapshot.json').toEqual([])
  })

  it('a migration not in the ledger says so (or is a known legacy exception)', () => {
    const silent = files.filter((f) => !f.inLedger && !f.saysNotApplied && !KNOWN_UNRECORDED.includes(f.name)).map((f) => f.name)
    expect(silent, 'mark it "Status: NOT YET APPLIED", or apply it and record it').toEqual([])
  })

  it('the legacy exception list only shrinks', () => {
    const names = new Set(files.map((f) => f.name))
    for (const n of KNOWN_UNRECORDED) {
      expect(names.has(n), `${n} no longer exists: remove it from KNOWN_UNRECORDED`).toBe(true)
      expect(applied.has(n), `${n} is now in the ledger: remove it from KNOWN_UNRECORDED`).toBe(false)
    }
  })

  it('nothing in pending-migrations has been applied', () => {
    const live = sqlNames(pendingDir).filter((n) => applied.has(n))
    expect(live, 'an applied migration belongs in supabase/migrations, not pending-migrations').toEqual([])
  })
})
