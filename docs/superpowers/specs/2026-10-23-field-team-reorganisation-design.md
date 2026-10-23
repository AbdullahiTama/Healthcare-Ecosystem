# Field team reorganisation: design

Status: draft for owner review. Scope agreed with the owner on 2026-10-23.

## Intent

Live Field Activity is used by manufacturers and wholesalers whose reps visit pharmacies, hospitals and clinics.
The owner's model: **reps work from their own login; the company manages the field team from its dashboard.**
Today one page serves both: the rep tool and the manager tools are mixed behind tabs and role checks, a rep's
login shows eleven enterprise modules, and "manager" means "any role whose name contains manager".

## Scope

- Business types: `manufacturer_importer` and `wholesale` only (ENTERPRISE_TYPES, as the `activity` module is
  already gated). Pharmacies, hospitals and clinics: not in scope.
- What a person can read does not change, except the two authorisation fixes below (field manager, orders).

## Goals

### 1. The rep's login

- A rep lands on **Field** (their field home) after signing in, not the general dashboard.
- Their menu is **Field, Orders, Messages**. The other enterprise modules leave a rep's default menu. An owner can
  still grant more on the role (the Roles screen already allows it).
- A built-in role template **Field Rep** gives exactly that. The fallback for an unrecognised staff role
  (`DEFAULT_STAFF_PERMS`, which the live "Medical sales rep" uses today) changes to the same Field, Orders,
  Messages set.
- **Field** holds what reps already have, moved out of the mixed page: check in/out, log a visit (place, notes,
  voice, photos, offline queue), My reports, Shared with me, Who sees my activity.

### 2. An order started from a visit (owner's choice)

- On a report the rep wrote, "Raise order" opens the existing order form with the customer filled from the visit
  (name and address from the chosen place or directory business) and the order linked to the report.
- The report shows the order(s) it produced; the order shows the visit it came from.
- An order can still be raised without a visit. One visit can produce several orders.

### 3. The company dashboard (owner and field managers)

- **Dashboard home, "Field team today" panel** (owner picked layout A over a map, 2026-10-23):
  - counts: checked in X of Y reps, visits today, orders awaiting my approval, places to confirm;
  - **Checked in**: each rep, time and area of today's check-in, an old position labelled old (over 60 minutes,
    the rule managers already see), and who has not checked in;
  - **Today's visits**: newest first, place, location match badge, order/photo markers; link to Team reports.
  - Works on a phone as stacked lists. Never a live-tracking view.
- A **Field team** sidebar section with full pages:
  - **Team reports**: the existing team feed and table, filters, export, compare location.
  - **Team check-ins**: the existing team check-in view.
  - **Order approvals**: orders waiting for this person's approval (the existing Orders page, filtered).
  - **Report fields**: what a visit report asks for (owner).
  - **Places to confirm**: places reps added (existing review).
- These leave the rep's page entirely.

### 4. Who is a field manager (explicit, closes audit F2)

- New role permission **Manage field team** (`canManageField`), shown in the Roles editor. Built-in template
  **Field Manager** has it. The owner always has it.
- Database: a new `is_field_manager(bid)` = owner or platform admin, OR the caller's role grants `canManageField`,
  OR the existing `is_business_manager(bid)` (name rule) so nobody who has access today loses it.
  `caller_sees_all_activity` and `manager_checkin_overview` use it. `is_business_manager` itself is NOT changed: other
  features (facility review) depend on it.
- The UI uses the same rule (`canManageField` or the existing name rule) for the Field team section.

### 5. Orders authorisation (found during this design, 2026-10-23)

Today `orders` has one permissive policy, FOR ALL to every member of the company. Any member can read, edit and
delete every order and set any status; "only the tagged approver or the owner may approve" is enforced only in the
browser. Fix, as part of this work:

- Read: a field manager or the owner sees all orders; anyone else sees orders they created, are tagged to approve,
  or watch.
- Status changes enforced in the database: approve/reject only by the tagged approver or the owner, never by the
  person who created the order (unless they are the owner); later stages follow the existing pipeline order.
- No member deletes an order; mistakes are rejected, not erased (an audit trail already exists in `order_events`).

## Non-goals

- Pharmacies, hospitals, clinics.
- A live map or any continuous tracking.
- Coverage analytics (audit F10) and the open retention decisions.
- Rewriting the order form or messages; they are reused.

## Anti-goals (a failure even if it works)

- A rep seeing team reports, team check-ins or other reps' orders.
- Management tools still reachable only from inside the rep's page.
- Order approval that a direct API call can bypass.
- An existing manager silently losing access on release.

## Decisions (author's calls unless marked as the owner's)

- Layout A, summary panel (owner's choice).
- Orders from a visit (owner's choice); link stored as a nullable `orders.field_activity_id` referencing
  `field_activities(id)`.
- Self-approval: only the owner may approve an order they created (author's call).
- Transition for managers: the name rule stays as a fallback in `is_field_manager` (author's call); removing it later
  is a separate decision once roles are set up with the new permission.
- Rep landing: Field is the landing page for a person whose menu includes Field and does not include the dashboard.
- Module keys (author's call): the rep's Field keeps the existing `activity` key (relabelled "Field"), so stored role
  permissions keep working. The Field team section is NOT a nav entry stored on roles: it shows for anyone who is a
  field manager (owner, `canManageField`, or the name rule), so there is one switch, not two.
- "X of Y reps checked in" (author's call): Y = active staff whose menu includes Field and who are not field
  managers; the owner is not counted.
- Orders' child tables (`order_items`, `order_files`, `order_events`, `order_watchers`) follow the visibility of their
  order.
- Raising an order needs a connection (author's call): orders are not added to the offline queue in this work; offline,
  "Raise order" says so instead of failing.
- Database changes ship as drafts for approval and are verified the project's way (catalog read-back, rolled-back
  runs as real users, residue check, advisor before and after).

## What the builder decides

File layout of the split pages, component names, and how the existing 1,800-line `LiveActivity.jsx` is divided,
following the repository-seam pattern already used in the module.

## Builder notes (where things are today)

- Module registry, roles, nav order, `isManagerRole`, `canSeeAllActivity`, `DEFAULT_STAFF_PERMS`:
  `apps/carehub/src/lib/permissions.js`.
- Routes and guards: `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx`; dashboard home:
  `modules/dashboard-home/DashboardHome.jsx`.
- Field page today: `modules/live-activity/LiveActivity.jsx` (+ `feedScope.js`); check-ins: `modules/checkins/`.
- Orders: `modules/orders/` (approval check `canApprove` is UI-only); messages: `modules/messages/`.
- DB: `caller_sees_all_activity` in `supabase/migrations/carehub_20261131_field_activity_access.sql`;
  `is_business_manager` in `carehub_20260823_facility_review_authorization.sql`; `manager_checkin_overview` in
  `carehub_20261130_staff_checkins.sql`; orders policy "orders of own business" (live).
