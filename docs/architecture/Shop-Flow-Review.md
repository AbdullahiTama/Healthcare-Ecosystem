# CareFind Shop: end-to-end flow review

Status: review of 2026-10-07. Everything marked **Fixed** is on branch `claude/dazzling-albattani-z5j01s`. The database changes are in two migrations, **neither applied to production yet** (section 7): `carefind_20261020_shop_flow_fixes.sql` and `carefind_20261021_shop_expiry_and_delivery_quotes.sql`. SD-1, SD-2 and SD-3 follow the recommendations in section 4.

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
| SF-0 | CRITICAL | `PaystackProvider.verifyPayment` | **Every order's first payment failed** with "Could not check your earlier payment". `create_shop_order` records a placeholder reference (`CF-…`) that is never sent to Paystack. Before starting a payment, `initiate-shop-payment` checks the previous attempt with Paystack, which answers HTTP 400 "Transaction reference not found". That surfaced as `invalid_request` instead of `not_found`, so the handler refused to continue, on every retry. | **Fixed** |
| SF-1 | HIGH | `Checkout.jsx` | **Every order with a promo code failed** with "Order total mismatch". Checkout sent the discounted total, but `create_shop_order` compares the total with items + fees, and `apply_promo_code_to_order` subtracts the discount afterwards. A failed promo application was also ignored, so the customer could pay full price after being shown a discount. | **Fixed**: the order is created at full price and the server applies the discount. A failed application stops the redirect to Paystack and says so on the order page. |
| SF-2 | HIGH | `Checkout.jsx` | **Every home-delivery order outside the approved cities failed** with "Delivery fee mismatch". The distance field is hidden there but its default (5 km) was still sent, so the server charged ₦600 delivery while checkout sent ₦0. | **Fixed**: no distance is sent when delivery will be quoted. |
| SF-3 | MEDIUM | `Checkout.jsx` | If the order was created but the payment could not start (any error not containing the word "paystack"), the customer stayed on checkout with a full cart. A second click created a **duplicate order**, which also held stock. | **Fixed**: once the order exists, the cart is cleared and the customer continues on the order page, with the reason shown. |
| SF-4 | HIGH | `add_tracking_event` | **The vendor could never record a tracking update.** Its customer notice wrote `notifications(user_id, title, data)`, columns the live table does not have, so the call failed. It also set the status on its own terms, outside the F-39 rules: it could move a cancelled-and-refunded order to `delivered`, go backwards, and wrote no status history. | **Fixed**: the status change goes through `update_shop_order_status` (same rules, history, notices and email). |
| SF-5 | LOW | `notify_stock_alerts_on_restock` | "Back in stock" alerts were never sent. The trigger compared `products.id` with `ecommerce_products.id`, which never match. Had they matched, the broken notification insert would have rolled back the restock itself. | **Fixed** |
| SF-6 | LOW | `OrderDetail.jsx` | "I've Paid — Verify" asked the customer to type a Paystack reference. | **Fixed**: without a reference in the link, the server checks the order's latest attempt. |
| SF-7 | MEDIUM | Order emails | The "View order" button in every order status email linked to `/orders/<order ref>`. The order page looks orders up by id, so the link opened an error. The order confirmation email had no link at all. | **Fixed**: both link to `/orders/<order id>`. |
| SD-1 | HIGH | `cleanup_pending_shop_orders` | **Unpaid orders were never released.** The function that cancels unpaid orders and returns their stock existed but nothing called it. It also could not have worked: it set `payment_status = 'expired'`, which the table's check constraint refuses. Every abandoned checkout kept its stock reserved for good. | **Fixed**: see 4.1 |
| SD-2 | HIGH | Pay at Pickup | **A Pay at Pickup order could never progress.** Nothing records that the customer paid in cash, and the vendor may not accept an unpaid order (F-39). `create_shop_order` also told vendors "pay at pickup" for every pickup order, including orders paid online. | **Paused**: see 4.2 |
| SD-3 | HIGH | Delivery quotes | **Delivery outside the approved cities was never charged.** The customer could pay before the quote. The vendor's "Quote Delivery" only moved the status and wrote the amount into a note: `delivery_kobo` and `total_kobo` never changed. | **Fixed**: see 4.3 |
| SD-4 | MEDIUM | Checkout | The customer types the delivery distance, so entering 0 km makes delivery free. | **Decision needed**: compute it from the vendor's and customer's locations, or have the vendor confirm it. |
| SD-5 | MEDIUM | Fulfilment | The vendor alone marks an order `delivered`. That starts the return window, after which the money is released unless the customer asks for a return. The customer is emailed when the order is marked delivered, which is their prompt to object. | Accepted risk for now. Consider a customer "I received it" step or a pickup code. |
| SD-6 | LOW | CareHub `Ecommerce.jsx` | Vendor order buttons had no error handling: a refused status change failed silently. Vendors get only an in-app notice (no email) when an order is paid. | **Fixed** (buttons report success or the reason). The vendor email is a follow-up. |
| SD-7 | LOW | `create_shop_order` | A pickup order in a city outside the approved list went to `delivery_quote_pending`, though there is nothing to deliver. | **Fixed** |
| SD-8 | LOW | CareHub `services/supabase.js` | `sbFetch` logs the first 20 characters of the user's access token to the browser console on every request. | Follow-up: remove the log. |

