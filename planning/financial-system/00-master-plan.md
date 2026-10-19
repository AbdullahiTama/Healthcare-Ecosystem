# Financial System — Master Plan

Current phase: **REMEDIATION 01 (2026-10-15)** — see `docs/superpowers/plans/2026-10-15-phase1-otp-reliability-remediation.md`.
Overall status: Phase 00 COMPLETED. Phase 01 COMPLETED (decisions D1-D5 accepted). Phase 02 COMPLETED (migration applied to production and catalog-verified).

> **Status legend for the remediation work:** *Implemented and tested* = code merged, tests green, **not deployed**.
> *Production state verified* = confirmed read-only against `szdybxmgmhndoytqanfb` on 2026-10-15.
>
> | Remediation item | Status |
> |---|---|
> | Shared packages restored from HEAD (92 files were deleted in the working tree; every build, test and CI leg was broken) | Implemented and tested |
> | Rem-01 OTP reliability & withdrawal session (resume survives a rebuild, truthful cooldown, no 409 deadlock) | **Implemented and tested — NOT deployed.** No migration required |
> | Rem-02 CareFind Admin Orders reads `transactions` instead of `shop_orders` (54 shop orders invisible) | **Implemented and tested — NOT deployed.** Now reads `shop_orders` with server-side search/filter/paging; a failed query surfaces instead of rendering as empty |
> | Rem-03 Withdrawal message conflated provider insufficiency with user insufficiency | **Implemented and tested — NOT deployed.** Handler classifies the refusal (`provider_balance_low` / `transfer_refused` / `transfer_pending`); the UI estimate is server-driven; `carefind_20261112_paystack_transfer_buffer` **APPLIED** (ledger `20261015142131`) |
> | Rem-04 Engine `lock_timeout`/`statement_timeout` lost on `settle_payment_intent`, `create_withdrawal`, `settle_withdrawal`, `settle_business_withdrawal` | **APPLIED + verified** (`carefind_20261112_engine_timeouts_reapply`, ledger `20261015142108`). All 20 engine entry points carry `lock_timeout=10s`; regression guard in `engineTimeouts.db.test.js` |
> | Rem-05 Vendor earnings release keyed on `status='delivered'`, which a vendor can set themselves; no pickup-station receipt exists | **APPLIED + verified** (`carefind_20261113_pickup_receipt_release`, 17/17 tests). Staff receipt now releases the earning via one shared primitive with the delivery trigger. **Open:** a vendor may still self-set `delivered`; the two triggers coexist by design |
> | Rem-06 `business_wallets` has no balance guard; booking releases spend the shop credit `held` pool | **DETECTION APPLIED + WIRED INTO THE NIGHTLY SCAN** (`carefind_20261115` detects; `carefind_20261116` publishes, verified 2026-10-19): `reconcile_business_wallets()` runs from `run_db_reconciliation` and Money Checks shows its findings; `confirm_appointment` revoked from `authenticated`. **NGN 10,000 of unexplained business balance = 2 warning findings — NOT corrected; no receipt exists for the N5,000 (evidence gathered 2026-10-19) — owner decision owed** (`docs/superpowers/plans/2026-10-19-wallet-integrity-corrections.md`). A true write-guard (like `wallets_guard`) is still not in place |
> | Rem-07 `release_vendor_credit_on_delivery()` keeps `PUBLIC EXECUTE` | **APPLIED + verified** (`carefind_20261114`). Both that function and the new `shop_order_receipts_guard` are now private to the owner |
> | Rem-08 Migration ledger does not reproduce production (renamed/split migrations; hardened `apply_promo_code_to_order` applied out of band) | **LEDGER RECONCILED 2026-10-15.** The 131 files with no ledger row were all already applied under other names (123 verified: every object they create is live; 6 superseded; 2 checked individually) — 131 metadata-only rows inserted, `created_by='ledger_reconciliation_2026_10_15'`, synthetic `<date>90<NN>` versions. **Repo files now with no ledger row: 0.** No DDL/DML touched application data (wallet total, orders, withdrawals, transactions all byte-identical before/after). Rollback + pre-change backup in `apps/docs/architecture/`. Ratchet test (7/7) prevents the gap regrowing. **Still open:** `supabase/migrations/` remains a delta stream with no baseline — 38 live functions and 110 live tables have no `create` anywhere in the repo. Full analysis: `apps/docs/architecture/Migration-Drift-Audit.md` |
> | Rem-09 3 stuck withdrawals (2 reserved since July with `payout_kobo = NULL`, 1 processing since 2026-10-11) and 9 legacy paid orders with ₦1,170 uncredited | Frozen. **Requires explicit financial authorisation — not actioned** |
> | Rem-10 `npm audit` gate fails | **PARTIALLY FIXED — gate still red.** The original entry ("`brace-expansion` high; `react-router-dom` moderate") was wrong: it was measured with `--omit=dev`, but `carefind-ci.yml` / `carehub-ci.yml` gate on `npm audit --audit-level=high` **without** `--omit=dev`. Real totals were carefind 13 (3 crit / 4 high), carehub 12. All 6 shared packages: **0**. Applied every non-breaking fix: `brace-expansion` 5.0.9→5.0.12, `source-map-js` 1.2.1→1.2.2, `undici` 7.29.0→7.30.1, `dompurify` 3.4.15→3.4.17 → carefind 13→**10**, carehub 12→**9**. Finance gate 1290/1290 green, build green. **Also found:** `xlsx` was declared a *devDependency* but is imported by two live routes (`excel-import`/`excel-export`), so the prod audit never saw its two HIGH advisories — there is **no fixed version on npm**. Moved to `dependencies` (now visible to the prod audit) and added a 5 MB upload ceiling to `excel-import`, which previously buffered the whole body unbounded into `XLSX.read()`. **Remaining advisories all need a semver-major or have no fix:** `vitest`+`tinypool`+`@vitest/coverage-v8` (3 critical) → vitest@5; `vite`+`esbuild` → vite@8; `react-router-dom` → v7; `xlsx` → replace/vendor |

| Phase | Status |
|---|---|
| 00 Baseline and audit | COMPLETED |
| 01 Financial architecture | COMPLETED |
| 02 Payment intents | COMPLETED |
| 03 Provider abstraction | COMPLETED |
| 04 CareFind payment flows | COMPLETED (migrations applied; app code not yet deployed) |
| 05 CareFind CareCoin wallet | COMPLETED (migrations applied; app code not yet deployed) |
| 06 CareHub payment flows | COMPLETED (migrations applied; app code not yet deployed) |
| 07 Commission engine | COMPLETED (migrations applied incl. the follow-up; app code not yet deployed) |
| 08 Withdrawal engine | COMPLETED (migrations applied; app code not yet deployed) |
| 09 Refund engine | COMPLETED (migration applied; app code not yet deployed) |
| 10 Central settlement engine | COMPLETED (migration applied; app code not yet deployed) |
| 11 Webhooks and reconciliation | COMPLETED (migrations applied; app code not yet deployed) |
| 12 Performance and resilience | COMPLETED (migrations applied; app code not yet deployed) |
| 13 Financial test suite | READY_FOR_REVIEW (migration 20261018 applied; app code not yet deployed) |
| 14 Red-team audit | READY_FOR_REVIEW (migration 20261019 applied to production 2026-10-06) |
| 15 Production readiness | READY_FOR_REVIEW (audit and runbook; no code or database change; NOT ready to go live, see doc) |
| 16 Wallet top-up & ecosystem spend | READY_FOR_REVIEW (code, tests and docs complete; migration `carefind_20261020_wallet_spend_and_topup` NOT applied to production). Saved payout accounts + Dojah KYC + PIN code: separate work, migrations applied |

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
| 2026-10-03 | Card booking refunds | Recommended: full card refund when the business cancels at any time, or the patient cancels >= 24h before (the rule `cancel-appointment` already enforces); otherwise none. Platform pays the provider refund, reverses its commission, recovers the business's 80% from held then available balance (never below zero; shortfall flagged, not negative). Paystack's own fee is absorbed by the platform. Replaces the dead 72h code. | **CONFIRMED by owner 2026-10-05** ("ok" to the recommendation) |
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
Migrations: 1 — **APPLIED to production 2026-10-04** (`carefind_20261007_commission_engine`). Catalog re-read after apply: one function per name; `_record_referral_commission` and `commissions_guard` executable by nobody; `reconcile_commissions`/`backfill_missing_commissions`/`renew_business_plan` service_role only; `set_commission_status` authenticated + service_role (checks admin inside); no INSERT/UPDATE/DELETE/TRUNCATE grant for anon/authenticated/service_role on `commissions` or `commission_review_flags`; both unique indexes and both triggers present; tables empty. Deploy the CareHub code now.
Tests: payments folder 441 passed with `PG_CONCURRENCY_URL` set (real-Postgres included); CareHub phase-07 files 51 passed. Mutation-checked: dropping the business lock and the unique indexes fails the overlapping-transactions test (12 "first" payments).
Unresolved / for owner: the tier-based `agent_earnings`/payout program (10/5/3%) is a separate scheme from the 40/5 referral commissions: which should pay the agent, or both? (`double_program` reconciliation flags overlaps; decision needed before Phase 08 payouts); deploy Phase 04-07 code; decision recorded 2026-10-04: agents are paid from referral commissions only, the tier-based agent_earnings scheme is to be retired in Phase 08; docs relocation still unresolved.
Next phase: PHASE 08 — WITHDRAWAL ENGINE.

## Phase 08 — Withdrawal engine

