# Purchases: editing, central history and analytics, supplier picker, barcodes

2026-10-31. Migration: `supabase/migrations/carehub_20261229_purchase_editing_and_analytics.sql`
(**drafted, NOT applied**). Builds on `Purchases-Bulk-Stock-Entry.md` and `Stock-Ledger.md`.

## Why

The pharmacy asked for six things: edit recorded purchases; a purchase history across all products and
suppliers with spending figures; automatic summaries when a supplier or product is picked; existing
suppliers offered instead of retyped; flexible date filters; barcode entry on purchases.

What the code and the live data (read 2026-10-31, 13 purchases) showed:

| Finding | Consequence |
|---|---|
| `purchases` has one policy, `FOR ALL` to public | Any member could PATCH or DELETE any purchase directly. "Who may edit" could only ever have been a screen rule. |
| Purchase lines (`items`) did not keep their line id or product | An edit could not tell which stock movement a line made, so it could not correct stock. |
| 8 purchases predate the stock ledger, 5 came after; one predates line items | Edits have to handle stock that was added outside the ledger. |
| 3 of the 5 ledger-era purchases have EAN-13 codes typed into **Batch no.** | Users had no barcode field, so they used the batch field. |
| Supplier names are free text grouped by `lower(btrim(name))` | "MedSupply Ltd" and "Medsupply Limited" become two suppliers, with split spending and debts. |
| The role editor showed "Manage field team" but never read or saved it | Saving any role erased the permission (fixed here, since the new switch lives in the same code). |

## Editing a purchase

**Who:** the Owner (`is_business_owner`), or staff whose custom role has the new **Edit purchases**
switch (`canEditPurchases`, Staff ▸ Roles & Permissions). No preset role has it, Managers included. The
database decides (`can_edit_purchases`, same shape as `can_manage_directory`); the screen only decides what
it offers.

**Where:** Purchases list ▸ **Edit** on a row, or open a purchase ▸ **Edit**. The form is the Record
Purchase form (`PurchaseForm.jsx`, shared by both), plus a required reason.

**What can change:** supplier, supply date, due date, notes, the amount paid, and every line's product,
quantity, unit cost, batch, expiry and barcode. Lines can be added or removed. Selling prices of existing
products are changed in Inventory, not here (the line keeps its selling price for the record).

**`edit_purchase` (one transaction):**

1. Checks sign-in, a 3 to 300 character reason, membership, then `can_edit_purchases`.
2. Refuses when the purchase changed since the screen loaded it (`p_expected_edit_count`,
   `p_expected_amount_paid`): another edit, or a payment recorded meanwhile, is never overwritten. The
   screen sends the amount paid only when the user changed it.
3. Works out, per line, what the line has already added to stock: `ledger_base` (units added before the
   ledger) plus its `purchase` / `purchase_edit` movements for its product.
4. Moves stock through `apply_stock_change` by the difference: same product means the delta (into or out
   of the batch the line created); a new product or a changed product means the old product gets back
   what it received and the new one receives the line. Removed lines give back their units. Increases run
   before decreases, so moving units between lines of one product never dips below zero. Movements:
   `correction` (or `purchase_receipt` for a received line), source `purchase_edit`, key
   `purchase_edit:<purchase>:<edit no>:<line>:<kind>:<product>`.
5. Units already sold cannot be taken back: the edit is refused with a sentence naming the line and the
   lowest quantity it can have. The screen shows that lowest quantity before saving
   (`get_purchase_for_edit.min_qty`) and disables Remove on such lines.
6. Recomputes every total on the server (`total_cost`, `quantity`, average `cost_price`, `product_name`,
   `expiry`, `batch`, `balance`, `status`). The amount paid cannot exceed the new total.
7. A changed amount paid is a `correction` row in `purchase_payments` (signed amount), so the payment
   history still adds up to `amount_paid`. Renaming the supplier renames the purchase's payment rows,
   so supplier history stays together.
8. The supplier's "we owe" debt is updated (amount, paid, balance, status, name, due date), or created
   when a balance appears.
9. A product's `cost_price` is corrected only when it still equals this line's old cost (it came from this
   purchase). Otherwise a later purchase's cost would be overwritten.
