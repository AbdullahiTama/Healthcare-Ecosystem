import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthApiError, AuthRefreshDiscardedError, AuthRetryableFetchError } from '@supabase/supabase-js'

// The module binds a default instance to the real client; every test below
// builds its own instance against a fake, so the real one is never touched.
vi.mock('../authClient.js', () => ({ authClient: { auth: {} } }))

import { createSessionFetch, clockSkewMs, SessionUnavailableError, SESSION_ENDED_MESSAGE, SESSION_UNREACHABLE_MESSAGE } from '../sessionFetch.js'
import { describeLag } from '../../components/layout/ClockSkewBanner.jsx'

function fakeAuth({ token = 'old', sessionError = null, refreshTo = 'new', refreshError = null } = {}) {
  let stored = token
  return {
    get stored() { return stored },
    getSession: vi.fn(async () => ({ data: { session: stored ? { access_token: stored } : null }, error: sessionError })),
    refreshSession: vi.fn(async () => {
      await Promise.resolve()
      if (refreshError) return { data: { session: null }, error: refreshError }
      stored = refreshTo
      return { data: { session: { access_token: refreshTo } }, error: null }
    }),
    signOut: vi.fn(async () => { stored = null; return { error: null } }),
  }
}

// Answers with each status in turn, recording the bearer of every request.
function fakeFetch(...statuses) {
  const bearers = []
  const fetchImpl = vi.fn(async (url, init) => {
    bearers.push(init.headers.Authorization)
    const status = statuses.length > 1 ? statuses.shift() : statuses[0]
    return { status, ok: status < 400 }
  })
  return { fetchImpl, bearers }
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })

