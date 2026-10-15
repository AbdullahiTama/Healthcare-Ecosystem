import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Feed/ADR separation pin: the confidential safety-report module must never
// touch the public social-feed surfaces. Mirrors the mainSourceOrder.test.js
// precedent (static source scan, no renderer needed).
const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.resolve(here, '..', '..')

function moduleFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out = moduleFiles(full, out)
    else if (/\.(js|jsx)$/.test(entry) && !/\.test\.(js|jsx)$/.test(entry)) out.push(full)
  }
  return out
}

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const files = moduleFiles(here)

describe('safety-report feed separation', () => {
  it('touches the confidential ADR tables, proving the scan is non-vacuous', () => {
    const all = files.map((f) => readFileSync(f, 'utf8')).join('\n')
    expect(all).toContain('adr_reports')
    expect(all).toContain('submit_adr_public_report')
  })

  it('contains no public-feed table access or composer calls', () => {
    const violations = []
    for (const f of files) {
      const src = stripComments(readFileSync(f, 'utf8'))
      for (const pattern of [/\.from\(\s*['"]posts['"]\s*\)/, /postRepository/, /startPost\(/, /createPost\(/]) {
        if (pattern.test(src)) violations.push(`${path.basename(f)}: ${pattern}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('is reachable from the Create selector and the router', () => {
    const feed = readFileSync(path.join(srcRoot, 'modules', 'social-feed', 'Feed.jsx'), 'utf8')
    expect(feed).toContain('Safety Report')
    expect(feed).toContain('/report-side-effect')
    const main = readFileSync(path.join(srcRoot, 'main.jsx'), 'utf8')
    expect(main).toContain('report-side-effect')
    expect(main).toContain('SafetyReportPage')
  })
})
