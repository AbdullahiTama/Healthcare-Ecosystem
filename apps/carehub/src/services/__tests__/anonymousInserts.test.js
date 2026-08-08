import { describe, it, expect, beforeEach, vi } from 'vitest'

// The two public forms run with no session, so sbFetch falls back to the anon
// key. Stub the session lookup rather than the network client, so the test
// exercises the real sbFetch header assembly.
vi.mock('../../lib/authClient.js', () => ({
  authClient: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

import { registerBusiness, submitAgentApplication, updateBusiness } from '../supabase.js'

let calls

beforeEach(() => {
  calls = []
  global.fetch = vi.fn(async (url, options) => {
    calls.push({ url, options })
    // 201 + empty body is exactly what PostgREST answers to return=minimal.
    return { ok: true, status: 201, text: async () => '' }
  })
})

const preferOf = (call) => call.options.headers.Prefer

// ── Regression: anonymous INSERTs must not ask for a representation ──────────
//
// PostgreSQL applies the SELECT policy to the new row whenever an INSERT
// carries a RETURNING clause, which `Prefer: return=representation` makes
// PostgREST generate. Neither of these tables lets an anonymous caller read
// the row it just wrote — `businesses`' only anon SELECT policy is CareFind's
// public directory (status='active', while a new signup is 'pending'), and
// `agent_applications` is a write-only intake queue with no anon SELECT policy
// at all. Asking for a representation therefore fails the whole INSERT with
// 42501, which is what broke both public forms in production.
describe('anonymous public-form inserts', () => {
  it('registerBusiness asks for no representation', async () => {
    await registerBusiness({ name: 'HealthPlus', email: 'owner@example.com', status: 'pending' })
    expect(calls).toHaveLength(1)
    expect(calls[0].options.method).toBe('POST')
    expect(preferOf(calls[0])).toBe('return=minimal')
  })

  it('submitAgentApplication asks for no representation', async () => {
    await submitAgentApplication({ applicant_name: 'Ada', contact_email: 'ada@example.com' })
    expect(calls).toHaveLength(1)
    expect(calls[0].options.method).toBe('POST')
    expect(preferOf(calls[0])).toBe('return=minimal')
  })

  it('returns an empty result rather than throwing on PostgREST 201 + empty body', async () => {
    await expect(registerBusiness({ name: 'HealthPlus' })).resolves.toEqual([])
  })

  // Guards the other half: return=minimal is only correct where the caller
  // discards the result. Authenticated reads/writes that DO use the response
  // must keep asking for one, so this is not blanket-applied.
  it('leaves authenticated writes that already opted into minimal untouched', async () => {
    await updateBusiness('biz-1', { phone: '0800' })
    expect(preferOf(calls[0])).toBe('return=minimal')
  })
})
