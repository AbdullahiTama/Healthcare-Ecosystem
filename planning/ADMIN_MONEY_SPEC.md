# Admin Money — Revenue & Payouts Control Plane Spec

**Status:** Draft for review — implements brainstorm 2026-09-08 (Money P0, owner lens)
**Owner lens:** Every kobo in, out, or stuck must be visible, traceable, refundable, and auditable without asking an engineer.
**Existing surface audited:** `apps/carehub/src/pages/admin/AdminDashboard.jsx:1012` LedgerUnifiedPanel (statement combine wallet+plan+shop), `1115` PayoutsUnifiedPanel (atomic markPaid `606` + `markPayoutPaidAtomic`), `services/supabase.js:577` `getLedgerForEntity` / `598` `getPayoutRequests`, `planning/CODE_AUDIT.md` C5/C15 wallet atomic, `architecture/Current-Architecture.md` Postgres via PostgREST, `docs/PROJECT_OVERVIEW.md` subscription plans.

---

## 1. Goal (Job to Be Done)

As SaaS owner, I hire the admin to **collect, protect, and disburse money**:
- **In:** plan payments (Paystack) → `plan_payments` → active business `status=active`, `plan_expires_at` extended.
- **Out:** agent commissions `agent_earnings` → `payout_requests` → bank transfer → `paid`.
- **Stuck:** mismatches, failed renewals, overdrawn wallets, disputed shop orders.
Today: Ledger aggregates but no Paystack truth vs DB, Plans are free-text `businesses.plan` + no entitlements, no dunning, no invoice, no refund.

## 2. Invariants (from audit)

1. **RLS = boundary.** Financial tables already `business_id`-scoped; admin money tables are platform-admin `is_platform_admin()` (like `20260908_admin_platform_health` pattern). No anon read on money.
2. **Atomic money.** `sale_stock_movement` trigger C5, `credit_wallet_topup` idempotency `reference` unique, `mark_payout_paid` atomic RPC — money never written optimistically from client.
3. **Paystack is source of truth for “paid”.** HMAC verify + reference lookup already correct in webhook; admin must triple-match Paystack settled vs `plan_payments` vs ledger, not trust one.
4. **Receipt is idempotent, not duplicated.** `dispense_ref` / `payment_reference` UNIQUE prevents replay after offline queue.

## 3. Data Model (additive, additive-only)

```sql
-- Plan catalog (replaces free-text businesses.plan)
create table plan_catalog (
  key text primary key, -- basic, pro, enterprise, custom_ikeja
  name text not null,
  price_kobo int not null check (price_kobo >= 0),
  billing_cycle text not null check (billing_cycle in ('monthly','yearly','lifetime')),
  trial_days int not null default 0,
  entitlements jsonb not null default '{}', -- { pharmacy: true, hospital: true, lab: false, ecommerce: true, branches: 5 }
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Subscription state per business (extends businesses.plan/plan_expires_at)
create table business_subscriptions (
  business_id uuid primary key references businesses(id),
  plan_key text not null references plan_catalog(key),
  status text not null check (status in ('trialing','active','past_due','suspended','canceled')),
  current_period_start date not null,
  current_period_end date not null,
  grace_until date,
  renew_attempts int not null default 0,
  last_payment_reference text
);

-- Paystack ledger mirror (webhook writes here; admin reconciles)
create table paystack_events (
  id bigserial primary key,
  reference text unique not null,
  event_type text not null, -- charge.success, transfer.success
  amount_kobo int not null,
  currency text not null default 'NGN',
  status text not null,
  business_id uuid, -- resolved via metadata
  raw jsonb not null,
  received_at timestamptz not null default now()
);

-- Dunning queue
create table dunning_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  attempt int not null default 0,
  next_attempt_at timestamptz not null,
  status text not null check (status in ('open','retrying','failed','recovered')),
  last_error text
);

-- Invoices / credit notes (append-only, append credit on refund)
create table invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  type text not null check (type in ('invoice','credit_note')),
  reference text unique not null,
  amount_kobo int not null,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- Audit extension: money actions → admin_audit_log (reuse existing)
-- Export: invoices/payouts exports → export_logs with reason+watermark (reuse)
```

