// CareHub's POST /api/webhooks/resend had the same defects as CareFind's copy: it checked an x-resend-signature header
// (Resend sends svix-* headers), HMAC'd JSON.stringify(req.body) instead of the raw bytes, read data.message.id (the field
// is data.email_id), matched it to the outbox's own id instead of provider_message_id, and referenced an undefined `res`
// when the secret was missing. It now verifies the Svix signature over req.rawBody (kept by the router) and applies the
// event through the shared, idempotent applyResendEvent.
import { createHmac } from 'node:crypto'

const h = vi.hoisted(() => ({ apply: vi.fn(), client: { from: () => ({}) } }))

vi.mock('../_lib/supabase.js', () => ({ supabase: h.client }))
vi.mock('@care-ecosystem/shared-email', async (importOriginal) => ({
  ...(await importOriginal()),
  applyResendEvent: (...a) => h.apply(...a),
}))

import handler from '../_handlers/webhooks-resend.js'

const KEY = Buffer.from('a-very-secret-signing-key-0123456')
const SECRET = `whsec_${KEY.toString('base64')}`

function signed(body, { id = 'msg_1', timestamp = String(Math.floor(Date.now() / 1000)), key = KEY } = {}) {
  const signature = 'v1,' + createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
  return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature }
}

async function call({ method = 'POST', headers = {}, rawBody, body } = {}) {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(v) { this.body = v; return this } }
  await handler({ method, headers, body, rawBody }, res)
  return res
}

const EVENT = { type: 'email.bounced', created_at: '2026-10-04T11:59:00.000Z', data: { email_id: 'prov-1', to: ['someone@example.com'] } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET)
  h.apply.mockResolvedValue({ status: 'applied' })
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/webhooks/resend (CareHub)', () => {
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

  it('rejects when the router did not keep the raw bytes, because a re-serialised body cannot verify', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = '{ "type": "email.bounced",   "data": { "email_id": "prov-1" } }'

    const res = await call({ headers: signed(raw), body: JSON.parse(raw) })

    expect(res.statusCode).toBe(401)
  })

  it('verifies against the exact bytes received, not a re-serialisation of the parsed body', async () => {
    const raw = '{ "type": "email.bounced",   "data": { "email_id": "prov-1" } }'

    const res = await call({ headers: signed(raw), rawBody: Buffer.from(raw), body: JSON.parse(raw) })

    expect(res.statusCode).toBe(200)
    expect(h.apply).toHaveBeenCalledWith(h.client, { svixId: 'msg_1', event: JSON.parse(raw) })
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
