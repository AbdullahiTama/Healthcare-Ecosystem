-- ============================================================================
-- 2026-08-13 — CareFind follows: real foreign keys from follows to profiles
--
-- WHY THIS EXISTS
-- ---------------
-- FollowersSheet.jsx lists a profile's followers/following with PostgREST
-- *embedded* joins:
--
--     follower_id, follower:follower_id(id, full_name, ...)
--     following_id, following:following_id(id, full_name, ...)
--
-- PostgREST can only resolve an embedded resource when the two tables are
-- linked by a real FOREIGN KEY. Schema-Reference-CareFind.md documents both
-- follows.follower_id and follows.following_id as "no FK constraint found …
-- referential integrity here is app-enforced only". Without a constraint,
-- every embedding fails, the request errors, and both profile sheets render
-- "Could not load this list. Please try again." on every profile. The reader
-- can see the counts (plain count queries still work) but never the list.
--
-- DESIGN
-- ------
-- * Orphan rows are deleted FIRST: the follower/following ids were never
--   enforced, so deleted auth users can leave dangling rows that would make
--   the FK's validation fail. Deleting them is safe — a follow whose subject
--   profile is gone is meaningless.
-- * Constraints are then added immediately (not NOT VALID): the cleanup ran
--   in the same migration, so there is nothing left to defer. A loud failure
--   at apply time is better than a silently skipped validate later.
-- * Indexes back the two embedding/where lookups the sheet and the profile
--   stat rows actually run (eq on following_id, eq on follower_id).
--
-- SCOPE
-- -----
-- Two foreign keys + two indexes. RLS is untouched (follows is already
-- correctly row-level-scoped, like the other social tables). Idempotent;
-- run once via the Supabase SQL editor.
-- ============================================================================

-- 1. Drop rows pointing at profiles that no longer exist (both directions).
--    Also self-follows are dropped: a follow of yourself is a UI mistake the
--    app already guards against, and it is the only shape that can survive
--    the FK while still being logically wrong.
delete from public.follows
 where follower_id not in (select id from public.profiles)
    or following_id not in (select id from public.profiles)
    or follower_id = following_id;

-- 2. The two foreign keys, guarded so re-running the migration is safe.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_follows_follower_profile') then
    alter table public.follows
      add constraint fk_follows_follower_profile
      foreign key (follower_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_follows_following_profile') then
    alter table public.follows
      add constraint fk_follows_following_profile
      foreign key (following_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

-- 3. Indexes so the sheet's lookups and the stat-row counts stay cheap.
create index if not exists follows_following_id_idx on public.follows (following_id);
create index if not exists follows_follower_id_idx on public.follows (follower_id);

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Constraints exist and ARE validated:
--        select conname, convalidated from pg_constraint
--        where conname like 'fk_follows_%';
--      Both rows: convalidated = true.
--   2. Embeddings resolve — GET on a profile with any followers:
--        /rest/v1/follows?select=follower_id,follower:id(id,full_name)&following_id=eq.<uuid>
--      returns rows with a nested `follower` object (no 400 "Could not find
--      relationship").
--   3. Profile → Followers / Following sheets in the app list people instead
--      of showing the error state.
-- ============================================================================