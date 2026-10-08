import { authClient } from '../../lib/authClient'

// Bounds mirrored from api/_handlers/initiate-wallet-topup.js. The server is
// authoritative — these only shape the form's validation before we ask it for
// a checkout session.
export const MIN_TOPUP_KOBO = 10_000 // ₦100
export const MAX_TOPUP_KOBO = 10_000_000 // ₦100,000

// Starts a wallet top-up and hands back Paystack's hosted-checkout URL.
// The amount goes as whole kobo; the callback is where Paystack sends the
// owner back with an opaque reference to verify.
// -> { ok, data, sessionExpired?, networkError? }
export async function initiateWalletTopup({ amountKobo, callbackUrl }) {
  const { data: { session } } = await authClient.auth.getSession()
  if (!session) return { ok: false, sessionExpired: true, data: {} }
  try {
    const res = await fetch('/api/initiate-wallet-topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ amount: amountKobo, callback_url: callbackUrl }),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, data }
  } catch {
    return { ok: false, networkError: true, data: {} }
  }
}

// Confirms the reference Paystack sent the owner back with. Only the opaque
// reference crosses the wire — the amount and the credit are decided
// server-side after Paystack is asked, so an edited address bar cannot
// change what lands in the wallet.
// -> { ok, data, sessionExpired?, networkError? }
export async function verifyWalletTopup(reference) {
  const { data: { session } } = await authClient.auth.getSession()
  if (!session) return { ok: false, sessionExpired: true, data: {} }
  try {
    const res = await fetch('/api/verify-wallet-topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ reference }),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, data }
  } catch {
    return { ok: false, networkError: true, data: {} }
  }
}

// Leaves the SPA for Paystack's hosted checkout. Its own seam so tests can
// assert the hand-off without jsdom attempting a real navigation.
export function goToPaystack(authorizationUrl) {
  window.location.href = authorizationUrl
}
