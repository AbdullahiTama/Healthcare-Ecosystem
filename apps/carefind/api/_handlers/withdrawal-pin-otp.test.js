// Phase 16 A2: POST /api/withdrawal-pin-otp emails a 6-digit code for arming the withdrawal PIN.
// The code must never appear in the response, the rate limit must surface as 429, and a failed
// enqueue must not look like success.
const h = vi.hoisted(() => {
  const s = {
    user: { id: 'user-12345678', email: 'u@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', user_metadata: { full_name: 'Ada Obi' } },
    otpResult: { code: '654321' },
  }
  return s
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => h.user }))
vi.mock('../_lib/emailOtp.js', () => ({ requestWithdrawalOtp: vi.fn(async () => h.otpResult) }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))

import handler from './withdrawal-pin-otp.js'
import { requestWithdrawalOtp } from '../_lib/emailOtp.js'
import { enqueue, processBatch } from '../_lib/emailService.js'

function call(method = 'POST', body = {}) {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  return handler({ method, body, headers: {} }, res).then(() => res)
}

beforeEach(() => {
  requestWithdrawalOtp.mockClear()
  enqueue.mockClear()
  processBatch.mockClear()
  h.user = { id: 'user-12345678', email: 'u@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', user_metadata: { full_name: 'Ada Obi' } }
  h.otpResult = { code: '654321' }
})

describe('/api/withdrawal-pin-otp', () => {
  it('rejects non-POST and signed-out callers before any work', async () => {
    expect((await call('GET')).statusCode).toBe(405)
    h.user = null
    expect((await call()).statusCode).toBe(401)
    expect(requestWithdrawalOtp).not.toHaveBeenCalled()
  })

  it('demands a confirmed email', async () => {
    h.user.email_confirmed_at = null
    const res = await call()
    expect(res.statusCode).toBe(403)
    expect(requestWithdrawalOtp).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('emails the code and never echoes it in the response', async () => {
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(JSON.stringify(res.body)).not.toContain('654321')
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: 'withdrawal_pin_otp',
      toEmail: 'u@example.com',
      payload: expect.objectContaining({ code: '654321', minutes: 10 }),
    }))
    expect(processBatch).toHaveBeenCalledTimes(1)
  })

  it('surfaces the rate limit as 429 and sends nothing', async () => {
    h.otpResult = { error: 'Too many codes requested. Try again later.', status: 429 }
    const res = await call()
    expect(res.statusCode).toBe(429)
    expect(res.body.error).toContain('Too many codes')
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('a failed enqueue is a 500, not a silent success', async () => {
    enqueue.mockImplementationOnce(async () => { throw new Error('outbox down') })
    const res = await call()
    expect(res.statusCode).toBe(500)
  })

  it('defaults the action to set_pin when the client sends none', async () => {
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ action: 'set_pin' }),
    }))
  })

  it("carries action 'withdrawal' through to the outbox payload", async () => {
    const res = await call('POST', { action: 'withdrawal' })
    expect(res.statusCode).toBe(200)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: 'withdrawal_pin_otp',
      payload: expect.objectContaining({ code: '654321', action: 'withdrawal' }),
    }))
  })

  it('rejects an unknown action before any work', async () => {
    const res = await call('POST', { action: 'transfer_everything' })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/action/)
    expect(requestWithdrawalOtp).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })
})