## 4. Unpaid orders, Pay at Pickup and delivery quotes

### 4.1 Unpaid orders expire (SD-1)

`expire_unpaid_shop_orders()` runs every 5 minutes as the finance cron's `shop_order_expiry` step (`api/_lib/financeJobs.js`). It replaces the never-called `cleanup_pending_shop_orders`, which is dropped. An unpaid order is cancelled the way `cancel_shop_order` does it: stock back, open attempts and intents closed, status history, in-app notice, and the "cancelled" status email.

| Order | Expires |
|---|---|
| Waiting for payment, sent to Paystack | 60 minutes after the latest payment attempt |
| Waiting for payment, never sent to Paystack (e.g. placed as Pay at Pickup before it was paused) | 72 hours after it was placed |
| Waiting for a delivery quote | 7 days without a quote |

An order whose Paystack payment is being applied (`verified` intent) is never touched, and rows locked by a checkout are skipped until the next run. A Paystack payment that still arrives for an expired order is refunded automatically by the settlement engine (`order_not_payable`). The windows are constants in the function; change them there.

### 4.2 Pay at Pickup is paused (SD-2)

Checkout no longer offers it, and every order is paid online. In CareHub the vendor's setting is shown as paused and cannot be changed, but the saved choice is kept. Turning it back on needs two things first: a vendor action "Payment collected" that marks the order paid, and a decision on how the platform's commission is collected on cash sales, since no money passes through Paystack.

### 4.3 Delivery is quoted before payment (SD-3)

- An out-of-zone home-delivery order is placed without payment ("Place Order — Get Delivery Quote") and waits in `delivery_quote_pending`. `initiate-shop-payment` refuses to take payment for it (409).
- The vendor's "Quote Delivery" calls `quote_shop_order_delivery(order, kobo)`. That sets `delivery_kobo` and `total_kobo` (subtotal + fulfilment + delivery − any promo discount), opens the order for payment, and notifies and emails the customer ("Pay for your order"). The amount must be more than ₦0 and at most ₦1,000,000.
- `update_shop_order_status` no longer lets a vendor skip the quote by moving the order to `pending_payment` directly.
- Still open: under the current payout model, the vendor is credited `subtotal − commission`. The quoted delivery fee, like in-zone delivery, stays with the platform. If vendors deliver themselves, they should be credited the delivery fee. That is a payout-model decision (`docs/architecture/Vendor-Payout-Model.md`).
- Orders already paid without delivery before this change are not touched.

## 5. Security implications of the fixes

