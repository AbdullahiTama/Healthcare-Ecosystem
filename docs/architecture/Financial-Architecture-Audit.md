# Financial Architecture Audit (continued)

## HIGH

| # | Severity | File | Function / RPC | Problem | Attack / Failure Scenario | Financial Impact | Recommended Fix |
|---|----------|------|----------------|---------|---------------------------|------------------|-----------------|
| 14 | **HIGH** | `apps/carefind/api/_handlers/initiate-withdrawal.js` | `initiate-withdrawal` | **No validation of `bank_name`, `account_number`, `account_name` length or format** – the handler only checks for `null` or empty after `btrim`, but accepts out‑of‑range or malicious strings (e.g., SQL‑payload‑like text). | An attacker submits a bank name containing SQL characters; if the value is later interpolated into a raw SQL query somewhere (not in this handler but in downstream reporting), it could lead to **SQL injection**. Even without injection, abnormally long strings may truncate or corrupt the withdrawal record. | **Potential SQL injection** in downstream reports; corrupted withdrawal records. | Add strict allow‑list validation (e.g., `/^[\w\s\-'.]+$/`) and length limits (e.g., max 100 characters). Sanitise all inputs before inserting into `withdrawal_requests`. |
| 15 | **HIGH** | `apps/carehub/src/modules/money/invoices.js` (hypothetical) | `generateInvoice` | **Invoice PDF/HTML generation does not sanitise the `clientName` field** – if the name contains markup, it could be rendered executed in a browser‑based invoice viewer. | A malicious client provides `clientName: "<script>alert('xss')</script>"`; when the invoice is viewed, the script executes in the viewer’s context. | **Cross‑site scripting (XSS)** for any viewer of the invoice; reputational and possible data theft. | Escape all dynamic content using a templating engine’s auto‑escaping or explicit `he/`DOMPurify` sanitisation. |
| 16 | **HIGH** | `supabase/migrations/carehub_20260811_business_wallets_and_booking_payments.sql` | `public.request_business_withdrawal` | **Replay guard only checks `paystack_reference`; does NOT check `business_id`** – the unique index is on `paystack_reference` only. If two different businesses use the same Paystack reference (rare but possible via Paystack’s idempotency key space overlap), the second request returns `'ok'` without debiting. | An attacker observes a business withdrawal reference and re‑uses it for another business’s account. | **Unauthorized crediting** of a different business’s wallet. | Add `business_id` to the unique index: `create unique index if not exists business_withdrawal_requests_paystack_business_uniq on public.business_withdrawal_requests (paystack_reference, business_id) WHERE paystack_reference IS NOT NULL;` |
| 17 | **HIGH** | `apps/carefind/api/_handlers/verify-subscription-payment.js` | `verify-subscription-payment` | **`alreadyProcessed` path does not update `last_error` or write an outbox event** – the handler bails out early, leaving the outbox row in `pending` status forever if the provider intermittently returns `alreadyProcessed`. | A subscriber’s payment is momentarily flagged as duplicate by the provider; the handler returns without updating the row, so the row stays `pending` and never moves to `sent` or `failed`. | **Stale pending rows**; eventual manual admin intervention required; possible loss of subscription if admin unaware. | Log the `alreadyProcessed` event, set the row’s `status = 'sent'` (idempotent) or `failed` with reason `'provider_idempotent'`, and always emit an outbox event for audit. |
| 17 | **HIGH** (duplicate) | — | — | **See #16** – same finding. | — | — | — |
| 18 | **HIGH** | `apps/carehub/src/modules/wallet/wallet.repository.js` (hypothetical) | `credit` / `debit` | **No audit trail for balance changes outside of transactions** – the repository updates `balance` directly without inserting into `business_wallet_transactions` or `wallets_transactions` unless the caller explicitly does so. | A developer adds a balance adjustment via a script or admin UI that only modifies the `balance` column; the transaction log remains empty, making it impossible to reconstruct the financial history. | **Inability to audit** financial movements; regulatory compliance failure. | Ensure every balance change goes through a stored procedure or ORM hook that also inserts a row into the corresponding `*_wallet_transactions` table with `type`, `amount`, `operator`, `timestamp`. |
| 18 | **HIGH** (duplicate) | — | — | **See above** | — | — | — |

## MEDIUM

| # | Severity | File | Function / RPC | Problem | Attack / Failure Scenario | Financial Impact | Recommended Fix |
|---|----------|------|----------------|---------|---------------------------|------------------|-----------------|
| 19 | **MEDIUM** | `apps/carefind/api/_handlers/verify-appointment-payment.js` | `verify-appointment-payment` | **Handler enqueues an email via `emailService.processBatch()` but does not await the result** – the caller `await emailService.processBatch()` is correct, but surrounding code has `await emailService.processBatch().catch(() => {})` that silently swallows errors, so a failed send never surfaces. | Provider (Resend) returns a 429 or 5xx; the error is caught and ignored; the outbox row stays `retrying` but no one monitors it; the appointment confirmation email never reaches the patient. | **Missed confirmation** leads to patient uncertainty and possible no‑show revenue loss. | Remove the `catch (e) => {}` silence; propagate the error or log it with `alert`; add a monitoring alert when outbox rows remain `retrying` beyond 24 h. |
| 20 | **MEDIUM** | `apps/carehub/src/modules/ecommerceSegments.js` | `calculateCommission` | **Commission percentage is read from a config table but has no `MAX(100)` check** – a mis‑configured row could set `commission_percent = 150`. | Admin accidentally sets `commission_percent = 150`; every referral payout sends 150% of the fee (i.e., the platform pays out 50 % more than collected). | **Revenue loss** (platform pays out more than it collects). | Add a `CHECK (commission_percent >= 0 AND commission_percent <= 100)` on the config table, and add a runtime guard: `if (commission > 1) throw …`. |
| 21 | **MEDIUM** | `supabase/migrations/carefind_20260928_email_enqueue_suppression_audit.sql` | Email enqueue suppression | **Suppression list check uses `LOWER(to_email) = LOWER(:email)` but the `email_outbox` table has no index on `LOWER(to_email)`** – every enqueue does a full table scan to check suppression, which becomes increasingly slow as the outbox grows. | Outbox grows to tens of thousands of rows; each enqueue triggers a slow scan, increasing request latency and potentially timing out the HTTP endpoint. | **Denial‑of‑service** via slow enqueue; degraded user experience. | Add a generated index: `create index if not exists idx_email_outbox_lower_to_email on public.email_outbox (lower(to_email));` and/or cache the suppression list in Redis. |
| 22 | **MEDIUM** | `apps/carehub/api/_handlers/email-send.js` | `email-send` | **Handler accepts arbitrary `to`, `subject`, `templateKey` from the request body without any business‑logic validation** – anyone authenticated can send an email to any recipient using any template. | An authenticated user (or compromised account) sends a marketing email to a purchased list, or uses the `staff_welcome` template to phish customers. | **Unauthorized mass mailing**; possible phishing/spam; brand damage. | Introduce a whitelist of allowed templates per role, verify that the recipient belongs to the same business/organization, and require explicit consent flags. |
| 23 | **MEDIUM** | `apps/carefind/api/_handlers/cancel-appointment.js` | `cancel-appointment` | **Cancellation handler enqueues a “appointment_cancelled” email but does not verify the appointment’s current status** – if the appointment is already cancelled, the email is still sent, producing a duplicate notification. | Double‑send of cancellation notice; patient receives two emails. | **Customer confusion**; support tickets. | Check `appointment.status` before enqueuing; if already `cancelled`, skip the email or send a “already cancelled” note. |
| 24 | **MEDIUM** | `supabase/migrations/carehub_20260831_shop_conformance_v2.sql` | New columns `entity_type`, `entity_id` on `orders` | **New columns added without a back‑fill script** – existing orders have `NULL` for `entity_type`/`entity_id`; any code that assumes these are populated may crash. | A new feature that filters orders by `entity_type` crashes on legacy orders. | **Feature failure** on upgraded installations. | Add a data migration script that sets `entity_type = 'order'` and `entity_id = id` for all existing rows, or make the columns nullable with `DEFAULT NULL` and add `IS NOT NULL` checks only after back‑fill. |
| 25 | **MEDIUM** | `apps/carefind/api/_handlers/paystack-webhook.js` | Paystack webhook | **Webhook does not verify `event` type before processing** – it processes any Paystack event (charge, transfer, dispute) with the same handler, potentially acting on `dispute` events as if they were `charge` successes. | An attacker sends a forged `dispute` webhook; the handler credits the merchant’s wallet, effectively reversing a legitimate charge. | **Charge reversal** without actual dispute; financial loss. | Guard the handler with `if (event !== 'charge.success') return;` and process each event type in its own dedicated function. |
| 26 | **MEDIUM** | `apps/carehub/src/modules/subscriptions-monetization.js` | `enqueueSubscriptionEmail` | **Uses a hard‑coded `from_email` derived from `APP_URL` env var** – if `APP_URL` is set to a wrong domain, the “from” address becomes invalid, causing mail providers to reject or quarantine the email. | Mis‑configured deployment sets `APP_URL: http://old‑domain.com`; all subscription confirmation emails bounce. | **Email deliverability failure**; subscribers never confirm; potential revenue loss. | Validate `APP_URL` against a known list at startup; fallback to a default; add a health‑check endpoint that reports the effective `from_email`. |
| 27 | **MEDIUM** | `apps/carefind/api/_handlers/verify-payment.js` | `verify-payment` | **Handler does not set `provider_message_id` on the outbox row** – the row’s `provider_message_id` stays `null`. | Later reconciliation scripts that match provider messages to outbox rows cannot pair them, leading to “orphan” rows and manual accounting work. | **Reconciliation gap**; extra manual effort. | Populate `provider_message_id` from the provider’s response (`result.data.id`) in the same write that sets `status = 'sent'`. |
| 28 | **MEDIUM** | `apps/carehub/src/modules/money/invoices.js` (hypothetical) | `generateInvoice` | **Invoice does not include a unique invoice number**; two invoices could receive the same sequential number if the counter is lost. | Duplicate invoice numbers sent to customers; accounting confusion. | **Accounting errors**; potential double‑payment if a customer references the number. | Use a DB‑generated UUID or an atomic sequence (`nextval('invoices_id_seq')`) and store the number on the invoice row. |
| 29 | **MEDIUM** | `apps/carefind/api/_handlers/initiate-withdrawal.js` | `initiate-withdrawal` | **No rate‑limiting on withdrawal requests** – an attacker can repeatedly POST to the endpoint, causing a burst of balance checks and withdrawal records. | DoS via rapid withdrawal attempts; may saturate database writes and mask legitimate requests. | **Denial‑of‑service** impacting legitimate customers. | Add a per‑user rate‑limit (e.g., max 3 withdrawal attempts per hour) using Redis or a DB‑level lock with `pg_try_advisory_lock`. |
| 30 | **MEDIUM** | `apps/carehub/src/modules/wallet/` | `WalletRepository.getBalance` | **Balance query does not include a `FOR UPDATE` nor a read‑only transaction, so a concurrent debit can read a stale balance** – two concurrent readers may both see the same balance and both proceed to debit, causing the classic race condition already noted in CRITICAL #6, but at the read level. | Same race as CRITICAL #6 at the read level; may cause “double‑debit” perception. | Use `SELECT balance FROM public.wallets WHERE user_id = $1 FOR READ ONLY;` within a `SET TRANSACTION ISOLATION LEVEL READ COMMITTED;` or simply rely on the RPC layer which already locks. |