RLS: `enable row level security` + `platform_admin` policy for all 5 (like health). `plan_catalog` SELECT allow authenticated? No — admin only; tenant reads via entitlements view `business_entitlements` (security_invoker) that exposes only `entitlements` for own `business_id`.

Seed: `insert into plan_catalog(key,name,price_kobo,billing_cycle,entitlements) values ('basic','Basic',0,'monthly','{}'),('pro','Pro',1500000,'monthly','{"pharmacy":true,"ecommerce":true,"branches":3}'),('enterprise','Enterprise',5000000,'monthly','{"pharmacy":true,"hospital":true,"lab":true,"ecommerce":true,"branches":99}') on conflict do nothing;`

Indexes: `idx_paystack_reference`, `idx_business_subscriptions_end`, `idx_invoices_business`.

## 4. Screens (Money) — what you click

### M1 — Revenue Overview (MRR/ARPU/Churn/LTV)
**File:** `pages/admin/money/RevenueOverview.jsx`
**Header KPIs (6-cap like DashboardStats:192 but money):** MRR (sum active `plan_catalog.price_kobo`/100), ARPU, Active subscriptions, Past-due, Churn 30d, LTV. Each with `delta` vs prev period + `Sparkline:36` 7d.
**Trend:** one 30d MRR area + churn bar (not chart wall). Source: `business_subscriptions` join `plan_catalog`. Poll 60s.
**Cohort:** Week 1/4/12 retention from `businesses.created_at` → first `plan_payments` → still active.
**States:** loading skeleton 6 cards, error `ErrorState:149`, empty “No subscriptions yet — seed plan_catalog”.

### M2 — Plan Catalog & Entitlements
**File:** `money/PlanCatalog.jsx`
**Table 36px sticky:** `Key | Name | Price ₦ | Cycle | Trial | Entitlements (pharmacy/hospital/lab/ecommerce/branches) | Active | Actions`.
**Actions:** New plan (Modal), Edit (entitlements JSON checklist → `entitlements` like `PLATFORM_PERMISSIONS:8` checklist), Activate/Deactivate, Delete (only if zero subscribers). Writes `plan_catalog`, audit `create_plan/update_plan`.
**Entitlements enforcement:** `business_entitlements` view used by `BusinessDashboard` nav guard — admin toggle immediately gates UI (like `TeamPlatformPanel` perms at data layer, not just nav hide).

### M3 — Subscriptions & Dunning
**File:** `money/Subscriptions.jsx`
**Filters:** search business name (`ilike` escaped `421`), plan_key, status, period_end range, page `sbFetchWithCount:451`.
**Table:** `Business | Plan | Status (trialing/active/past_due) | Period End | Grace | Attempts | Actions` — status dot `amber` past_due, `red` suspended.
**Actions:** Extend (date picker), Change plan (select from `plan_catalog`), Suspend/Reactivate (writes `businesses.status` + `business_subscriptions.status`, audited), Retry now (creates `dunning_jobs` entry).
**Dunning panel:** queue `dunning_jobs` open/retrying, next_attempt `g/f` 1/3/7 days, auto-create on `paystack_events` failure. Cron job marks `grace_until` then `suspended` after 3 fails.

### M4 — Paystack Reconciliation (Triple Match)
**File:** `money/Reconciliation.jsx`
**Concept:** Paystack settled (from `paystack_events`) vs DB `plan_payments` vs Ledger (`business_wallet_transactions`/`invoices`) — daily auto-match.
**Inbox:** `Mismatch | Reference | Paystack ₦ | DB ₦ | Ledger ₦ | Business | Age | Resolve`. Mismatch types: `missing_in_db` (paystack paid but no `plan_payments`), `missing_in_paystack` (DB says paid but paystack not settled), `amount_mismatch`.
**Resolve:** “Create missing payment” (idempotent insert with `payment_reference` UNIQUE), “Mark Paystack refund”, “Link to business” — each audited + writes `admin_audit_log`. Filters: 24h/7d, amount.
**Verify:** row probes: `paystack_events?reference=eq.XXX` visible, `plan_payments?reference=eq.XXX` visible, ledger entry balance `fmt(bal)`.

