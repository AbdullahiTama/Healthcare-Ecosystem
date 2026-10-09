# Retired: CareFind-side business directory (archived 2026-10-09)

Retired by `sql/20261013_retire_carefind_directory.sql` after the directory was unified into
`directory_*` (one schema, two scopes: company-private + platform registry, see
`sql/20261012_directory_platform_scope.sql` and `knowledge/modules/business-directory.md`).

State when retired: **0 rows** in `business_directory`, `business_import_batches`, `business_import_errors`,
`business_verification`, `business_sources`; 28 categories (identical names to the built-in `directory_categories`,
carried over by name) and 21 subcategories (carried into `directory_subcategories` as built-ins). No application code,
foreign key, view or other function referenced these objects. Originally applied via Supabase MCP as
`carefind_20261001_business_directory_*` and `carefind_20261002_directory_spec_*` (never committed to this repo).

Access model it had: platform-admin-only writes (`admin_users` / `is_platform_admin()`); any signed-in user could read
`is_active AND NOT is_demo` rows; categories/subcategories publicly readable.

## Tables (columns)
- **business_directory**: id, name, normalized_name, slug (unique), category_id NOT NULL, subcategory_id, business_type, address,
  state NOT NULL, lga, city, area, latitude numeric, longitude numeric, `location` (PostGIS geography), phone, email, website,
  whatsapp, contact_person, opening_hours jsonb, description, logo_url, cover_url, verification_status, verified_at,
  verified_by uuid, data_source, import_batch_id, legacy_id, is_active, created_at, updated_at, created_by uuid, is_demo NOT NULL.
- **business_categories**: id, name (unique), slug (unique), description, icon, color, is_active, sort_order, timestamps.
- **business_subcategories**: id, category_id, name, slug (unique per category), description, is_active, sort_order, timestamps.
- **business_import_batches**: id, filename, file_url, total/successful/duplicate/invalid_records, status, error_message, imported_by uuid NOT NULL, timestamps.
- **business_import_errors**: id, batch_id, row_number, error_type, error_message, field_name, raw_data jsonb, suggested_fix.
- **business_sources**: id, name (unique), type, url, api_key_env, is_active.
- **business_verification**: id, business_id, verifier_id, status, notes, evidence_url, verified_at.

## Ideas worth keeping (not carried over)
- **PostGIS + GiST** radius search (`ST_DWithin` / `<->`) and a **pg_trgm GIN index on normalized_name** for fuzzy name search.
  The CareHub directory uses a lat/lng bounding box + haversine, which is fine to ~100k rows per company; if the
  platform registry grows well beyond that, add a `geography` column with a GiST index and a trigram index to
  `directory_businesses` rather than reviving these tables.
- `slug`, `whatsapp`, `logo_url`, `cover_url`, `area` columns: relevant only if businesses get a public CareFind profile page.
- `business_sources` (`api_key_env`): the shape of an external-data-source registry, if a connector is built.

## Functions
- `search_nearby_businesses(lat, lng, radius_m default 5000 (cap 25000), category, state, lga, verification, source, limit (cap 200), offset)` →
  rows with `distance_m`; filtered `is_active AND NOT is_demo AND location IS NOT NULL`, ordered by `location <->`.
- `find_duplicate_businesses(name, phone, lat, lng, category, threshold default 0.7)` → up to 10 rows by trigram `similarity()`,
  or same digits-only phone, or within 100 m (`ST_DWithin`). (Superseded by `services/deduplication.js`.)
- `get_business_stats()` → json of totals by verification/category/state and the last import batch.
- `generate_business_slug()` → trigger function: slugifies `name`, appends `-N` until unique.

Remaining trigger functions that served these tables' triggers (`normalize_business_name`, `update_business_location`,
`update_*_updated_at`) were left in place if present; they are harmless orphans and can be dropped separately.

## Indexes (summary)
`business_directory`: slug unique; category; state/lga; GiST(location) ×2; GIN trigram(normalized_name); btree(normalized_name);
verification; active (partial); source; import batch; legacy_id (partial); created_at desc. Others: PK + slug/name uniques + FK lookups.
