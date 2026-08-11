# Purchases — Business Domain

## Purpose
Records supplier deliveries — supplier name, product/item description, quantity, cost, payment status — and automatically creates a "we owe" Debts entry when a purchase is underpaid.

## Files
`apps/carehub/src/pages/dashboard/Purchases.jsx` (the entire module), `pages/dashboard/Reports.jsx` (read-only consumer), `pages/dashboard/Debts.jsx` (downstream, via auto-created rows).

## Components
Single default-exported component, list + add-modal + "Mark Paid" action, no sub-file decomposition.

## Services
`lib/supabase.js`: `getPurchases`, `addPurchase`, `updatePurchase`, plus calls into `addDebt`/`updateDebt`/`getDebts` (Debts domain) for auto-creation and "Mark Paid" reconciliation.

## Dependencies
`lib/utils.js` (`fmt`, `todayDate`). No dependency on the Inventory domain despite recording what are, in substance, stock deliveries.

## Database Tables
`purchases` (`id, business_id, supplier_name, product_name, quantity, cost_price, total_cost, amount_paid, balance, supply_date, due_date, status, notes`). `product_name` is free text — **there is no `product_id` foreign key to `products`**.

## Current State
Recording a purchase, tracking payment status, and marking paid (which also reconciles the matching Debts row) are all implemented and functional as a supplier-payment ledger. **Recording a purchase has no effect on Inventory** — because `product_name` is free text with no link to a `products` row, and `Purchases.jsx` never calls `updateProduct()`, receiving stock through this domain does not update the corresponding catalog item's `stock` count. A business must separately use Inventory's manual "+Stock" action, with no system-level guarantee the two records describe the same delivery.

## Missing Documentation
No document explains why Purchases was not given a `product_id` reference when the domain conceptually represents receiving inventory — whether this was a deliberate simplification (purchases as a pure financial ledger, unconcerned with stock) or an unbuilt integration is not recorded anywhere.
