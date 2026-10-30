# Inventory: stock writes that no longer erase sales, and a safe duplicate merge

2026-10-30. Client changes plus one applied database function
(`supabase/migrations/carehub_20261220_merge_duplicate_products.sql`).

## Why

Inventory's product list is loaded once and goes stale as POS sells. Several paths wrote `products.stock` back as an absolute value computed from that list, so every sale made since the list loaded was erased:

| Path | What it did | Now |
|---|---|---|
| Edit product | Always sent the form's stock, so changing only a price reset stock to the page load figure | Stock is sent only when the user changed it (a deliberate count correction) |
| "Update Existing Product" (Add Product with a name that exists) | Wrote `existing.stock + incoming.stock`, and changed prices for any role | Adds the units with `increment_product_stock`; prices change only with `canEditPrice` |
| Clean up duplicates | Wrote the keeper's stock as the sum of the group's stale counts, then bulk deleted the rest | `merge_duplicate_products`, below |

**+ Stock** already incremented atomically on main. It now also: is shown only with `canEditStock` (as Add Product and the Edit form's stock field already were); is disabled while saving, because each press is a real increment and a double tap added twice; rejects decimals instead of truncating 2.5 to 2; stays open with the typed value when the save fails; reports the database's new stock level. Its "Note" field was never stored anywhere and was replaced by a pointer to Purchases.

The bulk delete in the duplicate cleanup was worse than the stale total. `ON DELETE CASCADE` silently removed the duplicate's product reviews, shop listing and stock count history, and a duplicate with stock batches, LPO lines or shop order lines (foreign keys without cascade) made the delete fail after the keeper's summed stock had already been written: stock counted twice and the duplicates left in place.

## The merge function

`merge_duplicate_products(p_business_id, p_keeper_id, p_duplicate_ids)`, one transaction per group:

1. Authorises the business owner (`is_business_owner`), or active staff whose custom role grants `canDelete`, the rule the app uses to show the button.
2. Locks the keeper and duplicates in id order; all must belong to the business.
3. Moves each duplicate's **current** stock (read under the lock) into the keeper through `apply_stock_change`, as two journalled `correction` movements per duplicate, so the stock ledger's rules apply. Positive stocks move first; a group whose total would be below zero is refused by the ledger and nothing in it changes (636 products live have negative stock from before the floor existed).
4. Repoints every reference to the keeper: stock batches, LPO lines, shop order lines, shop listing, out of stock requests, stock count items, transfer lines, reviews.
5. Deletes the duplicates.

Refused, with a reason shown per group (other groups still merge): a shop listing on more than one product in the group (listings carry orders and shopper alerts, so the owner chooses); batch tracked products (none live today); a service grouped with a stocked product. Reviews: a customer who reviewed two of the products keeps the most recent review (one review per customer per product). The ledger rows of a deleted duplicate stay under its id (append only); historical `sales.items` keep the ids they were sold under.

The dialog now names the product each group keeps and marks it "Kept"; the button is shown only with `canDelete`.

## Security

- `SECURITY DEFINER`, pinned `search_path = public, pg_temp`, EXECUTE for `authenticated` only (revoked from PUBLIC and anon). Definer is required: under `SECURITY INVOKER` the owner cannot UPDATE a customer's review or a shop order line, the repoint would match nothing, and the delete's cascade would remove them, the data loss being fixed. Authorisation is therefore explicit and every statement is scoped to `p_business_id`. `auth.uid()`/`auth.email()` still identify the caller, so ledger rows record who merged.
- Advisors after applying: exactly one new finding, `authenticated_security_definer_function_executable` for this function, which is the intended design. No anon or search path finding.
- `productRepository.deleteBulk` had no callers left and was removed.

## Verification

- Scratch Postgres 16 with production's ledger, authorisation and guard functions copied verbatim, RLS on every table: 36 checks (stale sale preserved, ledger rows and actor, every repoint, review rule, cross tenant owner refused, Manager refused, custom role allowed, deactivated staff refused, smuggled foreign product refused, negative totals refused and rolled back, listing conflict, batch tracked, services, retry, grants). Three mutations each caught (invoker instead of definer, ordering, custom role branch).
- Production, inside a `DO` block that raised at the end so everything rolled back, on a test business: another business's owner refused; the owner's merge gave 15 from current stock (stale total 18), four ledger rows, batch and out of stock request repointed; anon cannot execute. Zero residue afterwards. Then applied as `carehub_20261220_merge_duplicate_products` (version 20261030090338); live body md5 matches the file.
- Client: `apps/carehub/src/modules/inventory/Inventory.stock.test.jsx` (12 tests) and `repositories/index.test.js`; mutation checked. Real Chromium run of the cleanup dialog and merge.
