# Purchases: totals that reconcile, and uploaded lines without a quantity

Last updated: 2026-11-19. Migration: `supabase/migrations/carehub_20270131_purchase_totals_reconcile.sql`.
Related: [Purchases-Editing-and-Analytics.md](Purchases-Editing-and-Analytics.md), [Purchases-Import-Export.md](Purchases-Import-Export.md).

## Problem (reported 2026-11-19)

The total under Purchases sometimes differed from the Purchase Summary, and uploaded purchases, especially rows
without a quantity, were not reflected consistently in both.

## Root causes (verified against the code and the live database)

| # | Cause | Effect |
|---|---|---|
| 1 | The figures above the Purchases list (`get_purchase_totals`) were always all-time and unfiltered; the list under them follows the chosen period, supplier and search. History & analytics kept its own period, opening on **This month**. | The same purchases showed three different sets of figures. Uploaded purchases are often back-dated, so they appeared under Purchases (all time) but not in the summary (this month). |
| 2 | The summary's **Total spent** (and spending per supplier) re-added every line as quantity x unit cost instead of using the purchase's own total. | A line without a quantity counted 0; per-line rounding drifted by kobo (live: ₦8,949,342.00 against ₦8,949,341.99); a purchase whose items held no object line fell out of the summary. |
| 3 | An uploaded row without a quantity was an error, which blocked its whole purchase. | That purchase reached neither section. |

Live on 2026-11-19 every one of the 67 purchases had paid + owed = total and a quantity on every line, so no stored
purchase was wrong: the mismatches came from how the figures were selected and added up, and from what the upload
refused.

## Change

**Database (`carehub_20270131`)**

- `get_purchase_totals(business, from, to, supplier, search)`: the same selection as `get_purchases_page`, and a new
  `total_amount`. The one-argument call still works (all purchases).
- `get_purchase_summary` / `get_purchase_supplier_stats`: with whole purchases selected (no product, no search),
  spend is the sum of the purchases' own totals, the same figure as the Purchases **Total Amount**. Narrowed to a
  product or a search, spend stays the sum of the matching lines (labelled "Spent on this product" / "Spent on
  matching lines").
- `purchase_line_rows`: an amount-only line has no quantity or unit cost and counts its amount; a purchase whose
  items hold no object line falls back to its own summary line instead of disappearing.
- `get_purchase_product_stats`: unit costs (average, last, previous) only from lines with a quantity.
- `edit_purchase`: an amount-only line can be kept (amount corrected) or completed (quantity and unit cost entered:
  it is received into stock as a purchase receipt, like a new line). A new line, or a line that added stock, still
  needs a quantity. The header's average unit cost counts only lines with a quantity.

**App**

- Purchases: four cards (Total Purchases, **Total Amount**, Total Paid, Balance Owed) for exactly the purchases listed,
  with the selection in words under the count ("All time", "This month · Emzor"). Before the migration is applied, a
  filtered request falls back to all purchases and says "All purchases" rather than show figures that disagree.
- History & analytics shares the period and supplier with the Purchases tab, both ways.
- Upload: **Quantity** and **Unit Cost** are optional; a new optional **Line Total (NGN)** column. A row without a
  quantity is recorded as an amount-only line: its Line Total (else its Unit Cost, read as the line's amount) counts in
  the purchase, its paid / owed and the supplier debt; no stock is added and no product is created; the preview warns
  per row. A quantity with a Line Total and no Unit Cost works out the unit cost; a Line Total that disagrees with
  quantity x unit cost is flagged and quantity x unit cost is used. A file with none of the three columns is refused
  at the header. The template gains the column and an example row.
- The invoice view shows "Quantity not recorded: no stock was added"; the export leaves Quantity and Unit Cost blank
  and keeps the Line Total, so the file uploads again as the same line.
- Edit Purchase shows an **Amount** field on such a line, with a note; entering a quantity and unit cost turns it into
  a normal line, which saving adds to stock.

Stored shape of an amount-only line in `purchases.items`:
`{ "id", "product_id", "name", "qty": null, "cost": null, "amount": 3500, "no_qty": true, ... }`.

## Security

No new access. `get_purchase_totals` keeps its ownership check and grants; analytics stay SECURITY INVOKER under
purchases' RLS; `edit_purchase` keeps its membership and "Edit purchases" checks. An amount-only line cannot move stock.

## Deployment order

Apply the migration, probe it, then deploy the app. An app deployed first would record amount-only lines that the old
summary counts as 0 and the old `edit_purchase` refuses to save.

## Tests

- `scripts/db-tests/purchaseTotalsReconcile.pglite.mjs` (48): the defect reproduced on the live functions; then, for
  all time, a month, another month, one supplier and an empty month, the Purchases figures equal the list and the
  summary equals the figures (count, total, paid, outstanding) and paid + owed = total and supplier spend adds up;
  the one-argument call; no kobo drift; the non-object purchase; amount-only line and product stats; edit keep /
  correct / complete (receipt movement), refusals, unchanged edit; access and grants.
- `scripts/db-tests/purchaseEditing.pglite.mjs` (77) also passes with this migration applied on top (normal purchases
  edit exactly as before).
- `apps/carehub/src/modules/purchases/__tests__/purchaseNoQuantity.test.js` and `Purchases.reconcile.test.jsx`
  (15; 14 fail on the previous code), and the updated import / export tests.

## Manual check

Purchases: the four cards say "All time"; pick a month and a supplier: the cards and the list change together, and
Paid + Owed = Total Amount. Open History & analytics: the same month and supplier are selected and Total spent equals
Total Amount. Upload the template: one purchase of three lines, total ₦23,500, with a warning that Cotton wool has no
quantity; after recording, Paracetamol and Amoxicillin stock rise, Cotton wool's does not, and both tabs show ₦23,500.
Edit that purchase, give Cotton wool a quantity and unit cost, save: its stock rises.
