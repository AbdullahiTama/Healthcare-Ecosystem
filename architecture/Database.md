# Database — Care Ecosystem

**For CareHub specifically, column-level detail now lives in `architecture/Schema-Reference-CareHub.md`** (added this engagement, as part of resolving `Technical-Debt.md` H6) — this document's CareHub section below is the older, table-inventory-level summary; the new file goes table-by-table with confirmed vs. inferred columns. No equivalent exists yet for CareFind.

No schema file, migration, or ERD exists anywhere in either repository. Both `apps/carehub` and `apps/carefind` point at **the same physical Supabase/Postgres project** — this is now a confirmed fact, not an inference: `apps/carehub/src/lib/supabase.js` and `apps/carefind/carefind-main/src/lib/supabaseClient.js` contain the identical project URL (`https://szdybxmgmhndoytqanfb.supabase.co`) and the identical anon key (`sb_publishable_xEs5f4L6qSxqXikPZM06SQ_TKy4UNFz`), verified by direct read of both files. Everything below is reconstructed by reading every query string and payload shape in both apps' source, since no schema, migration, or ERD exists — treat the table/column detail as a reverse-engineered map, not an authoritative schema, even though the shared-project fact itself is now solid.

---

## 1. CareHub Tables

*(Full detail — including proven vs. inferred relationships, index recommendations, N+1 patterns, missing constraints, performance risks, and security concerns for these tables — lives in this session's Database Interaction Analysis; the table inventory is reproduced here for a single point of reference.)*

Tenancy: `businesses`. Staff: `staff`, `staff_claims`. Admin: `admin_team`. Catalog: `products`. Sales: `sales`. CRM: `clients`. Finance: `expenses`, `debts`, `purchases`. Scheduling: `appointments`. Config: `business_settings`. Notifications: `staff_notifications`. Multi-branch: `enterprise_locations`. Territories: `territories`, `rep_territories`. Messaging: `internal_messages`, `internal_message_recipients`, `internal_message_files` (+ Storage bucket `message-files`). Enterprise stock: `stock_batches`, `stock_movements`. Orders: `orders`, `order_items`, `order_watchers`, `order_files`, `order_events` (+ Storage bucket `order-files`). Field activity: `activity_fields`, `activity_default_viewers`, `field_activities`, `activity_viewers`, `activity_reactions`, `activity_comments` (+ Storage bucket `activity-voice`). Hospital pipeline: `patients`, `triage`, `consultations`, `prescriptions`, `lab_requests`, `lab_results`, `imaging_requests`, `patient_messages` — the latter four were reachable only through three duplicated shadow services in `Doctor.jsx`/`Lab.jsx`/`Imaging.jsx` when this was first written; consolidated into `lib/supabase.js` this engagement (`Technical-Debt.md` H1).

**36 CareHub tables + 3 Storage buckets.**

Proven relationship (only two in the whole app — PostgREST embedding requires a real FK): `staff_claims.staff_id → staff.id`, `rep_territories.staff_id → staff.id`. Every other relationship in CareHub is inferred from column naming, not proven.

---

## 2. CareFind Tables

Confirmed by a full grep of every `supabase.from('...')` call across `apps/carefind/carefind-main/src`:

**Shared with CareHub (same table, both apps read/write it):**
- `businesses` — CareHub's Inventory/Settings/Register write it; CareFind's `Search.jsx`/`BusinessProfile.jsx` read it (filtered by `visible_on_carefind`); CareFind's `AdminPanel.jsx` **writes** to it too (`approveClaim()` sets `visible_on_carefind = true`).
- `products` — CareHub's Inventory owns core fields (name, price, stock, category); CareFind's `Search.jsx`/`BusinessProfile.jsx` read additional columns (`whatsapp, image_url, sale_type, price_unit, min_purchase, seller_location`) that have **no confirmed write path in CareHub's own `ProductModal`** — see Shared-Services.md.
- `staff_claims` — the clearest genuine two-way workflow in the ecosystem: CareFind's `ClaimStaffPosition.jsx`/`Profile.jsx` let a CareFind end-user (their own Supabase-Auth `user_id`) claim to be a specific staff member listed in CareHub; CareHub's `Staff.jsx` approves/rejects the same rows. See Shared-Services.md.

**CareFind-only (no CareHub awareness at all):**
`reviews`, `profiles`, `search_logs`, `promotions`, `posts`, `post_comments`, `post_reactions`, `saved_posts`, `stories`, `follows`, `notifications` (CareFind's own — distinct from CareHub's `staff_notifications`), `live_sessions`, `live_shows`, `live_comments`, `live_reactions`, `live_participants`, `live_views`, `live_shares`, `live_items`, `live_messages`, `playlists`, `playlist_parts`, `news`, `news_comments`, `news_reactions`, `saved_news`, `wallets`, `transactions`, `withdrawal_requests`, `gifts`, `tasks`, `task_submissions`, `subscriptions`, `user_subscriptions`, `creator_subscriptions`, `product_subscriptions`, `product_reviews`, `user_reviews`, `verification_requests`, `unclaimed_entities`, `admin_teams` (CareFind's own — distinct from CareHub's `admin_team`), `admin_users`, `credentials`, `avatars`, `covers`, `reports`, `staff_directory`, `business_claims`.

**⚠️ Name-collision risk requiring live-schema verification: `consultations`.** CareHub's `consultations` table (written by `Doctor.jsx`) is a clinical record — `patient_id, hpi, examination, primary_diagnosis, ...`. CareFind's `consultations` table (written by `ProfessionalMonetization.jsx`) is a **paid-consultation-booking record** — `professional_id, patient_id, type, fee, notes, status: 'setup'/'paid'` — for CareFind's creator-monetization feature, unrelated to any clinical workflow. Both use the identical table name. **Now that the shared-project fact above is confirmed rather than inferred, "two logically separate tables that happen to share a name in two otherwise-disconnected schemas" is no longer a plausible resolution** — there is one Postgres database, one `public` schema (the Supabase default), and Postgres does not allow two tables with the same name in the same schema. The only remaining possibilities are: (a) it genuinely is one physical table serving two irreconcilable purposes, which is the finding as originally stated, just now with the "maybe they're separate" escape hatch closed; or (b) one of the two products' queries targets a different, non-default schema not visible in either codebase (possible but not evidenced by anything read so far — connection strings and schema selection weren't found hardcoded anywhere). This should still be the first thing verified directly against the live Supabase project before any further ecosystem-level work — see `Security-Risks.md` — but the verification is now to confirm option (a), not to determine which of two options is true.

**~40 CareFind-side tables** (excluding the 3 shared with CareHub) + at least one Storage-adjacent concept (`avatars`, `covers` tables suggest either Storage buckets or URL-reference tables, not confirmed which).

---

## 3. Notable CareFind Query Patterns

Unlike CareHub's hand-built `fetch()` + string-concatenated PostgREST URLs, CareFind uses the proper `supabase-js` query builder throughout (`supabase.from('table').select(...).eq(...)`), which is a materially safer and more maintainable pattern. Two things worth flagging:

- **`AdminPanel.jsx`'s `loadAll()`** fires up to 12 queries in a single `Promise.all` (`profiles` count, `verification_requests`, `business_claims`, `reports`, `transactions`, `tasks`, `admin_teams`, `businesses`, `admin_users`, `withdrawal_requests`, `task_submissions`, `consultations`) — well-parallelized, but several of these (`reports`, `transactions`, `verification_requests`, `businesses` capped at `limit(100)`) have no pagination beyond a single page of results, the same unbounded-growth pattern flagged for CareHub in Performance-Risks.md.
- **Embedded-resource queries are used extensively and correctly** in CareFind (`profiles(full_name, display_name)`, `tasks(title, compensation)`, `businesses(name)`, `staff:staff_id(...)`) — far more than CareHub's two total instances — implying CareFind's schema has considerably more enforced foreign keys than CareHub's, at least among the tables these embeds touch.

---

## 4. Ecosystem-Wide Findings

1. **No migration, schema file, or ERD exists for either product**, despite them apparently sharing one physical database. Neither team has a single source of truth for a schema both depend on — see Missing-Documentation.md.
2. **~76 tables across both products, only 3 confirmed shared**, and even those 3 show signs of incomplete coordination (the `products` marketplace-column write-path gap; the `consultations` naming collision).
3. **Two independently-named "admin" table pairs** (`admin_team` in CareHub vs. `admin_teams`/`admin_users` in CareFind) suggest the two products' admin systems were built without reference to each other, despite the "one ecosystem" framing.
4. **The one clean, well-designed piece of cross-product data flow** (`staff_claims`) proves the two teams *can* coordinate through the shared database when they choose to — it's the model the `products`/`consultations` gaps above should be brought up to, not an exception to explain away.

Full detail on indexes (unauditable — no schema access), N+1 patterns, missing constraints, and security posture for CareHub's tables specifically is in this session's Database Interaction Analysis (superseded/absorbed into this document's CareHub section above plus Security-Risks.md and Performance-Risks.md, which now cover both products).
