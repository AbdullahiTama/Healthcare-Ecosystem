// @vitest-environment node
// Migration drift ratchet (Rem-08).
//
// THE PROBLEM THIS EXISTS FOR
//   `supabase/migrations/` is a DELTA STREAM, not a schema. It has never contained a baseline: the original tables were
//   created outside the repo, so the migration folder only ever recorded changes to them. The base schema is instead
//   hand-encoded in a test fixture (`src/test/payments/fixtures/liveSchemaSubset.sql`), which is why the PGlite suites can
//   boot at all.
//
//   Measured against production on 2026-10-15, the repo cannot account for 38 live functions and 110 live tables: there is
//   no `create` statement for them anywhere in `supabase/migrations/`, `apps/carefind/sql/` or `apps/carehub/sql/`.
//   Consequences: a fresh database built from this repo would be missing them, and - worse - because PL/pgSQL does not
//   resolve function names until a function is first CALLED, the migrations that use them would apply cleanly and then
//   fail at runtime, in production, the first time someone placed an order.
//
// WHAT THIS TEST DOES
//   It is a RATCHET, not a repair. `productionCatalogue.snapshot.json` records the live catalogue and the gap as it stood
//   on 2026-10-15. The gap is allowed to SHRINK - back-filling a missing migration is progress and must not break CI -
//   but it may never GROW. A new object that nobody wrote down is a regression, and that is what fails here.
//
//   TO CLOSE A GAP: add the missing `create` statement to the repo's SQL, then delete that name from
//   `knownGap`. Do NOT delete it from the top-level `functions` / `tables` arrays - that is the escape hatch the
//   "has not been doctored" test closes. Removing a security-relevant name from `knownGap` additionally trips the
//   explicit list at the bottom of this file, so those removals cannot pass unnoticed.
//
//   It does not need a database, so it runs in the ordinary unit suite on every push.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const snapshot = JSON.parse(readFileSync(new URL('./productionCatalogue.snapshot.json', import.meta.url), 'utf8'))

const SQL_ROOTS = ['supabase/migrations', 'apps/carefind/sql', 'apps/carehub/sql']

const sqlFilesIn = (dir) => {
  let out = []
  let entries = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) out = out.concat(sqlFilesIn(full))
    else if (e.endsWith('.sql')) out.push(full)
  }
  return out
}

/** Every CREATE FUNCTION / CREATE TABLE the repo can point at, across all three SQL sources. */
function readRepoSchema() {
  const functions = new Set()
  const tables = new Set()
  const perRoot = {}
  for (const root of SQL_ROOTS) {
    const files = sqlFilesIn(join(repoRoot, root))
    perRoot[root] = files.length
    for (const f of files) {
      const sql = readFileSync(f, 'utf8')
      for (const m of sql.matchAll(/^\s*create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gim)) {
        functions.add(m[1].toLowerCase())
      }
      for (const m of sql.matchAll(/^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gim)) {
        tables.add(m[1].toLowerCase())
      }
    }
  }
  const files = Object.values(perRoot).reduce((a, b) => a + b, 0)
  return { functions, tables, files, perRoot }
}

const repo = readRepoSchema()
const missingFunctions = snapshot.functions.filter((n) => !repo.functions.has(n.toLowerCase()))
const missingTables = snapshot.tables.filter((n) => !repo.tables.has(n.toLowerCase()))
const newFunctions = missingFunctions.filter((n) => !snapshot.knownGap.functions.includes(n))
const newTables = missingTables.filter((n) => !snapshot.knownGap.tables.includes(n))
const fixedFunctions = snapshot.knownGap.functions.filter((n) => !missingFunctions.includes(n))
const fixedTables = snapshot.knownGap.tables.filter((n) => !missingTables.includes(n))

describe('migration drift ratchet', () => {
  it('read all three SQL sources, not a subset', () => {
    // A wrong or moved path would make every assertion below pass vacuously, which is worse than having no test. Each
    // root must contribute real files, or the drift report is silently measuring less than it claims to.
    for (const root of SQL_ROOTS) {
      expect(repo.perRoot[root], root).toBeGreaterThan(20)
    }
    expect(repo.functions.size).toBeGreaterThan(250)
    expect(repo.tables.size).toBeGreaterThan(120)
  })

  it('accounts for every live production function, or lists it as a known gap', () => {
    expect(newFunctions).toEqual([])
  })

  it('accounts for every live production table, or lists it as a known gap', () => {
    expect(newTables).toEqual([])
  })

  it('has a live catalogue worth the name', () => {
    // Guards the escape hatch: emptying the snapshot would make every ratchet above pass forever.
    expect(snapshot.functions.length).toBeGreaterThan(200)
    expect(snapshot.tables.length).toBeGreaterThan(200)
    expect(snapshot.capturedOn).toBe('2026-10-15')
  })

  it('has not been doctored: nothing was deleted from the live catalogue to hide a gap', () => {
    // The escape hatch to watch for is EDITING THE SNAPSHOT rather than fixing the repo: delete a name from
    // `functions` and the ratchet never sees it again. Every recorded gap must still be in the catalogue.
    const droppedFunctions = snapshot.knownGap.functions.filter((n) => !snapshot.functions.includes(n))
    const droppedTables = snapshot.knownGap.tables.filter((n) => !snapshot.tables.includes(n))
    expect({ functions: droppedFunctions, tables: droppedTables }).toEqual({ functions: [], tables: [] })
  })

  it('reports the current state, so the number is always in the test output', () => {
    const state = {
      liveFunctions: snapshot.functions.length,
      liveTables: snapshot.tables.length,
      unaccountedFunctions: missingFunctions.length,
      unaccountedTables: missingTables.length,
      newlyUnaccounted: newFunctions.length + newTables.length,
      fixedSinceBaseline: fixedFunctions.length + fixedTables.length,
    }
    // eslint-disable-next-line no-console
    console.log('[migration-drift]', JSON.stringify(state))
    expect(state.newlyUnaccounted).toBe(0)
    expect(state.unaccountedFunctions).toBeLessThanOrEqual(snapshot.knownGap.functions.length)
    expect(state.unaccountedTables).toBeLessThanOrEqual(snapshot.knownGap.tables.length)
  })
})

describe('the functions that are missing are named, not anonymous', () => {
  it('the security-relevant ones are in the recorded gap and stay visible', () => {
    // These decide who may read or write. If one of them is ever back-filled, this list is what tells a reviewer it
    // happened; if a NEW one is lost, the ratchet above is what fails.
    const securitySensitive = [
      'is_platform_admin_email',
      'is_business_owner_email',
      'is_staff_owner_level',
      'can_manage_staff',
      'can_manage_staff_as',
      'can_manage_directory',
      'role_grants_staff_management',
      'role_grants_directory_management',
      'guard_role_writes',
      'guard_staff_writes',
      'staff_email_conflict',
      'directory_businesses_guard',
      'guard_email_outbox_quarantine',
    ]
    for (const fn of securitySensitive) {
      expect(snapshot.knownGap.functions, fn).toContain(fn)
    }
  })
})