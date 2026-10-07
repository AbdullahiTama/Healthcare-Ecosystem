# CareFind Shop: end-to-end flow review

Status: review of 2026-10-07. The defects marked **Fixed** are fixed on branch `claude/dazzling-albattani-z5j01s`. The database fixes are in `supabase/migrations/carefind_20261020_shop_flow_fixes.sql`, which is **NOT yet applied to production**. Items marked **Decision needed** change behaviour customers or vendors rely on, so they wait for an owner decision.

## 1. Scope and method

The whole journey: cart → checkout (`Checkout.jsx`, `create_shop_order`) → payment (`initiate-shop-payment`, Paystack, `verify-shop-payment`, the webhook, `_settle_shop_order`) → vendor fulfilment (CareHub `Ecommerce.jsx`, `update_shop_order_status`, `add_tracking_event`) → delivery, returns and cancellation (`cancel_shop_order`, `request-shop-return`, `release_shop_vendor_credits`) → notifications and email (`effects.js` order confirmation, `enqueue_shop_order_status_email`, the email outbox).

Each finding was traced through the code that runs it, using the latest definition of every SQL function, the live table shapes (`liveSchemaSubset.sql`) and the client that calls it. The database findings are reproduced as tests against real Postgres (PGlite). Each test first runs against the live body, then applies the migration.

## 2. What is sound

- Money is decided on the server. `create_shop_order` recomputes subtotal, commission, fulfilment, delivery and total from the items and refuses any difference. The payment intent fixes the amount before Paystack is contacted. Settlement accepts only a Paystack payment that matches it, once.
- The redirect and the webhook share one settlement path, so the order confirmation email and the vendor notice are sent exactly once (with an idempotency key).
- A paid order that is cancelled is refunded automatically. Vendor money is held until the return window after delivery has passed, and an open return or refund blocks the release.
- Status emails (processing, shipped, delivered, cancelled) are queued in the database trigger, so they cannot be skipped by a client.

## 3. Findings

| ID | Severity | Where | Problem | Status |
|---|---|---|---|---|
| SF-0 | HIGH | `PaystackProvider.verifyPayment` | Paystack reports an unknown reference as HTTP 400 "Transaction reference not found", which surfaced as `invalid_request`, not `not_found`. An order whose earlier checkout never opened was stuck on "Could not check your earlier payment" for good. | **Fixed** (previous commit) |
| SF-1 | HIGH | `Checkout.jsx` | **Every order with a promo code failed** with "Order total mismatch". Checkout sent the discounted total, but `create_shop_order` compares the total with items + fees, and `apply_promo_code_to_order` subtracts the discount afterwards. A failed promo application was also ignored, so the customer could pay full price after being shown a discount. | **Fixed**: the order is created at full price and the server applies the discount. A failed application stops the redirect to Paystack and says so on the order page. |
| SF-2 | HIGH | `Checkout.jsx` | **Every home-delivery order outside the approved cities failed** with "Delivery fee mismatch". The distance field is hidden there but its default (5 km) was still sent, so the server charged ₦600 delivery while checkout sent ₦0. | **Fixed**: no distance is sent when delivery will be quoted. |
| SF-3 | MEDIUM | `Checkout.jsx` | If the order was created but the payment could not start (any error not containing the word "paystack"), the customer stayed on checkout with a full cart. A second click created a **duplicate order**, which also held stock. | **Fixed**: once the order exists, the cart is cleared and the customer continues on the order page, with the reason shown. |
| SF-4 | HIGH | `add_tracking_event` | **The vendor could never record a tracking update.** Its customer notice wrote `notifications(user_id, title, data)`, columns the live table does not have, so the call failed. It also set the status on its own terms, outside the F-39 rules: it could move a cancelled-and-refunded order to `delivered`, go backwards, and wrote no status history. | **Fixed**: the status change goes through `update_shop_order_status` (same rules, history, notices and email). |
| SF-5 | LOW | `notify_stock_alerts_on_restock` | "Back in stock" alerts were never sent. The trigger compared `products.id` with `ecommerce_products.id`, which never match. Had they matched, the broken notification insert would have rolled back the restock itself. | **Fixed** |
| SF-6 | LOW | `OrderDetail.jsx` | "I've Paid — Verify" asked the customer to type a Paystack reference. | **Fixed**: without a reference in the link, the server checks the order's latest attempt. |
| SD-1 | HIGH | `cleanup_pending_shop_orders` | **Unpaid orders are never released.** The function that cancels unpaid orders and returns their stock exists but nothing calls it. Every abandoned checkout keeps its stock reserved for good, so products show as out of stock while still on the shelf. | **Decision needed**: see 4.1 |
| SD-2 | HIGH | Pay at Pickup | **A Pay at Pickup order can never progress.** Nothing records that the customer paid in cash, and the vendor may not accept an unpaid order (F-39). The order stays `pending_payment` and holds its stock. | **Decision needed**: see 4.2 |
| SD-3 | HIGH | Delivery quotes | **Delivery outside the approved cities is never charged.** The customer pays products + fulfilment and the order becomes `paid`. The vendor's "Quote Delivery" button only shows before payment, and it writes the amount into a status note only: `delivery_kobo` and `total_kobo` never change. | **Decision needed**: see 4.3 |
| SD-4 | MEDIUM | Checkout | The customer types the delivery distance, so entering 0 km makes delivery free. | **Decision needed**: compute it from the vendor's and customer's locations, or have the vendor confirm it. |
| SD-5 | MEDIUM | Fulfilment | The vendor alone marks an order `delivered`. That starts the return window, after which the money is released unless the customer asks for a return. The customer is emailed when the order is marked delivered, which is their prompt to object. | Accepted risk for now. Consider a customer "I received it" step or a pickup code. |
| SD-6 | LOW | CareHub `Ecommerce.jsx` | Vendor order buttons have no error handling: a refused status change fails silently. Vendors get only an in-app notice (no email) when an order is paid. | Follow-up |
| SD-7 | LOW | `create_shop_order` | A pickup order in a city outside the approved list goes to `delivery_quote_pending`, though there is nothing to deliver. | Follow-up, together with SD-3 |

