# Production readiness (Phase 15)

Status: audit and runbook written 2026-10-06. This phase changed no code and no database object; it checked what production actually looks like and what a go-live needs. Findings are in section 1; the deploy runbook, rollback, monitoring and owner decisions follow.

Update 2026-10-09: the wallet/PIN-OTP design workstream (`docs/superpowers/specs/2026-10-08-wallet-and-payout-accounts-design.md`) is implemented and fully tested — shared-email 328, shared-payments 372, carefind 2,383, carehub 1,298 tests green (two carefind timeouts under load pass in isolation) — but **not deployed**; every row below still describes production. It adds one availability dependency on section 2: once deployed, every withdrawal requires an emailed OTP, delivered by `RESEND_API_KEY`/`RESEND_FROM_EMAIL` through an inline outbox flush at request time, with the (currently broken) cron from 1.1 as backstop — if both fail, withdrawals fail closed until mail flows.

## 1. What production looks like today (read from the live database)

| Check | Result |
|---|---|
| Database | Supabase project `szdybxmgmhndoytqanfb` ("carehub"), Postgres 17, eu-west-1, ACTIVE_HEALTHY |
| Migrations through `20261019` | applied (the finance chain is complete) |
| Reconciliation | no critical findings; open: 9 info and 3 warning (the known legacy items) |
| **Scheduled jobs** | **BROKEN: all 2,880 pg_cron runs in 24 h failed.** Both `email-outbox-carehub` and `email-outbox-carefind` raise `Vault secret email_outbox_cron_<app>_url is not set`. See 1.1 |
| App code (Phase 04-14) | NOT deployed (owner decision, "not yet") |
| Test suite on the final code | `npm run test:finance`: 67 files, 898 tests, all pass (handlers, PGlite migrations/engines, invariants, red team). The real-Postgres concurrency suites (`test:finance:pg`) were not re-run this session; CI runs them against a Postgres service |
| Last reconciliation run | 2026-10-05 21:02 UTC: a manual run; nothing schedules it |
| Payment intents / provider events | 1 / 1 (a stale pending test intent); no failed events |
| Security advisors | see 1.2 |
| Backups / point-in-time recovery | NOT verifiable from here: owner must confirm in the Supabase dashboard (1.3) |

### 1.1 The email outbox and every scheduled finance step are not running

The function `dispatch_email_outbox_cron` is correct: it refuses to run, loudly, when its configuration is missing, so the failure is visible (that is why it shows as 2,880 failed runs instead of silently doing nothing). The configuration it needs, in Supabase Vault, was never set:

* `email_outbox_cron_carehub_url` and `email_outbox_cron_carefind_url`: the full URL of each app's `/api/cron/process-email-outbox`
* `email_outbox_cron_secret`: must equal the apps' `CRON_SECRET`

Consequence today: no queued email is sent by either app (transactional mail, plan/payment notices, and the Phase 11 `finance_alert` mail for critical findings), and the finance steps that ride on the same cron (webhook replay, open-payment sweep, vendor credit release, reconciliation, alerting) never run. Because the Phase 04-14 code is not deployed, the deployed endpoint is the old one: pointing the cron at it now would start draining email but would not run the finance steps. **So the order matters (section 2).** Setting the secrets is an owner action (it needs the production URLs and the secret value); I did not touch Vault. Once the 2026-10-09 wallet workstream deploys, this cron is also the backstop for withdrawal OTP delivery (see the status note): the primary path is the inline flush on each request, so `RESEND_API_KEY`/`RESEND_FROM_EMAIL` become withdrawal availability dependencies, not just notification ones.

### 1.2 Security advisor summary (after migration 19)

* ERROR `rls_disabled_in_public` on `spatial_ref_sys`: PostGIS's own reference table; not ours to alter, no tenant data.
* WARN `anon_security_definer_function_executable` (23) and `authenticated_security_definer_function_executable` (63): expected for an RPC-based app; each money-adjacent function in the list was read this phase and has its own caller check (`mark_payout_paid`, `set_commission_status`, `calculate_agent_earnings`: admin/service only; `apply_promo_code_to_order`, `cancel_shop_order`, `confirm_pos_payment`, `confirm_transfer_payment`, `shop_add_message`, `process_shop_return`: customer/vendor/admin checks). Pure calculators and public lookups account for most of the anon list.
* WARN `function_search_path_mutable` on `create_shop_order`: the 19-argument SQL wrapper that only calls the 20-argument function (which has a fixed `search_path`); harmless.
* WARN `extension_in_public` (pg_trgm, postgis): moving them is risky and not worth it now.
* WARN `auth_leaked_password_protection` disabled: **owner action**, one switch in Auth settings (compromised-password check). Recommended before launch.
* INFO `rls_enabled_no_policy` (24 tables): deny-all to clients, server-only tables by design.

### 1.3 Backups

The Supabase plan's backup and point-in-time-recovery status could not be read through the tools available. Before go-live the owner must confirm in the dashboard (Database, Backups) that daily backups exist and, for a money system, that PITR is enabled, and note the retention. A financial ledger without PITR cannot be rewound to the minute before a bad change.

## 2. Deploy runbook (in this order)

