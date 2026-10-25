# Business Directory × Live Field Activity — design

Date: 2026-10-24. Owner request: "lets go ahead with … 1-4" (visit history per business, coverage gaps, the rep's
customer list, suggesting a missing business). The owner skipped the questions and asked for a recommendation, so
every product call below is the author's unless marked as the owner's.

## Intent

A manufacturer's or wholesaler's field team visits the same pharmacies, clinics and shops again and again. Today
each visit is a separate report; nothing answers "when did we last see Allen Pharmacy, who went, and did it buy?",
"which of our customers have gone quiet?", or, for a rep, "who are my customers?". And when a rep stands in a
business the CareHub directory does not know, there is no way to tell the platform team.

## Scope

Manufacturers and wholesalers (ENTERPRISE_TYPES), as for the rest of Live Field Activity (owner, 2026-10-23).

## Facts this design rests on (live, 2026-10-24)

- The directory is **platform-admin only** (owner decision 2026-10-22, migration
  `carehub_20261208_directory_company_lockdown`, applied). A company reaches it only through
  `nearby_directory_businesses` (verified listings within 1 km, at most 10, name/address/type/distance).
- The live directory holds **0 businesses**. 12 live visits, none linked to a listing or a map facility.
- A report names at most one target: a directory listing (`directory_business_id/name`) or a map facility
  (`facility_name/address/category/lat/lng/source`), or neither (a caption only).
- The removed Territory Intelligence readers (`directory_unvisited`, `directory_visit_totals`, …) only ever read
  a company's OWN directory rows, which companies can no longer create. They stay revoked and unused.

## Goals

### 1. Customers (managers): Field team → Customers

A **customer** is a place the team has visited, identified by the report's target:
- a directory listing: key `d:<directory_business_id>`, name = the stored `directory_business_name`;
- a map facility: key `f:<lower(trim(name))>@<lat rounded to 3 dp>,<lng rounded to 3 dp>` (≈100 m), name/address/
  category from the visit.
Visits with neither are not customers; the empty state says a customer appears when a rep chooses the place in
the log form.

The page (new module `field-customers`, access `field-manager`, `/dashboard/field-team/customers`) lists customers
with: name and kind (Directory / Map), address, last visit (when, by whom), visits in the last 30 days and in total,
number of reps who visited, and the last order raised from a visit there (reference + stage). Search by name;
filter by territory (of the visits) and by rep. Opening a customer shows its visit history (date, rep, territory,
location match badge, photo count) and the orders raised from those visits.

### 2. Going quiet (coverage gaps, reshaped)

A filter on the Customers page: **Not visited in** any / 14 / 30 / 60 / 90 days. Field team today gains a tile
"N customers not visited in 30 days" linking to the page with that filter on.

Not built (owner decision 2026-10-22): listing directory businesses a company has **never** visited. That would put
the directory back on company dashboards. Recorded as an owner decision if wanted later.

### 3. My customers (reps)

On the rep's Field page, a third tab **My customers**, for staff only (the owner uses Field team → Customers): the
customers from the rep's OWN visits, same columns minus "by whom", sorted by last visit. Each row offers:
- **Log a visit here**: opens the usual log form with that place already chosen as the target. The GPS fix is still
  taken, and the location match is judged exactly as for a place picked by hand (a remembered place is never proof
  of a visit).
