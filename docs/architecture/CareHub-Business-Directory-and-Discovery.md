# CareHub Business Directory and Discovery

> **STATUS, 2026-10-19: RETIRED DESIGN. Do not implement or apply anything described in the directory, import, merge and discovery sections of this document.** They describe a second, CareHub-hosted directory that duplicates the one already live in CareFind (`directory_businesses` and friends, commits `c651fed` and `4331e88`). The migrations are in `docs/architecture/retired-migrations/` with the reason for each. What remains valid from this work: check-ins and location history (`CareHub-Location-and-Privacy.md`), the activity-access hardening, the realtime fixes, and the ideas being ported onto the live directory (Excel import, reviewed merge). The live directory's ownership model is the existing one: rows with `business_id` NULL are the platform-wide directory curated by a platform admin; rows with a `business_id` belong to that company and are managed through `can_manage_directory()`.


Status: Phases 1-4 written. **Nothing here is applied to any database.** The migrations were exercised on PGlite (real Postgres compiled to WebAssembly) by `scripts/db-tests/directory.pglite.mjs`: 63 checks pass (apply, re-apply, grants, RLS, triggers, constraints, RPCs, radius maths). That harness uses stand-ins for Supabase's `auth` schema and the tenant tables, so it is **not** a substitute for a run against a Supabase branch. Baseline and findings: `CareHub-Enterprise-Implementation-Baseline.md`.

## Ownership boundary

`is_directory_admin()` is the single decision point for who administers the shared directory. Today it is `auth.uid() IS NOT NULL AND is_platform_admin()`. When the CareFind-vs-CareHub ownership decision is made, only that function body changes; no table, policy or client code changes. Ordinary company owners and managers are not directory admins. No email address is hardcoded.

**Default until decided: the existing platform admin.** Open product-owner decision: which administration owns it.

## Data model (migration `carehub_20261120_business_directory.sql`)

| Table | Purpose |
|---|---|
| `directory_categories` | One table, `parent_id` NULL = category, set = subcategory (one level, trigger-enforced). Seeded with the 18 healthcare categories; admin-editable. |
| `directory_businesses` | The records. Normalised name and phone are trigger-computed. Coordinates are a both-or-neither pair with range checks. `claimed_business_id` optionally links a prospect to a registered tenant; the directory row is never the tenant row. |
| `directory_business_private` | Contact person and notes. Admin-only, so company users reading the directory never see them. |
| `directory_audit` | Append-only history written by triggers. No client write policy exists. |

It does not duplicate `businesses`, `facilities_cache` or `rep_added_facilities`. Those stay as the tenant table and the per-company field-report caches. Discovery (Phase 4) will read `businesses` as a separate, labelled "registered on CareHub" source.

## Permissions

- Read: any signed-in user, **active rows only** (admins also see inactive). Email and phone are therefore visible to every signed-in company user by design (they are what prospecting needs); contact person is not.
- Create, update, categories, private data, audit read: directory admin only (RLS).
- Delete: no policy, so records are deactivated, never removed.
- `anon`: no access.

## Verification

Explicit column `verification_status` in `unverified | pending | verified | rejected`. A BEFORE trigger forces new rows to `unverified` and reverts any direct change to the verification columns. The only way to change them is `directory_set_verification(id, status, note)`, which requires `is_directory_admin()`, stamps `verified_by` and `verified_at` from `auth.uid()` and `now()`, and writes an audit row. A CHECK forbids `verified` without an actor and timestamp. Imports, phone numbers and Google listings never set it.

## Client layer

- `modules/directory/directoryRecord.js`: pure validation and normalisation, reusing `normalizeName` / `normalizePhone` from `lib/facilityDiscovery.js` (the SQL normalisers mirror them).
- `modules/directory/repositories/index.js`: injected-transport repository. Server-side filtering with a clamped limit (max 100), LIKE wildcards escaped, unknown verification filters dropped, no delete method, verification only via RPC. Authorisation is by RLS, not by this layer.

## Import (Phase 2)

CSV and Excel (`.xlsx`). Both produce the same table and row numbers and feed the same planner, duplicate review and runner. The CSV parser handles quotes, CRLF, BOM and embedded newlines. **Excel** is read by `read-excel-file` (MIT, maintained; chosen over `xlsx`, whose npm release is unmaintained with known prototype-pollution and ReDoS CVEs, and over `exceljs`, which is 22 MB and Node-oriented) with `fflate` for a pre-parse size check. The reader is loaded on demand only when an `.xlsx` is chosen. Rules: first non-empty sheet is used (the screen names it and says other sheets are ignored); every cell becomes text (a phone stored as a number loses its leading 0 in Excel, which the phone normaliser tolerates); the legacy `.xls` and password-protected workbooks are refused with instructions; file size is capped at 2 MB, and an archive whose *declared* uncompressed size exceeds 60 MB or that has more than 200 entries is refused before anything is inflated. "Row N" in an error is the original row in the spreadsheet or file, even when blank rows were skipped. The file fingerprint is taken over the file bytes, so re-importing the same workbook is recognised. Each row is validated, then classified `new | possible_duplicate | confirmed_duplicate | invalid | needs_review` against existing candidates and earlier rows in the file (normalised name, phone, address, coordinates, token-overlap name similarity). Default decisions import only `new` rows; everything else needs an explicit choice. Decisions are import, skip, keep existing, or merge (below). The downloadable template is a CSV (Excel opens it). Execution is batched (50), per-row failures are tracked, a failed batch is retried row by row, and a re-run of the same file reports rows as already imported (source_ref = file fingerprint + row, unique index). Existing-record fuzzy matching only sees rows sharing a name or phone key or in a city named in the file.

