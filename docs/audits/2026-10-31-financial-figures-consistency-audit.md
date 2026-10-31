# Financial figures consistency audit (pharmacy report, 2026-10-31)

Status: **investigation complete, fixes not yet implemented.**

## The report

A pharmacy observed that "Sales today" on the main dashboard sometimes differs
from the Sales & Accounts report, and that the same business account shows
different figures at different times or on different devices.

## Verdict

**The report is true.** The code has several independent causes. The live
data (project `carehub`, read-only queries, 2026-10-31) confirms that they have
already affected real pharmacy accounts. No sale, payment or balance is stored
wrongly: the ledger and the sales table agree for every completed sale on the
platform. The fault is in how screens **select and add up** those records.
Each screen chooses which rows count, which day they fall on and whether
refunds are taken off for itself, and the screens disagree.

Businesses are anonymised below. "Pharmacy A" is the most active pharmacy
(388 completed sales, 25–30 Oct). "Pharmacy B" and "Pharmacy C" are
smaller pharmacies.

## Findings, in order of impact

### F1. Completed held invoices were counted twice (confirmed, large)

Pharmacy A works by holding an invoice and completing it later. Completing a
held invoice inserts a new sale (`resumed_from`) and leaves the held row behind
with `is_on_hold = false` and `status = 'converted'` (earlier versions used
`'resumed'`, and deleting a hold used `'deleted'`). Any screen that treats
`is_on_hold = false` as "a sale" counts that invoice twice.

- Before commit `e0418c8` (deployed 27 Oct, 20:33 UTC), the dashboard filtered on
  `is_on_hold=eq.false` alone. On **27 Oct**, Pharmacy A had **₦377,550**
  of real sales, plus 51 deleted or resumed shells worth **₦763,250** that
  the dashboard counted as sales. Sales & Accounts excluded them.
- Pharmacy A has had 96 converted rows since then (28–30 Oct, **₦443,055**),
  one for every completed hold. Current code excludes them everywhere it
  computes money.
- **Why it still shows up on some devices:** the app reloads a new build only
  when a lazy route chunk fails to load (`main.jsx`, `vite:preloadError`). A
  counter device that keeps the dashboard open never fetches a new chunk, so
  it can run a pre-27 Oct build indefinitely. That build shows "Sales today"
  inflated by every completed hold (on 30 Oct: ₦604,930 instead of
  ₦469,390). Opening Sales & Accounts on that device requests a chunk that no
  longer exists, which forces a reload, and the figures then agree. This
  matches "sometimes differs" and "differs on different devices" exactly.
- Still open in current code: the 30-day sales-velocity digest
  (`DashboardHome` → `saleRepository.getSince`) counts held, converted and
  deleted rows. That is a stock insight, not a money figure, but it overstates
  how fast products move.

### F2. "Today" means different hours on different screens (confirmed)

| Screen | Start of "today" | Source |
|---|---|---|
| Dashboard, Overview | 00:00 **UTC** (01:00 Lagos), no end | `saleRepository.getToday` |
| Financial Reports | 00:00–24:00 **UTC** | `reports/periodFilter.js` |
| Sales & Accounts | 00:00–24:00 **device local time** | `pos/salesReport.js periodRange` |

- A sale made between 00:00 and 01:00 Lagos time counts as today in Sales &
  Accounts and as yesterday on the dashboard and in Financial Reports. Live
  data: Pharmacy B has 3 sales at 00:20 Lagos time (₦6,000), and a hospital has
  2 (₦127,200).
- Sales & Accounts depends on the **device's time zone and clock**. A phone or
  laptop set to another zone (or to the wrong date) shows a different "today",
  "this week" and "this month" from a correctly set device.
- "This week" is the last 7×24 hours in Financial Reports, but Monday to
  Sunday in Sales & Accounts.
- Sales & Accounts computes its range once per period selection
  (`useMemo([period, from, to])`). A report left open past midnight keeps
  showing yesterday under the label "Today".
- Recent-sales lists show `created_at.slice(11,16)`, which is UTC time, one
  hour behind the receipt and the wall clock. This does not change a total,
  but it gets in the way of reconciliation.

### F3. Refunds: net on one screen, gross on the other (confirmed)

- Dashboard "Sales today" and Financial Reports "Total revenue" add
  `saleNet` = total − refunded.
- Sales & Accounts "Total sales" adds the gross `total` and shows refunds
  separately.
- Live data: Pharmacy C refunded a ₦200 sale on 28 Oct. The dashboard
  showed ₦0 for it, and Sales & Accounts showed ₦200 in sales and ₦200 in
  refunds.
