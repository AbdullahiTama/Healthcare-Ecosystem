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
// `registerBusiness` posts to the server handler /api/register-business, not a
// browser RPC: the handler creates the unconfirmed owner + pending business and
// emails the verification link, and the form never carries a password (the owner
// chooses it from that link).
// `agent_applications` remains a write-only anon INSERT with no anon SELECT
// policy at all, so it must keep return=minimal — asking for a representation
// fails the whole INSERT with 42501, which is what broke that public form.
describe('anonymous public-form registration', () => {
  // The handler answers JSON, unlike PostgREST's empty return=minimal body.
  const answerWith = (ok, payload) => {
    global.fetch = vi.fn(async (url, options) => {
      calls.push({ url, options })
      return { ok, status: ok ? 200 : 400, json: async () => payload }
    })
  }

  it('registerBusiness posts the business fields to the server handler, never a password', async () => {
    answerWith(true, { ok: true })
    await registerBusiness({ name: 'HealthPlus', email: 'owner@example.com', password: 'secret123', confirmPassword: 'secret123' })
    expect(calls).toHaveLength(1)
    expect(calls[0].options.method).toBe('POST')
    expect(calls[0].url).toBe('/api/register-business')
    const body = JSON.parse(calls[0].options.body)
    expect(body).toMatchObject({ name: 'HealthPlus', email: 'owner@example.com' })
    for (const k of ['password', 'confirmPassword', 'p_password', 'p_business']) expect(body).not.toHaveProperty(k)
  })

  it('registerBusiness resolves { ok: true } and rejects with the server message when refused', async () => {
    answerWith(true, { ok: true })
    await expect(registerBusiness({ name: 'HealthPlus', email: 'o@example.com' })).resolves.toEqual({ ok: true })
    answerWith(false, { error: 'An account with this email already exists. Please sign in instead.' })
    await expect(registerBusiness({ name: 'HealthPlus', email: 'o@example.com' })).rejects.toThrow('An account with this email already exists. Please sign in instead.')
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
