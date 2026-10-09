# Business Directory, Business Discovery & Field Work — Business Domain

Enterprise (manufacturer/importer, wholesale) feature. Three layers, deliberately separate:

| Layer | Module | Answers | Creates field activity? |
|---|---|---|---|
| Business Directory | `modules/business-directory` (`/dashboard/directory`) | "Which businesses do we know about?" — the data layer | No |
| Business Discovery | `modules/business-discovery` (`/dashboard/discovery`) | "Find businesses near here / of this kind" — search only | **Never** |
| Live Field Activity | `modules/live-activity` (`/dashboard/activity`) | "Where did the rep work and what happened?" — the official report | Yes, on submit |

`modules/field-work/FieldWorkSwitch` presents LIVE FIELD REPORT and BUSINESS DISCOVERY side by side on both pages.

## Non-negotiable separation
Discovery imports no field-activity, notification, attendance or visit function; a test asserts a search issues only reads, and a real-browser run confirmed zero write requests. Live Field Report only *suggests* nearby directory businesses (`NearbyBusinessPicker`): nothing is pre-selected, wording is "Possible nearby business / Detected nearby / Location captured / Selected business", and `directory_business_id` is written only when the rep explicitly picks one and submits. GPS proximity is never treated as proof of a visit.

## Data model (`sql/20261010_business_directory.sql` — NOT YET APPLIED)
Tables are `directory_*` because `businesses` is the CareHub tenant/login table. Spec tables map: `businesses`→`directory_businesses`; locations/contacts/verification are 1:1 column groups on it; sources = `data_source` + `import_batch_id`; plus `directory_categories`, `directory_subcategories`, `directory_import_batches`, `directory_import_errors`, `directory_reports`, `directory_duplicate_dismissals`. `field_activities` gains nullable `directory_business_id` + `directory_business_name` (snapshot; link nulls out if the directory row is deleted).

Tenancy: every row has `business_id`; read = `current_business_ids()`; write = `can_manage_directory()` (Owner/platform admin, or an active staff member whose custom role has `canManageDirectory`). Built-in categories have `business_id NULL` (read-only to tenants). Triggers enforce same-tenant category/subcategory/territory, immutable `business_id`, server-owned `verified_at/by`. Requires the C21 helper `is_staff_owner_level`.

Verified on a scratch Postgres 16 with a Supabase-like stub: re-runnable; 50 behavioural checks (cross-tenant read/write/move, unprivileged edits, forged verification, forged activity links, anon, platform admin) all pass; radius search uses `idx_dirbiz_geo`, admin list `idx_dirbiz_recent` at 50k rows.

## Services (`business-directory/services`, all pure and unit-tested)
`normalize` (names, phones, addresses, websites), `similarity`, `deduplication` (blocking index; New / Possible / Confirmed; Keep existing / Import new / Merge / Skip; directory-wide duplicate scan), `importService` (template, CSV/XLSX parse, validation, analysis in slices with progress, chunked commit, stop-and-report on failure — re-running the same file is safe), `queryParser` (rule-based NL → category/quantity/radius/place; no third party sees GPS or search text), `geocoding` (Nominatim, ≤1 req/s, cached, **no built-in coordinates**), `location`, `distance` (haversine + bounding box), `search` (BusinessSearch + BusinessMatcher), `exportService` (CSV/Excel/JSON/PDF-via-print, formula-injection neutralised).

## Decisions worth knowing
- Excel uses lazy-loaded `exceljs`, not SheetJS `xlsx@0.18.5` (known prototype-pollution/ReDoS advisories on npm). Limits: 15 MB, 20,000 rows per file.
- Radius search = lat/lng rectangle in SQL + exact haversine in the browser. Adequate to ~100k rows per tenant; move to PostGIS/`earthdistance` beyond that.
- "Open/closed now" filter is not offered: `opening_hours` is free text and not reliable. Add structured hours first.
- PDF export uses the browser print dialog, like the project's other print templates.
- Map: Leaflet + OpenStreetMap tiles, lazy-loaded, behind an error boundary so the list survives a map failure.
- No external-API connector yet; `data_source = 'external'` and `source_detail` are reserved for it. Demo rows use `data_source = 'demo'` and show "DEMO DATA". Nothing is seeded.

## Permissions
Modules `discovery` (Owner, Manager, default staff) and `directory` (Owner; custom roles). Flag `canManageDirectory` (Owner true; grantable per custom role in Staff → Roles).

## Test plan
`npm test` (carehub): 130 new tests — normalisation, dedup (incl. 3,000×3,000 timing), import end-to-end, XLSX round-trip, NL examples from the spec, repository tenancy and PostgREST-injection guard, search/sort, geocoding, export, discovery/picker/switch components. Manual after applying the migration: import a real 1,000-row file; verify a rep without the flag cannot write; log a field report with and without a confirmed business; confirm managers see "Business: …" in feed/table.

## Phase 4 (designed for, not built)
`territory_id`, `state`, `lga` on directory rows and `field_activities.directory_business_id` give the join for: businesses per territory, coverage = directory businesses with ≥1 linked activity in a window, "not visited recently" = directory businesses with none, segmentation by category, rep assignment via `rep_territories`. Needs a manager dashboard and (at scale) a SQL view/RPC for the aggregation.
