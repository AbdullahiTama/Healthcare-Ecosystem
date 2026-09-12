---
title: 'Shop Cart, Checkout, Orders and Inventory Sync'
type: 'feature'
created: '2026-08-30'
status: 'done'
baseline_commit: '504241e'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Shop browse (Goal 2) and pricing engine (Goal 4) are complete, but customers cannot add products to cart, checkout, or place orders. Vendors cannot receive or manage orders. Inventory is not synced with Shop sales, so overselling is possible.

**Approach:** Build cart (add/remove/update, localStorage + React context), checkout flow (address, delivery preference, fee calculation via pricing engine, payment integration), order creation (with price snapshots, status tracking, atomic inventory decrement via row-lock), vendor notifications (in-app + email), and order management (status updates, communication timeline). All atomic, idempotent, and auditable.

## Boundaries & Constraints

**Always:** Cart state in localStorage (persist across sessions) + React context (reactive UI). Checkout uses pricing engine (Goal 4) for fee calculation. Order creation is atomic: decrement inventory + create order + notify vendor in single transaction (row-locked). Price snapshot at order time (never changes later). Idempotent payment callbacks (no duplicate orders). Status machine: pending_payment → paid → accepted → processing → ready_for_pickup → delivered / cancelled. All writes verify ownership (customer sees own orders, vendor sees own orders). Loading/error/empty/responsive/a11y on every screen.

**Ask First:** Payment gateway integration (Paystack already exists in CareFind — reuse?). Email notification service (existing CareFind email service or new?). Order communication timeline (in-app only or also email/SMS?).

**Never:** Don't allow checkout with out-of-stock products (re-check at checkout). Don't create order without payment verification. Don't decrement inventory without order creation (atomic). Don't expose other customers' orders. Don't allow vendor to access another vendor's orders.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Add to cart | productId, quantity | Cart updated, localStorage persisted, badge count updated | 400 if product not found or out of stock |
| Remove from cart | productId | Cart updated, localStorage persisted | No error if product not in cart |
| Update quantity | productId, quantity | Cart updated, stock re-checked | 400 if quantity > stock |
| Checkout start | Cart items | Address form, delivery preference, fee summary | Empty cart → redirect to Shop |
| Calculate fees | Cart total, segment, distance | Commission, fulfilment, delivery, total | Throw if invalid inputs |
| Place order | Address, delivery pref, payment | Order created (pending_payment), inventory reserved | 409 if stock insufficient |
| Payment success | Payment reference | Order status → paid, vendor notified | Idempotent (no duplicate orders) |
| Payment failure | Payment error | Order status remains pending_payment, customer notified | Retry or cancel |
| Vendor accepts order | orderId | Order status → accepted, customer notified | 403 if not vendor's order |
| Vendor marks ready | orderId | Order status → ready_for_pickup, customer notified | 403 if not vendor's order |
| Customer cancels | orderId | Order status → cancelled, inventory restored | 400 if already delivered/processing |
| Order detail | orderId | Order items, status, timeline, communication | 404 if not found or not owner |
| Inventory sync | Order created | products.stock decremented atomically | 409 if insufficient stock |
| Concurrent checkout | Two customers, same product | Only one succeeds, other gets 409 | Row-lock on products.stock |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/modules/shop/Cart.jsx` -- Cart page: list items, update quantity, remove, checkout button. Uses cartRepository for state.
- `apps/carefind/src/modules/shop/Checkout.jsx` -- Checkout flow: address form, delivery preference, fee summary (pricing engine), payment button. Creates order via orderRepository.
- `apps/carefind/src/modules/shop/OrderDetail.jsx` -- Order detail page: items, status, timeline, communication. Customer and vendor views.
- `apps/carefind/src/modules/shop/OrderList.jsx` -- Order list page: customer sees own orders, vendor sees own orders. Filter by status.
- `apps/carefind/src/modules/shop/cartRepository.js` -- Cart state: localStorage + React context. add/remove/update/getAll/clear.
- `apps/carefind/src/modules/shop/orderRepository.js` -- Order CRUD: create (atomic inventory decrement), getById, getByCustomer, getByVendor, updateStatus.
- `apps/carehub/sql/20260830_shop_orders.sql` -- Migration: orders, order_items, order_status_history, order_messages. RLS for customer/vendor isolation. Atomic inventory decrement RPC.
- `apps/carefind/src/modules/shop/pricing.js:1` -- Already built (Goal 4), checkout imports for fee calculation.
- `apps/carefind/src/modules/shop/shopRepository.js:1` -- Already built (Goal 2), checkout imports for product detail.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/carehub/sql/20260830_shop_orders.sql` -- Migration: orders (id, customer_id, vendor_id, status, total_kobo, commission_kobo, fulfilment_kobo, delivery_kobo, delivery_address, delivery_preference, payment_reference, created_at, updated_at), order_items (id, order_id, ecommerce_product_id, product_name, quantity, unit_price_kobo), order_status_history (id, order_id, status, changed_at, changed_by), order_messages (id, order_id, sender_id, message, created_at). RLS: customer sees own orders, vendor sees own orders. Atomic RPC `create_order_with_inventory_decrement` (row-lock products.stock, create order + items, decrement stock, return order_id).
- [ ] `apps/carefind/src/modules/shop/cartRepository.js` -- Cart state: localStorage (persist) + React context (reactive). `add(productId, quantity)`, `remove(productId)`, `updateQuantity(productId, quantity)`, `getAll()`, `clear()`, `getCount()`. Validates stock before add/update.
- [ ] `apps/carefind/src/modules/shop/orderRepository.js` -- Order CRUD: `create({cart, address, deliveryPreference, paymentReference})` (calls atomic RPC), `getById(orderId)`, `getByCustomer(customerId)`, `getByVendor(vendorId)`, `updateStatus(orderId, status)`. All tenant-scoped.
- [ ] `apps/carefind/src/modules/shop/Cart.jsx` -- Cart page: list items (image, name, price, quantity +/-, remove), subtotal, checkout button. Empty state. Uses cartRepository.
- [ ] `apps/carefind/src/modules/shop/Checkout.jsx` -- Checkout flow: address form (street, city, state), delivery preference (pickup/home), fee summary (pricing engine: commission + fulfilment + delivery), total, payment button (Paystack integration). Creates order via orderRepository.
- [ ] `apps/carefind/src/modules/shop/OrderDetail.jsx` -- Order detail: items list, status badge, timeline (status history), communication (messages). Customer view: status, cancel button (if pending). Vendor view: accept/mark ready buttons.
- [ ] `apps/carefind/src/modules/shop/OrderList.jsx` -- Order list: customer sees own orders, vendor sees own orders. Filter by status. Link to OrderDetail.
- [ ] `apps/carefind/src/modules/shop/CartProvider.jsx` -- React context provider for cart state. Wraps app, provides add/remove/update/getAll/clear/getCount.
- [ ] `apps/carefind/src/main.jsx` -- Register routes: `/cart`, `/checkout`, `/orders`, `/orders/:id`. Import CartProvider, wrap app.

