# CareFind social-feed engagement: uniqueness, reposts, sharing, persistence

**Date:** 2026-08-13
**App:** `apps/carefind`
**Status:** Implemented (SQL + JS). SQL not yet applied to the live database.

---

## What this phase fixed

The feed's engagement writes were optimistic and fire-and-forget. Consequences,
in order of severity:

1. **Vanish-on-reload.** `toggleLike`/`toggleSave` inserted with no `.select()`
   and no error handling. A silently failed write (RLS, network) left a temp
   row in state until the next feed load re-derived state from the DB, at which
   point the like/save simply disappeared. `toggleFollow` already did this
   correctly (temp-id → real-id swap); like/save never got the same treatment.
2. **Duplicates.** `post_reactions` and `saved_posts` had no uniqueness — a
   fast double-tap created two rows; unlike/unsave-by-id removed only one.
3. **Reposts weren't real.** A "repost" existed only as a display convention
   (content prefixed `🔁`, `postDisplay.jsx`); `apply_feed_audit.sql` itself
   notes "there is no post_reposts table". There was no repost button on feed
   cards and no count anywhere.
4. **Sharing left no trace.** `sharePost` discarded the outcome; there was no
   per-post share record.
5. **The feed had no memory.** Every load re-ranked the same 50 posts; nothing
   recorded what you'd seen or which feed tab you preferred.

---

## SQL (apply to the shared Supabase project, in this order)

| File | Adds |
|---|---|
| `sql/20260813_post_engagement_uniqueness.sql` | Dedupes `post_reactions` and `saved_posts`, then adds unique indexes `post_reactions_user_post_uniq` / `saved_posts_user_post_uniq` on `(post_id, user_id)` |
| `sql/20260813_post_reposts.sql` | `post_reposts` table + unique index + RLS (public read, self write); `posts.repost_count` (trigger-maintained via `maintain_post_repost_count`); `posts.repost_of` (FK → `posts`, cascade) for classic 🔁 repost posts |
| `sql/20260813_post_shares_and_gifts.sql` | `post_shares` + unique index + RLS; `post_gift_stats(uuid)` and `post_gift_stats_batch(uuid[])` SECURITY DEFINER RPCs (defensive against the unverifiable live `gifts` schema) |
| `sql/20260813_feed_persistence.sql` | `feed_config` (per-user prefs, owner-only RLS); `seen_posts` (read receipts, owner-only RLS); `read_posts_all(uuid[])` invoker RPC |

Each file is idempotent and carries a `VERIFY AFTER APPLYING` block.

**Dropped from the original plan, deliberately:**
- *Marketplace "nearby" RPCs* — "nearby" in CareFind is pure client-side
  (`haversineMeters`/`distanceLabel` in `src/modules/utils/marketplace.js`);
  there is no SQL-side geo join to replace. Building RPCs would be unnecessary
  abstraction (AGENTS.md).
- *`wallets` INSERT policy* — already exists at
  `sql/carefind_rls_hardening.sql` (`wallets insertable by their own user`).

---

## App changes

`src/modules/social-feed/Feed.jsx`
- `toggleLike` / `toggleSave` now insert with `.select().maybeSingle()`, swap
  the temp row for the real one, roll back state + toast on failure, and
  resolve a `23505` double-tap to the existing row via
  `insertRowResolvingConflict`.
- `sharePost` records a `post_shares` row (best-effort, never fails the share)
  after a successful share or copy.
- **Repost button** on feed cards (hidden on reposts themselves), showing
  `posts.repost_count`. `toggleRepost` writes the `post_reposts` reference AND
  a real `🔁`-prefixed post into the reposter's feed (`writeRepost`); undo
  removes both (`undoRepost`). Optimistic, with rollback when the feed-post
  write fails.
- **Gift counts** on the gift button via `post_gift_stats_batch` (one RPC per
  page), refreshed for the post after the gift panel closes.
- **Feed persistence:** seen posts get a small ranking boost and the page is
  marked read via `read_posts_all`; the active tab is persisted/restored via
  `feed_config`.
- Pre-migration safety: `loadFeed`/`searchPosts` fall back to the older column
  set if `repost_of`/`repost_count` don't exist yet (same pattern as the
  existing `search_vector` fallback).

`src/modules/social-feed/engagement.js` (new)
- `insertRowResolvingConflict(supabase, table, row, conflictColumns)` — the
  shared insert-and-reconcile primitive used by like, save, and the repost
  reference.
- `writeRepost(supabase, { user, post })` / `undoRepost(supabase, {...})` — the
  two-write classic repost, kept as testable units.

`src/modules/social-feed/engagement.test.js` (new)
- Covers fresh insert, 23505 read-back, non-23505 failure, read-back-nothing,
  and both repost write/undo paths with a scripted result-queue supabase mock.

**Profiles Reposts tab** (`PublicProfile.jsx`, `Profile.jsx`): no change needed
— with classic reposts the existing `isRepost` filter over the user's posts
shows exactly the reposts (now backed by real `post_reposts` records).

---

## Design decisions

- **Classic repost, not reference-only** (user-confirmed). A repost is a real
  `🔁`-marked `posts` row (`repost_of` → source, cascades when the source is
  deleted) plus a `post_reposts` reference. Followers see it in their feed;
  the source carries a real `repost_count`; the Reposts tab shows the
  reposted content as before. Subscriber-only/premium flags carry across so a
  repost of a locked post stays locked.
- **Unique indexes, not table constraints**, so future RPCs can target them
  with `ON CONFLICT`.
- **Dedupe before constraint**: duplicates are collapsed to the earliest `id`
  before the unique index lands, since these tables have no `created_at`.
- **RLS in the `follows` shape** for `post_reposts`/`post_shares`: public
  read, self (or anon) write. Counts are maintained by a SECURITY DEFINER
  trigger rather than by client-side writes, so the count column is never
  touched by normal sessions.

---

## Test plan

- **JS:** `npm test` in `apps/carefind` — **146 tests / 15 files all pass**,
  including `engagement.test.js` (11), the new `followers.test.js` (4, covering
  the `created_at` ordering fallback), and the new `newsArticle.test.jsx` (5,
  covering the `/news/:id` route's loading / not-found / error / view-record
  states). Production build (`npm run build`) is clean. Note: this suite was
  previously "blocked by a vitest startup hang" on this machine; the hang no
  longer reproduces — the full suite runs end-to-end.
- **Manual (after applying SQL):** like twice fast → one reaction row, like
  survives reload; unlike → count decrements. Same for save. Repost → a
  `🔁` post appears in your feed and `repost_count` increments on the source;
  undo removes both. Share → `post_shares` row written. Gift → count updates.
- **Security:** anon can SELECT `post_reposts`/`post_shares` but not insert
  with a `user_id` that isn't `auth.uid()`; `feed_config`/`seen_posts` are
  owner-only; the gift RPCs and `read_posts_all` are authenticated-only.

## Verification steps after applying the SQL

Follow the `VERIFY AFTER APPLYING` blocks in each migration file
(`pg_indexes`, `pg_policies`, and the behavioural probes they list).
