-- # Phase 5 (G): story seen/unseen tracking.
-- Story rails show a teal ring when a user has unviewed stories and a grey
-- ring once every story has been seen. The ring needs per-(story, user) seen
-- state, so the view counter (increment_story_view, a bare count on stories)
-- is deliberately not used for that: it can't answer "has THIS viewer seen
-- THIS story". This table records exactly that.
--
-- Design:
--   * PRIMARY KEY (story_id, user_id) makes a mark-seen idempotent: a second
--     insert for the same viewer+story is a 23505, never a duplicate.
--   * Both FKs cascade on delete, so a deleted story or account cleans up
--     after itself (matching the engagement tables' cascade discipline).
--   * RLS is read-your-own-rows / write-your-own-rows: a viewer can record
--     and read only their own story views. Nobody can learn who else viewed
--     a story through this table.

create table if not exists public.story_views (
  story_id  uuid        not null references public.stories(id) on delete cascade,
  user_id   uuid        not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create index if not exists story_views_user_idx
  on public.story_views (user_id, viewed_at desc);

alter table public.story_views enable row level security;

-- A viewer can read their own view rows (used to compute "all seen" for a
-- story rail) and write their own view rows. No update/delete: once a story
-- is seen it stays seen.
drop policy if exists "story_views readable by their own viewer" on public.story_views;
create policy "story_views readable by their own viewer" on public.story_views
  for select
  using (user_id = auth.uid());

drop policy if exists "story_views insertable by their own viewer" on public.story_views;
create policy "story_views insertable by their own viewer" on public.story_views
  for insert
  with check (user_id = auth.uid());
