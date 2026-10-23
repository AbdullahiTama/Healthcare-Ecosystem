# Field Team Reorganisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reps work from a focused Field login (Field, Orders, Messages; orders started from a visit); owners and field managers manage the team from a "Field team" section and a dashboard summary; order approval and team check-ins are enforced by the database.

**Architecture:** The module registry in `lib/permissions.js` stays the single source of truth: new Field team entries carry an `access` rule (`field-manager` / `owner`) instead of living in role nav arrays, so the sidebar, route guards and landing page all derive from `getNavItems`. `LiveActivity` gains a `mode` prop (`rep` | `team`) so one tested feed serves both pages; the management modals become their own pages. Database work is three drafts in `docs/architecture/pending-migrations/`, applied only with owner approval.

**Tech Stack:** React 18 + Vite, vitest + Testing Library (react-dom/client + act, as the existing tests), Supabase/PostgREST, PGlite tests in `scripts/db-tests/`.

**Spec:** `docs/superpowers/specs/2026-10-23-field-team-reorganisation-design.md`

## Global Constraints

- Scope is `manufacturer_importer` and `wholesale` (ENTERPRISE_TYPES). Nothing changes for other business types.
- No one who can see team activity, team check-ins or an order today loses it on release, except the order
  visibility the spec deliberately narrows (Goal 5).
- The field-manager rule is `canSeeAllActivity({ isOwner, role, perms })` in the app and `caller_sees_all_activity(bid)`
  in the database. Do not add another permission key; relabel `canManageDirectory` to "Manage field team".
- Work on branch `feat/field-team-reorganisation` (worktree `C:\Users\USER\Desktop\HealthCare-Ecosystem-hardening`).
  `main` is production: push or merge only when the owner says so.
- DB drafts: `apply_migration` only, one at a time, with owner approval; read back `pg_policies`/`pg_proc.proacl`
  (one overload, no `anon`); rolled-back `DO` run as real users with the `email` claim set; residue check; advisor
  snapshot before and after.
- One commit per unit; behaviour changes separate from moves. `git add` and `git commit` in one command, explicit paths.
- Every new screen: loading, error and empty states; keyboard and screen-reader operable; checked at 375, 768 and 1280 px.
- After moving JSX run `npm run lint:undef` (CareHub ESLint has no React plugin).

## Review Focus

1. A wholesale "Regional Manager" with no custom role keeps today's menu, and no existing manager loses Team reports or Team check-ins (Task 1, Task 8).
2. A person whose menu has no `dashboard` lands on Field, never in a redirect loop (Task 1).
3. An owner or manager who also logs visits still logs from Field and sees their own reports there (Task 3).
4. The creator of an order cannot approve it through a direct API call, while the tagged approver's approval in the UI still works (Task 7).
5. "Raise order" offline says so and creates nothing; a Field team URL typed by a rep redirects away (Task 6, Task 4).

---

### Task 1: Registry, rep menu, landing page

**Files:**
- Modify: `apps/carehub/src/lib/permissions.js` (MODULES, NAV_SECTIONS, SECTION_ORDER, getNavItems, new helpers)
- Modify: `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx` (landing route, `dashboard` guard)
- Test: `apps/carehub/src/lib/__tests__/fieldNav.test.js`, `apps/carehub/src/pages/dashboard/__tests__/BusinessDashboard.test.jsx` (extend)

**Interfaces:**
- Produces:
  - `MODULES.activity.label = 'Field'`, `section: 'field'`; new section `field` ("Field") and `field-team` ("Field team") in `NAV_SECTIONS`, ordered `overview, field, field-team, operations, ...`.
  - New MODULES (types ENTERPRISE_TYPES, section `field-team`, each with `path` under `/dashboard/field-team/`):
    `field-reports` (Team reports, `access: 'field-manager'`), `field-checkins` (Team check-ins, `field-manager`),
    `field-approvals` (Order approvals, `field-manager`), `field-places` (Places to confirm, `field-manager`),
    `field-fields` (Report fields, `access: 'owner'`).
  - `getNavItems(role, businessType, customRoles)` includes a module when `perms.nav` lists it, OR its `access` is
    `field-manager` and `canSeeAllActivity({ isOwner: role === 'Owner', role, perms })`, OR its `access` is `owner` and `role === 'Owner'`.
  - `FIELD_REP_NAV = ['activity', 'orders', 'messages']`; `getPerms` unchanged, but `getNavItems` uses `FIELD_REP_NAV`
    when the role fell back to `DEFAULT_STAFF_PERMS`, the type is enterprise and `!isManagerRole(role)`.
  - `landingRoute(allowedKeys: string[]) -> string`: `'dashboard'` if allowed, else `'activity'` if allowed, else the first allowed key.

