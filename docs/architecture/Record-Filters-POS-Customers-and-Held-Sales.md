# Record filters (Debts, Clients, Expenses), adding customers at the POS, and held sales that appear at once

Status: built 2026-11-09. The filters, POS and held-sale changes are app only. Expense payment status (§2.3.1) adds
the migration `carehub_20270107_expense_payments` (not applied yet).

Related: [Client-Totals-Debts-and-Held-Sales.md](Client-Totals-Debts-and-Held-Sales.md) (the first debt filter
summary), [POS-Drafts-and-Held-Sale-Reliability.md](POS-Drafts-and-Held-Sale-Reliability.md) (held-sale writes),
[Transaction-Details-and-Credit-Customers.md](Transaction-Details-and-Credit-Customers.md) (the credit customer picker).

## 1. What was asked, and what the code did before

| Request | Before |
|---|---|
| Debts: filter by year, month, date, range, party, location, payment status, transaction type/source, amount, direction; totals follow | Party-name search and one month box. The two cards ("Clients owe you", "You owe others") always showed the whole list. |
| Clients and Expenses: the same kind of filtering, totals follow | Clients: name/phone/email search; the cards always showed every client; a failed load looked like "No clients yet". Expenses: one month box (server RPCs per month). |
| Add a client from the POS without leaving the sale | Possible only after choosing the **Credit** payment method. |
| A held sale appears in Sales on Hold at once and never disappears | The list updated only after a re-read from the server. A hold saved while offline (or when the request failed) went to the device's queue and was **not shown at all** until it synced; syncing did not refresh the list; a failed read showed "No held sales". |

## 2. Design

One rule set, three pages. Nothing is duplicated:

- `src/lib/recordFilters.js` (pure): text search (`normText`, `matchesText`), amount ranges (`inAmountRange`, blank or
  invalid bounds are ignored, reversed bounds are read the right way round), periods (`inPeriod` compares the calendar
  day only, so no time zone moves a record across a boundary), and the year list.
- Dates reuse the existing `components/PeriodFilter` + `lib/datePeriods` (All time, Day, Week, Month, Year, Custom
  range, and presets), already used by Purchases.
- `src/components/RecordFilters.jsx`: `FilterPanel` (collapsible, "N active", **Clear all filters**),
  `FilterSelect` (labelled, with an "All" choice) and `AmountRangeFilter` (labelled min/max in a fieldset).
- Each page has a pure filter module that composes those: `debts/debtFilters.js`, `clients/clientFilters.js`,
  `expenses/expenseFilters.js`. Each exposes `filter…`, a totals function, an active-filter count and a plain-words
  description used by the summary line and the empty state.
- **Totals are computed from exactly the rows on screen**, in whole kobo (no 0.1 + 0.2 drift), so every filter change
  recalculates them. The summary line (`role="status"`, `aria-live="polite"`) reads the result to screen readers.

### 2.1 Debts

| Filter | Rule |
|---|---|
| Date recorded | `created_at` calendar day in the period |
| Customer / supplier / party | search on `party_name`, case and spacing ignored |
| Location | Owners with branches only (see 2.4). Default: the location in use |
| Payment status | derived: **Paid** (closed, or nothing left), **Partially paid** (something paid, something left), **Unpaid** (nothing paid). The stored `status` only says paid/pending |
| Transaction type / source | `source`: Credit sale, Purchase, Recorded by hand (no source = an old hand-recorded debt) |
| Direction | Owed to us / We owe others |
| Amount range | on the outstanding balance or the original amount (a "Compare" choice) |

Cards: **Total outstanding** (both directions), **Owed to us**, **We owe others**, each with its open count. The
summary adds counts by payment status.

### 2.2 Clients

| Filter | Rule |
|---|---|
| Date joined | `created_at` in the period |
| Search | name, phone, email, address |
| Payment status | **Owes money** / **Nothing owed**, from open "owed to us" debts. A debt is the client's by `client_id`, or by a name that matches exactly one client (the till's rule; two clients with one name are never guessed between) |
| Purchase activity | has bought before / never bought (`visit_count`) |
| Gender | Male, Female, Other, Not recorded |
| Lifetime spend, number of visits | ranges |

Cards: clients (of total), lifetime spend (with average), **Owed to you** (with how many clients owe), visits. Each
card row shows "Owes ₦…". **Export CSV** exports the clients shown (with an "Owes" column). If the open debts cannot be
read, "Owed to you" says so and the payment filter is marked unavailable instead of showing ₦0. A failed client load
now shows an error with Retry.

