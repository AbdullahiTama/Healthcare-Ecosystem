// Phase 16 A3: CareHub mirror of the withdrawal-PIN email OTP endpoint (owner session via verifyBusiness).
const h = vi.hoisted(() => {
  const s = {
    auth: { business: { id: 'biz-1' }, user: { id: 'user-1', email: 'o@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' } },
    otpResult: { code: '123456' },
  }
  return s
})

vi.mock('../_lib/supabase.js', () => ({ supabase: {} }))
vi.mock('../_lib/verifyBusiness.js', () => ({ verifyBusiness: vi.fn(async () => h.auth) }))
vi.mock('../_lib/emailOtp.js', () => ({ requestWithdrawalOtp: vi.fn(async () => h.otpResult) }))
vi.mock('../../src/lib/emailService.js', () => ({ emailService: { enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) } }))

import handler from '../_handlers/withdrawal-pin-otp.js'
import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { requestWithdrawalOtp } from '../_lib/emailOtp.js'
import { emailService } from '../../src/lib/emailService.js'

function call(method = 'POST', body = {}) {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  return handler({ method, body, headers: {} }, res).then(() => res)
}

beforeEach(() => {
  verifyBusiness.mockClear()
  requestWithdrawalOtp.mockClear()
  emailService.enqueue.mockClear()
  emailService.processBatch.mockClear()
  h.auth = { business: { id: 'biz-1' }, user: { id: 'user-1', email: 'o@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' } }
  h.otpResult = { code: '123456' }
})

describe('/api/withdrawal-pin-otp (CareHub)', () => {
  it('rejects non-POST and unauthenticated callers before any work', async () => {
    expect((await call('GET')).statusCode).toBe(405)
    h.auth = { error: 'not_logged_in' }
    expect((await call()).statusCode).toBe(401)
    expect(requestWithdrawalOtp).not.toHaveBeenCalled()
  })

  it('demands a confirmed email', async () => {
    h.auth.user.email_confirmed_at = null
    expect((await call()).statusCode).toBe(403)
    expect(emailService.enqueue).not.toHaveBeenCalled()
  })

  it('emails the code and never echoes it in the response', async () => {
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(JSON.stringify(res.body)).not.toContain('123456')
    expect(emailService.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: 'withdrawal_pin_otp',
      toEmail: 'o@x.com',
      payload: expect.objectContaining({ code: '123456', minutes: 10 }),
    }))
    expect(emailService.processBatch).toHaveBeenCalledTimes(1)
  })

  it('surfaces the rate limit as 429 and sends nothing', async () => {
    h.otpResult = { error: 'Too many codes requested. Try again later.', status: 429 }
    const res = await call()
    expect(res.statusCode).toBe(429)
    expect(emailService.enqueue).not.toHaveBeenCalled()
  })

  it('a failed enqueue is a 500, not a silent success', async () => {
    emailService.enqueue.mockImplementationOnce(async () => { throw new Error('outbox down') })
    expect((await call()).statusCode).toBe(500)
  })

  it('defaults the action to set_pin when the client sends none', async () => {
    const res = await call()
    expect(res.statusCode).toBe(200)
    expect(emailService.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ action: 'set_pin' }),
    }))
  })

  it("carries action 'withdrawal' through to the outbox payload", async () => {
    const res = await call('POST', { action: 'withdrawal' })
    expect(res.statusCode).toBe(200)
    expect(emailService.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: 'withdrawal_pin_otp',
      payload: expect.objectContaining({ code: '123456', action: 'withdrawal' }),
    }))
  })

  it('rejects an unknown action before any work', async () => {
    const res = await call('POST', { action: 'transfer_everything' })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/action/)
    expect(requestWithdrawalOtp).not.toHaveBeenCalled()
    expect(emailService.enqueue).not.toHaveBeenCalled()
  })
})