- No permission is widened. `add_tracking_event` keeps its own ownership and "paid" checks and now also passes the forward-only rules of `update_shop_order_status`, closing a bypass of F-39. The acting user is still taken from the session, never from an argument.
- The checkout change sends less to the server (no discounted total, no distance when not charged). The server remains the authority on every amount.
- `quote_shop_order_delivery` is callable by signed-in users but acts only for the order's vendor, an admin or the server, and only on an unpaid order waiting for a quote. The amount is bounded and the total is recomputed on the server. `expire_unpaid_shop_orders` is server-only (service role).

## 6. Tests

- `apps/carefind/src/modules/shop/__tests__/checkoutOrder.test.js`: the order request (pickup, approved and out-of-zone delivery, never a discounted total, validation) and the error messages.
- `apps/carefind/src/test/payments/redTeam.db.test.js`, block "S-1 / S-2": each defect is shown against the live body, then the migration is applied. A tracking update advances the order with history and a notice. A same-step update records a location without a status change. Going backwards, reviving a cancelled order and a stranger's call are refused. A restock alerts each watcher once, with a link.
- `redTeam.db.test.js`, block "SD-1 / SD-3 / SD-7". It shows the old quote shortcut, then applies the migration. Then: expiry (abandoned, still paying, never sent, being settled, quote waiting, paid untouched, once only), quoting (amount, total with promo, notice, email, refusals), out-of-zone pickup vs home delivery, and status email links.
- `api/_handlers/shop-payment.engine.test.js`: payment refused while awaiting a quote; the checkout placeholder reference that Paystack never saw is closed and the real payment starts (SF-0).
- `api/_lib/__tests__/financeJobs.test.js`: the expiry step runs behind its own slot, and its failure never blocks the other steps.
- `packages/shared-email` (`carefindOrderEmails.test.js`) and `packages/shared-payments` (`effects.test.js`, `paystack.test.js`): email links, the quote email, the confirmation payload, and the Paystack not-found classification.

Manual check after deploying:
1. Place a normal order and pay. You should get the confirmation email, and its link should open the order.
2. Place a promo-code order.
3. Place an out-of-zone home-delivery order. Quote it from CareHub, then check the customer's email and pay.
4. Abandon a Paystack checkout. Within about 65 minutes the order should be cancelled and its stock back.
5. As the vendor, add a tracking update.

## 7. Deploying

1. Apply, in order, `supabase/migrations/carefind_20261020_shop_flow_fixes.sql` and `carefind_20261021_shop_expiry_and_delivery_quotes.sql`. These replace or add functions and drop the unused `cleanup_pending_shop_orders`; no data is changed.
2. Deploy CareFind and CareHub (both use the shared-payments and shared-email packages) **together with** step 1. The new checkout places out-of-zone orders without payment, and the CareHub "Quote Delivery" button calls the new function.
3. From the first cron run after deploying, existing unpaid orders past their window are cancelled and their stock returned. Expect a one-off batch (at most 200 per run).
4. Rollback: re-apply the previous bodies of `add_tracking_event`, `create_shop_order` and `update_shop_order_status` (from `carefind_20261019_red_team_fixes.sql`), `notify_stock_alerts_on_restock` (from `carehub_20260906_shop_stock_alerts.sql`) and `enqueue_shop_order_status_email` (from `carefind_20260919_shop_orders_status_email_trigger.sql`). Remove the `shop_order_expiry` step and revert the front-end commits.

## 8. Part 3: from CareFind to CareHub (the vendor's side)

The whole journey was traced from the CareFind checkout to the money reaching the vendor's CareHub wallet: order → payment → vendor notified → fulfilment → customer notified and emailed → return window → payout. It is now covered by one end-to-end database test (below). Findings:

