# CareHub Payment Flows (Phase 06)

Status: implemented and tested in the repo; **the two pending migrations are not yet applied to production** (see §6). Replaces the per-flow settlement of CareHub plan payments and appointment payments (audit F-06, F-10, F-15) with the same engine CareFind uses (`CareFind-Payment-Flows.md`).

## 1. The shape

```
verified business owner ──(names WHAT: months ∈ {1,12} / appointment id)──▶ initiate handler
   initiate handler (server decides plan, price, business, amount)
        1. createPaymentIntent()        -> payment_intents row, unique reference, expected kobo
        2. provider.initializePayment() -> Paystack checkout URL
        3. markIntentPending(); (appointments) point the appointment at the newest reference
business pays at Paystack
   ┌── redirect:  verify-plan-payment / verify-appointment-payment ──┐
   └── webhook:   the shared paystack-webhook (any charge.success) ──┴─▶ settleByReference()
                                                                          verify with Paystack -> settle_payment_intent()
                                                                          runSettlementEffects()  (emails, staff notice; once)
```
CareHub has no webhook of its own: the shared endpoint (CareFind's deployment) settles any intent, whatever `application` it belongs to.

## 2. What the server decides

| Flow | Client sends | Server decides |
|---|---|---|
| Plan payment | `months` (1 or 12) | business (from the verified session, never the body), plan (from the business row), price (`PLAN_MONTHLY_NAIRA` / `PLAN_YEARLY_NAIRA`), amount in kobo, reference |
| Appointment payment | `appointment_id` | the business's own appointment only (404 otherwise), fee = the stored `fee_amount` (positive whole kobo), amount, reference |

Tests assert that any amount/price/plan/business/user in the body is ignored, that other `months` values and custom/unknown plans are refused with no intent created, and that every attempt gets a fresh reference.

## 3. Settlement (Postgres, one function)

`settle_payment_intent` gained two purposes (everything else — provider/currency/amount checks, replay safety, `needs_refund` instead of dropping money — is unchanged):

* **`appointment`** -> the same handler as a CareFind booking: the appointment is locked; business and fee must match the intent; the business wallet is credited from the **actual kobo paid** (platform = round(fee x `booking_platform_rate`), the rest held), the appointment becomes `paid` / `card`. A card amount is **never** converted to CareCoins (F-06). An appointment already paid another way (POS/transfer) -> `needs_refund(already_paid)`, nothing credited.
* **`plan_renewal`** -> new `_settle_plan_renewal`: validates `months ∈ {1,12}`, a positive whole-naira amount and that the business exists, then calls the existing `renew_business_plan()` — one definition of "renew a plan": the `plan_payments` row is claimed by its unique reference and the expiry is extended **from the current expiry under the business row lock** (an expired plan restarts from today). **No duplicate renewal**: the engine settles an intent once, and `plan_payments.reference` is unique underneath (a reference already claimed by the legacy webhook path -> `needs_refund(reference_already_used)`).

Card money stays in kobo end to end; CareCoin money (Phase 05) is a different currency in a different ledger and is not touched by either handler. Tests: 21 on PGlite, plus real-Postgres cases (25 callers on one plan payment -> one renewal; 6 different payments for one business -> 6 rows and 6 stacked months; 10 payments for one appointment -> one pays it, nine `needs_refund`).

## 4. Behaviour changes

* **Appointment retries work.** The old handler re-sent the same Paystack reference every time, which Paystack refuses after an abandoned attempt (F-15). Each attempt now has its own intent/reference; earlier attempts stay settleable (a late success is accepted, or parked as `needs_refund(already_paid)` if the appointment was paid by a later attempt).
* **Wrong-amount, wrong-business and wrong-purpose payments** are now refused/parked instead of trusted: ownership is the intent's `business_id` (not an email match on a metadata field), and the paid amount must equal the amount recorded before checkout (F-10).
* **Responses keep their shapes** (`credited`/`newExpiry`, `alreadyProcessed`, `success`/`id`/`paid`/`alreadyPaid`); new: HTTP 409 with `needsRefund` when a payment cannot be applied, and `needsRefund: true` alongside `alreadyPaid` when an appointment was paid another way meanwhile.
* **Effects run once, by whoever settled**, for both doors: plan renewal -> `subscription_created` email to the owner; appointment -> staff notification + `appointment_confirmed` to the client (client email falls back to the client record). They live in `shared-payments/effects.js`, shared with CareFind.

## 5. Still true (deliberately not in this phase)

* **Referral commission** is still computed in Node after settlement (`computeCommission`), and by the daily reconcile cron when the webhook settled first. The first-payment determination inside `renew_business_plan` is still the old non-atomic one (F-05). **Phase 07** moves both into one atomic database step.
* **Business withdrawals** (`initiate-business-withdrawal`), the `ilike` owner matching in `verifyBusiness` (F-09) and the missing PIN/limits (F-08) are **Phase 08**.
* **Refunds** for `needs_refund` payments and the business-wallet refund gaps are **Phase 09**.
* `callback_url` is still client-supplied (F-27, low).
* Legacy webhook branches (`handlePlanPayment`, `handleBooking` for `source = 'carehub'`) remain for payments that started before the engine shipped; they drain, then Phase 10 removes them. Shop orders are not on the engine yet.

## 6. Rollout (order matters)

Apply, then deploy the code:

1. `carefind_20261006_coin_paths_platform_fee` — Q1: 20% platform fee on CareCoin-paid subscriptions/consultations (needs the Phase 04/05 migrations, already live)
2. `carefind_20261006_settle_plan_and_carehub_appointments` — engine: `appointment` and `plan_renewal` (needs the Phase 04 engine, already live; fails clearly if `renew_business_plan` is missing)

Deploy the CareFind app (shared webhook) and the CareHub app together; the CareHub app now depends on `@care-ecosystem/shared-payments`. Until the migration is applied, deploying the new CareHub code would make plan/appointment payments end in an exception (the engine rejects unsupported purposes) — so migrate first. After applying: re-read `pg_proc.proacl` for both migrations' functions (project trap) — each migration asserts it itself.

## 7. Tests

`apps/carehub/api/__tests__/paymentFlows.test.js` (37), `carehubSettlement.db.test.js` (21, PGlite with the production `renew_business_plan`), 3 more cases in `settlementConcurrency.pg.test.js` (real Postgres), 2 webhook cases, 23 tests for the shared effects/request-settlement code. Mutation-checked: dropping the business-ownership check or taking the price from the request each fail tests.
