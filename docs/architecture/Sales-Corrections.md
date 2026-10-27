# Sales corrections: held sales, Recent sales and Owner-only edit / refund / delete

Migration: `supabase/migrations/carehub_20261216_sales_owner_corrections.sql`
(**drafted, NOT applied**). Tests: `scripts/db-tests/salesCorrections.pglite.mjs`
(61 real-Postgres checks) plus the vitest suites listed at the end.

## What went wrong on 2026-10-27

Deleting (or resuming) a held sale did `UPDATE sales SET is_on_hold = false,
status = 'deleted' | 'resumed'`. The dashboard's *Sales today*, the POS *Recent*
list and the client history filtered on `is_on_hold = false` alone, so those rows
were counted as completed sales. Live at the time: 30 `deleted` and 5 `resumed`
rows. The Sales & Accounts report was already immune (`isCompletedSale`).

## The rules now

| Where | Who | What |
|---|---|---|
| POS ▸ Held | any seller | **Open & edit** (add/remove products, customer, note), save with **Hold**, or complete by charging. **No Delete**, for anyone. |
| POS ▸ Recent | any seller | **Reprint** only. No refund, edit, delete or repayment. |
| Financial Reports ▸ Transactions | search: anyone with the report; **Edit / Refund / Delete: the Owner only** | |
| Sales & Accounts (`/pos/report`) | | view, reprint, record repayments. No refund (moved to Financial Reports). |

"Owner" means the business login (or the owner of a parent business) or an active
staff row whose role is exactly `Owner` (`is_business_owner()`). Managers are not
owners. The screen only decides what is *offered*; the database enforces it.

## Held sales never become sales until completed

* A held sale is a `sales` row with `is_on_hold = true`. Opening it loads the cart
  and leaves the row untouched. Saving edits PATCHes its contents in place
  (`saleRepository.updateHeld`).
* Completing inserts a **new** completed sale carrying `resumed_from = <held id>`.
  An AFTER INSERT trigger (`sales_close_resumed_hold`) marks the held row
  `status = 'converted'` in the same transaction. The existing INSERT triggers
  then take stock and write the payments ledger exactly once; the same held sale
  cannot be completed twice (the second insert is rejected).
* Clients can no longer release, relabel or DELETE a held sale
  (`sales_guard_direct_update` / `_delete`). A held row never reaches the ledger,
  stock, debts or any total.
* Every read that means "sales" now uses the completed predicate
  (`is_on_hold = false AND status IS NULL OR 'completed'`): *Sales today*, Recent,
  credit/open sales, the sales count, Financial Reports.

## Owner corrections (Financial Reports ▸ Transactions ▸ open a transaction)

Each is one database function, one transaction, reason required (3–300 chars), and
writes an `audit_log` row (`sale.edited` / `sale.refunded` / `sale.deleted`,
`actor_type = 'owner'`, before/after snapshot). The detail view shows the history.

| | Sale row | Payments ledger (`sale_payments`, append-only) | Stock | Customer debt |
|---|---|---|---|---|
| **Edit** `edit_sale` | items, subtotal, discount, total, balance, credit flag, customer, `edited_at` recomputed **on the server** | unchanged (money that moved is a fact) | per-product and per-batch difference applied; batch changes journaled | updated, created or settled to match the new balance |
| **Refund** `refund_sale` | `refunded_amount` += amount | `refund` row (method, shift, who) | money only, as before | unchanged |
| **Delete** `delete_sale` | `status = 'deleted'`, balance 0, `deleted_at` (row kept for the audit) | reversing `refund` rows per method for what is still held | whole sale returned | removed |

Edit rules: at least one line; whole-number quantities above zero; non-negative
prices; discount ≤ subtotal; paid amount is capped at the old total (the cash
path stores cash tendered), so a **higher** total leaves a balance (credit) and a
**lower** one shows *refund due*. The refund cap is the ledger's net balance, so
an overpayment created by an edit can be refunded. `sales.items` keeps the app's
double-encoded shape (a JSON string) because screens `JSON.parse` it.

## Data consistency

After any correction the client invalidates `sales`, `salesReport`, `reports`
(and so the dashboard, Recent, Sales & Accounts and Financial Reports). Revenue
everywhere is **net of refunds** (`saleNet`): Financial Reports, *Sales today*,
the multi-branch overview. Deleted sales are not transactions in any of them.

## Security notes

* `edit_sale`, `delete_sale`, `refund_sale`: SECURITY DEFINER, `search_path`
  pinned, membership via `current_business_ids()`, then `is_business_owner()`;
  EXECUTE revoked from `PUBLIC`/`anon`. The helpers are not callable by clients.
* The guard triggers use `current_user`, so definer functions and the service
  role pass; a signed-in client PATCHing money columns of a completed sale, or
  DELETEing any sale, gets `42501`.
* `refund_sale` used to admit managers; it is now Owner-only (the request).

## Rollout

1. Apply `carehub_20261216_sales_owner_corrections.sql` as a tracked migration,
   then re-read `proacl` for the new functions (Supabase re-grants `anon`).
2. Deploy the app. **Order matters the other way too:** the new app calls
   `edit_sale`/`delete_sale` and sends `resumed_from`; without the migration those
   fail loudly (the Owner sees the server message) and resumed sales cannot
   complete. Ship them together.
3. Optional data repair (not done automatically): 5 live `resumed` rows are held
   carts that were opened and never charged. They are correctly excluded from
   totals now but are no longer listed under Held. Restore any the shop still
   wants with a one-off `UPDATE ... SET is_on_hold = true, status = NULL`.

## Known limits / follow-ups

* `docs/architecture/pending-migrations/carehub_20261211_sales_write_hardening.sql`
  (unapplied) grants clients `UPDATE (status, is_on_hold, notes)` and removes
  every other column; applied as-is it would re-allow release of held sales and
  block editing held contents. Reconcile it with this migration first (grant
  `items, subtotal, discount, total, balance, client_name, notes`, drop
  `status`/`is_on_hold`) and update its test.
* Refund stays money-only: returned goods go back through Inventory.
* Lines added in an edit have no batch attribution (product stock only).
* Changing the customer name on an edit detaches the sale from the customer
  record (`client_id` null).
* Sales & Accounts (`/pos/report`) no longer offers refunds; repayments remain.
* `planning/ROADMAP.md`, `planning/CODE_AUDIT.md` and `docs/PROJECT_OVERVIEW.md`,
  named in the engineering instructions, do not exist in the repository.

## Test plan

* DB: `node scripts/db-tests/salesCorrections.pglite.mjs`
  (needs `npm i --no-save @electric-sql/pglite`); `posAccounting` and `exportAudit`
  still pass.
* App (`apps/carehub`, `npx vitest run`): `POS.held.test.jsx` (no Delete; open
  leaves the row alone; re-hold updates the same row; completion sends
  `resumed_from`; Recent is Reprint-only), `Reports.transactions.test.jsx`
  (completed-only list, net revenue, search, full detail, Owner vs Manager),
  `transactionSearch.test.js`, `saleEdit.test.js`, `repositories/index.test.js`.
* Manual, after applying the migration, as Owner and as a Manager/cashier: hold a
  sale ▸ Held ▸ Open & edit ▸ add a product ▸ Hold; reopen ▸ charge ▸ confirm one
  sale, stock down once, Held empty, dashboard +1. In Financial Reports search by
  name/receipt/amount, open a sale, edit quantity, refund, delete; confirm the
  dashboard, *Sales & Accounts*, Debts and stock agree and the history lists each
  step. Repeat as a Manager: details open, no Edit/Refund/Delete.
