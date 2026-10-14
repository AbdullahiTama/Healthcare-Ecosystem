// CareFind withdrawal PIN endpoints. Audit F-32: /set used to let ANY signed-in session replace the PIN, which
// defeats the PIN as a stolen-session control. Setting or replacing now needs a fresh emailed code (and, when
// replacing, the current PIN unless the user chose "forgot PIN").
const h = vi.hoisted(() => {
  const s = { rpcCalls: [], user: null, stored: null, otp: 'ok', issued: 'ok', verified: true, createFirst: null, draftRow: null }
  const draftChain = () => {
    const b = {}
    b.maybeSingle = async () => ({ data: s.draftRow, error: null })
    for (const m of ['select', 'eq', 'is', 'gt', 'order', 'limit']) b[m] = () => b
    return b
  }
  s.client = {
    from: (table) => (table === 'withdrawal_drafts' ? draftChain() : { delete: () => ({ lt: () => Promise.resolve({}) }) }),
    rpc: async (name, args) => {
      s.rpcCalls.push([name, args])
      if (name === 'get_withdrawal_pin') return { data: s.stored ? [s.stored] : [] }
      if (name === 'verify_withdrawal_pin') return { data: s.verified }
      if (name === 'verify_otp') return { data: s.otp }
      if (name === 'issue_otp') return { data: s.issued }
      if (name === 'create_withdrawal_draft') {
        if (s.createFirst) { const d = s.createFirst; s.createFirst = null; return { data: d, error: null } }
        return { data: { ok: true, draft_id: 'd-2' }, error: null }
      }
      if (name === 'void_withdrawal_draft') return { data: null, error: null }
      return { data: null, error: null }
    },
  }
  s.mailer = { sendOtp: async () => ({ ok: true }), sendPinChanged: async () => ({ ok: true }) }
  return s
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => h.user }))
vi.mock('../_lib/securityMailer.js', () => ({ getSecurityMailer: async () => h.mailer }))

import { hashPin } from '@care-ecosystem/shared-payments'
import handler from './withdrawal-pin.js'

process.env.OTP_HMAC_SECRET = 'test-secret'
const SALT = '00112233445566778899aabbccddeeff'
const rpcs = (n) => h.rpcCalls.filter(([name]) => name === n)

function call(action, body = {}, method = 'POST') {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  return handler({ method, url: `/api/withdrawal-pin/${action}`, body, headers: {} }, res).then(() => res)
}

beforeEach(() => {
  h.rpcCalls.length = 0
  h.stored = null; h.otp = 'ok'; h.issued = 'ok'; h.verified = true; h.createFirst = null; h.draftRow = null
  h.user = { id: 'user-1', email: 'u@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' }
  h.mailer.sendOtp = vi.fn(async () => ({ ok: true }))
  h.mailer.sendPinChanged = vi.fn(async () => ({ ok: true }))
})