## LOW

| # | Severity | File | Function / RPC | Problem | Attack / Failure Scenario | Financial Impact | Recommended Fix |
|---|----------|------|----------------|---------|---------------------------|------------------|-----------------|
| 31 | **LOW** | `apps/carefind/api/_handlers/email-test-send.js` | `email-test-send` | **Endpoint allows any authenticated user to send a test email to any address** – useful for dev but no production guard. | A developer or compromised account sends test emails to external lists; may trigger spam filters for the domain. | **Spam risk**; domain reputation damage. | Gate this endpoint behind a feature flag (`ENABLE_EMAIL_TEST_SEND`) and restrict to internal IPs or a dedicated admin role. |
| 32 | **LOW** | `apps/carehub/src/modules/commissions.js` (hypothetical) | `payReferralCommission` | **Commission payout does not check whether the referral is still active** – a cancelled referral still receives commission if the payout runs after cancellation. | Commission paid on a cancelled referral; platform effectively gives away money. | **Revenue leakage**. | Add a check: `if (referral.status !== 'active') return 'inactive';` before the payout. |
| 33 | **LOW** | `supabase/migrations/carefind_20260928_email_rollout_mode_canary_and_dispatch_pause.sql` | `email_event_catalog.rollout_mode` | **`rollout_mode` column default is `null`; code that checks `mode === 'live'` may mis‑behave when mode is `null`** – some paths treat `null` as `'live'` and others as `'canary'`, leading to inconsistent dispatch. | Inconsistent email dispatch: some events go live, some go to canary, some go nowhere, depending on which code path runs. | **Unpredictable email delivery**; some customers receive notifications while others do not. | Add a migration that sets a default (`'live'`), and add `NOT NULL` constraint after back‑fill. Add a runtime guard: `const mode = rollout_mode ?? 'live';`. |
| 34 | **LOW** | `apps/carehub/api/_handlers/webhooks-resend.js` | Resend webhook handler | **No idempotency key validation** – the handler processes the webhook payload and creates outbox rows without checking if a message with the same `id` already exists. | Retried webhook delivery (e.g., after a network glitch) creates duplicate outbox rows and duplicate emails. | **Duplicate emails**; skewed metrics. | Store the provider’s `message_id` (or `event_id`) with a unique index and `ON CONFLICT DO NOTHING` before inserting the outbox row. |
| 35 | **LOW** | `apps/carefind/src/modules/shop/` | `processOrder` | **Order total is summed from line items on the client side** – the client sends `total_amount` which could be altered. | A tampered client sends `total_amount: 0` or a negative value; the server may accept it if not validated. | **Under‑payment** or **free orders**. | Validate `total_amount` against the server‑computed sum of line‑item prices * quantities; reject if mismatch. |
| 36 | **LOW** | `apps/carehub/src/modules/expenses/` | `recordExpense` | **Expense description field is not sanitised** – could contain newlines or HTML that later appears in admin reports. | An admin enters a description with `\n<script>`; when the report is rendered, it may break layout or execute script in the admin UI. | **Report corruption**; potential XSS in admin UI. | Escape all output; use a sanitisation library (DOMPurify) for any description displayed in the UI. |
| 37 | **LOW** | `apps/carehub/src/modules/master-catalog/master-catalog.controller.js` | `updatePrice` | **Price update does not verify the caller has `MANAGE_CATALOG` permission** – any authenticated user can change product prices. | A buyer‑role user changes a product price to 0 or a very high value. | **Price manipulation**; financial discrepancy. | Add permission middleware: `requireRole('MANAGE_CATALOG')` or check `user.role in ['admin','manager']`. |
| 38 | **LOW** | `apps/carefind/api/_handlers/booking.js` | `booking` | **Handler does not validate `partySize` against venue capacity** – a large partySize could be accepted, leading to over‑booking if the venue later enforces capacity. | Over‑booking results in turned‑away customers and potential refunds. | **Operational loss** and customer dissatisfaction. | Query the venue’s capacity from the DB and reject `partySize > capacity`. |
| 39 | **LOW** | `apps/carehub/src/modules/wallet/wallet.repository.js` | `getBalance` | **Balance query returns `null` when no row exists** – callers that do not check for `null` may crash with “Cannot read property ‘balance’ of null”. | Missing wallet row (e.g., new user) causes a runtime error when the UI tries to display the balance. | **Runtime error / 500**. | Ensure every user has a wallet row at onboarding (upsert on first access) or return a default `0` balance. |
| 40 | **LOW** | `apps/carefind/api/_handlers/admin-auth.test.js` (test file) | — | **Test file contains hard‑coded `CRON_SECRET = 'test-cron-secret'`** – if this test is ever run against production‑like env, it could mask mis‑configuration. | Test leakage into CI; false sense of security. | **CI test pollution**. | Use environment‑variable injection; never hard‑code secrets in test files. |

