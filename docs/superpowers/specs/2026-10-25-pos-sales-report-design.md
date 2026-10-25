# POS Sales & Accounts Report: design

Date: 2026-10-25. Branch `feat/pos-sales-report`. The owner asked us to skip the
clarifying questions and start, so every product decision below that the request
did not settle is marked **(my call)**.

## Intent

A cashier closes the till and must be able to say, accurately: what was sold,
what money actually came in (by cash / transfer / POS), what is still owed and by
whom, what was refunded or discounted, and who handled each transaction. The
owner must be able to see the same thing per staff member and per shift. The
request's own example is the test: a ₦100,000 sale paid ₦70,000 shows ₦100,000
sales, ₦70,000 received, ₦30,000 outstanding.

It is an accounting and reconciliation feature, not a sales-history list.

## What the POS records today (live schema, checked 2026-10-25)

The report cannot be built honestly on the current data. Recon found:

| Need | Today | Consequence |
|---|---|---|
| Who handled a sale | `sales.staff_name` exists but the POS never writes it (3 of 120 rows set) | No accountability possible |
| Shifts | No table, no concept | Cannot filter by shift |
| Money received over time | A credit collection overwrites the original sale's `amount_paid` | A repayment today is counted on the day of the original sale; "received this week" is wrong |
| Refunds | None at the POS (`refunds` is CareFind's online-payment table) | Refund total would always read zero |
| Sale vs debt agreement | Debts page "mark paid" updates the debt only | The sale still shows a balance after the debt is settled |
| Integrity | `sales` policy is `ALL` for every member | Any cashier can PATCH any sale's totals or paid amount after the fact |
| Day boundaries | `created_at` is `timestamp without time zone`, UTC | Sales between 00:00 and 01:00 Lagos time fall on the previous day if the day is cut in UTC |
| Change given | Cash `amount_paid` stores the cash tendered (1 live row has `amount_paid > total`) | Received money must be `least(amount_paid, total)` |
| Credit deposit method | The credit-sale path records a deposit with no method | Cannot place it in cash / transfer / POS |

## Goals

1. Report page reachable from a new icon beside the barcode button in the POS
   search bar, available wherever the POS is (POS is enabled for every business
   type, so the report is too).
2. Period filter: today, yesterday, this week, this month, this year, custom range.
3. Filters: customer, product, payment method, payment status, cashier, shift.
4. Transactions table: receipt ID, date, customer, products, quantities, total,
   amount paid, outstanding, payment method, payment status, cashier.
5. Summary: total sales, payments received, cash / transfer / POS breakdown,
   credit sales, outstanding, refunds, discounts, transaction count. Every
   figure recomputes from the same filtered set. Summary stays visible while
   the list scrolls.
6. Every transaction (and every payment) identifies the staff member, stamped by
   the database so it cannot be forged by the client.
7. Transaction detail, print, PDF, Excel export of the filtered records.
8. No profit or cost figures anywhere in the report or its exports.
9. The checkout flow is unchanged except two small, opt-in additions (a deposit
   method on credit sales, an optional shift open/close).

## Non-goals

- Restocking on refund. A refund returns money only; returned goods go back
  through Inventory's existing stock adjust. **(my call)**: restock-on-refund
  touches the batch/FEFO allocation triggers and deserves its own design.
- Profit, margin, cost-of-goods. Already in the owner's Finance reports.
- Rewriting the existing Reports hub. This report is the till's.
- Server-side aggregation. Volumes are small (120 sales platform-wide); the
  date range is filtered in the database and the rest in the browser. Noted as
  the scaling path below.

## Anti-goals (would make this a failure even if it "works")

- A received figure that counts change handed back, or counts a repayment on
  the wrong day.
- A cashier identity the client chose.
- A checkout that breaks or slows because the new database objects are not yet
  applied in production.

## Design

### Data (two migration files, drafted, NOT applied)

**Migration 1: `carehub_20261210_pos_accounting.sql` (in `docs/architecture/pending-migrations/` until applied)**

1. `pos_shifts`: `id, business_id, opened_by uuid (auth user), staff_id
   (nullable: the owner has no staff row), staff_name, opened_at timestamptz,
   opening_float numeric >= 0, closed_at, counted_cash, expected_cash,
   close_note`. One open shift per (business, user), enforced by a partial
   unique index. Written only through `open_pos_shift(p_business_id,
   p_opening_float)` and `close_pos_shift(p_shift_id, p_counted_cash, p_note)`;
   `expected_cash` is computed by the server at close (float + cash received −
   cash refunded during the shift). Shifts are optional **(my call)**: a sale
   rung up with no open shift is reported under "No shift". Forcing shifts
   would change the checkout workflow, which the request rules out.

2. `sales` gets `cashier_user_id uuid`, `cashier_staff_id uuid`, `shift_id
   uuid`, `refunded_amount numeric default 0`. A `BEFORE INSERT` trigger
   overwrites `cashier_*`, `staff_name` and `shift_id` from `auth.uid()` /
   `auth.email()` (staff row by `auth_user_id`, then by email; owner via
   `businesses.email`, named from `owner_name`/`owner`). A client value is
   ignored. Known limitation: an offline-queued sale is stamped with whoever
   is signed in when it syncs. Normally that is the same person on the same
   device. Recorded, not fixed.

3. `sale_payments`, an append-only ledger: `id, business_id, sale_id, kind
   ('sale' | 'collection' | 'refund'), method ('Cash' | 'Transfer' | 'POS'),
   amount numeric > 0, received_at timestamptz, received_by, staff_id,
   staff_name, shift_id, note`. No client INSERT/UPDATE/DELETE grant; members
   SELECT (`TO authenticated`). Written by:
   - `AFTER INSERT` on `sales` (completed, non-held sales): one row per method.
     Split uses `payment_split`; the credit deposit uses `payment_split` too
     (the POS now sends it); otherwise the single `payment_method`. Amount is
     capped at `least(amount_paid, total)` so change is never counted.
   - `record_sale_payment(p_sale_id, p_amount, p_method)`: a credit collection.
     Atomically appends the ledger row, updates the sale's `amount_paid` /
     `balance` / `is_credit`, and settles the matching `credit_sale` debt.
     The amount is clamped to the outstanding balance. Used by the POS Credit
     tab and by the Debts page for debts that came from a sale.
   - `refund_sale(p_sale_id, p_amount, p_method, p_reason)`: an owner or
     manager role only (server-checked, mirroring `isManagerRole`). Appends a
     refund row and increments `sales.refunded_amount`, capped at what was
     received net of earlier refunds. A reason is required.
   - Backfill: one `kind='sale'` row per existing completed sale from
     `least(amount_paid,total)` at `created_at`, method from
     `payment_method` (Credit deposits → `Cash`, flagged in `note` as
     backfilled). Historical collections cannot be separated from the original
     payment and stay on the sale's date. This is documented in the report's help text.

4. `record_export_audit` allow-list gains `sales_report.xlsx` and
   `sales_report.pdf`; the permission check is unchanged (Owner, or a custom
   role with `canExportReports`).

Every function: pinned `search_path`, explicit membership check through
`current_business_ids()`, `REVOKE … FROM PUBLIC, anon` then **verify
`pg_proc.proacl` after apply** (known Supabase default-privilege trap).

**Migration 2: `carehub_20261211_sales_write_hardening.sql`** (separate, so it
can be reviewed and applied on its own). Column-level grants on `sales`:
`authenticated` keeps INSERT and SELECT, and UPDATE only on `status,
is_on_hold, notes`. DELETE is revoked. Money columns change only through the
functions above. This is what makes the report an accounting record, not a
figure any cashier can edit. Every current client write was checked: the only
money-column PATCH is `collectCredit`, which moves to `record_sale_payment`.

### Reading and computing (client)

- `modules/pos/repositories`: `createShiftRepository` (current open shift,
  list, open, close) and `createPaymentRepository` (ledger in a range, by sale,
  record collection, refund), on the existing injected-transport seam.
  `saleRepository.getRange(businessId, fromIso, toIso)` uses `pagedQuery`.
- `modules/pos/salesReport.js`: pure functions, no React:
  `periodRange(period, {now, from, to})` (local-day boundaries converted to UTC
  strings matching the `timestamp without time zone` column), `paymentStatus(sale)`
  (Paid / Part-paid / Unpaid / Refunded / Part-refunded), `filterSales`,
  `summarise(sales, payments)`, `toReportRows`.
- Semantics, so the numbers reconcile:
  - **Total sales** = Σ total of completed sales whose date is in the period.
  - **Received** = Σ ledger receipts (`sale` + `collection`) with `received_at`
    in the period, split Cash / Transfer / POS. A repayment counts on the day
    the money came in.
  - **Refunds** = Σ ledger refunds in the period. **Net received** = received − refunds.
  - **Outstanding** = Σ current balance of the period's sales.
  - **Credit sales** = count and value of the period's sales not fully paid at the till.
  - **Discounts** = Σ discount. **Transactions** = count of the period's sales.
  - Cashier and shift filters apply to the sale's cashier for sales figures and
    to the payment's receiver for money figures (whoever took the money is the
    one who must account for it). The summary labels say which.
  - When one shift is selected, the summary adds opening float, expected cash in
    drawer and, once closed, counted cash and the difference.
