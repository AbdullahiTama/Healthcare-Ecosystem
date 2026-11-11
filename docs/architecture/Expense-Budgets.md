# Expense budgets

2026-11-04. Migration `supabase/migrations/carehub_20270103_expense_budgets.sql`, **applied to production 2026-11-04**
(version 20261104143040) with the owner's approval. CODE_AUDIT item A15.

## Report

"The expense budget I set has disappeared." The Owner set ₦50,000; recorded expenses reduced it and the remaining
balance showed. Then the budget and the remaining balance were gone.

## Investigation: persistence, not lost expenses

- **Expenses are intact.** Live, 2026-11-04: 22 expenses in October (4 businesses), 16 in November. Every total
  comes from `get_expense_totals`, unchanged.
- **The budget was never saved on the server.** No live table or column holds a budget. `Expenses.jsx` wrote it to
  the browser's `localStorage` (`carehub_expense_budget = { [businessId]: { 'YYYY-MM': amount } }`) and read the
  entry for the month on screen.

So the budget disappeared whenever:

| Cause | Why |
|---|---|
| A new month began | Only that month's entry was read; November had none, although October's was still in the browser. The report came in on 4 November. |
| Another phone, browser or profile | Each browser has its own storage. |
| Site data cleared, private window, storage evicted | Safari removes script-written storage of sites unused for 7 days; "clear cache" tools remove it. |
| Staff looked | They never had it, although the dialog said "All staff can see the budget". |

Both a persistence issue (browser-only) and a display issue (strictly one month, no carry-over).

## Fix

**Database** (`carehub_20270103_expense_budgets`):

- `expense_budgets (business_id, month 'YYYY-MM', amount ≥ 0, set_by, updated_at)`, one row per business and month.
- Read: members of the business and platform admins (`business_id IN current_business_ids()`, the rule `expenses`
  uses). No direct insert, update or delete for any app user.
- Write: `set_expense_budget(business, month, amount)`, `SECURITY DEFINER`, **Owner only** (`is_business_owner`),
  validates month and amount, upserts and stamps `set_by` / `updated_at`.

**Rule:** a month uses its own budget, else the **latest earlier** one, so a budget carries over until the Owner
changes it. A budget of 0 means "no budget from this month on" and stops the carry-over. Both the database query
(`expenseRepository.getBudget`: `month <= M`, newest first) and the browser fallback (`effectiveBudget`) follow it.

**App** (`modules/expenses/`):

- `useExpenseBudget.js` loads and saves the budget. On the Owner's first visit after the update, budgets still held in
  that browser are moved to the database (a month the database already has is left alone) and removed from the
  browser, so the reporting Owner's ₦50,000 comes back once they open Expenses on the device where they set it.
- The tracker says "Carried over from 2026-10 budget" when it is.
- A budget that could not be read shows "The budget could not be loaded. It has not been lost." with Try again,
  never the "Set a monthly expense budget" prompt.
- Spending that could not be read (or is loading) shows "—", never "the whole budget remains".
- Saving waits for the database; on failure the dialog stays open and nothing changes.
- Before the migration is applied, the browser storage is used exactly as before, and the tracker says
  "saved on this device only".
- `expenseRules.js`: `effectiveBudget`, `legacyBudgetEntries`, `budgetSummary` (kobo arithmetic).

Spending is unchanged: remaining = budget − `get_expense_totals` for the month, reloaded after every save or delete,
so each recorded expense reduces it and a deleted one gives it back.

## Security

- New readable data: a monthly budget figure, for members of the business only (RLS); nothing for anon.
- Only the business's Owner can set it, through the definer function (42501 otherwise). Staff and managers cannot,
  matching the screen. Definer function with pinned `search_path`; EXECUTE revoked from PUBLIC and anon.
- No existing table, policy, grant or function changes.

## Applied (2026-11-04)

Applied verbatim, version 20261104143040. Verified afterwards: RLS on; `authenticated` may only SELECT the table and
`anon` nothing; `set_expense_budget` is `SECURITY DEFINER` with `search_path = public, pg_temp`, executable by
`authenticated` only. Expense records unchanged.

Rolled-back probe (DO blocks that raised; 0 budget rows remained), as a real Owner, one of their active staff and the
owner of another business:

| # | Who / what | Result |
|---|---|---|
| 1 | Owner sets 2026-10 = 50,000 | allowed |
| 2 | Owner sets it again (55,000) | one row, 55,000 |
| 3 | Owner reads 2026-11 | 2026-10 = 55,000 (carried over) |
| 4–6 | Owner INSERT / UPDATE / DELETE directly | refused, permission denied |
| 7 | Bad month 2026-13 | refused |
| 8 | Staff reads 2026-11 | 2026-10 = 55,000 |
| 9 | Staff sets a budget | refused, 42501 |
| 10 | Staff INSERT directly | refused |
| 11 | Another business reads it | 0 rows |
| 12 | Another business sets it | refused, 42501 |
| 13 | anon reads / sets | refused, permission denied |

Security advisor: the day's baseline (8 groups, 208 findings) plus one intended finding,
`authenticated_security_definer_function_executable` for `set_expense_budget` (the app's way to save a budget; it
refuses everyone but the Owner).

**Remaining step:** ask the reporting Owner to open Expenses once on the phone or computer where they set the
budget. That moves it from the browser to the database; from then on it shows on every device and to staff.

## Tests

| File | Covers |
|---|---|
| `apps/carefind/src/test/expenses/expenseBudgets.db.test.js` | PGlite with the live `current_business_ids`, `is_business_owner`, `is_platform_admin`: Owner sets, upsert, staff / manager / other business / anon refused, bad input, no direct writes, member-only reads, carry-over, 0 stops it (9) |
| `apps/carehub/src/modules/expenses/Expenses.budget.test.jsx` | carried over with November spending deducted, staff see it, save, failed save, browser budgets moved once and not over the database, staff never upload, failed budget read, failed spending read, 0 stops carry-over, earlier month, fallback before the migration (12; 10 fail on the previous screen) |
| `expenseRules.test.js`, `repositories/index.test.js` | the rules and the queries |

