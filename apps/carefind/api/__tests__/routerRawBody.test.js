// A webhook signature covers the exact bytes the sender transmitted. The router consumes the request stream (body
// parser off) and rebuilds req.body from JSON, which would destroy those bytes, so it must also keep them as
// req.rawBody (only paystack-webhook gets the untouched stream). Without that the Resend webhook can never verify.
// This sends a signed delivery through the REAL router and the email dispatcher to the Resend handler.
import { createHmac } from 'node:crypto'
import { Readable } from 'node:stream'

const h = vi.hoisted(() => ({ apply: vi.fn(async () => ({ status: 'applied' })) }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => ({}), auth: {} }) }))
// Keep the real signature verifier; stub only what would touch the network or the database.
vi.mock('@care-ecosystem/shared-email', async (importOriginal) => ({
  ...(await importOriginal()),
  applyResendEvent: (...a) => h.apply(...a),
}))

const KEY = Buffer.from('a-very-secret-signing-key-0123456')

// A Readable buffers the body until the router starts consuming it, like a real HTTP request: the router awaits a
// dynamic import before it reads, so a stream that emitted immediately would lose its data.
function streamed(method, url, headers, body) {
  return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(body)]), { method, url, headers })
}
function makeRes() {
  return { statusCode: 200, body: null, headersSent: false, status(c) { this.statusCode = c; return this }, json(p) { this.body = p; this.headersSent = true; return this } }
}
function signedFor(raw, id = 'msg_9') {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = 'v1,' + createHmac('sha256', KEY).update(`${id}.${timestamp}.${raw}`).digest('base64')
  return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature }
}

describe('router keeps the raw request bytes for webhook verification', () => {
  let handler
  beforeAll(async () => {
    vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
    vi.stubEnv('RESEND_WEBHOOK_SECRET', `whsec_${KEY.toString('base64')}`)
    // Importing the router loads every handler; that is slow on a cold run, so give it a realistic budget.
    handler = (await import('../router.js')).default
  }, 120000)
  afterAll(() => vi.unstubAllEnvs())

  it('verifies and applies a signed Resend delivery whose bytes differ from JSON.stringify(JSON.parse(body))', async () => {
    h.apply.mockClear()
    const raw = '{ "type": "email.bounced",   "data": { "email_id": "prov-1" } }'
    const res = makeRes()

    await handler(streamed('POST', '/api/webhooks/resend', signedFor(raw), raw), res)

    expect(res.statusCode).toBe(200)
    expect(h.apply).toHaveBeenCalledTimes(1)
    expect(h.apply.mock.calls[0][1]).toEqual({ svixId: 'msg_9', event: JSON.parse(raw) })
  })

  it('rejects the same delivery when the body was altered in transit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.apply.mockClear()
    const raw = '{ "type": "email.bounced",   "data": { "email_id": "prov-1" } }'
    const res = makeRes()

    await handler(streamed('POST', '/api/webhooks/resend', signedFor(raw), raw.replace('prov-1', 'prov-2')), res)

    expect(res.statusCode).toBe(401)
    expect(h.apply).not.toHaveBeenCalled()
  })
})
