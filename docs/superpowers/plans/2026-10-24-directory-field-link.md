# Directory × Field Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers derived from field visits (manager page with a "not visited in" filter, rep tab, dashboard tile) and rep suggestions of missing businesses reviewed by the platform admin.

**Architecture:** One draft migration adds two SECURITY INVOKER readers (`field_customers`, `field_customer_visits`) over the caller's own RLS, and a `directory_suggestions` table with forced-identity insert and a daily cap. Client: a `customers` folder under live-activity (repository, pure filter, manager page, rep tab, history panel) and a `suggestions` folder under business-directory (repository, rep form, admin tab).

**Tech Stack:** React 18 + Vite, vitest (react-dom/client + act, MemoryRouter), Supabase PostgREST via `sbFetch`, PGlite DB tests.

**Spec:** `docs/superpowers/specs/2026-10-24-directory-field-link-design.md`

## Global Constraints

- Scope: manufacturers and wholesalers (ENTERPRISE_TYPES) only.
- Directory stays platform-admin only; no new read of `directory_businesses` by companies.
- Customer key: `d:<directory_business_id>` or `f:<lower(trim(facility_name))>@<round(lat,3)>,<round(lng,3)>`; visits with neither are not customers.
- "Not visited in" choices: any / 14 / 30 / 60 / 90 days; dashboard tile uses 30.
- List limit 500, most recently visited first, with a "showing the 500 most recent" note when 500 rows come back.
- Suggestion types: `pharmacy` Pharmacy, `hospital` Hospital, `clinic` Clinic, `laboratory` Laboratory, `distributor` Distributor, `retail` Retail shop, `other` Other.
- Suggestion cap: 20 per company per 24 hours. Name 2–200 chars, note ≤ 500 chars.
- DB changes are drafts in `docs/architecture/pending-migrations/`; nothing is applied without the owner.
- Commits: one per task, `git add` + `git commit` in one command with explicit paths; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Every screen: loading, error (with retry), empty state, responsive (wraps at phone width), accessible labels.

## Review Focus

1. A rep's My customers must not include customers that exist only through a colleague's report shared with them → `p_staff_id` filters `staff_id`; test in Task 1.
2. "Log a visit here" for a facility far from the rep → the saved report is unverified/pending, never verified; test in Task 5.
3. A suggestion insert that sends someone else's staff id, name, email, or status `accepted` → stored as the caller, pending; test in Task 1.
4. The same facility visited with slightly different name casing/spaces → one customer; test in Task 1.
5. Orders raised from a visit at a customer appear as its last order even when the newest visit has no order → last order is the newest order across all that customer's visits; test in Task 1.

---

### Task 1: Migration draft and DB tests

**Files:**
- Create: `docs/architecture/pending-migrations/carehub_20261027_directory_field_link.sql`
- Create: `scripts/db-tests/directoryFieldLink.pglite.mjs`
- Modify: `docs/architecture/pending-migrations/README.md` (pending row)

