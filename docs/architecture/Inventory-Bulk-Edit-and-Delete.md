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
- Bulk delete: see §7.
- Rules `modules/clients/clientBulkEdit.js`; dialog `modules/clients/components/ClientBulkEditModal.jsx`.
- Tests: `clients/clientBulkEdit.test.js`, `clients/repositories/index.test.js` (updateMany),
  `clients/Clients.bulkEdit.test.jsx` (mark and edit, select all with one request, per-client notes, retry, ticking
  does not open details). CareHub suite: 3,533 tests pass; lint 0 errors; build passes.

## 7. Clients: delete selected and restore (added 2026-11-10)

Database: `supabase/migrations/carehub_20270111_client_bulk_delete.sql` (same design as products), applied to
production 2026-11-10 with the owner's approval and probed (results in its header).

- Why a function: live foreign keys (2026-11-10) refuse deleting a client with sales, appointments or consultations,
  silently unlink their debts and customer requests (SET NULL), and cascade away client visits that point at them.
- `delete_clients(business, client_ids)`: keeps, with every reason, clients with sales, appointments,
  consultations, debts, customer requests or linked client records / visits; copies the rest into `deleted_clients`
  and deletes them; one `audit_log` entry (`clients.deleted`). Who: the Owner or a role allowed to delete
  (`can_delete_clients`, not callable by app users directly).
- `restore_deleted_clients(business, deletion)`: puts them back with their ids; a client whose phone number is now
  used by another client of the business is skipped and counted (the phone is unique per business); audited.
- App: **Delete selected** in the Clients selection bar and **Recently deleted** among the page buttons, for the
  Owner and roles allowed to delete; the result lists who was kept and why ("Ada Obi: has sales, has debts") and
  offers **Undo**. The shared client list drops exactly the deleted clients at once.
- Shared with Inventory: `lib/bulkDelete.js` (refusal sentences, grouping deletions), `components/RecentlyDeletedModal.jsx`
  (now takes a `noun`), `components/SelectionBar.jsx`.
- Security: no access widened (any member may DELETE clients through the API today; the function is stricter);
  SECURITY DEFINER, search_path pinned, caller checked first, one business; EXECUTE authenticated only.
  `deleted_clients` holds personal data for restore under the same access rule as `clients` (members read; no client
  writes; anon nothing).
- Tests: PGlite `apps/carefind/src/test/clients/clientBulkDelete.db.test.js` (7: kept reasons for every linked kind,
  copies and audit, debts stay linked, other business / unknown ids untouched, who may delete, restore, phone clash,
  table access); `lib/bulkDelete.test.js`; `clients/repositories/index.test.js`; `clients/Clients.bulkEdit.test.jsx`
  (delete with kept list and Undo, Recently deleted, a role without delete permission). CareHub suite: 3,541 tests pass.


## 8. Expenses: mark, edit, delete and restore (added 2026-11-10)

Database: `supabase/migrations/carehub_20270112_expense_bulk_delete.sql`.

- **Mark and edit** (anyone who can log expenses): a tick box per row, "Select all N shown" (follows the filters),
  **Edit selected**: **category**, **date** (not in the future) and the **staff name as entered**. Not here on
  purpose: amounts and anything paid (payments go through Record payment; the database refuses a direct change to
  the paid amount) and who recorded it (stamped by the database). Rules `modules/expenses/expenseBulkEdit.js`; dialog
  `modules/expenses/components/ExpenseBulkEditModal.jsx`.
- **Delete selected** and **Recently deleted** (Owner or a role allowed to delete, as the existing Delete button):
  `delete_expenses()` copies each expense **with its payment history** into `deleted_expenses`, deletes it (the
  history cascades as before, but is kept in the copy) and audits (`expenses.deleted`, with the total). No expense is
  "kept back": nothing else depends on an expense. The single **Delete** button uses the same path (Undo in the
  toast; plain delete before the migration).
- **Restore** (`restore_deleted_expenses()`) puts each expense back exactly: same id, amount, date, original recorder
  and its original payment rows, then the paid amount through the payment guard's own switch. To keep the original
  recorder, the function clears the request identity for its own insert only (the recorded-by stamp skips when there
  is no identity) and restores it straight after; the audit entry names who restored.
- **Shared parts (one copy for all three pages):** `components/SelectionBar.jsx`, `components/BulkEditShell.jsx`
  (Update button, progress, result, retry; Inventory's and Clients' bulk-edit dialogs now use it too),
  `components/BulkDeleteModal.jsx` (Clients and Expenses; Inventory keeps its own dialog for the delete-all flow),
  `components/RecentlyDeletedModal.jsx`, `lib/bulkUpdates.js`, `lib/bulkDelete.js`. New permission helper in the
  database: `member_can_delete()` (the product and client functions carry the same rule inline; consolidating them
  is a later clean-up).
- **Security:** no access widened; SECURITY DEFINER, search_path pinned, caller checked first, one business; EXECUTE
  authenticated only; `member_can_delete()` not callable by app users; `deleted_expenses` readable by members only.
- **Tests:** PGlite `apps/carefind/src/test/expenses/expenseBulkDelete.db.test.js` (6: copies with payment history and
  audit total; other business / unknown ids untouched; who may delete; exact restore of amount, paid amount,
  recorder and payment rows with no invented payment; restoring twice; the restorer's identity is back afterwards;
  table access); `expenses/expenseBulkEdit.test.js`; `expenses/repositories/index.test.js`;
  `expenses/Expenses.bulk.test.jsx` (edit in one request, permissions, delete with Undo and restore, single Delete with
  Undo and fallback, Recently deleted). CareHub suite: 3,551 tests pass.
