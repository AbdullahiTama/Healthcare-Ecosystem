-- ============================================================================
-- 2026-08-13 — CareFind engagement integrity: unique (post, user) rows
--
-- WHY THIS EXISTS
-- ---------------
-- A like or a save must be at most one row per (post, user). The tables have
-- never enforced that (Schema-Reference-CareFind.md: post_reactions is "One
-- row per (user, post) in practice, not DB-enforced"), and the client toggles
-- are optimistic — fire-and-forget inserts with temp ids. Two consequences:
--
--   1. Duplicates. A double-tap or a retried optimistic write can insert two
--      rows for the same (post, user); counts double and unlike-by-id removes
--      only one of them.
--   2. Vanish-on-reload. The insert is not reconciled: if it silently failed
--      (RLS, network), the UI kept the temp row until the next full load,
--      which re-derives state from the DB and the like/save simply disappears.
--
-- This migration closes #1 at the source (the DB). The client-side
-- reconciliation (#2) is handled in the matching app change
-- (Feed.jsx/useFeed.js toggle reconciliation) — this SQL is the foundation
-- that lets the write path be made atomic and idempotent.
--
-- DESIGN
-- ------
-- * Duplicates are collapsed FIRST, keeping the earliest id (these tables
--   have no created_at, so id order is the deterministic proxy), because a
--   unique index cannot be built over duplicate data.
-- * Unique INDEXES (not constraints) so ON CONFLICT in app/future RPC writes
--   can target them by name and the feed can upsert idempotently.
--
-- SCOPE
-- -----
-- Two dedupe sweeps + two unique indexes. RLS untouched (post_reactions and
-- saved_posts are already correctly self-scoped). Idempotent; run once via
-- the Supabase SQL editor.
-- ============================================================================

-- 1a. Collapse duplicate likes to the earliest row.
delete from public.post_reactions r
 where exists (
   select 1 from public.post_reactions k
    where k.post_id = r.post_id and k.user_id = r.user_id and k.id < r.id
 );

-- 1b. Collapse duplicate saves to the earliest row.
delete from public.saved_posts s
 where exists (
   select 1 from public.saved_posts k
    where k.post_id = s.post_id and k.user_id = s.user_id and k.id < s.id
 );

-- 2a. One like per (post, user). ON CONFLICT (post_id, user_id) targets this.
create unique index if not exists post_reactions_user_post_uniq
  on public.post_reactions (post_id, user_id);

-- 2b. One save per (post, user). ON CONFLICT (post_id, user_id) targets this.
create unique index if not exists saved_posts_user_post_uniq
  on public.saved_posts (post_id, user_id);

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Indexes exist:
--        select indexname from pg_indexes
--        where indexname in ('post_reactions_user_post_uniq', 'saved_posts_user_post_uniq');
--   2. No duplicates remain:
--        select post_id, user_id, count(*) from public.post_reactions
--        group by post_id, user_id having count(*) > 1;  -- must be empty
--        select post_id, user_id, count(*) from public.saved_posts
--        group by post_id, user_id having count(*) > 1;  -- must be empty
--   3. A raw insert of an existing (post, user) pair now errors with
--      duplicate_key_value_contraint instead of silently adding a row.
-- ============================================================================