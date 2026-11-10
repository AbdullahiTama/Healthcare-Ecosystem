# Inventory: mark and edit in bulk, delete in bulk, delete all and re-upload, restore

Status: built and live 2026-11-10. Database: `supabase/migrations/carehub_20270109_inventory_bulk_delete.sql` and
`carehub_20270110_restore_respects_plan_limit.sql`, both applied with the owner's approval and probed (results in
their headers). Without them (another environment) bulk delete says the update is needed and single delete works as
before.

Related: [Inventory-Large-Catalogs.md](Inventory-Large-Catalogs.md), [Inventory-Duplicate-Merge.md](Inventory-Duplicate-Merge.md),
[Stock-Ledger.md](Stock-Ledger.md).

## 1. What was asked, and what was there

The owner asked for bulk edit in Inventory: mark products, edit them together, and a way to delete everything and
upload the list again. Before: one product at a time (Edit, Del), CSV upload that skips existing names, Excel export.

Live facts (2026-11-10): 9,930 products, up to 3,203 in one business. A plain `DELETE` of a product **cascades away**
its customer reviews, online-shop listing and lines in past stock counts, is **refused** when the product is in a shop
order, an internal order or has stock batches, leaves its stock out of the stock ledger, and records nothing. A bulk
`DELETE` would fail entirely on one such product, or silently destroy customer-facing data.

## 2. Mark and edit (app only)

- A checkbox on every row (and "Select all N shown", which follows the current search and filters). A bar shows
  "N selected · Clear · Edit selected · Delete selected".
- **Edit selected** (roles that can edit products or prices): category, selling price and cost price (set to an
  amount, or increase / decrease by a percentage, rounded to kobo), reorder level (not applied to services), shelf,
  CareFind listing. Empty fields stay as they are. Prices need the price permission, as in the single-product form.
- Before saving it shows how many products will really change (products that already match are left out) and a few
  "before → after" lines. Products with identical changes are saved in one request per 100
  (`productRepository.updateMany`); a percentage gives each product its own price. Failures are listed and can be
  retried; what saved is applied to the list at once.
- **Not bulk-editable on purpose:** stock (only through the stock ledger: Add stock, sales, stock counts) and
  tracking mode (only through `set_product_tracking_mode()`).
- Rules: `modules/inventory/bulkEdit.js` (pure); dialog: `components/BulkEditModal.jsx`.

## 3. Delete selected, delete all and re-upload, restore (database function)

`delete_products(business, product_ids, all, confirm)`, one transaction:
- **Keeps**, and returns with every reason, products in shop orders or internal orders, with stock batches, customer
  reviews, an online-shop listing or past stock counts. The page lists them ("Reviewed cream: has customer reviews").
- Writes each deleted stocked product's stock off in the ledger (`stock_movements` `write_off`, source
  `product_deleted`), copies the full row into `deleted_products`, deletes it, and writes one `audit_log` entry
  (`inventory.products_deleted`).
- Who: the Owner, or a role with delete permission (same rule as merging duplicates). **All products: Owner only,
  with the typed phrase `DELETE ALL PRODUCTS`.**

`restore_deleted_products(business, deletion)` puts a deletion back with the same ids, prices and stock (the opening
stock trigger records the stock again). A product whose name is now taken (for example after a re-upload) or that is
back already is skipped and counted, so restoring never duplicates. Audit-logged (`inventory.products_restored`).
Restore stops at the plan's product limit (Basic: 5,000) and says how many it could not bring back; the plan trigger
does not run for the function's own inserts, so the function checks the limit itself. An expired plan does not block
a restore (undoing a deletion is not adding products).

In the app (`components/DeleteProductsModal.jsx`, `components/RecentlyDeletedModal.jsx`):
- **Delete selected** from the selection bar. The single **Del** button uses the same function (so a linked product
  is kept with the reason instead of losing its reviews or failing), with Undo in the toast; before the migration it
  falls back to the previous delete.
- **Delete all & re-upload** (Owner): explains what is kept; step 1 downloads an Excel copy in the upload template's
  column order (edit it, save as CSV, upload it back), or a box to confirm a copy is not needed; step 2 asks for the
  typed phrase. The result shows deleted / kept, **Undo**, and **Upload your new list** (opens the CSV upload).
