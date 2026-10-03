# Financial Architecture Audit — Phase 00 (Baseline)

Date: 2026-10-03 · Scope: `apps/carefind`, `apps/carehub` · Mode: read-only, no production logic changed.
Live DB inspected: Supabase `szdybxmgmhndoytqanfb` (function bodies, ACLs, constraints only).

## 0. Coverage and honesty statement

| Area | Status |
|---|---|
| CareFind API handlers (topup, subscription, consultation, booking, shop, withdrawal, webhook, cron) | **Read in full** |
| CareHub API handlers (plan, appointment, business withdrawal, commissions, reconcile cron) | **Read in full** |
| Live `SECURITY DEFINER` bodies: `credit_wallet_topup`, `settle_subscription_payment`, `settle_consultation_payment`, `settle_card_booking`, `pay_booking_with_credits`, `pay_creator_subscription`, `pay_professional_consultation`, `send_gift`, `request_withdrawal`, `reject_withdrawal_request`, `request_business_withdrawal` (both overloads), `reject_business_withdrawal`, `refund_business_withdrawal`, `refund_appointment_payment`, `fn_credit_business_booking`, `renew_business_plan`, `mark_payout_paid`, `confirm_pos_payment`, `confirm_transfer_payment` | **Read live** |
| Live ACLs (`proacl`) and `search_path` for all financial RPCs | **Read live** — every one has `search_path=public`; none grants `anon` |
| Live CHECK/UNIQUE/FK constraints on 12 financial tables | **Read live** |
| **Live RLS policies and table DML grants on financial tables** | **NOT VERIFIED.** The catalog query was blocked by the tool-permission classifier; not retried. Must be done before Phase 05/14. |
| Not read: `verify_shop_payment`, `claim_payment_event`, `book_appointment_slot`, `approve_withdrawal_request`, `complete_withdrawal_transfer`, `get_withdrawal_trust`, `calculate_shop_commission`, `guard_appointment_payment_columns`, shop vendor-settlement logic, `agent_earnings`/`payout_requests` creation, indexes, `list_migrations` drift check, advisors | **Open — carry into Phase 01/05** |
| `planning/ROADMAP.md`, `planning/CODE_AUDIT.md`, `docs/PROJECT_OVERVIEW.md` (required by CLAUDE.md) | **Do not exist in this repo.** Only `README.md` and `AGENTS.md` were available. |

No exploit was executed. One rollback-only behavioural probe was run (F-13).

## 1. Current financial flows (as built)

Two money systems that must never be mixed:
* **Card money (kobo, Paystack)** — shop orders, appointments, CareHub plans, business wallets.
* **CareCoin (integer coins, ₦200 = 1 coin, hard-coded in JS and SQL)** — CareFind wallets, gifts, subscriptions, consultations.

```
TOPUP        client → initiate-payment (pkg from server table) → Paystack
             → verify-payment (redirect) | paystack-webhook → credit_wallet_topup (claim ref, credit)
SUBSCRIPTION client → charge-subscription (priceCoins FROM CLIENT) → Paystack
             → verify-subscription-payment | webhook → settle_subscription_payment (creator credited)
             coins path: client → rpc pay_creator_subscription(p_creator, p_price FROM CLIENT)
CONSULTATION client → charge-consultation (fee from professional_consultations) → Paystack
             → verify-consultation-payment | webhook → settle_consultation_payment
             coins path: rpc pay_professional_consultation
CF BOOKING   card: verify-booking-payment | webhook(handleBooking) → settle_card_booking → fn_credit_business_booking (80% held / 20% platform)
             coins: rpc pay_booking_with_credits → same fn_credit_business_booking
CH APPT      initiate-appointment-payment → Paystack → verify-appointment-payment | CareFind webhook(handleBooking) → settle_card_booking
CH PLAN      initiate-plan-payment (price from planLimits.js) → Paystack
             → verify-plan-payment | CareFind webhook(handlePlanPayment) → renew_business_plan
             → computeCommission (JS, separate step; webhook path relies on daily reconcile cron)
SHOP         initiate-shop-payment (total_kobo) → Paystack → verify-shop-payment | webhook(handleShopOrder)
             → verify_shop_payment RPC → fallback settle_shop_payment (does NOT exist live) → fallback raw UPDATE
WITHDRAWAL   CF: initiate-withdrawal → [PIN|deviceToken] → request_withdrawal (debit) → Paystack transfer → webhook/cron
             CH: initiate-business-withdrawal → request_business_withdrawal (reserve) → Paystack transfer → webhook/cron
REFUND       refund_appointment_payment (coins only), reject_*_withdrawal (transfer failure), shop duplicate = log + ledger flag only
```

