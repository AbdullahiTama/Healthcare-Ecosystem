# CareHub Staff Membership: Joining, Scope and Removal

How a person becomes staff, what they can reach, and what happens when they are removed. The database enforces every
rule here; the app only explains them.

## Joining (C21, live since 2026-10-09)

- Staff join by invitation only (`POST /api/staff-invitations` → `create_staff_invitation`). A direct insert is
  refused. The invitee sets their own password on `/accept-invite`.
- If the invitee has no account, accepting creates one, and `staff.owns_login` is set. If they already have a
  confirmed account (for example on CareFind), they sign in with it and their password is never changed.
- `owns_login` is false for these existing accounts.

## One person, one business

| Rule | Enforced by |
|---|---|
| One email is one staff record anywhere, case-insensitive | unique index `staff_email_lower_key` |
| A staff member sees and changes only their own business, never its branches | `current_business_ids()` (owners still get their whole tree) |
| An email that is staff somewhere cannot become a business login | trigger `guard_business_email_not_staff` |
| A business login cannot be invited, accepted or reactivated as staff | `staff_email_conflict()` in the invitation, acceptance and `guard_staff_writes` |
| A member's business, email and login cannot be edited | `guard_staff_writes` |

To work for another business, the person is removed and invited there. To work at a branch, they are invited at that
branch.

## Removal (`remove_staff_member`, carehub_20261219)

The Staff page's **Remove** (or **Revoke** for an unanswered invitation) calls `remove_staff_member(staff_id)`. A direct
DELETE is refused.

**Who may remove:**
- The Owner and platform admins.
- Staff whose role grants "Manage staff".
- Only the Owner may remove someone who manages staff.
- Nobody may remove themselves.

| Data | What happens |
|---|---|
| Staff record | Deleted |
| Login | Deleted when it was created for this membership and nothing else uses it. A personal CareFind account (wallet, posts, orders, etc.) is kept but has no access to the business |
| Notifications, activity viewer and default-viewer entries, order watching, territory assignments, CareFind profile claims, rep customers, colleagues and entries | Deleted |
| Sales, payments, till shifts, orders, internal messages, field reports, comments and reactions, directory suggestions, ADR notification log | Kept and unlinked; they already store the person's name |
| Warehouse manager slot | Emptied |
| Attendance check-ins | Kept, with the name stored in `staff_checkins.staff_name`. They still appear in the Owner's Activity feed |
| `audit_log` | One `staff.removed` row: who removed whom, and whether the login was deleted |

Append-only ledgers (`sale_payments`, `staff_checkins`) and the directory-suggestion guard accept exactly one change
from server code: clearing the removed person's link, with every other column unchanged. Browser users still cannot
edit them.

Auth-user ids recorded on audit, stock and attendance rows (`audit_log.actor_id`, `stock_movements.actor_id`,
`sale_payments.received_by`, `staff_checkins.user_id`) are kept as they are. They are history, not membership.

## Status

**Applied to production 2026-10-28** (run from the SQL editor, recorded as `carehub_20261219_staff_offboarding_and_scope`).
Verified the same day:
- every object exists, and only `authenticated` may run `remove_staff_member`;
- direct deletes are refused, and the invitation records `owns_login`;
- 3 of the 4 existing staff logins are marked CareHub-owned; the pre-existing personal account is not;
- the Activity feed is patched.

## Existing data (2026-10-28)

- Three inactive staff records whose emails later became other businesses' owner logins were removed on 2026-10-28
  through `remove_staff_member`, acting as each business's owner. Each removal has a `staff.removed` audit row, and no
  staff email is a business login any more.
- One active staff member (no login) belongs to a business with a branch. After this change they can reach only
  their own business.

## Test plan

- PGlite `apps/carefind/src/test/plan-enforcement/staffOffboarding.db.test.js` (12 tests). It covers:
  - authorisation (outsiders, plain staff, yourself, staff admins vs managers);
  - complete removal, record by record;
  - logins: a minted one is deleted, a personal one is kept;
  - the ledgers still refuse other changes;
  - the Activity feed name;
  - branch scope, case-insensitive uniqueness, the business-email guard and reactivation.
- Unit: `src/modules/staff/repositories/index.test.js` and `src/modules/staff/Staff.remove.test.jsx` (remove, revoke,
  refusal shown in plain words).
- Manual, after applying the migration:
  1. Invite a test staff member, accept, record a sale, then Remove them. The sale stays under their name, and they
     can no longer sign in.
  2. As a staff member of a business with branches, confirm the branches' data is not visible.
