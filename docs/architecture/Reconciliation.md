# Webhooks, recovery and reconciliation (Phase 11)

Status: implemented and tested. Migration `carefind_20261014_reconciliation` is **APPLIED to production (2026-10-05)**; the first live run found no critical finding. The Node side (replay, sweep, provider comparison, admin actions) ships with the next CareFind deploy.

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

## 8. Not done / open

* **No alert channel.** A critical finding is logged and listed, but nobody is paged or emailed; the channel (admin email, Slack, PagerDuty) is the owner's choice.
* **No admin screen.** The API exists; a Reconciliation tab in the admin dashboard is a follow-up.
* **Cadence.** The cron is daily (Vercel plan). A payment recoverable only by the sweep (both the redirect and the webhook failed) can therefore wait up to a day; the webhook's own retries and the redirect usually settle it within minutes.
* Settled intents are not cross-checked against the provider's list in the reverse direction (settlement itself requires a verified success, and a missing transaction id is a database check).
* Paystack settlement-batch and bank-statement reconciliation (what Paystack pays out to the platform's bank) is out of scope.

## 9. Tests

`reconciliation.db.test.js` (19, PGlite): sync semantics (insert, repeat, auto-resolve, reopen, dismissed stays, scope, validation, acknowledge/dismiss/reopen, ordering, permissions), config history, every database check against production-shaped anomalies, replay and sweep lists. `reconciliationConcurrency.pg.test.js` (3, real Postgres; mutation-checked: removing the advisory lock fails two): overlapping syncs and runs never double-report or error. `shared-payments`: reconciliation (22) and `listTransactions` (3). CareFind: admin actions (6) and the wiring (1).