One Paystack webhook (CareFind app) serves both apps and dispatches **by guessing from metadata shape** (`purpose`, `appointment_id`, `order_id`, `business_id+months`, then top-up fallthrough).

## 2. Findings

Severity scale: CRITICAL = unauthorised/duplicate money movement possible; HIGH = material loss, bypass of a control, or large data exposure; MEDIUM = integrity/ops risk; LOW = hygiene.
"Status" says whether I verified it in code/live DB or inferred it.

### CRITICAL

**F-01 — Withdrawal reference reuse + replay-OK RPC can pay out without debiting (CareFind and CareHub)**
* Files: `carefind/api/_handlers/initiate-withdrawal.js:103-116`, `carehub/api/_handlers/initiate-business-withdrawal.js:46-59`
* RPC: `request_withdrawal(…p_reference…)`, `request_business_withdrawal(…p_reference)`; live bodies begin with `if exists (… paystack_reference = p_reference and status in ('pending','processing')) then return 'ok'` — **before** any balance check or debit.
* Problem: the handler picks the user's *latest pending row with no transfer code* and reuses its reference for the **new** request (a "latest-row lookup"). The RPC then sees that reference, returns `'ok'` without debiting, and the handler initiates a Paystack transfer for the **new** amount/bank under the old reference. The pre-check only tests `wallet.balance >= coins`, so the new amount is bounded only by the balance; the daily cap lives inside the skipped RPC branch too.
* Scenario: request A (small) is inserted; before A attaches its transfer code, request B (large) runs its `prior` lookup, reuses A's reference, is not debited, and its transfer is the one Paystack accepts. A's own transfer is then rejected as a duplicate reference → `paystackRejected` → A is **refunded**. Net: payout of B, debit of nothing. Also reachable without a race after any ambiguous failure (timeout) that leaves a row pending with no code.
* Impact: payout up to the whole wallet balance while the balance is retained; repeatable; bypasses daily cap. Money leaves via Paystack, not just ledger.
* Status: logic verified from source + live RPC bodies; **race not executed**. Treat as exploitable until disproved.
* Recommendation (Phase 08): reference must be generated server-side *per request row* and stored by the RPC; the RPC must return the existing row only when amount, bank and user all match; no "latest-row" lookup anywhere; state machine `requested → reserved → processing → …`.

**F-24 — CRITICAL (static evidence; behaviour NOT probed): direct client writes to money tables via RLS + table grants** (live catalog read 2026-10-03, `szdybxmgmhndoytqanfb`)
* `authenticated` (and `anon`, though policies scope to user ids) hold table-level INSERT/UPDATE/DELETE on every financial table, and **no triggers exist** on `wallets`, `transactions`, `withdrawal_requests`, `withdrawal_trust`, `business_wallets`, `business_wallet_transactions`, `business_withdrawal_requests`, `agent_earnings`, `creator_subscriptions`, `gifts`. The only guards are the RLS policies:
  * `business_wallets`, `business_wallet_transactions`, `business_withdrawal_requests`: policy `ALL` for `business_id IN current_business_ids()` → a business owner/staff can UPDATE `available_balance` directly, then withdraw it. CareHub wallet integrity rests on nothing else.
  * `wallets`: INSERT allowed for own `user_id` (two policies) with no balance restriction → a user with no wallet row can insert one with any balance. (Existing rows cannot be UPDATEd: there is no UPDATE policy.)
  * `withdrawal_requests`: own INSERT/UPDATE/DELETE → a user can plant a `pending` row with a chosen `paystack_reference`; `initiate-withdrawal` then reuses it (F-01) and `request_withdrawal` returns `'ok'` without debiting. This turns F-01 from a race into a deterministic exploit.
  * `withdrawal_trust`: `ALL` own → a user can set their own `trust_level`, `device_trust_enabled` (F-02) and raise their daily cap.
  * `transactions`: own INSERT/UPDATE/DELETE → the CareCoin ledger is user-editable; a user can pre-claim a `topup`/`consultation_payment` reference (partial unique index) so the real credit is skipped as "already processed", or delete evidence.
  * `agent_earnings`: `ALL` for the agent matched by `contact_email = auth.email()` → an agent can write their own `amount_owed`; `mark_payout_paid` then settles it.
  * `creator_subscriptions`: own UPDATE → free extension of `expires_at`; `gifts`: own INSERT → forged gift rows.
