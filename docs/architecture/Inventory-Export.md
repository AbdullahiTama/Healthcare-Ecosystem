# Inventory Excel Export

## What it does

`Inventory` shows an **Export Excel** button that downloads the current filtered
product list (all pages, not only the visible page) as
`CareHub_Inventory_YYYY-MM-DD.xlsx`.

- Code: `apps/carehub/src/modules/inventory/inventoryExport.js` (pure builders) and
  the `exportExcel` handler in `Inventory.jsx`.
- Library: ExcelJS, loaded lazily on first export so it is not in the main bundle.
- Columns 1-10 match the CSV import template (`csvImport.js`); then Shelf, Sale
  Type, Unit, Stock Status, Stock Value, Cost Value.
- Services carry a sentinel stock of 999 and no cost, so their stock and value
  cells are blank and their status is `Service`.
- `stockStatus()` in `inventoryStats.js` is the single definition of
  In stock / Low stock / Out of stock, using the KPI-tile thresholds.

## Security

- **Permission:** the button is rendered only when `perms.canExportReports` is
  true (Owner by default). The file contains cost price, margin and stock value.
  Hiding the button is a UI control only: the product rows are already in the
  browser for any role that can open Inventory, so this does not stop a user who
  can read the page from copying the data. Who may *read* cost price remains
  governed by the existing Inventory/RLS rules.
- **Formula injection:** text cells pass through `neutraliseFormula` (shared with
  the business-directory export); a value starting with `=`, `@`, tab or CR is
  prefixed with `'`.
- **Tenant scope:** the export uses the products already loaded for the signed-in
  business (`productRepository.getAll` is filtered by `business_id`). No new
  query or endpoint.
- **Logging:** a `console.info` line records business id and row count on success
  (no product data); failures log via `console.error`.

## Known gap / follow-up

There is no server-side audit trail for exports. `audit_log`
(`supabase/migrations/carehub_20260810_audit_log.sql`) is not yet applied and its
INSERT policy is service-role only, so the browser cannot write to it. Recording
"who exported cost data" needs an API endpoint or RPC plus that migration. It was
deliberately not added here because it is a production schema change.

## Test plan

Automated (`inventoryExport.test.js`): value maths and status, services blank,
header + rows with barcode kept as text and a real date cell, formula
neutralising, empty list.

Manual / browser (done 2026-10-25 against the real Inventory component in
Chromium with mock data, at 1280px and 390px):

1. Owner sees **Export Excel**; click downloads the file and toasts "Exported N products".
2. Search "amox" then export: file has header + 1 row.
3. Role without `canExportReports`: button absent.
4. No products: click shows "There are no products to export." and no download.
5. Product named `=HYPERLINK(...)` opens as text.
6. Layout wraps cleanly at 390px; no console or page errors.

Still worth a one-off check by a person: open the downloaded file in desktop
Excel / Google Sheets, and export a catalogue of several thousand products to
check timing.