### 2.3 Expenses

| Filter | Rule |
|---|---|
| Expense date | `expenseDate()` (the date entered, else the day recorded; same rule as `expense_effective_date()`). Opens on this month, as before |
| Search | description, category, staff |
| Category | the configured categories plus any found in the data |
| Recorded by | the name the database stamped (`recorded_by_name`), else the name typed on the form |
| Amount | range |

Cards and the category breakdown follow the filters. The **budget** (stored in the database, see audit A15) stays monthly:
it uses the month filtered on (else the current month) and always compares against that whole month's spending,
whatever else is filtered. The USB-scanner guard restores the filters if a scan lands in one of them.

The page now reads every expense once (`expenseRepository.getAll`, paged past the 1,000-row cap) and filters on the
device, so any combination totals exactly. Live volumes on 2026-11-09: at most 42 expenses, 45 debts and 11 clients
per business. If a business reaches many thousands, move the filter to a database function; the existing
`get_expenses_page` / `get_expense_totals` / `get_expense_summary` reads are kept in the repository for that.

### 2.3.1 Expense payment status (added 2026-11-09, audit A16)

An expense can now be logged as **Paid in full**, **Part paid** (with the amount paid now) or **Not paid yet**, with
how it was paid (Cash, Transfer, POS, Cheque, Other), and paid off later.

- **Database** (`supabase/migrations/carehub_20270107_expense_payments.sql`): `expenses.amount_paid` (0 .. amount)
  and `payment_method`; every existing expense is set paid in full, which is what it meant. Status and balance are
  derived (balance = amount - amount_paid), never stored. `expense_payments` is an append-only history (the same design
  as `purchase_payments`): the amount paid when logged, every later payment, and one "before payment history" row per
  existing expense, so an expense's history adds up to what was paid. `record_expense_payment()` is the only way to
  pay: it checks the caller belongs to the business, that 0 < amount <= still owed, and writes the history in the same
  transaction. A trigger refuses any other change to `amount_paid` and any lowering of an expense below what was paid.
  An app build that sends no `amount_paid` still records paid expenses (insert trigger default).
- **App**: the Log Expense form has a Payment choice; the page shows **Paid** and **Still to pay** cards (with how
  many expenses are not fully paid) next to Total spent; a **Payment status** filter (Unpaid, Partially paid, Paid);
  a Status column with what is left to pay; **Record payment** on each expense not fully paid (amount defaults to what
  is owed, method, date, note); and the expense detail shows paid, still to pay and the payment history.
- **Totals and budget**: Total spent, the category breakdown, the budget and Reports still count the full expense
  amount (spending is incurred when the bill is logged, paid or not). Paid and Still to pay are shown alongside.
- **Before the migration is applied** the app keeps working as today: rows have no `amount_paid`, so everything reads
  as paid, the form offers no payment choice and nothing offers Record payment. If an unpaid expense is attempted
  anyway, it is refused with an explanation, never stored as paid.
- **Unpaid expenses are not debts**: they are not added to the Debts page's "We owe others", so nothing is counted
  twice. They are tracked on the Expenses page.

### 2.4 Locations (Debts)

Every location is its own `businesses` row. For an **Owner** whose business has branches, the page lists the
locations (`locationsRepository.getAll`) and reads all their debts in one query (`debtRepository.getForBusinesses`,
`business_id=in.(…)`); the default view is still the location in use. A debt of another location is shown and counted,
but opening it shows the debt summary only and "Mark paid" reads **Settle at <location>**: its sale, purchase, receipt
settings and staff attribution belong to that location, so it is settled after switching to it. Staff never list
locations and read only their own business, as before. If the locations cannot be listed, the page falls back to the
location in use.

## 3. Adding a customer at the POS

- A person-plus button beside the sale's customer box ("New customer for this sale") opens **Add customer**: full name
  (required), phone (recommended), email (optional). It works for any payment method; the cart is untouched.
- Saving creates the client through the same `useCreateClient` mutation as the Clients page, selects them for the sale
  (the sale and any debt link to the record), and confirms with a toast. A duplicate phone is explained.
- The new client is put into the shared client cache at once and the list is re-read, so it is immediately in the
  Clients page, the Debts party picker, the credit picker and every other client list.
- The form is one component, `pos/NewCustomerForm.jsx`, used by this dialog and by the credit-sale `CustomerPicker`
  (which previously had its own copy).

## 4. Held sales appear at once and do not disappear

- **Saved online:** the saved row returned by the database is put into the cached open-sales list immediately
  (`upsertOpenSale`, matched by id so the re-read that follows replaces rather than doubles it). Saving an edited held
  sale updates its entry the same way.
