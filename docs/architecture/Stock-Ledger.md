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

At first capture the ledger held 3,343 rows, every one an `opening` movement written by the product-creation trigger. Nothing else journalled. The table below is the state after the changes listed in it.

| Writer | Path | Ledger? |
|---|---|---|
| Purchases | `receive_stock` (`purchase_receipt`, one movement per line, key `purchase:<purchase id>:<line id>`, batch created in the same transaction) | Yes, since `carehub_20261223_receive_stock` |
| Inventory + Stock | `receive_stock` (`adjustment`, key fixed per restock dialog, batch and expiry required for tracked products) | Yes, same migration |
| Inventory "Update Existing Product" | `receive_stock` (`adjustment`, key fixed per warning) | Yes, same migration |
| Clean up duplicates | `merge_duplicate_products` (two `correction` movements per duplicate) | Yes, `carehub_20261220` |
| New product with stock | `journal_opening_stock` trigger (`opening`) | Yes |
| POS sales | `apply_sale_ledger` trigger → `sale_take_stock` (`sale`, one movement per product and batch, key `sale:<sale id>:<product>:<batch or ->`) | Yes, since `carehub_20261224_sale_stock_ledger` |
| Sale edits and deletes (Owner, Financial Reports) | `edit_sale` / `delete_sale` → `sale_apply_stock_delta` (`sale_reversal` for units given back, `sale` for extra units) | Yes, same migration |
| Shop orders and cancellations | `create_shop_order`, `cleanup_pending_shop_orders`, `shop_restore_inventory_on_cancel` | **No** |
| Stock counts | `save_stock_validation_session` | **No** |
| Branch transfers | `send_stock_transfer` / `receive_stock_transfer` | **No** (checked by source; verify before relying on it) |

Each movement records the locked row's real before and after quantities, so rows stay correct individually. Consecutive rows for a product chain (one row's `qty_after` is the next row's `qty_before`) only while every writer journals; shop orders, stock counts and transfers still do not, so a product touched by one of them has a gap at that point. Those three are the remaining steps.

## POS sales on the ledger (2026-10-30)

`carehub_20261224_sale_stock_ledger` (applied live as version 20261030135055; cutover **2026-10-30 13:50:55.58739 UTC**) plus `carehub_20261224b_pin_cutover_search_path`. Tests: `scripts/db-tests/salesLedger.pglite.mjs` (24 checks) and `salesCorrections.pglite.mjs` (66 checks), both against the live stock schema, movement-type CHECK and ledger snapshot.

What replaced what:

- One `AFTER INSERT` trigger, `sale_stock_ledger` → `apply_sale_ledger()`, replaces `sale_stock_movement` and `sale_batch_movement`. Held sales still move nothing (the real charge inserts a new row). Lines are taken in product order so concurrent sales lock in the same order.
- `sale_take_stock` / `sale_return_stock` are the only places a sale takes or puts back units, both through `apply_stock_change`, so product and batch move together in one row that names the cashier and the sale.
- `sale_apply_stock_delta` keeps its signature and callers, matches old and new lines on product **and** batch, and journals `sale_reversal` / `sale`. The old version wrote `sale_correction`, which the movement-type CHECK refuses, so any edit or delete of a sale with a batch line would have failed (none had happened).

Behaviour that changed, on purpose:

| Before | Now |
|---|---|
| Selling 5 with 2 on hand set stock to 0 and recorded nothing | Takes the 2, journals them, and the row's reason says `short by 3`; the sale is kept |
| A sale raised a negative stock to 0 | A negative stock is left as it is (636 products live) |
| A batch line moved the batch and the product in two triggers, journalling a row with no product | One row, product and batch together |
| Edit or delete gave back the line quantity | Gives back what the ledger recorded for that sale, never more, to the batches it came from (a sale that took 2 of 5 gives back 2) |

Sales created before the cutover with no ledger rows keep the old rule on edit or delete (the line quantity goes back), because their stock was taken by the old trigger without a record.

"A sale is never lost": neither helper raises. If the ledger refuses for an unexpected reason (a tracked product whose batches disagree with its stock), the change falls back to the old direct write and logs a `WARNING` in the Postgres logs, so a sale never leaves stock overstated. A sale with no ledger rows after the cutover therefore points at a fallback worth investigating.

Verified live: a rolled-back probe through the real `edit_sale` / `delete_sale` paths (oversell, held sale, edit, delete); after applying, the function bodies match the repository, every sale since the cutover has ledger rows with the cashier, product stock equals the last `qty_after`, and the security advisor findings are unchanged.

Security: `apply_sale_ledger` and `sale_apply_stock_delta` are `SECURITY DEFINER` with a pinned `search_path`; every statement is scoped to the sale's `business_id`, which the sales RLS `WITH CHECK` (own business or platform admin) already authorised. The helpers, the trigger function, the cutover function and the delta are revoked from `PUBLIC`, `anon` and `authenticated`, so nobody can journal a "sale" without inserting a sale.

Rollback: re-attach the old triggers, which are left in place, unattached and commented `SUPERSEDED`:

```sql
DROP TRIGGER sale_stock_ledger ON public.sales;
CREATE TRIGGER sale_stock_movement AFTER INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION apply_sale_stock_movement();
CREATE TRIGGER sale_batch_movement AFTER INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION apply_sale_batch_movement();
```

and restore `sale_apply_stock_delta` from `carehub_20261216_sales_owner_corrections`. Once this has run cleanly for a while, drop `apply_sale_stock_movement` and `apply_sale_batch_movement`.

`receive_stock` replays an already journalled idempotency key (backed by `stock_movements_idem_uniq`), so a retry after a lost reply or a second tap never adds twice. It is `SECURITY INVOKER`: the boundary is RLS, which on products and stock is "own business, or a platform admin". Platform admins can therefore receive stock into any business, exactly as they could already PATCH `products.stock` (verified live: a non-admin owner of another business is refused; a platform admin is not).

`increment_product_stock` is marked deprecated in production and no longer called by the client. It stays only until the client with this change is deployed everywhere; then drop it.
