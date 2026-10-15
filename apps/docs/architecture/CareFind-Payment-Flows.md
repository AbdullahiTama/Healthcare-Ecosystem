# CareFind Payment Flows (Phase 04)

Status: implemented and tested in the repo; **migrations not yet applied to production** (see §5). Replaces the per-flow settlement code described in `Financial-Architecture-Audit.md` for CareFind top-ups, creator subscriptions, professional consultations and paid appointments.

## 1. The shape

```
client ──(names WHAT it wants: package / creator / professional / slot)──▶ initiate handler
   initiate handler (server decides amount, payer, payee)
        1. createPaymentIntent()        -> payment_intents row, status created, unique reference
        2. provider.initializePayment() -> Paystack checkout URL
        3. markIntentPending()
customer pays at Paystack
   ┌── redirect:  verify-* handler ──┐
   └── webhook:   paystack-webhook ──┴─▶ settleByReference()
                                            1. read intent (already settled? answer, no provider call)
                                            2. provider.verifyPayment(reference)   (Paystack is the truth)
                                            3. rpc settle_payment_intent(...)      (Postgres, atomic, idempotent)
                                         runSettlementEffects()  (emails / business notice, once)
```
Redirect and webhook are two doors into the same room: whichever arrives first settles, the other receives `already_settled` and moves nothing.

## 2. What the server decides (client-controlled input is a name, never a number)

| Flow | Client sends | Server decides |
|---|---|---|
| Top-up | `packageId` | coins + naira from `topupPackages.js`; payer from the JWT |
| Subscription | `creatorId` | price = `profiles.subscription_price` (cap and coin value from `financial_config`); payer from the JWT |
| Consultation | `professionalId` | fee = the professional's `setup` offer; payer from the JWT; refuses a patient who already booked |
| Appointment | slot/service/guest details | fee = service price or business fee; business from the slot |

A price, amount, coin count, fee or user id in a request body is ignored (tests assert this per flow).

## 3. `settle_payment_intent` (Postgres, service-role only)

Inputs are Paystack's verified facts: reference, provider, provider transaction id, amount (kobo), currency. In one transaction it locks the intent and:

1. unknown reference -> `unknown_reference` (legacy payment; webhook falls back, §6)
2. already `settled`/`refunded` -> `already_settled`, nothing moves; already `needs_refund` -> returned as is
3. missing or conflicting provider transaction id -> `rejected`, intent untouched
4. provider / currency / amount differ from the intent -> `needs_refund` (`provider_mismatch` / `currency_mismatch` / `amount_mismatch`); the money is real, so it is parked, not dropped
5. dispatches to a private handler (validate first, write after):
   * **top-up**: claim the reference in `transactions`, credit coins
   * **subscription**: price must equal coins x coin value; creator exists and is not the subscriber; creator gets **floor(coins x 80%)**, the rest is booked as `platform_fee_subscription`; 30 days granted/extended; the subscriber's CareCoin wallet is **not** touched
   * **consultation**: the paid booking row is the claim (unique per professional+patient; a patient who already booked -> `needs_refund: already_booked`, nothing credited); professional gets **floor(fee x 80% / coin value)** coins; the patient's wallet is **never** debited
   * **booking**: appointment locked; business and fee must match the intent; credited from the **actual kobo paid** (platform = round(fee x booking rate)), no rounding to a coin boundary
6. handler declined -> `needs_refund` with its reason; handler fine -> `settled`

Unsupported purposes (plan renewal, CareHub appointment, shop order) **raise**, rolling back the whole call, so they can never look handled. They move onto the engine in Phase 06 / 10.

Rates and constants come from `financial_config` (`coin_value_kobo`, `booking_platform_rate`, `subscription_platform_rate`, `consultation_platform_rate`, `subscription_max_coins`), not from literals.

## 4. Commercial-rule changes made in this phase (owner decisions, 2026-10-03)

* Card **subscriptions and consultations carry a 20% platform fee** (previously none). Coins are whole numbers, so the creator/professional share is rounded **down** and the remainder stays with the platform (a 1-coin subscription pays the creator nothing). The CareCoin-paid paths (`pay_creator_subscription`, `pay_professional_consultation`) are **unchanged** — see open question Q1.
* The coin-path subscription price is now the creator's listed price (`price_mismatch` otherwise); a creator who raises their price makes old-price auto-renewals fail safely instead of undercharging.

## 5. Rollout (order matters)

Apply, in this order, **before deploying the application code** (the new handlers call functions that do not exist until then):