| ID | Severity | Finding | Fix |
|----|----------|---------|-----|
| SV-1 | High | Every shop notification in CareHub went nowhere. Database functions write full links (`/dashboard/ecommerce/orders/<id>`), but the notification bell prefixed `/dashboard/` again, producing `/dashboard//dashboard/...`. That matched no route, so the vendor landed on the dashboard home. There was also no route for a single order. | The bell keeps full paths as they are (`notificationPath`). New route `/dashboard/ecommerce/orders/:orderId` opens that order's drawer; closing it returns to E-commerce. An order that is not the business's shows an error instead of loading forever. The "order paid" notice now links to the order. |
| SV-2 | Medium | The order status filter in E-commerce applied the previous choice (a stale closure through `setTimeout`). | `loadOrders` takes the status just chosen. |
| SV-3 | Medium | A pickup order at "Ready for Pickup" offered only "In Transit". The tracking panel's errors (for example a refused status change) were never shown, because its toast was never rendered. | Pickup orders finish with "Collected by Customer" (→ delivered). The panel reports through the page's toast, and offers status changes only on a paid order still in fulfilment. Order rows are keyboard-operable; sending a message reports failures. |
| SV-4 | High (defence in depth) | The order, its items, status history, payment attempts and tracking events are written only by SECURITY DEFINER functions and the service role, but clients still held table write grants. Any surviving permissive policy in production would let a vendor insert a backdated `delivered` history row (which starts the return-window clock and releases its money early), or edit the status or amounts. | Write grants on those five tables are revoked from `anon` and `authenticated`. The end-to-end test runs the whole flow after the revoke, which proves nothing depends on direct writes. |
| SV-5 | Medium | The vendor's "Generate tracking link" always failed: only the customer could create a token. The link was also built on the CareHub domain, which has no `/track` page. The token used pgcrypto's `gen_random_bytes`, which a `search_path` of `public` does not reach on Supabase. | The order's vendor may create the token. It now comes from `gen_random_uuid()` (128-bit, core Postgres). The link uses the CareFind origin (`VITE_CAREFIND_URL`, default `https://carefind.app`). |
| SV-6 | High (privacy) | `shop_tracking_tokens` was readable by `anon` with `USING (true)`. The public anon key alone listed every token, and each token opens that order's tracking page: status, vendor notes and recorded GPS locations. | Policies dropped and table grants revoked from clients. Tokens are created and read only through `generate_tracking_token` and `get_tracking_by_token`. |

Verified sound along the way:
- Vendors read their orders, items and history under RLS.
- Status changes are forward-only and need a paid order.
- Settlement credits `subtotal − commission` into `held_balance` exactly once, even when the redirect verify and the webhook both arrive.
- The credit is released to `available_balance` only after the return window, counted from the first delivery.
- The CareHub wallet shows held and available balances and labels `shop_credit` / `shop_release`.

Still open (not changed here):
- The vendor tracking-events read policy matches business owners only (`owner_id = auth.uid()`). Non-owner staff see an empty tracking history.
- The "order paid" notice goes to the owner only.

Security implications: nothing is widened except `generate_tracking_token`, which now also serves the order's own vendor (who already sees everything the public page shows). Everything else removes access. Migration: `supabase/migrations/carefind_20261022_shop_vendor_flow.sql`; it checks its own grants and fails if a client can still write those tables or read tokens.

Tests:
- `redTeam.db.test.js`, block "SV". BEFORE: the vendor cannot create a link; anon lists tokens. Then the whole journey on real migrations: checkout, refused unpaid fulfilment, settlement and idempotent re-settlement, vendor fulfilment, notification links on both sides, status email, release only after the window, wallet available. Also direct-write attacks by vendor and customer, vendor tracking and the public link, and token listing refused.
- CareHub `modules/ecommerce/__tests__/Ecommerce.test.jsx`: deep link opens and closes the order, unknown order, the status filter, pickup vs home buttons. All five fail on the previous code.
- CareHub `NotificationBell.test.jsx` (a shop notification opens its order) and `lib/notificationCategories.test.js` (`notificationPath`).
- `packages/shared-payments`: the paid notice links to the order.

Deploying: apply `carefind_20261022_shop_vendor_flow.sql` after the part 1 and 2 migrations, then deploy CareHub (the new route, bell and tracking link). The migration does not depend on the app deploy, and the app changes work before it, except the vendor tracking link.

Manual check: pay for an order, then open the vendor's "order paid" notification in CareHub; it should open that order. Move a pickup order to "Collected by Customer". For a home delivery, generate the tracking link and open it in a private window.
