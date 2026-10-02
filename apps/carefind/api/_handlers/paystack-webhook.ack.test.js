// Financial audit H-3 / M-12: the webhook must finish settling BEFORE it acknowledges.
// Vercel can freeze a serverless function once the response is sent, so work done after
// res.json() may never run, and Paystack - told 200 - would never redeliver the event.
import crypto from 'crypto'
import { EventEmitter } from 'events'

const h = vi.hoisted(() => ({ creditTopup: vi.fn(), db: null }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (...a) => h.db.from(...a), rpc: (...a) => h.db.rpc(...a) }) }))
vi.mock('../_lib/paystack.js', () => ({ getPaystackSecretKey: () => 'sk_test_secret' }))
vi.mock('../_lib/paystackCredit.js', () => ({ creditTopup: h.creditTopup }))
vi.mock('../_lib/consultationSettle.js', () => ({ settleConsultationPayment: vi.fn() }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))

import handler from './paystack-webhook.js'

function request(body, { sign = true, signature } = {}) {
  const raw = Buffer.from(JSON.stringify(body))
  const req = new EventEmitter()
  req.method = 'POST'
  req.headers = { 'x-paystack-signature': signature ?? (sign ? crypto.createHmac('sha512', 'sk_test_secret').update(raw).digest('hex') : 'bad') }
  setImmediate(() => { req.emit('data', raw); req.emit('end') })
  return req
}
function response() {
  const r = { statusCode: 0, body: null, sentAt: null }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; r.sentAt = Date.now(); return r }
  return r
}

const topup = { event: 'charge.success', data: { reference: 'ref-1', amount: 100000, metadata: { user_id: 'u1', coins: '5' } } }

beforeEach(() => {
  h.creditTopup.mockReset()
  h.db = { from: () => { throw new Error('db down') }, rpc: async () => ({ data: null, error: null }) }
})

describe('paystack webhook acknowledgement', () => {
  it('does not acknowledge until the event has been settled', async () => {
    let release
    h.creditTopup.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ credited: true }) }))
    const res = response()
    const pending = handler(request(topup), res)
    await new Promise((r) => setTimeout(r, 30))
    expect(h.creditTopup).toHaveBeenCalled()
    expect(res.body).toBeNull() // still settling: nothing sent yet
    release()
    await pending
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ received: true })
  })

  it('a processing failure answers 500 so Paystack redelivers the event', async () => {
    const res = response()
    await handler(request({ event: 'transfer.success', data: { reference: 'cf_wd_1' } }), res)
    expect(res.statusCode).toBe(500)
  })

  it('rejects an invalid signature without processing anything', async () => {
    const res = response()
    await handler(request(topup, { sign: false }), res)
    expect(res.statusCode).toBe(401)
    expect(h.creditTopup).not.toHaveBeenCalled()
  })
})
