# Financial System — Master Plan

Current phase: **PHASE 03 — PAYMENT PROVIDER ABSTRACTION**
Overall status: Phase 00 COMPLETED. Phase 01 COMPLETED (decisions D1-D5 accepted). Phase 02 COMPLETED (migration applied to production and catalog-verified).

| Phase | Status |
|---|---|
| 00 Baseline and audit | COMPLETED |
| 01 Financial architecture | COMPLETED |
| 02 Payment intents | COMPLETED |
| 03 Provider abstraction | READY_FOR_REVIEW |
| 04 CareFind payment flows | NOT_STARTED |
| 05 CareFind CareCoin wallet | NOT_STARTED |
| 06 CareHub payment flows | NOT_STARTED |
| 07 Commission engine | NOT_STARTED |
| 08 Withdrawal engine | NOT_STARTED |
| 09 Refund engine | NOT_STARTED |
| 10 Central settlement engine | NOT_STARTED |
| 11 Webhooks and reconciliation | NOT_STARTED |
| 12 Performance and resilience | NOT_STARTED |
| 13 Financial test suite | NOT_STARTED |
| 14 Red-team audit | NOT_STARTED |
| 15 Production readiness | NOT_STARTED |

## Phase 00

Completed work: read all CareFind/CareHub payment, webhook, withdrawal, commission and cron code; read 19 live SECURITY DEFINER bodies, ACLs and constraints; wrote the audit.

Files changed (docs only):
* `docs/architecture/Financial-Architecture-Audit.md` (new)
* `planning/financial-system/00-master-plan.md` (new)

Migrations: none. Tests: none added or run (read-only phase). Production logic: untouched.

Findings: 1 CRITICAL (F-01), 7 HIGH (F-02…F-08), 10 MEDIUM, 5 LOW. See the audit.

Unresolved / open:
* Live RLS policies and DML grants: verified after the user cleared the query; found F-24 and fixed it (see follow-up).
* Not read: `verify_shop_payment`, `claim_payment_event`, `book_appointment_slot`, `approve_withdrawal_request`, `complete_withdrawal_transfer`, `get_withdrawal_trust`, shop vendor settlement, agent payout creation, indexes, migration drift (`list_migrations`), advisors.
* `planning/ROADMAP.md`, `planning/CODE_AUDIT.md`, `docs/PROJECT_OVERVIEW.md` named in CLAUDE.md do not exist.
* F-01/F-02/F-03 are live exposures; decision needed on fixing ahead of Phase 08.

Next phase: PHASE 01 — FINANCIAL ARCHITECTURE (design only).

### Phase 00 follow-up (urgent fixes shipped during review)
* F-24 (money tables writable from the browser): migration `carefind_20261003_lock_money_tables_to_server_writes` APPLIED to production (`20261003185456`), catalog-verified.
* F-03 `a026364`, F-02 `d6a8b4c`, F-01 handler side `99ac657`, F-25 owner role `ff26647` — committed with tests.
* Still open from Phase 00: DB-side replay branch of `request_withdrawal`/`request_business_withdrawal` and the 5-arg overload (Phase 08); everything else in the audit.

## Phase 01 — Financial architecture (design only)

Completed work: target architecture, ownership boundaries, 4 state machines (payment intent, withdrawal, refund, commission), 12 invariants, client-vs-server control table, trust boundaries, current→target mapping.
Files changed: `docs/architecture/Financial-Architecture.md` (new). Migrations: none. Tests: none (design phase). Production logic: untouched.
Read additionally: `verify_shop_payment`, `claim_payment_event`, `approve_withdrawal_request`, `complete_withdrawal_transfer` (live bodies).
New findings: `claim_payment_event` executable by `authenticated` (low; Phase 14); shop settlement has no vendor ledger or commission (design decision D6).
Decisions awaiting owner (doc §10-11): D1 settlement in Postgres; D2 wallets stay projections; D3 two currencies one ledger; D4 guest bookings via intent with null customer; D6 shop vendor payout model; consultation/subscription platform fee; card-booking refund policy; webhook endpoint per app.
Unresolved: indexes and migration drift not yet checked; `agent_earnings` is written by SQL function `calculate_agent_earnings` (carefindhub foundation; renamed by `20261002_financial_phase0_lockdown.sql`) — a SECOND commission system parallel to `commissions`, to be reconciled in Phase 07; `planning/ROADMAP.md`, `planning/CODE_AUDIT.md`, `docs/PROJECT_OVERVIEW.md` still absent.
Next phase: PHASE 02 — PAYMENT INTENTS.

## Phase 02 — Payment intents

Decisions accepted for this phase: D1 settlement in Postgres, D2 wallets stay projections, D3 one ledger/two currencies, D4 guest bookings via intents with null customer, D5 incremental rollout. Business questions (shop vendor payout, subscription/consultation platform fee, card-booking refund policy, webhook endpoint) remain open and are carried to Phases 04/06/09/11.

