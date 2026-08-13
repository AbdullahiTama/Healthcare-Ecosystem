import { describe, it, expect, beforeEach, vi } from 'vitest'

// Provisioning runs with a logged-in owner, so sbFetch forwards the real
// session's token. Stub the session lookup to hand back a fake token, so the
// test exercises the real sbFetch header assembly.
vi.mock('../../lib/authClient.js', () => ({
  authClient: { auth: { getSession: async () => ({ data: { session: { access_token: 'token-1' } } }) } },
}))

import { provisionStaffAuth, getStaffByEmail } from '../supabase.js'

let calls

beforeEach(() => {
  calls = []
  global.fetch = vi.fn(async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200, text: async () => '["uid-1"]' }
  })
})

describe('provisionStaffAuth', () => {
  it('posts to the provision_staff_auth RPC with the expected args', async () => {
    const result = await provisionStaffAuth('biz-1', 'Staff@Example.com', 'secret123')
    expect(calls).toHaveLength(1)
    expect(calls[0].options.method).toBe('POST')
    expect(calls[0].url).toContain('rpc/provision_staff_auth')
    expect(JSON.parse(calls[0].options.body)).toEqual({
      p_business_id: 'biz-1',
      p_email: 'staff@example.com',
      p_password: 'secret123',
    })
    // Scalar RPC result is unwrapped (bare value or array both handled).
    expect(result).toBe('uid-1')
  })

  it('carries the real session token, not the anon key', async () => {
    await provisionStaffAuth('biz-1', 'staff@example.com', 'secret123')
    expect(calls[0].options.headers.Authorization).toBe('Bearer token-1')
  })
})

describe('getStaffByEmail', () => {
  it('looks up an active staff row by email', async () => {
    await getStaffByEmail('staff@example.com')
    expect(calls[0].url).toContain('staff?email=eq.staff%40example.com&status=eq.active&select=*')
  })
})
