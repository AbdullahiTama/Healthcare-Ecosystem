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
- **Audit trail (server side):** every export is recorded in `audit_log` through
  `record_export_audit()` (`supabase/migrations/carehub_20261209_record_export_audit.sql`),
  the only write path. The database takes the actor from the session (the client
  cannot name one), checks the caller is the business owner, an owner of an
  ancestor business, or an active staff member, and re-checks the export
  permission with the same rule as `getPerms()`: `Owner` always, otherwise the
  business's own `roles` row must have `canExportReports = true`. A role that may
  not export is refused (403) and nothing is written. Each row holds actor, actor
  type, business, time, export type, row count, the filters used (the search term
  is not stored, only that one was applied) and the actor's email.
- **Append-only:** the same migration revokes all client write grants on
  `audit_log` (it previously allowed UPDATE/DELETE/TRUNCATE for `anon` and
  `authenticated`, held back only by RLS, which does not cover TRUNCATE) and adds
  triggers that refuse UPDATE, DELETE and TRUNCATE even for the table owner.
- **Order of operations:** file built, then audit recorded, then download. A
  failed build leaves no audit row. If the database refuses, the download is
  cancelled. If the record cannot be saved for any other reason (function not
  deployed yet, network, expired session) the file is still delivered and the
  user sees a warning, because the data is already in the browser and blocking
  would not protect it; the warning keeps the gap visible instead of silent.
- **What it does not do:** it records that an export was declared. It cannot stop
  a signed-in user copying data the browser already holds, and a modified client
  could skip the call. It is accountability, not prevention.
- **Reading it:** the existing `audit_log` policy lets members of the business
  (and platform admins) read its rows. There is no screen for it yet.
- **Logging:** failures log via `console.error`; a missing audit record logs a
  `console.warn` with its status.

## Rollout

The migration is **not applied** to production. Until it is, exports still work
and show the "audit record could not be saved" warning. Apply it, then run
`scripts/db-tests/exportAudit.pglite.mjs` (needs `npm i --no-save
@electric-sql/pglite`) against a Supabase branch first; the PGlite run proves the
SQL and permissions, not PostgREST. Rollback steps are in the migration header.

## Test plan

Automated:
- `inventoryExport.test.js`: value maths and status, services blank, header +
  rows with barcode kept as text and a real date cell, formula neutralising,
  empty list, and the audit hook (runs before the download; false or a throw
  cancels it).
- `audit/repositories/index.test.js`: RPC payload (no actor sent), and the
  refused / unavailable / failed status mapping.
- `scripts/db-tests/exportAudit.pglite.mjs` (37 checks on real Postgres via
  PGlite): owner, custom-role staff, `Owner`-role staff allowed; roles without
  the flag, inactive staff, forged business id, other company, outsider and
  anonymous refused with nothing written; ancestor owner allowed on a branch but
  parent-business staff not promoted; input validation; no client INSERT,
  UPDATE, DELETE or TRUNCATE; append-only even for the table owner; tenant
  isolation on reads.

Manual / browser (done 2026-10-25 against the real Inventory component in
Chromium with mock data, at 1280px and 390px):

1. Owner sees **Export Excel**; click downloads the file and toasts "Exported N products".
2. Search "amox" then export: file has header + 1 row.
3. Role without `canExportReports`: button absent.
4. No products: click shows "There are no products to export." and no download.
5. Product named `=HYPERLINK(...)` opens as text.
6. Layout wraps cleanly at 390px; no console or page errors.
7. Audit outcomes with the RPC intercepted (2026-10-25): recorded gives the
   success toast and a download; a refusal gives "Your role is not allowed to
   export data." and NO download; function missing (404) and server error (500)
   download the file with the "audit record could not be saved" warning. The
   request body carried business, type, row count and filters and no actor.

Still worth a one-off check by a person: open the downloaded file in desktop
Excel / Google Sheets, and export a catalogue of several thousand products to
check timing.
