import { postWithSession } from './walletRequest'

// Bounds mirrored from api/_handlers/initiate-wallet-topup.js. The server is
// authoritative — these only shape the form's validation before we ask it for
// a checkout session.
export const MIN_TOPUP_KOBO = 10_000 // ₦100
export const MAX_TOPUP_KOBO = 10_000_000 // ₦100,000

// Starts a wallet top-up and hands back Paystack's hosted-checkout URL.
// The amount goes as whole kobo; the callback is where Paystack sends the
// owner back with an opaque reference to verify.
// -> { ok, data, sessionExpired?, networkError? }
export function initiateWalletTopup({ amountKobo, callbackUrl }) {
  return postWithSession('/api/initiate-wallet-topup', { amount: amountKobo, callback_url: callbackUrl })
}

// Confirms the reference Paystack sent the owner back with. Only the opaque
// reference crosses the wire — the amount and the credit are decided
// server-side after Paystack is asked, so an edited address bar cannot
// change what lands in the wallet.
// -> { ok, data, sessionExpired?, networkError? }
export function verifyWalletTopup(reference) {
  return postWithSession('/api/verify-wallet-topup', { reference })
}

// The processing fee rate the server will add to a top-up (a ratio, 0.1 = 10%). Nothing is created; the server still
// decides the charge. -> { ok, data: { fee_rate }, sessionExpired?, networkError? }
export function fetchTopupFeeRate() {
  return postWithSession('/api/initiate-wallet-topup', { quote: true })
}

// Leaves the SPA for Paystack's hosted checkout. Its own seam so tests can
// assert the hand-off without jsdom attempting a real navigation.
export function goToPaystack(authorizationUrl) {
  window.location.href = authorizationUrl
}