- **Raise order**: opens the order form with the customer name and address filled in, NOT linked to an old visit
  (an order is linked to a visit only when raised from that visit's report).

Below the list, **Your suggestions** (goal 4) with each one's status.

### 4. Suggest a missing business

In the log form, under the place suggestions: "Business not in the CareHub directory? Suggest it". A short form:
name (required), type (Pharmacy, Hospital, Clinic, Laboratory, Distributor, Retail shop, Other), address (pre-filled
with the area caption, editable), an optional note. The rep's current GPS fix is attached; without one the form
says a position is needed. Nothing about the visit changes; the suggestion is separate.

Platform admin, Directory → new tab **Suggestions** (pending first): company, rep, when, name, type, address, note,
and listings already within 200 m (to catch duplicates). Actions: **Add to directory** (opens the existing
business form pre-filled with name, type, address and position; saving creates the listing and marks the suggestion
accepted with the new listing's id) or **Reject** (optional reason). The admin sets verification in the form as
usual; only verified listings are suggested to reps.

## Data and security

All new database objects are drafts in `docs/architecture/pending-migrations/`, applied only with the owner's
approval. One migration: `carehub_20261027_directory_field_link.sql`.

- `field_customer_key(directory_business_id, facility_name, facility_lat, facility_lng)`: IMMUTABLE SQL, the one
  definition of the key above (used by both readers, so the list and the history cannot disagree).
- `field_customers(p_business_id, p_staff_id default null, p_limit default 500, p_quiet_days default null)`: **SECURITY INVOKER**.
  `p_quiet_days` ("not visited in") is applied before the limit, so a team with more than 500 customers still
  sees every quiet one (final review). It also returns `source`, the facility source of the newest visit, so
  "Log a visit here" keeps a value the live `facility_source` check accepts. It reads
  `field_activities` and `orders` under the caller's own row level security, so a rep sees only customers from
  visits they may read and a manager sees the team's. `p_staff_id` narrows to one rep's visits (My customers).
  Returns no directory columns beyond the name stored on the visit.
- `field_customer_visits(p_business_id, p_key, p_limit default 100)`: SECURITY INVOKER, the visits for one key with
  the orders raised from them.
- `directory_suggestions` table: who suggested (company, staff id, name, email: forced by a BEFORE INSERT trigger
  from the caller, never trusted from the client), the suggestion, position, status
  `pending | accepted | rejected`, review fields, created_at.
  - INSERT: a signed-in member of the company, for that company; status forced to pending; review fields forced
    empty; at most 20 suggestions per company per 24 hours.
  - SELECT: a platform admin; the person who made it; the company's field managers (`caller_sees_all_activity`).
  - UPDATE: platform admin only, and only the review fields and status (pending → accepted | rejected).
  - DELETE: nobody signed in.
  - No grants to anon.

Security implications: nothing widens access to the directory. The two readers can only return what the caller
can already read. The suggestion table holds a business's name, address and position as typed by a rep, plus the
rep's name and email (needed for review and status); it is readable only as above. The daily cap limits abuse; the
admin review is the real gate. No contact details of the suggested business are collected (the admin finds them).

## Non-goals

Maps; export of the customer list; notifications on a decision (the rep sees the status in My customers); editing
or withdrawing a suggestion; merging a facility customer into a directory listing after the fact; customer records
of their own (a customer is derived from visits, not stored).

## Anti-goals (a failure even if it works)

- A company can read directory listings it has not visited, or any listing's contact details.
- A rep sees a colleague's customers or visits they could not see before.
- "Log a visit here" records a visit, or a verified location match, without a fresh GPS fix judged as usual.
- The list and the history disagree about which visits belong to a customer.

## Calls made while checking this design (author's)

- A customer's name, address and territory come from its **most recent** visit (a listing renamed later shows the
  newer name once visited again). The rep filter keeps customers that rep visited at least once.
- Two visits to the same facility name whose positions fall either side of a ~100 m grid line become two customers.
  Accepted: rare, visible, and the alternative (fuzzy matching) makes the list and history disagree.
- The list shows the 500 most recently visited customers and says so when there are more.
- The suggestion's "type" is a hint for the admin; the directory's own category is chosen in the business form. The
  form opens with name, address and position filled and the type and note in the description.
- Accepting is two writes (create the listing, then mark the suggestion). If the second fails the admin sees the
  error and a "Mark as added" retry; the listing is not created twice.

## Builder notes

- Live Field Activity rep page: `LiveActivity.jsx` (1733 lines) holds the tabs (`feedScope.scopeTabs`). Render My
  customers as its own component; do not grow the file more than the wiring needs.
- The log form target: `VisitTarget.jsx` (facility object `{ name, address, category, lat, lng, source }`;
  directory `{ id, name }`); `openLogger()` resets the target, so a pre-chosen target is applied after it.
- Orders prefill: `Orders.jsx` reads `location.state.fromVisit`; add a sibling `fromCustomer` without a link, and
  clear it the same way (window.history.replaceState, never a navigation: App remounts on navigation).
- Field team pages: `lib/permissions.js` MODULES/NAV_ORDER, `BusinessDashboard.jsx` routes, Field team today in
  `dashboard-home/FieldTeamToday.jsx` (summary in `fieldTeamToday.js`).
- Admin directory: `modules/business-directory/BusinessDirectory.jsx` (`TABS`, `platformMode`), `BusinessForm`.
- PGlite tests for the migration (`scripts/db-tests/`), copying the live policies on `field_activities`, `orders`.
- Every screen: loading, error, empty (saying how customers appear: by choosing a place when logging a visit),
  responsive, accessible.
