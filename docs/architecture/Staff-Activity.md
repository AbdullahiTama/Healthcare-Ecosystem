# Staff ▸ Activity (owner-only)

Migration: `supabase/migrations/carehub_20261217_staff_activity.sql` (**drafted,
NOT applied**; needs `carehub_20261216_sales_owner_corrections.sql` first, for
`is_business_owner()`). Tests: `scripts/db-tests/staffActivity.pglite.mjs` (30
real-Postgres checks), `Staff.activity.test.jsx`, `staffActivity.test.js`.

## What it is
A second tab on the Staff page, **Owner only**: *Team* (the existing accounts,
roles and permissions) and *Activity*. Activity is a read-only, newest-first feed
of what every staff member did, with a per-person summary and filters by person,
role, kind of activity and text. Click a person card to narrow the feed to them.

## What counts as an activity
| Kind | Source | Person comes from |
|---|---|---|
| Sale, Credit sale, Held sale | `sales` (deleted sales are not sales; a sale on credit is "Credit sale") | `cashier_staff_id` |
| Purchase | `purchases` | `recorded_by*` stamp (carehub_20261229, pending) |
| Supplier payment | `purchase_payments` kind `payment` | `recorded_by` (auth user) |
| Debt recorded | `debts` entered by hand (not those opened by a credit sale or a purchase) | `recorded_by*` stamp |
| Refund, Repayment | `sale_payments` | `staff_id` |
| Sale edited, Sale deleted | `audit_log` (Owner corrections) | auth user ▸ `staff.auth_user_id`; the Owner has no staff row |
| Expense | `expenses` | the `recorded_by*` stamp when present (carehub_20261229), else the typed name matched to `staff.full_name` |
| Stock change | `stock_movements` with a known actor (automatic `sale` movements omitted) | `actor_id`, else `moved_by` (text: an id or a typed name) |
| Attendance | `staff_checkins` | `staff_id` |
| Field visit | `field_activities` | `staff_id` |
| Shift opened / closed | `pos_shifts` (close carries counted − expected) | `staff_id` |

Activity with no staff match (the Owner, or a login not linked to a staff row) is
shown as **Owner or unlinked** rather than guessed.

## Security
`staff_activity(p_business_id, p_from, p_to, p_limit)` is SECURITY DEFINER,
`search_path` pinned, refuses everyone but `is_business_owner()` (managers
included), `anon` has no EXECUTE, bounded to 366 days and 2000 rows. The tab is
also hidden for non-owners, but the database is the gate. It changes nothing.

**Honest limit:** the underlying tables (`sales`, `expenses`, `audit_log`, …) are
still readable by any member through their own screens; this feature restricts
the *combined who-did-what feed*, it does not lock those tables down.

## Not built (by choice)
Task assignment and approval queues (you chose monitor + audit). No export (an
export would need its own audit-log type). Expenses carry only a name, so a
renamed staff member's old expenses will not match. Logins/sessions are not
recorded anywhere, so they are not listed.

## Rollout
Apply 20261216, then 20261217 (the function does not exist until then and the
tab shows a load error). Then deploy the app.

## Test plan
`node scripts/db-tests/staffActivity.pglite.mjs`; `npx vitest run src/modules/staff`.
Manual as Owner: Staff ▸ Activity ▸ pick *This week*; make a sale as a cashier,
hold one, record an expense, check in; refresh: each appears under the right
person and role. As Manager/cashier: no Activity tab; calling the function
returns *Only the Owner can view staff activity*.

## Business activity on the dashboard
The Owner's dashboard shows the money records from this feed (purchases,
supplier payments, expenses, credit, debts, refunds, corrections, a till that
did not balance) for the last seven days, each opening its record. See
`Owner-Financial-Activity.md`. Periods here now use the business day
(`lib/businessDay.js`, Lagos time).
