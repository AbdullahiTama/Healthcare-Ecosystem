# CareHub Business Directory and Discovery

Status: Phase 1 data layer written. **Nothing here is applied to any database, and the SQL has not been run against a real Postgres.** Baseline and findings: `CareHub-Enterprise-Implementation-Baseline.md`.

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

CSV only (no spreadsheet library is installed; Excel is not supported). Parser handles quotes, CRLF, BOM and embedded newlines. Each row is validated, then classified `new | possible_duplicate | confirmed_duplicate | invalid | needs_review` against existing candidates and earlier rows in the file (normalised name, phone, address, coordinates, token-overlap name similarity). Default decisions import only `new` rows; everything else needs an explicit choice. Merge is not implemented: decisions are import, skip, keep existing. Execution is batched (50), per-row failures are tracked, a failed batch is retried row by row, and a re-run of the same file reports rows as already imported (source_ref = file fingerprint + row, unique index). Existing-record fuzzy matching only sees rows sharing a name or phone key or in a city named in the file.

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

## Not yet built

Check-ins and location history (5-6), field-activity business linking and activity RLS hardening (7). Direct-RLS tests need a Postgres instance; none was available.

## Apply and rollback

Not applied. Before applying: run the migration on an isolated Postgres/Supabase branch, and confirm `is_platform_admin()` exists with the signature this file assumes. Rollback is in the migration header.