Completed work: `payment_intents`, `payment_provider_events`, `financial_config` — integer-only money, unique reference, immutable identity (trigger), enforced state machine incl. late-success paths, append-only events with unique (provider,event_id), no client access (RLS on, zero policies, explicit revokes, delete/truncate blocked even for service_role), config seeded with the CURRENT hard-coded rules (no commercial value changed).
Files changed:
* `supabase/migrations/carefind_20261003_payment_intents_foundation.sql` (new; copy in `apps/carefind/sql/20261003_payment_intents_foundation.sql`)
* `apps/carefind/src/test/payments/paymentIntents.db.test.js` (new, 44 tests, real Postgres via PGlite)
* `apps/carefind/package.json`, `package-lock.json` (devDependency `@electric-sql/pglite`)
Migrations: the file above — APPLIED to production as `carefind_20261003_payment_intents_foundation`. Live catalog re-read: all 3 tables RLS on, 0 policies, only service_role grants (SELECT/INSERT/UPDATE/REFERENCES/TRIGGER; no DELETE/TRUNCATE), 2 triggers each, guard functions executable only by postgres/service_role, config seeded with the 8 current rules. Security advisor `rls_enabled_no_policy` rose 14 -> 17 (these 3 server-only tables; intended). Not behaviourally probed on production (writes there were not attempted); behaviour proven on PGlite with the same SQL.
Tests: 44/44 pass (`npx vitest run --config vitest.payments.config.js src/test/payments/paymentIntents.db.test.js`). Not run: full CareFind suite.
Unresolved: `customer_id`/`business_id` intentionally have no FK (money records must outlive accounts) — revisit if reconciliation needs it; `financial_config` has no change history yet (Phase 11 audit log); no flow uses the tables yet by design.
Next phase: PHASE 03 — PAYMENT PROVIDER ABSTRACTION.

## Phase 03 — Payment provider abstraction

Completed work: new package `packages/shared-payments` — provider contract (8 methods), `PaystackProvider`, provider-neutral HTTP client with per-attempt timeout, safe retry policy (reads retried; writes NEVER retried after timeout/network/5xx and flagged `ambiguous`; 429 retried honouring capped Retry-After; total time budget), structured `ProviderError`s, correlation ids, structured logs without headers/query strings, secret redaction, private-field key storage, local validation (integer kobo, NGN, reference/NUBAN formats), strict response checks (reference echo, integer amount, unknown status refused).
Files changed (all new): `packages/shared-payments/{package.json,package-lock.json,vitest.config.js,README.md}`, `src/{index,errors,redact,http,PaymentProvider}.js`, `src/paystack/PaystackProvider.js`, `src/__tests__/{http,paystack}.test.js`; `docs/architecture/Financial-Architecture-Audit.md` (F-26).
Migrations: none. Production logic: untouched; the package is NOT imported by either app yet.
Tests: 105/105 pass (`cd packages/shared-payments && npm test`). Mutation-checked: disabling the no-retry-for-writes rule and the secret redaction each fail 11 tests.
Not done by design: webhook signature verification (Phase 11), replacing existing Paystack calls (Phases 04/06/08), wiring the package into the apps' package.json (Phase 04 — first consumer).
New finding: F-26 `checkBalance` may be a no-op (unverified; needs one real /balance response).
Unresolved: confirm Paystack /balance field name; transfer reference format rule (16-50 lowercase) is enforced in the adapter — existing `cf_wd_<8>_<12hex>` references comply, `ch_wd_<8>_<12hex>` too.
Next phase: PHASE 04 — CAREFIND PAYMENT FLOWS.

## Business decisions log

| Date | Question | Decision | Status |
|---|---|---|---|
| 2026-10-03 | Platform fee on CARD subscriptions and consultations (today: none, F-20) | **20%** (same as booking and withdrawal) — commercial rule CHANGE explicitly instructed by the owner. Interpretation to confirm: 20% of the amount paid, creator/professional receives 80%. | DECIDED (confirm interpretation) |
| 2026-10-03 | Card booking refunds | Recommended: full card refund when the business cancels at any time, or the patient cancels >= 24h before (the rule `cancel-appointment` already enforces); otherwise none. Platform pays the provider refund, reverses its commission, recovers the business's 80% from held then available balance (never below zero; shortfall flagged, not negative). Paystack's own fee is absorbed by the platform. Replaces the dead 72h code. | RECOMMENDED, awaiting owner |
| 2026-10-03 | Shop commission | Recommended: adopt the schedule already in the database (`calculate_shop_commission`: retail 10%, wholesale 5%, distributor 2.5%) and in vendors' accepted terms (`accepted_commission_rate`); platform collects, vendor owed order total minus commission, paid through the withdrawal engine. | RECOMMENDED, awaiting owner |
| 2026-10-03 | Webhook endpoint | Recommended: one provider-events endpoint per deployment routing by the stored intent's `application`. | RECOMMENDED |

Impact on Phase 04: the 20% fee needs `financial_config` keys (`subscription_platform_rate`, `consultation_platform_rate` = 0.20) added by migration, and settlement must credit creators/professionals 80% in CareCoin with the 20% booked to platform revenue — to be designed with the CareCoin rounding rule (F-20) in Phase 04/05.
