# Point of Sale (POS) — Business Domain

## Purpose
The checkout/sales-transaction domain for every CareHub business type — cart building, discount application, split/credit payment handling, receipt generation, held sales, and same-day sales history. The primary revenue-recording surface of the product.

## Files
`apps/carehub/src/pages/dashboard/POS.jsx` (the module), `pages/dashboard/BusinessDashboard.jsx` (owns the shared `products` state POS reads from), `pages/dashboard/DashboardHome.jsx`/`Locations.jsx`/`Reports.jsx` (read-only consumers of sales totals).

## Components
Single large default-exported `POS` component with internal `view` state switching between `pos`/`held`/`recent`/`credit` sub-views, all in one file — no sub-component extraction. Shared primitives: `Card`, `Modal`, `Pill`, `GhostBtn`, `TealBtn`, `DarkBtn`, `Inp`, `Sel`, `Avatar`, `Toast`.

## Services
`lib/supabase.js`: `addSale`, `updateSale`, `getSales`, `getTodaySales`, `getSettings` (read-only), plus `queueOfflineSale`/`getOfflineQueue` (the offline-cache domain) and `addDebt`/`updateDebt` (cross-call into the Debts domain for auto-created credit-sale debts).

## Dependencies
`lib/utils.js` (`fmt`, `genId`, formatting), `components/ui/index.jsx`. Reads the `products` array as a prop from `BusinessDashboard.jsx` (Inventory domain) to build the sale screen — this is the domain's primary cross-domain dependency.

## Database Tables
`sales` (`id, business_id, txn_no, client_name, items` — a JSON-stringified blob of line items, not normalized rows — `subtotal, discount, total, payment_method, payment_split, amount_paid, balance, is_credit, is_on_hold, created_at`). Also writes to `debts` when a sale is underpaid.

## Current State
Cart, discount, split-payment, hold, and credit flows are all implemented and functional as a checkout experience, including an offline queue that stores a sale locally and replays it once connectivity returns. **The one critical gap**: on checkout, `products.stock` is decremented only in local React component state (`setProducts(prev => ...)`) — `updateProduct()` is never called, so the sale's effect on inventory is never persisted to the database (see `inventory.md`). Every underpaid or credit sale automatically creates a `debts` row via logic duplicated independently from `purchases.md`'s equivalent reconciliation code.

## Coming back to an idle counter (2026-10-30)
POS and the dashboard home refresh in place when staff return after 5+ minutes away (tab hidden, device asleep) or the connection comes back — they never reload (`lib/resume.js`, `providers/RefreshProvider.jsx`). The session is renewed first, then the shell refetches products and replays the offline queue while POS refetches sales (held, credit, recent), clients and receipt settings. **The cart, payment fields and a resumed held sale are never touched**, and lists keep showing their earlier data until the new data arrives; a small pill says "Updating…", "Updated just now", or "Couldn't update" with Retry.

Because the offline queue now replays on resume and reconnect as well as on mount and the Sync button, `saleRepository.syncQueued` is single-flight (overlapping calls join the run in progress — `sales` has no unique key on `txn_no`, so two runs would record each sale twice) and removes the sales it sent from the queue as it stands afterwards, so a sale parked during a sync is kept.

## Missing Documentation
No document specifies the intended contract between POS and Inventory regarding stock — nothing states whether POS was ever meant to write back to `products.stock` directly, or whether a separate reconciliation process (not found anywhere in the codebase) was intended to own that. No document describes the `items` JSON blob's schema, which every report/reconciliation feature that might need line-item detail would have to reverse-engineer from `POS.jsx`'s cart-building code, as this entry did.
