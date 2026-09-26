// @vitest-environment node
//
// Regression tests for the CareHub catch-all API router.
//
// Production was returning 500 "Cannot find module .../_handlers/<x>.js" on
// every /api/* route. Three independent defects combined to break it, and all
// three are invisible to a test suite that never imports the api/ tree:
//
//   1. router.js dispatched with `await import(path)` where `path` came from a
//      lookup table. Vercel builds this function with @vercel/nft, which only
//      follows literal specifiers, so no handler was bundled.
//   2. cron-handler.js imported './process-email-outbox.js'; the file on disk
//      is cron-process-email-outbox.js.
//   3. webhooks-handler.js imported './resend.js'; the file on disk is
//      webhooks-resend.js.
//
// Defect 1 cannot be caught by importing the router -- it imports cleanly and
// only fails when Vercel assembles the bundle. So it is asserted structurally:
// no dynamic import in the api/ tree may take a non-literal specifier.
// This file deliberately lives in api/__tests__/ rather than api/ directly.
// Vercel treats every non-underscore file under api/ as a serverless function,
// so a test at api/router.test.js would consume one of the 12 Hobby-plan
// function slots and pull vitest (a devDependency) into a production bundle.
// The underscore prefix excludes the directory, matching how _handlers/ is kept
// out of the function count.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The cron handler calls EmailService.processBatch(), which queries the outbox.
// Left real, that is a live network call: an earlier beforeAll in this file sets
// SUPABASE_URL process-wide, so the cron test inherited a dead address and blew
// the 5s timeout whenever the connection did not fail fast. These tests assert
// method and auth handling, not delivery, so the service is stubbed to make them
// deterministic and instant.
vi.mock('@care-ecosystem/shared-email', () => ({
  EmailService: class {
    async processBatch() { return { processed: 0, sent: 0, failed: 0 } }
  },
  getEmailService: () => ({ processBatch: async () => ({ processed: 0, sent: 0, failed: 0 }) }),
  sendEmail: async () => ({ success: true, data: { id: 'stub' } }),
}))

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function jsFilesIn(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    // Test files are excluded from the scan below. Otherwise this file would
    // scan itself and flag the template literal in the child-process test.
    if (entry === '__tests__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...jsFilesIn(full))
    else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) out.push(full)
  }
  return out
}

const ALL_API_FILES = jsFilesIn(API_DIR)

