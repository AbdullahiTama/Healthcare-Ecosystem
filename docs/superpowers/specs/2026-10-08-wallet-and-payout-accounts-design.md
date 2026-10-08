# Wallet Top-Up, Ecosystem Spend, Saved Payout Accounts & PIN-OTP — Design

Date: 2026-10-08
Status: DRAFT for owner review (spec self-reviewed 2026-10-08)
Related: `docs/architecture/{Withdrawal-Engine,CareCoin-Wallet,CareHub-Payment-Flows,Refund-Engine}.md`, `planning/financial-system/00-master-plan.md` (Phase 16 candidate)

## 1. Goals

1. Businesses on CareHub and users on CareFind can **top up** their wallets by card (Paystack).
2. Both sides can **spend wallet balance inside the ecosystem**: CareFind bookings / subscriptions / consultations / shop orders; CareHub plan renewals / per-appointment platform fees.
3. Users and businesses can **save multiple verified payout accounts**, one marked default.
4. Withdrawal **PIN set/change is gated by an emailed OTP**; change additionally needs the current PIN.
5. Verification today is **free**: Paystack account-name resolution + BVN/NIN format validation + storage for later provider review. No billed KYC API yet (see §6).
6. Every CareCoin that is withdrawable must carry **provenance**: traceable to a settled payment or an allowed internal source, never a client-supplied number (see §5).

## 2. What already exists (reuse, don't rebuild)

| Capability | Today |
|---|---|
| Bank directory (UBA, Zenith, GTBank, Sterling, Jaiz, PalmPay, OPay, Moniepoint MFB…) | `/api/banks` — Paystack paginated list merged with curated majors (`apps/carefind/api/_handlers/banks.js:10`) |
| Account-name resolution | `/api/resolve-account` via Paystack (`apps/carefind/api/_lib/paystackTransfer.js:67`) |
| CareFind CareCoin wallet | integer balance, append-only `coin_ledger`, posting primitive `_post_coin_entry`, card top-up path, gift/booking/subscription/consultation spend |
| Business wallets (CareHub) | `business_wallets` (held/available kobo), credited from card settlements, withdrawn via `create_business_withdrawal` |
| Withdrawal engine | atomic reservation, rolling caps, states `reserved→processing→completed→reversed→failed→refunded`, `/api/withdrawal-pin/{status,set}`, `initiate-business-withdrawal` |
| Email outbox | shared `finance_alert` / email cron — OTP delivery reuses it |

## 3. Payout accounts (new)

Tables (server-only, no client writes, RLS on, zero policies; same pattern as `payment_intents`):

* `payout_accounts` — `id`, `owner_user_id` or `owner_business_id`, `bank_code`, `bank_name`, `account_number`, `account_name`, `status` (`pending_review | verified | failed`), `verified_at`, `bvn_last4`, `nin_last4` (last-4 only; full BVN/NIN encrypted at rest for a future provider check, never logged), `created_at`.
* `payout_account_events` — append-only audit (add/verify/fail/set_default/remove).

Rules:

* Adding an account: Paystack name resolution must succeed (typed name must match, same rule as withdrawals); BVN/NIN validated for format (11 digits) and **stored for review**; `status = pending_review`. It can be used for a withdrawal only after admin approval flips it to `verified`; the default can only point at a `verified` account.
* Default selection and default removal require **current PIN + fresh email OTP**.
* Editing bank/account number resets the row to `pending_review` and keeps the old default until re-verified.
* Shared across CareFind and CareHub by owner (one person, one set of saved accounts — same as the one-PIN-per-person rule).
* Replacing details requires the current PIN as well, so a stolen session alone cannot redirect withdrawals.

## 4. PIN + email OTP

* `POST /api/withdrawal-pin/otp/request` — rate-limited (3/hour), emails a 6-digit code to the confirmed account email (shared outbox), stores hash + 10-minute expiry + attempt counter server-side.
* `POST /api/withdrawal-pin/set` — body `{ pin, otp }`; if a PIN already exists, `currentPin` is also required; forgot-PIN = OTP only.
* Effects: CareFind's set endpoint gains the current-PIN check (closes F-32); CareHub's forgot-PIN path is now OTP instead of "not possible".
* OTP verification is single-use, 5 attempts, then burn.

