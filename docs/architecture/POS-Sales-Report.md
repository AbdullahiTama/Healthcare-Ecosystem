# POS Sales & Accounts report

The till's accounting and reconciliation view. A cashier reconciles what was
sold against the money that actually came in; an owner or manager can do the
same per staff member and per shift.

Design and decisions: `docs/superpowers/specs/2026-10-25-pos-sales-report-design.md`.

## Where it is

- POS search bar → the receipt icon beside the barcode button → `/dashboard/pos/report`.
- Guarded by the `pos` permission, and POS is enabled for every business type,
  so the report exists wherever there is a till.

## Status

| Piece | State |
|---|---|
| Client (report, detail, shifts, exports, deposit method, collections) | Merged to `main` and deployed 2026-10-27 (PR #36, `99055c2`) |
| `carehub_20261210_pos_accounting.sql` | **APPLIED live 2026-10-26** (tracked as `20261026221943`), verified: ACLs (no anon; internals not executable by signed-in users), behavioural rollback test as a real Cashier, backfill 183 sales / ₦4,660,975.00 matching the pre-apply total, advisors +4 expected WARNs only |
| `carehub_20261211_sales_write_hardening.sql` | **APPLIED live 2026-10-27** (tracked as `20261027012946`) after PR #36 deployed, verified: `anon` has no privileges on `sales`; `authenticated` keeps SELECT/INSERT and UPDATE on `status, is_on_hold, notes` only; a rolled-back run as a real Cashier showed hold/resume still works, direct edits to amount_paid/total/staff_name and DELETE are refused, Collect via `record_sale_payment()` works |

Before migration 1 was applied the report still worked on `sales` alone. It shows
a notice that money figures are estimated, hides the Payments tab, shift
controls, refunds and repayments from the detail view. Collections in the POS
and Debts fall back to the previous writes.

## How the figures are defined

All arithmetic lives in `apps/carehub/src/modules/pos/salesReport.js` (tested in
`salesReport.test.js`). The page and both exports read from it.

| Figure | Definition |
|---|---|
| Total sales | Σ `total` of completed sales created in the period |
| Payments received | Σ ledger rows of kind `sale` + `collection` received in the period, split Cash / Transfer / POS |
| Refunds | Σ ledger rows of kind `refund` in the period |
| Net received | received − refunds |
| Cash in hand | cash received − cash refunded |
| Credit given | per sale, `total` − what was paid at the till (ledger kind `sale`) |
| Outstanding | Σ current `total − least(amount_paid, total)` of the period's sales |
| Discounts | Σ `discount` |
| Transactions | count of completed sales |
| Expected cash (shift) | opening float + cash taken − cash refunded in that shift |

- **Completed sale**: `NOT is_on_hold AND status IS NULL OR 'completed'`.
- **Received excludes change**: the cash path stores the cash tendered in
  `amount_paid`, so money is always `least(amount_paid, total)`.
- **A repayment counts on the day the money came in**, not on the sale's date.
- **Cashier and shift filters**: sales figures follow who made the sale; money
  figures follow who received it.
- **Days** are the device's local calendar. `sales.created_at` is
  `timestamp without time zone` holding UTC, so zone-less values are read as
  UTC (`parseDbTime`).
- **No cost or profit figure** appears on the page or in either export.

## Data (migration 1)

- `sales.cashier_user_id / cashier_staff_id / staff_name / shift_id`: stamped
  by the `sales_stamp_actor` BEFORE INSERT trigger from the caller's session.
  A value sent by the client is overwritten. A service-role insert (no user)
  is left as sent.
- `sale_payments`: append-only ledger. Clients may only SELECT their own
  business's rows. Written by the `sales_record_payments` AFTER INSERT trigger,
  `record_sale_payment()` and `refund_sale()`. Existing completed sales were
  backfilled (`backfilled = true`); historical repayments were already merged
  into `amount_paid` and stay on the sale's date.
- `pos_shifts`: `open_pos_shift()` / `close_pos_shift()`. Optional. One open
  shift per person per business. The opener, the owner or a manager can close
  it; the server computes expected cash.
- `refund_sale()`: owner or manager role (`is_business_manager`), reason
  required, capped at what was received net of earlier refunds. Money only;
  returned stock goes through Inventory.
- `record_export_audit()` allow-list gains `sales_report.xlsx`.

Migration 2 restricts client UPDATE on `sales` to `status, is_on_hold, notes`
and removes DELETE and every anon grant, so money columns change only through
the functions above.

## Who sees what

| Role | Sees | Cashier filter | Excel | Refund |
|---|---|---|---|---|
| Owner | all staff | yes | yes | yes |
| Manager / any role with `canViewReports` | all staff | yes | if `canExportReports` (server-checked) | if role name contains "manager" |
| Cashier, Pharmacist, Therapist | own transactions only | no | no | no |

The "own transactions only" rule is a **screen rule**. The `sales` policy lets
every member read every sale, and the POS Recent/Held tabs rely on that.
Tightening reads is a follow-up.

## Exports

- **Print / PDF**: a print-ready HTML document (`buildSalesReportHtml`); the
  browser's Save as PDF produces the file (same pattern as `ADR-Exports.md`).
  Not gated.
- **Excel**: `exceljs`, Summary + Transactions sheets, formula-neutralised text,
  recorded through `record_export_audit('sales_report.xlsx')` before the file
  is saved. A refusal cancels the download.

## Applying the migrations

1. `get_advisors` (security) baseline.
2. Apply `carehub_20261210_pos_accounting.sql` with `apply_migration`, then
   move it to `supabase/migrations/`.
3. Verify the catalog: `select proname, proacl from pg_proc where proname in
   ('open_pos_shift','close_pos_shift','record_sale_payment','refund_sale','pos_actor','pos_split_payments')`.
   Expect `authenticated` on the four public functions, no `anon` anywhere, and
   no `authenticated` on `pos_actor` / `pos_split_payments`. Supabase re-grants
   EXECUTE to anon at creation time: if it is there, revoke it in a follow-up migration.
4. Verify behaviour inside a `DO` block that ends in `RAISE EXCEPTION` (rolls
   back): insert a sale as an authenticated staff member with a forged
   `staff_name`, confirm it is overwritten and one ledger row exists.
5. Confirm the backfill count equals the completed-sale count with money received.
6. Apply `carehub_20261211_sales_write_hardening.sql`; re-check
   `information_schema.column_privileges` for `sales`.
7. `get_advisors` again and compare.
8. Only then merge the client.

## Tests

| File | Covers |
|---|---|
| `scripts/db-tests/posAccounting.pglite.mjs` | 99 real-Postgres checks: stamping, ledger, change, split, shifts, collections, refunds, read-only ledger, ACLs, backfill, hardening |
| `src/modules/pos/salesReport.test.js` | every summary figure, periods, filters, rows |
| `src/modules/pos/salesReportExport.test.js` | Excel sheets, formula neutralising, HTML escaping, no cost data |
| `src/modules/pos/repositories/accounting.test.js` | tenant scoping, paging, RPC payloads, missing-migration detection |
| `src/modules/pos/SalesReport.test.jsx` | states, filters move figures, cashier sees own only, estimated notice |
| `src/modules/debts/Debts.settle.test.jsx` | credit-sale debt settles the sale; fallback; manual debts unchanged |
| `src/modules/pos/POS.barcode.test.jsx` | report button navigates |

## Known limitations and follow-ups

- An offline-queued sale is stamped with whoever is signed in when it syncs.
- Restock on refund is not built.
- `sales.items` carries each product's `cost_price` (the cart spreads the whole
  product row), so any member can read cost prices from sales via the API. The
  report never shows them; the POS write should strip them.
- Read access to `sales` for non-reporting roles is not narrowed (see above).
- Summary is computed in the browser; past a few thousand sales per range,
  move it into a SQL function.