- The dashboard also takes a refund off **the day of the original sale**, so
  an earlier day's figure changes when a refund is made later. Sales &
  Accounts records the refund on the day it happened. Both behaviours can be
  defended, but they must not both appear under labels that look the same.
- When an Owner deletes a sale, the system writes a compensating `refund` row
  to the ledger. Live data: Pharmacy C has two deleted sales worth ₦10,600,
  and they appear in "Refunds" as if money had been handed back.

### F4. Screens don't refresh one another (confirmed in code)

- The dashboard has no polling and no realtime subscription. It refetches only
  on window focus or remount once its 30 s `staleTime` has passed. A screen left
  open at the counter keeps an old figure while another device shows a fresh one.
- Recording a sale (`useInvalidateSales`) refreshes the dashboard, Recent and
  open-sales queries, but **not** `['salesReport']` or `['reports']`. Sales &
  Accounts and Financial Reports can show a pre-sale cached figure for up to 30 s.
- A refund from the dashboard's sale modal has the same gap.

### F5. Same word, different scope (confirmed in code)

- Dashboard "Owed to you" is the balance of **all** open credit sales, ever.
- Sales & Accounts "Outstanding" is the balance of **this period's** sales only.
- Financial Reports "Cash collected" adds `amount_paid` without capping it at
  the total. Live data has 2 rows where `amount_paid > total` (change
  recorded as payment), so cash collected comes out higher than the money
  actually kept.

### F6. Visible to cashiers by design (not a fault for Pharmacy A)

For roles without `canViewReports`, Sales & Accounts shows only the signed-in
cashier's own sales, while the dashboard shows the whole business. On a shared
account this can look like "different figures on another device". All of
Pharmacy A's roles have `canViewReports`, so this does not explain its
report. The fix is a clear "Showing your sales only" label.

### F7. Secondary: sub-kobo totals

Pharmacy A's daily totals carry fractions such as ₦566,399.9996, because unit
prices are derived by division and stored unrounded. Displays round them the
same way, so this does not cause a visible mismatch today. Money should
still be stored to the kobo.

## What was checked and found sound

- For every completed sale on the platform, `sale_payments` ledger receipts
  equal `least(amount_paid, total)` (0 mismatches).
- `sales.balance` agrees with `total − least(amount_paid, total)`, with 2
  exceptions (overpaid rows, see F5).
- For Pharmacy A, on every day from 25 to 30 Oct, the current dashboard
  query and the current Sales & Accounts query return the same total once both
  are fresh. Every remaining divergence for this business comes from F1 (old
  builds), F4 (staleness), or F2 at the edges.

## Recommended fix plan

One rule per figure, computed in one place and used by every screen.

1. **One business day.** Add `lib/businessDay.js` with the business's time zone
   (default `Africa/Lagos`, independent of the device's zone). Dashboard,
   Overview, Sales & Accounts and Financial Reports all build their period
   ranges from it, with `[start, end)` bounds. "Today" rolls over at
   midnight without a reload.
2. **One summary.** The dashboard and Overview compute "Sales today" with
   `summarise()` from `pos/salesReport.js`, the same function and the same
   rows as Sales & Accounts. Gross sales, refunds and net figures get explicit
   labels on every screen. Financial Reports keeps net revenue and says so.
3. **One "completed sale" rule everywhere.** Apply it to the velocity digest
   too. Add a test that holds, converted, resumed and deleted rows never reach
   a money figure.
4. **One refresh.** A sale, payment, refund, edit or delete invalidates
   `sales`, `salesReport` and `reports` together. The dashboard refetches on
   an interval and on reconnect.
5. **Stale builds.** Check the deployed build id on focus and at intervals,
   and reload when it changes (with the existing loop guard).
6. **Labels.** "Owed to you (all open credit)" and "Outstanding on these
   sales". Cap "Cash collected" at the sale total. Show "Showing your sales
   only" for cashier-scoped reports. Show times in Lagos time.
7. Follow-up (server): a `sales_summary(business_id, from, to)` SQL function
   as the single figure of record, plus rounding of stored money to the kobo.
   Both need migrations reviewed separately.

## Test plan for the fixes

- Unit tests: business-day boundaries at 00:00, 00:59 and 23:59 Lagos, with the
  device zone set to UTC, Lagos and America/New_York.
- Unit tests: `summarise()` with held, converted, resumed, deleted, refunded and
  overpaid fixtures, checked against Pharmacy A's 27 Oct shape.
- Component tests: the dashboard and Sales & Accounts render the same "Sales
  today" from the same fixture.
- Invalidation tests: recording a sale refreshes the report query keys.