## 5. Wallet spend & provenance hardening

Spend paths (new intent purposes on the existing settlement engine, same invariants — integer money, atomic posting, replay-safe unique reference, `needs_refund` instead of dropped money):

* `booking_wallet`, `subscription_wallet`, `consultation_wallet` (CareFind): migrate the legacy coin RPCs onto intents so every spend has an `payment_intents` row and one audit trail (ledger rows and RPC contracts unchanged).
* `shop_order_wallet` (CareFind): buyer debited in CareCoins; vendor credited `subtotal − 20%` in kobo at the fixed rate.
* `plan_renewal_wallet` (CareHub): business wallet debited the server-computed plan price in kobo; renewal extension uses the existing `renew_business_plan` under the same lock.
* `appointment_fee_wallet` (CareHub): business wallet pays the platform's per-appointment fee in kobo (new `financial_config` key, commercial value TBD by owner — Phase 06's card-split 20% remains the default settlement path).

**Provenance requirement (new):** the withdrawal reservation now verifies that the debited coins' source is traceable — each `coin_ledger` credit must carry a `kind` whose `reference` resolves to either a settled `payment_intents` row or an allowed internal kind (`gift_received`, `refund`, `opening_balance`, `adjustment`). Credits without a traceable source are **quarantined**: visible in history but excluded from withdrawable balance and flagged to admin (`wallet.needs_attention`). This blocks wallet inflation by hacked clients and makes every withdrawn coin auditable end-to-end. Business wallets already have the equivalent: credits only from `settle_payment_intent`/refunds with provider-verified references.

**Why the wallet is not "just numbers in a table":**

* Balances change **only** through the Postgres posting primitives; every API role has INSERT/UPDATE/DELETE revoked on `wallets`/`business_wallets`; a trigger refuses any direct balance write.
* The ledger (`coin_ledger`, append-only, unique `(user, kind, reference)`) is the source of truth; `reconcile_coin_wallets()` / `verify_coin_ledger_chain()` prove balance == Σ ledger.
* There is no endpoint that accepts a balance from a client; every amount is re-computed server-side from `financial_config`.
* Top-ups settle only from provider-confirmed `charge.success` via the same engine that settles bookings/orders.
* BVN/NIN/PIN are hashed or last-4 only at rest; OTP and PIN failures are attempt-capped and logged.

## 6. Verification provider seam (no billing right now)

* `VerificationProvider` interface in `packages/shared-payments` with a fake/test implementation and a future Youverify/Prembly adapter slot. No live billed calls in this phase; accounts stay `pending_review` until an admin approves in the admin console. A config flag flips to the live provider later without schema change.

## 7. Migrations, tests, reconciliation

* New migrations (PGlite-tested, production-shaped fixtures, ACLs asserted): `payout_accounts` + events, OTP table, `paid_by_wallet` intent purposes + provenance check in the reservation, `wallet_topup` for businesses, provenance reconcile (`reconcile_coin_provenance()`).
* Concurrency tests for wallet debits (overlapping spends, cap races), provenance-block tests (a forged credit cannot withdraw), OTP rate-limit/lockout tests, default-flip-requires-PIN+OTP tests.
* Reconciliation findings integrated with `run_db_reconciliation()`; any quarantined coin or review-stuck account appears as a finding.

## 8. Open decisions for the owner

* Per-appointment platform fee amount/`financial_config` key (commercial value).
* Admin approval queue UX for `pending_review` accounts.
* Whether CareFind coin spend on shop converts at exactly the withdrawal rate (₦200/coin) or a separate rate.
* Whether to keep the legacy coin RPCs alongside intents during a transition window (recommended: dual-path for one release).

## 9. Explicitly out of scope

* Live BVN/NIN API calls (billing) — seam only.
* Image/credential upload for KYC (deferred; format + review today).
* Changing the 20% commercial rules.
