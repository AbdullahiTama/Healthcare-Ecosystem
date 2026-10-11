// H01: OTP hardening - dedicated key, per-IP / platform limits, purpose registry, shared request helper, log hygiene, purge.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  OTP_PURPOSES, OTP_PURPOSE_VALUES, isOtpPurpose, hashOtp, hashIp, clientIp, sendOtp, checkOtp, issueOtpFromRequest, purgeOtpChallenges,
} from '../otp.js'

const SECRET = 'unit-test-otp-secret-value'
const SERVICE_KEY = 'service-role-key-must-not-be-used-in-production'
const IP = '203.0.113.77'
const user = { id: 'user-1', email: 'ada.obi@example.com', email_confirmed_at: '2026-01-01' }

const env = { ...process.env }
beforeEach(() => {
  process.env.OTP_HMAC_SECRET = SECRET
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
})
afterEach(() => {
  process.env = { ...env }
})

const silent = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
const mailer = () => ({ sendOtp: vi.fn(async () => ({ ok: true })) })
const rpcReturning = (value) => ({ rpc: vi.fn(async () => ({ data: value, error: null })) })
const allLogged = (logger) => JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls])

describe('the hashing key', () => {
  it('production refuses to fall back to the service-role key', () => {
    delete process.env.OTP_HMAC_SECRET
    process.env.NODE_ENV = 'production'
    expect(() => hashOtp('123456', 'u', 'pin_set')).toThrow(/OTP_HMAC_SECRET must be set in production/)
    expect(() => hashIp('1.2.3.4')).toThrow(/production/)
  })

  it('outside production the service-role key is still accepted, and a dedicated key wins when both exist', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.OTP_HMAC_SECRET
    const viaFallback = hashOtp('123456', 'u', 'pin_set')
    process.env.OTP_HMAC_SECRET = SECRET
    expect(hashOtp('123456', 'u', 'pin_set')).not.toBe(viaFallback)
  })

  it('a misconfigured production deploy fails closed with 503 and a log line free of secrets, before any database call', async () => {
    delete process.env.OTP_HMAC_SECRET
    process.env.NODE_ENV = 'production'
    const logger = silent()
    const supabase = rpcReturning('ok')
    const sent = await sendOtp({ supabase, user, purpose: 'withdrawal', mailer: mailer(), logger })
    expect(sent.status).toBe(503)
    const checked = await checkOtp({ supabase, userId: user.id, purpose: 'withdrawal', code: '123456', logger })
    expect(checked).toMatchObject({ ok: false, status: 503 })
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('otp.misconfigured', expect.any(Object))
    expect(allLogged(logger)).not.toContain(SERVICE_KEY)
  })
})

