# Vendor payout model for shop sales

Status: implemented and tested. Migrations `carefind_20261012_shop_vendor_payouts` and `carefind_20261013_shop_return_hardening` are **APPLIED to production (2026-10-05)**. The application code (cron release sweep, wallet labels) ships with the next CareFind/CareHub deploy; until then nothing releases held money (it simply stays held, which is safe).

## 1. The model

The vendor is paid through the **business wallet** bookings already use, and withdraws through the **PIN-protected withdrawal engine** (CareHub). No second money system.

```
order PAID           held_balance      += subtotal - commission        ledger 'shop_credit'   ref shopcr_<order>
delivered + 7 days   held -> available                                 ledger 'shop_release'  ref shoprl_<order>   (cron sweep)
refund / return      vendor share taken back at REQUEST                ledger 'refund_debit'  ref rf_<refund>
refund FAILS         exactly what was taken is given back              ledger 'refund_restore'
vendor withdraws     available -> bank, through the withdrawal engine
```

* The credit is written inside `_settle_shop_order`, in the same transaction that marks the order paid, so a payment is never "paid but the vendor not credited" and a replay cannot credit twice (`shop_vendor_credits.order_id` is the primary key; the ledger reference is unique).
* **What the vendor earns:** `subtotal - commission`. Commission (20% flat, stored on the order at creation) and the fulfilment fee stay with the platform; the delivery fee is not the vendor's; platform promo discounts are absorbed by the platform.
* **Return window = hold period = 7 days** (`financial_config.shop_vendor_return_window_days`), measured from the order's **first** `delivered` history row. The customer can return exactly as long as the vendor's money is held. (Before this, `request_shop_return` measured from `shop_orders.updated_at`, which any later update moved.)
* The sweep skips an order that is not `delivered`, has a requested return, or has a live refund. It takes locks in one order everywhere: order, credit, wallet.

## 2. Refunds of shop orders (refund engine, third entity)

`request_refund(cause, 'shop_order', order_id, requested_by, reason, platform_funded, amount_kobo)`; causes `shop_return` and `order_cancelled`.

* Full or partial (`amount_kobo`, never more than the intent's amount). The vendor recovery is pro rata of the vendor's share (`round(share * refund / paid)`), the remaining share stays held and is released later.
* A **released** credit is recovered from `available` first; a **held** credit from `held` first. Never below zero; if the vendor already withdrew it, the shortfall is recorded on the refund and listed by `reconcile_shop_vendor_credits()` (`refund_shortfall`).
* Platform-funded refunds touch the vendor not at all.
* Completion (`settle_refund` processed): full refund -> order `refunded` (a cancelled order stays `cancelled`, `payment_status` `refunded`), payment attempt `refunded`, intent `refunded`, customer notified; partial -> the order goes back to `delivered`. Failure -> the vendor is restored, the credit returns to `held`/`released`, an order waiting on a return is `delivered` again, and the order can be refunded again.
* The Paystack call is made by the refund sweep (cron), exactly like booking refunds; the customer's money is only marked returned when the provider confirms.
* Limitation: one live refund per order, so a second partial refund after a completed partial one is not possible.

## 3. Behaviour changes (and why)

| Function | Before | Now |
|---|---|---|
| `cancel_shop_order` | cancelling a PAID order kept the customer's money | a paid order is refunded through the engine; a customer cannot cancel a dispatched paid order (must request a return once delivered); an order with a return/dispute in progress cannot be cancelled; vendor/admin can cancel any unfinished order and the customer is refunded |
| `process_shop_return` approve | flipped the order to `refunded` and moved no money | starts a real card refund (<= amount paid); the order stays `refund_requested` until the provider confirms; if the refund cannot start, the approval rolls back |
| `request_shop_return` | executable by `anon`; customer chose any amount; window from `updated_at` | authenticated only; amount in 1..total; window from the first delivery |

## 4. Not done automatically: the 9 orders paid before this model

Nine paid orders (CF-000012 ... CF-000026, vendor share 117,000 kobo = N1,170 in total) predate vendor credits. They were marked paid by the previous flow, which did not verify the payment with the provider, so they are **not** credited automatically. `reconcile_shop_vendor_credits()` lists them as `legacy_paid_order_without_credit`; a human verifies each payment at Paystack and decides.

## 5. Reconciliation (`reconcile_shop_vendor_credits`, service_role)

`legacy_paid_order_without_credit`, `paid_order_without_credit` (a bug after cutover), `credit_amount_mismatch`, `credit_without_ledger_row`, `released_without_ledger_row`, `release_shortfall`, `refund_shortfall`, `approved_return_without_refund`, `held_below_open_credits`. A clean system returns only the nine legacy rows.

## 6. Security

* `shop_vendor_credits` is server-only (RLS on, all grants revoked) with a guard trigger (identity and amounts immutable, no delete, no truncate).
* `release_shop_vendor_credits`, `reconcile_shop_vendor_credits`, `request_refund`, `settle_refund`: `service_role` only; `_settle_shop_order`: nobody. `cancel_shop_order`/`process_shop_return`/`request_shop_return`: `authenticated` (and `service_role`); `anon` revoked.
* The vendor cannot withdraw held money, and available money leaves only through the existing PIN-protected, capped, ledgered withdrawal engine.

## 7. Tests

`vendorPayouts.db.test.js` (34, PGlite): credit/replay/needs_refund, release (window, undelivered, open return, live refund, once, shortfall), refunds (held, released, shortfall, failure restore, partial, platform-funded, one live refund, amount bounds), cancel/return flows, return hardening, reconcile, permissions. `vendorPayoutsConcurrency.pg.test.js` (5, real Postgres): 30 simultaneous credits, 12 overlapping release sweeps, 12 overlapping refunds, a release racing a refund, a failed refund racing its replay. Mutation check: removing the order/credit locks in the release makes the sweep and the race tests fail.
