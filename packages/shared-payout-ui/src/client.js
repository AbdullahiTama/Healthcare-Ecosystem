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


// ---- Identity verification and saved payout accounts ------------------------------------------------------------------
// All POST + bearer token; the server decides who the owner is (never the body).
const post = (path, token, body = {}) => request(path, { method: 'POST', token, body })

export const kycStatus = ({ basePath = '/api', token }) => post(`${basePath}/kyc/status`, token)
/** BVN + NIN -> verified identity. The numbers are sent once and never kept by the app. */
export const kycVerify = ({ basePath = '/api', token, bvn, nin }) => post(`${basePath}/kyc/verify`, token, { bvn, nin })
export const kycSelfie = ({ basePath = '/api', token, bvn, selfieImage }) => post(`${basePath}/kyc/selfie`, token, { bvn, selfieImage })

export const listPayoutAccounts = ({ basePath = '/api', token }) => post(`${basePath}/payout-accounts/list`, token)
export const sendPayoutAccountOtp = ({ basePath = '/api', token }) => post(`${basePath}/payout-accounts/otp`, token)
export const addPayoutAccount = ({ basePath = '/api', token, bankCode, accountNumber, otp }) => post(`${basePath}/payout-accounts/add`, token, { bankCode, accountNumber, otp })
export const setDefaultPayoutAccount = ({ basePath = '/api', token, id }) => post(`${basePath}/payout-accounts/default`, token, { id })
export const removePayoutAccount = ({ basePath = '/api', token, id, pin }) => post(`${basePath}/payout-accounts/remove`, token, { id, pin })
