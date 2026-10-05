// Runs the financial mutants (see mutants.mjs). For each: apply the defect, run the tests meant to catch it, require a FAILURE, restore
// the file. The file is ALWAYS restored (finally, SIGINT, SIGTERM, and a crash handler); a leftover backup from a killed run is
// restored first, so an interrupted run can never leave a defect in the code.
//
//   node src/test/payments/mutation/run.mjs [ids...]      exit code 1 if any mutant survived
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { MUTANTS } from './mutants.mjs'

const ROOT = path.resolve(fileURLToPath(new URL('../../../../../../', import.meta.url)))
const BACKUPS = path.join(ROOT, 'apps/carefind/.mutation-backups')
mkdirSync(BACKUPS, { recursive: true })

const slug = (file) => file.replace(/[\\/]/g, '__')
const backupOf = (file) => path.join(BACKUPS, slug(file))

// restore anything a killed run left behind
for (const f of readdirSync(BACKUPS)) {
  const original = path.join(ROOT, f.replace(/__/g, '/'))
  writeFileSync(original, readFileSync(path.join(BACKUPS, f)))
  unlinkSync(path.join(BACKUPS, f))
  console.log(`restored ${f.replace(/__/g, '/')} from an interrupted run`)
}

let current = null
const restore = () => {
  if (!current) return
  const b = backupOf(current)
  if (existsSync(b)) { writeFileSync(path.join(ROOT, current), readFileSync(b)); unlinkSync(b) }
  current = null
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restore(); process.exit(130) })
process.on('uncaughtException', (e) => { restore(); console.error(e); process.exit(1) })

const only = process.argv.slice(2)
const chosen = MUTANTS.filter((m) => !only.length || only.includes(m.id))
const results = []

function vitest(run) {
  const args = ['vitest', 'run', ...run.files, ...(run.args || []), '--no-file-parallelism']
  const r = spawnSync('npx', args, { cwd: path.join(ROOT, run.cwd), shell: true, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' }, timeout: 15 * 60 * 1000 })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  const failed = (out.match(/Tests\s+(?:\d+ failed)/) || out.match(/Test Files\s+\d+ failed/)) ? true : r.status !== 0
  const failure = (out.match(/^\s*(?:×|✗|FAIL)\s.*$/m) || [''])[0].trim().slice(0, 140)
  return { failed, failure, status: r.status }
}

for (const m of chosen) {
  const abs = path.join(ROOT, m.file)
  const original = readFileSync(abs, 'utf8')
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const normal = original.replace(/\r\n/g, '\n')
  const count = normal.split(m.find).length - 1
  if (count !== 1) { results.push({ id: m.id, verdict: 'INVALID', note: `find matched ${count} times` }); console.log(`${m.id} INVALID (${count} matches) ${m.what}`); continue }

  writeFileSync(backupOf(m.file), original)
  current = m.file
  try {
    writeFileSync(abs, normal.replace(m.find, () => m.replace).replace(/\n/g, eol))
    const runs = [m.run, m.alsoRun].filter(Boolean)
    let killedBy = null
    for (const run of runs) {
      const r = vitest(run)
      if (r.failed) { killedBy = { files: run.files.map((f) => path.basename(f)).join(', '), failure: r.failure }; break }
    }
    results.push({ id: m.id, verdict: killedBy ? 'killed' : 'SURVIVED', note: killedBy ? `${killedBy.files}: ${killedBy.failure}` : 'every test still passed' })
    console.log(`${m.id} ${killedBy ? 'killed  ' : 'SURVIVED'} ${m.what}${killedBy ? `\n        by ${killedBy.files}` : ''}`)
  } finally {
    restore()
  }
}

const survived = results.filter((r) => r.verdict === 'SURVIVED')
const invalid = results.filter((r) => r.verdict === 'INVALID')
console.log(`\n${results.length - survived.length - invalid.length} killed, ${survived.length} survived, ${invalid.length} invalid, of ${results.length}`)
for (const r of [...survived, ...invalid]) console.log(`  ${r.id}: ${r.verdict} - ${r.note}`)
process.exit(survived.length || invalid.length ? 1 : 0)