### Merging an imported row into an existing business

Merge is available only for a row that matches an **existing directory record** (not for in-file duplicates), is never a default, and runs only after the administrator reviews it field by field.

- **Review.** "Merge into existing..." opens a table of each field: existing value, imported value, action. A blank existing value defaults to *Fill the blank* (ticked). A different existing value defaults to *kept*; replacing it needs an explicit tick. If several records matched, the reviewer picks the target. Confirming the review only records the choice; nothing runs until the import is started, and the button says exactly how many rows will be imported and merged.
- **What a merge can touch.** Category, subcategory, business type, address, city, state, LGA, coordinates (always as a pair), phone, email, website, description. **Never** the name, verification status, who verified and when, data source or source reference, the active flag, or ids. A merge cannot turn an imported record into a verified one or rename a trusted one; use the normal edit for those.
- **Verified records are locked.** Blanks on a verified record can be filled, but its existing values cannot be replaced by a merge (the review hides the option, and the database refuses it independently).
- **Authorised and enforced in the database.** `directory_merge_import_row(id, source_ref, changes)` requires `is_directory_admin()`, accepts only the whitelisted fields, rejects unknown fields, empty or blank values and unknown modes, refuses a deactivated target, and applies everything in one UPDATE: if any value fails a table constraint (bad email, out-of-range coordinate) the whole call fails and nothing is applied. It returns exactly what was applied and what was skipped and why (`same`, `existing_value_kept`, `verified_record`), and the import summary lists those.
- **Retry-safe.** Each (record, import row reference) merges once, recorded in `directory_import_merges` (admin-readable, no direct writes). Re-running the same file reports the merge as already applied and does not change anything, so it cannot undo a later manual edit. The same record can still be merged from a different import row.
- **Auditable.** One audit row per applied merge, action `merge`, note `merge from import <reference>`, with the full before and after of the record. The import history records how many rows were merged.
- **Not covered.** There is no "undo merge" button (the audit row holds the previous values for a manual edit), merging more than one imported row into the same record in one run is allowed but each is reviewed separately, and merges across two existing directory records (de-duplicating the directory itself) are not implemented.

## Business Discovery (Phases 3-4)

Surface: the `discovery` module (Facility Discovery) now opens on a **Business directory** tab; the previous multi-source map search is unchanged as **Live search (maps)**. The directory tab is a separate, server-paginated path because the legacy engine merges and paginates in the browser and labels GPS proximity as "verified".

- `directory_search` RPC (`carehub_20261122_directory_search.sql`): SECURITY INVOKER, read-only, authenticated only. Filters (name, category, subcategory, state, LGA, city, free-text place, verification, source), radius via bounding box then haversine (no PostGIS), sorts (name, distance, verified first, recent), limit capped at 100, radius 100 m to 100 km. Distance is **straight-line** and labelled so.
- Natural language: rule-based (`searchQuery.js`), no AI dependency. It only interprets; the filters are shown and editable. Ambiguous input (for example Surulere exists in two states) is flagged, never guessed. A place it cannot match to a state or LGA is searched as text and is **not geocoded**, so a radius does not apply to it.
- Location: `locationCapture.js`, one-shot, only on a button press, never continuous. Denied, unavailable, timeout, unsupported and invalid positions are reported honestly; low accuracy is flagged. Manual location: coordinates, the centre of a chosen state (labelled approximate, opt-in), or a map click.
- Google Maps: `googleMapsLoader.js` reads `VITE_GOOGLE_MAPS_BROWSER_KEY` (a public, referrer-restricted browser key; never a server key). With no key the map is replaced by a message and the list keeps working. **Not verified against a live key.** Directions and "view on map" use `google.com/maps` URLs that need no key and are hidden for rows without valid coordinates. No Geocoding/Places web service is called, and no external result is stored or labelled as verified.
- List and map selection: the parent owns `selectedId`; a marker click selects and scrolls to the row, a row click highlights and pans to the marker.
- Export: CSV of the same filters, paged, capped at 1,000 rows (the UI says when truncated), formula-injection safe, no contact person or notes, shown only to roles with `canExportReports`.
- Read-only: the screen's repository surface is `listCategories` and `discover`. Search, select, directions and export never create an activity, visit, attendance or notification.

