import { fetchWithSession, fetchWithSessionResponse, SessionUnavailableError } from '../../lib/sessionFetch'

const NETWORK_ERROR = 'Network error. Check your connection and try again.'

// The one way the wallet and payout screens call our /api handlers with the
// signed-in session. They used to read getSession().access_token themselves;
// on a till whose clock is behind that token is already expired, and every
// call was refused until something else renewed the session.
//
// fetchWithSession renews a refused token and retries once. That retry is
// safe for money and PIN calls: every handler reached from here answers 401
// only when the token itself is refused (verifyBusiness), before any PIN or
// code check and before any money moves. A wrong PIN is 403, a wrong code
// 400, so a retry can never replay a PIN or code attempt.
//
// -> { ok, status, data, sessionExpired?, networkError? }
// `data.error` always carries something the owner can read when ok is false.
export async function postWithSession(path, body) {
  try {
    const res = await fetchWithSession(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  } catch (e) {
    if (e instanceof SessionUnavailableError && e.ended) {
      return { ok: false, status: 401, sessionExpired: true, data: { error: e.message } }
    }
    return { ok: false, status: 0, networkError: true, data: { error: e instanceof SessionUnavailableError ? e.message : NETWORK_ERROR } }
  }
}

// Options for the shared payout client (createPayoutManager,
// createAccountResolver in @care-ecosystem/shared-payout-ui). It builds its
// own requests, so it is handed the session-aware fetch, which sets
// Authorization itself; a separate token lookup would only read the same
// possibly-expired token. A session that cannot be used comes back as a
// 401/503 answer whose `error` the client already shows.
export const payoutClientOptions = {
  getToken: async () => null,
  fetchImpl: fetchWithSessionResponse,
}
