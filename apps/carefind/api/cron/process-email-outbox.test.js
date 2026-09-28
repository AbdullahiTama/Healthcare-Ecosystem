import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regression test for an unauthenticated drain. The guard used to read
// `if (token && process.env.CRON_SECRET)`, so a request with no Authorization
// header skipped the check entirely and ran processBatch(). Any caller could
// force the outbox to dispatch. Batch 2 raised the schedule to every minute,
// which would have turned a daily unauthenticated trigger into a standing one,
// so the guard now fails closed. These cases are what stop that coming back.
const processBatch = vi.hoisted(() => vi.fn(async () => ({ processed: 0, sent: 0, failed: 0 })))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
vi.mock('@care-ecosystem/shared-email', () => ({ EmailService: class { processBatch = processBatch } }))

const { default: handler } = await import('./process-email-outbox.js')

function res() {
  const r = { statusCode: null, body: null }
  r.status = (code) => { r.statusCode = code; return r }
  r.json = (payload) => { r.body = payload; return r }
  return r
}

const ENV = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key', CRON_SECRET: 'the-secret' }

beforeEach(() => {
  processBatch.mockClear()
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v
})

afterEach(() => { delete process.env.CRON_SECRET })

describe('process-email-outbox authentication', () => {
  it('refuses a request with no Authorization header instead of draining the outbox', async () => {
    const r = res()
    await handler({ method: 'GET', headers: {} }, r)

    expect(r.statusCode).toBe(401)
    // The whole defect: the old guard let this through and sent the batch.
    expect(processBatch).not.toHaveBeenCalled()
  })

  it('refuses a wrong bearer token', async () => {
    const r = res()
    await handler({ method: 'GET', headers: { authorization: 'Bearer wrong' } }, r)

    expect(r.statusCode).toBe(401)
    expect(processBatch).not.toHaveBeenCalled()
  })

  it('refuses a header whose scheme is not Bearer, and an empty one', async () => {
    for (const authorization of ['Basic the-secret', 'Bearer', '']) {
      processBatch.mockClear()
      const r = res()
      await handler({ method: 'GET', headers: { authorization } }, r)

      expect(r.statusCode, `authorization=${JSON.stringify(authorization)}`).toBe(401)
      expect(processBatch).not.toHaveBeenCalled()
    }
  })

  it('drains for the correct bearer token, with or without the Bearer prefix', async () => {
    for (const header of ['Bearer the-secret', 'the-secret']) {
      processBatch.mockClear()
      const r = res()
      await handler({ method: 'GET', headers: { authorization: header } }, r)

      expect(r.statusCode).toBe(200)
      expect(processBatch).toHaveBeenCalledTimes(1)
    }
  })

  it('refuses to run when CRON_SECRET is unset, rather than defaulting to open', async () => {
    delete process.env.CRON_SECRET
    const r = res()
    await handler({ method: 'GET', headers: { authorization: 'Bearer anything' } }, r)

    expect(r.statusCode).toBe(500)
    expect(processBatch).not.toHaveBeenCalled()
  })

  it('rejects a method other than GET or POST', async () => {
    const r = res()
    await handler({ method: 'DELETE', headers: { authorization: 'Bearer the-secret' } }, r)

    expect(r.statusCode).toBe(405)
    expect(processBatch).not.toHaveBeenCalled()
  })
})
