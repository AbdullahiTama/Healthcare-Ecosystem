# Inventory — Business Domain

## Purpose
CareHub's product catalog and stock-quantity manager for retail-style businesses (pharmacies, skincare/aesthetic spas, dental/optical clinics, hospitals selling products at the counter). It is the system of record for what a business sells, at what price, and how many units are on hand, and it gates what appears publicly on CareFind via the `list_on_carefind` flag. It is distinct from the enterprise "Stock & Batches" domain (`Stock.jsx`), which is a separate batch/expiry-tracking system for manufacturer/wholesale tenants.

## Files
- `apps/carehub/src/pages/dashboard/Inventory.jsx` — the module itself (706 lines, includes `ProductModal` and `RestockModal`)
- `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx` — owns the shared `products` state, passed down as a prop
- `apps/carehub/src/pages/dashboard/POS.jsx` — consumer; sales are meant to deduct stock
- `apps/carehub/src/pages/dashboard/Purchases.jsx` — adjacent domain; checked for a stock-linkage that doesn't exist
- `apps/carehub/src/pages/dashboard/CareFind.jsx` — duplicates Inventory's own CareFind-visibility toggle
- `apps/carehub/src/lib/supabase.js`, `lib/permissions.js`, `lib/utils.js`, `components/ui/index.jsx`

## Components
`Inventory` (default export, page shell), `ProductModal` (add/edit form), `RestockModal` (add-units form) — all defined inline in `Inventory.jsx`, no separate component files. The CSV-upload, duplicate-cleanup, and duplicate-warning modals are inline JSX blocks, not componentized. Shared primitives consumed: `Card`, `StatCard`, `Modal`, `Pill`, `Inp`, `Sel`, `Textarea`, `Toggle`, `GhostBtn`, `TealBtn`, `RedBtn`, `Loading`, `Empty`, `Toast`.

## Services
No dedicated service module. Five functions in `lib/supabase.js`: `getProducts`, `addProduct`, `updateProduct`, `deleteProduct`, `deleteProductsBulk` — thin wrappers over a hand-built `sbFetch()`/PostgREST pattern. All business logic (duplicate detection, category defaulting, price/stock coercion) lives in the page component itself, not in the service layer.

## Dependencies
`lib/permissions.js` (`canEditStock`, `canEditPrice`, `canDelete`), `lib/utils.js` (`fmt`, `PRODUCT_CATS`, `PRODUCT_EMOJIS`), `components/ui/index.jsx`. Browser APIs: `BarcodeDetector` (Chromium-only, no fallback library), `FileReader`/`Blob` for CSV import/export. No third-party CSV or validation library.

## Database Tables
`products` — columns observed: `id, business_id, name, generic_name, category, price, cost_price, stock, reorder_level, barcode, list_on_carefind, emoji`. Filtered everywhere by `business_id=eq.<id>`. No schema file exists; columns are inferred from query strings. No RLS policy is visible from the repository.

## Current State
Add/edit/delete/restock/CSV-import/duplicate-merge are all implemented and reachable. **Stock is not reliably accurate**: `POS.jsx` decrements `stock` only in local React state and never calls `updateProduct()`, so a sale's effect on inventory reverts on reload. `Purchases.jsx` records supplier deliveries as free text with no link to `products`, so receiving stock has no effect on the catalog either. The CareFind-visibility toggle is implemented twice (here and in `CareFind.jsx`) with no shared source. No pagination exists — every load fetches the full catalog. Authorization (`canEditPrice`/`canEditStock`) is enforced only by disabling form fields client-side.

## Bulk upload (CSV)
Positional 10-column template (`Inventory.jsx` downloadTemplate + `csvImport.js`): Product Name · Generic Name · Category · Selling Price (NGN) · Cost Price (NGN) · Stock Quantity · Reorder Level · Barcode · List on CareFind (yes/no) · **Expiry Date**. Column 10 was added 2026-08-21; parsing lives in pure helpers (`parseInventoryCsv`, `normalizeExpiryDate`) unit-tested in `csvImport.test.js`. Contract: blank/malformed/impossible expiry values become `null` (the column is nullable) rather than failing the row — JS date-rollover traps (2027-02-31 → March) are explicitly rejected; ISO input is validated in UTC so no timezone shifts it, other formats are read back in local components. Legacy 9-column files keep importing with a null expiry. Empty stock cell means a Service (stock 999); rows without a product name are skipped; import skips duplicates already in the catalog.

