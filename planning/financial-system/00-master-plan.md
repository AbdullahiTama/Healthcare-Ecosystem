# Financial System — Master Plan

Current phase: **PHASE 07 — COMMISSION ENGINE**
Overall status: Phase 00 COMPLETED. Phase 01 COMPLETED (decisions D1-D5 accepted). Phase 02 COMPLETED (migration applied to production and catalog-verified).

| Phase | Status |
|---|---|
| 00 Baseline and audit | COMPLETED |
| 01 Financial architecture | COMPLETED |
| 02 Payment intents | COMPLETED |
| 03 Provider abstraction | COMPLETED |
| 04 CareFind payment flows | COMPLETED (migrations applied; app code not yet deployed) |
| 05 CareFind CareCoin wallet | COMPLETED (migrations applied; app code not yet deployed) |
| 06 CareHub payment flows | COMPLETED (migrations applied; app code not yet deployed) |
| 07 Commission engine | READY_FOR_REVIEW (migration written, not applied) |
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

## Phase 04 — CareFind payment flows

Decisions applied: 20% platform fee on card subscriptions/consultations (creator/professional share rounded DOWN to whole coins, remainder to platform); CareCoin-paid paths unchanged (Q1 open); card bookings settled from the ACTUAL kobo amount.
Completed work: `settle_payment_intent` (one atomic, idempotent engine: identity/provider/currency/amount checks, handlers for top-up, subscription, consultation, booking, unapplicable payments -> needs_refund); intents created before Paystack in all four CareFind initiators with server-decided amounts; redirect handlers and the webhook converge on `settleByReference`; webhook persists provider events (replay-safe, retryable); post-settlement emails/notices run once; F-04 fixed on both paths (card: creator's listed price; coins: `pay_creator_subscription` validates price); F-06 fixed (`settle_card_booking` + engine use the actual amount); consultation card payment never touches CareCoin wallets.
Files (new/changed): migrations `carefind_20261004_{settle_payment_intent, pay_creator_subscription_authoritative_price, settle_card_booking_actual_amount}.sql` (+ copies in `apps/carefind/sql/`); `packages/shared-payments/src/{intents,settlement,events}.js`; CareFind `api/_lib/{payments,financialConfig,intentSettlement,settlementEffects}.js`, handlers `initiate-payment, verify-payment, charge-subscription, verify-subscription-payment, charge-consultation, verify-consultation-payment, booking, verify-booking-payment, paystack-webhook`; client `subscriptions.js`; tests (below); `docs/architecture/CareFind-Payment-Flows.md`.
Migrations: 3, **APPLIED to production 2026-10-03** in the required order (`20261003214439` settle_payment_intent, `…214449` pay_creator_subscription_authoritative_price, `…214500` settle_card_booking_actual_amount). Live catalog re-read: engine executable by service_role only (ACL postgres+service_role); the 5 private helpers by nobody but the owner; `pay_creator_subscription` keeps authenticated+service_role (anon excluded); `settle_card_booking` service_role only; one function per name (no siblings); `financial_config` has the 10 expected keys incl. subscription/consultation_platform_rate = 0.20. **The application code is NOT yet deployed** — until it is, the old handlers keep running against the (backward-compatible) new database: the coin-path price check and the actual-amount booking settlement are already live for the old code too. Behavioural writes were not probed on production; behaviour is proven on PGlite and a real local Postgres 18.4 with the same SQL.
Tests: PGlite engine 41 + subscription-price 9 + booking-amount 7; handlers topup 21, subscription 23, consultation 21, booking 17, webhook 17; shared-payments 133; legacy webhook tests adapted (21); real-concurrency suite 8 (needs PG_CONCURRENCY_URL; passed on PostgreSQL 18.4 and found + fixed a lost-update race). Mutation-checked. Payments suite 281/281, CareFind api 167/167; full CareFind suite (143 files): 1479/1480 passed; the 1 failure (`VerifyEmail` PKCE, a 10 s timeout under load) is unrelated and passes alone (5.7 s). The new node-environment suites initially failed to load under the default config (`setup.js` used `window`) and under load (PGlite start-up > 10 s hook timeout) — both fixed.
Removed: `chargeSubscriptionCap.test.js`, `verifySubscriptionCap.test.js` (asserted client-supplied prices), `charge-noSubaccount.test.js` (covered by the flow tests).
Unresolved: deploy the application code; Q1 (20% on CareCoin paths); legacy webhook branches remain until drained (Phase 10); needs_refund payments have no refund path yet (Phase 09); F-27 callback_url; F-28 claim_payment_event; CareHub/Shop not migrated.
Next phase: PHASE 05 — CAREFIND CARECOIN WALLET.

## Phase 05 — CareFind CareCoin wallet

Completed work: append-only integer `coin_ledger` + a single posting primitive (`_post_coin_entry`, `_post_coin_transfer`); opening-balance cutover; `wallets.balance` integer; all 13 CareCoin writers moved onto the ledger with unchanged contracts; hand-written balance changes refused by trigger; `transactions` and `gifts` append-only; reconciliation + chain verification; F-13 (gift validation) and the database side of F-01 (withdrawal replay must match user/amount/account) closed; self-purchases refused; withdrawal minimum from `financial_config`; readable gift-refusal messages in the client.
Files: migrations `carefind_20261005_{coin_ledger, coin_writers_use_ledger, lock_wallets_to_ledger}.sql` (+ copies in `apps/carefind/sql/`); tests `coinLedger.db` 26, `coinWriters.db` 34, `coinLockdown.db` 14, `coinConcurrency.pg` 9 (real Postgres); fixtures `liveSchemaSubset.sql` (extended), `legacyFunctions.js`, `realPostgres.js`; client `GiftPanel.jsx` (+test); `docs/architecture/CareCoin-Wallet.md`.
Migrations: 3 — **APPLIED to production 2026-10-04** in order (`20261004021742` coin_ledger, `…021849` coin_writers_use_ledger, `…021918` lock_wallets_to_ledger). Live catalog re-read after each step: wallets.balance is integer (19 wallets, 186 coins; the 10.4 wallet became 10 with the fraction recorded in its opening entry); 8 opening entries; ledger sum 186 = wallet total 186; `reconcile_coin_wallets()` and `verify_coin_ledger_chain()` return no rows; all 10 replaced functions keep exactly their previous ACLs (anon none; authenticated only send_gift / pay_creator_subscription / pay_professional_consultation) with one function per name; posting primitives and guard functions executable by nobody but the owner; coin_ledger grants are SELECT only (authenticated, service_role) with one own-read policy; the 8 ledger-lock triggers exist on wallets/transactions/gifts/coin_ledger; wallet policies intact (read own; insert own empty). Behavioural writes were not probed on production; behaviour is proven on PGlite and a real Postgres 18.4 with the same SQL. (Pre-flight read from production before applying: Pre-flight read from production: no duplicate active withdrawal references; no view/rule/trigger/FK depends on `wallets.balance` (one policy does and is handled); the only hand-writers of balances are the 13 replaced functions; production already has a unique index on `paystack_reference`.)
Tests: PGlite 74 + real-Postgres 9 + settlement concurrency 8 (all pass on PostgreSQL 18.4); payments folder under the default config 356 passed / 17 skipped (the skipped are the two real-concurrency suites, which need `PG_CONCURRENCY_URL`); GiftPanel 8. Not run: full CareFind suite after this phase.
Found by tests: a real race in `request_withdrawal` (identical retries returned raw unique-violation errors; money was never double-debited) — fixed with an advisory lock on the reference; the wallets policy that blocks `ALTER COLUMN TYPE` — fixed in the migration.
Unresolved: Q1 (20% fee on CareCoin-paid paths); refund gaps in `refund_appointment_payment` (Phase 09); business wallets not yet on a ledger (Phase 06/08); account deletion with coins now refused (F-31, needs an admin settle procedure); application code from Phase 04 still not deployed.
**Docs location incident:** the `docs/` tree was moved to `apps/docs/` outside this session; the audit findings F-17/F-30/F-31 (see `CareCoin-Wallet.md` §5/§8) are NOT yet written into `Financial-Architecture-Audit.md`, and commit `27a9d2f` accidentally recorded that file's deletion from `docs/architecture/`. Waiting for the owner to say which location is canonical.
Next phase: PHASE 06 — CAREHUB PAYMENT FLOWS.

## Business decisions log (update 2026-10-04)

| Date | Question | Decision | Status |
|---|---|---|---|
| 2026-10-04 | Q1: 20% platform fee on CareCoin-paid subscriptions/consultations | **20%** (owner), same as the card paths; payer pays the full price, payee gets floor(price x 80%), platform keeps the rest | DECIDED, implemented and APPLIED to production 2026-10-04 |
| 2026-10-04 | Shop commission | **20% flat** (owner), replacing the schedule in `calculate_shop_commission` (retail 10% / wholesale 5% / distributor 2.5%). NOT yet implemented: nothing live changes until the shop moves onto the engine. Implementation must also update `apps/carehub/src/lib/ecommerceSegments.js` (UI rates/labels), the vendor terms version, and decide how vendors who already accepted `accepted_commission_rate` of 10/5/2.5 are treated (a contractual question for the owner: honour their accepted rate until they re-accept, or migrate all). A `shop_commission_rate = 0.20` key goes into `financial_config` with that migration. | DECIDED, implementation pending (shop phase) |
| 2026-10-03 | Card booking/appointment refund policy; webhook endpoint | recommendations stand (see log above) | still awaiting explicit owner confirmation; needed for Phase 09 / Phase 11 |

## Phase 06 — CareHub payment flows

Completed work: CareHub plan payments and appointment payments through payment intents and the settlement engine. `settle_payment_intent` now settles `appointment` (same handler as a CareFind booking: business credited from the actual kobo paid, 80% held / 20% platform) and `plan_renewal` (new handler calling the existing `renew_business_plan`, so renewal has one definition; no duplicate renewal). CareHub initiators price on the server (plan table / stored appointment fee), record the intent for the verified business before Paystack, and give every appointment attempt its own reference (F-15); redirect handlers authorise by `intent.business_id` and settle only through the engine; the shared webhook settles CareHub intents through the same engine. Settle-for-caller and post-settlement effects moved into `shared-payments` and are shared with CareFind. Card money stays in kobo; CareCoin money is untouched.
Files: migration `carefind_20261006_settle_plan_and_carehub_appointments.sql` (+ copy in `apps/carefind/sql/`); `packages/shared-payments/src/{requestSettlement,effects,testing}.js` (+ exports, tests); CareHub `api/_lib/{payments,intentSettlement,settlementEffects}.js`, handlers `initiate-plan-payment, verify-plan-payment, initiate-appointment-payment, verify-appointment-payment`, `package.json`/lockfile (shared-payments dependency; the lockfile was already out of sync with package.json); CareFind `api/_lib/{intentSettlement,settlementEffects}.js` become thin wrappers; tests `carehubSettlement.db` 21, `paymentFlows` (CareHub) 37, 3 real-Postgres concurrency cases, 2 webhook cases, 23 shared-code tests; `docs/architecture/CareHub-Payment-Flows.md`.
Migrations: 2 — **APPLIED to production 2026-10-04** in order (`carefind_20261006_coin_paths_platform_fee`, `carefind_20261006_settle_plan_and_carehub_appointments`). Live catalog re-read: one function per name; `settle_payment_intent` / `settle_subscription_payment` / `settle_consultation_payment` service_role only; `pay_creator_subscription` / `pay_professional_consultation` keep authenticated+service_role, anon none; `_post_coin_split`, `_settle_plan_renewal`, `_settle_booking` executable by nobody but the owner; no function writes a wallet balance by hand; wallets reconcile with the ledger (186 = 186) and the chain is intact; the three platform rates are 0.20. Behavioural writes were not probed on production. The new CareHub/CareFind application code is still NOT deployed (it can now be: the engine accepts plan_renewal and appointment).
Tests: payments folder (CareFind, default config) 390 passed / 20 skipped (real-concurrency cases need `PG_CONCURRENCY_URL`); shared-payments 156; CareHub API 37 new pass, existing 12 files pass (`authEmail` passes alone but failed 3 tests in a loaded full run; its handler and test carry someone else's uncommitted edits, not mine). Real Postgres 18.4: settlement concurrency 11, wallet concurrency 9 — all pass. Mutation-checked: business-ownership check and server-side pricing.
Unresolved: deploy both apps (Phase 04, 05, 06 code is still undeployed); referral commission still computed in Node after settlement and the first-payment race in `renew_business_plan` (Phase 07); `verifyBusiness` ilike wildcard, business-withdrawal controls (Phase 08); refunds for needs_refund payments (Phase 09); legacy webhook branches drain then removed (Phase 10); `callback_url` client-supplied (F-27); docs relocation from `docs/` to `apps/docs/` still unresolved (see Phase 05 note).
Next phase: PHASE 07 — COMMISSION ENGINE.

## Phase 07 — Commission engine

Completed work: referral commissions (existing rules: first payment 40%, later 5%) moved into the database. `renew_business_plan` now locks the business row BEFORE deciding "first payment" (F-05) and creates the commission (or a review flag) in the same transaction as the payment row and the expiry extension; unique partial indexes make a second first-payment / second bonus impossible even if bypassed. `commissions` gains `base_amount`, CHECKs (amount = round(base x rate, 2), rate 0..1, type/status enumerated), an immutability + forward-only status trigger, no deletes/truncates. All write privileges on `commissions`/`commission_review_flags` are revoked from every role (client creation impossible); `set_commission_status()` for admin/server. `reconcile_commissions()` (missing, wrong type/rate/base/agent, first-payment integrity, double-program) and `backfill_missing_commissions()` (set-based, oldest-first, no window cap) added. Rates and the inactive-agent policy are `financial_config` rows. Node `computeCommission` and its tests deleted; the CareHub cron now calls backfill + reconcile.
Files: migration `carefind_20261007_commission_engine.sql` (+ copy in `apps/carefind/sql/`); CareHub `api/_handlers/{verify-plan-payment,cron-reconcile-payments}.js`, `api/_lib/commissionReconcile.js` (rewritten), `api/_lib/commissions.js` (deleted), `src/lib/referral_program.js` (comment); tests `commissionEngine.db` 25, `commissionConcurrency.pg` 6 (real Postgres), CareHub `commissionReconcile` 3, `paymentFlows` 36; fixture `liveSchemaSubset.sql` (+agents/commissions/flags/agent_earnings); docs `docs/architecture/Commission-Engine.md`, `CareHub-Payment-Flows.md`.
Migrations: 1 — **NOT applied** (`carefind_20261007_commission_engine`). Apply BEFORE deploying the new CareHub code; the migration refuses to apply if `reconcile_commissions()` is not clean (production tables are empty) and asserts ACLs itself.
Tests: payments folder 441 passed with `PG_CONCURRENCY_URL` set (real-Postgres included); CareHub phase-07 files 51 passed. Mutation-checked: dropping the business lock and the unique indexes fails the overlapping-transactions test (12 "first" payments).
Unresolved / for owner: the tier-based `agent_earnings`/payout program (10/5/3%) is a separate scheme from the 40/5 referral commissions: which should pay the agent, or both? (`double_program` reconciliation flags overlaps; decision needed before Phase 08 payouts); apply the migration; deploy Phase 04-07 code; docs relocation still unresolved.
Next phase: PHASE 08 — WITHDRAWAL ENGINE.
