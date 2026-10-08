# Webhooks, recovery and reconciliation (Phase 11)

Status: implemented and tested. Migrations `carefind_20261014_reconciliation` and `carefind_20261015_reconciliation_ops` are **APPLIED to production (2026-10-05)**; the first live run found no critical finding. The Node side (replay, sweep, provider comparison, alerts, admin screen) ships with the next CareFind deploy.

## 1. The problem this phase closes

The engines settle money correctly **when they are told**. Three things could still leave money wrong with nobody knowing: a webhook that failed and that Paystack gave up retrying; a payment the customer made but neither the redirect nor the webhook settled; a charge Paystack received that no intent recognises. And the per-engine reconcile functions existed but nothing ran them, nothing kept their answers, and nobody was told.

## 2. Webhook path (same contract, now recoverable)

Signature (HMAC-SHA512, constant-time) -> store the event (`payment_provider_events`, unique `(provider, event_id)`) -> process -> stamp the outcome -> acknowledge. A bad signature is rejected and is now logged (`webhook.invalid_signature`). What an event *means* moved out of the HTTP handler into `api/_lib/webhookProcessor.js`, so the **replay uses exactly the same code**: `charge.success` -> `settle_payment_intent`; `transfer.*` -> withdrawal engine; `refund.*` -> refund engine; nothing is decided from `metadata`.

## 3. The recovery steps (`shared-payments/src/reconciliation.js`, run daily by the cron, or on demand by an admin)

| Step | What it does | Safe because |
|---|---|---|
| `replayProviderEvents` | processes stored events that failed or never finished (older than 10 min, fewer than 20 attempts) again from their saved payload | every branch is idempotent; a failure is recorded with its attempt count and never stamped processed |
| `sweepOpenIntents` | intents still `created`/`pending`/`verified` after 15 min: asks Paystack by reference and settles through the ONE engine; runs the app's effects exactly for what it settled; an attempt never paid and past its expiry is closed | settlement is `settle_payment_intent`; a timeout is an error to retry, never a reason to close |
| `reconcileProviderTransactions` | Paystack's own list of successful charges (last 48 h) against our intents: `charge_without_intent`, `amount_mismatch`, `transaction_id_mismatch`, `paid_not_settled` (settlement is attempted first; only what still is not settled stays a finding) | read-only against Paystack; a provider failure writes nothing, so no finding is resolved on a guess |
| `runDbReconciliation` | every database check (below), last, so it sees what the steps above repaired | one writer per source, advisory-locked |

Each step is isolated (one failing never stops the others) and the report names the failed steps. If any critical or warning finding is open the run logs ONE structured line, `reconciliation.open_findings`, with the counts.

## 4. The database checks

coins (wallet vs ledger, ledger chain); commissions, withdrawals, refunds and shop vendor credits (the existing `reconcile_*` functions, now actually run); payment intents (settled without a provider transaction id; settled shop order or appointment whose entity is not paid); provider events (failed, stored and never processed, and **every successful charge no intent recognised** = real money nothing settled).

## 5. Findings

`reconciliation_findings`: one row per `(source, kind, subject)`. Seen again -> `occurrences` grows. Condition gone -> auto `resolved`. Comes back -> reopened. A person can `acknowledge`, or `dismiss` with a note (at least 5 characters); a **dismissed** finding is never reopened, so a known, explained row (for example a charge from another integration on the same Paystack account) does not nag forever. A partial scan (`p_scope`) can resolve only what it actually looked at. Tables are server-only; access is through `list_/update_reconciliation_finding`, `service_role` only. Admin API actions: `admin_list_reconciliation`, `admin_update_reconciliation_finding` (records the acting admin), `admin_run_reconciliation`.

## 6. financial_config history

Every change to a commercial constant is recorded (`financial_config_history`: key, old, new, who (the signed-in user when it came through the API), when); append-only, with a baseline row per constant (18). Closes the Phase 02 follow-up.

## 7. First live run (2026-10-05)

0 critical. 3 warnings: the three legacy CareFind withdrawals still `reserved` since July/September (known; decision pending). 9 info: the nine shop orders paid before vendor credits. Coins, commissions, refunds, intents and webhook events: clean. No unmatched charge yet (the old webhook is still live).

## 8. Alerts, the admin screen and the cadence (owner decisions 2026-10-05; migration `carefind_20261015_reconciliation_ops`, APPLIED)

* **Email alerts.** A CRITICAL finding is emailed to every active platform admin (plus `FINANCE_ALERT_EMAILS`, comma separated, for people who are not admins) through the email catalog event `finance_alert` (so the catalog's sender, subject and rollout switch govern it; `enabled` and `live`). Each finding is handed to exactly one caller (`claim_findings_to_alert`, row-locked, skip-locked); if the email cannot be queued the claim is released and the next pass retries. While a finding stays open and unacknowledged it is repeated once a day; acknowledging silences the reminders. Warnings and info are never emailed (they are in the screen).
* **Admin screen.** Admin panel > Commerce > "Money Checks" (`/admin-panel`, command palette `G K`): filter by open / acknowledged / resolved / dismissed, acknowledge, dismiss with a note, reopen, and "Run checks now". Loading, error (with retry), empty and success states; labelled controls; wraps on narrow widths. It only records decisions; it cannot move money.
* **Cadence.** The CareFind cron endpoint is driven **every minute** by Supabase Cron (`email-outbox-carefind`), not daily as `vercel.json` suggests, so the pass must not hit Paystack every minute. `claim_job_slot(job, minutes)` is an atomic "is it due?" gate shared by every instance: replay and sweep every 5 minutes, the Paystack comparison every 30, the database checks every 10, alerts every 5. "Run now" bypasses the gates. If the gate itself fails the step runs (never reconciling is worse than reconciling twice).
* **Sweep backoff.** An open payment attempt is re-checked with Paystack every 10 minutes in its first hour, hourly in its first day, then every 12 hours (`payment_intent_checks`), instead of every pass for a week.

## 8b. Still open

* The alert goes to email only; a second channel (Slack, SMS, a pager) is not wired.
* A payment recoverable only by the sweep now waits at most about 15 minutes (5-minute gate + 15-minute grace), not a day.
* Settled intents are not cross-checked against the provider's list in the reverse direction (settlement itself requires a verified success, and a missing transaction id is a database check).
* Paystack settlement-batch and bank-statement reconciliation (what Paystack pays out to the platform's bank) is out of scope.
* The screen's layout uses wrapping flex rows and was not verified in a real browser at mobile / tablet / desktop widths.

## 9. Tests

`reconciliation.db.test.js` (19, PGlite): sync semantics (insert, repeat, auto-resolve, reopen, dismissed stays, scope, validation, acknowledge/dismiss/reopen, ordering, permissions), config history, every database check against production-shaped anomalies, replay and sweep lists. `reconciliationConcurrency.pg.test.js` (3, real Postgres; mutation-checked: removing the advisory lock fails two): overlapping syncs and runs never double-report or error. `shared-payments`: reconciliation (22) and `listTransactions` (3). CareFind: admin actions (6) and the wiring (1).