**Interfaces:**
- Produces (SQL):
  - `field_customer_key(p_directory_business_id uuid, p_facility_name text, p_facility_lat double precision, p_facility_lng double precision) RETURNS text` IMMUTABLE.
  - `field_customers(p_business_id uuid, p_staff_id uuid DEFAULT NULL, p_limit int DEFAULT 500) RETURNS TABLE(key text, kind text /* 'directory'|'facility' */, directory_business_id uuid, name text, address text, category text, lat double precision, lng double precision, territory_id uuid, last_visit_at timestamptz, last_visit_rep text, last_visit_staff_id uuid, last_activity_id uuid, visits_total int, visits_30d int, rep_staff_ids uuid[], last_order_id uuid, last_order_ref text, last_order_status text, last_order_at timestamptz)` SECURITY INVOKER, STABLE, `search_path public, pg_temp`. Name/address/category/lat/lng/territory from the most recent visit.
  - `field_customer_visits(p_business_id uuid, p_key text, p_limit int DEFAULT 100) RETURNS TABLE(id uuid, created_at timestamptz, rep_name text, staff_id uuid, territory_id uuid, facility_verified boolean, facility_pending_review boolean, place_verified boolean, facility_distance_m int, gps_accuracy_m int, photo_count int, orders jsonb /* [{id, order_ref, status, created_at}] */)` SECURITY INVOKER, newest first.
  - Table `directory_suggestions(id uuid pk default gen_random_uuid(), business_id uuid not null references businesses(id), suggested_by_staff_id uuid, suggested_by_name text, suggested_by_email text, name text not null, business_type text not null, address text, latitude double precision not null, longitude double precision not null, note text, status text not null default 'pending', directory_business_id uuid references directory_businesses(id) on delete set null, review_note text, reviewed_by text, reviewed_at timestamptz, created_at timestamptz not null default now())` with CHECKs for the Global Constraints values and lat/lng ranges.
  - Trigger `directory_suggestions_before_insert` (SECURITY DEFINER, EXECUTE revoked from PUBLIC/anon/authenticated): for `current_user = 'authenticated'` forces `suggested_by_staff_id = caller_staff_id(business_id)`, `suggested_by_name` = that staff's full_name or, for the owner, the business's `owner`/name, `suggested_by_email = auth.email()`, `status = 'pending'`, review fields NULL, `created_at = now()`; refuses (42501) when the caller is not a member (`business_id NOT IN current_business_ids()`) or 20 suggestions for that business exist in the last 24 hours (P0001 message "Too many suggestions today").
  - Trigger `directory_suggestions_before_update` (INVOKER): identity, suggestion and created_at columns immutable; status only `pending → accepted | rejected`; `reviewed_at = now()`, `reviewed_by = auth.email()` set on the transition.
  - Policies (RLS on, all `TO authenticated`): INSERT with check `business_id IN (SELECT current_business_ids())`; SELECT using `is_platform_admin() OR suggested_by_email = auth.email() OR caller_sees_all_activity(business_id)`; UPDATE using/with check `is_platform_admin()`; no DELETE policy (and a RESTRICTIVE delete `USING (false)`). `REVOKE ALL ON directory_suggestions FROM anon`; grant select/insert/update to authenticated.
  - Closing verify block: function overload counts = 1, readers are not SECURITY DEFINER, trigger functions not executable by anon/authenticated, anon has no table privilege, RLS enabled.

- [ ] **Step 1: Write `directoryFieldLink.pglite.mjs`** reusing `_harness.mjs` (`seedStaff`, `as`, `sup`, `applyMigrations`, `makeLikeLive`, `addDirectoryManagerStub`) and the live `field_activities` and `orders` setup copied from `orders.pglite.mjs` (tables, the "of own business" policies, `carehub_20261131_field_activity_access.sql`, `carehub_20261026_orders_field_activity_link.sql`). Create minimal `directory_businesses(id uuid pk, business_id uuid, name text, is_active boolean, verification_status text, data_source text)`. Checks (each `ok`/`expectError`):
  - `customers: repA1 sees one customer for "Allen Pharmacy" and " allen pharmacy " 30 m apart (same grid cell)`
  - `customers: two visits to the same directory listing are one customer, kind directory, name from the newest visit`
  - `customers: visits_30d counts only the last 30 days; visits_total counts all`
  - `customers: a visit with no directory listing and no facility is not a customer`
  - `customers: last order is the newest order across the customer's visits (newest visit has none)`
  - `customers: p_staff_id = repA1 excludes a customer known only from repA2's report shared with repA1` (insert `activity_viewers` row)
  - `customers: repA1 without p_staff_id sees only customers from visits RLS lets them read`
  - `customers: mgrA (field manager) sees the whole team's customers; company B sees none of A's`
  - `customers: rep_staff_ids lists each rep who visited`
  - `visits: field_customer_visits returns that key's visits newest first with their orders, and nothing for another company`
  - `suggestions: repA1 inserts; stored with repA1's staff id, name "Rep One", email, status pending even when the client sends accepted, another staff id and a review note`
  - `suggestions: an outsider (no company) is refused; a member cannot suggest for company B`
  - `suggestions: the 21st suggestion in 24 hours is refused with "Too many suggestions today"`
  - `suggestions: repA2 cannot read repA1's suggestion; mgrA can; company B cannot; admin can`
  - `suggestions: a rep cannot update or delete; admin accepts pending → accepted with directory_business_id, reviewed_by set; accepted → rejected refused; changing name refused`
  - `suggestions: anon has no access; trigger functions not callable; readers are SECURITY INVOKER`
  - migration applies and re-runs cleanly.

