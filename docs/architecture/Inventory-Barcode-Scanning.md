# Inventory, Stock Management and Master Catalog: USB barcode scanners

2026-11-04. Client only, no database change. The same fix as Purchases
(`Purchases-Editing-and-Analytics.md`, "USB scanner routing") and the POS (`POS-Barcode-Scanning.md`).
Stock Management's **Inventory** tab is this same screen; its **Stock Validation** tab is covered at the end;
**Stock History** has no inputs. The Master Catalog is covered in the last section.

## Problem

A USB or Bluetooth scanner in keyboard mode types the code, then usually Enter, into whichever field has
focus. In Inventory:

| Where focus was | What a scan did |
|---|---|
| Add / Edit product: Stock Quantity, a price, Reorder Level | wrote the 13 digit code there (Stock Quantity becomes a 13 digit count when saved) |
| Add / Edit product: the Save button | the scanner's Enter saved the product |
| Restock: Units to Add | a 13 digit number of units, added by **+ Add Stock** |
| The list's search box | typed the code, but search matched only name and generic name: "No products match" |
| Nothing (list) | nothing; only the camera button handled barcodes |

## Fix

All three screens share `useKeyboardScanner` (`src/hooks/useKeyboardScanner.js`) on top of
`createKeyboardScanDetector` (`src/lib/barcodeScanner.js`): a scan is 6+ keys, each within 50 ms, ended by
Enter/Tab or a 100 ms pause, so typing by hand is never taken for one. The scanner's Enter/Tab is swallowed.
What the burst typed is undone from a snapshot taken at its first key.

- **Add / Edit product:** a scan anywhere in the dialog (its buttons too, or with nothing focused) goes into
  Barcode; everything else is as it was. A code that already belongs to another product shows a warning
  (the save itself is unchanged).
- **Restock:** the dialog has no barcode field, so a scan is undone and "Scanned … was not added. Type the
  number of units to add." is shown. Batch number is left alone: batch labels may be scanned on purpose.
- **List (no dialog open):** a scan anywhere opens its product, like the camera button ("Found: …"); an
  unknown code goes into search with "No product has the barcode …". The camera, the fallback prompt and the
  scanner share `openScanned`, and the lookup is the shared exact-after-trim rule `findProductByBarcode`
  (moved from `purchases/lineItems.js` to `lib/barcodeScanner.js`; the camera used to compare untrimmed).
- **Search** also matches barcodes ("Search name, generic name or barcode...", now with an accessible name).

Left alone: text areas, fields outside Inventory, and the CSV upload, duplicate clean-up and delete dialogs.

## Security

None affected: no data, permission or server change. Undoing a burst only returns fields to values the user
already had; read-only prices and stock stay read-only. Opening a product from a scan is what the camera
button already did, and the edit dialog applies the same permissions.

## Tests

`src/modules/inventory/Inventory.scanner.test.jsx`, 13 tests: Stock, Save button, price, duplicate warning,
hand typing (product form); Units, + Add Stock button, batch label (Restock); nothing focused, search box,
unknown code, typed barcode search, fields outside Inventory (list). 10 fail against the previous Inventory;
the other 3 check what must not change. Not yet tried with a physical scanner.

## Stock Management ▸ Stock Validation

**Problem:** the count worksheet's Adjustment quantity clamps what is typed to 10000
(`parseAdjustmentQty`), so a scan with focus there became a **10000 unit adjustment**. Scanning could not add
a product to the count: the search box matched barcodes, but Enter did nothing.

**Fix (`StockValidation.jsx`, same hook, window listener while the tab is shown):** a scan anywhere on the
tab puts the worksheet, the search text and the save's request key back as they were before the first
scanned key, then looks the code up with `findProductByBarcode`:

- a product not yet on the count is added ("Added: …") and focus moves to its Adjustment quantity, ready
  for the counted number; one already on it keeps its quantity and its row is shown, as a click does;
- an unknown code goes into search with "No product has the barcode …";
- with the Validation Summary open, a scan changes nothing ("Close the summary to add scanned products.")
  and its Enter does not press Save Validation.

The request key is restored with the worksheet so that retrying a save whose result was unknown still
reuses its key (the server's protection against applying one count twice). Quantity inputs are now named
per product ("Adjustment quantity for …"), and search says it takes barcodes.

**Tests:** `StockValidation.scanner.test.jsx`, 9 tests (nothing focused, from a quantity, product already
counted, search box, unknown code, no-suffix scanner, summary open, hand typing, fields outside). 8 fail
against the previous screen (the hand-typing check only because its setup adds the product by scan).

## Master Catalog

**Problem:** the add / edit item form is a real `<form>`: a scan with focus in Default price, Default cost,
Reorder level, Pack size or Name typed the code there and the scanner's Enter **submitted** it. The Carry
dialog's "Own price" and each location's price took the code as a price, and the scanner's Enter pressed a
focused Carry, Stop carrying, Set price, Push or Archive button, or confirmed an open Push / Archive.

**Fix:** the dialogs use `useDialogKeyboardScanner` (moved from Inventory into
`src/hooks/useKeyboardScanner.js`; Inventory now imports it): keys anywhere inside the open dialog, or with
nothing focused, are that dialog's.

- **Item form:** a scan goes into Barcode, everything else as it was, nothing submitted;
  "Scanned … into Barcode." is announced. Before the catalogue update (no Barcode field) the scan is undone:
  "barcodes can be added once the catalogue update is installed".
- **Carry dialog and Locations and prices:** no barcode field, so the scan is undone and "Scan ignored (…):
  there is no barcode field here, so nothing was changed." is shown; no button is pressed.
- **List** (window listener while no own dialog is open): a scan anywhere searches the catalogue for the code
  at once (the server search covers barcodes; the 300 ms typing pause is skipped), replacing what was in the
  box. With a Push or Archive confirmation open the scan does nothing ("confirm or cancel first") and its
  Enter does not confirm.

**Tests:** `master-catalog/__tests__/MasterCatalog.scanner.test.jsx`, 11 tests. 9 fail against the previous
screens; the other 2 (hand typing, fields outside) check what must not change.

