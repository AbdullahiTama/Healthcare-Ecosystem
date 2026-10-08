// @vitest-environment node
//
// A webhook signature covers the exact bytes the sender transmitted. The router consumes the request stream (body
// parser off) and rebuilds req.body from JSON, which would destroy those bytes, so it must also keep them as
// req.rawBody. Without that the Resend webhook can never verify. This sends a signed delivery through the REAL router.
import { createHmac } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { describe, it, expect, beforeAll, vi } from 'vitest'

const h = vi.hoisted(() => ({ apply: vi.fn(async () => ({ status: 'applied' })) }))

// Keep the real signature verifier; stub only what would touch the network or the database.
vi.mock('@care-ecosystem/shared-email', async (importOriginal) => ({
  ...(await importOriginal()),
  EmailService: class { async drain() { return { processed: 0 } } },
  getEmailService: () => ({ drain: async () => ({ processed: 0 }) }),
  sendEmail: async () => ({ success: true, data: { id: 'stub' } }),
  applyResendEvent: (...a) => h.apply(...a),
}))

const KEY = Buffer.from('a-very-secret-signing-key-0123456')

function streamed(method, url, headers, body) {
  const req = Object.assign(new EventEmitter(), { method, url, headers })
  setImmediate(() => { if (body !== undefined) req.emit('data', Buffer.from(body)); req.emit('end') })
  return req
}
function makeRes() {
  return { statusCode: 200, body: null, headersSent: false, status(c) { this.statusCode = c; return this }, json(p) { this.body = p; this.headersSent = true; return this } }
}

describe('router keeps the raw request bytes for webhook verification', () => {
  let handler
  beforeAll(async () => {
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key'
    process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_key'
    process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret'
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${KEY.toString('base64')}`
    handler = (await import('../router.js')).default
  })

  it('verifies and applies a signed Resend delivery whose bytes differ from JSON.stringify(JSON.parse(body))', async () => {
    h.apply.mockClear()
    const raw = '{ "type": "email.bounced",   "data": { "email_id": "prov-1" } }'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = 'v1,' + createHmac('sha256', KEY).update(`msg_9.${timestamp}.${raw}`).digest('base64')
    const res = makeRes()

    await handler(streamed('POST', '/api/webhooks/resend', { 'svix-id': 'msg_9', 'svix-timestamp': timestamp, 'svix-signature': signature }, raw), res)

    expect(res.statusCode).toBe(200)
    expect(h.apply).toHaveBeenCalledTimes(1)
    expect(h.apply.mock.calls[0][1]).toEqual({ svixId: 'msg_9', event: JSON.parse(raw) })
  })

  it('rejects the same delivery when the body was altered in transit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.apply.mockClear()
    const raw = '{ "type": "email.bounced",   "data": { "email_id": "prov-1" } }'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = 'v1,' + createHmac('sha256', KEY).update(`msg_9.${timestamp}.${raw}`).digest('base64')
    const res = makeRes()

    await handler(streamed('POST', '/api/webhooks/resend', { 'svix-id': 'msg_9', 'svix-timestamp': timestamp, 'svix-signature': signature }, raw.replace('prov-1', 'prov-2')), res)

    expect(res.statusCode).toBe(401)
    expect(h.apply).not.toHaveBeenCalled()
  })
})
