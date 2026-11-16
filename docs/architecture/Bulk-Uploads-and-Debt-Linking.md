# Bulk uploads, debt linking, supplier phone in Purchases, POS out-of-stock price

2026-11-16. Four reported issues: incomplete file uploads (Inventory, Purchases, Debts and other sections), incomplete
automatic debt linking, no selling price on out-of-stock products at the POS, and no supplier phone in Purchases.
CODE_AUDIT item A33. **No database change**: everything here uses tables and functions already applied to production.

What was already done on `main` before this change, and is not repeated here:
[Debt-Accounts-and-POS-Stock-Limits.md](Debt-Accounts-and-POS-Stock-Limits.md) (Debts import and export, supplier
accounts that include debts recorded by hand or imported, A26), [Supplier-Directory.md](Supplier-Directory.md) (supplier
records with phone and contacts, A28), Record Debt linking each debt to its client or supplier, and credit-sale debts
linked to their sale's client (A32).

## 1. Incomplete file uploads

### Root causes (Inventory, verified against `main` at `56e20dd`)

| # | Cause | Effect |
|---|---|---|
| 1 | A row was skipped as "already exists" when its **generic name** matched any product in stock (`createDuplicateIndex` matches name *or* generic name). | Every brand of a generic already stocked was lost: ten Paracetamol brands in a file were all skipped if one Paracetamol was in Inventory. The main reason large uploads came in short. |
| 2 | The CSV was split on raw line breaks. | A quoted cell containing a line break cut its row in two. |
| 3 | The picker accepted `.xlsx` / `.xls` and read the file as text. | An Excel file produced nothing usable. |
| 4 | Rows without a product name and rows over the plan's product limit were dropped without being counted. | The totals did not add up to the file. |
| 5 | `parseFloat` read "1,500" as 1 and "₦800" as 0. | Wrong prices. |
| 6 | Only the first five failures were named, in a toast; nothing could be re-uploaded. | No way to account for, fix and resend the rest. |

Purchases, Debts, Clients and Suppliers already read files with the shared reader (`lib/spreadsheet.js`) and report
every row; Inventory was the upload still on the old parser.

### The rule the Inventory upload now follows

Every row submitted ends in exactly one state, shown in a preview **before** anything is saved and in the result after:
**ready / imported**, **duplicate** (same name or barcode as a product in Inventory or an earlier row of the file;
skipped), **needs fixing** (the reason names the column), **over plan limit**, or **failed** (the database's own reason).
The result shows **submitted, imported, duplicates, failed**; "Download rows to fix" gives a CSV of every row not saved,
in the upload's columns plus *Problem* (ignored on upload). Uploading it, or the whole corrected file again, never
duplicates: rows already imported are then duplicates.

### Code

- `apps/carehub/src/lib/spreadsheetImport.js` (complements `lib/spreadsheet.js`, which reads files): value parsers
  (moved here from `purchaseImport.js`, which re-exports them), `readTableByHeader` (columns by header in any order,
  with a positional fallback for old templates), `saveInBatches` (one request per 100 rows; a refused batch is saved
  row by row so only the bad row fails, with its reason; network and 5xx errors retried once; never throws),
  `buildRowsToFixCsv`.
- `apps/carehub/src/components/BulkUpload.jsx`: shared preview/result pieces (stats, notices, file picker, progress, row
  issue list, download). The Purchases upload uses its Stat and Notice.
- `modules/inventory/csvImport.js` (rules), `components/InventoryImportModal.jsx` (screens),
  `productRepository.createMany`. The Inventory Excel export uploads back unchanged.

## 2. Automatic debt linking

Checked against production on 2026-11-16:

- Customer debts: every hand-recorded "Owes us" debt is linked to a client (Record Debt links or creates the client;
  the Debts import links in `import_debts`). The 5 unlinked customer debts are credit sales with no client to link
  (walk-in sales; A32).
- Supplier debts: `get_supplier_accounts` (applied, A26) builds each supplier's account from its purchases **and** its
  "We owe" debts recorded by hand or imported, by name, so every such debt is in its supplier's outstanding balance and
  in Purchases › Supplier summary; a new name is a new account. Every purchase with a balance has its debt (0 missing).
- **Defect fixed here:** `debtRepository.recordUnderpayment` returned `null` both for "nothing owed" and for a failed
  write, so a purchase whose debt could not be written was reported as "added to Debts". It now returns
  `{ failed, message }` (still never throws, so POS is unaffected), and Record Purchase and the purchase upload say the
  balance could not be added to Debts.

## 3. POS: price of an out-of-stock product

Searching or scanning an out-of-stock product shows its selling price, without moving anything:
- the **Out of stock** list (from the badge, filtered by the search) adds "Selling price ₦…" to the end of each product's
  existing second line;
- the "… is out of stock" message (barcode in the search box, USB scanner, camera, typed code) ends with
  "Selling price: ₦…".

## 4. Supplier phone in Purchases

Supplier records with a phone already exist (Purchases › Supplier summary, A28). Added:
- **Record Purchase**: an optional *Supplier Phone* field, showing the phone on file for a known supplier.
- **Purchase upload**: an optional *Supplier Phone* column in the template; a value that is not a phone number is named
  for its row. (The purchase export has the column too, blank, so an export uploads back unchanged.)
- Saved by `purchaseRepository.saveSupplierPhone` onto the supplier's record (`suppliers`, matched by the same key,
  created when the supplier has none). A different phone already on file is **kept**, as the supplier import does, and
  the message says to change it in Supplier summary.

## Security implications

No new table, function, grant or policy. The uploads and the phone write go through the same tables and RLS policies as
the existing forms (`products`, `suppliers`: members of the business may add and edit). No authentication or
permission rule is changed.

## Test plan

Automated (passing 2026-11-16):

| Area | Test |
|---|---|
| Upload engine | `lib/spreadsheetImport.test.js`: batches, refused batch saved row by row, retry rules, rows-to-fix round trip |
| Inventory | `inventory/csvImport.test.js` (generic-name regression, quoted line breaks, ₦ and separators, in-file duplicates, 1,002-row accounting, plan limit); `components/InventoryImportModal.test.jsx` (1,000 rows imported; stats; failure reasons; rows-to-fix file; missing column) |
| Debt failure | `debts/repositories/index.test.js`; `purchases/__tests__/Purchases.importExport.test.jsx` (a failed purchase debt is reported) |
| Supplier phone | `Purchases.test.jsx` (saved on the record, optional, phone on file shown), `Purchases.importExport.test.jsx` (column; bad phone named) |
| POS | `pos/POS.barcode.test.jsx`: price in the out-of-stock message and list |

Manual, in production:
1. Upload an Inventory file of 1,000+ rows including several brands of one generic → every row accounted for.
2. Upload a file with a bad price and a duplicate → named in the preview; download the rows to fix, correct, re-upload.
3. Record a purchase with a supplier phone → the phone appears in Supplier summary.
4. POS: search an out-of-stock product → price in the Out of stock list; scan it → price in the message.