* Probe status: a rollback-only write test was **blocked by the tool-permission classifier and not retried**. Evidence is policy text + trigger/grant catalogs, so exploitability is *inferred, not demonstrated*. It is nonetheless the most likely root cause class of every "free money" scenario in this audit.
* Fix class (Phase 05/08 or earlier): `REVOKE INSERT, UPDATE, DELETE` on these tables from `anon, authenticated`; drop the write policies; keep SELECT policies; all mutation via service-role RPCs. Check the CareFind and CareHub front-ends for any direct `.from('<table>').insert/update` first so nothing legitimate breaks.

### HIGH

**F-02 — Withdrawal "device trust" never validates the token (PIN bypass)**
* `carefind/api/_handlers/initiate-withdrawal.js:35`: `hasDeviceTrust = deviceToken && trust?.device_trust_enabled`. `deviceToken` is any truthy string; it is never compared to `withdrawal_trust_devices.device_id`.
* Scenario: anyone holding a session JWT for an account with `device_trust_enabled` withdraws with `deviceToken:"x"` and no PIN. The PIN is the only second factor against a stolen session.
* Impact: full wallet withdrawal (subject to trust-level daily cap) from a session compromise. Recommendation: bind device tokens server-side (hashed, per-user, expiring), verify in the handler, or remove device trust.

**F-03 — `wallet-transactions` leaks any business's wallet and ledger to any signed-in user**
* `carefind/api/_handlers/wallet-transactions.js:19-30`: comment says "verify the user owns this business", code only checks the business *exists*. Uses service role.
* Impact: read `held_balance`, `available_balance` and 100 ledger rows (booking amounts, appointment ids) for any `business_id`. Recommendation: ownership/admin check via the same logic as `verifyBusiness`/RLS.

**F-04 — Creator subscription price is client-controlled (both payment paths)**
* Card: `charge-subscription.js:22-32` takes `priceCoins` (1-12) from the body; `settle_subscription_payment` credits whatever `p_price` it is handed. Coins: `pay_creator_subscription(p_creator, p_price)` is `authenticated`-callable with a caller-chosen price (> 0 only).
* Impact: a creator who charges 12 coins can be subscribed for 1 (₦200). No server-side creator price is consulted. Recommendation (Phase 04): server reads the creator's offer.

**F-05 — First-payment determination is not atomic → duplicate 40% commissions; commission is a separate non-atomic step**
* `renew_business_plan` does `select count(*) … ` then inserts the payment, no lock on the business row until later. Two concurrent first payments (different references) both get `is_first_payment = true`; `UNIQUE(payment_id)` stops duplicates *per payment*, not per business → two 40% `referral_bonus` rows.
* `computeCommission` runs in JS after settlement (`verify-plan-payment.js:74-85`). If the process dies, or settlement came through the webhook, commission waits for the cron backstop (`commissionReconcile.js`: 90-day window, `limit 200`, only the first 1000 referred businesses, ordered oldest-first → silently starves newer payments at scale).
* Impact: overpaid agent commissions (financial), missed commissions (liability). Rates (40%/5%) are correct in `referral_program.js`; they are not the bug.

