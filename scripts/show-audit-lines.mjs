// Print exact source lines for audit findings without console encoding damage.
//   node scripts/show-audit-lines.mjs "file1.jsx:12,34" "file2.jsx:9"
import { readFileSync } from 'node:fs'
import path from 'node:path'
const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
for (const spec of process.argv.slice(2)) {
  const [rel, lines] = spec.split(':')
  const src = readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/)
  for (const n of lines.split(',').map(Number)) {
    const i = n - 1
    const prev = (src[i - 1] ?? '').trim()
    const cur = (src[i] ?? '')
    const next = (src[i + 1] ?? '').trim()
    process.stdout.write(`${rel}:${n}\n`)
    if (prev) process.stdout.write(`   ctx- | ${prev}\n`)
    process.stdout.write(`   > ${cur}\n`)
    if (next) process.stdout.write(`   ctx+ | ${next}\n`)
    process.stdout.write('\n')
  }
}
