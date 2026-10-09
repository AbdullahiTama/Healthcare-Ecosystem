// The CareHub withdrawal PIN endpoints. The PIN is the second factor against a stolen owner session (audit F-08),
// so REPLACING one must require the current PIN: otherwise a thief would just set their own.
const h = vi.hoisted(() => {
  const s = { rpcCalls: [], auth: null, stored: null }
  s.client = {
    rpc: async (name, args) => {
      s.rpcCalls.push([name, args])
      if (name === 'get_withdrawal_pin') return { data: s.stored ? [s.stored] : [] }
      if (name === 'verify_withdrawal_pin') return { data: s.verified ?? true }
      if (name === 'set_withdrawal_pin') return { data: null, error: s.setError || null }
      if (name === 'verify_otp') return { data: s.otp ?? 'ok', error: null }
      if (name === 'issue_otp') return { data: s.issued ?? 'ok', error: null }
      return { data: null }
    },
  }
  return s
})

h.mailer = { sendOtp: vi.fn(async () => ({ ok: true })), sendPinChanged: vi.fn(async () => ({ ok: true })) }
process.env.OTP_HMAC_SECRET = 'test-secret'

vi.mock('../_lib/supabase.js', () => ({ supabase: h.client }))
vi.mock('../_lib/securityMailer.js', () => ({ getSecurityMailer: async () => h.mailer }))
vi.mock('../_lib/verifyBusiness.js', () => ({ verifyBusiness: async () => h.auth }))

import { hashPin } from '@care-ecosystem/shared-payments'
import handler from '../_handlers/withdrawal-pin.js'

const SALT = '00112233445566778899aabbccddeeff'
const call = (action, body = {}, method = 'POST') => {
  const r = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  return handler({ method, url: `/api/withdrawal-pin/${action}`, body }, r).then(() => r)
}
const rpcs = (n) => h.rpcCalls.filter(([name]) => name === n)

beforeEach(() => {
  h.rpcCalls.length = 0
  h.verified = true
  h.setError = null
  h.stored = null
  h.otp = 'ok'
  h.issued = 'ok'
  h.mailer.sendOtp.mockClear()
  h.mailer.sendPinChanged.mockClear()
  h.auth = { business: { id: 'biz-1' }, user: { id: 'user-1', email: 'o@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' } }
})

describe('/api/withdrawal-pin', () => {
  it('requires a signed-in owner and POST', async () => {
    h.auth = { error: 'not_logged_in' }
    expect((await call('set', { pin: '1234' })).statusCode).toBe(401)
    h.auth = { business: { id: 'biz-1' }, user: { id: 'user-1' } }
    expect((await call('set', { pin: '1234' }, 'GET')).statusCode).toBe(405)
  })

  it('status reports whether a PIN exists, without exposing the hash or salt', async () => {
    let r = await call('status'); expect(r.body).toEqual({ hasPin: false })
    h.stored = { pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null }
    r = await call('status'); expect(r.body).toEqual({ hasPin: true })
  })

  it('creates a first PIN: only the DERIVED hash and a fresh salt reach the database, for the VERIFIED user', async () => {
    const r = await call('set', { pin: '4321', otp: '123456', user_id: 'attacker' })
    expect(r.statusCode).toBe(200)
    const [[, args]] = rpcs('set_withdrawal_pin')
    expect(args.p_user_id).toBe('user-1')
    expect(args.p_pin_salt).toMatch(/^[0-9a-f]{32}$/)
    expect(args.p_pin_hash).toBe(hashPin('4321', args.p_pin_salt))
    expect(JSON.stringify(h.rpcCalls)).not.toContain('"4321"')
  })

  it('refuses malformed PINs and an unconfirmed email', async () => {
    for (const pin of [undefined, '12', '1234567', 'abcd']) expect((await call('set', { pin, otp: '123456' })).statusCode).toBe(400)
    h.auth.user.email_confirmed_at = null
    expect((await call('set', { pin: '1234', otp: '123456' })).statusCode).toBe(403)
    expect(rpcs('set_withdrawal_pin')).toHaveLength(0)
  })

  it('REPLACING a PIN needs the current one: none, wrong, or locked is refused and nothing is written', async () => {
    h.stored = { pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null }
    let r = await call('set', { pin: '9999', otp: '123456' })
    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(/current PIN/)
    h.verified = false
    r = await call('set', { pin: '9999', otp: '123456', currentPin: '0000' })
    expect(r.statusCode).toBe(403)
    h.stored = { ...h.stored, locked_until: new Date(Date.now() + 600000).toISOString() }
    r = await call('set', { pin: '9999', otp: '123456', currentPin: '1234' })
    expect(r.statusCode).toBe(403)
    expect(rpcs('set_withdrawal_pin')).toHaveLength(0)
  })

  it('replaces the PIN when the current one is right', async () => {
    h.stored = { pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null }
    const r = await call('set', { pin: '9999', otp: '123456', currentPin: '1234' })
    expect(r.statusCode).toBe(200)
    expect(rpcs('set_withdrawal_pin')).toHaveLength(1)
  })

  it('a session alone cannot set a PIN: no code, or a wrong/expired code, writes nothing (audit F-32)', async () => {
    expect((await call('set', { pin: '4321' })).statusCode).toBe(400)
    h.otp = 'invalid'
    expect((await call('set', { pin: '4321', otp: '000000' })).statusCode).toBe(400)
    h.otp = 'expired'
    h.stored = { pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null }
    expect((await call('set', { pin: '4321', otp: '000000', forgot: true })).statusCode).toBe(400)
    expect(rpcs('set_withdrawal_pin')).toHaveLength(0)
  })

  it('"forgot PIN" replaces an existing PIN with only the emailed code, and the owner is alerted', async () => {
    h.stored = { pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null }
    const r = await call('set', { pin: '5678', otp: '123456', forgot: true })
    expect(r.statusCode).toBe(200)
    expect(rpcs('verify_withdrawal_pin')).toHaveLength(0)
    expect(h.mailer.sendPinChanged).toHaveBeenCalledWith({ to: 'o@x.com' })
  })

  it('otp emails a code to the verified owner only, never returns it, and honours the resend limits', async () => {
    const r = await call('otp')
    expect(r.statusCode).toBe(200)
    expect(JSON.stringify(r.body)).not.toMatch(/\d{6}/)
    expect(h.mailer.sendOtp).toHaveBeenCalledWith(expect.objectContaining({ to: 'o@x.com', purpose: 'pin_set' }))
    h.issued = 'cooldown'
    expect((await call('otp')).statusCode).toBe(429)
    h.auth = { error: 'not_logged_in' }
    expect((await call('otp')).statusCode).toBe(401)
  })

  it('a database failure is a 500, an unknown action a 404', async () => {
    h.setError = { message: 'down' }
    expect((await call('set', { pin: '1234', otp: '123456' })).statusCode).toBe(500)
    expect((await call('whatever')).statusCode).toBe(404)
  })
})
