# The Settlement Engine (Phase 10)

Status: implemented and tested in the repo. **The migration `carefind_20261010_central_settlement` is written and NOT applied to production** (section 6): it drops functions the live shop code calls, so it goes live together with the new CareFind/CareHub code.

## 1. One definition

```
payment_intent (recorded by the server BEFORE checkout: purpose, payer, payee, entity, expected kobo)
        + verified provider transaction (asked of Paystack directly: status, amount, currency, id)
                                  |
                      settle_payment_intent()     <- the ONLY way card money becomes an effect
   verify identity -> amount -> currency -> provider; lock the intent; already settled? ; dispatch to ONE private handler;
   the handler validates, then writes (its own transaction part); a payment that cannot be applied becomes needs_refund
                                  |
   settled -> effects run ONCE, by the call that settled it      needs_refund -> refund engine (Phase 09)
```
Callers: the redirect handlers (`verify-*`) and the Paystack webhook (`charge.success`). Both go through `settleIntentForRequest` / `settleByReference` in `shared-payments`; neither contains any money logic.

| Purpose | Handler | What it moves |
|---|---|---|
| `wallet_topup` | `_settle_wallet_topup` | CareCoins through the ledger |
| `creator_subscription` | `_settle_creator_subscription` | coins payer -> creator (80%), platform keeps the rest |
| `consultation` | `_settle_consultation` | same, plus the booking claim |
| `booking`, `appointment` | `_settle_booking` | business wallet credited from the amount actually paid (80% held / 20% platform) |
| `plan_renewal` | `_settle_plan_renewal` | plan expiry + the referral commission (one transaction) |
| **`shop_order`** (new) | `_settle_shop_order` | order paid, payment-attempt ledger, history, customer notice |

`_settle_shop_order` re-checks under the order lock: the order belongs to the intent's customer and vendor, is payable (`pending_payment` / `delivery_quote_pending`), is not already paid, and its total still equals the amount recorded. Anything else is `needs_refund` with a reason (`customer_mismatch`, `business_mismatch`, `already_paid`, `order_not_payable`, `amount_changed`).

## 2. What was removed (second definitions)

* `verify_shop_payment` ("In production this would call Paystack verify; here we trust the reference presence"), `claim_payment_event` (**F-28**: executable by any signed-in user), `settle_card_booking`: dropped.
* The per-purpose money primitives `credit_wallet_topup`, `settle_subscription_payment`, `settle_consultation_payment`, `renew_business_plan`, `fn_credit_business_booking` are now **engine internals**: EXECUTE revoked from every API role (the engine's handlers are SECURITY DEFINER and keep calling them). No application code can settle money any other way.
* Node: the webhook's **metadata dispatch** (top-up, subscription, consultation, booking, shop, plan: each decided by `event.data.metadata`, which the payer influences) and its helpers `paystackCredit.js`, `consultationSettle.js` are deleted. The webhook went from 575 to 158 lines: signature, persistence, `charge.success` -> engine, `transfer.*` -> withdrawal engine, `refund.*` -> refund engine.
* The shop's own fallback ladder (RPC, a second RPC, then a direct table UPDATE) in `verify-shop-payment` is gone.

## 3. Shop flow now

`initiate-shop-payment` records an intent for the order's own `total_kobo` and the signed-in customer, mirrors the attempt in `shop_payments`, then initialises Paystack with the intent's amount. A previous attempt is checked first: paid -> settled now and the customer told (never charged twice); unpaid -> closed (ledger and intent); cannot be checked -> refuse (502) rather than risk a double payment; an attempt that pre-dates intents and that Paystack says was **paid** -> 409 for a human. `verify-shop-payment` and the webhook settle only through the engine; the order named by the client must be the intent's own order (checked before settling). Effects (vendor notice, purchase pattern, order confirmation email) are shared in `shared-payments/effects.js` and run once.

## 4. "Domain events"

The engine's result is the domain event: `settled` carries what changed (purpose, entity, amounts), and `runSettlementEffects` consumes it exactly once (only the call that actually settled gets `outcome = settled`; replays and the losing racer get `already_settled`). There is no separate event bus; adding one later means consuming the same result.

## 5. Behaviour changes to be aware of

* A charge that **no payment intent recognises** is acknowledged (a retry cannot change it), recorded as `ignored`, and logged as `payment.unmatched_charge`. It is **never** settled from its metadata. Two cases produce it: another integration sharing the Paystack account, and a payment started before this code was deployed. **Phase 11 adds the reconciliation that lists them**; until then watch that log line after deploy.
* Shop orders paid after a retry: the loser is parked `needs_refund` and refunded by the refund engine (cron), not silently dropped or applied twice.

## 6. Rollout

1. Deploy CareFind + CareHub (the Phase 04-10 code). The code works against the **current** database too, except the shop (its handlers need `_settle_shop_order`).
2. Apply `carefind_20261010_central_settlement` **with the same deploy**: the OLD shop code calls `verify_shop_payment` / `claim_payment_event`, which it drops; the NEW shop code needs the migration. The migration asserts the engine's ACL, that exactly one engine exists, that no legacy settlement function survives, and that no API role can call a primitive.
3. In Paystack, keep one webhook URL (this endpoint); it already receives `charge.success`, `transfer.*` and `refund.*`.
4. After applying: re-read `proacl` for `settle_payment_intent` and the revoked primitives.

## 7. Tests

`centralSettlement.db.test.js` (13, PGlite): shop settle/replay/amount mismatch/wrong customer or vendor/repriced/not payable/delivery quote/retry with a late success then a double payment (refundable)/bad intent; legacy functions gone; F-28 closed; the five primitives uncallable by `anon`, `authenticated` and `service_role`; the engine still settles top-up, plan renewal and booking as `service_role` without the revoked grants. `shopSettlementConcurrency.pg.test.js` (4, real Postgres): 40 callers on one payment; 12 genuinely overlapping transactions; two attempts of one order paid at once -> one settles, one `needs_refund`; many orders at once. `shop-payment.engine.test.js` (19): both handlers. `shared-payments` shop effects (4). Webhook tests rewritten for the single path (unmatched charges, ack-after-settle, refund and transfer routing).