**F-06 — Card booking is accounted in rounded-up CareCoin value**
* `settle_card_booking`: `v_coins := ceil(fee_kobo/20000)`, `rounded = coins*20000`, platform 20% of the rounded figure, business credited `rounded - platform`. The customer paid the *actual* fee.
* Impact: business is credited more than 80% of what was paid (up to ₦199 per booking); platform books commission on money it never received. Violates "do not mix the two accounting systems".
* Related: `refund_appointment_payment` always refunds in **coins** (`patient_user_id` is only set by the coins path). A card-paid booking refund debits the business wallet and refunds nobody; the 5-line `else null` branch refunds without debiting if the business has already withdrawn (ledger shows `-amount`, wallet unchanged).

**F-07 — Money received with no settlement path and no automated refund**
* `settle_consultation_payment`: reference is claimed in `transactions` *before* the booking insert; if the patient already booked, it returns `already_booked` — card money taken, nothing delivered, no refund record. `settle_card_booking` returns `already_paid` for an appointment already paid by coins/other card — same. Shop duplicate payments are logged and flagged in `shop_payments.gateway_response` only.
* Impact: customers charged twice with manual-only recovery; no refund state machine exists.

**F-08 — CareHub business withdrawals lack the controls CareFind has**
* `initiate-business-withdrawal.js`: no PIN, no trust tier, no daily cap, **no account-name resolution** (typed `accountName` goes straight to the Paystack recipient), amount is client-supplied kobo with no minimum or fee. A session compromise (or a business staff session mapped to the owner email) drains the wallet to an attacker's bank.
* Compounded by F-09.

### MEDIUM

**F-09 — `verifyBusiness` matches the owner by `ilike(email)` with unescaped user-controlled pattern**
* `carehub/api/_lib/verifyBusiness.js:21-25`. `_` and `%` in an auth email are wildcards. An attacker who legitimately owns `j_hn@provider.com` matches `john@provider.com`'s business (only if exactly one row matches; `maybeSingle` errors on several). Identity-by-email is the root weakness (no `owner_id`). Impact grows with F-08. Fix: `eq` on lower-cased email, or an owner FK.

**F-10 — No amount/currency verification against the *expected* amount for top-up, subscription, consultation, plan**
* Booking, appointment and shop compare Paystack's amount to a stored value. Top-up/subscription/consultation/plan trust metadata written at initialize time and credit `metadata.coins` irrespective of `amount`; `currency` is checked nowhere in either app. Safe only while no other writer can create transactions with that metadata on the account. There is no `payment_intents` table to bind reference → expected amount.

**F-11 — Webhook design**
* `paystack-webhook.js`: signature is verified correctly (raw body, HMAC-SHA512, `timingSafeEqual`). But: dispatch by metadata shape (a crafted/legacy transaction falls through to the top-up handler); unknown `charge.success` is acknowledged silently; no persisted event log, no replay window, no `event.id` idempotency (idempotency is per-reference only); `JSON.parse` unguarded (malformed body → 500 retry storm); `transfer.reversed` after `completed` is ignored (`reject_*` only act on pending) so a reversed payout is never recredited; CareHub has no webhook of its own and depends on CareFind's deployment.
* Handlers in the webhook swallow RPC errors with `return null` (`handleSubscription`, `handleBooking`, `handlePlanPayment`) → falls through to the next handler and finally acknowledges 200, so a transient DB error permanently loses the settlement until someone reconciles manually (no reconciliation exists for those).

**F-12 — Provider client has no timeout, retry policy, rate-limit handling or correlation ID** (`_lib/paystack.js` in both apps; `paystackFetch` is a bare `fetch`). A hung call holds a serverless slot and, in withdrawal flow, leaves the debited-not-sent state to the 10-minute grace sweep. Secret is not leaked (key prefix check prints 3 chars).

**F-13 — `send_gift` accepts any `p_coins`** (no `> 0` check). Verified with a rolled-back probe: a negative gift is blocked **only** by the `wallets_balance_nonnegative` CHECK firing on the proposed INSERT tuple — accidental protection. `gifts` and `transactions` have no CHECK on `coins/amount`. If that CHECK is ever dropped or the recipient row logic changes, this is an unauthenticated-equivalent wallet drain. (This is the C15 family — see memory.) Add explicit validation.

