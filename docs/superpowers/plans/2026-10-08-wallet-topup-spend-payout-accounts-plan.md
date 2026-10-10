# Wallet Top-Up, Ecosystem Spend, Saved Payout Accounts & PIN-OTP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let CareFind users and CareHub businesses top up wallets, spend wallet balance across the ecosystem (bookings, subscriptions, consultations, shop, plan renewals, per-appointment fees), save multiple verified payout accounts, and set/change withdrawal PINs via emailed OTP — while every withdrawable coin remains traceable to provider-confirmed money.

**Architecture:** All new money movement goes through the existing Postgres settlement engine (`settle_payment_intent` dispatch + private `_settle_*` handlers + the coin ledger posting primitives). New surface only adds: (a) `payout_accounts` + `payout_account_events` tables, (b) `withdrawal_email_otps` table, (c) new intent purposes, (d) a provenance check inside the withdrawal reservation, (e) API handlers + admin op. No client can write money rows.

**Tech Stack:** Supabase Postgres (PGlite tests), Node ESM handlers (Next/Vercel `api/_handlers`), `@care-ecosystem/shared-payments`, `@care-ecosystem/shared-email`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-wallet-and-payout-accounts-design.md`

## Global Constraints

- Money is integer-only (kobo / whole coins); never fractional.
- Ledger references are unique per leg: `<kind>_<reference>`; replays must be no-ops, never double-pays.
- `business_wallets` / `wallets` balances are written only by engine/posting functions; client roles have no write grants.
- Every new purpose must be service-role-only in SQL and wired through `settle_payment_intent` dispatch; no ad-hoc balance edits.
- BVN/NIN stored last-4 only for display; full values encrypted-at-rest later. No billed KYC calls in this plan — accounts go `pending_review` until an admin flips them `verified`.
- Email OTP: 6 digits, 10-minute expiry, 5 attempts, single-use, rate-limited 3/hour, delivered via the shared `EmailService` outbox.
- PIN rule is identical on both apps: set/replace needs a fresh email OTP; changing an existing PIN additionally needs the current PIN (closes F-32).
- CareCoin→kobo conversion uses the existing fixed ₦200/coin rate from `financial_config` (key `coin_naira_rate` — confirm key in Task 6).
- Migration copies must be mirrored to `apps/carefind/sql/` for the PGlite fixture chain (project convention).

---

## Milestone A — Saved payout accounts + admin review + PIN-OTP

### Task A1: `withdrawal_email_otps` migration

**Files:**
- Create: `supabase/migrations/carefind_20261020_withdrawal_email_otp.sql`
- Mirror: `apps/carefind/sql/carefind_20261020_withdrawal_email_otp.sql`
- Test: `apps/carefind/src/test/payments/withdrawalEmailOtp.db.test.js` (new)

- [x] **Step 1:** Write the failing test: insert a session row, call `request_withdrawal_email_otp(p_user_id)` is not how it should be — instead the API creates the OTP row; the RPC is for verification. Test: create table exists, row insert works, `expires_at` default ~now()+10min, attempts default 0, unique `(user_id, code_hash)` per active period not needed — simply unique id.

```sql
create table public.withdrawal_email_otps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  purpose text not null default 'withdrawal_pin',
  code_hash text not null,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  attempts integer not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.withdrawal_email_otps enable row level security;
