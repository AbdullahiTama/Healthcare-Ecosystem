// POST /api/webhooks/resend receives bounce / complaint / delivery events from Resend. The old handler checked an
// x-resend-signature header (Resend sends svix-* headers), HMAC'd JSON.stringify(req.body) (the signature covers the raw
// bytes), read data.message.id (the field is data.email_id) and matched it to the outbox's own id (the provider's id is
// outbox.provider_message_id), and referenced an undefined `res` when the secret was missing. Nothing a real delivery
// sent could ever be accepted or applied.
import { createHmac } from 'node:crypto'
import { EventEmitter } from 'node:events'

const h = vi.hoisted(() => ({ apply: vi.fn(), client: { from: () => ({}) } }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@care-ecosystem/shared-email', async (importOriginal) => ({
  ...(await importOriginal()),
  applyResendEvent: (...a) => h.apply(...a),
}))

import handler from '../webhooks/resend.js'

const KEY = Buffer.from('a-very-secret-signing-key-0123456')
const SECRET = `whsec_${KEY.toString('base64')}`

function signed(body, { id = 'msg_1', timestamp = String(Math.floor(Date.now() / 1000)), key = KEY } = {}) {
  const signature = 'v1,' + createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
  return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature }
}

async function call({ method = 'POST', headers = {}, rawBody, body, stream } = {}) {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(v) { this.body = v; return this } }
  let req = { method, headers, body, rawBody }
  if (stream !== undefined) {
    // no router in front: the handler must read the body itself
    req = Object.assign(new EventEmitter(), { method, headers, body: undefined })
    setImmediate(() => { req.emit('data', Buffer.from(stream)); req.emit('end') })
  }
  await handler(req, res)
  return res
}

const EVENT = { type: 'email.bounced', created_at: '2026-10-04T11:59:00.000Z', data: { email_id: 'prov-1', to: ['someone@example.com'] } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET)
  h.apply.mockResolvedValue({ status: 'applied' })
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/webhooks/resend', () => {
  it('rejects anything but POST', async () => {
    const res = await call({ method: 'GET' })

    expect(res.statusCode).toBe(405)
  })

  it('fails closed with a 500, not a crash, when the webhook secret is not configured', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = JSON.stringify(EVENT)

    const res = await call({ headers: signed(raw), rawBody: Buffer.from(raw) })

    expect(res.statusCode).toBe(500)
    expect(h.apply).not.toHaveBeenCalled()
  })

  it('rejects a delivery that carries only the old x-resend-signature header', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = JSON.stringify(EVENT)

    const res = await call({ headers: { 'x-resend-signature': createHmac('sha256', SECRET).update(raw).digest('hex') }, rawBody: Buffer.from(raw) })

    expect(res.statusCode).toBe(401)
    expect(h.apply).not.toHaveBeenCalled()
  })

  it('rejects a body that was altered after signing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = JSON.stringify(EVENT)

    const res = await call({ headers: signed(raw), rawBody: Buffer.from(raw.replace('prov-1', 'prov-9')) })

    expect(res.statusCode).toBe(401)
    expect(h.apply).not.toHaveBeenCalled()
  })

  it('verifies against the exact bytes received, not a re-serialisation of the parsed body', async () => {
    // Spacing that JSON.stringify(JSON.parse(raw)) would not reproduce.
    const raw = '{ "type": "email.bounced",   "data": { "email_id": "prov-1" } }'

    const res = await call({ headers: signed(raw), rawBody: Buffer.from(raw), body: JSON.parse(raw) })

    expect(res.statusCode).toBe(200)
    expect(h.apply).toHaveBeenCalledWith(h.client, { svixId: 'msg_1', event: JSON.parse(raw) })
  })

  it('reads the body itself when no router has kept it', async () => {
    const raw = JSON.stringify(EVENT)

    const res = await call({ headers: signed(raw), stream: raw })

    expect(res.statusCode).toBe(200)
    expect(h.apply).toHaveBeenCalledWith(h.client, { svixId: 'msg_1', event: EVENT })
  })

  it('answers 400 for a correctly signed body that is not JSON', async () => {
    const raw = 'not json'

    const res = await call({ headers: signed(raw), rawBody: Buffer.from(raw) })

    expect(res.statusCode).toBe(400)
    expect(h.apply).not.toHaveBeenCalled()
  })

  it('answers 500 when the event cannot be recorded, so Resend redelivers it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.apply.mockRejectedValue(new Error('db down'))
    const raw = JSON.stringify(EVENT)

    const res = await call({ headers: signed(raw), rawBody: Buffer.from(raw) })

    expect(res.statusCode).toBe(500)
  })

  it('acknowledges a duplicate delivery with 200', async () => {
    h.apply.mockResolvedValue({ status: 'duplicate' })
    const raw = JSON.stringify(EVENT)

    const res = await call({ headers: signed(raw), rawBody: Buffer.from(raw) })

    expect(res.statusCode).toBe(200)
  })
})
