# Performance and resilience (Phase 12)

Status: implemented and tested. Migrations `carefind_20261016_reconciliation_scale` and `carefind_20261017_engine_timeouts_and_hot_paths` are written; see section 8 for what is applied. Nothing here changes a commercial rule, a gateway or what any payment means.

Production today is tiny (about 50 transactions, 26 shop orders, 8 ledger rows), so nothing is slow yet. The question this phase answers is **what breaks first when volume is 100 times larger, or when a dependency misbehaves**, and the answers come from measuring, not guessing.

## 1. How it was measured

`apps/carefind/src/test/payments/bench/scale.bench.mjs` builds a throw-away real Postgres with every migration, bulk-loads production-shaped data (100,000 settled payments: 104,000 intents, 200,000 webhook events, 160,000 coin-ledger rows, 40,000 shop orders and vendor credits, 30,000 appointments, 110,000 wallet ledger rows), runs `ANALYZE`, then times the scheduled work, the per-payment work, a 20-client settlement burst, and the plans of the heaviest checks. Run it by hand when a query, an index or a check changes. (It runs on a Windows dev machine against an embedded Postgres, so absolute numbers are pessimistic and the commit fsync is slow; compare runs with each other, not with a production server.)

## 2. What the measurements found, and what was done

| # | Finding (at 100,000 payments unless stated) | Fix |
|---|---|---|
| 1 | `sync_reconciliation_findings` looped per finding with a lock and a scan of the whole report: **quadratic**. A systemic fault that produced 80,000 findings made one `run_db_reconciliation()` take more than 4 minutes: it never finished inside its 10-minute cadence and held locks the whole time | set-based (one upsert, one anti-join); each source reports at most 500 findings (critical first) plus one summary finding "N findings, only the 500 worst are listed"; counting and ordering happen on rows, not on an 80,000-element json document |
| 2 | `reconcile_shop_vendor_credits()` called `_fin_cfg()` (a table lookup) for **every paid order**, twice: 7.0 s at 40,000 orders (4.3 s at 12,000) | cutoff computed once: 0.9 s -> 0.15 s at 3,000 orders, and no longer proportional to the order count |
| 3 | The unmatched-charge check scanned all 200,000 webhook events (0.5 s) and "settled without a transaction id" scanned all intents | tiny partial indexes: 0.1 s and 0.01 s, no sequential scan |
| 4 | The checks that grow with the whole history (wallet vs ledger sum 0.5 s, the ledger chain 1.1 s, settled intents vs their orders and appointments 1.1 s each at 100,000 rows; linear, so about 100x that at 100 million rows) ran every 10 minutes | split into "light" (every 10 minutes) and "heavy" (hourly): `run_db_reconciliation(p_heavy)` |
| 5 | A burst of 20 simultaneous payments for **one vendor** ran at 27/s with a median of 205 ms (a different vendor each: 187-274/s, p95 about 120-220 ms). The vendor's wallet row was locked in the **middle** of the transaction | the wallet row is now touched **last** (median 205 ms -> 20 ms) and updated with a plain `UPDATE` first (an `INSERT .. ON CONFLICT` only for a vendor's very first order). The booking credit (`fn_credit_business_booking`) got the same shape, and one more fix (see 6). **What did not change:** a p95 of about 5 s remains in this 20-way, single-row burst on the Windows dev database (wait events show only row-lock queueing on that one wallet row); I could not attribute it further without a Linux database, so it is reported, not claimed fixed. A single vendor's throughput is bounded by one row's lock hand-off |
| 6 | `fn_credit_business_booking` credited the wallet **before** its ledger insert and ignored a duplicate ledger row: calling it twice for one reference would credit twice (the engine's one-settlement-per-intent rule is the only thing that prevented it) | ledger first, wallet only when the ledger row is new: the primitive is replay-safe on its own |
| 7 | Nothing bounded how long an engine function could wait for a lock or run: a hung connection holding a wallet row would block that vendor's settlements, and every caller, indefinitely | `lock_timeout = 10 s` and `statement_timeout = 30 s` (120 s for reconciliation) on every engine entry point (`_apply_engine_timeouts()`); a timeout is an infrastructure error the Node side retries, the engine's transaction having rolled back |

Checked and fine: a single settlement takes 13-80 ms (CPU, no commit wait); `release_shop_vendor_credits` 8 ms, `list_open_intents_to_check` 48 ms, `list_replayable_provider_events` 10 ms, `claim_findings_to_alert` 15 ms, the admin findings list 7 ms, a refund request 29 ms, even at 100,000 payments.

## 3. Resilience (Node side, shared by both apps)

| Failure | Before | Now |
|---|---|---|
| A deadlock, lock timeout, statement timeout, connection exhaustion or a dropped HTTP hop to the database inside `settle_payment_intent`, `request_refund`, `settle_refund` or the withdrawal settle functions | the payment failed (the webhook answered 500 and waited for Paystack's retry; a redirect showed an error) | `rpcWithRetry`: three attempts with jittered backoff on **infrastructure** errors only (40001, 40P01, 55P03, 57014, 53300, 57P01, 08xxx, fetch failed, 502/503/504). A business error (a raised refusal, a constraint violation, a permission error) is never retried. Safe because every one of these functions is idempotent and a failed attempt rolled back |
| Paystack is down or rate-limiting | every sweep asked it once per row, up to 50 times, burning the whole invocation | a `LoopGuard` stops a sweep after **three consecutive provider infrastructure failures** (timeout, network, 5xx, rate limit, auth, config) and reports `stopped: provider_unavailable`; an answer about one transaction (not found, rejected) never opens it |
| The cron endpoint is hit **every minute** (Supabase Cron, not daily as `vercel.json` suggests) and the function has a hard time limit | the email drain, then withdrawals, refunds, vendor release and reconciliation ran in sequence with no shared deadline, so the steps after a slow one starved, and the withdrawal and refund sweeps asked Paystack about every stuck row every minute | `runScheduled`: one **deadline** for the whole invocation (`CRON_BUDGET_MS`, default 50 s; `vercel.json` gives the function 60 s); each step has its own **interval** behind the atomic `claim_job_slot` gate (vendor release, withdrawals and refunds every 5 minutes; reconciliation's own sub-steps 5 / 30 / 10 / 60 minutes); a step that no longer fits is skipped (`out_of_time`) and runs next minute; the loops inside a step stop at the deadline; a step that fails never blocks the others or the email delivery |
| Open payment attempts | each re-asked at Paystack every pass for 7 days | per-intent backoff: every 10 minutes in the first hour, hourly in the first day, then every 12 hours |

Every step is idempotent, so being stopped half way, or running in two places (the CareFind and CareHub endpoints share the same gates), is safe.

## 4. Capacity notes (what to expect, what to watch)

* Per-payment cost is a few milliseconds of database work; the limits are provider calls (8 s timeout, 3 attempts for reads) and one row per vendor wallet for bursts.
* The light reconciliation grows with the number of **open findings and recent events**, not with history; the heavy one (hourly) grows with history. If the heavy run ever approaches its 120 s statement timeout, make it incremental (checksum the ledger by month and re-verify only the current month).
* `payment_provider_events` stores every webhook payload and is append-only (a trigger refuses delete and update of the payload). At today's volume that is trivial. A retention rule (archive payloads older than N months to cold storage, keep the row and its outcome) is an owner decision and is **not** implemented.
* The reconciliation tables are bounded: findings are one row per (source, kind, subject) and capped at 500 per source per run; `reconciliation_runs` gains one row per run (about 150 a day) and should be trimmed by a retention job later.

## 5. The trap this phase leaves in the codebase

`CREATE OR REPLACE FUNCTION` **replaces** the function's `SET` clauses. A later migration that redefines `settle_payment_intent` (or any other engine entry point) silently drops its timeouts. Every such migration must end with `select public._apply_engine_timeouts();`; `engineTimeouts.db.test.js` loads every migration in order and fails if any entry point lacks `lock_timeout` and `statement_timeout`.

## 6. Tests

`engineTimeouts.db.test.js` (6): every entry point has both timeouts and keeps its `search_path`, the helper is idempotent and private, the settings do not leak out of the function. `reconciliation.db.test.js` (+8 at scale): a 3,000-finding report, duplicates, severity changes, an atomic rejection, the cap (critical first, one summary finding), light vs heavy runs, a light run leaving the heavy findings alone, the new indexes. `shared-payments` `rpcRetry` (28) and `scheduler` (27); reconciliation (+4). CareFind `financeJobs` (7). The vendor payout suite (34) and every concurrency suite now run on the final code.

## 7. Not done

* Native cron split: the finance steps still ride the email cron endpoint (one function, 60 s, shared deadline). A dedicated endpoint and Supabase Cron job would isolate them completely; it needs a new Vault secret and a function slot.
* A load test against a production-like Linux database (the single-vendor tail in finding 5).
* Event retention / archiving (owner decision), incremental heavy reconciliation (not needed until the ledger is about 100x larger).
* A circuit breaker for the redirect and webhook paths (they call Paystack once per request and already fail with a clear 502; the breaker is only in the sweeps).

## 8. Rollout

* `carefind_20261016_reconciliation_scale` and `carefind_20261017_engine_timeouts_and_hot_paths` are independent of the app deploy and safe to apply first (the old Node code calls the same function names; `run_db_reconciliation` keeps working with no arguments).
* The Node changes (retry, scheduler, deadlines, `financeJobs`, `vercel.json` `maxDuration`) ship with the next CareFind deploy.