- [ ] **Step 2: Run it, expect failures** — `cd $SP/pg && cp <repo>/scripts/db-tests/*.mjs . && REPO_ROOT=<repo> node directoryFieldLink.pglite.mjs` → migration missing.
- [ ] **Step 3: Write the migration** to the Interfaces above (header: what, why, security implications, rollback).
- [ ] **Step 4: Run to green**, then rerun `orders.pglite.mjs` and `checkins.pglite.mjs` (unchanged, still green).
- [ ] **Step 5: Add the README pending row** (order 1, "Ready", one-line summary) and commit `feat(db draft): field customers readers and directory suggestions (not applied)`.

### Task 2: Customer repository and filter

**Files:**
- Create: `apps/carehub/src/modules/live-activity/customers/repository.js`, `customerFilter.js`
- Test: `apps/carehub/src/modules/live-activity/customers/__tests__/repository.test.js`, `customerFilter.test.js`

**Interfaces:**
- Produces:
  - `createCustomerRepository({ request = sbFetch })` → `{ list(businessId, { staffId = null } = {}) : Promise<Customer[]>, visits(businessId, key) : Promise<Visit[]> }`; `export const customerRepository`. Both POST `rpc/field_customers` (`{ p_business_id, p_staff_id }`) / `rpc/field_customer_visits` (`{ p_business_id, p_key }`). Before the migration exists the server answers PGRST202/42883: `list` and `visits` then throw `Error` with `code = 'NOT_AVAILABLE'` and message "Customers are not available yet."
  - `filterCustomers(rows, { search = '', territoryId = '', staffId = '', notVisitedDays = 0, now = Date.now() }) : Customer[]` — search matches name or address case-insensitively; territory matches `territory_id`; staff matches `rep_staff_ids` includes; `notVisitedDays > 0` keeps rows whose `last_visit_at` is older than that many days.
  - `NOT_VISITED_CHOICES = [[0,'Any time'],[14,'14 days'],[30,'30 days'],[60,'60 days'],[90,'90 days']]`, `LIST_LIMIT = 500`.

- [ ] **Step 1: Tests** — `list sends p_business_id and p_staff_id null for a manager, the staff id for a rep`; `visits sends the key`; `an unknown-function answer becomes NOT_AVAILABLE`; other errors pass through; `filterCustomers` cases for each filter and their combination, boundary: exactly 30 days ago is NOT older than 30 days.
- [ ] **Step 2: Run, RED** — `npx vitest run src/modules/live-activity/customers`
- [ ] **Step 3: Implement**
- [ ] **Step 4: GREEN**
- [ ] **Step 5: Commit** `feat(field customers): repository and filters`

### Task 3: Manager page — Field team → Customers

**Files:**
- Create: `apps/carehub/src/modules/live-activity/customers/CustomersPage.jsx`, `CustomerHistory.jsx`
- Modify: `apps/carehub/src/lib/permissions.js` (module `field-customers`: label 'Customers', icon `Store`, section 'field-team', path '/dashboard/field-team/customers', access 'field-manager'; NAV_ORDER.enterprise after 'field-reports'), `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx` (lazy route `field-team/customers` via `guard('field-customers', …)` with TopBar 'Customers')
- Test: `customers/__tests__/CustomersPage.test.jsx`, `CustomerHistory.test.jsx`; update `lib/__tests__/fieldNav.test.js` (FIELD_TEAM includes 'field-customers'; section order)

**Interfaces:**
- Consumes: Task 2 `customerRepository`, `filterCustomers`, `NOT_VISITED_CHOICES`, `LIST_LIMIT`; `territoryRepository.getAll(businessId)`; `staffRepository.getAll(businessId)`; `STAGE_LABEL` from `orders/stages.js`; `storedVerification` + `LocationMatchBadge` for history rows.
- Produces: `CustomersPage({ brand })`; reads `?notVisited=<days>` once on mount (one of the choices, else 0). `CustomerHistory({ businessId, customer, onClose })` (modal/sheet).

- [ ] **Step 1: Tests** — loading then rows (name, kind badge "Directory"/"Map", last visit rep and relative time, "3 visits · 1 in 30 days", "Order ORD-1 · Approved"); search/territory/rep/not-visited filters narrow the rows; `?notVisited=30` preselects 30 days; empty: "No customers yet. A customer appears when a rep chooses the place while logging a visit."; filtered-empty: "No customers match these filters."; NOT_AVAILABLE shows "Customers are not available yet." without retry; other error shows retry that reloads; 500 rows shows "Showing the 500 most recently visited customers."; clicking a row opens history with visits newest first, each with its orders, and its own loading/error/empty.
- [ ] **Step 2: RED** · **Step 3: Implement** (table on wide screens, stacked cards under 640 px; filters wrap) · **Step 4: GREEN** (plus fieldNav, BusinessDashboard tests)
- [ ] **Step 5: Commit** `feat(field customers): Field team > Customers with visit history and a not-visited filter`

