// Security audit gate for an app's dependencies (CareHub and CareFind CI).
//
//   node ../../scripts/audit-gate.mjs            (run from apps/<app>)
//
// Replaces `npm audit --audit-level=high` with the same bar plus one narrow escape hatch:
//
//   * Production dependencies: any high or critical advisory fails. No exceptions.
//   * Development dependencies (build and test tools): any high or critical advisory fails, unless it is
//     listed in .github/audit-exceptions.json with a reason and an expiry date. An expired exception fails,
//     so it is looked at again.
//
// The exceptions file is for advisories with no fixed version to move to, in tools that never ship to
// users. Each entry: { "advisory": "GHSA-…", "package": "…", "reason": "…", "expires": "YYYY-MM-DD" }.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BLOCKING = new Set(['high', 'critical'])

// High and critical advisories in an `npm audit --json` report: [{ advisory, package, severity, title, url }].
// Only the package an advisory is filed against is counted; its dependents are listed by npm too, but they
// carry the same advisory, so counting them again would only repeat it.
export function blockingAdvisories(report) {
  const found = new Map()
  for (const [name, vuln] of Object.entries(report?.vulnerabilities || {})) {
    for (const via of vuln.via || []) {
      if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue
      const advisory = String(via.url || '').split('/').pop() || `${name}:${via.source}`
      if (!found.has(advisory)) found.set(advisory, { advisory, package: name, severity: via.severity, title: via.title, url: via.url })
    }
  }
  return [...found.values()]
}

// The gate's decision. `full` and `prod` are `npm audit --json` reports for all and for production-only
// dependencies; `exceptions` is the parsed exceptions list; `today` is YYYY-MM-DD.
// Returns { failures: [{ advisory, package, why }], excused: [{ advisory, package, expires }] }.
export function decide({ full, prod, exceptions = [], today }) {
  const failures = []
  const excused = []
  const inProd = new Set(blockingAdvisories(prod).map((a) => a.advisory))
  for (const a of blockingAdvisories(prod)) failures.push({ ...a, why: 'in a production dependency' })
  for (const a of blockingAdvisories(full)) {
    if (inProd.has(a.advisory)) continue
    const ex = exceptions.find((e) => e.advisory === a.advisory)
    if (!ex) failures.push({ ...a, why: 'in a development dependency, with no exception' })
    else if (!ex.reason || !/^\d{4}-\d{2}-\d{2}$/.test(ex.expires || '')) failures.push({ ...a, why: 'exception has no reason or expiry date' })
    else if (ex.expires < today) failures.push({ ...a, why: `exception expired on ${ex.expires}` })
    else excused.push({ advisory: a.advisory, package: a.package, expires: ex.expires })
  }
  return { failures, excused }
}

function audit(args) {
  const run = spawnSync('npm', ['audit', '--json', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  try { return JSON.parse(run.stdout) } catch {
    console.error(`npm audit ${args.join(' ')} did not return a report:\n${run.stderr || run.stdout}`)
    process.exit(2)
  }
}

function main() {
  const file = fileURLToPath(new URL('../.github/audit-exceptions.json', import.meta.url))
  const exceptions = JSON.parse(readFileSync(file, 'utf8')).exceptions || []
  const today = new Date().toISOString().slice(0, 10)
  const { failures, excused } = decide({ full: audit([]), prod: audit(['--omit=dev']), exceptions, today })
  for (const e of excused) console.log(`excused until ${e.expires}: ${e.advisory} (${e.package}), development dependency`)
  for (const f of failures) console.error(`FAIL ${f.severity} ${f.advisory} (${f.package}) ${f.why}: ${f.title || ''} ${f.url || ''}`)
  if (failures.length) {
    console.error(`\n${failures.length} high or critical advisor${failures.length === 1 ? 'y blocks' : 'ies block'} this build. See scripts/audit-gate.mjs.`)
    process.exit(1)
  }
  console.log('Security audit passed: no high or critical advisories outside dated exceptions.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