1. `carefind_20261004_settle_payment_intent` (engine, handlers, `_fin_cfg`, 2 new config keys)
2. `carefind_20261004_pay_creator_subscription_authoritative_price` (F-04, coin path)
3. `carefind_20261004_settle_card_booking_actual_amount` (F-06; has a precondition that fails clearly if step 1 was skipped)

Then deploy. Payments that started before the deploy have no intent; they keep working (§6). After applying, re-read `pg_proc` for siblings and `proacl` (project trap: default privileges re-grant EXECUTE) — each migration asserts this itself.

## 6. Transition behaviour

* **Webhook**: for `charge.success` it first tries the engine (`unknown_reference` -> legacy metadata dispatch for payments started before this change). The legacy branches (`creditTopup`, `settle_subscription_payment`, `settle_consultation_payment`, `settle_card_booking` via `handleBooking`, shop, CareHub plan) stay until they drain; removal is Phase 10 cleanup.
* **Redirect verify handlers** return 404 for a legacy reference, except `verify-booking-payment`, which reports `alreadyPaid` if the appointment is already paid.
* **Events**: every webhook event is stored in `payment_provider_events` *before* processing (`unique(provider, event_id)`); a handled replay is acknowledged without reprocessing; a failed attempt stays retryable; `charge.success` that Paystack still reports `pending`, or that the engine `rejected`, answers 500 so Paystack redelivers; a payment that cannot be applied is parked as `needs_refund` and logged as `[payment-needs-refund]`.

## 7. Failure behaviour

| Situation | Result |
|---|---|
| Paystack initialise refused | intent -> `failed`; 502 |
| Paystack initialise ambiguous (timeout) | intent stays `created` (expires); 502; customer was never sent a link |
| Verify call fails / times out | 502 (redirect) or 500 (webhook -> redelivery) |
| Engine/DB error | exception -> whole transaction rolled back -> retry |
| Same payment arrives twice (webhook+redirect, duplicate delivery) | exactly one settlement |
| Customer pays twice for the same thing | second payment `needs_refund` (`already_booked` / `already_paid`) — **refund itself is Phase 09** |

## 8. Tests

* `settlementEngine.db.test.js` (41), `authoritativeSubscriptionPrice.db.test.js` (9), `settleCardBookingActualAmount.db.test.js` (7): real Postgres (PGlite) + the real migrations + a replica of the live tables.
* `topupFlow` (21), `subscriptionFlow` (23), `consultationFlow` (21), `bookingFlow` (17), `webhookEngine` (17): handlers with fakes.
* `packages/shared-payments`: 133.
* Mutation-checked: weakening the amount check, the replay guard, the 80% split, the booking amount, webhook duplicate suppression and not-paid handling each make tests fail.

**Concurrency (real, multi-connection)**: `settlementConcurrency.pg.test.js` opens up to 40 connections to a real Postgres and fires settlements at the same instant. It runs only when `PG_CONCURRENCY_URL` is set (`npm run test:concurrency` in `apps/carefind`; any local Postgres 15+, Docker, or the `embedded-postgres` package) and is skipped otherwise. Verified on PostgreSQL 18.4:
* 25 callers on one intent -> exactly 1 `settled`, 24 `already_settled`, wallet credited once
* 150 independent webhook+redirect races -> never both settled, never a double credit
* 20 different top-ups for one user -> all credited, none lost
* 10 payments for one appointment -> 1 pays it, 9 `needs_refund(already_paid)`, business credited once
* 8 payments for one consultation pair -> 1 booking, 1 professional credit, 7 `already_booked` with nothing written
* 6 subscription payments for one pair (paid-creator and 1-coin variants) -> 6 months granted
* 120-call mixed storm (every intent hit twice) -> no deadlock, no error, balances conserved
This suite **found a real race**: concurrent renewals extended `expires_at` from a stale read and granted one month for six payments (hidden for paid creators only by statement ordering). Fixed in the engine (extend from the locked row). Without a real Postgres the PGlite suites still prove replay-idempotency, but not parallel interleaving.

## 9. Open questions

* **Q1**: should the 20% platform fee also apply to the CareCoin-paid subscription/consultation paths? Today coins paths credit 100%, card paths 80% — inconsistent until decided.
* **Q2**: `callback_url` is still client-supplied on top-ups/subscriptions/consultations (Paystack redirects the payer there afterwards). Self-affecting only, but an allow-list of our own origins is cheap hardening (new finding F-27, low).
* **F-27 (low)**: `callback_url` — see Q2. **F-28 (info)**: `claim_payment_event` is callable by any signed-in user (shop events only; Phase 14).
* Shop, CareHub plans and CareHub appointments still use their own settlement until Phases 06/10.
