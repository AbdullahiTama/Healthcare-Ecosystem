# The stock ledger (live, not yet in the repository)

Captured 2026-10-30.

## The gap

Production's `supabase_migrations.schema_migrations` records `carehub_20261140_inventory_integrity_foundation` (applied 2026-10-21, with a `20261140b` constraint validation). No file for it exists in `supabase/migrations/` or on any branch of this repository. It created the stock ledger that every stock write is meant to go through, so code was being written against a model the repository could not show. `docs/architecture/stock-ledger-live-snapshot.sql` records the live definitions; it is a snapshot, not a migration, and must not be run. The original migration should be recovered from whoever applied it and committed in its place.

## What is live

- `apply_stock_change(business, product, delta, movement_type, batch, source..., idempotency_key, actor)`: "the single stock writing function". Locks the product (and batch), refuses negative stock, keeps `products.stock` equal to the sum of batches for tracked products, journals one `stock_movements` row with before and after quantities and the caller, idempotent on its key. `SECURITY INVOKER`.
- `stock_movements` is append only (`guard_stock_movement_append_only`); `movement_type` is one of opening, purchase_receipt, sale, sale_reversal, return_restock, return_writeoff, adjustment, write_off, transfer, tracking_change, correction.
- `products.tracking_mode` (`none`, `batch_only`, `batch_expiry`), changed only through `set_product_tracking_mode`. Floors on `products.stock` and `stock_batches.quantity` refuse new negatives. New products journal their opening stock.

At capture: all 11,351 products have `tracking_mode = 'none'`; 636 have negative stock from before the floor; no tracked product disagrees with its batches.

## Known bypass (follow up)

`increment_product_stock` (C12) predates the ledger and writes `products.stock` directly. Purchases and Inventory's + Stock and "Update Existing Product" use it, so those additions leave no `stock_movements` row, and on a batch tracked product they would make stock disagree with its batches. Harmless while nothing is tracked, but the ledger is incomplete. The fix is to move those callers to `apply_stock_change` with `purchase_receipt` or `adjustment`. `merge_duplicate_products` already uses the ledger.