### M5 — Invoices & Receipts
**File:** `money/Invoices.jsx`
**For business picker:** search (like Ledger `1022`), select → list `invoices` type invoice/credit_note. Actions: Generate (from `plan_catalog` price → `reference` genId), Void, Refund → creates `credit_note` negative `amount_kobo`, PDF via `buildStatementHtml` pattern `carefindhubExports:25` + watermark, WhatsApp send, audit.

### M6 — Payout Command Center (upgrade existing)
**File:** extends `PayoutsUnifiedPanel:1115` → `money/PayoutsPro.jsx`
**Pre-check:** Resolve account (Paystack `bank/resolve`), velocity (last 7d sum), balance (`agent_earnings` sum owed - paid). “Mark Paid” lights only if all green; grey shows reason.
**Bulk:** CSV upload (business_id/agent_id, amount, reason) → preview → 2-step approve → atomic `mark_payout_paid` per row.
**States:** loading, error, empty “No payouts pending”.

### M7 — Wallet Treasury
**File:** `money/WalletTreasury.jsx`
**Aggregate:** `business_wallet_transactions` sum by type, overdrawn list (balance <0), top-up anomaly (spike >3σ). Top 10 wallets by balance, sparkline 7d.

## 5. Security & Correctness Verification

- anon SELECT `plan_catalog` → 0 (platform_admin only); authenticated `business_entitlements` view shows own entitlements only (security_invoker true).
- `paystack_events.reference` UNIQUE prevents double-process (like C15 wallet idempotency).
- `invoices.reference` UNIQUE; refund creates credit_note, never mutates invoice amount.
- All writes `Prefer: return=minimal`, audit via `admin_audit_log` (like health), RLS probe not catalog-only.
- Advisors rerun: no new ERROR, only expected SECURITY DEFINER WARN for `provision_staff_auth`/`register_business` baseline.

## 6. States, Responsive, A11y (per AGENTS.md)

- Loading skeleton per panel, error + Retry, empty + CTA (Go to Plan Catalog), table 36px sticky → card 768, `aria-label` search/filter, keyboard nav, `prefersReducedMotion`.
- Logging: every plan edit, subscription change, reconciliation resolve, payout mark → `admin_audit_log` + `export_logs` watermark.

## 7. Rollout Slices (vertical)

1. **M2 Plan Catalog + M3 Subscriptions read-only** (1 migration plan_catalog+subscriptions, seed, 2 panels) — proves owner can price.
2. M1 Revenue KPIs (MRR/ churn) — single chart, no more.
3. M4 Paystack mirror + Reconciliation inbox (`paystack_events` webhook write + match query)
4. M3 Dunning engine (cron → `dunning_jobs` → `past_due` → `suspended`)
5. M5 Invoices / credit notes + export governance
6. M6 Payout Pro (pre-check + bulk) + M7 Treasury

Each slice: repo seam `modules/money/repositories`, RLS probe, 5+ vitest, `vite build` clean, update `CODE_AUDIT.md`.

## 8. Open Questions

- Pricing: keep `plan_catalog.price_kobo` in kobo vs naira? Keep kobo (ledger already kobo).
- Trials: `trialing` → `active` on first Paystack success, or manual?
- Shop settlement split: platform % stored in `plan_catalog.entitlements` or separate `shop_commission` table? Recommend separate.

## 9. DoD (per roadmap §9)

- [ ] Repository with injected transport
- [ ] Scoped writes or platform_admin RLS verified behaviorally
- [ ] Loading/error/empty + responsive 375/768/1280
- [ ] No alert()/confirm() (ConfirmDialog+Toast)
- [ ] Tests in-memory
- [ ] Audit every write
- [ ] Commit separate: schema / repo / UI

---
*Next: implement slice 1 (M2+M3 read-only) → slice 2 → …*
