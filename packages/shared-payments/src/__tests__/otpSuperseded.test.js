import { describe, it, expect, vi } from 'vitest'
import { checkOtp } from '../otp.js'
describe('checkOtp superseded', () => {
  it('maps superseded without burning and logs it', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: 'superseded', error: null }) }
    process.env.OTP_HMAC_SECRET = 'test-secret'
    const r = await (await import('../otp.js')).checkOtp({ supabase, userId: 'u-1', purpose: 'withdrawal', code: '123456', logger })
    expect(r).toEqual({ ok: false, status: 400, code: 'otp_superseded', error: 'A newer code was issued — please use the latest email.' })
    expect(logger.warn).toHaveBeenCalledWith('otp.superseded_typed', expect.objectContaining({ purpose: 'withdrawal' }))
  })
})
