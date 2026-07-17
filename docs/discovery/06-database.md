# 06 — Database

## No Schema Exists

No migration file, schema definition, or ERD exists in either repository. Every table and column referenced in this document was reconstructed by reading query strings across both codebases — not confirmed against the live database. `docs/CARE_ECOSYSTEM_OPERATING_MANUAL/BOOK-02-SOFTWARE/05-Database-Architecture.md` is a 0-byte placeholder; it does not fill this gap.

## Physical Database

Both products point at **one shared Supabase/Postgres project — confirmed directly, not inferred**: `apps/carehub/src/lib/supabase.js` and `apps/carefind/carefind-main/src/lib/supabaseClient.js` contain the identical project URL (`szdybxmgmhndoytqanfb.supabase.co`) and the identical anon key. An earlier pass of this document stated this was inferred only from matching table names — that undersold the evidence available; it's a directly-read fact.

## CareHub Tables (~36 + 3 Storage buckets)

Tenancy: `businesses`. Staff: `staff`, `staff_claims`. Admin: `admin_team`. Catalog: `products`. Sales: `sales`. CRM: `clients`. Finance: `expenses`, `debts`, `purchases`. Scheduling: `appointments`. Config: `business_settings`. Notifications: `staff_notifications`. Multi-branch: `enterprise_locations`. Territories: `territories`, `rep_territories`. Messaging: `internal_messages` (+2 child tables) + Storage bucket `message-files`. Enterprise stock: `stock_batches`, `stock_movements`. Orders: `orders` (+4 child tables) + Storage bucket `order-files`. Field activity: 6 tables + Storage bucket `activity-voice`. Hospital pipeline: `patients`, `triage`, `consultations`, `prescriptions`, plus four tables reachable only through duplicated shadow services: `lab_requests`, `lab_results`, `imaging_requests`, `patient_messages`.

Only **two relationships in the entire CareHub codebase are proven** (via PostgREST embedded-join syntax, which requires a real foreign key to work): `staff_claims.staff_id → staff.id` and `rep_territories.staff_id → staff.id`. Every other relationship in this document is inferred from column naming, not proven.

## CareFind Tables (~40, excluding the 3 shared with CareHub)

`reviews`, `profiles`, `search_logs`, `promotions`, `posts`, `post_comments`, `post_reactions`, `saved_posts`, `stories`, `follows`, `notifications` (distinct from CareHub's `staff_notifications`), `live_sessions`, `live_shows`, `live_comments`, `live_reactions`, `live_participants`, `live_views`, `live_shares`, `live_items`, `live_messages`, `playlists`, `playlist_parts`, `news`, `news_comments`, `news_reactions`, `saved_news`, `wallets`, `transactions`, `withdrawal_requests`, `gifts`, `tasks`, `task_submissions`, `subscriptions`, `user_subscriptions`, `creator_subscriptions`, `product_subscriptions`, `product_reviews`, `user_reviews`, `verification_requests`, `unclaimed_entities`, `admin_teams` (distinct from CareHub's `admin_team`), `admin_users`, `credentials`, `avatars`, `covers`, `reports`, `staff_directory`, `business_claims`.

## Shared Tables — What's Actually Shared vs. Owned

- **`businesses`** — CareHub writes core fields; CareFind's `Search.jsx`/`BusinessProfile.jsx` read (filtered `visible_on_carefind`); CareFind's own `AdminPanel.jsx` also *writes* to it (`approveClaim()` sets `visible_on_carefind = true`).
- **`products`** — CareHub owns core fields; CareFind reads additional marketplace columns (`whatsapp`, `image_url`, `sale_type`, `price_unit`, `min_purchase`, `seller_location`) that **have no confirmed write path anywhere in CareHub's own product-editing UI**.
- **`staff_claims`** — the ecosystem's one genuinely well-designed cross-product workflow: CareFind users submit claims, CareHub's `Staff.jsx` approves/rejects them.
- **`business_claims`** — CareFind users claim a business; CareFind's own admin panel approves and writes back into CareHub's `businesses` table.

## ⚠️ The One Unresolved, High-Priority Item

**`consultations`** exists in both products' queries with completely unrelated schemas. CareHub's (written by `Doctor.jsx`) is a clinical record: `patient_id, hpi, examination, primary_diagnosis, ...`. CareFind's (written by `ProfessionalMonetization.jsx`) is a paid-consultation-booking record for creator monetization: `professional_id, patient_id, type, fee, status: 'setup'/'paid'`. **Now that the shared-project fact above is confirmed (identical URL/anon key, not inferred from table names), "two logically separate tables that happen to share a name" is no longer plausible** — Postgres cannot have two same-named tables in one schema, and no evidence of multi-schema usage exists in either codebase. This is very likely one physical table serving two irreconcilable purposes. Verify directly against the live schema before any further database work — this is the single highest-priority open question in the entire ecosystem, now narrowed from "which of two explanations is true" to "confirm the one remaining explanation."

## Query Patterns

CareHub: raw `fetch()` + hand-concatenated PostgREST strings, no `supabase-js` query builder for CRUD, most interpolation not escaped beyond a handful of `encodeURIComponent` calls. CareFind: proper `supabase-js` query builder throughout, including working embedded-resource joins (`profiles(full_name)`, `staff:staff_id(...)`) implying more enforced foreign keys exist on that side of the schema.

## Pagination

Only 3 of ~20 CareHub list queries have any `limit` (`staff_notifications` at 50, `stock_movements`/`field_activities` at 100). Every other list query fetches the entire table per tenant. CareFind's search/admin queries are capped at a single page (`limit(40)`/`limit(100)`) with no further pagination.

## Security Posture

No RLS policy can be confirmed to exist on any table in either product from source code alone. All access is scoped only by a client-supplied filter value against a publicly-embedded anon key. See `05-authentication.md` and `architecture/Security-Risks.md`.

Full detail, including index recommendations (unauditable without schema access) and confirmed N+1 patterns: `architecture/Database.md`.