**Acceptance Criteria:**
- Given customer adds product to cart, when viewed then cart shows item with quantity, price, subtotal; localStorage persists across sessions
- Given customer updates quantity, when quantity > stock then error shown, cart not updated
- Given customer proceeds to checkout, when cart empty then redirect to Shop with message
- Given customer enters address and delivery preference, when checkout then fee summary shows commission (vendor), fulfilment (customer), delivery (customer if home), total
- Given customer completes payment, when payment verified then order created (pending_payment → paid), inventory decremented atomically, vendor notified
- Given vendor receives order notification, when vendor accepts then order status → accepted, customer notified
- Given vendor marks ready, when ready then order status → ready_for_pickup, customer notified
- Given customer cancels order, when order is pending_payment then order status → cancelled, inventory restored
- Given two customers checkout same product concurrently, when both submit then only one succeeds, other gets 409 (stock insufficient)
- Given order created, when viewed then price snapshot preserved (never changes even if product price changes later)
- Given payment callback received twice, when idempotent then only one order created (no duplicates)
- Given customer views orders, when list then only own orders shown (RLS isolation)
- Given vendor views orders, when list then only own orders shown (RLS isolation)

## Spec Change Log


## Design Notes

Cart state: localStorage (persist across sessions) + React context (reactive UI). Checkout uses pricing engine (Goal 4) for fee calculation. Order creation is atomic: RPC `create_order_with_inventory_decrement` row-locks products.stock, creates order + items, decrements stock, returns order_id — all in single transaction. Price snapshot: order_items.unit_price_kobo is the price at order time, never changes. Status machine: pending_payment → paid → accepted → processing → ready_for_pickup → delivered / cancelled. Vendor notifications: in-app (staff_notifications table) + email (existing CareFind email service). Customer notifications: in-app (notifications table) + email.

## Verification

**Commands:**
- `npx vitest run src/modules/shop/cartRepository.test.js --reporter=verbose` -- expected: cart add/remove/update tests pass
- `npx vitest run src/modules/shop/orderRepository.test.js --reporter=verbose` -- expected: order create/get/update tests pass
- `npx vite build --workspace=apps/carefind` -- expected: clean, cart/checkout/orders routes resolve

**Manual checks:**
- Add product to cart → cart badge updates, localStorage persists
- Checkout → address form, fee summary, payment → order created, inventory decremented
- Vendor receives notification → accepts → customer notified
- Customer views orders → only own orders shown
- Concurrent checkout → only one succeeds
