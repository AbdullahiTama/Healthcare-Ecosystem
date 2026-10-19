# CareHub Enterprise Business Directory and Live Field Operations: Implementation Baseline

> **CORRECTION, 2026-10-19: parts of this baseline are wrong.** It was written from CareHub-only searches and concluded that no business directory exists. **One does, and it is live**: the CareFind Business Directory and Business Discovery (commits `c651fed`, `4331e88`, spec 0001), with `directory_businesses`, `directory_categories`, `directory_subcategories`, `directory_import_batches`, `directory_import_errors`, `directory_duplicate_dismissals`, `directory_reports`, the rep-activity functions (`directory_unvisited`, `directory_coverage_summary`, `directory_rep_activity`, `directory_visit_totals`), and `field_activities.directory_business_id` with its link guard. Sections 2, 7 and 12 below (what exists, what is missing, and the recommendation to build new `directory_*` tables) are therefore **superseded**; the duplicate design built from them was retired (`docs/architecture/retired-migrations/`). Finding S8 (staff self-promotion) is also **not true in production**: the live `guard_staff_writes` trigger already prevents it; it was true only of the repo's older pilot policy. S1, S3, S4, S5 and B1/B2 were real; their status is in `CareHub-Enterprise-Test-Report.md` section 9.


Phase 0 audit. Branch `main` at `fa2d735`. Written 2026-10-19.
Method: static reading of the checked-out repository. **No live database, Supabase dashboard or Google Cloud access was used**, so every database statement below is derived from migration files in `supabase/migrations/` and may differ from production (see `reference_supabase_carehub_gotchas`: files that were never applied exist in this repo).

## 0. Process notes

- `CLAUDE.md` requires reading `docs/PROJECT_OVERVIEW.md`, `planning/ROADMAP.md`, `planning/CODE_AUDIT.md`. **None of the three exists in the repository** (`planning/` holds only `financial-system/`). `README.md` references `planning/CODE_AUDIT.md`, so that reference is dangling. This baseline substitutes `README.md`, `docs/architecture/*` and the code itself.
- Working tree at start: uncommitted user changes to `apps/carehub/src/modules/wallet/Wallet.jsx`, `Wallet.test.jsx`, `apps/carefind/src/test/payments/businessWalletReconciliation.db.test.js`, and two untracked `*20261116_business_wallet_reconciliation_wiring.sql` files. These are unrelated to this feature and must not be touched or swept into this feature's commits.
- `main` is the production deployment point. Feature work must go on a branch and PR; nothing here has been pushed or deployed.

## 1. Existing modules (CareHub, `apps/carehub/src/modules`)

| Module | Files | Role in this feature |
|---|---|---|
| `live-activity` | `LiveActivity.jsx` (1523 lines), `FacilityPicker.jsx`, `repositories/index.js` | The existing Live Field Activity. Must be preserved. |
| `facility-discovery` | `FacilityDiscovery.jsx`, `export.js` | Existing "Smart Facility Discovery" tab. This is the nearest thing to Business Discovery. |
| `territories` | `Territories.jsx`, `territoryImport.js`, `repositories/` | Territories and `rep_territories` assignment, with CSV import. |
| `staff` | `Staff.jsx`, `repositories/` | Staff, roles, invitations. |
| `locations` | `Locations.jsx` | Branch/enterprise locations. Not a business directory. |
| `adr`, `trust`, `ops`, `growth` ... | n/a | Out of scope. |

Shared libraries (`apps/carehub/src/lib`): `facilityDiscovery.js` (458 lines, the discovery engine), `places.js` (Overpass, CareFind RPC, cache, rep-added places), `geo.js` (haversine, categories, facility verification), `nigeriaGeo.js` (37 states, 774 LGAs, boundary resolution), `permissions.js` (role templates, `isManagerRole`), `realtime.js` (`watchTable`).

## 2. Existing database objects (from migrations, unverified against live)

- `businesses`: **doubles as the tenant table and the discovery source.** Columns used by discovery: `name, business_type, category, state, city, lga, area, address, phone, latitude, longitude, lat, lng, website, created_at`, plus `is_platform_admin`. Two coordinate column pairs (`latitude/longitude` and `lat/lng`) are both read; which is authoritative is not documented.
- `field_activities` (+ `place_of_visit, place_coords, place_verified, facility_name/address/category/lat/lng/distance_m/source/verified, facility_pending_review, territory_id`), `activity_fields`, `activity_default_viewers`, `activity_viewers`, `activity_reactions`, `activity_comments`.
- `facilities_cache`, `rep_added_facilities` (per-business caches with a manager review workflow, migration `carehub_20260823_*`).
- `territories`, `rep_territories` (no `business_id`; tenancy derived through the parent territory).
- `staff` (role is free text; `is_business_manager()` matches `role ~* 'manager'`).
- Functions: `current_business_ids()`, `is_platform_admin()`, `is_business_manager(uuid)`, `discover_facilities_cursor(...)`.
- Storage bucket `activity-voice`.

