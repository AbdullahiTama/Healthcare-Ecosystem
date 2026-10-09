// Browser-side helpers for the payout endpoints. Framework-free: the apps keep
// their own UI and just call these. `getToken` returns the current Supabase
// access token (or null when signed out).

async function request(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, data: data || {} }
}

export function fetchBanks(basePath = '/api') {
  return request(`${basePath}/banks`)
}

// Server-side name lookup. The caller never supplies the account name.
// -> data: { accountName } | { error, unsupportedBank? }
export function resolveAccountName({ basePath = '/api', token, bankCode, accountNumber }) {
  return request(`${basePath}/resolve-account`, { method: 'POST', token, body: { bankCode, accountNumber } })
}

/** Email a 6-digit code (needed to set or replace the withdrawal PIN). */
export function sendPinOtp({ basePath = '/api', token }) {
  return request(`${basePath}/withdrawal-pin/otp`, { method: 'POST', token, body: {} })
}

export function setWithdrawalPin({ basePath = '/api', token, pin, otp, currentPin, forgot }) {
  return request(`${basePath}/withdrawal-pin/set`, { method: 'POST', token, body: { pin, otp, currentPin, forgot } })
}