## Missing Documentation
No written specification exists for: the duplicate-detection/merge algorithm (name/generic-name normalization rules, "keeper" selection logic) — reverse-engineered from source for this entry; the intended relationship (if any) between `products.stock` and the enterprise `stock_batches`/`stock_movements` system; why `products` carries both a legacy `cat` and current `category` field with `||` fallbacks throughout; and what, if anything, is supposed to keep `products.stock` accurate given POS does not persist its own decrements.

---

# Master Catalog (multi-branch catalog, ADR-004)

## Purpose
Lets a multi-branch owner keep ONE canonical product list (`master_products`) and choose, per branch, which products that branch carries (`branch_products`). The owner pushes name/category/price updates to every active branch; branches keep local control over stock and may override the price. A branch can still create branch-only products in its own `products` table that never appear in the master catalog.

## Files
- `apps/carehub/src/modules/master-catalog/MasterCatalog.jsx` — the owner-only page: product list, add/edit modal, per-branch activation matrix with override-price inputs, Push, Delete
- `apps/carehub/src/modules/master-catalog/repositories/index.js` — `masterCatalogRepository` (seam pattern: `createMasterCatalogRepository(request = sbFetch)`); `getAll` scoped to the PARENT business id (`brand.parent_business_id || brand.id`)
- `apps/carehub/src/modules/master-catalog/repositories/index.test.js` — 10 tests: tenant scoping on every read/write, RPC call-shape assertions via a recording adapter
- `apps/carehub/src/services/supabase.js` — `cloneBranchData` now calls `rpc/activate_branch_product` per master product instead of raw-inserting `branch_products` (previously created orphan links and failed silently under RLS)
- `apps/carehub/src/lib/permissions.js` — `mastercatalog` module (all types), added to `Owner.nav` and all three `NAV_ORDER` lists
- `apps/carehub/sql/20260810_master_catalog.sql` — tables + SELECT RLS (NGN price; FK `ON DELETE CASCADE` from `branch_products.master_product_id`)
- `apps/carehub/sql/20260811_master_catalog_ops.sql` — RLS write policies + the three RPCs + anon/PUBLIC revokes. **Both migrations are NOT YET APPLIED — the UI must not go live before them.**

## Materialisation model
`branch_products` is the activation link + override layer ONLY. Stock lives in the branch's own `products` table. `name` is the join key between the two layers (no FK): a branch `products` row with the same name as a master product IS that master product. `activate_branch_product` upserts the link AND materialises the branch's `products` row (stock 0, price = override or master default, emoji 💊), preserving existing stock/costing on repeat calls. Consequences:
- Renaming a master product requires re-activation at branches — the push RPC only matches branch rows whose name already equals the new name (UI shows this hint on edit).
- Deactivating leaves the branch's `products` row untouched: remaining stock stays sellable, it just stops receiving pushes.
- Deleting a master product cascades the links; branch `products` rows are untouched.

## Security model
- All three RPCs are `SECURITY INVOKER` with `SET search_path = public` — never SECURITY DEFINER (the C15/C17 pattern). Reads and writes are scoped by `current_business_ids()` (owner at the parent sees every branch).
- Repository reads are tenant-scoped in the URL (`business_id=eq.<parentId>` for masters; links are per-branch-id, which is itself a `businesses` row in the tree).
- RLS write policies use the same predicate shape as every tenant table; both `REVOKE ... FROM anon` AND `FROM PUBLIC` are required (Supabase re-grants anon at function creation).
- Even with anon EXECUTE the RPCs are inert: an anon caller has no `current_business_ids()` membership, so every lookup matches zero rows.

## Known limitations
- Activation carries no stock — the branch adds stock in its own Inventory (by design).
- Override of 0 is rejected (both client-side and by the RPC) — 0 is not a saleable price.

## Reading collections past 1000 rows
PostgREST clamps every response to `db-max-rows` (1000 on this project) — a raised client `limit` cannot help (proven live 2026-08-11: `Content-Range: 0-999/12276` on a `limit=50000` request). All tenant collection reads therefore page through `src/lib/pagedQuery.js` (`limit=1000&offset=N` until the last short page, stable `order=<field>.asc,id.asc`). Applies to `productRepository.getAll`, `clientRepository.getAll`, `masterCatalogRepository.getAll`/`getLinks` and the legacy `getProducts`/`getClients`. Reads NOT yet paged (clamped at 1000): `saleRepository.getToday`/`getAll`, expense/purchase/debt collection reads, `getBusinesses`, `getBranches` — tracked in CODE_AUDIT.
