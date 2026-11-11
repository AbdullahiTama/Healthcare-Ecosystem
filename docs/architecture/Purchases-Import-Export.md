# Purchases: bulk upload and export (Excel / CSV)

2026-11-11. Pending item 1 of "Still Pending Issues – CareFind Hub". Migration
`supabase/migrations/carehub_20270115_purchase_export_audit.sql` (**not applied**; needs the owner's approval).
CODE_AUDIT item A23.

## What the user gets

On **Purchases** (list view), next to Record Purchase:

- **Upload**: an Excel (.xlsx) or CSV file of purchase lines → a preview of every purchase it makes (nothing is saved
  yet) → **Record N purchases** with progress → a result that names anything not recorded.
- **Export** (Owner, or a role with *Export reports*): the purchases matching the list's filters (supply date, supplier,
  search) as Excel or CSV, one row per item.

The template is downloadable from the upload dialog (Excel with an Instructions sheet, or CSV). The export uses the same
columns first, so an export can be corrected and uploaded again.

## File format

One row per purchase **line**. Columns are matched by header name, in any order; common alternatives are accepted
(`Vendor` for Supplier, `Qty`, `Cost Price`, `Invoice No` …). Unknown columns are listed and ignored.

| Column | Level | Required | Notes |
|---|---|---|---|
| Purchase Ref | purchase | no | Rows with the same ref are one purchase. Without it, rows with the same supplier (case and spacing ignored) and supply date are one purchase. Stored in Notes as "Ref …" when Notes is blank. |
| Supplier | purchase | yes | |
| Supply Date | purchase | yes | `YYYY-MM-DD`, `DD/MM/YYYY` (also `-` or `.`), an Excel date cell or serial. **Month-first dates are never guessed**: 05/11/2026 is 5 November. Not in the future (the form's rule). |
| Product Name | line | yes | Linked to Inventory by exact (normalised) name or barcode, as the form does; never a fuzzy match. A new name creates a product. |
| Quantity | line | yes | Whole number above 0. |
| Unit Cost (NGN) | line | yes | Above 0. `₦` and thousands separators accepted. |
| Selling Price (NGN) | line | no | Price of a new product. On an existing product it is applied only for roles allowed to edit prices (the form's rule), and the preview says so for each line. |
| Batch No., Expiry Date | line | when tracked | Required for products tracked by batch / batch and expiry. A past expiry is a warning. |
| Barcode | line | no | Refused if it belongs to another product. |
| Category | line | no | For new products; unknown values become *Other* with a warning. |
| Amount Paid (NGN) | purchase | no | For the whole purchase. More than the total is an error. A balance goes to Debts. |
| Due Date, Notes | purchase | no | |

A purchase-level value may be filled on one row or repeated; two different values on rows of one purchase are an error.
Limits: 2,000 rows and 5 MB per file; legacy `.xls` is refused with how to save as .xlsx/CSV.

## Design

| Piece | Role |
|---|---|
| `purchases/recordPurchase.js` | **Extracted from `Purchases.jsx`**: recording one purchase (purchase record → products created/updated → each line received through `receive_stock` with key `purchase:<id>:<line>` → "we owe" debt). Used by the form and the upload, so both record identically. |
| `purchases/purchaseImport.js` | Pure: template, header mapping, value parsing, row checks (reuses `lineItems.itemProblems`, the form's line rules), grouping, duplicate keys, `commitImportPlan`. |
| `purchases/purchaseExport.js` | Pure: one row per line from `purchaseLines` (older purchases without lines export as one summary row), CSV/XLSX via the shared builders. |
| `components/PurchaseImportModal.jsx`, `PurchaseExportModal.jsx` | The dialogs. |
| `purchaseRepository.getAllPages` / `getAllForExport` | Page through `get_purchases_page` with the list's filters; the export then reads `items` by id in chunks of 100, scoped by `business_id`. |
| `business-directory/services` | `readSpreadsheet` (sheet name, column count and size are now options) and `buildXlsx` (sheet name, widths, number formats) are shared rather than copied. |

**Recording.** Purchases are recorded one after another, as the form would, so each purchase is its own unit: a purchase
whose record is refused saves nothing and is listed with the reason; the others continue. Products created by one
purchase are passed to the next, so two purchases of a new product create it once. **Stop after this purchase** halts
between purchases. Stock or debt problems after a purchase is saved are reported (as the form reports them), never
retried, so nothing is recorded twice.

**Behaviour change in the form (improvement):** a failure to create the debt for a balance used to show "Could not save
purchase" although the purchase and its stock were saved, inviting a duplicate retry. It is now reported as "the balance
could not be added to Debts: add it there".

**Duplicates.** Before the preview, purchases already recorded in the file's supply-date range are read; a planned
purchase with the same supplier, supply date and total is marked *already recorded* and **skipped unless the user ticks
the box**. If that read fails, the preview says it could not check.

**Export audit.** The file is built, then `record_export_audit` is called (`purchases.xlsx` / `purchases.csv`, row
count, filters without the search text), then the file is saved. A refusal (42501) cancels the download; any other audit
failure still saves the file and says the audit record could not be saved, as Inventory and the Sales report do.
Text cells are neutralised against spreadsheet formula injection (`neutraliseFormula`).

## Security implications

- **Upload** grants nothing new: each purchase goes through the same repository calls, RLS, `receive_stock` and plan
  checks as one typed into Record Purchase, by the same people (anyone with the Purchases module). An expired plan still
  cannot create products; the preview names those purchases before anything is saved. The file is parsed in the browser
  only; it is never uploaded or stored.
- **Export** carries costs. It is offered to the Owner and roles with *Export reports*, and the database decides again in
  `record_export_audit` (Owner or `canExportReports`), recording `includes_cost_data = true`.
- **Before A23's migration is applied**, the audit call fails with "Unknown export type" (reported as *failed*, not
  *refused*), so the file is saved with the warning that no audit record was written. The data itself is already
  readable by those users through the Purchases screen.

## Test plan

| Test | Covers |
|---|---|
| `purchases/__tests__/purchaseImport.test.js` (19) | dates (day-first, Excel, impossible dates), money, header aliases, missing columns, limits, template uploads as-is, grouping by ref and by supplier+date, conflicts, every row rule, tracked products, barcode owner, overpayment, warnings, expired plan, repricing notice, duplicates, sequential commit, failure isolation, stop |
| `purchases/__tests__/purchaseExport.test.js` (6) | one row per line, legacy summary row, column order, CSV round-trip into the importer, formula neutralising, Excel sheet, audit veto |
| `purchases/__tests__/Purchases.importExport.test.jsx` (9) | full upload on the screen (preview → record: purchase, stock receipts with distinct keys, debt), duplicates skipped then included, missing columns, `.xls`, a refused purchase, export permission, audited CSV export, refusal, failed load |
| `scripts/db-tests/purchaseExportAudit.pglite.mjs` (16) | the migration over the previous definition: before (refused), Owner / export role recorded as cost data, refusals write nothing, unknown types still refused, anon has no EXECUTE |
| Existing Purchases suite (162 tests incl. the above) | the form after the extraction is unchanged |

**Manual check after deploy:** download both templates; upload the Excel template unchanged (one purchase, two lines);
upload a CSV with a bad row (the others record); upload the same file again (skipped as duplicate); export with a supplier
filter as CSV and Excel, open both, upload the export again (skipped as duplicates); as a Cashier, no Export button.