1. **Freeze**: no other deploys during the window. Take a manual backup (or note the PITR timestamp) and record the current Vercel deployment id for rollback.
2. **Environment** (Vercel, CareFind and CareHub projects): confirm present: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `PAYSTACK_SECRET_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (or `EMAIL_FROM`), `RESEND_WEBHOOK_SECRET`, `CAREFIND_APP_URL`/`APP_URL`, `CAREFIND_ADMIN_EMAIL`/`ADMIN_EMAIL` (finance alert recipients). Optional tuning: `EMAIL_OUTBOX_BATCH_SIZE`, `EMAIL_OUTBOX_TIME_BUDGET_MS`, `EMAIL_OUTBOX_MAX_BATCHES`, `CRON_BUDGET_MS`. No secret may be a `VITE_*` variable.
3. **Deploy CareFind** (the money endpoints, the webhook and the cron). Deploy before touching the cron, so the endpoint the cron will call is the new one.
4. **Deploy CareHub** (appointment completion, staff creation, vendor screens). Smoke-test the callers of the changed functions: complete an appointment, create a staff login, advance an order as a vendor, open Expenses and Purchases.
5. **Set the Vault secrets** (1.1) with the production URLs and `email_outbox_cron_secret` equal to `CRON_SECRET`. Within one minute `cron.job_run_details` must show `succeeded`.
6. **Verify the schedule** with the queries in section 4: outbox draining, a reconciliation run recorded, no critical findings.
7. **Paystack**: confirm the webhook URL points at the new CareFind endpoint and a test event is answered 200; keep test and live keys separate.
8. **Smoke payment** with a small real amount per path (shop order, booking, subscription): settled, split correct, vendor credit held, refund of the test payment completes.

## 3. Rollback

* **Application**: redeploy the recorded previous Vercel deployment. The migrations are backward compatible with the old code (verified at each phase), except where noted below.
* **Cron**: unset or rename the three Vault secrets; the jobs go back to failing loudly and the apps stop receiving cron calls. (`select cron.unschedule(...)` also works.)
* **Database**: migrations are forward-only; there is no down-migration. A bad migration is fixed by a new corrective migration (as `20261018` was). Real data loss would be recovered from PITR (1.3).
* **Behaviour changes that old clients may notice** (compatible with the new database, but worth knowing): `provision_staff_auth` links an existing account instead of resetting its password (F-37); `update_shop_order_status` and `add_tracking_event` refuse backwards or payment-state moves by a vendor (F-39); `complete_appointment_and_release` no longer moves money itself (F-40).

## 4. Monitoring (what to watch, with the query)

| Signal | Query | Healthy |
|---|---|---|
| The cron is working | `select status, count(*) from cron.job_run_details where start_time > now()-interval '1 hour' group by 1` | only `succeeded` |
| Reconciliation ran | `select max(started_at) from public.reconciliation_runs` | within the last hour once deployed |
| Open findings | `select severity, count(*) from public.reconciliation_findings where status='open' group by 1` | no `critical`; alert mail is sent on a new critical |
| Stuck payments | `select count(*) from public.payment_intents where status='pending' and created_at < now()-interval '1 hour'` | 0 (the sweep resolves them) |
| Failed provider events | `select count(*) from public.payment_provider_events where outcome='failed'` | 0 or falling |
| Money Checks screen | CareFind admin, "Money Checks" (`G K`) | no critical |

An unattended money system needs somebody to notice a red signal. Today the only push channel is the finance alert email (which is itself blocked by 1.1). Recommended: a second channel (a webhook to chat) and an external uptime check on `/api/cron/process-email-outbox`'s last success. Both are owner decisions.

## 5. Gaps and recommendations (not implemented here)

1. **No kill switch.** `financial_config` holds rates and cutover epochs, no `enabled` flags. If a defect is found after launch, the only ways to stop money moving are a deploy or revoking function privileges by hand. Proposal (to be reviewed before building): a `finance_flags` row set (`withdrawals_enabled`, `refunds_enabled`, `vendor_release_enabled`, `settlement_enabled`) read by the engines' entry points and the sweeps, togglable from the admin Money Checks screen with an audit row in `financial_config_history`. About one migration, one admin control, tests per engine.
2. **Webhook, CORS and endpoint rate limits** were not audited in Phase 14 (listed there as not done). They should be reviewed before real money flows through the new endpoints; `lookup-appointment` and `resolve-account` should require a signed-in user.
3. **Event retention**: `payment_provider_events` and `reconciliation_runs` grow without bound; decide a retention period and an archive job.
4. **Owner data items**: 3 legacy CareFind withdrawals still need a decision; 9 shop orders (CF-000012 to CF-000026, vendor share N1,170) were paid before vendor credits existed and are listed as `legacy_paid_order_without_credit`; one stale pending test intent.
5. **Auth hardening**: enable leaked-password protection (1.2) and review who holds platform-admin rows in `businesses`.

## 6. Go / no-go

**Not ready to go live today**, for two reasons that are not code defects: the Phase 04-14 application code is not deployed, and the scheduler's configuration is missing (1.1). The database side is ready: migrations applied and verified, reconciliation clean, the red-team fixes live. Ready means: sections 2.1-2.8 completed, the three owner confirmations in 1.3 / 1.2 / 5.4 given, and the smoke payments settled and refunded correctly.
