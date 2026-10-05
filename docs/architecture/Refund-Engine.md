# Refund Engine (Phase 09)

Status: implemented and tested; migrations `carefind_20261008_commission_reconcile_first_payment` and `carefind_20261009_refund_engine` are **APPLIED to production (2026-10-05)** and verified. The application code is not yet deployed (section 7).

## 1. Three kinds, one table, one door

| Kind | Money | Completes when |
|---|---|---|
| `card` | back to the payer through Paystack | **Paystack confirms** (`refund.processed`, or its own "processed" answer) - never on our say-so |
| `carecoin` | back to the payer's CareCoin wallet through the ledger | in the same transaction as the request |
| `platform_funded` | a card refund the platform pays from its own pocket (goodwill, dispute): the business keeps its money, the commission is not reversed | like `card` |

States: `requested -> processing -> completed`; `requested|processing -> failed` (the entity stays paid). A trigger enforces the machine and the immutability of identity, amounts and recoveries; no role can read or write `refunds` (RLS on, no grants); only `request_refund`, `mark_refund_processing` and `settle_refund` write it.

```
cancel / admin / cron ──▶ request_refund(cause, entity)        ONE atomic step, no provider call
                            lock entity + payment, policy checks, take the business share back,
                            create the refund (one live refund per payment)
                          ──commit──▶ provider.refundPayment(payment reference, exact kobo)   (no lock held)
provider answer / webhook / sweep ──▶ settle_refund(outcome)       replay-safe, the ONLY door
```

## 2. What a booking refund does (owner policy, confirmed 2026-10-05)

Full refund when the business cancels at any time, or the patient cancels >= 24h ahead (what `cancel-appointment` already enforces); the platform absorbs Paystack's own fee.
* **At request:** the business's share is taken back from its wallet, **held first, then available, never below zero**, with a ledger row (`refund_debit`). A shortfall (the business already withdrew it) is recorded on the refund and reported by `reconcile_refunds()` as `business_shortfall` - it is never a negative balance.
* **If the provider fails the refund:** the recovered amount goes back to the business **exactly, into the same buckets** (`refund_restore`), the customer stays paid, and a new refund can be requested.
* **At completion:** the payment intent becomes `refunded`, the appointment becomes `refunded`, the platform's commission row is reversed (`commission_reversal`).
* **Offline payments** (POS, bank transfer, cash) never passed through the platform: reported as `not_refundable_by_platform`; the business refunds the client directly.
* **CareCoin bookings** are refunded in coins, exactly the coins the ledger shows were debited (not recomputed from the business credit).

Payments that **could not be applied** (`payment_intents.status = needs_refund`: wrong amount, already booked, already paid another way) are refunded in full for what was actually paid (`metadata.paid_amount_kobo`); nothing was credited so nothing is recovered. The cron finds them (`refundUnappliedPayments`).

## 3. Safety properties

| Property | Mechanism |
|---|---|
| no double refund | one live refund per entity (partial unique index) + entity row lock + the provider refuses a second full refund of a payment; cancel + admin + retries racing create exactly one refund and debit the business once |
| "completed" means the provider said so | the database completes a card refund only through `settle_refund(processed)`; a provider answer of `processing` only links it |
| never failed on a guess | a timeout, network error, auth/config problem or rate limit leaves the refund `requested`/`processing`; only a definite business-level refusal fails it, and "already refunded / duplicate" is read as "exists", not "failed" |
| look before sending again | the sweep asks Paystack (`verifyRefund`, new) before it ever re-sends a `requested` refund: a timed-out call may have created it |
| amount integrity | `processed` for a different amount than refunded is `amount_mismatch`, not completed |
| contradictions are reported, not "fixed" | `conflict_processed_after_failed` (money went back AND the business was restored) and `conflict_failed_after_completed` are logged as `refund.needs_attention` |
| a crash cannot lose a refund | `cancel-appointment` cancels first and refunds second; if the refund step dies, the cron refunds every cancelled-but-paid appointment (`refundCancelledAppointments`, reconciled as `cancelled_appointment_not_refunded`) |
| no negative balances | recovery is `least(credit, held)` then `least(rest, available)` |

## 4. Reconciliation (`reconcile_refunds(stale_minutes)`, service role)

`stuck`, `needs_refund_without_refund`, `completed_but_intent_not_refunded`, `completed_but_appointment_not_refunded`, `business_debit_missing`, `failed_without_restore`, `restore_without_failed`, `carecoin_refund_without_ledger`, `business_shortfall`, `cancelled_appointment_not_refunded`, `refunded_appointment_without_refund` (after the cutover). The migration refused to apply unless production reconciled (it did: 0 rows).

## 5. Node side (`shared-payments/refunds.js`, used by both apps)

`requestRefund`, `settleRefund`, `executeCardRefund`, `settleRefundWebhook`, `sweepRefunds`, `refundUnappliedPayments`, `refundCancelledAppointments`, `runRefundSweeps`; `PaystackProvider.verifyRefund` added to the provider contract. CareFind: `cancel-appointment` (engine, no money moved by Node), `paystack-webhook` (`refund.pending|processing|processed|failed`), the chained cron. CareHub: `cron-reconcile-payments`.

## 6. Found and fixed on the way

* **`appointments.cancelled_at` did not exist in production** (the migration that adds it was applied without it), so `cancel-appointment` failed on every cancellation with a database error. The refund migration adds the column; cancellations work again once the migration is live (it is).
* `refund_appointment_payment` (no callers) refunded **coins** for card payments (nobody received them) and skipped the wallet debit when the business could not cover it; dropped.
* `cancel-appointment`'s fake-withdrawal "balance reversal" is gone (Phase 08); the real reversal is now the engine.

## 7. Rollout and what is NOT covered

1. Deploy CareFind and CareHub (the new code needs the live tables/functions, which are in place).
2. Make sure Paystack's webhook sends the `refund.*` events to the existing endpoint (the shared webhook; no new endpoint).
3. **Shop returns** (`request-shop-return` / `shop_returns` refund amounts) are not on the engine yet: the shop is not on the settlement engine either (Phase 10).
4. Subscription and consultation refunds do not exist as features; when they do, they use `request_refund` with a new cause.
5. No admin UI for `admin_refund` / `platform_funded` yet; the engine and `request_refund(... p_platform_funded)` are ready for it.

## 8. Tests

`refundEngine.db.test.js` (20, PGlite, production-order migrations) and `refundConcurrency.pg.test.js` (8, real Postgres: 40 simultaneous requests -> one refund and one debit; overlapping transactions; 40 failure notices -> one restore; processed/failed/processing races; CareCoin race; many bookings of one wallet; mixed storm). **Mutation-checked:** removing the row locks fails the overlapping tests. `shared-payments` `refunds` (25) + `verifyRefund` (4); CareFind `cancel-appointment.refund` (10), webhook refund events (4); CareHub cron.
