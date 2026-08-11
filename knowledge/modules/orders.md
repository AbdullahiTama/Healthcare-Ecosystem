# Orders — Business Domain

## Purpose
LPO (Local Purchase Order) submission, approval, and dispatch workflow for the manufacturer/wholesale vertical — a field rep submits an order, a tagged approver approves it, the warehouse processes and dispatches it, with notifications fired at each transition.

## Files
`apps/carehub/src/pages/dashboard/Orders.jsx` (the entire module).

## Components
Single default-exported component; no `TopBar` (same inconsistency as the other enterprise routes).

## Services
`lib/supabase.js`: `getOrders`, `getOrderById`, `getOrderItems`, `getOrderWatchers`, `getOrderFiles`, `getOrderEvents`, `addOrderEvent`, `uploadOrderFile`, `createOrder` (up to four sequential inserts — order, items, watchers, files — plus a notification to the approver, with no transaction wrapping the sequence), `advanceOrder` (status transition plus a notification to the rep and watchers).

## Dependencies
`getStaff` (approver/watcher pickers), `getProducts` (Inventory domain, for order line items), `getTerritories` and `getEnterpriseLocations` (for scoping), Storage bucket `order-files`, Notifications domain (both `createOrder` and `advanceOrder` fire notifications internally).

## Database Tables
`orders`, `order_items`, `order_watchers`, `order_files`, `order_events`, Storage bucket `order-files` (public, same posture as `message-files`).

## Current State
The full submit → approve → dispatch → deliver workflow is implemented, including a per-order event log and CC'd watchers. `createOrder`'s multi-table write sequence has no transaction — a failure partway through (e.g., after the order row is created but before items are attached) leaves a partial, inconsistent order record with no automatic rollback or retry.

## Missing Documentation
No document specifies what should happen operationally if `createOrder`'s multi-step sequence fails partway through — there is no documented recovery procedure for a partially-created order, and this entry's description of that risk is inferred from reading the code's lack of transaction handling, not from any stated design decision.
