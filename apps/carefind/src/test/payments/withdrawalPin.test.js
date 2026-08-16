import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSupabase, mockVerifyUser } = vi.hoisted(() => ({
  mockSupabase: {},
  mockVerifyUser: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockSupabase) }))
vi.mock('../../../api/_lib/verifyUser.js', () => ({ verifyUser: mockVerifyUser }))

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
      return { data: null, error: null }
    })
  })

  const confirmedUser = { id: 'user-1', email_confirmed_at: '2026-01-01T00:00:00Z' }

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
      const res = await handler(makeReq('/api/withdrawal-pin/set', { pin: '4821' }), makeRes())
      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({ ok: true })
      expect(mockSupabase.rpc).toHaveBeenCalledTimes(1)
      const [fn, args] = mockSupabase.rpc.mock.calls[0]
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