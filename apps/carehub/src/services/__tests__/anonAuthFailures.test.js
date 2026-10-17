import { describe, it, expect, beforeEach, vi } from 'vitest'

// Regression for the CareHub ADR page error:
//   Supabase error (401): permission denied for function can_access_adr_report_row
//
// That helper grants EXECUTE to authenticated/postgres/service_role only, so a
// request that fell back to the anon key is denied with code 42501 — and
// PostgREST reports it as 401, not the 403 this recovery branch historically
// matched. The 401 therefore never converted into a sign-in prompt and the raw
// database error reached the UI. These pin the recovery, plus the two guards:
// a REAL session's permission failure must keep its original detail, and
// successful anon reads (public forms, pre-login lookups) must stay untouched.
const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(async () => {}),
}))

vi.mock('../../lib/authClient.js', () => ({
  authClient: {
    auth: { getSession: h.getSession, refreshSession: h.refreshSession, signOut: h.signOut },
  },
}))

import { getBusinesses } from '../supabase.js'

let response

function reply({ ok = false, status, json = null }) {
  return { ok, status, text: async () => JSON.stringify(json) }
}

beforeEach(() => {
  h.getSession.mockReset()
  h.refreshSession.mockReset()
  // mockReset() drops the implementation, and sbFetch calls
  // `signOut().catch(...)` — restore an async no-op or that line throws.
  h.signOut.mockReset()
  h.signOut.mockImplementation(async () => {})
  // authToken() tries a refresh when the stored session is gone; a hard failure
  // (the real-world case behind the report) falls back to the anon key.
  h.refreshSession.mockResolvedValue({ data: { session: null } })
  response = reply({ ok: true, status: 200, json: [] })
  global.fetch = vi.fn(async () => response)
})

// No stored session + failed refresh => sbFetch sends the anon key.
const asAnon = () => h.getSession.mockResolvedValue({ data: { session: null } })
const withSession = () => h.getSession.mockResolvedValue({ data: { session: { access_token: 'token-1' } } })

describe('sbFetch anon auth failures', () => {
  it('maps the live 401/42501 RLS denial to a sign-in prompt', async () => {
    asAnon()
    response = reply({
      status: 401,
      json: { code: '42501', message: 'permission denied for function can_access_adr_report_row' },
    })

    await expect(getBusinesses()).rejects.toThrow('Session expired. Please log in again.')
    expect(h.signOut).toHaveBeenCalled()
  })

  it('still maps the historical 403 shape to the same prompt', async () => {
    asAnon()
    response = reply({ status: 403, json: { code: '42501', message: 'permission denied for table businesses' } })

    await expect(getBusinesses()).rejects.toThrow('Session expired. Please log in again.')
    expect(h.signOut).toHaveBeenCalled()
  })

  it('keeps a real session failure verbatim instead of masking it as expiry', async () => {
    withSession()
    response = reply({
      status: 401,
      json: { code: '42501', message: 'permission denied for function can_access_adr_report_row' },
    })

    await expect(getBusinesses()).rejects.toThrow(
      'Supabase error (401): permission denied for function can_access_adr_report_row'
    )
    expect(h.signOut).not.toHaveBeenCalled()
  })

  it('leaves successful anon reads alone, so public/pre-login flows still work', async () => {
    asAnon()
    response = reply({ ok: true, status: 200, json: [{ id: 'b1' }] })

    await expect(getBusinesses()).resolves.toEqual([{ id: 'b1' }])
    expect(h.signOut).not.toHaveBeenCalled()
  })
})
