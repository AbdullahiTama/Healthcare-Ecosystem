# Vendor payout model for shop sales

Status: implemented and tested. Migrations `carefind_20261012_shop_vendor_payouts` and `carefind_20261013_shop_return_hardening` are **APPLIED to production (2026-10-05)**. The application code (cron release sweep, wallet labels) ships with the next CareFind/CareHub deploy; until then nothing releases held money (it simply stays held, which is safe).

`carefind_20261105_release_on_delivery` **removes the hold**: a vendor's share is released the moment the order is delivered, not after a 7-day wait (owner decision, 2026-10-14). The customer's return window is unaffected — see below.

## 1. The model

The vendor is paid through the **business wallet** bookings already use, and withdraws through the **PIN-protected withdrawal engine** (CareHub). No second money system.

```
order PAID           held_balance      += subtotal - commission        ledger 'shop_credit'   ref shopcr_<order>
delivered             held -> available                                 ledger 'shop_release'  ref shoprl_<order>   (row trigger, same tx; daily sweep backstop)
refund / return      vendor share taken back at REQUEST                ledger 'refund_debit'  ref rf_<refund>
refund FAILS         exactly what was taken is given back              ledger 'refund_restore'
vendor withdraws     available -> bank, through the withdrawal engine
```

* The credit is written inside `_settle_shop_order`, in the same transaction that marks the order paid, so a payment is never "paid but the vendor not credited" and a replay cannot credit twice (`shop_vendor_credits.order_id` is the primary key; the ledger reference is unique).
* **What the vendor earns:** `subtotal - commission`. Commission (20% flat, stored on the order at creation) and the fulfilment fee stay with the platform; the delivery fee is not the vendor's; platform promo discounts are absorbed by the platform.
* **The payout hold is gone; the return window is not.** A paid order's share is released the moment the order becomes `delivered` — synchronously, in the same transaction that delivered it, so the vendor can withdraw immediately. The **customer's** return window is unchanged: `financial_config.shop_vendor_return_window_days` (7) still governs `request_shop_return`, measured from the order's **first** `delivered` history row. The two used to share one number — which is what made "the customer can return exactly as long as the vendor's money is held" true — and are now deliberately decoupled. That config value must stay 7: zeroing it would delete customers' return rights, since `request_shop_return` and `request_shop_return_service` still read it.
* **The accepted consequence (owner, 2026-10-14):** a return requested after delivery may find the money already withdrawn. The return is still granted inside its 7 days; the refund engine then recovers the vendor's share from `available_balance`, and if it is already gone it records the shortfall on the refund, which `reconcile_shop_vendor_credits()` lists as `refund_shortfall`. No double-payout is possible: release only ever moves `held -> available`, only while the credit is `held`, and only for that one order.
* Both the **trigger and the sweep** skip an order that is not `delivered`, has a requested return, or has a live refund. Release takes locks in one order everywhere — order, credit, wallet — so a delivery, a refund and the sweep cannot deadlock against each other.
* The trigger (`trg_shop_order_release_on_delivery`) fires only on a real transition **into** `delivered` and calls `release_shop_vendor_credits(1, <order>)`, so it releases exactly that one order. Because it is the same guarded call, it correctly covers every other path that reaches `delivered`: a partial refund completing (the remaining share), a failed refund restoring the order (the restored share), and a rejected return (the whole share) — and it does nothing when the credit is already `released`.

## 2. Refunds of shop orders (refund engine, third entity)

`request_refund(cause, 'shop_order', order_id, requested_by, reason, platform_funded, amount_kobo)`; causes `shop_return` and `order_cancelled`.

* Full or partial (`amount_kobo`, never more than the intent's amount). The vendor recovery is pro rata of the vendor's share (`round(share * refund / paid)`). Because the share is released on delivery, that recovery now comes out of `available_balance`; a held share (undelivered, or blocked by an open return) still recovers from `held_balance` first.
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
* `release_shop_vendor_credits`, `reconcile_shop_vendor_credits`, `request_refund`, `settle_refund`: `service_role` only; `_settle_shop_order`: nobody. `cancel_shop_order`/`process_shop_return`/`request_shop_return`: `authenticated` (and `service_role`); `anon` revoked. The **delivery trigger function** `release_vendor_credit_on_delivery` is `SECURITY DEFINER` with a pinned `search_path`; it performs one call scoped to `NEW.id` and writes nothing itself, so it cannot recurse (release never touches `shop_orders`). Like the other trigger functions it carries no grants, and PostgreSQL refuses any direct call to a trigger function anyway ("trigger functions can only be called as triggers"), so an API role cannot reach it by name.
* The vendor cannot withdraw held money, and available money leaves only through the existing PIN-protected, capped, ledgered withdrawal engine.

## 7. Tests

`vendorPayouts.db.test.js` (46, PGlite): credit/replay/needs_refund, release on delivery (fires at delivery with one ledger row and a no-op later sweep, undelivered held, open return held, live refund held, once, shortfall), **release through the production path** (the vendor themself calls `update_shop_order_status` and the trigger releases), the delivery trigger not being drivable by an API role, refunds (held, released, shortfall, failure restore, partial, platform-funded, one live refund, amount bounds), cancel/return flows, return hardening, reconcile, permissions, and the decoupling assertion that money is released on delivery while the customer's return window still runs 7 days. `vendorPayoutsConcurrency.pg.test.js` (5, real Postgres): 30 simultaneous credits, 12 overlapping release sweeps of an order the trigger already released (none may release it a second time), 12 overlapping refunds, a release racing a refund, a failed refund racing its replay. Mutation check: removing the order/credit locks in the release makes the sweep and the race tests fail.
