// Release gate (H07). One command that answers "is this tree safe to release?" with a table instead of a feeling.
//
//   node scripts/release-gate.mjs                  everything (needs PG_CONCURRENCY_URL for the real-Postgres suites)
//   node scripts/release-gate.mjs --only=packages,migrations
//   node scripts/release-gate.mjs --skip=builds,mutation
//
// Exit code 0 ONLY when every step ran and passed. A skipped step is reported as SKIPPED and makes the exit code 2, so a gate that
// did not look at something can never be mistaken for one that did. It never applies a migration, deploys, or contacts a provider:
// every database in it is PGlite or the throwaway Postgres named by PG_CONCURRENCY_URL.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1]?.split(',').filter(Boolean) || null
const only = arg('only')
const skip = new Set(arg('skip') || [])

const PACKAGES = ['shared-payments', 'shared-email', 'shared-notifications', 'shared-payout-ui']
const APPS = ['carefind', 'carehub']

// ---- the migration copy rule ------------------------------------------------------------------------------------------------
// supabase/migrations is what the engines' tests replay; apps/carefind/sql is the copy people apply from. From the H-track on, a
// money migration must exist in both and be identical (line endings aside), or the thing that was tested is not the thing applied.
const H_TRACK_FROM = 20261028
const inTrack = (n) => { const m = n.match(/^carefind_(d{8})_.+.sql$/); return Boolean(m) && Number(m[1]) >= H_TRACK_FROM }
function migrationCopies() {
  const A = path.join(ROOT, 'supabase/migrations')
  const B = path.join(ROOT, 'apps/carefind/sql')
  const norm = (f) => readFileSync(f, 'utf8').replace(/\r/g, '')
  const problems = []
  const names = readdirSync(A).filter((f) => f.endsWith('.sql'))
  const stamps = new Map()
  for (const f of names) {
    const m = f.match(/^(carefind|carehub)_(\d{8})_(.+)\.sql$/)
    if (!m) continue
    const key = `${m[1]}_${m[2]}_${m[3]}`
    if (stamps.has(key)) problems.push(`duplicate migration name ${f}`)
    stamps.set(key, true)
  }
  for (const f of names.filter(inTrack)) {
    const copy = path.join(B, f)
    if (!existsSync(copy)) problems.push(`${f}: no copy in apps/carefind/sql`)
    else if (norm(path.join(A, f)) !== norm(copy)) problems.push(`${f}: the two copies differ`)
  }
  for (const f of readdirSync(B).filter(inTrack)) {
    if (!existsSync(path.join(A, f))) problems.push(`${f}: in apps/carefind/sql but not in supabase/migrations`)
  }
  return problems
}

// ---- the steps --------------------------------------------------------------------------------------------------------------
const sh = (cwd, cmd, env = {}) => ({ cwd, cmd, env })
const steps = [
  { id: 'migrations', label: 'migration copies identical, names unique', run: () => migrationCopies() },
  ...PACKAGES.map((p) => ({ id: 'packages', label: `package tests: ${p}`, ...sh(`packages/${p}`, 'npm test') })),
  ...PACKAGES.map((p) => ({ id: 'audit', label: `audit (production deps, high): ${p}`, ...sh(`packages/${p}`, 'npm audit --omit=dev --audit-level=high') })),
  { id: 'apps', label: 'CareFind: all tests (PGlite; the *.pg suites skip here)', ...sh('apps/carefind', 'npm test') },
  { id: 'apps', label: 'CareHub: all tests', ...sh('apps/carehub', 'npm test') },
  { id: 'realpg', label: 'CareFind: real-Postgres concurrency suites', ...sh('apps/carefind', 'npm run test:finance:pg'), needs: 'PG_CONCURRENCY_URL' },
  { id: 'mutation', label: 'financial mutation gate (every mutant must be killed)', ...sh('apps/carefind', 'npm run test:mutation') },
  ...APPS.map((a) => ({ id: 'lint', label: `lint: ${a} (errors fail; warnings do not)`, ...sh(`apps/${a}`, 'npm run lint') })),
  ...APPS.map((a) => ({ id: 'builds', label: `build: ${a}`, ...sh(`apps/${a}`, 'npm run build') })),
  ...APPS.map((a) => ({ id: 'audit', label: `audit (production deps, high): ${a}`, ...sh(`apps/${a}`, 'npm audit --omit=dev --audit-level=high') })),
  // First party UI copy must not contain a dash character. The audit parses the
  // AST, so it never flags a route path, CSS class, column name or identifier.
  { id: 'copy', label: 'first party UI copy: no dashes, no unparsed files', run: () => spawnSync(process.execPath, ['scripts/audit-ui-copy.mjs'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout.split('\n').filter((l) => /DASH|parse error/i.test(l)) },
]

const rows = []
for (const s of steps) {
  const selected = (!only || only.includes(s.id)) && !skip.has(s.id)
  if (!selected) { rows.push({ ...s, verdict: 'SKIPPED', note: 'not selected' }); continue }
  if (s.needs && !process.env[s.needs]) { rows.push({ ...s, verdict: 'SKIPPED', note: `set ${s.needs}` }); continue }
  const t0 = Date.now()
  let failures = []
  let ok = true
  let tail = ''
  if (s.run) {
    failures = s.run()
    ok = failures.length === 0
    tail = failures.join('\n')
  } else {
    // Only the real-Postgres step may see PG_CONCURRENCY_URL. Elsewhere it would switch the *.pg suites on inside a parallel run, and
    // they take row and advisory locks on one shared server (55P03); they are written to run sequentially, in their own step.
    const env = { ...process.env, FORCE_COLOR: '0', ...s.env }
    if (s.id !== 'realpg') delete env.PG_CONCURRENCY_URL
    const r = spawnSync(s.cmd, { cwd: path.join(ROOT, s.cwd), shell: true, encoding: 'utf8', env, maxBuffer: 256 * 1024 * 1024 })
    ok = r.status === 0
    tail = `${r.stdout || ''}${r.stderr || ''}`.split('\n').filter((l) => l.trim()).slice(-12).join('\n')
  }
  const secs = Math.round((Date.now() - t0) / 1000)
  rows.push({ ...s, verdict: ok ? 'PASS' : 'FAIL', note: `${secs}s`, tail: ok ? '' : tail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.label} (${secs}s)`)
  if (!ok) console.log(tail.split('\n').map((l) => `      ${l}`).join('\n'))
}

const count = (v) => rows.filter((r) => r.verdict === v).length
console.log('\n=== release gate ===')
for (const r of rows) console.log(`${r.verdict.padEnd(8)} ${r.label}${r.verdict === 'SKIPPED' ? `  (${r.note})` : ''}`)
console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('SKIPPED')} skipped of ${rows.length}`)
if (count('FAIL')) { console.log('RESULT: NOT READY (a step failed)'); process.exit(1) }
if (count('SKIPPED')) { console.log('RESULT: INCOMPLETE (a step was skipped; this is not a release verdict)'); process.exit(2) }
console.log('RESULT: READY')
