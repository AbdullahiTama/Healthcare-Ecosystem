import { isAuthApiError, isAuthRetryableFetchError, isAuthSessionMissingError } from '@supabase/supabase-js'
import { authClient } from './authClient.js'

// Session-aware fetch for every CareHub request that carries the signed-in
// user's token: PostgREST (sbFetch), Storage (sbUpload) and our own /api/*
// handlers.
//
// Why this exists (planning/CODE_AUDIT.md, "Idle sessions stop working"):
// supabase-js decides whether the access token is still valid by comparing its
// expires_at with the DEVICE clock. On a till whose clock is behind, it never
// refreshes: production logs on 2026-10-29 showed one shop PC sending the same
// token for up to 19 hours after the server had expired it. An hour after
// sign-in every request came back 401, the platform looked frozen, and staff
// logged out and back in to get another hour. The server is the authority on
// expiry, so a 401 here forces one refresh and one retry, whatever the device
// clock says.
//
// It also never downgrades a signed-in user to the anon key. sbFetch used to
// fall back to it whenever getSession() came back empty, so a refresh that
// failed (Wi-Fi still reconnecting after the laptop woke) ran the next queries
// as anon: RLS answered with empty lists and refused writes, and screens
// looked emptied rather than disconnected.

export const SESSION_ENDED_MESSAGE = 'Your session has ended. Please sign in again.'
export const SESSION_UNREACHABLE_MESSAGE = 'Could not renew your session. Check your internet connection and try again.'

export class SessionUnavailableError extends Error {
  constructor(message, { ended = false } = {}) {
    super(message)
    this.name = 'SessionUnavailableError'
    // true: the server rejected the session, signing in again is the only fix.
    // false: the session may be fine, we just could not reach the server.
    this.ended = ended
  }
}

// PostgREST and our /api handlers answer an expired or revoked token with 401.
export const isUnauthorized = (res) => res.status === 401

export function createSessionFetch({ auth, fetchImpl }) {
  let renewing = null

  // The signed-in user's access token, or null when nobody is signed in (the
  // login page, registration, invitation lookups). Throws when a session
  // exists but could not be refreshed: those requests must not run as anon.
  async function getAccessToken() {
    const { data, error } = await auth.getSession()
    if (data?.session?.access_token) return data.session.access_token
    if (error) {
      throw new SessionUnavailableError(
        isAuthRetryableFetchError(error) ? SESSION_UNREACHABLE_MESSAGE : SESSION_ENDED_MESSAGE,
        { ended: !isAuthRetryableFetchError(error) },
      )
    }
    return null
  }

  async function renew(staleToken) {
    // Another request may already have renewed it: the token it was sent
    // with is stale, the stored one is not.
    const current = await getAccessToken().catch(() => null)
    if (current && current !== staleToken) return current

    const { data, error } = await auth.refreshSession()
    if (data?.session?.access_token) {
      console.warn('[session] the server rejected the access token; renewed it and retried')
      return data.session.access_token
    }
    // Another tab may have renewed the session while this refresh ran
    // (supabase-js then discards ours rather than overwrite theirs).
    const latest = await getAccessToken().catch(() => null)
    if (latest && latest !== staleToken) return latest

    if (!isAuthApiError(error) && !isAuthSessionMissingError(error)) {
      // Network trouble or anything else short of the server saying no:
      // keep the session so the next request can try again.
      throw new SessionUnavailableError(SESSION_UNREACHABLE_MESSAGE)
    }
    // The server refused the refresh token itself (revoked, signed out
    // elsewhere, deleted user). supabase-js keeps the session when the
    // device clock says the access token is still valid, which on a slow
    // clock is always, so drop it here. The SIGNED_OUT event sends the user
    // to the login page instead of leaving a dashboard that cannot load.
    console.warn('[session] session refresh refused; signing out on this device', error?.code || error?.message)
    await auth.signOut({ scope: 'local' }).catch(() => {})
    throw new SessionUnavailableError(SESSION_ENDED_MESSAGE, { ended: true })
  }

  // Single flight: a dashboard fires about ten requests at once. When the
  // token is stale they all 401 together and must share one refresh, not
  // rotate the refresh token ten times.
  function renewAccessToken(staleToken) {
    if (!renewing) {
      renewing = renew(staleToken).finally(() => { renewing = null })
    }
    return renewing
  }

  // fetch() with "Authorization: Bearer <user token>". anonToken is what to
  // send when nobody is signed in; without one, signed-out calls throw (our
  // /api handlers all require a user). isAuthFailure decides which responses
  // mean "this token was refused" and earn one renewal and one retry.
  async function fetchWithSession(url, init = {}, { anonToken = null, isAuthFailure = isUnauthorized } = {}) {
    const token = await getAccessToken()
    if (!token && !anonToken) throw new SessionUnavailableError(SESSION_ENDED_MESSAGE, { ended: true })

    const send = (bearer) => fetchImpl(url, { ...init, headers: { ...init.headers, Authorization: 'Bearer ' + bearer } })
    const res = await send(token || anonToken)
    if (!token || !(await isAuthFailure(res))) return res

    return send(await renewAccessToken(token))
  }

  // Forces a refresh of the signed-in session, whatever the device clock says
  // about the current token. Used when the counter comes back from idle
  // (lib/resume.js), so the first tap afterwards is not the one waiting on a
  // renewal — and a session revoked meanwhile is found now, not mid-sale.
  // Resolves to null when nobody is signed in.
  async function renewSession() {
    const token = await getAccessToken()
    return token ? renewAccessToken(token) : null
  }

  // fetchWithSession for code that reads an HTTP answer rather than catching
  // an exception, such as the shared payout client
  // (@care-ecosystem/shared-payout-ui), which takes a fetchImpl. A session
  // that cannot be used becomes the answer such code already handles: 401
  // when it has ended, 503 when CareHub could not be reached, with the
  // user-facing message as `error`.
  async function fetchWithSessionResponse(url, init = {}, options = {}) {
    try {
      return await fetchWithSession(url, init, options)
    } catch (e) {
      if (!(e instanceof SessionUnavailableError)) throw e
      return new Response(JSON.stringify({ error: e.message }), {
        status: e.ended ? 401 : 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  return { getAccessToken, renewAccessToken, renewSession, fetchWithSession, fetchWithSessionResponse }
}

// Local clock minus server clock, in ms, read from the token's iat (the
// server's time when it minted the token). Only a clock running BEHIND can be
// read reliably this way: a token from storage may be an hour old, which looks
// like a clock running ahead, but no token is minted in the future. Callers
// therefore act only on large negative values.
export function clockSkewMs(session, now = Date.now()) {
  const iat = jwtIssuedAt(session?.access_token)
  return iat ? now - iat * 1000 : 0
}

function jwtIssuedAt(token) {
  try {
    const part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const iat = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '='))).iat
    return typeof iat === 'number' ? iat : null
  } catch (e) {
    return null
  }
}

// Late-bound, so tests that stub global.fetch are honoured.
export const { getAccessToken, renewSession, fetchWithSession, fetchWithSessionResponse } = createSessionFetch({
  auth: authClient.auth,
  fetchImpl: (...args) => fetch(...args),
})
