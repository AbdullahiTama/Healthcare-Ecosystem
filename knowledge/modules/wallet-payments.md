# Wallet & Payments — Business Domain

## Purpose
CareFind's internal currency/balance system and its connection to real-money payment via Paystack — funding a wallet, spending it (e.g., on gifts — see `subscriptions-monetization.md`), and withdrawing earned balances.

## Files
`apps/carefind/carefind-main/src/Wallet.jsx` (277 lines), `api/initiate-payment.js` (Vercel function, correctly placed), `paystack-webhook.js` (payment-confirmation handler — located at the project root, **not** inside `api/`, unlike every other serverless function in this codebase).

## Components
`Wallet.jsx` is a single component covering balance display, funding, and transaction history.

## Services
`api/initiate-payment.js`: server-side call to `https://api.paystack.co/transaction/initialize`, correctly keeping `PAYSTACK_SECRET_KEY` out of the browser. `paystack-webhook.js`: verifies the Paystack HMAC signature (`crypto.createHmac('sha512', PAYSTACK_SECRET_KEY)`) and idempotently credits `wallets.balance` on a confirmed `charge.success` event, checking `transactions` for an existing `reference` before crediting twice.

## Dependencies
`lib/supabaseClient.js`, `lib/AuthContext.jsx`. `paystack-webhook.js` requires a live callback from Paystack's servers to CareFind's deployment.

## Database Tables
`wallets` (`user_id, balance`), `transactions` (`user_id, type, amount, naira_amount, reference, status`), `withdrawal_requests`.

## Current State
`initiate-payment.js` and the webhook's signature-verification/crediting logic are both correctly implemented — the webhook is, on inspection, the single best-built piece of security-sensitive code in either product. **Its deployment location is anomalous**: it sits at `apps/carefind/carefind-main/paystack-webhook.js` rather than under `api/`, where Vercel's file-based routing convention expects serverless functions to live, and the project's `vercel.json` only rewrites `/api/(.*)`. Whether this file is actually reachable as a live webhook endpoint in the deployed application could not be confirmed from the repository.

## Missing Documentation
No document confirms `paystack-webhook.js`'s actual deployment status or reachable URL — this is a live open question requiring access to the Vercel project configuration, not resolvable from source. If the webhook is not reachable, wallet crediting on successful payment would not occur despite `initiate-payment.js` successfully starting the transaction, and no document anywhere flags this as a risk.
