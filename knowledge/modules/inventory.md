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

## Missing Documentation
No written specification exists for: the duplicate-detection/merge algorithm (name/generic-name normalization rules, "keeper" selection logic) — reverse-engineered from source for this entry; the intended relationship (if any) between `products.stock` and the enterprise `stock_batches`/`stock_movements` system; why `products` carries both a legacy `cat` and current `category` field with `||` fallbacks throughout; and what, if anything, is supposed to keep `products.stock` accurate given POS does not persist its own decrements.