**Not present anywhere in the repo:** a dedicated directory table, directory categories/subcategories table, verification status or verifier columns, import/import-row tables, duplicate-candidate tables, any check-in or location-history table, any audit table for directory changes.

## 3. Existing API routes (`apps/carehub/api`)

Router `api/router.js` with handlers in `api/_handlers`: auth/email, banks, KYC, payout accounts, payments, webhooks, register-business, notify-*. **There is no directory, import, geocoding, or Google Maps handler.** `api/_lib/requirePlatformAdmin.js` is the existing server-side platform-admin gate (confirmed email plus `businesses.is_platform_admin`) and is the correct reuse point for directory administration.

## 4. Existing permissions

- Client: `lib/permissions.js` role templates (`Owner`, `Manager`, ...), custom roles, `isManagerRole` (substring match).
- Server: RLS via `current_business_ids()`, `is_platform_admin()`, `is_business_manager()`.
- Platform-level role today: a single boolean `businesses.is_platform_admin`, identified through the business email. No separate directory-admin permission exists.

## 5. Existing map and location integrations

- **Overpass (OpenStreetMap)**, called directly from the browser (`places.js`).
- **Nominatim** reverse geocoding from the browser (`liveActivityRepository.reverseGeocode`).
- **Browser Geolocation** (`LiveActivity.jsx:442`), invoked from the activity logger.
- **Google Places**: `facilityDiscovery.js:290` posts to `VITE_GOOGLE_PLACES_PROXY` if set. **No such proxy exists in this repository** (there is no `supabase/functions` directory and no handler in `api/`). `.env.example` documents the variable as public. So Google integration is a stub that silently returns `[]`.
- **No interactive map component and no Google Maps JS library** is installed in `apps/carehub/package.json`. Map/list synchronisation, markers, directions, geocoding by Google: all absent.

## 6. Functionality that must be preserved

Activity logging, staff identification, timestamp, GPS capture, location labels, territory selection, custom activity fields, voice notes (`activity-voice`), default viewers, reactions, comments, filters, existing exports, `FacilityPicker`, rep-added facility review workflow, `facilities_cache`, territory CSV import, and the `FacilityDiscovery` tab and its export. All have existing tests (see section 10).

## 7. Missing functionality (against the brief)

Central directory with verification/audit; categories and subcategories; admin CRUD UI; bulk import with validation preview, history, retry safety; duplicate review UI (an in-memory `dedupeFacilities` exists but only merges transient search results, and merges on a name-and-proximity heuristic); Google Maps display, directions, geocoding; radius search on the server; natural-language search; explicit check-in / location history; manager check-in view; business-link confirmation on a field report; server-side pagination of activities; real realtime status.

## 8. Potential security problems found (to be fixed or decided in later phases)

| # | Finding | Evidence | Severity (unverified against live) |
|---|---|---|---|
| S1 | `discover_facilities_cursor` is `SECURITY DEFINER`, reads **all** `businesses` rows (tenants included, no active/listed/public flag) and returns `phone` and coordinates. The repo contains **no `REVOKE`/`GRANT`** for it, so Postgres' default `EXECUTE` to `PUBLIC` applies: anonymous callers can probably enumerate every tenant's contact details. | `carehub_20260905_facility_discovery_cursor_pagination.sql` | High if live matches the file. Needs a live `has_function_privilege('anon', ...)` check. |
| S2 | Same RPC: `p_limit` is unbounded (a caller can request the whole table), `p_cursor::integer` throws on bad input, and user input is spliced into `ILIKE '%...%'` without escaping `%` and `_`. Not SQL injection (parameters are bound) but a resource and correctness issue. | same file | Medium |
| S3 | **Activity "viewers" are not an access control.** RLS on `field_activities`, `activity_viewers`, `activity_reactions`, `activity_comments` scopes by business only. Any staff member of the company can read every rep's activity, including GPS, by querying PostgREST directly. The brief's "manager/viewer permissions" exist only in the UI and notifications. | `sql/phase2_rls_pilot.sql:520-560` | Medium: intra-tenant, not cross-tenant |
| S4 | `activity_viewers`/`reactions`/`comments` have `FOR ALL` policies, so any member of the business can insert a reaction or comment as another `staff_id`/`actor_name`, or delete another user's. | same | Medium |
| S5 | `field_activities` insert has no check that `staff_id`/`rep_name` match the caller, so one rep can log activity as another, and GPS columns are fully client-asserted. | same | Medium |
| S6 | `facilities_cache` can still be written with fabricated `source='detected'` rows by any member (acknowledged residual risk in migration `20260823_facility_review_authorization`). | that migration's header | Low-Medium |
| S7 | Overpass and Nominatim are called straight from the browser: no auth, no rate limiting, user coordinates sent to third parties; Nominatim's usage policy requires a valid identifying referer/UA and forbids heavy use. | `places.js`, `repositories/index.js:127` | Low-Medium (privacy and ToS) |
| S8 | **Staff can promote themselves.** `staff` has one `FOR ALL` business-scoped policy, so any staff member can set their own `role` to a manager role, create manager accounts, change status/email or delete colleagues. `is_business_manager()` (and everything built on it) trusts the `role` text. Demonstrated on PGlite against the pilot policy. | `sql/phase2_rls_pilot.sql:150`, `scripts/db-tests/staff.pglite.mjs` | High if live matches |