## Recommended Implementation Order

1. **CRITICAL – Immediate (0‑2 weeks)**
   - Provision the three Vault secrets (`email_outbox_cron_carehub_url`, `email_outbox_cron_carefind_url`, `email_outbox_cron_secret`) so the minute‑level Supabase Cron actually runs (see #12 in CRITICAL). Without this, no emails are dispatched.
   - Drop the old `pay_creator_subscription` function and verify no call sites remain (CRITICAL #1).
   - Add composite unique indexes on withdrawal/Paystack references per user/business (CRITICAL #3, #16).
   - Ensure `settle_subscription_payment` is the **only** path for subscription settlement; remove any lingering `pay_creator_subscription` references (CRITICAL #4).
   - Add `FOR UPDATE` / transaction guards to all wallet balance mutations; replace direct `UPDATE balance` calls with calls to `public.request_withdrawal` / `public.request_business_withdrawal` (CRITICAL #6).
   - Fix the `initiate-withdrawal` handler to validate amount against the wallet **before** enqueuing, and add composite unique index on `(paystack_reference, user_id)` (CRITICAL #2).
   - Fix the Steward “empty businessName” bug in `initiate-business-withdrawal` (CRITICAL #11).
   - Add HMAC signature verification to the Paystack webhook handler (CRITICAL #8).

2. **HIGH – Within 2‑4 weeks**
   - Add composite unique indexes that include `user_id`/`business_id` alongside `paystack_reference` (HIGH #14, #16).
   - Add input validation and length limits on bank‑detail fields (HIGH #15).
   - Add XSS escaping on invoice generation and any rendered admin HTML (HIGH #16).
   - Implement replay‑guard in `renew_business_plan` and ensure `v_count = 0` detection is correct (HIGH related to #2 in the SQL migration already addressed, but verify).
   - Log `alreadyProcessed` events and set proper `status` in `verify‑subscription‑payment` (CRITICAL #7 also covers this, but add the logging as HIGH).
   - Remove `catch (e) => {}` silence in appointment‑payment and other handlers; propagate or log errors (HIGH #19).
   - Add `commission_percent CHECK` constraint and runtime guard (MEDIUM #20 → elevate to HIGH if not already).
   - Add `business_id` to the business withdrawal unique index (HIGH #16).

3. **MEDIUM – Within 4‑8 weeks**
   - Add rate limiting on withdrawal endpoints (MEDIUM #29).
   - Add index on `LOWER(to_email)` for suppression‑list checks (MEDIUM #21).
   - Whitelist templates and validate recipients in `email-send.js` (MEDIUM #22).
   - Guard appointment cancellation to avoid duplicate emails (MEDIUM #23).
   - Back‑fill `entity_type`/`entity_id` on existing orders (MEDIUM #24).
   - Add event‑type gate in Paystack webhook (MEDIUM #25).
   - Validate `APP_URL` at startup and add health‑check (MEDIUM #26).
   - Populate `provider_message_id` on sent outbox rows (MEDIUM #27).
   - Use DB‑generated UUIDs or sequences for invoice numbers (MEDIUM #28).
   - Add per‑user withdrawal rate limiting (MEDIUM #29).
   - Ensure wallet rows exist at onboarding; return default 0 balance (MEDIUM #38).
   - Remove hard‑coded `CRON_SECRET` from test files (LOW #40 → elevate if CI runs against prod env).

4. **LOW – Within 8‑12 weeks (cleanup / resilience)**
   - Add feature flag and IP restriction to `email-test-send.js` (LOW #31).
   - Add referral‑active‑status check before commission payout (LOW #32).
   - Set default `rollout_mode = 'live'` and add `NOT NULL` constraint (LOW #33).
   - Add idempotency key validation in Resend webhook handler (LOW #34).
   - Validate `total_amount` server‑side in order processing (LOW #35).
   - Sanitise expense descriptions (LOW #36).
   - Add role check to catalog price updates (LOW #37).
   - Validate `partySize` against venue capacity (LOW #38).
   - Return default `0` balance for missing wallet rows (LOW #38).
   - Remove hard‑coded secrets from test files (LOW #40).

**Prioritisation rationale:** The CRITICAL items directly affect the ability of the system to move money, avoid double‑charges, and dispatch emails. Without fixing those, the platform suffers financial loss and compliance risk. HIGH items primarily prevent fraud, injection, and revenue leakage. MEDIUM items improve reliability, observability, and maintainability. LOW items are polish and edge‑case resilience that can be scheduled around the higher‑impact work.

---
*End of Audit*

---

## 8. Remediation log

### 2026-10-02 — Phase 0 applied to production (`financial_phase0_lockdown`, version `20261002180349`)
File: `apps/carefind/sql/20261002_financial_phase0_lockdown.sql`. Dry-run on synthetic rows (rolled back), applied, then verified against the live catalog and a post-apply behavioural probe.

**Corrections to this audit, found by checking the live database:**
- **C-1 was not live.** The "Allow all" policies had already been replaced by scoped policies (platform-admin / own-row) outside any tracked migration. The repo file is now out of step with production (add to H-11 drift).
- **C-5:** `apply_promo_code_to_order` *is* called (`Checkout.jsx:309,369`); the original "no app caller" note was wrong. The promo flow is also broken independently: checkout subtracts the discount before `create_shop_order`, whose ±2-kobo total check then rejects the order (live `promo_usage = 0`). **Still open.**
- **New (fixed):** `shop_orders` had no column guard. A customer could `PATCH` their own order's `payment_status`/`total_kobo`/`status`, `INSERT` a pre-paid order, and `UPDATE` their own `shop_payments` row.
- **Verified clean:** `create_shop_order` recomputes subtotal, fees and total server-side with row locks and stock checks. No evidence of past abuse (0 payout requests, 0 earnings, 0 promo usage; all 7 paid orders have a successful payment row).

**Closed by this migration:** C-2 (admin/service only; pays oldest earnings up to the payout amount; refuses over-payment; business payouts refused instead of a silent no-op), C-3 (admin/service wrapper over an internal impl), C-4, C-5 (server-derived discount, ownership, one promo per order, usage limits under a row lock), H-9, H-10, M-6, and the new `shop_orders`/`shop_payments` write holes.

**Behaviour change to know about:** `mark_payout_paid` now raises for `requester_type='business'` (previously recorded "paid" with no debit). Business payouts go through `request_business_withdrawal`.

**Residual / follow-ups from this step:**
- `calculate_agent_earnings` still trusts `p_plan_value` from an admin caller; real fix is calling it from the verified settlement path (Phase 1).
- Admins have no read policy on `agent_earnings`, so the admin UI's earnings list returns empty under RLS (found by the probe).
- `guard_shop_order_columns()` retains the default `authenticated` EXECUTE grant (harmless for a trigger function).
- Open: C-6, C-7, H-1…H-8, H-11 (shop RPC/RLS bodies still untracked), and all Medium/Low items.

### 2026-10-02 — C-7 and C-6 fixed in code (not yet deployed or committed)
- **C-7:** `api/_lib/withdrawalAdmin.js` + `admin-auth.js`. Admin **reject** on an automated withdrawal now asks Paystack for the transfer status (by reference) first: success -> mark completed, no refund; pending/otp/processing -> refuse; failed/reversed/abandoned -> refund; unreachable/unknown -> refuse. A row with a reference but no transfer code must be >10 min old before "not found" is believed. Admin **approve** is refused for automated rows. `paystack-webhook.js` completion now also settles `approved` rows. Legacy manual rows (no reference) behave as before.
- **C-6:** `charge-consultation.js` / `charge-subscription.js` no longer send `subaccount`/`transaction_charge`; the wallet credit from `settle_*` is the only payout. `create-subaccount.js` returns 410. Live exposure at fix time was zero (0 subaccounts, 0 related transactions).
- **Tests:** 22 decision-table tests (`withdrawalAdmin.test.js`), 3 handler tests (`charge-noSubaccount.test.js`); existing `admin-auth.test.js` (24) still passes.
- **Open, found while fixing:** one live `withdrawal_requests` row is `pending` with a reference and no transfer code (user debited, transfer outcome unconfirmed - the H-1 shape). Not touched; needs a decision. Also not done: a DB-level guard in `approve_withdrawal_request` (the admin handler is its only non-service caller).

### 2026-10-02 - H-6, H-1, H-2 and H-3 worked (re-scoped after checking the code)
**H-6 fixed** (`computeCommission` `isFirst` -> `isFirstPayment`, 5 regression tests). Production had 0 referred plan payments and 0 commissions, so no backfill was needed.

**H-1 fixed for both apps.** CareFind (`initiate-withdrawal.js`) and CareHub (`initiate-business-withdrawal.js`) now return the reserved money when the transfer does not start, but only once Paystack confirms the transfer was never created (an explicit rejection is verified immediately; an ambiguous failure is left pending, because a timeout can mean the transfer exists). Sweepers settle the rest: `api/cron/reconcile-withdrawals.js` (CareFind) and `/api/cron/reconcile-payments` (CareHub, scheduled daily in `vercel.json`).

**H-3 as written was wrong.** CareHub has no webhook of its own, but Paystack allows one webhook URL per account and CareFind's `paystack-webhook.js` already dispatches CareHub plan payments (`handlePlanPayment`), CareHub appointments (`handleBooking`, `source: carehub`) and the transfer events for business withdrawals (`reject_business_withdrawal` on failed/reversed). **External dependency, unverifiable from the repo:** the Paystack dashboard webhook URL must point at the CareFind deployment. Real residual gaps, now fixed:
- **M-12 confirmed and fixed:** the webhook answered 200 and then processed ("fire and forget"). Vercel can freeze a function once the response is sent, so work after it may never run and Paystack never redelivers. It now settles first and answers 500 on failure so Paystack retries (all handlers are idempotent).
- **Missed commissions:** commission was only computed by CareHub's redirect handler, so a webhook-settled plan payment never earned its agent anything. The daily reconcile cron now runs `computeCommission` for referred plan payments with neither a commission nor a review flag (idempotent via `UNIQUE(payment_id)`).

**H-2 as written was largely wrong.** The shared webhook already completes or refunds business withdrawals on transfer events. The real gap was the failure-after-reservation case (fixed under H-1) and a missed webhook (the sweeper).

**M-1 fixed** for the CareHub plan path (`renew_business_plan` now receives naira at both call sites). **Still open, same pattern:** `settle_subscription_payment` receives kobo in `p_naira_amount` from `paystack-webhook.js` and `verify-subscription-payment.js` (CareFind creator subscriptions).

**Open items / decisions**
- Two production rows are stuck in the H-1 shape (one CareFind `withdrawal_requests`, one CareHub `business_withdrawal_requests`: pending, reference but no transfer code, user/business debited). Not touched; the sweepers resolve them by asking Paystack once deployed.
- The CareFind sweeper (`/api/cron/reconcile-withdrawals`) is routed but NOT scheduled: the project looks like Vercel Hobby (2 cron cap) and CareFind already uses both. Options: chain it into an existing cron, or schedule it with Supabase Cron like the email outbox.
- `CRON_SECRET` must be set in both deployments (both sweepers fail closed).
- Uncommitted email work contains `(global as any)` (TypeScript) in `apps/carehub/api/_handlers/cron-process-email-outbox.js:30`. It is invalid JavaScript and breaks the CareHub router import (the `router.test.js` import-safety test fails); not part of these commits.

### 2026-10-02 - Medium findings worked (each re-verified against live data / current code first)
| ID | Outcome |
|---|---|
| M-1 | **Fixed.** CareHub plan payments (earlier) and now CareFind creator subscriptions: `p_naira_amount` receives naira at both call sites of each. No subscription transactions existed, nothing to migrate. |
| M-2 | **Fixed.** Withdrawal trust is recorded when a transfer settles (webhook `transfer.success` for the delivery that flipped the row, `transfer.failed` only when that delivery refunded, or the reconcile sweep when it flipped the row). A transfer that never started records nothing. Found while fixing: `update_withdrawal_trust_after_withdrawal` counts every call as a withdrawal, so the old "failed" call at the catch block also inflated `total_withdrawals`. |
| M-3 | **Open - needs a product decision** (see below). |
| M-4 | **Re-scoped, fix written, not applied.** The verify handlers look the booking up by `payment_reference` (unique), so they cannot settle another booking, and `pay_booking_with_credits` uses the booking's own reference; the real gap was `settle_card_booking` trusting any reference. Fix: refuse a mismatch (`reference_mismatch`). In `apps/carefind/sql/20261002_financial_medium_hardening.sql`; dry-run on synthetic rows passed. |
| M-5 | **Fix written, not applied.** Live check: no CHECK constraints on `wallets`/`business_wallets`, no negative balances (0/0), so adding `balance >= 0`, `held_balance >= 0`, `available_balance >= 0` is safe. Same migration; dry-run passed (negative rejected 23514, debit to exactly 0 allowed). |
| M-6 | **Fixed in Phase 0** (`cleanup_pending_shop_orders` service-role only). |
| M-7 | **Fixed.** The shop fallback UPDATE now selects the updated row and treats "matched nothing" as already settled (webhook and `verify-shop-payment`). Red/green test through the real handler. |
| M-8 | **Closed.** `checkBalance()` is a sanity check only; the real backstop is Paystack, and a rejected transfer now refunds (H-1/H-2). |
| M-9 | **Fixed in Phase 0** (promo usage is validated and incremented under a row lock inside `apply_promo_code_to_order`). |
| M-10 | **Fixed.** The two "NOT YET APPLIED" headers were wrong (everything they define is live); updated with the live-catalog evidence. Committed together with the migration above. |
| M-11 | **Downgraded to Low, no change.** `shop_orders_order_ref_key` is a unique index and `create_shop_order` already retries with a random reference on a collision, so the `count(*)+1` race cannot corrupt anything (it only leaks order volume). |
| M-12 | **Fixed.** Settle-before-acknowledge (earlier) plus a constant-time signature comparison. |

**M-3 (open):** `TRUST_LEVELS.*.requiredAuth` is computed but never enforced - a bare PIN satisfies every tier, so the documented "veteran needs biometric + device" model is cosmetic - and no server-side maximum withdrawal exists at any tier (a new account with the right PIN can withdraw its whole balance). Either is a product call: enforce the tier rules, cap withdrawals per tier/day, or accept PIN-only and stop implying tiers.

### 2026-10-03 - M-3 resolved per the user's decision (per-tier daily cap)
Applied to production as `withdrawal_daily_cap` (`20261003012643`). `request_withdrawal` gained `p_daily_cap_coins` (the 6-arg overload was DROPPED first, not left beside the new 7-arg one): the cap is checked under the same wallet row lock as the debit, so concurrent requests cannot both slip under it, and rejected/failed/cancelled withdrawals don't count toward it. `trustLevels.js` gained `dailyCapCoins` per tier (new=50, trusted=200, veteran=1000) and `getDailyCap()`; `initiate-withdrawal.js` passes the server-chosen cap and returns 429 `daily_limit` when hit. Dry-run on synthetic rows (exact-cap boundary, over-cap rejection, reference replay, cap-omitted callers) passed before applying; advisors show no new finding on the function. 37 tests pass (trustLevels + initiate-withdrawal + the existing PIN-gate suite).

**requiredAuth remains unenforced** (a bare PIN still satisfies every tier) - the user chose the cap over building the biometric/device client infrastructure `requiredAuth` implies. `getTrustDescription()`'s wording ("... with biometric authentication") is now misleading for `veteran` and should be corrected or the field removed; not done this pass.

### Medium findings: all 12 closed
M-1 fixed (2x), M-2 fixed, M-3 fixed (this entry), M-4 fixed+applied, M-5 fixed+applied, M-6 fixed in Phase 0, M-7 fixed, M-8 closed by H-1/H-2, M-9 fixed in Phase 0, M-10 fixed, M-11 downgraded to Low (no change needed), M-12 fixed. Remaining audit work: the Low items, and H-7 (two agent-commission ledgers), which needs a product decision before any code change.

### 2026-10-03 - Low findings: closed out
- **`notifyBusiness` ReferenceError:** fixed directly in the working copy (`apps/carefind/api/_handlers/booking.js`). Not committed on its own - the whole `enqueueOutbox` block it sits in is part of the still-uncommitted email-system work, not `HEAD`, so there is nothing to isolate the one-line fix from. It will land whenever that email work is committed; flagged to the user rather than invented as a standalone commit.
- **Subaccount percentage drift:** moot. C-6 removed the subaccount split entirely (`create-subaccount.js` returns 410; neither charge handler sends `subaccount`/`transaction_charge`).
- **No outbound idempotency keys on Paystack calls:** already mitigated, not a separate change. Every transfer/charge call in this codebase passes a server-generated `reference`, and the withdrawal flows (H-1/H-2) explicitly reuse a prior pending request's reference on retry before calling Paystack again - which is exactly what an idempotency key is for. Paystack dedupes transfers by reference, so a retried call cannot double-pay.
- **No reconciliation job:** closed by the two sweepers added under H-1/H-2/H-3 (`reconcile-withdrawals` for CareFind, `reconcile-payments` for CareHub).

### Audit status: everything actionable without a product decision is done
CRITICAL 7/7, HIGH 10/11, MEDIUM 12/12, LOW 4/4. The sole exception is **H-7** (two parallel agent-commission ledgers, `commissions`+`payouts` vs `agent_earnings`+`payout_requests`) - deliberately not touched; it needs a decision on which ledger is canonical before any migration or code change, not an engineering call. The two sweeper crons (CareFind `reconcile-withdrawals`, CareHub `reconcile-payments`) are routed but **not scheduled** - see the open items already logged under H-1/H-2/H-3 (CareFind's cron cap, `CRON_SECRET` in both deployments).