## Set new budget (2026-11-11)

Pending item 2 of "Still Pending Issues – CareFind Hub". Migration
`supabase/migrations/carehub_20270116_expense_new_budget.sql`, **applied to production 2026-11-11** (version
20261111153408) with the owner's approval; the rolled-back live probe passed (results in the migration header).
CODE_AUDIT item A24 (closed).

**Report.** "Users cannot set a new budget after the existing budget is exhausted. Only the Edit option is available."
With one budget per month and `set_expense_budget` overwriting it, raising a used-up ₦50,000 to ₦80,000 on the 18th
rewrote the month as if ₦80,000 had always applied (the overspend vanished), and the ₦52,000 that exhausted the old
budget kept counting against the new one.

**Fix.**

- `expense_budgets.starts_on` (NULL = the 1st): the day a month's budget began. Spending against a budget is counted
  from that day to the end of its month; a budget carried into a later month counts that month from the 1st. Existing
  rows keep NULL, so every existing budget reads as before.
- `expense_budget_history`: every budget that was **replaced** (with the days it ran and what was spent against it,
  computed by the database from `expense_effective_date`) or **edited** (the previous amount). Members of the business
  read it; nobody writes it directly.
- `start_new_expense_budget(business, month, amount, starts_on)`, Owner only: closes the budget in force (its own or
  carried over) the day before `starts_on`, records it in the history, and starts the new amount on `starts_on`. The
  start must be in the month and after the current budget's start (a change on the same day is an Edit). The new budget
  carries over to later months like any other. A per-business-and-month advisory lock serialises it with Edit.
- `set_expense_budget` (Edit) is unchanged except that changing a month's own amount first records the previous amount
  in the history. It keeps `starts_on`.

**Screen.** For the Owner, **Set new budget** sits next to Edit budget whenever a budget is in force (highlighted when it
is used up), and the tracker says "This budget is used up. Set a new one…" with the button. The dialog takes the amount
and the start day (today by default; from the day after the current start to the month's end) and previews how the
current budget closes ("closes on 17 Nov: ₦52,000 spent of ₦50,000"), what is already dated on or after the new start,
and what the new budget leaves. The tracker then says "New budget from 2026-11-18" and counts from that day. **Earlier
budgets in 2026-11** lists replaced budgets with their days and spending (marked when over) and edits, for everyone who
sees the budget. A failed save keeps the dialog open and changes nothing; a failed history read says so with Try again.
Before the migration is applied, the history read fails as "table not found", so Set new budget is not offered and Edit
works as before; the browser-only fallback never offers it.

**Security.** New readable data: earlier budget amounts, dates and spending totals, for members of the business only
(the same rule as `expense_budgets` and `expenses`). Writes only through the two `SECURITY DEFINER` functions, which
refuse anyone but the Owner (42501); no INSERT/UPDATE/DELETE grant on either table; EXECUTE revoked from PUBLIC and anon.

**Tests.**

| File | Covers |
|---|---|
| `apps/carefind/src/test/expenses/expenseNewBudget.db.test.js` (11, PGlite, applied over carehub_20270103 as in production) | existing budgets unchanged; Owner only; bad amount / start outside the month / not after the current start / nothing to replace; closing a carried-over budget with 52,000 spent of 50,000; October untouched; another business's expenses not counted; carry-over into December; a second new budget in the month; Edit keeps the start and records the old amount (and nothing when unchanged); history unreadable by others and unwritable by anyone; `starts_on` outside the month refused by the table |
| `apps/carehub/src/modules/expenses/Expenses.newBudget.test.jsx` (7) | used-up budget → Set new budget → preview → saved, counted from the start, old budget in history; validation; failed save; staff see it but cannot set one; before the update (Edit only); failed history read with retry; Edit after a new budget |
| `expenseRules.test.js`, `repositories/index.test.js` | start day, spending since, start range, validation; the queries and confirmations |

**Manual check (still to do in the app):** as the Owner on a month whose budget is used up, set a new budget from today; the
tracker counts from today and Earlier budgets shows the old one with its spending; as staff, the same figures and no
button; Edit the new budget and confirm the start stays.

## USB barcode scanners on the Expenses screen (2026-11-04)

The same scanner fix as the stock screens (`Inventory-Barcode-Scanning.md`, shared `useKeyboardScanner` hook).
Expenses has no barcode field, so a scan is never meant there. Before, a scan typed its code into whichever field had
focus, then pressed Enter:

- **Amount:** the code became the expense. A 12-digit UPC (e.g. 615,110,000,123) is under the ₦1 trillion cap, so it
  could be saved; the scanner's Enter on a focused **Save Expense** saved it.
- **Monthly budget:** the code became the budget; Enter on **Save Budget** saved it.
- **List:** Enter on a focused **Delete** opened the confirmation, and Enter on its **Delete** deleted the expense.

Now a scan anywhere on the screen (any field, button or dialog, or with nothing focused) puts the expense form, the
budget field and the month back as they were, shows "Scan ignored (…): Expenses has no barcode field, so nothing was
changed.", and presses nothing. **Description** and **Recorded By** are free text (a receipt or invoice number may be
scanned there on purpose) and are left alone, as are fields outside the screen. Typing by hand is never taken for a
scan (6+ keys each within 50 ms).

Tests: `Expenses.scanner.test.jsx`, 9 tests; 6 fail against the previous screen, the other 3 check what must not
change (free-text fields, hand typing, fields outside).