### Environment

| Variable | Where | Purpose |
|---|---|---|
| `VITE_GOOGLE_MAPS_BROWSER_KEY` | carehub build env | Maps JavaScript API, browser key restricted by HTTP referrer and by API |

## Company, representative and field-activity integration (Phases 5-8)

**Reused, not rebuilt.** Company membership is the existing model: the business owner (login email = `businesses.email`) and `staff` rows (`business_id`, `email`, `status`, `role`). Territories and `rep_territories` are unchanged. A person can belong to several businesses (membership is looked up per business), and nothing assumes one global company per user. No parallel user system was added.

**Check-ins** (`carehub_20261123_staff_checkins.sql`): see `CareHub-Location-and-Privacy.md`. Explicit, append-only, written only through `record_checkin()` which checks the caller's own membership; read by managers only through `manager_checkin_overview()`, which logs each access.

**Field activity link** (`carehub_20261124_field_activity_directory_link.sql`): optional `directory_business_id` on a report. The logger shows "Possible nearby business (optional)" from the directory within 300 m of the position already captured for the report; nothing is pre-selected; the rep presses Select; the fields are sent only then; the database refuses an unconfirmed link and copies the business name itself. A report without a link is unchanged. Search, viewing and GPS proximity never write anything.

**Field activity access** (`carehub_20261125_field_activity_access.sql`) and **staff privilege guard** (`carehub_20261126_staff_privilege_guard.sql`) are behaviour changes for findings S3-S5 and S8. See their headers; both need a product decision and a check of the live policies before applying.

**Paging**: the feed fetches 100 activities, with an on-request "Load older activity" button (keyset on `created_at`; viewers, reactions and comments are fetched only for each new page).

**Realtime**: the socket carries the user's JWT and the LIVE badge needs a confirmed subscription. If the channel drops it shows NOT LIVE and reconnects with exponential backoff (2 s doubling to 30 s); when it comes back the feed refetches once, because rows that arrived while it was down are not replayed (this reload also drops any older pages the person had loaded). Reactions and comments update live too: a change refetches just those two lists for the newest 100 activities, debounced. All of that is tested with a mocked client. It needs the tables in the `supabase_realtime` publication, which nothing in this repository sets up (`carehub_20261127_realtime_activity_tables.sql` adds them idempotently). **Delivery to a second signed-in session has not been tested on Supabase.**

### Administrative ownership

| Concern | Where it is decided | Default today |
|---|---|---|
| Who administers the shared directory | `is_directory_admin()` (one function) | `is_platform_admin()` |
| Who sees the Directory console tab | platform permission `Directory` | UI only |
| What a company can do to the directory | read active rows, search, export (if `canExportReports`), link a business to its own report | nothing else |
| Company-specific notes/prospects | not built; would be a separate company-scoped table, never columns on the global record | n/a |

**Decision for the product owner: CareFind administration or CareHub administration owns the directory.** Switching is a change to the body of `is_directory_admin()` (for example reading a `directory_admins` table or a claim), with no table, policy or client change. No email address is hardcoded anywhere. The `Directory` platform permission hides the console but is not the security boundary.

### Migration order (all prepared, none applied)

| # | File | Kind |
|---|---|---|
| 1 | `carehub_20261119_discover_facilities_cursor_lockdown` | security fix (S1, S2) |
| 2 | `carehub_20261120_business_directory` | new tables |
| 3 | `carehub_20261121_directory_imports` | new table |
| 4 | `carehub_20261122_directory_search` | new function |
| 5 | `carehub_20261123_staff_checkins` | new tables and functions |
| 6 | `carehub_20261124_field_activity_directory_link` | additive columns |
| 7 | `carehub_20261125_field_activity_access` | **behaviour change** (S3-S5) |
| 8 | `carehub_20261126_staff_privilege_guard` | **behaviour change** (S8) |
| 9 | `carehub_20261127_realtime_activity_tables` | additive publication change; check `pg_publication_tables` first |
| 10 | `carehub_20261128_directory_import_merge` | new table and function; replaces the directory audit trigger function (adds optional action/note) |

1-6, 9 and 10 are additive or strictly tightening a function and are independent of the two behaviour changes. 7 and 8 should be reviewed against the live policies first.

## Not yet built

Retention/purge for check-ins, undo for a merge, de-duplicating two existing directory records, company-specific prospect notes, an admin editor for category names, and any run against a real Supabase branch.

## Apply and rollback

Not applied. Before applying: run the migrations on an isolated Supabase branch (the PGlite run does not cover PostgREST, Realtime or the live schema), and confirm the live `is_platform_admin()` and `current_business_ids()` match the definitions in `sql/phase2_rls_pilot.sql`, which the harness uses. Order: `20261119` (legacy RPC lockdown), `20261120`, `20261121`, `20261122`. Rollback is in each migration header.
