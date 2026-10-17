// Report every occurrence of the em dash used as a JSX/JS value fallback, with
// its surrounding context, so a bulk edit can be reviewed before it is applied.
//
//   node scripts/inspect-dash-fallbacks.mjs <file...>
import { readFileSync } from 'node:fs'

const DASH = '\u2014'
for (const f of process.argv.slice(2)) {
  const src = readFileSync(f, 'utf8').split(/\r?\n/)
  src.forEach((line, i) => {
    if (!line.includes(DASH)) return
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return          // comments are not copy
    process.stdout.write(`${f}:${i + 1}\n   ${line.trim()}\n`)
  })
}
