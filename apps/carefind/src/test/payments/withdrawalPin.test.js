import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSupabase, mockVerifyUser } = vi.hoisted(() => ({
  mockSupabase: {},
  mockVerifyUser: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockSupabase) }))
vi.mock('../../../api/_lib/verifyUser.js', () => ({ verifyUser: mockVerifyUser }))

process.env.OTP_HMAC_SECRET = 'test-secret'
vi.mock('../../../api/_lib/securityMailer.js', () => ({ getSecurityMailer: async () => ({ sendOtp: async () => ({ ok: true }), sendPinChanged: async () => ({ ok: true }) }) }))

import handler from '../../../api/_handlers/withdrawal-pin.js'

let pinRow = []
let verifyResult = true

function makeReq(url, body = {}) {
  return { method: 'POST', url, headers: {}, body }
}

function makeRes() {
  const res = { statusCode: 200, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (obj) => { res.body = obj; return res }
  return res
}

describe('withdrawal-pin handler', () => {
  beforeEach(() => {
    mockVerifyUser.mockReset()
    mockSupabase.rpc = vi.fn()
    pinRow = []
    verifyResult = true
    mockSupabase.rpc.mockImplementation(async (fn) => {
      if (fn === 'get_withdrawal_pin') return { data: pinRow, error: null }
      if (fn === 'verify_withdrawal_pin') return { data: verifyResult, error: null }
      if (fn === 'verify_otp') return { data: 'ok', error: null }
      return { data: null, error: null }
    })
  })

  const confirmedUser = { id: 'user-1', email_confirmed_at: '2026-01-01T00:00:00Z' }

  describe('POST /api/withdrawal-pin/otp', () => {
    const issued = () => mockSupabase.rpc.mock.calls.filter(([fn]) => fn === 'issue_otp')

    beforeEach(() => {
      mockSupabase.rpc.mockImplementation(async (fn) => (fn === 'issue_otp' ? { data: 'ok', error: null } : { data: null, error: null }))
    })

    it('issues a PIN-set code by default', async () => {
      mockVerifyUser.mockResolvedValue({ ...confirmedUser, email: 'u@example.com' })
      const res = await handler(makeReq('/api/withdrawal-pin/otp', {}), makeRes())
      expect(res.statusCode).toBe(200)
      expect(issued()[0][1]).toMatchObject({ p_purpose: 'pin_set' })
    })

    it('issues a withdrawal code when asked, and nothing for any other purpose', async () => {
      mockVerifyUser.mockResolvedValue({ ...confirmedUser, email: 'u@example.com' })
      let res = await handler(makeReq('/api/withdrawal-pin/otp', { purpose: 'withdrawal' }), makeRes())
      expect(res.statusCode).toBe(200)
      expect(issued()[0][1]).toMatchObject({ p_purpose: 'withdrawal' })
      mockSupabase.rpc.mockClear()
      res = await handler(makeReq('/api/withdrawal-pin/otp', { purpose: 'payout_account' }), makeRes())
      expect(res.statusCode).toBe(400)
      expect(issued()).toHaveLength(0)
    })
  })

  describe('POST /api/withdrawal-pin/set', () => {
    it('rejects a non-digit pin', async () => {
      mockVerifyUser.mockResolvedValue(confirmedUser)
      const res = await handler(makeReq('/api/withdrawal-pin/set', { pin: 'abcd' }), makeRes())
      expect(res.statusCode).toBe(400)
      expect(res.body.error).toContain('4-6 digits')
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
    })

    it('rejects a pin that is not 4-6 digits long', async () => {
      mockVerifyUser.mockResolvedValue(confirmedUser)
      const res = await handler(makeReq('/api/withdrawal-pin/set', { pin: '123' }), makeRes())
      expect(res.statusCode).toBe(400)
    })

    it('rejects a missing pin', async () => {
      mockVerifyUser.mockResolvedValue(confirmedUser)
      const res = await handler(makeReq('/api/withdrawal-pin/set', {}), makeRes())
      expect(res.statusCode).toBe(400)
    })

    it('rejects when the session email is not confirmed', async () => {
      mockVerifyUser.mockResolvedValue({ id: 'user-1', email_confirmed_at: null })
      const res = await handler(makeReq('/api/withdrawal-pin/set', { pin: '1234' }), makeRes())
      expect(res.statusCode).toBe(403)
      expect(res.body.error).toContain('Confirm your email')
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
    })

    it('sets the PIN for a confirmed email', async () => {
      mockVerifyUser.mockResolvedValue(confirmedUser)
      const res = await handler(makeReq('/api/withdrawal-pin/set', { pin: '4821', otp: '123456' }), makeRes())
      expect(res.statusCode).toBe(200)
      expect(res.body).toMatchObject({ ok: true })
      const [fn, args] = mockSupabase.rpc.mock.calls.find(([n]) => n === 'set_withdrawal_pin')
      expect(fn).toBe('set_withdrawal_pin')
      expect(args.p_user_id).toBe('user-1')
      expect(args.p_pin_hash).toMatch(/^[0-9a-f]{128}$/)
      expect(args.p_pin_salt).toMatch(/^[0-9a-f]{32}$/)
    })

    it('requires a signed-in user', async () => {
      mockVerifyUser.mockResolvedValue(null)
      const res = await handler(makeReq('/api/withdrawal-pin/set', { pin: '1234' }), makeRes())
      expect(res.statusCode).toBe(401)
    })
  })

  describe('POST /api/withdrawal-pin/verify', () => {
    it('returns ok for a correct pin', async () => {
      mockVerifyUser.mockResolvedValue(confirmedUser)
      pinRow = [{ pin_hash: 'h'.repeat(128), pin_salt: 's'.repeat(32), failed_attempts: 0, locked_until: null }]
      verifyResult = true
      const res = await handler(makeReq('/api/withdrawal-pin/verify', { pin: '1234' }), makeRes())
      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({ ok: true })
    })

    it('returns 403 {ok:false} for a wrong pin', async () => {
      mockVerifyUser.mockResolvedValue(confirmedUser)
      pinRow = [{ pin_hash: 'h'.repeat(128), pin_salt: 's'.repeat(32), failed_attempts: 0, locked_until: null }]
      verifyResult = false
      const res = await handler(makeReq('/api/withdrawal-pin/verify', { pin: '9999' }), makeRes())
      expect(res.statusCode).toBe(403)
      expect(res.body).toEqual({ ok: false })
    })

    it('returns 400 when no PIN has been set', async () => {
      mockVerifyUser.mockResolvedValue(confirmedUser)
      pinRow = []
      const res = await handler(makeReq('/api/withdrawal-pin/verify', { pin: '1234' }), makeRes())
      expect(res.statusCode).toBe(400)
      expect(res.body.error).toContain('Set a withdrawal PIN first')
    })
  })
})