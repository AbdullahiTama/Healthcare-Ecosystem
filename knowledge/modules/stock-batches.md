# Stock & Batches — Business Domain

## Purpose
A batch- and expiry-aware stock-tracking system for the manufacturer/wholesale vertical, with a full audit trail of every stock movement (receipt, transfer, adjustment). This is the properly-audited counterpart to the simple `products.stock` integer used by the generic Inventory domain — the two systems are entirely separate and do not intersect.

## Files
`apps/carehub/src/pages/dashboard/Stock.jsx` (the entire module).

## Components
Single default-exported component; no `TopBar` (same inconsistency as the other enterprise routes).

## Services
`lib/supabase.js`: `getStockBatches`, `addStockBatch`, `updateStockBatch`, `deleteStockBatch`, `getStockMovements` (the only enterprise list query with a `limit` — 100 rows), `addStockMovement`, `transferStock`, `adjustStock` — the latter two compute quantity diffs and write a corresponding audit-trail movement row as part of the same operation.

## Dependencies
`getEnterpriseLocations` (Warehouses domain, for the location picker), `getProducts` (Inventory domain, read-only).

## Database Tables
`stock_batches` (`id, business_id, location_id, product_id, product_name, batch_number, quantity, expiry_date, date_received, supplier_source, storage_location, status, received_by`), `stock_movements` (`id, business_id, batch_id, from_location_id, to_location_id, movement_type, quantity, reason, moved_by, created_at`).

## Current State
Batch receiving, transfer, and adjustment are all implemented with a genuine audit trail — the one domain in the entire codebase with a real stock-movement history. Entirely disconnected from the generic Inventory domain's `products.stock` field, despite both nominally tracking "how much of this product do we have."

## Missing Documentation
No document explains why this domain and the generic Inventory domain maintain two entirely separate stock models rather than one shared system parameterized by business type — nothing states whether this was a deliberate architectural choice (enterprise businesses genuinely need batch/expiry tracking retail businesses don't) or two independently-built systems that were never reconciled.