- [ ] **Step 1: Failing tests** (`fieldNav.test.js`): Owner of a manufacturer gets every `field-*` item and `activity` labelled "Field" in section `field`; an unknown role "Medical sales rep" at a manufacturer gets exactly `activity, orders, messages`; "Regional Manager" (unknown) at a wholesaler gets today's `DEFAULT_STAFF_PERMS` set plus the four `field-manager` items but not `field-fields`; a custom role with `canManageDirectory: true` gets the four `field-manager` items; a pharmacy Owner gets no `field-*` item and no `activity`; an unknown role at a pharmacy gets today's fallback unchanged; `landingRoute(['activity','orders'])` is `'activity'`, `landingRoute(['dashboard','activity'])` is `'dashboard'`; `getNavGroups` puts the Field team items in a group labelled "Field team".
- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/lib/__tests__/fieldNav.test.js`
- [ ] **Step 3: Implement** the registry changes and helpers above. Keep `ALL_NAV_*` exports working.
- [ ] **Step 4: Run** the new test plus `src/lib` (existing permissions tests must stay green; update any that asserted the old `activity` label or section, as a deliberate change).
- [ ] **Step 5: Landing.** Test in `BusinessDashboard.test.jsx`: a rep (nav without `dashboard`) opening `/dashboard` ends on the Field page and the route renders once (no loop); an Owner still lands on the dashboard. Implement: the index, `dashboard` and `*` routes navigate to `landingRoute(allowedRouteKeys)`, and `guard()` redirects to it instead of the hard-coded `'dashboard'`.
- [ ] **Step 6: Commit** `feat(field): registry sections, rep menu and landing page`.

### Task 2: Roles: templates and the relabelled permission

**Files:**
- Modify: `apps/carehub/src/lib/roleTemplates.js` (`ROLE_TEMPLATES.enterprise`), `apps/carehub/src/modules/staff/Staff.jsx:82`
- Test: `apps/carehub/src/lib/__tests__/roleTemplates.test.js` (create or extend), Staff test if one covers the permission list

- [ ] **Step 1: Failing tests:** enterprise templates include **Field Rep** (`nav: ['activity','orders','messages']`, every boolean false) and **Field Manager** (`nav: ['dashboard','activity','orders','messages','territories']`, `canManageDirectory: true`, `canViewReports: true`); the Staff permission list shows label "Manage field team" with a description saying it opens the Field team section and team check-ins.
- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Commit** `feat(staff): Field Rep and Field Manager templates; "Manage field team" label`.

### Task 3: One feed, two modes

**Files:**
- Modify: `apps/carehub/src/modules/live-activity/LiveActivity.jsx`, `feedScope.js`
- Create: `apps/carehub/src/modules/live-activity/ReportFieldsSetup.jsx`, `PlacesToConfirm.jsx` (move the existing modals' content; behaviour unchanged)
- Test: `LiveActivity.mode.test.jsx` (create); existing `LiveActivity.*.test.jsx` keep passing (they render the default mode)

**Interfaces:**
- Produces: `<LiveActivity mode="rep" | "team" />`, default `"rep"`.
  - `rep`: check-in panel, Log Activity, tabs **My reports** and **Shared with me** for everyone (a manager's
    "Shared with me" shows only reports they are tagged on, filtered with `canSeeAll: false`), outbox strip, notice.
    No Team tab, no team check-ins, no Set up fields, no Review facilities, no table/export, no Compare location.
  - `team`: no check-in panel, no Log Activity; the team feed (scope `team` with `canSeeAll: true`), feed/table
    switch, filters, export, Compare location. Rendered only for field managers (Task 4 guards it).
  - `<ReportFieldsSetup brand />` and `<PlacesToConfirm brand />` are standalone pages with their own loading/error/empty states.

- [ ] **Step 1: Failing tests** (`LiveActivity.mode.test.jsx`, mocks as in `LiveActivity.target.test.jsx`): as Owner in `rep` mode the page shows Log Activity and the two tabs and none of: "Team Reports", "Set up fields", "Review facilities", "Export", the team check-ins component; as Owner in `team` mode it shows the team feed, "Export" and "Table", and no "Log Activity" and no check-in panel; a non-manager in `rep` mode sees only their own and tagged reports; a manager in `rep` mode under "Shared with me" sees only reports they are tagged on.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Move first, then change.** Commit the extraction of `ReportFieldsSetup` and `PlacesToConfirm` (still opened from the page) as `refactor(field): extract report fields and places review` with the full live-activity folder green. Then implement `mode` and remove the management entry points from `rep` mode.
- [ ] **Step 4: Run** the mode tests and the whole live-activity folder; `npm run lint:undef`.
- [ ] **Step 5: Commit** `feat(field): rep and team modes of the activity feed`.

### Task 4: Field team pages and routes

**Files:**
- Modify: `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx` (routes), `apps/carehub/src/modules/orders/Orders.jsx` (accept `view` prop)
- Test: `BusinessDashboard.test.jsx` (extend), `apps/carehub/src/modules/orders/__tests__/approvals.test.jsx` (create)

**Interfaces:**
- Consumes: Task 1 module keys and paths; Task 3 `mode`, `ReportFieldsSetup`, `PlacesToConfirm`.
- Produces routes, each wrapped in `guard(<key>)`: `field-team/reports` → `<LiveActivity mode="team" />`;
  `field-team/checkins` → `<TeamLocations />` (existing); `field-team/approvals` → `<Orders view="approvals" />`;
  `field-team/places` → `<PlacesToConfirm />`; `field-team/fields` → `<ReportFieldsSetup />`.
  `<Orders view="approvals">` lists only `status = 'submitted'` orders where the viewer is the tagged approver (or all
  submitted ones for the Owner), with the existing approve/reject controls and no New Order button.
  It loads through a new `orderRepository.listAwaitingApproval(businessId, { approverStaffId, isOwner }) -> Promise<Order[]>`
  (in `modules/orders/repositories/index.js`), which Task 5 also uses for its count.

- [ ] **Step 1: Failing tests:** each route renders its page for an Owner; a rep typing `/dashboard/field-team/reports` lands on their landing page; the approvals view shows only orders awaiting the viewer and no "New Order".
- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Check** the five pages at 375/768/1280 px in a browser if one is connected; otherwise record "not checked in a browser" in the PR.
- [ ] **Step 4: Commit** `feat(field): Field team pages and routes`.

### Task 5: "Field team today" on the dashboard home

**Files:**
- Create: `apps/carehub/src/modules/dashboard-home/FieldTeamToday.jsx`, `fieldTeamToday.js` (pure summariser)
- Modify: `apps/carehub/src/modules/dashboard-home/DashboardHome.jsx` (render for enterprise field managers, like the hospital block)
- Test: `modules/dashboard-home/__tests__/fieldTeamToday.test.js`, `FieldTeamToday.test.jsx`

**Interfaces:**
- Produces: `summariseFieldDay({ staff, checkins, visits, ordersAwaiting, placesPending, now, perms }) -> { checkedIn, repsTotal, visitsToday, ordersToApprove, placesToConfirm, checkinRows: [{ name, at, area, stale, missing }], visitRows: [{ at, rep, place, badge, hasOrder, hasPhoto }] }`.
  `repsTotal` = active staff whose nav (via `getNavItems`) includes `activity` and who are not field managers; the
  owner is not counted. `stale` = last check-in over `STALE_AFTER_MINUTES` (60). `missing` = a counted rep with no
  check-in today. Visits are today's reports, newest first, at most 8 rows.
- Consumes: the check-in team overview (as `TeamLocations` loads it), `liveActivityRepository.getFieldActivities(brandId, { since: startOfToday })`, Task 4's `orderRepository.listAwaitingApproval`, and pending rep-added facilities (`getRepAddedFacilities` in `lib/places.js`, as the page loads them today).

- [ ] **Step 1: Failing tests** for `summariseFieldDay`: counts with an owner, two reps (one checked in 20 min ago, one 3 h ago) and one rep not checked in → `checkedIn 2, repsTotal 3`, one `stale`, one `missing`; a manager is not counted; visits from yesterday are excluded; more than 8 visits are capped.
- [ ] **Step 2: Failing tests** for the component: loading placeholder; an error with Retry; empty day ("No check-ins yet today", "No visits yet today"); links go to `field-team/reports` and `field-team/checkins`; not rendered for a pharmacy or for a rep.
- [ ] **Step 3: Implement; run, expect PASS;** check 375/768/1280 px (two lists stack on a phone).
- [ ] **Step 4: Commit** `feat(field): Field team today on the dashboard home`.

### Task 6: Order started from a visit

**Files:**
- Create: `docs/architecture/pending-migrations/carehub_20261026_orders_field_activity_link.sql`
- Modify: `modules/live-activity/LiveActivity.jsx` (report card), `modules/orders/Orders.jsx` (prefill), `modules/orders/repositories/index.js`
- Test: `LiveActivity.orders.test.jsx` (create), `modules/orders/__tests__/fromVisit.test.jsx` (create), `scripts/db-tests/activity.pglite.mjs` (extend)

**Interfaces:**
- Produces: column `orders.field_activity_id uuid NULL REFERENCES field_activities(id) ON DELETE SET NULL`, index on it.
  On a report the viewer authored, a "Raise order" button navigates to `/dashboard/orders` with router state
  `{ fromVisit: { activityId, customer_name, customer_address } }` (name and address from `facility_*` or `directory_business_name`).
  `Orders` opens the composer prefilled from that state and sends `field_activity_id`. A report card lists its orders
  (ref and status) from one request for the visible report ids.

- [ ] **Step 1: DB draft + PGlite tests first:** the column exists and is nullable; an order may reference a report of its own company only (a check or trigger: refuse a report of another company with 42501); deleting is not possible anyway (Task 7) but a removed report would leave the order with a NULL link; re-applying is safe.
- [ ] **Step 2: Failing UI tests:** "Raise order" appears on my own report, not on a colleague's; it opens Orders with the customer filled in; the submitted order carries `field_activity_id`; offline (`navigator.onLine = false`) the button explains that an order needs a connection and nothing is sent; the report shows "Order ORD-… · Awaiting approval" once linked.
- [ ] **Step 3: Implement; run, expect PASS.** Before the column is applied, the repository omits `field_activity_id` when the server reports an unknown column (same pattern as `gps_accuracy_m`); test it.
- [ ] **Step 4: Commit** in two: the draft with its DB tests; the UI.

### Task 7: Orders authorisation (draft)

**Files:**
- Create: `docs/architecture/pending-migrations/carehub_20261026_orders_authorisation.sql`
- Test: `scripts/db-tests/orders.pglite.mjs` (create, on `_harness.mjs`, with the live "orders of own business" and "order_items via parent order" policies copied as the BEFORE state)

**Interfaces:**
- Produces:
  - RESTRICTIVE SELECT on `orders` TO authenticated: `caller_sees_all_activity(business_id) OR created_by_staff_id = caller_staff_id(business_id) OR approver_staff_id = caller_staff_id(business_id) OR id IN (watched by the caller)`.
  - `orders_status_guard()` BEFORE UPDATE trigger: changing `status` to `approved` or `rejected` is allowed only for the tagged approver or the owner, never for the creator unless owner (42501); other status steps follow `submitted → approved → processing → dispatched → delivered`; `created_by_*` and `business_id` cannot change.
  - DELETE on `orders` and its child tables refused to authenticated (restrictive policy `USING (false)` for DELETE).
  - Child tables (`order_items`, `order_files`, `order_events`, `order_watchers`) get a RESTRICTIVE SELECT that follows their order's visibility.
- [ ] **Step 1: Tests first (BEFORE shows each hole is real, AFTER closes it):** a rep reads a colleague's order (before yes, after no); the creator sets their own order to approved via UPDATE (before yes, after 42501); the tagged approver approves (still works); the owner approves anything; a watcher reads the order; a member deletes an order (before yes, after 0 rows); a field manager reads all; another company reads none; status cannot jump from submitted to delivered; child rows follow; re-apply is safe; trigger function not executable by `anon`/`authenticated`.
- [ ] **Step 2: Run, expect FAIL on the AFTER block; write the draft; run, expect PASS.**
- [ ] **Step 3: UI check:** run the orders and live-activity suites; the Orders page's own approve/reject and event writes still work against a mocked refusal (the toast shows the database message).
- [ ] **Step 4: Commit** `docs(orders): draft orders authorisation (not applied)`.

### Task 8: Team check-ins follow the field-manager rule (draft, closes F2)

**Files:**
- Create: `docs/architecture/pending-migrations/carehub_20261026_checkin_overview_field_manager.sql`
- Test: `scripts/db-tests/checkins.pglite.mjs` (extend)

- [ ] **Step 1: Tests first:** a custom role with `canManageDirectory` (via the harness's directory-manager stub) is refused `manager_checkin_overview` before and allowed after; a name-rule manager is allowed before and after; a plain rep is refused before and after; the access log still gets its row; one overload, no `anon` execute.
- [ ] **Step 2: Draft** `CREATE OR REPLACE` of `manager_checkin_overview(uuid)` with the identical body except the check becomes `caller_sees_all_activity(p_business_id)`; read the live definition first and change only that line.
- [ ] **Step 3: Run, expect PASS; commit** `docs(checkins): draft team check-ins for field managers (not applied)`.

### Task 9: Docs, verification, review

- [ ] **Step 1:** Update `docs/audits/live-field-activity-audit.md` (new section: the reorganisation, F2 status, the orders finding) and `docs/architecture/pending-migrations/README.md` (three new drafts, apply order: 8, 6, 7).
- [ ] **Step 2:** Full CareHub suite, `npm run build`, `npm run lint:undef`; record the known `business-directory` timing failure as pre-existing.
- [ ] **Step 3:** A walk-through as an Owner, a Field Manager and a Field Rep in a browser (if one is connected): landing page, menu, Raise order, approvals, dashboard panel; otherwise list it as not run in the PR.
- [ ] **Step 4:** Final whole-branch review; open a PR against `main` only when the owner asks.
