-- 2026-08-13 — CareFind follows: add created_at for newest-first ordering.
--
-- The `follows` social-graph table never had a created_at column (the schema
-- reference lists only follower_id/following_id). FollowersSheet.jsx ordered
-- its list by created_at, so every list render failed with PostgREST 400
-- ("Could not load this list. Please try again."). This migration gives the
-- table a real created_at (backfilled to now(), which is the honest value for
-- rows created before tracking existed) so the ordering can work.
--
-- The app is defensive: FollowersSheet falls back to an unordered query when
-- this migration hasn't been applied, so this file and the app change ship
-- independently.

-- 1. Add the column (no-op when already present).
alter table public.follows
  add column if not exists created_at timestamptz;

-- 2. Backfill existing rows before the NOT NULL constraint lands.
update public.follows
   set created_at = now()
 where created_at is null;

-- 3. Make it defaulted and mandatory going forward.
alter table public.follows
  alter column created_at set default now(),
  alter column created_at set not null;

-- 4. Index for newest-first list reads (followers/following sheets).
create index if not exists follows_created_at_idx
  on public.follows (created_at desc);

-- ---------------------------------------------------------------------------
-- VERIFY AFTER APPLYING:
--   select column_name, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'follows'
--      and column_name = 'created_at';
--   -- expect: is_nullable NO, column_default now()
--   select count(*) from public.follows where created_at is null; -- expect 0
--   -- and, via REST: GET /rest/v1/follows?select=following_id&order=created_at.desc
--   --   must return 200 (not PGRST204).
-- ---------------------------------------------------------------------------
