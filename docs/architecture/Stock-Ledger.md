# The stock ledger (live, not yet in the repository)

Captured 2026-10-30.

## The gap

Production's `supabase_migrations.schema_migrations` records `carehub_20261140_inventory_integrity_foundation` (applied 2026-10-21, with a `20261140b` constraint validation). No file for it exists in `supabase/migrations/` or on any branch of this repository. It created the stock ledger that every stock write is meant to go through, so code was being written against a model the repository could not show. `docs/architecture/stock-ledger-live-snapshot.sql` records the live definitions; it is a snapshot, not a migration, and must not be run. The original migration should be recovered from whoever applied it and committed in its place.

## What is live

- `apply_stock_change(business, product, delta, movement_type, batch, source..., idempotency_key, actor)`: "the single stock writing function". Locks the product (and batch), refuses negative stock, keeps `products.stock` equal to the sum of batches for tracked products, journals one `stock_movements` row with before and after quantities and the caller, idempotent on its key. `SECURITY INVOKER`.
- `stock_movements` is append only (`guard_stock_movement_append_only`); `movement_type` is one of opening, purchase_receipt, sale, sale_reversal, return_restock, return_writeoff, adjustment, write_off, transfer, tracking_change, correction.
- `products.tracking_mode` (`none`, `batch_only`, `batch_expiry`), changed only through `set_product_tracking_mode`. Floors on `products.stock` and `stock_batches.quantity` refuse new negatives. New products journal their opening stock.

At capture: all 11,351 products have `tracking_mode = 'none'`; 636 have negative stock from before the floor; no tracked product disagrees with its batches.

## Who writes to it (2026-10-30)

At capture the ledger held 3,343 rows, every one an `opening` movement written by the product-creation trigger. Nothing else journalled.

| Writer | Path | Ledger? |
|---|---|---|
| Purchases | `receive_stock` (`purchase_receipt`, one movement per line, key `purchase:<purchase id>:<line id>`, batch created in the same transaction) | Yes, since `carehub_20261223_receive_stock` |
| Inventory + Stock | `receive_stock` (`adjustment`, key fixed per restock dialog, batch and expiry required for tracked products) | Yes, same migration |
| Inventory "Update Existing Product" | `receive_stock` (`adjustment`, key fixed per warning) | Yes, same migration |
| Clean up duplicates | `merge_duplicate_products` (two `correction` movements per duplicate) | Yes, `carehub_20261220` |
| New product with stock | `journal_opening_stock` trigger (`opening`) | Yes |
| POS sales, sale edits and deletes | `apply_sale_stock_movement`, `sale_apply_stock_delta` | **No**: write `products.stock` directly |
| Shop orders and cancellations | `create_shop_order`, `cleanup_pending_shop_orders`, `shop_restore_inventory_on_cancel` | **No** |
| Stock counts | `save_stock_validation_session` | **No** |
| Branch transfers | `send_stock_transfer` / `receive_stock_transfer` | **No** (checked by source; verify before relying on it) |

Each movement records the locked row's real before and after quantities, so rows stay correct individually; but because sales do not journal yet, consecutive rows for a product do not chain (one row's `qty_after` is not the next row's `qty_before`). Moving the sale trigger onto `apply_stock_change` is the next and largest step; it must keep the trigger's "never lose a sale" rule.

`receive_stock` replays an already journalled idempotency key (backed by `stock_movements_idem_uniq`), so a retry after a lost reply or a second tap never adds twice. It is `SECURITY INVOKER`: the boundary is RLS, which on products and stock is "own business, or a platform admin". Platform admins can therefore receive stock into any business, exactly as they could already PATCH `products.stock` (verified live: a non-admin owner of another business is refused; a platform admin is not).

`increment_product_stock` is marked deprecated in production and no longer called by the client. It stays only until the client with this change is deployed everywhere; then drop it.
