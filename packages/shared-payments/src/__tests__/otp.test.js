import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateOtp, hashOtp, isValidOtp, maskEmail, sendOtp, checkOtp } from '../otp.js'
import { setWithdrawalPin, withdrawalPinStatus, hashPin, randomPinSalt } from '../pin.js'

process.env.OTP_HMAC_SECRET = 'test-secret'

function rpcStub(map) {
  return {
    rpc: vi.fn(async (fn, args) => {
      const v = map[fn]
      return typeof v === 'function' ? v(args) : { data: v ?? null, error: null }
    }),
    from: () => ({ delete: () => ({ lt: () => Promise.resolve({}) }) }),
  }
}
const user = { id: 'u1', email: 'ada@x.com', email_confirmed_at: '2026-01-01' }
const okMailer = () => ({ sendOtp: vi.fn(async () => ({ ok: true })), sendPinChanged: vi.fn(async () => ({ ok: true })) })

describe('otp helpers', () => {
  it('generates 6-digit codes', () => {
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{6}$/)
  })
  it('binds the hash to user and purpose and never contains the code', () => {
    const h = hashOtp('123456', 'u1', 'pin_set')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain('123456')
    expect(hashOtp('123456', 'u2', 'pin_set')).not.toBe(h)
    expect(hashOtp('123456', 'u1', 'payout_account')).not.toBe(h)
    expect(hashOtp('123457', 'u1', 'pin_set')).not.toBe(h)
  })
  it('fails closed with no secret configured', () => {
    const keep = [process.env.OTP_HMAC_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY]
    delete process.env.OTP_HMAC_SECRET; delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(() => hashOtp('123456', 'u', 'p')).toThrow(/must be set/)
    process.env.OTP_HMAC_SECRET = keep[0]
    if (keep[1]) process.env.SUPABASE_SERVICE_ROLE_KEY = keep[1]
  })
  it('validates and masks', () => {
    expect(isValidOtp('123456')).toBe(true)
    expect(isValidOtp('12345')).toBe(false)
    expect(isValidOtp(123456)).toBe(false)
    expect(maskEmail('ada.obi@gmail.com')).toBe('a******@gmail.com')
    expect(maskEmail('')).toBe('')
  })
})

describe('sendOtp', () => {
  it('emails the code, stores only its hash, never returns it, masks the address', async () => {
    const supabase = rpcStub({ issue_otp: 'ok' })
    const mailer = okMailer()
    const r = await sendOtp({ supabase, user, purpose: 'pin_set', mailer })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body)).not.toMatch(/\d{6}/)
    expect(r.body.sentTo).toBe('a**@x.com')
    const { code, to } = mailer.sendOtp.mock.calls[0][0]
    expect(to).toBe('ada@x.com')
    expect(supabase.rpc.mock.calls[0][1].p_code_hash).toBe(hashOtp(code, 'u1', 'pin_set'))
  })
  it.each([['cooldown', 'wait a minute'], ['rate_limited', 'hour']])('maps %s to 429 and sends nothing', async (state, text) => {
    const mailer = okMailer()
    const r = await sendOtp({ supabase: rpcStub({ issue_otp: state }), user, purpose: 'pin_set', mailer })
    expect(r.status).toBe(429)
    expect(r.body.error).toContain(text)
    expect(mailer.sendOtp).not.toHaveBeenCalled()
  })
  it('refuses unconfirmed or address-less accounts without touching the database', async () => {
    const supabase = rpcStub({ issue_otp: 'ok' })
    expect((await sendOtp({ supabase, user: { ...user, email_confirmed_at: null }, purpose: 'pin_set', mailer: okMailer() })).status).toBe(403)
    expect((await sendOtp({ supabase, user: { id: 'u' }, purpose: 'pin_set', mailer: okMailer() })).status).toBe(400)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
  it('reports 502 when the email provider fails', async () => {
    const mailer = { sendOtp: async () => ({ ok: false, error: 'x' }) }
    expect((await sendOtp({ supabase: rpcStub({ issue_otp: 'ok' }), user, purpose: 'pin_set', mailer })).status).toBe(502)
  })
})

