// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// A serverless function is frozen the moment it responds, so `flushOutbox().catch(...)` (start the flush, do not wait) never ran:
// confirmations, withdrawal codes and refund notices sat in the outbox until the next cron, once a day in production. About 19
// handlers did it. This test fails the build if that shape comes back: every flush must be awaited (or handed on as a promise).
const API = resolve(process.cwd(), 'api')

function sources(dir = API) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sources(path)
    return /\.js$/.test(entry.name) && !/\.test\.js$/.test(entry.name) ? [path] : []
  })
}
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')

// What is allowed in front of a call to a flush: awaited, returned/handed on as a promise, or its own definition.
const HANDLED = /(\bawait|=>|\breturn|\bfunction)\s*(\w+\.)?$/
function unawaitedFlushes(text) {
  const code = strip(text)
  const found = []
  for (const match of code.matchAll(/\b(flushOutbox|processBatch)\s*\(/g)) {
    const before = code.slice(Math.max(0, match.index - 60), match.index).split('\n').pop()
    if (!HANDLED.test(before)) found.push(`${before}${match[0]}`.trim())
  }
  return found
}

describe('the email outbox flush is never fire-and-forget (CareHub)', () => {
  const files = sources()

  it('scans the handlers (so a moved directory cannot make this pass vacuously)', () => {
    expect(files.length).toBeGreaterThan(20)
    const awaited = files.reduce((n, f) => n + (strip(readFileSync(f, 'utf8')).match(/await flushOutbox\(\)/g) || []).length, 0)
    expect(awaited).toBeGreaterThanOrEqual(7)
  })

  it('recognises the pattern it forbids', () => {
    expect(unawaitedFlushes('flushOutbox().catch((err) => console.error(err))')).toHaveLength(1)
    expect(unawaitedFlushes('    emailService.processBatch().catch(() => {})')).toHaveLength(1)
    expect(unawaitedFlushes('    void flushOutbox()')).toHaveLength(1)
    expect(unawaitedFlushes('    await flushOutbox()\n    const r = await emailService.processBatch()\n    flush: () => processBatch()')).toEqual([])
    expect(unawaitedFlushes('// flushOutbox().catch(x)\n/* processBatch() */')).toEqual([])
  })

  it.each(files.map((f) => [relative(API, f), f]))('%s starts no flush it does not wait for', (_name, file) => {
    expect(unawaitedFlushes(readFileSync(file, 'utf8'))).toEqual([])
  })
})
