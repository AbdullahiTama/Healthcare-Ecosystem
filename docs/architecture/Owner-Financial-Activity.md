# Owner's business activity (dashboard)

Status: app code on branch `ccr-eb43ff04-sr0rcy` (not yet deployed). The
migration `supabase/migrations/carehub_20261229_owner_financial_activity.sql`
is **applied live** (2026-10-31, version 20261031160504).

## What the Owner sees

A **Business activity** section on the dashboard home. It is shown to the
business Owner only. It has three parts.

1. **Needs follow-up.** Highlight tiles, each shown only when it is not zero:
   - *Owed to suppliers*: the total and the largest balance
     (`get_supplier_balances`). Opens Purchases ▸ Suppliers.
   - *Bills past due*: open debts the business owes whose due date has passed.
     A purchase on credit opens such a debt, so overdue supplier invoices are
     included. Opens Debts.
   - *Owed to you, past due*: overdue money owed to the business, other than
     credit sales. Those are already covered by the "Owed to you" card. Opens
     Debts.
2. **Category tabs** with counts: All, Purchases & suppliers, Expenses,
   Credit & debts, Refunds & changes.
3. **The feed.** Covers the last seven business days (Lagos), newest first.
   Shows 6 rows, expandable to 25. Each row gives:
   - a brief description (the kind of activity, then the supplier, customer or
     party, then what is unpaid or still owed);
   - the amount;
   - who recorded it, with their role, and when ("Today 14:20", "Yesterday
     09:05", "27 Oct 11:00").

   Rows that arrived since the Owner's last visit carry a **New** badge, and
   the header shows "N new". The last visit is remembered per business, on the
   device. "See all" opens Staff ▸ Activity.

| Kind | Tab | Opens |
|---|---|---|
| Purchase | Purchases & suppliers | the purchase invoice (`/dashboard/purchases?purchase=<id>`) |
| Supplier payment | Purchases & suppliers | the purchase it paid |
| Expense | Expenses | the expense in full, including who recorded it (`/dashboard/expenses?expense=<id>`) |
| Credit sale | Credit & debts | the sale in full (receipt, items, payments) on the dashboard |
| Debt recorded (by hand) | Credit & debts | the debt (`/dashboard/debts?debt=<id>`) |
| Repayment | Credit & debts | the sale |
| Refund, Sale edited, Sale deleted | Refunds & changes | the sale |
| Till short or over (shift closed with a difference) | Refunds & changes | Sales & Accounts |

**Not listed, by design:** routine cash sales (they are in "Recent sales"),
held sales, stock moves, attendance and a till that balanced. They remain in
Staff ▸ Activity.

## How it works

- **One source.** The feed reads `staff_activity()`, the Owner-only feed. Any
  other caller is refused by the database, so the section is not the only
  gate. `modules/dashboard-home/ownerActivity.js` holds the pure rules: what
  counts, the tabs, the links, the wording and the follow-ups. It is tested in
  `__tests__/ownerActivity.test.js`.
- **Freshness.** The feed refetches every 60 s and on focus. Any sale,
  repayment, refund or correction refreshes it immediately
  (`invalidateSalesFigures`). Follow-ups refetch every 5 minutes and whenever
  the dashboard opens.
- **Deep links.** `hooks/useQueryParamAction.js` opens the record named in the
  query string once, then drops the parameter so a refresh does not reopen it.
  Purchases (`purchase`, `view`), Expenses (`expense`), Debts (`debt`) and
  Staff (`tab=activity`) use it.

## The migration (applied 2026-10-31)

1. **Who recorded it.** Before this migration, `purchases` and `debts`
   recorded no person at all, and `expenses.staff_name` is whatever was typed
   on the form. The migration does the following:
   - Each of the three tables gains `recorded_by`, `recorded_by_staff_id` and
     `recorded_by_name`.
   - A BEFORE INSERT trigger stamps these columns from the login through
     `pos_actor()`: the staff row, or the Owner by business email.
   - A value sent by the screen is overwritten, and a BEFORE UPDATE trigger
     keeps the stamp, so nobody can put a record in someone else's name.
   - With no signed-in user (service role), the row is left as sent.
   - A debt opened by a credit sale is stamped with the cashier.
2. **The feed** gains `purchase`, `supplier_payment` (payments only; the
   at-purchase and pre-history rows are not new events), `credit_sale` (was
   `sale`) and `debt` (hand-entered only; debts from credit sales and
   purchases are listed as those). Expenses use the stamp and carry their id.
   The signature, return type and Owner-only rule are unchanged.

**Before it is applied**, the section still works with the live function, but
shows fewer kinds:
- shown: expenses (attributed by typed name), refunds, repayments and
  corrections;
- not shown: purchases, supplier payments and hand-entered debts;
- credit sales appear as plain sales, which the section leaves out.

The follow-up tiles do not depend on the migration.

**Records made before the migration** have no stamp. Their person shows as
"Owner or unlinked" (purchases, debts), or is matched by typed name
(expenses). Nothing is guessed.

### How it was applied

1. Rolled-back probe on production
   (`scripts/db-tests/live-rollback-owner-financial-activity.sql`, throwaway
   `rollback.invalid` fixtures, everything undone). Every check passed:
   - a purchase recorded by a cashier is stamped with that cashier, whatever
     the screen sends;
   - an expense entered by staff linked by email is stamped, and its typed
     name is kept;
   - the Owner's debt is stamped with the Owner's name;
   - editing a debt or an expense applies the edit and keeps the stamp, and
     a forged name is ignored;
   - another business is refused;
   - the Owner's feed shows the purchase, the expense and the debt, with who
     recorded each and a link;
   - a manager and a cashier are refused the feed;
   - the trigger functions are not callable by app users;
   - existing rows are untouched.
2. Applied as version 20261031160504.
3. Verified after applying:
   - the three function bodies match the file (md5 of `prosrc`);
   - the six triggers are present;
   - anon and authenticated cannot execute the trigger functions;
   - `staff_activity` is still SECURITY DEFINER, callable by authenticated
     only;
   - row counts are unchanged (13 purchases, 27 expenses, 31 debts) and no
     existing row is stamped.
4. Security advisor: 203 findings before, 205 after. The two extra findings
   (and one changed signature) belong to `edit_purchase`,
   `get_purchase_for_edit` and `get_purchases_page`. They come from
   `carehub_20261229_purchase_editing_and_analytics`, applied by another
   session ten minutes earlier. None comes from this migration.

**Interaction with purchase editing.** Since that other migration, live
refuses direct updates to a purchase; purchases change only through
`edit_purchase`. Its updates keep the original "recorded by" stamp (the
BEFORE UPDATE trigger). A purchase edit is not yet listed in the Owner's feed;
see "Not built".

## Security

- The feed is the Owner's in the database (`is_business_owner`), not only on
  screen.
- The stamping triggers are SECURITY DEFINER (they read staff and businesses
  through `pos_actor`). `search_path` is pinned, and anon and authenticated
  have no EXECUTE.
- Honest limit: `purchases`, `expenses` and `debts` remain readable by every
  member through their own screens. This feature restricts the combined
  who-did-what feed, not those tables.

## Tests

- `node scripts/db-tests/ownerFinancialActivity.pglite.mjs`: 24 checks.
  Covers stamping per table, forged values ignored, the stamp kept on update,
  the Owner stamped by name, the service role untouched, each new kind with
  person, amount and link, still Owner only, and other businesses never
  visible.
- `npx vitest run src/modules/dashboard-home src/hooks src/modules/staff
  src/modules/expenses src/modules/debts src/modules/purchases`: rules,
  component (states, tabs, links, New badge, follow-ups), owner-only mounting,
  deep links and repositories.

## Manual test plan (after the migration)

1. As a cashier: record a purchase on credit with a due date, record a
   supplier payment, log an expense and make a credit sale.
2. As the Owner, on the dashboard: each appears within a minute with the
   cashier's name and role, the amount and the time. The four arrive marked
   New.
3. Click each one. The purchase invoice, the expense, and the sale (with its
   payments) open.
4. Let the purchase's due date pass, or set one in the past. "Bills past due"
   shows it.
5. As a manager or cashier: no Business activity section on the dashboard.

## Not built (by choice)

- Purchase edits (`edit_purchase`) in the Owner's feed. They arrived in a
  separate migration during this work. Listing them, with the reason and who
  made the edit, is the natural next addition, and needs one more change to
  `staff_activity()`.

- Push or bell notifications for these events. The dashboard section is where
  the Owner was asked to be told; a bell entry would duplicate each row.
- Approval queues: this feature monitors, it does not block.
