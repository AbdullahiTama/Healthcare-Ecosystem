# Expense budgets

2026-11-04. Migration `supabase/migrations/carehub_20270103_expense_budgets.sql`, **not yet applied** (see "Applying").
CODE_AUDIT item A15.

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

## Applying

1. Apply the migration (owner's approval).
2. Rolled-back probe as a real Owner and a real staff member: set a budget (Owner: allowed; staff: 42501); direct
   INSERT/UPDATE/DELETE on `expense_budgets` (both: permission denied); read for the next month returns the carried
   budget; another business sees nothing. Then the security advisor: no new finding.
3. Ask the reporting Owner to open Expenses on the device where the budget was set.

## Tests

| File | Covers |
|---|---|
| `apps/carefind/src/test/expenses/expenseBudgets.db.test.js` | PGlite with the live `current_business_ids`, `is_business_owner`, `is_platform_admin`: Owner sets, upsert, staff / manager / other business / anon refused, bad input, no direct writes, member-only reads, carry-over, 0 stops it (9) |
| `apps/carehub/src/modules/expenses/Expenses.budget.test.jsx` | carried over with November spending deducted, staff see it, save, failed save, browser budgets moved once and not over the database, staff never upload, failed budget read, failed spending read, 0 stops carry-over, earlier month, fallback before the migration (12; 10 fail on the previous screen) |
| `expenseRules.test.js`, `repositories/index.test.js` | the rules and the queries |
