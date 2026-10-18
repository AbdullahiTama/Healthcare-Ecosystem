# Barcode scanning at the POS counter

A till takes barcodes through three entry points. They all have to resolve to
the same product, or staff hit "the barcode exists but the POS cannot find it":

| Entry point | Who uses it | Implementation |
| --- | --- | --- |
| Search box (`Search products or scan...`) | hardware USB scanners, which type like a keyboard and press Enter | `onSearchKeyDown` + the `visible` filter |
| Camera button | phones / tablets with `BarcodeDetector` | `startScan` → `detect` interval |
| Camera fallback prompt | desktop browsers without `BarcodeDetector` (`'BarcodeDetector' in window` is false on most of them) | `startScan` → `prompt()` |

## Observed symptom

Scanning a registered barcode showed the code sitting in the search box over
"No products match your search." — even though Inventory listed the product
with that exact barcode. Chain:

1. A hardware scanner types the digits into the search box and sends Enter.
2. The grid filter in `POS.jsx` ONLY matched `name` and `generic_name`, so the
   barcode filtered every product away. Enter was not handled either, so the
   scan could not add anything.
3. The fallback prompt (path 3 above) also matched only `name` — it never read
   `p.barcode` — so on desktop the camera button failed the same way.

The camera path with a real `BarcodeDetector` did check `p.barcode === code`;
the other two paths made it look like the product's barcode was wrong.

## The fix

One lookup rule, one definition (`findByBarcode` in `POS.jsx`):

```js
const findByBarcode = code => products.find(p => (p.barcode || '').trim() === String(code).trim())
```

- **Grid filter** — a query now matches name, generic name OR barcode
  (trimmed, case-insensitive `includes`), so a scanned code immediately shows
  its product instead of the empty state.
- **Enter in the search box** — when the whole query is an exact barcode match,
  it is treated as a scan: stock check, `add(product)`, "Added: …" toast, and
  the field resets so the next scan starts clean. A non-barcode Enter stays a
  plain text search and never adds anything.
- **Camera path and fallback prompt** — both call `findByBarcode` first,
  then keep the pre-existing name-includes fallback. The prompt path also
  gained the same "Added: …" toast the camera path always had.

Trim-only equality is deliberate: a stray space from a scanner (or a label
saved with one) must not break the lookup, while a partial barcode must never
auto-add a product — partial matches only filter the grid.

Out-of-stock products follow the existing rule everywhere: the scan warns
("… is out of stock.") and does not add, and the grid explains it via
"All matching products are out of stock."

## Tests

| File | Covers |
| --- | --- |
| `src/modules/pos/POS.barcode.test.jsx` | barcode query shows the product; unregistered barcode shows the empty state; Enter adds and resets the field; out-of-stock Enter warns without adding; non-barcode Enter never adds; fallback prompt resolves by barcode |

## If you hit this in the wild

Update to a build containing the fix — no data is affected, the barcode was
always stored correctly. If a product still will not scan, compare the stored
barcode in Inventory with what the scanner emits (some scanners emit 12-digit
UPC-A where the label shows 13-digit EAN-13 with a leading zero); the lookup
is exact after trimming, so those two forms are different strings.
