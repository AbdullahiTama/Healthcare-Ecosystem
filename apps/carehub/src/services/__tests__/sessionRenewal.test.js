import { describe, it, expect, beforeEach, vi } from 'vitest'

// A session whose access token the server has already expired, while the
// device clock still calls it valid: getSession keeps returning it until
// something forces a refresh. This is the shape of the 2026-10-29 incident.
const session = vi.hoisted(() => ({ token: 'expired-token' }))
vi.mock('../../lib/authClient.js', () => ({
  authClient: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: session.token } }, error: null }),
      refreshSession: async () => { session.token = 'fresh-token'; return { data: { session: { access_token: 'fresh-token' } }, error: null } },
      signOut: async () => ({ error: null }),
    },
  },
}))

import { sbFetch, sbUpload } from '../supabase.js'

let calls

// The server accepts only the fresh token.
function serverWith(refusal) {
  global.fetch = vi.fn(async (url, options) => {
    calls.push({ url, options })
    const ok = options.headers.Authorization === 'Bearer fresh-token'
    if (ok) return { ok: true, status: 200, text: async () => '[{"id":"s1"}]' }
    return { ok: false, status: refusal.status, text: async () => refusal.body, clone() { return this } }
  })
}

beforeEach(() => {
  calls = []
  session.token = 'expired-token'
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('sbFetch with a token the server has expired', () => {
  it('renews it and completes the request instead of failing every call', async () => {
    serverWith({ status: 401, body: '{"code":"PGRST303","message":"JWT expired"}' })
    const rows = await sbFetch('sales', { method: 'POST', body: '{"total":100}' })
    expect(rows).toEqual([{ id: 's1' }])
    expect(calls.map(c => c.options.headers.Authorization)).toEqual(['Bearer expired-token', 'Bearer fresh-token'])
    // The retry is the same request, body and all.
    expect(calls[1].options).toMatchObject({ method: 'POST', body: '{"total":100}' })
    expect(calls[1].options.headers.apikey).toBeTruthy()
  })

  it('does not retry ordinary errors', async () => {
    session.token = 'fresh-token'
    global.fetch = vi.fn(async () => ({ ok: false, status: 400, text: async () => '{"message":"bad filter"}' }))
    await expect(sbFetch('sales?x=1')).rejects.toThrow('Supabase error (400): bad filter')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('sbUpload with a token the server has expired', () => {
  it("renews on Storage's InvalidJWT answer and uploads", async () => {
    serverWith({ status: 400, body: '{"statusCode":"403","error":"InvalidJWT","message":"\\"exp\\" claim timestamp check failed"}' })
    const url = await sbUpload('logos', 'a.png', new Blob(['x']), 'image/png')
    expect(url).toContain('/storage/v1/object/public/logos/a.png')
    expect(calls).toHaveLength(2)
  })

  it('leaves other Storage errors alone', async () => {
    serverWith({ status: 400, body: '{"statusCode":"413","error":"Payload too large"}' })
    await expect(sbUpload('logos', 'a.png', new Blob(['x']), 'image/png', 'Logo upload failed')).rejects.toThrow('Logo upload failed (400)')
    expect(calls).toHaveLength(1)
  })
})