- **Saved offline or after a failed request:** the hold is in the device's offline queue. Held Sales now also lists
  queued held sales for this location, marked "Saved on this device. It will sync when you are back online." They can
  be printed but not opened until synced (there is no server row to save onto yet). The list re-reads the queue after
  every hold, when the server list changes and when the connection returns; a queued sale already on the server is
  shown once.
- **After syncing**, every sales list is invalidated, so synced held sales move into the normal list straight away.
- **Coming back to the POS** always re-reads the open sales (`refetchOnMount: 'always'`); the cached list shows
  meanwhile, so nothing blinks out.
- **A failed read** shows an error with Retry above whatever is known, never "No held sales".

## 5. Security implications

- No permission is widened and no database object changes. Every read still goes through row-level security.
- The multi-location debt read asks only for ids from the Owner's own location list; `current_business_ids()` decides
  what comes back (an owner's own locations and branches; staff only their one business). Ids are validated as UUIDs
  before they enter the query.
- Writes are unchanged and remain scoped to the location in use: debts of other locations are deliberately read-only
  on this page.
- Adding a customer at the till uses the existing client insert (same RLS and unique-phone index as the Clients page).
- The offline queue is the existing one in `localStorage`; held sales shown from it are this device's own and are
  filtered to the location in use.

## 6. Test plan

**Automated** (CareHub, `npm test`: 3,476 tests pass; lint 0 errors; build passes):

- `lib`/filters: `debts/debtFilters.test.js`, `debts/debtTotals.test.js`, `clients/clientFilters.test.js`,
  `expenses/expenseFilters.test.js`: every filter alone and combined, periods by day/month/year/range, ranges (open,
  reversed, invalid), derived payment status, client balance linking (link, unique name, ambiguous name, wrong
  direction, paid), kobo totals, descriptions.
- Existing suites adapted to the new reads: `expenses/Expenses.budget.test.jsx`, `expenses/Expenses.scanner.test.jsx`,
  `clients/Clients.scanner.test.jsx` (same behaviours asserted).
- Pages: `debts/Debts.filterTotals.test.jsx` (cards follow payment status, direction + amount, period; owner with
  branches: default location, All locations, "Settle at"; staff never list locations), `clients/Clients.filters.test.jsx`
  (totals, payment filter, combined filters and clear, load error, debts unavailable), `expenses/Expenses.page.test.jsx`
  (opens on this month, category recalculates, All time).
- POS: `pos/POS.heldAndCustomers.test.jsx` (held sale shown at once, edited held sale updated, offline hold listed and
  not openable, other location's queue hidden, no duplicates, read error with Retry, add customer for any sale with
  cart kept, name prefilled, duplicate phone, name required); existing credit, held, draft and invoice suites.
- Expense payments: `apps/carefind/src/test/expenses/expensePayments.db.test.js` (14, PGlite with the live table,
  policy, grants and helper functions: backfill and its history, re-run safe, logging paid / part paid / unpaid,
  payments in parts, over-payment and bad input refused, staff allowed, another business / missing / anon refused
  without leaking, direct edits of the paid amount and of the history refused, cascade on delete);
  `expenses/Expenses.payments.test.jsx` (cards, status filter, logging unpaid and part paid, Record payment, refusals,
  detail history, behaviour before the migration); repository fallback and request shapes; rules
  (`expenseRules.test.js`, `expenseFilters.test.js`).
- Cache: `hooks/__tests__/queries.cache.test.jsx` (held-sale upsert dedupe and order; new client in the shared list).

**Manual, after deploy:**

1. Debts: open Debt filters, choose Partially paid, then a month: the three cards and the summary change together.
   As an Owner with a branch, choose All locations: the branch's debts appear with "Settle at …".
2. Clients: choose Owes money: only debtors remain, "Owed to you" matches the Debts page's owed-to-us total for them.
3. Expenses: choose a category and an amount range; the total and the breakdown match the rows.
4. POS: put an item in the cart, tap the person-plus button, add a customer: they are selected and appear on the
   Clients page without a refresh. Hold a sale: it is under Held at once. Turn the network off, hold another: it is
   listed as saved on this device; turn the network on: it syncs and becomes a normal held sale.
5. After `carehub_20270107_expense_payments` is applied: log an expense as Not paid yet; it shows Unpaid with the full
   amount to pay, and Still to pay rises by it. Record part of it, then the rest: the status moves to Partially paid,
   then Paid, and the detail lists both payments.
