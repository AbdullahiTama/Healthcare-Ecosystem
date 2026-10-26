# Inventory with large catalogs

Status: implemented and tested (October 2026). No database or permission change.

## Why

A pharmacy with 3,193 products reported slow pages and data that "doesn't load well". The server was healthy (no 5xx, no slow queries). The cost was in the browser:

| Problem | Effect at ~3,000 products |
|---|---|
| Every add, edit, delete, restock, CareFind toggle, import and duplicate cleanup called `reload()`, which downloaded the whole catalog **twice** (`productRepository.getAll` and the dashboard's `loadProducts`) | 8 requests of up to 1,000 rows (~3 MB of JSON) per click, plus a ~3 MB `localStorage` write |
| CSV import and its preview checked each row with `findDuplicate`, a regex scan of the whole catalog | O(rows × catalog): 2,000 rows × 3,000 products = 6 million normalisations, done 3 times per render of the preview |
| `findAllDuplicateGroups` and the category list ran on every render | a full catalog pass on every keystroke in the search box |
| Restock read the stock shown on screen, added to it and wrote the total back | a sale on a till at the same moment was overwritten (lost update) |

## What changed

* **Saves update the list in place.** `productRepository.update` now returns the saved row (`return=representation`). `Inventory.jsx` applies what the server returned with the pure helpers in `modules/inventory/productListState.js` (`upsertProducts`, `removeProducts`); nothing re-downloads the catalog after a save. Bulk import applies all created rows once at the end; cleanup applies each batch as it finishes, so a failure half way still leaves the list accurate.
* **Restock is atomic.** It calls `productRepository.incrementStock` (the `increment_product_stock` RPC, `stock = stock + qty` in the database) and shows the stock the database returns. Zero or negative quantities are refused before any request.
* **Duplicate checks are O(1).** `createDuplicateIndex` in `lib/productMatches.js` is built once per catalog change and gives exactly `findDuplicate`'s answer (the first product, in list order, whose normalised name or generic name matches). The add form, CSV preview and CSV import use it.
* **Memoised catalog passes.** Duplicate groups, categories and the preview's duplicate count recompute only when the catalog (or the uploaded file) changes.
* **Offline cache follows the list.** `BusinessDashboard` writes the `products_<businessId>` cache 1.5 s after the list stops changing, instead of once per full download. It never writes before the first load has finished (so the empty initial list, or the previous business's list after a switch, cannot overwrite a good cache).
* Errors in delete, restock, CareFind toggle and "update existing" are now logged and shown; the CareFind toggle used to fail silently.

## What did not change, and why

The catalog is still loaded **in full once per session** (`BusinessDashboard.loadProducts`). Server-side paging of the products page was considered and not done: the POS, offline sales, the stock KPIs, duplicate detection, Excel export and the plan cap all work on the whole list in memory. Paging only the products table would mean either a second copy of the catalog or moving all of those to the server. The list is now fetched once instead of twice per save, which removes the reported slowness. If catalogs grow past ~20,000 products, the next steps are: select explicit columns instead of `*` for the initial load, then a server-side search RPC for the products table.

Other screens (`Purchases`, `Orders`, `Stock`, `Locations`) still call `productRepository.getAll` for their own needs; they were not part of the reported problem.

`modules/inventory/hooks/useInventory.js` duplicates the old Inventory logic and is not imported anywhere. It was left untouched; removing it is a separate clean-up.

## Security

No change to authentication, RLS or permissions. Every write still goes through the tenant-scoped repository (`id` **and** `business_id` filters). `increment_product_stock` is `SECURITY INVOKER`, so the same `products` RLS policy that governs a PATCH governs the restock; it is already used by Purchases. Returning the saved row exposes nothing new: it is the caller's own row, which they could already read.

## Tests

Automated (`npx vitest run` in `apps/carehub`):

* `modules/inventory/productListState.test.js`: replace in place, partial merge (restock), insert in name order, numeric vs string ids, no-op on empty results, removal, inputs never mutated.
* `lib/__tests__/productMatches.test.js`: `createDuplicateIndex` gives the same answer as `findDuplicate` for name, generic, mixed and empty queries, including the "earlier row wins" case.
* `modules/inventory/repositories/index.test.js`: `update` returns the saved row and returns `null` (changing nothing) for another business's row.

Manual test plan (a business with 1,000+ products, DevTools Network tab open):

1. Open Products: one paged load of the catalog (one request per 1,000 rows).
2. Edit a product's price: one PATCH, no `products?...select=*` GETs; the row shows the new price.
3. Add a product: one POST; it appears in name order; the count goes up by one.
4. Restock 5 units: one `rpc/increment_product_stock` call; the stock goes up by 5. Restock 0: a warning, no request.
5. Toggle CareFind: one PATCH; the icon changes. Go offline and toggle: an error toast.
6. Delete a product: one DELETE; the row disappears.
7. Import a CSV of 500 rows with some existing names: the preview opens without a freeze and counts the duplicates; the import shows the new rows without a reload.
8. Run duplicate cleanup: the list shrinks as batches finish.
9. Reload the page while offline: the products from the cache include the changes from steps 2-8.
10. Switch business (multi-business owner): the second business's cache does not contain the first one's products.