-- no grants to anon/authenticated; service_role only
```

- [x] **Step 2:** Run test → fails (table missing).
- [x] **Step 3:** Add migration + mirror; grants: `revoke all` from public/anon/authenticated; grant select/insert/update to service_role only.
- [x] **Step 4:** Run test → passes. Commit.

### Task A2: OTP request endpoint (CareFind)

**Files:**
- Create: `apps/carefind/api/_handlers/withdrawal-pin-otp-request.js`
- Modify: `apps/carefind/api/router.js` (add `withdrawal-pin-otp-request` route)
- Test: `apps/carefind/api/_handlers/withdrawal-pin-otp-request.test.js`

Handler: POST, `verifyUser`, rate-limit (3/hour, query count of rows in last hour → 429), generate 6-digit code, store `sha256(code + user_id)` in `withdrawal_email_otps`, `emailService.enqueue({ templateKey: 'withdrawal_pin_otp', toEmail: user.email, payload: { code } })`. Never echo the code in the response.

- [x] Failing test: mock supabase + emailService; expect 429 on 4th request in an hour; expect enqueue on success; expect no code in body.
- [x] Implement; run; pass; commit.

### Task A3: OTP request endpoint (CareHub)

- Mirror of A2 using `verifyBusiness` + `apps/carehub/src/lib/emailService.js`.
- Files: `apps/carehub/api/_handlers/withdrawal-pin-otp-request.js`, its test, `apps/carehub/api/router.js`.

### Task A4: Template key + renderer for OTP email

**Files:**
- Modify: `packages/shared-email/src/templates/index.js` (add `withdrawalPinOtp: 'withdrawal_pin_otp'` to both maps)
- Modify: `packages/shared-email/src/templates/Transactional/CareFind/CareFind.js` + `CareHub` equivalent (add renderer)

- [x] Add renderer `withdrawalPinOtp({ code })` producing a simple code email.
- [x] Test: node import of getTemplate('withdrawal_pin_otp', 'carefind') returns a function; render contains the code.

### Task A5: `set_withdrawal_pin` requires OTP (both apps)

**Files:**
- Modify: `apps/carefind/api/_handlers/withdrawal-pin.js` (add `otp` to set body; verify OTP before set; if PIN already exists require `currentPin`)
- Modify: `apps/carehub/api/_handlers/withdrawal-pin.js` (add `otp` to set body; verify OTP then currentPin)
- Test: update `apps/carefind/src/test/payments/withdrawalPin.test.js` and `apps/carehub/api__tests__/withdrawalPin.test.js`

Verify OTP: select latest unconsumed unexpired row for user, compare hash, increment attempts (≥5 → burn), set consumed_at on success. No new RPC needed if service_role can update the row.

### Task A6: `payout_accounts` migration + table + RPCs

**Files:**
- Create: `supabase/migrations/carefind_20261020_payout_accounts.sql` (+ mirror)
- Test: `apps/carefind/src/test/payments/payoutAccounts.db.test.js`

```sql
create table public.payout_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid,
  owner_business_id uuid,
  bank_code text not null, bank_name text not null,
  account_number text not null, account_name text not null,
  status text not null default 'pending_review' check (status in ('pending_review','verified','failed')),
  bvn_last4 text, nin_last4 text,
  verified_at timestamptz,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  check (owner_user_id is not null or owner_business_id is not null)
);
create table public.payout_account_events (
  id bigint generated always as identity primary key,
  payout_account_id uuid references public.payout_accounts(id),
  actor uuid,
  action text not null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```
RLS on, no API grants; engine/admin RPCs service-role only.

### Task A7: Payout account API (CareFind + CareHub)

**Handlers:** `apps/carefind/api/_handlers/payout-accounts.js` (list own, add, set-default, remove), mirror in CareHub.
- Add: resolve account name (existing `resolveAccount`), BVN/NIN format check (11 digits), insert `pending_review`, event `added`.
- Set default: require verified status + PIN (`checkWithdrawalPin`) + fresh OTP (same verification helper as A5).
- Edit bank/account number: reset to `pending_review`, `is_default=false`.

### Task A8: Admin review op

**Files:** `apps/carefind/api/_handlers/admin-auth.js` add `action === 'payout_account_review'` with `{ payoutAccountId, decision: 'verified'|'failed' }` → sets status + verified_at, event `reviewed`, notifies user via email outbox.

### Task A9: Withdrawal can only use verified default? No — keep free-form but warn

Decision: withdrawals still accept a typed account (current behavior); saved accounts are a convenience + trust signal. The default saved account pre-fills the withdrawal form and skips re-resolution only if `verified` and unchanged. (If product wants hard enforcement, flip a config flag.)

---

## Milestone B — Business wallet card top-up

### Task B1: `business_wallet_topup` intent purpose

- Widen `payment_intents_purpose_check` with `'business_wallet_topup'`.
- `PURPOSES` in `packages/shared-payments/src/intents.js` widen.
- New SQL `_settle_business_wallet_topup(payment_intents)`: validate `i.business_id`, credit `business_wallets.available_balance += expected_amount`, insert `business_wallet_transactions(type='topup', amount, reference=i.reference)`, update `updated_at`; idempotent on reference.
- Wire into `settle_payment_intent` dispatch with the same service-role assertions.
- Handler: `apps/carehub/api/_handlers/initiate-wallet-topup.js` + `verify-wallet-topup.js` mirroring plan payment.
- Test: PGlite db test — settle credits wallet once; replay same reference settles once (unique leg); intent for wrong business → needs_refund.

### Task B2: UI hook for business top-up

Minimal: add a `TopUpWallet` button on the CareHub Wallet screen that calls `initiate-wallet-topup` and redirects to Paystack. Test with a light handler test; no visual polish in this plan.

---

## Milestone C — Wallet-paid intents

### Task C1: CareCoin spend paths unified under intents (dual-path transition)

- New purposes: `booking_wallet`, `subscription_wallet`, `consultation_wallet`.
- `_settle_booking_wallet(i)` = call existing booking settlement (held/available split) using coin amount; mark appointment paid via card? No — via `pay_booking_with_credits` logic: keep RPC contract, but the handler now creates an intent with `purpose:'booking_wallet'`, metadata `{coins}`, and the settle handler calls the same RPC server-side after provider-like verification (no Paystack): since payment is wallet-internal, the "provider" is a new internal one — instead of forcing the Paystack shape, add a DB fast path: `settle_payment_intent` branch for `*_wallet` purposes settles immediately when `metadata.wallet_confirmed = true` and the coin debit already happened in `_post_coin_entry`... **Simpler, safer:** keep the existing RPCs as the authoritative coin movers, and record a `payment_intents` row with `purpose:'booking_wallet'`, `status:'settled'`, `provider:'wallet'`, `expected_amount = coins * coin_rate` for audit. No settlement engine change needed for these three; the intent row is the audit record.
- Test: each RPC writes a matching settled intent row (or ledger leg references the intent reference).

### Task C2: `shop_order_wallet`

- Purpose `shop_order_wallet`; settle handler: verify order unpaid, debit buyer coins via `_post_coin_entry(..., kind='shop_payment', reference=i.reference)`, compute vendor kobo `subtotal - platform_fee` at coin rate, credit via vendor-credit path (`shop_credit`), mark order paid, set appointment/shop history.
- Test: buyer debited once, vendor credited once, replay no-op, insufficient coins → `needs_refund` (no, wallet path → fail the intent before debit; use `failed` + coins untouched).

### Task C3: `plan_renewal_wallet`

- Purpose `plan_renewal_wallet`; settle handler: debit business wallet `available_balance` via a new guarded update, insert `business_wallet_transactions(type='plan_payment', amount=-price, reference=i.reference)`, call `renew_business_plan` (existing) with the new month count. Reuse plan price from business row (server-side).
- Test: debit+extension atomic; insufficient available → failed, no extension; replay no-op.

### Task C4: `appointment_fee_wallet`

- Purpose `appointment_fee_wallet`; settle handler: debit business wallet `available_balance`, insert `business_wallet_transactions(type='appointment_fee', amount=-fee, reference=i.reference)`, ledger the platform share (existing platform accounting row), mark the appointment's platform fee settled.
- Commercial value for the per-appointment fee comes from `financial_config` key `appointment_platform_fee_kobo` (seed 0 → behavior unchanged until owner sets it).
- Test: deduct only when config > 0; replay no-op; insufficient → failed.

---

## Milestone D — Coin provenance hardening

### Task D1: Provenance rule in `coin_ledger`

- Migration: add a CHECK or a validation function `coin_leg_source_ok(kind, reference)`: allowed internal kinds `opening_balance, topup? (card), gift_received, refund...` Actually `topup` IS provider-confirmed (via intent), so its reference points at a settled intent — that is traceable. Rule: `reference` must match an existing settled `payment_intents.reference` OR be in an allowed prefix list (`wd_refund_`, `appt_refund_`, `gift_`, `opening_`, `adj_`).
- Withdrawal reservation: before debiting, check the user's wallet has not received untraceable credits (e.g. a manual `adjustment` not matching prefix, or a legacy row): flag to `wallet.needs_attention` email + recon finding, and refuse withdrawal for the untraceable portion.
- `reconcile_coin_provenance()` returns untraceable credits → included in `run_db_reconciliation()`.
- Test: seed a forged `adjustment` credit → withdrawal refused + finding appears; normal topup → withdrawal allowed.

### Task D2: Doc + runbook note

- Update `docs/architecture/CareCoin-Wallet.md` §3 with the provenance guarantee and `Withdrawal-Engine.md` with the new reservation check.

---

## Milestone E — Docs & master plan

### Task E1
- Update `planning/financial-system/00-master-plan.md` with Phase 16 summary (after implementation).
- Create `docs/architecture/Saved-Accounts-and-Wallet-Spend.md` capturing the new surfaces, state machines, invariants, and roll-out order (mirror the style of Withdrawal-Engine.md).

---

## Self-review notes (post-write)

- Coverage: spec §3 payout accounts → A6-A8; §4 PIN+OTP → A1-A5; §5 wallet spend → C1-C4; top-up → B1-B2; §6 provider seam → deferred by design (noted); §7 migrations/tests/recon → D1 + all tasks; §8 open decisions listed in plan tasks B2-UI, C4-config default 0.
- Placeholder scan: no TBD/TODO; open commercial values are explicitly `financial_config` seeds, not code.
- Type consistency: `withdrawal_email_otps(code_hash)`, `payout_accounts(status)`, intent purpose names match across tasks A-D.