**F-14 — Shop settlement falls back to direct table updates**
* `verify-shop-payment.js:106-145` and webhook `:362-390`: if `verify_shop_payment` errors for *any* reason (including a transient failure) the code tries `settle_shop_payment` (which does not exist live) and then raw-updates `shop_orders`, skipping whatever the RPC does (stock, vendor accounting, events). Two definitions of settlement. Need to read `verify_shop_payment` to know what is skipped.

**F-15 — Appointment payment reference is reused** (`initiate-appointment-payment.js:25`): after an abandoned attempt Paystack rejects the same reference ("duplicate reference"), so the retry path is broken; the stored reference is also written before Paystack accepts it.

**F-16 — Overlapping `request_business_withdrawal` overloads** (5-arg and 6-arg both live, service_role only). The 5-arg one has no replay protection. Trap from the engagement's known `CREATE OR REPLACE` sibling issue; drop the old one.

**F-17 — Non-reconcilable CareCoin ledger.** `wallets.balance` is mutated directly alongside `transactions` inserts, with no balance snapshot, no per-row sign convention (withdrawal debit stored positive, gifts negative, topup positive), `transactions.reference` is unique only per `type` via partial indexes, and gift/subscription/booking rows are partially unreferenced. `wallets.balance` is `numeric` while `transactions.amount` is `integer`. There is no job that proves `wallets.balance = Σ ledger`.

**F-18 — Hard-coded commercial constants duplicated across languages** (₦200/coin, 20% platform, 20% withdrawal fee in `initiate-withdrawal.js`, `20000` in SQL, plan prices in `planLimits.js`, creator max 12 coins). One drift = mispriced money. Move to one server-owned config table.

### LOW

* **F-19** — Mixed units in one schema: `transactions.naira_amount` = naira, `appointments.fee_amount` = kobo, `shop_orders.*_kobo`, `plan_payments.naira_amount` = naira, `consultation fee` = naira `numeric`. Conversions are scattered (`Math.round(amount/100)`).
* **F-20** — `settle_consultation_payment` credits `ceil(fee/200)` coins for a ₦ fee: professional over-credited by up to ₦199 and no platform commission is taken on card consultations (check against commercial intent).
* **F-21** — Cron endpoints: `check-subscription-expiry.js` authenticates only if a token is supplied (anonymous call allowed). It only enqueues emails, so low; the money crons correctly fail closed.
* **F-22** — Migration drift risk: the same SQL exists in `apps/*/sql`, `supabase/migrations`, and `supabase/seeds` (e.g. `carefind_wallet_payment_hardening.sql` under *seeds*). Live drift not yet checked (`list_migrations` not run).
* **F-23** — `paystack-webhook.js` is the only file where CareFind/CareHub logic is entangled; `packages/shared-email/test_*.txt` stray files and `preview.log` are untracked noise (not financial).

### Added after the first pass

**F-25 — MEDIUM — `cancel-appointment` trusted the caller's role** (`carefind/api/_handlers/cancel-appointment.js`). No authentication; `cancelled_by:"owner"` came from the body and skipped the patient's 24h/past-appointment rules. *Fixed:* the owner role now needs a verified owner session (`_lib/businessOwnership.js`, shared with F-03), covered by `cancel-appointment.test.js`. Deliberately unchanged: the patient role stays capability-based (bookings can be anonymous; the appointment UUID is the credential). *Still open, Phase 09:* the refund branch is dead code (`created_at` is never selected, so `hoursSinceCreation` is NaN) and, if revived, would file a fake "refund" withdrawal through the 5-arg `request_business_withdrawal`; a patient cancelling a card-paid appointment gets no refund.