### Task 4: Field team today tile

**Files:**
- Modify: `apps/carehub/src/modules/dashboard-home/FieldTeamToday.jsx`, `fieldTeamToday.js`
- Test: `dashboard-home/__tests__/FieldTeamToday.test.jsx`, `fieldTeamToday.test.js`

**Interfaces:**
- Consumes: `customerRepository.list(brand.id)`.
- Produces: `summariseFieldDay({ …, customers = [] })` returns `quietCustomers` = rows with `last_visit_at` older than 30 days.

- [ ] **Step 1: Tests** — `quietCustomers` counts only older than 30 days; the tile reads "2 customers not visited in 30 days" and links to `/dashboard/field-team/customers?notVisited=30`; a failed or NOT_AVAILABLE customers load hides the tile and leaves the other sections working.
- [ ] **Step 2: RED** · **Step 3: Implement** (add to the existing `Promise.allSettled`) · **Step 4: GREEN** · **Step 5: Commit** `feat(field team today): customers going quiet`

### Task 5: Rep — My customers, Log a visit here, Raise order

**Files:**
- Create: `apps/carehub/src/modules/live-activity/customers/MyCustomers.jsx`
- Modify: `apps/carehub/src/modules/live-activity/feedScope.js` (`scopeTabs(canSeeAll, { withCustomers = false } = {})` appends `['customers','My customers']`), `LiveActivity.jsx` (tabs pass `withCustomers: !isTeamView && !!meStaffId`; `scope === 'customers'` renders `<MyCustomers>` in place of the feed/table and its view switch; feed loading ignores scope 'customers'; `openLogger(target)` applies `target.facility` / `target.business` after the reset), `apps/carehub/src/modules/orders/Orders.jsx` (`location.state.fromCustomer = { customer_name, customer_address }`: opens the form prefilled, banner "For {name}.", no `field_activity_id`, cleared like fromVisit)
- Test: `customers/__tests__/MyCustomers.test.jsx`, `live-activity/LiveActivity.customers.test.jsx`, `orders/__tests__/fromCustomer.test.jsx`, update `feedScope` tests if present

**Interfaces:**
- Consumes: Task 2 `customerRepository.list(businessId, { staffId })`; Task 6 `SuggestionsList` (rendered below the list; until Task 6 lands, omit).
- Produces: `MyCustomers({ brand, staffId, onLogVisit(target), onRaiseOrder(customer) })` where `target = { business: { id, name } }` for directory customers or `{ facility: { name, address, category, lat, lng, source: 'remembered' } }` for facility customers.

- [ ] **Step 1: Tests** — tab shows for staff in rep mode, not for the owner nor in team mode; list calls `list(biz, { staffId: me })`, sorted newest first, with last order stage; empty "You have no customers yet. Choose the place when you log a visit and it will appear here."; error with retry; "Log a visit here" opens the log form with the facility chosen and GPS capture started; a facility 2 km from the captured fix saves `facility_verified: false` (pending or unverified per `facilityVerification`), never true; a directory customer saves `directory_business_id`; "Raise order" navigates to `/dashboard/orders` with `fromCustomer` and the order form opens prefilled, banner "For Allen Pharmacy.", submit has no `field_activity_id`, state cleared via `replaceState` without a navigation.
- [ ] **Step 2: RED** · **Step 3: Implement** · **Step 4: GREEN** (whole live-activity and orders suites)
- [ ] **Step 5: Commit** `feat(field customers): My customers on the rep's Field page`

### Task 6: Rep — suggest a missing business

**Files:**
- Create: `apps/carehub/src/modules/business-directory/suggestions/repository.js`, `SuggestBusiness.jsx`, `SuggestionsList.jsx`
- Modify: `apps/carehub/src/modules/live-activity/VisitTarget.jsx` (when `gps && !business`: a link button "Business not in the CareHub directory? Suggest it" opening `SuggestBusiness`; props `businessId`, `areaLabel`), `LiveActivity.jsx` (pass `areaLabel={placeName}`), `customers/MyCustomers.jsx` (render `SuggestionsList` below)
- Test: `suggestions/__tests__/repository.test.js`, `SuggestBusiness.test.jsx`, `SuggestionsList.test.jsx`; extend `VisitTarget` tests if present