describe('/api/withdrawal-pin (CareFind)', () => {
  it('requires POST and a signed-in user', async () => {
    expect((await call('set', {}, 'GET')).statusCode).toBe(405)
    h.user = null
    expect((await call('otp')).statusCode).toBe(401)
  })

  it('status reports presence only', async () => {
    expect((await call('status')).body).toEqual({ hasPin: false })
    h.stored = { pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null }
    expect((await call('status')).body).toEqual({ hasPin: true })
  })

  it('otp emails the code to the verified account and never returns it', async () => {
    const r = await call('otp')
    expect(r.statusCode).toBe(200)
    expect(JSON.stringify(r.body)).not.toMatch(/\d{6}/)
    expect(h.mailer.sendOtp).toHaveBeenCalledWith(expect.objectContaining({ to: 'u@x.com', purpose: 'pin_set' }))
    h.issued = 'rate_limited'
    expect((await call('otp')).statusCode).toBe(429)
  })

  it('a first PIN needs the emailed code; the database only ever sees the derived hash', async () => {
    const r = await call('set', { pin: '4321', otp: '123456', user_id: 'attacker' })
    expect(r.statusCode).toBe(200)
    const [[, args]] = rpcs('set_withdrawal_pin')
    expect(args.p_user_id).toBe('user-1')
    expect(args.p_pin_hash).toBe(hashPin('4321', args.p_pin_salt))
    expect(JSON.stringify(h.rpcCalls)).not.toContain('"4321"')
    expect(h.mailer.sendPinChanged).toHaveBeenCalled()
  })

  it('F-32: a bare session cannot replace an existing PIN', async () => {
    h.stored = { pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null }
    // no code, no current PIN
    expect((await call('set', { pin: '9999' })).statusCode).toBe(400)
    // code but no current PIN and not "forgot"
    expect((await call('set', { pin: '9999', otp: '123456' })).statusCode).toBe(400)
    // wrong current PIN
    h.verified = false
    expect((await call('set', { pin: '9999', otp: '123456', currentPin: '0000' })).statusCode).toBe(403)
    // forgot, but the code is wrong
    h.verified = true; h.otp = 'invalid'
    expect((await call('set', { pin: '9999', otp: '000000', forgot: true })).statusCode).toBe(400)
    expect(rpcs('set_withdrawal_pin')).toHaveLength(0)
  })

  it('replaces with the current PIN + code, or with the code alone when forgotten', async () => {
    h.stored = { pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null }
    expect((await call('set', { pin: '9999', otp: '123456', currentPin: '1234' })).statusCode).toBe(200)
    expect((await call('set', { pin: '8888', otp: '123456', forgot: true })).statusCode).toBe(200)
    expect(rpcs('set_withdrawal_pin')).toHaveLength(2)
  })

  it('refuses an unconfirmed email and malformed PINs', async () => {
    expect((await call('set', { pin: '12', otp: '123456' })).statusCode).toBe(400)
    h.user.email_confirmed_at = null
    expect((await call('set', { pin: '1234', otp: '123456' })).statusCode).toBe(403)
    expect(rpcs('set_withdrawal_pin')).toHaveLength(0)
  })

  it('verify still pre-checks a PIN', async () => {
    h.stored = { pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null }
    expect((await call('verify', { pin: '1234' })).body).toEqual({ ok: true })
    h.verified = false
    expect((await call('verify', { pin: '1234' })).statusCode).toBe(403)
    expect((await call('verify', { pin: 'x' })).statusCode).toBe(400)
  })

  it('a withdrawal code needs a destination: amount alone is refused', async () => {
    const r = await call('otp', { purpose: 'withdrawal', amount: 10 })
    expect(r.statusCode).toBe(400)
    expect(r.body).toMatchObject({ code: 'draft_destination' })
    expect(rpcs('create_withdrawal_draft')).toHaveLength(0)
    expect(rpcs('issue_otp')).toHaveLength(0)
  })

  it('a withdrawal code with amount + destination drafts then issues', async () => {
    const r = await call('otp', { purpose: 'withdrawal', amount: 10, bankCode: '058', accountNumber: '0123456789' })
    expect(r.statusCode).toBe(200)
    expect(rpcs('create_withdrawal_draft')).toHaveLength(1)
    expect(rpcs('issue_otp')).toHaveLength(1)
  })

  it('a live draft without reissue stays 409 and is never voided', async () => {
    h.createFirst = { ok: false, outcome: 'draft_active' }
    const r = await call('otp', { purpose: 'withdrawal', amount: 10, bankCode: '058', accountNumber: '0123456789' })
    expect(r.statusCode).toBe(409)
    expect(r.body).toMatchObject({ code: 'draft_active' })
    expect(rpcs('void_withdrawal_draft')).toHaveLength(0)
    expect(rpcs('issue_otp')).toHaveLength(0)
  })

  it('reissue voids the live draft, then drafts + issues the new code', async () => {
    h.createFirst = { ok: false, outcome: 'draft_active' }
    const r = await call('otp', { purpose: 'withdrawal', amount: 10, bankCode: '058', accountNumber: '0123456789', reissue: true })
    expect(r.statusCode).toBe(200)
    expect(rpcs('void_withdrawal_draft')).toHaveLength(1)
    expect(rpcs('void_withdrawal_draft')[0][1]).toMatchObject({ p_user_id: 'user-1', p_reason: 'reissue' })
    expect(rpcs('create_withdrawal_draft')).toHaveLength(2)
    expect(rpcs('issue_otp')).toHaveLength(1)
  })

  it('reissue inside the cooldown voids nothing and returns the cooldown untouched', async () => {
    h.createFirst = { ok: false, outcome: 'draft_active' }
    h.issued = 'cooldown'
    const r = await call('otp', { purpose: 'withdrawal', amount: 10, bankCode: '058', accountNumber: '0123456789', reissue: true })
    expect(r.statusCode).toBe(429)
    expect(rpcs('void_withdrawal_draft')).toHaveLength(0)
    expect(rpcs('create_withdrawal_draft')).toHaveLength(1)
  })

  it('a failed send voids the draft it just created (no phantom lock)', async () => {
    h.mailer.sendOtp = vi.fn(async () => ({ ok: false, error: 'smtp down' }))
    const r = await call('otp', { purpose: 'withdrawal', amount: 10, bankCode: '058', accountNumber: '0123456789' })
    expect(r.statusCode).toBe(502)
    expect(rpcs('void_withdrawal_draft')).toHaveLength(1)
    expect(rpcs('void_withdrawal_draft')[0][1]).toMatchObject({ p_user_id: 'user-1', p_reason: 'issue_failed' })
  })

  it('the draft action never exposes the destination fingerprint', async () => {
    h.draftRow = { id: 'd-1', app: 'carefind', amount: 10, unit: 'coins', destination_fp: 'saved:acc-1', destination_mask: '••••cc-1' }
    const r = await call('draft')
    expect(r.statusCode).toBe(200)
    expect(r.body.draft).toMatchObject({ id: 'd-1', amount: 10 })
    expect('destination_fp' in (r.body.draft || {})).toBe(false)
  })

  it('a misconfigured draft secret fails closed without issuing', async () => {
    const savedSecret = process.env.OTP_HMAC_SECRET
    const savedRole = process.env.SUPABASE_SERVICE_ROLE_KEY
    try {
      delete process.env.OTP_HMAC_SECRET
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
      const r = await call('otp', { purpose: 'withdrawal', amount: 10, bankCode: '058', accountNumber: '0123456789' })
      expect(r.statusCode).toBe(503)
      expect(r.body).toMatchObject({ code: 'draft_unavailable' })
      expect(rpcs('issue_otp')).toHaveLength(0)
    } finally {
      if (savedSecret !== undefined) process.env.OTP_HMAC_SECRET = savedSecret
      if (savedRole !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedRole
    }
  })
})