Completed work: one withdrawal architecture for CareFind (CareCoins) and CareHub (business wallets). States reserved -> processing -> completed -> reversed, failed -> refunded, enforced by a trigger. The database creates the request and derives the Paystack reference from its id (no client reference, no latest-row lookup, F-01); reservation is atomic (balance, rolling 24h cap, ledger debit, request row, payout from `financial_config`) and commits before any Paystack call; the transfer is linked by request id; every provider outcome (webhook, sweep, admin, handler recovery) settles through `settle_withdrawal` / `settle_business_withdrawal`: replay-safe, refund at most once, completes only for the reserved amount, completed-then-reversed transfers are refunded, contradictory signals are reported not applied. Request tables are write-locked for every role. CareHub gained the controls CareFind has (F-08): withdrawal PIN (new `/api/withdrawal-pin`, replacing a PIN needs the current one), bank-account-name verification, minimum N100 and N1,000,000/24h cap (owner decision 2026-10-04, in `financial_config`). `verifyBusiness` ILIKE wildcard fixed (F-09). Legacy functions incl. the replay branch and the 5-arg overload dropped (F-16). Shared lifecycle logic moved to `shared-payments`. Also fixed a false alarm in the Phase 07 commission reconcile found by the concurrency suite.
Files: migrations `carefind_20261008_withdrawal_engine.sql`, `carefind_20261008_commission_reconcile_first_payment.sql` (+ copies in `apps/carefind/sql/`); `packages/shared-payments/src/{withdrawals,pin}.js`; CareFind `api/_handlers/{initiate-withdrawal,paystack-webhook,admin-auth,cancel-appointment}.js`, `api/_lib/{withdrawalRecovery,withdrawalEffects,withdrawalAdmin,pinCrypto}.js`, admin UI (`WithdrawalsTab`, repositories), design-system `StatusBadge`; CareHub `api/_handlers/{initiate-business-withdrawal,withdrawal-pin}.js`, `api/_lib/{verifyBusiness,withdrawalRecovery}.js`, `api/router.js`, `src/modules/wallet/{WithdrawalPinField,withdrawalApi}`, Wallet and Appointments screens; docs `docs/architecture/Withdrawal-Engine.md`.
Migrations: 2 — **APPLIED to production 2026-10-05** (`carefind_20261008_commission_reconcile_first_payment`, then `carefind_20261008_withdrawal_engine` at the owner's instruction, before the code deploy: until the new CareFind/CareHub code is live, withdrawals on the OLD code fail). Catalog re-read: one function per name, the guard executable by nobody, the rest service_role only, no write grants on either request table, no legacy function left; existing rows migrated (3 CareFind `reserved`, 1 business `refunded`); `reconcile_withdrawals` reports only the 3 legacy `stuck` rows. Found while testing the production-shaped data BEFORE applying: the guard trigger and a NOT VALID check would have blocked refunding legacy rows without a reference - fixed in the migration as applied.
Tests: CareFind payments + api with `PG_CONCURRENCY_URL` set: 692 passed (55 files; includes PGlite 27 + real-Postgres 10 withdrawal tests, mutation-checked); shared-payments 188 passed; CareHub api 170 passed + wallet UI 15; CareHub production build passes.
Found: F-32 CareFind `/api/withdrawal-pin/set` lets any session replace a PIN (needs a forgot-PIN flow); F-33 `cancel-appointment` marks card payments refunded without moving money and used to abuse the withdrawal path (Phase 09); 3 legacy CareFind withdrawals (41 coins) debited with no transfer in production, two without a reference: admin reject needed.
Unresolved: apply + deploy; decide on the 3 legacy withdrawals; F-32/F-33; refund engine (Phase 09); business wallets still have no balance ledger of their own beyond `business_wallet_transactions`; docs relocation; `callback_url` client-supplied (F-27).
Next phase: PHASE 09 — REFUND ENGINE.

## Phase 09 — Refund engine

Completed work: one `refunds` table and one door for CareFind and CareHub refunds. Kinds: `card` (completes ONLY when Paystack confirms), `carecoin` (ledger, same transaction), `platform_funded` (platform pays, business keeps its money). `request_refund` is atomic: policy checks, entity lock, the business share taken back (held first, then available, never below zero, shortfall recorded), one live refund per payment; the provider is called after it commits. `settle_refund` is the only door for provider outcomes (webhook, sweep, handler): replay-safe, amount-checked, a failure restores the business exactly, contradictions reported. Payments that could not be applied (`needs_refund`) are refunded in full. Cancelled-but-unrefunded appointments are retried by the cron. Reconciliation covers 11 inconsistency kinds. `PaystackProvider.verifyRefund` added; the sweep asks the provider before ever re-sending. Retired `refund_appointment_payment` (refunded coins for card payments). Owner policy confirmed 2026-10-05 (full refund when the business cancels any time or the patient cancels 24h+ ahead; platform absorbs Paystack's fee).
Files: migration `carefind_20261009_refund_engine.sql` (+ copy in `apps/carefind/sql/`); `packages/shared-payments/src/{refunds,paystack/PaystackProvider,PaymentProvider}.js`; CareFind `api/_handlers/{cancel-appointment,paystack-webhook}.js`, `api/cron/process-email-outbox.js`; CareHub `api/_handlers/cron-reconcile-payments.js`; docs `docs/architecture/Refund-Engine.md`.
Migrations: 2 — **APPLIED to production 2026-10-05**: `carefind_20261008_commission_reconcile_first_payment` (replaces the Phase 07 reconcile function) and `carefind_20261009_refund_engine`. Catalog re-read: one function per name, `refunds_guard` executable by nobody, the rest service_role only, `refunds` has RLS and no grants, `appointments.cancelled_at` now exists, `refund_appointment_payment` gone, `reconcile_refunds` and `reconcile_commissions` return 0 rows.
Tests: PGlite 20 + real-Postgres 8 (mutation-checked); shared-payments 25 + 4; CareFind cancel-appointment 10, webhook refund events 4; CareHub cron 2.
Found: **F-34** production lacked `appointments.cancelled_at`, so `cancel-appointment` failed on EVERY cancellation (migration drift; fixed by the refund migration); `refund_appointment_payment` refunded coins to nobody for card payments.
Unresolved: **deploy Phase 04-09 code NOW** (the Phase 08 migration is live, so withdrawals on the old code fail); Paystack must send `refund.*` events to the shared webhook; shop returns are not on the engine (Phase 10); no admin UI for admin/platform-funded refunds; F-32 (CareFind PIN replaceable by any session); 3 legacy withdrawals (41 coins) need an admin decision.
Next phase: PHASE 10 — CENTRAL SETTLEMENT ENGINE.

## Shop commission and vendor payout (decisions log, 2026-10-05)

| Question | Decision | Status |
|---|---|---|
| Shop commission | **20% flat** on the order subtotal, every segment (replaces 10 / 5 / 2.5). New orders only; an order's commission is stored at creation. One config row `shop_commission_rate`; terms v3 (v2's text, the commission sentence at 20%) becomes the active version | DECIDED (owner), implemented; migration `carefind_20261011_shop_commission_flat` **APPLIED to production 2026-10-05** (deploy the CareFind/CareHub code that carries 20% in `pricing.js` / `ecommerceSegments.js`: until then the old clients compute the old commission and `create_shop_order` refuses the order) |
| Vendor payout model for shop sales | Reuse the business wallet and the withdrawal engine. PAID order: vendor credited `subtotal - commission` into `held_balance`; released to `available_balance` once delivered + 7 days (= the customer return window, one config row); withdrawn through the PIN-protected engine. Refunds/returns recover the vendor share (released: available first; held: held first; never negative; shortfall recorded) and restore it exactly if the provider fails. See `docs/architecture/Vendor-Payout-Model.md` | DECIDED (owner: "lets build the vendor model"), IMPLEMENTED; migrations `carefind_20261012_shop_vendor_payouts` and `carefind_20261013_shop_return_hardening` APPLIED 2026-10-05; cron release sweep ships with the next deploy |

## Phase 10 — Central settlement engine

Completed work: there is now ONE definition of card settlement, `settle_payment_intent`, for every purpose. The shop (the last purpose settled elsewhere) joined it: `_settle_shop_order` re-checks customer, vendor, payability and amount under the order lock and writes the order, the attempt ledger, the history and the notice in one transaction; a payment that cannot be applied becomes `needs_refund`. The second definitions are gone: `verify_shop_payment` ("here we trust the reference presence"), `claim_payment_event` (F-28), `settle_card_booking`; the per-purpose money primitives (`credit_wallet_topup`, `settle_subscription_payment`, `settle_consultation_payment`, `renew_business_plan`, `fn_credit_business_booking`) are engine internals, EXECUTE revoked from every API role. Node: the webhook's metadata dispatch (6 branches, decided by client-influenced `metadata`) and its helper libs are deleted (575 -> 158 lines); `initiate-shop-payment` records an intent for the order's own total before Paystack and never takes a second payment for an attempt that was already paid; `verify-shop-payment` and the webhook only call the engine; the order a client names must be the intent's own. Shop effects are shared and run once. A charge no intent recognises is acknowledged, recorded `ignored` and logged `payment.unmatched_charge`, never guessed.
Files: migration `carefind_20261010_central_settlement.sql` (+ copy in `apps/carefind/sql/`); `packages/shared-payments/src/{effects,requestSettlement,settlement}.js`; CareFind `api/_handlers/{initiate-shop-payment,verify-shop-payment,paystack-webhook}.js`, `api/_lib/intentSettlement.js`, deleted `api/_lib/{paystackCredit,consultationSettle}.js`; docs `docs/architecture/Settlement-Engine.md`.
Migrations: 1 — **APPLIED to production 2026-10-05** (`carefind_20261010_central_settlement`, at the owner's instruction, before the code deploy: until the new CareFind code is live the OLD shop code fails because `verify_shop_payment` and `claim_payment_event` are gone). Catalog re-read: one `settle_payment_intent` (service_role only), `_settle_shop_order` and the five money primitives executable by nobody, the three legacy functions gone.
Tests: PGlite 13 + real-Postgres 4 (shop under concurrency); shop handlers 19; shared-payments +4; webhook tests rewritten. Full CareFind payments + api run recorded in the report.
Found: the webhook settled money from event `metadata` (client-influenced) in six branches; the shop "verified" a payment by trusting the reference; `claim_payment_event` was executable by any signed-in user (F-28, closed by removal).
Unresolved: DEPLOY the Phase 04-10 code now (and watch for `payment.unmatched_charge` until Phase 11's reconciliation lists them); shop commission 20% flat (owner decision 2026-10-05) is IMPLEMENTED but its migration `carefind_20261011_shop_commission_flat` is NOT applied: apply it WITH the CareFind deploy (create_shop_order compares the client's commission with the database function; the new pricing.js carries 20%); vendors who accepted terms v1/v2 are charged 20% on new orders per the owner's decision and should be asked to accept terms v3 (legal text to be reviewed); vendor payout model: RECOMMENDED below, awaiting the owner's go; shop returns/refunds (`request-shop-return`) still use their own RPC amounts; F-27 `callback_url`; F-32; the 3 legacy withdrawals.
Next phase: PHASE 11 — WEBHOOKS AND RECONCILIATION.

## Vendor payout model (post Phase 10, 2026-10-05)

Completed work: shop sales now pay the vendor. `_settle_shop_order` credits `subtotal - commission` (held) in the payment's own transaction (one `shop_vendor_credits` row per order, unique ledger reference); `release_shop_vendor_credits` (cron) moves it to available after delivery + the 7-day return window; the refund engine gained a third entity, `shop_order` (causes `shop_return`, `order_cancelled`, partial or full, vendor recovery pro rata, exact restore on failure); `cancel_shop_order` now refunds paid orders and `process_shop_return` approve starts a real card refund (before: it only flipped statuses and kept the customer's money); `request_shop_return` hardened (anon revoked, amount capped at what was paid, window from the first delivery). `reconcile_shop_vendor_credits()` added. Wallet history labels shop sales.
Files: migrations `carefind_20261012_shop_vendor_payouts.sql`, `carefind_20261013_shop_return_hardening.sql` (+ copies in `apps/carefind/sql/`); CareFind `api/cron/process-email-outbox.js` (release sweep); CareHub `Wallet.jsx` (labels, totals); tests `vendorPayouts.db.test.js` (34) and `vendorPayoutsConcurrency.pg.test.js` (5, real Postgres; mutation-checked); doc `docs/architecture/Vendor-Payout-Model.md`.
Migrations: 2 - both **APPLIED** 2026-10-05; catalog re-read (request_refund exists once, service_role only; anon revoked on the three return/cancel functions; `_settle_shop_order` private). The repo copy of `20261012` carries explanatory comments the applied text omits (functionally identical).
Tests: CareFind 2059, CareHub 1216, shared-payments 219, all passing (real-Postgres suites run sequentially).
Found and fixed: `process_shop_return` approve moved no money; `cancel_shop_order` kept the customer's money for paid orders; `request_shop_return` was executable by `anon`, accepted any refund amount, and measured the window from `updated_at`; (test-found) a partial-refund history row restarted the release window, now measured from the first delivery.
Unresolved: (1) the 9 orders paid before credits (CF-000012...000026, N1,170 of vendor share) are listed by `reconcile_shop_vendor_credits()` for a human decision, not auto-credited, because the old flow never verified those payments with Paystack; (2) deploy the code (the sweep that releases held money is in the cron); (3) a second partial refund of one order is not possible (one live refund per order); (4) no admin UI for platform-funded shop refunds; (5) vendors who accepted terms v1/v2 should accept v3; (6) shop returns cannot be refunded to wallet/manual, only to the original card.

## Phase 11 — Webhooks and reconciliation

Completed work: failures are now recoverable and visible. (1) What a Paystack event means moved to `api/_lib/webhookProcessor.js`, so a stored event whose processing failed is replayed by exactly the live code; bad signatures are logged. (2) `shared-payments/reconciliation.js`: replay of failed/stuck events; a sweep that asks Paystack about payments still open after 15 minutes and settles them through the one engine (and closes never-paid expired attempts); a comparison of Paystack's own list of successful charges with our intents (`charge_without_intent`, `amount_mismatch`, `transaction_id_mismatch`, `paid_not_settled`); `PaymentProvider.listTransactions` added. (3) Database: `reconciliation_findings` (auto-resolve, reopen, acknowledge, dismiss-with-note), `reconciliation_runs`, one writer `sync_reconciliation_findings`, and `run_db_reconciliation()` which finally RUNS every engine's reconcile function plus new checks on payment intents and webhook events (including every charge no intent recognised). (4) `financial_config_history` (who changed which commercial constant). (5) CareFind admin API actions to list, acknowledge/dismiss and run now; the cron runs a pass daily.
Files: migration `carefind_20261014_reconciliation.sql` (+ copy in `apps/carefind/sql/`); `packages/shared-payments/src/{reconciliation,PaymentProvider,index,paystack/PaystackProvider}.js`; CareFind `api/_lib/{webhookProcessor,financeReconcile}.js`, `api/_handlers/{paystack-webhook,admin-auth}.js`, `api/cron/process-email-outbox.js`; doc `docs/architecture/Reconciliation.md`.
Migrations: 1 - **APPLIED 2026-10-05**; catalog re-read (all functions `service_role` only, tables unreadable by every API role, 18 config baselines). First live run: 0 critical; 3 warnings (the 3 legacy withdrawals), 9 info (the 9 pre-credit shop orders); coins, commissions, refunds, intents and events clean.
Tests: reconciliation.db 19; reconciliationConcurrency.pg 3 (mutation-checked); shared-payments reconciliation 22 + listTransactions 3; CareFind admin actions 6 + wiring 1.
Found: nothing ran the engine reconcile functions and nothing stored or reported their results; a webhook that failed past Paystack's retries was lost for good; a payment missed by both the redirect and the webhook stayed unsettled indefinitely; `payment.unmatched_charge` existed only as a log line.
Unresolved: no alert channel (owner's choice: email, Slack, PagerDuty); no admin screen for findings (API only); the cron is daily, so a payment recoverable only by the sweep can wait up to a day; no reverse comparison of settled intents against the provider list; Paystack payout/settlement-batch reconciliation is out of scope; deploy the Phase 04-11 code.
Follow-up (owner: email alerts, admin screen, cadence): migration `carefind_20261015_reconciliation_ops` APPLIED 2026-10-05. Critical findings are emailed to the platform admins through the catalog event `finance_alert` (once, then daily while open and unacknowledged; a failed send releases the claim); the "Money Checks" admin screen lists, acknowledges, dismisses (with a note), reopens and runs checks now; `claim_job_slot` gates every step because the CareFind cron endpoint runs EVERY MINUTE (Supabase Cron), not daily (replay/sweep 5 min, Paystack comparison 30, database checks 10); the sweep backs off per intent (10 min, hourly, 12 hourly). Tests added: reconciliation.db +9, concurrency.pg +2, shared-payments +14, CareFind alerts/recipients 9, Money Checks screen 10, shared-email finance_alert 5. Also removed two stale entries from the shrink-only subject-offender list (the shop webhook paths no longer offend since Phase 10).
Next phase: PHASE 12 — PERFORMANCE AND RESILIENCE.

## Phase 12 — Performance and resilience

Completed work: measured first, then fixed. A benchmark (`apps/carefind/src/test/payments/bench/scale.bench.mjs`) loads 100,000 settled payments (200,000 webhook events, 160,000 ledger rows, 40,000 shop orders) into a real Postgres and times everything that runs on a schedule or per payment. Database: (1) `sync_reconciliation_findings` was quadratic (80,000 findings = more than 4 minutes per run): now set-based, with each source capped at 500 findings plus one summary finding; (2) `reconcile_shop_vendor_credits` evaluated a config lookup per order (7 s at 40,000 orders): computed once (0.9 s -> 0.15 s at 3,000); (3) partial indexes for the unmatched-charge and settled-without-transaction-id checks (no sequential scans); (4) the history-sized checks split into light (every 10 minutes) and heavy (hourly); (5) the shop settlement touches the vendor wallet row last and with a plain UPDATE (one-vendor burst median 205 ms -> 20 ms); the booking credit got the same shape AND became replay-safe (it credited the wallet before its ledger insert and ignored a duplicate ledger row); (6) `lock_timeout` 10 s and `statement_timeout` 30 s (120 s for reconciliation) on every engine entry point, re-applied by `_apply_engine_timeouts()`. Node: `rpcWithRetry` (infrastructure errors only, never business errors) on the settlement, refund and withdrawal settle calls; `scheduler.js` (one deadline per cron invocation, per-step intervals behind the atomic `claim_job_slot`, a provider circuit breaker that stops a sweep after three consecutive provider outages); `financeJobs.js` runs vendor release, withdrawal sweep, refund sweep and reconciliation as named steps; `vercel.json` gives the email cron function 60 s. Discovered: the CareFind cron endpoint is driven EVERY MINUTE by Supabase Cron (not daily), so every sweep was running every minute with no deadline.
Files: migrations `carefind_20261016_reconciliation_scale.sql`, `carefind_20261017_engine_timeouts_and_hot_paths.sql` (+ copies in `apps/carefind/sql/`); `packages/shared-payments/src/{rpcRetry,scheduler,reconciliation,refunds,withdrawals,settlement,index}.js`; CareFind `api/_lib/{financeJobs,financeReconcile}.js`, `api/cron/process-email-outbox.js`, `vercel.json`; bench `src/test/payments/bench/scale.bench.mjs`; doc `docs/architecture/Performance-and-Resilience.md`.
Tests: engineTimeouts.db 6; reconciliation.db 36 (+8 at scale); shared-payments rpcRetry 28, scheduler 27, reconciliation +4; CareFind financeJobs 7; the vendor payout and concurrency suites now run on the final code.
Found: the quadratic sync; the per-row config lookup; unbounded waits on locks; a hot wallet row locked mid-transaction; `fn_credit_business_booking` not replay-safe on its own; every sweep running every minute without a deadline; two stale entries removed from the shrink-only subject-offender list earlier in the phase.
Unresolved: a p95 of about 5 s remains in a 20-way single-vendor burst on the Windows dev database (row-lock queueing on one wallet row; not attributed further, not claimed fixed); the finance steps still share the email cron function (a dedicated endpoint needs a Vault secret and a function slot); event retention/archiving is an owner decision; no load test on a production-like Linux database; deploy the Phase 04-12 code.
Applied to production 2026-10-05: `carefind_20261016_reconciliation_scale`, `carefind_20261017_engine_timeouts_and_hot_paths`, and `carefind_20261016b_sync_findings_small_report_fast_path` (the repo file of 16 already contains the final sync function: creating and analysing a temp table cost about 0.5 s per call on a busy machine for a report of three findings, so the index and statistics are built only for reports over 500 findings). Catalog re-read: engine functions service_role-only with lock_timeout 10s / statement_timeout 30s (120s for reconciliation); `fn_credit_business_booking`, `_settle_shop_order`, `_apply_engine_timeouts`, `_recon_*` private; a live reconciliation run unchanged (0 critical). Side effect worth knowing: the new lock_timeout makes a pile-up of overlapping reconciliation runs fail fast with 55P03 (the next minute's run retries) instead of waiting; the concurrency tests were re-sized accordingly.
Next phase: PHASE 13 — FINANCIAL TEST SUITE.

## Phase 13 — Financial test suite

Completed work: asked whether the tests would NOTICE wrong money code, and proved it. (1) `financialInvariants.db.test.js`: seeded random programs (top-ups, subscriptions, shop orders, bookings, deliveries, release, full and partial refunds that complete or fail, coin withdrawals) run through the real engines; after every step the coin wallets equal their ledgers, nothing is negative and business wallets equal their ledgers; at the end every card payment is split completely, settled payments have transaction ids and paid entities, refunds never exceed payments, reconciliation is clean; and replaying EVERY call twice ends in identical books. (2) Mutation testing: 25 deliberate defects in money code (`npm run test:mutation`, always restores the file); first run killed 21, the 3 survivors were real holes (an untested reconciliation branch, an untested webhook-replay rule, a stale mutant), all closed: 25/25 killed. (3) CI: a `finance-suite` job (Postgres 16 service) runs the shared-payments package, the PGlite engines and handlers, and the real-Postgres concurrency suites, and is triggered by `supabase/**`. (4) Handler tests for the uncovered money and auth endpoints; scripts `test:finance`, `test:finance:pg`, `test:mutation`, `bench:finance`.
Found: **a regression I introduced** - `request_shop_return` hardening (20261013) refused the server endpoint's service-role call (no auth.uid()), so every customer return request would have failed; no delivered order or return existed yet, so nobody was affected. Fixed by `carefind_20261018_shop_return_service_caller` (the function acts for the customer NAMED by a service-role caller and applies the ownership test; a signed-in caller can never use the parameter; the endpoint passes the authenticated user), APPLIED 2026-10-06; the refund engine's tests exercised superseded definitions (now the full migration chain); CI never ran shared-payments, the concurrency suites, or reacted to migration changes; `checkBalance` summed all currencies (fixed, NGN only); `lookup-appointment` returns a patient's appointments to anyone who knows a phone number and business id, and `resolve-account` is an unauthenticated account-name oracle (both for Phase 14).
Files: `docs/architecture/Financial-Test-Plan.md`; migration `carefind_20261018_shop_return_service_caller.sql` (+ copy); `apps/carefind/src/test/payments/{financialInvariants.db,bookingCredits,engineTimeouts}.test.js` and `mutation/`; handler tests under `api/_handlers` and `api/_lib/__tests__`; `packages/shared-payments/src/__tests__/{effects,events}.test.js`; `.github/workflows/carefind-ci.yml`; `apps/carefind/package.json`.
Tests: CareFind api + payments 926 pass (74 files, real-Postgres suites included); shared-payments 333 (97% lines).
Unresolved: the migrations are tested on PGlite and a plain Postgres server, never on Supabase's own stack; no browser end-to-end of a payment; mutants should grow with every bug; CareHub handlers not re-audited; the two exposures above; deploy the Phase 04-13 code.
Next phase: PHASE 14 — RED-TEAM AUDIT.

## Phase 14 — Red-team audit

Completed work: attacked the system as an anonymous visitor, a customer, a vendor and a business member; 8 findings (2 critical, 2 high, 2 medium, 1 low plus F-43 policy gaps), each reproduced as a test before the fix. Critical: any user's password could be reset via `provision_staff_auth` (F-37); the vendor credit could be inflated through an unchecked subtotal (F-38). High: any user could change any order's status (F-39); completing dummy appointments drained a business's held balance (F-40); anon could read purchase records (F-41).
Files: `supabase/migrations/carefind_20261019_red_team_fixes.sql` (+ copy in `apps/carefind/sql/`), `apps/carefind/src/test/payments/redTeam.db.test.js` (30 tests), fixture additions, `docs/architecture/Red-Team-Audit.md`.
Tests: redTeam 30 pass; PGlite payments suite 33 files / 621 tests pass.
Unresolved: the full PGlite and real-Postgres concurrency suites not re-run since migration 19 joined the chains (7 mutants killed); the first production apply rolled back on live parameter defaults the test fixture lacked (fixed, second apply clean); endpoint/webhook/CORS/CareHub/referral/storage review not done; vendor-controlled delivered status, mint squatting, lookup-appointment and resolve-account exposures remain.
Applied to production 2026-10-06 and catalog-verified (see Red-Team-Audit.md section 5).
Next phase: PHASE 15 — PRODUCTION READINESS.

## Phase 15 — Production readiness

Completed work: read the live system as a go-live reviewer. Full finance suite on the final code: 67 files / 898 tests pass. Security advisors reviewed (money-adjacent SECURITY DEFINER functions each read; none lacks a caller check). Wrote the deploy runbook, rollback, monitoring queries and go/no-go in `docs/architecture/Production-Readiness.md`.
Found: **every scheduled job in production fails**: all 2,880 pg_cron runs in 24 h raised `Vault secret email_outbox_cron_<app>_url is not set` (the secrets for the two cron URLs and the shared secret were never set), so neither app's email outbox is drained and the scheduled finance steps (webhook replay, sweeps, vendor release, reconciliation, alert mail) never run. No kill switch exists for the engines (proposal in the doc). Backups/PITR could not be verified from here. Leaked-password protection is off.
Files: `docs/architecture/Production-Readiness.md`.
Unresolved (owner): deploy the Phase 04-14 code, THEN set the three Vault secrets; confirm backups/PITR; enable leaked-password protection; decide the kill-switch proposal, a second alert channel, event retention, the 3 legacy withdrawals and the 9 pre-credit shop orders; the Phase 14 not-done review areas; `test:finance:pg` not re-run this session.
Phase status: the planned 16-phase program (00-15) is complete; go-live is gated on the owner items above.

## Phase 16 — Wallet top-up & ecosystem spend

Completed work (originally by Joepuils, merged onto the payout-accounts branch; the payout-account and PIN-code parts of that commit were NOT taken, the KYC-based versions replace them):
* **CareHub business wallet card top-up (B1-B2):** `initiate-wallet-topup` / `verify-wallet-topup` (server-priced, N100 - N100,000 bounds, purpose `business_wallet_topup` through the one settlement engine); `topupApi.js` plus the "Add funds" card on the CareHub Wallet screen. CareFind's own top-up is unchanged (`wallet_topup` via `initiate-payment`).
* **Wallet-balance spend (C1-C4):** seven new intent purposes settle from a wallet (`booking_wallet`, `subscription_wallet`, `consultation_wallet`, `shop_order_wallet`, `plan_renewal_wallet`, `appointment_fee_wallet`, `business_wallet_topup`) through the one `settle_payment_intent` engine via private `_settle_*_wallet` handlers that are never client-callable. **Wiring status:** only `business_wallet_topup` has end-to-end handlers and UI; the other six are engine capability proven by tests, no client creates those intents yet.
* **CareCoin provenance (D1):** every positive coin credit must be traceable; `create_withdrawal` refuses to withdraw past `balance - untraceable` (`untraceable_credits`, handler 403 + `wallet_needs_attention` email); `reconcile_coin_provenance()` feeds `run_db_reconciliation`. Rule: `CareCoin-Wallet.md` §3. Business withdrawals are exempt.

Migration: `carefind_20261020_wallet_spend_and_topup.sql` (+ mirror in `supabase/migrations/`), **NOT applied to production**. Details and rollout: `docs/architecture/Wallet-Spend-and-Topup.md`.


---

# Payment Security Hardening track (H00-H07)

Separate from Phases 00-16 above (which stay as written). Scope, order and rules were set by the owner on 2026-10-10: one phase at a time, stop after each report, nothing applied to production / deployed / sent as a real payment without explicit authorization, no weakened tests, no commercial-rate changes, **no paid KYC (Dojah or any other) as a payment or withdrawal prerequisite**.

| Phase | Status |
|---|---|
| H00 Baseline audit | READY_FOR_REVIEW (read-only; this section) |
| H01 Shared OTP security | READY_FOR_REVIEW (migration written, NOT applied; `OTP_HMAC_SECRET` must be set before deploy) |
| H02 PIN and payout-account protection | READY_FOR_REVIEW (migration written, NOT applied; new caps apply to all users, see commercial effect) |
| H03 Payment and settlement security | READY_FOR_REVIEW (migration written, NOT applied; apply before deploy; 10% top-up fee per owner) |
| H04 Withdrawal state machine | READY_FOR_REVIEW (migration written, NOT applied; apply before deploy; legacy-row SQL for the owner) |
| H05 Shared payment email system | READY_FOR_REVIEW (migration written, NOT applied; no payment e-mail has ever been sent in production: deploy + Vault secrets first) |
| H06 KYC exclusion | READY_FOR_REVIEW (migration written, NOT applied; code is safe before and after it: a missing row means OFF) |
| H07 Tests and release gate | READY_FOR_REVIEW (CI and gate written locally, NOT pushed; both apps' production-dependency audits FAIL, pre-existing, owner decision) |

## H00 - Baseline audit (read-only)

Method: read the OTP / PIN / payout-account / KYC / withdrawal code in `packages/shared-payments`, `shared-email`, `shared-notifications`, `shared-payout-ui` and both apps' handlers; the OTP, PIN, payout-account, limits and withdrawal-OTP migrations; CI workflows; read production's migration LIST (names and versions only, project `szdybxmgmhndoytqanfb`, via `list_migrations`). No SQL was run against production, so **live ACLs, RLS and config values (for example `payout_account_required`) are NOT verified here**. No file other than this section was changed.

### Inventory (IMPL implemented / PART partial / MISSING / UNSAFE)

| Feature | Status | Where / evidence |
|---|---|---|
| CSPRNG 6-digit code | IMPL | `shared-payments/src/otp.js` `crypto.randomInt` |
| Keyed OTP hash, no plaintext stored | IMPL (key choice: H-02) | `otp.js` `hashOtp` HMAC-SHA256 of `userId:purpose:code`; `otp_challenges.code_hash` |
| Purpose + user binding | IMPL | hash input and `(user_id, purpose)` lookup in `issue_otp` / `verify_otp` |
| 5-min expiry, 5 attempts, single use, row-locked verify | IMPL | `supabase/migrations/carefind_20261024_otp_challenges.sql` |
| Resend cooldown 60 s, 3 per hour per user+purpose, atomic | IMPL | same file, advisory lock |
| IP / global OTP abuse controls | MISSING | none in `otp.js` or SQL (H-03) |
| OTP never logged / returned | IMPL | `sendOtp` returns a masked address only; provider error logged without the code |
| OTP delivery | IMPL | direct send, not via outbox, by design (`securityEmails.js` header) |
| PIN hash (scrypt, per-user salt), 5 failures -> 15 min lock | IMPL | `shared-payments/src/pin.js`, `carefind_20260816_withdrawal_pin.sql` |
| PIN set/replace needs emailed OTP (+ current PIN unless forgot) | IMPL | `setWithdrawalPin`; handlers in both apps |
| PIN recovery ("forgot") | PART | same function with `forgot:true`; OTP only; no distinct recovery notification, no post-change cooling-off (H-09) |
| Payout account add: bank-resolved name, name match, OTP, limit 5, duplicates | IMPL but KYC-gated | `payoutAccounts.js` `addPayoutAccount` (H-01) |
| Payout account remove: PIN + alert | IMPL | `payoutHandlers.js` `remove` |
| Payout account set-default | PART | `setDefaultPayoutAccount`: session only, no PIN/OTP, no alert (H-08) |
| Payout account "replace" | n/a | modelled as add + remove |
| Withdrawal: PIN, then OTP, then bank-name check, then atomic reserve | IMPL | `initiate-withdrawal.js`, `initiate-business-withdrawal.js` |
| CareFind withdrawal uses the shared PIN gate | UNSAFE (drift) | inline copy of `checkWithdrawalPin` in `initiate-withdrawal.js` (H-05) |
| Destination forced from DB for saved accounts | IMPL | `getPayoutAccountForWithdrawal` |
| Typed-in destination | PART | allowed while `payout_account_required = 0`; unsupported-bank branch trusts the typed name (H-06) |
| Withdrawal state machine, reservation, reference from request id | IMPL (Phase 08; re-audit in H04) | `create_withdrawal`, `settle_withdrawal`, `shared-payments/src/withdrawals.js` |
| Paystack webhook: HMAC-SHA512, constant-time, stored events, replay | IMPL | `apps/carefind/api/_handlers/paystack-webhook.js` |
| CareHub Paystack webhook | n/a | none; CareHub intents settle through CareFind's shared endpoint (confirm the Paystack dashboard config in H03) |
| Settlement / refunds / reconciliation engines | IMPL (Phases 04-14; re-audit in H03/H04) | `settle_payment_intent`, `request_refund`, `run_db_reconciliation` |
| Email outbox with retry, backoff, dead state, idempotency key | IMPL | `EmailService.js`, `20261002_email_outbox_*` |
| Escaping of template variables | IMPL (re-verify in H05) | `shared-email/src/utils/escapeHtml.js`, `layout.js` `html` tag |
| Security emails (OTP, PIN changed, PIN locked, payout added/removed) | PART | `securityEmails.js`; sent directly; alert failures swallowed (H-04) |
| Payment receipt / failure | IMPL | templates `payment_success`, `payment_failed` |
| Withdrawal requested / completed / failed | IMPL | templates present; **processing: MISSING** |
| Refund completed | IMPL | `refund_completed`; **refund requested / failed: MISSING** |
| Wallet top-up receipt | NOT FOUND | no dedicated template located by key search (confirm in H05) |
| Alerts for other sensitive changes (default account) | MISSING | H-08 |
| `shared-notifications` | IMPL, unrelated to payment security | adapters + types only |
| Paid KYC (Dojah) | IMPL and COUPLED to payout accounts / limits | see KYC map |

### Findings

Severity is my assessment from reading code; none was reproduced in this phase.

* **H-01 (High, conflicts with the brief): KYC gates payout accounts and can gate withdrawals.** `addPayoutAccount` refuses without `kyc_verifications.tier >= 1` (403 `kyc_required`); both withdrawal handlers refuse typed-in destinations when `financial_config.payout_account_required = 1`; per-person limits are lifted by KYC tier (`withdrawalLimits.js`). Live value of the flag not read.
* **H-02 (Medium): the OTP HMAC key falls back to `SUPABASE_SERVICE_ROLE_KEY`**, and the KYC hash secret falls back to the OTP secret and then the service key. The most powerful secret doubles as a hashing key; rotating one rotates the other and invalidates stored identifiers.
* **H-03 (Medium): no IP or global OTP controls**, only per-user-per-purpose (60 s / 3 per hour). The in-memory limiter (`rateLimit.js`) is per serverless instance and used only by `resolve-account`.
* **H-04 (Medium): security alert delivery failures are silently swallowed** (`.catch(() => {})` on PIN-changed, payout-account added/removed and PIN-locked). No outbox, no retry, no log line. Conflicts with "do not silently swallow delivery errors".
* **H-05 (Medium, duplication): CareFind `initiate-withdrawal.js` re-implements the PIN gate inline** while CareHub uses `checkWithdrawalPin`. The same file also contains a verbatim duplicated `untraceable_credits` block (the second copy is unreachable).
* **H-06 (Medium, confirm in H02): the unsupported-bank branch accepts the typed account name** with no bank confirmation (CareFind handler). Only reachable with no saved account.
* **H-07 (Low): OTP purposes live in three places** (SQL allowlist re-created by each migration, `OTP_PURPOSES`, the email `PURPOSES` map). Adding a purpose without all three fails at runtime.
* **H-08 (Medium): set-default payout account needs only a session** (no PIN, no alert), and the default decides where a one-click withdrawal goes.
* **H-09 (Medium): no cooling-off after a PIN change or PIN recovery.** Someone holding a session AND the inbox can reset the PIN and withdraw immediately (a fresh withdrawal OTP is still required; the cooling cap applies only to NEW payout accounts).
* **H-10 (Low): the OTP is consumed before bank resolution and reservation**, so a validation failure afterwards (limit, insufficient funds) costs the user a code and counts toward 3 per hour.
* **H-11 (Low, latent): outbox template `withdrawal_pin_otp` is registered** (`shared-email/src/templates/index.js`) from a superseded design. Nothing sends it; if something did, the live code would be persisted in the outbox payload.
* **H-12 (Medium): CI does not run `shared-email`, `shared-notifications` or `shared-payout-ui` tests**; CareHub CI does not run `shared-payments`; the real-Postgres concurrency job exists only in the CareFind workflow; `npm audit` covers the apps, not the packages.
* **H-13 (Low): housekeeping delete of `otp_challenges` is fire-and-forget from Node**; no scheduled purge.
* **H-14 (Low): `setWithdrawalPin` reads `hasPin` then writes** without a lock; OTP consumption bounds it, but it is not atomic.

### Contradictions between migrations, docs and production

1. Master plan Phase 16 (line 245) and the migration header say `carefind_20261020_wallet_spend_and_topup` is **NOT applied**. Production's migration list shows its 7 parts applied (`20261010110402` to `20261010110547`), and commit `6e1b4d2` says so.
2. `carefind_20261027_withdrawal_otp_purpose.sql` header: "NOT APPLIED". Production list: applied (`20261010115431`). Same for `carefind_20261026_notifications_insert_policy` (header NOT applied; applied `20261010105435`).
3. Repo names and dates differ from what ran: `carefind_20261024_otp_challenges.sql` (header: applied 2026-10-09) is `otp_challenges_table` at `20261009212046`; `carefind_20261025_payout_accounts_and_kyc.sql` is `payout_accounts_1..4`; `carefind_20261026_withdrawal_limits.sql` is `withdrawal_limits_config`. A migration-list diff will not match by name.
4. The OTP migration file ends with `drop function if exists reject_business_withdrawal(uuid)`, yet a migration named `reject_business_withdrawal` was applied (`20261009212302`). Whether the function still exists live is **unverified** (known trap: replaced or dropped RPCs leaving siblings; check `pg_proc`).
5. Master plan says Phase 16's payout/PIN parts "were NOT taken, KYC-based versions replace them". `docs/superpowers/{specs,plans}/2026-10-08-*` still describe `withdrawal_email_otps` + outbox `withdrawal_pin_otp`; the shipped design is `otp_challenges` + direct send.
6. Docs location: `docs/architecture/` (18 files) vs untracked `apps/docs/architecture/` (3 files); `CareFind-Payment-Flows.md` and `Financial-Architecture.md` show as deleted from `docs/` in the working tree. Still unresolved from Phase 05.
7. `CLAUDE.md` requires `docs/PROJECT_OVERVIEW.md`, `planning/ROADMAP.md`, `planning/CODE_AUDIT.md`; none exist, and `README.md` links CODE_AUDIT.
8. `shared-email/src/events.js` says it mirrors `docs/architecture/Email-System.md`, which does not exist. The README test table omits shared-email, shared-payments and shared-payout-ui.
9. Each migration exists twice (`supabase/migrations/` and `apps/carefind/sql/`).

### KYC dependency map (input for H06; nothing disabled in H00)

* shared-payments: `kyc/{DojahProvider,identity,nameMatch}.js`; `payoutAccounts.js` (KYC gate + legal-name match); `payoutHandlers.js` `createKycHandler`; `withdrawalLimits.js` (`kycTier`, tier caps); exports in `index.js`; tests `dojah`, `kycAndPayoutAccounts`, `nameMatch`, `payoutHandlers`, `withdrawalLimits`.
* Apps: `api/_handlers/kyc.js` + router entry (both); `initiate-withdrawal.js` imports `limitsForSavedAccount`; `PayoutAccountsPanel.jsx` (both); `shared-payout-ui` (`client.js`, `selfie.js`, `stores.js`).
* Database: `kyc_verifications`, `kyc_begin_attempt`, `kyc_save_verified`, `kyc_save_selfie`; config `payout_account_required`, `kyc_tier1_daily_cap_kobo`, `kyc_tier2_daily_cap_kobo`.
* Env: Dojah credentials, `KYC_HASH_SECRET`.
* Effective gate today: saving a payout account requires KYC; a withdrawal requires KYC only when `payout_account_required = 1` (live value unread). **Open design question for H02/H06:** without KYC there is no verified legal name, so "account name must match" needs a replacement rule (for example match the holder name on the platform profile or business registration) or an explicit owner decision to rely on the bank-resolved name plus OTP, PIN and cooling-off.

### Tests run (baseline, no code changed)

| Suite | Result |
|---|---|
| `packages/shared-payments` `npm test` | 22 files, 474 passed |
| `packages/shared-email` `vitest run` | first run 333 passed / 2 failed (failing names not captured); immediate re-run 335 / 335. Treated as a load-sensitive flake, cause not identified |
| `packages/shared-notifications` `vitest run` | 1 file, 12 passed |
| CareFind targeted (withdrawal-pin, initiate-withdrawal x3, withdrawalOtpPurpose.db, withdrawalPin) | 5 files, 54 passed |
| CareHub targeted (withdrawalPin, initiateBusinessWithdrawal x2) | 3 files, 46 passed |

Not run: full CareFind and CareHub suites, `shared-payout-ui`, real-Postgres concurrency suites (need `PG_CONCURRENCY_URL`), production builds, `npm audit`. H07 owns those.

### Unresolved / needs owner

* Live value of `payout_account_required` and live ACLs of `issue_otp`, `verify_otp`, `get_withdrawal_pin`, `payout_account_*`, `kyc_*` (one read-only catalog query; I did not run SQL on production).
* Whether `reject_business_withdrawal` still exists live.
* Canonical docs location.
* The name-match replacement rule once KYC is out (above).
* Whether Paystack sends CareHub events to the CareFind webhook (dashboard setting, not in the repo).

Next phase: **H01 - Shared OTP security** (done below).

### H00 addendum - live catalog read (2026-10-10, read-only SELECT on `szdybxmgmhndoytqanfb`, owner-authorized)

* ACLs: `issue_otp`, `verify_otp`, `get_withdrawal_pin`, `set_withdrawal_pin`, `verify_withdrawal_pin`, `payout_account_add/disable/set_default`, `kyc_begin_attempt/save_verified/save_selfie`, `create_withdrawal`, `create_business_withdrawal`, `reject_business_withdrawal`: EXECUTE for `postgres` and `service_role` only; one function per name (no overload siblings among these).
* `otp_challenges`, `withdrawal_pins`, `payout_accounts`, `kyc_verifications`: RLS on, zero policies, no anon/authenticated grants (`payout_accounts` and `kyc_verifications` are SELECT-only for service_role).
* `issue_otp` allowlist live: `pin_set`, `payout_account`, `withdrawal`.
* `financial_config.payout_account_required = 0`: typed-in bank details are still accepted, so KYC does **not** currently gate withdrawals. It gates only saving a payout account, and lifts the daily cap by tier (`kyc_tier1` N50,000, `kyc_tier2` N500,000; cooling-off N20,000 for 24 h).
* **`reject_business_withdrawal(uuid)` exists live** (service_role only). The repo's OTP migration says it was dropped as superseded by `settle_business_withdrawal`; the drop was never applied. It is a second door for business-withdrawal refunds: to be reviewed in H04, not changed in H00/H01.
* `otp_challenges` contains **zero rows**: no OTP has ever been issued in production, so the OTP, PIN-replace and payout-account flows have not been exercised live (consistent with the application code from Phases 04-16 not being deployed).

## H01 - Shared OTP security

Owner approval of the design: 2026-10-10 (chat). Scope was the OTP service only; PIN and payout-account rules are H02, the email delivery path is H05.

Already correct and left alone (verified by reading and by tests): CSPRNG codes, keyed hash bound to user and purpose, 5-minute expiry, 5 attempts per challenge, atomic row-locked single use, 60 s gap and 3 an hour per user and purpose, no code in any response, authenticated issuance bound to the session user (no account-enumeration surface).

Changes:
* **Dedicated key (H-02):** `OTP_HMAC_SECRET` is required when `NODE_ENV=production`; the service-role-key fallback now exists only outside production. A misconfigured deploy answers 503 `otp_unavailable` with an `otp.misconfigured` log line, before any database call.
* **IP and platform ceilings (H-03):** `issue_otp` takes `p_ip_hash` (keyed HMAC of the client address; the address is never stored). Per-IP (`otp_ip_hourly_cap`, default 10) and platform (`otp_global_hourly_cap`, default 500) hourly ceilings are read from `financial_config` and counted under advisory locks taken in a fixed order (user+purpose, ip, platform). Per-IP and per-user refusals share one response so a caller cannot tell which ceiling it hit; a platform refusal is 503. Client address comes from the edge-set headers first (`x-vercel-forwarded-for`, `x-real-ip`), never a browser-supplied first `X-Forwarded-For` entry.
* **One purpose registry (H-07):** `OTP_PURPOSE_VALUES` / `isOtpPurpose` in shared-payments; unknown purposes are refused in JS before the database on issue and verify. The email wording map is exported as `OTP_EMAIL_PURPOSES`. `otpPurposeRegistry.test.js` fails the build when the SQL allowlist, the JS constant and the email map disagree.
* **One `/otp` action (duplication):** `issueOtpFromRequest` in shared-payments replaces the copy-pasted purpose dispatch in both apps' `withdrawal-pin.js`; the payout-accounts route forwards the client IP too.
* **Purge (H-13):** the fire-and-forget delete in `sendOtp` is gone; cron step `otp_purge` (hourly, behind `claim_job_slot`) deletes codes older than a day through `purgeOtpChallenges`, and a failure is a reported failed step.
* **Logging:** structured JSON events `otp.issued`, `otp.rate_limited` (scope user / ip / global), `otp.verify_rejected`, `otp.delivery_failed`, `otp.misconfigured`, `otp.purged`. Fields: purpose, a keyed 12-character user reference, outcome. Never a code, address, IP, user id or key; provider error text is stripped of e-mail addresses.

Files:
* New: `supabase/migrations/carefind_20261028_otp_hardening.sql` (+ identical copy in `apps/carefind/sql/`); `packages/shared-payments/src/__tests__/otpHardening.test.js`; `apps/carefind/src/test/payments/{otpHardening.db,otpConcurrency.pg,otpPurposeRegistry}.test.js`.
* Changed: `packages/shared-payments/src/{otp,index,payoutAccounts,payoutHandlers}.js`; `packages/shared-email/src/{securityEmails,index}.js`; `apps/carefind/api/_handlers/withdrawal-pin.js`; `apps/carehub/api/_handlers/withdrawal-pin.js`; `apps/carefind/api/_lib/financeJobs.js` (+ its test: the step list now includes `otp_purge`); `docs/architecture/Payout-Accounts-and-KYC.md`.

Migration: `carefind_20261028_otp_hardening` - **NOT applied to production.** Adds `otp_challenges.ip_hash` (+2 indexes), two `financial_config` rows, drops the 4-argument `issue_otp` and creates the 5-argument one (service_role only). No DELETE statement in it. Old callers that pass four arguments keep working (the new parameter has a default), so it can be applied before the code deploy. After applying, re-read `pg_proc`: exactly one `issue_otp`, ACL `{postgres=X/postgres,service_role=X/postgres}`.

Tests (all run 2026-10-10 on the final code):
| Suite | Result |
|---|---|
| shared-payments (full) | 23 files, 494 passed (474 baseline + 20 new) |
| shared-email (full) | 15 files, 335 passed |
| shared-notifications | 12 passed |
| CareFind api + payments, PGlite, `*.pg.test.js` excluded | 77 files, 1020 passed (includes 16 new migration tests, 1 registry test) |
| CareFind real-Postgres suites (`pg.test`, `--no-file-parallelism`, PostgreSQL 17.5 via a throw-away embedded server, UTF8) | 9 files, 64 passed (includes the 6 new OTP concurrency tests: 30 racing verifies -> exactly 1 ok; 20 parallel wrong guesses -> 4 invalid + 1 locked; 40 accounts on one IP -> exactly 10 issued; 40 on 40 IPs with platform cap 15 -> exactly 15; mixed load -> no deadlock) |
| CareHub api | 19 files, 217 passed |
| Production builds | CareFind and CareHub build clean |
| Lint (`npm run lint`) | 0 errors in both apps (353 / 394 pre-existing warnings; not compared file by file) |

Mutation check: deleting the per-IP and platform advisory locks from the migration made both ceiling tests fail (40 issued instead of 10 / 15); file restored and re-verified.

Test-environment notes: no PostgreSQL was installed, so the real-concurrency suites were run against a throw-away embedded PostgreSQL 17.5 (production is 17.6; the Phase 05-13 notes used 18.4). A first run of the older `reconciliationConcurrency` and `vendorPayoutsConcurrency` suites failed only because that scratch cluster had been created with WIN1252 encoding (migrations contain Unicode arrows); recreated as UTF8 they pass. Not run: `shared-payout-ui`, `npm audit`, the mutation harness (`test:mutation`).

Unresolved / carried forward:
* **Before deploying H01 code: set `OTP_HMAC_SECRET` (its own value, not the service-role key) on both Vercel projects. Owner action; not done.** Zero rows exist in `otp_challenges` in production, so no in-flight code is invalidated by the key choice.
* Apply the migration (owner authorization needed).
* Behind a trusted proxy chain other than Vercel the IP headers would need re-checking; `clientIp` is only as trustworthy as the edge.
* H-10 (the withdrawal code is consumed before bank resolution, so a later validation failure costs the user a code) is deliberately unchanged: reordering would move a paid provider lookup ahead of the third factor. Revisit in H02.
* `reject_business_withdrawal(uuid)` still exists live (known from `Payout-Accounts-and-KYC.md` section 5); H04.
* KYC hash secret still falls back to `OTP_HMAC_SECRET`, then the service-role key (H06).

Next phase: **H02 - PIN and payout-account protection** (done below).

## H02 - PIN and payout-account protection

Owner approval of the design and decisions: 2026-10-10 ("approve with D1a, D2 as proposed, D3 approved"). D1a: no name-match requirement, the bank's resolved name is stored. D2: reuse the existing cooling-off cap and hours, new `pin_change_cooloff_hours` default 24. D3: the new caps apply to all users, including typed-in destinations today.

Corrections to H00 made while reading closer: **H-08 is Low** (the server takes the destination from each request's `payoutAccountId`, never from "default"; set-default only changes what the app preselects). **New High finding, fixed:** the new-account cooling-off cap applied only when the withdrawal named a saved account, so while `payout_account_required = 0` (live) typing the destination skipped it entirely.

What changed:
* **A. New-destination rule.** `limitsForDestination` (shared-payments `withdrawalLimits.js`) caps any destination the owner has not been paid at (new saved account inside its window, any typed-in destination, any destination the bank could not confirm) at the cooling-off amount until a withdrawal to it completes. History = a completed `withdrawal_requests` / `business_withdrawal_requests` row for the same bank code and account number. A failed history lookup counts as unknown (caps, never uncaps). Applies to both apps, saved or typed.
* **B. PIN-change cooling.** `withdrawal_pins.pin_set_at` (written by `set_withdrawal_pin`); for `pin_change_cooloff_hours` after it, every withdrawal is capped. Existing PINs have `null` and are not capped by applying the migration.
* **C. CareFind uses the shared PIN gate** (`checkWithdrawalPin`, same as CareHub) instead of its inline copy; the duplicated unreachable `untraceable_credits` block and the inline account check are gone (CareFind now uses the shared `verifyBankAccount`). `needsPin` / `code` are returned like CareHub.
* **D. Alerts.** Set-default sends an owner alert (`renderPayoutAccountEmail` event `default`). All owner alerts go through `sendSecurityAlert`, which logs `alert.failed` (event and an address-free reason) instead of swallowing the failure. The retrying outbox remains H05.
* **E. No KYC gate for saving an account (D1a).** `addPayoutAccount` no longer reads `kyc_verifications` and no longer matches names; `p_score` is null. Both apps' UI no longer disables "Add account" without verification and describes identity verification as optional.
* **F. Unverifiable bank (H-06).** The typed name is still accepted, but the destination is always treated as new and `withdrawal.unverified_destination` is logged (bank code only).
* **Fail closed.** If the limits cannot be decided CareFind answers 503 `limits_unavailable` and reserves nothing.
* Responses carry `limitReason` = `new_account` | `new_destination` | `pin_changed`.

Not changed: the KYC tier ceiling still lifts the trust ladder for a saved account of a person (H06 decides), the withdrawal-code ordering (H-10), the KYC endpoints, tables and UI form (optional now, removed in H06), the PIN/OTP rules from H01.

Files:
* New: `supabase/migrations/carefind_20261029_pin_and_payout_protection.sql` (+ identical copy in `apps/carefind/sql/`); `packages/shared-payments/src/alerts.js`, `src/__tests__/alerts.test.js`; `apps/carefind/src/test/payments/pinProtection.db.test.js`.
* Changed: `packages/shared-payments/src/{withdrawalLimits,payoutAccounts,payoutHandlers,pin,index}.js`; `packages/shared-email/src/securityEmails.js`; `apps/carefind/api/_handlers/initiate-withdrawal.js`; `apps/carehub/api/_handlers/initiate-business-withdrawal.js`; both apps' `PayoutAccountsPanel.jsx` and `AddPayoutAccountModal.jsx`; `docs/architecture/Payout-Accounts-and-KYC.md` (banner + section 7).
* Tests changed on purpose (behaviour changed by the approved decisions, none weakened): the KYC-required and name-mismatch cases in `kycAndPayoutAccounts.test.js` / `payoutHandlers.test.js` now assert the opposite (saves without identity, stores the bank's name, still gated by the code); `withdrawalLimits.test.js` (`readLimitConfig` shape, `limitsForSavedAccount` replaced by `limitsForDestination`); the three CareFind `initiate-withdrawal.*.test.js` files and `initiateWithdrawal.test.js` (real PIN hashes for the shared gate, `.in()` on the fake, `coin_value_kobo`); two panel tests (adding is no longer blocked); CareHub `initiateBusinessWithdrawal.payoutAccount/recovery` (typed destinations now carry the cap).

Migration: `carefind_20261029_pin_and_payout_protection` - **NOT applied to production.** Adds `withdrawal_pins.pin_set_at`, one `financial_config` row, re-creates `set_withdrawal_pin` with the same signature, and two partial indexes (created only if the request tables exist). Safe to apply before the code deploys (nothing reads the column until the new code does). After applying, re-read `pg_proc`: one `set_withdrawal_pin`, ACL `{postgres=X/postgres,service_role=X/postgres}`.

Tests (2026-10-10, final code):
| Suite | Result |
|---|---|
| shared-payments | 24 files, 514 passed |
| shared-email | 15 files, 336 passed |
| shared-notifications / shared-payout-ui | 12 passed / 3 files, 34 passed |
| CareFind api + payments + wallet-payments (PGlite, `*.pg.test.js` excluded) | 82 files, 1066 passed |
| CareHub api + wallet | 24 files, 255 passed |
| CareFind real-Postgres suites (embedded PostgreSQL 17.5, UTF8, `--no-file-parallelism`) | 9 files, 64 passed |
| Builds / lint | both apps build clean; `npm run lint` 0 errors (353 / 394 pre-existing warnings) |

New tests: 13 `limitsForDestination` cases, 4 `alerts`, net +2 in `kycAndPayoutAccounts`, net +1 in `payoutHandlers`, 1 shared-email (shared-payments 494 -> 514), 10 CareFind handler bypass cases, 6 CareHub handler cases, 7 migration cases (PGlite). The CareFind and CareHub totals above also include the wallet UI folders, which the H01 run did not cover. Mutation check: forcing the new-destination rule off failed 17 tests across shared-payments and the CareFind handler suite; file restored and re-verified.

Not run / not proven: the withdrawal engine's per-call cap under concurrency was NOT re-tested for this exact path because the mechanism is unchanged and is already covered by `withdrawalConcurrency.pg.test.js` (cap 50, twenty 10-coin requests -> exactly 5) and the business default-cap case, both green in the run above. No end-to-end browser check of the add-account UI (unit-level panel tests only; the layout was not changed). `npm audit`, `test:mutation` harness not run.

Unresolved / carried forward:
* **Commercial effect to communicate:** the first withdrawal to any destination, and every withdrawal for 24 h after a PIN change, is capped at N20,000 per rolling 24 h for ALL users. Existing users with typed-in destinations hit it on their first withdrawal after the deploy (the typed destination counts as known once one withdrawal to it completes). Set `payout_account_cooloff_hours` and/or `pin_change_cooloff_hours` to 0 to disable.
* A person who has never completed a withdrawal and wants to move more than N20,000 must do it in more than one day, or via a first N20,000 withdrawal then the rest.
* Apply the migration and deploy (owner). `OTP_HMAC_SECRET` (H01) must be set first.
* Set-default stays session-only by design; the alert is best effort until H05.
* Dojah/KYC code, tier limits and the optional UI form remain until H06.
* `reject_business_withdrawal(uuid)` still exists live (H04).

Next phase: **H03 - Payment and settlement security** (done below).

## H03 - Payment and settlement security

Owner approval: 2026-10-10 ("approve scope"; D-A and D-B not answered, applied as (1) keep rounding unchanged and no extra callback origins). Added by the owner in the same message and confirmed by answer: **a 10% processing fee on every top-up, added on top, on both CareFind CareCoin top-ups and CareHub business wallet top-ups, future top-ups only.**

Audit (read-only, plus SELECT queries on production): every initiator, redirect handler, the Paystack webhook, `settle_payment_intent` and its handlers. Verified sound: prices and fees decided on the server (the client names only what it buys); the intent recorded before Paystack with payer, purpose, expected integer kobo, currency and entity; settlement verified through Paystack's verify API, never from webhook metadata; provider, currency and exact-amount checks and transaction-id conflict refusal in the one SQL engine; redirect and webhook share one entry point; replays are no-ops; the webhook signature is HMAC-SHA512 compared in constant time and events are persisted before processing. Full per-flow table with the test that proves each claim: `docs/architecture/Payment-Security-Matrix.md`.

Findings and what was done:
* **G1 (Medium) `callback_url` was client-supplied** in five initiators (F-27). Fixed: `resolveCallbackUrl` (absolute, no credentials, https except localhost, origin must be the request's own or in `PAYMENT_CALLBACK_ORIGINS`), applied before any intent is created; 400 `invalid_callback_url`.
* **G4 (latent)** a wallet-funded intent reaching the provider path would have been closed as `failed` after Paystack answered "not found". Fixed: `settleByReference` returns `not_provider_payment` for `*_wallet` purposes without touching the provider or the intent.
* **Top-up processing fee (owner decision).** Server-side only, `financial_config.topup_processing_fee_rate` (0.10, read on every top-up, 0 disables, missing/invalid row falls back to 10% with a logged warning). Fee = `round(base x rate)` kobo. `expected_amount` is the total charged; `metadata` carries `base_amount_kobo`, `fee_kobo`, `fee_rate`. CareHub wallet credits the BASE (before this change it would have credited the total), CareFind credits whole coins; both handlers refuse an intent whose base + fee is not the charged total. `{ quote: true }` returns the rate so both wallet screens show "wallet receives / fee / you pay" before checkout. Receipts and the CareHub top-up email show the right figure.
* **G2 (decision, applied (1) keep)** card-paid subscriptions and consultations still pay the creator `floor(price x 80%)` whole coins and the platform the remainder; the platform keeps up to one coin (N200) more than 20% per such payment. Not changed. Paying card-funded earnings in exact kobo needs a kobo ledger for creators: a separate phase if wanted.
* **G3 (High, operational, no code) delayed and ambiguous outcomes are not being resolved in production.** Read on 2026-10-10: every pg_cron run in 24 h fails (`email-outbox-carefind` 1,440, `email-outbox-carehub` 1,440: `Vault secret ... is not set`); **7 payment intents are `pending` for more than an hour**, 11 reconciliation findings are open, and only 2 provider events exist. The sweeps that settle or close such payments are tested but cannot run until the code is deployed and the Vault secrets are set. Nothing was settled or changed by this audit.
* **G5 (accepted)** an anonymous holder of a booking reference can trigger its settlement: by design for guest bookings, idempotent, credits only the intent's own entities.

Files:
* New: `packages/shared-payments/src/{topupFee,callbackUrl}.js`; tests `packages/shared-payments/src/__tests__/{topupFeeAndCallback,walletPurposeGuard}.test.js`, `apps/carefind/src/test/payments/topupProcessingFee.db.test.js`; `supabase/migrations/carefind_20261030_topup_processing_fee.sql` (+ identical copy in `apps/carefind/sql/`); `docs/architecture/Payment-Security-Matrix.md`.
* Changed: `packages/shared-payments/src/{settlement,requestSettlement,effects,index}.js`; CareFind `api/_handlers/{initiate-payment,charge-subscription,charge-consultation}.js`; CareHub `api/_handlers/{initiate-wallet-topup,initiate-plan-payment}.js`, `src/modules/wallet/{Wallet.jsx,topupApi.js}`; CareFind `src/modules/wallet-payments/Wallet.jsx`; tests `topupFlow`, `subscriptionFlow`, `consultationFlow` (CareFind), `walletTopup`, `paymentFlows`, `Wallet.test.jsx` (CareHub). Existing tests were changed only where the new rules require it (callback origin must match the request; top-up totals include the fee); none was weakened.

Migration: `carefind_20261030_topup_processing_fee` - **NOT applied to production.** One config row and two re-created handler functions with unchanged signatures (`_settle_wallet_topup`, `_settle_business_wallet_topup`; no sibling, no grants). **Apply it BEFORE deploying the fee code** (until then old intents carry no metadata and are credited as before; new intents carry the fee and the OLD business handler would credit the total). After applying, re-read `pg_proc` ACLs: nobody but the owner may execute either function.

Tests (2026-10-10, final code):
| Suite | Result |
|---|---|
| shared-payments | 26 files, 552 passed |
| shared-email | 14 of 15 files passed in the full run; `deliveryContracts.test.js` failed 2 tests with 20-25 s runtimes while the machine was loaded (the same two failed once in the H00 baseline); re-run alone: 7/7 in 6.9 s. Treated as a load-sensitive flake (it scans the source tree); not fixed here |
| shared-notifications / shared-payout-ui | 12 / 34 passed |
| CareFind api + payments + wallet UI (PGlite, no `*.pg.test.js`) | 82 of 83 files passed (1,099 tests); `otpHardening.db.test.js` failed to start in the loaded run, re-run alone: 16/16. Same cause |
| CareHub api + wallet | 24 files, 278 passed |
| CareFind real-Postgres (embedded PostgreSQL 17.5, UTF8) | 9 files, 64 passed |
| Builds / lint | both apps build; `npm run lint` 0 errors (353 / 394 pre-existing warnings) |

New tests: 15 migration cases (base credited, replay, base-only payment refused, overpay refused, tampered metadata refused, legacy intent, zero fee, coins whole, ACL), 41 helper/guard cases, 14 CareFind and 14 CareHub handler cases (fee per package, client fee ignored, config rate, 0, unreadable rate, quote, callback bypass x7 per initiator), 3 wallet UI cases.

Not done / not proven: no mutation run for the fee path; no browser walkthrough of either wallet screen (unit-level UI tests only; the CareFind wallet screen has no component test); no real Paystack call (nothing was paid or sent); the Paystack dashboard settings (webhook URL, `refund.*` events for the shared endpoint) are not visible from here.

Unresolved / owner actions:
1. **Apply `carefind_20261030` before deploying; deploy; then set the three Vault secrets** so the sweeps run and the 7 stale intents and 11 findings are resolved by the existing engine. Order: `OTP_HMAC_SECRET` (H01) -> apply H01/H02/H03 migrations -> deploy -> Vault secrets.
2. Tell customers about the 10% fee before it goes live (it changes the price of every top-up; the CareFind packages page and the CareHub dialog now show it).
3. D-A (rounding) stays at "keep"; say if you want the kobo-ledger phase.
4. Revenue reporting: the fee is on the intent (`metadata.fee_kobo`); there is no separate revenue table for it yet, so finance reports must read it from there (or ask for a ledger row in H07).
5. Carried: KYC (H06), `reject_business_withdrawal` (H04), email outbox for alerts (H05), `lookup-appointment` / `resolve-account` exposures noted in Phase 14.

Next phase: **H04 - Withdrawal state machine** (done below).

## H04 - Withdrawal state machine

Owner approval: 2026-10-10 ("approve H04; D1 60 min; D2 give me the SQL").

Audit (read-only plus SELECT queries on production): `create_withdrawal` / `create_business_withdrawal`, `attach_*`, `settle_*`, the state guard trigger, `reconcile_withdrawals`, the apps' initiators, the webhook transfer events, the sweep, the admin reject path, and the live data. Already satisfying the brief: atomic reservation (wallet lock, balance and 24 h cap, debit, request row in one transaction); the unique reference derived from the request id before any provider call; provider linkage by exact request id and immutable once set; no "latest pending row" selection anywhere; a trigger-enforced state machine with immutable owner/amount/bank details and no deletes; refund at most once (row lock, unique ledger reference, early return); real-Postgres concurrency tests for simultaneous withdrawals, cap races and duplicate events (Phase 08).

Findings and what was done:
* **W1 (Medium), fixed: "reserved" did not say whether a transfer call was made.** `processing` was set only when the provider's answer came back, so a timed-out call and a never-sent call looked alike and were both released on a 10-minute "not found". Now `mark_withdrawal_transfer_attempt` / `mark_business_withdrawal_transfer_attempt` move `reserved -> processing` immediately BEFORE the provider call, and the API makes no call unless the mark was recorded (otherwise it releases the reservation). `reserved` = no call ever made (releasable at once); `processing` = a call was made or is in flight, released only on provider-confirmed non-payment: Paystack `failed/reversed/abandoned/blocked/rejected`, or "not found" with no transfer code **60 minutes after the mark** (D1, `AMBIGUOUS_GRACE_MS`), or at once after a definite Paystack refusal. A timeout alone never releases funds, in the handler, the sweep or the admin screen. Rows with no status are treated as attempted.
* **W2 (Medium), fixed: a payout reported after a refund left no durable trace** (a possible double payout, logged only). The settle functions now stamp `failure_reason` once with `conflict:paid_after_refund` / `conflict:failed_after_completed` / `conflict:amount_mismatch` and change nothing else; `reconcile_withdrawals` reports them as `provider_conflict` (critical by default, so the existing finance alert fires). `processing_without_transfer` is raised only when a marked transfer is overdue (stale window + 30 minutes).
* **W3 (Low), fixed in the migration: the stray pre-engine `reject_business_withdrawal(uuid)` is dropped.** It was re-created in production by an earlier OTP-era migration after the engine retired it; inert (it needs a `pending` status that cannot exist) but it hand-edits a wallet balance.
* **W4 (owner) three legacy withdrawals, 41 coins, still `reserved`** (ids and the Paystack checks to make are in `docs/architecture/Withdrawal-Engine.md`, "Runbook"). The SQL is written for the owner to run after checking the evidence; **not run by me**. The 26-coin request will refund itself through the sweep once the code is deployed and the sweep runs; the two with no reference need the SQL or the admin screen.
* **W5 (note)** there is deliberately no persisted `requested` state: request, reference and reservation are one atomic step.
* **W6 (known, out of scope)** business wallets have no balance ledger of their own beyond `business_wallet_transactions`.

Files:
* New: `supabase/migrations/carefind_20261031_withdrawal_attempt_and_conflicts.sql` (+ identical copy in `apps/carefind/sql/`); `apps/carefind/src/test/payments/{withdrawalAttempt.db,withdrawalAttemptConcurrency.pg}.test.js`.
* Changed: `packages/shared-payments/src/{withdrawals,index}.js`; CareFind `api/_handlers/{initiate-withdrawal,admin-auth}.js`; CareHub `api/_handlers/initiate-business-withdrawal.js`; `docs/architecture/Withdrawal-Engine.md` (state diagram, meaning of each state, runbook).
* Tests changed on purpose (the rule they encoded, "not found after 10 minutes", is now the two-state rule): `withdrawals.test.js`, CareFind `withdrawalRecovery.test.js` and `withdrawalAdmin.test.js`, and the four handler suites (default answer for the new RPC). Nothing was weakened; the old behaviour for a never-attempted request is still asserted.

Migration: `carefind_20261031_withdrawal_attempt_and_conflicts` - **NOT applied to production.** Two new service_role-only functions; `settle_withdrawal`, `settle_business_withdrawal` and `reconcile_withdrawals` re-created with unchanged signatures (ACLs kept, no siblings); one `drop function`. **Apply it BEFORE deploying the code** (the new handlers refuse to start a transfer they could not mark, so without the functions every withdrawal would be released as `attempt_not_recorded`). If the SQL tool stalls on the `drop`, run that one statement in the SQL editor. After applying, re-read `pg_proc`: one row per name, ACL `{postgres=X/postgres,service_role=X/postgres}`, `reject_business_withdrawal` absent.

Tests (2026-10-10, final code):
| Suite | Result |
|---|---|
| shared-payments | 26 files, 572 passed (+20: decision rules for both states, the 60-minute window, every provider status) |
| shared-email / shared-notifications / shared-payout-ui | 336 / 12 / 34 passed |
| CareFind api + payments + wallet UI (PGlite, no `*.pg.test.js`) | 84 files, 1,145 passed (new: 21 migration cases in `withdrawalAttempt.db`, 8 handler cases) |
| CareHub api + wallet | 24 files; 279 passed in the full run, 3 stale-rule failures in `withdrawalRecovery.test.js` updated to the two-state rule and re-run: 16/16 |
| CareFind real-Postgres (embedded PostgreSQL 17.5, UTF8, `--no-file-parallelism`) | 10 files, 72 passed (new: 8 in `withdrawalAttemptConcurrency.pg`) |
| Builds / lint | both apps build; `npm run lint` 0 errors (353 / 394 pre-existing warnings) |

Concurrency proven on real Postgres: 40 duplicate provider success events complete once and refund nothing; 20 marks racing 20 failures end in one `refunded` state with the coins returned once (4 rounds); 25 success events after a refund are stamped once and move nothing (personal and business); 20 wrong-amount successes are refused and stamped once; an attach racing duplicate successes completes once with the linkage recorded; 40 simultaneous marked withdrawals from a 25-coin wallet leave exactly 5 in flight and a zero balance; 30 marks racing 30 business failures refund the wallet once.
Mutation check: removing the conflict stamp and letting a retried mark move `updated_at` made 3 of the 21 migration tests fail; the file was restored and re-verified.
Not run: a real Paystack transfer (nothing was sent), `npm audit`, the `test:mutation` harness.

Unresolved / owner actions:
1. Apply order: `OTP_HMAC_SECRET` -> migrations H01, H02, H03, H04 -> deploy -> Vault secrets (the sweep only exists once deployed and scheduled).
2. Run the legacy-withdrawal runbook after checking Paystack.
3. Business-wallet ledger remains a possible later phase.

Next phase: **H05 - Shared payment email system** (done below).

## H05 - Shared payment email system

Owner approval: 2026-10-10 ("approve H05, D1-D4 as recommended"): D1 the "processing" notice is a one-time slow-transfer message; D2 enable the payment, withdrawal, refund and security events in the catalog; D3 include the delivery backfill; D4 `payment_failed` only for provider-declined payments.

Audit (read-only plus SELECT queries on production): shared-email (templates, `EmailService`, `sendEmail`, provider, security mails), shared-payments effects, every payment/withdrawal/refund/wallet sender in both apps, the catalog and the live outbox. Already satisfying the brief: outbox lease claim, attempt counting at claim, max attempts, backoff (Retry-After honoured), `dead` state, unique idempotency key, provider idempotency key = row id, `email_logs`, dispatch pause; the `html` tagged template escapes every interpolation; provider secrets are read server-side only; one-time codes are sent directly and never stored (H01); admin-only send endpoints with an allowlist.

Findings and what was done:
* **E1 (High, operational) no payment, withdrawal, refund or top-up e-mail has ever been sent in production** (19 outbox rows, all registration / password-reset / order mail; the outbox cron fails every minute, "Vault secret ... is not set"; the new code is undeployed). No code change can fix this; it is on the owner list.
* **E2 fixed: missing e-mails.** New templates for both brands: `withdrawal_processing` (once, only when Paystack still reports the transfer in flight after the grace period, via the sweep), `refund_requested`, `refund_failed`, and CareHub `payment_failed`; a distinct **PIN reset** security mail (`forgot PIN`), sent instead of the ordinary change notice. `payment_failed` is now actually sent, only for a provider-declined payment (verify status `failed`; not an abandoned checkout), by the redirect handlers and the sweep, once per reference.
* **E3 fixed: poor payloads.** The customer's real name (never their address), the naira actually paid out, the coins, the bank and the last four digits, for withdrawal requested / completed / failed in both apps; refund e-mails say `N...` for card refunds and `N CareCoins` for CareCoin refunds; the CareHub top-up e-mail shows the amount credited (not the fee-inclusive charge).
* **E4 fixed: a failed enqueue was lost for good.** New cron step `payment_notifications` (every 15 minutes, behind `claim_job_slot`): `list_unnotified_money_events` lists money events that settled in the last 48 hours and have no outbox row under their e-mail's key (withdrawals and business withdrawals completed / failed, refunds completed / failed, top-ups), and the same effects send them under the same keys. A lost enqueue becomes a late e-mail; a replay cannot duplicate it. Enqueue failures are also logged as structured `email.enqueue_failed` events (no address).
* **E5 fixed:** `withdrawal_pin_otp` removed from both template registries and the shared exports.
* **E6 fixed: account numbers.** `maskAccount` (last four digits, idempotent, total) is applied at the source (effects) and again inside every template; the business effect used to store the FULL account number in the outbox payload.
* **E7 fixed (migration, not applied):** the payment, withdrawal, refund, wallet and review events are registered and enabled for the brand that sends them (new rows modelled on the app's `withdrawal_requested` row); no other event is touched.
* **E8 fixed:** CareFind `api/email/send.js` has the credential-key guard CareHub's had.
* **New central guard:** `EmailService.enqueue` refuses any payload with a credential-like key at any depth (`otp`, `code`, `pin`, `password`, `secret`, `api_key`, `token`, `session` ...) before a row is written, so no sender can put a secret in the stored outbox.

Files:
* New: `supabase/migrations/carefind_20261101_payment_email_events.sql` (+ identical copy in `apps/carefind/sql/`); `apps/carefind/api/_lib/moneyNotifications.js`; tests `packages/shared-email/src/__tests__/{paymentEmails,outboxCredentialGuard}.test.js`, `packages/shared-payments/src/__tests__/paymentNotifications.test.js`, `apps/carefind/api/_lib/__tests__/{moneyNotifications,withdrawalEffects}.test.js`, `apps/carefind/src/test/payments/paymentEmailEvents.db.test.js`.
* Changed: shared-email `templates/{index.js,CareHub/index.js,Transactional/index.js,Transactional/CareFind/{index,CareFind}.js}`, `securityEmails.js`, `EmailService.js`, `events.js`, `index.js`, `utils/formatters.js`; shared-payments `withdrawals.js`, `refunds.js`, `refundEffects.js`, `businessWithdrawalEffects.js`, `effects.js`, `reconciliation.js`, `pin.js`, `index.js`; CareFind `api/_lib/{withdrawalEffects,withdrawalRecovery,intentSettlement,financeJobs}.js`, `api/_handlers/{initiate-withdrawal,cancel-appointment}.js`, `api/email/send.js`; CareHub `api/_lib/{withdrawalRecovery,intentSettlement}.js`, `api/_handlers/initiate-business-withdrawal.js`; `docs/architecture/Notifications-and-Purchase-Emails.md`.
* Tests changed on purpose: the refund `onSettled` seam now also reports `failed` and `requested` (`refunds.test.js`, `refundEffects.test.js`); the business effect masks the account and names the business (`businessWithdrawalEffects.test.js`); the finance-jobs step list includes `payment_notifications`. Nothing was weakened.

Migration: `carefind_20261101_payment_email_events` - **NOT applied to production.** Additive: catalog rows (insert-or-enable only) and one read-only `service_role` function. Safe to apply at any time and before or after the deploy; the cron step needs the function, and fails visibly (a failed step) if it is missing.

Tests (2026-10-11, final code):
| Suite | Result |
|---|---|
| shared-payments | 27 files, 595 passed |
| shared-email | 17 files, 447 passed; `deliveryContracts.test.js` failed 2 tests with 23-29 s runtimes while the machine was loaded (the same two as in H00 and H03); re-run alone: 7/7 in 2.8 s. Load-sensitive flake (it scans the source tree), not fixed here |
| shared-notifications / shared-payout-ui | 12 / 34 passed |
| CareFind api + payments + wallet UI (PGlite, no `*.pg.test.js`) | 87 files, 1,179 tests; 3 tests that encoded "only a completed refund notifies" were updated to the new three-moment rule and re-run: 25/25 |
| CareHub api + wallet | 24 files, 284 passed |
| CareFind real-Postgres (embedded PostgreSQL 17.5, UTF8) | 10 files, 72 passed |
| Builds / lint | both apps build; `npm run lint` 0 errors (354 / 394 warnings) |

New tests: 70 template/contract cases (every payment template, both brands, hostile input, masking, no secret field), 20 outbox-guard cases, 16 notification-decision cases (slow notice, declined payment, PIN reset), 8 backfill cases, 8 withdrawal-effect cases, 13 migration cases (catalog and list function on PGlite), 3 finance-job cases, 2 sweep-hook cases.
Mutation check: removing the template-level account masking and disabling the credential guard made 10 of 101 tests fail; both files restored and re-verified.
Not run: any send to a real recipient (nothing was sent), `npm audit`, the `test:mutation` harness.

Unresolved / owner actions:
1. **Deploy, then set the three Vault secrets**: until then no e-mail of any kind is drained by the cron, and the payment e-mails depend on the immediate flush after each enqueue.
2. Resend sender domains and `EMAIL_FROM` are configuration I cannot see; nothing was sent to a real recipient in this phase.
3. Marketing, business-lifecycle and auth e-mails were not reviewed (out of scope).

Next phase: **H06 - KYC exclusion** (done below).

## H06 - KYC exclusion

Owner approval: 2026-10-11 ("approve H06; D1 disable; D2 keep; D3 confirmed"): D1 identity verification is disabled by default, D2 the code, tables and stored rows are kept, D3 payments and withdrawals must never depend on it.

Findings (re-checked against the code, not the H00 map):
* **K1 (High, fixed): a hidden dependency.** The payout screen loaded `kyc/status` and `listPayoutAccounts` together and failed as a whole if either failed, so an unconfigured Dojah (or a KYC outage) could stop a person reaching their payout accounts. The account list is now loaded first and is the screen; `kyc/status` is asked only when the server says verification is on, and a failure there is tolerated.
* **K2 (Medium, fixed): KYC still moved money limits.** `limitsForDestination` lifted the trust-ladder cap by KYC tier for a saved account. It now reads a KYC row only when the switch is on; otherwise tier is 0 and the cap is the trust cap. **Commercial effect:** a person who had completed verification (none in production: `kyc_verifications` has 2 tier-0 rows) would lose a tier-based lift; nobody currently has one.
* **K3 (Medium, fixed): paid lookups reachable.** `/api/kyc/verify` and `/selfie` could reach Dojah from any signed-in account. They now answer 404 `kyc_disabled` before the provider is built.
* **K4 (Low, fixed): the identity hash key.** In production `KYC_HASH_SECRET` is required (no fallback to the one-time-code key or the service-role key); outside production the old fallbacks remain.
* Not an issue: no payment, withdrawal, refund, settlement, OTP, PIN or e-mail module referenced KYC (proved by the new isolation test, which now guards it).

Switch: `financial_config.kyc_enabled` (0 default; only exactly 1 turns it on; missing row, junk or 2 all mean OFF). Re-enable runbook is in `docs/architecture/Payout-Accounts-and-KYC.md`.

Files:
* New: `supabase/migrations/carefind_20261102_kyc_switch.sql` (+ identical copy in `apps/carefind/sql/`; one `insert ... on conflict do nothing`); `packages/shared-payments/src/__tests__/kycIsolation.test.js`.
* Changed: `shared-payments/src/{withdrawalLimits,payoutAccounts,payoutHandlers,index}.js`, `kyc/identity.js`; `shared-payout-ui/src/stores.js`; both apps' `PayoutAccountsPanel.jsx` (identity card hidden when off); `docs/architecture/Payout-Accounts-and-KYC.md`.
* Tests changed on purpose: the CareFind "Phase 4" tier-lift cases now run with `kyc_enabled = 1` (they describe the optional mode), and the H02 saved-account case expects cap 1000 with no lift when OFF (was 2500). New OFF-mode cases in `initiate-withdrawal.payoutAccount`, `payoutHandlers`, `withdrawalLimits`, `stores` and both panel tests. Nothing was weakened; ON-mode behaviour is still covered.

Migration: `carefind_20261102_kyc_switch` - **NOT applied to production.** Optional: the code treats a missing row as OFF, so deploy order does not matter. Apply it only so the switch is visible and editable in `financial_config`.

Tests (2026-10-11, final code):
| Suite | Result |
|---|---|
| shared-payments | 28 files, 616 passed |
| shared-email / shared-notifications / shared-payout-ui | 447 / 12 / 39 passed |
| CareFind api + payments + wallet UI (PGlite) | 87 files: 86 passed, 1178 tests passed, 7 skipped (the `*.pg.test.js` suites skip without `PG_CONCURRENCY_URL`, by design). `pinProtection.db.test.js` **failed to start in the full run** (file-level, machine under load); re-run alone: 7/7, 28 s. Load-sensitive, not caused by H06 (the file does not touch KYC); I did not capture the exact message, so this is an inference |
| CareHub api + wallet | 24 files, 285 passed |
| CareFind real-Postgres (embedded PostgreSQL 17.5, UTF8) | 10 files, 72 passed |
| Builds / lint | both apps build; `npm run lint` 0 errors (354 / 394 warnings) |

Not run: any call to Dojah (live or sandbox; nothing was sent), `npm audit`, the `test:mutation` harness. Mutation check: forcing `kycEnabled: true` in `readLimitConfig` failed 9 of 79 tests across `withdrawalLimits`, `payoutHandlers` and `kycAndPayoutAccounts`; the file was restored and re-verified.

Unresolved / owner actions:
1. Same order as before, plus: apply `carefind_20261102` (optional). Dojah variables are **not** needed for any payment flow.
2. If identity verification is ever re-enabled: set `KYC_HASH_SECRET` first, run the Dojah sandbox (NIN and selfie field names were never verified against the live API), then set `kyc_enabled = 1`.
3. CareHub Appointments' withdraw dialog still uses typed bank details (carried from Phase 14; matters only if `payout_account_required` is set to 1).
4. Flaky under load, to harden in H07: shared-email `deliveryContracts`, CareFind `pinProtection.db` / `otpHardening.db` (PGlite startup).

Next phase: **H07 - Tests and release gate** (done below).

## H07 - Tests and release gate

Owner approval: 2026-10-11 ("approve", defaults as recommended): D1 CI Postgres pinned to production's major (17), D2 mutation gate blocking on money-code changes, D3 production-dependency audit blocking for the packages, D4 local only (nothing pushed).

Findings (from the CI and harness audit):
* **R1 (High) three packages never ran in CI** (`shared-email`, `shared-notifications`, `shared-payout-ui`), and **R2** the CareHub workflow never ran `shared-payments`. Fixed: `.github/workflows/packages-ci.yml` runs all four on every change under `packages/`.
* **R3 (High) no mutant covered H01-H06.** Fixed: 16 new mutants H01-H16 (one-time-code IP and platform caps and key binding; cooling-off for a first-time destination, a recent PIN change and a business; the 10% fee; the callback allowlist; the wallet-purpose guard; the "attempted" rule and the sixty-minute wait; the retry keeping the original mark time; account masking; the outbox credential guard; the KYC switch and endpoint gate).
* **R4** the mutation gate was not in CI. Fixed: `finance-mutation.yml` (blocking; runs on changes to the money packages, `supabase/`, CareFind `api/` and the financial tests; about 15 minutes).
* **R5 fixed (flakes):** `deliveryContracts` read the whole tree repeatedly per test (now once; explicit file-level timeout, assertions identical); CareFind `hookTimeout` 120 s so a loaded machine no longer fails a PGlite file at start-up (per-test timeout unchanged).
* **R6 fixed:** the real-Postgres CI service was Postgres 16; production is 17.
* **R7 fixed:** `scripts/release-gate.mjs`, one command and one table; exit 0 only when every step ran and passed, 2 when something was skipped, 1 when something failed. It also checks that every money migration from `carefind_20261028` on exists in both `supabase/migrations` and `apps/carefind/sql` with identical content, and that migration names are unique.
* **Found while building the gate:** CareFind's plain `npm test` runs the `*.pg` suites in parallel when `PG_CONCURRENCY_URL` is set, and they collide on locks (55P03). The gate now hides the URL from every step except the sequential real-Postgres one. CI is not affected (its plain test step has no URL).
* **Found, NOT fixed (needs a decision): both apps' existing "Security audit" CI steps fail today** on production dependencies, so CI for both apps is already red at that step on a fresh run: CareFind `brace-expansion` (high), `react-router` / `react-router-dom` and `dompurify`; CareHub the same plus `source-map-js`, `vite` (high), `vitest`/`tinypool` (critical). CareHub lists `vite` and `vitest` under `dependencies`, so the dev toolchain counts as production there. All four packages also have vitest-2 advisories in dev dependencies only (hence the packages' audit is `--omit=dev`). I did not upgrade dependencies or loosen the audit.
* **Found, NOT fixed:** `shared-email` declares a `typecheck` script (`tsc --noEmit`) with no TypeScript dependency and no tsconfig, so it cannot run; I did not add it to CI.

Files:
* New: `.github/workflows/packages-ci.yml`, `.github/workflows/finance-mutation.yml`, `scripts/release-gate.mjs`, `packages/shared-email/package-lock.json`.
* Changed: `.github/workflows/carefind-ci.yml` (Postgres 17), `apps/carefind/src/test/payments/mutation/mutants.mjs` (+16), `apps/carefind/vitest.config.js` (`hookTimeout`), `packages/shared-email/src/__tests__/deliveryContracts.test.js`, `docs/architecture/Financial-Test-Plan.md`.

Migrations: none in H07.

Results (2026-10-11; the gate was run in two passes because the first exposed the gate bug above and two packages with empty local `node_modules`):
| Step | Result |
|---|---|
| migration copies identical, names unique | PASS |
| shared-payments / shared-email / shared-notifications / shared-payout-ui (`npm test`, lockfile-pinned vitest 2) | PASS (all four) |
| CareFind all tests (PGlite, `*.pg` hidden) | PASS (744 s) |
| CareHub all tests | PASS |
| CareFind real-Postgres concurrency suites (embedded PostgreSQL 17.5) | PASS (229 s) |
| mutation gate | PASS: 46 of 46 killed (30 original + 16 new), 780 s; every mutated file verified restored |
| lint (both apps) / builds (both apps) | PASS, 0 errors |
| audit, production dependencies, high: the four packages | PASS |
| audit, production dependencies, high: CareFind, CareHub | **FAIL** (pre-existing, see above) |

Overall gate verdict: **NOT READY on dependency audits only.** Every functional step passes. The combined run was not a single uninterrupted invocation; a final one-command run once the audit decision is made would give the single table.

Not run: Dojah or any provider call, `npm run bench:finance`, a push or PR (so none of the new workflows has run on GitHub yet; they are untested there).

Unresolved / owner actions:
1. Decide the dependency audit: upgrade (`react-router-dom` 7.18.4 is offered as a fix; CareHub's `vite`/`vitest` should move to `devDependencies`) or accept and scope the audit. Until then CI audit steps stay red.
2. Review and push the workflows; the first GitHub run may need tweaks (cache paths, the `finance-suite` job on Postgres 17).
3. Everything from H01-H06 still stands: set `OTP_HMAC_SECRET`, apply migrations H01-H06 in order, deploy, set the Vault secrets, run the legacy-withdrawal runbook, tell customers about the 10% fee.
4. Outside this track, unfixed: CareHub `businesses` INSERT escalation (memory note).

## Track summary (H00-H07)

All eight phases are written, tested and READY_FOR_REVIEW locally. Nothing has been applied to production, deployed, pushed, or sent through a provider.

### Production apply log (2026-10-11, owner-authorized: "apply the migrations first")

Project `szdybxmgmhndoytqanfb` (carehub, Postgres 17). Applied with `apply_migration`, in order, each verified against `pg_proc` / `proacl` / config rows afterwards:

| Migration | Result |
|---|---|
| `carefind_20261028_otp_hardening` | applied; one `issue_otp` (5 args), ACL postgres + service_role |
| `carefind_20261029_pin_and_payout_protection` | applied; `pin_set_at`, config row, both indexes |
| `carefind_20261030_topup_processing_fee` | applied; `topup_processing_fee_rate = 0.10`; settle helpers owner-only |
| `carefind_20261031_withdrawal_attempt_and_conflicts` | applied; mark/settle/reconcile functions correct; `reject_business_withdrawal` dropped |
| `carefind_20261102_kyc_switch` | applied; `kyc_enabled = 0` |
| `carefind_20261101_payment_email_events` | **failed once, atomically (nothing written)**: the production catalog CHECK `email_catalog_schema_is_valid` requires `additionalProperties = false`; the PGlite fixture did not carry it. Migration and fixture corrected (commit `5781525`), then applied; 21 events enabled |

Security advisors before and after: identical (0 new findings, 0 resolved). Not done by me: setting `OTP_HMAC_SECRET` (Vercel), the Vault secrets, and the legacy-withdrawal runbook. **The application code is still not deployed**; until it is, the old code runs against the new schema (designed to be compatible: `issue_otp` keeps a 4-argument call working through the new default parameter).