## 9. Behavioural defects against the brief

| # | Defect | Evidence |
|---|---|---|
| B1 | **The LIVE badge is shown whenever the component mounts.** `setLiveOn(true)` is called right after `watchTable()` returns, before any subscription status is known, and `subscribe()` has no status callback. | `LiveActivity.jsx:170-181`, `lib/realtime.js:33-47` |
| B2 | **Realtime probably never delivers rows.** `lib/realtime.js` creates a client with `persistSession:false` and never calls `setAuth` with the user's JWT, so the websocket connects as `anon`. Realtime `postgres_changes` is filtered by RLS for the connecting role; `field_activities` policies only admit authenticated members, so inserts are very likely not delivered. Needs verification with a live two-session test. |
| B3 | Only `INSERT` is watched. Reactions, comments, edits do not update live. No reconnect state, no error state. | `realtime.js` |
| B4 | `getFieldActivities` fetches the latest 100 rows with `select=*` and no filters or cursor; viewers, reactions and comments are then fetched for all 100 ids with `in.(...)` in the URL. `countFieldActivities` caps at 1000 by fetching ids. | `repositories/index.js:53-76` |
| B5 | `verificationStatus` (`facilityDiscovery.js:37`) returns `VERIFIED` purely because the GPS fix is within 150 m of a facility. The brief says GPS proximity is not proof, and that "verified" must come from trusted system data. The label must be renamed or decoupled (the stored `facility_verified` is documented as distance-only). The branch for OSM/Google at lines 44-49 is also dead logic (both branches return the same value). |
| B6 | Two coordinate column pairs on `businesses` (`latitude/longitude`, `lat/lng`). |
| B7 | `fetchCareFindFacilities` treats the *tenant* table as a public directory with no consent/listing flag. |

## 9a. Status after implementation (2026-10-19)

S1, S2, S3, S4, S5, S8 and B1/B2 have fixes written. **None is applied**; S3-S5 and S8 need a product decision (see the migration headers). Everything else in this baseline is unchanged. See `CareHub-Business-Directory-and-Discovery.md` for the migration order and `CareHub-Enterprise-Test-Report.md` for results.

## 10. Dependencies and external services

Supabase (Postgres, Auth, Realtime, Storage), Vercel (serverless `api/`), Paystack, Resend, Sentry, Overpass API, Nominatim, optional Google Places proxy (nonexistent), React 18, Vite 5, Vitest 2, `@tanstack/react-query`. **No Google Maps credentials are available in this repo or session**, so no live Google integration can be verified; any Google work in later phases can only be code-complete plus documented, not demonstrated.

## 11. Test and build status (baseline, before any change)

`apps/carehub`: `npx vitest run`. Result recorded below once the run finished.

Run on 2026-10-19 (929 s wall time on a loaded Windows machine):

- Test files: 130 passed, **2 failed**, 132 total.
- Tests: 1528 passed, 5 skipped, 0 failed assertions (1533 total).
- The 2 failing files are `api/__tests__/router.test.js` and `api/__tests__/routerRawBody.test.js`. Both failed with `Hook timed out in 30000ms` (a `beforeAll`/setup hook, not an assertion). They were **not** re-run in isolation, so whether this is machine load or a real regression is unconfirmed. Treat them as a pre-existing, unexplained baseline failure.

Build (`npm run build`) was not run in Phase 0; recorded in the test report.

## 12. Architectural decision required before Phase 1

The brief forbids a second directory and also forbids granting directory administration to ordinary companies. But today the only "directory" is `businesses`, the **tenant table**. Reusing it as the canonical directory conflates a SaaS customer (with login identity, wallet, billing, `is_platform_admin`) with a prospect that never signed up. Options:

1. **New `directory_businesses` (and category/audit/import) tables, owned by platform admin, with an optional `claimed_business_id` link to `businesses`.** Clean ownership boundary, no tenant data leakage, reversible. Adds tables, but they do not duplicate an existing one, because no prospect directory exists today.
2. Add directory columns to `businesses`. Rejected: leaks tenant PII to discovery, couples verification to account state, and makes company-scoped write policies unsafe.

**Recommendation: option 1.** The existing `businesses`-sourced results stay as a read-only "registered on CareHub/CareFind" source inside discovery, and are labelled as such. Ownership (CareFind vs CareHub admin) stays a policy-level decision: a single `directory_admin` permission resolved by a server-side function, defaulting to `is_platform_admin()`, so the final owner can be switched without a data migration.

This also decides S1: the legacy RPC should be restricted to `authenticated` (or replaced) in a separate behaviour-fix commit, not folded into the refactor.
