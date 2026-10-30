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
* **Restock is atomic.** It calls `productRepository.incrementStock` (the `increment_product_stock` RPC, `stock = stock + qty` in the database) and shows the stock the database returns. Zero or negative quantities are refused before any request. *(Superseded 2026-10-30: restock now goes through the stock ledger with `receive_stock`; see `Stock-Ledger.md`.)*
* **Duplicate checks are O(1).** `createDuplicateIndex` in `lib/productMatches.js` is built once per catalog change and gives exactly `findDuplicate`'s answer (the first product, in list order, whose normalised name or generic name matches). The add form, CSV preview and CSV import use it.
* **Memoised catalog passes.** Duplicate groups, categories and the preview's duplicate count recompute only when the catalog (or the uploaded file) changes.
* **Offline cache follows the list.** `BusinessDashboard` writes the `products_<businessId>` cache 1.5 s after the list stops changing, instead of once per full download. It never writes before the first load has finished (so the empty initial list, or the previous business's list after a switch, cannot overwrite a good cache).
* Errors in delete, restock, CareFind toggle and "update existing" are now logged and shown; the CareFind toggle used to fail silently.

## Loading the catalog (states and rules)

The catalog is loaded once per business by `useProductCatalog` (`modules/inventory/hooks/useProductCatalog.js`), called in `BusinessDashboard` and passed to every page as `products`, `setProducts` and `catalog`. It is a React Query query (`keys.products(businessId)` in `hooks/queries.js`), like the app's other server data, so request de-duplication, one retry, refetch on reconnect and dropping answers for a previous business come from the library. The fallback rules are a plain function, `loadProductCatalog` (`modules/inventory/productCatalog.js`):

| Situation | What the user sees |
|---|---|
| First load, no saved copy | Skeleton tiles and rows with "Loading products… 2,000 loaded" (progress per 1,000-row page). Add, Upload CSV and Export wait until the list has loaded |
| First load, saved copy on this device | The saved copy at once, with "Updating your product list…"; replaced by the server list when it arrives |
| Request failed, no saved copy | An error panel with Retry |
| Request failed, saved copy | The saved copy with a warning ("may be out of date") and Try again |
| Offline | The saved copy with an offline notice (no request is sent); refreshed automatically on reconnect |
| Server answered empty but a saved copy exists | The saved copy, flagged: this is how an expired sign-in looks (row security returns nothing to the anon key) |
| Server answered empty, no saved copy | "No products yet" with Add product |
| Search or filters match nothing | "No products match" with Clear filters |

Rules:

* **Refresh cadence.** The list is refreshed on window focus at most every 5 minutes (the app default is 30 s, too heavy for a multi-megabyte catalog), on reconnect, and on Retry. A saved copy counts as out of date at once.
* **Edits during a load.** A page's local update (`setProducts`) made while a load is running cancels that load (its rows were read before the edit), applies the edit, and loads again, so the edit is never overwritten.
* **Offline copy.** Written 1.5 s after the list stops changing, never for an unchanged list, and read only when a fallback is needed.
* The POS product grid uses the same states (skeleton, error with Retry, "No products to sell yet").

`services/supabase.js` `getProducts` was removed: it duplicated `productRepository.getAll`.

## What did not change, and why

The catalog is still loaded **in full once per session** (`BusinessDashboard.loadProducts`). Server-side paging of the products page was considered and not done: the POS, offline sales, the stock KPIs, duplicate detection, Excel export and the plan cap all work on the whole list in memory. Paging only the products table would mean either a second copy of the catalog or moving all of those to the server. The list is now fetched once instead of twice per save, which removes the reported slowness. If catalogs grow past ~20,000 products, the next steps are: select explicit columns instead of `*` for the initial load, then a server-side search RPC for the products table.

Other screens (`Purchases`, `Orders`, `Stock`, `Locations`) still call `productRepository.getAll` for their own needs; they were not part of the reported problem.

`modules/inventory/hooks/useInventory.js` duplicated the old Inventory logic and was not imported anywhere; it was deleted on 2026-10-30, together with the equally unused `components/ProductForm.jsx` (and its test). Both still carried the absolute `stock` writes that erased sales.

## Security

No change to authentication, RLS or permissions. Every write still goes through the tenant-scoped repository (`id` **and** `business_id` filters). `increment_product_stock` is `SECURITY INVOKER`, so the same `products` RLS policy that governs a PATCH governs the restock; it is already used by Purchases. Returning the saved row exposes nothing new: it is the caller's own row, which they could already read.

## Tests

Automated (`npx vitest run` in `apps/carehub`):

* `modules/inventory/productListState.test.js`: replace in place, partial merge (restock), insert in name order, numeric vs string ids, no-op on empty results, removal, inputs never mutated.
* `lib/__tests__/productMatches.test.js`: `createDuplicateIndex` gives the same answer as `findDuplicate` for name, generic, mixed and empty queries, including the "earlier row wins" case.
* `modules/inventory/productCatalog.test.js`: server wins; offline, failed and unconfirmed fall back to the saved copy (and say why); no copy means an error or a genuinely empty catalog; the copy is not read on success; progress is forwarded.
* `modules/inventory/hooks/useProductCatalog.test.jsx` (real React Query): loading with progress then ready; saved copy shown at once then replaced; error then Retry; failed refresh keeps the copy; local edits need no reload; an edit during a load survives the late answer; a business switch never shows the previous business's products; the offline copy is written once, after the list settles.
* `modules/inventory/Inventory.states.test.jsx`: skeleton and disabled actions while loading, error panel with Retry, saved-copy and offline banners, refreshing line, "No products yet", "No products match" with Clear filters.
* `lib/__tests__/pagedQuery.test.js`: page progress callback.
* `modules/inventory/repositories/index.test.js`: `update` returns the saved row and returns `null` (changing nothing) for another business's row.

Manual test plan (a business with 1,000+ products, DevTools Network tab open):

1. Open Products: one paged load of the catalog (one request per 1,000 rows).
2. Edit a product's price: one PATCH, no `products?...select=*` GETs; the row shows the new price.
3. Add a product: one POST; it appears in name order; the count goes up by one.
4. Restock 5 units: one `rpc/receive_stock` call (was `increment_product_stock` before 2026-10-30); the stock goes up by 5 and a ledger row is written. Restock 0: a warning, no request.
5. Toggle CareFind: one PATCH; the icon changes. Go offline and toggle: an error toast.
6. Delete a product: one DELETE; the row disappears.
7. Import a CSV of 500 rows with some existing names: the preview opens without a freeze and counts the duplicates; the import shows the new rows without a reload.
8. Run duplicate cleanup: the list shrinks as batches finish.
9. Reload the page while offline: the products from the cache include the changes from steps 2-8.
10. Switch business (multi-business owner): the second business's cache does not contain the first one's products.
11. Clear site data, throttle the network to "Slow 3G", open Inventory: skeletons with a rising "N loaded" count; Add / Upload / Export disabled until loaded; no "No products" flash.
12. Reload with a saved copy: products appear at once with "Updating your product list…".
13. Block `*/rest/v1/products*` in DevTools and reload: the saved copy with the "may be out of date" warning; Try again after unblocking loads fresh data. With site data cleared too: the error panel with Retry.
14. Go offline (DevTools) and reload: the offline notice; go back online: it refreshes by itself.
15. Search for nonsense: "No products match" and Clear filters brings the list back. Repeat 11 and 13 on POS.
