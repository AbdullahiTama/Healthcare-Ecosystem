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

## Not yet built

Admin UI, import (Phase 2), duplicate review UI, maps and discovery (Phases 3-4), check-ins (5-6), field-activity business linking (7). Direct-RLS tests need a Postgres instance; none was available.

## Apply and rollback

Not applied. Before applying: run the migration on an isolated Postgres/Supabase branch, and confirm `is_platform_admin()` exists with the signature this file assumes. Rollback is in the migration header.
