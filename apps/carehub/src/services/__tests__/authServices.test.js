import { describe, it, expect, beforeEach, vi } from 'vitest'

// Stub the session lookup to hand back a fake token, so the test exercises
// the real sbFetch header assembly.
vi.mock('../../lib/authClient.js', () => ({
  authClient: { auth: { getSession: async () => ({ data: { session: { access_token: 'token-1' } } }) } },
}))

import { getStaffByEmail } from '../supabase.js'

let calls

beforeEach(() => {
  calls = []
  global.fetch = vi.fn(async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200, text: async () => '["uid-1"]' }
  })
})

describe('getStaffByEmail', () => {
  it('looks up an active staff row by email', async () => {
    await getStaffByEmail('staff@example.com')
    expect(calls[0].url).toContain('staff?email=eq.staff%40example.com&status=eq.active&select=*')
  })
})
