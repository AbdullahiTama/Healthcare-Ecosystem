# Client totals, debt filter totals, and held-sale invoices

Status: built 2026-10-28. Database part: `supabase/migrations/carehub_20261220_client_totals_and_held_sales.sql`.

## 1. Client visits and total spent

**Finding (live data, 2026-10-28).**
- Nothing ever updated `clients.visit_count` or `clients.total_spend` after a client was created. All 13 clients read 0
  visits, while 5 had completed sales.
- 375 sales carry a customer name but no `client_id`. 345 of them are "Walk-in"; 19 name exactly one client of their
  business.
- The till linked a sale only when the typed name matched exactly, including capitals, so "musa" never linked to
  "Musa".

**Fix.**
- **Database:** `refresh_client_totals(client ids)` recomputes visits and spend for those clients.
  - Visits are the client's completed sales: not on hold, status empty or `completed`, not deleted.
  - Spend is their total less refunds.
  - The trigger `sales_refresh_client_totals` runs it on every insert, delete, and change of client, total, refund,
    status, hold or deletion.
  - Every client is recomputed once when the migration is applied.
- **Backfill:** unlinked sales are linked to their client when the name matches exactly one client of the same
  business. Case and surrounding spaces are ignored, and "Walk-in" never matches.
- **Till:** `resolveClientId` uses the same rule (`customerPick.exactClient`), so a typed name links whatever its
  capitals. Two clients with the same name are never guessed between. Held sales now store the client link too.
- **App:** after a sale, the clients list is refreshed (`useInvalidateSales` also invalidates `clients`).

## 2. Debt totals for a filter

When a search or month filter is active, the Debts page shows a summary for the matching debts:
- how many debts match;
- the outstanding amount owed to the business, with how many of those are still open;
- what the business owes, if the matches include suppliers.

The search ignores case and extra spaces. When nothing matches, the page says so and offers **Clear filters**. The
arithmetic is in `debts/debtTotals.js`.

## 3. Held sales

**Finding (live data).**
- **Converted rows left open.** Charging a held sale inserts a new paid sale with `resumed_from`, and
  `sales_close_resumed_hold` marked the held row `converted`, but left it `is_on_hold = true` with its whole total as
  balance. 24 rows read as still held and unpaid.
- **Legacy rows double-counted.** 19 older held rows (`HLD…`, payment method "On Hold", nothing paid) had been flipped
  to `completed` by the till before carehub_20261216. Each had also been charged as its own paid sale, so they counted
  twice in revenue and read as unpaid sales.

**Fix.**
- **Closing a charged held sale:** the held row is now set to `is_on_hold = false`, `balance = 0` and
  status `converted`. The 24 existing rows are closed the same way.
- **The 19 legacy rows** become `resumed`, the status the till already uses for a held row that was reopened and
  charged as a new sale. None has a payment, stock movement or debt attached.
- **The completed sale is the record:** it carries the payment method, amount paid and balance (a balance only for a
  credit sale or a shortfall). A held sale still cannot be charged twice.
- **Invoices:**
  - **Held Sales → Print invoice** prints any held sale.
  - **Hold → Hold & print invoice** holds the cart and prints its invoice.
  - The invoice uses the receipt layout (`receiptPrint.buildReceiptHtml`, with `kind: 'invoice'`). It is titled
    INVOICE and shows the invoice number, customer, items, total, "Amount paid ₦0", AMOUNT DUE and "Not paid". It also
    says "This is an invoice, not a receipt." It has no payment method and no QR code.
  - The print window opens inside the click, so it is not blocked as a pop-up. If the held sale is refused, the window
    closes and nothing prints.

## Security implications

- No permission is widened.
- `refresh_client_totals` and the trigger function are SECURITY DEFINER only to write the two total columns of
  clients in the sale's own business. App users cannot execute them.
- The change to closing a held sale keeps the existing checks: same business, still held, not already closed.

## Test plan

- **PGlite:** `apps/carefind/src/test/client-totals/clientTotalsAndHeldSales.db.test.js` (10 tests):
  - totals count completed sales only, net of refunds;
  - name linking: unique matches only, never Walk-in or another business;
  - totals follow a new sale, a refund, a move to another client, a deletion and a removal;
  - a held sale is not a visit;
  - a charged held sale is closed and cannot be charged twice;
  - existing converted and legacy rows are fixed;
  - re-running the migration changes nothing;
  - app users cannot execute the functions.
- **Unit and UI:**
  - `debts/debtTotals.test.js`;
  - `debts/Debts.filterTotals.test.jsx`: the summary appears only with a filter, totals one customer across
    capitalisations, shows supplier amounts, works with search plus month, and handles no matches;
  - `pos/POS.holdInvoice.test.jsx`: the held-sale invoice content; Hold & print saves the client link then prints; no
    invoice when the hold is refused.
- **Manual, after applying the migration:**
  1. Open Clients and check that a regular customer's visits and total spent match their sales history.
  2. Hold a sale, print its invoice, then charge it. Check that it leaves Held Sales and appears once in Recent with
     its payment.
