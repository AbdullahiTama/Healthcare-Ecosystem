-- ============================================================================
-- 2026-08-13 — CareFind repost integrity: one 🔁 feed post per (user, source)
--
-- WHY THIS EXISTS
-- ---------------
-- Phase 8 report, open item: a repost double-tap in one render tick publishes
-- two identical 🔁 posts. writeRepost dedupes the post_reposts reference via
-- insertRowResolvingConflict, but the mirrored `posts` row (repost_of) is a
-- plain insert — nothing stops a second identical feed post. Counts stayed
-- correct (they read post_reposts) and reloads self-healed, but the UI showed
-- two identical reposts until then.
--
-- DESIGN
-- ------
-- * Partial UNIQUE INDEX (not a constraint) on (user_id, repost_of) where the
--   column is set — matching the existing posts_repost_of_idx partial pattern
--   and the "unique INDEXES so ON CONFLICT can target them by name" convention
--   from 20260813_post_engagement_uniqueness.sql. A normal (non-repost) post
--   has repost_of NULL and is unaffected.
-- * Dedupe sweep first (keep the earliest id), because a unique index cannot
--   be built over duplicate data. Zero duplicates exist today; the sweep is a
--   safety net so the migration is safe on any branch state.
--
-- CLIENT COUNTERPART
-- ------------------
-- writeRepost (social-feed/engagement.js) now sends the posts row through
-- insertRowResolvingConflict on ['user_id', 'repost_of'], so a 23505 is
-- reconciled by reading the existing 🔁 post back instead of erroring; and
-- Feed.jsx toggleRepost has an in-flight guard so the second tap of a
-- double-tap does not even issue a write. The DB index is the authority; the
-- client changes just avoid the wasted write and the error path.
--
-- SCOPE
-- -----
-- RLS untouched. Idempotent; run once via the Supabase SQL editor.
-- ============================================================================

-- 1. Collapse any duplicate 🔁 feed posts to the earliest id (safety net; none
--    exist on the live DB today).
delete from public.posts p
 where p.repost_of is not null
   and exists (
     select 1 from public.posts k
      where k.repost_of = p.repost_of and k.user_id = p.user_id and k.id < p.id
   );

-- 2. One 🔁 feed post per (user, source post). ON CONFLICT (user_id, repost_of)
--    targets this; INSERT ... ON CONFLICT DO NOTHING is available to future
--    RPCs. Partial: only repost rows (repost_of IS NOT NULL) are constrained.
create unique index if not exists posts_user_repost_uniq
  on public.posts (user_id, repost_of)
  where repost_of is not null;

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Index exists:
--        select indexname from pg_indexes where indexname = 'posts_user_repost_uniq';
--   2. No duplicate 🔁 posts remain:
--        select user_id, repost_of, count(*) from public.posts
--         where repost_of is not null group by 1, 2 having count(*) > 1; -- empty
--   3. A second repost insert of the same (user, source) now errors with
--      duplicate_key_value_constraint instead of adding a twin feed post.
-- ============================================================================