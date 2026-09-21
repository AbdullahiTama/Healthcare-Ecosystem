---
title: 'CareFind Hub Business Directory - Phase 1: Foundation'
type: 'feature'
created: '2026-09-21'
status: 'done'
baseline_commit: '6fb896cb7f1727cd5b379357fd328f5aab791340'
review_loop_iteration: 0
context:
  - docs/PROJECT_OVERVIEW.md
  - planning/roadmap.md
  - planning/CODE_AUDIT.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CareFind Hub lacks a central Business Directory database, admin management interface, and CSV/Excel import system. The existing `business-directory` module has frontend services and components that reference tables (`business_directory`, `business_categories`, `business_subcategories`, `business_verification`, `business_import_batches`, `business_import_errors`) that do not exist in the database. No admin can currently add, edit, verify, import, or manage businesses.

**Approach:** Create the complete database schema via a Supabase SQL migration, wire the existing frontend module to real data, enhance the admin interface with full CRUD + verification + import workflow, and seed initial healthcare categories. Preserve all existing CareFind functionality.

## Boundaries & Constraints

**Always:**
- Use existing Supabase architecture (no Neon, no migration away)
- Follow existing code conventions: React 18, Vite, inline styles with theme tokens, lucide-react icons, `@care-ecosystem/design-system` components
- RLS on every new table — scoped by `is_platform_admin()` for directory management
- Every DDL must use `IF NOT EXISTS` / idempotent patterns (project lesson from CODE_AUDIT)
- SECURITY DEFINER functions must pin `set search_path = public, pg_temp`
- No native `alert()`/`confirm()`/`prompt()`
- Loading, error, and empty states on every new view

**Ask First:**
- Whether to seed demo/placeholder businesses for testing or start empty
- Whether the admin Business Directory page replaces or coexists with the existing admin `BusinessesTab`

**Never:**
- Fabricate real businesses, addresses, phone numbers, or coordinates
- Present demo records as real-world businesses (label as DEMO DATA if used)
- Introduce new UI component libraries or state management
- Bypass RLS or use service-role from the client

</frozen-after-approval>

## Code Map

- `apps/carefind/src/modules/business-directory/repositories/businessDirectoryRepository.js` — Existing repository referencing `business_directory`, `business_categories`, `business_subcategories`, `business_verification`, `business_import_batches`, `business_import_errors`. Needs tables created to function.
- `apps/carefind/src/modules/business-directory/services/importService.js` — CSV/Excel parser with XLSX, validation, dedup, geocoding. Ready to wire once DB exists.
- `apps/carefind/src/modules/business-directory/services/deduplicationService.js` — Levenshtein, Jaccard, composite scoring, batch dedup. Complete.
- `apps/carefind/src/modules/business-directory/services/locationService.js` — GPS, geocoding (Nominatim), Haversine distance. Complete.
- `apps/carefind/src/modules/business-directory/services/exportService.js` — CSV, Excel, PDF (jsPDF), JSON export. Complete.
- `apps/carefind/src/modules/business-directory/services/queryParser.js` — NL query parser for category/location/radius/quantity. Complete.
- `apps/carefind/src/modules/business-directory/hooks/index.js` — `useBusinessSearch`, `useBusiness`, `useBusinessImport`, `useBusinessExport`, `useCategories`, `useLocation` hooks. Complete.
- `apps/carefind/src/modules/business-directory/BusinessDirectoryPage.jsx` — Admin page with List/Import/Categories tabs. Uses `@care-ecosystem/design-system` components. Needs wiring to real data.
- `apps/carefind/src/modules/business-directory/BusinessListTab.jsx` — DataTable with search, filters, export, pagination. Complete.
- `apps/carefind/src/modules/business-directory/BusinessImportTab.jsx` — 5-step wizard (upload → validate → preview → import → complete). Complete.
- `apps/carefind/src/modules/business-directory/BusinessCategoriesTab.jsx` — Category management. Needs read from real DB.
- `apps/carefind/src/modules/business-directory/components/BusinessForm.jsx` — Add/edit business form. Complete.
- `apps/carefind/src/modules/business-directory/components/BusinessDetails.jsx` — Business detail view. Complete.
- `apps/carefind/src/modules/business-directory/components/BusinessCard.jsx` — Card display. Complete.
- `apps/carefind/src/modules/business-directory/components/VerificationBadge.jsx` — Status badge. Complete.
- `apps/carefind/src/modules/business-discovery/` — Separate module (Phase 2 scope). Currently references business-directory hooks.
- `apps/carefind/src/styles/theme.js` — Design tokens (gray*, teal*, radius, etc.)
- `apps/carefind/sql/` — Existing migration directory (64 loose .sql files, no formal tooling)
- `apps/carefind/src/components/ui/index.jsx` — Re-exports design system components

## Tasks & Acceptance

**Execution:**