describe('checkOtp', () => {
  it('rejects malformed codes without touching the database', async () => {
    const supabase = rpcStub({ verify_otp: 'ok' })
    expect((await checkOtp({ supabase, userId: 'u1', purpose: 'pin_set', code: 'abc' })).ok).toBe(false)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
  it.each([['ok', true], ['invalid', false], ['expired', false], ['locked', false], ['none', false]])('result %s', async (state, ok) => {
    const r = await checkOtp({ supabase: rpcStub({ verify_otp: state }), userId: 'u1', purpose: 'pin_set', code: '123456' })
    expect(r.ok).toBe(ok)
  })
})

function pinRow(pin = '1234') {
  const salt = randomPinSalt()
  return [{ pin_hash: hashPin(pin, salt), pin_salt: salt, failed_attempts: 0, locked_until: null }]
}

describe('setWithdrawalPin (stolen-session takeover fix)', () => {
  let mailer
  beforeEach(() => { mailer = okMailer() })
  const args = (over = {}) => ({ pin: '4321', otp: '123456', mailer, ...over })
  const wrote = (s) => s.rpc.mock.calls.some(([fn]) => fn === 'set_withdrawal_pin')

  it('first PIN needs a valid code; stores only a scrypt hash; sends the alert', async () => {
    const s = rpcStub({ get_withdrawal_pin: [], verify_otp: 'ok' })
    const r = await setWithdrawalPin(s, user, args())
    expect(r.status).toBe(200)
    const set = s.rpc.mock.calls.find(([fn]) => fn === 'set_withdrawal_pin')[1]
    expect(set.p_pin_hash).toHaveLength(128)
    expect(JSON.stringify(set)).not.toContain('4321')
    expect(mailer.sendPinChanged).toHaveBeenCalledTimes(1)
  })

  it('a bare session cannot overwrite an existing PIN: no/wrong code writes nothing, even with forgot', async () => {
    const s = rpcStub({ get_withdrawal_pin: pinRow(), verify_otp: 'none' })
    expect((await setWithdrawalPin(s, user, args({ otp: undefined, forgot: true }))).status).toBe(400)
    const wrong = rpcStub({ get_withdrawal_pin: pinRow(), verify_otp: 'invalid' })
    expect((await setWithdrawalPin(wrong, user, args({ forgot: true }))).status).toBe(400)
    expect(wrote(s)).toBe(false)
    expect(wrote(wrong)).toBe(false)
  })

  it('replacing needs the current PIN, checked before the code is consumed', async () => {
    const s = rpcStub({ get_withdrawal_pin: pinRow('1234'), verify_withdrawal_pin: false, verify_otp: 'ok' })
    expect((await setWithdrawalPin(s, user, args())).status).toBe(400)
    expect((await setWithdrawalPin(s, user, args({ currentPin: '0000' }))).status).toBe(403)
    expect(s.rpc.mock.calls.some(([fn]) => fn === 'verify_otp')).toBe(false)
    expect(wrote(s)).toBe(false)
  })

  it('right current PIN + code works; forgot needs only the code', async () => {
    const a = rpcStub({ get_withdrawal_pin: pinRow('1234'), verify_withdrawal_pin: true, verify_otp: 'ok' })
    expect((await setWithdrawalPin(a, user, args({ currentPin: '1234' }))).body).toEqual({ ok: true, hadPin: true })
    const b = rpcStub({ get_withdrawal_pin: pinRow('1234'), verify_otp: 'ok' })
    expect((await setWithdrawalPin(b, user, args({ forgot: true }))).status).toBe(200)
  })

  it('validates the PIN format and email confirmation before anything else', async () => {
    const s = rpcStub({})
    expect((await setWithdrawalPin(s, user, args({ pin: '12' }))).status).toBe(400)
    expect((await setWithdrawalPin(s, { ...user, email_confirmed_at: null }, args())).status).toBe(403)
    expect(s.rpc).not.toHaveBeenCalled()
  })

  it('a failing alert email does not fail the change', async () => {
    const s = rpcStub({ get_withdrawal_pin: [], verify_otp: 'ok' })
    const r = await setWithdrawalPin(s, user, args({ mailer: { sendPinChanged: async () => { throw new Error('mail down') } } }))
    expect(r.status).toBe(200)
  })
})

describe('withdrawalPinStatus', () => {
  it('reports presence without exposing the hash', async () => {
    const r = await withdrawalPinStatus(rpcStub({ get_withdrawal_pin: pinRow() }), 'u1')
    expect(r.body).toEqual({ hasPin: true })
    expect((await withdrawalPinStatus(rpcStub({ get_withdrawal_pin: [] }), 'u1')).body).toEqual({ hasPin: false })
  })
})