describe('fetchWithSession', () => {
  it("sends the signed-in user's token and keeps the caller's headers", async () => {
    const auth = fakeAuth()
    const { fetchImpl, bearers } = fakeFetch(200)
    const { fetchWithSession } = createSessionFetch({ auth, fetchImpl })
    const res = await fetchWithSession('/x', { method: 'POST', headers: { apikey: 'k' } }, { anonToken: 'anon' })
    expect(res.status).toBe(200)
    expect(bearers).toEqual(['Bearer old'])
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { apikey: 'k' } })
    expect(auth.refreshSession).not.toHaveBeenCalled()
  })

  it('renews a token the server refuses and retries once, whatever the device clock says', async () => {
    // The production failure: getSession keeps returning a token the device
    // clock thinks is valid, and the server answers 401.
    const auth = fakeAuth()
    const { fetchImpl, bearers } = fakeFetch(401, 200)
    const { fetchWithSession } = createSessionFetch({ auth, fetchImpl })
    const res = await fetchWithSession('/x', {}, { anonToken: 'anon' })
    expect(res.status).toBe(200)
    expect(bearers).toEqual(['Bearer old', 'Bearer new'])
    expect(auth.refreshSession).toHaveBeenCalledTimes(1)
  })

  it('does not loop when the renewed token is refused too', async () => {
    const auth = fakeAuth()
    const { fetchImpl, bearers } = fakeFetch(401)
    const { fetchWithSession } = createSessionFetch({ auth, fetchImpl })
    const res = await fetchWithSession('/x', {}, { anonToken: 'anon' })
    expect(res.status).toBe(401)
    expect(bearers).toEqual(['Bearer old', 'Bearer new'])
    expect(auth.refreshSession).toHaveBeenCalledTimes(1)
  })

  it('shares one refresh between requests that fail together', async () => {
    const auth = fakeAuth()
    const fetchImpl = vi.fn(async (url, init) => ({ status: init.headers.Authorization === 'Bearer old' ? 401 : 200 }))
    const { fetchWithSession } = createSessionFetch({ auth, fetchImpl })
    const results = await Promise.all([1, 2, 3, 4].map(() => fetchWithSession('/x', {}, { anonToken: 'anon' })))
    expect(results.map(r => r.status)).toEqual([200, 200, 200, 200])
    expect(auth.refreshSession).toHaveBeenCalledTimes(1)
  })

  it('reuses an already-renewed token instead of rotating it again', async () => {
    const auth = fakeAuth({ token: 'new' })
    const { renewAccessToken } = createSessionFetch({ auth, fetchImpl: vi.fn() })
    await expect(renewAccessToken('old')).resolves.toBe('new')
    expect(auth.refreshSession).not.toHaveBeenCalled()
  })

  it('uses the anon key when nobody is signed in, and never renews it', async () => {
    const auth = fakeAuth({ token: null })
    const { fetchImpl, bearers } = fakeFetch(401)
    const { fetchWithSession } = createSessionFetch({ auth, fetchImpl })
    const res = await fetchWithSession('/x', {}, { anonToken: 'anon' })
    expect(res.status).toBe(401)
    expect(bearers).toEqual(['Bearer anon'])
    expect(auth.refreshSession).not.toHaveBeenCalled()
  })

  it('refuses to call a user-only endpoint without a session', async () => {
    const { fetchImpl } = fakeFetch(200)
    const { fetchWithSession } = createSessionFetch({ auth: fakeAuth({ token: null }), fetchImpl })
    await expect(fetchWithSession('/api/x')).rejects.toMatchObject({ name: 'SessionUnavailableError', ended: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never downgrades a signed-in user to anon when the session cannot be refreshed offline', async () => {
    const auth = fakeAuth({ token: null, sessionError: new AuthRetryableFetchError('Failed to fetch', 0) })
    const { fetchImpl } = fakeFetch(200)
    const { fetchWithSession } = createSessionFetch({ auth, fetchImpl })
    const err = await fetchWithSession('/x', {}, { anonToken: 'anon' }).catch(e => e)
    expect(err).toBeInstanceOf(SessionUnavailableError)
    expect(err.message).toBe(SESSION_UNREACHABLE_MESSAGE)
    expect(err.ended).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports an ended session when the server rejected the refresh during getSession', async () => {
    const auth = fakeAuth({ token: null, sessionError: new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found') })
    const { fetchWithSession } = createSessionFetch({ auth, fetchImpl: vi.fn() })
    await expect(fetchWithSession('/x', {}, { anonToken: 'anon' })).rejects.toMatchObject({ message: SESSION_ENDED_MESSAGE, ended: true })
  })

  it('signs this device out when the server refuses the refresh token', async () => {
    // e.g. the session was revoked: supabase-js would keep it while the
    // device clock still calls the access token valid.
    const auth = fakeAuth({ refreshError: new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found') })
    const { fetchImpl } = fakeFetch(401)
    const { fetchWithSession } = createSessionFetch({ auth, fetchImpl })
    await expect(fetchWithSession('/x', {}, { anonToken: 'anon' })).rejects.toMatchObject({ message: SESSION_ENDED_MESSAGE, ended: true })
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it("uses another tab's renewal instead of signing out when supabase-js discards ours", async () => {
    const auth = fakeAuth()
    auth.refreshSession = vi.fn(async () => {
      auth.getSession.mockResolvedValue({ data: { session: { access_token: 'from-other-tab' } }, error: null })
      return { data: { session: null }, error: new AuthRefreshDiscardedError() }
    })
    const { fetchImpl, bearers } = fakeFetch(401, 200)
    const { fetchWithSession } = createSessionFetch({ auth, fetchImpl })
    await fetchWithSession('/x', {}, { anonToken: 'anon' })
    expect(bearers).toEqual(['Bearer old', 'Bearer from-other-tab'])
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('keeps the session when the refresh only failed for lack of a connection', async () => {
    const auth = fakeAuth({ refreshError: new AuthRetryableFetchError('Failed to fetch', 0) })
    const { fetchImpl } = fakeFetch(401)
    const { fetchWithSession } = createSessionFetch({ auth, fetchImpl })
    await expect(fetchWithSession('/x', {}, { anonToken: 'anon' })).rejects.toMatchObject({ message: SESSION_UNREACHABLE_MESSAGE, ended: false })
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('lets the caller decide what counts as a refused token', async () => {
    const auth = fakeAuth()
    const { fetchImpl, bearers } = fakeFetch(400, 200)
    const { fetchWithSession } = createSessionFetch({ auth, fetchImpl })
    await fetchWithSession('/x', {}, { anonToken: 'anon', isAuthFailure: async (res) => res.status === 400 })
    expect(bearers).toEqual(['Bearer old', 'Bearer new'])
  })
})

describe('renewSession', () => {
  it('forces a refresh even while the device clock calls the token valid', async () => {
    const auth = fakeAuth()
    const { renewSession } = createSessionFetch({ auth, fetchImpl: vi.fn() })
    await expect(renewSession()).resolves.toBe('new')
    expect(auth.refreshSession).toHaveBeenCalledTimes(1)
  })

  it('does nothing when nobody is signed in', async () => {
    const auth = fakeAuth({ token: null })
    const { renewSession } = createSessionFetch({ auth, fetchImpl: vi.fn() })
    await expect(renewSession()).resolves.toBeNull()
    expect(auth.refreshSession).not.toHaveBeenCalled()
  })
})

function jwt(payload) {
  const enc = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return enc({ alg: 'HS256' }) + '.' + enc(payload) + '.sig'
}

describe('clockSkewMs', () => {
  const serverNow = 1793269277

  it('reads a clock running behind as a negative skew', () => {
    const deviceNow = (serverNow - 19 * 3600) * 1000
    expect(clockSkewMs({ access_token: jwt({ iat: serverNow }) }, deviceNow)).toBe(-19 * 3600 * 1000)
  })

  it('reads an older stored token as a positive skew, never as a clock running behind', () => {
    expect(clockSkewMs({ access_token: jwt({ iat: serverNow - 3000 }) }, serverNow * 1000)).toBe(3000 * 1000)
  })

  it('treats anything it cannot decode as no skew', () => {
    expect(clockSkewMs(null)).toBe(0)
    expect(clockSkewMs({ access_token: 'not-a-jwt' })).toBe(0)
    expect(clockSkewMs({ access_token: jwt({ sub: 'x' }) })).toBe(0)
  })
})

describe('describeLag', () => {
  it('speaks in minutes below an hour and a half, hours above', () => {
    expect(describeLag(10 * 60000)).toBe('about 10 minutes')
    expect(describeLag(60 * 60000)).toBe('about 60 minutes')
    expect(describeLag(2 * 3600000)).toBe('about 2 hours')
    expect(describeLag(19.2 * 3600000)).toBe('about 19 hours')
  })
})