## 4. Decisions needed

### 4.1 Releasing unpaid orders (SD-1)

Proposal: add a `shop_order_expiry` step to the finance jobs (`api/_lib/financeJobs.js`, every 5 minutes) that cancels an unpaid order and returns its stock. Rules:

- Only once no Paystack checkout for it can still be paid: its latest payment intent is failed or expired, or it never had one, and it is older than the window. Otherwise a customer could pay an order that was just cancelled. The engine would refund that payment, but the customer would see a cancelled order.
- Window: 60 minutes is suggested. The existing function uses 30.
- Pay at Pickup orders are excluded, or given a longer window, depending on 4.2.

### 4.2 Pay at Pickup (SD-2)

Either remove the option until it is complete, or add a vendor action "Payment collected" that marks the order paid. The second needs a decision on how the platform's commission is collected on cash sales, because no money passes through Paystack.

### 4.3 Delivery quotes (SD-3)

Recommended: an out-of-zone home-delivery order cannot be paid until it is quoted. "Quote Delivery" becomes a server function that sets `delivery_kobo` and `total_kobo` and moves the order to `pending_payment`. The customer then pays the full amount in one payment, and the existing settlement rules (amount = intent) are unchanged. The alternative, a second "delivery balance" payment after the first, needs a new payment purpose.

## 5. Security implications of the fixes

- No permission is widened. `add_tracking_event` keeps its own ownership and "paid" checks and now also passes the forward-only rules of `update_shop_order_status`, closing a bypass of F-39. The acting user is still taken from the session, never from an argument.
- The checkout change sends less to the server (no discounted total, no distance when not charged). The server remains the authority on every amount.

## 6. Tests

- `apps/carefind/src/modules/shop/__tests__/checkoutOrder.test.js`: the order request (pickup, approved and out-of-zone delivery, never a discounted total, validation) and the error messages.
- `apps/carefind/src/test/payments/redTeam.db.test.js`, block "S-1 / S-2": each defect is shown against the live body, then the migration is applied. A tracking update advances the order with history and a notice. A same-step update records a location without a status change. Going backwards, reviving a cancelled order and a stranger's call are refused. A restock alerts each watcher once, with a link.
- `packages/shared-payments`: the Paystack not-found classification (SF-0).

Manual check after deploying: place a promo-code order, an out-of-zone home-delivery order and a normal order; abandon one Paystack checkout and pay it from the order page; as the vendor, add a tracking update.

## 7. Deploying

1. Apply `supabase/migrations/carefind_20261020_shop_flow_fixes.sql` to production. It replaces two functions and has no data changes.
2. Deploy CareFind (checkout and order page) and the shared-payments package.
3. Rollback: re-apply the previous bodies of `add_tracking_event` (from `carefind_20261019_red_team_fixes.sql`) and `notify_stock_alerts_on_restock` (from `carehub_20260906_shop_stock_alerts.sql`). Revert the front-end commit.
