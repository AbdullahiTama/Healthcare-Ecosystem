# Inventory: USB barcode scanners

2026-11-04. Client only, no database change. Third of three screens given the same fix: Purchases
(`Purchases-Editing-and-Analytics.md`, "USB scanner routing") and the POS (`POS-Barcode-Scanning.md`).

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