- Who sees what **(my call)**: roles with `canViewReports` (Owner, Manager,
  custom roles granted it) see every cashier and get the cashier filter. Other
  POS roles (Cashier, Pharmacist, Therapist) see only the sales and payments
  they handled. **This is a screen rule, not a security boundary**: the
  existing `sales` policy lets every member read every sale, and the POS
  Recent/Held tabs already show all of them. Tightening reads would break those
  tabs; it is listed as a follow-up.

### Screen

- Route `/dashboard/pos/report`, behind the same `pos` guard. The POS search bar
  gets a `FileBarChart` icon button beside the camera (same 42px tile, white
  with border so the scan button stays the primary action).
- Layout: header (title, back to POS, shift control, Print / PDF / Excel), a
  sticky summary band, filters (period pills + custom range; a "More filters"
  row that is open on desktop and collapses on mobile), then the list: a table
  that scrolls inside its own card on desktop and cards on mobile.
- Row → detail modal: line items, payments history (each with who and when),
  cashier, shift, reprint receipt, and for managers a refund action.
- States: loading, error with retry, empty for "no sales in this period" vs
  "no sales match these filters", and a "not available yet" state when the
  ledger is missing (migration not applied). In that state the report still
  shows sales from `sales` alone, with an explicit notice that received and
  refund figures are unavailable. It never shows wrong numbers silently.
