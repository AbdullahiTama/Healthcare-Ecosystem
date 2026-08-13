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

// ── Regression: anonymous public forms must not leak or fail on the row they
// write ────────────────────────────────────────────────────────────────────────
//
// `registerBusiness` moved to the register_business RPC in C2: the businesses
// password column is gone, and the RPC (SECURITY DEFINER, anon-executable)
// mints the confirmed auth user + pending row atomically, forcing the
// privileged defaults server-side. It returns a scalar business id, not a row.
// `agent_applications` remains a write-only anon INSERT with no anon SELECT
// policy at all, so it must keep return=minimal — asking for a representation
// fails the whole INSERT with 42501, which is what broke that public form.
describe('anonymous public-form registration', () => {
  it('registerBusiness posts to the register_business RPC, password as a separate arg', async () => {
    await registerBusiness({ name: 'HealthPlus', email: 'owner@example.com', password: 'secret123' })
    expect(calls).toHaveLength(1)
    expect(calls[0].options.method).toBe('POST')
    expect(calls[0].url).toContain('rpc/register_business')
    const body = JSON.parse(calls[0].options.body)
    expect(body.p_business).toEqual({ name: 'HealthPlus', email: 'owner@example.com' })
    expect(body.p_password).toBe('secret123')
    expect(body.p_business).not.toHaveProperty('password')
  })

  it('registerBusiness resolves the RPC result rather than throwing on an empty body', async () => {
    await expect(registerBusiness({ name: 'HealthPlus', email: 'o@example.com', password: 'secret123' })).resolves.toBeUndefined()
  })

  it('submitAgentApplication asks for no representation', async () => {
    await submitAgentApplication({ applicant_name: 'Ada', contact_email: 'ada@example.com' })
    expect(calls).toHaveLength(1)
    expect(calls[0].options.method).toBe('POST')
    expect(preferOf(calls[0])).toBe('return=minimal')
  })

  // Guards the other half: return=minimal is only correct where the caller
  // discards the result. Authenticated reads/writes that DO use the response
  // must keep asking for one, so this is not blanket-applied.
  it('leaves authenticated writes that already opted into minimal untouched', async () => {
    await updateBusiness('biz-1', { phone: '0800' })
    expect(preferOf(calls[0])).toBe('return=minimal')
  })
})
