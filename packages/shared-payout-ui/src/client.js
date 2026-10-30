// Browser-side helpers for the payout endpoints. Framework-free: the apps keep
// their own UI and just call these. `getToken` returns the current Supabase
// access token (or null when signed out).
//
// `fetchImpl` (optional, default: the global fetch) lets an app route these
// calls through its own session-aware fetch. CareHub passes one that renews
// a refused token and retries once (apps/carehub/src/lib/sessionFetch.js);
// it sets Authorization itself, overriding the header built from `token`.

async function request(path, { method = 'GET', body, token, fetchImpl = (...args) => fetch(...args) } = {}) {
  const res = await fetchImpl(path, {
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
export function resolveAccountName({ basePath = '/api', token, bankCode, accountNumber, fetchImpl }) {
  return request(`${basePath}/resolve-account`, { method: 'POST', token, fetchImpl, body: { bankCode, accountNumber } })
}

/** Email a 6-digit code (needed to set or replace the withdrawal PIN). */
export function sendPinOtp({ basePath = '/api', token, fetchImpl }) {
  return request(`${basePath}/withdrawal-pin/otp`, { method: 'POST', token, fetchImpl, body: {} })
}

export function setWithdrawalPin({ basePath = '/api', token, pin, otp, currentPin, forgot, fetchImpl }) {
  return request(`${basePath}/withdrawal-pin/set`, { method: 'POST', token, fetchImpl, body: { pin, otp, currentPin, forgot } })
}


// ---- Identity verification and saved payout accounts ------------------------------------------------------------------
// All POST + bearer token; the server decides who the owner is (never the body).
const post = (path, token, fetchImpl, body = {}) => request(path, { method: 'POST', token, fetchImpl, body })

export const kycStatus = ({ basePath = '/api', token, fetchImpl }) => post(`${basePath}/kyc/status`, token, fetchImpl)
/** BVN + NIN -> verified identity. The numbers are sent once and never kept by the app. */
export const kycVerify = ({ basePath = '/api', token, fetchImpl, bvn, nin }) => post(`${basePath}/kyc/verify`, token, fetchImpl, { bvn, nin })
export const kycSelfie = ({ basePath = '/api', token, fetchImpl, bvn, selfieImage }) => post(`${basePath}/kyc/selfie`, token, fetchImpl, { bvn, selfieImage })

export const listPayoutAccounts = ({ basePath = '/api', token, fetchImpl }) => post(`${basePath}/payout-accounts/list`, token, fetchImpl)
export const sendPayoutAccountOtp = ({ basePath = '/api', token, fetchImpl }) => post(`${basePath}/payout-accounts/otp`, token, fetchImpl)
export const addPayoutAccount = ({ basePath = '/api', token, fetchImpl, bankCode, accountNumber, otp }) => post(`${basePath}/payout-accounts/add`, token, fetchImpl, { bankCode, accountNumber, otp })
export const setDefaultPayoutAccount = ({ basePath = '/api', token, fetchImpl, id }) => post(`${basePath}/payout-accounts/default`, token, fetchImpl, { id })
export const removePayoutAccount = ({ basePath = '/api', token, fetchImpl, id, pin }) => post(`${basePath}/payout-accounts/remove`, token, fetchImpl, { id, pin })