10. A barcode on a line is saved on the product when the product has none and no other product uses it;
    a barcode belonging to another product is refused.
11. Writes `audit_log` `purchase.edited` (actor, reason, staff name, before and after, stock moved). The
    purchase view lists these under **Changes**.
12. An edit that changes nothing writes nothing and reports `unchanged`. A retried request is therefore
    harmless (the edit names the target state, not a delta).

**Lines that cannot move stock ("locked"):** a line recorded before the ledger whose name matches no
product (and the single summary line of a purchase recorded before line items were kept) added stock to a
product nobody can identify. Its product and quantity cannot change and it cannot be removed; its cost,
batch text and dates can. A summary line stays a summary after an edit (`summary: true`), so it never
feeds per-product price statistics.

**Line identity:** `purchase_items_normalized` gives each line `id`, `product_id`, `batch_id` and
`ledger_base`. Ledger-era lines are paired with their receipt by product name and quantity (the form's
line id was the receipt's `source_line_id`); pre-ledger lines are matched to a product by exact name and
assumed to have added their quantity, the same rule sales use for pre-ledger edits. The migration
backfills this into `items`; new purchases save `id`, `product_id` and `barcode` on each line.

## History and analytics (Purchases ▸ History & analytics)

All figures come from the database, dated by each purchase's **supply date** (the date entered), falling
back to the day it was recorded:

| Function | Returns |
|---|---|
| `get_purchase_summary` | purchases, lines, units, spent, paid, outstanding, suppliers, products, first and last purchase, payments made in the period (by payment date) |
| `get_purchase_supplier_stats` | per supplier: purchases, spent, share, paid, outstanding, last purchase and amount |
| `get_purchase_product_stats` | per product: times bought, units, spent, average / lowest / highest / last / previous unit cost, last supplier; sortable, paged |
| `get_purchase_history` | every line of every purchase, newest first, paged |

Filters, shared by all four: period, search (product, supplier, barcode or batch), supplier, product.
Picking a supplier or product row narrows everything to it and shows its own summary. A product is
matched by id **or** name, so lines saved before products were recorded on them still count. Summary
lines are excluded from price statistics. All are `SECURITY INVOKER`: purchases' RLS scopes them.

The Purchases list also takes the period and a supplier (`get_purchases_page` gains `p_from`, `p_to`,
`p_supplier_key`; older clients' month / year calls still work).

**Periods** (`lib/datePeriods.js`, `components/PeriodFilter.jsx`): all time, a specific day, the week
(Monday to Sunday) around a day, a month, a year, a custom range (either end open), and presets (Today,
This week, This month, Last month, Last 30 days, This year). An incomplete period is all time, never
"nothing". Reports' `periodFilter.js` answers a different question and is unchanged.

## While recording (and editing)

- **Supplier:** a combobox over every supplier already bought from (`SupplierField.jsx`): arrows / Enter
  / Escape, outstanding balance in the list. A known supplier shows purchases, spent, paid, outstanding and
  the last purchase. A near-duplicate ("Medsupply Limited" for "MedSupply Ltd": punctuation, spacing and
  company suffixes ignored) shows "Use MedSupply Ltd". Leaving the field snaps a known supplier to its own
  spelling.
- **Product insight:** under each linked line, when it was last bought, from whom, at what unit cost
  (and the one before), the average, how often, and how the cost typed now compares (e.g. "+10% vs last
  price"). One request for the 500 most recently bought products; any other product is asked for alone.
- **Barcode:** a field on every line. Typing or scanning a code that belongs to a product links the line
  (details fill in, focus moves to Quantity). A linked product's barcode is shown read-only. A code for a
  product without one is saved on it; one that belongs to another product blocks the save. Phones and
  tablets with `BarcodeDetector` get a camera button (`lib/barcodeScanner.js`, now shared with the POS).
  An 8 to 14 digit "batch number" offers **Move it to Barcode**.

## Security

- Closes direct UPDATE / DELETE of purchases by signed-in clients (`purchases_guard_direct_write`,
  `current_user` test, as the sales guards). Definer functions (`record_purchase_payment`,
  `edit_purchase`) and the service role are unaffected; INSERT is unchanged. The only server-side writer
  found live was `record_purchase_payment`; the client's direct PATCH existed only in a fallback for
  databases without that function (live has it), now removed.
- `edit_purchase` and `get_purchase_for_edit`: `SECURITY DEFINER`, pinned `search_path`, membership then
  permission, every statement scoped to the purchase's business; actor from `auth.uid()`, the staff name is
  display only. Helpers (`can_edit_purchases`, `purchase_items_normalized`, `purchase_line_received`, the
  guard) are revoked from `PUBLIC`, `anon` and `authenticated`. Analytics are invoker; `anon` has EXECUTE
  on nothing here.
- Editing is a new power over stock and money: no preset role gets it, every edit needs a reason, and
  every edit is in `audit_log` with before and after.
- The role editor fix means a role's "Manage field team" switch now actually saves. Owners should check
  roles they saved before, which lost that permission.

## Rollout

1. Apply the migration as a tracked migration. Then re-read `proacl` for the new functions (Supabase
   grants `anon` EXECUTE on creation; the file revokes it, so confirm) and run the security advisor.
2. Deploy the app. Before the migration, the app degrades: History and Edit say "available once the
   latest database update is applied", the list loads without date / supplier filters and says so, and
   recording a purchase works as before. After the migration, an older app still records purchases and
   pays suppliers; only its direct-PATCH fallback (unused live) would be refused.
3. Verify with a rolled-back probe as a business owner: edit a ledger-era purchase up and down, try below
   the sold quantity, change the amount paid, and check that stock, the debt and the payment history agree.

Rollback: see the migration header.

## Tests

- DB: `node scripts/db-tests/purchaseEditing.pglite.mjs` (77 checks; needs
  `npm i --no-save @electric-sql/pglite`). Real Postgres with the live ledger snapshot, the real
  `receive_stock` and supplier-payment migrations, and purchases seeded the way the deployed client writes
  them (ledger-era, pre-ledger, summary, batch-tracked). It covers the backfill, the guard, the permission
  (Owner, granted role, rep, other business, anon), quantity up and down and the sold-units refusal,
  product change, removal, new product and batch, the pre-ledger base, the locked summary, payment
  corrections, supplier rename, barcodes, the cost rule, batch renumbering, concurrency, unchanged and
  retried edits, every analytics function, isolation and grants. `salesLedger`, `stockCount` and
  `shopOrderStock` still pass.
- App (`apps/carehub`, `npx vitest run`, 3020 passing): `EditPurchase.test.jsx`,
  `PurchaseHistory.test.jsx`, `Purchases.test.jsx` (the 11 existing behaviours unchanged on the shared
  form, plus supplier picker, duplicate warning, barcode link / save / conflict, batch-to-barcode, insight,
  who sees Edit), `suppliers.test.js`, `analytics.test.js`, `lineItems.test.js`, `purchaseInvoice.test.js`,
  `repositories/index.test.js`, `PeriodFilter.test.jsx`, `datePeriods.test.js`, `Staff.roles.test.jsx`
  (fails against the old role editor), `SupplierPayments.test.jsx`.
- Real Chromium at 390px and 1280px against stubbed REST (33 checks, no console errors): record with
  supplier pick, barcode and insight; edit and save; history, presets, product narrowing; no Edit for a
  Manager; no horizontal page overflow. This caught screen-reader-only text escaping the table scrollers
  on phones, which is fixed.

## Known limits / follow-ups

- Suppliers are still free-text names; a `suppliers` table (with merge of existing duplicates) would make
  grouping exact. The picker and duplicate warning reduce new duplicates but do not merge old ones.
- Adding a batch to a line that had none records it on the purchase but does not create a stock batch
  for an untracked product (a batch holding only part of the line's units would mislead).
- Line ids for purchases saved by the deployed client after this migration but before the app deploy are
  paired at edit time (by product name and quantity). Deploy the app promptly after the migration.
- `get_purchase_totals` (the three cards above the tabs) stays all-time; period figures are on the
  History tab.
- `planning/ROADMAP.md`, `planning/CODE_AUDIT.md` and `docs/PROJECT_OVERVIEW.md`, named in the
  engineering instructions, do not exist in the repository.