**Fix status (2026-10-03):** F-01 handler side (`99ac657`), F-02 (`d6a8b4c`), F-03 (`a026364`), F-25 owner role — committed with tests. **F-24 migration APPLIED to production** (`20261003185456 carefind_20261003_lock_money_tables_to_server_writes`, tracked in `schema_migrations`). Post-apply catalog read confirmed: zero table-level INSERT/UPDATE/DELETE/TRUNCATE grants for `anon`/`authenticated` on the 10 tables except `authenticated:INSERT` on `wallets` (policy requires own `user_id` and `balance = 0`) and column-level `UPDATE(auto_renew)` on `creator_subscriptions`; only SELECT policies remain on the money tables. Not behaviourally probed (a write probe was blocked), so the claim rests on catalog state. F-01's database-side replay branch (`request_withdrawal` / `request_business_withdrawal` return `'ok'` for a known reference) remains until Phase 08, but a client can no longer plant the pending row it needed.
Note: the live migration list already contained `financial_phase0_lockdown`, `financial_medium_hardening` and `withdrawal_daily_cap` (2026-10-02/03) from earlier work; this audit did not account for their content beyond the live function bodies it read.

**F-26 — LOW/MEDIUM (suspected, found in Phase 03) — withdrawal balance pre-check may never block.** `paystackTransfer.checkBalance()` (both apps) sums `b.available_balance` over every currency. I believe Paystack's `GET /balance` returns the figure as `balance`; if so the sum is `NaN` and `available < amountKobo` is always false, so the "provider balance low" guard never fires. Unverified against a live account — check one real `/balance` response. The new `PaystackProvider.getBalance` reads `balance ?? available_balance` for the requested currency only.

### Verified OK (so they are not re-opened)

* All financial RPCs inspected: `search_path=public`; `EXECUTE` is `service_role` (and `postgres`) except the intended user RPCs (`send_gift`, `pay_creator_subscription`, `pay_professional_consultation`, `book_appointment_slot`, `confirm_pos_payment`, `confirm_transfer_payment`, `mark_payout_paid`, `claim_payment_event`, `get_withdrawal_trust`). `credit_wallet_topup` is **not** callable by `anon`/`authenticated` (C17 is closed). No sibling overloads except F-16.
* `send_gift` and `pay_*` derive the caller from `auth.uid()`; `confirm_pos_payment`/`confirm_transfer_payment` check `current_business_ids()`/`is_platform_admin()`; `mark_payout_paid` checks `service_role`/admin.
* Reference claims are atomic where used: `credit_wallet_topup`, `settle_subscription_payment`, `settle_consultation_payment` (partial unique indexes), `renew_business_plan` (`plan_payments.reference` UNIQUE), `commissions.payment_id` UNIQUE, `fn_credit_business_booking` (`ON CONFLICT … DO NOTHING`).
* Non-negative balances are enforced by CHECKs on `wallets` and `business_wallets`.
* Booking/appointment/shop paths compare Paystack amount to the stored amount; shop also binds `metadata.order_id` and the reference to the order.
* Withdrawal safety features exist and are good: Paystack is asked by reference before any refund; admin-reject is blocked while a transfer may be in flight; 10-minute grace; trust is recorded only on settlement; duplicate-delivery guards (`status='pending'` guarded updates).

## 3. Cross-cutting risk summary

| Class | Where |
|---|---|
| Client-controlled amounts/prices | F-04 (subscription), F-08 (business withdrawal amount) |
| Duplicate settlement / race | F-01, F-05, F-07 |
| Missing idempotency at the event level | F-11 |
| Inconsistent state transitions | F-01, F-06 (refund), F-11 (reversed) |
| Incorrect accounting | F-06, F-17, F-20 |
| Gateway amount/currency mismatch | F-10 |
| Trust-boundary / authz | F-02, F-03, F-09 |
| Timeout / retry | F-12 |
| Unsafe SECURITY DEFINER | none found beyond F-13/F-16 (RLS and grants unverified) |

## 4. Recommended order into later phases

1. **Before any refactor (urgent, small): F-01, F-02, F-03.** These are live exposure, not architecture. Per the engagement's "surface findings immediately" rule they should be decided on now rather than waiting for Phases 05/08.
2. Phase 01-03: payment intent, provider abstraction (fixes F-10, F-12, parts of F-11).
3. Phase 04/06: F-04, F-06, F-07, F-14, F-15.
4. Phase 07: F-05. Phase 08: F-01, F-08, F-09. Phase 09: F-06 refunds, F-07, F-11 reversal. Phase 10/11: F-11, F-14, F-17.