- Print/PDF follow the repo's established pattern (`ADR-Exports.md`): a
  print-ready HTML document opened in a new window; "PDF" is the same document
  through the browser's Save as PDF. No new dependency. **(my call)**
- Excel through `exceljs` (already a dependency), formula-neutralised text
  cells, audited through `record_export_audit` before download, refused if the
  role may not export. Printing is not gated. A cashier must be able to hand
  the owner a paper report.

### Checkout changes (minimal)

- Credit sale with a deposit: Cash / Transfer / POS chips appear under the
  "amount paid now" field (default Cash), sent as `payment_split`.
- `collectCredit` and Debts "mark paid" (for `credit_sale` debts) call
  `record_sale_payment`, which fixes the sale/debt disagreement. A collection
  also asks for the method (default Cash).
- Optional "Open shift" / "Close shift" control in the POS header area.

### Deployment order

The client must not reach production before the database objects exist, or
collections and the report would fail. Order: apply migration 1, verify
(catalog + behavioural rollback test), apply migration 2, verify, then merge.
The client also degrades: if `record_sale_payment` is missing (PGRST202) the
collection falls back to the old two-step write, and the report shows its
"not available" notice.

## Scaling path (not built)

Past a few thousand sales per range, move `summarise` into a SQL function
returning the aggregates, keep the list paged.

## Follow-ups to record

- Tighten `sales` SELECT for non-reporting roles (needs Recent/Held redesign).
- Restock on refund.
- `sales.items` carries each product's `cost_price` (the cart spreads the whole
  product row), so any member can read cost prices from sales. The report never
  shows them; the write should strip them. Separate fix.
