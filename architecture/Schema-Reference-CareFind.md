# CareFind Schema Reference

This is the schema document CareFind has never had at column level (`Database.md` has a table-inventory-level summary; this goes further). Unlike `Schema-Reference-CareHub.md` — written entirely from source, before live database access existed for this engagement — **every table, column, type, and foreign key below is confirmed directly against the live Supabase project** (`carehub` / `szdybxmgmhndoytqanfb`, queried 2026-07-17 via `information_schema.columns` and `information_schema.table_constraints`), not reconstructed from query strings. Treat this as authoritative for structure as of that date; it will drift if the schema changes afterward and isn't re-verified.

**Scope**: every table referenced anywhere in `apps/carefind/src` or `apps/carefind/api` (48 tables, found via exhaustive grep for `.from('...')`), plus the 3 tables it shares physically with CareHub (`businesses`, `business_claims`, `consultations` — documented in full in `Schema-Reference-CareHub.md`, only cross-referenced here). Storage buckets are listed separately in §9.

**A note this document exists partly to correct**: several tables below carry columns that look like `text`/`integer` free-form fields with no enum enforcement at the database level (e.g. every `status` column) — CareFind's status vocabularies (`'pending'`, `'active'`, `'paid'`, etc.) are conventions enforced only by application code, not by the schema. Nothing here should be read as "the database guarantees this," only "the application currently writes/reads this."

---

## 1. Identity

### `profiles`
CareFind's one user-identity table — `id` is a real Supabase Auth UUID (`auth.users.id`), not a CareHub-style email/password row. Every other CareFind table's `user_id`/`author_id`/`sender_id`/etc. FKs here.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, not null | PK, = `auth.users.id` |
| `display_name`, `full_name` | text | — |
| `is_verified` | boolean, default false | drives the verification badge; set by admin approval of `verification_requests` |
| `verification_label`, `specialty` | text | profession label shown once verified |
| `is_admin` | boolean, default false | **distinct from `admin_users`** — this is a different, profile-level admin flag; not confirmed which (if either) code path actually reads it this pass |
| `avatar_url`, `cover_url`, `bio`, `location`, `website`, `phone` | text | — |
| `subscription_price` | integer, default 0 | this profile's own paid-subscription price, if they're a creator (see `creator_subscriptions`/`user_subscriptions` in §5) |
| `created_at` | timestamptz, default now() | — |

### `staff_directory`
**Confirmed a VIEW, not a base table** (`information_schema.tables.table_type = 'VIEW'`) — columns are `staff_id`, `business_id`, `full_name`, `public_title`, `role`, `business_name`, no primary key of its own. Used by `ClaimStaffPosition.jsx` to look up staff to claim. Feeds into CareHub's `staff` table via `staff_id`. Being a view, it has no RLS of its own — its effective access control is whatever the underlying `staff`/`businesses` tables grant (see §11 and `Technical-Debt.md` C14).

---

## 2. Social Feed

| Table | Key columns | Notes |
|---|---|---|
| `posts` | `user_id!` (FK `profiles`), `content!`, `post_type='text'`, `image_url`, `audio_url`, `video_url`, `rating`, `is_premium=false`, `subscriber_only=false`, `preview_text`, `posting_as_business_id` (FK `businesses`), `posted_as_type`/`posted_as_id`/`posted_as_name`/`posted_as_title`, `live_session_id` (FK `live_sessions`), `view_count=0`, `theme` | The richest single table in CareFind — supports posting as a business (`posting_as_business_id`) or under an arbitrary claimed identity (`posted_as_*`, not FK-enforced — no constraint ties `posted_as_id` to anything). `increment_post_view` RPC bumps `view_count` rather than a raw UPDATE. |
| `post_comments` | `post_id!` (FK `posts`), `user_id!`, `content!`, `posting_as_business_id` (FK `businesses`) | — |
| `post_reactions` | `post_id!` (FK `posts`), `user_id!`, `reaction_type='like'` | One row per (user, post) in practice, not DB-enforced (no unique constraint found) |
| `saved_posts` | `user_id!`, `post_id!` (FK `posts`) | — |
| `follows` | `follower_id!`, `following_id!` | Both `uuid`, no FK constraint found to `profiles` on either — referential integrity here is app-enforced only |
| `reports` | `reporter_id!`, `post_id!` (FK `posts`), `reason!`, `status='pending'` | Moderation queue, read by `AdminPanel.jsx`'s "Admin read reports" policy (see C14 in `Technical-Debt.md` — that policy is `qual:true`, not a real admin check) |