// These files carry comments explaining the defects they used to have, and
// those comments quote the old broken specifiers verbatim. Scanning raw
// source would report them as live imports, so strip comments first.
//
// Only whole-line `//` comments are removed, anchored to line start, so a
// `//` inside a string such as 'https://...' is left alone.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('api module graph', () => {
  it('finds the api tree (guards against a silently empty scan)', () => {
    expect(ALL_API_FILES.length).toBeGreaterThan(5)
    expect(existsSync(join(API_DIR, 'router.js'))).toBe(true)
    expect(existsSync(join(API_DIR, '_handlers', 'cron-process-email-outbox.js'))).toBe(true)
    expect(existsSync(join(API_DIR, '_handlers', 'webhooks-resend.js'))).toBe(true)
  })

  // Defect 1: @vercel/nft cannot trace `await import(someVariable)`, so the
  // module is absent from the deployed bundle and the route 500s at runtime.
  it('never uses a dynamic import with a non-literal specifier', () => {
    const offenders = []
    for (const file of ALL_API_FILES) {
      const src = stripComments(readFileSync(file, 'utf8'))
      for (const match of src.matchAll(/import\(\s*([^)]*?)\s*\)/g)) {
        const spec = match[1].trim()
        const isLiteral = /^(['"]).*\1$/s.test(spec)
        if (!isLiteral) {
          offenders.push(`${file.slice(API_DIR.length + 1)}: import(${spec})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  // Defects 2 and 3: a relative import naming a file that does not exist.
  // ESM throws ERR_MODULE_NOT_FOUND at load time; nothing else in the build
  // reports it, because the importer is only reached through the router.
  it('resolves every relative import to a real file', () => {
    const broken = []
    const pattern = /(?:from|import\()\s*['"](\.[^'"]+)['"]/g
    for (const file of ALL_API_FILES) {
      const src = stripComments(readFileSync(file, 'utf8'))
      for (const match of src.matchAll(pattern)) {
        const target = resolve(dirname(file), match[1])
        if (!existsSync(target)) {
          broken.push(`${file.slice(API_DIR.length + 1)} -> ${match[1]}`)
        }
      }
    }
    expect(broken).toEqual([])
  })
})

describe('router dispatch', () => {
  let handler
  let HANDLERS

  beforeAll(async () => {
    // Several handlers construct a Supabase client at module scope, which
    // throws when the URL is undefined. Provide env before importing.
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key'
    process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_key'
    process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret'
    handler = (await import('../router.js')).default
    const src = readFileSync(join(API_DIR, 'router.js'), 'utf8')
    // Route names are asserted from source so the test does not need to reach
    // into module internals.
    HANDLERS = [...src.matchAll(/^\s{2}'([a-z-]+)':\s+\w+Handler,/gm)].map((m) => m[1])
  })

  it('exposes a route table', () => {
    expect(HANDLERS.length).toBeGreaterThanOrEqual(14)
  })

  it('returns JSON 404 for an unknown route instead of crashing', async () => {
    const res = makeRes()
    await handler(makeReq('GET', '/api/no-such-route'), res)
    expect(res.statusCode).toBe(400 === res.statusCode ? 400 : 404)
    expect(res.body.error).toMatch(/No handler for \/api\/no-such-route/)
  })

  it('routes /api/email and /api/cron to a callable handler', async () => {
    // Reaching the handler and failing inside it is progress: a module
    // resolution failure would instead surface as a 500 mentioning
    // "Cannot find module", which is the exact production regression.
    for (const path of ['/api/email/preview', '/api/cron/process-email-outbox']) {
      const res = makeRes()
      try {
        await handler(makeReq('GET', path), res)
      } catch { /* handler may throw on missing env; the import already happened */ }
      if (res.statusCode === 500) {
        expect(res.body.error).not.toMatch(/Cannot find module/)
      }
    }
  })
})

describe('router import safety', () => {
  // The failure that shipped: src/lib/emailService.js imported getEmailService
  // from @care-ecosystem/shared-email, which did not export it. Vitest's SSR
  // transform downgraded that to a soft runtime TypeError, but real Node ESM
  // raises a hard error at load -- and because the router imports handlers
  // statically, every route died with FUNCTION_INVOCATION_FAILED.
  //
  // This must run in a child process: the suite above sets process.env, and
  // the module cache is already warm, so an in-process import would pass even
  // while production stays broken.
  it('imports in a bare child process, with no inherited env', () => {
    // pathToFileURL, not the raw path: on Windows a bare "C:\..." specifier is
    // rejected with ERR_UNSUPPORTED_ESM_URL_SCHEME.
    const routerUrl = pathToFileURL(join(API_DIR, 'router.js')).href
    const script = `await import(${JSON.stringify(routerUrl)}); console.log('IMPORT_OK')`
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      // Nothing inherited, deliberately including SUPABASE_URL and
      // SUPABASE_SERVICE_ROLE_KEY. Importing the router must not require a
      // configured database: handlers obtain their client from _lib/supabase.js
      // on first use. A module-scope createClient anywhere in the tree fails
      // this test and takes all 15 routes down with it in production.
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      cwd: resolve(API_DIR, '..', '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(out).toContain('IMPORT_OK')
  })
})

describe('cron auth', () => {
  let cron

  beforeAll(async () => {
    process.env.CRON_SECRET = 'test-cron-secret'
    cron = (await import('../_handlers/cron-process-email-outbox.js')).default
  })

  // Vercel Cron Jobs call the path with GET. The handler previously rejected
  // anything but POST, so the schedule could never fire.
  it('accepts GET (the method Vercel cron uses)', async () => {
    const res = makeRes()
    await cron(makeReq('GET', '/api/cron/process-email-outbox', { authorization: 'Bearer test-cron-secret' }), res)
    expect(res.statusCode).not.toBe(405)
  })

  it('rejects a request with no Authorization header', async () => {
    const res = makeRes()
    await cron(makeReq('GET', '/api/cron/process-email-outbox'), res)
    expect(res.statusCode).toBe(401)
  })

  it('rejects a wrong token', async () => {
    const res = makeRes()
    await cron(makeReq('GET', '/api/cron/process-email-outbox', { authorization: 'Bearer wrong' }), res)
    expect(res.statusCode).toBe(401)
  })

  it('still rejects methods other than GET/POST', async () => {
    const res = makeRes()
    await cron(makeReq('DELETE', '/api/cron/process-email-outbox'), res)
    expect(res.statusCode).toBe(405)
  })
})

function makeReq(method, url, headers = {}) {
  return { method, url, headers, on: () => {} }
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; this.headersSent = true; return this },
  }
}