- **Recently deleted**: every bulk deletion (when, by whom, how many, first names) with **Restore**.
- Held sales that include a deleted product can still be charged (the sale price guard skips unknown products); past
  sales and reports keep their figures.

## 4. Security implications

- No access is widened. Today any member may `DELETE` products through the API (RLS); the functions are stricter
  (owner or delete-permission role; all products owner-only with confirmation). SECURITY DEFINER, search_path
  `public, pg_temp`, caller checked first, one business only. EXECUTE: authenticated; anon revoked.
- `deleted_products`: RLS; members SELECT their business's rows (product data they could already read); no client
  writes; anon nothing.
- Customer-facing and order records are never deleted; products tied to them are kept.
- Bulk edit uses the existing product UPDATE path (RLS, the price-source trigger, the CareFind rep-account guard); it
  sends only the changed fields.

## 5. Test plan

Automated (CareHub 3,523 tests pass; lint 0 errors; build passes):
- PGlite `apps/carefind/src/test/inventory/inventoryBulkDelete.db.test.js` (10, including the plan limit), with the live foreign keys and ON
  DELETE rules: selected delete keeps every linked kind with its reasons, writes stock off (not for services or zero
  stock), keeps copies, audits, nulls the SET NULL references; other business / unknown ids not touched; who may
  delete; delete all owner-only with the exact phrase and this business only; restore with ids, prices, stock and
  ledger; no duplicates on restore; deleted_products access.
- `inventory/bulkEdit.test.js` (validation, plan, percentages, grouping, runner failures/progress),
  `inventory/repositories/index.test.js` (request shapes, chunking, grouping deletions, error translation),
  `inventory/Inventory.bulk.test.jsx` (9: select and edit, select all and retry, permissions, delete selected with
  kept list and Undo, delete all with backup and typed confirmation then upload, manager cannot delete all, Del keeps
  a linked product, Del fallback before the migration, Recently deleted restore).

Manual after applying:
1. Mark three products, Edit selected, increase selling price by 10%: the preview and the saved prices match.
2. Mark a product with a shop listing and a plain one, Delete selected: the plain one goes, the listed one is kept
   with its reason; Undo brings the first back.
3. As the Owner, Delete all & re-upload on a test branch: download the copy, type the phrase, delete, upload the CSV;
   then Recently deleted shows the deletion (restore skips the names re-uploaded).

## 6. Clients: mark and edit (added 2026-11-10, app only)

The same marking as Inventory (shared `components/SelectionBar.jsx`; grouping and sending shared in
`lib/bulkUpdates.js`, which Inventory's `bulkEdit.js` re-exports): a tick box on each client card, "Select all N
shown" (follows search and filters), **Edit selected**.

- Fields: **gender**, **address**, and **Add a note**, which is added to the end of each client's notes with
  today's date (`2026-11-10: …`), so existing notes are never overwritten; notes are capped at 2,000 characters,
  keeping the newest text. Empty fields stay as they are; clients already matching are not counted or sent.
- Not editable in bulk on purpose: name, phone (also the duplicate check, unique per business) and email are each
  client's own; visits and total spent are kept by the database from sales.
- Saving: identical changes go in one request per 100 (`clientRepository.updateMany`), each client's note in its own;
  saved rows go straight into the shared client cache (`useUpdateManyClients`), so POS, Debts and every client picker
  see them at once; failures are listed and can be retried.
- Who: anyone who can open Clients (the same people who can add clients; RLS: members of the business).
- No bulk delete for clients: a client with sales, appointments or consultations cannot be deleted (live foreign keys,
  2026-11-10), and deleting one would unlink their debts. It would need the same server-side safeguards as products.
- Rules `modules/clients/clientBulkEdit.js`; dialog `modules/clients/components/ClientBulkEditModal.jsx`.
- Tests: `clients/clientBulkEdit.test.js`, `clients/repositories/index.test.js` (updateMany),
  `clients/Clients.bulkEdit.test.jsx` (mark and edit, select all with one request, per-client notes, retry, ticking
  does not open details). CareHub suite: 3,533 tests pass; lint 0 errors; build passes.
