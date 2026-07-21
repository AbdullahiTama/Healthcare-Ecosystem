// Canonical source of truth for what a CareCoins top-up package actually
// costs. initiate-payment.js looks packages up here by id rather than
// trusting a client-supplied naira amount — Wallet.jsx's own copy of this
// list (apps/carefind/src/modules/wallet-payments/Wallet.jsx) is display
// data only and must stay in sync with this one, but is never the source
// the server charges against.
export const TOPUP_PACKAGES = {
  1: { coins: 1, naira: 200 },
  5: { coins: 5, naira: 950 },
  15: { coins: 15, naira: 2700 },
  50: { coins: 50, naira: 8500 },
}