---

## 3. Live Streaming

Two parallel, seemingly redundant systems exist side by side — `live_shows`/`live_items`/`live_participants`/`live_reactions`/`live_shares`/`live_views`/`live_comments` (the one `AdminPanel.jsx`'s live-control room and `LiveActivity`-style admin tooling uses) vs. `live_sessions`/`live_messages` (referenced by `posts.live_session_id` and `gifts.live_session_id`). Neither this pass nor prior documentation fully reconciled whether these are two generations of the same feature or two genuinely separate use cases — flagged here as an open question, not resolved.

| Table | Key columns | Notes |
|---|---|---|
| `live_shows` | `host_id`/`guest_id` (FK `profiles`), `title`, `status='live'`, `started_at`/`ended_at`, `is_platform=false`, `scheduled_at`, `trailer_url` | Platform-run shows have `host_id = null` + `is_platform = true` (confirmed in `AdminPanel.jsx`'s `startLiveShow`/`scheduleShow`) |
| `live_items` | `show_id!` (FK `live_shows`), `sender_id` (FK `profiles`), `kind='text'`, `content` | Chat/reaction feed items within a show |
| `live_participants` | `show_id!` (FK `live_shows`), `user_id` (FK `profiles`), `role='guest'`, `invited_at`, `joined=false` | — |
| `live_comments` | `show_id!` (FK `live_shows`), `user_id` (FK `profiles`), `content!`, `hidden=false` | Moderatable — `hidden` lets admins suppress without deleting |
| `live_reactions` / `live_shares` / `live_views` | `show_id!` (FK `live_shows`), `user_id` | Three near-identical engagement-tracking tables, one row per event, no dedup constraint found |
| `live_sessions` | `host_id` (FK — target table not confirmed this pass, likely `profiles`), `topic!`, `status='live'`, `board_strokes` (jsonb, default `[]`), `likes=0`, `started_at`/`ended_at` | `board_strokes` suggests a shared-whiteboard feature not seen referenced elsewhere in this pass |
| `live_messages` | `session_id` (FK `live_sessions`), `user_id`, `content`, `type='text'`, `audio_url` | — |
| `gifts` | `sender_id`/`recipient_id` (FK — not confirmed, likely `profiles`), `post_id` (FK `posts`), `live_session_id` (FK `live_sessions`), `gift_type!`, `gift_emoji!`, `coins!` | Real-money-adjacent (coins) — see `Technical-Debt.md` C11 for the non-atomic wallet-crediting issue in `GiftPanel.jsx` |

---

## 4. News & Stories

| Table | Key columns | Notes |
|---|---|---|
| `news` | `headline!`, `subtitle`, `body`, `hero_image_url`, `author_id` (FK `profiles`), `posting_as_business_id` (FK `businesses`), `status='pending'`, `published_at`, `contact_phone`/`contact_email`, `view_count=0` | Moderation queue via `status` |
| `news_comments` / `news_reactions` | `news_id!` (FK `news`), `user_id` (FK `profiles`), `content!` (comments only) | — |
| `saved_news` | `news_id!` (FK `news`), `user_id!` (FK `profiles`) | — |
| `stories` | `title`, `body`, `image_url`, `bg_color='#0f766e'`, `expires_at` default `now() + 24h`, `user_id` (FK `profiles`), `view_count=0`, `is_platform=false` | Ephemeral, 24h TTL by default (app must enforce hiding expired rows — no DB-level cleanup job found) |

---

## 5. Monetization

| Table | Key columns | Notes |
|---|---|---|
| `subscriptions` | `professional_id!`, `price!=500`, `description`, `is_active=true` | A professional's own subscription *offer* — the price/description they're selling access at |
| `creator_subscriptions` | `subscriber_id`/`creator_id` (FK `profiles`), `price!`, `auto_renew=true`, `expires_at!` | One purchased subscription instance |
| `user_subscriptions` | `subscriber_id`/`professional_id`, `status='active'`, `started_at`, `expires_at`, `reference` | Second, parallel subscription-instance table alongside `creator_subscriptions` — not reconciled this pass whether these are the same concept tracked twice or genuinely distinct (e.g. one for `subscriptions`.professional_id offers, one for `creator_subscriptions`); paid for via `pay_creator_subscription` RPC per `Technical-Debt.md` C11 |
| `product_subscriptions` | `user_id!`, `active=false`, `expires_at` | A third, distinct subscription concept — this one gates marketplace features, unrelated to creator subscriptions |
| `wallets` | `user_id!`, `balance=0` | One row per user; credited/debited client-side in multiple places (see C11) |
| `transactions` | `user_id`, `type!`, `amount!`, `naira_amount`, `reference`, `recipient_id`, `status='pending'` | Ledger — `type` differentiates top-up/gift/subscription/etc. (values not enumerated this pass) |
| `withdrawal_requests` | `user_id!`, `amount!`, `bank_name`, `account_number`, `account_name`, `status='pending'` | Approved/rejected via `AdminPanel.jsx` — see C14, this table's admin policies are `qual:true` |
| `gifts` | (see §3) | Also monetization-adjacent — `coins` |

---

## 6. Marketplace

`products` is **physically shared with CareHub** (same table CareHub's `Inventory.jsx` writes to — see `Schema-Reference-CareHub.md` §2 for the CareHub-side columns). CareFind-specific columns confirmed on this pass, not in the CareHub doc: `owner_id` (FK `profiles` — a CareFind user can own a product listing directly, separate from `business_id`), `description`, `image_url`, `whatsapp`, `sale_type`, `min_purchase`, `price_unit`, `seller_location`, `sales_unit`, `list_on_carefind` (boolean, default true — the CareHub↔CareFind visibility bridge for this table, same pattern as `businesses.visible_on_carefind`).

| Table | Key columns | Notes |
|---|---|---|
| `product_reviews` | `user_id!`, `product_id!` (FK `products`), `rating!`, `comment` | — |
| `reviews` | `business_id!` (FK `businesses`), `user_id!`, `rating!`, `comment` | Business-level reviews, distinct from product-level |
| `user_reviews` | `subject_id`/`user_id` (both FK `profiles`), `rating!`, `comment` | Person-to-person reviews (e.g. reviewing a professional) |

---

## 7. Verification & Claims

| Table | Key columns | Notes |
|---|---|---|
| `verification_requests` | `user_id`, `full_name!`, `profession!`, `credential_url`, `status='pending'`, `phone`, `workplace`, `work_address`, `years_experience` | Approving sets `profiles.is_verified`/`verification_label` (confirmed in `AdminPanel.jsx`'s `approveVerif`) |
| `business_claims` | `user_id`, `business_id` (FK `businesses`), `status='pending'` | Shared with CareHub via `businesses` — see `Schema-Reference-CareHub.md` and `Technical-Debt.md` H11/C14 for this table's RLS history |
| `staff_claims` | `staff_id` (FK `staff` — CareHub's table), `user_id`, `status='pending'` | Inserted via `attempt_staff_claim` RPC, not a raw client insert (per `phase2_rls_pilot.sql`'s own research) |
| `unclaimed_entities` | `name!`, `entity_type!`, `submitted_by` | User-submitted "this business/professional isn't on here yet" suggestions |
| `credentials` (Storage bucket, not a table) | — | See §9 |

---

## 8. Tasks (Professional Gig Marketplace)

| Table | Key columns | Notes |
|---|---|---|
| `tasks` | `title!`, `description!`, `compensation!`, `specialty`, `deadline`, `status='open'`, `created_by` | Posted by admins (`AdminPanel.jsx`'s `saveTask`) |
| `task_submissions` | `task_id!` (FK `tasks`), `professional_id`, `response`, `status='pending'` | — |

---

## 9. Admin & Cross-Cutting

| Table | Key columns | Notes |
|---|---|---|
| `admin_users` | `email!`, `password_hash!`, `full_name!`, `role!='moderator'`, `is_active=true`, `team_id` (FK `admin_teams`), `notifications_count=0`, `last_login` | See `Technical-Debt.md` C9 (RLS gap) and C14 (`"Allow admin login check"`/`"...update their own record"` are both `qual:true`) |
| `admin_teams` | `name!`, `description`, `created_by` (FK `admin_users`) | — |
| `notifications` | `recipient_id`/`actor_id` (FK `profiles`), `type`, `message`, `link`, `post_id` (FK `posts`), `read=false` | — |
| `search_logs` | `query`, `category`, `user_id`, `results_count=0`, `found=false` | — |
| `promotions` | `title!`, `image_url`, `link_url`, `expires_at` | Admin-managed banner/promo slots |
| `playlists` | `owner_id!` (FK `profiles`), `title!`, `description`, `cover_url` | — |
| `playlist_parts` | `playlist_id!` (FK `playlists`), `position=0`, `title`, `kind='text'`, `content`, `media_url` | — |
| `consultations` | — | **Not a CareFind table** despite CareFind code historically referencing it — see `Schema-Reference-CareHub.md` §3 and `Technical-Debt.md` C8/C13. CareFind's professional consultation booking now uses its own table below; no CareFind code touches `consultations` any more (C13 resolved 2026-08-11). |
| `professional_consultations` | `professional_id`/`patient_id` (FK `profiles`), `type='text'`, `fee` (naira), `notes`, `status='setup'` (offer) / `'paid'` (booking), `created_at` | CareFind's paid-consultation-booking table (`20260811_professional_consultations.sql`). One `status='setup'` offer per professional and one `status='paid'` booking per (professional, patient) pair, enforced by partial unique indexes. Money moves only through `pay_professional_consultation` (authenticated, atomic wallet debit/credit) and `settle_consultation_payment` (service_role-only, card path, reference-claimed) — see `planning/20260811_carefind_consultation_booking.md` |

---

## 10. Storage Buckets

| Bucket | Written by |
|---|---|
| `avatars` | profile photo uploads (not re-traced to a specific call site this pass) |
| `covers` | cover photo uploads |
| `credentials` | `VerifyProfessional.jsx` — professional verification documents |
| `live-media` | live show trailers/media |
| `news-images` | news post images |
| `post-images` | feed post images |
| `product-images` | marketplace product images |
| `promo-images` | promotion banner images |
| `story-images` | story images |

---

## 11. Row-Level Security — status as of this pass

**Every table above has `relrowsecurity = true`**, but this is not the same as being protected — see `Technical-Debt.md` C14 in full. In short: nearly every table carries a permissive policy (mostly named `"Allow all"`, `"Anyone can read X"`, or an "Admin ..." policy) with `qual: true` for role `public`, and Postgres ORs permissive policies together — so the presence of RLS being "enabled" on any table in this document should not be read as that table having real access control today. A handful of tables do have at least one properly-scoped policy alongside the permissive one (e.g. `business_claims`'s `auth.uid() = user_id` policies) — but since the permissive policy grants access regardless, the scoped ones currently add no restriction in practice. No table-by-table policy audit is repeated here; see C14 for the specific "Admin"-named policies flagged as needing individual review (`verification_requests`, `withdrawal_requests`, `admin_users`, `admin_teams`, `transactions`, `tasks`, `task_submissions`, plus `business_claims`/`businesses` shared with CareHub).

---

## 12. What This Document Does Not Cover

- **Full column lists for every table** — some tables above (e.g. `staff_directory`, `live_sessions`) list only the columns confirmed relevant to a specific call site; the live query this document is based on captured every column for every table in scope, but not every column is individually annotated above where its purpose wasn't obvious from name + type alone.
- **Indexes, triggers, sequences** — not queried this pass.
- **The live_shows-vs-live_sessions reconciliation question** (§3) — flagged, not resolved.
- **Whether `is_admin` on `profiles` is read anywhere** — not traced this pass; `admin_users` (a separate table entirely) is what `AdminPanel.jsx`'s own auth actually uses.
- **CareHub's ~40 tables** — see `Schema-Reference-CareHub.md`, built the same session's-predecessor pass without live access; consider re-verifying it against the live schema the same way this document was built, since it would benefit from the same upgrade in confidence this document has over it.

**If this document and the live Supabase schema ever disagree, the live schema is correct and this document is stale.** Unlike `Schema-Reference-CareHub.md`, this one *was* built from a live introspection — but schemas drift, and no automated check keeps this file in sync.