describe('IP handling', () => {
  it('hashes the address with a keyed, domain-separated HMAC and never returns it', () => {
    const h = hashIp(IP)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain(IP)
    expect(hashIp('203.0.113.78')).not.toBe(h)
    process.env.OTP_HMAC_SECRET = 'a-different-key'
    expect(hashIp(IP)).not.toBe(h)
  })

  it('prefers the edge-set headers over a browser-supplied X-Forwarded-For', () => {
    expect(clientIp({ headers: { 'x-vercel-forwarded-for': '198.51.100.9', 'x-forwarded-for': '6.6.6.6, 198.51.100.9' } })).toBe('198.51.100.9')
    expect(clientIp({ headers: { 'x-real-ip': '198.51.100.8', 'x-forwarded-for': '6.6.6.6' } })).toBe('198.51.100.8')
    expect(clientIp({ headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' } })).toBe('198.51.100.7')
    expect(clientIp({ headers: { 'x-forwarded-for': ['198.51.100.6'] } })).toBe('198.51.100.6')
  })

  it('returns null when nothing usable is present, and ignores absurdly long values', () => {
    expect(clientIp({ headers: {} })).toBeNull()
    expect(clientIp({})).toBeNull()
    expect(clientIp({ headers: { 'x-real-ip': 'x'.repeat(200) } })).toBeNull()
  })
})

describe('issuing with IP and platform limits', () => {
  it('sends only the keyed IP hash to the database', async () => {
    const supabase = rpcReturning('ok')
    const r = await sendOtp({ supabase, user, purpose: 'withdrawal', mailer: mailer(), ip: IP, logger: silent() })
    expect(r.status).toBe(200)
    const args = supabase.rpc.mock.calls[0][1]
    expect(args.p_ip_hash).toBe(hashIp(IP))
    expect(JSON.stringify(args)).not.toContain(IP)
  })

  it('passes null when the address is unknown (the user and platform limits still apply)', async () => {
    const supabase = rpcReturning('ok')
    await sendOtp({ supabase, user, purpose: 'withdrawal', mailer: mailer(), logger: silent() })
    expect(supabase.rpc.mock.calls[0][1].p_ip_hash).toBeNull()
  })

  it("maps 'ip_limited' to the same 429 as the per-user cap, so a caller cannot tell which ceiling it hit", async () => {
    const m = mailer()
    const r = await sendOtp({ supabase: rpcReturning('ip_limited'), user, purpose: 'pin_set', mailer: m, ip: IP, logger: silent() })
    const u = await sendOtp({ supabase: rpcReturning('rate_limited'), user, purpose: 'pin_set', mailer: m, ip: IP, logger: silent() })
    expect(r).toEqual(u)
    expect(r.status).toBe(429)
    expect(m.sendOtp).not.toHaveBeenCalled()
  })

  it("maps 'global_limited' to 503 without sending anything", async () => {
    const m = mailer()
    const r = await sendOtp({ supabase: rpcReturning('global_limited'), user, purpose: 'pin_set', mailer: m, logger: silent() })
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('otp_unavailable')
    expect(m.sendOtp).not.toHaveBeenCalled()
  })

  it('an unknown database answer is a 500, not a send', async () => {
    const m = mailer()
    const r = await sendOtp({ supabase: rpcReturning('something_new'), user, purpose: 'pin_set', mailer: m, logger: silent() })
    expect(r.status).toBe(500)
    expect(m.sendOtp).not.toHaveBeenCalled()
  })
})

describe('the purpose registry', () => {
  it('lists exactly the three purposes the database knows', () => {
    expect([...OTP_PURPOSE_VALUES].sort()).toEqual(['payout_account', 'pin_set', 'withdrawal'])
    expect(isOtpPurpose('withdrawal')).toBe(true)
    expect(isOtpPurpose('wire_money')).toBe(false)
  })

  it('an unknown purpose never reaches the database, on issue or on verify', async () => {
    const supabase = rpcReturning('ok')
    expect((await sendOtp({ supabase, user, purpose: 'wire_money', mailer: mailer(), logger: silent() })).status).toBe(400)
    expect(await checkOtp({ supabase, userId: 'u', purpose: 'wire_money', code: '123456', logger: silent() })).toMatchObject({ ok: false, status: 400 })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})

describe('issueOtpFromRequest (the one /otp action both apps mount)', () => {
  const req = (body, headers = { 'x-real-ip': IP }) => ({ body, headers })

  it('defaults to the PIN purpose and forwards the client IP', async () => {
    const supabase = rpcReturning('ok')
    const r = await issueOtpFromRequest({ supabase, user, req: req({}), mailer: mailer(), logger: silent() })
    expect(r.status).toBe(200)
    expect(supabase.rpc.mock.calls[0][1]).toMatchObject({ p_purpose: 'pin_set', p_ip_hash: hashIp(IP) })
  })

  it('mints a withdrawal code when asked', async () => {
    const supabase = rpcReturning('ok')
    await issueOtpFromRequest({ supabase, user, req: req({ purpose: OTP_PURPOSES.WITHDRAWAL }), mailer: mailer(), logger: silent() })
    expect(supabase.rpc.mock.calls[0][1].p_purpose).toBe('withdrawal')
  })

  it('refuses purposes this route may not mint (payout_account has its own route) and junk', async () => {
    const supabase = rpcReturning('ok')
    for (const purpose of ['payout_account', 'wire_money', 42, null]) {
      const r = await issueOtpFromRequest({ supabase, user, req: req({ purpose }), mailer: mailer(), logger: silent() })
      expect(r.status).toBe(400)
    }
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})

describe('log hygiene', () => {
  it('no log line from a full issue, a failed delivery and a wrong guess contains the code, the address, the IP or the key', async () => {
    const logger = silent()
    const m = { sendOtp: vi.fn(async () => ({ ok: false, error: 'provider rejected ada.obi@example.com' })) }
    const supabase = { rpc: vi.fn(async (fn) => ({ data: fn === 'issue_otp' ? 'ok' : 'invalid', error: null })) }
    await sendOtp({ supabase, user, purpose: 'withdrawal', mailer: m, ip: IP, logger })
    const issuedCode = m.sendOtp.mock.calls[0][0].code
    await checkOtp({ supabase, userId: user.id, purpose: 'withdrawal', code: '654321', logger })

    const text = allLogged(logger)
    for (const secretThing of [issuedCode, '654321', 'ada.obi@example.com', 'example.com', IP, SECRET, SERVICE_KEY, user.id]) {
      expect(text).not.toContain(secretThing)
    }
    expect(logger.error).toHaveBeenCalledWith('otp.delivery_failed', expect.objectContaining({ purpose: 'withdrawal' }))
    expect(logger.warn).toHaveBeenCalledWith('otp.verify_rejected', expect.objectContaining({ result: 'invalid' }))
  })

  it('the default logger writes JSON lines, not free text', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    await sendOtp({ supabase: rpcReturning('ok'), user, purpose: 'pin_set', mailer: mailer() })
    expect(() => JSON.parse(spy.mock.calls[0][0])).not.toThrow()
    expect(JSON.parse(spy.mock.calls[0][0])).toMatchObject({ event: 'otp.issued', purpose: 'pin_set' })
    spy.mockRestore()
  })
})

describe('purgeOtpChallenges', () => {
  const stub = (result) => {
    const lt = vi.fn(async () => result)
    return { client: { from: vi.fn(() => ({ delete: vi.fn(() => ({ lt })) })) }, lt }
  }

  it('deletes rows older than a day by default and reports how many', async () => {
    const { client, lt } = stub({ error: null, count: 7 })
    const now = Date.parse('2026-10-10T12:00:00Z')
    expect(await purgeOtpChallenges(client, { now })).toEqual({ purged: 7 })
    expect(lt).toHaveBeenCalledWith('created_at', '2026-10-09T12:00:00.000Z')
  })

  it('a database error is thrown so the scheduled step is reported as failed, not silently skipped', async () => {
    await expect(purgeOtpChallenges(stub({ error: { message: 'boom' }, count: null }).client)).rejects.toThrow(/otp purge failed: boom/)
  })
})
