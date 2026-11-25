# Wholesale and retail prices; bulk stock deletion; mobile pagination; optional requisition cost

2026-11-25. Feedback from a pharmacy newly onboarded in Lagos. One migration (`carehub_20270205_wholesale_retail_prices`,
applied 2026-11-25 before the app was deployed, see "Deployment order"); everything else is app only. CODE_AUDIT item A50.

## 1. Wholesale and retail prices

### The rule (one place: `apps/carehub/src/lib/productPricing.js`)

A product has two optional selling prices:

| Column | Meaning | Not entered |
|---|---|---|
| `products.price` | Retail price (the column every product has always had; CareFind shows it) | `0` (the column's default, as for 1,235 live products on 2026-11-25) |
| `products.wholesale_price` (new) | Wholesale price | `null` |

A price is *set* when it is a number above 0. Inventory, Purchases, the upload templates and the POS all read prices
through `productPricing.js` (`priceOptions`, `priceFor`, `priceSummary`, `referencePrice`), so they agree on what is
shown. A product with neither price behaves exactly as before (one retail price of ₦0).

Wholesale prices are per product row: the master-catalogue push (`products_price_source`) still carries only the
retail price.

### Stock Inventory (Stock Management › Inventory)

- **Product form:** *Retail Price* and *Wholesale Price*, both optional (the retail price used to be required). A hint
  says the POS offers only the prices entered. With a cost price, a margin is shown for each price entered. Both fields
  are read-only without "Edit prices", as the retail price was.
- **List:** separate *Retail Price* and *Wholesale Price* columns ("Not set" when not entered), sortable. Margin, stock
  value and profit use the retail price, or the wholesale price for a product sold only wholesale.
- **Bulk edit:** *Wholesale price* beside *Retail price* (set, or raise / lower by %). A percentage changes only products
  that have a wholesale price; setting it to 0 removes it.
- **Add an existing product again ("Update Existing Product"):** only the prices entered replace the existing ones.
- **Excel export:** *Retail Price (NGN)* and *Wholesale Price (NGN)*; a price not entered is blank, not 0.

### Purchases

- **Record Purchase:** each line has *Retail price* and *Wholesale price*, both optional. Picking a product fills both
  from Inventory. Roles without "Edit prices" see both read-only (and a value typed before the catalogue loaded reverts
  to the product's own).
- **Recording:** an existing product's retail / wholesale price changes only when a price was entered on the line and
  the role may edit prices. A new product is created with the prices entered; only when **neither** is entered does it
  get the automatic retail price of unit cost + 50% (as before).
- **Purchase detail and export:** each line shows / exports *Retail* and *Wholesale*.
- **Edit Purchase** changes no prices (as before), so it has no wholesale field; a product first created while editing a
  purchase gets a retail price only. `edit_purchase` rebuilds the line list without the `wholesale` key, so an edited
  purchase no longer shows the wholesale price its lines were recorded with (the product keeps it). Follow-up in A50.

### Templates (both columns optional)

| Template | Columns |
|---|---|
| Inventory upload (`csvImport.js`) | … Category · **Retail Price (NGN)** · **Wholesale Price (NGN)** · Cost Price (NGN) · … Examples show both, retail only and wholesale only. |
| Purchases upload (`purchaseImport.js`) | … Line Total (NGN) · **Retail Price (NGN)** · **Wholesale Price (NGN)** · Batch No. · … |

Files made from the earlier templates still import: *Selling Price (NGN)* is read as the retail price; *Wholesale* and
*Retail* short headers are recognised. An Inventory file with no recognisable headers is read in the old ten-column
order (`LEGACY_POSITIONAL_KEYS`), so such a file never has its cost read as a wholesale price. A wholesale price that is
not a number (or negative) is reported on its row and not saved; the purchases upload warns before it sets or changes an
existing product's wholesale price.

### POS

- **Product cards** show only the prices the product has: one figure for a retail-only product (as before); otherwise
  each price labelled *Retail* / *Wholesale*, the one the next unit will be added at first and largest.
- **Price switch** (*Price: Retail | Wholesale*) at the top of *Current Sale*, shown only when some product has a
  wholesale price. New lines are added at that price; switching moves lines whose product has both prices to the new
  price, except lines whose price was typed over (a one-off override is never silently changed). A product with one
  price always sells at it. Every new sale starts at Retail.
- **Each line** whose product has both prices has its own *Retail / Wholesale* chips; a wholesale-only line is labelled
  *Wholesale*. The one-off price override (for roles with "Edit prices") compares with, and falls back to, the line's
  own tier price.
- The line's tier is saved in the sale's items JSON (`price_tier`), held sales and drafts keep it, and receipts mark
  wholesale lines (`(wholesale)` / `(W/S)` on thermal printers). The Owner's sale correction adds a wholesale-only product
  at its wholesale price, never at ₦0.
- Rules: `apps/carehub/src/modules/pos/priceTiers.js` (pure, tested).

### Database (`carehub_20270205_wholesale_retail_prices`)

1. `products.wholesale_price numeric NULL`, `CHECK (wholesale_price IS NULL OR wholesale_price >= 0)`.
2. `guard_sale_item_prices` accepts a line priced at the product's retail price **or** its wholesale price; any other
   price still needs "Edit prices". Without this a Cashier's wholesale sale is refused ("Price override not allowed").
   The rest of the guard is verbatim from `carehub_20270118`.
3. `GRANT SELECT (wholesale_price) ON products TO authenticated`, so the column stays readable once
   `carehub_20270203` (column-by-column SELECT) is applied.

**Security implications.** The price guard widens by exactly one value per product, set by someone allowed to edit
prices; staff without "Edit prices" still cannot pick an arbitrary price. Read access follows the row, like the retail
price: any signed-in user can read the wholesale price of a product listed on CareFind (policy "public can view listed
products"). If wholesale prices must stay private to the business, that is an owner decision (A50): revoke the column
from the API roles and read it through a checked function, as `product_costs()` does for cost.

Tested on PGlite: `apps/carefind/src/test/pos/wholesalePrices.db.test.js` (the refusal before, both prices accepted
after, any other price refused with both prices named, the Owner unaffected, negative refused, readable after the
column guard, idempotent).

### Deployment order

The app names `wholesale_price` in every products read (`productColumns.js`), so **apply the migration first**, probe it,
then deploy CareHub. Deployed the other way round, Inventory and the POS cannot load products until the migration is
applied. Rollback: redeploy the previous app, then the migration's ROLLBACK.

### Not changed

CareFind shows `products.price` as before. A product sold only wholesale (retail not entered) is shown there like the
1,235 products already at ₦0; follow-up in A50.

## 2. Bulk stock deletion (Stock Management › Inventory)

Selection, *Select all*, *Delete selected*, Recently deleted and Undo already existed (A17), but the bulk actions only
appeared after a row had been ticked, so the pharmacy did not find them. The shared bar (`components/SelectionBar.jsx`,
used by Inventory, Clients, Debts, Expenses and Purchases) now always shows *Select all N shown* and the page's actions
(*Edit selected*, *Delete selected*), disabled until something is selected, with the hint "Tick the boxes to select, or
select all." While rows are selected the bar stays at the top of the screen as the list scrolls, so on a phone the
actions are in reach from any row. Permissions are unchanged: *Delete selected* appears only for roles that may delete.

## 3. Mobile pagination; staying on the page after a delete

- **Cause:** the shared `DataTable` (`packages/design-system`) rendered Previous / Next for the desktop table and the card
  variant, but not for the phone card list, so on a phone only the first page (50 products) was reachable.
- **Fix:** the phone list has Previous / Next (40 px tall buttons, a polite live region for "51 to 100 of 120", and the
  new page is scrolled into view from its top). The buttons move from the page actually shown, so a page index left
  beyond the end (rows deleted) still pages correctly.
- **Staying on the page:** Inventory, Clients, Debts, Orders and Stock reset to page 1 whenever the number of rows
  changed, i.e. after every delete. They now reset only when the search, filters or tab change; after a delete the user
  stays on the page they were on (the last page is shown if theirs no longer exists).

## 4. Demand / Requisition: cost optional

A requisition line needs only a product name. The unit cost may be left blank (saved as no cost: `create_requisition`
already stores `''` as null); a cost that is entered must be a number of 0 or more. The total counts the lines with a
cost and says how many have none; the printed requisition shows "Not set" for them. Rules:
`apps/carehub/src/modules/demand/requisitionLines.js`. No database change.

## Test plan

Automated (all passing on 2026-11-25: CareHub 390 files / 4,000+ tests; the CareFind PGlite suite for the migration):

| Area | Tests |
|---|---|
| Price rules | `lib/productPricing.test.js`, `pos/priceTiers.test.js` |
| Inventory | `csvImport.test.js` (template, old templates, headerless files, bad wholesale price), `inventoryExport.test.js`, `bulkEdit.test.js`, `Inventory.stock.test.jsx` (wholesale-only product, clearing the price) |
| Purchases | `__tests__/purchaseWholesalePrices.test.js` (new products, repricing rules, upload, invoice, export), `Purchases.test.jsx` (field filled and locked) |
| POS | `POS.wholesale.test.jsx` (cards, switch, per-line chips, overrides kept), `saleEdit.test.js` |
| Database | `apps/carefind/src/test/pos/wholesalePrices.db.test.js` |
| Pagination / bulk delete | `components/__tests__/sharedDataTable.test.jsx` (phone paging, stale page), `Inventory.bulk.test.jsx` (actions visible but disabled, stay on page 2 after a delete, search back to page 1) |
| Requisitions | `demand/requisitionLines.test.js` |

Manual, at phone (375 px), tablet (820 px) and desktop (1366 px) widths, done on fixtures in a local harness on
2026-11-25 (no horizontal scrolling; Next reaches page 2 on a phone; price switch and chips usable). To repeat on the
live app once deployed:

1. Inventory: add a product with only a wholesale price, one with only retail, one with both; check the list columns
   and the Excel export. Download the template and upload it unchanged (4 rows ready).
2. Purchases: record a purchase with a new product priced wholesale only; check Inventory shows no retail price and the
   wholesale price. Upload the purchases template.
3. POS as a Cashier: sell a product with both prices at Retail, then switch to Wholesale and charge; the sale is accepted
   (only after the migration). Try a typed price as the Cashier: still refused.
4. On a phone: Stock Management › Inventory with more than 50 products, tap Next, delete a product, stay on page 2. Tick
   two products and use Delete selected, then Undo.
5. Demand › New Requisition: save with a line without a cost; print it.