**Interfaces:**
- Produces:
  - `createSuggestionRepository({ request = sbFetch })` → `{ create(businessId, { name, business_type, address, latitude, longitude, note }), listMine(), listPending(), markAccepted(id, directoryBusinessId), reject(id, reviewNote) }`; `export const suggestionRepository`; `SUGGESTION_TYPES` (Global Constraints list). `listMine` = `directory_suggestions?suggested_by_email=eq.<auth email>&order=created_at.desc` (RLS is the boundary; the filter keeps a manager's own list personal). `listPending` = `status=eq.pending&order=created_at.asc&select=*,businesses(name)`. Missing table (42P01/PGRST205) → `Error` code `NOT_AVAILABLE`.
  - `SuggestBusiness({ businessId, gps, areaLabel, onClose, onSent })`; `SuggestionsList({ repo = suggestionRepository })`.

- [ ] **Step 1: Tests** — form requires a name (2+ chars) and a type; address prefilled with the area caption; sends the GPS position; without GPS shows "Your position is needed to suggest a business." and no send button; success shows "Thanks. The CareHub team will review it." and calls onSent; the cap error shows "You have sent many suggestions today. Try again tomorrow."; other errors show the message with the form kept; offline shows "Suggesting a business needs a connection."; SuggestionsList shows each with status "Waiting for review" / "Added to the directory" / "Not added" (+ review note), empty renders nothing, NOT_AVAILABLE renders nothing.
- [ ] **Step 2: RED** · **Step 3: Implement** · **Step 4: GREEN** · **Step 5: Commit** `feat(directory): reps suggest a business missing from the directory`

### Task 7: Admin — Suggestions tab

**Files:**
- Create: `apps/carehub/src/modules/business-directory/suggestions/SuggestionsTab.jsx`
- Modify: `apps/carehub/src/modules/business-directory/BusinessDirectory.jsx` (TABS gains `['suggestions','Suggestions']` in `platformMode` only; `BusinessForm` receives `initial` when `editing.id || editing.fromSuggestion`; `saveBusiness` after `repo.create` calls `suggestionRepository.markAccepted(editing.fromSuggestion, created.id)` and on failure toasts "The listing was added but the suggestion is still open. Use Mark as added." keeping the suggestion visible)
- Test: `suggestions/__tests__/SuggestionsTab.test.jsx`, extend `business-directory/__tests__/platformMode.test.jsx`

**Interfaces:**
- Consumes: Task 6 `suggestionRepository`; directory `repo.searchWithinBox(scopeId, { lat, lng, radiusKm: 0.2 }, {}, { limit: 10 })`.
- Produces: `SuggestionsTab({ repo, suggestionRepo, scopeId, onAdd(prefill) })` where `prefill = { fromSuggestion: id, name, address, latitude, longitude, description: 'Suggested by <rep> of <company>. Type: <label>. <note>' }`.

- [ ] **Step 1: Tests** — tab only in platformMode; lists pending oldest first with company, rep, date, type, address, note; each shows listings within 200 m or "No listing within 200 m"; "Add to directory" opens the business form prefilled and saving creates then marks accepted (row leaves the list); markAccepted failure keeps the row with "Mark as added" which calls `markAccepted` with the created id; "Reject" with optional reason calls `reject` and removes the row; loading, error with retry, empty "No suggestions waiting."
- [ ] **Step 2: RED** · **Step 3: Implement** · **Step 4: GREEN** · **Step 5: Commit** `feat(directory admin): review business suggestions from field reps`

### Task 8: Docs, full verification, review

**Files:**
- Modify: `docs/architecture/pending-migrations/README.md`; correct the stale "DRAFT, NOT APPLIED" header line in `supabase/migrations/carehub_20261208_directory_company_lockdown.sql` (applied 2026-10-22, version 20261022151535); audit/spec status notes.

- [ ] **Step 1:** Full carehub suite, `npm run build`, `npm run lint:undef`; all three PGlite suites.
- [ ] **Step 2:** Commit docs `docs(directory field link): record the draft and status`.
- [ ] **Step 3:** Final whole-branch review; fix Critical/Important with RED→GREEN.