- [ ] `apps/carefind/sql/20260921_business_directory_foundation.sql` — Create all 7 database tables with RLS, indexes, and seed categories. Tables: `business_directory` (with PostGIS `geography` column for proximity), `business_categories`, `business_subcategories`, `business_verification`, `business_import_batches`, `business_import_errors`, `business_sources`. Include `search_nearby_businesses` RPC and `get_business_stats` RPC. Seed the 28 healthcare categories from the spec.
- [ ] `apps/carefind/src/modules/business-directory/BusinessDirectoryPage.jsx` — Wire to real `useBusinessSearch` and `useCategories` hooks. Add loading/error states. Connect "Add Business" to `BusinessForm` with real `createBusiness` call. Connect edit/delete actions.
- [ ] `apps/carefind/src/modules/business-directory/BusinessListTab.jsx` — Verify DataTable renders real data. Ensure search, filter by category/status/state, pagination all work against live DB. Wire export buttons to `exportService`.
- [ ] `apps/carefind/src/modules/business-directory/BusinessImportTab.jsx` — Wire upload → parse → validate → import flow to `importService.js` and `businessDirectoryRepository.createImportBatch`/`addImportError`. Ensure 10MB limit, CSV/Excel validation, duplicate handling options (review/skip/import_new). Add progress indicator for large imports.
- [ ] `apps/carefind/src/modules/business-directory/BusinessCategoriesTab.jsx` — Wire to `getCategories`, `createCategory`, `updateCategory`, `deleteCategory` from repository. Add loading/error/empty states.
- [ ] `apps/carefind/src/modules/business-directory/components/BusinessForm.jsx` — Wire submit to `createBusiness`/`updateBusiness`. Add form validation (required: name, category). Show loading during submission.
- [ ] `apps/carefind/src/modules/business-directory/components/BusinessDetails.jsx` — Wire to `getBusinessById` with full category/subcategory/verification joins. Display all fields from spec §9. Add Call/Directions/Share actions.
- [ ] `apps/carefind/src/modules/business-directory/hooks/index.js` — Verify all hooks work with real repository calls. No changes expected unless bugs found.
- [ ] `apps/carefind/src/modules/business-directory/index.js` — Verify exports match what other modules consume.
- [ ] Run `npm test` in `apps/carefind` — all existing tests pass.
- [ ] Run `npm run build` in `apps/carefind` — clean build, no errors.

**Acceptance Criteria:**

- Given the migration is applied, when an admin opens Business Directory, then they see a list of businesses (initially empty or seeded) with search, filters, and pagination working.
- Given an admin clicks "Add Business", when they fill the form with name + category + optional fields and submit, then the business appears in the list with `verification_status: 'unverified'`.
- Given businesses exist, when an admin exports to CSV/Excel/PDF/JSON, then a file downloads with correct data.
- Given an admin uploads a CSV with 100 rows (80 valid, 10 invalid, 10 duplicates), when they complete the import wizard, then the summary shows "80 imported, 10 invalid, 10 duplicates".
- Given the import template is downloaded, when opened in Excel, then it contains all 17 column headers with an example row.
- Given a business exists, when an admin marks it as "verified", then `verification_status` updates and a `business_verification` record is created.
- Given a business exists, when an admin soft-deletes it, then `is_active` is set to `false` and it disappears from the active list.
- Given the admin navigates to Categories, when they add/edit/delete a category, then the change persists and is reflected in form dropdowns.

## Spec Change Log

<!-- Empty until first review loopback. -->

## Design Notes

The database schema uses a `geography(POINT, 4326)` column for PostGIS-powered proximity queries. The `search_nearby_businesses` RPC accepts lat/lng/radius and returns businesses ordered by distance using `ST_Distance`. This enables the Business Discovery module (Phase 2) to do efficient radius searches without loading all businesses into memory.

Category seeding uses `INSERT ... ON CONFLICT (slug) DO NOTHING` to be idempotent. The 28 categories from the spec are seeded with slugs derived from lowercased, hyphenated names.

The import system processes files in the browser (XLSX library) and batches inserts in groups of 100 to avoid Supabase request timeouts. The `business_import_batches` table tracks each import's progress, and `business_import_errors` records per-row failures for admin review.

## Verification

**Commands:**
- `cd apps/carefind && npm test` — expected: all existing tests pass (no regressions)
- `cd apps/carefind && npm run build` — expected: clean build, no errors
- SQL migration applied via Supabase SQL editor — expected: all 7 tables exist, RLS enabled, 28 categories seeded, RPCs created

**Manual checks (if no CLI):**
- Open Business Directory page → see empty state or seeded businesses
- Add a business via form → appears in list
- Import a test CSV → wizard completes with correct summary
- Export businesses → file downloads with correct format
- Verify a business → status badge updates
- Delete a business → disappears from active list
- Navigate to Categories → add/edit/delete works

## Suggested Review Order

**Database Schema (Foundation)**

- PostGIS proximity search RPC and 7-table schema with RLS
  [`20260921_business_directory_foundation.sql:1`](../../apps/carefind/sql/20260921_business_directory_foundation.sql#L1)

**RPC Response Shape Fix**

- Maps flat RPC response to nested category object for ResultsMap/ResultsList
  [`businessDiscoveryRepository.js:51`](../../apps/carefind/src/modules/business-discovery/repositories/businessDiscoveryRepository.js#L51)

**Delete Confirmation Flow**

- Replaces confirm() with state-based Modal, adds loading state
  [`BusinessCategoriesTab.jsx:37`](../../apps/carefind/src/modules/business-directory/BusinessCategoriesTab.jsx#L37)

**Code Quality Fixes**

- Removes dead branches in normalizePhoneNumber
  [`deduplicationService.js:46`](../../apps/carefind/src/modules/business-directory/services/deduplicationService.js#L46)

- Fixes duplicate keyword entry in CATEGORY_KEYWORDS
  [`queryParser.js:19`](../../apps/carefind/src/modules/business-directory/services/queryParser.js#L19)

**Test Coverage**

- Unit tests for deduplication and query parsing services
  [`deduplicationService.test.js:1`](../../apps/carefind/src/modules/business-directory/services/deduplicationService.test.js#L1)
  [`queryParser.test.js:1`](../../apps/carefind/src/modules/business-directory/services/queryParser.test.js#L1)
